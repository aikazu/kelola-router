# Phase 1: v0.1 — Passthrough Proxy

> Part of [Master Plan](./2026-06-01-minimax-router.md). Ship after Phase 6.
> Spec: `docs/spec/IMPLEMENTATION.md` §6 v0.1
> Target: 1-2h

**Goal:** Hono app on `127.0.0.1:20137` forwarding 5 routes to MiniMax upstream. No auth, no augmentation, no DB. Verifies streaming works end-to-end.

**Done when:** `curl /v1/chat/completions` returns real MiniMax response, `curl /v1/messages` works, `stream:true` returns SSE, `/health` returns `{ok:true}`.

---

## Task 1.1: Project scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `vitest.config.ts`

- [x] **Step 1: Write `package.json`**

```json
{
  "name": "minimax-router",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "engines": { "node": ">=20" },
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc",
    "start": "node dist/server.js",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@hono/node-server": "^1.11.0",
    "hono": "^4.4.0",
    "pino": "^9.2.0"
  },
  "devDependencies": {
    "@types/node": "^20.12.0",
    "tsx": "^4.11.0",
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  }
}
```

- [x] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noImplicitAny": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "outDir": "dist",
    "rootDir": "src",
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [x] **Step 3: Write `.gitignore`**

```
node_modules/
dist/
data/
.env
*.log
.DS_Store
```

- [x] **Step 4: Write `.env.example`**

```
# MiniMax API key (for testing passthrough)
MINIMAX_API_KEY=mm_test_replace_me

# Server bind
HOST=127.0.0.1
PORT=20137

# Upstream region (intl | cn)
MINIMAX_REGION=intl
```

- [x] **Step 5: Write `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
  },
});
```

- [x] **Step 6: Install deps**

Run: `npm install`
Expected: `node_modules/` created, no errors

- [x] **Step 7: Commit**

```bash
git init
git add .
git commit -m "chore: project scaffold with hono + ts strict + vitest"
```

---

## Task 1.2: First Hono app + health route

**Files:**
- Create: `src/server.ts`
- Create: `src/server.test.ts`

- [x] **Step 1: Write failing test**

`src/server.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { app } from "./server.js";

describe("GET /health", () => {
  it("returns ok", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });
});
```

- [x] **Step 2: Run test (expect fail)**

Run: `npm test`
Expected: FAIL — `app` is not exported from `./server.js`

- [x] **Step 3: Write `src/server.ts`**

```ts
import { Hono } from "hono";

const app = new Hono();

app.get("/health", (c) => c.json({ ok: true }));

export { app };
```

- [x] **Step 4: Run test (expect pass)**

Run: `npm test`
Expected: PASS — 1 test

- [x] **Step 5: Commit**

```bash
git add src/server.ts src/server.test.ts
git commit -m "feat: Hono app with /health route"
```

---

## Task 1.3: Direct upstream fetch (transport layer stub)

**Files:**
- Create: `src/transport/types.ts`
- Create: `src/transport/proxyFetch.ts`
- Create: `src/transport/proxyFetch.test.ts`

- [x] **Step 1: Write failing test for direct fetch**

`src/transport/proxyFetch.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { proxyAwareFetch } from "./proxyFetch.js";

afterEach(() => vi.restoreAllMocks());

describe("proxyAwareFetch (direct mode)", () => {
  it("calls global fetch with provided url and options", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("ok", { status: 200 }),
    );
    const res = await proxyAwareFetch(
      "https://example.com/api",
      { method: "POST", body: "x" },
      { relay: null, proxy: null },
    );
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledWith(
      "https://example.com/api",
      expect.objectContaining({ method: "POST", body: "x" }),
    );
  });

  it("returns upstream response unchanged when no relay/proxy", async () => {
    const upstream = new Response('{"a":1}', {
      status: 201,
      headers: { "content-type": "application/json" },
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(upstream);
    const res = await proxyAwareFetch(
      "https://example.com",
      {},
      { relay: null, proxy: null },
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ a: 1 });
  });
});
```

- [x] **Step 2: Run test (expect fail)**

Run: `npm test`
Expected: FAIL — `./proxyFetch.js` not found

- [x] **Step 3: Write `src/transport/types.ts`**

