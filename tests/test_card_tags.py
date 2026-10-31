import json
from pathlib import Path
from backend import board_context, knowledge
from backend.db import Session
from backend.models import Document
from .conftest import create
from .test_chat import fake_codex, tool_event, wait_done


def reference(work, key, kind="tasks"):
    return {"kind": kind, "id": work["id"], "card_key": key}


def test_tagged_cards_and_document_sources_reach_codex_and_are_saved_in_history(client, fake_codex):
    work = create(client, "tasks", title="Dự án được gắn thẻ", checklist=[{"text": "Đọc yêu cầu", "done": True}])
    child = create(client, "tasks", title="Việc con", parent_id=work["id"], description="Chỉ làm phần báo cáo")
    path = "/api/v1/canvas/work:tasks:" + work["id"]
    client.patch(
        path, json={"cards": {"note:one": {"title": "Ý tưởng", "text": "Nội dung chọn riêng"}}, "suggestions": True}
    )
    upload = client.post(
        "/api/v1/knowledge/upload",
        data={"work_kind": "tasks", "work_id": work["id"]},
        files={"file": ("requirements.md", "# Nguồn đúng\nNộp bản phân tích vào thứ sáu.".encode())},
    ).json()
    with Session() as session:
        file = Path(session.get(Document, upload["id"]).data["path"])
    knowledge.ingest(file, doc_id=upload["id"])
    refs = [
        reference(work, key)
        for key in ["steps", "note:one", "task:" + child["id"], "document:" + upload["id"], "suggestions", "note:one"]
    ]
    revision = client.get("/api/v1/workspace").json()["revision"]
    servers = fake_codex([tool_event("get_planning_context", {})])
    thread = client.post("/api/v1/chat/threads").json()["id"]
    response = client.post(
        f"/api/v1/chat/threads/{thread}/messages",
        json={"text": "Giải thích các thẻ này", "context": None, "card_references": refs},
    )
    assert response.status_code == 200
    history = wait_done(client, thread)
    user = history["messages"][0]
    assert len(user["attached_cards"]) == 5 and user["document_ids"] == [upload["id"]]
    output = next(message for message in servers[0].sent if message.get("id") == 10)
    planning = json.loads(output["result"]["contentItems"][0]["text"])
    selected = {card["card_key"]: card for card in planning["attached_cards"]}
    assert selected["note:one"]["text"] == "Nội dung chọn riêng"
    assert selected["note:one"]["work_title"] == work["title"]
    assert "Đọc yêu cầu" in selected["steps"]["text"]
    assert "Chỉ làm phần báo cáo" in selected["task:" + child["id"]]["text"]
    assert selected["document:" + upload["id"]]["document_id"] == upload["id"]
    assert planning["attached_sources"][0]["document_id"] == upload["id"]
    assert "Nộp bản phân tích" in planning["attached_sources"][0]["text"]
    assert "path" not in selected["document:" + upload["id"]]
    assert client.get("/api/v1/workspace").json()["revision"] == revision
    assert not client.get("/api/v1/workspace").json()["proposals"]
    prompt = next(params for method, params in servers[0].requests if method == "turn/start")
    assert "attached_cards" in json.dumps(prompt)


def test_card_references_validate_membership_and_do_not_start_a_turn_on_failure(client, fake_codex):
    work = create(client, "projects", title="Đồ án A")
    other = create(client, "tasks", title="Việc ngoài đồ án")
    fake_codex()
    thread = client.post("/api/v1/chat/threads").json()["id"]
    endpoint = f"/api/v1/chat/threads/{thread}/messages"
    for key in ["note:missing", "task:" + other["id"], "document:missing", "suggestions", "../private"]:
        response = client.post(
            endpoint, json={"text": "Đọc thẻ", "card_references": [reference(work, key, "projects")]}
        )
        assert response.status_code == 404
    for ref in [
        {"kind": "sources", "id": work["id"], "card_key": "steps"},
        {**reference(work, "steps", "projects"), "text": "Client forged contents"},
        reference({"id": ""}, "steps"),
    ]:
        assert client.post(endpoint, json={"text": "Đọc thẻ", "card_references": [ref]}).status_code == 422
    assert (
        client.post(
            endpoint, json={"text": "Đọc thẻ", "card_references": [reference(work, "steps", "projects")] * 21}
        ).status_code
        == 422
    )
    assert client.get("/api/v1/chat/threads/" + thread).json()["messages"] == []
    client.cookies.clear()
    assert client.post(endpoint, json={"text": "Đọc thẻ", "card_references": []}).status_code == 401


def test_card_snapshots_are_bounded_and_remain_the_selected_version(client):
    work = create(client, "deadlines", title="Deadline", due_at="2026-11-01")
    path = "/api/v1/canvas/work:deadlines:" + work["id"]
    cards = {f"note:{i}": {"title": f"Ghi chú {i}", "text": str(i) * 30000} for i in range(6)}
    client.patch(path, json={"cards": cards})
    refs = [board_context.CardReference(**reference(work, key, "deadlines")) for key in cards]
    snapshot = board_context.resolve(refs)
    assert sum(len(card["text"]) for card in snapshot) == 48000
    assert all(card["truncated"] for card in snapshot)
    client.patch(path, json={"cards": {"note:0": {"title": "Đã đổi", "text": "Bản mới"}}})
    assert snapshot[0]["text"] == "0" * 12000
    assert board_context.resolve(refs)[0]["text"] == "Bản mới"


def test_pending_document_tag_waits_and_deleted_note_cannot_be_sent(client, fake_codex):
    work = create(client, "tasks", title="Nguồn đang xử lý")
    upload = client.post(
        "/api/v1/knowledge/upload",
        data={"work_kind": "tasks", "work_id": work["id"]},
        files={"file": ("pending.txt", b"waiting")},
    ).json()
    fake_codex()
    thread = client.post("/api/v1/chat/threads").json()["id"]
    response = client.post(
        f"/api/v1/chat/threads/{thread}/messages",
        json={"text": "Đọc tài liệu", "card_references": [reference(work, "document:" + upload["id"])]},
    )
    assert response.status_code == 409 and "đang được xử lý" in response.json()["detail"]
    endpoint = "/api/v1/canvas/work:tasks:" + work["id"]
    client.patch(endpoint, json={"cards": {"note:delete": {"title": "Xóa", "text": "old"}}})
    client.patch(endpoint, json={"cards": {"note:delete": None}})
    assert (
        client.post(
            f"/api/v1/chat/threads/{thread}/messages",
            json={"text": "Đọc thẻ", "card_references": [reference(work, "note:delete")]},
        ).status_code
        == 404
    )
