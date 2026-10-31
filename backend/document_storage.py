"""Shared optimistic file saves, serialized with indexing and document deletion.

Format adapters validate their content and registered path. This module owns
revision checks, atomic replacement and rollback if source indexing fails.
"""

import hashlib
import os
import stat
import tempfile
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from . import domain, knowledge
from .db import Session, write_lock
from .models import Document


def digest(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def atomic_write(path: Path, raw: bytes) -> None:
    temporary = None
    try:
        mode = stat.S_IMODE(path.stat().st_mode)
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".document-", suffix=".tmp", delete=False) as file:
            temporary = Path(file.name)
            file.write(raw)
            file.flush()
            os.fsync(file.fileno())
        temporary.chmod(mode)
        os.replace(temporary, path)
    finally:
        if temporary:
            temporary.unlink(missing_ok=True)


@dataclass(frozen=True)
class SaveErrors:
    conflict: str
    indexing: str
    write: str


def save_document(
    ident: str, raw: bytes, revision: str, *, resolve: Callable[[str], Path], errors: SaveErrors
) -> dict[str, str]:
    path = resolve(ident)
    # Always acquire the per-file lock first, matching knowledge.ingest.
    with knowledge.document_lock(path), write_lock:
        path = resolve(ident)
        with Session() as session:
            metadata = session.get(Document, ident).data.copy()
        try:
            original = path.read_bytes()
            if digest(original) != revision:
                domain.fail(errors.conflict, 409)
            if raw == original:
                return {"revision": revision}
            atomic_write(path, raw)
            try:
                knowledge.ingest(
                    path,
                    source_id=metadata.get("source_id"),
                    course_id=metadata.get("course_id"),
                    project_id=metadata.get("project_id"),
                    doc_id=ident,
                )
            except Exception:
                atomic_write(path, original)
                domain.fail(errors.indexing, 503)
        except OSError:
            domain.fail(errors.write, 503)
    return {"revision": digest(raw)}
