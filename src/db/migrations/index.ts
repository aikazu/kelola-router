import type Database from 'better-sqlite3';
import { migration_001 } from './001-initial.js';
import { migration_002 } from './002-kiro.js';
import { migration_003 } from './003-transports.js';
import { migration_004 } from './004-reqid.js';
import { migration_005 } from './005-combos.js';
import { migration_006 } from './006-transport-country.js';
import { migration_007 } from './007-audit-log.js';
import { migration_008 } from './008-pioneer-dedup.js';
import { migration_009 } from './009-pioneer-anthropic-dedup.js';

const ALL_MIGRATIONS: Array<{ id: number; name: string; sql: string }> = [
  migration_001,
  migration_002,
  migration_003,
  migration_004,
  migration_005,
  migration_006,
  migration_007,
  migration_008,
  migration_009,
];

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
