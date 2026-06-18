/**
 * Migration 008 — dedup Pioneer model rows.
 *
 * Background: the `fetchAndSeedPioneerModels` seeder stored rows as
 * `pioneer/<m.id>`, but some entries from the upstream `/v1/models` catalogue
 * leaked an old id format `anthropic/pioneer/<real_id>`, and the seeder
 * prepended `pioneer/` again, producing triple-nested rows like
 * `pioneer/anthropic/pioneer/Qwen/...` — 70+ such rows leaked into the DB.
 *
 * Algorithm: for every Pioneer row, the canonical bare id is the substring
 * after the LAST `pioneer/` in the name. Rows that share the same bare id are
 * collapsed; the survivor is the row with the shortest name (i.e. the
 * pre-existing correctly-namespaced one wins, not the leaked garbage).
 *
 * Safe on a clean DB — re-running is a no-op once dedup is complete.
 * `user_version = 8`.
 */
export const migration_008 = {
  id: 8,
  name: 'pioneer-dedup',
  sql: [
    "CREATE TEMP TABLE _pioneer_dedup_old (",
    "  id INTEGER PRIMARY KEY,",
    "  name TEXT NOT NULL,",
    "  bare_id TEXT NOT NULL",
    ");",
    "",
    "INSERT INTO _pioneer_dedup_old (id, name, bare_id)",
    "  SELECT",
    "    id,",
    "    name,",
    "    CASE",
    "      WHEN instr(name, 'pioneer/') = 0 THEN name",
    "      ELSE substr(name, ",
    "        (SELECT max(p) FROM (",
    "          WITH RECURSIVE cnt(n) AS (",
    "            SELECT 1 UNION ALL SELECT n + 1 FROM cnt WHERE n < length(name) - 7",
    "          )",
    "          SELECT n + 8 AS p FROM cnt",
    "           WHERE substr(name, n, 8) = 'pioneer/'",
    "        ))",
    "      )",
    "    END",
    "  FROM models",
    "  WHERE provider = 'pioneer' OR name LIKE 'pioneer/%';",
    "",
    "-- Pick one row per bare_id: shortest name wins, ties broken by lowest id.",
    "CREATE TEMP TABLE _pioneer_kept AS",
    "  SELECT bare_id, id AS kept_id FROM (",
    "    SELECT o.*,",
    "      row_number() OVER (PARTITION BY bare_id ORDER BY length(name) ASC, id ASC) AS rn",
    "    FROM _pioneer_dedup_old o",
    "  ) WHERE rn = 1;",
    "",
    "-- Delete non-survivors.",
    "DELETE FROM models",
    " WHERE id IN (SELECT id FROM _pioneer_dedup_old)",
    "   AND id NOT IN (SELECT kept_id FROM _pioneer_kept);",
    "",
    "-- Rename and fix upstream_model on survivors.",
    "UPDATE models",
    "   SET name          = 'pioneer/' || (SELECT bare_id FROM _pioneer_kept WHERE kept_id = models.id),",
    "       upstream_model = (SELECT bare_id FROM _pioneer_kept WHERE kept_id = models.id)",
    " WHERE id IN (SELECT kept_id FROM _pioneer_kept);",
    "",
    "DROP TABLE _pioneer_dedup_old;",
    "DROP TABLE _pioneer_kept;",
  ].join("\n"),
};
