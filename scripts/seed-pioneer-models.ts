#!/usr/bin/env tsx
/**
 * Seed built-in Pioneer models. Idempotent: re-running upserts.
 *
 * Both `models.name` AND `models.upstream_model` are GLOBAL unique keys, and
 * several Pioneer ids (e.g. `claude-opus-4-8`, `gpt-5.5`) are identical to
 * Kiro / CodeBuddy ids. To stop one provider's seed from clashing with
 * another's row on either column, Pioneer rows are namespaced under `pioneer/`
 * in BOTH `name` and `upstream_model`.
 *
 * Clients route with `pio/pioneer/<id>` (the `pio/` prefix selects the
 * provider; `pioneer/<id>` is the DB name). The proxy resolves the row, then
 * strips the single leading `pioneer/` from `upstream_model` to recover the
 * bare id Pioneer's API expects.
 *
 * Pricing is zero (Pioneer uses credit-based billing, not per-token). The
 * dashboard shows request counts but not cost estimates.
 */
import { openDb } from '../src/db/index.js';
import { upsertModel } from '../src/db/repos/models.js';
import { log } from '../src/util/log.js';

interface PioneerModel {
  /**
   * Id Pioneer's API expects. Clients call this with the `pio/` prefix
   * (e.g. `pio/claude-opus-4-8`, `pio/auto`).
   */
  api: string;
  display: string;
  context: number;
}

const MODELS: PioneerModel[] = [
  {
    api: 'claude-opus-4-8',
    display: 'Claude Opus 4 8',
    context: 1000000,
  },
  {
    api: 'claude-sonnet-4-6',
    display: 'Claude Sonnet 4 6',
    context: 1000000,
  },
  {
    api: 'claude-haiku-4-5',
    display: 'Claude Haiku 4 5',
    context: 200000,
  },
  {
    api: 'gpt-5.5',
    display: 'GPT 5.5',
    context: 1000000,
  },
  {
    api: 'gemini-3.1-pro',
    display: 'Gemini 3.1 Pro',
    context: 1048576,
  },
  {
    api: 'deepseek-ai/DeepSeek-V4-Pro',
    display: 'DeepSeek V4 Pro',
    context: 1000000,
  },
  {
    api: 'qwen3.7-max',
    display: 'Qwen3.7 Max',
    context: 1000000,
  },
  {
    api: 'moonshotai/Kimi-K2.6',
    display: 'Kimi K2.6',
    context: 262144,
  },
];

const db = openDb();
let inserted = 0;
let updated = 0;

for (const m of MODELS) {
  // Namespace BOTH name and upstream_model under a single `pioneer/` so neither
  // unique key collides with same-named Kiro/CodeBuddy rows. Clients use the
  // clean `pio/<api>` form; resolveModel maps that to this `pioneer/<api>` row
  // and the proxy strips the one `pioneer/` before calling the API.
  const name = `pioneer/${m.api}`;
  const existed = db.prepare(`SELECT 1 FROM models WHERE name = ?`).get(name);
  upsertModel(db, {
    name,
    upstream_model: name,
    display_name: `Pioneer ${m.display}`,
    family: 'pioneer',
    context_window: m.context,
    pricing_input: 0,
    pricing_output: 0,
    pricing_cache_read: 0,
    pricing_cache_write: 0,
    source: 'builtin',
    provider: 'pioneer',
  });
  if (existed) updated++;
  else inserted++;
}

log.info({ inserted, updated, total: MODELS.length }, 'pioneer models seeded');
console.log(`Seeded ${MODELS.length} Pioneer models (${inserted} new, ${updated} updated).`);
