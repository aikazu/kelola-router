#!/usr/bin/env tsx
/**
 * Seed built-in QwenCloud (Aliyun token-plan) models. Idempotent: re-running upserts.
 *
 * QwenCloud exposes a single Anthropic-Messages-compatible gateway that does
 * not publish a per-model list endpoint, so the catalogue is static. Pricing
 * is the official Aliyun token-plan list price in USD per 1M tokens; cache
 * legs are not published, so they stay 0. See `src/providers/qwencloud/models.ts`.
 *
 * Model ids are stored BARE (no `qctp/` prefix) in both name and
 * upstream_model so they never collide on the globally-unique index.
 * Clients call `qctp/<model>`; the proxy strips the prefix before forwarding.
 *
 * Call `seedQwenCloudBuiltins` from code rather than duplicating the
 * catalogue here — this script is a thin CLI wrapper for that one function.
 */
import { openDb } from '../src/db/index.js';
import { seedQwenCloudBuiltins } from '../src/db/seed-builtin-models.js';
import { log } from '../src/util/log.js';

const db = openDb();
const result = seedQwenCloudBuiltins(db);
log.info({ added: result.added, total: result.total }, 'qwencloud models seeded');
console.log(`Seeded ${result.total} QwenCloud models (${result.added} new).`);
