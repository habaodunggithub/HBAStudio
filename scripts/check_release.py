#!/usr/bin/env python3
"""Check files Git would publish, including accidentally tracked ignored files.

Diagnostics contain filenames and rule names, never matching secret values. This
is a conservative guard for common leaks, not a replacement for reviewing a diff.
"""

import argparse
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
MAX_BYTES = 10 * 1024 * 1024
SECRET_PATTERNS = {
    "private key": re.compile(rb"-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----"),
    "Google OAuth secret": re.compile(rb"GOCSPX-[A-Za-z0-9_-]{20,}"),
    "Google API key": re.compile(rb"AIza[A-Za-z0-9_-]{30,}"),
    "GitHub token": re.compile(rb"(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})"),
    "OpenAI key": re.compile(rb"sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{40,}"),
    "AWS access key": re.compile(rb"AKIA[A-Z0-9]{16}"),
}
PRIVATE_NAMES = {"local-token", "google-client.json", "google-token.json", "auth.json", "codex-connection.json"}
PRIVATE_PARTS = {".private", ".codex", ".venv", "node_modules", "__pycache__", "test-results", "playwright-report"}


def candidate_files(root: Path) -> list[Path]:
    result = subprocess.run(
        ["git", "-C", str(root), "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
        check=True,
        capture_output=True,
    )
    return sorted({Path(name.decode("utf-8")) for name in result.stdout.split(b"\0") if name})


def inspect_file(root: Path, relative: Path) -> list[str]:
    issues = []
    path = root / relative
    if path.is_symlink():
        return ["symlink must be reviewed before publication"]
    if not path.is_file():
        return ["tracked file is missing or is not a regular file"]
    name = relative.name
    if (
        PRIVATE_PARTS.intersection(relative.parts)
        or name in PRIVATE_NAMES
        or name.startswith("client_secret")
        or (name.startswith(".env") and name != ".env.example")
        or path.suffix.lower() in {".db", ".sqlite", ".sqlite3", ".pem", ".key", ".zip"}
    ):
        issues.append("private/generated file is included in Git's publication set")
    if path.stat().st_size > MAX_BYTES:
        return issues + ["file exceeds the 10 MiB source-file limit"]
    raw = path.read_bytes()
    for label, pattern in SECRET_PATTERNS.items():
        if pattern.search(raw):
            issues.append(label)
    if path.suffix == ".json" and not name.endswith(".example.json"):
        try:
            value = json.loads(raw)
        except (ValueError, UnicodeDecodeError):
            value = None
        if isinstance(value, dict) and (
            any(key in value for key in ("refresh_token", "private_key", "access_token"))
            or any(isinstance(value.get(key), dict) and value[key].get("client_secret") for key in ("installed", "web"))
        ):
            issues.append("credential JSON")
    return issues


def audit(root: Path) -> tuple[list[Path], list[str]]:
    files = candidate_files(root)
    findings = [f"{path.as_posix()}: {issue}" for path in files for issue in inspect_file(root, path)]
    for name in ("LICENSE", "README.md", "CONTRIBUTING.md", "SECURITY.md", ".gitignore", ".env.example"):
        if Path(name) not in files:
            findings.append(f"{name}: required project file is missing from Git's publication set")
    return files, findings


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    args = parser.parse_args()
    try:
        files, findings = audit(args.root.resolve())
    except subprocess.CalledProcessError:
        parser.exit(2, "Run inside a Git repository (git init -b main for a new checkout).\n")
    if findings:
        print("Release check failed:\n" + "\n".join(findings), file=sys.stderr)
        raise SystemExit(1)
    print(f"Release check passed: {len(files)} Git-visible source files; no common secret patterns found.")


if __name__ == "__main__":
    main()
