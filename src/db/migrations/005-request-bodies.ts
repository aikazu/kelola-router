/**
 * Capture full request/response bodies + headers + error in request_logs
 * to power the per-request drilldown in the dashboard SPA.
 */
export const migration_005 = {
  id: 5,
  name: 'request_bodies',
  sql: `
    ALTER TABLE request_logs ADD COLUMN request_body TEXT;
    ALTER TABLE request_logs ADD COLUMN response_body TEXT;
    ALTER TABLE request_logs ADD COLUMN request_headers TEXT;
    ALTER TABLE request_logs ADD COLUMN response_headers TEXT;
    ALTER TABLE request_logs ADD COLUMN error TEXT;
  `,
};
