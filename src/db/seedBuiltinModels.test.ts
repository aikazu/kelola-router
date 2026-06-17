import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb } from './index.js';
import {
  seedCodebuddyBuiltins,
  seedKiroBuiltins,
  seedModelsForProvider,
} from './seedBuiltinModels.js';

beforeEach(() => {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'sbm-')), 't.db');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('seedKiroBuiltins', () => {
  it('inserts kiro builtins including variant rows', () => {
    const db = openDb();
    const result = seedKiroBuiltins(db);
    expect(result.total).toBeGreaterThan(0);
    expect(result.added).toBe(result.total);

    const rows = db.prepare('SELECT name FROM models ORDER BY name').all() as { name: string }[];
    const names = rows.map((r) => r.name);
    expect(names).toContain('claude-sonnet-4-6');
    expect(names).toContain('claude-sonnet-4-6-thinking');
    expect(names).toContain('auto');
  });

  it('is idempotent on second call', () => {
    const db = openDb();
    seedKiroBuiltins(db);
    const second = seedKiroBuiltins(db);
    expect(second.added).toBe(0);
    expect(second.total).toBeGreaterThan(0);
  });
});

describe('seedCodebuddyBuiltins', () => {
  it('inserts codebuddy builtins', () => {
    const db = openDb();
    const result = seedCodebuddyBuiltins(db);
    expect(result.total).toBeGreaterThan(0);
    expect(result.added).toBe(result.total);

    const rows = db.prepare('SELECT name, provider FROM models').all() as {
      name: string;
      provider: string;
    }[];
    const record = Object.fromEntries(rows.map((r) => [r.name, r]));
    expect(record['claude-opus-4.6']).toBeTruthy();
    expect(record['claude-opus-4.6']?.provider).toBe('codebuddy');
  });

  it('is idempotent on second call', () => {
    const db = openDb();
    seedCodebuddyBuiltins(db);
    const second = seedCodebuddyBuiltins(db);
    expect(second.added).toBe(0);
    expect(second.total).toBeGreaterThan(0);
  });
});

describe('seedModelsForProvider', () => {
  it('returns ok:false for minimax without api key', async () => {
    const db = openDb();
    const result = await seedModelsForProvider(db, 'minimax');
    expect(result.ok).toBe(false);
    expect(result.added).toBe(0);
  });

  it('returns ok:false for pioneer without api key', async () => {
    const db = openDb();
    const result = await seedModelsForProvider(db, 'pioneer');
    expect(result.ok).toBe(false);
    expect(result.added).toBe(0);
  });

  it('returns ok:true for kiro always', async () => {
    const db = openDb();
    const result = await seedModelsForProvider(db, 'kiro');
    expect(result.ok).toBe(true);
    expect(result.added).toBeGreaterThan(0);
  });

  it('returns ok:true for codebuddy always', async () => {
    const db = openDb();
    const result = await seedModelsForProvider(db, 'codebuddy');
    expect(result.ok).toBe(true);
    expect(result.added).toBeGreaterThan(0);
  });

  it('fetches and upserts minimax models with a mocked upstream', async () => {
    const db = openDb();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: 'MiniMax-M3' }, { id: 'MiniMax-X' }] }), {
        status: 200,
      })
    );

    const result = await seedModelsForProvider(db, 'minimax', { apiKey: 'mm_key' });
    expect(result.ok).toBe(true);
    expect(result.added).toBe(2);

    const names = (db.prepare('SELECT name FROM models').all() as { name: string }[]).map(
      (r) => r.name
    );
    expect(names).toContain('MiniMax-M3');
    expect(names).toContain('MiniMax-X');
  });

  it('fetches and upserts pioneer models with a mocked upstream', async () => {
    const db = openDb();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ data: [{ id: 'claude-opus-4-8', display_name: 'Claude Opus 4.8' }] }),
        { status: 200 }
      )
    );

    const result = await seedModelsForProvider(db, 'pioneer', { apiKey: 'pio_key' });
    expect(result.ok).toBe(true);
    expect(result.added).toBe(1);

    const rows = (db.prepare('SELECT name FROM models').all() as { name: string }[]).map(
      (r) => r.name
    );
    expect(rows).toContain('pioneer/claude-opus-4-8');
  });
});
