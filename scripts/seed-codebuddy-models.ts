#!/usr/bin/env tsx
/**
 * Seed built-in CodeBuddy models. Idempotent: re-running upserts.
 *
 * Only proven, tested models are seeded. Model names retain the `codebuddy/`
 * prefix which is passed through to the upstream API as-is.
 *
 * Pricing is set to zero (CodeBuddy uses credits, not per-token billing).
 * The dashboard will show request counts but not cost estimates.
 */
import { openDb } from '../src/db/index.js';
import { upsertModel } from '../src/db/repos/models.js';
import { log } from '../src/util/log.js';

interface CodeBuddyModel {
  name: string;
  display: string;
  context: number;
}

const MODELS: CodeBuddyModel[] = [
  {
    name: 'codebuddy/claude-opus-4.6',
    display: 'Claude Opus 4.6',
    context: 1000000,
  },
  {
    name: 'codebuddy/gemini-3.5-flash',
    display: 'Gemini 3.5 Flash',
    context: 1000000,
  },
  {
    name: 'codebuddy/gemini-3.1-pro',
    display: 'Gemini 3.1 Pro',
    context: 400000,
  },
  {
    name: 'codebuddy/gpt-5.5',
    display: 'GPT-5.5',
    context: 1000000,
  },
  {
    name: 'codebuddy/glm-5.0',
    display: 'GLM-5.0',
    context: 200000,
  },
  {
    name: 'codebuddy/kimi-k2.5',
    display: 'Kimi K2.5',
    context: 164000,
  },
];

const db = openDb();
let inserted = 0;
let updated = 0;

for (const m of MODELS) {
  const existed = db.prepare(`SELECT 1 FROM models WHERE name = ?`).get(m.name);
  upsertModel(db, {
    name: m.name,
    upstream_model: m.name, // Passed through as-is to CodeBuddy
    display_name: `CodeBuddy ${m.display}`,
    family: 'codebuddy',
    context_window: m.context,
    pricing_input: 0,
    pricing_output: 0,
    pricing_cache_read: 0,
    pricing_cache_write: 0,
    source: 'builtin',
    provider: 'codebuddy',
  });
  if (existed) updated++;
  else inserted++;
}

log.info({ inserted, updated, total: MODELS.length }, 'codebuddy models seeded');
console.log(`Seeded ${MODELS.length} CodeBuddy models (${inserted} new, ${updated} updated).`);
