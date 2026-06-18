#!/usr/bin/env tsx
/**
 * Seed Notion models from src/providers/notion/manifest.json into the DB.
 *
 * Idempotent: re-running only upserts rows. Models are read from the TS
 * constants file (NOTION_MODEL_TABLE) so the manifest stays in sync with
 * the wire format constants.
 *
 * Usage:
 *   tsx scripts/seed-notion-models.ts
 */
import { openDb } from '../src/db/index.js';
import { listModels, upsertModel } from '../src/db/repos/models.js';
import { NOTION_MODEL_TABLE } from '../src/providers/notion/constants.js';

interface ModelRow {
  name: string;
  upstream_model: string;
  provider: string;
}

function main(): number {
  const db = openDb();
  try {
    const existing = new Map(
      listModels(db, { includeDisabled: true })
        .filter((m) => m.provider === 'notion')
        .map((m): [string, ModelRow] => [m.upstream_model, m as unknown as ModelRow])
    );

    let inserted = 0;
    let updated = 0;
    for (const m of NOTION_MODEL_TABLE) {
      const name = m.alias.replace(/^nt\//, '');
      const isExisting = existing.has(m.internalId);
      upsertModel(db, {
        name,
        upstream_model: m.internalId,
        display_name: `Notion ${m.displayName}`,
        family: m.family,
        context_window: null,
        pricing_input: 0,
        pricing_output: 0,
        pricing_cache_read: 0,
        pricing_cache_write: 0,
        source: 'builtin',
        provider: 'notion',
      });
      if (isExisting) updated++;
      else inserted++;
    }
    console.log(
      `Notion models: ${inserted} inserted, ${updated} updated, ${NOTION_MODEL_TABLE.length} total`
    );
    return 0;
  } finally {
    db.close();
  }
}

try {
  const code = main();
  process.exit(code);
} catch (e: unknown) {
  console.error('Fatal:', e);
  process.exit(99);
}
