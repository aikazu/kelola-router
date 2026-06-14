import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync } from 'node:fs';
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
 * Plain-SQLite header magic — the first 16 bytes of any unencrypted SQLite file.
 * Encrypted files have random-looking bytes here (ground-truth encryption signal,
 * per Task 10 learnings: `cipher_version` pragma is NOT reliable).
 */
const SQLITE_MAGIC = 'SQLite format 3\0';

/**
 * Detect whether the file at `path` is an UNENCRYPTED SQLite database by reading
 * the 16-byte header. Returns `false` if the file does not exist (fresh-deploy
 * case — `openDatabase()` will create it encrypted when a key is set) or if the
 * header is non-magic (already encrypted).
 *
 * Synchronous on purpose: we're at boot, before any DB handle exists.
 */
function isPlaintextSqlite(path: string): boolean {
  if (!existsSync(path)) return false;
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(16);
    readSync(fd, buf, 0, 16, 0);
    return buf.toString('latin1') === SQLITE_MAGIC;
  } finally {
    closeSync(fd);
  }
}

/**
 * Open the SQLite file with optional SQLCipher encryption-at-rest.
 *
 * When `getDbKey()` returns a value, we swap to `better-sqlite3-multiple-ciphers`
 * and set `PRAGMA key` BEFORE any other PRAGMA or schema op (SQLCipher requires
 * the key to be the very first statement on a freshly opened handle).
 *
 * Fresh-deploy-only policy (v0.15): if `ROUTER_DB_KEY` is set but the existing
 * DB file is plaintext (e.g. user upgraded from a pre-encryption version without
 * re-encrypting), we REFUSE to start with a clear error message instead of
 * silently corrupting the file or auto-migrating. No `--rekey` in this scope.
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
    if (isPlaintextSqlite(path)) {
      throw new Error(
        `Database file at ${path} is unencrypted but ROUTER_DB_KEY is set. ` +
          'Either remove ROUTER_DB_KEY (downgrade to plaintext) or delete the DB file and re-deploy fresh. ' +
          'Automatic migration is intentionally not supported. See README "Security" section.'
      );
    }
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
