import json
from pathlib import Path
from sqlalchemy import select
from backend import google_sync as google, priorities, workspaces, knowledge
from backend.db import Session, transaction
from backend.models import CalendarEvent, Document, SyncMapping
from .conftest import create
from .test_google import FakeGoogle, connect, mapping


def calendar(client, start="2026-11-01T00:00:00+07:00", end="2026-11-03T00:00:00+07:00"):
    return client.get("/api/v1/calendar", params={"start": start, "end": end}).json()


def test_all_day_import_and_legacy_refresh_keep_date_type(client):
    connect()
    from backend.models import CalendarConnection

    with transaction() as s:
        c = s.get(CalendarConnection, "google")
        c.data = {**c.data, "selected_calendar_ids": ["personal"]}
    fake = FakeGoogle()
    fake.events["personal"] = {
        "all-day": {
            "id": "all-day",
            "etag": "a",
            "summary": "Cả ngày",
            "start": {"date": "2026-11-01"},
            "end": {"date": "2026-11-02"},
        },
        "timed": {
            "id": "timed",
            "etag": "b",
            "summary": "Đúng 24 giờ",
            "start": {"dateTime": "2026-11-01T00:00:00+07:00"},
            "end": {"dateTime": "2026-11-02T00:00:00+07:00"},
        },
    }
    google.sync(fake)
    events = {e["title"]: e for e in calendar(client)}
    assert events["Cả ngày"]["allDay"] and events["Cả ngày"]["start"] == "2026-11-01"
    assert events["Cả ngày"]["end"] == "2026-11-02"
    assert not events["Đúng 24 giờ"]["allDay"]
    with transaction() as s:
        event = next(e for e in s.scalars(select(CalendarEvent)) if e.data["title"] == "Cả ngày")
        event.data = {k: v for k, v in event.data.items() if k != "all_day"}
        c = s.get(CalendarConnection, "google")
        c.data = {k: v for k, v in c.data.items() if k != "event_format_version"}
    google.sync(fake)
    assert next(e for e in calendar(client) if e["title"] == "Cả ngày")["allDay"]


def test_deadline_is_all_day_exclusive_end_and_tasks_are_not_calendar_events(client):
    deadline = create(client, "deadlines", title="Nộp bài", due_at="2026-11-01")
    task = create(client, "tasks", title="Làm bài", deadline_id=deadline["id"])
    create(
        client,
        "blocks",
        title="Buổi cũ",
        task_id=task["id"],
        start="2026-11-01T10:00:00+07:00",
        end="2026-11-01T10:45:00+07:00",
    )
    events = calendar(client)
    assert len(events) == 1
    assert events[0]["allDay"] and events[0]["start"] == "2026-11-01" and events[0]["end"] == "2026-11-02"
    assert not calendar(client, "2026-11-02T00:00:00+07:00", "2026-11-03T00:00:00+07:00")


def test_google_deadline_exports_date_and_remote_day_move_uses_end_of_day(client):
    connect()
    create(client, "deadlines", title="Nộp bài", due_at="2026-11-01")
    fake = FakeGoogle()
    google.sync(fake)
    m = mapping("deadlines")
    event = fake.events["app-calendar"][m["event_id"]]
    assert event["start"] == {"date": "2026-11-01"}
    assert event["end"] == {"date": "2026-11-02"}
    fake.change("app-calendar", m["event_id"], start={"date": "2026-11-03"}, end={"date": "2026-11-04"})
    google.sync(fake)
    assert client.get("/api/v1/deadlines").json()[0]["due_at"] == "2026-11-03T23:59:00+07:00"


def test_all_day_creation_and_color_validation(client):
    event = create(client, "events", title="Đi cả ngày", start="2026-11-01", end="2026-11-03")
    assert event["all_day"] and event["start"].endswith("T00:00:00+07:00")
    assert client.patch("/api/v1/calendar/colors", json={"events:Đi cả ngày": "#3f51b5"}).status_code == 200
    assert client.get("/api/v1/workspace").json()["settings"]["calendar_colors"]["events:Đi cả ngày"] == "#3f51b5"
    assert client.patch("/api/v1/calendar/colors", json={"bad": "red"}).status_code == 422


def test_linked_google_marker_appears_once_without_deleting_source(client):
    source = "https://www.google.com/calendar/event?eid=verified-source-id"
    create(
        client,
        "events",
        title="Nguồn Google",
        start="2026-11-01",
        end="2026-11-02",
        readonly=True,
        origin="google",
        google_event_url=source,
    )
    create(
        client,
        "deadlines",
        title="Deadline đã nhập",
        due_at="2026-11-01",
        description="Nguồn: " + source + "&ctz=Asia/Ho_Chi_Minh",
    )
    events = calendar(client)
    assert len(events) == 1 and events[0]["kind"] == "deadlines"
    assert len(client.get("/api/v1/events").json()) == 1
    # Other days and unrelated all-day entries are not hidden.
    create(
        client,
        "events",
        title="Ngày khác",
        start="2026-11-02",
        end="2026-11-03",
        readonly=True,
        origin="google",
        google_event_url=source,
    )
    assert len(calendar(client)) == 2


