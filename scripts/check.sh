#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
pdm_require uv
pdm_require pnpm
uv run --frozen --no-sync ruff check backend scripts tests
uv run --frozen --no-sync ruff format --check backend scripts tests
pdm_python -m pytest -q --tb=short
pnpm --dir frontend format:check
pnpm --dir frontend test:unit
pnpm --dir frontend build
pdm_python scripts/check_release.py
if [[ "${1:-}" == "--e2e" ]]; then
  pnpm --dir frontend test:e2e
elif [[ "$#" != 0 ]]; then
  printf 'Usage: bash scripts/check.sh [--e2e]\n' >&2
  exit 2
fi
