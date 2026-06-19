/**
 * Built-in model seeds for providers that do not expose a usable live model-list
 * endpoint (Kiro, CodeBuddy).
 *
 * Dispatch in `seedModelsForProvider` is called after an account is added so the
 * user gets the relevant models immediately without a CLI seed step.
 */
import type Database from 'better-sqlite3';
import { type FetchModelsResult, fetchModels } from '../providers/listModels.js';
import {
  fetchAndSeedPioneerModels,
  type SeedPioneerModelsResult,
} from '../providers/pioneer/models.js';
import { log } from '../util/log.js';
import { type ModelUpsert, upsertModel } from './repos/models.js';

export interface SeedResult {
  added: number;
  total: number;
}

// ── Kiro built-in models ───────────────────────────────────────────────────

interface KiroBase {
  upstream: string;
  display: string;
  context: number;
  pricing: {
    input: number;
    output: number;
    cacheWrite: number;
    cacheRead: number;
  };
}

const KIRO_BASES: KiroBase[] = [
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
    upstream: 'auto',
    display: 'Kiro Auto',
    context: 200000,
    pricing: { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
  },
];

function buildKiroModels(): ModelUpsert[] {
  const out: ModelUpsert[] = [];
  for (const base of KIRO_BASES) {
    const isAuto = base.upstream === 'auto';
    const variants = [
      { suffix: '', label: base.display },
      { suffix: '-thinking', label: `${base.display} (Thinking)` },
      ...(isAuto
        ? []
        : [
            { suffix: '-agentic', label: `${base.display} (Agentic)` },
            { suffix: '-thinking-agentic', label: `${base.display} (Thinking + Agentic)` },
          ]),
    ];
    for (const v of variants) {
      const name = `${base.upstream}${v.suffix}`;
      out.push({
        name,
        upstream_model: name,
        display_name: `Kiro ${v.label}`,
        family: 'kiro',
        context_window: base.context,
        pricing_input: base.pricing.input,
        pricing_output: base.pricing.output,
        pricing_cache_write: base.pricing.cacheWrite,
        pricing_cache_read: base.pricing.cacheRead,
        source: 'builtin',
        enabled: v.suffix.endsWith('-thinking') ? 0 : 1,
        provider: 'kiro',
      });
    }
  }
  return out;
}

function countPreexistingRows(db: Database.Database, models: ModelUpsert[]): number {
  if (models.length === 0) return 0;
  const placeholders = models.map(() => '?').join(', ');
  const names = models.map((m) => m.name);
  return (
    db
      .prepare<unknown[], { c: number }>(
        `SELECT COUNT(*) AS c FROM models WHERE name IN (${placeholders})`
      )
      .get(...names)?.c ?? 0
  );
}

/**
 * Seed the Kiro built-in model list. Idempotent: re-running only upserts rows.
 */
export function seedKiroBuiltins(db: Database.Database): SeedResult {
  const models = buildKiroModels();
  const previous = countPreexistingRows(db, models);
  for (const m of models) upsertModel(db, m);
  const current = countPreexistingRows(db, models);
  return { added: current - previous, total: models.length };
}

// ── CodeBuddy built-in models ──────────────────────────────────────────────

interface CodeBuddyModel {
  name: string;
  display: string;
  context: number;
}

const CODEBUDDY_MODELS: CodeBuddyModel[] = [
  {
    name: 'claude-opus-4.6',
    display: 'Claude Opus 4.6',
    context: 1000000,
  },
  {
    name: 'gemini-3.5-flash',
    display: 'Gemini 3.5 Flash',
    context: 1000000,
  },
  {
    name: 'gemini-3.1-pro',
    display: 'Gemini 3.1 Pro',
    context: 400000,
  },
  {
    name: 'gpt-5.5',
    display: 'GPT-5.5',
    context: 1000000,
  },
  {
    name: 'glm-5.0',
    display: 'GLM-5.0',
    context: 200000,
  },
  {
    name: 'kimi-k2.5',
    display: 'Kimi K2.5',
    context: 164000,
  },
];

/**
 * Seed the CodeBuddy built-in model list. Idempotent: re-running only upserts rows.
 */
export function seedCodebuddyBuiltins(db: Database.Database): SeedResult {
  const models: ModelUpsert[] = CODEBUDDY_MODELS.map((m) => ({
    name: m.name,
    upstream_model: m.name,
    display_name: `CodeBuddy ${m.display}`,
    family: 'codebuddy',
    context_window: m.context,
    pricing_input: 0,
    pricing_output: 0,
    pricing_cache_read: 0,
    pricing_cache_write: 0,
    source: 'builtin',
    provider: 'codebuddy',
  }));
  const previous = countPreexistingRows(db, models);
  for (const m of models) upsertModel(db, m);
  const current = countPreexistingRows(db, models);
  return { added: current - previous, total: models.length };
}

// ── Z.AI built-in models ───────────────────────────────────────────────────

interface ZaiModel {
  upstream: string;
  display: string;
  context: number;
  pricing: {
    input: number;
    output: number;
    cacheRead: number;
  };
}

/**
 * Curated catalogue — only the flagship + current-generation models. Pricing
 * from docs.z.ai/guides/overview/pricing (USD per 1M tokens). Context from the
 * per-model guide pages (glm-5.2 / glm-5.1 / glm-5 / glm-5-turbo / glm-4.7 /
 * glm-5v-turbo / glm-4.6v). Flash variants are free per the pricing page
 * (0 across the row).
 */
