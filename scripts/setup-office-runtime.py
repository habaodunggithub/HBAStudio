#!/usr/bin/env python3
"""Install a hash-pinned LibreOffice WASM bundle, without executing downloads.

Run with the same PDM_CACHE_DIR/PDM_OFFICE_ASSETS as the app. --source-dir can
copy an already downloaded bundle (including the compressed .br files) offline.
All files are verified in a staging directory before the installed bundle changes.
The upstream CDN uses a moving URL; changed contents deliberately fail hash checks.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import tempfile
import urllib.request
import uuid
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from backend import config

PROJECT_ROOT = Path(__file__).resolve().parent.parent
MANIFEST_PATH = config.RESOURCES / "office-runtime.json"


def default_destination(bundle):
    return config.directory("PDM_OFFICE_ASSETS", config.CACHE / "office-runtime" / bundle["id"])


def copy_verified(stream, output, asset):
    digest = hashlib.sha256()
    count = 0
    with output.open("wb") as target:
        while chunk := stream.read(1024 * 1024):
            count += len(chunk)
            if count > asset["bytes"]:
                raise ValueError("Sai kích thước tài nguyên: " + asset["name"])
            digest.update(chunk)
            target.write(chunk)
        target.flush()
        os.fsync(target.fileno())
    if count != asset["bytes"] or digest.hexdigest() != asset["sha256"]:
        raise ValueError("SHA-256 không khớp: " + asset["name"] + ". Không thay đổi bản đang cài.")


def install(bundle, destination, source_dir=None):
    destination = destination.expanduser().resolve()
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        if not destination.is_dir():
            raise ValueError("Thư mục cài đặt không hợp lệ")
        if any(destination.iterdir()) and not (destination / "runtime.json").is_file():
            raise ValueError("Không ghi đè thư mục có dữ liệu ngoài bộ runtime được quản lý")
    with tempfile.TemporaryDirectory(prefix=".office-runtime-", dir=destination.parent) as temporary:
        staged = Path(temporary) / "bundle"
        staged.mkdir()
        for asset in bundle["assets"]:
            print("Kiểm tra " + asset["name"], flush=True)
            output = staged / asset["file"]
            if source_dir is not None:
                source = Path(source_dir) / asset["file"]
                if source.is_symlink() or not source.is_file():
                    raise ValueError("Thiếu tài nguyên nguồn: " + asset["file"])
                with source.open("rb") as stream:
                    copy_verified(stream, output, asset)
            else:
                # No user-supplied URLs or shell installers. Hash pins remain the
                # authority even if the vendor changes its latest CDN target.
                request = urllib.request.Request(asset["url"], headers={"User-Agent": "HBA-Studio-Office-Setup/1"})
                with urllib.request.urlopen(request, timeout=120) as stream:
                    copy_verified(stream, output, asset)
        (staged / "runtime.json").write_text(json.dumps(bundle, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        notice = "HBA Studio uses the unmodified upstream LibreOffice WebAssembly and ZetaJS runtimes.\n"
        for source in bundle["sources"]:
            notice += (
                "\n"
                + source["name"]
                + "\n"
                + source["license"]
                + "\nSource: "
                + source["source"]
                + "\nNotices: "
                + source["notice"]
                + "\n"
            )
            if source.get("license_text"):
                notice += "\n" + source["license_text"]
        (staged / "NOTICE.txt").write_text(notice, encoding="utf-8")
        backup = None
        if destination.exists():
            backup = destination.parent / (".office-runtime-previous-" + uuid.uuid4().hex)
            destination.rename(backup)
        try:
            staged.rename(destination)
        except OSError:
            if backup is not None:
                backup.rename(destination)
            raise
        if backup is not None:
            shutil.rmtree(backup)
    return destination


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source-dir", type=Path, help="Copy verified files from this directory instead of downloading"
    )
    parser.add_argument("--dest", type=Path, help="Override the runtime installation directory")
    parser.add_argument("--if-missing", action="store_true", help="Reuse an installed bundle after checking every hash")
    args = parser.parse_args()
    bundle = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    destination = args.dest or default_destination(bundle)
    if args.if_missing:
        try:

            def matches(asset):
                path = destination / asset["file"]
                if path.is_symlink() or path.stat().st_size != asset["bytes"]:
                    return False
                with path.open("rb") as file:
                    return hashlib.file_digest(file, "sha256").hexdigest() == asset["sha256"]

            if all(matches(asset) for asset in bundle["assets"]):
                print("LibreOffice Writer đã sẵn sàng")
                return
        except OSError:
            pass
    try:
        destination = install(bundle, destination, args.source_dir)
    except (OSError, ValueError) as error:
        parser.exit(1, "Không cài được LibreOffice: " + str(error) + "\n")
    print("Đã cài " + bundle["version"] + " tại " + str(destination))


if __name__ == "__main__":
    main()
