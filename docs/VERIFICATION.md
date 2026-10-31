# Verification: open-source preparation

Verified on **2026-11-01** (Asia/Ho_Chi_Minh), on Linux with Python 3.12.14,
uv 0.12.6, Node.js 22.23.2 and pnpm 11.24.0. These results describe local runs;
the new GitHub Actions workflow has not yet run on a published repository.

| Check | Result |
| --- | --- |
| Existing backend baseline before refactor | 133 passed |
| Final backend tests, core install without PyTorch | **143 passed** |
| Frontend unit tests | **7 passed** |
| Complete Chromium journeys with an independent backend/database per test | **71 passed**, 5.4 minutes |
| Python Ruff lint and formatting | Passed |
| Frontend Prettier and TypeScript/production build | Passed |
| MCP stdio smoke | Five tools discovered; context, cited search, excerpt and unapplied draft verified |
| Fresh installed backend wheel, outside the source tree | Migrations, Office manifest, session boundary, writes and restart persistence passed |
| Fresh source archive installation | Frozen Python/pnpm installs, 143 backend tests, frontend unit tests and build passed |
| Source development proxy using ports 8875/5181 | Bootstrap, authenticated task creation and workspace reads passed |
| Fresh Office runtime download into a temporary directory | All five pinned assets downloaded and SHA-256 verified |
| Public source guard | Passed for Git-visible files, including prospective first-commit files |
| Relative documentation links | No broken links found |

The core verification environment was approximately 188 MiB, compared with the
existing approximately 1.4 GiB environment including semantic-search dependencies.
These are local directory measurements, not guaranteed download/installation sizes.
The semantic extra is resolved in the lockfile; a fresh model download and live
semantic-quality evaluation were not performed in this refactor.

## Compatibility and regression coverage

The refactor moves 59 existing application endpoints into 10 feature routers;
the existing connections router remains separate. Their method/path contract is
recorded in `tests/api_contract.json`. Existing domain/calendar/document tests
continue to pass. Twenty service modules changed only in formatting, confirmed
by comparing parsed Python ASTs against the pre-refactor source backup.

Additional tests cover imports without creating data directories, invalid ports,
configured development Origins, malformed/disallowed Origins, core keyword
search without the semantic extra, and secrets force-added despite `.gitignore`.

The first full browser pass found a delayed chat-focus race and two calendar
checks affected by records left by preceding tests. Delayed focus now respects
the user's movement to another card; each browser journey owns a new backend and
temporary database. The affected 12 journeys passed in a focused run, followed by
the complete 71-test successful run.

Browser coverage includes planning/undo, canvas arrangement and persistence,
card tagging, mock account setup, calendar interaction, Markdown saves/conflicts,
PDF selection, spreadsheets, native Writer save/recovery, Vietnamese composition,
Unicode replacement and DPR/zoom behavior. Browser and backend workspaces are
synthetic; no live account sign-in or calendar writes were used.

## Distribution and privacy boundaries

The source distribution and backend wheel were inspected for private/generated
entries. The wheel contains migrations, the Office manifest and project notices;
it deliberately leaves the built frontend and optional runtime/model binaries
outside the wheel. The source archive includes frontend inputs, public synthetic
screenshots, tests, docs and community/CI files.

The original OAuth file and historical QA/screenshots are preserved locally under
the ignored `.private/` directory. Original source files also have a separate
local backup. Personal application databases, accounts and registered source
files were not modified by the test runs. No schema migration was introduced.
The Git repository is initialized on `main`; no commit, remote or push was created.

The publication guard is a limited filename/content-pattern check. It is not proof
that arbitrary future files contain no private information. Review the staged
diff and binary assets before publication, as described in [RELEASING.md](RELEASING.md).

## Limits

- Native Windows/macOS runtime behavior, real OAuth and phone notifications were
  not tested. CI currently targets Linux.
- Vietnamese composition tests use Chromium input APIs; they do not prove physical
  Windows UniKey behavior.
- The systemd installer was updated and its shell syntax checked; the user's live
  service was not installed, enabled or restarted during this work.
- The backend test client emits one upstream Starlette/httpx deprecation warning;
  tests pass without suppressing it.
- Optional Office download URLs include an upstream moving CDN URL. Fresh downloads
  matched the recorded pins during this run; later upstream changes intentionally
  fail integrity checks rather than silently changing executable assets.
