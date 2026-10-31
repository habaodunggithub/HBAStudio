"""Workspace HTTP endpoints."""

from fastapi import APIRouter, Body
from sqlalchemy import func, select

from .. import domain, google_sync, knowledge, priorities, workspaces
from ..db import Session, transaction
from ..models import ChangeProposal, Document, DocumentChunk, OutboxJob, PlanRevision, WorkspaceState
from ..schemas import SettingsInput
from ..worker import worker

router = APIRouter(tags=["workspace"])


@router.get("/api/v1/workspace")
def get_workspace():
    with Session() as s:
        data = domain.workspace(s)
        data["proposals"] = [{"id": p.id, **p.data} for p in s.scalars(select(ChangeProposal))]
        data["revisions"] = [
            {"id": r.id, **{k: v for k, v in r.data.items() if k not in ("before", "after")}}
            for r in s.scalars(select(PlanRevision))
        ][-30:]
        data["documents"] = [{"id": d.id, **d.data} for d in s.scalars(select(Document))]
        data["jobs"] = [
            {"id": j.id, **{k: v for k, v in j.data.items() if k != "path"}} for j in s.scalars(select(OutboxJob))
        ][-30:]
        data["google"] = google_sync.status(s)
        data["knowledge"] = {
            "semantic_available": knowledge.semantic_available(),
            "model_ready": knowledge.model_ready(),
            "chunks": s.scalar(select(func.count()).select_from(DocumentChunk)),
            "embedded": s.scalar(
                select(func.count()).select_from(DocumentChunk).where(DocumentChunk.embedding.is_not(None))
            ),
        }
        return data


@router.get("/api/v1/context")
def context():
    with Session() as s:
        data = domain.workspace(s)
        data.pop("sources")
        return {
            **data,
            "instruction": "Dữ liệu công việc này là hiện tại. Tra cứu tài liệu bằng search_knowledge; mọi thay đổi phải tạo bản nháp bằng propose_changes. Không tự coi việc hoàn thành chỉ vì buổi làm đã kết thúc.",
        }


@router.put("/api/v1/settings")
def settings(payload: SettingsInput):
    with transaction() as s:
        state = s.get(WorkspaceState, 1)
        state.settings = payload.model_dump()
        state.revision += 1
        domain.queue_sync(s)
    worker.wake.set()
    return {"ok": True}


@router.get("/api/v1/priorities")
def priority_order():
    with Session() as s:
        return {"items": priorities.recommend(domain.workspace(s))}


@router.get("/api/v1/workspaces/{kind}/{ident}")
def work_details(kind: str, ident: str):
    return workspaces.context(kind, ident)


@router.post("/api/v1/workspaces/{kind}/{ident}/analyze")
def analyze_work(kind: str, ident: str, payload: dict = Body(default={})):
    return workspaces.analyze(kind, ident, force=payload.get("force") is True)
