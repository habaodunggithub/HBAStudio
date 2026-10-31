# Configuration

The API, CLI and MCP read the checkout's `.env` with `python-dotenv`.
An explicitly set environment variable wins, including an empty value. Vite reads
the same root file for development ports. Do not put shell commands in `.env`.
Paths support `~`; relative paths resolve from the repository root, independent of
the launch directory. Empty path values select defaults.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PDM_PORT` | `8765` | Local backend port, 1–65535; also used by MCP and the Google OAuth callback. |
| `PDM_DEV_PORT` | `5173` | Vite development port and allowed development Origin. Vite fails if occupied. |
| `PDM_DATA_DIR` | OS user data directory + `personal-deadline-management` | SQLite, uploads, backups and private account state. |
| `PDM_CACHE_DIR` | OS user cache directory + `personal-deadline-management` | Models and optional Office runtime. |
| `PDM_WEB_DIST` | `frontend/dist` in a source checkout | Built frontend to serve. Set an absolute path when running an installed backend wheel. |
| `PDM_AGENT_ENABLED` | Enabled unless `0` | Disable Codex chat, analysis and image reading with `0`. |
| `PDM_GOOGLE_CLIENT_FILE` | `resources/google-client.json` | Your Desktop OAuth configuration. A user-uploaded config in the data directory takes precedence. |
| `PDM_OFFICE_ASSETS` | `<cache>/office-runtime/<manifest id>` | Verified, optional Writer runtime; shared by installer, API and browser-test launcher. |
| `PDM_VENV` | Shell-launcher environment | Override the Python environment selected by Bash scripts. Export this variable; it is not loaded from `.env` by Bash. |
| `UV_PROJECT_ENVIRONMENT` | `.venv` for direct uv commands | Explicit uv environment; also honored by Bash scripts unless `PDM_VENV` is set. |
| `PDM_NO_WORKER` | Worker enabled unless `1` | Disable background jobs for isolated backend tests. Source ingestion needs the worker. |

On Linux the data/cache defaults follow `XDG_DATA_HOME`/`XDG_CACHE_HOME`, falling
back to `~/.local/share` and `~/.cache`. Platform paths are resolved by
`platformdirs`; Linux defaults remain compatible with previous installations.

Bash launchers default their Python environment to
`${XDG_CACHE_HOME:-$HOME/.cache}/personal-deadline-management/venv`, preserving the
existing setup and keeping dependencies off mounted source drives. Direct `uv`
commands use `.venv` unless you export `UV_PROJECT_ENVIRONMENT`. Choose one setup
and use it consistently. Installing `--extra semantic` into one environment does
not install it into the other.

Scheduling currently uses Vietnamese locale and `Asia/Ho_Chi_Minh` throughout the
schema and UI. There is no configurable scheduling timezone yet.

`PDM_TESTING=1` allows the test client's `testserver` hostname. It is reserved for
tests; do not set it in a running user instance. Browser tests force port 8766,
a temporary data/cache directory, disabled AI and a missing OAuth config path.

## Example: another backend and development port

```dotenv
PDM_PORT=8875
PDM_DEV_PORT=5181
PDM_DATA_DIR=~/Documents/hba-workspace
PDM_AGENT_ENABLED=0
```

Restart both the API and Vite after changing config. Do not start a second backend
using the same database. MCP must use the same `PDM_DATA_DIR` and `PDM_PORT` as the
backend. The systemd user service loads the root `.env` through the same CLI.
