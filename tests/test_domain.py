import pytest
from backend.db import Session
from backend.models import Task, TaskDependency
from .conftest import create


def test_linked_course_project_deadline_and_persistence(client):
    course = create(client, "courses", title="Hệ điều hành")
    project = create(client, "projects", title="Lab xv6", course_id=course["id"])
    deadline = create(client, "deadlines", title="Nộp lab", project_id=project["id"], due_at="2026-11-01")
    task = create(
        client, "tasks", title="Đọc đề", project_id=project["id"], deadline_id=deadline["id"], estimate_minutes=45
    )
    with Session() as s:
        assert s.get(Task, task["id"]).data["title"] == "Đọc đề"
    assert deadline["due_at"] == "2026-11-01T23:59:00+07:00"


def test_cycle_and_atomic_rollback(client):
    a = create(client, "tasks", title="A")
    b = create(client, "tasks", title="B", depends_on=[a["id"]])
    result = client.patch("/api/v1/tasks/" + a["id"], json={"depends_on": [b["id"]]})
    assert result.status_code == 422
    with Session() as s:
        assert s.get(Task, a["id"]).data["depends_on"] == []
        assert len(s.query(TaskDependency).all()) == 1


def test_parent_cycle(client):
    a = create(client, "tasks", title="A")
    b = create(client, "tasks", title="B", parent_id=a["id"])
    assert client.patch("/api/v1/tasks/" + a["id"], json={"parent_id": b["id"]}).status_code == 422


def test_delete_reference_is_rejected(client):
    a = create(client, "tasks", title="A")
    create(client, "tasks", title="B", depends_on=[a["id"]])
    assert client.delete("/api/v1/tasks/" + a["id"]).status_code == 422


@pytest.mark.parametrize(
    "kind,payload",
    [
        ("tasks", {"title": "  "}),
        ("tasks", {"title": "A", "estimate_minutes": -10}),
        ("tasks", {"title": "A", "priority": 9}),
        ("tasks", {"title": "A", "deadline_id": "missing"}),
        ("events", {"title": "X", "start": "2026-11-01T12:00:00+07:00", "end": "2026-11-01T11:00:00+07:00"}),
        ("deadlines", {"title": "X", "due_at": "wrong-date"}),
    ],
)
def test_invalid_input(client, kind, payload):
    assert client.post("/api/v1/" + kind, json=payload).status_code == 422


def test_draft_apply_once_and_undo(client):
    response = client.post(
        "/api/v1/proposals",
        json={
            "operations": [
                {
                    "kind": "tasks",
                    "action": "create",
                    "id": "step-a",
                    "data": {"title": "Đọc đề", "estimate_minutes": 30},
                },
                {
                    "kind": "tasks",
                    "action": "create",
                    "id": "step-b",
                    "data": {"title": "Làm bài", "depends_on": ["step-a"]},
                },
            ]
        },
    )
    assert response.status_code == 200, response.text
    p = response.json()
    assert client.get("/api/v1/tasks").json() == []
    result = client.post("/api/v1/proposals/" + p["id"] + "/apply")
    assert result.status_code == 200, result.text
    tasks = client.get("/api/v1/tasks").json()
    assert len(tasks) == 2
    assert next(t for t in tasks if t["id"] == "step-a")["estimate_source"] == "codex"
    assert client.post("/api/v1/proposals/" + p["id"] + "/apply").status_code == 409
    assert client.post("/api/v1/revisions/" + result.json()["revision_id"] + "/undo").status_code == 200
    assert client.get("/api/v1/tasks").json() == []


def test_stale_proposal_and_undo_conflict(client):
    a = create(client, "tasks", title="A")
    p = client.post(
        "/api/v1/proposals",
        json={"operations": [{"kind": "tasks", "action": "update", "id": a["id"], "data": {"title": "B"}}]},
    ).json()
    create(client, "tasks", title="Changed")
    assert client.post("/api/v1/proposals/" + p["id"] + "/apply").status_code == 409
    assert client.post("/api/v1/revisions/" + a["revision_id"] + "/undo").status_code == 409


