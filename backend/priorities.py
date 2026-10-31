"""Explainable work ordering, independent of calendar slots and manual estimates."""

from datetime import datetime, timezone
from .planner import dt, ZONE


def recommend(data, at=None):
    at = (dt(at) if at else datetime.now(timezone.utc)).astimezone(ZONE)
    tasks = {t["id"]: t for t in data["tasks"]}
    deadlines = {d["id"]: d for d in data["deadlines"]}
    children = {ident: [t for t in tasks.values() if t.get("parent_id") == ident] for ident in tasks}

    def chain(t):
        yield t
        while t.get("parent_id") in tasks:
            t = tasks[t["parent_id"]]
            yield t

    def done(t):
        return all(done(c) for c in children[t["id"]]) if children[t["id"]] else t.get("status") == "done"

    def due(t):
        values = []
        for parent in chain(t):
            if parent.get("due_at"):
                values.append(parent["due_at"])
            if parent.get("deadline_id") in deadlines:
                values.append(deadlines[parent["deadline_id"]]["due_at"])
        return min(values, key=dt) if values else None

    def root(t):
        return list(chain(t))[-1]

    candidates = {}
    for t in tasks.values():
        if t.get("status") in ("done", "cancelled") or done(t):
            continue
        r = root(t)
        if r.get("status") in ("done", "cancelled"):
            continue
        key = "tasks:" + r["id"]
        entry = candidates.setdefault(
            key,
            {
                "kind": "tasks",
                "id": r["id"],
                "title": r["title"],
                "due_at": None,
                "priority": r.get("priority", 2),
                "remaining_minutes": 0,
                "blocked_by": [],
                "dependencies": set(),
            },
        )
        value = due(t)
        if value and (not entry["due_at"] or dt(value) < dt(entry["due_at"])):
            entry["due_at"] = value
        entry["priority"] = max(entry["priority"], t.get("priority", 2))
        if not children[t["id"]] and t.get("estimate_minutes"):
            worked = sum(s["minutes"] for s in data["sessions"] if s["task_id"] == t["id"])
            entry["remaining_minutes"] += max(0, t["estimate_minutes"] - worked)
        for dep_id in t.get("depends_on", []):
            dep = tasks.get(dep_id)
            if dep and not done(dep):
                blocker = {"id": dep_id, "title": dep["title"]}
                if blocker not in entry["blocked_by"]:
                    entry["blocked_by"].append(blocker)
                dep_root = root(dep)
                if dep_root["id"] != r["id"]:
                    entry["dependencies"].add("tasks:" + dep_root["id"])

    # Include deadlines even when the user has not made a task for them yet.
    for d in deadlines.values():
        if d.get("done"):
            continue
        linked = [t for t in tasks.values() if t.get("deadline_id") == d["id"]]
        if any("tasks:" + root(t)["id"] in candidates for t in linked):
            continue
        candidates["deadlines:" + d["id"]] = {
            "kind": "deadlines",
            "id": d["id"],
            "title": d["title"],
            "due_at": d["due_at"],
            "priority": 2,
            "remaining_minutes": 0,
            "blocked_by": [],
            "dependencies": set(),
        }

    # A prerequisite inherits the earliest downstream due date.
    for _ in candidates:
        changed = False
        for entry in candidates.values():
            for key in entry["dependencies"]:
                dep = candidates.get(key)
                if dep and entry["due_at"] and (not dep["due_at"] or dt(dep["due_at"]) > dt(entry["due_at"])):
                    dep["due_at"] = entry["due_at"]
                    dep["unlocks"] = entry["title"]
                    changed = True
        if not changed:
            break

    capacity = data["settings"].get("daily_limit_minutes", 240)

    def score(entry):
        days = (dt(entry["due_at"]) - at).total_seconds() / 86400 if entry["due_at"] else 100000
        slack = days - entry["remaining_minutes"] / max(1, capacity)
        return (slack - (entry["priority"] - 2) * 0.5, -entry["priority"], entry["title"], entry["id"])

    ordered, pending = [], dict(candidates)
    while pending:
        ready = [(key, entry) for key, entry in pending.items() if not (entry["dependencies"] & pending.keys())]
        key, entry = min(ready or list(pending.items()), key=lambda pair: score(pair[1]))
        pending.pop(key)
        reasons = []
        if entry.get("unlocks"):
            reasons.append("Làm trước để mở khóa: " + entry["unlocks"])
        if entry["due_at"]:
            due_date = dt(entry["due_at"]).astimezone(ZONE)
            days = (due_date.date() - at.date()).days
            reasons.append(
                "Đã quá hạn" if due_date < at else "Đến hạn hôm nay" if days == 0 else f"Còn {days} ngày đến hạn"
            )
            if score(entry)[0] < 1 and entry["remaining_minutes"]:
                reasons.append("Khối lượng còn lại cần bắt đầu sớm")
        else:
            reasons.append("Chưa có hạn; cân nhắc sau các mốc gần")
        if entry["blocked_by"]:
            reasons.append("Chờ: " + ", ".join(b["title"] for b in entry["blocked_by"]))
        if entry["priority"] >= 3:
            reasons.append("Mức quan trọng cao")
        ordered.append(
            {k: v for k, v in entry.items() if k != "dependencies"}
            | {"rank": len(ordered) + 1, "reason": ". ".join(reasons) + "."}
        )
    return ordered
