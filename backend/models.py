"""Typed entity tables. Payloads are validated by the shared domain schema layer."""

from sqlalchemy import Integer, String, JSON, Text, LargeBinary, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class EntityMixin:
    id: Mapped[str] = mapped_column(String, primary_key=True)
    data: Mapped[dict] = mapped_column(JSON, default=dict)


class Course(EntityMixin, Base):
    __tablename__ = "courses"


class Project(EntityMixin, Base):
    __tablename__ = "projects"


class Deadline(EntityMixin, Base):
    __tablename__ = "deadlines"


class Task(EntityMixin, Base):
    __tablename__ = "tasks"


class CalendarEvent(EntityMixin, Base):
    __tablename__ = "calendar_events"


class TimeBlock(EntityMixin, Base):
    __tablename__ = "time_blocks"


class WorkSession(EntityMixin, Base):
    __tablename__ = "work_sessions"


class Note(EntityMixin, Base):
    __tablename__ = "notes"


class KnowledgeSource(EntityMixin, Base):
    __tablename__ = "knowledge_sources"


class TaskDependency(Base):
    __tablename__ = "task_dependencies"
    task_id: Mapped[str] = mapped_column(String, primary_key=True)
    depends_on_id: Mapped[str] = mapped_column(String, primary_key=True)


class WorkspaceState(Base):
    __tablename__ = "workspace_state"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    revision: Mapped[int] = mapped_column(Integer, default=0)
    settings: Mapped[dict] = mapped_column(JSON, default=dict)


class ChangeProposal(EntityMixin, Base):
    __tablename__ = "change_proposals"


class PlanRevision(EntityMixin, Base):
    __tablename__ = "plan_revisions"


class Document(EntityMixin, Base):
    __tablename__ = "documents"


class DocumentChunk(Base):
    __tablename__ = "document_chunks"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    document_id: Mapped[str] = mapped_column(String, index=True)
    text: Mapped[str] = mapped_column(Text)
    location: Mapped[str] = mapped_column(String)
    embedding: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    model: Mapped[str | None] = mapped_column(String, nullable=True)


class CalendarConnection(EntityMixin, Base):
    __tablename__ = "calendar_connections"


class SyncMapping(EntityMixin, Base):
    __tablename__ = "sync_mappings"


class OutboxJob(EntityMixin, Base):
    __tablename__ = "outbox_jobs"


class ChatThread(EntityMixin, Base):
    __tablename__ = "chat_threads"


class CanvasBoard(EntityMixin, Base):
    __tablename__ = "canvas_boards"


ENTITIES = {
    "courses": Course,
    "projects": Project,
    "deadlines": Deadline,
    "tasks": Task,
    "events": CalendarEvent,
    "blocks": TimeBlock,
    "sessions": WorkSession,
    "notes": Note,
    "sources": KnowledgeSource,
}
BUSINESS = [k for k in ENTITIES if k != "sources"]
