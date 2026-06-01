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
import { listEnabledAccounts, updateAccount, createAccount } from "./db/repos/accounts.js";
import { insertRequestLog } from "./db/repos/requestLogs.js";
import { resolveModel } from "./providers/alias.js";
import { calculateCost } from "./providers/pricing.js";
import { fetchModels } from "./providers/listModels.js";
import { log } from "./util/log.js";
import { getHost, getPort } from "./util/env.js";
import { augmentRequest } from "./cache-injection.js";
import { compressMessages, formatRtkLog } from "./rtk/index.js";
import { pipeWithUsage } from "./streaming/pipeWithUsage.js";
import {
  bodyOpenAIToAnthropic, bodyAnthropicToOpenAI,
  responseOpenAIToAnthropic, responseAnthropicToOpenAI,
  bodyAddsOpenAIStreamUsage,
} from "./providers/format/transform.js";
import { getUpstreamFormat } from "./providers/format/negotiate.js";
import { getSetting, setSetting } from "./db/repos/settings.js";
import { startQuotaPuller } from "./scheduler/quotaPull.js";
import { renderOverview } from "./dashboard/pages/overview.js";
import { renderUsage } from "./dashboard/pages/usage.js";
import { renderAccounts } from "./dashboard/pages/accounts.js";
import { renderModels } from "./dashboard/pages/models.js";
import { renderQuota } from "./dashboard/pages/quota.js";
import { renderSettings } from "./dashboard/pages/settings.js";
import { renderClientKeys } from "./dashboard/pages/clientKeys.js";
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

