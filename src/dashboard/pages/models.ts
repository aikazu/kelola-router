import { page } from "../render.js";
import { listModels } from "../../db/repos/models.js";
import type Database from "better-sqlite3";

export function renderModels(db: Database.Database, flashMsg: string | null = null): string {
  const models = listModels(db, { includeDisabled: true });
  const flash = flashMsg ? `<div class="alert">${escapeHtml(flashMsg)}</div>` : "";
  const body = `
    <p class="card-sub">All models known to the router. Disabled models are rejected at the proxy layer.</p>
    ${flash}
    <div class="card">
      <div class="card-title" style="display:flex;justify-content:space-between;align-items:center">
        <span>Models</span>
        <form method="POST" action="/admin/models/fetch" style="display:inline">
          <button class="btn" style="padding:6px 14px;font-size:10px">Fetch from upstream</button>
        </form>
      </div>
      <table>
        <tr><th>Name</th><th>Display</th><th>Family</th><th>Context</th><th>Thinking</th><th>Source</th><th>Status</th><th></th></tr>
        ${models.map((m) => `
          <tr>
            <td>${escapeHtml(m.name)}</td>
            <td>${escapeHtml(m.display_name ?? "")}</td>
            <td>${escapeHtml(m.family ?? "")}</td>
            <td>${m.context_window ?? ""}</td>
            <td>${m.thinking_enabled ? "yes" : "no"}</td>
            <td>${escapeHtml(m.source)}</td>
            <td><span class="badge ${m.enabled ? "badge-active" : "badge-muted"}">${m.enabled ? "active" : "disabled"}</span></td>
            <td style="white-space:nowrap">
              ${m.enabled
                ? `<form method="POST" action="/admin/models/${encodeURIComponent(m.name)}/disable" style="display:inline"><button class="btn-ghost" style="padding:3px 10px;font-size:10px">Disable</button></form>`
                : `<form method="POST" action="/admin/models/${encodeURIComponent(m.name)}/enable" style="display:inline"><button class="btn-ghost" style="padding:3px 10px;font-size:10px">Enable</button></form>`}
            </td>
          </tr>
        `).join("")}
      </table>
    </div>
  `;
  return page("Models", "models", body, { db });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
