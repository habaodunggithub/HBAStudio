from datetime import datetime, date, time
from typing import Literal
from zoneinfo import ZoneInfo
from pydantic import BaseModel, ConfigDict, Field, model_validator, field_validator
from .config import TZ


def stamp(value: str) -> str:
    if len(value) == 10:
        value = datetime.combine(date.fromisoformat(value), time(23, 59), ZoneInfo(TZ)).isoformat()
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if not dt.tzinfo:
        dt = dt.replace(tzinfo=ZoneInfo(TZ))
    return dt.isoformat()


class Common(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=500)
    description: str = Field(default="", max_length=100000)

    @field_validator("title")
    @classmethod
    def clean_title(cls, v):
        if not v.strip():
            raise ValueError("Tên không được để trống")
        return v.strip()


class CourseInput(Common):
    color: str = "#476953"
    semester: str = ""


class WorkInput(Common):
    checklist: list[dict] = Field(default_factory=list, max_length=200)

    @field_validator("checklist")
    @classmethod
    def checklist_items(cls, items):
        for item in items:
            if (
                set(item) - {"text", "done"}
                or not isinstance(item.get("text"), str)
                or not item["text"].strip()
                or not isinstance(item.get("done", False), bool)
            ):
                raise ValueError("Mục checklist cần text và done")
        return [{"text": i["text"].strip(), "done": i.get("done", False)} for i in items]


class ProjectInput(WorkInput):
    course_id: str | None = None
    status: Literal["active", "done", "archived"] = "active"


class DeadlineInput(WorkInput):
    project_id: str | None = None
    course_id: str | None = None
    due_at: str
    done: bool = False
    color: str | None = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")

    @field_validator("due_at")
    @classmethod
    def due(cls, v):
        return stamp(v)


class TaskInput(WorkInput):
    project_id: str | None = None
    course_id: str | None = None
    deadline_id: str | None = None
    parent_id: str | None = None
    status: Literal["todo", "doing", "done", "cancelled"] = "todo"
    priority: int = Field(default=2, ge=1, le=4)
    estimate_minutes: int | None = Field(default=None, gt=0, le=100000)
    estimate_source: Literal["user", "codex"] = "user"
    due_at: str | None = None
    depends_on: list[str] = Field(default_factory=list, max_length=100)
    checklist: list[dict] = Field(default_factory=list, max_length=200)
    completed_at: str | None = None
    created_at: str | None = None

    @field_validator("due_at")
    @classmethod
    def due(cls, v):
        return stamp(v) if v else None

    @field_validator("checklist")
    @classmethod
    def checklist_items(cls, items):
        for item in items:
            if (
                set(item) - {"text", "done"}
                or not isinstance(item.get("text"), str)
                or not item["text"].strip()
                or not isinstance(item.get("done", False), bool)
            ):
                raise ValueError("Mục checklist cần text và done")
        return [{"text": i["text"].strip(), "done": i.get("done", False)} for i in items]


class EventInput(Common):
    start: str
    end: str
    recurrence: list[str] = Field(default_factory=list)
    exceptions: dict[str, dict | None] = Field(default_factory=dict)
    busy: bool = True
    origin: Literal["local", "google"] = "local"
    readonly: bool = False
    google_calendar_id: str | None = None
    google_event_id: str | None = None
    google_event_url: str | None = None
    all_day: bool = False
    color: str | None = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")

    @model_validator(mode="before")
    @classmethod
    def date_only(cls, data):
        if isinstance(data, dict) and isinstance(data.get("start"), str) and len(data["start"]) == 10:
            data = {**data, "all_day": True}
        return data

    @field_validator("start", "end")
    @classmethod
    def ts(cls, v):
        return stamp(v + "T00:00:00+07:00" if len(v) == 10 else v)

    @model_validator(mode="after")
    def order(self):
        if datetime.fromisoformat(self.end) <= datetime.fromisoformat(self.start):
            raise ValueError("Giờ kết thúc phải sau giờ bắt đầu")
        if self.recurrence:
            from dateutil.rrule import rrulestr

            rrulestr("\n".join(self.recurrence), dtstart=datetime.fromisoformat(self.start), forceset=True)
            if any("FREQ=SECONDLY" in r or "FREQ=MINUTELY" in r for r in self.recurrence):
                raise ValueError("Lịch lặp chỉ hỗ trợ tần suất theo giờ trở lên")
        for key, value in self.exceptions.items():
            stamp(key)
            if value is not None:
                if set(value) != {"start", "end"} or datetime.fromisoformat(
                    stamp(value["end"])
                ) <= datetime.fromisoformat(stamp(value["start"])):
                    raise ValueError("Ngoại lệ lịch lặp không hợp lệ")
        return self


class BlockInput(EventInput):
    task_id: str
    locked: bool = False
    status: Literal["planned", "done", "missed"] = "planned"


class SessionInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    task_id: str
    minutes: int = Field(gt=0, le=1440)
    recorded_at: str | None = None
    note: str = ""


class NoteInput(Common):
    course_id: str | None = None
    project_id: str | None = None


class SourceInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1)
    path: str
    enabled: bool = True
    status: str = "pending"
    error: str | None = None
    last_scan: str | None = None


SCHEMAS = {
    "courses": CourseInput,
    "projects": ProjectInput,
    "deadlines": DeadlineInput,
    "tasks": TaskInput,
    "events": EventInput,
    "blocks": BlockInput,
    "sessions": SessionInput,
    "notes": NoteInput,
    "sources": SourceInput,
}


class SettingsInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    timezone: Literal["Asia/Ho_Chi_Minh"] = TZ
    availability: list[dict] = Field(default_factory=list, max_length=50)
    daily_limit_minutes: int = Field(default=240, ge=15, le=1440)
    block_minutes: int = Field(default=45, ge=15, le=180)
    break_minutes: int = Field(default=15, ge=0, le=120)
    horizon_days: int = Field(default=14, ge=1, le=90)
    block_reminder_minutes: int = Field(default=15, ge=0, le=40320)
    deadline_reminders: list[int] = [1440, 120]
    semantic_enabled: bool = True
    calendar_colors: dict[str, str] = Field(default_factory=dict, max_length=300)

    @field_validator("calendar_colors")
    @classmethod
    def colors(cls, values):
        import re

        if any(len(k) > 600 or not re.fullmatch(r"#[0-9a-fA-F]{6}", v) for k, v in values.items()):
            raise ValueError("Màu lịch cần có dạng #RRGGBB")
        return values

    @model_validator(mode="after")
    def windows(self):
        for w in self.availability:
            if set(w) != {"weekday", "start", "end"} or not 0 <= w["weekday"] <= 6:
                raise ValueError("Khung giờ cần weekday (0=thứ Hai), start và end")
            if time.fromisoformat(w["start"]) >= time.fromisoformat(w["end"]):
                raise ValueError("Khung giờ phải kết thúc trong cùng ngày, sau giờ bắt đầu")
        if any(not isinstance(v, int) or not 0 <= v <= 40320 for v in self.deadline_reminders):
            raise ValueError("Nhắc việc phải trong khoảng 0–40320 phút")
        return self
