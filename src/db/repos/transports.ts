import type Database from 'better-sqlite3';
import { invalidateDispatcher } from '../../transport/dispatcherCache.js';
import { invalidateResolvedTransportCache } from '../../transport/resolvedCache.js';
import { invalidateSocks } from '../../transport/socksLoader.js';

export type TransportType = 'proxy' | 'relay';
export type TransportKind = 'http' | 'socks5' | 'vercel' | 'cloudflare';

export interface Transport {
  id: string;
  label: string;
  type: TransportType;
  kind: TransportKind;
  url: string;
  enabled: boolean;
  /** Geoip country code (e.g. 'SG'), null until probed or if undetermined. */
  country: string | null;
  created_at: string;
}

export type TransportCreate = Pick<Transport, 'id' | 'label' | 'type' | 'kind' | 'url'> & {
  enabled?: boolean;
  country?: string | null;
};

interface TransportRow {
  id: string;
  label: string;
  type: TransportType;
  kind: TransportKind;
  url: string;
  enabled: number;
  country: string | null;
  created_at: string;
}

function rowToTransport(row: TransportRow): Transport {
  return { ...row, enabled: !!row.enabled, country: row.country ?? null };
}

export function createTransport(db: Database.Database, input: TransportCreate): Transport {
  db.prepare(`
    INSERT INTO transports (id, label, type, kind, url, enabled, country)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.id,
    input.label,
    input.type,
    input.kind,
    input.url,
    input.enabled === false ? 0 : 1,
    input.country ?? null
  );
  invalidateResolvedTransportCache(db);
  return getTransport(db, input.id)!;
}

/** Persist the geoip country code for a transport (null clears it). */
export function setTransportCountry(
  db: Database.Database,
  id: string,
  country: string | null
): void {
  db.prepare(`UPDATE transports SET country = ? WHERE id = ?`).run(country, id);
}

export function getTransport(db: Database.Database, id: string): Transport | null {
  const row = db.prepare(`SELECT * FROM transports WHERE id = ?`).get(id) as
    | TransportRow
    | undefined;
  return row ? rowToTransport(row) : null;
}

export function listTransports(db: Database.Database): Transport[] {
  const rows = db
    .prepare(`SELECT * FROM transports ORDER BY created_at, id`)
    .all() as TransportRow[];
  return rows.map(rowToTransport);
}

export function updateTransport(
  db: Database.Database,
  id: string,
  patch: Partial<Pick<Transport, 'label' | 'kind' | 'url' | 'enabled'>>
): void {
  const keys = Object.keys(patch);
  if (keys.length === 0) return;
  const set = keys.map((k) => `${k} = ?`).join(', ');
  const values = keys.map((k) => {
    const v = (patch as Record<string, unknown>)[k];
    return k === 'enabled' ? (v ? 1 : 0) : v;
  });
  db.prepare(`UPDATE transports SET ${set} WHERE id = ?`).run(...values, id);
  // Invalidate the cached dispatcher when URL/kind changes or proxy gets
  // disabled, so the next request rebuilds the agent with the new config.
  if (patch.url || patch.kind || patch.enabled === false) {
    if (patch.url) {
      if (patch.kind === 'socks5') invalidateSocks(patch.url);
      else if (patch.kind) invalidateDispatcher(patch.url);
    }
  }
  invalidateResolvedTransportCache(db);
}

export function deleteTransport(db: Database.Database, id: string): void {
  const existing = getTransport(db, id);
  db.prepare(`DELETE FROM transports WHERE id = ?`).run(id);
  if (existing && existing.type === 'proxy') {
    if (existing.kind === 'socks5') invalidateSocks(existing.url);
    else invalidateDispatcher(existing.url);
  }
  invalidateResolvedTransportCache(db);
}

/**
 * Delete many transports by id in one transaction. Per-id proxy cache
 * invalidation is preserved (each removed proxy clears its dispatcher/socks
 * agent). Returns the number of rows that actually existed and were deleted;
 * unknown ids are silently ignored.
 */
export function deleteTransports(db: Database.Database, ids: string[]): number {
  const run = db.transaction((targets: string[]) => {
    let deleted = 0;
    const stmt = db.prepare(`DELETE FROM transports WHERE id = ?`);
    for (const id of targets) {
      const existing = getTransport(db, id);
      if (!existing) continue;
      stmt.run(id);
      deleted++;
      if (existing.type === 'proxy') {
        if (existing.kind === 'socks5') invalidateSocks(existing.url);
        else invalidateDispatcher(existing.url);
      }
    }
    return deleted;
  });
  const deleted = run(ids);
  if (deleted > 0) invalidateResolvedTransportCache(db);
  return deleted;
}
