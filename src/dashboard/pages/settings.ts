import { page } from "../render.js";
import { getSetting } from "../../db/repos/settings.js";
import { isPasswordSet } from "../../auth/password.js";
import type Database from "better-sqlite3";

export function renderSettings(db: Database.Database): string {
  const caveman = (getSetting(db, "caveman") as { level: string } | null) ?? { level: "off" };
  const caching = (getSetting(db, "caching") as { autoBreakpoints: boolean } | null) ?? { autoBreakpoints: true };
  const rtk = (getSetting(db, "rtk") as { enabled: boolean } | null) ?? { enabled: true };
  const minimax = (getSetting(db, "minimax") as { upstreamFormat?: string; reasoningSplitDefault?: boolean; m3DefaultMaxCompletionTokens?: number } | null) ?? {};
  const passwordSet = isPasswordSet(db);

  const body = `
    <p class="card-sub">Toggles applied to every proxy request. Changes take effect immediately.</p>

    <div class="card">
      <div class="card-title">Dashboard access</div>
      <p>${passwordSet
        ? `<span class="badge badge-active">Password set</span> Dashboard requires login. <a href="#" onclick="document.getElementById('pwForm').style.display='block';return false">Change password</a> · <form method="POST" action="/admin/settings/password" style="display:inline" onsubmit="return confirm('Clear password? Dashboard will become open access.')"><input type="hidden" name="action" value="clear"><button type="submit" class="btn-ghost" style="padding:4px 12px;font-size:10px">Remove password</button></form>`
        : `<span class="badge badge-warn">Open mode</span> No password set — anyone with dashboard URL can access. <a href="#" onclick="document.getElementById('pwForm').style.display='block';return false">Set password</a>`}</p>
      <div id="pwForm" style="display:none;margin-top:16px;padding-top:16px;border-top:1px solid rgba(212,175,55,0.15)">
        <form method="POST" action="/admin/settings/password" class="form-row">
          <input type="hidden" name="action" value="set">
          <div class="form-field"><label>New password</label><input type="password" name="password" required minlength="4" autocomplete="new-password"></div>
          <div class="form-field" style="max-width:140px; flex:0"><label>&nbsp;</label><button type="submit">Save</button></div>
        </form>
      </div>
    </div>

    <div class="card">
      <div class="card-title">Caveman mode</div>
      <p class="card-sub">Injects a terse system prompt to force concise output.</p>
      <form method="POST" action="/admin/settings/caveman" class="form-row">
        <div class="form-field">
          <label>Level</label>
          <select name="level">
            <option value="off" ${caveman.level === "off" ? "selected" : ""}>Off</option>
            <option value="terse" ${caveman.level === "terse" ? "selected" : ""}>Terse</option>
            <option value="ultra" ${caveman.level === "ultra" ? "selected" : ""}>Ultra</option>
          </select>
        </div>
        <div class="form-field" style="max-width:120px; flex:0"><label>&nbsp;</label><button type="submit">Save</button></div>
      </form>
    </div>

    <div class="card">
      <div class="card-title">RTK compression</div>
      <p class="card-sub">Token-saving compression on messages before forwarding.</p>
      <form method="POST" action="/admin/settings/rtk" class="form-row">
        <div class="form-field"><label style="display:flex;align-items:center;gap:6px"><input type="checkbox" name="enabled" ${rtk.enabled ? "checked" : ""}> Enabled</label></div>
        <div class="form-field" style="max-width:120px; flex:0"><label>&nbsp;</label><button type="submit">Save</button></div>
      </form>
    </div>

    <div class="card">
      <div class="card-title">Prompt caching</div>
      <p class="card-sub">Auto-inject dual cache_control breakpoints on Anthropic system prompts.</p>
      <form method="POST" action="/admin/settings/caching" class="form-row">
        <div class="form-field"><label style="display:flex;align-items:center;gap:6px"><input type="checkbox" name="autoBreakpoints" ${caching.autoBreakpoints ? "checked" : ""}> Auto-inject breakpoints</label></div>
        <div class="form-field" style="max-width:120px; flex:0"><label>&nbsp;</label><button type="submit">Save</button></div>
      </form>
    </div>

    <div class="card">
      <div class="card-title">MiniMax provider</div>
      <p class="card-sub">Cross-format routing + M3 defaults. Override per-deployment.</p>
      <form method="POST" action="/admin/settings/minimax" class="form-row">
        <div class="form-field">
          <label>Upstream format override</label>
          <select name="upstreamFormat">
            <option value="auto" ${!minimax.upstreamFormat || minimax.upstreamFormat === "auto" ? "selected" : ""}>Auto (match client)</option>
            <option value="openai" ${minimax.upstreamFormat === "openai" ? "selected" : ""}>Always OpenAI</option>
            <option value="anthropic" ${minimax.upstreamFormat === "anthropic" ? "selected" : ""}>Always Anthropic</option>
          </select>
        </div>
        <div class="form-field">
          <label>Reasoning split default</label>
          <select name="reasoningSplitDefault">
            <option value="false" ${!minimax.reasoningSplitDefault ? "selected" : ""}>Off</option>
            <option value="true" ${minimax.reasoningSplitDefault ? "selected" : ""}>On</option>
          </select>
        </div>
        <div class="form-field" style="max-width:140px">
          <label>M3 max tokens default</label>
          <input type="number" name="m3DefaultMaxCompletionTokens" value="${minimax.m3DefaultMaxCompletionTokens ?? 131072}">
        </div>
        <div class="form-field" style="max-width:120px; flex:0"><label>&nbsp;</label><button type="submit">Save</button></div>
      </form>
    </div>
  `;
  return page("Settings", "settings", body, { db });
}
