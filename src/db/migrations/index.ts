import { migration_001 } from "./001-initial.js";
import { migration_002 } from "./002-admin-key.js";
import type Database from "better-sqlite3";

const ALL_MIGRATIONS: Array<{
  id: number;
  name: string;
  sql: string;
  condition?: (db: Database.Database) => boolean;
}> = [migration_001, migration_002];

export function migrate(db: Database.Database): void {
  const current = Number(db.pragma("user_version", { simple: true }));
  for (const m of ALL_MIGRATIONS) {
    if (m.id > current) {
      // Skip if condition returns false
      if (m.condition && !m.condition(db)) {
        db.pragma(`user_version = ${m.id}`);
        console.log(`[db] skipped migration ${m.id}: ${m.name} (condition)`);
        continue;
      }
      try {
        db.exec(m.sql);
        db.pragma(`user_version = ${m.id}`);
        console.log(`[db] applied migration ${m.id}: ${m.name}`);
      } catch (e) {
        console.error(`[db] migration ${m.id} failed:`, e);
        throw e;
      }
    }
  }
}