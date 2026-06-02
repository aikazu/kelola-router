import { migration_001 } from "./001-initial.js";
import { migration_002 } from "./002-admin-key.js";
import { migration_003 } from "./003-drop-users.js";
import { migration_004 } from "./004-sessions.js";
import { migration_005 } from "./005-request-bodies.js";
import { migration_006 } from "./006-drop-thinking-fields.js";
import { migration_007 } from "./007-model-aliases.js";
import type Database from "better-sqlite3";

const ALL_MIGRATIONS: Array<{
  id: number;
  name: string;
  sql: string;
  condition?: (db: Database.Database) => boolean;
}> = [migration_001, migration_002, migration_003, migration_004, migration_005, migration_006, migration_007];

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
      } catch (e: any) {
        console.error(`[db] migration ${m.id} failed:`, e.message);
        console.error(`[db] path:`, process.env.ROUTER_DB_PATH);
        throw e;
      }
    }
  }
}