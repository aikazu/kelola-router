import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { listAliasesForTargets } from '../../db/repos/aliases.js';
import {
  bulkToggleModels,
  disableModel,
  enableModel,
  getModel,
  listModels,
  upsertModel,
} from '../../db/repos/models.js';
import { handleApiError } from './middleware.js';
import { testModelUpstream } from './modelHealth.js';

export const modelRoutes = new Hono();

modelRoutes.get('/', (c) => {
  try {
    const db = c.get('db') as Database.Database;
    const rows = listModels(db, { includeDisabled: true });
    const targets = [...new Set(rows.map((r) => r.upstream_model))];
    const aliasesByTarget = listAliasesForTargets(db, targets);
    return c.json(
      rows.map((m) => ({
        name: m.name,
        displayName: m.display_name,
        family: m.family,
        contextWindow: m.context_window,
        provider: m.provider ?? 'minimax',
        pricingInput: m.pricing_input,
        pricingOutput: m.pricing_output,
        source: m.source,
        enabled: !!m.enabled,
        aliasCount: (aliasesByTarget[m.upstream_model] ?? []).length,
      }))
    );
  } catch (e) {
    return handleApiError(e);
  }
});

modelRoutes.post('/', async (c) => {
  try {
    const db = c.get('db') as Database.Database;
    const body = await c.req.json<{
      name?: string;
      provider?: string;
      displayName?: string;
      contextWindow?: number;
      pricingInput?: number;
      pricingOutput?: number;
    }>();
    if (!body.name || typeof body.name !== 'string' || !body.name.trim()) {
      return c.json({ error: 'invalid_body', message: 'Nama model wajib diisi' }, 400);
    }
    const ALLOWED_PROVIDERS = ['minimax', 'kiro', 'codebuddy', 'pioneer'] as const;
    if (!body.provider || !(ALLOWED_PROVIDERS as readonly string[]).includes(body.provider)) {
      return c.json(
        {
          error: 'invalid_body',
          message: `Provider harus salah satu: ${ALLOWED_PROVIDERS.join(', ')}`,
        },
        400
      );
    }
    const name = body.name.trim();
    if (getModel(db, name)) {
      return c.json({ error: 'conflict', message: 'Model dengan nama itu sudah ada' }, 409);
    }
    upsertModel(db, {
      name,
      upstream_model: name,
      display_name: body.displayName?.trim() || null,
      context_window: typeof body.contextWindow === 'number' ? body.contextWindow : null,
      pricing_input: typeof body.pricingInput === 'number' ? body.pricingInput : null,
      pricing_output: typeof body.pricingOutput === 'number' ? body.pricingOutput : null,
      provider: body.provider as (typeof ALLOWED_PROVIDERS)[number],
      source: 'manual',
    });
    return c.json({ ok: true }, 201);
  } catch (e) {
    return handleApiError(e);
  }
});

modelRoutes.post('/:name/disable', (c) => {
  try {
    disableModel(c.get('db') as Database.Database, decodeURIComponent(c.req.param('name')));
    return new Response(null, { status: 204 });
  } catch (e) {
    return handleApiError(e);
  }
});

modelRoutes.post('/:name/enable', (c) => {
  try {
    enableModel(c.get('db') as Database.Database, decodeURIComponent(c.req.param('name')));
    return new Response(null, { status: 204 });
  } catch (e) {
    return handleApiError(e);
  }
});

modelRoutes.post('/:name/test', async (c) => {
  try {
    const db = c.get('db') as Database.Database;
    const model = getModel(db, decodeURIComponent(c.req.param('name')));
    if (!model) return c.json({ error: 'not_found', message: 'Model tidak ditemukan' }, 404);
    const result = await testModelUpstream(db, model);
    return c.json(result);
  } catch (e) {
    return handleApiError(e);
  }
});

modelRoutes.post('/bulk-toggle', async (c) => {
  try {
    const db = c.get('db') as Database.Database;
    const { names, enabled } = await c.req.json<{ names: string[]; enabled: boolean }>();
    if (!Array.isArray(names) || names.length === 0 || typeof enabled !== 'boolean') {
      return c.json(
        { error: 'invalid_body', message: 'names: string[], enabled: boolean required' },
        400
      );
    }
    const updated = bulkToggleModels(db, names, enabled);
    return c.json({ updated });
  } catch (e) {
    return handleApiError(e);
  }
});

modelRoutes.post('/fetch', (c) => {
  try {
    // Placeholder: actual upstream fetch is in src/server.ts. We just touch upsertModel to validate route.
    const db = c.get('db') as Database.Database;
    const before = listModels(db).length;
    return c.json({ added: 0, updated: 0, total: before });
  } catch (e) {
    return handleApiError(e);
  }
});
