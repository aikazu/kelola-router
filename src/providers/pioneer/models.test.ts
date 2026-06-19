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
    expect(names).toEqual(['pioneer/Qwen/Qwen3-32B', 'pioneer/claude-opus-4-8', 'pioneer/gpt-5.5']);
    const gpt = pioneer.find((m) => m.name === 'pioneer/gpt-5.5')!;
    // upstream_model is stored namespaced under `pioneer/` so it cannot collide
    // on the globally-unique `models.upstream_model` index with Kiro / CodeBuddy
    // rows that own the bare id (e.g. `claude-opus-4-8`). The proxy strips a
    // single leading `pioneer/` before forwarding to `/v1/chat/completions`.
    expect(gpt.upstream_model).toBe('pioneer/gpt-5.5');
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

  it('does not abort the batch when one row collides on upstream_model', async () => {
    const db = openDb();
    // Pre-seed a Kiro-style row that already owns the bare `claude-opus-4-8`
    // upstream_model — mirroring what migration 008 / 009 left behind when Kiro
    // claimed the id before Pioneer was added. Without the `pioneer/` prefix
    // on `upstream_model`, Pioneer's INSERT for `claude-opus-4-8` would hit the
    // globally-unique index and throw — previously aborting the whole batch
    // and surfacing a 500 to the dashboard Add-Key call.
    db.prepare(
      `INSERT INTO models (name, upstream_model, family, source, provider) VALUES (?, ?, ?, ?, ?)`
    ).run('claude-opus-4-8', 'claude-opus-4-8', 'kiro', 'builtin', 'kiro');

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            { id: 'gpt-5.5', max_input_tokens: 1000 },
            { id: 'claude-opus-4-8', max_input_tokens: 2000 },
            { id: 'claude-haiku-4-5', max_input_tokens: 3000 },
          ],
        }),
        { status: 200 }
      )
    );

    const result = await fetchAndSeedPioneerModels(db, 'pio_sk_test');

    expect(result.ok).toBe(true);
    // All three upstream ids should land as Pioneer rows. The old behaviour
    // would have crashed on `claude-opus-4-8` and produced 0 rows.
    const pioneer = listModels(db, { includeDisabled: true }).filter(
      (m) => m.provider === 'pioneer'
    );
    expect(pioneer.map((m) => m.name).sort()).toEqual([
      'pioneer/claude-haiku-4-5',
      'pioneer/claude-opus-4-8',
      'pioneer/gpt-5.5',
    ]);
    // Kiro's row must remain intact — Pioneer must not overwrite it.
    const kiro = listModels(db, { includeDisabled: true }).find(
      (m) => m.name === 'claude-opus-4-8'
    );
    expect(kiro?.provider).toBe('kiro');
  });
});
