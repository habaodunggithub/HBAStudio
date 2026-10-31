"""Read registered local documents, never arbitrary client-supplied paths."""

from pathlib import Path
from zipfile import ZipFile, BadZipFile
from . import config, domain
from .db import Session
from .models import Document, KnowledgeSource

MIMES = {
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".txt": "text/plain",
    ".md": "text/plain",
    ".markdown": "text/plain",
}


def registered_file(ident):
    with Session() as s:
        doc = s.get(Document, ident)
        if not doc:
            domain.fail("Không tìm thấy tài liệu", 404)
        path = Path(doc.data.get("path", ""))
        source = s.get(KnowledgeSource, doc.data["source_id"]) if doc.data.get("source_id") else None
        root = Path(source.data["path"]) if source else config.DATA / "uploads"
        if path.is_symlink() or not path.resolve().is_relative_to(root.resolve()) or not path.is_file():
            domain.fail("File gốc không còn khả dụng", 404)
        if path.suffix.lower() not in MIMES or path.stat().st_size > 50 * 1024 * 1024:
            domain.fail("Loại hoặc kích thước tài liệu không được hỗ trợ", 415)
        return path, doc.data.get("title", path.name)


def check_archive(path):
    try:
        with ZipFile(path) as archive:
            if sum(i.file_size for i in archive.infolist()) > 200 * 1024 * 1024 or len(archive.infolist()) > 20000:
                domain.fail("Tài liệu quá lớn sau giải nén", 413)
    except BadZipFile:
        domain.fail("File Office không hợp lệ", 422)


def spreadsheet(ident, sheet=0, row=0, column=0):
    from openpyxl import load_workbook
    from openpyxl.utils import get_column_letter

    path, title = registered_file(ident)
    if path.suffix.lower() != ".xlsx":
        domain.fail("Tài liệu không phải XLSX", 422)
    check_archive(path)
    try:
        book = load_workbook(path, read_only=True, data_only=True, keep_links=False)
    except Exception:
        domain.fail("Không đọc được bảng tính; kiểm tra file hoặc mật khẩu", 422)
    try:
        if sheet >= len(book.worksheets):
            domain.fail("Sheet không tồn tại", 404)
        ws = book.worksheets[sheet]
        rows, cols = ws.max_row or 1, ws.max_column or 1
        if row >= rows or column >= cols:
            domain.fail("Vùng ô không tồn tại", 422)
        end_row, end_col = min(rows, row + 100), min(cols, column + 40)
        values = [
            [str(cell) if cell is not None else "" for cell in cells]
            for cells in ws.iter_rows(
                min_row=row + 1, max_row=end_row, min_col=column + 1, max_col=end_col, values_only=True
            )
        ]
        return {
            "title": title,
            "sheets": book.sheetnames,
            "sheet": sheet,
            "row": row,
            "column": column,
            "rows": rows,
            "columns": cols,
            "headers": [get_column_letter(i) for i in range(column + 1, end_col + 1)],
            "values": values,
        }
    finally:
        book.close()
