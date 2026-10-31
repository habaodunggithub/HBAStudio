import json
import queue
import uuid
import time
from types import SimpleNamespace

import httpx
import pytest

from backend import codex_auth, codex_runtime, config, google_sync, sync_policy
from backend.db import Session, transaction
from backend.models import ChatThread, CalendarConnection, CalendarEvent, SyncMapping


class FakeServer:
    def __init__(self, mode, accounts):
        self.mode, self.accounts = mode, accounts
        self.events = queue.Queue()
        self.closed = False
        self.calls = []
        self.login_id = str(uuid.uuid4())

    def request(self, method, params, job, deadline):
        self.calls.append((method, params))
        if method == "account/read":
            return {"account": self.accounts.get(self.mode)}
        if method == "account/login/start":
            if params["type"] == "chatgptDeviceCode":
                return {
                    "loginId": self.login_id,
                    "verificationUrl": "https://auth.openai.com/codex/device",
                    "userCode": "TEST-1234",
                }
            return {"loginId": self.login_id, "authUrl": "https://auth.openai.com/oauth/authorize?state=test"}
        if method == "account/logout":
            self.accounts[self.mode] = None
        return {}

    def close(self):
        self.closed = True


@pytest.fixture
def auth(monkeypatch):
    codex_auth.shutdown()
    codex_auth._invalidate()
    monkeypatch.setattr(codex_auth, "_notice", "")
    monkeypatch.setenv("PDM_AGENT_ENABLED", "1")
    monkeypatch.setattr(codex_auth.shutil, "which", lambda name: "/bin/codex")
    (config.DATA / "codex-connection.json").unlink(missing_ok=True)
    accounts = {
        "system": {"type": "chatgpt", "email": "local@example.test", "planType": "plus", "accessToken": "never-expose"}
    }
    servers = []

    def server(mode):
        instance = FakeServer(mode, accounts)
        servers.append(instance)
        return instance, codex_auth.AuthJob()

    monkeypatch.setattr(codex_auth, "_server", server)
    yield accounts, servers
    codex_auth.shutdown()
    codex_auth._invalidate()
    (config.DATA / "codex-connection.json").unlink(missing_ok=True)


def test_status_is_read_only_cached_and_never_exposes_provider_tokens(client, auth):
    _, servers = auth
    response = client.get("/api/v1/connections")
    assert response.status_code == 200
    result = response.json()
    assert result["mode"] == "local" and result["codex"]["connected"]
    assert result["codex"]["account"] == {"type": "chatgpt", "email": "local@example.test", "plan": "plus"}
    assert "never-expose" not in response.text
    assert not (config.DATA / "codex-connection.json").exists()
    client.get("/api/v1/connections")
    assert len(servers) == 1 and servers[0].closed
    client.cookies.clear()
    assert client.get("/api/v1/connections").status_code == 401
    assert client.post("/api/v1/connections/codex/login", json={}).status_code == 401


def test_login_switches_identity_only_after_provider_completion_and_confirmed_account(client, auth):
    accounts, servers = auth
    result = client.post("/api/v1/connections/codex/login", json={"method": "browser"}).json()
    login = next(server for server in servers if any(method == "account/login/start" for method, _ in server.calls))
    assert result["pending"]["url"].startswith("https://auth.openai.com/")
    assert codex_runtime.selection()["mode"] == "system"
    duplicate = client.post("/api/v1/connections/codex/login", json={}).json()
    assert duplicate["pending"]["login_id"] == result["pending"]["login_id"]
    accounts["app"] = {"type": "chatgpt", "email": "own@example.test", "planType": "pro"}
    login.events.put({"method": "account/login/completed", "params": {"loginId": login.login_id, "success": True}})
    connected = client.get("/api/v1/connections").json()["codex"]
    assert connected["connected"] and connected["source"] == "app" and not connected["pending"]
    assert connected["account"]["email"] == "own@example.test" and login.closed
    assert not any(method in {"turn/start", "thread/start"} for server in servers for method, _ in server.calls)


