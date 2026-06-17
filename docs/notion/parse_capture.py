"""Parse mitmweb HAR export into Notion capture-notes.md + filtered fixture.

Usage:
    python docs/notion/parse_capture.py <har-file> [--notes-out PATH] [--fixture-out PATH]

Defaults:
    --notes-out   docs/notion/capture-notes.md
    --fixture-out tests/fixtures/notion/sample-stream.har
"""

import argparse
import json
import sys
from pathlib import Path
from urllib.parse import urlparse


def is_notion_origin(url: str) -> bool:
    host = urlparse(url).netloc.lower()
    return host.endswith("notion.com") or host.endswith("notion.so")


def is_static(url: str, content_type: str = "") -> bool:
    static_ext = (".js", ".css", ".png", ".jpg", ".jpeg", ".gif", ".svg",
                  ".woff", ".woff2", ".ttf", ".ico", ".map", ".wasm")
    path = urlparse(url).path.lower()
    if any(path.endswith(ext) for ext in static_ext):
        return True
    if content_type.startswith(("image/", "font/", "text/css", "application/javascript")):
        return True
    return False


def looks_like_ai_chat(url: str) -> bool:
    p = urlparse(url).path.lower()
    return any(seg in p for seg in ("/ai/", "/chat", "/completion", "/conversation"))


def looks_like_auth(url: str) -> bool:
    p = urlparse(url).path.lower()
    return any(seg in p for seg in ("login", "auth", "otp", "sendotp", "verify",
                                    "token", "refresh", "session"))


def looks_like_user_lookup(url: str) -> bool:
    p = urlparse(url).path.lower()
    return any(seg in p for seg in ("users/me", "workspaces", "/me", "/workspace"))


def safe_json_body(entry: dict) -> object | None:
    """Best-effort JSON parse of request or response body text."""
    body = entry.get("postData", {}).get("text") or entry.get("response", {}).get("content", {}).get("text")
    if body is None:
        return None
    try:
        return json.loads(body)
    except (json.JSONDecodeError, TypeError):
        return body[:500] if isinstance(body, str) else str(body)[:500]


def collect_har(har: dict) -> list[dict]:
    """Flatten HAR entries, filter to Notion non-static traffic."""
    entries = har.get("log", {}).get("entries", [])
    out = []
    for e in entries:
        url = e.get("request", {}).get("url", "")
        if not is_notion_origin(url):
            continue
        resp = e.get("response", {}).get("content", {})
        ct = resp.get("mimeType", "")
        if is_static(url, ct):
            continue
        out.append(e)
    return out


def categorize(entries: list[dict]) -> dict[str, list[dict]]:
    cats: dict[str, list[dict]] = {
        "auth_otp_send": [],
        "auth_otp_verify": [],
        "auth_token_refresh": [],
        "ai_chat": [],
        "user_workspace": [],
        "other": [],
    }
    for e in entries:
        url = e.get("request", {}).get("url", "")
        method = e.get("request", {}).get("method", "GET").upper()
        p = urlparse(url).path.lower()
        if method == "POST" and ("sendotp" in p or "send_otp" in p):
            cats["auth_otp_send"].append(e)
        elif method == "POST" and ("verify" in p or "exchange" in p or "confirm" in p) and looks_like_auth(url):
            cats["auth_otp_verify"].append(e)
        elif method == "POST" and "refresh" in p and looks_like_auth(url):
            cats["auth_token_refresh"].append(e)
        elif method == "POST" and looks_like_ai_chat(url):
            cats["ai_chat"].append(e)
        elif method == "GET" and looks_like_user_lookup(url):
            cats["user_workspace"].append(e)
        else:
            cats["other"].append(e)
    return cats


