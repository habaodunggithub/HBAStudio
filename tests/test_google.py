from copy import deepcopy
import httpx
from sqlalchemy import select
from backend import google_sync as google
from backend.db import Session, transaction
from backend.models import CalendarConnection, SyncMapping, CalendarEvent, TimeBlock, Deadline
from .conftest import create


class FakeGoogle:
    """Models provider ETags, paged incremental reads, and duplicate event IDs."""

    def __init__(self):
        self.events = {}
        self.serial = 0
        self.invalid = False

    def request(self, method, path, **kwargs):
        if path == "/calendars" and method == "POST":
            return {"id": "app-calendar"}
        parts = path.split("/")
        cid = parts[2]
        store = self.events.setdefault(cid, {})
        if method == "GET" and len(parts) == 4:
            if self.invalid and kwargs.get("params", {}).get("syncToken"):
                self.invalid = False
                self.error(410)
            return {"items": deepcopy(list(store.values())), "nextSyncToken": "token-" + str(self.serial)}
        eid = parts[4] if len(parts) > 4 else kwargs["json"]["id"]
        if method == "GET":
            if eid not in store:
                self.error(404)
            return deepcopy(store[eid])
        if method == "POST" and eid in store:
            self.error(409)
        if method in ("PUT", "DELETE"):
            if eid not in store:
                self.error(404)
            expected = kwargs.get("headers", {}).get("If-Match")
            if expected not in ("*", store[eid].get("etag")):
                self.error(412)
        if method == "DELETE":
            store.pop(eid)
            return {}
        self.serial += 1
        store[eid] = {**deepcopy(kwargs["json"]), "id": eid, "etag": str(self.serial)}
        return deepcopy(store[eid])

    def error(self, status):
        r = httpx.Response(status, request=httpx.Request("GET", "https://test.google/events"))
        raise httpx.HTTPStatusError("provider error", request=r.request, response=r)

    def change(self, cid, eid, **patch):
        self.serial += 1
        self.events[cid][eid].update(patch, etag=str(self.serial))


def connect():
    with transaction() as s:
        s.add(CalendarConnection(id="google", data={"selected_calendar_ids": [], "sync_tokens": {}}))


def mapping(kind):
    with Session() as s:
        return next(m.data.copy() for m in s.scalars(select(SyncMapping)) if m.data["kind"] == kind)


def test_roundtrip_remote_move_locks_block_and_retry_no_duplicate(client):
    connect()
    task = create(client, "tasks", title="Đọc đề", estimate_minutes=45)
    block = create(
        client,
        "blocks",
        title="Đọc đề",
        task_id=task["id"],
        start="2026-11-01T09:00:00+07:00",
        end="2026-11-01T09:45:00+07:00",
    )
    fake = FakeGoogle()
    google.sync(fake)
    google.sync(fake)
    assert len(fake.events["app-calendar"]) == 1
    m = mapping("blocks")
    fake.change(
        "app-calendar",
        m["event_id"],
        start={"dateTime": "2026-11-01T11:00:00+07:00", "timeZone": "Asia/Ho_Chi_Minh"},
        end={"dateTime": "2026-11-01T11:45:00+07:00", "timeZone": "Asia/Ho_Chi_Minh"},
    )
    google.sync(fake)
    with Session() as s:
        assert s.get(TimeBlock, block["id"]).data["locked"]
        assert "11:00" in s.get(TimeBlock, block["id"]).data["start"]


def test_remote_delete_does_not_delete_task_or_deadline(client):
    connect()
    task = create(client, "tasks", title="A")
    block = create(
        client,
        "blocks",
        title="A",
        task_id=task["id"],
        start="2026-11-01T09:00:00+07:00",
        end="2026-11-01T09:45:00+07:00",
    )
    deadline = create(client, "deadlines", title="Nộp", due_at="2026-11-02")
    fake = FakeGoogle()
    google.sync(fake)
    for kind in ("blocks", "deadlines"):
        m = mapping(kind)
        fake.change("app-calendar", m["event_id"], status="cancelled")
    google.sync(fake)
    google.sync(fake)
    assert len(client.get("/api/v1/tasks").json()) == 1
    with Session() as s:
        assert s.get(TimeBlock, block["id"]) is None
        assert s.get(Deadline, deadline["id"]) is not None


