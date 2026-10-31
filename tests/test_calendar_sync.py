from copy import deepcopy
from datetime import datetime, timezone
from types import SimpleNamespace
import httpx
import pytest
from sqlalchemy import select
from backend import google_sync as google, sync_policy as policy, domain
from backend.db import Session, transaction
from backend.models import CalendarConnection, OutboxJob, SyncMapping, CalendarEvent
from .conftest import create
from .test_google import FakeGoogle, connect, mapping


def move(client, kind, item, start, end, all_day=False, **kw):
    return client.post(
        f"/api/v1/calendar/{kind}/{item['id']}/move",
        json={
            "start": start,
            "end": end,
            "all_day": all_day,
            "expected_start": item["start"],
            "expected_end": item["end"],
            **kw,
        },
    )


def test_calendar_move_resize_undo_and_stale_rejection(client):
    event = create(client, "events", title="Họp", start="2026-11-01T09:00:00+07:00", end="2026-11-01T10:00:00+07:00")
    result = move(client, "events", event, "2026-11-02T10:00:00+07:00", "2026-11-02T11:30:00+07:00")
    assert result.status_code == 200
    assert move(client, "events", event, "2026-11-03T10:00:00+07:00", "2026-11-03T11:00:00+07:00").status_code == 409
    current = client.get("/api/v1/events").json()[0]
    assert current["start"].startswith("2026-11-02T10:00")
    assert current["end"].startswith("2026-11-02T11:30")
    assert client.post("/api/v1/revisions/" + result.json()["revision_id"] + "/undo").status_code == 200
    assert client.get("/api/v1/events").json()[0]["start"] == event["start"]
    invalid = move(client, "events", event, "2026-11-02", "2026-11-01", True)
    assert invalid.status_code == 422


def test_calendar_deadline_keeps_due_clock_and_readonly_is_protected(client):
    due = create(client, "deadlines", title="Nộp bài", due_at="2026-11-01T17:00:00+07:00")
    assert (
        move(
            client,
            "deadlines",
            {"id": due["id"], "start": "2026-11-01", "end": "2026-11-02"},
            "2026-11-03",
            "2026-11-04",
            True,
        ).status_code
        == 200
    )
    assert client.get("/api/v1/deadlines").json()[0]["due_at"] == "2026-11-03T17:00:00+07:00"
    external = create(client, "events", title="Lịch Google khác", start="2026-11-01", end="2026-11-02", readonly=True)
    assert move(client, "events", external, "2026-11-03", "2026-11-04", True).status_code == 409
    assert client.get("/api/v1/events").json()[0]["start"] == external["start"]


def test_move_recurring_occurrence_not_series_and_validate_original(client):
    event = create(
        client,
        "events",
        title="Học tuần",
        start="2026-11-01T09:00:00+07:00",
        end="2026-11-01T10:00:00+07:00",
        recurrence=["RRULE:FREQ=WEEKLY;COUNT=4"],
    )
    occurrence = {**event, "start": "2026-11-08T09:00:00+07:00", "end": "2026-11-08T10:00:00+07:00"}
    result = move(
        client,
        "events",
        occurrence,
        "2026-11-09T14:00:00+07:00",
        "2026-11-09T15:00:00+07:00",
        occurrence_key=occurrence["start"],
    )
    assert result.status_code == 200
    current = client.get("/api/v1/events").json()[0]
    assert current["start"] == event["start"] and len(current["exceptions"]) == 1
    assert (
        move(
            client,
            "events",
            occurrence,
            "2026-11-10T14:00:00+07:00",
            "2026-11-10T15:00:00+07:00",
            occurrence_key="2026-11-02T09:00:00+07:00",
        ).status_code
        == 422
    )
    events = client.get("/api/v1/calendar", params={"start": "2026-11-08", "end": "2026-11-11"}).json()
    shifted = next(e for e in events if e["id"] == event["id"])
    assert shifted["start"].startswith("2026-11-09T14:00") and shifted["occurrence_key"] == occurrence["start"]


