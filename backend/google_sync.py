"""Google Calendar adapter: private app calendar, incremental pulls and ETag writes."""

import hashlib
import json
import os
import time
from datetime import timedelta, timezone
from pathlib import Path
import httpx
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from google_auth_oauthlib.flow import Flow
from sqlalchemy import select, delete
from . import config, sync_policy
from .db import Session, transaction
from .models import CalendarConnection, SyncMapping, ENTITIES, WorkspaceState, OutboxJob
from .domain import now, uid, fail
from .planner import dt

BASE = "https://www.googleapis.com/calendar/v3"
SCOPES = [
    "https://www.googleapis.com/auth/calendar.app.created",
    "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
    "https://www.googleapis.com/auth/calendar.events.readonly",
]
_flow = None
_auth_state = None
_auth_started = 0
_auth_url = None
GOOGLE_COLORS = {
    "1": "#7986cb",
    "2": "#33b679",
    "3": "#8e24aa",
    "4": "#e67c73",
    "5": "#f6bf26",
    "6": "#f4511e",
    "7": "#039be5",
    "8": "#616161",
    "9": "#3f51b5",
    "10": "#0b8043",
    "11": "#d50000",
}


def private_write(name, content):
    target = config.DATA / name
    fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write(content)
    target.chmod(0o600)


def credentials():
    path = config.DATA / "google-token.json"
    if not path.exists():
        raise ValueError("Chưa kết nối Google Calendar")
    creds = Credentials.from_authorized_user_file(str(path), SCOPES)
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
        private_write("google-token.json", creds.to_json())
    return creds


class GoogleClient:
    def __init__(self):
        self.creds = credentials()

    def request(self, method, path, **kwargs):
        sync_policy.reserve_request()
        with httpx.Client(timeout=30) as client:
            response = client.request(
                method,
                BASE + path,
                headers={"Authorization": "Bearer " + self.creds.token, **kwargs.pop("headers", {})},
                **kwargs,
            )
        if response.status_code in (204,):
            return {}
        if response.status_code >= 400:
            try:
                response.raise_for_status()
            except httpx.HTTPStatusError as exc:
                if response.status_code in (401, 403, 429, 500, 502, 503, 504):
                    with transaction() as s:
                        c = connection(s)
                        if c:
                            until = sync_policy.clock() + sync_policy.retry_delay(
                                exc, c.data.get("failures", 0) + 1, sync_policy.clock()
                            )
                            c.data = {
                                **c.data,
                                "retry_at": sync_policy.stamp(max(until, sync_policy.epoch(c.data.get("retry_at")))),
                                "status": "waiting",
                                "error": "Google chưa nhận yêu cầu. Nhịp đang chờ trước khi thử lại.",
                            }
                raise
        response.raise_for_status()
        return response.json()


def connection(s):
    return s.get(CalendarConnection, "google")


def client_path():
    """Users need no Cloud Console setup when the distributor supplies a Desktop client."""
    personal = config.DATA / "google-client.json"
    bundled = config.directory("PDM_GOOGLE_CLIENT_FILE", config.ROOT / "resources/google-client.json")
    return personal if personal.exists() else bundled


def status(s):
    c = connection(s)
    primary = next(
        (item for item in (c.data.get("calendar_list", {}).get("items", []) if c else []) if item.get("primary")), {}
    )
    return {
        "configured": client_path().is_file(),
        "connected": bool(c and (config.DATA / "google-token.json").exists()),
        **(
            {
                k: v
                for k, v in c.data.items()
                if k not in ("api_budget", "calendar_list", "sync_tokens", "pull_pending", "pull_targets")
            }
            if c
            else {}
        ),
        **sync_policy.public(c.data if c else {}, s.get(OutboxJob, "google-sync")),
        "account_label": (c.data.get("account_id") if c else None) or primary.get("id") or primary.get("summary"),
        "conflicts": [
            {"id": m.id, **m.data["conflict"]} for m in s.scalars(select(SyncMapping)) if m.data.get("conflict")
        ],
    }