```ts
export type ProxyKind = "http" | "socks5";
export type RelayKind = "vercel" | "cloudflare";

export interface ProxyConfig {
  kind: ProxyKind;
  url: string;
}

export interface RelayConfig {
  kind: RelayKind;
  url: string;
}

export interface TransportConfig {
  relay: RelayConfig | null;
  proxy: ProxyConfig | null;
}
```

- [x] **Step 4: Write `src/transport/proxyFetch.ts` (v0.1: direct only)**

```ts
import type { TransportConfig } from "./types.js";

/**
 * Forwards a request to upstream. In v0.1, relay + proxy are ignored
 * (always direct). v0.6 implements both paths.
 */
export async function proxyAwareFetch(
  targetUrl: string,
  options: RequestInit,
  _transportConfig: TransportConfig | null,
): Promise<Response> {
  return globalThis.fetch(targetUrl, options);
}
```

- [x] **Step 5: Run test (expect pass)**

Run: `npm test`
Expected: PASS — 3 tests total

- [x] **Step 6: Commit**

```bash
git add src/transport/
git commit -m "feat: transport/proxyFetch with direct passthrough (v0.1)"
```

---

## Task 1.4: Base URL resolver

**Files:**
- Create: `src/providers/baseUrl.ts`
- Create: `src/providers/baseUrl.test.ts`

- [x] **Step 1: Write failing test**

`src/providers/baseUrl.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { getBaseUrl } from "./baseUrl.js";

describe("getBaseUrl", () => {
  const accountIntl = { provider: "minimax" as const, baseUrl: null };
  const accountCn = { provider: "minimax" as const, baseUrl: null };

  it("returns intl OpenAI URL by default", () => {
    const url = getBaseUrl(accountIntl, "openai");
    expect(url).toBe("https://api.minimax.io/v1");
  });

  it("returns intl Anthropic URL by default", () => {
    const url = getBaseUrl(accountIntl, "anthropic");
    expect(url).toBe("https://api.minimax.io/anthropic");
  });

  it("returns CN OpenAI URL when MINIMAX_REGION=cn", () => {
    const prev = process.env.MINIMAX_REGION;
    process.env.MINIMAX_REGION = "cn";
    try {
      const url = getBaseUrl(accountCn, "openai");
      expect(url).toBe("https://api.minimaxi.com/v1");
    } finally {
      process.env.MINIMAX_REGION = prev;
    }
  });

  it("returns CN Anthropic URL when MINIMAX_REGION=cn", () => {
    const prev = process.env.MINIMAX_REGION;
    process.env.MINIMAX_REGION = "cn";
    try {
      const url = getBaseUrl(accountCn, "anthropic");
      expect(url).toBe("https://api.minimaxi.com/anthropic");
    } finally {
      process.env.MINIMAX_REGION = prev;
    }
  });

  it("honors account.baseUrl override", () => {
    const url = getBaseUrl(
      { provider: "minimax" as const, baseUrl: "https://my-proxy.example.com" },
      "openai",
    );
    expect(url).toBe("https://my-proxy.example.com");
  });
});
```

- [x] **Step 2: Run test (expect fail)**

Run: `npm test`
Expected: FAIL — `./baseUrl.js` not found

- [x] **Step 3: Write `src/providers/baseUrl.ts`**

```ts
type AccountLike = { provider: "minimax"; baseUrl: string | null };

export function getBaseUrl(
  account: AccountLike,
  kind: "openai" | "anthropic",
): string {
  if (account.baseUrl) return account.baseUrl;
  const isCn = process.env.MINIMAX_REGION === "cn";
  if (kind === "openai") {
    return isCn ? "https://api.minimaxi.com/v1" : "https://api.minimax.io/v1";
  }
  return isCn ? "https://api.minimaxi.com/anthropic" : "https://api.minimax.io/anthropic";
}
```

- [x] **Step 4: Run test (expect pass)**

Run: `npm test`
Expected: PASS — 8 tests total

- [x] **Step 5: Commit**

```bash
git add src/providers/baseUrl.ts src/providers/baseUrl.test.ts
git commit -m "feat: providers/baseUrl with intl/cn + override"
```

---

## Task 1.5: Header builder

**Files:**
- Create: `src/providers/headers.ts`
- Create: `src/providers/headers.test.ts`

- [x] **Step 1: Write failing test**

