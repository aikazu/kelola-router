#!/usr/bin/env tsx
/**
 * Seed built-in TabiToken models. Idempotent: re-running upserts.
 *
 * TabiToken is a New-API-fork reseller gateway (OpenAI-compatible) that does
 * not publish a per-model price list, so pricing mirrors the underlying
 * provider's standard public list price. Sources:
 *   - Anthropic: docs.claude.com/en/docs/about-claude/models/all-models
 *   - OpenAI:    openai.com/api/pricing
 *   - DeepSeek:  api-docs.deepseek.com/quick_start/pricing
 *   - Google:    ai.google.dev/gemini-api/docs/pricing
 *
 * Models are stored namespaced under `tabi/` in both name and upstream_model
 * so they never collide on the globally-unique index with same-named Kiro /
 * CodeBuddy / Pioneer rows. Clients call `tabi/<id>`; the proxy strips the
 * prefix before forwarding to the upstream.
 *
 * Override per-row from the dashboard edit modal if your TabiToken tier bills
 * differently. Call `seedTabiBuiltins` from code rather than duplicating the
 * catalogue here — this script is a thin CLI wrapper for that one function.
 */
import { openDb } from '../src/db/index.js';
import { seedTabiBuiltins } from '../src/providers/tabi/models.js';
import { log } from '../src/util/log.js';

const db = openDb();
const result = seedTabiBuiltins(db);
log.info({ added: result.added, total: result.total }, 'tabi models seeded');
console.log(`Seeded ${result.total} TabiToken models (${result.added} new).`);
