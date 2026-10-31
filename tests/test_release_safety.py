"""Exercise the publication boundary, including bypasses of .gitignore."""

import importlib.util
import subprocess
from pathlib import Path

import pytest


@pytest.fixture
def checker():
    spec = importlib.util.spec_from_file_location(
        "release_check", Path(__file__).parents[1] / "scripts/check_release.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_ignored_credentials_are_excluded_but_force_tracked_secrets_fail(checker, tmp_path):
    subprocess.run(["git", "init", "-q", str(tmp_path)], check=True)
    (tmp_path / ".gitignore").write_text(".env\n.private/\n")
    (tmp_path / ".env").write_text("PRIVATE_DATA=fixture\n")
    (tmp_path / "main.py").write_text("print('public')\n")
    assert Path(".env") not in checker.candidate_files(tmp_path)
    subprocess.run(["git", "-C", str(tmp_path), "add", "--force", ".env"], check=True)
    assert Path(".env") in checker.candidate_files(tmp_path)
    assert checker.inspect_file(tmp_path, Path(".env"))


def test_secret_findings_never_print_values_and_examples_are_allowed(checker, tmp_path):
    secret = "GOCSPX-" + "x" * 30
    (tmp_path / "config.txt").write_text(secret)
    issues = checker.inspect_file(tmp_path, Path("config.txt"))
    assert issues == ["Google OAuth secret"]
    assert all(secret not in item for item in issues)
    (tmp_path / "google-client.example.json").write_text('{"installed":{"client_secret":"YOUR_VALUE"}}')
    assert checker.inspect_file(tmp_path, Path("google-client.example.json")) == []
    (tmp_path / "innocent.json").write_text('{"refresh_token":"fixture"}')
    assert "credential JSON" in checker.inspect_file(tmp_path, Path("innocent.json"))


def test_symlink_cannot_smuggle_an_external_file(checker, tmp_path):
    (tmp_path / "link.txt").symlink_to(tmp_path.parent / "outside.txt")
    assert checker.inspect_file(tmp_path, Path("link.txt")) == ["symlink must be reviewed before publication"]
