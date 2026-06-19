import type Database from 'better-sqlite3';
import { upsertModel } from '../../db/repos/models.js';
import { log } from '../../util/log.js';
import { PIONEER_BASE_URL } from './index.js';

/** Shape of one entry in Pioneer's `GET /v1/models` response. */
interface PioneerModelEntry {
  id: string;
  display_name?: string | null;
  max_input_tokens?: number | null;
  max_tokens?: number | null;
}

export interface SeedPioneerModelsResult {
  ok: boolean;
  added?: number;
  total?: number;
  status?: number;
  error?: string;
}

/**
 * USD per 1M tokens. Pioneer is an aggregator that resells models from
 * multiple upstream providers under its own id space (e.g. `claude-opus-4-8`,
 * `glm-5`, `moonshotai/Kimi-K2.6`, `qwen3-coder-next`). Pioneer's
 * `GET /v1/models` does NOT return per-token pricing, so we look it up here
 * from the underlying provider's standard public list price. Sources:
 *   - Anthropic: docs.claude.com/en/docs/about-claude/models/all-models
 *   - Z.AI:      docs.z.ai/guides/overview/pricing
 *   - Moonshot:  platform.moonshot.ai/docs/pricing
 *   - OpenAI:    openai.com/api/pricing
 *   - DeepSeek:  api-docs.deepseek.com/quick_start/pricing
 *   - Alibaba:   help.aliyun.com (Qwen API)
 * Unmapped ids fall through to all-zero pricing — Pioneer can still list and
 * route them, and the user can override per-row from the dashboard edit modal.
 */
const PIONEER_PRICING: Record<
  string,
  { input: number; output: number; cacheRead: number; cacheWrite: number }
> = {
  // Anthropic Claude family (cache write 1.25x input, cache read 0.1x input)
  'claude-opus-4-8': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-opus-4-7': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-opus-4-6': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-opus-4-5': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-sonnet-4-6': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  'claude-sonnet-4-5': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  'claude-sonnet-4': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  // Z.AI GLM family
  glm5: { input: 1, output: 3.2, cacheRead: 0.2, cacheWrite: 0 },
  'glm-5': { input: 1, output: 3.2, cacheRead: 0.2, cacheWrite: 0 },
  // Moonshot Kimi (Pioneer serves with vendor prefix)
  'moonshotai/Kimi-K2.6': { input: 0.6, output: 2.2, cacheRead: 0.15, cacheWrite: 0 },
  'moonshotai/Kimi-K2.5': { input: 0.6, output: 2.2, cacheRead: 0.15, cacheWrite: 0 },
  'moonshotai/Kimi-K2': { input: 0.6, output: 2.2, cacheRead: 0.15, cacheWrite: 0 },
  // OpenAI GPT-5 family
  'gpt-5.5': { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },
  'gpt-5': { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },
  // DeepSeek
  'deepseek-3.2': { input: 0.27, output: 1.1, cacheRead: 0.07, cacheWrite: 0 },
  // Qwen Coder (Alibaba bailian)
  'qwen3-coder-next': { input: 0.4, output: 1.6, cacheRead: 0.1, cacheWrite: 0 },
};

/**
 * Prefix-based pricing patterns — applied AFTER the explicit `PIONEER_PRICING`
 * table and BEFORE the all-zero fallback. Each entry maps a regex test to the
 * underlying provider's standard public list price. Ordered most-specific
 * first; first match wins.
 *
 * Sources:
 *   - Anthropic:  docs.claude.com/en/docs/about-claude/models/all-models
 *   - Google:     ai.google.dev/gemini-api/docs/pricing
 *   - OpenAI:     openai.com/api/pricing
 *   - DeepSeek:   api-docs.deepseek.com/quick_start/pricing
 *   - Meta Llama: llama.meta.com/docs/models
 *   - Mistral:    docs.mistral.ai/getting-started/models/overview
 *   - Moonshot:   platform.moonshot.ai/docs/pricing
 *   - Qwen:       help.aliyun.com (Alibaba bailian / Qwen API)
 *   - NVIDIA:     build.nvidia.com/models
 *   - Z.AI:       docs.z.ai/guides/overview/pricing
 *   - Xiaomi:     mi-mo.github.io
 *   - HF / LiquidAI: open weights, list price 0 (route still works)
 */
