// src/providers/qwencloud/models.test.ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../../db/index.js';
import { listModels } from '../../db/repos/models.js';
import { seedQwenCloudBuiltins } from './models.js';

beforeEach(() => {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'qwencloud-')), 't.db');
});
afterEach(() => {
  delete process.env.ROUTER_DB_PATH;
});

describe('seedQwenCloudBuiltins', () => {
  it('seeds the 3 confirmed qwencloud models with provider=qwencloud', () => {
    const db = openDb();
    const result = seedQwenCloudBuiltins(db);
    expect(result.total).toBe(3);
    expect(result.added).toBe(result.total);
    const models = listModels(db, { includeDisabled: true }).filter(
      (m) => m.provider === 'qwencloud'
    );
    const byName = new Map(models.map((m) => [m.name, m]));
    expect(byName.has('qwen3.8-max')).toBe(true);
    expect(byName.has('deepseek-v4-flash-0731')).toBe(true);
    expect(byName.has('deepseek-v4-pro-0813')).toBe(true);
  });

  it('stores bare model ids in name and upstream_model (no qctp/ prefix)', () => {
    const db = openDb();
    seedQwenCloudBuiltins(db);
    const models = listModels(db, { includeDisabled: true }).filter(
      (m) => m.provider === 'qwencloud'
    );
    expect(models.length).toBe(3);
    for (const m of models) {
      expect(m.name).not.toMatch(/^qctp\//);
      expect(m.upstream_model).not.toMatch(/^qctp\//);
    }
  });

  it('sets official per-1M pricing and a human display name', () => {
    const db = openDb();
    seedQwenCloudBuiltins(db);
    const models = listModels(db, { includeDisabled: true }).filter(
      (m) => m.provider === 'qwencloud'
    );
    const byName = new Map(models.map((m) => [m.name, m]));
    expect(byName.get('qwen3.8-max')?.display_name).toBe('Qwen 3.8 Max');
    expect(byName.get('deepseek-v4-flash-0731')?.display_name).toBe('DeepSeek V4 Flash (0731)');
    expect(byName.get('deepseek-v4-pro-0813')?.display_name).toBe('DeepSeek V4 Pro (0813)');
    // Official Aliyun token-plan list prices, USD per 1M tokens (user-confirmed).
    const expected: Record<string, [input: number, output: number]> = {
      'qwen3.8-max': [2.0, 6.0],
      'deepseek-v4-flash-0731': [0.44, 1.32],
      'deepseek-v4-pro-0813': [1.32, 3.96],
    };
    for (const m of models) {
      const [input, output] = expected[m.name];
      expect(m.pricing_input).toBe(input);
      expect(m.pricing_output).toBe(output);
      // Cache legs are not published for the token-plan → stay 0.
      expect(m.pricing_cache_read).toBe(0);
      expect(m.pricing_cache_write).toBe(0);
    }
  });

  it('is idempotent — re-running only upserts', () => {
    const db = openDb();
    const first = seedQwenCloudBuiltins(db);
    const second = seedQwenCloudBuiltins(db);
    expect(second.added).toBe(0);
    expect(second.total).toBe(first.total);
  });
});
