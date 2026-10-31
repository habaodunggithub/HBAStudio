"""Versioned DOCX editing for registered local files."""

from io import BytesIO
from zipfile import ZipFile
from fastapi import HTTPException
from . import document_reader, domain, knowledge
from .document_storage import SaveErrors, digest, save_document

MAX_BYTES = 50 * 1024 * 1024


def registered_docx(ident):
    path, title = document_reader.registered_file(ident)
    if path.suffix.lower() != ".docx":
        domain.fail("Tài liệu không phải DOCX", 422)
    return path, title


def validate(raw):
    if not raw or len(raw) > MAX_BYTES:
        domain.fail("File DOCX cần nhỏ hơn hoặc bằng 50 MB", 413)
    try:
        with ZipFile(BytesIO(raw)) as archive:
            entries = archive.infolist()
            if len(entries) > 20000 or sum(entry.file_size for entry in entries) > 200 * 1024 * 1024:
                domain.fail("Tài liệu quá lớn sau giải nén", 413)
            if any(entry.filename.lower().endswith("vbaproject.bin") for entry in entries):
                domain.fail("Không hỗ trợ lưu macro trong DOCX", 422)
        from docx import Document as WordDocument

        WordDocument(BytesIO(raw))
    except HTTPException:
        raise
    except Exception:
        domain.fail("File DOCX không hợp lệ", 422)


def read(ident):
    path, title = registered_docx(ident)
    try:
        with knowledge.document_lock(path):
            raw = path.read_bytes()
    except OSError:
        domain.fail("Chưa đọc được file DOCX; hãy thử lại", 503)
    validate(raw)
    return raw, digest(raw), title


def update(ident, raw, revision):
    validate(raw)
    return save_document(
        ident,
        raw,
        revision,
        resolve=lambda ident: registered_docx(ident)[0],
        errors=SaveErrors(
            conflict="File đã thay đổi ở nơi khác. Bản DOCX đang sửa của bạn vẫn được giữ.",
            indexing="Chưa cập nhật được tài liệu; file cũ được giữ lại. Hãy thử lưu lại.",
            write="Chưa lưu được DOCX; bản đang sửa vẫn được giữ. Hãy thử lại.",
        ),
    )
