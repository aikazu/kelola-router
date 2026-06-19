#!/usr/bin/env tsx
/**
 * Seed built-in CodeBuddy models. Idempotent: re-running upserts.
 *
 * Only proven, tested models are seeded. Model names are stored bare (no prefix);
 * clients route via the `cb/` prefix, which the proxy strips before calling upstream.
 *
 * Pricing mirrors the underlying provider's standard public list price (CodeBuddy
 * is a multi-provider proxy and does not publish a per-model price list). Sources:
 *   - Anthropic: docs.claude.com/en/docs/about-claude/models/all-models
 *   - Z.AI:      docs.z.ai/guides/overview/pricing
 *   - Google:    ai.google.dev/gemini-api/docs/pricing
 *   - OpenAI:    openai.com/api/pricing
 *   - Moonshot:  platform.moonshot.ai/docs/pricing
 * Override per-row from the dashboard edit modal if your CodeBuddy tier bills
 * differently. `context_output` stays null — CodeBuddy does not publish it.
 */
import { openDb } from '../src/db/index.js';
import { upsertModel } from '../src/db/repos/models.js';
import { log } from '../src/util/log.js';

interface CodeBuddyModel {
  name: string;
  display: string;
  context: number;
  /** USD per 1M tokens — see header for sources. */
  pricing: { input: number; output: number; cacheRead: number; cacheWrite: number };
}

const MODELS: CodeBuddyModel[] = [
  {
    name: 'claude-opus-4.6',
    display: 'Claude Opus 4.6',
    context: 1000000,
    pricing: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  },
  {
    name: 'gemini-3.5-flash',
    display: 'Gemini 3.5 Flash',
    context: 1000000,
    pricing: { input: 0.075, output: 0.3, cacheRead: 0, cacheWrite: 0 },
  },
  {
    name: 'gemini-3.1-pro',
    display: 'Gemini 3.1 Pro',
    context: 400000,
    pricing: { input: 1.25, output: 5, cacheRead: 0.31, cacheWrite: 0.31 },
  },
  {
    name: 'gpt-5.5',
    display: 'GPT-5.5',
    context: 1000000,
    pricing: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },
  },
  {
    name: 'glm-5.0',
    display: 'GLM-5.0',
    context: 200000,
    pricing: { input: 1, output: 3.2, cacheRead: 0.2, cacheWrite: 0 },
  },
  {
    name: 'kimi-k2.5',
    display: 'Kimi K2.5',
    context: 164000,
    pricing: { input: 0.6, output: 2.2, cacheRead: 0.15, cacheWrite: 0 },
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
    pricing_input: m.pricing.input,
    pricing_output: m.pricing.output,
    pricing_cache_read: m.pricing.cacheRead,
    pricing_cache_write: m.pricing.cacheWrite,
    source: 'builtin',
    provider: 'codebuddy',
  });
  if (existed) updated++;
  else inserted++;
}
log.info({ inserted, updated, total: MODELS.length }, 'codebuddy models seeded');
console.log(`Seeded ${MODELS.length} CodeBuddy models (${inserted} new, ${updated} updated).`);
