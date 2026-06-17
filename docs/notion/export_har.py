"""mitmdump addon: dump flows as HAR JSON.

Usage:
    mitmdump -s docs/notion/export_har.py --no-server -r docs/notion/capture.flow
    # writes docs/notion/capture.har
"""
import datetime
import json
import sys
from mitmproxy import http
from typing import Any, List


_ENTRIES: List[dict] = []


def _iso(ts: Any) -> str:
    if ts is None:
        return ""
    try:
        return datetime.datetime.fromtimestamp(float(ts), tz=datetime.timezone.utc).isoformat()
    except (TypeError, ValueError):
        return str(ts)


def har_entry(flow: http.HTTPFlow) -> dict:
    req = flow.request
    resp = flow.response
    return {
        "startedDateTime": _iso(getattr(flow.request, "timestamp_start", None)),
        "request": {
            "method": req.method,
            "url": req.pretty_url,
            "httpVersion": "HTTP/1.1",
            "headers": [{"name": k, "value": v} for k, v in req.headers.items()],
            "queryString": [{"name": k, "value": v} for k, v in req.query.items()],
            "cookies": [{"name": k, "value": v} for k, v in req.cookies.items()],
            "headersSize": -1,
            "bodySize": len(req.raw_content) if req.raw_content else 0,
            "postData": {
                "mimeType": req.headers.get("content-type", ""),
                "text": req.get_text() if req.raw_content else "",
            } if req.raw_content else None,
        },
        "response": {
            "status": resp.status_code if resp else 0,
            "statusText": resp.reason if resp else "",
            "httpVersion": "HTTP/1.1",
            "headers": [{"name": k, "value": v} for k, v in resp.headers.items()] if resp else [],
            "cookies": [],
            "content": {
                "size": len(resp.raw_content) if resp and resp.raw_content else 0,
                "mimeType": resp.headers.get("content-type", "") if resp else "",
                "text": resp.get_text() if resp and resp.raw_content else "",
            } if resp else None,
            "redirectURL": resp.headers.get("location", "") if resp else "",
            "headersSize": -1,
            "bodySize": -1,
        },
        "cache": {},
        "timings": {"send": 0, "wait": 0, "receive": 0},
        "serverIPAddress": flow.server_conn.peername[0] if flow.server_conn and flow.server_conn.peername else "",
    }


def response(flow: http.HTTPFlow) -> None:
    if not flow.response:
        return
    host = flow.request.pretty_host.lower()
    if not (host.endswith("notion.com") or host.endswith("notion.so")):
        return
    _ENTRIES.append(har_entry(flow))
    sys.stderr.write(f"NOTION: {flow.request.method} {flow.request.pretty_url} -> {flow.response.status_code}\n")
    sys.stderr.flush()


def done() -> None:
    out_path = "docs/notion/capture.har"
    with open(out_path, "w", encoding="utf-8") as fp:
        json.dump({"log": {"version": "1.2", "creator": {"name": "mitmdump-har", "version": "1.0"}, "entries": _ENTRIES}}, fp, indent=2, ensure_ascii=False, default=str)
    sys.stderr.write(f"Wrote {len(_ENTRIES)} Notion entries to {out_path}\n")


class _Addon:
    def response(self, flow: http.HTTPFlow) -> None:
        response(flow)

    def done(self) -> None:
        done()


addons = [_Addon()]