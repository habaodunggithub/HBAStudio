"""Edit registered Markdown files and refresh their source index."""

from pydantic import BaseModel, ConfigDict, Field
from . import document_reader, domain
from .document_storage import SaveErrors, digest, save_document

MAX_BYTES = 2 * 1024 * 1024


class ContentUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    content: str = Field(max_length=MAX_BYTES)
    revision: str = Field(pattern=r"^[a-f0-9]{64}$")


def registered_markdown(ident):
    path, _ = document_reader.registered_file(ident)
    if path.suffix.lower() not in {".md", ".markdown"}:
        domain.fail("Chỉ chỉnh sửa nội dung file Markdown", 422)
    if path.stat().st_size > MAX_BYTES:
        domain.fail("Trình chỉnh sửa hỗ trợ Markdown tối đa 2 MB", 413)
    return path


def read(ident):
    path = registered_markdown(ident)
    try:
        raw = path.read_bytes()
        content = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        domain.fail("File Markdown cần được lưu dưới dạng UTF-8", 422)
    except OSError:
        domain.fail("Chưa đọc được file Markdown; hãy thử lại", 503)
    return {"content": content, "revision": digest(raw)}


def update(ident, payload):
    raw = payload.content.encode("utf-8")
    if len(raw) > MAX_BYTES:
        domain.fail("Nội dung Markdown vượt giới hạn 2 MB", 413)
    return save_document(
        ident,
        raw,
        payload.revision,
        resolve=registered_markdown,
        errors=SaveErrors(
            conflict="File đã thay đổi ở nơi khác. Bản đang sửa của bạn vẫn được giữ.",
            indexing="Chưa cập nhật được nội dung tài liệu; file cũ được giữ lại. Hãy thử lưu lại.",
            write="Chưa lưu được file Markdown; bản đang sửa vẫn được giữ. Hãy thử lại.",
        ),
    )
