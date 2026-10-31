# Development

## Pick a Python environment

Direct uv commands use `.venv`; Bash launchers preserve the legacy environment
in the user cache. To use one environment consistently with both:

```bash
export UV_PROJECT_ENVIRONMENT="${XDG_CACHE_HOME:-$HOME/.cache}/personal-deadline-management/venv"
bash scripts/setup.sh
bash scripts/dev.sh
```

Alternatively, export `PDM_VENV="$PWD/.venv"` for the shell launchers, and use
`.venv` for direct uv commands. Avoid syncing the active user's environment during
experiments: use a distinct environment and temporary data/cache directories.

`uv sync --frozen` installs core dependencies and development tools. Semantic
search is an extra (`--extra semantic`), not a required dependency. Routine shell
setup uses `--inexact` to preserve optional extras already installed. To remove
extras deliberately, stop the app and sync without `--inexact` or the extra flag.

## Commands

```bash
# Backend, loopback only; add --reload during development.
uv run --frozen --no-sync pdm
# Frontend; ports and proxy come from the root .env/environment.
pnpm --dir frontend dev

# Formatting and static checks.
uv run --frozen --no-sync ruff format backend scripts tests
uv run --frozen --no-sync ruff check backend scripts tests
pnpm --dir frontend format
pnpm --dir frontend typecheck

# Backend and frontend unit/integration tests.
uv run --frozen --no-sync pytest -q
pnpm --dir frontend test:unit
pnpm --dir frontend build

# MCP protocol smoke against a temporary backend (no AI inference).
uv run --frozen --no-sync python scripts/smoke_mcp.py

# Publication guard, also usable before a first commit.
uv run --frozen --no-sync python scripts/check_release.py
```

`bash scripts/check.sh` runs formatting validation, static checks, tests, build and
publication guard. Tests initialize and clean temporary databases; they must never
reuse a real user's data or credentials. `tests/api_contract.json` records the
original method/path contract across the router refactor.

## Browser tests

```bash
bash scripts/setup.sh --office
pnpm --dir frontend exec playwright install chromium
pnpm --dir frontend build
pnpm --dir frontend test:e2e
# A focused journey:
pnpm --dir frontend test:e2e e2e/workspace.spec.ts
```

Each Playwright journey starts its own backend on port 8766, uses synthetic
records and disables AI. Source files/SQLite/cache live in a new temporary
directory for each test, removed when its backend stops. Keep one worker because
journeys use the same reserved port. The immutable, hash-verified Office bundle may be shared from the
configured cache. Neither Google OAuth nor Codex login needs to be configured.
The complete suite includes real Writer loading, so install the optional runtime
first. Runtime installation needs network access unless using `--source-dir`.

Only the explicit `scripts/smoke_mcp.py --codex` mode performs a live Codex turn;
it is not part of CI. Live OAuth, Calendar notifications and physical Vietnamese
IME behavior need manual testing and must be reported separately from mock/CDP tests.

## Packages

```bash
uv build
```

The source distribution contains the app source, frontend build inputs, tests,
community files and docs. It excludes private/generated directories. The Python
wheel contains the backend, CLI, migrations, Office manifest and license notices.
It does not contain the built web frontend, Office binaries or model weights.

To use an installed backend wheel, build the frontend from the matching source
revision, set `PDM_WEB_DIST=/absolute/path/to/frontend/dist`, then run `pdm`.
Migrations are located relative to the installed package, so the wheel does not
require the source checkout's `alembic.ini`. Set `PDM_DATA_DIR` and
`PDM_CACHE_DIR` explicitly for a portable installation.

## Structure

- `backend/app.py`: app factory, lifecycle and router composition.
- `backend/routes/`: HTTP adapters grouped by feature; concrete routes precede
  generic entity routes.
- `backend/security.py`: host, Origin, session token and response headers.
- `backend/config.py`: shared environment/path handling without filesystem writes.
- `backend/domain.py`, `planner.py`, `google_sync.py`, `knowledge.py`: services.
- `frontend/src/main.tsx`: rendering entry and styles; `App.tsx`: application shell.
- `frontend/src/workspace/`: entity editor, linked text and priority components.
- `frontend/src/board/`, `documents/`, `connections/`: existing feature boundaries.

Read [ARCHITECTURE.md](ARCHITECTURE.md) before changing board save queues,
document drafts, provider identities, or domain revisions.
