import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { openDb } from "./db/index.js";
import { requireApiKey, requireAdmin } from "./auth.js";
import { upstreamUrl, upstreamHeaders, PROVIDER } from "./providers/minimax.js";
import { upstreamFetch } from "./providers/upstreamFetch.js";
import { selectAccount } from "./accounts/selection.js";
import { isModelLockActive } from "./accounts/state.js";
import { getModelLock, setModelLock, clearExpiredModelLocks } from "./accounts/locks.js";
import { checkFallbackError } from "./accounts/errorRules.js";
import { updateAccount } from "./db/repos/accounts.js";
import { insertRequestLog } from "./db/repos/requestLogs.js";
import { resolveModel } from "./providers/alias.js";
import { calculateCost } from "./providers/pricing.js";
import { fetchModels } from "./providers/listModels.js";
import { log } from "./util/log.js";
import { getHost, getPort } from "./util/env.js";
import { augmentRequest } from "./cache-injection.js";
import { compressMessages, formatRtkLog } from "./rtk/index.js";
import { pipeWithUsage } from "./streaming/pipeWithUsage.js";
import { getSetting, setSetting } from "./db/repos/settings.js";
import { startQuotaPuller } from "./scheduler/quotaPull.js";
import { createAccount } from "./db/repos/accounts.js";
import { renderOverview } from "./dashboard/pages/overview.js";
import { renderUsage } from "./dashboard/pages/usage.js";
import { renderAccounts } from "./dashboard/pages/accounts.js";
import { renderModels } from "./dashboard/pages/models.js";
import { renderQuota } from "./dashboard/pages/quota.js";
import { renderSettings } from "./dashboard/pages/settings.js";
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
  c.set("startTime", Date.now());
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

  const db = c.get("db");
  const settings = {
    caveman: (getSetting(db, "caveman") as { level: string } | null) ?? undefined,
    caching: (getSetting(db, "caching") as { autoBreakpoints: boolean; respectCallerMarkers: boolean } | null) ?? undefined,
  };
  await augmentRequest(body, settings);

  const rtkSetting = getSetting(db, "rtk") as { enabled: boolean } | null;
  if (rtkSetting?.enabled) {
    const stats = compressMessages(body, true);
    const log = formatRtkLog(stats);
    if (log) console.log(log);
  }

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

  // Per-model lock: skip accounts that have an active lock for this model.
  clearExpiredModelLocks(c.get("db"));
  if (isModelLockActive(getModelLock(c.get("db"), account.id, resolved.upstreamModel))) {
    return c.json({ error: `model ${resolved.upstreamModel} temporarily locked for account ${account.id}` }, 429);
  }

  const url = upstreamUrl({ provider: PROVIDER, apiKey: acc.api_key, baseUrl: acc.base_url }, format, upstreamPath);
  const headers = upstreamHeaders({ provider: PROVIDER, apiKey: acc.api_key, baseUrl: acc.base_url }, body.stream === true, format);

  try {
    const resp = await upstreamFetch(url, body, headers);
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
      // Per-model lock: prevent same model from being retried until cooldown.
      if (decision.cooldownMs > 0) {
        setModelLock(c.get("db"), account.id, resolved.upstreamModel, decision.cooldownMs);
      }
      return c.body(errBody, resp.status as any, {
        "content-type": resp.headers.get("content-type") ?? "application/json",
      });
    }
    updateAccount(c.get("db"), account.id, { rate_limited_until: null, backoff_level: 0, last_error: null, status: "active" });

    if (body.stream === true) {
      // Streaming: tee upstream bytes to client, extract usage on completion, log.
      const startMs = c.get("startTime");
      const userId = user.id;
      const accountId = account.id;
      const modelName = body.model;
      const piped = await pipeWithUsage(resp, format, (usage) => {
        const prompt = usage?.prompt_tokens ?? 0;
        const completion = usage?.completion_tokens ?? 0;
        const cacheCreate = usage?.cache_creation_tokens ?? 0;
        const cacheRead = usage?.cache_read_tokens ?? 0;
        const total = usage?.total_tokens ?? prompt + completion;
        const cost = calculateCost(c.get("db"), modelName, {
          prompt_tokens: prompt, completion_tokens: completion,
          cache_creation_tokens: cacheCreate, cache_read_tokens: cacheRead,
        });
        insertRequestLog(c.get("db"), {
          user_id: userId, account_id: accountId, model: modelName,
          endpoint: upstreamPath, format,
          prompt_tokens: prompt, completion_tokens: completion,
          cache_creation_tokens: cacheCreate, cache_read_tokens: cacheRead,
          total_tokens: total, cost_usd: cost,
          latency_ms: Date.now() - startMs, status_code: resp.status,
          base_resp_code: undefined, stream: 1, rtk_bytes_saved: 0,
        });
      });
      return piped;
    }

    let respBody = await resp.text();
    let usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; cache_creation_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } } = {};
    try { usage = JSON.parse(respBody).usage ?? {}; } catch {}
    const cost = calculateCost(c.get("db"), body.model, {
      prompt_tokens: usage.prompt_tokens ?? 0,
      completion_tokens: usage.completion_tokens ?? 0,
      cache_creation_tokens: usage.cache_creation_tokens ?? 0,
      cache_read_tokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
    });
    insertRequestLog(c.get("db"), {
      user_id: user.id, account_id: account.id, model: body.model,
      endpoint: upstreamPath, format,
      prompt_tokens: usage.prompt_tokens ?? 0,
      completion_tokens: usage.completion_tokens ?? 0,
      cache_creation_tokens: usage.cache_creation_tokens ?? 0,
      cache_read_tokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
      total_tokens: usage.total_tokens ?? 0,
      cost_usd: cost,
      latency_ms: Date.now() - c.get("startTime"),
      status_code: resp.status,
      base_resp_code: undefined,
      stream: 0,
      rtk_bytes_saved: 0,
    });
    return c.body(respBody, resp.status as any, { "content-type": resp.headers.get("content-type") ?? "application/json" });
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

