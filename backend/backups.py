import argparse
import json
import sqlite3
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from . import config
from .db import write_lock


def backup():
    config.prepare()
    name = datetime.now(timezone.utc).strftime("workspace-%Y%m%d-%H%M%S-%f.zip")
    destination = config.DATA / "backups" / name
    with write_lock, tempfile.TemporaryDirectory() as temporary:
        database = Path(temporary) / "workspace.db"
        with sqlite3.connect(config.DATA / "workspace.db") as source, sqlite3.connect(database) as target:
            source.backup(target)
        with zipfile.ZipFile(destination, "w", zipfile.ZIP_DEFLATED) as archive:
            archive.write(database, "workspace.db")
            archive.writestr(
                "manifest.json",
                json.dumps(
                    {
                        "version": 1,
                        "created_at": datetime.now(timezone.utc).isoformat(),
                        "watched_files_included": False,
                        "secrets_included": False,
                    }
                ),
            )
            for file in (config.DATA / "uploads").iterdir():
                if file.is_file() and not file.is_symlink():
                    archive.write(file, "uploads/" + file.name)
    destination.chmod(0o600)
    for old in sorted((config.DATA / "backups").glob("workspace-*.zip"), reverse=True)[7:]:
        old.unlink()
    return name


def restore(archive_path, destination):
    destination = Path(destination).expanduser().resolve()
    if destination.exists() and any(destination.iterdir()):
        raise ValueError("Thư mục phục hồi phải trống; không ghi đè dữ liệu đang dùng")
    with tempfile.TemporaryDirectory() as tmp:
        staging = Path(tmp)
        with zipfile.ZipFile(archive_path) as archive:
            allowed = []
            for info in archive.infolist():
                path = Path(info.filename)
                if path.is_absolute() or ".." in path.parts or ((info.external_attr >> 16) & 0o170000) == 0o120000:
                    raise ValueError("Archive chứa đường dẫn không an toàn")
                if (
                    info.filename in ("workspace.db", "manifest.json")
                    or len(path.parts) == 2
                    and path.parts[0] == "uploads"
                ):
                    allowed.append(info)
                else:
                    raise ValueError("Archive chứa file không hỗ trợ")
            if sum(i.file_size for i in allowed) > 5 * 1024**3:
                raise ValueError("Archive quá lớn")
            archive.extractall(staging, members=allowed)
        with sqlite3.connect(staging / "workspace.db") as conn:
            if conn.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise ValueError("Database không toàn vẹn")
            if not conn.execute("SELECT version_num FROM alembic_version").fetchone():
                raise ValueError("Không tìm thấy schema")
        destination.mkdir(parents=True, exist_ok=True, mode=0o700)
        import shutil

        shutil.copy2(staging / "workspace.db", destination / "workspace.db")
        shutil.copytree(staging / "uploads", destination / "uploads", dirs_exist_ok=True) if (
            staging / "uploads"
        ).exists() else (destination / "uploads").mkdir()
        # Rebase uploaded paths. Watch folders and Google credentials are not restored implicitly.
        with sqlite3.connect(destination / "workspace.db") as conn:
            for ident, payload in conn.execute("SELECT id,data FROM documents").fetchall():
                d = json.loads(payload)
                if not d.get("source_id"):
                    d["path"] = str(destination / "uploads" / Path(d["path"]).name)
                    conn.execute("UPDATE documents SET data=? WHERE id=?", (json.dumps(d), ident))
            conn.execute("DELETE FROM calendar_connections")
            conn.execute("DELETE FROM sync_mappings")
            conn.execute("DELETE FROM outbox_jobs")
            conn.execute("DELETE FROM calendar_events WHERE json_extract(data, '$.readonly') = 1")
            conn.commit()
    return str(destination)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["create", "restore"])
    parser.add_argument("archive", nargs="?")
    parser.add_argument("--destination")
    args = parser.parse_args()
    if args.action == "create":
        print(backup())
    elif args.archive and args.destination:
        print(restore(args.archive, args.destination))
    else:
        parser.error("restore cần archive và --destination")
