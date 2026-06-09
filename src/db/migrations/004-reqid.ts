/**
 * Migration 004 — console correlation id.
 * Additive: a nullable req_id on request_logs lets a console flow line link to
 * its Request Detail row. Existing rows stay null.
 */
export const migration_004 = {
  id: 4,
  name: 'request-log-reqid',
  sql: `
    ALTER TABLE request_logs ADD COLUMN req_id TEXT;
  `,
};
