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
   * USD per 1M tokens — **Anthropic official list prices** (docs.anthropic.com
   * pricing page, verified 2026-08-19). Standard rate for Claude Opus 5 and
   * Opus 4.8 (also Opus 4.6/4.7/4.5): $5 input / $25 output, cache hits
   * $0.50, 5-minute cache write $6.25 (the router defaults to short-TTL
   * cache_control breakpoints; the 1h cache write is $10). The -thinking
   * variants bill at the same rate.
   *
   * Note: TabiToken's own billing is far lower ($0.8 / $0.5 per 1M input,
   * from its public /api/pricing, output free per completion_ratio=0) — the
   * dashboard reports official list prices for realistic cost estimates.
   */
  pricing: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
}

const TABI_MODELS: TabiModel[] = [
  {
    id: 'claude-opus-5',
    display: 'Claude Opus 5',
    context: 1000000,
    contextOutput: 128000,
    pricing: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  },
  {
    id: 'claude-opus-5-thinking',
    display: 'Claude Opus 5 Thinking',
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
    id: 'claude-opus-4-8-thinking',
    display: 'Claude Opus 4.8 Thinking',
    context: 1000000,
    contextOutput: 128000,
    pricing: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
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
