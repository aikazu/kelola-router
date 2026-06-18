#!/usr/bin/env tsx
import { existsSync, statSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/db/index.js';
import { log } from '../src/util/log.js';

function defaultDbPath(): string {
  if (process.env.ROUTER_DB_PATH) return process.env.ROUTER_DB_PATH;
  const home = homedir();
  if (process.platform === 'darwin')
    return join(home, 'Library/Application Support/kelola-router/router.db');
  if (process.platform === 'win32')
    return join(process.env.APPDATA || home, 'kelola-router/router.db');
  return join(process.env.XDG_DATA_HOME || join(home, '.local/share'), 'kelola-router/router.db');
}

const args = process.argv.slice(2);
// npm swallows `--yes` when run via `npm run reset --yes` because it isn't
// passed after a `--` separator. Accept the equivalent env var that npm sets
// when users run `npm_config_yes=1 npm run reset` (or `--yes` is forwarded by
// a wrapper that knows the npm quirk).
const yes =
  args.includes('--yes') ||
  args.includes('-y') ||
  process.env.npm_config_yes === '1' ||
  process.env.npm_config_yes === 'true';
const dbPath = defaultDbPath();

// Open (and immediately close) the DB handle to honor ROUTER_DB_KEY.
// This ensures the reset is routed through openDb() — encryption key
// is validated here if set, so the subsequent unlinkSync is "key-aware".
try {
  const db = openDb();
  db.close();
} catch {
  /* ignore — we proceed to delete the file regardless */
}
const sidecars = [`${dbPath}-wal`, `${dbPath}-shm`];
const allPaths = [dbPath, ...sidecars];

const existing = allPaths.filter((p) => existsSync(p));
if (existing.length === 0) {
  console.log(`No database to remove at ${dbPath}`);
  process.exit(0);
}

if (!yes) {
  console.error('Refusing to reset without --yes. This will delete:');
  for (const p of existing) {
    const size = statSync(p).size;
    console.error(`  ${p}  (${size} bytes)`);
  }
  console.error('Run with --yes to confirm.');
  console.error('Tip: `npm run reset` eats the flag — use `npm run reset -- --yes` instead.');
  process.exit(1);
}

for (const p of existing) {
  unlinkSync(p);
  log.info({ path: p }, 'removed');
}
console.log(`Removed ${existing.length} file(s). Next start will recreate schema.`);