const PIONEER_PRICING_PATTERNS: ReadonlyArray<{
  test: (id: string) => boolean;
  price: { input: number; output: number; cacheRead: number; cacheWrite: number };
}> = [
  // Anthropic Claude (cache write 1.25x input, cache read 0.1x input)
  {
    test: (id) => /^claude-opus-4-1/.test(id),
    price: { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  },
  {
    test: (id) => /^claude-opus-4-[2-9]/.test(id),
    price: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  },
  {
    test: (id) => /^claude-opus-4-/.test(id),
    price: { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  },
  {
    test: (id) => /^claude-sonnet-4-/.test(id),
    price: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  },
  {
    test: (id) => /^claude-sonnet-/.test(id),
    price: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  },
  {
    test: (id) => /^claude-haiku-4-/.test(id),
    price: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  },
  {
    test: (id) => /^claude-3-7-sonnet/.test(id),
    price: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  },
  {
    test: (id) => /^claude-3-5-sonnet/.test(id),
    price: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  },
  {
    test: (id) => /^claude-3-5-haiku/.test(id),
    price: { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 },
  },
  {
    test: (id) => /^claude-3-/.test(id),
    price: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  },
  {
    test: (id) => /^claude-/.test(id),
    price: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  },
  // Google Gemini (cache read = 0.25x input, no published cache write)
  {
    test: (id) => /^gemini-3-flash/.test(id),
    price: { input: 0.075, output: 0.3, cacheRead: 0.01875, cacheWrite: 0 },
  },
  {
    test: (id) => /^gemini-3\.[15]-pro/.test(id),
    price: { input: 1.25, output: 5, cacheRead: 0.31, cacheWrite: 0.31 },
  },
  {
    test: (id) => /^gemini-3-pro/.test(id),
    price: { input: 1.25, output: 5, cacheRead: 0.31, cacheWrite: 0.31 },
  },
  {
    test: (id) => /^gemini-2\.5-pro/.test(id),
    price: { input: 1.25, output: 10, cacheRead: 0.31, cacheWrite: 0 },
  },
  {
    test: (id) => /^gemini-2\.5-flash/.test(id),
    price: { input: 0.075, output: 0.3, cacheRead: 0.01875, cacheWrite: 0 },
  },
  {
    test: (id) => /^gemini-/.test(id),
    price: { input: 0.075, output: 0.3, cacheRead: 0.01875, cacheWrite: 0 },
  },
  {
    test: (id) => /^google\/gemma-/.test(id),
    price: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  },
  {
    test: (id) => /^google\/diffusion/.test(id),
    price: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  },
  // OpenAI (cache read 0.1x input)
  {
    test: (id) => /^gpt-5\.5/.test(id),
    price: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },
  },
  {
    test: (id) => /^gpt-5\.[1-9]/.test(id),
    price: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },
  },
  {
    test: (id) => /^gpt-5/.test(id),
    price: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },
  },
  {
    test: (id) => /^gpt-4\.1/.test(id),
    price: { input: 2, output: 8, cacheRead: 0.5, cacheWrite: 0 },
  },
  {
    test: (id) => /^gpt-4o-mini/.test(id),
    price: { input: 0.15, output: 0.6, cacheRead: 0.075, cacheWrite: 0 },
  },
  {
    test: (id) => /^gpt-4o/.test(id),
    price: { input: 2.5, output: 10, cacheRead: 1.25, cacheWrite: 0 },
  },
  {
    test: (id) => /^gpt-oss/.test(id),
    price: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  },
  {
    test: (id) => /^gpt-/.test(id),
    price: { input: 2.5, output: 10, cacheRead: 1.25, cacheWrite: 0 },
  },
  {
    test: (id) => /^openai\/gpt-oss/.test(id),
    price: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  },
  // DeepSeek
  {
    test: (id) => /^deepseek-3\./.test(id),
    price: { input: 0.27, output: 1.1, cacheRead: 0.07, cacheWrite: 0 },
  },
  {
    test: (id) => /^deepseek-ai\/DeepSeek-V3/.test(id),
    price: { input: 0.27, output: 1.1, cacheRead: 0.07, cacheWrite: 0 },
  },
  {
    test: (id) => /^deepseek-ai\/DeepSeek-V4/.test(id),
    price: { input: 0.27, output: 1.1, cacheRead: 0.07, cacheWrite: 0 },
  },
  {
    test: (id) => /^deepseek-/.test(id),
    price: { input: 0.27, output: 1.1, cacheRead: 0.07, cacheWrite: 0 },
  },
  // Qwen (Alibaba)
  {
    test: (id) => /^qwen3\.7/.test(id),
    price: { input: 1.6, output: 6.4, cacheRead: 0.16, cacheWrite: 0 },
  },
  {
    test: (id) => /^qwen3\.6/.test(id),
    price: { input: 1.2, output: 4.8, cacheRead: 0.12, cacheWrite: 0 },
  },
  {
    test: (id) => /^qwen3-coder/.test(id),
    price: { input: 0.4, output: 1.6, cacheRead: 0.1, cacheWrite: 0 },
  },
  {
    test: (id) => /^qwen3-/.test(id),
    price: { input: 0.4, output: 1.6, cacheRead: 0.1, cacheWrite: 0 },
  },
  {
    test: (id) => /^qwen2\.5-coder/.test(id),
    price: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  },
  { test: (id) => /^Qwen\//.test(id), price: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
  // Meta Llama (open weights — 0 unless served via paid API)
  {
    test: (id) => /^llama-3\.1-70b/.test(id),
    price: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  },
  { test: (id) => /^llama-/.test(id), price: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
  {
    test: (id) => /^meta-llama\//.test(id),
    price: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  },
  // Mistral
  {
    test: (id) => /^mistral-medium/.test(id),
    price: { input: 0.4, output: 2, cacheRead: 0.04, cacheWrite: 0 },
  },
  {
    test: (id) => /^mistral-/.test(id),
    price: { input: 0.2, output: 0.6, cacheRead: 0.02, cacheWrite: 0 },
  },
  {
    test: (id) => /^mistralai\//.test(id),
    price: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  },
  // Moonshot Kimi
  {
    test: (id) => /^moonshotai\/Kimi-K2\.7/.test(id),
    price: { input: 0.6, output: 2.2, cacheRead: 0.15, cacheWrite: 0 },
  },
  {
    test: (id) => /^moonshotai\/Kimi-K2/.test(id),
    price: { input: 0.6, output: 2.2, cacheRead: 0.15, cacheWrite: 0 },
  },
  {
    test: (id) => /^moonshotai\//.test(id),
    price: { input: 0.6, output: 2.2, cacheRead: 0.15, cacheWrite: 0 },
  },
  // Z.AI
  {
    test: (id) => /^zai-org\/GLM-5\./.test(id),
    price: { input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 0 },
  },
  {
    test: (id) => /^zai-org\/GLM-/.test(id),
    price: { input: 1, output: 3.2, cacheRead: 0.2, cacheWrite: 0 },
  },
  {
    test: (id) => /^glm-/.test(id),
    price: { input: 1, output: 3.2, cacheRead: 0.2, cacheWrite: 0 },
  },
  // NVIDIA Nemotron
  {
    test: (id) => /^nvidia\/NVIDIA-Nemotron-3-Ultra/.test(id),
    price: { input: 4.2, output: 12, cacheRead: 0, cacheWrite: 0 },
  },
  {
    test: (id) => /^nvidia\/NVIDIA-Nemotron-3-Super/.test(id),
    price: { input: 1.5, output: 4.5, cacheRead: 0, cacheWrite: 0 },
  },
  {
    test: (id) => /^nvidia\/NVIDIA-Nemotron-3-Nano/.test(id),
    price: { input: 0.06, output: 0.18, cacheRead: 0, cacheWrite: 0 },
  },
  {
    test: (id) => /^nvidia\//.test(id),
    price: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  },
  // Xiaomi MiMo (open weights)
  {
    test: (id) => /^XiaomiMiMo\/MiMo-/.test(id),
    price: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  },
  // HF / LiquidAI (open weights)
  {
    test: (id) => /^HuggingFaceTB\//.test(id),
    price: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  },
  {
    test: (id) => /^LiquidAI\//.test(id),
    price: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  },
  // MiniMax passthrough
  {
    test: (id) => /^MiniMaxAI\/MiniMax-M/.test(id),
    price: { input: 0.6, output: 2.4, cacheRead: 0.12, cacheWrite: 0 },
  },
  {
    test: (id) => /^minimax-m/.test(id),
    price: { input: 0.3, output: 1.2, cacheRead: 0.06, cacheWrite: 0 },
  },
  // `auto` is a routing target, not a billable model — leave at 0
  { test: (id) => id === 'auto', price: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
];

/** Look up pricing for a Pioneer model id. Falls back to all-zero. */
function pricingForPioneerId(id: string): {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
} {
  // Direct hit first, then case-insensitive match, then a stripped
  // "anthropic/pioneer/" prefix for the Anthropic-API-compat alias form.
  const direct = PIONEER_PRICING[id];
  if (direct) return direct;
  const ci = PIONEER_PRICING[id.toLowerCase()];
  if (ci) return ci;
  const stripped = id.replace(/^anthropic\/pioneer\//, '');
  const s = PIONEER_PRICING[stripped] ?? PIONEER_PRICING[stripped.toLowerCase()];
  if (s) return s;
  // Prefix-based fallback: covers every family Pioneer serves without an
  // explicit entry. Ordered most-specific first; first match wins.
  for (const { test, price } of PIONEER_PRICING_PATTERNS) {
    if (test(stripped)) return price;
  }
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
}

/**
 * Fetch the live model catalogue from Pioneer with the given key and seed it
 * into the `models` table. Called right after a Pioneer account is added in the
 * dashboard so the user only ever has to paste a key — no CLI seed step.
 *
 * Pioneer ids (e.g. `claude-opus-4-8`, `gpt-5.5`) can collide with same-named
 * Kiro/CodeBuddy rows on the globally-unique `name`/`upstream_model` columns, so
 * each row is namespaced under `pioneer/` in BOTH columns. Clients still call
 * the clean `pio/<id>`; `resolveModel` maps that to the namespaced row and the
 * proxy strips the single leading `pioneer/` before the upstream request.
 */
export async function fetchAndSeedPioneerModels(
  db: Database.Database,
  apiKey: string,
  baseUrl?: string | null
): Promise<SeedPioneerModelsResult> {
  const url = `${baseUrl || PIONEER_BASE_URL}/v1/models`;
  log.info({ provider: 'pioneer', url, baseUrl: baseUrl ?? null }, 'pioneer: model seed starting');

  let resp: Response;
  try {
    resp = await fetch(url, { method: 'GET', headers: { 'X-API-Key': apiKey } });
  } catch (e) {
    const message = (e as Error).message;
    log.warn({ provider: 'pioneer', url, err: message }, 'pioneer: models fetch threw');
    return { ok: false, error: `Pioneer models fetch failed: ${message}` };
  }

  log.info(
    { provider: 'pioneer', status: resp.status, contentType: resp.headers.get('content-type') },
    'pioneer: models fetch responded'
  );

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    log.warn(
      { provider: 'pioneer', status: resp.status, body: text.slice(0, 200) },
      'pioneer: models fetch non-OK'
    );
    return {
      ok: false,
      status: resp.status,
      error: `Pioneer returned ${resp.status}: ${text.slice(0, 200)}`,
    };
  }

  // The upstream returns `{ data: [...], models: [...], object, has_more, ... }`.
  // `data` is the canonical model list (Anthropic-API-compat shape with id /
  // display_name / max_input_tokens / max_tokens). `models` is a separate
  // dashboard metadata list (slug / supported_reasoning_levels / etc.) — not
  // what `/v1/chat/completions` accepts. Fall back defensively if upstream
  // ever reshapes the response.
  const rawBody = (await resp.json()) as Record<string, unknown>;
  const topKeys = Object.keys(rawBody);
  log.info({ provider: 'pioneer', topKeys }, 'pioneer: models response keys');

  const dataContainer = rawBody.data ?? rawBody.models ?? rawBody.result ?? rawBody.items;
  const entries: PioneerModelEntry[] = Array.isArray(dataContainer)
    ? (dataContainer as PioneerModelEntry[])
    : [];
  const matchedKey = Array.isArray(rawBody.data)
    ? 'data'
    : Array.isArray(rawBody.models)
      ? 'models'
      : Array.isArray(rawBody.result)
        ? 'result'
        : Array.isArray(rawBody.items)
          ? 'items'
          : 'none';
  log.info(
    { provider: 'pioneer', matchedKey, entryCount: entries.length },
    'pioneer: parsed model entries'
  );

  let added = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  const seen = new Set<string>();
  for (const m of entries) {
    if (!m.id) continue;
    // Strip a leading `anthropic/pioneer/` (Anthropic-API-compat alias form) and/or
    // `pioneer/` (self-namespaced form), including repeated wraps (e.g.
    // `pioneer/anthropic/pioneer/<id>`), so each model collapses to one canonical
    // row. Without the `anthropic/pioneer/` strip the upstream catalogue seeds
    // the same model twice (e.g. `gpt-5.5` + `anthropic/pioneer/gpt-5.5`) and
    // produces duplicate rows.
    const bareId = m.id.replace(/^(?:anthropic\/pioneer\/|pioneer\/)+/, '');
    if (seen.has(bareId)) {
      skipped++;
      continue;
    }
    seen.add(bareId);
    const name = `pioneer/${bareId}`;
    // Store `upstream_model` as the namespaced form (`pioneer/<id>`) so it never
    // collides on the globally-unique `models.upstream_model` index with Kiro /
    // CodeBuddy rows that own the bare id (e.g. `claude-opus-4-8`). The proxy
    // already strips a single leading `pioneer/` before forwarding to
    // `/v1/chat/completions`, so this is wire-compatible with the bare-id form.
    const upstream = name;
    const existing = db.prepare(`SELECT 1 FROM models WHERE name = ?`).get(name);
    if (existing) {
      updated++;
    } else {
      added++;
    }
    try {
      const pricing = pricingForPioneerId(bareId);
      upsertModel(db, {
        name,
        upstream_model: upstream,
        display_name: `Pioneer ${m.display_name?.trim() || bareId}`,
        family: 'pioneer',
        context_window: m.max_input_tokens ?? null,
        context_output: m.max_tokens ?? null,
        pricing_input: pricing.input,
        pricing_output: pricing.output,
        pricing_cache_read: pricing.cacheRead,
        pricing_cache_write: pricing.cacheWrite,
        source: 'fetched',
        provider: 'pioneer',
      });
    } catch (e) {
      // A single UNIQUE / NOT NULL conflict (e.g. upstream_model collision
      // with a non-Pioneer provider that was inserted first) must not abort the
      // whole batch — log and continue with the remaining entries.
      failed++;
      log.warn(
        { provider: 'pioneer', name, upstream, err: (e as Error).message },
        'pioneer: upsert failed for one entry, skipping'
      );
    }
  }

  log.info(
    { provider: 'pioneer', total: entries.length, added, updated, skipped, failed },
    'pioneer: model seed finished'
  );

  return { ok: true, added, total: entries.length };
}
