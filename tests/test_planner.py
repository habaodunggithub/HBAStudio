from copy import deepcopy
from backend.planner import plan, dt, event_occurrences
from backend.db import DEFAULT_SETTINGS


def data():
    return {
        "settings": {**DEFAULT_SETTINGS, "availability": [{"weekday": 6, "start": "09:00", "end": "18:00"}]},
        "tasks": [],
        "deadlines": [],
        "events": [],
        "blocks": [],
        "sessions": [],
    }


def task(i, **kw):
    return {"id": i, "title": i, "status": "todo", "priority": 2, "estimate_minutes": 45, "depends_on": [], **kw}


def test_dependencies_and_daily_limit():
    d = data()
    d["settings"]["daily_limit_minutes"] = 90
    d["tasks"] = [task("b", depends_on=["a"], priority=4), task("a"), task("c")]
    r = plan(d, "2026-11-01T08:00:00+07:00", 1)
    assert [b["task_id"] for b in r["blocks"]] == ["a", "b"]
    assert dt(r["blocks"][1]["start"]) >= dt(r["blocks"][0]["end"])
    assert any(x["task_id"] == "c" for x in r["risks"])


def test_locked_and_fixed_are_preserved_and_parent_not_scheduled():
    d = data()
    d["tasks"] = [task("parent", estimate_minutes=500), task("child", parent_id="parent", estimate_minutes=90)]
    d["events"] = [{"title": "Lớp", "start": "2026-11-01T09:00:00+07:00", "end": "2026-11-01T10:00:00+07:00"}]
    d["blocks"] = [
        {
            "id": "keep",
            "task_id": "child",
            "title": "child",
            "start": "2026-11-01T10:00:00+07:00",
            "end": "2026-11-01T10:45:00+07:00",
            "locked": True,
            "status": "planned",
        }
    ]
    r = plan(d, "2026-11-01T08:00:00+07:00", 1)
    assert len(r["blocks"]) == 1
    assert r["blocks"][0]["task_id"] == "child"
    assert dt(r["blocks"][0]["start"]) >= dt(d["blocks"][0]["end"])
    assert not any(o.get("id") == "keep" for o in r["operations"])


def test_missing_estimate_blocks_downstream_and_never_changes_due():
    d = data()
    d["tasks"] = [task("a", estimate_minutes=None), task("b", depends_on=["a"], due_at="2026-11-01T10:00:00+07:00")]
    before = deepcopy(d)
    r = plan(d, "2026-11-01T08:00:00+07:00", 1)
    assert not r["blocks"] and len(r["risks"]) == 2
    assert d == before


def test_inherit_parent_due_and_propagate_to_prerequisites():
    d = data()
    d["tasks"] = [
        task("p", due_at="2026-11-01T10:00:00+07:00"),
        task("child", parent_id="p", depends_on=["pre"]),
        task("pre", priority=1),
        task("other", priority=4),
    ]
    r = plan(d, "2026-11-01T08:00:00+07:00", 1)
    assert r["blocks"][0]["task_id"] == "pre"
    assert any(x["task_id"] == "child" for x in r["risks"])


def test_missed_blocks_replanned_and_actual_time_subtracted():
    d = data()
    d["tasks"] = [task("a", estimate_minutes=90)]
    d["sessions"] = [{"task_id": "a", "minutes": 45}]
    d["blocks"] = [
        {
            "id": "miss",
            "task_id": "a",
            "title": "a",
            "start": "2026-10-31T09:00:00+07:00",
            "end": "2026-10-31T09:45:00+07:00",
            "status": "planned",
            "locked": False,
        }
    ]
    r = plan(d, "2026-11-01T08:00:00+07:00", 1)
    assert len(r["missed"]) == 1 and len(r["blocks"]) == 1


def test_scenario_day_off_and_no_availability():
    d = data()
    d["tasks"] = [task("a")]
    assert not plan(d, "2026-11-01T08:00:00+07:00", 1, ["2026-11-01"])["blocks"]
    d["settings"]["availability"] = []
    assert plan(d, "2026-11-01T08:00:00+07:00", 1)["risks"]


def test_recurrence_cancel_and_moved_exception():
    e = {
        "start": "2026-11-01T09:00:00+07:00",
        "end": "2026-11-01T10:00:00+07:00",
        "recurrence": ["RRULE:FREQ=WEEKLY"],
        "exceptions": {
            "2026-11-08T09:00:00+07:00": None,
            "2026-11-15T09:00:00+07:00": {"start": "2026-11-16T11:00:00+07:00", "end": "2026-11-16T12:00:00+07:00"},
        },
    }
    out = event_occurrences(e, dt("2026-11-01T00:00:00+07:00"), dt("2026-11-17T00:00:00+07:00"))
    assert len(out) == 2
    assert out[1][0].day == 16


def test_future_locked_prerequisite_finishes_before_successor():
    d = data()
    d["tasks"] = [task("a", estimate_minutes=90), task("b", depends_on=["a"])]
    d["blocks"] = [
        {
            "id": "locked",
            "title": "A",
            "task_id": "a",
            "start": "2026-11-01T14:00:00+07:00",
            "end": "2026-11-01T14:45:00+07:00",
            "status": "planned",
            "locked": True,
        }
    ]
    r = plan(d, "2026-11-01T08:00:00+07:00", 1)
    successor = next(b for b in r["blocks"] if b["task_id"] == "b")
    assert dt(successor["start"]) >= dt("2026-11-01T14:45:00+07:00")