def test_optional_blocks_move_locks_and_overlap_rolls_back(client):
    task = create(client, "tasks", title="Đọc")
    block = create(
        client,
        "blocks",
        title="Đọc",
        task_id=task["id"],
        start="2026-11-01T08:00:00+07:00",
        end="2026-11-01T09:00:00+07:00",
    )
    create(client, "events", title="Bận", start="2026-11-01T10:00:00+07:00", end="2026-11-01T11:00:00+07:00")
    assert move(client, "blocks", block, "2026-11-01T10:00:00+07:00", "2026-11-01T11:00:00+07:00").status_code == 409
    assert move(client, "blocks", block, "2026-11-01T12:00:00+07:00", "2026-11-01T13:00:00+07:00").status_code == 200
    assert client.get("/api/v1/blocks").json()[0]["locked"]
    params = {"start": "2026-11-01", "end": "2026-11-02"}
    assert not any(e["kind"] == "blocks" for e in client.get("/api/v1/calendar", params=params).json())
    assert any(
        e["kind"] == "blocks"
        for e in client.get("/api/v1/calendar", params={**params, "include_blocks": "true"}).json()
    )


def test_google_budget_persists_and_prevents_network_calls(client, monkeypatch):
    connect()
    at = [1800000000.0]
    monkeypatch.setattr(policy, "clock", lambda: at[0])
    monkeypatch.setattr(google, "credentials", lambda: SimpleNamespace(token="fixture"))
    sent = []
    transport = httpx.MockTransport(lambda request: sent.append(request) or httpx.Response(200, json={"items": []}))
    original = httpx.Client
    monkeypatch.setattr(google.httpx, "Client", lambda **kwargs: original(transport=transport, **kwargs))
    for _ in range(policy.MINUTE_LIMIT):
        google.GoogleClient().request("GET", "/users/me/calendarList")
    with pytest.raises(policy.Deferred):
        google.GoogleClient().request("GET", "/users/me/calendarList")
    assert len(sent) == policy.MINUTE_LIMIT
    at[0] += 61
    google.GoogleClient().request("GET", "/users/me/calendarList")
    with transaction() as s:
        c = google.connection(s)
        usage = policy.budget(c.data)
        usage["day_used"] = policy.DAY_LIMIT
        c.data = {**c.data, "api_budget": usage}
    with pytest.raises(policy.Deferred):
        google.GoogleClient().request("GET", "/users/me/calendarList")
    assert len(sent) == policy.MINUTE_LIMIT + 1
    with Session() as s:
        assert google.status(s)["quota"]["day_used"] == policy.DAY_LIMIT
    at[0] += 86401
    google.GoogleClient().request("GET", "/users/me/calendarList")


def test_sync_debounces_pushes_and_does_not_pull_after_every_local_edit(client, monkeypatch):
    connect()
    fake = FakeGoogle()
    google.sync(fake)
    at = [1800000000.0]
    monkeypatch.setattr(policy, "clock", lambda: at[0])
    with transaction() as s:
        c = google.connection(s)
        c.data = {**c.data, "last_pull": policy.stamp(at[0]), "next_pull_at": policy.stamp(at[0] + 900)}
    event = create(
        client, "events", title="Gộp thay đổi", start="2026-11-01T09:00:00+07:00", end="2026-11-01T10:00:00+07:00"
    )
    with transaction() as s:
        j = s.get(OutboxJob, "google-sync")
        j.data = {**j.data, "updated_at": policy.stamp(at[0]), "queued_at": policy.stamp(at[0])}
    assert not policy.tick(fake)
    client.patch("/api/v1/events/" + event["id"], json={"title": "Bản mới nhất"})
    calls = []
    original = fake.request
    fake.request = lambda method, path, **kwargs: calls.append((method, path)) or original(method, path, **kwargs)
    at[0] += 31
    assert policy.tick(fake)
    assert [m for m, p in calls] == ["POST"]
    assert next(iter(fake.events["app-calendar"].values()))["summary"] == "Bản mới nhất"
    assert not policy.tick(fake)
    at[0] += 1000
    assert policy.tick(fake) and calls[-1] == ("GET", "/calendars/app-calendar/events")


