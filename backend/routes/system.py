"""System HTTP endpoints."""

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from .. import __version__, office_runtime
from ..security import session_token

router = APIRouter(tags=["system"])


@router.get("/api/v1/health")
def health():
    return {"ok": True, "version": __version__}


@router.get("/api/v1/office/runtime")
def office_status():
    return office_runtime.runtime_status()


@router.get("/office-runtime/{name}")
def office_asset(name: str):
    return office_runtime.runtime_asset(name)


@router.get("/api/v1/bootstrap")
def bootstrap():
    response = JSONResponse({"ok": True})
    response.set_cookie("pdm_session", session_token(), httponly=True, samesite="strict", max_age=86400 * 30)
    return response
