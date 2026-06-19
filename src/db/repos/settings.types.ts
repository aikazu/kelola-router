/**
 * Valibot schemas for every known settings key.
 *
 * Foundation file for H4 (typed `getSetting<K>()` wrapper, Task 21). This module
 * declares the canonical shape of each settings row WITHOUT introducing any
 * runtime usage — no `parse`/`safeParse` calls live here and no call sites are
 * migrated yet (Tasks 22-25 do that). The `SETTINGS_SCHEMAS` map is `as const
 * satisfies Record<string, v.GenericSchema>` so:
 *
 *   - The literal key set is preserved for `SettingsMap`.
 *   - Every entry is statically verified to be a valibot schema.
 *
 * `SettingsMap` derives the per-key output type directly from the schemas, so
 * Task 21 can write `getSetting<K extends keyof SettingsMap>(...): SettingsMap[K] | null`.
 *
 * Shape sources (verified per call site on 2026-06-15):
 *   - migration 001-initial.ts:152-158   — seed defaults
 *   - src/server.ts:132,231,241,249,255,260,265 — write paths
 *   - src/util/env.ts:43                 — minimax.upstreamFormat reader
 *   - src/transport/resolve.ts:58-79     — GlobalTransportSetting
 *   - src/proxy/{minimax,kiro,combo,codebuddy,pioneer}.ts — selection.* readers
 *   - src/auth/password.ts               — admin_password scrypt hash format
 *   - src/caveman/prompts.ts:6           — CavemanLevel union
 *   - src/accounts/types.ts:3            — SelectionMode union
 *
 * No `v.unknown()` gaps: every key has a concrete, verified shape.
 */

import * as v from 'valibot';

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

const selectionModeSchema = v.picklist(['lowest-backoff', 'round-robin', 'sticky']);
const upstreamFormatSchema = v.picklist(['auto', 'openai', 'anthropic']);
const cavemanLevelSchema = v.picklist(['off', 'terse', 'ultra']);

const proxyConfigSchema = v.object({
  kind: v.picklist(['http', 'socks5']),
  url: v.string(),
});

const relayConfigSchema = v.object({
  kind: v.picklist(['vercel', 'cloudflare']),
  url: v.string(),
});

const selectionSchema = v.object({
  mode: selectionModeSchema,
  step: v.optional(v.number()),
});

// ---------------------------------------------------------------------------
// Per-key schemas
//
// Field optionality reflects what readers actually access. Optional fields are
// ones the seed provides but no current reader requires (they fall back to a
// hardcoded default when absent), allowing partial writes from the dashboard
// POST handlers to validate cleanly.
// ---------------------------------------------------------------------------

/**
 * RTK compression config. `enabled` is the only field readers branch on
 * (`getAllSettings(db).rtk?.enabled`); the seed also carries minCompressSize /
 * rawCap / filters for tuning but nothing reads them yet — they're optional so
 * the dashboard's `{enabled: boolean}` write (server.ts:260) validates.
 */
const rtkSchema = v.object({
  enabled: v.boolean(),
  minCompressSize: v.optional(v.number()),
  rawCap: v.optional(v.number()),
  filters: v.optional(v.array(v.string())),
});

/**
 * Caveman prompt-injection level. Matches `CavemanLevel` from
 * `src/caveman/prompts.ts:6`.
 */
const cavemanSchema = v.object({
  level: cavemanLevelSchema,
});

/**
 * Dual cache_control injection toggles. Seed sets both; dashboard write path
 * (server.ts:265) sets only `autoBreakpoints`, so `respectCallerMarkers` is
 * optional.
 */
const cachingSchema = v.object({
  autoBreakpoints: v.boolean(),
  respectCallerMarkers: v.optional(v.boolean()),
});

/**
 * MiniMax provider settings. Both fields optional: env.ts falls back to env /
 * `'auto'` when `upstreamFormat` is missing, and alias.ts guards
 * `m3DefaultMaxCompletionTokens` with `?.`. The dashboard merge handler
 * (server.ts:241-249) persists arbitrary key merges, so additional unknown
 * keys are tolerated via `v.looseObject`-free pass-through (kept strict here;
 * Task 21 will decide whether to loosen when migrating the merge call site).
 */
const minimaxSchema = v.object({
  upstreamFormat: v.optional(upstreamFormatSchema),
  m3DefaultMaxCompletionTokens: v.optional(v.number()),
});

/**
 * Global transport fallback (per-account transport overrides take priority).
 * Matches `GlobalTransportSetting` from `src/transport/resolve.ts:58-62`.
 * Both relay and proxy are nullable; proxyFailureMode defaults to 'direct'
 * when absent.
 */
const transportSchema = v.object({
  relay: v.nullable(relayConfigSchema),
  proxy: v.nullable(proxyConfigSchema),
  proxyFailureMode: v.optional(v.picklist(['direct', 'block'])),
});

/**
 * Build self-description. Auto-synced from package.json on startup
 * (server.ts writes `{version}` on boot).
 */
const buildSchema = v.object({
  version: v.string(),
});

/**
 * Admin password as a scrypt hash string, or null when unset (open mode).
 * Format per `hashPassword()`: `scrypt:<N>:<saltHex>:<hashHex>`. We schema it
 * as `nullable(string)` rather than a strict regex so the plain `null` write
 * in server.ts:231 validates, and so we don't reject legacy/canonical formats.
 */
const adminPasswordSchema = v.nullable(v.string());

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/**
 * Canonical map of every known settings key → valibot schema.
 *
 * `as const` preserves the literal key set (so `keyof typeof SETTINGS_SCHEMAS`
 * is the exact union of settings keys). `satisfies Record<string, v.GenericSchema>`
 * guarantees every entry is a valibot schema without widening the literal key
 * types.
 *
 * Add new keys here when they're introduced. Task 21 will use this to type
 * `getSetting<K>()`.
 */
export const SETTINGS_SCHEMAS = {
  rtk: rtkSchema,
  caveman: cavemanSchema,
  caching: cachingSchema,
  minimax: minimaxSchema,
  transport: transportSchema,
  build: buildSchema,
  admin_password: adminPasswordSchema,
  'selection.minimax': selectionSchema,
  'selection.kiro': selectionSchema,
  'selection.codebuddy': selectionSchema,
  'selection.pioneer': selectionSchema,
  'selection.notion': selectionSchema,
  'selection.zai': selectionSchema,
} as const satisfies Record<string, v.GenericSchema>;

/**
 * Union of all known settings keys. Equals `keyof typeof SETTINGS_SCHEMAS`.
 */
export type SettingKey = keyof typeof SETTINGS_SCHEMAS;

/**
 * Per-key output type. Task 21's typed `getSetting<K>()` returns
 * `SettingsMap[K] | null`.
 */
export type SettingsMap = {
  [K in keyof typeof SETTINGS_SCHEMAS]: v.InferOutput<(typeof SETTINGS_SCHEMAS)[K]>;
};
