/**
 * Migration 006 — transport geoip country.
 *
 * Additive only. Stores the geoip-detected country code (e.g. 'SG') for each
 * transport, populated by a connectivity+geoip probe on add. NULL until probed
 * or when the probe could not determine a country.
 */
export const migration_006 = {
  id: 6,
  name: 'transport-country',
  sql: `
    ALTER TABLE transports ADD COLUMN country TEXT;
  `,
};
