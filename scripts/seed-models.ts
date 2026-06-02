#!/usr/bin/env tsx
import { openDb } from "../src/db/index.js";
import { upsertModel } from "../src/db/repos/models.js";
import { log } from "../src/util/log.js";

const SEED: Array<Parameters<typeof upsertModel>[1]> = [
  { name: "MiniMax-M3",            upstream_model: "MiniMax-M3",            display_name: "MiniMax M3",             family: "m3",   context_window: 1000000, pricing_input: 0.60, pricing_output: 2.40, pricing_cache_read: 0.12, pricing_cache_write: null, pricing_tiers: '{"base":{"input":0.60,"output":2.40,"cacheRead":0.12,"cacheWrite":null},"high":{"input":1.20,"output":4.80,"cacheRead":0.24,"cacheWrite":null},"promotional":{"input":0.30,"output":1.20,"cacheRead":0.06,"cacheWrite":null}}', source: "builtin" },
  { name: "MiniMax-M2.7",          upstream_model: "MiniMax-M2.7",          display_name: "MiniMax M2.7",           family: "m2.7", context_window: 204800, pricing_input: 0.30, pricing_output: 1.20, pricing_cache_read: 0.06, pricing_cache_write: 0.375, source: "builtin" },
  { name: "MiniMax-M2.7-highspeed",upstream_model: "MiniMax-M2.7-highspeed",display_name: "MiniMax M2.7 highspeed", family: "m2.7", context_window: 204800, pricing_input: 0.60, pricing_output: 2.40, pricing_cache_read: 0.06, pricing_cache_write: 0.375, source: "builtin" },
  { name: "MiniMax-M2.5",          upstream_model: "MiniMax-M2.5",          display_name: "MiniMax M2.5",           family: "m2.5", context_window: 204800, pricing_input: 0.30, pricing_output: 1.20, pricing_cache_read: 0.03, pricing_cache_write: 0.375, source: "builtin" },
  { name: "MiniMax-M2.5-highspeed",upstream_model: "MiniMax-M2.5-highspeed",display_name: "MiniMax M2.5 highspeed", family: "m2.5", context_window: 204800, pricing_input: 0.60, pricing_output: 2.40, pricing_cache_read: 0.03, pricing_cache_write: 0.375, source: "builtin" },
  { name: "MiniMax-M2.1",          upstream_model: "MiniMax-M2.1",          display_name: "MiniMax M2.1",           family: "m2.1", context_window: 204800, pricing_input: 0.30, pricing_output: 1.20, pricing_cache_read: 0.03, pricing_cache_write: 0.375, source: "builtin" },
  { name: "MiniMax-M2.1-highspeed",upstream_model: "MiniMax-M2.1-highspeed",display_name: "MiniMax M2.1 highspeed", family: "m2.1", context_window: 204800, pricing_input: 0.60, pricing_output: 2.40, pricing_cache_read: 0.03, pricing_cache_write: 0.375, source: "builtin" },
  { name: "MiniMax-M2",            upstream_model: "MiniMax-M2",            display_name: "MiniMax M2",             family: "m2",   context_window: 204800, pricing_input: 0.30, pricing_output: 1.20, pricing_cache_read: 0.03, pricing_cache_write: 0.375, source: "builtin" },
  { name: "MiniMax-M2-her",        upstream_model: "MiniMax-M2-her",        display_name: "MiniMax M2-her (roleplay)", family: "m2-her", context_window: 64000, pricing_input: null as unknown as number, pricing_output: null as unknown as number, pricing_cache_read: null as unknown as number, pricing_cache_write: null as unknown as number, source: "builtin" },
];

const db = openDb();
let inserted = 0, updated = 0;
for (const m of SEED) {
  const existed = db.prepare(`SELECT 1 FROM models WHERE name = ?`).get(m.name);
  upsertModel(db, m);
  if (existed) updated++; else inserted++;
}
log.info({ inserted, updated, total: SEED.length }, "models seeded");
console.log(`Seeded ${SEED.length} models (${inserted} new, ${updated} updated).`);