const ZAI_MODELS: ZaiModel[] = [
  // Text: GLM-4.7 family
  {
    upstream: 'glm-4.7',
    display: 'GLM-4.7',
    context: 200000,
    pricing: { input: 0.6, output: 2.2, cacheRead: 0.11 },
  },
  {
    upstream: 'glm-4.7-flash',
    display: 'GLM-4.7 Flash',
    context: 200000,
    pricing: { input: 0, output: 0, cacheRead: 0 },
  },
  {
    upstream: 'glm-4.7-flashx',
    display: 'GLM-4.7 FlashX',
    context: 200000,
    pricing: { input: 0.07, output: 0.4, cacheRead: 0.01 },
  },
  // Text: GLM-5 family
  {
    upstream: 'glm-5',
    display: 'GLM-5',
    context: 200000,
    pricing: { input: 1, output: 3.2, cacheRead: 0.2 },
  },
  {
    upstream: 'glm-5-turbo',
    display: 'GLM-5 Turbo',
    context: 200000,
    pricing: { input: 1.2, output: 4.0, cacheRead: 0.24 },
  },
  {
    upstream: 'glm-5.1',
    display: 'GLM-5.1',
    context: 200000,
    pricing: { input: 1.4, output: 4.4, cacheRead: 0.26 },
  },
  {
    upstream: 'glm-5.2',
    display: 'GLM-5.2',
    context: 1000000,
    pricing: { input: 1.4, output: 4.4, cacheRead: 0.26 },
  },
  // Vision: GLM-4.6V family
  {
    upstream: 'glm-4.6v',
    display: 'GLM-4.6V',
    context: 128000,
    pricing: { input: 0.3, output: 0.9, cacheRead: 0.05 },
  },
  {
    upstream: 'glm-4.6v-flash',
    display: 'GLM-4.6V Flash',
    context: 128000,
    pricing: { input: 0, output: 0, cacheRead: 0 },
  },
  {
    upstream: 'glm-4.6v-flashx',
    display: 'GLM-4.6V FlashX',
    context: 128000,
    pricing: { input: 0.04, output: 0.4, cacheRead: 0.004 },
  },
  // Vision: GLM-5V family
  {
    upstream: 'glm-5v-turbo',
    display: 'GLM-5V Turbo',
    context: 200000,
    pricing: { input: 1.2, output: 4.0, cacheRead: 0.24 },
  },
];

/**
 * Seed the Z.AI built-in model list. Idempotent: re-running only upserts rows.
 * Names are stored BARE (no `zai/` prefix); clients route via the prefix which
 * the proxy strips before calling upstream.
 */
export function seedZaiBuiltins(db: Database.Database): SeedResult {
  const models: ModelUpsert[] = ZAI_MODELS.map((m) => ({
    name: m.upstream,
    upstream_model: m.upstream,
    display_name: `Z.AI ${m.display}`,
    family: 'zai',
    context_window: m.context,
    pricing_input: m.pricing.input,
    pricing_output: m.pricing.output,
    pricing_cache_read: m.pricing.cacheRead,
    pricing_cache_write: 0,
    source: 'builtin',
    provider: 'zai',
  }));
  const previous = countPreexistingRows(db, models);
  for (const m of models) upsertModel(db, m);
  const current = countPreexistingRows(db, models);
  return { added: current - previous, total: models.length };
}

// ── Dispatcher ─────────────────────────────────────────────────────────────

export type SeedableProvider = 'minimax' | 'kiro' | 'codebuddy' | 'pioneer' | 'notion' | 'zai';

export interface SeedProviderOptions {
  apiKey?: string;
  baseUrl?: string | null;
}

export interface SeedProviderResult {
  ok: boolean;
  added: number;
  error?: string;
}

/**
 * Seed the model catalogue for a provider after an account is added.
 * Live loaders run for MiniMax / Pioneer; builtin lists run for Kiro / CodeBuddy.
 * Failures are non-fatal to the caller and are returned in the result shape.
 */
export async function seedModelsForProvider(
  db: Database.Database,
  provider: SeedableProvider,
  opts: SeedProviderOptions = {}
): Promise<SeedProviderResult> {
  if (provider === 'minimax') {
    if (!opts.apiKey) {
      return { ok: false, added: 0, error: 'minimax seed requires api key' };
    }
    const result: FetchModelsResult = await fetchModels(db, opts.apiKey);
    if (!result.ok) return { ok: false, added: 0, error: result.error };
    return { ok: true, added: Number(result.added ?? 0) };
  }

  if (provider === 'pioneer') {
    if (!opts.apiKey) {
      return { ok: false, added: 0, error: 'pioneer seed requires api key' };
    }
    const result: SeedPioneerModelsResult = await fetchAndSeedPioneerModels(
      db,
      opts.apiKey,
      opts.baseUrl
    );
    if (!result.ok) return { ok: false, added: 0, error: result.error };
    return { ok: true, added: Number(result.added ?? 0) };
  }

  if (provider === 'kiro') {
    const result = seedKiroBuiltins(db);
    return { ok: true, added: result.added };
  }

  if (provider === 'codebuddy') {
    const result = seedCodebuddyBuiltins(db);
    return { ok: true, added: result.added };
  }

  const result = seedZaiBuiltins(db);
  return { ok: true, added: result.added };
}

/**
 * Best-effort wrapper used when seeding after account creation. A seed failure
 * must not roll back the account, so we log and discard the error.
 */
export async function seedModelsForProviderBestEffort(
  db: Database.Database,
  provider: SeedableProvider,
  opts: SeedProviderOptions = {}
): Promise<number> {
  const result = await seedModelsForProvider(db, provider, opts);
  if (!result.ok) {
    log.warn({ provider, err: result.error }, `${provider}: model auto-seed failed on account add`);
    return 0;
  }
  return result.added;
}