`src/providers/headers.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { buildHeaders } from "./headers.js";

const account = { provider: "minimax" as const, apiKey: "mm_test" };

describe("buildHeaders", () => {
  it("OpenAI format uses Authorization: Bearer", () => {
    const h = buildHeaders(account, false, "openai");
    expect(h["Authorization"]).toBe("Bearer mm_test");
    expect(h["Content-Type"]).toBe("application/json");
  });

  it("Anthropic format uses x-api-key + anthropic-version", () => {
    const h = buildHeaders(account, false, "anthropic");
    expect(h["x-api-key"]).toBe("mm_test");
    expect(h["anthropic-version"]).toBe("2023-06-01");
    expect(h["Content-Type"]).toBe("application/json");
  });

  it("streaming adds Accept: text/event-stream", () => {
    const h = buildHeaders(account, true, "openai");
    expect(h["Accept"]).toBe("text/event-stream");
  });

  it("non-streaming has no Accept", () => {
    const h = buildHeaders(account, false, "openai");
    expect(h["Accept"]).toBeUndefined();
  });
});
```

- [x] **Step 2: Run test (expect fail)**

Run: `npm test`
Expected: FAIL — `./headers.js` not found

- [x] **Step 3: Write `src/providers/headers.ts`**

```ts
type AccountLike = { provider: "minimax"; apiKey: string };

export function buildHeaders(
  account: AccountLike,
  stream: boolean,
  format: "openai" | "anthropic",
): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (format === "anthropic") {
    h["x-api-key"] = account.apiKey;
    h["anthropic-version"] = "2023-06-01";
  } else {
    h["Authorization"] = `Bearer ${account.apiKey}`;
  }
  if (stream) h["Accept"] = "text/event-stream";
  return h;
}
```

- [x] **Step 4: Run test (expect pass)**

Run: `npm test`
Expected: PASS — 12 tests total

- [x] **Step 5: Commit**

```bash
git add src/providers/headers.ts src/providers/headers.test.ts
git commit -m "feat: providers/headers for openai + anthropic + stream"
```

---

## Task 1.6: OpenAI-compat chat completions route

**Files:**
- Modify: `src/server.ts`

- [x] **Step 1: Write failing test**

`src/server.test.ts` (append to existing):
```ts
import { describe, it, expect, vi, afterEach } from "vitest";

afterEach(() => vi.restoreAllMocks());

describe("POST /v1/chat/completions", () => {
  it("forwards body to upstream OpenAI URL and returns response", async () => {
    const upstreamBody = JSON.stringify({
      id: "cmpl-1",
      choices: [{ message: { role: "assistant", content: "hi" } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(upstreamBody, {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const req = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "MiniMax-M3",
        messages: [{ role: "user", content: "hi" }],
      }),
    });
    const res = await app.request(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.choices[0].message.content).toBe("hi");

    expect(spy).toHaveBeenCalledTimes(1);
    const [calledUrl, calledOpts] = spy.mock.calls[0];
    expect(calledUrl).toBe("https://api.minimax.io/v1/chat/completions");
    expect(calledOpts.method).toBe("POST");
    const headers = calledOpts.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe(`Bearer ${process.env.MINIMAX_API_KEY}`);
    const sentBody = JSON.parse(calledOpts.body as string);
    expect(sentBody.model).toBe("MiniMax-M3");
  });
});
```

- [x] **Step 2: Run test (expect fail)**

Run: `npm test`
Expected: FAIL — no `/v1/chat/completions` route yet

- [x] **Step 3: Update `src/server.ts`**

```ts
import { Hono } from "hono";
import { getBaseUrl } from "./providers/baseUrl.js";
import { buildHeaders } from "./providers/headers.js";
import { proxyAwareFetch } from "./transport/proxyFetch.js";

const app = new Hono();

app.get("/health", (c) => c.json({ ok: true }));

app.post("/v1/chat/completions", async (c) => {
  const body = await c.req.json();
  const url = `${getBaseUrl({ provider: "minimax", baseUrl: null }, "openai")}/v1/chat/completions`;
  const apiKey = process.env.MINIMAX_API_KEY ?? "mm_test";
  const headers = buildHeaders(
    { provider: "minimax", apiKey },
    body.stream === true,
    "openai",
  );
  const resp = await proxyAwareFetch(
    url,
    { method: "POST", headers, body: JSON.stringify(body) },
    { relay: null, proxy: null },
  );
  return c.body(await resp.text(), resp.status as any, {
    "content-type": resp.headers.get("content-type") ?? "application/json",
  });
});

export { app };
```

