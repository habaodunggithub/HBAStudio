"""Calendar HTTP endpoints."""

from datetime import datetime, timedelta

from fastapi import APIRouter

from .. import calendar_ops, domain, planner
from ..db import Session, transaction
from ..models import WorkspaceState
from ..schemas import SettingsInput
from ..worker import worker

router = APIRouter(tags=["calendar"])


@router.get("/api/v1/calendar")
def calendar(start: str, end: str, include_blocks: bool = False):
    a, z = planner.dt(start), planner.dt(end)
    if z <= a or z - a > timedelta(days=400):
        domain.fail("Khoảng lịch cần từ 1 đến 400 ngày")
    result = []
    with Session() as s:
        deadlines = domain.records(s, "deadlines")
        for kind in ("events", "blocks") if include_blocks else ("events",):
            for item in domain.records(s, kind):
                if kind == "blocks" and item.get("status") != "planned":
                    continue
                # One-day Google markers already represented by a linked deadline
                # appear once. Keep the original source record available in context.
                source_url = item.get("google_event_url")
                if item.get("readonly") and item.get("all_day") and not item.get("recurrence") and source_url:
                    date = planner.dt(item["start"]).astimezone(planner.ZONE).date()
                    one_day = planner.dt(item["end"]) - planner.dt(item["start"]) == timedelta(days=1)
                    if one_day and any(
                        source_url in d.get("description", "")
                        and planner.dt(d["due_at"]).astimezone(planner.ZONE).date() == date
                        for d in deadlines
                    ):
                        continue
                for x, y in planner.event_occurrences(item, a, z):
                    key = next(
                        (
                            key
                            for key, value in item.get("exceptions", {}).items()
                            if value and planner.dt(value["start"]) == x
                        ),
                        x.isoformat(),
                    )
                    all_day = item.get("all_day", False)
                    result.append(
                        {
                            **item,
                            "kind": kind,
                            "allDay": all_day,
                            "start": x.astimezone(planner.ZONE).date().isoformat() if all_day else x.isoformat(),
                            "end": y.astimezone(planner.ZONE).date().isoformat() if all_day else y.isoformat(),
                            "occurrence": x.isoformat(),
                            "occurrence_key": key,
                        }
                    )
        for d in deadlines:
            date = planner.dt(d["due_at"]).astimezone(planner.ZONE).date()
            x = datetime.combine(date, datetime.min.time(), planner.ZONE)
            y = x + timedelta(days=1)
            if planner.overlaps(x, y, a, z):
                result.append(
                    {
                        **d,
                        "kind": "deadlines",
                        "allDay": True,
                        "start": date.isoformat(),
                        "end": y.date().isoformat(),
                        "title": "⏳ " + d["title"],
                    }
                )
    return result


@router.post("/api/v1/calendar/{kind}/{ident}/move")
def move_calendar_item(kind: str, ident: str, payload: calendar_ops.MoveInput):
    result = calendar_ops.move(kind, ident, payload)
    worker.wake.set()
    return result


@router.patch("/api/v1/calendar/colors")
def calendar_colors(payload: dict):
    with transaction() as s:
        state = s.get(WorkspaceState, 1)
        colors = {**state.settings.get("calendar_colors", {}), **payload}
        state.settings = SettingsInput.model_validate({**state.settings, "calendar_colors": colors}).model_dump()
        state.revision += 1
    return {"ok": True}
