#!/usr/bin/env bash
# Shared by source-checkout launchers. No secrets or shell code are read from .env.
set -euo pipefail
pdm_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$pdm_root"
export UV_PROJECT_ENVIRONMENT="${PDM_VENV:-${UV_PROJECT_ENVIRONMENT:-${XDG_CACHE_HOME:-$HOME/.cache}/personal-deadline-management/venv}}"

pdm_require() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'Missing required command: %s. See README.md.\n' "$1" >&2
    exit 1
  fi
}

pdm_python() {
  uv run --frozen --no-sync python "$@"
}
