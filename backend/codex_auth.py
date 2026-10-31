"""Local managed sign-in; no inference, password collection or CLI-wide logout."""

import queue
import shutil
import threading
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

from sqlalchemy import select

from . import codex_runtime, domain
from .db import Session
from .models import ChatThread, OutboxJob

_lock = threading.RLock()
_pending = None
_cache = None
_cached_at = 0
_notice = ""
LOGIN_TIMEOUT = 600


class AuthJob:
    def __init__(self):
        self.cancelled = threading.Event()
        self.notifications = []

    def event(self, server, message):
        self.notifications.append(message)


def _server(mode):
    from .chat import AppServer

    server = AppServer(auth_mode=mode)
    job = AuthJob()
    try:
        server.request(
            "initialize",
            {"clientInfo": {"name": "hba_studio", "title": "HBA Studio", "version": "0.1.0"}, "capabilities": {}},
            job,
            time.monotonic() + 15,
        )
        server.send({"method": "initialized", "params": {}})
        return server, job
    except Exception:
        server.close()
        raise


def _account(server, job):
    account = server.request("account/read", {"refreshToken": False}, job, time.monotonic() + 10).get("account")
    # Explicit allowlist: never return tokens or arbitrary provider payloads to the browser.
    if not account:
        return None
    return {"type": account.get("type"), "email": account.get("email"), "plan": account.get("planType")}


def _idle():
    with Session() as session:
        if any(row.data.get("status") == "running" for row in session.scalars(select(ChatThread))):
            domain.fail("Hãy chờ Codex trả lời xong trước khi đổi kết nối.", 409)
        if any(
            row.data.get("status") == "running" and row.data.get("kind") in {"analysis", "ingest"}
            for row in session.scalars(select(OutboxJob))
        ):
            domain.fail("Hãy chờ tài liệu xử lý xong trước khi đổi kết nối Codex.", 409)


def _invalidate():
    global _cache, _cached_at
    _cache, _cached_at = None, 0


def _clear_pending(cancel=False):
    global _pending
    pending, _pending = _pending, None
    if not pending:
        return
    pending["timer"].cancel()
    try:
        if cancel:
            pending["server"].request(
                "account/login/cancel", {"loginId": pending["login_id"]}, pending["job"], time.monotonic() + 2
            )
    except Exception:
        pass
    finally:
        pending["server"].close()


def _expire(login_id):
    global _notice
    with _lock:
        if _pending and _pending["login_id"] == login_id:
            _clear_pending(cancel=True)
            _notice = "Phiên đăng nhập đã hết hạn. Bạn có thể thử lại."


def _drain():
    global _notice
    if not _pending:
        return
    pending = _pending
    messages = pending["job"].notifications
    pending["job"].notifications = []
    while True:
        try:
            message = pending["server"].events.get_nowait()
            if message is None:
                _notice = "Kết nối đăng nhập đã đóng. Hãy thử lại."
                _clear_pending()
                return
            messages.append(message)
        except queue.Empty:
            break
    for message in messages:
        if message.get("method") != "account/login/completed":
            continue
        params = message.get("params", {})
        if params.get("loginId") != pending["login_id"]:
            continue
        if params.get("success"):
            try:
                if not _account(pending["server"], pending["job"]):
                    raise RuntimeError("Account missing")
                codex_runtime.select("app")
                _notice = ""
            except Exception:
                _notice = "Chưa xác nhận được tài khoản. Hãy thử kết nối lại."
        else:
            _notice = "Đăng nhập chưa hoàn tất. Bạn có thể thử lại."
        _clear_pending()
        _invalidate()
        return


def _watch_pending(login_id):
    # Completion is owned by the backend even when the connection panel closes.
    while True:
        with _lock:
            if not _pending or _pending["login_id"] != login_id:
                return
            _drain()
        time.sleep(0.5)


