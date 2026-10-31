"""Loopback/session boundary shared by all HTTP routers."""

import os
import secrets
import tempfile
from functools import lru_cache
from pathlib import Path
from urllib.parse import urlparse

from fastapi import Request
from fastapi.responses import JSONResponse

from . import config

PUBLIC_PATHS = frozenset({"/api/v1/health", "/api/v1/bootstrap", "/api/v1/google/callback"})
SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "require-corp",
}


@lru_cache(maxsize=4)
def _token_at(path: Path) -> str:
    if not path.exists():
        # Publish a complete token atomically, also when two processes start
        # together. Never replace a token belonging to a running backend.
        with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, delete=False) as file:
            temporary = Path(file.name)
            file.write(secrets.token_urlsafe(32))
        try:
            try:
                os.link(temporary, path)
            except FileExistsError:
                pass
        finally:
            temporary.unlink(missing_ok=True)
    token = path.read_text(encoding="utf-8").strip()
    if not token:
        raise RuntimeError("The local session token is empty; stop the app before repairing it")
    return token


def session_token() -> str:
    return _token_at(config.DATA / "local-token")


async def local_only(request: Request, call_next):
    allowed = {"127.0.0.1", "localhost"}
    if os.environ.get("PDM_TESTING") == "1":
        allowed.add("testserver")
    if request.url.hostname not in allowed:
        response = JSONResponse({"detail": "Ứng dụng chỉ phục vụ tại máy"}, status_code=403)
    else:
        origin = request.headers.get("origin")
        try:
            parsed = urlparse(origin) if origin else None
            valid_origin = parsed is None or (
                parsed.scheme == "http" and parsed.hostname in allowed and parsed.port in (config.PORT, config.DEV_PORT)
            )
        except ValueError:
            valid_origin = False
        if not valid_origin:
            response = JSONResponse({"detail": "Origin không được phép"}, status_code=403)
        elif request.url.path.startswith("/api/") and request.url.path not in PUBLIC_PATHS:
            token = request.headers.get("x-pdm-token") or request.cookies.get("pdm_session", "")
            if secrets.compare_digest(token, session_token()):
                response = await call_next(request)
            else:
                response = JSONResponse({"detail": "Phiên local chưa khởi tạo"}, status_code=401)
        else:
            response = await call_next(request)
    response.headers.update(SECURITY_HEADERS)
    return response
