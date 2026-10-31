"""Select the local Codex identity without editing the user's CLI credentials."""

import json
import os
import tempfile
import uuid
from pathlib import Path

from . import config


def selection():
    try:
        value = json.loads((config.DATA / "codex-connection.json").read_text())
        if value.get("mode") in {"system", "app", "off"}:
            return value
    except (OSError, ValueError):
        pass
    return {"mode": "system", "generation": "legacy"}


def select(mode):
    value = {"mode": mode, "generation": str(uuid.uuid4())}
    with tempfile.NamedTemporaryFile(mode="w", dir=config.DATA, prefix=".codex-connection-", delete=False) as file:
        temporary = Path(file.name)
        json.dump(value, file)
    try:
        os.replace(temporary, config.DATA / "codex-connection.json")
    finally:
        temporary.unlink(missing_ok=True)


def owned_home():
    path = config.DATA / "codex"
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    path.chmod(0o700)
    return path


def environment(mode=None):
    mode = mode or selection()["mode"]
    if mode == "off":
        raise RuntimeError("Codex đã ngắt kết nối. Mở Tài khoản & kết nối để đăng nhập lại.")
    env = {
        key: value
        for key, value in os.environ.items()
        if not key.startswith("CODEX_THREAD") and key != "CODEX_INTERNAL_ORIGINATOR_OVERRIDE"
    }
    if mode == "app":
        env["CODEX_HOME"] = str(owned_home())
        # An inherited API key/access token must not override the account chosen in the app.
        for key in ("OPENAI_API_KEY", "CODEX_API_KEY", "CODEX_ACCESS_TOKEN"):
            env.pop(key, None)
    return env


def auth_options(mode=None):
    return ["-c", 'cli_auth_credentials_store="file"'] if (mode or selection()["mode"]) == "app" else []
