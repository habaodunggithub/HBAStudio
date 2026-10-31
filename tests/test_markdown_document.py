from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from sqlalchemy import select
from .conftest import create
from backend import config, knowledge, markdown_document
from backend.db import Session, transaction
from backend.models import Document, DocumentChunk, KnowledgeSource


def upload(client, name="board.md", content=b"# Original\n\nolduniquetoken"):
    work = create(client, "tasks", title="Markdown workspace")
    response = client.post(
        "/api/v1/knowledge/upload", data={"work_kind": "tasks", "work_id": work["id"]}, files={"file": (name, content)}
    )
    assert response.status_code == 200
    ident = response.json()["id"]
    with Session() as session:
        path = Path(session.get(Document, ident).data["path"])
    knowledge.ingest(path, doc_id=ident)
    return "/api/v1/knowledge/documents/" + ident, ident, path, work


def test_markdown_save_updates_original_and_search_sources_without_changing_work(client):
    url, ident, path, work = upload(client)
    original = client.get(url + "/content")
    assert original.status_code == 200 and original.json()["content"].startswith("# Original")
    assert original.headers["cache-control"] == "private, no-store"
    before = client.get("/api/v1/workspaces/tasks/" + work["id"]).json()
    revision = client.get("/api/v1/workspace").json()["revision"]
    content = "# Ghi chú tiếng Việt\n\n- [x] newuniquetoken\n\n| A | B |\n| - | - |\n| 1 | 2 |"
    saved = client.put(url + "/content", json={"content": content, "revision": original.json()["revision"]})
    assert saved.status_code == 200 and saved.json()["revision"] != original.json()["revision"]
    assert path.read_text() == content and client.get(url + "/file").content.decode() == content
    assert client.get(url + "/content").json() == {"content": content, **saved.json()}
    with Session() as session:
        doc = session.get(Document, ident)
        assert doc.data["work_id"] == work["id"] and doc.data["work_kind"] == "tasks"
        assert doc.data["hash"] == saved.json()["revision"] and doc.data["status"] == "ready"
        assert all(
            "olduniquetoken" not in c.text
            for c in session.scalars(select(DocumentChunk).where(DocumentChunk.document_id == ident))
        )
    assert not knowledge.search("olduniquetoken")["hits"] and knowledge.search("newuniquetoken")["hits"]
    after = client.get("/api/v1/workspaces/tasks/" + work["id"]).json()
    assert before["fingerprint"] != after["fingerprint"] and after["analysis"]["status"] == "idle"
    assert client.get("/api/v1/workspace").json()["revision"] == revision
    assert not list(path.parent.glob(".markdown-*.tmp"))


def test_markdown_rejects_stale_and_simultaneous_saves(client):
    url, _, path, _ = upload(client)
    base = client.get(url + "/content").json()["revision"]
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(
            pool.map(
                lambda text: client.put(url + "/content", json={"content": text, "revision": base}),
                ["# First", "# Second"],
            )
        )
    assert sorted(r.status_code for r in results) == [200, 409]
    saved = client.get(url + "/content").json()
    assert saved["content"] == path.read_text() and saved["content"] in {"# First", "# Second"}
    path.write_text("# Edited externally")
    assert (
        client.put(url + "/content", json={"content": "# Local draft", "revision": saved["revision"]}).status_code
        == 409
    )
    assert path.read_text() == "# Edited externally"


def test_empty_markdown_is_valid_and_failed_indexing_keeps_original(client, monkeypatch):
    url, ident, path, _ = upload(client, name="notes.markdown")
    base = client.get(url + "/content").json()["revision"]

    def failed(*args, **kwargs):
        raise RuntimeError("Temporary index failure")

    with monkeypatch.context() as patch:
        patch.setattr(knowledge, "ingest", failed)
        assert client.put(url + "/content", json={"content": "new text", "revision": base}).status_code == 503
    assert path.read_bytes() == b"# Original\n\nolduniquetoken"
    assert client.get(url + "/content").json()["revision"] == base
    assert knowledge.search("olduniquetoken")["hits"]
    assert client.put(url + "/content", json={"content": "", "revision": base}).status_code == 200
    assert path.read_bytes() == b""
    with Session() as session:
        assert session.get(Document, ident).data["status"] == "ready"
        assert not list(session.scalars(select(DocumentChunk).where(DocumentChunk.document_id == ident)))


def test_watched_markdown_save_preserves_source_link(client, tmp_path):
    root = tmp_path / "source"
    root.mkdir()
    path = root / "reading.md"
    path.write_text("# Watched document")
    with transaction() as session:
        session.add(KnowledgeSource(id="watched", data={"path": str(root), "enabled": True}))
    ident = knowledge.ingest(path, source_id="watched")
    url = "/api/v1/knowledge/documents/" + ident
    revision = client.get(url + "/content").json()["revision"]
    assert (
        client.put(url + "/content", json={"content": "# Updated watched document", "revision": revision}).status_code
        == 200
    )
    knowledge.scan_sources()
    assert path.read_text() == "# Updated watched document"
    with Session() as session:
        assert session.get(Document, ident).data["source_id"] == "watched"
        assert len(list(session.scalars(select(Document)))) == 1


def test_markdown_edit_boundaries_format_size_and_auth(client, tmp_path, monkeypatch):
    url, _, path, _ = upload(client)
    base = client.get(url + "/content").json()["revision"]
    assert (
        client.put(url + "/content", json={"content": "bad", "revision": base, "path": "/tmp/anything"}).status_code
        == 422
    )
    assert client.put(url + "/content", json={"content": "bad", "revision": "invalid"}).status_code == 422
    other_url, _, _, _ = upload(client, name="text.txt")
    assert client.get(other_url + "/content").status_code == 422
    assert client.put(other_url + "/content", json={"content": "bad", "revision": base}).status_code == 422
    outside = tmp_path / "outside.md"
    outside.write_text("# private")
    linked = config.DATA / "uploads" / "escape.md"
    linked.symlink_to(outside)
    with transaction() as session:
        session.add(Document(id="outside", data={"path": str(outside)}))
        session.add(Document(id="escape", data={"path": str(linked)}))
    for ident in ["outside", "escape", "missing"]:
        endpoint = "/api/v1/knowledge/documents/" + ident + "/content"
        assert client.get(endpoint).status_code == 404
        assert client.put(endpoint, json={"content": "bad", "revision": base}).status_code == 404
    monkeypatch.setattr(markdown_document, "MAX_BYTES", 64)
    assert client.put(url + "/content", json={"content": "ế" * 30, "revision": base}).status_code == 413
    assert path.read_bytes() == b"# Original\n\nolduniquetoken"
    path.write_bytes(b"\xff\xfe")
    assert client.get(url + "/content").status_code == 422
    client.cookies.clear()
    assert client.get(url + "/content").status_code == 401
    assert client.put(url + "/content", json={"content": "bad", "revision": base}).status_code == 401
