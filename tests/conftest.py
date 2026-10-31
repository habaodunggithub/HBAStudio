import os
import tempfile
from pathlib import Path
import pytest

_temporary = tempfile.TemporaryDirectory(prefix="pdm-tests-")
os.environ["PDM_DATA_DIR"] = str(Path(_temporary.name) / "data")
os.environ["PDM_CACHE_DIR"] = str(Path(_temporary.name) / "cache")
os.environ["PDM_TESTING"] = "1"
os.environ["PDM_NO_WORKER"] = "1"
os.environ["PDM_AGENT_ENABLED"] = "0"
os.environ["PDM_GOOGLE_CLIENT_FILE"] = str(Path(_temporary.name) / "no-google-client.json")

from backend.db import initialize, transaction, engine, DEFAULT_SETTINGS
from backend.models import Base, WorkspaceState
from backend.app import app
from fastapi.testclient import TestClient


@pytest.fixture(autouse=True)
def clean_database():
    initialize()
    with transaction() as s:
        for table in reversed(Base.metadata.sorted_tables):
            s.execute(table.delete())
        s.connection().exec_driver_sql("DELETE FROM chunks_fts")
        s.add(WorkspaceState(id=1, revision=0, settings=DEFAULT_SETTINGS.copy()))
    yield


@pytest.fixture
def client():
    with TestClient(app) as c:
        c.get("/api/v1/bootstrap")
        yield c


def create(client, kind, **data):
    response = client.post("/api/v1/" + kind, json=data)
    assert response.status_code == 200, response.text
    return response.json()
