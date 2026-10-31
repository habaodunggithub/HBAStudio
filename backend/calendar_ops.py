"""Calendar gestures use the same validation, undo and sync queue as forms."""

from datetime import timedelta
from dateutil.rrule import rrulestr
from pydantic import BaseModel, ConfigDict
from . import domain, planner
from .db import transaction
from .models import ENTITIES


class MoveInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    start: str
    end: str
    all_day: bool
    occurrence_key: str | None = None
    expected_start: str
    expected_end: str


def move(kind, ident, payload):
    if kind not in ("events", "blocks", "deadlines"):
        domain.fail("Loại lịch không hỗ trợ", 404)
    try:
        a, z = planner.dt(payload.start), planner.dt(payload.end)
        old_a, old_z = planner.dt(payload.expected_start), planner.dt(payload.expected_end)
    except (ValueError, TypeError):
        domain.fail("Ngày giờ không hợp lệ")
    if z <= a:
        domain.fail("Giờ kết thúc phải sau giờ bắt đầu")
    if payload.all_day and any(value.astimezone(planner.ZONE).time().isoformat() != "00:00:00" for value in (a, z)):
        domain.fail("Sự kiện cả ngày cần bắt đầu và kết thúc ở đầu ngày")
    with transaction() as s:
        row = s.get(ENTITIES[kind], ident)
        if not row:
            domain.fail("Sự kiện không còn tồn tại", 404)
        item = row.data
        if item.get("readonly"):
            domain.fail("Lịch Google bên ngoài chỉ được đọc. Mở Google Calendar để chỉnh sửa.", 409)
        if kind == "deadlines":
            due = planner.dt(item["due_at"]).astimezone(planner.ZONE)
            current_a = due.replace(hour=0, minute=0, second=0, microsecond=0)
            current_z = current_a + timedelta(days=1)
            if not payload.all_day or z - a != timedelta(days=1):
                domain.fail("Deadline là mốc cả ngày; chỉ kéo sang ngày khác")
            date = a.astimezone(planner.ZONE).date()
            patch = {"due_at": due.replace(year=date.year, month=date.month, day=date.day).isoformat()}
        else:
            current_a, current_z = planner.dt(item["start"]), planner.dt(item["end"])
            if kind == "blocks":
                if payload.all_day or item["status"] != "planned":
                    domain.fail("Chỉ đổi giờ buổi làm đang lên kế hoạch")
                patch = {"start": a.isoformat(), "end": z.isoformat(), "locked": True}
            elif item.get("recurrence"):
                if payload.all_day != item.get("all_day", False) or not payload.occurrence_key:
                    domain.fail("Buổi lặp cần giữ loại cả ngày/có giờ và định danh buổi gốc")
                try:
                    point = planner.dt(payload.occurrence_key)
                    rule = rrulestr("\n".join(item["recurrence"]), dtstart=current_a, forceset=True)
                    if rule.before(point, inc=True) != point:
                        domain.fail("Buổi gốc không thuộc chuỗi lịch này")
                except (ValueError, TypeError):
                    domain.fail("Buổi lặp không hợp lệ")
                key = point.isoformat()
                replacement = item.get("exceptions", {}).get(key, "default")
                if replacement is None:
                    domain.fail("Buổi lịch này đã bị hủy", 409)
                current_a, current_z = (
                    (point, point + (current_z - current_a))
                    if replacement == "default"
                    else (planner.dt(replacement["start"]), planner.dt(replacement["end"]))
                )
                patch = {
                    "exceptions": {**item.get("exceptions", {}), key: {"start": a.isoformat(), "end": z.isoformat()}}
                }
            else:
                patch = {"start": a.isoformat(), "end": z.isoformat(), "all_day": payload.all_day}
        if current_a != old_a or current_z != old_z:
            domain.fail("Sự kiện vừa thay đổi. Hãy tải lại lịch rồi thử lại.", 409)
        return domain.commit_ops(s, [{"kind": kind, "action": "update", "id": ident, "data": patch}])
