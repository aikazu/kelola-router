from __future__ import annotations

import asyncio
import os
import time
from datetime import datetime, timedelta
from typing import Any
from urllib.parse import parse_qs, urlparse

import aiohttp

from errors import ErrorCode
from errors import NonRetryableBatcherError, RetryableBatcherError
from base import NormalizedAccount, ProviderAdapter

from config import (
    _EMAIL_PATTERN,
    CODEBUDDY_BASE_URL,
    CODEBUDDY_FETCH_QUOTA_ENABLED,
    CODEBUDDY_PLATFORM,
    CODEBUDDY_REDIRECT_SCHEME,
    CODEBUDDY_STATE_ENDPOINT,
    CODEBUDDY_USER_RESOURCE_ENDPOINT,
)
from utils import (
    _codebuddy_auth_debug,
    _codebuddy_auth_debug_enabled,
    _get_proxy_url,
    _make_session,
    _req_proxy,
)
from google_oauth import (
    _click_continue_button,
    _click_google_account_in_picker,
    _detect_google_text_captcha,
    _fill_google_email_step,
    _fill_google_password_step,
    _is_email_step,
    _is_google_account_picker,
    _is_password_step,
    _wait_for_google_text_captcha_input,
)
from page_helpers import (
    _build_cookie_header_from_page,
    _get_codebuddy_login_iframe,
    _handle_codebuddy_email_verification,
    _handle_codebuddy_landing,
    _handle_google_consent_continue,
    _handle_google_gaplustos,
    _handle_google_something_went_wrong,
    _save_cookies_to_file,
)
from api import (
    _claim_bonus,
    _codebuddy_request_via_page,
    _create_api_key_via_page,
    _credit_from_resource_payload,
    _ensure_region_with_retry,
    _fetch_console_accounts,
    _fetch_console_accounts_via_page,
    _fetch_user_resource_credit_via_page,
    _open_codebuddy_usage_page,
    _scrape_usage_credits_from_html,
    _submit_region_via_page,
    _wait_activity_credits,
)


