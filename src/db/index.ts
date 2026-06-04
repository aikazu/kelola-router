import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { migrate } from './migrations/index.js';

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
  return db;
}
