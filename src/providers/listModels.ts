import type Database from "better-sqlite3";
import { upsertModel } from "../db/repos/models.js";
import { getBaseUrl } from "./baseUrl.js";
import { buildHeaders } from "./headers.js";

function detectFamily(name: string): string {
  if (name.includes("M3")) return "m3";
  if (name.includes("M2.7")) return "m2.7";
  if (name.includes("M2.5")) return "m2.5";
  if (name.includes("M2.1")) return "m2.1";
  if (name.includes("M2-her")) return "m2-her";
  if (name.includes("M2")) return "m2";
  return "custom";
}

export async function fetchModels(db: Database.Database, apiKey: string): Promise<number> {
  const account = { provider: "minimax" as const, baseUrl: null };
  const url = `${getBaseUrl(account, "openai")}/v1/models`;
  const headers = buildHeaders({ provider: "minimax", apiKey }, false, "openai");
  const resp = await fetch(url, { method: "GET", headers });
  if (!resp.ok) throw new Error(`fetchModels failed: ${resp.status}`);

  const data = await resp.json() as { data: { id: string }[] };
  let added = 0;
  for (const m of data.data ?? []) {
    const existing = db.prepare(`SELECT id FROM models WHERE name = ?`).get(m.id);
    if (!existing) added++;
    upsertModel(db, {
      name: m.id,
      upstream_model: m.id,
      display_name: m.id,
      family: detectFamily(m.id),
      source: "fetched",
      enabled: 1,
    });
  }
  return added;
}
