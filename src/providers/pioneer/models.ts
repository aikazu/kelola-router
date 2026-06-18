import type Database from 'better-sqlite3';
import { upsertModel } from '../../db/repos/models.js';
import { PIONEER_BASE_URL } from './index.js';

/** Shape of one entry in Pioneer's `GET /v1/models` response. */
interface PioneerModelEntry {
  id: string;
  display_name?: string | null;
  max_input_tokens?: number | null;
}

export interface SeedPioneerModelsResult {
  ok: boolean;
  added?: number;
  total?: number;
  status?: number;
  error?: string;
}

/**
 * Fetch the live model catalogue from Pioneer with the given key and seed it
 * into the `models` table. Called right after a Pioneer account is added in the
 * dashboard so the user only ever has to paste a key — no CLI seed step.
 *
 * Pioneer ids (e.g. `claude-opus-4-8`, `gpt-5.5`) can collide with same-named
 * Kiro/CodeBuddy rows on the globally-unique `name`/`upstream_model` columns, so
 * each row is namespaced under `pioneer/` in BOTH columns. Clients still call
 * the clean `pio/<id>`; `resolveModel` maps that to the namespaced row and the
 * proxy strips the single leading `pioneer/` before the upstream request.
 */
export async function fetchAndSeedPioneerModels(
  db: Database.Database,
  apiKey: string,
  baseUrl?: string | null
): Promise<SeedPioneerModelsResult> {
  const url = `${baseUrl || PIONEER_BASE_URL}/v1/models`;

  let resp: Response;
  try {
    resp = await fetch(url, { method: 'GET', headers: { 'X-API-Key': apiKey } });
  } catch (e) {
    return { ok: false, error: `Pioneer models fetch failed: ${(e as Error).message}` };
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    return {
      ok: false,
      status: resp.status,
      error: `Pioneer returned ${resp.status}: ${text.slice(0, 200)}`,
    };
  }

  const data = (await resp.json()) as { data?: PioneerModelEntry[] };
  const entries = data.data ?? [];

  let added = 0;
  const seen = new Set<string>();
  for (const m of entries) {
    if (!m.id) continue;
    // Strip BOTH a leading `anthropic/pioneer/` (Anthropic-API-compat alias form) and a
    // leading `pioneer/` (self-namespaced form) so each model collapses to one canonical
    // row. Without the `anthropic/pioneer/` strip the upstream catalogue seeds the same
    // model twice (e.g. `gpt-5.5` + `anthropic/pioneer/gpt-5.5`) -> 64 phantom rows.
    const bareId = m.id.replace(/^anthropic\/pioneer\//, '').replace(/^pioneer\//, '');
    if (seen.has(bareId)) continue;
    seen.add(bareId);
    const name = `pioneer/${bareId}`;
    // Prefer the bare id for the upstream wire format too — Pioneer's
    // `/v1/chat/completions` accepts the short id and the proxy strips one
    // leading `pioneer/` defensively on top of that.
    const upstream = bareId;
    const existing = db.prepare(`SELECT 1 FROM models WHERE name = ?`).get(name);
    if (!existing) added++;
    upsertModel(db, {
      name,
      upstream_model: upstream,
      display_name: `Pioneer ${m.display_name?.trim() || bareId}`,
      family: 'pioneer',
      context_window: m.max_input_tokens ?? null,
      pricing_input: 0,
      pricing_output: 0,
      pricing_cache_read: 0,
      pricing_cache_write: 0,
      source: 'fetched',
      provider: 'pioneer',
    });
  }

  return { ok: true, added, total: entries.length };
}
