import { layout } from "../layout.js";
import { listAccountsByUser } from "../../db/repos/accounts.js";
import { latestQuotaByAccount } from "../../db/repos/quotaSnapshots.js";
import type Database from "better-sqlite3";

export function renderQuota(db: Database.Database, userId: number): string {
  const accounts = listAccountsByUser(db, userId);
  const body = `
    <h1>Quota</h1>
    ${accounts.map((a: { id: string; label: string; credit_type: string }) => {
      const snaps = latestQuotaByAccount(db, a.id, 2);
      const h5 = snaps.find((s: { window_type: string | null }) => s.window_type === "5h");
      const wk = snaps.find((s: { window_type: string | null }) => s.window_type === "weekly");
      return `
        <h2>${a.label} (${a.credit_type})</h2>
        ${h5 ? `<p>5h window: ${h5.used_count ?? 0} / ${h5.total_count ?? 0} used (${h5.remaining_count ?? 0} remaining) — resets ${h5.window_end ?? "?"}</p>` : "<p>5h: no data</p>"}
        ${wk ? `<p>Weekly: ${wk.used_count ?? 0} / ${wk.total_count ?? 0} used (${wk.remaining_count ?? 0} remaining) — resets ${wk.window_end ?? "?"}</p>` : "<p>Weekly: no data</p>"}
      `;
    }).join("")}
  `;
  return layout("Quota", body);
}