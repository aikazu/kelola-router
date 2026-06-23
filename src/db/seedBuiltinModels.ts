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
  /**
   * Max output tokens per upstream model. Kiro is a passthrough of the
   * underlying Claude models, so these numbers come straight from Anthropic's
   * published model specs (docs.claude.com/en/docs/about-claude/models/all-models).
   */
  contextOutput: number;
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
    contextOutput: 64000,
    pricing: { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  },
  {
    upstream: 'claude-haiku-4-5',
    display: 'Claude Haiku 4.5',
    context: 200000,
    contextOutput: 64000,
    pricing: { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
  },
  {
    upstream: 'claude-opus-4-8',
    display: 'Claude Opus 4.8',
    context: 1000000,
    contextOutput: 128000,
    pricing: { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  },
  {
    upstream: 'auto',
    display: 'Kiro Auto',
    context: 200000,
    contextOutput: 64000,
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
        context_output: base.contextOutput,
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
  /**
   * USD per 1M tokens. CodeBuddy (Tencent's AI coding assistant) is a
   * multi-provider proxy that resells several upstream models under its own
   * id space. CodeBuddy does NOT publish a per-model price list, so we use
   * the standard public list price of the closest real model on the underlying
   * provider. Sources:
   *   - Anthropic: docs.claude.com/en/docs/about-claude/models/all-models
   *   - Z.AI:      docs.z.ai/guides/overview/pricing
   *   - Google:    ai.google.dev/gemini-api/docs/pricing (Flash / Pro)
   *   - OpenAI:    openai.com/api/pricing (GPT-5 family)
   *   - Moonshot:  platform.moonshot.ai/docs/pricing (Kimi K2)
   * Override per-row from the dashboard edit modal if your CodeBuddy tier
   * prices differently.
   */
  pricing: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
}

const CODEBUDDY_MODELS: CodeBuddyModel[] = [
  {
    name: 'claude-opus-4.6',
    display: 'Claude Opus 4.6',
    context: 1000000,
    // Anthropic Opus 4.x list price (4.5/4.8 share the same rate). Cache write
    // = 1.25x input, cache read = 0.1x input per docs.claude.com.
    pricing: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  },
  {
    name: 'gemini-3.5-flash',
    display: 'Gemini 3.5 Flash',
    context: 1000000,
    // Google Gemini Flash list price (text ≤200k). No published cache pricing
    // for the Flash tier, so the cache fields stay 0.
    pricing: { input: 0.075, output: 0.3, cacheRead: 0, cacheWrite: 0 },
  },
  {
    name: 'gemini-3.1-pro',
    display: 'Gemini 3.1 Pro',
    context: 400000,
    // Google Gemini Pro list price (text ≤200k tier).
    pricing: { input: 1.25, output: 5, cacheRead: 0.31, cacheWrite: 0.31 },
  },
  {
    name: 'gpt-5.5',
    display: 'GPT-5.5',
    context: 1000000,
    // OpenAI GPT-5 family list price (closest published tier; cache read
    // discount is the GPT-5 0.1x rule per openai.com/api/pricing).
    pricing: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },
  },
  {
    name: 'glm-5.0',
    display: 'GLM-5.0',
    context: 200000,
    // Z.AI GLM-5 list price (same tier as glm-5.1 / glm-5.2 since the family
    // shares pricing). Cache write is the "Cached Input Storage" column,
    // currently "Limited-time Free" → 0 per docs.z.ai.
    pricing: { input: 1, output: 3.2, cacheRead: 0.2, cacheWrite: 0 },
  },
  {
    name: 'kimi-k2.5',
    display: 'Kimi K2.5',
    context: 164000,
    // Moonshot Kimi K2 list price per platform.moonshot.ai/docs/pricing.
    pricing: { input: 0.6, output: 2.2, cacheRead: 0.15, cacheWrite: 0 },
  },
];

/**
 * Seed the CodeBuddy built-in model list. Idempotent: re-running only upserts rows.
 * `context_output` stays null because CodeBuddy does not publish per-model
 * max-output specs; the upstream default applies at call time.
 */
export function seedCodebuddyBuiltins(db: Database.Database): SeedResult {
  const models: ModelUpsert[] = CODEBUDDY_MODELS.map((m) => ({
    name: m.name,
    upstream_model: m.name,
    display_name: `CodeBuddy ${m.display}`,
    family: 'codebuddy',
    context_window: m.context,
    context_output: null,
    pricing_input: m.pricing.input,
    pricing_output: m.pricing.output,
    pricing_cache_read: m.pricing.cacheRead,
    pricing_cache_write: m.pricing.cacheWrite,
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
  /**
   * Max output tokens. Sourced from the per-model guide page
   * (docs.z.ai/guides/llm/<id> for text, /guides/vlm/<id> for vision).
   * Vision pages do not publish a max-output figure, so vision rows leave
   * this null and rely on the upstream default at call time.
   */
  contextOutput: number | null;
  pricing: {
    input: number;
    output: number;
    cacheRead: number;
  };
}

/**
 * Curated catalogue — only the flagship + current-generation models. Pricing
 * from docs.z.ai/guides/overview/pricing (USD per 1M tokens). Context length
 * and max output tokens from the per-model guide pages (glm-5.2 / glm-5.1 /
 * glm-5 / glm-5-turbo / glm-4.7 / glm-5v-turbo / glm-4.6v). The "Cached Input
 * Storage" column on the pricing page is the cache-write leg, currently
 * listed as "Limited-time Free" — stored as 0 to match the published state.
 * Flash variants are free per the pricing page (0 across the row). GLM-4.5
 * family context/max-output from the glm-4.5 guide page (128K / 96K); the
 * X/Air/AirX variants share the family specs. GLM-4.6 context expanded to
 * 200K per its guide page. GLM-4.5V max-output is 16K per its guide page;
 * its context length is not published, so we use the family 128K default.
 * GLM-OCR context/output are not published; we use the family 128K default
 * and leave output null. GLM-4-32B-0414-128K context is 128K (from its id);
 * max output and cache pricing are not published (`-` on the pricing page).
 */
const ZAI_MODELS: ZaiModel[] = [
  // Text: GLM-4.7 family
  {
    upstream: 'glm-4.7',
    display: 'GLM-4.7',
    context: 200000,
    contextOutput: 128000,
    pricing: { input: 0.6, output: 2.2, cacheRead: 0.11 },
  },
  {
    upstream: 'glm-4.7-flash',
    display: 'GLM-4.7 Flash',
    context: 200000,
    contextOutput: 128000,
    pricing: { input: 0, output: 0, cacheRead: 0 },
  },
  {
    upstream: 'glm-4.7-flashx',
    display: 'GLM-4.7 FlashX',
    context: 200000,
    contextOutput: 128000,
    pricing: { input: 0.07, output: 0.4, cacheRead: 0.01 },
  },
  // Text: GLM-4.6
  {
    upstream: 'glm-4.6',
    display: 'GLM-4.6',
    context: 200000,
    contextOutput: 128000,
    pricing: { input: 0.6, output: 2.2, cacheRead: 0.11 },
  },
  // Text: GLM-4.5 family — context 128K, max output 96K per guide page
  {
    upstream: 'glm-4.5',
    display: 'GLM-4.5',
    context: 128000,
    contextOutput: 96000,
    pricing: { input: 0.6, output: 2.2, cacheRead: 0.11 },
  },
  {
    upstream: 'glm-4.5-x',
    display: 'GLM-4.5 X',
    context: 128000,
    contextOutput: 96000,
    pricing: { input: 2.2, output: 8.9, cacheRead: 0.45 },
  },
  {
    upstream: 'glm-4.5-air',
    display: 'GLM-4.5 Air',
    context: 128000,
    contextOutput: 96000,
    pricing: { input: 0.2, output: 1.1, cacheRead: 0.03 },
  },
  {
    upstream: 'glm-4.5-airx',
    display: 'GLM-4.5 AirX',
    context: 128000,
    contextOutput: 96000,
    pricing: { input: 1.1, output: 4.5, cacheRead: 0.22 },
  },
  {
    upstream: 'glm-4.5-flash',
    display: 'GLM-4.5 Flash',
    context: 128000,
    contextOutput: 96000,
    pricing: { input: 0, output: 0, cacheRead: 0 },
  },
  // Text: GLM-4-32B-0414-128K — older open-weight model, cache not supported
  {
    upstream: 'glm-4-32b-0414-128k',
    display: 'GLM-4-32B-0414-128K',
    context: 128000,
    contextOutput: null,
    pricing: { input: 0.1, output: 0.1, cacheRead: 0 },
  },
  // Text: GLM-5 family
  {
    upstream: 'glm-5',
    display: 'GLM-5',
    context: 200000,
    contextOutput: 128000,
    pricing: { input: 1, output: 3.2, cacheRead: 0.2 },
  },
  {
    upstream: 'glm-5-turbo',
    display: 'GLM-5 Turbo',
    context: 200000,
    contextOutput: 128000,
    pricing: { input: 1.2, output: 4.0, cacheRead: 0.24 },
  },
  {
    upstream: 'glm-5.1',
    display: 'GLM-5.1',
    context: 200000,
    contextOutput: 128000,
    pricing: { input: 1.4, output: 4.4, cacheRead: 0.26 },
  },
  {
    upstream: 'glm-5.2',
    display: 'GLM-5.2',
    context: 1000000,
    contextOutput: 128000,
    pricing: { input: 1.4, output: 4.4, cacheRead: 0.26 },
  },
  // Vision: GLM-4.6V family — Z.AI's vision guide pages publish Context Length
  // (128k) but not Maximum Output Tokens, so the output column is intentionally
  // null rather than guessed.
  {
    upstream: 'glm-4.6v',
    display: 'GLM-4.6V',
    context: 128000,
    contextOutput: null,
    pricing: { input: 0.3, output: 0.9, cacheRead: 0.05 },
  },
  {
    upstream: 'glm-4.6v-flash',
    display: 'GLM-4.6V Flash',
    context: 128000,
    contextOutput: null,
    pricing: { input: 0, output: 0, cacheRead: 0 },
  },
  {
    upstream: 'glm-4.6v-flashx',
    display: 'GLM-4.6V FlashX',
    context: 128000,
    contextOutput: null,
    pricing: { input: 0.04, output: 0.4, cacheRead: 0.004 },
  },
  // Vision: GLM-4.5V — max output 16K per guide page; context unpublished,
  // uses family 128K default
  {
    upstream: 'glm-4.5v',
    display: 'GLM-4.5V',
    context: 128000,
    contextOutput: 16000,
    pricing: { input: 0.6, output: 1.8, cacheRead: 0.11 },
  },
  // Vision: GLM-OCR — lightweight OCR specialist (0.9B params). Context and
  // max output are not published; uses family 128K default, output null.
  // Cache pricing not applicable (`\` on the pricing page).
  {
    upstream: 'glm-ocr',
    display: 'GLM-OCR',
    context: 128000,
    contextOutput: null,
    pricing: { input: 0.03, output: 0.03, cacheRead: 0 },
  },
  // Vision: GLM-5V family
  {
    upstream: 'glm-5v-turbo',
    display: 'GLM-5V Turbo',
    context: 200000,
    contextOutput: 128000,
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
    context_output: m.contextOutput,
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
  log.info(
    { provider, added: result.added },
    `${provider}: model auto-seed succeeded on account add`
  );
  return result.added;
}
