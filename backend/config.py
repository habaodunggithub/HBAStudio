"""Shared configuration for the API, CLI, MCP and optional runtime installer.

Importing configuration never creates directories or opens a database. Explicit
environment variables override the checkout's .env file. Existing Linux defaults
are retained; other platforms use their normal per-user application directories.
"""

import os
from pathlib import Path

from dotenv import load_dotenv
from platformdirs import user_cache_path, user_data_path

PACKAGE = Path(__file__).resolve().parent
ROOT = PACKAGE.parent
APP_NAME = "personal-deadline-management"
load_dotenv(ROOT / ".env", override=False)


def directory(name: str, default: Path) -> Path:
    value = os.environ.get(name, "").strip()
    path = Path(value).expanduser() if value else default
    return (ROOT / path).resolve() if not path.is_absolute() else path.resolve()


def port(name: str, default: int) -> int:
    try:
        value = int(os.environ.get(name) or default)
    except ValueError:
        raise ValueError(f"{name} must be an integer between 1 and 65535") from None
    if not 1 <= value <= 65535:
        raise ValueError(f"{name} must be between 1 and 65535")
    return value


DATA = directory("PDM_DATA_DIR", user_data_path(APP_NAME, appauthor=False))
CACHE = directory("PDM_CACHE_DIR", user_cache_path(APP_NAME, appauthor=False))
PORT = port("PDM_PORT", 8765)
DEV_PORT = port("PDM_DEV_PORT", 5173)
TZ = "Asia/Ho_Chi_Minh"
RESOURCES = ROOT / "resources" if (ROOT / "resources/office-runtime.json").is_file() else PACKAGE / "resources"
WEB_DIST = directory("PDM_WEB_DIST", ROOT / "frontend/dist")


def prepare():
    for path in (DATA, DATA / "uploads", DATA / "backups", CACHE):
        path.mkdir(parents=True, exist_ok=True)
    if os.name != "nt":
        DATA.chmod(0o700)
