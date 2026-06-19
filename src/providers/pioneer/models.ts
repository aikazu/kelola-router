import type Database from 'better-sqlite3';
import { upsertModel } from '../../db/repos/models.js';
import { log } from '../../util/log.js';
import { PIONEER_BASE_URL } from './index.js';

/** Shape of one entry in Pioneer's `GET /v1/models` response. */
interface PioneerModelEntry {
  id: string;
  display_name?: string | null;
  max_input_tokens?: number | null;
  max_tokens?: number | null;
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
  log.info({ provider: 'pioneer', url, baseUrl: baseUrl ?? null }, 'pioneer: model seed starting');

  let resp: Response;
  try {
    resp = await fetch(url, { method: 'GET', headers: { 'X-API-Key': apiKey } });
  } catch (e) {
    const message = (e as Error).message;
    log.warn({ provider: 'pioneer', url, err: message }, 'pioneer: models fetch threw');
    return { ok: false, error: `Pioneer models fetch failed: ${message}` };
  }

  log.info(
    { provider: 'pioneer', status: resp.status, contentType: resp.headers.get('content-type') },
    'pioneer: models fetch responded'
  );

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    log.warn(
      { provider: 'pioneer', status: resp.status, body: text.slice(0, 200) },
      'pioneer: models fetch non-OK'
    );
    return {
      ok: false,
      status: resp.status,
      error: `Pioneer returned ${resp.status}: ${text.slice(0, 200)}`,
    };
  }

  // The upstream returns `{ data: [...], models: [...], object, has_more, ... }`.
  // `data` is the canonical model list (Anthropic-API-compat shape with id /
  // display_name / max_input_tokens / max_tokens). `models` is a separate
  // dashboard metadata list (slug / supported_reasoning_levels / etc.) — not
  // what `/v1/chat/completions` accepts. Fall back defensively if upstream
  // ever reshapes the response.
  const rawBody = (await resp.json()) as Record<string, unknown>;
  const topKeys = Object.keys(rawBody);
  log.info({ provider: 'pioneer', topKeys }, 'pioneer: models response keys');

  const dataContainer = rawBody.data ?? rawBody.models ?? rawBody.result ?? rawBody.items;
  const entries: PioneerModelEntry[] = Array.isArray(dataContainer)
    ? (dataContainer as PioneerModelEntry[])
    : [];
  const matchedKey = Array.isArray(rawBody.data)
    ? 'data'
    : Array.isArray(rawBody.models)
      ? 'models'
      : Array.isArray(rawBody.result)
        ? 'result'
        : Array.isArray(rawBody.items)
          ? 'items'
          : 'none';
  log.info(
    { provider: 'pioneer', matchedKey, entryCount: entries.length },
    'pioneer: parsed model entries'
  );

  let added = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  const seen = new Set<string>();
  for (const m of entries) {
    if (!m.id) continue;
    // Strip a leading `anthropic/pioneer/` (Anthropic-API-compat alias form) and/or
    // `pioneer/` (self-namespaced form), including repeated wraps (e.g.
    // `pioneer/anthropic/pioneer/<id>`), so each model collapses to one canonical
    // row. Without the `anthropic/pioneer/` strip the upstream catalogue seeds
    // the same model twice (e.g. `gpt-5.5` + `anthropic/pioneer/gpt-5.5`) and
    // produces duplicate rows.
    const bareId = m.id.replace(/^(?:anthropic\/pioneer\/|pioneer\/)+/, '');
    if (seen.has(bareId)) {
      skipped++;
      continue;
    }
    seen.add(bareId);
    const name = `pioneer/${bareId}`;
    // Store `upstream_model` as the namespaced form (`pioneer/<id>`) so it never
    // collides on the globally-unique `models.upstream_model` index with Kiro /
    // CodeBuddy rows that own the bare id (e.g. `claude-opus-4-8`). The proxy
    // already strips a single leading `pioneer/` before forwarding to
    // `/v1/chat/completions`, so this is wire-compatible with the bare-id form.
    const upstream = name;
    const existing = db.prepare(`SELECT 1 FROM models WHERE name = ?`).get(name);
    if (existing) {
      updated++;
    } else {
      added++;
    }
    try {
      upsertModel(db, {
        name,
        upstream_model: upstream,
        display_name: `Pioneer ${m.display_name?.trim() || bareId}`,
        family: 'pioneer',
        context_window: m.max_input_tokens ?? null,
        context_output: m.max_tokens ?? null,
        pricing_input: 0,
        pricing_output: 0,
        pricing_cache_read: 0,
        pricing_cache_write: 0,
        source: 'fetched',
        provider: 'pioneer',
      });
    } catch (e) {
      // A single UNIQUE / NOT NULL conflict (e.g. upstream_model collision
      // with a non-Pioneer provider that was inserted first) must not abort the
      // whole batch — log and continue with the remaining entries.
      failed++;
      log.warn(
        { provider: 'pioneer', name, upstream, err: (e as Error).message },
        'pioneer: upsert failed for one entry, skipping'
      );
    }
  }

  log.info(
    { provider: 'pioneer', total: entries.length, added, updated, skipped, failed },
    'pioneer: model seed finished'
  );

  return { ok: true, added, total: entries.length };
}
