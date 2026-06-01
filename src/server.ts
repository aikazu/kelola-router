import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { openDb } from "./db/index.js";
import { requireApiKey } from "./auth.js";
import { getBaseUrl } from "./providers/baseUrl.js";
import { buildHeaders } from "./providers/headers.js";
import { proxyAwareFetch } from "./transport/proxyFetch.js";
import { selectAccount } from "./accounts/selection.js";
import { checkFallbackError } from "./accounts/errorRules.js";
import { updateAccount } from "./db/repos/accounts.js";
import { resolveModel } from "./providers/alias.js";
import { log } from "./util/log.js";
import type Database from "better-sqlite3";
import type { AccountState } from "./accounts/types.js";

let _db: Database.Database | null = null;
function getDb(): Database.Database {
  if (!_db) _db = openDb();
  return _db;
}

const app = new Hono();
app.use("*", async (c, next) => {
  c.set("db", getDb());
  await next();
});

app.get("/health", (c) => c.json({ ok: true }));

function userSettings(db: Database.Database, userId: number): { mode: "sticky" | "round-robin"; stickyKey: string } {
  const row = db.prepare(`SELECT value FROM user_settings WHERE user_id = ? AND key = 'account_mode'`).get(userId) as { value: string } | undefined;
  if (!row) return { mode: "round-robin", stickyKey: "x-router-key" };
  return JSON.parse(row.value);
}

async function handleProxy(c: any, format: "openai" | "anthropic", upstreamPath: string): Promise<Response> {
  const user = c.get("user");
  const body = await c.req.json();
  const cfg = userSettings(c.get("db"), user.id);
  const accountStates: AccountState[] = user.accounts.map((a: { id: string; rate_limited_until: string | null; status: string; enabled: boolean }) => ({
    id: a.id, backoffLevel: 0, rateLimitedUntil: a.rate_limited_until, lastError: null, status: a.status as any, enabled: !!a.enabled,
  }));
  const stickyKey = c.req.header(cfg.stickyKey);
  const account = selectAccount(accountStates, cfg.mode, stickyKey ?? undefined);
  if (!account) return c.json({ error: "all accounts unavailable" }, 503);

  const acc = user.accounts.find((a: { id: string }) => a.id === account.id)!;

  let resolved;
  try {
    resolved = resolveModel(c.get("db"), body.model ?? "", body);
    body.model = resolved.upstreamModel;
    resolved.bodyTransform(body);
  } catch (e: any) {
    return c.json({ error: e.message }, 400);
  }

  const url = `${getBaseUrl({ provider: "minimax", baseUrl: acc.base_url }, format)}${upstreamPath}`;
  const headers = buildHeaders({ provider: "minimax", apiKey: acc.api_key }, body.stream === true, format);

  try {
    const resp = await proxyAwareFetch(url, { method: "POST", headers, body: JSON.stringify(body) }, { relay: null, proxy: null });
    if (!resp.ok) {
      const errBody = await resp.text();
      let baseRespCode: number | undefined;
      try { baseRespCode = JSON.parse(errBody).base_resp?.status_code; } catch {}
      const decision = checkFallbackError(resp.status, errBody, baseRespCode, 0);
      const rateLimitedUntil = decision.cooldownMs > 0
        ? new Date(Date.now() + decision.cooldownMs).toISOString()
        : null;
      updateAccount(c.get("db"), account.id, {
        rate_limited_until: rateLimitedUntil,
        backoff_level: decision.newBackoffLevel ?? 0,
        last_error: JSON.stringify({ status: resp.status, message: errBody.slice(0, 500), timestamp: new Date().toISOString(), baseRespCode }),
        status: resp.status === 401 ? "error" : "active",
      });
      return c.body(errBody, resp.status as any, {
        "content-type": resp.headers.get("content-type") ?? "application/json",
      });
    }
    updateAccount(c.get("db"), account.id, { rate_limited_until: null, backoff_level: 0, last_error: null, status: "active" });
    return c.body(await resp.text(), resp.status as any, {
      "content-type": resp.headers.get("content-type") ?? "application/json",
    });
  } catch (e: any) {
    log.error({ err: e.message }, "upstream unreachable");
    return c.json({ error: `upstream unreachable: ${e.message}` }, 502);
  }
}

app.post("/v1/chat/completions", requireApiKey, (c) => handleProxy(c, "openai", "/v1/chat/completions"));
app.post("/v1/messages", requireApiKey, (c) => handleProxy(c, "anthropic", "/v1/messages"));
app.post("/v1/messages/count_tokens", requireApiKey, (c) => handleProxy(c, "anthropic", "/v1/messages/count_tokens"));
app.post("/v1/embeddings", requireApiKey, (c) => handleProxy(c, "openai", "/v1/embeddings"));
app.get("/v1/models", requireApiKey, (c) => handleProxy(c, "openai", "/v1/models"));

export { app };

// for test isolation: allow resetting the db instance
export function resetDb(): void { _db = null; }

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = parseInt(process.env.PORT ?? "20137", 10);
  const hostname = process.env.HOST ?? "127.0.0.1";
  serve({ fetch: app.fetch, port, hostname }, (info) => {
    log.info({ address: info.address, port: info.port }, "router listening");
  });
}