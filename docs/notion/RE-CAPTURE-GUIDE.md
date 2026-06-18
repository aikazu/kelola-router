# Notion Desktop AI Chat — RE Capture Guide

**Goal:** Capture Notion desktop AI chat traffic so we can reverse-engineer the endpoints, headers, body schema, SSE shape, and token lifecycle. Output: `docs/notion/capture-notes.md` + `tests/fixtures/notion/sample-stream.har`.

**Tools:** mitmproxy (HTTP/HTTPS intercept), Notion desktop client, browser (Chrome/Firefox) as fallback if desktop blocks MITM.

**Time:** ~30-45 min first run, ~10 min after you know the steps.

---

## Prerequisites

- [ ] Notion account with active AI subscription (otherwise AI chat returns 402)
- [ ] Notion desktop installed (https://www.notion.so/desktop) OR browser access to https://www.notion.so
- [ ] Python 3.9+ installed (mitmproxy is a Python package)
- [ ] Admin access on your machine (for installing cert + setting system proxy)

---

## Step 1: Install mitmproxy

```bash
pip install mitmproxy
```

Verify:

```bash
mitmproxy --version
# should print version 10+ or 11+
```

If `pip` is not on PATH, try `python -m pip install mitmproxy` or `pip3 install mitmproxy`.

---

## Step 2: Start mitmweb (the GUI version is easier than CLI)

```bash
mitmweb --set confdir=./.mitmproxy
```

This opens a browser tab at `http://127.0.0.1:8081` showing live traffic. The proxy itself listens on `127.0.0.1:8080`.

---

## Step 3: Install the mitmproxy CA certificate

mitmproxy intercepts HTTPS by generating a CA on the fly. Your OS / browser must trust this CA for traffic to flow without cert errors.

### macOS
```bash
# Open the cert that mitmproxy just generated:
open ~/.mitmproxy/mitmproxy-ca-cert.pem
# Keychain Access opens → System keychain → "Always Trust" on the cert
```

### Windows
```bash
# Double-click: %USERPROFILE%\.mitmproxy\mitmproxy-ca-cert.pem
# Install Certificate → Local Machine → Trusted Root Certification Authorities
```

### Linux (Debian/Ubuntu)
```bash
sudo cp ~/.mitmproxy/mitmproxy-ca-cert.pem /usr/local/share/ca-certificates/mitmproxy.crt
sudo update-ca-certificates
```

**Verify cert trust** by visiting `http://mitm.it` in your browser while mitmweb is running. It should load (showing mitmproxy's homepage) without cert warning.

---

## Step 4: Configure system proxy

Point your OS network settings to `127.0.0.1:8080` (HTTP+HTTPS proxy).

### macOS
System Settings → Network → [active interface] → Details → Proxies → check "Web Proxy (HTTP)" + "Secure Web Proxy (HTTPS)" → set both to `127.0.0.1:8080`.

### Windows
Settings → Network & Internet → Proxy → "Use a proxy server" → Address: `127.0.0.1`, Port: `8080` → Save.

### Linux (GNOME)
Settings → Network → Network Proxy → Manual → HTTP and HTTPS proxy: `127.0.0.1` port `8080`.

**Verify:** in mitmweb browser tab, you should now see traffic from your machine (e.g., update checks, telemetry).

---

## Step 5: Trigger AI chat in Notion

### Option A: Notion desktop

1. Launch Notion desktop (should connect via system proxy)
2. Sign in (mitmweb will show the login POST — **this is the OTP endpoint we need**, watch for `/login/sendOtp` or similar)
3. Open any page → press `/` → start typing "ai" → select the AI block option
4. Or: in any page, type text → select → right-click → "Ask AI"
5. Send 2-3 messages in the chat panel. Wait for one streaming response to complete.
6. Sign out and back in (forces a token refresh attempt — capture if it exists)

### Option B: Browser fallback

If desktop refuses to launch with proxy (some Electron apps pin certs):

1. Open Chrome/Firefox → already routed via system proxy
2. Go to https://www.notion.so/chat (or any page, invoke AI)
3. Same steps as desktop

mitmweb will show requests to `*.notion.com` and `*.notion.so`.

---

## Step 6: Filter and export HAR

In mitmweb:

1. Use the search/filter box to scope to `notion.com` or `notion.so` — this hides telemetry/static asset noise
2. Identify the key requests (see "What to look for" below)
3. Click each → verify it shows the AI chat request/response, not login page assets
4. File → **Export** → save as `sample-stream.har` to `tests/fixtures/notion/` in the kelola-router repo

If mitmweb's HAR export is broken, use mitmproxy CLI instead:

```bash
mitmdump -s export_har.py --set confdir=./.mitmproxy
```

where `export_har.py` is:

```python
from mitmproxy import ctx
import json

def response(flow):
    if 'notion.com' in flow.request.pretty_host or 'notion.so' in flow.request.pretty_host:
        ctx.log.info(f"Capture: {flow.request.method} {flow.request.pretty_url}")
```

Then dump via `mitmdump --wfile capture.flow` and convert with `har2.py` from mitmproxy's contrib scripts.

---

## Step 7: What to look for (the requests we need)

In mitmweb, after triggering AI chat, you should see entries like:

| URL pattern | Method | Why we need it |
|---|---|---|
| `/v1/login/sendOtp` or `/api/v3/login/sendOtp` | POST | OTP send endpoint — body `{ email }` |
| `/v1/login/verify` or similar | POST | OTP exchange — returns `token`, possibly `refresh_token`, `user_id`, `workspace_id` |
| `/v1/ai/chat` or `/api/ai/chat` | POST | The actual AI chat call. **This is the main one.** |
| `/v1/users/me` or similar | GET | Workspace/user lookup (may or may not exist) |
| Any URL with `/refresh` or `/token` | POST | Refresh endpoint (may or may not exist) |

For the AI chat request, capture:

- **Full URL** (exact path, exact subdomain)
- **All request headers** (especially `authorization`, `notion-client-version`, `notion-version`, `x-notion-*`)
- **Request body** (paste the JSON verbatim — field names, nesting)
- **Response status code**
- **Response headers** (especially `content-type` — should be `text/event-stream`)
- **First 3-5 SSE chunks** (raw bytes — they look like `data: {...}\n\n` or `event: ...\ndata: ...\n\n`)
- **Last chunk** (the one with `finish_reason` / `message_stop` / `[DONE]`)

If you see 401/403 after the chat succeeds once, that's the token expiry signal — copy the response body. If you see the chat auto-retry successfully, that's a refresh endpoint.

---

## Step 8: Write `docs/notion/capture-notes.md`

Open the repo at `docs/notion/capture-notes.md` (file does not exist yet — create it).

Use this template — fill in from your capture, do NOT copy from memory:

```markdown
# Notion Desktop Capture Notes

**Capture source:** [filename + date]
**Notion desktop version:** [from Help → About]
**AI subscription tier:** [free / Plus / Business / Enterprise]

## Authentication

### Send OTP
- URL: <paste full URL>
- Method: POST
- Request body: <paste JSON>
- Response 200 body: <paste JSON>
- Response 4xx body (if any): <paste JSON>

### Verify OTP
- URL: <paste>
- Method: POST
- Request body: <paste>
- Response body field paths:
  - access token: <path like `body.token` or `body.session.token`>
  - user_id: <path>
  - workspace_id: <path>
  - refresh_token: <path or "NOT PRESENT">
- Token TTL (if in response): <number + unit, or "not specified">
- Refresh endpoint: <URL or "not found">

### Token Lifecycle
- Token expiry signal: <401 status, error code in body, etc.>
- Refresh behavior: <auto-refreshed by client? manual re-auth? never expires?>
- Notes: <anything weird>

## AI Chat

### Endpoint
- URL: <full URL>
- Method: POST
- Content-Type: `application/json`
- Accept (from client): <value>

### Required Request Headers
- `authorization`: <scheme, e.g. `Bearer`>
- `notion-client-version`: <exact value from capture>
- `notion-version`: <exact value>
- <any other custom headers observed>

### Request Body Schema
```json
{
  "field1": "type",
  "field2": {...}
}
```
(paste actual JSON, with field names exactly as captured)

### Response (SSE)
- Content-Type: `text/event-stream`
- First chunk raw:
```
<first SSE event, byte-exact>
```
- Event types observed:
  - `<name>` — fields: `<list>`
  - `<name>` — fields: `<list>`
- Conversation ID extraction: <which field, in which event>
- Stream terminator: `<[DONE] / empty event / message_stop / etc.>`

### Model IDs Observed
- <list each model id seen in capture, e.g., `anthropic-claude-sonnet-4-20250514`>

## Error Responses
| Status | Body | Trigger |
|---|---|---|
| 401 | <paste body> | token expired |
| 402 | <paste body> | no AI subscription |
| 429 | <paste body> | rate limited |
| 500 | <paste body> | upstream error |

## Open Questions (capture couldn't answer)
- <anything still unknown, e.g., "couldn't determine TTL because no expiry observed in 30 min capture window">
```

---

## Step 9: Commit artifacts

```bash
cd C:\Users\iqbal\OneDrive\Documents\Project\kelola-router
git add docs/notion/capture-notes.md tests/fixtures/notion/sample-stream.har docs/notion/RE-CAPTURE-GUIDE.md
git commit -m "wip(capture): Notion desktop AI chat HAR + endpoint notes"
```

---

## Step 10: Hand off

Once committed, tell the assistant: **"capture done"** or paste the path to `capture-notes.md`. Implementation tasks 2-9 will pick up from there with exact endpoint URLs, header names, body fields.

---

## Troubleshooting

### "mitmweb shows no traffic from Notion desktop"
- Electron apps sometimes ignore system proxy. Workaround: launch Notion with explicit proxy env var:
  - macOS/Linux: `HTTPS_PROXY=http://127.0.0.1:8080 notion-app`
  - Windows: set env var then launch
- Or use the browser fallback (Step 5 Option B)

### "Notion shows 'network error' or won't load"
- Cert not trusted. Re-check Step 3.
- Try `http://mitm.it` in a fresh tab — if it warns about cert, trust is broken.

### "AI chat returns 402 Payment Required"
- Subscription tier doesn't include AI. Upgrade or use a different account. Without AI access, we can't capture the chat endpoint.

### "HAR export is empty / broken"
- Use mitmdump + custom export script (Step 6 alternative) — more reliable than mitmweb's HAR export.

### "I don't see a refresh endpoint anywhere"
- Notion may not have one. That's fine — auth module will handle 401 by emitting `notion_reauth_required` and the user re-runs the OTP flow. Document this finding in capture-notes.md Token Lifecycle section.

---

## What happens next

After capture, the implementation plan (`docs/superpowers/plans/2026-06-18-notion-provider.md`) Tasks 2-9 use the exact field names and URLs from `capture-notes.md` instead of the placeholder values in the plan. Tasks 1 (DB migration) and 10-12 don't depend on capture and can run in parallel.

Spec: `docs/superpowers/specs/2026-06-18-notion-reverse-engineer-design.md`
Plan: `docs/superpowers/plans/2026-06-18-notion-provider.md`