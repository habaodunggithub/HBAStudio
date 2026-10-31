from io import BytesIO
from pathlib import Path
from zipfile import ZipFile
import pytest
from docx import Document as WordDocument
from backend import knowledge
from backend.db import Session
from backend.models import Document
from .conftest import create


def word_bytes(text="Original Word text"):
    doc = WordDocument()
    p = doc.add_paragraph()
    p.add_run(text).bold = True
    p.add_run(" italic text").italic = True
    doc.add_table(rows=1, cols=2).cell(0, 0).text = "Keep table"
    doc.sections[0].header.paragraphs[0].text = "Keep header"
    buffer = BytesIO()
    doc.save(buffer)
    return buffer.getvalue()


def upload(client):
    work = create(client, "tasks", title="Edit Word")
    result = client.post(
        "/api/v1/knowledge/upload",
        data={"work_kind": "tasks", "work_id": work["id"]},
        files={"file": ("reading.docx", word_bytes())},
    ).json()
    with Session() as session:
        path = Path(session.get(Document, result["id"]).data["path"])
    knowledge.ingest(path, doc_id=result["id"])
    return "/api/v1/knowledge/documents/" + result["id"], path, work


def save(client, url, raw, revision):
    return client.put(url + "/docx", data={"revision": revision}, files={"file": ("reading.docx", raw)})


def test_docx_binary_save_preserves_format_tables_headers_and_refreshes_sources(client):
    url, path, work = upload(client)
    response = client.get(url + "/docx")
    assert response.status_code == 200
    revision = response.headers["x-document-revision"]
    business = client.get("/api/v1/workspace").json()["revision"]
    doc = WordDocument(BytesIO(response.content))
    doc.paragraphs[0].runs[0].text = "worduniquelyupdated"
    buffer = BytesIO()
    doc.save(buffer)
    result = save(client, url, buffer.getvalue(), revision)
    assert result.status_code == 200
    assert result.json()["revision"] != revision
    actual = WordDocument(BytesIO(client.get(url + "/file").content))
    assert actual.paragraphs[0].runs[0].text == "worduniquelyupdated" and actual.paragraphs[0].runs[0].bold
    assert actual.paragraphs[0].runs[1].italic
    assert actual.tables[0].cell(0, 0).text == "Keep table"
    assert actual.sections[0].header.paragraphs[0].text == "Keep header"
    assert path.read_bytes() == buffer.getvalue() and knowledge.search("worduniquelyupdated")["hits"]
    detail = client.get("/api/v1/workspaces/tasks/" + work["id"]).json()
    assert detail["documents"][0]["work_id"] == work["id"]
    assert client.get("/api/v1/workspace").json()["revision"] == business
    assert save(client, url, word_bytes("Stale"), revision).status_code == 409
    assert path.read_bytes() == buffer.getvalue()


def test_docx_failed_indexing_and_invalid_files_keep_original(client, monkeypatch):
    url, path, _ = upload(client)
    original = path.read_bytes()
    revision = client.get(url + "/docx").headers["x-document-revision"]

    def fail(*args, **kwargs):
        raise RuntimeError("temporary index issue")

    with monkeypatch.context() as patch:
        patch.setattr(knowledge, "ingest", fail)
        assert save(client, url, word_bytes("Changed"), revision).status_code == 503
    assert path.read_bytes() == original
    for raw in [b"not DOCX", b"PK\x03\x04broken"]:
        assert save(client, url, raw, revision).status_code == 422
        assert path.read_bytes() == original
    buffer = BytesIO()
    with ZipFile(buffer, "w") as archive:
        archive.writestr("word/vbaProject.bin", b"macro")
    assert save(client, url, buffer.getvalue(), revision).status_code == 422
    assert save(client, url, word_bytes(), "invalid").status_code == 422
    client.cookies.clear()
    assert client.get(url + "/docx").status_code == 401
    assert save(client, url, word_bytes(), revision).status_code == 401


def test_docx_wrong_file_type_cannot_be_edited(client):
    result = client.post("/api/v1/knowledge/upload", files={"file": ("notes.md", b"# Notes")}).json()
    url = "/api/v1/knowledge/documents/" + result["id"]
    assert client.get(url + "/docx").status_code == 422
    assert save(client, url, word_bytes(), "0" * 64).status_code == 422
    assert client.get("/api/v1/knowledge/documents/missing/docx").status_code == 404
