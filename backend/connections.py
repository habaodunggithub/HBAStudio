"""Connection UI endpoints; protected by the existing localhost/session boundary."""

from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict

from . import codex_auth, google_sync
from .db import Session

router = APIRouter(prefix="/api/v1/connections", tags=["connections"])


class LoginInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    method: Literal["browser", "device"] = "browser"


@router.get("")
def read():
    with Session() as session:
        google = google_sync.status(session)
    return {"mode": "local", "codex": codex_auth.status(), "google": google}


@router.post("/codex/login")
def login(payload: LoginInput):
    return codex_auth.start(payload.method)


@router.delete("/codex/login")
def cancel():
    return codex_auth.cancel()


@router.post("/codex/system")
def use_system():
    return codex_auth.use_system()


@router.delete("/codex")
def disconnect():
    return codex_auth.disconnect()
