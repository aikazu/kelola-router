// src/providers/qwencloud/models.ts
import type Database from 'better-sqlite3';
import { upsertModel } from '../../db/repos/models.js';

// ─── QwenCloud (Aliyun token-plan) built-in model catalogue ──────────────────

interface QwenCloudModel {
  /** Upstream model id (bare — the string Aliyun's /v1/messages accepts). */
  id: string;
  display: string;
  context: number;
  contextOutput: number | null;
  /**
   * USD price per 1M tokens — official Aliyun token-plan list prices,
   * confirmed by the user. Cache legs are not published, so they stay 0.
   */
  pricing: {
    input: number;
    output: number;
  };
}

const QWENCLOUD_MODELS: QwenCloudModel[] = [
  {
    id: 'qwen3.8-max',
    display: 'Qwen 3.8 Max',
    context: 1000000,
    contextOutput: 128000,
    pricing: { input: 2.0, output: 6.0 },
  },
  {
    id: 'deepseek-v4-flash-0731',
    display: 'DeepSeek V4 Flash (0731)',
    context: 1000000,
    contextOutput: 128000,
    pricing: { input: 0.44, output: 1.32 },
  },
  {
    id: 'deepseek-v4-pro-0813',
    display: 'DeepSeek V4 Pro (0813)',
    context: 1000000,
    contextOutput: 128000,
    pricing: { input: 1.32, output: 3.96 },
  },
];

/**
 * Seed the QwenCloud built-in model list. Idempotent: re-running only upserts
 * rows. The three ids are the confirmed-valid catalogue from
 * docs/qwencloud/wire-format.md (probed live, echo `model` back verbatim).
 *
 * Model ids are stored BARE (no `qctp/` prefix) in both `name` and
 * `upstream_model`, mirroring zai: these ids (`qwen3.8-max`,
 * `deepseek-v4-flash-0731`, `deepseek-v4-pro-0813`) do not collide with rows
 * from other providers on the globally-unique index. Clients route via the
 * `qctp/` prefix which the proxy strips before calling upstream.
 *
 * Pricing is stored as USD per 1M tokens (the schema unit; cost calculation
 * divides token counts by 1_000_000 before multiplying — see
 * src/providers/pricing.ts) using the official Aliyun token-plan list prices
 * confirmed by the user: qwen3.8-max $2/$6, deepseek-v4-flash-0731 $0.44/$1.32,
 * deepseek-v4-pro-0813 $1.32/$3.96 input/output per M. Cache legs are not
 * published for the token-plan, so cache pricing stays 0. `context_window` is
 * 1M (1,000,000) tokens input and `context_output` is 128K (128,000) tokens
 * max output for all three models — confirmed by the user.
 */
export function seedQwenCloudBuiltins(db: Database.Database): {
  added: number;
  total: number;
} {
  const models = QWENCLOUD_MODELS.map((m) => ({
    name: m.id,
    upstream_model: m.id,
    display_name: m.display,
    family: 'qwencloud',
    context_window: m.context,
    context_output: m.contextOutput,
    pricing_input: m.pricing.input,
    pricing_output: m.pricing.output,
    pricing_cache_read: 0,
    pricing_cache_write: 0,
    source: 'builtin' as const,
    provider: 'qwencloud' as const,
  }));

  const previous = (db
    .prepare<unknown[], { c: number }>(
      `SELECT COUNT(*) AS c FROM models WHERE name IN (${models.map(() => '?').join(', ')})`
    )
    .get(...models.map((m) => m.name))?.c ?? 0) as number;

  for (const m of models) upsertModel(db, m);

  const current = (db
    .prepare<unknown[], { c: number }>(
      `SELECT COUNT(*) AS c FROM models WHERE name IN (${models.map(() => '?').join(', ')})`
    )
    .get(...models.map((m) => m.name))?.c ?? 0) as number;

  return { added: current - previous, total: models.length };
}
