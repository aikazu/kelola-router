#!/usr/bin/env tsx
/**
 * Seed built-in Kiro (AWS CodeWhisperer) models. Idempotent: re-running upserts.
 *
 * For each base model we also seed `-thinking` / `-agentic` / `-thinking-agentic`
 * synthetic variants. These resolve to the same upstream model id (the suffix is
 * stripped before the request leaves the router) but toggle reasoning / the
 * chunked-write agentic system prompt. Availability ultimately depends on the
 * Kiro tier of the connected account.
 *
 * Pricing is left null — Kiro is billed per-account by AWS, not per-token here.
 */
import { openDb } from '../src/db/index.js';
import { upsertModel } from '../src/db/repos/models.js';
import { log } from '../src/util/log.js';

interface KiroBase {
  upstream: string;
  display: string;
  context: number;
}

const BASE_MODELS: KiroBase[] = [
  { upstream: 'claude-sonnet-4-6', display: 'Claude Sonnet 4.6', context: 1000000 },
  { upstream: 'claude-haiku-4-5', display: 'Claude Haiku 4.5', context: 200000 },
  { upstream: 'claude-opus-4-8', display: 'Claude Opus 4.8', context: 1000000 },
  { upstream: 'auto', display: 'Kiro Auto', context: 200000 },
];

const SEED: Array<Parameters<typeof upsertModel>[1]> = [];
for (const base of BASE_MODELS) {
  const isAuto = base.upstream === 'auto';
  const variants: Array<{ suffix: string; label: string }> = [
    { suffix: '', label: base.display },
    { suffix: '-thinking', label: `${base.display} (Thinking)` },
  ];
  if (!isAuto) {
    variants.push({ suffix: '-agentic', label: `${base.display} (Agentic)` });
    variants.push({ suffix: '-thinking-agentic', label: `${base.display} (Thinking + Agentic)` });
  }
  for (const v of variants) {
    const name = `${base.upstream}${v.suffix}`;
    SEED.push({
      name,
      // upstream_model retains the suffix; the Kiro executor strips it and maps
      // the suffix to behaviour flags (thinking / agentic).
      upstream_model: name,
      display_name: `Kiro ${v.label}`,
      family: 'kiro',
      context_window: base.context,
      source: 'builtin',
      provider: 'kiro',
    });
  }
}

const db = openDb();
let inserted = 0;
let updated = 0;
for (const m of SEED) {
  const existed = db.prepare(`SELECT 1 FROM models WHERE name = ?`).get(m.name);
  upsertModel(db, m);
  if (existed) updated++;
  else inserted++;
}
log.info({ inserted, updated, total: SEED.length }, 'kiro models seeded');
console.log(`Seeded ${SEED.length} Kiro models (${inserted} new, ${updated} updated).`);