def test_invalid_batch_does_not_partially_write(client):
    r = client.post(
        "/api/v1/changes",
        json={
            "operations": [
                {"kind": "tasks", "action": "create", "data": {"title": "A"}},
                {"kind": "tasks", "action": "create", "data": {"title": "B", "depends_on": ["missing"]}},
            ]
        },
    )
    assert r.status_code == 422
    assert client.get("/api/v1/tasks").json() == []


def test_blocks_do_not_overlap_fixed_or_each_other(client):
    task = create(client, "tasks", title="A")
    create(client, "events", title="Lớp", start="2026-11-01T09:00:00+07:00", end="2026-11-01T10:00:00+07:00")
    payload = {
        "title": "A",
        "task_id": task["id"],
        "start": "2026-11-01T09:30:00+07:00",
        "end": "2026-11-01T10:15:00+07:00",
    }
    assert client.post("/api/v1/blocks", json=payload).status_code == 409
    payload.update(start="2026-11-01T10:00:00+07:00", end="2026-11-01T10:45:00+07:00")
    assert client.post("/api/v1/blocks", json=payload).status_code == 200
    assert client.post("/api/v1/blocks", json=payload).status_code == 409


def test_done_block_does_not_finish_task(client):
    task = create(client, "tasks", title="A")
    block = create(
        client,
        "blocks",
        title="A",
        task_id=task["id"],
        start="2026-11-01T10:00:00+07:00",
        end="2026-11-01T10:45:00+07:00",
    )
    client.patch("/api/v1/blocks/" + block["id"], json={"status": "done"})
    assert client.get("/api/v1/tasks").json()[0]["status"] == "todo"


def test_origin_auth_and_host(client):
    assert (
        client.post("/api/v1/tasks", json={"title": "A"}, headers={"Origin": "https://attacker.example"}).status_code
        == 403
    )
    assert client.get("/api/v1/workspace", headers={"Host": "attacker.example"}).status_code == 403
    client.cookies.clear()
    assert client.get("/api/v1/workspace").status_code == 401


def test_edit_draft_and_reject_stale_edit(client):
    p = client.post(
        "/api/v1/proposals",
        json={
            "operations": [{"kind": "tasks", "action": "create", "data": {"title": "Draft", "estimate_minutes": 30}}]
        },
    ).json()
    ops = p["operations"]
    ops[0]["data"]["estimate_minutes"] = 60
    r = client.patch("/api/v1/proposals/" + p["id"], json={"operations": ops})
    assert r.status_code == 200, r.text
    assert r.json()["operations"][0]["data"]["estimate_minutes"] == 60
    assert client.get("/api/v1/tasks").json() == []
    create(client, "tasks", title="Thay đổi khác")
    assert client.patch("/api/v1/proposals/" + p["id"], json={"operations": ops}).status_code == 409


def test_settings_reject_bad_windows_and_recurrence(client):
    from backend.db import DEFAULT_SETTINGS

    assert (
        client.put(
            "/api/v1/settings",
            json={**DEFAULT_SETTINGS, "availability": [{"weekday": 0, "start": "20:00", "end": "19:00"}]},
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/api/v1/events",
            json={
                "title": "Bad rule",
                "start": "2026-11-01T09:00:00+07:00",
                "end": "2026-11-01T10:00:00+07:00",
                "recurrence": ["NOT A RULE"],
            },
        ).status_code
        == 422
    )


def test_api_preview_is_nonmutating_then_apply(client):
    from backend.db import DEFAULT_SETTINGS

    client.put(
        "/api/v1/settings",
        json={**DEFAULT_SETTINGS, "availability": [{"weekday": 6, "start": "09:00", "end": "12:00"}]},
    )
    create(client, "tasks", title="Làm bài", estimate_minutes=45, due_at="2026-11-01")
    r = client.post("/api/v1/plans/preview", json={"start": "2026-11-01T08:00:00+07:00", "days": 1})
    assert r.status_code == 200, r.text
    assert len(r.json()["preview"]["blocks"]) == 1
    assert client.get("/api/v1/blocks").json() == []
    assert client.post("/api/v1/proposals/" + r.json()["id"] + "/apply").status_code == 200
    assert len(client.get("/api/v1/blocks").json()) == 1
