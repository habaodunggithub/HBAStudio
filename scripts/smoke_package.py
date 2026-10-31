#!/usr/bin/env python3
"""Install the built backend wheel into a clean environment, away from source."""

import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
PRIVATE_PARTS = {".private", ".git", ".codex", ".venv", "node_modules", "__pycache__", "test-results"}


def check_archive(names):
    for name in names:
        path = Path(name)
        assert not PRIVATE_PARTS.intersection(path.parts), f"Private/generated archive entry: {name}"
        assert path.name not in {".env", "local-token", "google-client.json", "google-token.json"}, name
        assert not path.name.startswith("client_secret"), name


def main():
    wheels = sorted((ROOT / "dist").glob("personal_deadline_management-*.whl"))
    sources = sorted((ROOT / "dist").glob("personal_deadline_management-*.tar.gz"))
    if len(wheels) != 1 or len(sources) != 1:
        raise SystemExit("Run uv build first; dist/ must contain one matching wheel and source archive.")
    with zipfile.ZipFile(wheels[0]) as archive:
        check_archive(archive.namelist())
        assert "backend/resources/office-runtime.json" in archive.namelist()
        assert "backend/migrations/versions/0003_canvas.py" in archive.namelist()
        assert not any(name.startswith("frontend/") for name in archive.namelist())
    with tarfile.open(sources[0]) as archive:
        check_archive(archive.getnames())
        assert any(name.endswith("frontend/src/App.tsx") for name in archive.getnames())
        assert any(name.endswith("frontend/.prettierrc.json") for name in archive.getnames())
        assert any(name.endswith("docs/assets/workspace.png") for name in archive.getnames())

    with tempfile.TemporaryDirectory(prefix="pdm-package-smoke-") as temporary:
        root = Path(temporary)
        venv = root / "venv"
        subprocess.run(["uv", "venv", "--python", sys.executable, str(venv)], check=True)
        python = venv / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
        requirements = root / "requirements.txt"
        subprocess.run(
            [
                "uv",
                "export",
                "--frozen",
                "--no-dev",
                "--no-hashes",
                "--no-emit-project",
                "--output-file",
                str(requirements),
            ],
            cwd=ROOT,
            check=True,
            stdout=subprocess.DEVNULL,
        )
        subprocess.run(
            ["uv", "pip", "install", "--python", str(python), "-r", str(requirements), str(wheels[0])],
            check=True,
        )
        env = {
            **os.environ,
            "PDM_DATA_DIR": str(root / "data"),
            "PDM_CACHE_DIR": str(root / "cache"),
            "PDM_AGENT_ENABLED": "0",
            "PDM_NO_WORKER": "1",
            "PDM_TESTING": "1",
            "PDM_WEB_DIST": str(root / "no-web"),
            "PDM_GOOGLE_CLIENT_FILE": str(root / "no-google.json"),
        }
        env.pop("PYTHONPATH", None)
        code = """
from pathlib import Path
from fastapi.testclient import TestClient
from backend import config, __version__
from backend.app import app
from backend.office_runtime import manifest
from importlib.metadata import distribution
assert Path(config.__file__).is_relative_to(Path.cwd() / "venv"), config.__file__
assert manifest()["id"]
assert {e.name for e in distribution("personal-deadline-management").entry_points} >= {"pdm", "pdm-mcp"}
assert not config.DATA.exists()
with TestClient(app) as client:
    assert client.get("/api/v1/health").json() == {"ok": True, "version": __version__}
    assert client.get("/api/v1/workspace").status_code == 401
    assert client.get("/api/v1/bootstrap").status_code == 200
    assert client.get("/api/v1/workspace").json()["tasks"] == []
    assert client.post("/api/v1/tasks", json={"title": "Packaged task"}).status_code == 200
with TestClient(app) as client:
    client.get("/api/v1/bootstrap")
    assert client.get("/api/v1/workspace").json()["tasks"][0]["title"] == "Packaged task"
"""
        subprocess.run([str(python), "-c", code], cwd=root, env=env, check=True)
        cli = venv / ("Scripts/pdm.exe" if os.name == "nt" else "bin/pdm")
        subprocess.run([str(cli), "--version"], cwd=root, env=env, check=True)
    print(
        "Package smoke passed: clean wheel install, packaged migrations/resources, auth, writes and restart persistence."
    )


if __name__ == "__main__":
    main()
