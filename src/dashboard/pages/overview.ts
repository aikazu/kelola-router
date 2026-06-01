import { page } from "../render.js";
import { aggregateUsage, recentLogs } from "../../db/repos/requestLogs.js";
import { listAccounts } from "../../db/repos/accounts.js";
import type Database from "better-sqlite3";

export function renderOverview(db: Database.Database): string {
  const agg = aggregateUsage(db, { days: 7 });
  const accounts = listAccounts(db);
  const logs = recentLogs(db, { limit: 5 });
  const body = `
    <h1>Overview</h1>
    <p>Last 7 days, all client keys</p>
    <h2>Stats</h2>
    <table>
      <tr><th>Total cost</th><td>$${agg.total_cost.toFixed(4)}</td></tr>
      <tr><th>Total requests</th><td>${agg.total_requests}</td></tr>
      <tr><th>Total tokens</th><td>${agg.total_tokens.toLocaleString()}</td></tr>
      <tr><th>Active accounts</th><td>${accounts.filter((a) => a.enabled).length} / ${accounts.length}</td></tr>
    </table>
    <h2>By model</h2>
    <table>
      <tr><th>Model</th><th>Cost</th><th>Requests</th></tr>
      ${agg.by_model.map((m) => `<tr><td>${m.model}</td><td>$${m.cost.toFixed(4)}</td><td>${m.requests}</td></tr>`).join("")}
    </table>
    <h2>Recent requests</h2>
    <table>
      <tr><th>Time</th><th>Client</th><th>Account</th><th>Model</th><th>Status</th><th>Cost</th></tr>
      ${logs.map((l) => `<tr><td>${l.created_at}</td><td>${l.client_key_id ?? "—"}</td><td>${l.account_id ?? "—"}</td><td>${l.model}</td><td>${l.status_code}</td><td>$${l.cost_usd.toFixed(4)}</td></tr>`).join("")}
    </table>
  `;
  return page("Overview", "overview", body, { db });
}