def render_section(title: str, entries: list[dict]) -> str:
    if not entries:
        return f"\n### {title}\n\n(no entries found)\n"
    lines = [f"\n### {title}", ""]
    for i, e in enumerate(entries, 1):
        req = e.get("request", {})
        resp = e.get("response", {})
        url = req.get("url", "")
        method = req.get("method", "?")
        status = resp.get("status", "?")
        ct = resp.get("content", {}).get("mimeType", "")
        req_headers = {h["name"].lower(): h["value"] for h in req.get("headers", [])}
        req_body = safe_json_body(e) if req.get("postData") else None
        resp_text = resp.get("content", {}).get("text", "")
        resp_body = None
        if resp_text:
            try:
                resp_body = json.loads(resp_text)
            except json.JSONDecodeError:
                resp_body = resp_text[:600]
        lines.append(f"#### Entry {i}: {method} {urlparse(url).path}")
        lines.append(f"- Status: {status}")
        lines.append(f"- Response Content-Type: `{ct}`")
        lines.append("")
        lines.append("**Request headers (filtered):**")
        for k in ("authorization", "notion-client-version", "notion-version",
                  "content-type", "x-notion-client-version", "x-notion-version",
                  "notion-client-platform"):
            if k in req_headers:
                v = req_headers[k]
                if k == "authorization" and len(v) > 30:
                    v = v[:25] + "...[REDACTED]"
                lines.append(f"- `{k}`: `{v}`")
        lines.append("")
        if req_body is not None:
            lines.append("**Request body:**")
            lines.append("```json")
            lines.append(json.dumps(req_body, indent=2, ensure_ascii=False))
            lines.append("```")
            lines.append("")
        if resp_body is not None:
            lines.append(f"**Response body** (first 600 chars):")
            lines.append("```json" if isinstance(resp_body, (dict, list)) else "```")
            if isinstance(resp_body, str):
                lines.append(resp_body)
            else:
                lines.append(json.dumps(resp_body, indent=2, ensure_ascii=False)[:1500])
            lines.append("```")
            lines.append("")
        if "text/event-stream" in ct and isinstance(resp_text, str):
            lines.append("**SSE stream (first 1500 chars):**")
            lines.append("```")
            lines.append(resp_text[:1500])
            lines.append("```")
            lines.append("")
    return "\n".join(lines)


def find_token_field(obj: object) -> str | None:
    """Walk JSON tree, return first dot-path to a key containing 'token'."""
    def walk(node, path):
        if isinstance(node, dict):
            for k, v in node.items():
                if "token" in k.lower() and isinstance(v, str) and len(v) > 5:
                    return f"{path}.{k}" if path else k
                r = walk(v, f"{path}.{k}" if path else k)
                if r:
                    return r
        elif isinstance(node, list):
            for i, v in enumerate(node):
                r = walk(v, f"{path}[{i}]")
                if r:
                    return r
        return None
    return walk(obj, "")


