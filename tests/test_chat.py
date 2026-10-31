import threading
import time

import pytest

from backend import chat
from backend.db import transaction
from backend.models import ChatThread


def wait_done(client, ident):
    for _ in range(200):
        result = client.get("/api/v1/chat/threads/" + ident).json()
        if result["status"] != "running":
            return result
        time.sleep(0.01)
    pytest.fail("Chat did not finish")


class FakeServer:
    cwd = "/tmp"

    def __init__(self, events=(), gate=None):
        self.events = iter(events)
        self.requests = []
        self.sent = []
        self.gate = gate

    def request(self, method, params, job, deadline):
        self.requests.append((method, params))
        if method == "account/read":
            return {"account": {"type": "chatgpt"}}
        if method in ("thread/start", "thread/resume"):
            return {"thread": {"id": "codex-test-thread"}}
        if method == "turn/start":
            return {"turn": {"id": "turn-1"}}
        return {}

    def receive(self, job, deadline):
        while self.gate and not self.gate.wait(0.01):
            if job.cancelled.is_set():
                raise chat.Interrupted()
        if job.cancelled.is_set():
            raise chat.Interrupted()
        return next(
            self.events, {"method": "turn/completed", "params": {"turn": {"id": "turn-1", "status": "completed"}}}
        )

    def send(self, message):
        self.sent.append(message)

    def close(self):
        pass

    def interrupt(self, thread_id, turn_id):
        self.sent.append({"method": "turn/interrupt", "params": {"threadId": thread_id, "turnId": turn_id}})


def tool_event(name, arguments, ident=10):
    return {
        "id": ident,
        "method": "item/tool/call",
        "params": {"callId": str(ident), "tool": name, "arguments": arguments},
    }


@pytest.fixture
def fake_codex(monkeypatch):
    monkeypatch.delenv("PDM_AGENT_ENABLED", raising=False)
    monkeypatch.setattr(chat.shutil, "which", lambda _: "/bin/codex")
    servers = []

    def install(events=(), gate=None):
        def factory():
            server = FakeServer(events, gate)
            servers.append(server)
            return server

        monkeypatch.setattr(chat, "AppServer", factory)
        return servers

    return install


def test_chat_streams_persists_resumes_and_only_creates_reviewable_draft(client, fake_codex):
    operation = {"kind": "tasks", "action": "create", "data": {"title": "Ôn chương 2", "estimate_minutes": 30}}
    proposal_event = tool_event(
        "propose_changes", {"operations": [operation], "title": "Thêm việc ôn tập", "reason": "Yêu cầu trong chat"}, 11
    )
    servers = fake_codex(
        [
            tool_event("get_planning_context", {}),
            proposal_event,
            proposal_event,  # repeated call id is idempotent
            {"method": "item/agentMessage/delta", "params": {"itemId": "m1", "delta": "Đã tạo "}},
            {"method": "item/agentMessage/delta", "params": {"itemId": "m1", "delta": "bản nháp."}},
            {
                "method": "item/completed",
                "params": {"item": {"id": "m1", "type": "agentMessage", "text": "Đã tạo bản nháp."}},
            },
        ]
    )
    ident = client.post("/api/v1/chat/threads").json()["id"]
    sent = client.post(f"/api/v1/chat/threads/{ident}/messages", json={"text": "Thêm công việc ôn chương 2"})
    assert sent.status_code == 200
    result = wait_done(client, ident)
    message = result["messages"][-1]
    assert message["status"] == "completed"
    assert message["text"] == "Đã tạo bản nháp."
    assert len(message["proposals"]) == 1
    data = client.get("/api/v1/workspace").json()
    assert not data["tasks"] and data["revision"] == 0
    assert len(data["proposals"]) == 1
    assert "codex_thread_id" not in result
    # The existing review, apply and undo domain path remains authoritative.
    proposal = message["proposals"][0]["id"]
    applied = client.post(f"/api/v1/proposals/{proposal}/apply").json()
    assert client.get("/api/v1/workspace").json()["tasks"][0]["title"] == "Ôn chương 2"
    assert client.get(f"/api/v1/chat/threads/{ident}").json()["messages"][-1]["proposals"][0]["status"] == "applied"
    assert client.post("/api/v1/revisions/" + applied["revision_id"] + "/undo").status_code == 200
    fake_codex(
        [
            {
                "method": "item/completed",
                "params": {"item": {"id": "m2", "type": "agentMessage", "text": "Bạn có thể hỏi tiếp."}},
            }
        ]
    )
    assert client.post(f"/api/v1/chat/threads/{ident}/messages", json={"text": "Cảm ơn"}).status_code == 200
    result = wait_done(client, ident)
    assert len(result["messages"]) == 4
    resume = next(params for method, params in servers[-1].requests if method == "thread/resume")
    assert resume["threadId"] == "codex-test-thread"
    assert resume["sandbox"] == "read-only" and resume["approvalPolicy"] == "never"


