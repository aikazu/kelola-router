/**
 * Migration 009 — collapse Pioneer `anthropic/pioneer/<x>` duplicate rows.
 *
 * Background: the upstream `/v1/models` catalogue returns each model id in two forms —
 * a canonical bare id (`gpt-5.5`) AND an Anthropic-API-compat alias
 * (`anthropic/pioneer/gpt-5.5`). The old seeder only stripped a leading `pioneer/`, so
 * the alias entries leaked in as `name = 'pioneer/anthropic/pioneer/<x>'`,
 * `upstream_model = 'anthropic/pioneer/<x>'` — duplicate rows on a fresh Pioneer account.
 *
 * Algorithm: derive the canonical bare id by stripping a leading `anthropic/pioneer/`
 * from `upstream_model`. Partition by that canon; the survivor is the row whose
 * `upstream_model` is NOT prefixed with `anthropic/pioneer/` (the canonical). Delete the
 * rest. Survivors already carry canonical `name`/`upstream_model`, so no rewrite.
 *
 * Validated against a real dirty DB: 139 -> 75 exact, 0 survivors with a leaked prefix.
 * Idempotent: a no-op once dedup is complete. `user_version = 9`.
 */
export const migration_009 = {
  id: 9,
  name: 'pioneer-anthropic-dedup',
  sql: `
    CREATE TEMP TABLE _pio_canon AS
      SELECT id, name, upstream_model,
        CASE WHEN upstream_model LIKE 'anthropic/pioneer/%'
             THEN substr(upstream_model, 19)
             ELSE upstream_model
        END AS canon
      FROM models
      WHERE provider = 'pioneer';

    CREATE TEMP TABLE _pio_keep AS
      SELECT canon, id AS keep_id FROM (
        SELECT *,
          row_number() OVER (
            PARTITION BY canon
            ORDER BY
              CASE WHEN upstream_model LIKE 'anthropic/pioneer/%' THEN 1 ELSE 0 END,
              length(name) ASC,
              id ASC
          ) AS rn
        FROM _pio_canon
      ) WHERE rn = 1;

    DELETE FROM models
     WHERE id IN (SELECT id FROM _pio_canon)
       AND id NOT IN (SELECT keep_id FROM _pio_keep);

    DROP TABLE _pio_canon;
    DROP TABLE _pio_keep;
  `,
};
