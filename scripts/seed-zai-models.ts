#!/usr/bin/env tsx
/**
 * Seed built-in Z.AI models. Idempotent: re-running upserts.
 *
 * Model names are stored bare (no `zai/` prefix); clients route via the
 * prefix which the proxy strips before calling upstream. Pricing is zero
 * (z.ai is a flat-rate subscription — see docs/zai/auth.md).
 */
import { openDb } from '../src/db/index.js';
import { seedZaiBuiltins } from '../src/db/seed-builtin-models.js';
import { log } from '../src/util/log.js';

const db = openDb();
const result = seedZaiBuiltins(db);
log.info({ ...result }, 'zai models seeded');
console.log(`Seeded ${result.total} Z.AI models (${result.added} new). Run again to upsert.`);
