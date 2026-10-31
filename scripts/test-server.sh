#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
# Test documents and DB are isolated; the immutable engine bundle is shared.
export PDM_OFFICE_ASSETS="$(pdm_python -c 'from backend.office_runtime import runtime_root; print(runtime_root())')"
pdm_test_dir="$(mktemp -d -t pdm-browser-XXXXXX)"
export PDM_DATA_DIR="$pdm_test_dir/data"
export PDM_CACHE_DIR="$pdm_test_dir/cache"
export PDM_PORT=8766
export PDM_AGENT_ENABLED=0
export PDM_NO_WORKER=0
# OAuth file selection must never inherit the developer's personal configuration.
export PDM_GOOGLE_CLIENT_FILE="$pdm_test_dir/no-google-client.json"
uv run --frozen --no-sync pdm &
pdm_test_pid=$!
trap 'kill "$pdm_test_pid" 2>/dev/null || true; wait "$pdm_test_pid" 2>/dev/null || true; rm -rf -- "$pdm_test_dir"' EXIT INT TERM
wait "$pdm_test_pid"
