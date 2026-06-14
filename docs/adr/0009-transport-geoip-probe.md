# 0009. Transport GeoIP country probe on add (advisory, non-blocking)

Date: 2026-06-14

## Status

Accepted.

## Context

The router supports SOCKS5/HTTP transports (proxies/relays) to route upstream traffic through specific network paths. Users add transports via the dashboard and immediately want to know two things: (1) does this transport actually work, and (2) what country does it exit from?

Before v0.18.0, the transports page showed label, URL, and kind — no connectivity or geographic information. Users had to manually test a transport by routing a real request through it and inspecting the upstream log.

Adding a probe at transport-add time is an opportunity to surface both signals in one operation. The question was whether a failure to probe should block the transport from being saved, and which external service to use for country detection.

## Decision

`src/transport/geoip.ts` exports `checkTransportGeo(cfg: TransportConfig, timeoutMs = 8000): Promise<GeoResult>`. It routes a GET to `https://ipapi.co/json/` through the transport using `proxyAwareFetch`, then reads `country_code` (or `countryCode`) from the JSON response. The function **never throws** — any network failure or parse error returns `{ active: false, country: null }`.

Migration `006-transport-country` adds `ALTER TABLE transports ADD COLUMN country TEXT` (additive, `user_version = 6`). Existing rows are `NULL` until probed.

The probe runs as part of the `POST /api/admin/transports` handler — after the transport row is written, the probe fires and the result is patched back into the row. If the probe times out or fails, the transport is still saved with `country = NULL`. The probe is **advisory** and **non-blocking** for the save: the user gets the transport regardless.

`ipapi.co` was chosen because it requires no API key, returns a small JSON payload, and identifies the egress IP's country as seen from the target host — which is exactly the IP a proxy or relay presents to the upstream.

## Consequences

### Positive

- Users get immediate feedback on whether a transport is reachable and where it exits — without needing to make a real proxy request.
- The `country` column on the Transports page is informational and helps users identify misconfigured or geographically wrong transports at a glance.
- Non-blocking: a slow or unreachable proxy does not delay the save operation beyond the 8-second timeout.

### Negative

- `ipapi.co` is a free third-party service with rate limits. High-volume transport testing (e.g. bulk import) could hit the limit. The bulk import flow fires probes sequentially to mitigate this.
- The 8-second timeout adds latency to the transport-add admin action when the proxy is slow or unreachable. This is acceptable on an infrequent admin action.
- `country` is never re-probed automatically after save. A transport that changes its exit IP retains the old country until the user manually re-tests.

### Neutral

- `NULL` country is rendered as "—" in the dashboard. The absence of country is distinguishable from "probed and unknown".

## Alternatives considered

### Block save if probe fails

Require the transport to be reachable before saving. Rejected because: the user may be adding a transport that isn't available yet (e.g. a relay being configured on another machine), or the probe endpoint may be temporarily unreachable. Advisory is strictly better for add workflows.

### Use a self-hosted IP lookup service

Run an IP geolocation endpoint inside the Docker image. Rejected because: GeoIP databases are large (tens of MB), require licensing, and need periodic updates. A free external service is correct for the single-tenant, self-host use case.

### Probe in the background after save

Fire the probe asynchronously and let the dashboard poll for the result. Rejected because: adds complexity (a pending-probe state, a polling endpoint) for a result that can be surfaced synchronously within the 8s timeout.

## References

- `src/transport/geoip.ts` — `checkTransportGeo`, `GeoResult`
- `src/transport/proxyFetch.ts` — `proxyAwareFetch` (transport-aware fetch)
- `src/db/migrations/006-transport-country.ts` — additive `country TEXT` column
- `src/api/admin/transports.ts` — probe-on-add wiring
- `CHANGELOG.md` v0.18.0 — Transport upgrades entry
