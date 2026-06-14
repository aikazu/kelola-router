import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import {
  createCombo,
  deleteCombo,
  getComboById,
  listCombos,
  updateCombo,
} from '../../db/repos/combos.js';
import { parseModelPrefix } from '../../providers/modelPrefix.js';
import { ApiError, handleApiError } from './middleware.js';

export const comboRoutes = new Hono();

const NAME_RE = /^[A-Za-z0-9._:-]{1,128}$/;

function validateName(name: unknown): string {
  if (typeof name !== 'string' || !NAME_RE.test(name)) {
    throw new ApiError(
      'invalid_combo_name',
      'combo name must match /^[A-Za-z0-9._:-]{1,128}$/',
      400
    );
  }
  return name;
}

function validateModels(models: unknown): string[] {
  if (!Array.isArray(models) || models.length === 0) {
    throw new ApiError('invalid_models', 'models must be a non-empty array of strings', 400);
  }
  for (const m of models) {
    if (typeof m !== 'string' || !m.trim()) {
      throw new ApiError('invalid_models', 'each model must be a non-empty string', 400);
    }
    // Combo members are resolved per-member through the provider pipeline, so
    // each must carry an explicit provider prefix (mm/, kr/, cb/). A bare or
    // unknown-prefix member would silently skip in the fallback chain.
    let prefixed: boolean;
    try {
      prefixed = parseModelPrefix(m).prefixed;
    } catch {
      throw new ApiError(
        'invalid_models',
        `combo member '${m}' has an unknown provider prefix; use mm/, kr/, or cb/`,
        400
      );
    }
    if (!prefixed) {
      throw new ApiError(
        'invalid_models',
        `combo member '${m}' must be prefixed with a provider (mm/, kr/, or cb/)`,
        400
      );
    }
  }
  return models as string[];
}

comboRoutes.get('/', (c) => {
  try {
    const db = c.get('db') as Database.Database;
    return c.json({ combos: listCombos(db) });
  } catch (e) {
    return handleApiError(e);
  }
});

comboRoutes.post('/', async (c) => {
  try {
    const db = c.get('db') as Database.Database;
    const body = await c.req.json().catch(() => ({}));
    const name = validateName(body.name);
    const models = validateModels(body.models);
    const combo = createCombo(db, name, models);
    return c.json(combo, 201);
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('alias_conflict:')) {
      return handleApiError(
        new ApiError('alias_conflict', e.message.replace('alias_conflict: ', ''), 409)
      );
    }
    if (e instanceof Error && e.message.includes('UNIQUE constraint')) {
      return handleApiError(
        new ApiError('combo_name_exists', 'a combo with that name already exists', 409)
      );
    }
    return handleApiError(e);
  }
});

comboRoutes.put('/:id', async (c) => {
  try {
    const db = c.get('db') as Database.Database;
    const id = c.req.param('id');
    const existing = getComboById(db, id);
    if (!existing) throw new ApiError('combo_not_found', `combo not found: ${id}`, 404);
    const body = await c.req.json().catch(() => ({}));
    const updates: { name?: string; models?: string[] } = {};
    if (body.name !== undefined) updates.name = validateName(body.name);
    if (body.models !== undefined) updates.models = validateModels(body.models);
    const combo = updateCombo(db, id, updates);
    return c.json(combo);
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('alias_conflict:')) {
      return handleApiError(
        new ApiError('alias_conflict', e.message.replace('alias_conflict: ', ''), 409)
      );
    }
    if (e instanceof Error && e.message.includes('UNIQUE constraint')) {
      return handleApiError(
        new ApiError('combo_name_exists', 'a combo with that name already exists', 409)
      );
    }
    if (e instanceof Error && e.message.startsWith('combo not found:')) {
      return handleApiError(new ApiError('combo_not_found', e.message, 404));
    }
    return handleApiError(e);
  }
});

comboRoutes.delete('/:id', (c) => {
  try {
    const db = c.get('db') as Database.Database;
    const id = c.req.param('id');
    const ok = deleteCombo(db, id);
    if (!ok) throw new ApiError('combo_not_found', `combo not found: ${id}`, 404);
    return new Response(null, { status: 204 });
  } catch (e) {
    return handleApiError(e);
  }
});
