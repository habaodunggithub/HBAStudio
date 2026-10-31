import json
import pytest
from backend import arrangement, knowledge
from backend.db import Session
from backend.models import Document
from pathlib import Path
from .conftest import create


def fake_result(keys, links=None):
    return {
        "order": keys,
        "summary": "Đọc yêu cầu trước rồi chuẩn bị và nộp bài.",
        "links": links or [],
        "warnings": [],
    }


def test_proposal_reads_canonical_notes_tasks_and_sources_but_does_not_mutate(client, monkeypatch):
    work = create(client, "tasks", title="Báo cáo", checklist=[{"text": "Đọc yêu cầu", "done": False}])
    child = create(client, "tasks", title="Nộp bài", parent_id=work["id"])
    path = "/api/v1/canvas/work:tasks:" + work["id"]
    client.patch(path, json={"cards": {"note:one": {"title": "Chuẩn bị", "text": "Làm bản nháp"}}})
    doc = client.post(
        "/api/v1/knowledge/upload",
        data={"work_kind": "tasks", "work_id": work["id"]},
        files={"file": ("requirements.md", b"# Requirements\nRead before submitting.")},
    ).json()
    with Session() as s:
        file = Path(s.get(Document, doc["id"]).data["path"])
    knowledge.ingest(file, doc_id=doc["id"])
    keys = ["steps", "document:" + doc["id"], "note:one", "task:" + child["id"]]
    seen = []

    def run(payload):
        seen.append(payload)
        return fake_result(
            keys, [{"source": "note:one", "target": keys[-1], "reason": "Suy luận: soạn bản nháp trước khi nộp."}]
        )

    monkeypatch.setattr(arrangement, "run_codex", run)
    before = client.get(path).json()
    revision = client.get("/api/v1/workspace").json()["revision"]
    result = client.post(path + "/arrange", json={"keys": keys})
    assert result.status_code == 200
    assert result.json()["order"] == keys
    assert "Làm bản nháp" in json.dumps(seen[0], ensure_ascii=False)
    assert seen[0]["sources"][0]["card"] == "document:" + doc["id"]
    assert "Read before submitting" in seen[0]["sources"][0]["text"]
    assert "path" not in seen[0]["cards"][1]["content"]
    assert file.read_bytes() == b"# Requirements\nRead before submitting."
    assert client.get(path).json() == before
    assert client.get("/api/v1/workspace").json()["revision"] == revision


def test_membership_hidden_duplicates_and_limits_fail_before_codex(client, monkeypatch):
    work = create(client, "projects", title="Đồ án")
    other = create(client, "tasks", title="Ngoài đồ án")
    path = "/api/v1/canvas/work:projects:" + work["id"]
    client.patch(path, json={"hidden": ["steps"]})
    monkeypatch.setattr(arrangement, "run_codex", lambda _: pytest.fail("Must not call Codex"))
    for keys in [["steps"], ["task:" + other["id"]], ["note:missing"]]:
        assert client.post(path + "/arrange", json={"keys": keys}).status_code == 409
    for payload in [
        {"keys": []},
        {"keys": ["a"] * 81},
        {"keys": ["a"], "text": "forged"},
        {"keys": ["steps", "steps"]},
    ]:
        assert client.post(path + "/arrange", json=payload).status_code == 422
    assert client.post("/api/v1/canvas/course:missing/arrange", json={"keys": ["a"]}).status_code == 404
    client.cookies.clear()
    assert client.post(path + "/arrange", json={"keys": ["steps"]}).status_code == 401


@pytest.mark.parametrize("invalid", ["missing", "duplicate", "unknown", "reverse", "cycle", "foreign_link"])
def test_invalid_ai_order_and_links_cannot_be_accepted(client, monkeypatch, invalid):
    work = create(client, "tasks", title="Bài làm")
    path = "/api/v1/canvas/work:tasks:" + work["id"]
    client.patch(path, json={"cards": {"note:a": {"text": "A"}}})
    result = fake_result(["steps", "note:a"])
    if invalid == "missing":
        result["order"] = ["steps"]
    if invalid == "duplicate":
        result["order"] = ["steps", "steps"]
    if invalid == "unknown":
        result["order"] = ["steps", "note:unknown"]
    if invalid in ("reverse", "cycle", "foreign_link"):
        result["links"] = [{"source": "note:a", "target": "steps", "reason": "Sai thứ tự"}]
        if invalid == "cycle":
            result["links"].append({"source": "steps", "target": "note:a", "reason": "Vòng"})
        if invalid == "foreign_link":
            result["links"][0]["source"] = "foreign"
    monkeypatch.setattr(arrangement, "run_codex", lambda _: result)
    before = client.get(path).json()
    assert client.post(path + "/arrange", json={"keys": ["steps", "note:a"]}).status_code == 503
    assert client.get(path).json() == before


