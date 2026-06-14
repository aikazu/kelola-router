# CodeBuddy Sidecar

Python browser automation sidecar for kelola-router. Handles CodeBuddy account authentication, token refresh, and quota tracking via Camoufox (anti-detect Firefox).

## Architecture

```
kelola-router (TypeScript) ←→ main.py (JSON-lines IPC) ←→ Camoufox browser
```

- **90% of operations** = pure HTTP (cookie-based token refresh, no browser)
- **10% of operations** = browser automation (when cookies expire, re-auth needed)

## Prerequisites

- Python 3.11+
- ~500MB disk (Playwright Firefox + Camoufox + GeoIP database)
- Internet connection (for browser downloads on first setup)

## Setup

### Automated (recommended)

```bash
# Windows
setup.bat

# Linux/macOS/Git Bash
chmod +x setup.sh && ./setup.sh
```

### Manual

```bash
python -m venv .venv

# Windows
.venv\Scripts\pip.exe install -r requirements.txt
.venv\Scripts\python.exe -m playwright install firefox
.venv\Scripts\python.exe -m camoufox fetch

# Linux/macOS
.venv/bin/pip install -r requirements.txt
.venv/bin/python -m playwright install firefox
.venv/bin/python -m camoufox fetch
```

## IPC Protocol

Communication via JSON-lines over stdin/stdout.

### Commands (stdin → sidecar)

```jsonl
{"cmd": "login", "email": "...", "password": "...", "proxy": "socks5://..."}
{"cmd": "refresh_token", "email": "...", "password": "...", "cookies_path": "..."}
{"cmd": "check_quota", "email": "...", "cookies_path": "..."}
{"cmd": "shutdown"}
```

### Events (sidecar → stdout)

```jsonl
{"type": "ready"}
{"type": "progress", "step": "...", "message": "..."}
{"type": "success", "credentials": {"api_key": "sk-...", "cookies_path": "..."}, "quota": {...}}
{"type": "error", "code": "...", "message": "...", "retryable": true}
{"type": "quota", "credit_remain": 100, "credit_total": 500}
{"type": "shutdown_ack"}
```

### Error Codes

| Code | Retryable | Meaning |
|------|-----------|---------|
| `auth_temporary_failure` | ✅ | Transient auth failure, retry |
| `auth_account_locked` | ❌ | Account permanently locked |
| `auth_account_suspended` | ❌ | Account suspended |
| `network_connection_error` | ✅ | Network/timeout issue |
| `browser_challenge_blocked` | ❌ | Unresolvable browser challenge |
| `provider_token_exchange_failed` | ✅ | Token creation failed |
| `input_missing_required_field` | ❌ | Bad input |

## Token Refresh Strategy

1. **Fast path (no browser):** Load cookies → POST `/console/api/client/v1/api-keys` → new API key
2. **Slow path (browser):** Launch Camoufox → Google OAuth → extract cookies + API key

Fast path handles ~90% of cases. Browser only needed when cookies fully expire (every few days).

## Proxy

- **Login/registration:** NO proxy needed — Camoufox fingerprint + OAuth trusted app is sufficient
- **Inference (API calls):** Proxy handled by kelola-router's transport layer, not this sidecar

## Cookie Storage

Cookies stored in `cookies/` directory as JSON files:
- Filename: `<sha256_prefix_of_email>.json`
- Format: `{email, saved_at, expires_at, cookies: [...]}`

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CODEBUDDY_COOKIES_DIR` | `./cookies` | Cookie storage path |
| `BATCHER_CODEBUDDY_BASE_URL` | `https://www.codebuddy.ai` | CodeBuddy API base |
| `BATCHER_ENABLE_CAMOUFOX` | `true` | Use anti-detect browser |
| `BATCHER_CODEBUDDY_AUTH_DEBUG` | `false` | Enable debug logging |
| `BATCHER_PROXY_URL` | (none) | SOCKS5/HTTP proxy for browser (optional) |

## Troubleshooting

**Camoufox fetch fails:**
- Check internet connection
- Try: `.venv/Scripts/python.exe -m camoufox fetch --verbose`
- Behind corporate proxy: set `HTTPS_PROXY` env var

**Playwright install fails:**
- Try: `.venv/Scripts/python.exe -m playwright install firefox --with-deps`
- On Linux: may need system deps (`apt install libnss3 libatk-bridge2.0-0`)

**Login timeout:**
- Google may show CAPTCHA on suspicious IP
- Try with different IP or wait and retry
- Check `BATCHER_CODEBUDDY_AUTH_DEBUG=true` for detailed logs
