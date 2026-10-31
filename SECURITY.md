# Security and privacy

## Deployment boundary

HBA Studio is a single-user app served at `127.0.0.1`. It is intended for a trusted
local machine. The API checks the host, browser Origin and local session token;
login state is stored privately in the user data directory. Run only one backend
per data directory. This design does not provide authentication or tenant
isolation for an Internet-facing service.

## Data and network use

- SQLite, uploads, document indexes, chat history and backups stay in the user data
  directory. A backup contains personal data; login credentials are excluded.
- Keyword search runs locally. Semantic search is optional; installing it downloads
  Python dependencies, and choosing model download retrieves model files.
- The optional Writer installer downloads pinned runtime files and verifies hashes.
  Document editing then runs locally. A hash mismatch fails without replacing the
  installed bundle. Runtime downloads are separate from normal app startup.
- Connecting/using Codex sends relevant prompts, context, images or document
  excerpts to the provider using the selected account. Disabling AI or skipping
  login keeps core planning available.
- Google receives the events selected for sync. Writes are limited to the app's
  dedicated calendar; selected external calendars are read-only.
- Watched folders are user-selected and read-only. Links are saved as sources;
  the app does not automatically fetch arbitrary web pages.

Never commit `.env`, OAuth JSON, tokens, databases, backups, private screenshots
or provider logs. `.gitignore` excludes common locations; `scripts/check_release.py`
also checks Git-visible files, including ignored files accidentally force-added.
Its output lists rule names and filenames without printing matched secrets.
It is a limited pattern check: manually review new assets and the staged diff too.

## Supported versions and disclosure

Security fixes currently target the latest code on `main`. There are no maintained
older release branches or guaranteed response times.

After the repository is published, enable **Settings → Security → Private
vulnerability reporting**. Report suspected vulnerabilities through
**Security → Advisories → Report a vulnerability**. If that option is unavailable,
contact a maintainer using the contact methods on their GitHub profile and request
a private channel. Do not put credentials, personal records or working exploit
details in a public issue.

Include the affected revision, setup, minimal reproduction and impact using
synthetic data. If credentials have already been published, revoke/rotate them at
the provider; removing a file alone does not remove its copies or Git history.