def test_order_propagates_urgent_deadline_to_prerequisites_without_estimates(client):
    later = create(client, "tasks", title="Việc xa", due_at="2026-12-01", priority=4)
    prerequisite = create(client, "tasks", title="Đọc đề")
    deadline = create(client, "deadlines", title="Nộp gấp", due_at="2026-11-02")
    blocked = create(client, "tasks", title="Nộp bài", deadline_id=deadline["id"], depends_on=[prerequisite["id"]])
    data = client.get("/api/v1/context").json()
    order = priorities.recommend(data, at="2026-11-01T09:00:00+07:00")
    assert [entry["id"] for entry in order] == [prerequisite["id"], blocked["id"], later["id"]]
    assert "mở khóa" in order[0]["reason"] and "Chờ" in order[1]["reason"]
    client.patch("/api/v1/tasks/" + prerequisite["id"], json={"status": "done"})
    order = priorities.recommend(client.get("/api/v1/context").json(), at="2026-11-01T09:00:00+07:00")
    assert order[0]["id"] == blocked["id"] and order[0]["blocked_by"] == []


def test_workspace_specific_documents_shared_sources_and_cache_invalidation(client, tmp_path, monkeypatch):
    a = create(client, "tasks", title="Bài A", description="Đọc đề và kiểm thử")
    b = create(client, "tasks", title="Bài B")
    for task, name, content in [
        (a, "de-a.md", "Yêu cầu A: phân tích và kiểm thử."),
        (b, "de-b.md", "Nội dung riêng của B."),
    ]:
        response = client.post(
            "/api/v1/knowledge/upload",
            files={"file": (name, content.encode(), "text/markdown")},
            data={"work_kind": "tasks", "work_id": task["id"]},
        )
        assert response.status_code == 200
        with Session() as s:
            doc = s.get(Document, response.json()["id"])
            knowledge.ingest(doc.data["path"], doc_id=doc.id)
    shared = tmp_path / "chung.md"
    shared.write_text("Quy định chung: ghi nguồn báo cáo.")
    knowledge.ingest(shared)
    context = client.get(f"/api/v1/workspaces/tasks/{a['id']}").json()
    assert {d["title"] for d in context["documents"]} == {"de-a.md", "chung.md"}
    assert all("riêng của B" not in source["text"] for source in context["sources"])
    calls = []

    def fake_agent(payload):
        calls.append(payload["fingerprint"])
        return {
            "summary": "Tóm tắt A",
            "steps": [{"title": "Kiểm thử A", "detail": "Theo đề.", "source_ids": [payload["sources"][0]["id"]]}],
            "warnings": [],
            "priority_reason": "Bắt đầu đọc đề.",
        }

    monkeypatch.setattr(workspaces, "run_codex", fake_agent)
    path = f"/api/v1/workspaces/tasks/{a['id']}/analyze"
    client.post(path, json={})
    workspaces._queue.join()
    client.post(path, json={})
    workspaces._queue.join()
    assert len(calls) == 1
    updated = client.get(f"/api/v1/workspaces/tasks/{a['id']}").json()
    assert updated["analysis"]["status"] == "ready" and not updated["analysis"]["stale"]
    client.patch("/api/v1/tasks/" + a["id"], json={"description": "Yêu cầu mới"})
    assert client.get(f"/api/v1/workspaces/tasks/{a['id']}").json()["analysis"]["stale"]
    client.post(path, json={})
    workspaces._queue.join()
    assert len(calls) == 2
    assert client.get("/api/v1/tasks").json()[0]["checklist"] == []  # Suggestions never change tasks implicitly.


def test_agent_uses_structured_readonly_cli_and_rejects_fabricated_citation(monkeypatch):
    monkeypatch.setattr(workspaces.shutil, "which", lambda _: "/bin/codex")
    monkeypatch.delenv("PDM_AGENT_ENABLED", raising=False)

    def fake_run(command, **kwargs):
        assert "--ignore-user-config" in command and "--ephemeral" in command
        assert command[command.index("--sandbox") + 1] == "read-only"
        assert "features.shell_tool=false" in command
        result = {
            "summary": "Tóm tắt",
            "steps": [{"title": "Bước", "detail": "Đề xuất", "source_ids": ["fabricated"]}],
            "priority_reason": "",
            "warnings": [],
        }
        Path(command[command.index("--output-last-message") + 1]).write_text(json.dumps(result))
        return type("Result", (), {"returncode": 0})()

    monkeypatch.setattr(workspaces.subprocess, "run", fake_run)
    payload = {k: [] for k in ("tasks", "sources", "recommendations")}
    payload.update(kind="tasks", item={"title": "Bài"}, project=None, deadline=None, sources_truncated=False)
    import pytest

    with pytest.raises(RuntimeError, match="dẫn nguồn"):
        workspaces.run_codex(payload)


def test_task_inherits_deadline_project_materials_and_parent_due(client, tmp_path):
    course = create(client, "courses", title="Môn A")
    project = create(client, "projects", title="Bài tập A", course_id=course["id"])
    deadline = create(client, "deadlines", title="Hạn A", due_at="2026-11-05", project_id=project["id"])
    parent = create(client, "tasks", title="Việc cha", deadline_id=deadline["id"])
    child = create(client, "tasks", title="Việc con", parent_id=parent["id"])
    document_path = tmp_path / "tai-lieu-project.md"
    document_path.write_text("Nội dung theo đồ án A")
    knowledge.ingest(document_path, project_id=project["id"])
    details = client.get(f"/api/v1/workspaces/tasks/{child['id']}").json()
    assert details["project"]["id"] == project["id"] and details["deadline"]["id"] == deadline["id"]
    assert details["sources"][0]["text"] == "Nội dung theo đồ án A"