def find_field(obj: object, key_substr: str) -> str | None:
    def walk(node, path):
        if isinstance(node, dict):
            for k, v in node.items():
                if key_substr in k.lower() and v not in (None, "", [], {}):
                    return f"{path}.{k}" if path else k
                r = walk(v, f"{path}.{k}" if path else k)
                if r:
                    return r
        elif isinstance(node, list):
            for i, v in enumerate(node):
                r = walk(v, f"{path}[{i}]")
                if r:
                    return r
        return None
    return walk(obj, "")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("har_file", type=Path)
    ap.add_argument("--notes-out", type=Path, default=Path("docs/notion/capture-notes.md"))
    ap.add_argument("--fixture-out", type=Path, default=Path("tests/fixtures/notion/sample-stream.har"))
    args = ap.parse_args()

    if not args.har_file.exists():
        print(f"ERROR: {args.har_file} not found", file=sys.stderr)
        return 1

    try:
        har = json.loads(args.har_file.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        print(f"ERROR: not valid JSON: {e}", file=sys.stderr)
        return 1

    entries = collect_har(har)
    cats = categorize(entries)

    notes = []
    notes.append("# Notion Desktop Capture Notes")
    notes.append("")
    notes.append(f"**Source HAR:** `{args.har_file.name}`")
    notes.append(f"**Total Notion entries (non-static):** {len(entries)}")
    notes.append("")
    notes.append("## Counts by Category")
    notes.append("")
    for k, v in cats.items():
        notes.append(f"- `{k}`: {len(v)}")
    notes.append("")
    notes.append("---")
    notes.append("")
    notes.append("## Authentication")

    verify_entries = cats["auth_otp_verify"]
    token_path = None
    refresh_path = None
    ttl_path = None
    user_id_path = None
    workspace_id_path = None
    if verify_entries:
        for e in verify_entries:
            resp_text = e.get("response", {}).get("content", {}).get("text", "")
            try:
                resp_body = json.loads(resp_text)
            except json.JSONDecodeError:
                continue
            token_path = token_path or find_token_field(resp_body)
            user_id_path = user_id_path or find_field(resp_body, "user_id")
            workspace_id_path = workspace_id_path or find_field(resp_body, "workspace")
            refresh_path = refresh_path or find_field(resp_body, "refresh")
            ttl_path = ttl_path or find_field(resp_body, "ttl") or find_field(resp_body, "expires")
        if token_path:
            notes.append(f"- Token field path: `{token_path}`")
        if user_id_path:
            notes.append(f"- user_id path: `{user_id_path}`")
        if workspace_id_path:
            notes.append(f"- workspace_id path: `{workspace_id_path}`")
        if refresh_path:
            notes.append(f"- refresh_token path: `{refresh_path}` (refresh supported)")
        else:
            notes.append(f"- refresh_token: NOT PRESENT (re-auth via OTP only)")
        if ttl_path:
            notes.append(f"- TTL path: `{ttl_path}`")

    notes.append(render_section("Send OTP", cats["auth_otp_send"]))
    notes.append(render_section("Verify OTP", cats["auth_otp_verify"]))
    notes.append(render_section("Token Refresh", cats["auth_token_refresh"]))
    notes.append("")
    notes.append("---")
    notes.append("")
    notes.append("## AI Chat")
    notes.append(render_section("Chat Requests", cats["ai_chat"]))

    notes.append("### Model IDs Observed")
    model_ids = set()
    for e in cats["ai_chat"]:
        body = safe_json_body(e) if e.get("request", {}).get("postData") else None
        if isinstance(body, dict):
            for k in ("model", "model_id", "modelId"):
                if k in body and isinstance(body[k], str):
                    model_ids.add(body[k])
    if model_ids:
        for m in sorted(model_ids):
            notes.append(f"- `{m}`")
    else:
        notes.append("(none — capture didn't include model field)")

    notes.append("")
    notes.append("---")
    notes.append("")
    notes.append("## Error Responses")
    errs = [e for e in entries if int(e.get("response", {}).get("status", 200)) >= 400]
    if errs:
        for e in errs[:10]:
            req = e.get("request", {})
            resp = e.get("response", {})
            notes.append(f"- {resp.get('status')} {req.get('method')} {req.get('url')}")
    else:
        notes.append("(no 4xx/5xx observed)")

    notes.append("")
    notes.append("---")
    notes.append("")
    notes.append("## Other Notion Traffic (context only)")
    notes.append(render_section("User/Workspace Lookups", cats["user_workspace"]))
    notes.append(render_section("Other", cats["other"][:5]))

    args.notes_out.parent.mkdir(parents=True, exist_ok=True)
    args.notes_out.write_text("\n".join(notes), encoding="utf-8")
    print(f"Wrote {args.notes_out}")

    # Filtered fixture: only AI chat + auth
    keep = (cats["ai_chat"] + cats["auth_otp_send"] + cats["auth_otp_verify"]
            + cats["auth_token_refresh"])
    if keep:
        fixture = {
            "log": {
                "version": har.get("log", {}).get("version", "1.2"),
                "creator": {"name": "notion-capture-parser", "version": "1.0"},
                "entries": keep,
            }
        }
        args.fixture_out.parent.mkdir(parents=True, exist_ok=True)
        args.fixture_out.write_text(json.dumps(fixture, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"Wrote {args.fixture_out} ({len(keep)} entries)")
    else:
        print("WARNING: no AI chat or auth entries to write fixture", file=sys.stderr)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())