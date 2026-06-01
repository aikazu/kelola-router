# Phase 6: v0.6 — Transport + Docker

> Part of [Master Plan](./2026-06-01-minimax-router.md). Requires Phase 5 done.
> Spec: `docs/spec/IMPLEMENTATION.md` §6 v0.6
> Target: 1-2h

**Goal:** Full proxyAwareFetch with relay + proxy + env. Dynamic SOCKS5 import. Dockerfile + compose. Caddyfile snippet. README.

**Done when:** `HTTPS_PROXY` env forwards through proxy, `transport.relay` sends via relay, Docker image builds, `docker compose up` serves on 20137.

---

## Task 6.1: Full transport (relay + proxy + env fallback)

**Files:**
- Create: `src/transport/dispatcherCache.ts`
- Create: `src/transport/socksLoader.ts`
- Modify: `src/transport/proxyFetch.ts` (full impl)
- Create: `src/transport/proxyFetch.test.ts` (replace stub)

- [ ] **Step 1: Write `src/transport/dispatcherCache.ts`**

```ts
import type { Dispatcher } from "undici";

const cache = new Map<string, Dispatcher>();
const MAX_SIZE = 50;

export async function getDispatcher(proxyUrl: string): Promise<Dispatcher | null> {
  if (!proxyUrl) return null;
  if (cache.has(proxyUrl)) return cache.get(proxyUrl)!;
  if (cache.size >= MAX_SIZE) {
    const first = cache.keys().next().value;
    if (first) cache.delete(first);
  }
  const { ProxyAgent } = await import("undici");
  const agent = new ProxyAgent({ uri: proxyUrl });
  cache.set(proxyUrl, agent);
  return agent;
}
```

- [ ] **Step 2: Write `src/transport/socksLoader.ts`**

```ts
import type { Dispatcher } from "undici";

export async function getSocksDispatcher(socksUrl: string): Promise<Dispatcher> {
  const mod = await import("socks-proxy-agent");
  const SocksProxyAgent = mod.SocksProxyAgent;
  return new SocksProxyAgent(socksUrl) as unknown as Dispatcher;
}
```

- [ ] **Step 3: Install undici + socks-proxy-agent**

Run: `npm install undici socks-proxy-agent @types/socks-proxy-agent`
Expected: deps installed

- [ ] **Step 4: Write failing tests (replacing stub)**

`src/transport/proxyFetch.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { proxyAwareFetch } from "./proxyFetch.js";

afterEach(() => vi.restoreAllMocks());

describe("proxyAwareFetch", () => {
  it("relay: sends to relay URL with x-relay-target + x-relay-path headers", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("ok", { status: 200 }),
    );
    await proxyAwareFetch(
      "https://api.minimax.io/v1/chat/completions",
      { method: "POST" },
      { relay: { kind: "vercel", url: "https://my-relay.vercel.app/api/relay" }, proxy: null },
    );
    const [calledUrl, calledOpts] = spy.mock.calls[0];
    expect(calledUrl).toBe("https://my-relay.vercel.app/api/relay");
    const headers = (calledOpts.headers as Record<string, string>);
    expect(headers["x-relay-target"]).toBe("https://api.minimax.io");
    expect(headers["x-relay-path"]).toBe("/v1/chat/completions");
  });

  it("env HTTPS_PROXY: used when no settings proxy", async () => {
    const prev = process.env.HTTPS_PROXY;
    process.env.HTTPS_PROXY = "http://127.0.0.1:7890";
    try {
      const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));
      await proxyAwareFetch("https://api.minimax.io/v1/x", {}, { relay: null, proxy: null });
      const call = spy.mock.calls[0];
      expect(call[0]).toBe("https://api.minimax.io/v1/x");
      expect((call[1] as any).dispatcher).toBeDefined();
    } finally {
      if (prev === undefined) delete process.env.HTTPS_PROXY;
      else process.env.HTTPS_PROXY = prev;
    }
  });

  it("direct: no relay + no proxy → plain fetch", async () => {
    const prev = process.env.HTTPS_PROXY;
    delete process.env.HTTPS_PROXY;
    try {
      const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));
      await proxyAwareFetch("https://api.minimax.io/v1/x", {}, { relay: null, proxy: null });
      const call = spy.mock.calls[0];
      expect(call[0]).toBe("https://api.minimax.io/v1/x");
      expect((call[1] as any).dispatcher).toBeUndefined();
    } finally {
      if (prev !== undefined) process.env.HTTPS_PROXY = prev;
    }
  });

  it("falls back to direct on proxy dispatcher error", async () => {
    const prev = process.env.HTTPS_PROXY;
    process.env.HTTPS_PROXY = "http://invalid:9999";
    try {
      const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));
      await proxyAwareFetch("https://api.minimax.io/v1/x", {}, { relay: null, proxy: null });
      // Should still succeed (fallback to direct)
      expect(spy).toHaveBeenCalled();
    } finally {
      if (prev === undefined) delete process.env.HTTPS_PROXY;
      else process.env.HTTPS_PROXY = prev;
    }
  });
});
```