def test_two_sided_conflict_and_choose_remote(client):
    connect()
    event = create(
        client, "events", title="Gặp nhóm", start="2026-11-01T09:00:00+07:00", end="2026-11-01T10:00:00+07:00"
    )
    fake = FakeGoogle()
    google.sync(fake)
    m = mapping("events")
    client.patch("/api/v1/events/" + event["id"], json={"title": "Sửa local"})
    fake.change("app-calendar", m["event_id"], summary="Sửa Google")
    google.sync(fake)
    with Session() as s:
        conflict = next(m for m in s.scalars(select(SyncMapping)) if m.data.get("conflict"))
        ident = conflict.id
    assert client.post("/api/v1/google/conflicts/" + ident, json={"choice": "remote"}).status_code == 200
    assert client.get("/api/v1/events").json()[0]["title"] == "Sửa Google"


def test_external_calendar_readonly_and_recurrence_exception(client):
    connect()
    with transaction() as s:
        c = s.get(CalendarConnection, "google")
        c.data = {**c.data, "selected_calendar_ids": ["personal"]}
    fake = FakeGoogle()
    fake.events["personal"] = {
        "class": {
            "id": "class",
            "etag": "x",
            "summary": "Lớp",
            "start": {"dateTime": "2026-11-01T09:00:00+07:00"},
            "end": {"dateTime": "2026-11-01T10:00:00+07:00"},
            "recurrence": ["RRULE:FREQ=WEEKLY"],
        },
        "exception": {
            "id": "exception",
            "etag": "y",
            "recurringEventId": "class",
            "originalStartTime": {"dateTime": "2026-11-08T09:00:00+07:00"},
            "status": "cancelled",
        },
    }
    google.sync(fake)
    google.sync(fake)
    events = client.get("/api/v1/events").json()
    assert len(events) == 1 and events[0]["readonly"]
    assert events[0]["exceptions"]["2026-11-08T09:00:00+07:00"] is None
    assert client.patch("/api/v1/events/" + events[0]["id"], json={"title": "Không được sửa"}).status_code == 409
    assert not google.status(Session())["conflicts"]


def test_expired_sync_token_preserves_tasks_and_recovers(client):
    connect()
    create(client, "tasks", title="Giữ lại")
    fake = FakeGoogle()
    google.sync(fake)
    fake.invalid = True
    google.sync(fake)
    assert len(client.get("/api/v1/tasks").json()) == 1


def test_expired_sync_token_prunes_absent_google_cache_only(client):
    connect()
    create(client, "tasks", title="Giữ lại")
    with transaction() as s:
        c = s.get(CalendarConnection, "google")
        c.data = {**c.data, "selected_calendar_ids": ["personal"]}
    fake = FakeGoogle()
    fake.events["personal"] = {
        "meeting": {
            "id": "meeting",
            "etag": "1",
            "summary": "A",
            "start": {"dateTime": "2026-11-01T09:00:00+07:00"},
            "end": {"dateTime": "2026-11-01T10:00:00+07:00"},
        }
    }
    google.sync(fake)
    fake.change("personal", "meeting", summary="B")
    google.sync(fake)
    assert client.get("/api/v1/events").json()[0]["readonly"]
    fake.events["personal"].clear()
    with transaction() as s:
        c = s.get(CalendarConnection, "google")
        c.data = {**c.data, "sync_tokens": {}}
    google.sync(fake)
    assert not client.get("/api/v1/events").json()
    assert len(client.get("/api/v1/tasks").json()) == 1


def test_crash_after_insert_recovers_owned_identity(client):
    connect()
    event = create(client, "events", title="A", start="2026-11-01T09:00:00+07:00", end="2026-11-01T10:00:00+07:00")
    fake = FakeGoogle()
    google.sync(fake)
    with transaction() as s:
        for m in s.scalars(select(SyncMapping)):
            s.delete(m)
    google.sync(fake)
    assert len(client.get("/api/v1/events").json()) == 1
    assert len(fake.events["app-calendar"]) == 1


def test_oauth_state_rejected(client):
    assert client.get("/api/v1/google/callback?code=secret&state=invalid").status_code == 400


def test_disconnect_removes_external_cache_and_keeps_personal_tasks(client):
    connect()
    create(client, "tasks", title="Giữ công việc")
    with transaction() as s:
        s.add(CalendarEvent(id="external", data={"title": "Lịch ngoài", "readonly": True}))
    assert client.delete("/api/v1/google/connection").status_code == 200
    assert client.get("/api/v1/events").json() == []
    assert len(client.get("/api/v1/tasks").json()) == 1
