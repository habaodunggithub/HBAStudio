from pathlib import Path
from sqlalchemy import select
from backend import knowledge, backups, config
from backend.db import Session, transaction
from backend.models import KnowledgeSource, Document, DocumentChunk
from .conftest import create


def test_vietnamese_accent_and_live_notes(client, tmp_path):
    file = tmp_path / "De-bai.md"
    file.write_text("# Đồ án\nHạn nộp báo cáo và phân tích hệ điều hành.", encoding="utf-8")
    knowledge.ingest(file)
    r = knowledge.search("he dieu hanh")
    assert r["hits"] and r["hits"][0]["title"] == "De-bai.md"
    assert r["hits"][0]["version"]
    create(client, "notes", title="Lịch ôn tập", description="Ôn tập hệ điều hành vào thứ Sáu")
    assert knowledge.search("on tap")["notes"]


def test_changed_file_replaces_chunks(tmp_path):
    file = tmp_path / "test.txt"
    file.write_text("alpha nội dung cũ")
    ident = knowledge.ingest(file)
    before = knowledge.search("alpha")["hits"][0]["chunk_id"]
    file.write_text("beta nội dung mới")
    assert knowledge.ingest(file) == ident
    assert not knowledge.search("alpha")["hits"]
    assert knowledge.search("beta")["hits"][0]["chunk_id"] != before


def test_scan_deleted_symlink_and_missing_root(tmp_path):
    root = tmp_path / "docs"
    root.mkdir()
    (root / "a.txt").write_text("tài liệu nghiên cứu")
    other = tmp_path / "secret.txt"
    other.write_text("private content")
    (root / "link.txt").symlink_to(other)
    with transaction() as s:
        s.add(KnowledgeSource(id="src", data={"title": "Nguồn", "path": str(root), "enabled": True}))
    knowledge.scan_sources()
    with Session() as s:
        assert len(list(s.scalars(select(Document)))) == 1
    root.rename(tmp_path / "offline")
    knowledge.scan_sources()
    with Session() as s:
        assert s.get(KnowledgeSource, "src").data["status"] == "unavailable"
        assert len(list(s.scalars(select(Document)))) == 1
    (tmp_path / "offline").rename(root)
    (root / "a.txt").unlink()
    knowledge.scan_sources()
    with Session() as s:
        assert len(list(s.scalars(select(Document)))) == 0


def test_docx_and_scanned_pdf(tmp_path):
    from docx import Document as Docx

    doc = Docx()
    doc.add_paragraph("Yêu cầu báo cáo thiết kế thuật toán")
    path = tmp_path / "spec.docx"
    doc.save(path)
    knowledge.ingest(path)
    assert knowledge.search("thuat toan")["hits"]
    from pypdf import PdfWriter

    pdf = PdfWriter()
    pdf.add_blank_page(width=100, height=100)
    blank = tmp_path / "scan.pdf"
    pdf.write(blank)
    ident = knowledge.ingest(blank)
    with Session() as s:
        assert "OCR" in s.get(Document, ident).data["error"]


def test_backup_restore_with_uploads_and_secrets_excluded(client, tmp_path):
    create(client, "tasks", title="Phải giữ lại")
    file = config.DATA / "uploads" / "study.txt"
    file.write_text("Bản sao tài liệu học tập")
    knowledge.ingest(file)
    archive = backups.backup()
    import zipfile

    with zipfile.ZipFile(config.DATA / "backups" / archive) as z:
        assert "local-token" not in z.namelist()
        assert "uploads/study.txt" in z.namelist()
    target = tmp_path / "restored"
    backups.restore(config.DATA / "backups" / archive, target)
    import sqlite3, json

    with sqlite3.connect(target / "workspace.db") as c:
        assert json.loads(c.execute("select data from tasks").fetchone()[0])["title"] == "Phải giữ lại"
        assert json.loads(c.execute("select data from documents").fetchone()[0])["path"] == str(
            target / "uploads" / "study.txt"
        )
    assert (target / "uploads" / "study.txt").exists()


def test_restore_rejects_traversal(tmp_path):
    import zipfile, pytest

    path = tmp_path / "evil.zip"
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("../escape", "x")
    with pytest.raises(ValueError):
        backups.restore(path, tmp_path / "out")


def test_course_search_inherits_work_and_project_links_without_leaking_other_courses(client, tmp_path):
    from .conftest import create
    from backend import knowledge
    from backend.db import transaction
    from backend.models import Document

    course = create(client, "courses", title="Môn nguồn theo ngữ cảnh")
    other = create(client, "courses", title="Môn khác")
    project = create(client, "projects", title="Đồ án nguồn", course_id=course["id"])
    deadline = create(client, "deadlines", title="Nộp đồ án", project_id=project["id"], due_at="2026-11-01")
    parent = create(client, "tasks", title="Việc cha", deadline_id=deadline["id"])
    task = create(client, "tasks", title="Việc con", parent_id=parent["id"])
    path = tmp_path / "nguon-lien-ket.md"
    path.write_text("Thực nghiệm cần có bảng kết quả kiểm chứng.", encoding="utf-8")
    ident = knowledge.ingest(path)
    with transaction() as s:
        row = s.get(Document, ident)
        row.data = {**row.data, "work_kind": "tasks", "work_id": task["id"]}
    create(client, "notes", title="Kết quả thực nghiệm", description="Nội dung ghi chú", project_id=project["id"])
    result = knowledge.search("thực nghiệm", course_id=course["id"], project_id=project["id"])
    assert [hit["document_id"] for hit in result["hits"]] == [ident]
    assert len(result["notes"]) == 1
    result = knowledge.search("thực nghiệm", course_id=other["id"])
    assert result["hits"] == [] and result["notes"] == []
