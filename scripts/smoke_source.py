#!/usr/bin/env python3
"""Verify setup and a development proxy from only the public source archive."""

import http.cookiejar
import json
import os
from pathlib import Path
import signal
import subprocess
import tarfile
import tempfile
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]


def main():
    archives = sorted((ROOT / "dist").glob("personal_deadline_management-*.tar.gz"))
    if len(archives) != 1:
        raise SystemExit("Run uv build first; dist/ must contain one source archive.")
    with tempfile.TemporaryDirectory(prefix="pdm-source-smoke-") as temporary:
        directory = Path(temporary)
        with tarfile.open(archives[0]) as archive:
            archive.extractall(directory / "source", filter="data")
        source = next((directory / "source").iterdir())
        env = {
            **os.environ,
            "CI": "true",
            "UV_PROJECT_ENVIRONMENT": str(directory / "venv"),
            "PDM_DATA_DIR": str(directory / "data"),
            "PDM_CACHE_DIR": str(directory / "cache"),
            "PDM_GOOGLE_CLIENT_FILE": str(directory / "no-google.json"),
            "PDM_AGENT_ENABLED": "0",
            "PDM_NO_WORKER": "1",
        }
        env.pop("PDM_VENV", None)
        env.pop("VIRTUAL_ENV", None)
        env.pop("PYTHONPATH", None)

        def run(*command):
            subprocess.run(command, cwd=source, env=env, check=True)

        run("git", "init", "-q", "-b", "main")
        run("uv", "sync", "--frozen", "--python", "3.12")
        run("uv", "run", "--frozen", "--no-sync", "pytest", "-q")
        run("uv", "run", "--frozen", "--no-sync", "python", "scripts/check_release.py")
        run("pnpm", "--dir", "frontend", "install", "--frozen-lockfile")
        run("pnpm", "--dir", "frontend", "format:check")
        run("pnpm", "--dir", "frontend", "test:unit")
        run("pnpm", "--dir", "frontend", "build")

        # Explicitly exercise non-default ports through Vite, rather than merely
        # checking that environment variables appear in a configuration object.
        env.update(PDM_PORT="8875", PDM_DEV_PORT="5181")
        processes = []
        with (directory / "servers.log").open("w+") as log:
            try:
                for command in (
                    ["uv", "run", "--frozen", "--no-sync", "pdm"],
                    ["pnpm", "--dir", "frontend", "dev"],
                ):
                    processes.append(
                        subprocess.Popen(
                            command, cwd=source, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True
                        )
                    )
                client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
                base = "http://127.0.0.1:5181/api/v1"
                for _ in range(100):
                    try:
                        with client.open(base + "/health", timeout=1) as response:
                            if json.load(response).get("ok"):
                                break
                    except (OSError, urllib.error.URLError, ValueError):
                        if any(process.poll() is not None for process in processes):
                            log.seek(0)
                            raise RuntimeError("Source server exited:\n" + log.read()) from None
                        time.sleep(0.1)
                else:
                    raise RuntimeError("Source development server did not become ready")
                with client.open(base + "/bootstrap", timeout=5) as response:
                    assert response.status == 200
                request = urllib.request.Request(
                    base + "/tasks",
                    data=json.dumps({"title": "Source checkout smoke"}).encode(),
                    headers={"Content-Type": "application/json", "Origin": "http://127.0.0.1:5181"},
                )
                with client.open(request, timeout=5) as response:
                    assert json.load(response)["title"] == "Source checkout smoke"
                with client.open(base + "/workspace", timeout=5) as response:
                    assert len(json.load(response)["tasks"]) == 1
                    assert response.headers["Cross-Origin-Opener-Policy"] == "same-origin"
            finally:
                for process in reversed(processes):
                    if process.poll() is None:
                        os.killpg(process.pid, signal.SIGTERM)
                        try:
                            process.wait(timeout=10)
                        except subprocess.TimeoutExpired:
                            os.killpg(process.pid, signal.SIGKILL)
                            process.wait()
    print("Source smoke passed: clean locked install, tests/build and development proxy on custom ports.")


if __name__ == "__main__":
    main()
