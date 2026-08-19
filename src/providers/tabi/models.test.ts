// src/providers/tabi/models.test.ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../../db/index.js';
import { listModels } from '../../db/repos/models.js';
import { seedTabiBuiltins } from './models.js';

beforeEach(() => {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'tabi-')), 't.db');
});
afterEach(() => {
  delete process.env.ROUTER_DB_PATH;
});

describe('seedTabiBuiltins', () => {
  it('seeds the real TabiToken catalogue (4 models from /v1/models + /api/pricing)', () => {
    const db = openDb();
    const result = seedTabiBuiltins(db);
    expect(result.total).toBe(4);
    expect(result.added).toBe(result.total);
    const models = listModels(db, { includeDisabled: true }).filter((m) => m.provider === 'tabi');
    const byName = new Map(models.map((m) => [m.name, m]));
    expect(byName.has('tabi/claude-opus-5')).toBe(true);
    expect(byName.has('tabi/claude-opus-5-thinking')).toBe(true);
    expect(byName.has('tabi/claude-opus-4-8')).toBe(true);
    expect(byName.has('tabi/claude-opus-4-8-thinking')).toBe(true);
    // Prices are Anthropic official list prices (docs.anthropic.com, 2026-08-19):
    // $5 input / $25 output / $0.50 cache hit / $6.25 5m cache write per 1M.
    expect(byName.get('tabi/claude-opus-5')?.pricing_input).toBe(5);
    expect(byName.get('tabi/claude-opus-5')?.pricing_output).toBe(25);
    expect(byName.get('tabi/claude-opus-5')?.pricing_cache_read).toBe(0.5);
    expect(byName.get('tabi/claude-opus-5')?.pricing_cache_write).toBe(6.25);
    expect(byName.get('tabi/claude-opus-5-thinking')?.pricing_input).toBe(5);
    expect(byName.get('tabi/claude-opus-4-8')?.pricing_input).toBe(5);
    expect(byName.get('tabi/claude-opus-4-8-thinking')?.pricing_input).toBe(5);
  });

  it('is idempotent — re-running only upserts', () => {
    const db = openDb();
    const first = seedTabiBuiltins(db);
    const second = seedTabiBuiltins(db);
    expect(second.added).toBe(0);
    expect(second.total).toBe(first.total);
  });

  it('stores models with the tabi/ prefix in both name and upstream_model', () => {
    const db = openDb();
    seedTabiBuiltins(db);
    const models = listModels(db, { includeDisabled: true }).filter((m) => m.provider === 'tabi');
    expect(models.length).toBeGreaterThan(0);
    for (const m of models) {
      expect(m.name).toMatch(/^tabi\//);
      expect(m.upstream_model).toMatch(/^tabi\//);
    }
  });
});
