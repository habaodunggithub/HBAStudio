import logging
import threading
import time
from sqlalchemy import select
from .db import Session, transaction
from .models import OutboxJob
from .domain import now

log = logging.getLogger(__name__)


class Worker:
    def __init__(self):
        self.stop = threading.Event()
        self.wake = threading.Event()
        self.thread = None
        self.last_periodic = 0
        self.last_backup = 0

    def start(self):
        if self.thread and self.thread.is_alive():
            return
        self.stop.clear()
        self.wake.clear()
        self.thread = threading.Thread(target=self.run, name="pdm-worker", daemon=True)
        self.thread.start()

    def close(self):
        self.stop.set()
        self.wake.set()
        if self.thread:
            self.thread.join(timeout=2)

    def run(self):
        from . import knowledge, sync_policy, backups

        while not self.stop.is_set():
            try:
                with Session() as s:
                    jobs = [
                        (j.id, j.data.copy())
                        for j in s.scalars(select(OutboxJob))
                        if j.data.get("status") == "pending" and j.id != "google-sync"
                    ]
                for ident, job in jobs:
                    try:
                        if job["kind"] == "ingest":
                            knowledge.ingest(
                                job["path"],
                                course_id=job.get("course_id"),
                                project_id=job.get("project_id"),
                                doc_id=job["document_id"],
                            )
                        elif job["kind"] == "model":
                            knowledge.embed(["khởi tạo"], download=True)
                        with transaction() as s:
                            s.get(OutboxJob, ident).data = {**job, "status": "done", "finished_at": now()}
                    except Exception as exc:
                        with transaction() as s:
                            s.get(OutboxJob, ident).data = {**job, "status": "error", "error": str(exc)[:1000]}
                periodic = time.monotonic() - self.last_periodic >= 60
                if periodic:
                    knowledge.scan_sources()
                    self.last_periodic = time.monotonic()
                knowledge.index_embeddings()
                sync_policy.tick()
                if time.monotonic() - self.last_backup >= 86400:
                    backups.backup()
                    self.last_backup = time.monotonic()
            except Exception:
                log.exception("Worker task failed")
            self.wake.wait(5)
            self.wake.clear()


worker = Worker()