- [ ] **Step 5: Run tests (expect fail)**

Run: `npm test`
Expected: FAIL

- [ ] **Step 6: Write `src/transport/proxyFetch.ts` (full)**

```ts
import type { Dispatcher } from "undici";
import { getDispatcher } from "./dispatcherCache.js";
import { getSocksDispatcher } from "./socksLoader.js";
import type { TransportConfig } from "./types.js";

function normalizeProxyUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try { new URL(url); return url; }
  catch { return `http://${url}`; }
}

function getEnvProxyUrl(targetUrl: string): string | null {
  const noProxy = process.env.NO_PROXY || process.env.no_proxy;
  if (noProxy && shouldBypassByNoProxy(targetUrl, noProxy)) return null;
  const protocol = new URL(targetUrl).protocol;
  if (protocol === "https:") {
    return process.env.HTTPS_PROXY || process.env.https_proxy
      || process.env.ALL_PROXY  || process.env.all_proxy
      || null;
  }
  return process.env.HTTP_PROXY || process.env.http_proxy
    || process.env.ALL_PROXY  || process.env.all_proxy
    || null;
}

function shouldBypassByNoProxy(targetUrl: string, noProxyValue: string): boolean {
  if (!noProxyValue) return false;
  const host = new URL(targetUrl).hostname.toLowerCase();
  return noProxyValue.split(",").map(p => p.trim().toLowerCase()).filter(Boolean)
    .some(pattern => {
      if (pattern === "*") return true;
      if (pattern.startsWith(".")) return host.endsWith(pattern) || host === pattern.slice(1);
      return host === pattern || host.endsWith(`.${pattern}`);
    });
}

export async function proxyAwareFetch(
  targetUrl: string,
  options: RequestInit,
  transportConfig: TransportConfig | null,
): Promise<Response> {
  if (transportConfig?.relay?.url) {
    const parsed = new URL(targetUrl);
    const relayHeaders: Record<string, string> = {
      ...(options.headers as Record<string, string> | undefined),
      "x-relay-target": `${parsed.protocol}//${parsed.host}`,
      "x-relay-path": `${parsed.pathname}${parsed.search}`,
    };
    return globalThis.fetch(transportConfig.relay.url, { ...options, headers: relayHeaders });
  }

  const settingsProxyUrl = transportConfig?.proxy?.url;
  const envProxyUrl = getEnvProxyUrl(targetUrl);
  const proxyUrl = normalizeProxyUrl(settingsProxyUrl || envProxyUrl);

  if (proxyUrl) {
    try {
      const dispatcher: Dispatcher | null = transportConfig?.proxy?.kind === "socks5"
        ? await getSocksDispatcher(proxyUrl)
        : await getDispatcher(proxyUrl);
      if (dispatcher) {
        return await globalThis.fetch(targetUrl, { ...options, dispatcher: dispatcher as any });
      }
    } catch (e: any) {
      console.warn(`[transport] proxy failed, falling back to direct: ${e.message}`);
      return globalThis.fetch(targetUrl, options);
    }
  }

  return globalThis.fetch(targetUrl, options);
}
```

- [ ] **Step 7: Run tests (expect pass)**

Run: `npm test`
Expected: PASS — 142 tests (4 new)

- [ ] **Step 8: Commit**

```bash
git add src/transport/ package.json package-lock.json
git commit -m "feat: full proxyAwareFetch with relay + http/socks proxy + env fallback"
```

---

## Task 6.2: Dockerfile

**Files:**
- Create: `Dockerfile`
- Create: `docker-compose.yml`
- Create: `.dockerignore`

- [ ] **Step 1: Write `Dockerfile`**

```dockerfile
# Build stage
FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Runtime stage
FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=20137
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
RUN mkdir -p /data && chown -R node:node /data
VOLUME ["/data"]
EXPOSE 20137
USER node
CMD ["node", "dist/server.js"]
```

- [ ] **Step 2: Write `docker-compose.yml`**

```yaml
services:
  router:
    build: .
    container_name: minimax-router
    restart: unless-stopped
    ports:
      - "127.0.0.1:20137:20137"
    volumes:
      - ./data:/data
    environment:
      - HOST=0.0.0.0
      - PORT=20137
      - ROUTER_DB_PATH=/data/router.db
      - LOG_LEVEL=info
```

- [ ] **Step 3: Write `.dockerignore`**

```
node_modules
dist
data
.env
.git
.gitignore
*.md
tests
docs
.vscode
.idea
```

- [ ] **Step 4: Build + test**

Run: `docker build -t minimax-router .`
Expected: image builds successfully

Run: `docker run --rm -p 20137:20137 -e ROUTER_DB_PATH=/tmp/r.db minimax-router &`
Wait 2 sec, then: `curl http://127.0.0.1:20137/health`
Expected: `{"ok":true}`
Stop container.

- [ ] **Step 5: Commit**

