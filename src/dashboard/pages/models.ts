import { layout } from "../layout.js";
import { listModels } from "../../db/repos/models.js";
import type Database from "better-sqlite3";

export function renderModels(db: Database.Database, _userId: number): string {
  const models = listModels(db, { includeDisabled: true });
  const body = `
    <h1>Models</h1>
    <form method="POST" action="/admin/models/fetch" style="display:inline">
      <button type="submit">Fetch from upstream</button>
    </form>
    <table>
      <tr><th>Name</th><th>Display</th><th>Family</th><th>Context</th><th>Thinking</th><th>Source</th><th>Enabled</th></tr>
      ${models.map((m: { name: string; display_name: string | null; family: string | null; context_window: number | null; thinking_enabled: number; source: string; enabled: number }) => `
        <tr>
          <td>${m.name}</td>
          <td>${m.display_name ?? ""}</td>
          <td>${m.family ?? ""}</td>
          <td>${m.context_window ?? ""}</td>
          <td>${m.thinking_enabled ? "yes" : "no"}</td>
          <td>${m.source}</td>
          <td>${m.enabled ? "yes" : "no"}</td>
        </tr>
      `).join("")}
    </table>
  `;
  return layout("Models", body);
}