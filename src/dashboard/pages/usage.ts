import { page } from "../render.js";
import { recentLogs, aggregateUsage } from "../../db/repos/requestLogs.js";
import { listClientKeys } from "../../db/repos/client_keys.js";
import type Database from "better-sqlite3";

export function renderUsage(db: Database.Database, clientKeyId?: number): string {
  const filter = clientKeyId !== undefined ? { clientKeyId } : {};
  const logs = recentLogs(db, { ...filter, limit: 100 });
  const agg = aggregateUsage(db, { ...filter, days: 30 });
  const keys = listClientKeys(db);
  const filterLabel = clientKeyId !== undefined
    ? keys.find((k) => k.id === clientKeyId)?.label ?? `#${clientKeyId}`
    : "all client keys";
  const body = `
    <h1>Usage (last 30 days)</h1>
    <p>Filter:
      <a href="/admin/usage"${clientKeyId === undefined ? ' class="active"' : ""}>all</a>
      ${keys.map((k) => `<a href="/admin/usage?client_key=${k.id}"${k.id === clientKeyId ? ' class="active"' : ""}>${k.label}</a>`).join(" ")}
    </p>
    <p>Total (${escapeHtml(filterLabel)}): $${agg.total_cost.toFixed(4)} | ${agg.total_requests} requests | ${agg.total_tokens.toLocaleString()} tokens</p>
    <table>
      <tr><th>Time</th><th>Client</th><th>Model</th><th>Account</th><th>Tokens</th><th>Cost</th><th>Status</th><th>Latency</th></tr>
      ${logs.map((l) => `<tr><td>${l.created_at}</td><td>${l.client_key_id ?? ""}</td><td>${l.model}</td><td>${l.account_id ?? ""}</td><td>${l.total_tokens}</td><td>$${l.cost_usd.toFixed(4)}</td><td>${l.status_code}</td><td>${l.latency_ms}ms</td></tr>`).join("")}
    </table>
  `;
  return page("Usage", "usage", body, { db });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
