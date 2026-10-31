"""Documents HTTP endpoints."""

from pathlib import Path

from fastapi import APIRouter, File, Form, Query, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response
from sqlalchemy import select

from .. import config, document_reader, docx_document, domain, knowledge, markdown_document, workspaces
from ..db import Session, transaction
from ..models import ENTITIES, Course, Document, DocumentChunk, KnowledgeSource, OutboxJob, Project
from ..worker import worker

router = APIRouter(tags=["documents"])


@router.get("/api/v1/knowledge/search")
def search(q: str, course_id: str | None = None, project_id: str | None = None, limit: int = 8):
    return knowledge.search(q, course_id, project_id, limit)


@router.get("/api/v1/knowledge/excerpts/{ident}")
def excerpt(ident: str):
    with Session() as s:
        c = s.get(DocumentChunk, ident)
        if not c:
            domain.fail("Đoạn nguồn không còn tồn tại; hãy tìm kiếm lại", 404)
        d = s.get(Document, c.document_id)
        return {"chunk_id": c.id, "document_id": d.id, "text": c.text, "location": c.location, **d.data}


@router.get("/api/v1/knowledge/documents/{ident}/file")
def document_file(ident: str):
    path, title = document_reader.registered_file(ident)
    if path.suffix.lower() in {".docx", ".xlsx"}:
        document_reader.check_archive(path)
    return FileResponse(
        path,
        media_type=document_reader.MIMES[path.suffix.lower()],
        filename=title,
        content_disposition_type="inline",
        headers={"Cache-Control": "private, no-store"},
    )


@router.get("/api/v1/knowledge/documents/{ident}/spreadsheet")
def document_sheet(
    ident: str,
    sheet: int = Query(default=0, ge=0),
    row: int = Query(default=0, ge=0),
    column: int = Query(default=0, ge=0),
):
    return document_reader.spreadsheet(ident, sheet, row, column)


@router.get("/api/v1/knowledge/documents/{ident}/content")
def markdown_content(ident: str):
    return JSONResponse(markdown_document.read(ident), headers={"Cache-Control": "private, no-store"})


@router.put("/api/v1/knowledge/documents/{ident}/content")
def markdown_update(ident: str, payload: markdown_document.ContentUpdate):
    result = markdown_document.update(ident, payload)
    worker.wake.set()
    return result


@router.get("/api/v1/knowledge/documents/{ident}/docx")
def editable_docx(ident: str):
    raw, revision, _ = docx_document.read(ident)
    return Response(
        raw,
        media_type=document_reader.MIMES[".docx"],
        headers={"X-Document-Revision": revision, "Cache-Control": "private, no-store"},
    )


@router.put("/api/v1/knowledge/documents/{ident}/docx")
def save_docx(ident: str, file: UploadFile = File(...), revision: str = Form(..., pattern=r"^[a-f0-9]{64}$")):
    raw = file.file.read(docx_document.MAX_BYTES + 1)
    result = docx_document.update(ident, raw, revision)
    worker.wake.set()
    return result


@router.post("/api/v1/knowledge/upload")
def upload(
    file: UploadFile = File(...),
    course_id: str = Form(default=""),
    project_id: str = Form(default=""),
    work_kind: str = Form(default=""),
    work_id: str = Form(default=""),
):
    if work_kind or work_id:
        if work_kind not in workspaces.KINDS or not work_id:
            domain.fail("Liên kết workspace không hợp lệ")
        with Session() as s:
            if not s.get(ENTITIES[work_kind], work_id):
                domain.fail("Workspace không còn tồn tại", 404)
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in knowledge.SUFFIXES:
        domain.fail("Chỉ hỗ trợ PDF, DOCX, XLSX, Markdown, TXT và ảnh PNG, JPG, WebP")
    ident = domain.uid()
    safe_name = Path(file.filename or "document").name.replace("\\", "_")
    target = config.DATA / "uploads" / (ident + "-" + safe_name)
    count = 0
    try:
        with target.open("wb") as f:
            while piece := file.file.read(1024 * 1024):
                count += len(piece)
                if count > knowledge.MAX_BYTES:
                    domain.fail("File vượt giới hạn 50 MB", 413)
                f.write(piece)
        with transaction() as s:
            if course_id and not s.get(Course, course_id) or project_id and not s.get(Project, project_id):
                domain.fail("Môn học hoặc đồ án không tồn tại")
            s.add(
                Document(
                    id=ident,
                    data={
                        "title": safe_name,
                        "path": str(target),
                        "status": "pending",
                        "course_id": course_id or None,
                        "project_id": project_id or None,
                        "work_kind": work_kind or None,
                        "work_id": work_id or None,
                    },
                )
            )
            s.add(
                OutboxJob(
                    id=domain.uid(),
                    data={
                        "kind": "ingest",
                        "status": "pending",
                        "path": str(target),
                        "document_id": ident,
                        "course_id": course_id or None,
                        "project_id": project_id or None,
                    },
                )
            )
    except BaseException:
        target.unlink(missing_ok=True)
        raise
    worker.wake.set()
    return {"id": ident, "status": "pending"}


@router.patch("/api/v1/knowledge/documents/{ident}")
def tag_document(ident: str, payload: dict):
    with transaction() as s:
        obj = s.get(Document, ident)
        if not obj:
            domain.fail("Không tìm thấy tài liệu", 404)
        for field, model in (("course_id", Course), ("project_id", Project)):
            if payload.get(field) and not s.get(model, payload[field]):
                domain.fail("Liên kết không tồn tại")
        obj.data = {**obj.data, **{k: v for k, v in payload.items() if k in ("course_id", "project_id")}}
    return {"ok": True}


@router.delete("/api/v1/knowledge/documents/{ident}")
def delete_document(ident: str):
    with transaction() as s:
        doc = s.get(Document, ident)
        if not doc:
            domain.fail("Không tìm thấy tài liệu", 404)
        if doc.data.get("source_id"):
            domain.fail("Tài liệu thuộc thư mục theo dõi; hãy tắt hoặc gỡ nguồn để ngừng lập chỉ mục")
        path = Path(doc.data["path"])
        knowledge.remove_document(s, doc)
        if path.parent == config.DATA / "uploads":
            path.unlink(missing_ok=True)
    return {"ok": True}


@router.post("/api/v1/knowledge/sources")
def add_source(payload: dict):
    with transaction() as s:
        result = domain.save_source(s, payload)
    worker.last_periodic = 0
    worker.wake.set()
    return result


@router.delete("/api/v1/knowledge/sources/{ident}")
def remove_source(ident: str):
    with transaction() as s:
        source = s.get(KnowledgeSource, ident)
        if not source:
            domain.fail("Không tìm thấy nguồn", 404)
        for doc in list(s.scalars(select(Document))):
            if doc.data.get("source_id") == ident:
                knowledge.remove_document(s, doc)
        s.delete(source)
    return {"ok": True}


@router.post("/api/v1/knowledge/scan")
def scan():
    worker.last_periodic = 0
    worker.wake.set()
    return {"status": "pending"}


@router.post("/api/v1/knowledge/model")
def download_model():
    if not knowledge.semantic_available():
        domain.fail("Cài phần tìm kiếm ngữ nghĩa trước: uv sync --extra semantic", 409)
    with transaction() as s:
        job = s.get(OutboxJob, "embedding-model")
        if not job:
            s.add(OutboxJob(id="embedding-model", data={"kind": "model", "status": "pending"}))
        elif job.data.get("status") != "pending":
            job.data = {"kind": "model", "status": "pending"}
    worker.wake.set()
    return {"status": "pending"}
