"""Optional office runtime is inert until installed and serves pinned files only."""

import hashlib
import importlib.util
import io
import json
from pathlib import Path

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from backend import office_runtime


@pytest.fixture
def runtime(tmp_path, monkeypatch):
    raw = b"pinned office runtime fixture"
    bundle = {
        "id": "test-office-v1",
        "engine": "LibreOffice Writer",
        "version": "Test pinned build",
        "sources": [
            {
                "name": "Fixture",
                "license": "MIT",
                "source": "https://example.invalid/source",
                "notice": "https://example.invalid/license",
            }
        ],
        "assets": [
            {
                "name": "soffice.js",
                "file": "soffice.js",
                "bytes": len(raw),
                "sha256": hashlib.sha256(raw).hexdigest(),
                "url": "https://example.invalid/soffice.js",
                "media_type": "text/javascript",
            }
        ],
    }
    root = tmp_path / "runtime"
    root.mkdir()
    monkeypatch.setenv("PDM_OFFICE_ASSETS", str(root))
    monkeypatch.setattr(office_runtime, "manifest", lambda: bundle)
    office_runtime._verified.cache_clear()
    return root, bundle, raw


@pytest.fixture
def installer():
    path = Path(__file__).resolve().parents[1] / "scripts" / "setup-office-runtime.py"
    spec = importlib.util.spec_from_file_location("setup_office_runtime", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_runtime_status_missing_is_readonly_and_does_not_expose_paths(runtime):
    root, _, _ = runtime
    status = office_runtime.runtime_status()
    assert status["available"] is False
    assert status["missing"] == ["soffice.js"]
    assert str(root) not in json.dumps(status)
    assert list(root.iterdir()) == []


def test_runtime_checks_integrity_once_and_invalidates_modified_file(runtime, monkeypatch):
    root, _, raw = runtime
    path = root / "soffice.js"
    path.write_bytes(raw)
    calls = []
    original = hashlib.file_digest

    def digest(*args):
        calls.append(True)
        return original(*args)

    monkeypatch.setattr(hashlib, "file_digest", digest)
    assert office_runtime.runtime_status()["available"]
    assert office_runtime.runtime_status()["available"]
    assert office_runtime.runtime_asset("soffice.js").headers["etag"].startswith('"')
    assert len(calls) == 1
    path.write_bytes(b"x" * len(raw))
    assert not office_runtime.runtime_status()["available"]
    assert len(calls) == 2


def test_runtime_never_serves_unknown_names_unverified_files_or_symlinks(runtime, tmp_path):
    root, _, raw = runtime
    for name in ("../soffice.js", "runtime.json", "NOTICE.txt", "soffice.wasm.br"):
        with pytest.raises(HTTPException) as error:
            office_runtime.runtime_asset(name)
        assert error.value.status_code == 404
    with pytest.raises(HTTPException) as error:
        office_runtime.runtime_asset("soffice.js")
    assert error.value.status_code == 503
    source = tmp_path / "outside.js"
    source.write_bytes(raw)
    (root / "soffice.js").symlink_to(source)
    assert not office_runtime.runtime_status()["available"]
    with pytest.raises(HTTPException):
        office_runtime.runtime_asset("soffice.js")


def test_runtime_asset_content_and_headers(runtime):
    root, bundle, raw = runtime
    (root / "soffice.js").write_bytes(raw)
    app = FastAPI()
    app.get("/runtime/{name}")(office_runtime.runtime_asset)
    with TestClient(app) as client:
        response = client.get("/runtime/soffice.js?v=test-office-v1")
    assert response.status_code == 200
    assert response.content == raw
    assert response.headers["content-type"].startswith("text/javascript")
    assert response.headers["etag"] == '"' + bundle["assets"][0]["sha256"] + '"'
    assert "immutable" in response.headers["cache-control"]
    assert response.headers["cross-origin-resource-policy"] == "same-origin"


def test_runtime_brotli_assets_have_wasm_type_and_encoding(runtime):
    root, bundle, raw = runtime
    asset = bundle["assets"][0]
    asset.update(name="soffice.wasm", file="soffice.wasm.br", media_type="application/wasm", encoding="br")
    (root / asset["file"]).write_bytes(raw)
    response = office_runtime.runtime_asset("soffice.wasm")
    assert response.headers["content-type"] == "application/wasm"
    assert response.headers["content-encoding"] == "br"
    assert response.path == root / "soffice.wasm.br"


def test_setup_copies_verified_assets_and_records_provenance(runtime, installer, tmp_path):
    root, bundle, raw = runtime
    source = tmp_path / "source"
    source.mkdir()
    (source / "soffice.js").write_bytes(raw)
    assert installer.install(bundle, root, source) == root
    assert office_runtime.runtime_status()["available"]
    assert json.loads((root / "runtime.json").read_text())["id"] == bundle["id"]
    assert "https://example.invalid/source" in (root / "NOTICE.txt").read_text()


def test_setup_hash_failure_preserves_installed_bundle(runtime, installer, tmp_path):
    root, bundle, raw = runtime
    (root / "soffice.js").write_bytes(raw)
    (root / "runtime.json").write_text(json.dumps(bundle))
    source = tmp_path / "source"
    source.mkdir()
    (source / "soffice.js").write_bytes(b"x" * len(raw))
    with pytest.raises(ValueError, match="SHA-256"):
        installer.install(bundle, root, source)
    assert (root / "soffice.js").read_bytes() == raw
    assert list(root.parent.glob(".office-runtime-*")) == []


def test_setup_refuses_unmanaged_destination_or_source_symlink(runtime, installer, tmp_path):
    root, bundle, raw = runtime
    source = tmp_path / "source"
    source.mkdir()
    outside = tmp_path / "actual.js"
    outside.write_bytes(raw)
    (source / "soffice.js").symlink_to(outside)
    with pytest.raises(ValueError, match="Thiếu tài nguyên"):
        installer.install(bundle, root, source)
    (root / "personal.txt").write_text("preserve me")
    with pytest.raises(ValueError, match="Không ghi đè"):
        installer.install(bundle, root, source)
    assert (root / "personal.txt").read_text() == "preserve me"


def test_setup_failed_atomic_install_restores_existing_bundle(runtime, installer, tmp_path, monkeypatch):
    root, bundle, raw = runtime
    (root / "soffice.js").write_bytes(raw)
    (root / "runtime.json").write_text(json.dumps(bundle))
    source = tmp_path / "source"
    source.mkdir()
    (source / "soffice.js").write_bytes(raw)
    rename = Path.rename

    def fail_install(path, target):
        if path.name == "bundle":
            raise OSError("simulated installation failure")
        return rename(path, target)

    monkeypatch.setattr(Path, "rename", fail_install)
    with pytest.raises(OSError, match="installation failure"):
        installer.install(bundle, root, source)
    assert (root / "soffice.js").read_bytes() == raw
    assert list(root.parent.glob(".office-runtime-*")) == []


def test_setup_bounds_download_size_and_uses_pinned_urls(runtime, installer, tmp_path, monkeypatch):
    root, bundle, raw = runtime
    requested = []

    def download(request, timeout):
        requested.append(request.full_url)
        return io.BytesIO(raw)

    monkeypatch.setattr(installer.urllib.request, "urlopen", download)
    installer.install(bundle, root)
    assert requested == [bundle["assets"][0]["url"]]
    with pytest.raises(ValueError, match="Sai kích thước"):
        installer.copy_verified(io.BytesIO(raw + b"extra"), tmp_path / "too-large.js", bundle["assets"][0])


def test_manifest_contains_only_expected_pinned_runtime_assets():
    manifest = json.loads(office_runtime.MANIFEST_PATH.read_text())
    assert {a["name"] for a in manifest["assets"]} == {
        "soffice.js",
        "soffice.data.js.metadata",
        "soffice.wasm",
        "soffice.data",
        "zeta.js",
    }
    for asset in manifest["assets"]:
        assert asset["bytes"] > 0
        assert len(asset["sha256"]) == 64
        assert asset["url"].startswith("https://")
        assert "/" not in asset["file"]