async function handleProxy(c: any, format: "openai" | "anthropic", upstreamPath: string): Promise<Response> {
  const clientKey = c.get("clientKey");
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
    const rtkLog = formatRtkLog(stats);
    if (rtkLog) console.log(rtkLog);
  }

  // Pool: ALL enabled MiniMax accounts (shared across all client keys).
  const allAccounts = listEnabledAccounts(db);
  if (allAccounts.length === 0) {
    return c.json({ error: "no upstream accounts configured" }, 503);
  }
  const accountStates: AccountState[] = allAccounts.map((a) => ({
    id: a.id,
    backoffLevel: a.backoff_level,
    rateLimitedUntil: a.rate_limited_until,
    lastError: a.last_error ? JSON.parse(a.last_error) : null,
    status: a.status as AccountState["status"],
    enabled: !!a.enabled,
  }));
  const account = selectAccount(accountStates, "round-robin", undefined);
  if (!account) return c.json({ error: "all accounts unavailable" }, 503);
  const acc = allAccounts.find((a) => a.id === account.id)!;

  let resolved;
  try {
    resolved = resolveModel(db, body.model ?? "", body);
    body.model = resolved.upstreamModel;
    resolved.bodyTransform(body);
  } catch (e: any) {
    return c.json({ error: e.message }, 400);
  }

  // Determine upstream format. Default = same as client. Override via
  // settings.minimax.upstreamFormat or ROUTER_UPSTREAM_FORMAT env.
  const overrideRaw = (getSetting(db, "minimax") as { upstreamFormat?: string } | null)?.upstreamFormat
    ?? process.env.ROUTER_UPSTREAM_FORMAT
    ?? "auto";
  const upstreamFormat = getUpstreamFormat(format, overrideRaw as "auto" | "openai" | "anthropic");

  // OpenAI streaming: ensure include_usage so the final chunk carries usage.
  if (upstreamFormat === "openai") {
    bodyAddsOpenAIStreamUsage(body);
  }

  // Cross-format body conversion (only when client != upstream).
  if (format !== upstreamFormat) {
    if (format === "openai" && upstreamFormat === "anthropic") {
      Object.assign(body, bodyOpenAIToAnthropic(body));
    } else if (format === "anthropic" && upstreamFormat === "openai") {
      Object.assign(body, bodyAnthropicToOpenAI(body));
    }
  }

  clearExpiredModelLocks(db);
  if (isModelLockActive(getModelLock(db, account.id, resolved.upstreamModel))) {
    return c.json({ error: `model ${resolved.upstreamModel} temporarily locked` }, 429);
  }

  const url = upstreamUrl({ provider: PROVIDER, apiKey: acc.api_key, baseUrl: acc.base_url }, upstreamFormat, upstreamPath);
  const headers = upstreamHeaders({ provider: PROVIDER, apiKey: acc.api_key, baseUrl: acc.base_url }, body.stream === true, upstreamFormat);

  try {
    const resp = await upstreamFetch(url, body, headers);
    if (!resp.ok) {
      const errBody = await resp.text();
      let baseRespCode: number | undefined;
      try { baseRespCode = JSON.parse(errBody).base_resp?.status_code; } catch {}
      const decision = checkFallbackError(resp.status, errBody, baseRespCode, acc.backoff_level);
      const rateLimitedUntil = decision.cooldownMs > 0
        ? new Date(Date.now() + decision.cooldownMs).toISOString()
        : null;
      updateAccount(db, account.id, {
        rate_limited_until: rateLimitedUntil,
        backoff_level: decision.newBackoffLevel ?? 0,
        last_error: JSON.stringify({ status: resp.status, message: errBody.slice(0, 500), timestamp: new Date().toISOString(), baseRespCode }),
        status: resp.status === 401 ? "error" : "active",
      });
      if (decision.cooldownMs > 0) {
        setModelLock(db, account.id, resolved.upstreamModel, decision.cooldownMs);
      }
      return c.body(errBody, resp.status as any, {
        "content-type": resp.headers.get("content-type") ?? "application/json",
      });
    }
    updateAccount(db, account.id, { rate_limited_until: null, backoff_level: 0, last_error: null, status: "active" });

    if (body.stream === true) {
      const startMs = c.get("startTime");
      const clientKeyId = clientKey.id;
      const accountId = account.id;
      const modelName = body.model;
      const piped = await pipeWithUsage(resp, format, (usage) => {
        const prompt = usage?.prompt_tokens ?? 0;
        const completion = usage?.completion_tokens ?? 0;
        const cacheCreate = usage?.cache_creation_tokens ?? 0;
        const cacheRead = usage?.cache_read_tokens ?? 0;
        const total = usage?.total_tokens ?? prompt + completion;
        const cost = calculateCost(db, modelName, {
          prompt_tokens: prompt, completion_tokens: completion,
          cache_creation_tokens: cacheCreate, cache_read_tokens: cacheRead,
        });
        insertRequestLog(db, {
          client_key_id: clientKeyId, account_id: accountId, model: modelName,
          endpoint: upstreamPath, format: upstreamFormat,
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
    // Cross-format response conversion (non-stream only). Stream responses
    // pass through with upstream shape — stream-shape re-emit is deferred.
    if (format !== upstreamFormat) {
      try {
        const parsed = JSON.parse(respBody);
        // The response is in upstreamFormat. Convert to client format.
        const converted = upstreamFormat === "anthropic"
          ? responseAnthropicToOpenAI(parsed)
          : responseOpenAIToAnthropic(parsed);
        respBody = JSON.stringify(converted);
      } catch { /* non-JSON or malformed; pass through */ }
    }
    let usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; cache_creation_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } } = {};
    try { usage = JSON.parse(respBody).usage ?? {}; } catch {}
    const cost = calculateCost(db, body.model, {
      prompt_tokens: usage.prompt_tokens ?? 0,
      completion_tokens: usage.completion_tokens ?? 0,
      cache_creation_tokens: usage.cache_creation_tokens ?? 0,
      cache_read_tokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
    });
    insertRequestLog(db, {
      client_key_id: clientKey.id, account_id: account.id, model: body.model,
      endpoint: upstreamPath, format: upstreamFormat,
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
app.post("/v1/embeddings", requireApiKey, (c) => c.json({ error: "embeddings not supported by MiniMax" }, 501));
app.get("/v1/models", requireApiKey, (c) => handleProxy(c, "openai", "/v1/models"));

app.post("/admin/models/fetch", requireAdmin, async (c) => {
  const db = c.get("db");
  const firstActive = listEnabledAccounts(db)[0];
  if (!firstActive) return c.json({ error: "no active account" }, 400);
  try {
    const added = await fetchModels(db, firstActive.api_key);
    return c.json({ added });
  } catch (e: any) {
    return c.json({ error: e.message }, 502);
  }
});

app.get("/admin", requireAdmin, (c) => c.html(renderOverview(c.get("db"))));
app.get("/admin/usage", requireAdmin, (c) => {
  const url = new URL(c.req.url);
  const clientKeyId = url.searchParams.get("client_key");
  return c.html(renderUsage(c.get("db"), clientKeyId ? Number(clientKeyId) : undefined));
});
app.get("/admin/accounts", requireAdmin, (c) => c.html(renderAccounts(c.get("db"))));
app.get("/admin/models", requireAdmin, (c) => c.html(renderModels(c.get("db"))));
app.get("/admin/quota", requireAdmin, (c) => c.html(renderQuota(c.get("db"))));
app.get("/admin/settings", requireAdmin, (c) => c.html(renderSettings(c.get("db"))));
app.get("/admin/client-keys", requireAdmin, (c) => c.html(renderClientKeys(c.get("db"))));

app.post("/admin/accounts", requireAdmin, async (c) => {
  const body = await c.req.parseBody();
  const id = `acc_${Math.random().toString(36).slice(2, 14)}`;
  createAccount(c.get("db"), {
    id,
    label: String(body.label),
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

export function resetDb(): void { _db = null; }

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = getPort();
  const hostname = getHost();
  serve({ fetch: app.fetch, port, hostname }, (info) => {
    log.info({ address: info.address, port: info.port }, "router listening");
    startQuotaPuller(getDb(), 5 * 60_000);
  });
}
