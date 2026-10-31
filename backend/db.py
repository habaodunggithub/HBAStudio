import threading
from contextlib import contextmanager
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from . import config
from .models import Base, WorkspaceState

engine = create_engine(
    f"sqlite:///{config.DATA / 'workspace.db'}", connect_args={"check_same_thread": False, "timeout": 30}
)
Session = sessionmaker(engine, expire_on_commit=False)
write_lock = threading.RLock()


@event.listens_for(engine, "connect")
def pragmas(conn, _):
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA busy_timeout=30000")


DEFAULT_SETTINGS = {
    "timezone": config.TZ,
    "availability": [],
    "daily_limit_minutes": 240,
    "block_minutes": 45,
    "break_minutes": 15,
    "horizon_days": 14,
    "block_reminder_minutes": 15,
    "deadline_reminders": [1440, 120],
    "semantic_enabled": True,
}


def initialize():
    from alembic import command
    from alembic.config import Config

    config.prepare()
    cfg = Config()
    cfg.set_main_option("script_location", str(config.PACKAGE / "migrations"))
    database = config.DATA / "workspace.db"
    if database.exists() and database.stat().st_size:
        import sqlite3
        from alembic.script import ScriptDirectory

        with sqlite3.connect(database) as conn:
            exists = conn.execute("SELECT name FROM sqlite_master WHERE name='alembic_version'").fetchone()
            current = conn.execute("SELECT version_num FROM alembic_version").fetchone() if exists else None
        if current and current[0] != ScriptDirectory.from_config(cfg).get_current_head():
            from .backups import backup

            backup()
    command.upgrade(cfg, "head")
    with transaction() as s:
        if s.get(WorkspaceState, 1) is None:
            s.add(WorkspaceState(id=1, revision=0, settings=DEFAULT_SETTINGS.copy()))


@contextmanager
def transaction():
    with write_lock, Session() as s:
        try:
            # All writers, including other processes, acquire the SQLite reservation first.
            s.connection().exec_driver_sql("BEGIN IMMEDIATE")
            yield s
            s.commit()
        except BaseException:
            s.rollback()
            raise