def authorize():
    global _flow, _auth_state, _auth_started, _auth_url
    if _flow is not None and _auth_url and time.monotonic() - _auth_started <= 600:
        return _auth_url
    path = client_path()
    if not path.exists():
        fail("Hãy tải lên OAuth client JSON loại Desktop app trước")
    _flow = Flow.from_client_secrets_file(
        str(path),
        scopes=SCOPES,
        redirect_uri=f"http://127.0.0.1:{config.PORT}/api/v1/google/callback",
        autogenerate_code_verifier=True,
    )
    url, state = _flow.authorization_url(access_type="offline", prompt="consent")
    _auth_state = state
    _auth_started = time.monotonic()
    _auth_url = url
    return url


def cancel(state):
    global _flow, _auth_state, _auth_url
    import secrets

    if not _auth_state or not secrets.compare_digest(state, _auth_state) or time.monotonic() - _auth_started > 600:
        fail("Phiên đăng nhập hết hạn hoặc state không khớp", 400)
    _flow, _auth_state, _auth_url = None, None, None


def account_id(creds):
    """Resolve the authorized account using the Calendar scope already granted."""
    params = {"maxResults": 250, "fields": "items(id,primary),nextPageToken"}
    with httpx.Client(timeout=30) as client:
        while True:
            sync_policy.reserve_request(authentication=True)
            response = client.get(
                BASE + "/users/me/calendarList", params=params, headers={"Authorization": "Bearer " + creds.token}
            )
            response.raise_for_status()
            page = response.json()
            primary = next((item["id"] for item in page.get("items", []) if item.get("primary")), None)
            if primary:
                return primary
            if not page.get("nextPageToken"):
                raise ValueError("Không xác nhận được tài khoản Google Calendar")
            params["pageToken"] = page["nextPageToken"]


def callback(code, state):
    global _flow, _auth_state, _auth_url
    import secrets

    if (
        _flow is None
        or not _auth_state
        or not secrets.compare_digest(state, _auth_state)
        or time.monotonic() - _auth_started > 600
    ):
        fail("Phiên đăng nhập hết hạn hoặc state không khớp", 400)
    # A code is single-use. Consume the pending flow even if token exchange or
    # account verification fails, so the next login gets a fresh code and PKCE.
    flow = _flow
    _flow, _auth_state, _auth_url = None, None, None
    try:
        flow.fetch_token(code=code)
        new_account = account_id(flow.credentials)
    except sync_policy.Deferred:
        fail("Đang giãn lượt gọi Google Calendar. Hãy đợi rồi đăng nhập lại; kết nối cũ vẫn được giữ.", 429)
    except Exception:
        fail(
            "Chưa xác nhận được tài khoản Google Calendar. Hãy đăng nhập lại và cấp đủ quyền Calendar; kết nối cũ vẫn được giữ.",
            503,
        )
    with Session() as s:
        previous = connection(s)
        old_account = previous.data.get("account_id") if previous else None
        if previous and not old_account:
            old_account = next(
                (
                    item.get("id")
                    for item in previous.data.get("calendar_list", {}).get("items", [])
                    if item.get("primary")
                ),
                None,
            )
    if previous and not old_account:
        try:
            old_account = account_id(credentials())
        except Exception:
            pass
    private_write("google-token.json", flow.credentials.to_json())
    with transaction() as s:
        c = connection(s)
        if c and old_account != new_account:
            # IDs, ETags and imported busy events belong to the previous Google account.
            for event in list(s.scalars(select(ENTITIES["events"]))):
                if event.data.get("readonly"):
                    s.delete(event)
            s.execute(delete(SyncMapping))
            c.data = {"selected_calendar_ids": [], "sync_tokens": {}}
            s.get(WorkspaceState, 1).revision += 1
        if not c:
            s.add(
                CalendarConnection(
                    id="google",
                    data={
                        "status": "pending",
                        "selected_calendar_ids": [],
                        "sync_tokens": {},
                        "connected_at": now(),
                        "account_id": new_account,
                    },
                )
            )
        else:
            c.data = {
                **c.data,
                "status": "pending",
                "error": None,
                "retry_at": None,
                "failures": 0,
                "next_pull_at": now(),
                "connected_at": now(),
                "account_id": new_account,
            }


def canonical(event):
    return {
        k: event[k]
        for k in ("summary", "description", "start", "end", "recurrence", "transparency", "reminders", "colorId")
        if k in event
    }


