import copy
import uuid
from datetime import datetime, timezone
from pathlib import Path
from sqlalchemy import select, delete
from fastapi import HTTPException
from .models import ENTITIES, BUSINESS, TaskDependency, WorkspaceState, ChangeProposal, PlanRevision, OutboxJob
from .schemas import SCHEMAS


def now():
    return datetime.now(timezone.utc).isoformat()


def uid():
    return uuid.uuid4().hex


def fail(message, status=422):
    raise HTTPException(status, message)


def records(s, kind):
    return [{"id": o.id, **o.data} for o in s.scalars(select(ENTITIES[kind])).all()]


def workspace(s):
    state = s.get(WorkspaceState, 1)
    return {
        "revision": state.revision,
        "settings": copy.deepcopy(state.settings),
        **{kind: records(s, kind) for kind in ENTITIES},
    }


def snapshot(s):
    return {kind: records(s, kind) for kind in BUSINESS}


def dependencies(s):
    s.execute(delete(TaskDependency))
    for t in records(s, "tasks"):
        for dep in set(t.get("depends_on", [])):
            s.add(TaskDependency(task_id=t["id"], depends_on_id=dep))


def validate(s, check_calendar=True):
    data = {k: {o["id"]: o for o in records(s, k)} for k in ENTITIES}
    refs = {
        "course_id": "courses",
        "project_id": "projects",
        "deadline_id": "deadlines",
        "task_id": "tasks",
        "parent_id": "tasks",
    }
    for kind in BUSINESS:
        for item in data[kind].values():
            for field, target in refs.items():
                if item.get(field) and item[field] not in data[target]:
                    fail(f"{item.get('title', item['id'])}: liên kết {field} không tồn tại")
    tasks = data["tasks"]
    graph = {tid: list(t.get("depends_on", [])) for tid, t in tasks.items()}
    for tid, t in tasks.items():
        if t.get("parent_id"):
            # A parent aggregates its children; dependency on a parent expands in the planner.
            graph.setdefault(t["parent_id"], []).append(tid)
        for dep in t.get("depends_on", []):
            if dep not in tasks:
                fail("Công việc phụ thuộc không tồn tại")
    visiting, visited = set(), set()

    def visit(tid):
        if tid in visiting:
            fail("Quan hệ công việc tạo thành vòng lặp")
        if tid in visited:
            return
        visiting.add(tid)
        for dep in graph[tid]:
            visit(dep)
        visiting.remove(tid)
        visited.add(tid)

    for tid in graph:
        visit(tid)
    for block in data["blocks"].values():
        if any(t.get("parent_id") == block["task_id"] for t in tasks.values()):
            fail("Chỉ xếp lịch công việc lá; việc cha tổng hợp tiến độ")
    if not check_calendar:
        return
    from .planner import dt, event_occurrences, overlaps

    blocks = [b for b in data["blocks"].values() if b["status"] == "planned"]
    for i, b in enumerate(blocks):
        a, z = dt(b["start"]), dt(b["end"])
        for other in blocks[i + 1 :]:
            if overlaps(a, z, dt(other["start"]), dt(other["end"])):
                fail("Các buổi làm bị trùng giờ", 409)
        for event in data["events"].values():
            if event.get("busy", True) and event_occurrences(event, a, z):
                fail(f"Buổi làm trùng lịch cố định: {event['title']}", 409)


def normalize_ops(ops):
    if not isinstance(ops, list) or not 1 <= len(ops) <= 500:
        fail("Một đề xuất cần 1–500 thao tác")
    result = copy.deepcopy(ops)
    for op in result:
        if set(op) - {"kind", "action", "id", "data"}:
            fail("Thao tác chứa trường không hỗ trợ")
        if op.get("kind") not in BUSINESS or op.get("action") not in ("create", "update", "delete"):
            fail("Thao tác không hỗ trợ")
        if op["action"] == "create":
            op.setdefault("id", uid())
        if not isinstance(op.get("id"), str) or not 1 <= len(op["id"]) <= 128:
            fail("ID không hợp lệ")
    return result


