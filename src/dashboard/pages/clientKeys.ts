import { page } from "../render.js";
import { listClientKeys } from "../../db/repos/client_keys.js";
import type Database from "better-sqlite3";

export function renderClientKeys(db: Database.Database): string {
  const keys = listClientKeys(db);
  const rows = keys.length === 0
    ? `<tr><td colspan="5"><div class="empty">
        <h3>No client keys yet</h3>
        <p>Create one below to give an app (Claude Code, hermes-agent, etc.) access to the proxy.</p>
      </div></td></tr>`
    : keys.map((k) => `
        <tr>
          <td>${k.id}</td>
          <td>${escapeHtml(k.label)}</td>
          <td class="mono">
            <code id="k${k.id}">${k.key.slice(0, 8)}••••••••••••••${k.key.slice(-4)}</code>
            <button type="button" class="btn-ghost" style="padding:2px 8px;font-size:10px;margin-left:6px" onclick="toggleKey(${k.id}, '${k.key}')">Reveal</button>
            <button type="button" class="btn-ghost" style="padding:2px 8px;font-size:10px;margin-left:4px" onclick="copyKey(${k.id}, '${k.key}', this)">Copy</button>
          </td>
          <td><span class="badge ${k.enabled ? "badge-active" : "badge-muted"}">${k.enabled ? "active" : "disabled"}</span></td>
          <td>${k.created_at}</td>
          <td style="white-space:nowrap">
            ${k.enabled
              ? `<form method="POST" action="/admin/client-keys/${k.id}/disable" style="display:inline"><button class="btn-ghost" style="padding:3px 10px;font-size:10px">Disable</button></form>`
              : `<form method="POST" action="/admin/client-keys/${k.id}/enable" style="display:inline"><button class="btn-ghost" style="padding:3px 10px;font-size:10px">Enable</button></form>`}
            <form method="POST" action="/admin/client-keys/${k.id}/delete" style="display:inline" onsubmit="return confirm('Delete this key? Clients using it will lose access.')">
              <button class="btn-danger" style="padding:3px 10px;font-size:10px">Delete</button>
            </form>
          </td>
        </tr>
      `).join("");
  const body = `
    <p class="card-sub">Bearer credentials for clients. Each key gets its own usage tracking on <a href="/admin/usage">/admin/usage</a>.</p>
    <div class="card">
      <table>
        <tr><th>ID</th><th>Label</th><th>Bearer key</th><th>Status</th><th>Created</th><th></th></tr>
        ${rows}
      </table>
    </div>
    <div class="card">
      <div class="card-title">Create client key</div>
      <form method="POST" action="/admin/client-keys" class="form-row">
        <div class="form-field"><label>Label</label><input type="text" name="label" placeholder="my-app" required></div>
        <div class="form-field" style="max-width:140px; flex:0"><label>&nbsp;</label><button type="submit">Generate</button></div>
      </form>
      <p class="card-sub" style="margin-top:14px">Client usage: <code>Authorization: Bearer &lt;key&gt;</code> on <code>/v1/chat/completions</code>, <code>/v1/messages</code>, etc.</p>
    </div>
    <script>
    function toggleKey(id, full) {
      const el = document.getElementById('k' + id);
      if (el.dataset.shown === '1') {
        el.textContent = full.slice(0, 8) + '••••••••••••••' + full.slice(-4);
        el.dataset.shown = '0';
        el.nextElementSibling.textContent = 'Reveal';
      } else {
        el.textContent = full;
        el.dataset.shown = '1';
        el.nextElementSibling.textContent = 'Hide';
      }
    }
    async function copyKey(id, full, btn) {
      try {
        await navigator.clipboard.writeText(full);
        const orig = btn.textContent;
        btn.textContent = 'Copied';
        setTimeout(() => { btn.textContent = orig; }, 1200);
      } catch (e) {
        const el = document.getElementById('k' + id);
        el.dataset.shown = '1';
        el.textContent = full;
        el.nextElementSibling.textContent = 'Hide';
        alert('Clipboard blocked. Key revealed — copy manually.');
      }
    }
    </script>
  `;
  return page("Client keys", "client-keys", body, { db });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
