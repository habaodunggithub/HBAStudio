#!/usr/bin/env bash
set -euo pipefail
pdm_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec codex mcp add personal-deadline-management -- bash "$pdm_root/scripts/mcp.sh"
