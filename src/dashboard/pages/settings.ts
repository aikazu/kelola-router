import { page } from "../render.js";
import { getSetting } from "../../db/repos/settings.js";
import type Database from "better-sqlite3";

export function renderSettings(db: Database.Database): string {
  const caveman = getSetting<{ level: string }>(db, "caveman") ?? { level: "off" };
  const rtk = getSetting<{ enabled: boolean }>(db, "rtk") ?? { enabled: true };
  const caching = getSetting<{ autoBreakpoints: boolean }>(db, "caching") ?? { autoBreakpoints: true };
  const body = `
    <h1>Settings</h1>
    <form method="POST" action="/admin/settings/caveman">
      <h2>Caveman</h2>
      <label>Level:
        <select name="level">
          <option value="off" ${caveman.level === "off" ? "selected" : ""}>off</option>
          <option value="terse" ${caveman.level === "terse" ? "selected" : ""}>terse</option>
          <option value="ultra" ${caveman.level === "ultra" ? "selected" : ""}>ultra</option>
        </select>
      </label>
      <button type="submit">Save</button>
    </form>
    <form method="POST" action="/admin/settings/rtk">
      <h2>RTK</h2>
      <label><input type="checkbox" name="enabled" ${rtk.enabled ? "checked" : ""}> Enable tool-output compression</label>
      <button type="submit">Save</button>
    </form>
    <form method="POST" action="/admin/settings/caching">
      <h2>Caching</h2>
      <label><input type="checkbox" name="autoBreakpoints" ${caching.autoBreakpoints ? "checked" : ""}> Auto-inject dual cache_control breakpoints</label>
      <button type="submit">Save</button>
    </form>
  `;
  return page("Settings", "settings", body);
}