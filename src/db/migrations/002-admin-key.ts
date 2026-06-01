export const migration_002 = {
  id: 2,
  name: "admin_key",
  sql: `
    ALTER TABLE users ADD COLUMN admin_key TEXT;
    CREATE UNIQUE INDEX idx_users_admin_key ON users(admin_key) WHERE admin_key IS NOT NULL;
  `,
};