def test_chat_concurrency_cancel_and_reopen(client, fake_codex):
    fake_codex(gate=threading.Event())
    ident = client.post("/api/v1/chat/threads").json()["id"]
    path = f"/api/v1/chat/threads/{ident}"
    assert client.post(path + "/messages", json={"text": "Tóm tắt công việc"}).status_code == 200
    assert client.post(path + "/messages", json={"text": "Gửi trùng"}).status_code == 409
    assert client.get(path).json()["messages"][0]["text"] == "Tóm tắt công việc"
    assert client.post(path + "/interrupt").status_code == 200
    result = wait_done(client, ident)
    assert result["messages"][-1]["status"] == "interrupted"
    assert client.get("/api/v1/workspace").json()["revision"] == 0


def test_chat_tool_failures_are_reported_and_never_bypass_domain(client, fake_codex):
    servers = fake_codex(
        [
            tool_event("propose_changes", {"operations": [], "title": "Sai", "reason": ""}),
            tool_event("get_planning_context", {}, 11),
            tool_event(
                "propose_changes",
                {
                    "operations": [{"kind": "sources", "action": "create", "data": {"title": "x", "path": "/tmp"}}],
                    "title": "Sai",
                    "reason": "",
                },
                12,
            ),
            tool_event("delete_everything", {}, 13),
            {"id": 14, "method": "item/commandExecution/requestApproval", "params": {}},
        ]
    )
    ident = client.post("/api/v1/chat/threads").json()["id"]
    client.post(f"/api/v1/chat/threads/{ident}/messages", json={"text": "Thử các thao tác không hợp lệ"})
    wait_done(client, ident)
    sent = {r["id"]: r for r in servers[-1].sent if "id" in r}
    assert not sent[10]["result"]["success"]
    assert sent[11]["result"]["success"]
    assert not sent[12]["result"]["success"]
    assert not sent[13]["result"]["success"]
    assert sent[14]["error"]["code"] == -32601
    assert not client.get("/api/v1/workspace").json()["proposals"]


def test_chat_rejects_stale_context_and_preserves_errors(client, fake_codex):
    ident = chat.new_thread()["id"]
    with transaction() as s:
        row = s.get(ChatThread, ident)
        row.data = {**row.data, "messages": [{"id": "answer", "role": "assistant", "text": "", "status": "running"}]}
    turn = chat.Turn(ident, "answer", "", None)
    turn.tool("get_planning_context", {})
    client.post("/api/v1/tasks", json={"title": "Thay đổi bên ngoài chat"})
    with pytest.raises(ValueError, match="vừa đổi"):
        turn.tool(
            "propose_changes",
            {"operations": [{"kind": "tasks", "action": "create", "data": {"title": "x"}}], "title": "x", "reason": ""},
        )
    fake_codex([{"method": "error", "params": {"willRetry": False, "error": {"message": "Hết quota thử nghiệm"}}}])
    client.post(f"/api/v1/chat/threads/{ident}/messages", json={"text": "Thử phản hồi lỗi"})
    message = wait_done(client, ident)["messages"][-1]
    assert message["status"] == "error" and "quota" in message["error"]


def test_chat_validates_input_and_reports_disabled_state(client, monkeypatch):
    ident = client.post("/api/v1/chat/threads").json()["id"]
    for payload in ({"text": "   "}, {"text": "x", "context": {"kind": "sources", "id": "x"}}, {"text": "x" * 12001}):
        assert client.post(f"/api/v1/chat/threads/{ident}/messages", json=payload).status_code == 422
    monkeypatch.setenv("PDM_AGENT_ENABLED", "0")
    assert client.get("/api/v1/chat/threads").json()["available"] is False
    assert client.post(f"/api/v1/chat/threads/{ident}/messages", json={"text": "Xin chào"}).status_code == 503
    assert client.get("/api/v1/chat/threads/missing").status_code == 404


def test_chat_restart_keeps_history_and_marks_interrupted():
    ident = chat.new_thread()["id"]
    with transaction() as s:
        row = s.get(ChatThread, ident)
        row.data = {
            **row.data,
            "status": "running",
            "messages": [{"id": "m", "role": "assistant", "text": "Đang soạn", "status": "running"}],
        }
    chat.recover()
    result = chat.get_thread(ident)
    assert result["status"] == "idle"
    assert result["messages"][0]["status"] == "interrupted"
    assert result["messages"][0]["text"] == "Đang soạn"


