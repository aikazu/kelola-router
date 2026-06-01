import { layout } from "../layout.js";
import { recentLogs, aggregateUsage } from "../../db/repos/requestLogs.js";
import type Database from "better-sqlite3";

export function renderUsage(db: Database.Database, userId: number): string {
  const logs = recentLogs(db, userId, 100);
  const agg = aggregateUsage(db, userId, 30);
  const body = `
    <h1>Usage (last 30 days)</h1>
    <p>Total: $${agg.total_cost.toFixed(4)} | ${agg.total_requests} requests | ${agg.total_tokens.toLocaleString()} tokens</p>
    <table>
      <tr><th>Time</th><th>Model</th><th>Account</th><th>Tokens</th><th>Cost</th><th>Status</th><th>Latency</th></tr>
      ${logs.map((l: { created_at: string; model: string; account_id: string | null; total_tokens: number; cost_usd: number; status_code: number; latency_ms: number }) => `<tr><td>${l.created_at}</td><td>${l.model}</td><td>${l.account_id ?? ""}</td><td>${l.total_tokens}</td><td>$${l.cost_usd.toFixed(4)}</td><td>${l.status_code}</td><td>${l.latency_ms}ms</td></tr>`).join("")}
    </table>
  `;
  return layout("Usage", body);
}