def perform(s, ops, codex=False):
    for op in ops:
        kind, ident, action = op["kind"], op["id"], op["action"]
        model = ENTITIES[kind]
        obj = s.get(model, ident)
        if action == "create" and obj:
            fail("ID đã tồn tại", 409)
        if action != "create" and obj is None:
            fail("Không tìm thấy dữ liệu", 404)
        if obj and obj.data.get("readonly"):
            fail("Sự kiện Google bên ngoài chỉ được đọc", 409)
        if action == "delete":
            s.delete(obj)
            s.flush()
            continue
        old = obj.data if obj else {}
        content = {**old, **op.get("data", {})}
        if kind == "tasks":
            content["depends_on"] = list(dict.fromkeys(content.get("depends_on", [])))
            content.setdefault("created_at", now())
            if codex and "estimate_minutes" in op.get("data", {}):
                content["estimate_source"] = "codex"
            if content.get("status") == "done" and old.get("status") != "done":
                content["completed_at"] = now()
            elif content.get("status") != "done":
                content["completed_at"] = None
        if kind == "sessions":
            content.setdefault("recorded_at", now())
        content = SCHEMAS[kind].model_validate(content).model_dump()
        if obj:
            obj.data = content
        else:
            s.add(model(id=ident, data=content))
        s.flush()
    validate(s, check_calendar=any(o["kind"] in ("blocks", "events") for o in ops))
    dependencies(s)
    s.flush()


def queue_sync(s):
    # Coalesce pending requests. Event identity is stable, so retrying is idempotent.
    job = s.get(OutboxJob, "google-sync")
    if job is None:
        s.add(
            OutboxJob(
                id="google-sync",
                data={"status": "pending", "attempts": 0, "updated_at": now(), "queued_at": now(), "generation": 1},
            )
        )
    else:
        job.data = {
            **job.data,
            "status": "pending",
            "updated_at": now(),
            "generation": job.data.get("generation", 0) + 1,
            "queued_at": job.data.get("queued_at", job.data.get("updated_at", now()))
            if job.data.get("status") == "pending"
            else now(),
        }


def commit_ops(s, ops, expected=None, proposal_id=None, codex=False):
    state = s.get(WorkspaceState, 1)
    if expected is not None and expected != state.revision:
        fail("Dữ liệu đã đổi. Hãy tạo bản xem trước mới.", 409)
    ops = normalize_ops(ops)
    before = snapshot(s)
    perform(s, ops, codex)
    state.revision += 1
    revision_id = uid()
    s.add(
        PlanRevision(
            id=revision_id,
            data={
                "before": before,
                "after": snapshot(s),
                "revision": state.revision,
                "proposal_id": proposal_id,
                "created_at": now(),
                "undone": False,
            },
        )
    )
    queue_sync(s)
    return {"revision": state.revision, "revision_id": revision_id, "operations": ops}


def propose(s, ops, title="Đề xuất từ Codex", reason="", origin="codex"):
    ops = normalize_ops(ops)
    nested = s.begin_nested()
    try:
        perform(s, ops, codex=origin == "codex")
    finally:
        nested.rollback()
    state = s.get(WorkspaceState, 1)
    proposal = ChangeProposal(
        id=uid(),
        data={
            "title": title[:500],
            "reason": reason[:20000],
            "operations": ops,
            "base_revision": state.revision,
            "status": "draft",
            "origin": origin,
            "created_at": now(),
        },
    )
    s.add(proposal)
    return {"id": proposal.id, **proposal.data}


def apply_proposal(s, ident):
    p = s.get(ChangeProposal, ident)
    if not p:
        fail("Không tìm thấy đề xuất", 404)
    if p.data["status"] != "draft":
        fail("Đề xuất không còn ở trạng thái nháp", 409)
    result = commit_ops(s, p.data["operations"], p.data["base_revision"], p.id, p.data["origin"] == "codex")
    p.data = {**p.data, "status": "applied", "applied_at": now(), "revision_id": result["revision_id"]}
    return result


def undo(s, ident):
    r = s.get(PlanRevision, ident)
    state = s.get(WorkspaceState, 1)
    if not r or r.data["undone"] or r.data["revision"] != state.revision:
        fail("Không thể hoàn tác vì dữ liệu đã thay đổi tiếp", 409)
    for kind in BUSINESS:
        s.execute(delete(ENTITIES[kind]))
        for item in r.data["before"][kind]:
            s.add(ENTITIES[kind](id=item["id"], data={k: v for k, v in item.items() if k != "id"}))
    s.flush()
    dependencies(s)
    state.revision += 1
    r.data = {**r.data, "undone": True}
    queue_sync(s)
    return {"revision": state.revision}


def save_source(s, payload, ident=None):
    content = SCHEMAS["sources"].model_validate(payload).model_dump()
    path = Path(content["path"]).expanduser().resolve()
    if not path.is_dir():
        fail("Thư mục không tồn tại hoặc không truy cập được")
    if path == Path(path.anchor) or path == Path.home():
        fail("Hãy chọn một thư mục tài liệu cụ thể")
    content["path"] = str(path)
    obj = s.get(ENTITIES["sources"], ident) if ident else None
    if obj:
        obj.data = content
    else:
        obj = ENTITIES["sources"](id=uid(), data=content)
        s.add(obj)
    return {"id": obj.id, **content}
