"""Backups HTTP endpoints."""

from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import FileResponse

from .. import backups, config, domain

router = APIRouter(tags=["backups"])


@router.post("/api/v1/backups")
def create_backup():
    return {"filename": backups.backup()}


@router.get("/api/v1/backups")
def list_backups():
    return [
        {"filename": p.name, "bytes": p.stat().st_size}
        for p in sorted((config.DATA / "backups").glob("workspace-*.zip"), reverse=True)
    ]


@router.get("/api/v1/backups/{name}")
def get_backup(name: str):
    path = config.DATA / "backups" / Path(name).name
    if not path.is_file() or not name.startswith("workspace-") or path.suffix != ".zip":
        domain.fail("Không tìm thấy sao lưu", 404)
    return FileResponse(path, filename=path.name)
