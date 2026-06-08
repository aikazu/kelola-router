/**
 * Auto-seed built-in models on first startup (both MiniMax + Kiro).
 * Only runs when the `models` table is empty, so manual seeds, later model
 * additions, and existing deployments are never overwritten.
 */
import type Database from 'better-sqlite3';
import { log } from '../util/log.js';
import { type ModelUpsert, upsertModel } from './repos/models.js';

// ── MiniMax built-in models ────────────────────────────────────────────────

const MINIMAX_MODELS: ModelUpsert[] = [
  {
    name: 'MiniMax-M3',
    upstream_model: 'MiniMax-M3',
    display_name: 'MiniMax M3',
    family: 'm3',
    context_window: 1000000,
    pricing_input: 0.6,
    pricing_output: 2.4,
    pricing_cache_read: 0.12,
    pricing_cache_write: null,
    pricing_tiers:
      '{"base":{"input":0.60,"output":2.40,"cacheRead":0.12,"cacheWrite":null},"high":{"input":1.20,"output":4.80,"cacheRead":0.24,"cacheWrite":null},"promotional":{"input":0.30,"output":1.20,"cacheRead":0.06,"cacheWrite":null}}',
    source: 'builtin',
  },
  {
    name: 'MiniMax-M2.7',
    upstream_model: 'MiniMax-M2.7',
    display_name: 'MiniMax M2.7',
    family: 'm2.7',
    context_window: 204800,
    pricing_input: 0.3,
    pricing_output: 1.2,
    pricing_cache_read: 0.06,
    pricing_cache_write: 0.375,
    source: 'builtin',
  },
  {
    name: 'MiniMax-M2.7-highspeed',
    upstream_model: 'MiniMax-M2.7-highspeed',
    display_name: 'MiniMax M2.7 highspeed',
    family: 'm2.7',
    context_window: 204800,
    pricing_input: 0.6,
    pricing_output: 2.4,
    pricing_cache_read: 0.06,
    pricing_cache_write: 0.375,
    source: 'builtin',
  },
  {
    name: 'MiniMax-M2.5',
    upstream_model: 'MiniMax-M2.5',
    display_name: 'MiniMax M2.5',
    family: 'm2.5',
    context_window: 204800,
    pricing_input: 0.3,
    pricing_output: 1.2,
    pricing_cache_read: 0.03,
    pricing_cache_write: 0.375,
    source: 'builtin',
  },
  {
    name: 'MiniMax-M2.5-highspeed',
    upstream_model: 'MiniMax-M2.5-highspeed',
    display_name: 'MiniMax M2.5 highspeed',
    family: 'm2.5',
    context_window: 204800,
    pricing_input: 0.6,
    pricing_output: 2.4,
    pricing_cache_read: 0.03,
    pricing_cache_write: 0.375,
    source: 'builtin',
  },
  {
    name: 'MiniMax-M2.1',
    upstream_model: 'MiniMax-M2.1',
    display_name: 'MiniMax M2.1',
    family: 'm2.1',
    context_window: 204800,
    pricing_input: 0.3,
    pricing_output: 1.2,
    pricing_cache_read: 0.03,
    pricing_cache_write: 0.375,
    source: 'builtin',
  },
  {
    name: 'MiniMax-M2.1-highspeed',
    upstream_model: 'MiniMax-M2.1-highspeed',
    display_name: 'MiniMax M2.1 highspeed',
    family: 'm2.1',
    context_window: 204800,
    pricing_input: 0.6,
    pricing_output: 2.4,
    pricing_cache_read: 0.03,
    pricing_cache_write: 0.375,
    source: 'builtin',
  },
  {
    name: 'MiniMax-M2',
    upstream_model: 'MiniMax-M2',
    display_name: 'MiniMax M2',
    family: 'm2',
    context_window: 204800,
    pricing_input: 0.3,
    pricing_output: 1.2,
    pricing_cache_read: 0.03,
    pricing_cache_write: 0.375,
    source: 'builtin',
  },
  {
    name: 'MiniMax-M2-her',
    upstream_model: 'MiniMax-M2-her',
    display_name: 'MiniMax M2-her (roleplay)',
    family: 'm2-her',
    context_window: 64000,
    source: 'builtin',
  },
];

// ── Kiro (Claude) built-in models ──────────────────────────────────────────

interface KiroBase {
  upstream: string;
  display: string;
  context: number;
  pricing: { input: number; output: number; cacheWrite: number; cacheRead: number };
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
        provider: 'kiro',
      });
    }
  }
  return out;
}

// ── Public entry point ─────────────────────────────────────────────────────

export function autoSeedModels(db: Database.Database): void {
  const count = (db.prepare('SELECT COUNT(*) AS c FROM models').get() as { c: number }).c;
  if (count > 0) return; // already has models — skip

  const all = [...MINIMAX_MODELS, ...buildKiroModels()];
  for (const m of all) upsertModel(db, m);
  log.info({ count: all.length }, 'auto-seeded built-in models (first startup)');
}
