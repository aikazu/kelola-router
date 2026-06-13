#!/usr/bin/env python3
"""
CodeBuddy Sidecar — JSON-lines IPC interface for kelola-router.

Protocol:
  - Reads JSON commands from stdin (one per line)
  - Writes JSON events to stdout (one per line)
  - stderr is for debug/crash logs only

Commands:
  {"cmd": "login", "email": "...", "password": "...", "proxy": "socks5://..."}
  {"cmd": "refresh_token", "email": "...", "password": "...", "cookies_path": "..."}
  {"cmd": "check_quota", "email": "...", "cookies_path": "..."}
  {"cmd": "shutdown"}

Events:
  {"type": "progress", "step": "...", "message": "..."}
  {"type": "success", "credentials": {"api_key": "...", "cookies_path": "..."}, "quota": {...}}
  {"type": "error", "code": "...", "message": "...", "retryable": true/false}
  {"type": "ready"}
  {"type": "shutdown_ack"}
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path
from typing import Any

# Ensure sidecar directory is in path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from base import NormalizedAccount
from adapter import CodeBuddyProviderAdapter
from errors import RetryableBatcherError, NonRetryableBatcherError


def emit(event: dict[str, Any]) -> None:
    """Write a JSON event to stdout (one line)."""
    line = json.dumps(event, ensure_ascii=False)
    sys.stdout.write(line + "\n")
    sys.stdout.flush()


def emit_progress(step: str, message: str) -> None:
    emit({"type": "progress", "step": step, "message": message})


def emit_error(code: str, message: str, retryable: bool = True) -> None:
    emit({"type": "error", "code": code, "message": message, "retryable": retryable})


def emit_success(credentials: dict[str, str], quota: dict[str, Any] | None = None) -> None:
    emit({"type": "success", "credentials": credentials, "quota": quota})


async def handle_login(data: dict[str, Any]) -> None:
    """Full browser-based login flow."""
    email = data.get("email", "")
    password = data.get("password", "")
    proxy = data.get("proxy")

    if not email or not password:
        emit_error("input_missing_required_field", "email and password required", retryable=False)
        return

    # Set proxy env if provided
    if proxy:
        os.environ["BATCHER_PROXY_URL"] = proxy

    # Enable Camoufox
    os.environ["BATCHER_ENABLE_CAMOUFOX"] = "true"

    adapter = CodeBuddyProviderAdapter()
    account = NormalizedAccount(provider="codebuddy", identifier=email, secret=password)

    try:
        emit_progress("bootstrap", f"Launching browser for {email}...")
        session = await adapter.bootstrap_session(account)

        emit_progress("authenticate", "Browser session ready, starting Google OAuth...")
        auth_state = await adapter.authenticate(account, session)

        emit_progress("fetch_tokens", "Authenticated, creating API key...")
        tokens = await adapter.fetch_tokens(account, auth_state, session)

        quota = None
        try:
            emit_progress("fetch_quota", "Fetching quota...")
            quota = await adapter.fetch_quota(account, tokens, session)
        except Exception as e:
            emit_progress("quota_skip", f"Quota fetch skipped: {e}")

        # Determine cookies path
        from config import COOKIES_DIR
        import hashlib
        cookies_path = str(COOKIES_DIR / f"{hashlib.sha256(email.encode()).hexdigest()[:16]}.json")

        emit_success(
            credentials={"api_key": tokens.get("api_key", ""), "cookies_path": cookies_path},
            quota=quota,
        )

    except NonRetryableBatcherError as e:
        emit_error(e.code.value, e.message, retryable=False)
    except RetryableBatcherError as e:
        emit_error(e.code.value, e.message, retryable=True)
    except Exception as e:
        emit_error("network_connection_error", str(e), retryable=True)
    finally:
        try:
            await adapter.cleanup_session(session)
        except Exception:
            pass


async def handle_refresh_token(data: dict[str, Any]) -> None:
    """Cookie-based token refresh (no browser needed if cookies valid)."""
    email = data.get("email", "")
    password = data.get("password", "")
    cookies_path = data.get("cookies_path", "")

    if not email:
        emit_error("input_missing_required_field", "email required", retryable=False)
        return

    # Try cookie-based refresh first (fast path)
    if cookies_path and os.path.exists(cookies_path):
        emit_progress("cookie_refresh", "Attempting cookie-based refresh...")
        try:
            from api import _create_api_key_with_cookies
            from page_helpers import _load_cookies_from_file

            cookie_data = await _load_cookies_from_file(email)
            if cookie_data:
                api_key = await _create_api_key_with_cookies(cookie_data)
                if api_key:
                    emit_success(
                        credentials={"api_key": api_key, "cookies_path": cookies_path},
                        quota=None,
                    )
                    return
                emit_progress("cookie_expired", "Cookie refresh failed, falling back to browser...")
        except Exception as e:
            emit_progress("cookie_error", f"Cookie refresh error: {e}, falling back to browser...")

    # Fallback: full browser login
    if password:
        emit_progress("browser_fallback", "Starting full browser re-auth...")
        await handle_login({"email": email, "password": password, "proxy": data.get("proxy")})
    else:
        emit_error("auth_temporary_failure", "Cookies expired and no password provided for re-auth", retryable=True)


async def handle_check_quota(data: dict[str, Any]) -> None:
    """Check account quota via cookies (no browser)."""
    email = data.get("email", "")
    cookies_path = data.get("cookies_path", "")

    if not email:
        emit_error("input_missing_required_field", "email required", retryable=False)
        return

    try:
        adapter = CodeBuddyProviderAdapter()
        metadata = {"web_cookie": ""}

        # Load cookies and build cookie header
        if cookies_path and os.path.exists(cookies_path):
            with open(cookies_path, "r") as f:
                cookie_data = json.load(f)
            cookies = cookie_data.get("cookies", [])
            cookie_header = "; ".join(f"{c['name']}={c['value']}" for c in cookies if c.get("name") and c.get("value"))
            metadata["web_cookie"] = cookie_header

        quota = await adapter.refresh_saved_credit(metadata)
        if quota:
            emit({"type": "quota", **quota})
        else:
            emit_error("provider_unsupported_response", "Could not fetch quota", retryable=True)
    except Exception as e:
        emit_error("network_connection_error", f"Quota check failed: {e}", retryable=True)


async def main() -> None:
    """Main event loop — read commands from stdin, dispatch handlers."""
    emit({"type": "ready"})

    loop = asyncio.get_event_loop()

    while True:
        try:
            line = await loop.run_in_executor(None, sys.stdin.readline)
        except (EOFError, KeyboardInterrupt):
            break

        if not line:
            break

        line = line.strip()
        if not line:
            continue

        try:
            data = json.loads(line)
        except json.JSONDecodeError as e:
            emit_error("input_invalid_format", f"Invalid JSON: {e}", retryable=False)
            continue

        cmd = data.get("cmd", "")

        if cmd == "shutdown":
            emit({"type": "shutdown_ack"})
            break
        elif cmd == "login":
            await handle_login(data)
        elif cmd == "refresh_token":
            await handle_refresh_token(data)
        elif cmd == "check_quota":
            await handle_check_quota(data)
        else:
            emit_error("input_invalid_format", f"Unknown command: {cmd}", retryable=False)


if __name__ == "__main__":
    asyncio.run(main())
