import { page } from "../render.js";
import { aggregateUsage, recentLogs } from "../../db/repos/requestLogs.js";
import { listAccounts } from "../../db/repos/accounts.js";
import { isPasswordSet } from "../../auth/password.js";
import type Database from "better-sqlite3";

export function renderOverview(db: Database.Database): string {
  const agg = aggregateUsage(db, { days: 7 });
  const accounts = listAccounts(db);
  const logs = recentLogs(db, { limit: 5 });
  const enabledAccounts = accounts.filter(a => a.enabled).length;

  // Onboarding checklist — shown when state is incomplete
  const onboardingItems: string[] = [];
  if (accounts.length === 0) {
    onboardingItems.push(`Add at least one <a href="/admin/accounts">MiniMax upstream account</a> so the router has a key to forward requests with.`);
  }
  const ckCount = (db.prepare(`SELECT COUNT(*) as n FROM client_keys WHERE enabled = 1`).get() as { n: number }).n;
  if (ckCount === 0) {
    onboardingItems.push(`Create a <a href="/admin/client-keys">client bearer key</a> for each app that should reach the router (Claude Code, hermes-agent, etc).`);
  }
  if (!isPasswordSet(db)) {
    onboardingItems.push(`Optional: <a href="/admin/settings">set a dashboard password</a> if you'll expose this beyond localhost.`);
  }
  const onboarding = onboardingItems.length > 0 ? `
    <div class="alert">
      <strong>Getting started</strong>
      <ul style="margin:10px 0 0 18px; line-height:1.8">
        ${onboardingItems.map(t => `<li>${t}</li>`).join("")}
      </ul>
    </div>
  ` : "";

  const body = `
    ${onboarding}
    <div class="stat-grid">
      <div class="stat">
        <div class="stat-label">Cost (7d)</div>
        <div class="stat-value">$${agg.total_cost.toFixed(2)}</div>
        <div class="stat-sub">${agg.total_requests} requests</div>
      </div>
      <div class="stat">
        <div class="stat-label">Tokens (7d)</div>
        <div class="stat-value">${agg.total_tokens.toLocaleString()}</div>
        <div class="stat-sub">prompt + completion + cache</div>
      </div>
      <div class="stat">
        <div class="stat-label">Upstream accounts</div>
        <div class="stat-value">${enabledAccounts}<span style="font-size:14px;color:var(--text-3)"> / ${accounts.length}</span></div>
        <div class="stat-sub">enabled / total in pool</div>
      </div>
      <div class="stat">
        <div class="stat-label">Client keys</div>
        <div class="stat-value">${ckCount}</div>
        <div class="stat-sub">active bearers</div>
      </div>
    </div>
    <div class="card">
      <div class="card-title">By model (last 7 days)</div>
      ${agg.by_model.length === 0
        ? `<p class="card-sub">No requests yet.</p>`
        : `<table>
            <tr><th>Model</th><th>Cost</th><th>Requests</th></tr>
            ${agg.by_model.map((m) => `<tr><td>${m.model}</td><td>$${m.cost.toFixed(4)}</td><td>${m.requests}</td></tr>`).join("")}
          </table>`}
    </div>
    <div class="card">
      <div class="card-title">Recent requests</div>
      ${logs.length === 0
        ? `<p class="card-sub">No traffic yet.</p>`
        : `<table>
            <tr><th>Time</th><th>Client</th><th>Account</th><th>Model</th><th>Status</th><th>Cost</th></tr>
            ${logs.map((l) => `<tr><td>${l.created_at}</td><td>${l.client_key_id ?? "—"}</td><td>${l.account_id ?? "—"}</td><td>${l.model}</td><td>${l.status_code}</td><td>$${l.cost_usd.toFixed(4)}</td></tr>`).join("")}
          </table>`}
    </div>
  `;
  return page("Overview", "overview", body, { db });
}
