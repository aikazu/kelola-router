import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { existsSync } from "node:fs";
import { openDb } from "./db/index.js";
import { requireApiKey, requireAdmin, handleLogin, handleLogout, renderLoginPage, verifySameOrigin } from "./auth.js";
import { upstreamUrl, upstreamHeaders, PROVIDER } from "./providers/minimax.js";
import { upstreamFetch } from "./providers/upstreamFetch.js";
import { selectAccount } from "./accounts/selection.js";
import { isModelLockActive } from "./accounts/state.js";
import { getModelLock, setModelLock, clearExpiredModelLocks } from "./accounts/locks.js";
import { checkFallbackError } from "./accounts/errorRules.js";
import { listEnabledAccounts, listAccounts, updateAccount, createAccount, enableAccount, disableAccount, deleteAccount } from "./db/repos/accounts.js";
import { createClientKey, genClientKey, enableClientKey, deleteClientKey, disableClientKey } from "./db/repos/client_keys.js";
import { enableModel, disableModel } from "./db/repos/models.js";
import { insertRequestLog } from "./db/repos/requestLogs.js";
import { truncateBody, headersToJson } from "./proxy/capture.js";
import { adminApi } from "./api/admin/index.js";
import { resolveModel } from "./providers/alias.js";
import { calculateCost } from "./providers/pricing.js";
import { fetchModels } from "./providers/listModels.js";
import { log } from "./util/log.js";
import { getHost, getPort } from "./util/env.js";
import { augmentRequest } from "./cache-injection.js";
import { compressMessages, formatRtkLog } from "./rtk/index.js";
import { pipeWithUsage } from "./streaming/pipeWithUsage.js";
import { getSetting, setSetting } from "./db/repos/settings.js";
import { setPassword } from "./auth/password.js";
import { startQuotaPuller } from "./scheduler/quotaPull.js";
import {
  bodyOpenAIToAnthropic, bodyAnthropicToOpenAI,
  responseOpenAIToAnthropic, responseAnthropicToOpenAI,
  bodyAddsOpenAIStreamUsage,
} from "./providers/format/transform.js";
import { getUpstreamFormat } from "./providers/format/negotiate.js";
import type Database from "better-sqlite3";
import type { AccountState } from "./accounts/types.js";
import { isPasswordSet } from "./auth/password.js";
import { ulid } from "ulid";

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
app.route("/api", adminApi(getDb()));

app.use("/admin/*", async (c, next) => {
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    if (!verifySameOrigin(c)) {
      return c.json({ error: "cross-origin request blocked" }, 403);
    }
  }
  await next();
});

app.get("/health", (c) => c.json({ ok: true }));

