"""Contracts for source installs, packaged installs and the HTTP boundary."""

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

from backend import config, knowledge
from backend.app import create_app
from backend.db import Session
from backend.models import OutboxJob


def test_refactor_retains_every_existing_http_endpoint():
    expected = json.loads(Path(__file__).with_name("api_contract.json").read_text())
    paths = create_app().openapi()["paths"]
    for item in expected:
        assert item["method"].lower() in paths[item["path"]], item


def test_import_and_configuration_do_not_create_user_data(tmp_path):
    data, cache = tmp_path / "data", tmp_path / "cache"
    env = {**os.environ, "PDM_DATA_DIR": str(data), "PDM_CACHE_DIR": str(cache)}
    subprocess.run([sys.executable, "-c", "import backend.app"], env=env, check=True, capture_output=True)
    assert not data.exists()
    assert not cache.exists()


@pytest.mark.parametrize("value", ["abc", "0", "65536"])
def test_invalid_port_fails_with_actionable_error(value):
    result = subprocess.run(
        [sys.executable, "-c", "import backend.config"],
        env={**os.environ, "PDM_PORT": value},
        capture_output=True,
        text=True,
    )
    assert result.returncode != 0
    assert "PDM_PORT must be" in result.stderr


def test_origin_uses_configured_development_port_and_rejects_malformed_origins(client, monkeypatch):
    monkeypatch.setattr(config, "DEV_PORT", 5181)
    assert client.get("/api/v1/workspace", headers={"Origin": "http://127.0.0.1:5181"}).status_code == 200
    for origin in ("http://127.0.0.1:5173", "https://127.0.0.1:5181", "http://127.0.0.1:invalid", "null"):
        response = client.get("/api/v1/workspace", headers={"Origin": origin})
        assert response.status_code == 403
        assert response.headers["X-Content-Type-Options"] == "nosniff"


def test_basic_install_supports_keyword_search_without_semantic_dependencies(client, monkeypatch):
    monkeypatch.setattr(knowledge, "semantic_available", lambda: False)
    assert client.get("/api/v1/workspace").json()["knowledge"]["semantic_available"] is False
    assert client.get("/api/v1/knowledge/search", params={"q": "course"}).json()["mode"] == "keyword"
    response = client.post("/api/v1/knowledge/model")
    assert response.status_code == 409
    assert "--extra semantic" in response.json()["detail"]
    with Session() as session:
        assert session.get(OutboxJob, "embedding-model") is None
