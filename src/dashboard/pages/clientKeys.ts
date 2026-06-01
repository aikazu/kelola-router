import { page } from "../render.js";
import { listClientKeys } from "../../db/repos/client_keys.js";
import type Database from "better-sqlite3";

export function renderClientKeys(db: Database.Database): string {
  const keys = listClientKeys(db);
  const body = `
    <h1>Client API keys</h1>
    <p>Each row is a bearer credential a client uses to access <code>/v1/*</code> routes. Usage is tracked per key.</p>
    <table>
      <tr><th>ID</th><th>Label</th><th>Key</th><th>Enabled</th><th>Created</th></tr>
      ${keys.map((k) => `
        <tr>
          <td>${k.id}</td>
          <td>${escapeHtml(k.label)}</td>
          <td><code>${k.key}</code></td>
          <td>${k.enabled ? "yes" : "no"}</td>
          <td>${k.created_at}</td>
        </tr>
      `).join("")}
    </table>
    <p>Create new keys via the CLI: <code>npx tsx scripts/add-client-key.ts --label myapp</code></p>
  `;
  return page("Client keys", "client-keys", body);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
