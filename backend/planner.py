"""Deterministic, dependency-aware earliest-free-slot planner. No model calls."""

from datetime import datetime, timedelta, time, timezone
from zoneinfo import ZoneInfo
from dateutil.rrule import rrulestr
from .config import TZ

ZONE = ZoneInfo(TZ)


def dt(value):
    d = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return d if d.tzinfo else d.replace(tzinfo=ZONE)


def overlaps(a, b, c, d):
    return a < d and c < b


def event_occurrences(event, start, end):
    a, b = dt(event["start"]), dt(event["end"])
    duration = b - a
    rules = event.get("recurrence", [])
    if not rules:
        return [(a, b)] if overlaps(a, b, start, end) else []
    rule = rrulestr("\n".join(rules), dtstart=a, forceset=True)
    points = []
    for point in rule.xafter(start - duration, inc=True):
        if point > end:
            break
        points.append(point)
        if len(points) > 10000:
            raise ValueError("Lịch lặp quá dày")
    out = []
    exceptions = event.get("exceptions", {})
    for point in points:
        replacement = exceptions.get(point.isoformat(), "default")
        if replacement is None:
            continue
        x, y = (
            (point, point + duration)
            if replacement == "default"
            else (dt(replacement["start"]), dt(replacement["end"]))
        )
        if overlaps(x, y, start, end):
            out.append((x, y))
    # Moved exceptions may originate outside the query interval.
    for key, replacement in exceptions.items():
        if replacement and dt(key) not in points:
            x, y = dt(replacement["start"]), dt(replacement["end"])
            if overlaps(x, y, start, end):
                out.append((x, y))
    return out


