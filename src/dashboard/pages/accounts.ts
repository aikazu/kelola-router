import { page } from "../render.js";
import { listAccounts } from "../../db/repos/accounts.js";
import type Database from "better-sqlite3";

export function renderAccounts(db: Database.Database): string {
  const accounts = listAccounts(db);
  const rows = accounts.length === 0
    ? `<tr><td colspan="7"><div class="empty">
        <h3>No upstream accounts yet</h3>
        <p>Add a MiniMax API key to start routing requests.</p>
      </div></td></tr>`
    : accounts.map((a) => `
        <tr>
          <td><code>${a.id}</code></td>
          <td>${escapeHtml(a.label)}</td>
          <td><span class="badge ${a.credit_type === "token-plan" ? "badge-warn" : "badge-active"}">${a.credit_type}</span></td>
          <td><span class="badge badge-${a.status === "active" ? "active" : a.status === "error" ? "error" : "muted"}">${a.status}</span></td>
          <td class="mono">${a.last_error ? escapeHtml(a.last_error.slice(0, 60)) : "—"}</td>
          <td>${a.backoff_level}</td>
          <td>${a.rate_limited_until ? a.rate_limited_until.slice(0, 19) : "—"}</td>
          <td style="white-space:nowrap">
            ${a.enabled
              ? `<form method="POST" action="/admin/accounts/${a.id}/disable" style="display:inline"><button class="btn-ghost" style="padding:3px 10px;font-size:10px">Disable</button></form>`
              : `<form method="POST" action="/admin/accounts/${a.id}/enable" style="display:inline"><button class="btn-ghost" style="padding:3px 10px;font-size:10px">Enable</button></form>`}
            <form method="POST" action="/admin/accounts/${a.id}/delete" style="display:inline" onsubmit="return confirm('Delete ${escapeHtml(a.label)}? Cannot be undone.')">
              <button class="btn-danger" style="padding:3px 10px;font-size:10px">Delete</button>
            </form>
          </td>
        </tr>
      `).join("");
  const body = `
    <p class="card-sub">Pool of MiniMax API keys. The router fans out across enabled accounts with backoff + per-model locks when one returns 429/5xx.</p>
    <div class="card">
      <table>
        <tr><th>ID</th><th>Label</th><th>Credit</th><th>Status</th><th>Last error</th><th>Backoff</th><th>Rate-limited until</th><th></th></tr>
        ${rows}
      </table>
    </div>
    <div class="card">
      <div class="card-title">Add MiniMax account</div>
      <form method="POST" action="/admin/accounts" class="form-row">
        <div class="form-field"><label>Label</label><input type="text" name="label" placeholder="PAYG main" required></div>
        <div class="form-field" style="max-width:160px"><label>Credit type</label>
          <select name="credit_type"><option value="payg">PAYG</option><option value="token-plan">Token Plan</option></select>
        </div>
        <div class="form-field" style="flex:2"><label>MiniMax API key</label><input type="text" name="api_key" placeholder="mm_xxxxxxxx" required></div>
        <div class="form-field" style="max-width:140px; flex:0"><label>&nbsp;</label><button type="submit">Add</button></div>
      </form>
    </div>
  `;
  return page("Upstream accounts", "accounts", body, { db });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
