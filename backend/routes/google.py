"""Google HTTP endpoints."""

import json

from fastapi import APIRouter, HTTPException
from fastapi.responses import RedirectResponse
from sqlalchemy import delete, select

from .. import config, domain, google_sync, sync_policy
from ..db import transaction
from ..models import CalendarEvent, OutboxJob, SyncMapping, WorkspaceState
from ..worker import worker

router = APIRouter(tags=["google"])


@router.post("/api/v1/google/config")
def google_config(payload: dict):
    if "installed" not in payload or not payload["installed"].get("client_id"):
        domain.fail("Cần OAuth client JSON loại Desktop app")
    google_sync.private_write("google-client.json", json.dumps(payload))
    return {"ok": True}


@router.post("/api/v1/google/authorize")
def google_authorize():
    return {"url": google_sync.authorize()}


@router.get("/api/v1/google/callback")
def google_callback(code: str = "", state: str = "", error: str = ""):
    if error:
        google_sync.cancel(state)
        return RedirectResponse("/?google=cancelled#connections")
    try:
        google_sync.callback(code, state)
    except HTTPException as exc:
        if exc.status_code not in (429, 503):
            raise
        result = "limited" if exc.status_code == 429 else "failed"
        return RedirectResponse(f"/?google={result}#connections")
    worker.wake.set()
    return RedirectResponse("/?google=connected#connections")


@router.get("/api/v1/google/calendars")
def google_calendars():
    try:
        return google_sync.calendar_list()
    except sync_policy.Deferred as exc:
        domain.fail(str(exc), 429)
    except Exception:
        domain.fail("Không đọc được lịch. Hãy kết nối hoặc đăng nhập lại Google.", 502)


@router.put("/api/v1/google/selection")
def google_selection(payload: dict):
    ids = payload.get("calendar_ids", [])
    if not isinstance(ids, list) or len(ids) > 30 or not all(isinstance(x, str) for x in ids):
        domain.fail("Danh sách lịch không hợp lệ")
    with transaction() as s:
        c = google_sync.connection(s)
        if not c:
            domain.fail("Chưa kết nối Google")
        previous = set(c.data.get("selected_calendar_ids", []))
        for m in list(s.scalars(select(SyncMapping))):
            if m.data.get("readonly") and m.data["calendar_id"] in previous - set(ids):
                obj = s.get(CalendarEvent, m.data["entity_id"])
                if obj:
                    s.delete(obj)
                s.delete(m)
        c.data = {
            **c.data,
            "selected_calendar_ids": ids,
            "sync_tokens": {
                k: v for k, v in c.data.get("sync_tokens", {}).items() if k == c.data.get("calendar_id") or k in ids
            },
        }
        s.get(WorkspaceState, 1).revision += 1
        domain.queue_sync(s)
        job = s.get(OutboxJob, "google-sync")
        job.data = {**job.data, "pull": True}
    worker.wake.set()
    return {"ok": True}


@router.post("/api/v1/google/sync")
def sync():
    with transaction() as s:
        result = sync_policy.manual(s)
    worker.wake.set()
    return result


@router.put("/api/v1/google/sync-options")
def sync_options(payload: sync_policy.SyncOptions):
    with transaction() as s:
        result = sync_policy.options(s, payload)
    worker.wake.set()
    return result


@router.post("/api/v1/google/conflicts/{ident}")
def conflict(ident: str, payload: dict):
    with transaction() as s:
        google_sync.resolve(s, ident, payload.get("choice"))
        domain.queue_sync(s)
    worker.wake.set()
    return {"ok": True}


@router.delete("/api/v1/google/connection")
def disconnect():
    with transaction() as s:
        c = google_sync.connection(s)
        if c:
            s.delete(c)
        for event in list(s.scalars(select(CalendarEvent))):
            if event.data.get("readonly"):
                s.delete(event)
        s.execute(delete(SyncMapping))
        s.get(WorkspaceState, 1).revision += 1
    (config.DATA / "google-token.json").unlink(missing_ok=True)
    return {"ok": True}