- [x] **Step 4: Set MINIMAX_API_KEY in test env**

Add to `vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    env: {
      MINIMAX_API_KEY: "mm_test_key",
    },
  },
});
```

- [x] **Step 5: Run test (expect pass)**

Run: `npm test`
Expected: PASS — 13 tests total

- [x] **Step 6: Commit**

```bash
git add src/server.ts src/server.test.ts vitest.config.ts
git commit -m "feat: POST /v1/chat/completions OpenAI passthrough"
```

---

## Task 1.7: Anthropic-compat messages route

**Files:**
- Modify: `src/server.ts`

- [x] **Step 1: Write failing test**

`src/server.test.ts` (append):
```ts
describe("POST /v1/messages", () => {
  it("forwards to anthropic URL with x-api-key", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response('{"id":"msg_1","content":[{"type":"text","text":"hi"}]}', {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const req = new Request("http://localhost/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "MiniMax-M3",
        max_tokens: 100,
        messages: [{ role: "user", content: "hi" }],
      }),
    });
    const res = await app.request(req);
    expect(res.status).toBe(200);
    const [calledUrl, calledOpts] = spy.mock.calls[0];
    expect(calledUrl).toBe("https://api.minimax.io/anthropic/v1/messages");
    const headers = calledOpts.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("mm_test_key");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
  });
});
```

- [x] **Step 2: Run test (expect fail)**

Run: `npm test`
Expected: FAIL — `/v1/messages` route missing

- [x] **Step 3: Add route to `src/server.ts`**

Append inside `app` block:
```ts
app.post("/v1/messages", async (c) => {
  const body = await c.req.json();
  const url = `${getBaseUrl({ provider: "minimax", baseUrl: null }, "anthropic")}/v1/messages`;
  const apiKey = process.env.MINIMAX_API_KEY ?? "mm_test";
  const headers = buildHeaders(
    { provider: "minimax", apiKey },
    body.stream === true,
    "anthropic",
  );
  const resp = await proxyAwareFetch(
    url,
    { method: "POST", headers, body: JSON.stringify(body) },
    { relay: null, proxy: null },
  );
  return c.body(await resp.text(), resp.status as any, {
    "content-type": resp.headers.get("content-type") ?? "application/json",
  });
});
```

- [x] **Step 4: Run test (expect pass)**

Run: `npm test`
Expected: PASS — 14 tests total

- [x] **Step 5: Commit**

```bash
git add src/server.ts src/server.test.ts
git commit -m "feat: POST /v1/messages Anthropic passthrough"
```

---

## Task 1.8: Remaining 3 routes (count_tokens, embeddings, models)

**Files:**
- Modify: `src/server.ts`

- [x] **Step 1: Write failing tests for all 3**

`src/server.test.ts` (append):
```ts
describe("POST /v1/messages/count_tokens", () => {
  it("forwards to anthropic count_tokens URL", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response('{"input_tokens":5}', { status: 200 }),
    );
    const req = new Request("http://localhost/v1/messages/count_tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "MiniMax-M3", messages: [{ role: "user", content: "hi" }] }),
    });
    const res = await app.request(req);
    expect(res.status).toBe(200);
    expect(spy.mock.calls[0][0]).toBe("https://api.minimax.io/anthropic/v1/messages/count_tokens");
  });
});

describe("POST /v1/embeddings", () => {
  it("forwards to OpenAI embeddings URL", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response('{"data":[{"embedding":[0.1]}]}', { status: 200 }),
    );
    const req = new Request("http://localhost/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "text-embedding-3-small", input: "hi" }),
    });
    const res = await app.request(req);
    expect(res.status).toBe(200);
    expect(spy.mock.calls[0][0]).toBe("https://api.minimax.io/v1/embeddings");
  });
});

describe("GET /v1/models", () => {
  it("forwards to OpenAI models URL", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response('{"data":[]}', { status: 200 }),
    );
    const req = new Request("http://localhost/v1/models");
    const res = await app.request(req);
    expect(res.status).toBe(200);
    expect(spy.mock.calls[0][0]).toBe("https://api.minimax.io/v1/models");
  });
});
```

- [x] **Step 2: Run tests (expect fail)**

