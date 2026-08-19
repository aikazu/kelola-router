import type Database from 'better-sqlite3';
import { upsertModel } from '../../db/repos/models.js';

// ─── TabiToken built-in model catalogue ──────────────────────────────────────

interface TabiModel {
  /** Upstream model id (bare — the string TabiToken's /v1/chat/completions accepts). */
  id: string;
  display: string;
  context: number;
  contextOutput: number | null;
  /**
   * USD per 1M tokens. TabiToken is a reseller gateway (New-API fork) that
   * does not publish per-model pricing. These are the underlying provider's
   * standard public list prices. Override per-row from the dashboard edit
   * modal if your TabiToken tier prices differently.
   */
  pricing: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
}

const TABI_MODELS: TabiModel[] = [
  // Anthropic Claude family
  {
    id: 'claude-opus-5',
    display: 'Claude Opus 5',
    context: 1000000,
    contextOutput: 128000,
    pricing: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  },
  {
    id: 'claude-opus-4-8',
    display: 'Claude Opus 4.8',
    context: 1000000,
    contextOutput: 128000,
    pricing: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  },
  {
    id: 'claude-sonnet-4-6',
    display: 'Claude Sonnet 4.6',
    context: 1000000,
    contextOutput: 64000,
    pricing: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  },
  {
    id: 'claude-haiku-4-5',
    display: 'Claude Haiku 4.5',
    context: 200000,
    contextOutput: 64000,
    pricing: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  },
  // OpenAI GPT family
  {
    id: 'gpt-5.5',
    display: 'GPT-5.5',
    context: 1000000,
    contextOutput: 64000,
    pricing: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },
  },
  {
    id: 'gpt-5',
    display: 'GPT-5',
    context: 1000000,
    contextOutput: 64000,
    pricing: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },
  },
  {
    id: 'gpt-4o-mini',
    display: 'GPT-4o Mini',
    context: 128000,
    contextOutput: 16384,
    pricing: { input: 0.15, output: 0.6, cacheRead: 0.075, cacheWrite: 0 },
  },
  // DeepSeek
  {
    id: 'deepseek-3.2',
    display: 'DeepSeek V3.2',
    context: 64000,
    contextOutput: 8000,
    pricing: { input: 0.27, output: 1.1, cacheRead: 0.07, cacheWrite: 0 },
  },
  // Google Gemini
  {
    id: 'gemini-3.5-pro',
    display: 'Gemini 3.5 Pro',
    context: 200000,
    contextOutput: 8192,
    pricing: { input: 1.25, output: 5, cacheRead: 0.31, cacheWrite: 0.31 },
  },
  {
    id: 'gemini-3.5-flash',
    display: 'Gemini 3.5 Flash',
    context: 1000000,
    contextOutput: 8192,
    pricing: { input: 0.075, output: 0.3, cacheRead: 0.01875, cacheWrite: 0 },
  },
];

/**
 * Seed the TabiToken built-in model list. Idempotent: re-running only upserts
 * rows. Tabi models are stored with the `tabi/` prefix in both `name` and
 * `upstream_model` to avoid collisions on the globally-unique index with
 * same-named Kiro / CodeBuddy / Pioneer rows. The proxy strips the prefix
 * before forwarding to the upstream.
 */
export function seedTabiBuiltins(db: Database.Database): { added: number; total: number } {
  const models = TABI_MODELS.map((m) => ({
    name: `tabi/${m.id}`,
    upstream_model: `tabi/${m.id}`,
    display_name: `TabiToken ${m.display}`,
    family: 'tabi' as const,
    context_window: m.context,
    context_output: m.contextOutput,
    pricing_input: m.pricing.input,
    pricing_output: m.pricing.output,
    pricing_cache_read: m.pricing.cacheRead,
    pricing_cache_write: m.pricing.cacheWrite,
    source: 'builtin' as const,
    provider: 'tabi' as const,
  }));

  const previous = (db
    .prepare<unknown[], { c: number }>(
      `SELECT COUNT(*) AS c FROM models WHERE name IN (${models.map(() => '?').join(', ')})`
    )
    .get(...models.map((m) => m.name))?.c ?? 0) as number;

  for (const m of models) upsertModel(db, m);

  const current = (db
    .prepare<unknown[], { c: number }>(
      `SELECT COUNT(*) AS c FROM models WHERE name IN (${models.map(() => '?').join(', ')})`
    )
    .get(...models.map((m) => m.name))?.c ?? 0) as number;

  return { added: current - previous, total: models.length };
}