def test_backoff_retry_after_manual_cannot_bypass_and_pause_survives(client, monkeypatch):
    connect()
    at = [1800000000.0]
    monkeypatch.setattr(policy, "clock", lambda: at[0])

    class Throttled:
        count = 0

        def request(self, *args, **kwargs):
            self.count += 1
            response = httpx.Response(
                429, headers={"Retry-After": "180"}, request=httpx.Request("GET", "https://fixture")
            )
            raise httpx.HTTPStatusError("fixture", request=response.request, response=response)

    fake = Throttled()
    assert not policy.tick(fake)
    assert fake.count == 1
    with Session() as s:
        assert policy.epoch(google.connection(s).data["retry_at"]) >= at[0] + 180
    assert not policy.tick(fake) and fake.count == 1
    assert client.post("/api/v1/google/sync").status_code == 429
    assert (
        client.put("/api/v1/google/sync-options", json={"auto_sync": False, "interval_minutes": 30}).status_code == 200
    )
    at[0] += 1000
    assert not policy.tick(fake) and fake.count == 1
    assert client.post("/api/v1/google/sync").status_code == 200
    assert client.post("/api/v1/google/sync").status_code == 429


def test_changed_during_sync_stays_queued(client, monkeypatch):
    connect()

    def syncing(**kwargs):
        with transaction() as s:
            domain.queue_sync(s)

    monkeypatch.setattr(google, "sync", syncing)
    assert policy.tick(FakeGoogle())
    with Session() as s:
        assert s.get(OutboxJob, "google-sync").data["status"] == "pending"


def test_google_calendar_list_cache_and_incremental_pagination():
    connect()
    calls = []

    class Paged:
        def request(self, method, path, **kwargs):
            params = deepcopy(kwargs.get("params", {}))
            calls.append((path, params))
            if path == "/users/me/calendarList":
                return {"items": [{"id": "a"}]}
            return {"items": [], **({"nextSyncToken": "new"} if params.get("pageToken") else {"nextPageToken": "p2"})}

    fake = Paged()
    assert google.calendar_list(fake)["items"] == [{"id": "a"}]
    assert google.calendar_list(fake)["cached"]
    assert len(calls) == 1
    assert google.pull_calendar(fake, "a", "old") == ([], "new", False)
    assert calls[-1][1] == {"syncToken": "old", "showDeleted": "true", "maxResults": 2500, "pageToken": "p2"}


def test_provider_throttling_blocks_other_request_paths_too(monkeypatch):
    connect()
    at = [1800000000.0]
    monkeypatch.setattr(policy, "clock", lambda: at[0])
    monkeypatch.setattr(google, "credentials", lambda: SimpleNamespace(token="fixture"))
    calls = []
    transport = httpx.MockTransport(
        lambda request: (
            calls.append(request)
            or httpx.Response(
                429, headers={"Retry-After": "120"}, json={"error": {"errors": [{"reason": "rateLimitExceeded"}]}}
            )
        )
    )
    original = httpx.Client
    monkeypatch.setattr(google.httpx, "Client", lambda **kwargs: original(transport=transport, **kwargs))
    with pytest.raises(httpx.HTTPStatusError):
        google.GoogleClient().request("GET", "/users/me/calendarList")
    with pytest.raises(policy.Deferred):
        google.GoogleClient().request("GET", "/calendars/fixture/events")
    assert len(calls) == 1
    with Session() as s:
        assert policy.epoch(google.connection(s).data["retry_at"]) >= at[0] + 120


def test_sync_resumes_remaining_calendars_after_hitting_minute_budget(monkeypatch):
    connect()
    at = [1800000000.0]
    monkeypatch.setattr(policy, "clock", lambda: at[0])
    with transaction() as s:
        c = google.connection(s)
        c.data = {**c.data, "selected_calendar_ids": ["personal-" + str(i) for i in range(30)]}
    fake = FakeGoogle()
    original = fake.request
    calls = []

    def request(method, path, **kwargs):
        policy.reserve_request()
        calls.append((method, path))
        return original(method, path, **kwargs)

    fake.request = request
    assert not policy.tick(fake)
    assert len(calls) == policy.MINUTE_LIMIT
    with Session() as s:
        assert len(google.connection(s).data["pull_pending"]) == 2
    at[0] += 61
    assert policy.tick(fake)
    assert len(calls) == 32
    assert len({path for method, path in calls if method == "GET"}) == 31
    with Session() as s:
        assert google.connection(s).data["pull_pending"] is None


