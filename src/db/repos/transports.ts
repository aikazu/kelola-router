import type Database from 'better-sqlite3';

export type TransportType = 'proxy' | 'relay';
export type TransportKind = 'http' | 'socks5' | 'vercel' | 'cloudflare';

export interface Transport {
  id: string;
  label: string;
  type: TransportType;
  kind: TransportKind;
  url: string;
  enabled: boolean;
  created_at: string;
}

export type TransportCreate = Pick<Transport, 'id' | 'label' | 'type' | 'kind' | 'url'> & {
  enabled?: boolean;
};

interface TransportRow {
  id: string;
  label: string;
  type: TransportType;
  kind: TransportKind;
  url: string;
  enabled: number;
  created_at: string;
}

function rowToTransport(row: TransportRow): Transport {
  return { ...row, enabled: !!row.enabled };
}

export function createTransport(db: Database.Database, input: TransportCreate): Transport {
  db.prepare(`
    INSERT INTO transports (id, label, type, kind, url, enabled)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    input.id,
    input.label,
    input.type,
    input.kind,
    input.url,
    input.enabled === false ? 0 : 1
  );
  return getTransport(db, input.id)!;
}

export function getTransport(db: Database.Database, id: string): Transport | null {
  const row = db.prepare(`SELECT * FROM transports WHERE id = ?`).get(id) as TransportRow | undefined;
  return row ? rowToTransport(row) : null;
}

export function listTransports(db: Database.Database): Transport[] {
  const rows = db.prepare(`SELECT * FROM transports ORDER BY created_at, id`).all() as TransportRow[];
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
}

export function deleteTransport(db: Database.Database, id: string): void {
  db.prepare(`DELETE FROM transports WHERE id = ?`).run(id);
}
