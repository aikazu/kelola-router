import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import {
  AliasConflictError,
  deleteAlias,
  getAlias,
  listAliases,
  type ModelAlias,
  upsertAlias,
} from '../../db/repos/aliases.js';
import { clearAliasCache } from '../../providers/aliasCache.js';
import { ApiError, handleApiError } from './middleware.js';

export const aliasRoutes = new Hono();

const NAME_RE = /^[A-Za-z0-9._:-]{1,128}$/;
const LABEL_MAX = 200;

function rowToDto(r: ModelAlias) {
  return {
    aliasName: r.aliasName,
    upstreamModel: r.upstreamModel,
    label: r.label,
    source: r.source,
    createdAt: r.createdAt,
  };
}

function validateName(name: unknown): string {
  if (typeof name !== 'string' || !NAME_RE.test(name)) {
    throw new ApiError(
      'invalid_alias_name',
      'alias name must match /^[A-Za-z0-9._:-]{1,128}$/',
      400
    );
  }
  return name;
}

function validateTarget(db: Database.Database, target: unknown): string {
  if (typeof target !== 'string' || !target.trim()) {
    throw new ApiError('unknown_target_model', 'upstreamModel is required', 400);
  }
  const t = target.trim();
  // Check upstream_model exists in any model row
  const row = db.prepare(`SELECT 1 FROM models WHERE upstream_model = ? LIMIT 1`).get(t);
  if (!row) {
    throw new ApiError('unknown_target_model', `target model not found: ${t}`, 400);
  }
  return t;
}

function validateLabel(label: unknown): string | null {
  if (label === undefined || label === null) return null;
  if (typeof label !== 'string') {
    throw new ApiError('invalid_input', 'label must be a string', 400);
  }
  if (label.length > LABEL_MAX) {
    throw new ApiError('invalid_input', `label max ${LABEL_MAX} chars`, 400);
  }
  return label;
}

aliasRoutes.get('/', (c) => {
  try {
    const db = c.get('db') as Database.Database;
    return c.json({ aliases: listAliases(db).map(rowToDto) });
  } catch (e) {
    return handleApiError(e);
  }
});

aliasRoutes.post('/', async (c) => {
  try {
    const db = c.get('db') as Database.Database;
    const body = await c.req.json().catch(() => ({}));
    const aliasName = validateName(body.aliasName);
    const upstreamModel = validateTarget(db, body.upstreamModel);
    const label = validateLabel(body.label);
    let row;
    try {
      row = upsertAlias(db, { aliasName, upstreamModel, label, source: 'user' });
    } catch (e) {
      if (e instanceof AliasConflictError) {
        throw new ApiError('alias_conflicts_with_model', e.message, 409);
      }
      throw e;
    }
    clearAliasCache();
    return c.json(rowToDto(row), 201);
  } catch (e) {
    return handleApiError(e);
  }
});

aliasRoutes.put('/:name', async (c) => {
  try {
    const db = c.get('db') as Database.Database;
    const name = decodeURIComponent(c.req.param('name'));
    const existing = getAlias(db, name);
    if (!existing) throw new ApiError('alias_not_found', `alias not found: ${name}`, 404);
    const body = await c.req.json().catch(() => ({}));
    const upstreamModel =
      body.upstreamModel !== undefined
        ? validateTarget(db, body.upstreamModel)
        : existing.upstreamModel;
    const label = body.label !== undefined ? validateLabel(body.label) : existing.label;
    const row = upsertAlias(db, { aliasName: name, upstreamModel, label });
    clearAliasCache();
    return c.json(rowToDto(row));
  } catch (e) {
    return handleApiError(e);
  }
});

aliasRoutes.delete('/:name', (c) => {
  try {
    const db = c.get('db') as Database.Database;
    const name = decodeURIComponent(c.req.param('name'));
    const ok = deleteAlias(db, name);
    if (!ok) throw new ApiError('alias_not_found', `alias not found: ${name}`, 404);
    clearAliasCache();
    return new Response(null, { status: 204 });
  } catch (e) {
    return handleApiError(e);
  }
});