def digest(event):
    return hashlib.sha256(json.dumps(canonical(event), sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def outgoing(s):
    cfg = s.get(WorkspaceState, 1).settings
    result = {}
    for kind in ("blocks", "events", "deadlines"):
        for item in s.scalars(select(ENTITIES[kind])):
            d = item.data
            if (
                kind == "events"
                and d.get("readonly")
                or kind == "blocks"
                and d["status"] == "missed"
                or kind == "deadlines"
                and d.get("done")
            ):
                continue
            deadline = kind == "deadlines"
            start = d["due_at"] if deadline else d["start"]
            end = (dt(start) + timedelta(minutes=1)).isoformat() if deadline else d["end"]
            reminders = cfg["deadline_reminders"] if deadline else [cfg["block_reminder_minutes"]]
            payload = {
                "summary": ("⏳ " if deadline else "") + d["title"],
                "description": d.get("description", ""),
                "start": {"dateTime": start, "timeZone": config.TZ},
                "end": {"dateTime": end, "timeZone": config.TZ},
                "transparency": "transparent" if deadline or not d.get("busy", True) else "opaque",
                "reminders": {
                    "useDefault": False,
                    "overrides": [{"method": "popup", "minutes": m} for m in reminders[:5]],
                },
                "extendedProperties": {"private": {"pdm_kind": kind, "pdm_id": item.id}},
            }
            if deadline or d.get("all_day"):
                from .planner import ZONE

                date = dt(start).astimezone(ZONE).date()
                end_date = date + timedelta(days=1) if deadline else dt(end).astimezone(ZONE).date()
                payload["start"], payload["end"] = {"date": date.isoformat()}, {"date": end_date.isoformat()}
            if d.get("recurrence"):
                payload["recurrence"] = d["recurrence"]
            result[f"{kind}:{item.id}"] = payload
    return result


def remote_data(event, readonly=False, calendar_id=None):
    def ts(field):
        value = event[field].get("dateTime")
        if value:
            return value
        return event[field]["date"] + "T00:00:00+07:00"

    return {
        "title": event.get("summary", "Không có tiêu đề"),
        "description": event.get("description", ""),
        "start": ts("start"),
        "end": ts("end"),
        "recurrence": event.get("recurrence", []),
        "busy": event.get("transparency") != "transparent",
        "origin": "google",
        "readonly": readonly,
        "google_calendar_id": calendar_id,
        "exceptions": {},
        "all_day": "date" in event["start"],
        "color": GOOGLE_COLORS.get(event.get("colorId")),
        "google_event_id": event.get("id"),
        "google_event_url": event.get("htmlLink"),
    }


def import_remote(s, mapping, event, calendar_id):
    d = mapping.data
    kind, ident = d["kind"], d["entity_id"]
    obj = s.get(ENTITIES[kind], ident)
    if event.get("status") == "cancelled":
        if obj and kind != "deadlines":
            s.delete(obj)
        # Deleting a deadline reminder must not erase the deadline itself.
        mapping.data = {**d, "suppressed": True, "etag": event.get("etag"), "conflict": None}
        return
    if not obj:
        return
    patch = remote_data(event, readonly=d.get("readonly", False), calendar_id=calendar_id)
    if kind == "deadlines":
        due = event["start"]["date"] + "T23:59:00+07:00" if patch["all_day"] else patch["start"]
        update = {"title": patch["title"].removeprefix("⏳ "), "description": patch["description"], "due_at": due}
    elif kind == "blocks":
        update = {
            "start": patch["start"],
            "end": patch["end"],
            "title": patch["title"],
            "description": patch["description"],
            "locked": True,
        }
    else:
        update = {**patch, "exceptions": obj.data.get("exceptions", {})}
    obj.data = {**obj.data, **update}
    s.flush()
    payload = outgoing(s).get(f"{kind}:{ident}", {})
    mapping.data = {
        **d,
        "etag": event.get("etag"),
        "local_hash": digest(payload),
        "remote_hash": digest(event),
        "conflict": None,
    }


def pull_calendar(client, calendar_id, token):
    params = {"maxResults": 2500, "showDeleted": "true"}
    if token:
        params["syncToken"] = token
    events = []
    while True:
        try:
            page = client.request("GET", f"/calendars/{quote(calendar_id)}/events", params=params)
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == 410 and token:
                return pull_calendar(client, calendar_id, None)
            raise
        events.extend(page.get("items", []))
        if not page.get("nextPageToken"):
            return events, page.get("nextSyncToken"), not bool(token)
        params["pageToken"] = page["nextPageToken"]


def quote(value):
    from urllib.parse import quote as escape

    return escape(value, safe="")


def exception_value(event, item, key):
    if event.get("status") == "cancelled":
        return None
    value = {"start": remote_data(event)["start"], "end": remote_data(event)["end"]}
    point = dt(key)
    duration = dt(item["end"]) - dt(item["start"])
    return "default" if dt(value["start"]) == point and dt(value["end"]) == point + duration else value


def import_exception(s, master, event):
    obj = s.get(ENTITIES[master.data["kind"]], master.data["entity_id"])
    if not obj or master.data["kind"] != "events":
        return False
    original = event["originalStartTime"]
    key = (
        dt(original.get("dateTime") or original["date"] + "T00:00:00+07:00")
        .astimezone(dt(obj.data["start"]).tzinfo)
        .isoformat()
    )
    value = exception_value(event, obj.data, key)
    states = master.data.get("exception_states", {})
    baseline = states.get(key, {})
    local = obj.data.get("exceptions", {}).get(key, "default")
    previous = baseline.get("value", "default")
    if not master.data.get("readonly") and local != previous and value != previous and local != value:
        master.data = {
            **master.data,
            "conflict": {
                "title": obj.data["title"],
                "remote": event,
                "local": local,
                "kind": "events",
                "entity_id": obj.id,
                "occurrence_key": key,
            },
        }
        return False
    changed = False
    if local == previous or local == value or master.data.get("readonly"):
        exceptions = {**obj.data.get("exceptions", {})}
        if value == "default":
            exceptions.pop(key, None)
        else:
            exceptions[key] = value
        changed = exceptions != obj.data.get("exceptions", {})
        obj.data = {**obj.data, "exceptions": exceptions}
        previous = value
    master.data = {
        **master.data,
        "exception_states": {**states, key: {"value": previous, "id": event["id"], "etag": event.get("etag")}},
    }
    return changed


def push_exceptions(client, calendar_id):
    with Session() as s:
        entries = [
            (m.id, m.data.copy(), s.get(ENTITIES["events"], m.data["entity_id"]).data.copy())
            for m in s.scalars(select(SyncMapping))
            if m.data.get("calendar_id") == calendar_id
            and m.data.get("kind") == "events"
            and not m.data.get("readonly")
            and not m.data.get("conflict")
            and not m.data.get("suppressed")
            and s.get(ENTITIES["events"], m.data["entity_id"])
        ]
    for mapping_id, mapping, item in entries:
        if not item.get("recurrence"):
            continue
        states = mapping.get("exception_states", {}).copy()
        for key in set(item.get("exceptions", {})) | set(states):
            value = item.get("exceptions", {}).get(key, "default")
            baseline = states.get(key, {})
            if value == baseline.get("value", "default"):
                continue
            endpoint = f"/calendars/{quote(calendar_id)}/events"
            if baseline.get("id"):
                remote = client.request("GET", endpoint + "/" + quote(baseline["id"]))
            else:
                page = client.request(
                    "GET",
                    endpoint + "/" + quote(mapping["event_id"]) + "/instances",
                    params={
                        "originalStart": key[:10] if item.get("all_day") else key,
                        "showDeleted": "true",
                        "maxResults": 10,
                    },
                )
                remote = next(
                    (
                        e
                        for e in page.get("items", [])
                        if dt(
                            e["originalStartTime"].get("dateTime") or e["originalStartTime"]["date"] + "T00:00:00+07:00"
                        )
                        == dt(key)
                    ),
                    None,
                )
                if not remote:
                    raise ValueError("Không tìm thấy buổi lặp trên Google Calendar")
            current = exception_value(remote, item, key)
            if baseline and current not in (baseline.get("value", "default"), value):
                with transaction() as s:
                    obj = s.get(SyncMapping, mapping_id)
                    obj.data = {
                        **obj.data,
                        "conflict": {
                            "title": item["title"],
                            "remote": remote,
                            "local": value,
                            "kind": "events",
                            "entity_id": mapping["entity_id"],
                            "occurrence_key": key,
                        },
                    }
                break
            if current != value:
                path = endpoint + "/" + quote(remote["id"])
                headers = {"If-Match": remote.get("etag", "*")}
                try:
                    if value is None:
                        client.request("DELETE", path, headers=headers)
                    else:
                        point = dt(key)
                        start, end = (
                            (point.isoformat(), (point + (dt(item["end"]) - dt(item["start"]))).isoformat())
                            if value == "default"
                            else (value["start"], value["end"])
                        )
                        body = {
                            **canonical(remote),
                            "status": "confirmed",
                            "start": {"dateTime": start, "timeZone": config.TZ},
                            "end": {"dateTime": end, "timeZone": config.TZ},
                        }
                        if item.get("all_day"):
                            body.update(start={"date": start[:10]}, end={"date": end[:10]})
                        remote = client.request("PUT", path, json=body, headers=headers)
                except httpx.HTTPStatusError as exc:
                    if exc.response.status_code != 412:
                        raise
                    fresh = client.request("GET", path)
                    with transaction() as s:
                        obj = s.get(SyncMapping, mapping_id)
                        obj.data = {
                            **obj.data,
                            "conflict": {
                                "title": item["title"],
                                "remote": fresh,
                                "local": value,
                                "kind": "events",
                                "entity_id": mapping["entity_id"],
                                "occurrence_key": key,
                            },
                        }
                    break
            states[key] = {"id": remote["id"], "etag": remote.get("etag"), "value": value}
            with transaction() as s:
                obj = s.get(SyncMapping, mapping_id)
                obj.data = {**obj.data, "exception_states": states.copy()}


def sync(client=None, pull=True):
    with Session() as s:
        c = connection(s)
        if not c:
            return
        info = c.data.copy()
        job = s.get(OutboxJob, "google-sync")
        generation = job.data.get("generation", 0) if job else None
    client = client or GoogleClient()
    calendar_id = info.get("calendar_id")
    if not calendar_id:
        created = client.request(
            "POST", "/calendars", json={"summary": "PersonalDeadlineManagement", "timeZone": config.TZ}
        )
        calendar_id = created["id"]
        with transaction() as s:
            c = connection(s)
            c.data = {**c.data, "calendar_id": calendar_id}
    tokens = info.get("sync_tokens", {}).copy()
    pending = []
    if pull:
        targets = list(dict.fromkeys([calendar_id] + info.get("selected_calendar_ids", [])))
        with transaction() as s:
            c = connection(s)
            previous = c.data.get("pull_pending")
            pending = (
                targets
                if previous is None
                else [v for v in previous if v in targets]
                + [v for v in targets if v not in c.data.get("pull_targets", [])]
            )
            c.data = {**c.data, "pull_pending": pending, "pull_targets": targets}
    for cid in pending:
        # Older imports discarded Google's date/dateTime distinction. Refresh once
        # from the provider instead of guessing from midnight timestamps.
        version = info.get("event_format_versions", {}).get(cid, info.get("event_format_version"))
        events, token, full = pull_calendar(client, cid, tokens.get(cid) if version == 3 else None)
        with transaction() as s:
            current = connection(s)
            if not current or cid != calendar_id and cid not in current.data.get("selected_calendar_ids", []):
                continue
            desired = outgoing(s)
            mappings = {
                m.data.get("event_id"): m for m in s.scalars(select(SyncMapping)) if m.data.get("calendar_id") == cid
            }
            if full:
                seen = {e["id"] for e in events}
                events += [
                    {"id": eid, "status": "cancelled"}
                    for eid, m in mappings.items()
                    if eid not in seen and not m.data.get("suppressed")
                ]
            changed = False
            for event in sorted(events, key=lambda e: bool(e.get("recurringEventId"))):
                eid = event["id"]
                m = mappings.get(eid)
                # A recurrence exception belongs to its master, not a new standalone event.
                if event.get("recurringEventId"):
                    master = mappings.get(event["recurringEventId"])
                    if master:
                        changed = import_exception(s, master, event) or changed
                    continue
                if m:
                    if m.data.get("readonly"):
                        obj = s.get(ENTITIES[m.data["kind"]], m.data["entity_id"])
                        if (
                            event.get("status") == "cancelled"
                            or digest(event) != m.data.get("remote_hash")
                            or obj
                            and ("all_day" not in obj.data or "google_event_id" not in obj.data)
                        ):
                            import_remote(s, m, event, cid)
                            changed = True
                        continue
                    local_payload = desired.get(f"{m.data['kind']}:{m.data['entity_id']}")
                    local_changed = (digest(local_payload) if local_payload else None) != m.data.get("local_hash")
                    remote_changed = event.get("status") == "cancelled" or digest(event) != m.data.get("remote_hash")
                    if remote_changed and local_changed and not m.data.get("suppressed"):
                        m.data = {
                            **m.data,
                            "conflict": {
                                "title": event.get("summary", eid),
                                "remote": event,
                                "local": local_payload,
                                "kind": m.data["kind"],
                                "entity_id": m.data["entity_id"],
                            },
                        }
                    elif remote_changed and not m.data.get("suppressed"):
                        import_remote(s, m, event, cid)
                        changed = True
                    else:
                        m.data = {**m.data, "etag": event.get("etag", m.data.get("etag"))}
                elif event.get("status") != "cancelled":
                    private = event.get("extendedProperties", {}).get("private", {})
                    owned_kind, owned_id = private.get("pdm_kind"), private.get("pdm_id")
                    if (
                        cid == calendar_id
                        and owned_kind in ("events", "blocks", "deadlines")
                        and owned_id
                        and s.get(ENTITIES[owned_kind], owned_id)
                    ):
                        local = desired.get(f"{owned_kind}:{owned_id}", {})
                        restored = SyncMapping(
                            id=uid(),
                            data={
                                "calendar_id": cid,
                                "event_id": eid,
                                "kind": owned_kind,
                                "entity_id": owned_id,
                                "etag": event.get("etag"),
                                "local_hash": digest(local) if digest(local) == digest(event) else "retry",
                                "remote_hash": digest(event),
                            },
                        )
                        s.add(restored)
                        mappings[eid] = restored
                        continue
                    ident = uid()
                    s.add(ENTITIES["events"](id=ident, data=remote_data(event, cid != calendar_id, cid)))
                    s.flush()
                    local = outgoing(s).get("events:" + ident, {})
                    mapping = SyncMapping(
                        id=uid(),
                        data={
                            "calendar_id": cid,
                            "event_id": eid,
                            "kind": "events",
                            "entity_id": ident,
                            "etag": event.get("etag"),
                            "local_hash": digest(local),
                            "remote_hash": digest(event),
                            "readonly": cid != calendar_id,
                        },
                    )
                    s.add(mapping)
                    mappings[eid] = mapping
                    changed = True
            if changed:
                s.get(WorkspaceState, 1).revision += 1
            tokens[cid] = token
            current.data = {
                **current.data,
                "sync_tokens": {**current.data.get("sync_tokens", {}), cid: token},
                "event_format_versions": {**current.data.get("event_format_versions", {}), cid: 3},
                "pull_pending": [v for v in current.data.get("pull_pending", []) if v != cid],
            }
    # Send only app-calendar objects. Each request is followed by a persisted baseline.
    with Session() as s:
        desired = outgoing(s)
        maps = {
            f"{m.data['kind']}:{m.data['entity_id']}": (m.id, m.data.copy())
            for m in s.scalars(select(SyncMapping))
            if m.data.get("calendar_id") == calendar_id
        }
    for key in set(desired) | set(maps):
        payload = desired.get(key)
        mapping_id, mapping = maps.get(key, (None, {}))
        if mapping.get("readonly") or mapping.get("conflict") or mapping.get("suppressed"):
            continue
        if payload and digest(payload) == mapping.get("local_hash"):
            continue
        kind, ident = key.split(":", 1)
        # Deterministic base32hex-compatible ID prevents duplicates after crash/retry.
        eid = mapping.get("event_id") or hashlib.sha256(key.encode()).hexdigest()
        endpoint = f"/calendars/{quote(calendar_id)}/events"
        try:
            if not payload:
                client.request("DELETE", endpoint + "/" + quote(eid), headers={"If-Match": mapping.get("etag", "*")})
                remote = None
            elif mapping_id and not mapping.get("force_create"):
                remote = client.request(
                    "PUT", endpoint + "/" + quote(eid), json=payload, headers={"If-Match": mapping.get("etag", "*")}
                )
            else:
                try:
                    remote = client.request("POST", endpoint, json={**payload, "id": eid})
                except httpx.HTTPStatusError as exc:
                    if exc.response.status_code != 409:
                        raise
                    remote = client.request("GET", endpoint + "/" + eid)
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == 412:
                remote = client.request("GET", endpoint + "/" + quote(eid))
                with transaction() as s:
                    obj = s.get(SyncMapping, mapping_id)
                    obj.data = {
                        **obj.data,
                        "conflict": {
                            "title": remote.get("summary", eid),
                            "remote": remote,
                            "local": payload,
                            "kind": kind,
                            "entity_id": ident,
                        },
                    }
                continue
            if not payload and exc.response.status_code in (404, 410):
                remote = None
            else:
                raise
        with transaction() as s:
            obj = s.get(SyncMapping, mapping_id) if mapping_id else None
            if remote is None:
                if obj:
                    s.delete(obj)
                continue
            content = {
                "calendar_id": calendar_id,
                "event_id": eid,
                "kind": kind,
                "entity_id": ident,
                "etag": remote.get("etag"),
                "local_hash": digest(payload),
                "remote_hash": digest(remote),
            }
            if obj:
                obj.data = {**obj.data, **content}
            else:
                s.add(SyncMapping(id=uid(), data=content))
    push_exceptions(client, calendar_id)
    with transaction() as s:
        c = connection(s)
        if not c:
            return
        c.data = {
            **c.data,
            "status": "ready",
            "last_sync": now(),
            "error": None,
            **({"event_format_version": 3, "pull_pending": None} if pull else {}),
        }
        job = s.get(OutboxJob, "google-sync")
        if job and job.data.get("generation", 0) == generation:
            job.data = {**job.data, "status": "done", "attempts": 0}


def calendar_list(client=None):
    with Session() as s:
        c = connection(s)
        if not c:
            fail("Chưa kết nối Google Calendar")
        cached = c.data.get("calendar_list")
        if cached and sync_policy.clock() - sync_policy.epoch(c.data.get("calendar_list_at")) < 86400:
            return {**cached, "cached": True}
    client = client or GoogleClient()
    items, params = [], {"maxResults": 250}
    while True:
        page = client.request("GET", "/users/me/calendarList", params=params)
        items.extend(page.get("items", []))
        if not page.get("nextPageToken"):
            break
        params["pageToken"] = page["nextPageToken"]
    result = {"items": items}
    with transaction() as s:
        c = connection(s)
        if c:
            c.data = {**c.data, "calendar_list": result, "calendar_list_at": now()}
    return result


def resolve(s, ident, choice):
    m = s.get(SyncMapping, ident)
    if not m or not m.data.get("conflict"):
        fail("Xung đột không còn tồn tại", 404)
    remote = m.data["conflict"]["remote"]
    key = m.data["conflict"].get("occurrence_key")
    if key:
        obj = s.get(ENTITIES["events"], m.data["entity_id"])
        value = exception_value(remote, obj.data, key)
        states = {
            **m.data.get("exception_states", {}),
            key: {"value": value, "etag": remote.get("etag"), "id": remote["id"]},
        }
        if choice == "remote":
            exceptions = obj.data.get("exceptions", {}).copy()
            if value == "default":
                exceptions.pop(key, None)
            else:
                exceptions[key] = value
            obj.data = {**obj.data, "exceptions": exceptions}
        elif choice != "local":
            fail("Chọn local hoặc remote")
        m.data = {**m.data, "exception_states": states, "conflict": None}
        s.get(WorkspaceState, 1).revision += 1
        return
    if choice == "remote":
        import_remote(s, m, remote, m.data["calendar_id"])
    elif choice == "local":
        m.data = {
            **m.data,
            "etag": remote.get("etag"),
            "remote_hash": digest(remote),
            "local_hash": "retry",
            "conflict": None,
        }
        if remote.get("status") == "cancelled":
            m.data = {**m.data, "event_id": uid(), "force_create": True, "suppressed": False}
    else:
        fail("Chọn local hoặc remote")
    s.get(WorkspaceState, 1).revision += 1
