import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { listEnabledAccountsByProvider } from '../../db/repos/accounts.js';
import { listAliasesForTargets } from '../../db/repos/aliases.js';
import { listCombos } from '../../db/repos/combos.js';
import {
  bulkToggleModels,
  deleteModel,
  disableModel,
  enableModel,
  getModel,
  listModels,
  updateModel,
  upsertModel,
} from '../../db/repos/models.js';
import { seedModelsForProvider } from '../../db/seedBuiltinModels.js';
import { fetchModels } from '../../providers/listModels.js';
import { fetchAndSeedPioneerModels } from '../../providers/pioneer/models.js';
import { ApiError, handleApiError } from './middleware.js';
import { testModelUpstream } from './modelHealth.js';

export const modelRoutes = new Hono();

modelRoutes.get('/', (c) => {
  try {
    const db = c.get('db') as Database.Database;
    const rows = listModels(db, { includeDisabled: true });
    const targets = [...new Set(rows.map((r) => r.upstream_model))];
    const aliasesByTarget = listAliasesForTargets(db, targets);

    // Combo membership counts: combos.models is a JSON array of member names.
    const comboCountByName = new Map<string, number>();
    for (const combo of listCombos(db)) {
      for (const memberName of combo.models) {
        comboCountByName.set(memberName, (comboCountByName.get(memberName) ?? 0) + 1);
      }
    }

    return c.json(
      rows.map((m) => ({
        name: m.name,
        displayName: m.display_name,
        family: m.family,
        contextWindow: m.context_window,
        contextOutput: m.context_output,
        provider: m.provider ?? 'minimax',
        pricingInput: m.pricing_input,
        pricingOutput: m.pricing_output,
        source: m.source,
        enabled: !!m.enabled,
        aliasCount: (aliasesByTarget[m.upstream_model] ?? []).length,
        comboCount: comboCountByName.get(m.name) ?? 0,
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
      family?: string;
    }>();
    if (!body.name || typeof body.name !== 'string' || !body.name.trim()) {
      return c.json({ error: 'invalid_body', message: 'Nama model wajib diisi' }, 400);
    }
    const ALLOWED_PROVIDERS = ['minimax', 'kiro', 'codebuddy', 'pioneer', 'notion', 'zai'] as const;
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
      family: body.family?.trim() || null,
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

modelRoutes.get('/:name/refs', (c) => {
  try {
    const db = c.get('db') as Database.Database;
    const name = decodeURIComponent(c.req.param('name'));
    const model = getModel(db, name);
    if (!model) throw new ApiError('not_found', 'Model tidak ditemukan', 404);

    const aliases = (
      listAliasesForTargets(db, [model.upstream_model])[model.upstream_model] ?? []
    ).map((a) => ({ aliasName: a.aliasName }));
    const combos = listCombos(db)
      .filter((combo) => combo.models.includes(name))
      .map((combo) => ({ id: combo.id, comboName: combo.name }));

    return c.json({ aliases, combos });
  } catch (e) {
    return handleApiError(e);
  }
});

modelRoutes.delete('/:name', (c) => {
  try {
    const db = c.get('db') as Database.Database;
    const name = decodeURIComponent(c.req.param('name'));
    const model = getModel(db, name);
    if (!model) throw new ApiError('not_found', 'Model tidak ditemukan', 404);

    const aliases = (
      listAliasesForTargets(db, [model.upstream_model])[model.upstream_model] ?? []
    ).map((a) => ({ aliasName: a.aliasName }));
    const combos = listCombos(db)
      .filter((combo) => combo.models.includes(name))
      .map((combo) => ({ id: combo.id, comboName: combo.name }));

    // Inline response (not ApiError) — refs payload must reach the client; ApiError
    // body shape is { error, message } with no room for structured refs.
    if (aliases.length > 0 || combos.length > 0) {
      return c.json({ error: 'has_refs', refs: { aliases, combos } }, 409);
    }
    deleteModel(db, name);
    return c.json({ ok: true });
  } catch (e) {
    return handleApiError(e);
  }
});

modelRoutes.patch('/:name', async (c) => {
  try {
    const db = c.get('db') as Database.Database;
    const name = decodeURIComponent(c.req.param('name'));
    const model = getModel(db, name);
    if (!model) throw new ApiError('not_found', 'Model tidak ditemukan', 404);

    const body = await c.req.json<Record<string, unknown>>();

    // Allow only the editable fields; reject unknown keys + wrong types.
    const allowed: Array<
      'displayName' | 'contextWindow' | 'contextOutput' | 'pricingInput' | 'pricingOutput'
    > = ['displayName', 'contextWindow', 'contextOutput', 'pricingInput', 'pricingOutput'];
    const patch: Record<string, string | number | null> = {};
    for (const key of Object.keys(body)) {
      if (!allowed.includes(key as (typeof allowed)[number])) {
        throw new ApiError('invalid_input', `unknown field: ${key}`, 400);
      }
      const v = body[key];
      if (v === null) {
        patch[key] = null;
        continue;
      }
      if (key === 'displayName') {
        if (typeof v !== 'string') {
          throw new ApiError('invalid_input', 'displayName must be a string', 400);
        }
        patch[key] = v;
      } else {
        if (typeof v !== 'number' || !Number.isFinite(v)) {
          throw new ApiError('invalid_input', `${key} must be a number`, 400);
        }
        patch[key] = v;
      }
    }

    if (Object.keys(patch).length === 0) {
      throw new ApiError('invalid_input', 'no editable fields provided', 400);
    }

    updateModel(db, name, {
      displayName: patch.displayName as string | null | undefined,
      contextWindow: patch.contextWindow as number | null | undefined,
      contextOutput: patch.contextOutput as number | null | undefined,
      pricingInput: patch.pricingInput as number | null | undefined,
      pricingOutput: patch.pricingOutput as number | null | undefined,
    });
    return c.json({ ok: true });
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

const FETCH_PROVIDERS = ['minimax', 'pioneer', 'kiro', 'codebuddy', 'zai', 'notion'] as const;
type FetchProvider = (typeof FETCH_PROVIDERS)[number];

modelRoutes.post('/fetch/:provider', async (c) => {
  try {
    const db = c.get('db') as Database.Database;
    const provider = c.req.param('provider');
    if (!(FETCH_PROVIDERS as readonly string[]).includes(provider)) {
      return c.json(
        { error: 'no_upstream_list', message: `${provider} has no model-list endpoint` },
        404
      );
    }
    const p = provider as FetchProvider;

    // Builtin providers: re-run the static seed (no upstream call, no account
    // needed). Kiro/CodeBuddy/Z.AI/Notion all use `seedXxxBuiltins` which is
    // idempotent and only touches rows for that provider.
    if (p === 'kiro' || p === 'codebuddy' || p === 'zai' || p === 'notion') {
      const result = await seedModelsForProvider(db, p);
      if (!result.ok) {
        return c.json({ error: 'reseed_failed', message: result.error ?? 'seed error' }, 500);
      }
      const total = listModels(db, { includeDisabled: true, provider: p }).length;
      return c.json({ added: result.added, total });
    }

    // Upstream-fetch providers: require at least one active account.
    const accounts = listEnabledAccountsByProvider(db, p);
    const first = accounts[0];
    if (!first) {
      return c.json({ error: 'no_account', message: `no active ${p} account to fetch from` }, 400);
    }

    if (p === 'minimax') {
      const result = await fetchModels(db, first.api_key);
      if (!result.ok) {
        return c.json({ error: 'fetch_failed', message: result.error ?? 'upstream error' }, 502);
      }
      const total = listModels(db, { includeDisabled: true, provider: 'minimax' }).length;
      return c.json({ added: result.added ?? 0, total });
    }
    // pioneer: post-seed total row count for pioneer rows (incl. disabled).
    const result = await fetchAndSeedPioneerModels(db, first.api_key, first.base_url);
    if (!result.ok) {
      return c.json({ error: 'fetch_failed', message: result.error ?? 'upstream error' }, 502);
    }
    const total = listModels(db, { includeDisabled: true, provider: 'pioneer' }).length;
    return c.json({ added: result.added ?? 0, total });
  } catch (e) {
    return handleApiError(e);
  }
});