def test_device_flow_cancel_expiry_and_unsuccessful_login_keep_system_identity(client, auth):
    _, servers = auth
    result = client.post("/api/v1/connections/codex/login", json={"method": "device"}).json()
    assert result["pending"]["code"] == "TEST-1234"
    assert client.delete("/api/v1/connections/codex/login").status_code == 200
    assert codex_runtime.selection()["mode"] == "system"
    result = client.post("/api/v1/connections/codex/login", json={}).json()
    codex_auth._expire(result["pending"]["login_id"])
    status = client.get("/api/v1/connections").json()["codex"]
    assert not status["pending"] and "hết hạn" in status["error"]
    assert codex_runtime.selection()["mode"] == "system"
    assert client.post("/api/v1/connections/codex/login", json={"method": "unknown"}).status_code == 422


def test_disconnect_does_not_log_out_cli_and_active_chat_prevents_switch(client, auth):
    accounts, servers = auth
    with transaction() as session:
        session.add(ChatThread(id="active", data={"status": "running"}))
    assert client.delete("/api/v1/connections/codex").status_code == 409
    with transaction() as session:
        session.get(ChatThread, "active").data = {"status": "idle"}
    result = client.delete("/api/v1/connections/codex")
    assert result.status_code == 200 and not result.json()["connected"]
    assert not servers and accounts["system"]["email"] == "local@example.test"
    assert client.get("/api/v1/chat/threads").json()["available"] is False
    assert client.post("/api/v1/connections/codex/system").json()["connected"]
    assert not any(method == "account/logout" for server in servers for method, _ in server.calls)


def test_owned_runtime_isolates_auth_and_does_not_inherit_api_tokens(auth, monkeypatch):
    monkeypatch.setenv("CODEX_HOME", "/tmp/existing-user-home")
    monkeypatch.setenv("OPENAI_API_KEY", "system-api-key")
    monkeypatch.setenv("CODEX_ACCESS_TOKEN", "system-token")
    env = codex_runtime.environment("app")
    assert env["CODEX_HOME"] == str(config.DATA / "codex")
    assert "OPENAI_API_KEY" not in env and "CODEX_ACCESS_TOKEN" not in env
    assert codex_runtime.environment("system")["CODEX_HOME"] == "/tmp/existing-user-home"
    assert codex_runtime.auth_options("app") == ["-c", 'cli_auth_credentials_store="file"']
    assert (config.DATA / "codex").stat().st_mode & 0o777 == 0o700


def test_failed_completion_and_unrelated_login_events_never_switch_identity(client, auth):
    _, servers = auth
    client.post("/api/v1/connections/codex/login", json={})
    login = next(server for server in servers if any(method == "account/login/start" for method, _ in server.calls))
    login.events.put({"method": "account/login/completed", "params": {"loginId": "different-login", "success": True}})
    assert client.get("/api/v1/connections").json()["codex"]["pending"]
    login.events.put(
        {
            "method": "account/login/completed",
            "params": {"loginId": login.login_id, "success": False, "error": "private-provider-detail"},
        }
    )
    response = client.get("/api/v1/connections")
    assert not response.json()["codex"]["pending"]
    assert "private-provider-detail" not in response.text
    assert codex_runtime.selection()["mode"] == "system"


def test_disconnecting_app_owned_account_logs_out_only_that_store(client, auth):
    accounts, servers = auth
    accounts["app"] = {"type": "chatgpt", "email": "app@example.test"}
    codex_runtime.select("app")
    assert client.delete("/api/v1/connections/codex").status_code == 200
    assert accounts["app"] is None and accounts["system"] is not None
    assert [server.mode for server in servers] == ["app"]
    assert any(method == "account/logout" for method, _ in servers[0].calls)