def plan(data, start=None, days=None, excluded_dates=None):
    cfg = data["settings"]
    start = (dt(start) if start else datetime.now(timezone.utc)).astimezone(ZONE)
    stop = start + timedelta(days=days or cfg["horizon_days"])
    excluded = set(excluded_dates or [])
    tasks = {t["id"]: t for t in data["tasks"]}
    deadlines = {d["id"]: d for d in data["deadlines"]}
    children = {i: [t["id"] for t in tasks.values() if t.get("parent_id") == i] for i in tasks}
    active = {i: t for i, t in tasks.items() if not children[i] and t["status"] not in ("done", "cancelled")}
    parents = {}

    def leaf_ids(ident):
        return [ident] if not children[ident] else [leaf for ch in children[ident] for leaf in leaf_ids(ch)]

    def parent_chain(ident):
        out = [ident]
        while tasks[out[-1]].get("parent_id"):
            out.append(tasks[out[-1]]["parent_id"])
        return out

    deps = {}
    dues = {}
    for ident in active:
        chain = parent_chain(ident)
        deps[ident] = set(leaf for p in chain for dep in tasks[p].get("depends_on", []) for leaf in leaf_ids(dep)) - {
            ident
        }
        candidates = []
        for p in chain:
            t = tasks[p]
            if t.get("due_at"):
                candidates.append(dt(t["due_at"]))
            if t.get("deadline_id") in deadlines:
                candidates.append(dt(deadlines[t["deadline_id"]]["due_at"]))
        dues[ident] = min(candidates) if candidates else stop
    # Earlier downstream deadlines propagate to prerequisites.
    for _ in active:
        changed = False
        for i in active:
            for dep in deps[i]:
                if dep in dues and dues[dep] > dues[i]:
                    dues[dep] = dues[i]
                    changed = True
        if not changed:
            break
    occupied = []
    for e in data["events"]:
        if e.get("busy", True):
            occupied.extend(event_occurrences(e, start, stop))
    kept, removed, missed = [], [], []
    for b in data["blocks"]:
        if b["status"] != "planned":
            continue
        a, z = dt(b["start"]), dt(b["end"])
        if z <= start:
            missed.append(b)
        elif b.get("locked") or a < start or a >= stop:
            kept.append(b)
            occupied.append((a, z))
        else:
            removed.append(b)
    actual = {i: sum(w["minutes"] for w in data["sessions"] if w["task_id"] == i) for i in active}
    # Completed blocks count only when not already represented by recorded work.
    remaining = {}
    for i, t in active.items():
        done_blocks = sum(
            (dt(b["end"]) - dt(b["start"])).total_seconds() / 60
            for b in data["blocks"]
            if b["task_id"] == i and b["status"] == "done"
        )
        reserved = sum(
            (dt(b["end"]) - max(start, dt(b["start"]))).total_seconds() / 60
            for b in kept
            if b["task_id"] == i and dt(b["end"]) > start
        )
        remaining[i] = max(0, (t.get("estimate_minutes") or 0) - max(actual[i], done_blocks) - reserved)
    finish = {i: start for i, t in tasks.items() if t["status"] == "done"}
    for i in active:
        if remaining[i] == 0 and active[i].get("estimate_minutes"):
            finish[i] = max([start] + [dt(b["end"]) for b in kept if b["task_id"] == i])
    slots = []
    for offset in range((stop.date() - start.date()).days + 1):
        day = start.date() + timedelta(days=offset)
        if day.isoformat() in excluded:
            continue
        for window in cfg["availability"]:
            if window["weekday"] != day.weekday():
                continue
            a = max(start, datetime.combine(day, time.fromisoformat(window["start"]), ZONE))
            b = min(stop, datetime.combine(day, time.fromisoformat(window["end"]), ZONE))
            # Round up to a quarter-hour grid, then union overlapping windows.
            extra = 1 if a.second or a.microsecond else 0
            rounded = a.replace(second=0, microsecond=0) + timedelta(minutes=extra)
            a = rounded + timedelta(minutes=(-rounded.minute) % 15)
            while a + timedelta(minutes=15) <= b:
                slots.append(a)
                a += timedelta(minutes=15)
    slots = sorted(set(slots))
    daily = {}
    for b in kept:
        day = dt(b["start"]).astimezone(ZONE).date().isoformat()
        daily[day] = daily.get(day, 0) + (dt(b["end"]) - dt(b["start"])).total_seconds() / 60
    generated, risks = [], []
    pending = set(active)
    unlocks = {i: sum(i in deps[j] for j in active) for i in active}
    while pending:
        ready = [i for i in pending if all(d in finish for d in deps[i])]
        if not ready:
            for i in sorted(pending):
                risks.append(
                    {
                        "task_id": i,
                        "title": active[i]["title"],
                        "reason": "Bước trước chưa thể hoàn thành",
                        "remaining_minutes": remaining[i],
                    }
                )
            break
        ready.sort(key=lambda i: (dues[i], -active[i]["priority"], -unlocks[i], i))
        i = ready[0]
        pending.remove(i)
        t = active[i]
        if not t.get("estimate_minutes"):
            risks.append(
                {"task_id": i, "title": t["title"], "reason": "Chưa có thời lượng dự kiến", "remaining_minutes": None}
            )
            continue
        earliest = max([start] + [finish[d] for d in deps[i]])
        left = remaining[i]
        for a in slots:
            if left <= 0:
                break
            if a < earliest or a >= dues[i]:
                continue
            day = a.date().isoformat()
            budget = cfg["daily_limit_minutes"] - daily.get(day, 0)
            length = min(left, cfg["block_minutes"], budget)
            # Find contiguous usable grid slots. Short final tasks can use <15 minutes.
            while length > 0:
                z = a + timedelta(minutes=length)
                covered = all(a + timedelta(minutes=n) in slots for n in range(0, int(length), 15))
                if covered and z <= dues[i] and not any(overlaps(a, z, x, y) for x, y in occupied):
                    break
                length = max(0, length - 15)
            if length <= 0:
                continue
            z = a + timedelta(minutes=length)
            generated.append(
                {
                    "title": t["title"],
                    "task_id": i,
                    "start": a.isoformat(),
                    "end": z.isoformat(),
                    "locked": False,
                    "status": "planned",
                    "description": f"Ưu tiên hạn {dues[i].astimezone(ZONE).strftime('%d/%m %H:%M')}; mức {t['priority']}; mở khóa {unlocks[i]} việc",
                }
            )
            occupied.append((a, z + timedelta(minutes=cfg["break_minutes"])))
            daily[day] = daily.get(day, 0) + length
            left -= length
            earliest = z + timedelta(minutes=cfg["break_minutes"])
        if left > 0:
            risks.append(
                {
                    "task_id": i,
                    "title": t["title"],
                    "reason": "Không đủ giờ rảnh trước hạn hoặc trong phạm vi lập lịch",
                    "remaining_minutes": left,
                }
            )
        else:
            finish[i] = max(
                [earliest if remaining[i] else finish.get(i, earliest)]
                + [dt(b["end"]) for b in kept if b["task_id"] == i]
            )
    operations = [{"kind": "blocks", "action": "delete", "id": b["id"]} for b in removed]
    operations += [{"kind": "blocks", "action": "update", "id": b["id"], "data": {"status": "missed"}} for b in missed]
    operations += [{"kind": "blocks", "action": "create", "data": b} for b in generated]
    return {
        "blocks": generated,
        "removed": removed,
        "missed": missed,
        "risks": risks,
        "operations": operations,
        "start": start.isoformat(),
        "end": stop.isoformat(),
        "daily_minutes": daily,
    }
