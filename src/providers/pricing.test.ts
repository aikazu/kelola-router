import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../db/index.js';
import { upsertModel } from '../db/repos/models.js';
import { calculateCost, resolvePricing } from './pricing.js';

beforeEach(() => {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'pr-')), 't.db');
});

function seedMiniMaxForPricing(db: ReturnType<typeof openDb>): void {
  // MiniMax pricing from platform.minimax.io/docs/guides/pricing-payg.
  // M3 has a permanent 50% discount: ≤512k input uses the discounted base
  // tier ($0.30/$1.20/$0.06), >512k uses the high tier ($0.60/$2.40/$0.12).
  // M2.7 publishes flat pricing with a cache-write column.
  upsertModel(db, {
    name: 'MiniMax-M3',
    upstream_model: 'MiniMax-M3',
    display_name: 'MiniMax M3',
    family: 'm3',
    context_window: 1_000_000,
    pricing_input: 0.3,
    pricing_output: 1.2,
    pricing_cache_read: 0.06,
    pricing_cache_write: null,
    pricing_tiers:
      '{"base":{"input":0.30,"output":1.20,"cacheRead":0.06,"cacheWrite":null},"high":{"input":0.60,"output":2.40,"cacheRead":0.12,"cacheWrite":null}}',
    source: 'builtin',
  });
  upsertModel(db, {
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
  });
}

describe('resolvePricing', () => {
  it('M3 ≤ 512k → base pricing (discounted)', () => {
    const db = openDb();
    seedMiniMaxForPricing(db);
    const p = resolvePricing(db, 'MiniMax-M3', 100_000);
    expect(p?.input).toBe(0.3);
    expect(p?.output).toBe(1.2);
    expect(p?.cacheRead).toBe(0.06);
  });

  it('M3 > 512k → high pricing (2x base)', () => {
    const db = openDb();
    seedMiniMaxForPricing(db);
    const p = resolvePricing(db, 'MiniMax-M3', 600_000);
    expect(p?.input).toBe(0.6);
    expect(p?.output).toBe(2.4);
    expect(p?.cacheRead).toBe(0.12);
  });

  it('M2.7 → flat pricing', () => {
    const db = openDb();
    seedMiniMaxForPricing(db);
    const p = resolvePricing(db, 'MiniMax-M2.7', 50_000);
    expect(p?.input).toBe(0.3);
    expect(p?.output).toBe(1.2);
    expect(p?.cacheRead).toBe(0.06);
    expect(p?.cacheWrite).toBe(0.375);
  });

  it('M2-her with NULL pricing → null', () => {
    const db = openDb();
    upsertModel(db, {
      name: 'MiniMax-M2-her',
      upstream_model: 'MiniMax-M2-her',
      display_name: 'MiniMax M2-her (roleplay)',
      family: 'm2-her',
      context_window: 64000,
      source: 'builtin',
    });
    expect(resolvePricing(db, 'MiniMax-M2-her', 1000)).toBeNull();
  });

  it('unknown model → null', () => {
    const db = openDb();
    expect(resolvePricing(db, 'nope', 1000)).toBeNull();
  });
});

describe('calculateCost', () => {
  it('M2.7 with cache_read returns positive cost', () => {
    const db = openDb();
    seedMiniMaxForPricing(db);
    const c = calculateCost(db, 'MiniMax-M2.7', {
      prompt_tokens: 1000,
      completion_tokens: 500,
      cache_creation_tokens: 0,
      cache_read_tokens: 2000,
    });
    const expected = (1000 / 1e6) * 0.3 + (500 / 1e6) * 1.2 + (2000 / 1e6) * 0.06;
    expect(c).toBeCloseTo(expected, 8);
  });

  it('M3 with cache_creation: cacheWrite NULL → cost excludes cache_creation (honest unknown)', () => {
    const db = openDb();
    seedMiniMaxForPricing(db);
    const c = calculateCost(db, 'MiniMax-M3', {
      prompt_tokens: 1000,
      completion_tokens: 500,
      cache_creation_tokens: 1000,
      cache_read_tokens: 0,
    });
    // ≤512k base tier: input $0.30 / output $1.20 per 1M tokens.
    const expected = (1000 / 1e6) * 0.3 + (500 / 1e6) * 1.2;
    expect(c).toBeCloseTo(expected, 8);
  });

  it('unknown model → cost = 0 (caller should log NULL)', () => {
    const db = openDb();
    const c = calculateCost(db, 'nope', {
      prompt_tokens: 100,
      completion_tokens: 100,
      cache_creation_tokens: 0,
      cache_read_tokens: 0,
    });
    expect(c).toBe(0);
  });
});
