/**
 * Fresh-deploy seed: default settings rows. `build.version` is overwritten on
 * every startup by syncBuildVersion() in src/db/index.ts, so the value here is
 * just a placeholder until the first boot.
 */
export const SEED_SQL = `
    INSERT OR IGNORE INTO settings (key, value) VALUES
      ('rtk', '{"enabled": true, "minCompressSize": 500, "rawCap": 10485760, "filters": ["smart-truncate", "dedup-log"]}'),
      ('caveman', '{"level": "off"}'),
      ('caching', '{"autoBreakpoints": true, "respectCallerMarkers": true}'),
      ('minimax', '{"upstreamFormat": "auto", "m3DefaultMaxCompletionTokens": 131072}'),
      ('transport', '{"relay": null, "proxy": null}'),
      ('build', '{"version": "0.16.0"}');
`;
