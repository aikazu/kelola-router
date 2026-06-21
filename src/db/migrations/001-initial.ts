/**
 * The only migration. Builds the full final schema in one step on a fresh DB.
 * The SQL is split into three modules (schema / indexes / seed) to keep each
 * file readable; they are concatenated here and applied as a single migration.
 *
 * Fresh deploy only: no incremental ALTER migrations and no data dedup. Every
 * prior additive ALTER (provider columns, transports, req_id, combos,
 * audit_log, transport country, model context_output) and the standalone
 * CREATE TABLE migrations (transports, combos, audit_log) are folded into the
 * consolidated schema module. `user_version` ends at 1.
 */
import { INDEXES_SQL } from './indexes.sql.js';
import { SCHEMA_SQL } from './schema.sql.js';
import { SEED_SQL } from './seed.sql.js';

export const migration_001 = {
  id: 1,
  name: 'initial',
  sql: [SCHEMA_SQL, INDEXES_SQL, SEED_SQL].join('\n'),
};
