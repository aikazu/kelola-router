import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { migrate } from './migrations/index.js';
import { autoSeedModels } from './autoSeed.js';

function defaultDbPath(): string {
  if (process.env.ROUTER_DB_PATH) return process.env.ROUTER_DB_PATH;
  const home = homedir();
  if (process.platform === 'darwin') {
    return join(home, 'Library/Application Support/kelola-router/router.db');
  }
  if (process.platform === 'win32') {
    return join(process.env.APPDATA || home, 'kelola-router/router.db');
  }
  return join(process.env.XDG_DATA_HOME || join(home, '.local/share'), 'kelola-router/router.db');
}

/** Keep `settings.build.version` in sync with package.json on every startup. */
function syncBuildVersion(db: Database.Database): void {
  try {
    const base = typeof import.meta.dirname === 'string' ? import.meta.dirname : dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(base, '../../package.json'), 'utf-8'));
    const version = pkg.version as string;
    const row = db.prepare("SELECT value FROM settings WHERE key = 'build'").get() as { value: string } | undefined;
    const current = row ? JSON.parse(row.value) : {};
    if (current.version !== version) {
      current.version = version;
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('build', ?)").run(JSON.stringify(current));
    }
  } catch { /* best-effort */ }
}

export function openDb(): Database.Database {
  const dbPath = defaultDbPath();
  const dir = dirname(dbPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');

  migrate(db);
  autoSeedModels(db);
  syncBuildVersion(db);
  return db;
}
