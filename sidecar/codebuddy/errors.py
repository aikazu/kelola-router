"""Error codes and exceptions for CodeBuddy sidecar."""

from __future__ import annotations

from enum import Enum


class ErrorCode(str, Enum):
    # Auth errors
    auth_temporary_failure = "auth_temporary_failure"
    auth_account_locked = "auth_account_locked"
    auth_account_suspended = "auth_account_suspended"

    # Input errors
    input_invalid_format = "input_invalid_format"
    input_missing_required_field = "input_missing_required_field"

    # HTTP errors
    http_429 = "http_429"
    http_5xx = "http_5xx"

    # Network errors
    network_connection_error = "network_connection_error"
    network_timeout = "network_timeout"

    # Browser errors
    browser_unexpected_state = "browser_unexpected_state"
    browser_challenge_blocked = "browser_challenge_blocked"

    # Provider errors
    provider_unsupported_response = "provider_unsupported_response"
    provider_token_exchange_failed = "provider_token_exchange_failed"


class BatcherError(Exception):
    def __init__(self, code: ErrorCode, message: str):
        self.code = code
        self.message = message
        super().__init__(f"[{code.value}] {message}")


class RetryableBatcherError(BatcherError):
    """Error that can be retried (transient failures)."""
    pass


class NonRetryableBatcherError(BatcherError):
    """Error that should not be retried (permanent failures)."""
    pass
