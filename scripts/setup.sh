#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
for pdm_tool in uv node pnpm; do pdm_require "$pdm_tool"; done
pdm_extras=()
pdm_office=0
for pdm_option in "$@"; do
  case "$pdm_option" in
    --semantic) pdm_extras+=(--extra semantic) ;;
    --office) pdm_office=1 ;;
    *) printf 'Usage: bash scripts/setup.sh [--semantic] [--office]\n' >&2; exit 2 ;;
  esac
done
# Preserve already installed optional extras when doing routine setup.
uv sync --frozen --python 3.12 --inexact "${pdm_extras[@]}"
pnpm --dir frontend install --frozen-lockfile
if [[ "$pdm_office" == 1 ]]; then
  pdm_python scripts/setup-office-runtime.py --if-missing
fi
