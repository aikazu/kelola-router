import type Database from 'better-sqlite3';
import { getModel } from './models.js';

export interface ModelAlias {
  aliasName: string;
  upstreamModel: string;
  label: string | null;
  source: string;
  createdAt: string;
}

export interface UpsertAliasArgs {
  aliasName: string;
  upstreamModel: string;
  label?: string | null;
  source?: string;
}

function rowToAlias(r: Record<string, unknown>): ModelAlias {
  return {
    aliasName: r.alias_name as string,
    upstreamModel: r.upstream_model as string,
    label: (r.label as string | null) ?? null,
    source: r.source as string,
    createdAt: r.created_at as string,
  };
}

export function listAliases(db: Database.Database): ModelAlias[] {
  const rows = db
    .prepare(`SELECT * FROM model_aliases ORDER BY created_at, alias_name`)
    .all() as Record<string, unknown>[];
  return rows.map(rowToAlias);
}

export function getAlias(db: Database.Database, name: string): ModelAlias | null {
  const row = db.prepare(`SELECT * FROM model_aliases WHERE alias_name = ?`).get(name) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToAlias(row) : null;
}

export function isAliasShadowing(db: Database.Database, aliasName: string): boolean {
  return getModel(db, aliasName) !== null;
}

export function upsertAlias(db: Database.Database, args: UpsertAliasArgs): ModelAlias {
  const name = args.aliasName;
  const existing = getAlias(db, name);
  if (existing) {
    db.prepare(`
      UPDATE model_aliases
         SET upstream_model = ?, label = ?
       WHERE alias_name = ?
    `).run(args.upstreamModel, args.label ?? null, name);
  } else {
    db.prepare(`
      INSERT INTO model_aliases (alias_name, upstream_model, label, source)
      VALUES (?, ?, ?, ?)
    `).run(name, args.upstreamModel, args.label ?? null, args.source ?? 'user');
  }
  const row = getAlias(db, name);
  if (!row) throw new Error('upsertAlias: row missing post-write');
  return row;
}

export function deleteAlias(db: Database.Database, name: string): boolean {
  const r = db.prepare(`DELETE FROM model_aliases WHERE alias_name = ?`).run(name);
  return r.changes > 0;
}

export function listAliasesForTargets(
  db: Database.Database,
  upstreamNames: string[]
): Record<string, ModelAlias[]> {
  const out: Record<string, ModelAlias[]> = {};
  if (upstreamNames.length === 0) return out;
  const placeholders = upstreamNames.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT * FROM model_aliases WHERE upstream_model IN (${placeholders}) ORDER BY alias_name`
    )
    .all(...upstreamNames) as Record<string, unknown>[];
  for (const r of rows) {
    const a = rowToAlias(r);
    (out[a.upstreamModel] ??= []).push(a);
  }
  return out;
}