def test_bundled_google_client_is_used_without_user_upload(client, monkeypatch, tmp_path):
    client_file = config.DATA / "google-client.json"
    saved = client_file.read_bytes() if client_file.exists() else None
    client_file.unlink(missing_ok=True)
    bundled = tmp_path / "google-client.json"
    bundled.write_text(
        json.dumps(
            {
                "installed": {
                    "client_id": "distributed-client",
                    "client_secret": "public-desktop-client",
                    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                    "token_uri": "https://oauth2.googleapis.com/token",
                }
            }
        )
    )
    monkeypatch.setenv("PDM_GOOGLE_CLIENT_FILE", str(bundled))
    monkeypatch.setattr(google_sync, "_flow", None)
    monkeypatch.setattr(google_sync, "_auth_url", None)
    try:
        with Session() as session:
            assert google_sync.status(session)["configured"]
        response = client.post("/api/v1/google/authorize")
        assert response.status_code == 200 and "distributed-client" in response.json()["url"]
        assert client.post("/api/v1/google/authorize").json() == response.json()
        assert client.get("/api/v1/google/callback?error=access_denied&state=wrong").status_code == 400
        state = google_sync._auth_state
        response = client.get(
            "/api/v1/google/callback", params={"error": "access_denied", "state": state}, follow_redirects=False
        )
        assert response.status_code == 307 and response.headers["location"].endswith("#connections")
    finally:
        if saved is not None:
            client_file.write_bytes(saved)


@pytest.mark.parametrize("changed", [False, True])
def test_google_reauthorization_keeps_same_account_mapping_and_isolates_different_accounts(
    client, monkeypatch, changed
):
    token = config.DATA / "google-token.json"
    original = token.read_bytes() if token.exists() else None
    with transaction() as session:
        session.add(
            CalendarConnection(
                id="google",
                data={
                    "account_id": "old@example.test",
                    "calendar_id": "old-app-calendar",
                    "selected_calendar_ids": ["old-busy"],
                },
            )
        )
        session.add(CalendarEvent(id="busy", data={"readonly": True}))
        session.add(CalendarEvent(id="local", data={"title": "Keep local work", "readonly": False}))
        session.add(SyncMapping(id="mapping", data={"calendar_id": "old-app-calendar"}))
    flow = SimpleNamespace(
        credentials=SimpleNamespace(to_json=lambda: '{"token":"new-test-token"}'), fetch_token=lambda **kwargs: None
    )
    monkeypatch.setattr(google_sync, "_flow", flow)
    monkeypatch.setattr(google_sync, "_auth_state", "valid-state")
    monkeypatch.setattr(google_sync, "_auth_started", time.monotonic())
    monkeypatch.setattr(google_sync, "account_id", lambda creds: "new@example.test" if changed else "old@example.test")
    try:
        google_sync.callback("test-code", "valid-state")
        with Session() as session:
            result = google_sync.connection(session).data
            assert result["account_id"] == ("new@example.test" if changed else "old@example.test")
            assert session.get(CalendarEvent, "local")
            if changed:
                assert "calendar_id" not in result and result["selected_calendar_ids"] == []
                assert session.get(CalendarEvent, "busy") is None and session.get(SyncMapping, "mapping") is None
            else:
                assert result["calendar_id"] == "old-app-calendar"
                assert session.get(CalendarEvent, "busy") and session.get(SyncMapping, "mapping")
    finally:
        if original is None:
            token.unlink(missing_ok=True)
        else:
            token.write_bytes(original)


@pytest.fixture
def google_oauth(monkeypatch):
    token = config.DATA / "google-token.json"
    original = token.read_bytes() if token.exists() else None
    token.unlink(missing_ok=True)
    flow = SimpleNamespace(
        credentials=SimpleNamespace(token="fixture-access-token", to_json=lambda: '{"token":"fixture-access-token"}'),
        fetch_token=lambda **kwargs: None,
    )
    monkeypatch.setattr(google_sync, "_flow", flow)
    monkeypatch.setattr(google_sync, "_auth_state", "valid-state")
    monkeypatch.setattr(google_sync, "_auth_started", time.monotonic())
    monkeypatch.setattr(google_sync, "_auth_url", "https://accounts.google.com/old-attempt")
    yield flow, token
    if original is None:
        token.unlink(missing_ok=True)
    else:
        token.write_bytes(original)


def mock_calendar_identity(monkeypatch, handler):
    original = httpx.Client
    transport = httpx.MockTransport(handler)
    monkeypatch.setattr(google_sync.httpx, "Client", lambda **kwargs: original(transport=transport, **kwargs))


