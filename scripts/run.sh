#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
bash scripts/setup.sh "$@"
pnpm --dir frontend build
pdm_python -c 'from backend.config import PORT; print(f"Open http://127.0.0.1:{PORT}", flush=True)'
exec uv run --frozen --no-sync pdm
