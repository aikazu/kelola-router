import { page } from "../render.js";
import { listAccountsByUser } from "../../db/repos/accounts.js";
import type Database from "better-sqlite3";

export function renderAccounts(db: Database.Database, userId: number): string {
  const accounts = listAccountsByUser(db, userId);
  const body = `
    <h1>Accounts</h1>
    <table>
      <tr><th>ID</th><th>Label</th><th>Credit</th><th>Status</th><th>Last error</th><th>Backoff</th></tr>
      ${accounts.map((a: { id: string; label: string; credit_type: string; status: string; last_error: string | null; backoff_level: number }) => `
        <tr>
          <td>${a.id}</td>
          <td>${a.label}</td>
          <td>${a.credit_type}</td>
          <td><span class="badge ${a.status}">${a.status}</span></td>
          <td>${a.last_error ? a.last_error.slice(0, 50) : ""}</td>
          <td>${a.backoff_level}</td>
        </tr>
      `).join("")}
    </table>
    <form method="POST" action="/admin/accounts">
      <h2>Add account</h2>
      <label>Label <input name="label" required></label><br>
      <label>Credit type <select name="credit_type"><option value="payg">PAYG</option><option value="token-plan">Token Plan</option></select></label><br>
      <label>API key <input name="api_key" required></label><br>
      <button type="submit">Add</button>
    </form>
  `;
  return page("Accounts", "accounts", body);
}