def test_first_google_login_verifies_account_before_creating_connection(client, monkeypatch, google_oauth):
    _, token = google_oauth
    requests = []

    def identity(request):
        requests.append(request)
        assert request.method == "GET" and request.url.path == "/calendar/v3/users/me/calendarList"
        if request.url.params.get("pageToken") == "second":
            return httpx.Response(200, json={"items": [{"id": "first@example.test", "primary": True}]})
        return httpx.Response(200, json={"items": [], "nextPageToken": "second"})

    mock_calendar_identity(monkeypatch, identity)
    response = client.get(
        "/api/v1/google/callback", params={"code": "fixture-code", "state": "valid-state"}, follow_redirects=False
    )
    assert response.status_code == 307 and response.headers["location"] == "/?google=connected#connections"
    assert len(requests) == 2 and token.exists()
    with Session() as session:
        assert google_sync.status(session)["connected"]
        assert google_sync.connection(session).data["account_id"] == "first@example.test"
    assert google_sync._flow is None and google_sync._auth_url is None


def test_google_identity_can_reauthorize_during_old_token_backoff_but_respects_budget(
    client, monkeypatch, google_oauth
):
    flow, _ = google_oauth
    with transaction() as session:
        session.add(CalendarConnection(id="google", data={"retry_at": sync_policy.stamp(sync_policy.clock() + 900)}))
    requests = []
    mock_calendar_identity(
        monkeypatch,
        lambda request: (
            requests.append(request)
            or httpx.Response(200, json={"items": [{"id": "account@example.test", "primary": True}]})
        ),
    )
    with pytest.raises(sync_policy.Deferred):
        sync_policy.reserve_request()
    assert google_sync.account_id(flow.credentials) == "account@example.test"
    with transaction() as session:
        connection = google_sync.connection(session)
        usage = sync_policy.budget(connection.data)
        assert usage["day_used"] == 1
        connection.data = {**connection.data, "api_budget": {**usage, "day_used": sync_policy.DAY_LIMIT}}
    with pytest.raises(sync_policy.Deferred):
        google_sync.account_id(flow.credentials)
    assert len(requests) == 1


@pytest.mark.parametrize("failure", ["identity", "exchange", "quota"])
def test_google_oauth_failure_preserves_connection_and_next_login_gets_fresh_flow(
    client, monkeypatch, google_oauth, failure, tmp_path
):
    flow, token = google_oauth
    token.write_text('{"token":"previous-private-token"}')
    previous = {"account_id": "old@example.test", "calendar_id": "keep-calendar"}
    with transaction() as session:
        session.add(CalendarConnection(id="google", data=previous.copy()))
        if failure == "quota":
            connection = google_sync.connection(session)
            previous = {**previous, "budget_retry_at": sync_policy.stamp(sync_policy.clock() + 60)}
            connection.data = previous.copy()
    requests = []
    mock_calendar_identity(
        monkeypatch,
        lambda request: requests.append(request) or httpx.Response(403, json={"error": "private-provider-detail"}),
    )
    if failure == "exchange":

        def fail_exchange(**kwargs):
            raise ValueError("private-provider-detail")

        flow.fetch_token = fail_exchange
    response = client.get(
        "/api/v1/google/callback", params={"code": "private-code", "state": "valid-state"}, follow_redirects=False
    )
    assert response.status_code == 307
    assert response.headers["location"] == (
        "/?google=limited#connections" if failure == "quota" else "/?google=failed#connections"
    )
    assert "private" not in response.text and "private" not in response.headers["location"]
    assert token.read_text() == '{"token":"previous-private-token"}'
    with Session() as session:
        data = google_sync.connection(session).data
        assert {key: data[key] for key in previous} == previous
    assert google_sync._flow is None and google_sync._auth_state is None and google_sync._auth_url is None
    assert len(requests) == (1 if failure == "identity" else 0)
    assert client.get("/api/v1/google/callback?code=reused&state=valid-state").status_code == 400

    client_file = tmp_path / "google-client.json"
    client_file.write_text(
        json.dumps(
            {
                "installed": {
                    "client_id": "fixture-client",
                    "client_secret": "fixture-secret",
                    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                    "token_uri": "https://oauth2.googleapis.com/token",
                }
            }
        )
    )
    monkeypatch.setattr(google_sync, "client_path", lambda: client_file)
    response = client.post("/api/v1/google/authorize")
    assert response.status_code == 200 and response.json()["url"] != "https://accounts.google.com/old-attempt"
    assert google_sync._flow is not flow and google_sync._auth_state != "valid-state"