app.post("/admin/models/fetch", requireAdmin, async (c) => {
  const user = c.get("user");
  const firstActive = user.accounts.find((a: { enabled: boolean }) => a.enabled);
  if (!firstActive) return c.json({ error: "no active account" }, 400);
  try {
    const added = await fetchModels(c.get("db"), firstActive.api_key);
    return c.json({ added });
  } catch (e: any) {
    return c.json({ error: e.message }, 502);
  }
});

app.get("/admin", requireAdmin, (c) => {
  const u = c.get("user");
  return c.html(renderOverview(c.get("db"), u.id, u.name));
});
app.get("/admin/usage", requireAdmin, (c) => c.html(renderUsage(c.get("db"), c.get("user").id)));
app.get("/admin/accounts", requireAdmin, (c) => c.html(renderAccounts(c.get("db"), c.get("user").id)));
app.get("/admin/models", requireAdmin, (c) => c.html(renderModels(c.get("db"), c.get("user").id)));
app.get("/admin/quota", requireAdmin, (c) => c.html(renderQuota(c.get("db"), c.get("user").id)));
app.get("/admin/settings", requireAdmin, (c) => c.html(renderSettings(c.get("db"))));

app.post("/admin/accounts", requireAdmin, async (c) => {
  const body = await c.req.parseBody();
  const u = c.get("user");
  const id = `acc_${Math.random().toString(36).slice(2, 14)}`;
  createAccount(c.get("db"), {
    id, user_id: u.id, label: String(body.label),
    credit_type: String(body.credit_type) as "payg" | "token-plan",
    api_key: String(body.api_key),
  });
  return c.redirect("/admin/accounts");
});

app.post("/admin/settings/caveman", requireAdmin, async (c) => {
  const body = await c.req.parseBody();
  setSetting(c.get("db"), "caveman", { level: String(body.level) });
  return c.redirect("/admin/settings");
});
app.post("/admin/settings/rtk", requireAdmin, async (c) => {
  const body = await c.req.parseBody();
  setSetting(c.get("db"), "rtk", { enabled: body.enabled === "on" || body.enabled === "true" });
  return c.redirect("/admin/settings");
});
app.post("/admin/settings/caching", requireAdmin, async (c) => {
  const body = await c.req.parseBody();
  setSetting(c.get("db"), "caching", { autoBreakpoints: body.autoBreakpoints === "on" });
  return c.redirect("/admin/settings");
});

export { app };

// for test isolation: allow resetting the db instance
export function resetDb(): void { _db = null; }

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = getPort();
  const hostname = getHost();
  serve({ fetch: app.fetch, port, hostname }, (info) => {
    log.info({ address: info.address, port: info.port }, "router listening");
    startQuotaPuller(getDb(), 5 * 60_000);
  });
}