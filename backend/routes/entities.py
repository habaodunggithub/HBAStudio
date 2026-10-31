"""Entities HTTP endpoints."""

from fastapi import APIRouter

from .. import domain
from ..db import Session, transaction
from ..models import BUSINESS, ENTITIES

router = APIRouter(tags=["entities"])


@router.get("/api/v1/{kind}")
def listing(kind: str):
    if kind not in ENTITIES:
        domain.fail("Không tìm thấy", 404)
    with Session() as s:
        return domain.records(s, kind)


@router.post("/api/v1/{kind}")
def create(kind: str, payload: dict):
    if kind not in BUSINESS:
        domain.fail("Loại dữ liệu không hỗ trợ", 404)
    with transaction() as s:
        result = domain.commit_ops(s, [{"kind": kind, "action": "create", "data": payload}])
        ident = result["operations"][0]["id"]
        return {"id": ident, **s.get(ENTITIES[kind], ident).data, **{k: result[k] for k in ("revision", "revision_id")}}


@router.patch("/api/v1/{kind}/{ident}")
def update(kind: str, ident: str, payload: dict):
    if kind not in BUSINESS:
        domain.fail("Loại dữ liệu không hỗ trợ", 404)
    with transaction() as s:
        return domain.commit_ops(s, [{"kind": kind, "action": "update", "id": ident, "data": payload}])


@router.delete("/api/v1/{kind}/{ident}")
def remove(kind: str, ident: str):
    if kind not in BUSINESS:
        domain.fail("Loại dữ liệu không hỗ trợ", 404)
    with transaction() as s:
        return domain.commit_ops(s, [{"kind": kind, "action": "delete", "id": ident}])
