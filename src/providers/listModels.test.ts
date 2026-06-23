import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '../db/index.js';
import { listModels } from '../db/repos/models.js';
import { fetchModels } from './listModels.js';

beforeEach(() => {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'lm-')), 't.db');
});

describe('fetchModels', () => {
  it('hits upstream /v1/models and upserts rows', async () => {
    const db = openDb();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ id: 'MiniMax-M3' }, { id: 'MiniMax-newmodel' }, { id: 'MiniMax-another' }],
        }),
        { status: 200 }
      )
    );

    const result = await fetchModels(db, 'mm_test');
    expect(result.ok).toBe(true);
    expect(result.added).toBe(3);

    const all = listModels(db, { includeDisabled: true });
    const names = all.map((m) => m.name);
    expect(names).toContain('MiniMax-newmodel');
    expect(names).toContain('MiniMax-another');
    expect(names).toContain('MiniMax-M3');
  });

  it('updates source on existing models', async () => {
    const db = openDb();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: 'MiniMax-M3' }] }), { status: 200 })
    );
    const result = await fetchModels(db, 'mm_test');
    expect(result.ok).toBe(true);
    expect(result.added).toBe(1);
    const m = listModels(db, { includeDisabled: true }).find((x) => x.name === 'MiniMax-M3')!;
    expect(m.source).toBe('fetched');
  });

  it('fills pricing fields for known MiniMax models from the static table', async () => {
    const db = openDb();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: 'MiniMax-M3' }, { id: 'MiniMax-M2.7' }] }), {
        status: 200,
      })
    );
    const result = await fetchModels(db, 'mm_test');
    expect(result.ok).toBe(true);

    const m3 = listModels(db, { includeDisabled: true }).find((x) => x.name === 'MiniMax-M3')!;
    // M3 ≤512k tier: permanent 50% discount → effective $0.30 / $1.20 / $0.06.
    expect(m3.pricing_input).toBe(0.3);
    expect(m3.pricing_output).toBe(1.2);
    expect(m3.pricing_cache_read).toBe(0.06);
    expect(m3.pricing_cache_write).toBeNull();
    expect(m3.context_window).toBe(1_000_000);
    // Tiered pricing JSON populates the >512k high tier (2x base).
    expect(m3.pricing_tiers).toContain('"high"');
    expect(m3.pricing_tiers).toContain('1.20');

    const m27 = listModels(db, { includeDisabled: true }).find((x) => x.name === 'MiniMax-M2.7')!;
    expect(m27.pricing_input).toBe(0.3);
    expect(m27.pricing_output).toBe(1.2);
    expect(m27.pricing_cache_read).toBe(0.06);
    expect(m27.pricing_cache_write).toBe(0.375);
    expect(m27.pricing_tiers).toBeNull();
  });

  it('leaves pricing null for unknown MiniMax model ids', async () => {
    const db = openDb();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: 'MiniMax-newmodel' }] }), { status: 200 })
    );
    const result = await fetchModels(db, 'mm_test');
    expect(result.ok).toBe(true);
    const m = listModels(db, { includeDisabled: true }).find((x) => x.name === 'MiniMax-newmodel')!;
    expect(m.pricing_input).toBeNull();
    expect(m.pricing_tiers).toBeNull();
  });

  it('returns structured error on non-2xx', async () => {
    const db = openDb();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('err', { status: 500 }));
    const result = await fetchModels(db, 'mm_test');
    expect(result.ok).toBe(false);
    expect(result.status).toBe(500);
    expect(result.error).toMatch(/upstream returned 500/);
  });

  it('returns friendly message when 404', async () => {
    const db = openDb();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('not found', { status: 404 }));
    const result = await fetchModels(db, 'mm_test');
    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
    expect(result.error).toMatch(/does not expose|not.*found/i);
  });
});
