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
  it('seeds the expected number of models', () => {
    const db = openDb();
    const result = seedTabiBuiltins(db);
    expect(result.total).toBeGreaterThan(5);
    expect(result.added).toBe(result.total);
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