def test_chat_does_not_start_a_thread_with_inherited_external_tools(client, fake_codex, monkeypatch):
    servers = fake_codex()
    original = FakeServer.request

    def request(self, method, params, job, deadline):
        if method == "config/read":
            return {"config": {"mcp_servers": {"unexpected": {"enabled": True}}}}
        return original(self, method, params, job, deadline)

    monkeypatch.setattr(FakeServer, "request", request)
    ident = client.post("/api/v1/chat/threads").json()["id"]
    client.post(f"/api/v1/chat/threads/{ident}/messages", json={"text": "Đọc công việc"})
    result = wait_done(client, ident)
    assert result["messages"][-1]["status"] == "error"
    assert "MCP" in result["messages"][-1]["error"]
    assert all(method not in ("thread/start", "turn/start") for method, _ in servers[0].requests)


def test_ai_management_applies_only_selected_scope_and_can_undo(client, fake_codex):
    course = client.post("/api/v1/courses", json={"title": "Hệ điều hành"}).json()
    operations = [
        {
            "kind": "deadlines",
            "action": "create",
            "data": {
                "title": "Lab 3",
                "course_id": course["id"],
                "due_at": "2026-10-25",
                "description": "Theo tin nhắn giảng viên.",
            },
        }
    ]
    fake_codex(
        [
            tool_event("get_planning_context", {}),
            tool_event(
                "propose_changes",
                {"operations": operations, "title": "Thêm Lab 3", "reason": "Đúng hạn trong thông báo"},
                11,
            ),
        ]
    )
    ident = client.post("/api/v1/chat/threads").json()["id"]
    sent = client.post(
        f"/api/v1/chat/threads/{ident}/messages",
        json={"text": "Thêm deadline Lab 3", "auto_apply": True, "context": {"kind": "courses", "id": course["id"]}},
    )
    assert sent.status_code == 200
    result = wait_done(client, ident)
    proposal = result["messages"][-1]["proposals"][0]
    assert proposal["status"] == "applied" and proposal["revision_id"]
    assert client.get("/api/v1/workspace").json()["deadlines"][0]["course_id"] == course["id"]
    assert client.post("/api/v1/revisions/" + proposal["revision_id"] + "/undo").status_code == 200
    assert not client.get("/api/v1/workspace").json()["deadlines"]
    assert client.get(f"/api/v1/chat/threads/{ident}").json()["messages"][-1]["proposals"][0]["status"] == "undone"


def test_ai_management_keeps_deletion_reviewable(client, fake_codex):
    task = client.post("/api/v1/tasks", json={"title": "Việc cần giữ"}).json()
    fake_codex(
        [
            tool_event("get_planning_context", {}),
            tool_event(
                "propose_changes",
                {
                    "operations": [{"kind": "tasks", "action": "delete", "id": task["id"]}],
                    "title": "Xóa việc",
                    "reason": "Yêu cầu trong chat",
                },
                11,
            ),
        ]
    )
    ident = client.post("/api/v1/chat/threads").json()["id"]
    client.post(f"/api/v1/chat/threads/{ident}/messages", json={"text": "Xóa việc này", "auto_apply": True})
    proposal = wait_done(client, ident)["messages"][-1]["proposals"][0]
    assert proposal["status"] == "draft"
    assert len(client.get("/api/v1/workspace").json()["tasks"]) == 1


def test_course_context_includes_inherited_work_and_only_its_sources(client):
    course = client.post("/api/v1/courses", json={"title": "Hệ điều hành"}).json()
    other = client.post("/api/v1/courses", json={"title": "Trí tuệ nhân tạo"}).json()
    project = client.post("/api/v1/projects", json={"title": "Lab", "course_id": course["id"]}).json()
    deadline = client.post(
        "/api/v1/deadlines", json={"title": "Nộp Lab", "project_id": project["id"], "due_at": "2026-10-25"}
    ).json()
    task = client.post("/api/v1/tasks", json={"title": "Kiểm thử", "deadline_id": deadline["id"]}).json()
    client.post("/api/v1/tasks", json={"title": "Việc môn khác", "course_id": other["id"]})
    context = chat.course_context(course["id"])
    assert [t["id"] for t in context["tasks"]] == [task["id"]]
    assert [d["id"] for d in context["deadlines"]] == [deadline["id"]]
    assert context["item"]["id"] == course["id"]
