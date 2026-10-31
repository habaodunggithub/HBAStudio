"""Failure boundaries shared by every editable document format."""

import stat

import pytest

from backend import document_storage, knowledge
from .test_docx_edit import upload as upload_docx, save as save_docx
from .test_markdown_document import upload as upload_markdown


def test_atomic_replace_failure_preserves_original_permissions_and_cleans_temporary(tmp_path, monkeypatch):
    path = tmp_path / "original.md"
    path.write_bytes(b"original")
    path.chmod(0o640)

    def fail(*args):
        raise OSError("replacement unavailable")

    with monkeypatch.context() as patch:
        patch.setattr(document_storage.os, "replace", fail)
        with pytest.raises(OSError):
            document_storage.atomic_write(path, b"changed")
    assert path.read_bytes() == b"original"
    assert not list(tmp_path.glob(".document-*.tmp"))
    document_storage.atomic_write(path, b"changed")
    assert path.read_bytes() == b"changed"
    assert stat.S_IMODE(path.stat().st_mode) == 0o640


@pytest.mark.parametrize("format", ["markdown", "docx"])
def test_unchanged_save_skips_reindex_and_replace(client, monkeypatch, format):
    if format == "markdown":
        url, _, path, _ = upload_markdown(client)
        current = client.get(url + "/content").json()
        save = lambda: client.put(url + "/content", json=current)
        revision = current["revision"]
    else:
        url, path, _ = upload_docx(client)
        response = client.get(url + "/docx")
        revision = response.headers["x-document-revision"]
        save = lambda: save_docx(client, url, response.content, revision)
    before = path.stat().st_mtime_ns

    def unexpected(*args, **kwargs):
        raise AssertionError("Unchanged documents must not be rewritten or reindexed")

    monkeypatch.setattr(knowledge, "ingest", unexpected)
    monkeypatch.setattr(document_storage, "atomic_write", unexpected)
    result = save()
    assert result.status_code == 200
    assert result.json() == {"revision": revision}
    assert path.stat().st_mtime_ns == before
