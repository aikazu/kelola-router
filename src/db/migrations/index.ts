import type Database from 'better-sqlite3';
import { migration_001 } from './001-initial.js';

const ALL_MIGRATIONS: Array<{ id: number; name: string; sql: string }> = [migration_001];

export function migrate(db: Database.Database): void {
  const current = Number(db.pragma('user_version', { simple: true }));
  for (const m of ALL_MIGRATIONS) {
    if (m.id <= current) continue;
    try {
      db.exec(m.sql);
      db.pragma(`user_version = ${m.id}`);
      // TODO(kocomon): migrate to pino once log is initialized at db layer — 2026-06-14
      console.log(`[db] applied migration ${m.id}: ${m.name}`);
    } catch (e: unknown) {
      // TODO(kocomon): migrate to pino once log is initialized at db layer — 2026-06-14
      console.error(`[db] migration ${m.id} failed:`, (e as Error).message);
      // TODO(kocomon): migrate to pino once log is initialized at db layer — 2026-06-14
      console.error('[db] path:', process.env.ROUTER_DB_PATH);
      throw e;
    }
  }
}
