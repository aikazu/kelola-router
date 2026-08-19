import type Database from 'better-sqlite3';
import { upsertModel } from '../db/repos/models.js';
import { getBaseUrl } from './base-url.js';
import { buildHeaders } from './headers.js';

function detectFamily(name: string): string {
  if (name.includes('M3')) return 'm3';
  if (name.includes('M2.7')) return 'm2.7';
  if (name.includes('M2.5')) return 'm2.5';
  if (name.includes('M2.1')) return 'm2.1';
  if (name.includes('M2-her')) return 'm2-her';
  if (name.includes('M2')) return 'm2';
  return 'custom';
}

/**
 * Static pricing table for MiniMax models that fetchModels cannot obtain from
 * the upstream /v1/models endpoint (which only returns model ids). Prices are
 * USD per 1M tokens, sourced from platform.minimax.io/docs/guides/pricing-payg.
 *
 * M3 has a permanent 50% discount applied — the "Standard" column shows the
 * pre-discount price struck through; we store the actual effective (discounted)
 * price. M3 also has tiered pricing: ≤512k input tokens uses the base tier,
 * >512k uses the high tier (2x). The high tier is currently "limited quantity,
 * limited time" per the pricing page.
 *
 * M2.7 / M2.7-highspeed publish flat pricing with a cache-write column.
 * Legacy models (M2.5, M2.1, M2, M2-her) are not priced here — the pricing page
 * collapses them under "Legacy Models" without published numbers.
 */
interface MiniMaxPricing {
  context: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number | null;
  /** Tiered pricing JSON for models with a >512k high-context tier. */
  tiers?: string;
}

const MINIMAX_PRICING: Record<string, MiniMaxPricing> = {
  'MiniMax-M3': {
    context: 1_000_000,
    input: 0.3,
    output: 1.2,
    cacheRead: 0.06,
    cacheWrite: null,
    tiers:
      '{"base":{"input":0.30,"output":1.20,"cacheRead":0.06,"cacheWrite":null},"high":{"input":0.60,"output":2.40,"cacheRead":0.12,"cacheWrite":null}}',
  },
  'MiniMax-M2.7': {
    context: 204_800,
    input: 0.3,
    output: 1.2,
    cacheRead: 0.06,
    cacheWrite: 0.375,
  },
  'MiniMax-M2.7-highspeed': {
    context: 204_800,
    input: 0.6,
    output: 2.4,
    cacheRead: 0.06,
    cacheWrite: 0.375,
  },
};

function pricingForMiniMax(id: string): {
  contextWindow: number;
  pricingInput: number;
  pricingOutput: number;
  pricingCacheRead: number;
  pricingCacheWrite: number | null;
  pricingTiers: string | null;
} | null {
  const p = MINIMAX_PRICING[id];
  if (!p) return null;
  return {
    contextWindow: p.context,
    pricingInput: p.input,
    pricingOutput: p.output,
    pricingCacheRead: p.cacheRead,
    pricingCacheWrite: p.cacheWrite,
    pricingTiers: p.tiers ?? null,
  };
}

export interface FetchModelsResult {
  ok: boolean;
  added?: number;
  status?: number;
  error?: string;
}

export async function fetchModels(
  db: Database.Database,
  apiKey: string
): Promise<FetchModelsResult> {
  const account = { provider: 'minimax' as const, baseUrl: null };
  const candidatePaths = ['/v1/models'];
  const headers = buildHeaders({ provider: 'minimax', apiKey }, false, 'openai');

  for (const p of candidatePaths) {
    const url = `${getBaseUrl(account, 'openai')}${p}`;
    const resp = await fetch(url, { method: 'GET', headers });
    if (resp.ok) {
      const data = (await resp.json()) as { data: { id: string }[] };
      let added = 0;
      for (const m of data.data ?? []) {
        const existing = db.prepare(`SELECT id FROM models WHERE name = ?`).get(m.id);
        if (!existing) added++;
        const price = pricingForMiniMax(m.id);
        upsertModel(db, {
          name: m.id,
          upstream_model: m.id,
          display_name: m.id,
          family: detectFamily(m.id),
          ...(price && {
            context_window: price.contextWindow,
            pricing_input: price.pricingInput,
            pricing_output: price.pricingOutput,
            pricing_cache_read: price.pricingCacheRead,
            pricing_cache_write: price.pricingCacheWrite,
            pricing_tiers: price.pricingTiers,
          }),
          source: 'fetched',
          enabled: 1,
        });
      }
      return { ok: true, added };
    }
    if (resp.status === 404) continue;
    const text = await resp.text().catch(() => '');
    return {
      ok: false,
      status: resp.status,
      error: `upstream returned ${resp.status}: ${text.slice(0, 200)}`,
    };
  }
  return {
    ok: false,
    status: 404,
    error:
      'MiniMax upstream does not expose a model list endpoint at the OpenAI base URL; use the seeded models instead',
  };
}