```bash
git add Dockerfile docker-compose.yml .dockerignore
git commit -m "feat: Dockerfile + docker-compose for local + VPS deploy"
```

---

## Task 6.3: Caddyfile snippet for VPS

**Files:**
- Create: `Caddyfile`

- [ ] **Step 1: Write `Caddyfile`**

```
# Replace with your actual domain
router.example.com {
  reverse_proxy 127.0.0.1:20137 {
    header_up X-Forwarded-For {remote_host}
    header_up X-Forwarded-Proto {scheme}
  }
  encode gzip zstd
}
```

- [ ] **Step 2: Commit**

```bash
git add Caddyfile
git commit -m "docs: Caddyfile snippet for VPS deploy with auto-TLS"
```

---

## Task 6.4: README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write `README.md`**

```markdown
# minimax-router

Local-first API router for MiniMax (single provider). Multi-account PAYG + Token Plan, prompt caching with auto dual-breakpoint injection, RTK tool-output compression, Caveman terse-prompt injection, 5-page admin dashboard, multi-transport (direct / HTTP / SOCKS5 / Vercel-relay / Cloudflare-relay).

## Features

- OpenAI-compat (`/v1/chat/completions`, `/v1/embeddings`, `/v1/models`)
- Anthropic-compat (`/v1/messages`, `/v1/messages/count_tokens`)
- Multi-account (PAYG + Token Plan) with sticky / round-robin selection
- Exponential backoff + 5h/weekly window-reset cooldown
- Per-model rate-limit locks
- Auto dual `cache_control` breakpoints (lifts MiniMax cache hit rate from ~0% to 80%+)
- RTK tool-output compression (smart-truncate, dedup-log)
- Caveman terse-prompt injection (off / terse / ultra)
- Manual model registry + `/admin/models/fetch` for live model sync
- Per-request usage + cost tracking
- Quota tracking via `/v1/token_plan/remains` + fallback
- Server-rendered HTML dashboard (5 pages)
- Transport: direct / HTTP / SOCKS5 proxy / Vercel / Cloudflare relay

## Quickstart (local)

```bash
git clone <repo> minimax-router
cd minimax-router
npm install
npm run dev
```

Server listens on `http://127.0.0.1:20137`.

## Setup

```bash
# Create a router-user (prints api_key + admin_key)
npx tsx scripts/add-user.ts --name "me"

# Add a MiniMax account
npx tsx scripts/add-account.ts --user 1 --label "PAYG main" --credit-type payg --api-key mm_xxx
```

## Usage

```bash
# Use as OpenAI base URL
curl -H "Authorization: Bearer rk_xxx" http://127.0.0.1:20137/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"MiniMax-M3","messages":[{"role":"user","content":"hi"}]}'

# Use as Anthropic base URL
curl -H "x-api-key: rk_xxx" -H "anthropic-version: 2023-06-01" \
  http://127.0.0.1:20137/v1/messages \
  -H "Content-Type: application/json" \
  -d '{"model":"MiniMax-M3","max_tokens":100,"messages":[{"role":"user","content":"hi"}]}'
```

## Dashboard

Open `http://127.0.0.1:20137/admin` and use your `admin_key` (from `add-user.ts`).

Pages: Overview / Usage / Accounts / Models / Quota / Settings.

## Docker

```bash
docker compose up -d
docker compose logs -f
```

## VPS deploy (Hetzner / OVH)

1. Install Docker + Caddy on the VPS.
2. Clone repo, copy `.env` (with `HOST=0.0.0.0`).
3. `docker compose up -d`.
4. Edit `Caddyfile` with your domain, then `caddy reload` (auto-TLS via Let's Encrypt).

## Transport

- **Direct** (default): no config needed.
- **HTTP/HTTPS proxy**: set `HTTPS_PROXY=http://host:port` env var.
- **SOCKS5 proxy**: set `HTTPS_PROXY=socks5://host:port` env var.
- **Vercel/Cloudflare relay**: deploy the snippet from `docs/idea/transport/SUMMARY.md` and set `transport.relay` row in settings.

## API key encryption

v1 stores `accounts.api_key` plaintext. Back up `router.db` = back up all secrets. v1.1 will add AES-256-GCM encryption (env `ROUTER_MASTER_KEY`).

## Tests

```bash
npm test
```

## License

MIT.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: README with quickstart, usage, deploy, transport"
```

---

## Task 6.5: Phase 6 checkpoint

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: 142+ tests pass

- [ ] **Step 2: Type check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit + tag**

```bash
git add .
git commit -m "chore: phase 6 v0.6 checkpoint" --allow-empty
git tag v0.6
git push origin main --tags
```

---

**End of Phase 6. End of implementation plan.**

v1 complete. Total LOC estimate: ~3500 TS + ~1500 test LOC = ~5000 LOC shipped.

Next steps:
- Wire into issue tracker (GitHub Issues or similar) for milestone tracking
- v1.1: API key encryption, daily spend cap, optional dashboard password
- v2: Multi-provider (add 2nd provider by copying `src/providers/minimax.ts`)

