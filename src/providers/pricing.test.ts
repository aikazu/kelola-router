import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../db/index.js';
import { upsertModel } from '../db/repos/models.js';
import { calculateCost, calculateCostBreakdown, resolvePricing } from './pricing.js';

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

describe('calculateCostBreakdown', () => {
  it('flat pricing → correct input/output/cacheRead/cacheWrite components', () => {
    const db = openDb();
    seedMiniMaxForPricing(db);
    const b = calculateCostBreakdown(db, 'MiniMax-M2.7', {
      prompt_tokens: 1000,
      completion_tokens: 500,
      cache_creation_tokens: 200,
      cache_read_tokens: 3000,
    });
    expect(b.input).toBeCloseTo((1000 / 1e6) * 0.3, 8);
    expect(b.output).toBeCloseTo((500 / 1e6) * 1.2, 8);
    expect(b.cacheWrite).toBeCloseTo((200 / 1e6) * 0.375, 8);
    expect(b.cacheRead).toBeCloseTo((3000 / 1e6) * 0.06, 8);
  });

  it('tiered pricing > 512k → uses high tier for all components', () => {
    const db = openDb();
    seedMiniMaxForPricing(db);
    const b = calculateCostBreakdown(db, 'MiniMax-M3', {
      prompt_tokens: 600_000,
      completion_tokens: 300_000,
      cache_creation_tokens: 50_000,
      cache_read_tokens: 700_000,
    });
    expect(b.input).toBeCloseTo((600_000 / 1e6) * 0.6, 8);
    expect(b.output).toBeCloseTo((300_000 / 1e6) * 2.4, 8);
    expect(b.cacheRead).toBeCloseTo((700_000 / 1e6) * 0.12, 8);
    // cacheWrite is null in M3 → component is 0
    expect(b.cacheWrite).toBe(0);
  });

  it('tiered pricing ≤ 512k → uses discounted base tier', () => {
    const db = openDb();
    seedMiniMaxForPricing(db);
    const b = calculateCostBreakdown(db, 'MiniMax-M3', {
      prompt_tokens: 100_000,
      completion_tokens: 50_000,
      cache_creation_tokens: 0,
      cache_read_tokens: 10_000,
    });
    expect(b.input).toBeCloseTo((100_000 / 1e6) * 0.3, 8);
    expect(b.output).toBeCloseTo((50_000 / 1e6) * 1.2, 8);
    expect(b.cacheRead).toBeCloseTo((10_000 / 1e6) * 0.06, 8);
  });

  it('model without pricing / unknown model → all components 0', () => {
    const db = openDb();
    upsertModel(db, {
      name: 'MiniMax-M2-her',
      upstream_model: 'MiniMax-M2-her',
      display_name: 'MiniMax M2-her (roleplay)',
      family: 'm2-her',
      context_window: 64000,
      source: 'builtin',
    });
    expect(
      calculateCostBreakdown(db, 'MiniMax-M2-her', {
        prompt_tokens: 100,
        completion_tokens: 100,
        cache_creation_tokens: 10,
        cache_read_tokens: 10,
      })
    ).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
    expect(
      calculateCostBreakdown(db, 'nope', {
        prompt_tokens: 100,
        completion_tokens: 100,
        cache_creation_tokens: 10,
        cache_read_tokens: 10,
      })
    ).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
  });

  it('regression guard: sum of components equals calculateCost', () => {
    const db = openDb();
    seedMiniMaxForPricing(db);
    const usage = {
      prompt_tokens: 1_000_000,
      completion_tokens: 400_000,
      cache_creation_tokens: 120_000,
      cache_read_tokens: 2_000_000,
    };
    for (const model of ['MiniMax-M3', 'MiniMax-M2.7']) {
      const b = calculateCostBreakdown(db, model, usage);
      const total = b.input + b.output + b.cacheRead + b.cacheWrite;
      expect(total).toBeCloseTo(calculateCost(db, model, usage), 8);
    }
  });
});
