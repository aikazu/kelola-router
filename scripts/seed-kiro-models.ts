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
 * Pricing mirrors Anthropic's official Claude API rates (USD per 1M tokens), so
 * the dashboard cost telemetry is meaningful even though Kiro itself bills the
 * underlying AWS account per-seat, not per-token. Last verified 2026-06-09
 * against platform.claude.com pricing docs (Opus 4.8 $5/$25, Sonnet 4.6 $3/$15,
 * Haiku 4.5 $1/$5; cache write = 1.25x input, cache read = 0.1x input). Opus 4.8
 * and Sonnet 4.6 bill the full 1M context at flat rates with no long-context
 * surcharge, so no tiered pricing is needed. `auto` is priced as Haiku (its
 * cheapest possible routing target) so cost is never under-reported.
 */
import { openDb } from '../src/db/index.js';
import { upsertModel } from '../src/db/repos/models.js';
import { log } from '../src/util/log.js';

interface KiroBase {
  upstream: string;
  display: string;
  context: number;
  /** USD per 1M tokens. */
  pricing: { input: number; output: number; cacheWrite: number; cacheRead: number };
}

const BASE_MODELS: KiroBase[] = [
  {
    upstream: 'claude-sonnet-4-6',
    display: 'Claude Sonnet 4.6',
    context: 1000000,
    pricing: { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  },
  {
    upstream: 'claude-haiku-4-5',
    display: 'Claude Haiku 4.5',
    context: 200000,
    pricing: { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
  },
  {
    upstream: 'claude-opus-4-8',
    display: 'Claude Opus 4.8',
    context: 1000000,
    pricing: { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  },
  {
    // `auto` lets Kiro pick the model; price it as Haiku (the cheapest target)
    // so telemetry never under-reports cost regardless of what Kiro routes to.
    upstream: 'auto',
    display: 'Kiro Auto',
    context: 200000,
    pricing: { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
  },
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
      // All variants share the base model's per-token price (the suffix only
      // toggles router-side behaviour, not the upstream model that gets billed).
      pricing_input: base.pricing.input,
      pricing_output: base.pricing.output,
      pricing_cache_write: base.pricing.cacheWrite,
      pricing_cache_read: base.pricing.cacheRead,
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
