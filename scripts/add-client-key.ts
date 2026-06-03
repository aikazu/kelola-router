#!/usr/bin/env tsx
import { openDb } from '../src/db/index.js';
import { createClientKey, genClientKey } from '../src/db/repos/client_keys.js';
import { log } from '../src/util/log.js';

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : null;
}

const label = arg('label');
if (!label) {
  console.error('Usage: add-client-key.ts --label <label>');
  process.exit(1);
}

const db = openDb();
const key = genClientKey();
const row = createClientKey(db, { label, key });
log.info({ id: row.id, label }, 'client key created');
console.log(`Client key created: ${row.label} (id ${row.id})`);
console.log(`  api_key: ${row.key}`);
console.log(`  Use as: Authorization: Bearer ${row.key}`);
