"""Persistent, local request budgets and a single debounced sync scheduler."""

import random
import threading
import time
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime

import httpx
from pydantic import BaseModel, ConfigDict, Field
from .db import Session, transaction
from .models import CalendarConnection, OutboxJob

MINUTE_LIMIT = 30
DAY_LIMIT = 5000
DEFAULT_INTERVAL = 15
_sync_lock = threading.Lock()


def clock():
    return time.time()


def stamp(value):
    return datetime.fromtimestamp(value, timezone.utc).isoformat()


def epoch(value):
    return datetime.fromisoformat(value).timestamp() if value else 0


class SyncOptions(BaseModel):
    model_config = ConfigDict(extra="forbid")
    auto_sync: bool = True
    interval_minutes: int = Field(default=DEFAULT_INTERVAL, ge=5, le=120)


class Deferred(Exception):
    def __init__(self, message, until):
        super().__init__(message)
        self.until = until


def budget(info, at=None):
    at = clock() if at is None else at
    day = datetime.fromtimestamp(at, timezone.utc).date().isoformat()
    stored = info.get("api_budget", {})
    return {
        "day": day,
        "day_used": stored.get("day_used", 0) if stored.get("day") == day else 0,
        "recent": [t for t in stored.get("recent", []) if t > at - 60],
    }


def reserve_request(*, authentication=False):
    """Budget sync requests; identity checks also work before the first connection.

    Reauthorization must not inherit a failed token's sync backoff. Existing
    minute/day budgets still apply; no connection is created just to verify one.
    """
    at = clock()
    deferred = None
    with transaction() as s:
        c = s.get(CalendarConnection, "google")
        if not c:
            if authentication:
                return
            raise ValueError("Chưa kết nối Google Calendar")
        data = c.data
        until = max(0 if authentication else epoch(data.get("retry_at")), epoch(data.get("budget_retry_at")))
        if until > at:
            raise Deferred("Đồng bộ đang chờ để bảo vệ hạn mức API.", until)
        usage = budget(data, at)
        if usage["day_used"] >= DAY_LIMIT:
            until = epoch(usage["day"] + "T00:00:00+00:00") + 86400
            deferred = Deferred("Đã chạm mức lượt gọi trong ngày do Nhịp tự giới hạn.", until)
        elif len(usage["recent"]) >= MINUTE_LIMIT:
            until = min(usage["recent"]) + 60.1
            deferred = Deferred("Đang giãn lượt gọi Google Calendar.", until)
        else:
            usage["day_used"] += 1
            usage["recent"].append(at)
        c.data = {
            **data,
            "api_budget": usage,
            **({"budget_retry_at": stamp(until)} if deferred else {"budget_retry_at": None}),
        }
    if deferred:
        raise deferred


def options(s, payload):
    c = s.get(CalendarConnection, "google")
    if not c:
        from .domain import fail

        fail("Hãy kết nối Google Calendar trước")
    c.data = {
        **c.data,
        "auto_sync": payload.auto_sync,
        "interval_minutes": payload.interval_minutes,
        "next_pull_at": stamp(clock() + payload.interval_minutes * 60),
    }
    return {"ok": True}


def manual(s):
    from .domain import fail, queue_sync

    c = s.get(CalendarConnection, "google")
    if not c:
        fail("Chưa kết nối Google Calendar")
    at = clock()
    until = max(
        epoch(c.data.get("last_manual_at")) + 60, epoch(c.data.get("retry_at")), epoch(c.data.get("budget_retry_at"))
    )
    if at < until:
        fail("Đang chờ lượt đồng bộ tiếp theo. Nút đồng bộ không bỏ qua thời gian chờ hay hạn mức API.", 429)
    queue_sync(s)
    job = s.get(OutboxJob, "google-sync")
    job.data = {**job.data, "manual": True, "pull": True}
    c.data = {**c.data, "last_manual_at": stamp(at)}
    return {"status": "pending"}


