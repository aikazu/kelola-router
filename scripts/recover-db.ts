#!/usr/bin/env tsx
/**
 * One-off DB recovery: stop any active writer, checkpoint the WAL into the
 * main DB file, run integrity_check. Use after a "database disk malformed"
 * crash from concurrent writes between the docker container and a host tsx
 * script against the same ./data/router.db.
 *
 * Run with the container stopped (`docker compose stop router`).
 * Idempotent; does not modify data.
 */
import { existsSync } from 'node:fs';
import { openDb } from '../src/db/index.js';

const dbPath = process.env.ROUTER_DB_PATH ?? './data/router.db';
if (!existsSync(dbPath)) {
  console.error(`No DB at ${dbPath}`);
  process.exit(1);
}

const db = openDb();
try {
  // Force a WAL → main-file checkpoint so any pending frames land on disk.
  db.pragma('wal_checkpoint(TRUNCATE)');
  const integrity = db.pragma('integrity_check') as Array<{ integrity_check: string }>;
  const ok = integrity.every((r) => r.integrity_check === 'ok');
  console.log(JSON.stringify({ path: db.name, integrity, ok }, null, 2));
  process.exit(ok ? 0 : 1);
} catch (e) {
  console.error('Recovery failed:', e instanceof Error ? e.message : e);
  process.exit(1);
} finally {
  db.close();
}