def status():
    global _cache, _cached_at
    with _lock:
        _drain()
        mode = codex_runtime.selection()["mode"]
        installed = bool(shutil.which("codex"))
        from os import environ

        enabled = environ.get("PDM_AGENT_ENABLED") != "0"
        result = {
            "installed": installed,
            "enabled": enabled,
            "source": mode,
            "connected": False,
            "account": None,
            "error": _notice,
            "pending": None,
        }
        if installed and enabled and mode != "off":
            if _cache is None or time.monotonic() - _cached_at > 30:
                server = None
                try:
                    server, job = _server(mode)
                    _cache = {"account": _account(server, job), "error": ""}
                except Exception:
                    _cache = {"account": None, "error": "Chưa kiểm tra được Codex. Hãy thử làm mới kết nối."}
                finally:
                    if server:
                        server.close()
                _cached_at = time.monotonic()
            result.update(
                account=_cache["account"], connected=bool(_cache["account"]), error=_notice or _cache["error"]
            )
        if _pending:
            result["pending"] = {key: _pending[key] for key in ("login_id", "url", "code", "expires_at", "method")}
        return result


def start(method="browser"):
    global _pending, _notice
    with _lock:
        _idle()
        from os import environ

        if environ.get("PDM_AGENT_ENABLED") == "0" or not shutil.which("codex"):
            domain.fail("Codex chưa sẵn sàng trên máy này. Hãy cài Codex và bật AI trước khi kết nối.", 503)
        if _pending:
            return status()
        server = None
        try:
            server, job = _server("app")
            params = {"type": "chatgptDeviceCode"} if method == "device" else {"type": "chatgpt"}
            response = server.request("account/login/start", params, job, time.monotonic() + 30)
            url = response.get("verificationUrl") if method == "device" else response.get("authUrl")
            parsed = urlparse(url or "")
            if (
                parsed.scheme != "https"
                or parsed.hostname not in {"auth.openai.com", "chatgpt.com"}
                or not response.get("loginId")
            ):
                raise ValueError("Unexpected sign-in response")
            login_id = response["loginId"]
            timer = threading.Timer(LOGIN_TIMEOUT, _expire, args=(login_id,))
            timer.daemon = True
            _pending = {
                "server": server,
                "job": job,
                "timer": timer,
                "login_id": login_id,
                "url": url,
                "code": response.get("userCode"),
                "method": method,
                "expires_at": (datetime.now(timezone.utc) + timedelta(seconds=LOGIN_TIMEOUT)).isoformat(),
            }
            _notice = ""
            timer.start()
            threading.Thread(target=_watch_pending, args=(login_id,), daemon=True).start()
        except Exception:
            if server:
                server.close()
            domain.fail("Chưa mở được đăng nhập Codex. Hãy thử lại hoặc chọn đăng nhập bằng mã.", 503)
        return status()


def cancel():
    global _notice
    with _lock:
        _clear_pending(cancel=True)
        _notice = ""
        return status()


def use_system():
    with _lock:
        _idle()
        server = None
        try:
            server, job = _server("system")
            account = _account(server, job)
        except Exception:
            domain.fail("Chưa kiểm tra được Codex trên máy. Hãy thử lại.", 503)
        finally:
            if server:
                server.close()
        if not account:
            domain.fail("Chưa có phiên Codex đăng nhập trên máy.", 409)
        _clear_pending(cancel=True)
        codex_runtime.select("system")
        _invalidate()
        return status()


def disconnect():
    with _lock:
        _idle()
        _clear_pending(cancel=True)
        # A system session belongs to the CLI/IDE. Only forget its use in HBA.
        if codex_runtime.selection()["mode"] == "app":
            server = None
            try:
                server, job = _server("app")
                server.request("account/logout", {}, job, time.monotonic() + 10)
            except Exception:
                domain.fail("Chưa ngắt được kết nối Codex. Hãy thử lại.", 503)
            finally:
                if server:
                    server.close()
        codex_runtime.select("off")
        _invalidate()
        return status()


def shutdown():
    with _lock:
        _clear_pending(cancel=True)
