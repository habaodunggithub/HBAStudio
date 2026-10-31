"""Planning HTTP endpoints."""

from fastapi import APIRouter, Body

from .. import domain, planner
from ..db import transaction
from ..models import ChangeProposal, WorkspaceState
from ..worker import worker

router = APIRouter(tags=["planning"])


@router.post("/api/v1/changes")
def changes(payload: dict):
    with transaction() as s:
        return domain.commit_ops(s, payload.get("operations"), payload.get("revision"))


@router.post("/api/v1/proposals")
def proposals(payload: dict):
    with transaction() as s:
        return domain.propose(
            s, payload.get("operations"), payload.get("title", "Đề xuất từ Codex"), payload.get("reason", "")
        )


@router.post("/api/v1/proposals/{ident}/apply")
def apply(ident: str):
    with transaction() as s:
        result = domain.apply_proposal(s, ident)
    worker.wake.set()
    return result


@router.patch("/api/v1/proposals/{ident}")
def edit_proposal(ident: str, payload: dict):
    with transaction() as s:
        p = s.get(ChangeProposal, ident)
        if not p or p.data["status"] != "draft":
            domain.fail("Không tìm thấy bản nháp", 404)
        if p.data["base_revision"] != s.get(WorkspaceState, 1).revision:
            domain.fail("Dữ liệu đã đổi; hãy tạo phương án mới", 409)
        ops = domain.normalize_ops(payload.get("operations"))
        nested = s.begin_nested()
        try:
            domain.perform(s, ops, codex=p.data["origin"] == "codex")
        finally:
            nested.rollback()
        p.data = {**p.data, "operations": ops, "edited_at": domain.now()}
        return {"id": p.id, **p.data}


@router.post("/api/v1/proposals/{ident}/reject")
def reject(ident: str):
    with transaction() as s:
        p = s.get(ChangeProposal, ident)
        if not p or p.data["status"] != "draft":
            domain.fail("Không tìm thấy bản nháp", 404)
        p.data = {**p.data, "status": "rejected"}
    return {"ok": True}


@router.post("/api/v1/revisions/{ident}/undo")
def undo(ident: str):
    with transaction() as s:
        return domain.undo(s, ident)


@router.post("/api/v1/plans/preview")
def preview(payload: dict = Body(default={})):
    with transaction() as s:
        data = domain.workspace(s)
        days = payload.get("days", data["settings"]["horizon_days"])
        if not isinstance(days, int) or not 1 <= days <= 90:
            domain.fail("Phạm vi lập lịch từ 1 đến 90 ngày")
        result = planner.plan(data, payload.get("start"), days, payload.get("excluded_dates"))
        if result["operations"]:
            p = domain.propose(
                s,
                result["operations"],
                "Phương án sắp xếp lịch",
                "Xếp theo hạn, mức quan trọng và phụ thuộc",
                "planner",
            )
            obj = s.get(ChangeProposal, p["id"])
            obj.data = {**obj.data, "preview": {k: v for k, v in result.items() if k != "operations"}}
            return {"id": p["id"], **obj.data}
        return {"id": None, "title": "Chưa có thay đổi lịch", "preview": result}