class CodeBuddyProviderAdapter(ProviderAdapter):
    name = "codebuddy"

    async def parse_account(self, raw_line: str) -> NormalizedAccount:
        parts = [part.strip() for part in raw_line.split("|")]

        if len(parts) not in (2, 3):
            raise NonRetryableBatcherError(
                ErrorCode.input_invalid_format,
                "codebuddy account must be email|password or email|password|workspace_id",
            )

        email = parts[0]
        password = parts[1]
        workspace_id = parts[2] if len(parts) == 3 else ""

        if not email or not password:
            raise NonRetryableBatcherError(
                ErrorCode.input_missing_required_field,
                "codebuddy account requires email and password",
            )

        if not _EMAIL_PATTERN.match(email):
            raise NonRetryableBatcherError(
                ErrorCode.input_invalid_format,
                "codebuddy account email format is invalid",
            )

        metadata: dict[str, str] = {}
        if workspace_id:
            metadata["workspace_id"] = workspace_id

        return NormalizedAccount(
            provider=self.name,
            identifier=email,
            secret=password,
            metadata=metadata,
            raw=raw_line,
        )

    async def bootstrap_session(self, account: NormalizedAccount) -> Any:
        if os.getenv("BATCHER_ENABLE_CAMOUFOX", "false").lower() != "true":
            return {"stub": True}

        try:
            from browserforge.fingerprints import Screen
            from camoufox.async_api import AsyncCamoufox

            camoufox_kwargs = {
                "headless": os.getenv("BATCHER_CAMOUFOX_HEADLESS", "true").lower() == "true",
                "os": "windows",
                "block_webrtc": True,
                "disable_coop": True,
                "humanize": False,
                "screen": Screen(max_width=1920, max_height=1080),
            }
            proxy_url = _get_proxy_url()
            if proxy_url:
                from urllib.parse import urlparse as _urlparse

                _parsed = _urlparse(proxy_url)
                _proxy_cfg = {
                    "server": f"{_parsed.scheme}://{_parsed.hostname}:{_parsed.port}"
                }
                if _parsed.username:
                    _proxy_cfg["username"] = _parsed.username
                if _parsed.password:
                    _proxy_cfg["password"] = _parsed.password
                camoufox_kwargs["proxy"] = _proxy_cfg
                camoufox_kwargs["geoip"] = True
            manager = AsyncCamoufox(**camoufox_kwargs)
            browser = await manager.__aenter__()
            page = await browser.new_page()
            page.set_default_timeout(15000)

            await page.goto(
                CODEBUDDY_BASE_URL, wait_until="domcontentloaded", timeout=20000
            )
            await asyncio.sleep(1.0)

            _codebuddy_auth_debug("fetching auth/state via page.evaluate()")
            status, payload, body_text = await _codebuddy_request_via_page(
                page, "POST", CODEBUDDY_STATE_ENDPOINT, body={}
            )

            if status >= 500:
                raise RetryableBatcherError(
                    ErrorCode.http_5xx,
                    f"codebuddy auth/state server error ({status})",
                )
            if status == 429:
                raise RetryableBatcherError(
                    ErrorCode.http_429, "codebuddy auth/state rate limited"
                )
            if status != 200 or not isinstance(payload, dict):
                raise NonRetryableBatcherError(
                    ErrorCode.provider_unsupported_response,
                    f"codebuddy auth/state rejected request ({status}): {body_text[:120]}",
                )

            if payload.get("code") != 0:
                raise RetryableBatcherError(
                    ErrorCode.auth_temporary_failure,
                    f"codebuddy auth/state returned code={payload.get('code')}",
                )

            data = payload.get("data") or {}
            state = str(data.get("state") or "").strip()
            auth_url = str(data.get("authUrl") or "").strip()
            if not state or not auth_url:
                raise NonRetryableBatcherError(
                    ErrorCode.provider_unsupported_response,
                    "codebuddy auth/state missing state or authUrl",
                )

            _codebuddy_auth_debug(
                f"auth/state via page ok state={state[:20]}... authUrl={auth_url[:60]}..."
            )
            await page.goto(auth_url, wait_until="domcontentloaded", timeout=20000)

            return {
                "stub": False,
                "manager": manager,
                "browser": browser,
                "page": page,
                "state": state,
                "auth_url": auth_url,
                "auth_started_at": time.time(),
                "account": account.identifier,
            }
        except (RetryableBatcherError, NonRetryableBatcherError):
            raise
        except Exception as exc:
            raise RetryableBatcherError(
                ErrorCode.network_connection_error,
                f"codebuddy bootstrap error: {exc}",
            ) from exc

    async def authenticate(
        self, account: NormalizedAccount, session: Any
    ) -> dict[str, Any]:
        if session is None or session.get("stub"):
            if "timeout" in account.identifier:
                raise RetryableBatcherError(
                    ErrorCode.network_timeout, "codebuddy timeout"
                )
            if "locked" in account.identifier:
                raise NonRetryableBatcherError(
                    ErrorCode.auth_account_locked,
                    "codebuddy account locked",
                )
            return {"authenticated": True, "state": "stub-state"}

        page = session.get("page")
        if page is None:
            raise RetryableBatcherError(
                ErrorCode.browser_unexpected_state, "missing browser page"
            )

        state = session.get("state", "")
        if not state:
            raise NonRetryableBatcherError(
                ErrorCode.provider_unsupported_response,
                "codebuddy session missing auth state",
            )

        # CodeBuddy login uses an iframe landing (checkbox + Google button) before Google auth form.
        for _ in range(10):
            try:
                current_url = page.url
            except Exception:
                current_url = ""
            if "accounts.google.com" in current_url:
                break
            landing_clicked = await _handle_codebuddy_landing(page)
            if landing_clicked:
                await asyncio.sleep(0.8)
                break
            await asyncio.sleep(0.3)

        email_transition_deadline = 0.0
        password_transition_deadline = 0.0
        region_transition_deadline = 0.0
        landing_transition_deadline = 0.0
        email_step_started_at: float | None = None
        _codebuddy_base_netloc = urlparse(CODEBUDDY_BASE_URL).netloc

        for _ in range(150):
            try:
                current_url = page.url
            except Exception:
                current_url = ""
            parsed_url = urlparse(current_url) if current_url else None
            current_host = parsed_url.netloc if parsed_url else ""
            current_path = parsed_url.path if parsed_url else ""
            on_google_auth = "accounts.google.com" in current_host
            on_codebuddy_login = (
                current_host == _codebuddy_base_netloc
                and current_path.startswith("/login")
            )
            on_codebuddy_region = (
                current_host == _codebuddy_base_netloc
                and current_path.startswith("/register/user/complete")
            )
            # Detect redirect back to CodeBuddy home/root (not login, not region, not started)
            # This happens when Google account picker times out and browser redirects to CodeBuddy home
            _codebuddy_non_auth_paths = ("/", "", "/index.html", "/home")
            on_codebuddy_home = (
                current_host == _codebuddy_base_netloc
                and not on_codebuddy_login
                and not on_codebuddy_region
                and current_path.rstrip("/") in ("", "/index.html", "/home")
                or (
                    current_host == _codebuddy_base_netloc and current_path in ("/", "")
                )
            )
            on_keycloak_auth = (
                current_host == _codebuddy_base_netloc
                and "/auth/realms/" in current_path
            )
            now = time.monotonic()

            if current_url:
                if (
                    current_host == urlparse(CODEBUDDY_BASE_URL).netloc
                    and current_path == "/started"
                ):
                    q = parse_qs(parsed_url.query)
                    if (
                        q.get("platform", [""])[0].upper() == CODEBUDDY_PLATFORM
                        and q.get("state", [""])[0] == state
                    ):
                        return {"authenticated": True, "state": state}

                if current_url.startswith(CODEBUDDY_REDIRECT_SCHEME):
                    return {"authenticated": True, "state": state}

                if current_host == _codebuddy_base_netloc and not on_google_auth:
                    try:
                        is_restricted = await page.evaluate(
                            """() => {
                                const text = (document.body && document.body.innerText) || '';
                                return text.includes('Account Access Restricted')
                                    || text.includes('temporarily restricted');
                            }"""
                        )
                    except Exception:
                        is_restricted = False
                    if is_restricted:
                        _codebuddy_auth_debug(
                            "Account Access Restricted page detected — "
                            "cookies still valid, bypassing UI restriction"
                        )
                        return {"authenticated": True, "state": state, "restricted_bypass": True}

                normalized_path = (current_path or "").strip().lower()
                unauthorized_paths = {
                    "/no-permission",
                    "/no-client-authorization",
                    "/no-client-authorize",
                }
                if normalized_path in unauthorized_paths:
                    raise NonRetryableBatcherError(
                        ErrorCode.auth_account_suspended,
                        f"codebuddy account unauthorized client access ({normalized_path})",
                    )

            is_verify_email_page = False
            if on_keycloak_auth:
                if "VERIFY_EMAIL" in current_url or "verify-email" in current_url.lower() or ("required-action" in current_path and "execution=VERIFY_EMAIL" in current_url):
                    is_verify_email_page = True
                if not is_verify_email_page:
                    try:
                        page_text = await page.text_content("body")
                        if page_text and ("verify your email" in page_text.lower() or "email verification" in page_text.lower()):
                            is_verify_email_page = True
                    except Exception:
                        pass

            if is_verify_email_page:
                _codebuddy_auth_debug(f"email verification page detected at {current_url[:100]}")
                verified = await _handle_codebuddy_email_verification(page)
                if verified:
                    _codebuddy_auth_debug("email verification completed, continuing auth flow")
                    landing_transition_deadline = time.monotonic() + 10.0
                    await asyncio.sleep(2.0)
                    continue
                else:
                    _codebuddy_auth_debug("email verification handler returned False, will retry next loop")
                    await asyncio.sleep(3.0)
                    continue

            if on_keycloak_auth and not is_verify_email_page:
                try:
                    error_el = await page.query_selector("#kc-error-message")
                    if error_el:
                        error_text = await error_el.text_content()
                        _codebuddy_auth_debug(f"keycloak error page detected: {(error_text or '').strip()[:100]}")
                        auth_url = session.get("auth_url", "")
                        if auth_url:
                            _codebuddy_auth_debug(f"retrying auth from scratch: {auth_url[:80]}")
                            await asyncio.sleep(2.0)
                            await page.goto(auth_url, wait_until="domcontentloaded", timeout=20000)
                            landing_transition_deadline = time.monotonic() + 10.0
                            await asyncio.sleep(1.0)
                            continue
                        raise RetryableBatcherError(
                            ErrorCode.browser_unexpected_state,
                            f"keycloak error: {(error_text or 'unknown').strip()[:200]}",
                        )
                except RetryableBatcherError:
                    raise
                except Exception:
                    pass

            if await _handle_google_gaplustos(page):
                await asyncio.sleep(0.8)
                continue

            if await _handle_google_consent_continue(page):
                await asyncio.sleep(0.8)
                continue

            accounts_payload = await _fetch_console_accounts_via_page(page)
            cookie_header = await _build_cookie_header_from_page(
                page, CODEBUDDY_BASE_URL
            )
            if cookie_header and isinstance(session, dict):
                session["cookie_header"] = cookie_header

            if accounts_payload is None and cookie_header:
                accounts_payload = await _fetch_console_accounts(
                    cookie_header, current_url
                )
            if accounts_payload is not None:
                accounts_data = accounts_payload.get("data") or {}
                accounts = accounts_data.get("accounts") or []
                area_info_complete_raw = accounts_data.get("areaInfoComplete")
                area_info_complete = (
                    bool(area_info_complete_raw)
                    if area_info_complete_raw is not None
                    else False
                )
                _codebuddy_auth_debug(
                    "console accounts authenticated "
                    f"count={len(accounts)} path={current_path or '/'} "
                    f"areaInfoComplete={area_info_complete} raw={area_info_complete_raw!r}"
                )
                if cookie_header and isinstance(session, dict):
                    session["cookie_header"] = cookie_header

                if area_info_complete:
                    await _save_cookies_to_file(page, account.identifier)
                    return {"authenticated": True, "state": state}

                    continue

                await _save_cookies_to_file(page, account.identifier)
                return {"authenticated": True, "state": state}

            if on_codebuddy_region and now < region_transition_deadline:
                await asyncio.sleep(0.4)
                continue

            if on_codebuddy_region:
                region_ok = await _ensure_region_with_retry(
                    page, account.identifier, max_retries=3
                )
                if region_ok:
                    region_transition_deadline = time.monotonic() + 8.0
                    await asyncio.sleep(0.8)
                    continue

                if CODEBUDDY_FORCE_REGION_POST_AUTH:
                    forced = await _submit_region_via_page(page)
                    if forced:
                        region_transition_deadline = time.monotonic() + 8.0
                        await asyncio.sleep(0.8)
                        continue

                await asyncio.sleep(0.6)
                continue

            if on_codebuddy_login:
                await _handle_codebuddy_landing(page)

            # When redirected back to CodeBuddy home after a Google timeout/re-auth,
            # need to click ToS checkbox + Google login button again to restart the flow.
            if on_codebuddy_home and now >= landing_transition_deadline:
                _codebuddy_auth_debug(
                    f"codebuddy home detected (path={current_path!r}), re-triggering landing click"
                )
                landing_clicked = await _handle_codebuddy_landing(page)
                if landing_clicked:
                    _codebuddy_auth_debug(
                        "re-triggered codebuddy landing click on home page"
                    )
                    landing_transition_deadline = time.monotonic() + 12.0
                    await asyncio.sleep(1.5)
                    continue
                # If no landing elements found, try clicking generic buttons for this page
                await _click_continue_button(page)
                landing_transition_deadline = time.monotonic() + 8.0
                await asyncio.sleep(1.0)
                continue

            if on_codebuddy_home and now < landing_transition_deadline:
                await asyncio.sleep(0.5)
                continue

            if on_keycloak_auth and not is_verify_email_page and now >= landing_transition_deadline:
                _codebuddy_auth_debug(
                    f"keycloak auth page detected (path={current_path!r}), clicking Google login"
                )
                landing_clicked = await _handle_codebuddy_landing(page)
                if landing_clicked:
                    _codebuddy_auth_debug("clicked Google login on keycloak page")
                    landing_transition_deadline = time.monotonic() + 10.0
                    await asyncio.sleep(2.0)
                    continue
                await asyncio.sleep(1.0)
                continue

            if on_keycloak_auth and not is_verify_email_page and now < landing_transition_deadline:
                await asyncio.sleep(0.5)
                continue

            target = page
            if on_codebuddy_login:
                iframe = await _get_codebuddy_login_iframe(page)
                if iframe is not None:
                    target = iframe

            google_target = page if on_google_auth else target

            at_password_step = await _is_password_step(google_target)
            at_email_step = await _is_email_step(google_target)

            # Only check for account picker when neither email nor password fields are active.
            # This prevents the picker from falsely matching the password page.
            at_account_picker = False
            if on_google_auth and not at_password_step and not at_email_step:
                at_account_picker = await _is_google_account_picker(google_target)

            if on_google_auth:
                dismissed = await _handle_google_something_went_wrong(page)
                if dismissed:
                    _codebuddy_auth_debug("Google 'Something went wrong' dismissed, retrying")
                    await asyncio.sleep(3.0)
                    continue

            if on_google_auth and at_account_picker:
                _codebuddy_auth_debug(
                    f"google account picker detected, clicking account={account.identifier}"
                )
                account_clicked = await _click_google_account_in_picker(
                    google_target, account.identifier
                )
                if account_clicked:
                    _codebuddy_auth_debug("google account clicked in picker")
                    await asyncio.sleep(2.0)
                    continue
                else:
                    _codebuddy_auth_debug(
                        "google account not found in picker, trying generic click"
                    )
                    await _click_continue_button(google_target)
                    await asyncio.sleep(1.5)
                    continue

            if on_google_auth:
                text_captcha_marker = await _detect_google_text_captcha(page)
                if text_captcha_marker:
                    challenge_step = ""
                    if at_password_step:
                        challenge_step = "password"
                    elif at_email_step:
                        challenge_step = "email"
                    handled = await _wait_for_google_text_captcha_input(
                        page, session, text_captcha_marker, challenge_step, account
                    )
                    if handled:
                        await asyncio.sleep(1.0)
                        continue

            email_filled = False
            if on_google_auth and at_email_step and not at_password_step:
                if email_step_started_at is None:
                    email_step_started_at = now
                elif now - email_step_started_at > 120.0:
                    raise RetryableBatcherError(
                        ErrorCode.browser_challenge_blocked,
                        "codebuddy captcha suspected: email step stuck > 120s",
                    )
                if now < email_transition_deadline:
                    await asyncio.sleep(0.4)
                    continue
                # Use proven batch-adder strategy for Google email step:
                # wait_for_selector -> fill -> type -> verify -> press Enter.
                email_filled = await _fill_google_email_step(page, account.identifier)
            if email_filled:
                email_transition_deadline = time.monotonic() + 6.0
                await asyncio.sleep(0.2)
                await asyncio.sleep(1.0)
                continue

            password_filled = False
            if on_google_auth and at_password_step:
                email_step_started_at = None
                if now < password_transition_deadline:
                    await asyncio.sleep(0.4)
                    continue
                # Use proven batch-adder strategy for Google password step.
                password_filled = await _fill_google_password_step(page, account.secret)
            if password_filled:
                password_transition_deadline = time.monotonic() + 8.0
                await asyncio.sleep(0.2)
                await asyncio.sleep(1.0)
                continue

            # Strict guard: never click generic continue when login fields exist but
            # we failed to validate filled input.
            if on_google_auth and (at_email_step or at_password_step):
                await asyncio.sleep(0.6)
                continue
            if not on_google_auth:
                email_step_started_at = None

            await _click_continue_button(target)
            if target is not page:
                await _click_continue_button(page)
            await asyncio.sleep(1.0)

        raise RetryableBatcherError(
            ErrorCode.auth_temporary_failure,
            "codebuddy browser auth did not reach started callback in time",
        )

    async def fetch_tokens(
        self,
        account: NormalizedAccount,
        auth_state: dict[str, Any],
        session: Any,
    ) -> dict[str, str]:
        state = str(auth_state.get("state") or "")
        if session is None or session.get("stub"):
            return {
                "api_key": "stub-api-key",
                "state": state or "stub-state",
            }

        if not state:
            raise NonRetryableBatcherError(
                ErrorCode.provider_unsupported_response,
                "codebuddy auth state missing for API key creation",
            )

        page = session.get("page") if isinstance(session, dict) else None
        if not page:
            raise NonRetryableBatcherError(
                ErrorCode.provider_unsupported_response,
                "codebuddy browser session missing",
            )

        _codebuddy_auth_debug("API-only flow: set region + create key via page.evaluate()")

        await _submit_region_via_page(page)
        await asyncio.sleep(1.0)

        accounts_payload = await _fetch_console_accounts_via_page(page)
        user_enterprise_id = "personal-edition-user-id"
        user_id = ""
        if accounts_payload is not None:
            accounts_data = accounts_payload.get("data") or {}
            accounts = accounts_data.get("accounts") or []
            if accounts:
                user_enterprise_id = str(
                    accounts[0].get("userEnterpriseId")
                    or "personal-edition-user-id"
                )
                user_id = str(accounts[0].get("uid") or "")

        if user_id:
            register_url = (
                f"{CODEBUDDY_BASE_URL}/auth/realms/copilot/overseas"
                f"/user/register?userId={user_id}"
            )
            await _codebuddy_request_via_page(page, "GET", register_url)

        trial_url = f"{CODEBUDDY_BASE_URL}/billing/ide/trial"
        await _codebuddy_request_via_page(page, "POST", trial_url)
        await asyncio.sleep(1.0)

        _codebuddy_auth_debug("creating API key via page.evaluate()")
        api_key = await _create_api_key_via_page(page, user_enterprise_id)

        if not api_key:
            raise RetryableBatcherError(
                ErrorCode.provider_token_exchange_failed,
                "codebuddy failed to create API key",
            )

        await _save_cookies_to_file(page, account.identifier)
        _codebuddy_auth_debug("API key created, cookies saved")

        return {"api_key": api_key, "state": state}

    async def fetch_quota(
        self,
        account: NormalizedAccount,
        tokens: dict[str, str],
        session: Any,
    ) -> dict[str, Any] | None:
        _ = account

        page = session.get("page") if isinstance(session, dict) else None
        if page is None:
            return None

        try:
            await page.goto(
                f"{CODEBUDDY_BASE_URL}/profile",
                wait_until="domcontentloaded",
                timeout=15000,
            )
            await asyncio.sleep(1.0)
        except Exception:
            pass

        _codebuddy_auth_debug("VIP: checking gift claim via API")
        gift_claimed, gift_credits = await self._try_claim_gift_via_api(page)

        _codebuddy_auth_debug("VIP: fetching credit via API (get-user-resource)")
        for attempt in range(3):
            if attempt > 0:
                _codebuddy_auth_debug(f"credit API retry {attempt + 1}/3")
                await asyncio.sleep(1.0 + attempt)

            credit_summary = await _fetch_user_resource_credit_via_page(page)
            if credit_summary:
                if gift_claimed:
                    credit_summary["gift_claimed"] = True
                    credit_summary["gift_credits"] = gift_credits
                _codebuddy_auth_debug(
                    f"credit API success: dosage={credit_summary.get('credit_total_dosage')} "
                    f"remain={credit_summary.get('credit_capacity_remain')} "
                    f"size={credit_summary.get('credit_capacity_size')}"
                )
                return credit_summary

        _codebuddy_auth_debug(
            "VIP: credit API failed, falling back to browser claim + scrape"
        )
        opened = await _open_codebuddy_usage_page(page)
        if not opened:
            return None

        await asyncio.sleep(3.0)

        claimed = False
        for claim_attempt in range(3):
            claimed = await _claim_bonus(page)
            if claimed:
                break
            if claim_attempt < 2:
                _codebuddy_auth_debug(
                    f"claim attempt {claim_attempt + 1}/3 — button not ready, waiting..."
                )
                await asyncio.sleep(2.0)
        if claimed:
            _codebuddy_auth_debug("waiting for activity credits to appear")
            await _wait_activity_credits(page, timeout=30.0)
            await asyncio.sleep(2.0)

        for page_attempt in range(3):
            if page_attempt > 0:
                try:
                    await page.reload(wait_until="domcontentloaded")
                    try:
                        await page.wait_for_load_state("networkidle", timeout=12000)
                    except Exception:
                        pass
                    await asyncio.sleep(2.0 + page_attempt)
                except Exception:
                    pass

            credit_summary = await _scrape_usage_credits_from_html(page)
            if credit_summary:
                return credit_summary

        _codebuddy_auth_debug("VIP: credit fetch failed (API + browser)")
        return None

    async def _try_claim_gift_via_api(self, page: Any) -> tuple[bool, float]:
        check_url = f"{CODEBUDDY_BASE_URL}/billing/meter/check-gift-claimed"
        claim_url = f"{CODEBUDDY_BASE_URL}/billing/meter/claim-gift"

        try:
            result = await page.evaluate(
                """async (url) => {
                    try {
                        const resp = await fetch(url, {
                            method: 'POST',
                            credentials: 'include',
                            headers: {
                                'Accept': 'application/json, text/plain, */*',
                                'Content-Type': 'application/json',
                                'X-Requested-With': 'XMLHttpRequest',
                            },
                        });
                        const json = await resp.json();
                        return { status: resp.status, json };
                    } catch (err) {
                        return { status: 0, json: null };
                    }
                }""",
                check_url,
            )
        except Exception as exc:
            _codebuddy_auth_debug(f"VIP: check-gift API error={exc}")
            return False, 0

        payload = result.get("json") or {}
        data = payload.get("data") or {}
        claimed = data.get("claimed", True)
        active = data.get("active", False)
        credit_num = float(data.get("credit_num", 0))

        _codebuddy_auth_debug(
            f"VIP: check-gift claimed={claimed} active={active} credit_num={credit_num}"
        )

        if claimed or not active:
            return False, 0

        _codebuddy_auth_debug(f"VIP: claiming {credit_num} credits via API")
        await asyncio.sleep(1.0)

        try:
            result = await page.evaluate(
                """async (url) => {
                    try {
                        const resp = await fetch(url, {
                            method: 'POST',
                            credentials: 'include',
                            headers: {
                                'Accept': 'application/json, text/plain, */*',
                                'Content-Type': 'application/json',
                                'X-Requested-With': 'XMLHttpRequest',
                            },
                        });
                        const json = await resp.json();
                        return { status: resp.status, json };
                    } catch (err) {
                        return { status: 0, json: null };
                    }
                }""",
                claim_url,
            )
        except Exception as exc:
            _codebuddy_auth_debug(f"VIP: claim-gift API error={exc}")
            return False, 0

        claim_payload = result.get("json") or {}
        success = claim_payload.get("code") == 0
        _codebuddy_auth_debug(f"VIP: claim-gift success={success} credits={credit_num}")

        if success:
            await asyncio.sleep(2.0)

        return success, credit_num

    async def _fetch_user_resource_credit(
        self, cookie_header: str
    ) -> dict[str, float] | None:
        if not cookie_header.strip():
            return None

        timeout = aiohttp.ClientTimeout(total=20)
        now = datetime.utcnow()
        payload_body = {
            "PageNumber": 1,
            "PageSize": 100,
            "ProductCode": "p_tcaca",
            "Status": [0, 3],
            "PackageEndTimeRangeBegin": now.strftime("%Y-%m-%d %H:%M:%S"),
            "PackageEndTimeRangeEnd": (now + timedelta(days=365 * 20)).strftime(
                "%Y-%m-%d %H:%M:%S"
            ),
        }
        web_headers = {
            "Cookie": cookie_header,
            "Accept": "application/json, text/plain, */*",
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
            "Referer": f"{CODEBUDDY_BASE_URL}/profile/usage",
            "Origin": CODEBUDDY_BASE_URL,
            "X-Requested-With": "XMLHttpRequest",
            "X-Domain": urlparse(CODEBUDDY_BASE_URL).netloc,
        }

        async with _make_session(timeout, web_headers) as web_client:
            async with web_client.post(
                CODEBUDDY_USER_RESOURCE_ENDPOINT,
                json=payload_body,
                proxy=_req_proxy(web_client),
            ) as resp:
                if resp.status != 200:
                    _codebuddy_auth_debug(f"credit via cookie status={resp.status}")
                    return None
                resource_payload = await resp.json()
        if _codebuddy_auth_debug_enabled():
            _codebuddy_auth_debug(
                f"credit via cookie code={resource_payload.get('code')}"
            )
        return _credit_from_resource_payload(resource_payload)

    async def refresh_saved_credit(
        self, metadata: dict[str, Any]
    ) -> dict[str, Any] | None:
        cookie_header = str(metadata.get("web_cookie") or "").strip()
        if not cookie_header:
            tokens = metadata.get("tokens") or {}
            if isinstance(tokens, dict):
                cookie_header = str(tokens.get("web_cookie") or "").strip()
        if not cookie_header:
            return None
        return await self._fetch_user_resource_credit(cookie_header)

    async def cleanup_session(self, session: Any) -> None:
        if not isinstance(session, dict):
            return

        manager = session.get("manager")
        if manager is None:
            return

        try:
            await manager.__aexit__(None, None, None)
        except Exception:
            return
