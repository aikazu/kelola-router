import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import DatabaseWithCipher from 'better-sqlite3-multiple-ciphers';
import { getDbKey } from '../util/env.js';
import { autoSeedModels } from './autoSeed.js';
import { applyPragmas } from './migratePragmas.js';
import { migrate } from './migrations/index.js';

/**
 * SQLCipher key escape — SQLCipher's `PRAGMA key = '...'` parser treats a
 * doubled single-quote (`''`) inside a single-quoted string as an escaped
 * single-quote. Anything outside the ASCII alphanumeric / common-symbol
 * range stays byte-for-byte (it's just a passphrase, not SQL identifier).
 */
function escapeCipherKey(k: string): string {
  return k.replace(/'/g, "''");
}

/**
 * Open the SQLite file with optional SQLCipher encryption-at-rest.
 *
 * When `getDbKey()` returns a value, we swap to `better-sqlite3-multiple-ciphers`
 * and set `PRAGMA key` BEFORE any other PRAGMA or schema op (SQLCipher requires
 * the key to be the very first statement on a freshly opened handle).
 *
 * The cipher fork's `Database` is structurally compatible with the upstream
 * `better-sqlite3.Database` at runtime (same `prepare`/`exec`/`pragma`/`close`/
 * `transaction` API surface), but the two are distinct nominal types in
 * TypeScript — the cipher fork requires `key`/`rekey` methods. We cast at this
 * boundary so the rest of the codebase continues to see the vanilla
 * `better-sqlite3.Database` type and no other file needs to change.
 */
function openDatabase(path: string): Database.Database {
  const key = getDbKey();
  if (key) {
    const db = new DatabaseWithCipher(path);
    db.pragma(`key = '${escapeCipherKey(key)}'`);
    return db as unknown as Database.Database;
  }
  return new Database(path);
}

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
    const base =
      typeof import.meta.dirname === 'string'
        ? import.meta.dirname
        : dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(base, '../../package.json'), 'utf-8'));
    const version = pkg.version as string;
    const row = db.prepare("SELECT value FROM settings WHERE key = 'build'").get() as
      | { value: string }
      | undefined;
    const current = row ? JSON.parse(row.value) : {};
    if (current.version !== version) {
      current.version = version;
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('build', ?)").run(
        JSON.stringify(current)
      );
    }
  } catch {
    /* best-effort */
  }
}

export function openDb(): Database.Database {
  const dbPath = defaultDbPath();
  const dir = dirname(dbPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const db = openDatabase(dbPath);
  applyPragmas(db);

  migrate(db);
  autoSeedModels(db);
  syncBuildVersion(db);
  return db;
}