def retry_delay(exc, failures, at):
    delay = min(3600, 30 * 2 ** min(failures - 1, 7)) * random.uniform(1, 1.25)
    if isinstance(exc, httpx.HTTPStatusError):
        response = exc.response
        if response.status_code in (401, 403):
            try:
                reasons = {e.get("reason") for e in response.json().get("error", {}).get("errors", [])}
            except (ValueError, AttributeError):
                reasons = set()
            if response.status_code == 403 and reasons & {
                "rateLimitExceeded",
                "userRateLimitExceeded",
                "quotaExceeded",
                "dailyLimitExceeded",
            }:
                delay = max(delay, 60)
            else:
                delay = max(delay, 900)
        retry = response.headers.get("Retry-After", "")
        try:
            delay = max(delay, float(retry))
        except ValueError:
            try:
                delay = max(delay, parsedate_to_datetime(retry).timestamp() - at)
            except (ValueError, TypeError):
                pass
    return delay


def tick(client=None):
    """Called by the worker, never by browser polling. No sleeps or immediate retries."""
    if not _sync_lock.acquire(blocking=False):
        return False
    try:
        at = clock()
        with transaction() as s:
            c = s.get(CalendarConnection, "google")
            if not c:
                return False
            info = c.data.copy()
            job = s.get(OutboxJob, "google-sync")
            pending = bool(job and job.data.get("status") == "pending")
            manual_request = pending and job.data.get("manual", False)
            if not info.get("auto_sync", True) and not manual_request:
                return False
            if max(epoch(info.get("retry_at")), epoch(info.get("budget_retry_at"))) > at:
                return False
            due_pull = (
                not info.get("last_pull")
                or at >= epoch(info.get("next_pull_at"))
                or pending
                and job.data.get("pull", False)
            )
            due_write = pending and at >= min(
                epoch(job.data.get("updated_at")) + 10,
                epoch(job.data.get("queued_at", job.data.get("updated_at"))) + 30,
            )
            if not (due_pull or due_write or manual_request):
                return False
            generation = job.data.get("generation", 0) if job else None
            c.data = {**info, "status": "syncing", "last_attempt": stamp(at)}
        try:
            from . import google_sync

            google_sync.sync(client=client, pull=bool(due_pull or manual_request))
        except Exception as exc:
            with transaction() as s:
                c = s.get(CalendarConnection, "google")
                if not c:
                    return False
                failures = c.data.get("failures", 0) + 1
                until = (
                    exc.until
                    if isinstance(exc, Deferred)
                    else max(clock() + retry_delay(exc, failures, clock()), epoch(c.data.get("retry_at")))
                )
                message = (
                    str(exc)
                    if isinstance(exc, Deferred)
                    else "Đồng bộ chưa thành công. Nhịp sẽ thử lại; kiểm tra mạng hoặc đăng nhập Google nếu lỗi kéo dài."
                )
                c.data = {
                    **c.data,
                    "status": "waiting" if isinstance(exc, Deferred) else "error",
                    "error": message,
                    "retry_at": stamp(until),
                    "failures": failures,
                }
                job = s.get(OutboxJob, "google-sync")
                if job:
                    job.data = {**job.data, "status": "pending", "attempts": job.data.get("attempts", 0) + 1}
            return False
        with transaction() as s:
            c = s.get(CalendarConnection, "google")
            if not c:
                return True
            extra = {}
            if due_pull or manual_request:
                extra = {
                    "last_pull": stamp(clock()),
                    "next_pull_at": stamp(
                        clock() + c.data.get("interval_minutes", DEFAULT_INTERVAL) * 60 * random.uniform(0.75, 1.25)
                    ),
                }
            c.data = {
                **c.data,
                **extra,
                "status": "ready",
                "failures": 0,
                "retry_at": None,
                "budget_retry_at": None,
                "error": None,
            }
            job = s.get(OutboxJob, "google-sync")
            if job and job.data.get("generation", 0) == generation:
                job.data = {**job.data, "status": "done", "manual": False, "pull": False, "attempts": 0}
        return True
    finally:
        _sync_lock.release()


def public(info, job=None):
    usage = budget(info)
    return {
        "auto_sync": info.get("auto_sync", True),
        "interval_minutes": info.get("interval_minutes", DEFAULT_INTERVAL),
        "last_pull": info.get("last_pull"),
        "next_pull_at": info.get("next_pull_at"),
        "retry_at": info.get("retry_at"),
        "pending_changes": bool(job and job.data.get("status") == "pending"),
        "quota": {
            "day_used": usage["day_used"],
            "day_limit": DAY_LIMIT,
            "minute_used": len(usage["recent"]),
            "minute_limit": MINUTE_LIMIT,
        },
    }