@pytest.mark.parametrize("choice", ["local", "remote"])
def test_recurring_conflict_never_silently_overwrites_other_side(client, choice):
    connect()
    event = create(
        client,
        "events",
        title="Học lặp",
        start="2026-11-01T09:00:00+07:00",
        end="2026-11-01T10:00:00+07:00",
        recurrence=["RRULE:FREQ=WEEKLY;COUNT=4"],
    )
    fake = FakeGoogle()
    google.sync(fake)
    master = mapping("events")
    key = "2026-11-08T09:00:00+07:00"
    instance = {
        "id": "instance",
        "etag": "one",
        "recurringEventId": master["event_id"],
        "originalStartTime": {"dateTime": key},
        "summary": "Học lặp",
        "start": {"dateTime": key},
        "end": {"dateTime": "2026-11-08T10:00:00+07:00"},
    }
    fake.events["app-calendar"]["instance"] = deepcopy(instance)
    google.sync(fake)
    occurrence = {**event, "start": key, "end": "2026-11-08T10:00:00+07:00"}
    assert (
        move(
            client, "events", occurrence, "2026-11-08T14:00:00+07:00", "2026-11-08T15:00:00+07:00", occurrence_key=key
        ).status_code
        == 200
    )
    fake.change(
        "app-calendar",
        "instance",
        start={"dateTime": "2026-11-08T16:00:00+07:00"},
        end={"dateTime": "2026-11-08T17:00:00+07:00"},
    )
    google.sync(fake)
    assert fake.events["app-calendar"]["instance"]["start"]["dateTime"].startswith("2026-11-08T16:00")
    with Session() as s:
        ident = next(m.id for m in s.scalars(select(SyncMapping)) if m.data.get("conflict"))
    assert client.post("/api/v1/google/conflicts/" + ident, json={"choice": choice}).status_code == 200
    google.sync(fake, pull=False)
    expected = "14:00" if choice == "local" else "16:00"
    assert expected in fake.events["app-calendar"]["instance"]["start"]["dateTime"]
    assert expected in client.get("/api/v1/events").json()[0]["exceptions"][key]["start"]


def test_google_exception_push_and_undo_restore_one_occurrence(client):
    connect()
    event = create(
        client,
        "events",
        title="Học",
        start="2026-11-01T09:00:00+07:00",
        end="2026-11-01T10:00:00+07:00",
        recurrence=["RRULE:FREQ=WEEKLY;COUNT=4"],
    )
    fake = FakeGoogle()
    google.sync(fake)
    master = mapping("events")
    instance = {
        "id": "instance",
        "etag": "one",
        "recurringEventId": master["event_id"],
        "originalStartTime": {"dateTime": "2026-11-08T09:00:00+07:00"},
        "summary": "Học",
        "start": {"dateTime": "2026-11-08T09:00:00+07:00"},
        "end": {"dateTime": "2026-11-08T10:00:00+07:00"},
    }
    fake.events["app-calendar"]["instance"] = deepcopy(instance)
    original = fake.request
    calls = []

    def request(method, path, **kwargs):
        calls.append((method, path))
        if path.endswith("/instances"):
            return {"items": [deepcopy(fake.events["app-calendar"]["instance"])]}
        result = original(method, path, **kwargs)
        if method == "PUT" and path.endswith("/instance"):
            fake.events["app-calendar"]["instance"].update(
                recurringEventId=instance["recurringEventId"], originalStartTime=instance["originalStartTime"]
            )
        return result

    fake.request = request
    occurrence = {**event, "start": "2026-11-08T09:00:00+07:00", "end": "2026-11-08T10:00:00+07:00"}
    result = move(
        client,
        "events",
        occurrence,
        "2026-11-09T14:00:00+07:00",
        "2026-11-09T15:00:00+07:00",
        occurrence_key=occurrence["start"],
    )
    assert result.status_code == 200
    google.sync(fake, pull=False)
    assert fake.events["app-calendar"]["instance"]["start"]["dateTime"] == "2026-11-09T14:00:00+07:00"
    assert fake.events["app-calendar"][master["event_id"]]["start"]["dateTime"] == event["start"]
    calls.clear()
    google.sync(fake, pull=False)
    assert not calls
    client.post("/api/v1/revisions/" + result.json()["revision_id"] + "/undo")
    google.sync(fake, pull=False)
    assert fake.events["app-calendar"]["instance"]["start"]["dateTime"] == "2026-11-08T09:00:00+07:00"
