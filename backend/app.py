"""Application composition. HTTP handlers live in backend.routes."""

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import ValidationError

from . import __version__, chat, codex_auth, config, knowledge
from .connections import router as connections_router
from .db import initialize
from .routes import backups, calendar, canvas, documents, entities, google, planning, system, workspace
from .routes import chat as chat_routes
from .security import local_only, session_token
from .worker import worker


@asynccontextmanager
async def lifespan(app):
    initialize()
    session_token()
    chat.recover()
    if os.environ.get("PDM_NO_WORKER") != "1":
        worker.start()
    try:
        yield
    finally:
        chat.shutdown()
        codex_auth.shutdown()
        worker.close()
        knowledge.shutdown()


def create_app() -> FastAPI:
    app = FastAPI(title="HBA Studio", version=__version__, lifespan=lifespan)
    app.middleware("http")(local_only)

    @app.exception_handler(ValidationError)
    async def validation_error(request, exc):
        return JSONResponse({"detail": "; ".join(e["msg"] for e in exc.errors())}, status_code=422)

    # Concrete paths must precede the generic /{kind} compatibility endpoints.
    for router in (
        system.router,
        connections_router,
        workspace.router,
        canvas.router,
        chat_routes.router,
        planning.router,
        calendar.router,
        documents.router,
        google.router,
        backups.router,
        entities.router,
    ):
        app.include_router(router)
    if config.WEB_DIST.is_dir():
        app.mount("/", StaticFiles(directory=config.WEB_DIST, html=True), name="web")
    return app


app = create_app()