Run: `npm test`
Expected: FAIL — 3 new tests fail (routes missing)

- [x] **Step 3: Add 3 routes to `src/server.ts`**

```ts
app.post("/v1/messages/count_tokens", async (c) => {
  const body = await c.req.json();
  const url = `${getBaseUrl({ provider: "minimax", baseUrl: null }, "anthropic")}/v1/messages/count_tokens`;
  const apiKey = process.env.MINIMAX_API_KEY ?? "mm_test";
  const resp = await proxyAwareFetch(
    url,
    { method: "POST", headers: buildHeaders({ provider: "minimax", apiKey }, false, "anthropic"), body: JSON.stringify(body) },
    { relay: null, proxy: null },
  );
  return c.body(await resp.text(), resp.status as any, {
    "content-type": resp.headers.get("content-type") ?? "application/json",
  });
});

app.post("/v1/embeddings", async (c) => {
  const body = await c.req.json();
  const url = `${getBaseUrl({ provider: "minimax", baseUrl: null }, "openai")}/v1/embeddings`;
  const apiKey = process.env.MINIMAX_API_KEY ?? "mm_test";
  const resp = await proxyAwareFetch(
    url,
    { method: "POST", headers: buildHeaders({ provider: "minimax", apiKey }, false, "openai"), body: JSON.stringify(body) },
    { relay: null, proxy: null },
  );
  return c.body(await resp.text(), resp.status as any, {
    "content-type": resp.headers.get("content-type") ?? "application/json",
  });
});

app.get("/v1/models", async (c) => {
  const url = `${getBaseUrl({ provider: "minimax", baseUrl: null }, "openai")}/v1/models`;
  const apiKey = process.env.MINIMAX_API_KEY ?? "mm_test";
  const resp = await proxyAwareFetch(
    url,
    { method: "GET", headers: buildHeaders({ provider: "minimax", apiKey }, false, "openai") },
    { relay: null, proxy: null },
  );
  return c.body(await resp.text(), resp.status as any, {
    "content-type": resp.headers.get("content-type") ?? "application/json",
  });
});
```

- [x] **Step 4: Run tests (expect pass)**

Run: `npm test`
Expected: PASS — 17 tests total

- [x] **Step 5: Commit**

```bash
git add src/server.ts src/server.test.ts
git commit -m "feat: count_tokens, embeddings, models passthrough routes"
```

---

## Task 1.9: Server listener + manual smoke test

**Files:**
- Modify: `src/server.ts`
- Create: `src/util/log.ts`

- [x] **Step 1: Write `src/util/log.ts`**

```ts
import pino from "pino";

export const log = pino({
  level: process.env.LOG_LEVEL ?? "info",
});
```

- [x] **Step 2: Add listener to `src/server.ts`**

At the bottom (after `export { app }`):
```ts
import { serve } from "@hono/node-server";
import { log } from "./util/log.js";

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = parseInt(process.env.PORT ?? "20137", 10);
  const hostname = process.env.HOST ?? "127.0.0.1";
  serve({ fetch: app.fetch, port, hostname }, (info) => {
    log.info({ address: info.address, port: info.port }, "router listening");
  });
}
```

- [x] **Step 3: Run tests (must still pass)**

Run: `npm test`
Expected: PASS — 17 tests

- [x] **Step 4: Manual smoke test**

Run: `npm run dev` (in one terminal)
In another terminal:
```bash
curl -s http://127.0.0.1:20137/health
# Expected: {"ok":true}
```
Stop dev server.

- [x] **Step 5: Commit**

```bash
git add src/server.ts src/util/log.ts
git commit -m "feat: listener + pino logger"
```

---

## Task 1.10: Phase 1 checkpoint

- [x] **Step 1: Run full test suite**

Run: `npm test`
Expected: 17+ tests, all green

- [x] **Step 2: Verify type check**

Run: `npx tsc --noEmit`
Expected: no errors

- [x] **Step 3: Commit + push**

```bash
git add .
git commit -m "chore: phase 1 v0.1 checkpoint" --allow-empty
git push origin main
```

- [x] **Step 4: Tag**

```bash
git tag v0.1
git push origin v0.1
```

---

**End of Phase 1.** Continue to [Phase 2: v0.2 Auth + Multi-Account](./2026-06-01-minimax-router-phase-2-v02-auth-accounts.md).