def test_course_home_unassigned_and_work_have_independent_canonical_scope(client, monkeypatch):
    course = create(client, "courses", title="Cơ sở dữ liệu")
    project = create(client, "projects", title="Đồ án", course_id=course["id"])
    deadline = create(client, "deadlines", title="Báo cáo", project_id=project["id"], due_at="2026-11-01")
    loose = create(client, "tasks", title="Chưa gắn môn")
    linked = create(client, "tasks", title="Việc thuộc bài", deadline_id=deadline["id"])
    seen = []

    def run(payload):
        seen.append(payload)
        return fake_result([c["key"] for c in payload["cards"]])

    monkeypatch.setattr(arrangement, "run_codex", run)
    for ident, keys in [
        ("home", ["courses:" + course["id"], "courses:unassigned"]),
        ("course:" + course["id"], ["deadlines:" + deadline["id"]]),
        ("unassigned", ["tasks:" + loose["id"]]),
        ("work", ["tasks:" + loose["id"], "deadlines:" + deadline["id"]]),
    ]:
        assert client.post(f"/api/v1/canvas/{ident}/arrange", json={"keys": keys}).status_code == 200
    assert "Báo cáo" in json.dumps(seen[0], ensure_ascii=False)
    for ident, key in [
        ("unassigned", "deadlines:" + deadline["id"]),
        ("work", "tasks:" + linked["id"]),
        ("course:" + course["id"], "tasks:" + loose["id"]),
    ]:
        assert client.post(f"/api/v1/canvas/{ident}/arrange", json={"keys": [key]}).status_code == 409


def test_explicit_dependencies_are_enforced_and_provider_failure_does_not_save(client, monkeypatch):
    work = create(client, "projects", title="Đồ án")
    before = create(client, "tasks", title="Đọc đề", project_id=work["id"])
    after = create(client, "tasks", title="Nộp", project_id=work["id"], depends_on=[before["id"]])
    keys = ["task:" + after["id"], "task:" + before["id"]]
    endpoint = "/api/v1/canvas/work:projects:" + work["id"] + "/arrange"
    monkeypatch.setattr(arrangement, "run_codex", lambda _: fake_result(keys))
    assert client.post(endpoint, json={"keys": keys}).status_code == 503
    monkeypatch.setattr(arrangement, "run_codex", lambda _: fake_result(list(reversed(keys))))
    assert client.post(endpoint, json={"keys": keys}).status_code == 200

    def failure(_):
        raise RuntimeError("Hết hạn mức")

    monkeypatch.setattr(arrangement, "run_codex", failure)
    assert client.post(endpoint, json={"keys": keys}).json()["detail"] == "Hết hạn mức"


def test_payload_keeps_each_card_and_bounds_long_contents(client):
    work = create(client, "tasks", title="Nguồn dài")
    path = "/api/v1/canvas/work:tasks:" + work["id"]
    client.patch(path, json={"cards": {f"note:{i}": {"text": "a" * 50000} for i in range(4)}})
    context = arrangement.context("work:tasks:" + work["id"], [f"note:{i}" for i in range(4)])
    assert len(context["cards"]) == 4
    assert all(len(c["content"]) <= 2500 for c in context["cards"])


def test_concurrent_changes_and_existing_arrow_conflicts_reject_the_proposal(client, monkeypatch):
    work = create(client, "tasks", title="Không gian thay đổi")
    path = "/api/v1/canvas/work:tasks:" + work["id"]
    client.patch(
        path,
        json={
            "cards": {"note:a": {"text": "Bản cũ"}},
            "edges": {"manual": {"source": "steps", "target": "note:a", "arrow": True}},
        },
    )
    keys = ["steps", "note:a"]
    monkeypatch.setattr(arrangement, "run_codex", lambda _: fake_result(list(reversed(keys))))
    assert client.post(path + "/arrange", json={"keys": keys}).status_code == 503
    client.patch(
        path,
        json={
            "edges": {
                "manual": {"source": "steps", "target": "note:a", "arrow": False},
                "arrange:old": {"source": "note:a", "target": "steps", "arrow": True},
            }
        },
    )
    monkeypatch.setattr(arrangement, "run_codex", lambda _: fake_result(keys))
    assert client.post(path + "/arrange", json={"keys": keys}).status_code == 200

    def changed(_):
        client.patch(path, json={"cards": {"note:a": {"text": "Bản mới"}}})
        return fake_result(keys)

    monkeypatch.setattr(arrangement, "run_codex", changed)
    response = client.post(path + "/arrange", json={"keys": keys})
    assert response.status_code == 409 and "đã thay đổi" in response.json()["detail"]
    assert client.get(path).json()["cards"]["note:a"]["text"] == "Bản mới"

    def changed_work(_):
        client.patch("/api/v1/tasks/" + work["id"], json={"title": "Mục tiêu mới"})
        return fake_result(keys)

    monkeypatch.setattr(arrangement, "run_codex", changed_work)
    assert client.post(path + "/arrange", json={"keys": keys}).status_code == 409
