# Preparing a public source release

## Verify the source

Use a clean checkout and the locked toolchain. Follow [DEVELOPMENT.md](DEVELOPMENT.md)
to select the Python environment, then run:

```bash
bash scripts/setup.sh --office
pnpm --dir frontend exec playwright install chromium
bash scripts/check.sh --e2e
uv run --frozen --no-sync python scripts/smoke_mcp.py
uv build
uv run --frozen --no-sync python scripts/check_release.py
```

The publication check inspects tracked and untracked, non-ignored files. It also
includes ignored files already in the index, so `git add --force` cannot bypass it.
It rejects common credentials, private/generated paths, symlinks and source files
over 10 MiB. Review the staged diff and new binary assets manually; a regex check
cannot certify that every possible secret or personal screenshot is absent.

For an existing private development directory, preserve credentials, private QA,
screenshots and source documents outside Git (the ignored `.private/` directory
can hold local history). Copy only synthetic, reviewed screenshots into public
docs. Do not zip the whole working directory to publish it.

## First GitHub publication

The local repository may be initialized without a remote or commit. Create an
empty GitHub repository yourself, then run these commands with its real URL:

```bash
git status --short --ignored
git add .
git diff --cached --stat
# Inspect the actual staged content too.
git diff --cached
uv run --frozen --no-sync python scripts/check_release.py
git commit -m "chore: prepare HBA Studio open-source release"
git remote add origin <YOUR_GITHUB_REPOSITORY_URL>
git push -u origin main
```

The URL above is a placeholder. Repository creation, public visibility, pushing
and releases are explicit publishing steps; the refactor itself does not perform
them. `.gitignore` prevents normal adds of `.env`, credentials, local data,
dependencies, build outputs and `.private/`. If Git reports an already tracked
sensitive file, remove it from the index and investigate its history before publishing.

After publishing, enable private vulnerability reporting and review the CI result.
Configure branch protection for `main` if desired. No hosted production server or
cloud credentials are required by CI.

## Versioned releases

Update `backend/__init__.py`, `pyproject.toml` and `frontend/package.json` together,
regenerate affected lockfiles, and add a concise entry to `CHANGELOG.md`. Run the
checks above on the intended revision before creating a tag/release.

Use `git archive` for a source archive after committing. Do not include `.env`,
databases, backups, credentials, Office runtime binaries or model caches. A source
archive and a Python backend wheel are different artifacts; see the package
boundaries in [DEVELOPMENT.md](DEVELOPMENT.md).

If distributing compiled web assets or optional runtime/model binaries, retain
third-party notices and the relevant upstream licensing/source obligations from
[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).