// Obsidian-gold landing page (the public homepage)
app.get("/", (c) => {
  const db = c.get("db");
  const accounts = listAccounts(db);
  const clientKeys = db.prepare("SELECT COUNT(*) as n FROM client_keys WHERE enabled = 1").get() as { n: number };
  const ckEnabled = clientKeys.n;
  const accEnabled = accounts.filter(a => a.enabled).length;
  const passwordSet = isPasswordSet(db);
  const dashboardHref = passwordSet ? "/login" : "/admin";
  return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>kelola-router</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600&family=Manrope:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
:root{--ink-0:#0a0908;--ink-1:#14110f;--ink-2:#1c1814;--ink-3:#2a2520;--gold-1:#b8860b;--gold-2:#d4af37;--gold-3:#f4d03f;--gold-4:#f9e29c;--text-1:#f5f0e6;--text-2:#a8a098;--text-3:#6a6660;--font-display:'Cormorant Garamond',Georgia,serif;--font-body:'Manrope',-apple-system,sans-serif;--font-mono:'JetBrains Mono',monospace}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:var(--font-body);background:radial-gradient(ellipse 1000px 600px at 50% -10%,rgba(212,175,55,0.06) 0%,transparent 60%),linear-gradient(180deg,var(--ink-1) 0%,var(--ink-0) 100%);color:var(--text-1);min-height:100vh;line-height:1.55;-webkit-font-smoothing:antialiased}
.wrap{max-width:820px;margin:0 auto;padding:80px 32px}
.hero{text-align:center;margin-bottom:60px}
.brand-mark{display:inline-block;font-family:var(--font-display);font-size:18px;letter-spacing:6px;text-transform:uppercase;color:var(--gold-2);padding:6px 16px;border:1px solid rgba(212,175,55,0.3);border-radius:2px;margin-bottom:32px}
h1{font-family:var(--font-display);font-size:64px;font-weight:500;letter-spacing:0.5px;line-height:1.1;margin-bottom:18px}
h1::first-letter{color:var(--gold-2)}
.tagline{color:var(--text-2);font-size:17px;letter-spacing:0.3px;max-width:580px;margin:0 auto 36px}
.divider{width:60px;height:1px;background:linear-gradient(90deg,transparent,var(--gold-2),transparent);margin:0 auto 36px;opacity:0.6}
.cta{display:flex;gap:14px;justify-content:center;flex-wrap:wrap}
.btn{display:inline-block;padding:12px 24px;background:linear-gradient(180deg,var(--gold-3) 0%,var(--gold-2) 100%);color:var(--ink-0);font-weight:700;font-size:11px;letter-spacing:2px;text-transform:uppercase;border-radius:3px;text-decoration:none;transition:transform 0.1s,box-shadow 0.15s;border:0;cursor:pointer;font-family:inherit}
.btn:hover{transform:translateY(-1px);box-shadow:0 4px 16px rgba(212,175,55,0.3);color:var(--ink-0)}
.btn-ghost{padding:12px 24px;background:transparent;color:var(--gold-3);font-size:11px;letter-spacing:2px;text-transform:uppercase;border:1px solid rgba(212,175,55,0.3);border-radius:3px;text-decoration:none;font-weight:600}
.btn-ghost:hover{background:rgba(212,175,55,0.08);color:var(--gold-4)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-bottom:36px}
.stat{background:var(--ink-2);border:1px solid rgba(212,175,55,0.18);border-radius:4px;padding:18px 20px;position:relative;overflow:hidden}
.stat::before{content:"";position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,transparent,var(--gold-2),transparent);opacity:0.5}
.stat-l{font-size:10px;letter-spacing:2px;text-transform:uppercase;color:var(--text-3);font-weight:600}
.stat-v{font-family:var(--font-display);font-size:32px;color:var(--gold-3);margin-top:4px;letter-spacing:0.5px}
.section{background:var(--ink-2);border:1px solid rgba(212,175,55,0.18);border-radius:4px;padding:24px 28px;margin-bottom:18px}
.section h2{font-family:var(--font-display);font-size:20px;font-weight:500;margin-bottom:14px}
.section h2::before{content:"❖";color:var(--gold-2);margin-right:10px;font-size:14px;opacity:0.7}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid rgba(212,175,55,0.1)}
th{font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:var(--gold-1);font-weight:600}
code{font-family:var(--font-mono);background:var(--ink-3);padding:1px 6px;border-radius:3px;font-size:12.5px;color:var(--gold-3)}
.status{display:inline-block;padding:4px 12px;border-radius:2px;font-size:10px;letter-spacing:1.5px;text-transform:uppercase;font-weight:600;background:rgba(74,124,58,0.18);color:#8fbf73;border:1px solid rgba(74,124,58,0.4)}
.status-warn{background:rgba(184,134,11,0.18);color:var(--gold-3);border-color:rgba(184,134,11,0.4)}
.footer{margin-top:60px;text-align:center;color:var(--text-3);font-size:11px;letter-spacing:1px}
</style>
</head>
<body>
<div class="wrap">
  <div class="hero">
    <div class="brand-mark">kelola-router</div>
    <h1>One proxy.<br>Many MiniMax accounts.</h1>
    <p class="tagline">Hono + better-sqlite3 routing layer. Pool MiniMax API keys, fan out requests, track per-client usage — all in a single binary.</p>
    <div class="divider"></div>
    <div class="cta">
      <a class="btn" href="${dashboardHref}">${passwordSet ? "Sign in" : "Open dashboard"}</a>
      <a class="btn-ghost" href="/health">Health</a>
    </div>
    <p style="margin-top:18px;color:var(--text-3);font-size:12px">
      <span class="status ${passwordSet ? "" : "status-warn"}">${passwordSet ? "Protected" : "Open mode"}</span>
    </p>
  </div>

  <div class="grid">
    <div class="stat"><div class="stat-l">Upstream</div><div class="stat-v">${accEnabled}<span style="font-size:14px;color:var(--text-3)"> / ${accounts.length}</span></div></div>
    <div class="stat"><div class="stat-l">Client keys</div><div class="stat-v">${ckEnabled}</div></div>
    <div class="stat"><div class="stat-l">Status</div><div class="stat-v" style="font-size:18px">${accEnabled > 0 ? "● Ready" : "○ Setup"}</div></div>
    <div class="stat"><div class="stat-l">Version</div><div class="stat-v" style="font-size:18px">v0.9</div></div>
  </div>

  <div class="section">
    <h2>What you can do</h2>
    <table>
      <tr><th>Action</th><th>Where</th></tr>
      <tr><td>Add MiniMax upstream keys (pool for fallback)</td><td><a href="/admin/accounts">/admin/accounts</a></td></tr>
      <tr><td>Create client bearer keys for your apps</td><td><a href="/admin/client-keys">/admin/client-keys</a></td></tr>
      <tr><td>Toggle RTK / Caveman / cache injection</td><td><a href="/admin/settings">/admin/settings</a></td></tr>
      <tr><td>See per-client usage breakdown</td><td><a href="/admin/usage">/admin/usage</a></td></tr>
      <tr><td>Lock dashboard behind a password</td><td><a href="/admin/settings">/admin/settings</a></td></tr>
    </table>
  </div>

  <div class="section">
    <h2>Proxy endpoints</h2>
    <table>
      <tr><th>Provider</th><th>Path</th><th>Auth</th></tr>
      <tr><td>OpenAI</td><td><code>POST /v1/chat/completions</code></td><td><code>Authorization: Bearer &lt;client_key&gt;</code></td></tr>
      <tr><td>Anthropic</td><td><code>POST /v1/messages</code></td><td>same</td></tr>
      <tr><td>Anthropic</td><td><code>POST /v1/messages/count_tokens</code></td><td>same</td></tr>
      <tr><td>List models</td><td><code>GET /v1/models</code></td><td>same</td></tr>
    </table>
  </div>

  <div class="footer">kelola-router · single-process SQLite-WAL · ${accEnabled > 0 ? "operational" : "awaiting setup"}</div>
</div>
</body>
</html>`);
});

app.get("/login", (c) => c.html(renderLoginPage("", c.get("db"))));
app.post("/login", handleLogin);
app.post("/logout", handleLogout);

async function handleProxy(c: any, format: "openai" | "anthropic", upstreamPath: string): Promise<Response> {
  const clientKey = c.get("clientKey");
  const text = await c.req.text();
  let body: any = {};
  if (text) { try { body = JSON.parse(text); } catch (e: any) { return c.json({ error: `invalid JSON: ${e.message}` }, 400); } }
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
          request_body: truncateBody(text),
          request_headers: headersToJson(c.req.raw.headers),
          response_headers: headersToJson(resp.headers),
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
      request_body: truncateBody(text),
      response_body: truncateBody(respBody),
      request_headers: headersToJson(c.req.raw.headers),
      response_headers: headersToJson(resp.headers),
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
  if (!firstActive) return c.json({ error: "no active account — add a MiniMax upstream key first" }, 400);
  const result = await fetchModels(db, firstActive.api_key);
  if (!result.ok) {
    return c.json({ error: result.error ?? "fetch failed", status: result.status }, 502);
  }
  return c.redirect(`/admin/models?fetched=${result.added ?? 0}`);
});
app.post("/admin/models/:name/enable", requireAdmin, (c) => {
  enableModel(c.get("db"), c.req.param("name")!);
  return c.redirect("/admin/models");
});
app.post("/admin/models/:name/disable", requireAdmin, (c) => {
  disableModel(c.get("db"), c.req.param("name")!);
  return c.redirect("/admin/models");
});

app.get("/admin", requireAdmin, (c) => c.redirect("/"));
app.get("/admin/usage", requireAdmin, (c) => c.redirect("/"));
app.get("/admin/accounts", requireAdmin, (c) => c.redirect("/"));
app.get("/admin/models", requireAdmin, (c) => c.redirect("/"));
app.get("/admin/quota", requireAdmin, (c) => c.redirect("/"));
app.get("/admin/settings", requireAdmin, (c) => c.redirect("/"));
app.get("/admin/client-keys", requireAdmin, (c) => c.redirect("/"));

app.post("/admin/accounts", requireAdmin, async (c) => {
  const body = await c.req.parseBody();
  const id = `acc_${ulid()}`;
  createAccount(c.get("db"), {
    id,
    label: String(body.label),
    credit_type: String(body.credit_type) as "payg" | "token-plan",
    api_key: String(body.api_key),
  });
  return c.redirect("/admin/accounts");
});
app.post("/admin/accounts/:id/enable", requireAdmin, (c) => {
  enableAccount(c.get("db"), c.req.param("id")!);
  return c.redirect("/admin/accounts");
});
app.post("/admin/accounts/:id/disable", requireAdmin, (c) => {
  disableAccount(c.get("db"), c.req.param("id")!);
  return c.redirect("/admin/accounts");
});
app.post("/admin/accounts/:id/delete", requireAdmin, (c) => {
  deleteAccount(c.get("db"), c.req.param("id")!);
  return c.redirect("/admin/accounts");
});

app.post("/admin/client-keys", requireAdmin, async (c) => {
  const body = await c.req.parseBody();
  const label = String(body.label ?? "").trim();
  if (!label) return c.redirect("/admin/client-keys");
  createClientKey(c.get("db"), { label, key: genClientKey() });
  return c.redirect("/admin/client-keys");
});
app.post("/admin/client-keys/:id/enable", requireAdmin, (c) => {
  enableClientKey(c.get("db"), Number(c.req.param("id")));
  return c.redirect("/admin/client-keys");
});
app.post("/admin/client-keys/:id/disable", requireAdmin, (c) => {
  disableClientKey(c.get("db"), Number(c.req.param("id")));
  return c.redirect("/admin/client-keys");
});
app.post("/admin/client-keys/:id/delete", requireAdmin, (c) => {
  deleteClientKey(c.get("db"), Number(c.req.param("id")));
  return c.redirect("/admin/client-keys");
});

app.post("/admin/settings/password", requireAdmin, async (c) => {
  const body = await c.req.parseBody();
  const action = String(body.action ?? "");
  if (action === "clear") {
    c.get("db").prepare(`DELETE FROM settings WHERE key = 'admin_password'`).run();
  } else {
    const pw = String(body.password ?? "");
    if (pw.length >= 4) setPassword(c.get("db"), pw);
  }
  return c.redirect("/admin/settings");
});

app.post("/admin/settings/minimax", requireAdmin, async (c) => {
  const body = await c.req.parseBody();
  const current = (getSetting(c.get("db"), "minimax") as Record<string, unknown> | null) ?? {};
  const next = {
    ...current,
    upstreamFormat: String((body as Record<string, string>).upstreamFormat ?? "auto"),
    reasoningSplitDefault: String((body as Record<string, string>).reasoningSplitDefault ?? "false") === "true",
    m3DefaultMaxCompletionTokens: Number((body as Record<string, string>).m3DefaultMaxCompletionTokens ?? 131072),
  };
  setSetting(c.get("db"), "minimax", next);
  return c.redirect("/admin/settings");
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

// Serve built SPA if client/dist exists. In dev with `npm run dev`, Vite serves on
// :5173 with HMR; users should browse there. Visiting :20137 in dev will also serve
// the built SPA (no HMR) so URLs stay consistent.
if (existsSync("./client/dist/index.html")) {
  try {
    const { serveStatic } = await import("@hono/node-server/serve-static");
    const distRoot = "./client/dist";
    app.use("/assets/*", serveStatic({ root: distRoot }));
    app.get("*", serveStatic({ path: "./index.html", root: distRoot }));
    log.info({ root: distRoot }, "serving SPA from client/dist");
  } catch (e) {
    log.warn({ err: (e as Error).message }, "serveStatic unavailable; SPA not served");
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = getPort();
  const hostname = getHost();
  serve({ fetch: app.fetch, port, hostname }, (info) => {
    log.info({ address: info.address, port: info.port }, "router listening");
    startQuotaPuller(getDb(), 5 * 60_000);
  });
}
