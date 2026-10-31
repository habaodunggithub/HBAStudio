"""Serve only the verified, optional local LibreOffice browser runtime.

The binary bundle is installed separately, never fetched while opening a document.
Integrity is cached by file identity and nanosecond modification/change timestamps;
unchanged bundles are not hashed again on each browser request.
"""

import hashlib
import json
import os
import stat
from functools import lru_cache
from pathlib import Path

from fastapi import HTTPException
from fastapi.responses import FileResponse

from . import config

MANIFEST_PATH = config.RESOURCES / "office-runtime.json"


@lru_cache(maxsize=1)
def manifest():
    return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))


def runtime_root():
    configured = os.environ.get("PDM_OFFICE_ASSETS")
    return (
        Path(configured).expanduser() if configured else config.CACHE / "office-runtime" / manifest()["id"]
    ).resolve()


@lru_cache(maxsize=128)
def _verified(path, fingerprint, expected_size, expected_digest):
    # fingerprint is intentionally part of the cache key even though only the
    # digest requires I/O: replacing or modifying an asset invalidates the result.
    try:
        with open(path, "rb") as file:
            digest = hashlib.file_digest(file, "sha256").hexdigest()
            current = os.fstat(file.fileno())
        return digest == expected_digest and _fingerprint(current) == fingerprint and current.st_size == expected_size
    except OSError:
        return False


def _fingerprint(info):
    return info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns


def _asset_valid(root, asset):
    path = root / asset["file"]
    try:
        info = path.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_size != asset["bytes"]:
            return False
        return _verified(str(path), _fingerprint(info), asset["bytes"], asset["sha256"])
    except OSError:
        return False


def runtime_status():
    bundle = manifest()
    root = runtime_root()
    missing = [asset["name"] for asset in bundle["assets"] if not _asset_valid(root, asset)]
    return {
        "available": not missing,
        "engine": bundle["engine"],
        "version": bundle["version"],
        "runtime_id": bundle["id"],
        "missing": missing,
        "message": "Sẵn sàng chỉnh sửa bằng LibreOffice Writer"
        if not missing
        else "Chưa cài đủ bộ LibreOffice Writer hoặc bộ cài cần được kiểm tra lại. Chạy scripts/setup-office-runtime.py để cài.",
    }


def runtime_asset(name: str):
    bundle = manifest()
    asset = next((item for item in bundle["assets"] if item["name"] == name), None)
    if asset is None:
        raise HTTPException(404, "Không tìm thấy tài nguyên LibreOffice")
    root = runtime_root()
    if not _asset_valid(root, asset):
        raise HTTPException(503, "Bộ LibreOffice Writer chưa sẵn sàng; hãy cài lại bộ runtime")
    headers = {
        "ETag": '"' + asset["sha256"] + '"',
        # The frontend includes runtime_id in asset URLs. A new bundle must use
        # a new id; the source bundle is pinned to exact SHA-256 values.
        "Cache-Control": "private, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
        "Cross-Origin-Resource-Policy": "same-origin",
    }
    if asset.get("encoding"):
        headers["Content-Encoding"] = asset["encoding"]
    return FileResponse(root / asset["file"], media_type=asset["media_type"], headers=headers)
