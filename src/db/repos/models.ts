import type Database from "better-sqlite3";

export interface Model {
  id: number;
  name: string;
  display_name: string | null;
  family: string | null;
  upstream_model: string;
  context_window: number | null;
  thinking_enabled: number;
  thinking_budget: number | null;
  pricing_input: number | null;
  pricing_output: number | null;
  pricing_cache_read: number | null;
  pricing_cache_write: number | null;
  pricing_tiers: string | null;
  capabilities: string | null;
  source: string;
  enabled: number;
  created_at: string;
}

export type ModelUpsert = Pick<Model, "name" | "upstream_model"> & Partial<Model>;

export function getModel(db: Database.Database, name: string): Model | null {
  const row = db.prepare(`SELECT * FROM models WHERE name = ?`).get(name) as Model | undefined;
  return row ?? null;
}

export function listModels(db: Database.Database, opts: { includeDisabled?: boolean } = {}): Model[] {
  const sql = opts.includeDisabled
    ? `SELECT * FROM models ORDER BY family, name`
    : `SELECT * FROM models WHERE enabled = 1 ORDER BY family, name`;
  return db.prepare(sql).all() as Model[];
}

export function upsertModel(db: Database.Database, m: ModelUpsert): void {
  const existing = getModel(db, m.name);
  if (existing) {
    const keys = Object.keys(m).filter(k => k !== "name" && k !== "id" && k !== "created_at");
    if (keys.length === 0) return;
    const set = keys.map(k => `${k} = ?`).join(", ");
    const vals = keys.map(k => (m as Record<string, unknown>)[k]);
    db.prepare(`UPDATE models SET ${set} WHERE name = ?`).run(...vals, m.name);
  } else {
    db.prepare(`
      INSERT INTO models (name, upstream_model, display_name, family, context_window, thinking_enabled, thinking_budget,
                          pricing_input, pricing_output, pricing_cache_read, pricing_cache_write, pricing_tiers, capabilities, source, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      m.name, m.upstream_model,
      m.display_name ?? null, m.family ?? null, m.context_window ?? null,
      m.thinking_enabled ? 1 : 0, m.thinking_budget ?? null,
      m.pricing_input ?? null, m.pricing_output ?? null,
      m.pricing_cache_read ?? null, m.pricing_cache_write ?? null,
      m.pricing_tiers ?? null, m.capabilities ?? null,
      m.source ?? "manual", m.enabled === 0 ? 0 : 1,
    );
  }
}

export function disableModel(db: Database.Database, name: string): void {
  db.prepare(`UPDATE models SET enabled = 0 WHERE name = ?`).run(name);
}