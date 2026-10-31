"""Canvas HTTP endpoints."""

from fastapi import APIRouter

from .. import arrangement, canvas

router = APIRouter(tags=["canvas"])


@router.get("/api/v1/canvas/{ident}")
def canvas_read(ident: str):
    return canvas.read(ident)


@router.patch("/api/v1/canvas/{ident}")
def canvas_update(ident: str, payload: canvas.LayoutPatch):
    return canvas.update(ident, payload)


@router.post("/api/v1/canvas/{ident}/arrange")
def canvas_arrange(ident: str, payload: arrangement.Request):
    return arrangement.propose(ident, payload)
