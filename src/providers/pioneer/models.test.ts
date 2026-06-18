import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '../../db/index.js';
import { listModels } from '../../db/repos/models.js';
import { fetchAndSeedPioneerModels } from './models.js';

beforeEach(() => {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'pio-')), 't.db');
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchAndSeedPioneerModels', () => {
  it('dedups anthropic/pioneer/<id> duplicates against the canonical bare id', async () => {
    const db = openDb();
    const catalogue = {
      data: [
        { id: 'gpt-5.5', max_input_tokens: 1000 },
        { id: 'anthropic/pioneer/gpt-5.5', max_input_tokens: 1000 },
        { id: 'Qwen/Qwen3-32B', max_input_tokens: 2000 },
        { id: 'anthropic/pioneer/Qwen/Qwen3-32B', max_input_tokens: 2000 },
        { id: 'claude-opus-4-8', max_input_tokens: 3000 },
      ],
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(catalogue), { status: 200 })
    );

    const result = await fetchAndSeedPioneerModels(db, 'pio_sk_test');

    expect(result.ok).toBe(true);
    const pioneer = listModels(db, { includeDisabled: true }).filter(
      (m) => m.provider === 'pioneer'
    );
    expect(pioneer).toHaveLength(3);
    const names = pioneer.map((m) => m.name).sort();
    expect(names).toEqual([
      'pioneer/Qwen/Qwen3-32B',
      'pioneer/claude-opus-4-8',
      'pioneer/gpt-5.5',
    ]);
    const gpt = pioneer.find((m) => m.name === 'pioneer/gpt-5.5')!;
    expect(gpt.upstream_model).toBe('gpt-5.5');
  });

  it('seeds context_output from max_tokens', async () => {
    const db = openDb();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ id: 'gpt-5.5', max_input_tokens: 1000, max_tokens: 4096 }],
        }),
        { status: 200 }
      )
    );
    await fetchAndSeedPioneerModels(db, 'pio_sk_test');
    const m = listModels(db, { includeDisabled: true }).find((x) => x.name === 'pioneer/gpt-5.5')!;
    expect(m.context_window).toBe(1000);
    expect(m.context_output).toBe(4096);
  });
});
