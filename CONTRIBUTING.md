# Contributing to HBA Studio

Contributions in English or Vietnamese are welcome. Start with a focused issue
for substantial behavior changes, then submit a small pull request explaining
the problem, the resulting behavior and how you verified it.

## Local setup

Use Python 3.12, uv, Node 22.18+ in the 22.x line and pnpm 11.24.0.

```bash
bash scripts/setup.sh
bash scripts/dev.sh
```

The [development guide](docs/DEVELOPMENT.md) covers direct uv commands, optional
runtime setup and test isolation. Accounts are not needed to contribute to core
planning, readers, boards or keyword search.

## Change boundaries

- Keep HTTP adapters in `backend/routes/`; business validation, revisions, proposals
  and undo belong to domain services. Preserve existing API method/path contracts.
- Use the shared transaction boundary for writes. Do not write to the real
  database from a script or bypass revision/conflict checks.
- Keep canvas positions independent of business revisions. Preserve queued edits,
  deletion markers, reader drafts and per-board isolation.
- Preserve user choice in AI flows. External MCP tools only create drafts; opening
  a board/reader must not trigger inference. Use mocked providers in tests.
- Google writes target the app's own calendar. Selected external calendars stay
  read-only. Do not weaken host, Origin, session-token or OAuth-state checks.
- New migrations must work for fresh and existing databases. Back up before schema
  changes; do not modify an applied migration to introduce a schema change.
- Do not bundle personal data, credentials, scraped course documents, generated
  runtime binaries or screenshots of an actual account.

## Before a pull request

```bash
# Python uses Ruff; frontend uses Prettier.
# Choose the same Python environment as the launchers, as described in DEVELOPMENT.md.
uv run --frozen ruff format backend scripts tests
pnpm --dir frontend format
bash scripts/check.sh
```

Run relevant Playwright journeys for UI/integration changes; use
`bash scripts/check.sh --e2e` for the full suite after installing Writer and
Chromium. Add regression coverage for a behavior change; documentation-only
changes do not need new tests. Include screenshots only from synthetic test data.

Commit the lockfile with dependency changes. Avoid unrelated dependency upgrades
or formatting changes in a bug fix. Commit messages should describe the resulting
change, for example `fix: retain reader edits when switching boards`.

Describe any unverified platform/provider behavior honestly. A successful build
alone does not establish a working user journey. CI should pass before merging.

## Reporting security issues

Use the repository's private vulnerability reporting flow described in
[SECURITY.md](SECURITY.md). Do not publish exploit details or login credentials in
public issues. All participation follows [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

Contributions to original project code are provided under [MIT](LICENSE). Preserve
existing third-party copyright and license notices when copying external code.
