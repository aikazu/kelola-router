import type Database from 'better-sqlite3';

export interface Model {
  id: number;
  name: string;
  display_name: string | null;
  family: string | null;
  upstream_model: string;
  context_window: number | null;
  context_output: number | null;
  pricing_input: number | null;
  pricing_output: number | null;
  pricing_cache_read: number | null;
  pricing_cache_write: number | null;
  pricing_tiers: string | null;
  capabilities: string | null;
  source: string;
  enabled: number;
  created_at: string;
  /** Upstream provider. Defaults to 'minimax' for legacy rows. */
  provider: string;
}

export type ModelUpsert = Pick<Model, 'name' | 'upstream_model'> & Partial<Model>;

export function getModel(db: Database.Database, name: string): Model | null {
  const row = db.prepare(`SELECT * FROM models WHERE name = ?`).get(name) as Model | undefined;
  return row ?? null;
}

export function listModels(
  db: Database.Database,
  opts: { includeDisabled?: boolean; provider?: string } = {}
): Model[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (!opts.includeDisabled) where.push('enabled = 1');
  if (opts.provider) {
    where.push('provider = ?');
    params.push(opts.provider);
  }
  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  return db
    .prepare(`SELECT * FROM models ${whereClause} ORDER BY family, name`)
    .all(...params) as Model[];
}

/**
 * Columns that the upsert is allowed to overwrite on an existing row. The
 * `provider` column is deliberately excluded: a row's provider is decided at
 * INSERT time and never changes on update (otherwise a single `name` could
 * silently flip between providers, breaking routing + per-provider counts).
 * `name` and `created_at` are excluded as primary-key / audit fields.
 */
const UPSERTABLE_COLUMNS = new Set([
  'upstream_model',
  'display_name',
  'family',
  'context_window',
  'context_output',
  'pricing_input',
  'pricing_output',
  'pricing_cache_read',
  'pricing_cache_write',
  'pricing_tiers',
  'capabilities',
  'source',
  'enabled',
]);

export function upsertModel(db: Database.Database, m: ModelUpsert): void {
  const existing = getModel(db, m.name);
  if (existing) {
    // Only UPDATE columns explicitly listed in UPSERTABLE_COLUMNS — passing
    // `provider` or `name` is silently ignored to prevent accidental cross-
    // provider renames. `undefined` values are also skipped so a partial
    // upsert doesn't overwrite real data with NULL.
    const updates: string[] = [];
    const vals: unknown[] = [];
    for (const [k, v] of Object.entries(m)) {
      if (!UPSERTABLE_COLUMNS.has(k)) continue;
      if (v === undefined) continue;
      updates.push(`${k} = ?`);
      vals.push(v);
    }
    if (updates.length === 0) return;
    db.prepare(`UPDATE models SET ${updates.join(', ')} WHERE name = ?`).run(...vals, m.name);
  } else {
    db.prepare(`
      INSERT INTO models (name, upstream_model, display_name, family, context_window, context_output,
                          pricing_input, pricing_output, pricing_cache_read, pricing_cache_write, pricing_tiers, capabilities, source, enabled, provider)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      m.name,
      m.upstream_model,
      m.display_name ?? null,
      m.family ?? null,
      m.context_window ?? null,
      m.context_output ?? null,
      m.pricing_input ?? null,
      m.pricing_output ?? null,
      m.pricing_cache_read ?? null,
      m.pricing_cache_write ?? null,
      m.pricing_tiers ?? null,
      m.capabilities ?? null,
      m.source ?? 'manual',
      m.enabled === 0 ? 0 : 1,
      m.provider ?? 'minimax'
    );
  }
}

export function disableModel(db: Database.Database, name: string): void {
  db.prepare(`UPDATE models SET enabled = 0 WHERE name = ?`).run(name);
}

export function enableModel(db: Database.Database, name: string): void {
  db.prepare(`UPDATE models SET enabled = 1 WHERE name = ?`).run(name);
}

export function bulkToggleModels(db: Database.Database, names: string[], enabled: boolean): number {
  if (names.length === 0) return 0;
  const placeholders = names.map(() => '?').join(',');
  const r = db
    .prepare(`UPDATE models SET enabled = ? WHERE name IN (${placeholders})`)
    .run(enabled ? 1 : 0, ...names);
  return r.changes;
}

export function deleteModel(db: Database.Database, name: string): boolean {
  const r = db.prepare(`DELETE FROM models WHERE name = ?`).run(name);
  return r.changes > 0;
}

export interface ModelUpdate {
  displayName?: string | null;
  contextWindow?: number | null;
  contextOutput?: number | null;
  pricingInput?: number | null;
  pricingOutput?: number | null;
}

export function updateModel(db: Database.Database, name: string, patch: ModelUpdate): boolean {
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (patch.displayName !== undefined) {
    sets.push('display_name = ?');
    vals.push(patch.displayName);
  }
  if (patch.contextWindow !== undefined) {
    sets.push('context_window = ?');
    vals.push(patch.contextWindow);
  }
  if (patch.contextOutput !== undefined) {
    sets.push('context_output = ?');
    vals.push(patch.contextOutput);
  }
  if (patch.pricingInput !== undefined) {
    sets.push('pricing_input = ?');
    vals.push(patch.pricingInput);
  }
  if (patch.pricingOutput !== undefined) {
    sets.push('pricing_output = ?');
    vals.push(patch.pricingOutput);
  }
  if (sets.length === 0) return false;
  vals.push(name);
  const r = db.prepare(`UPDATE models SET ${sets.join(', ')} WHERE name = ?`).run(...vals);
  return r.changes > 0;
}
