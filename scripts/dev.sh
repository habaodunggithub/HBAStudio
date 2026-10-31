#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
bash scripts/setup.sh "$@"
uv run --frozen --no-sync pdm --reload &
pdm_backend_pid=$!
trap 'kill "$pdm_backend_pid" 2>/dev/null || true; wait "$pdm_backend_pid" 2>/dev/null || true' EXIT INT TERM
pnpm --dir frontend dev
