import type Database from 'better-sqlite3';
import { getModel, type Model } from '../db/repos/models.js';

export interface ModelPricing {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number | null;
}

export interface ModelPricingTiers {
  base: ModelPricing;
  high: ModelPricing;
  promotional?: ModelPricing;
}

export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
}

const HIGH_CONTEXT_THRESHOLD = 512_000;

export function resolvePricing(
  db: Database.Database,
  modelName: string,
  promptTokens: number
): ModelPricing | null {
  const model: Model | null = getModel(db, modelName);
  if (!model) return null;

  if (model.pricing_tiers) {
    const tiers: ModelPricingTiers = JSON.parse(model.pricing_tiers);
    if (promptTokens > HIGH_CONTEXT_THRESHOLD) return tiers.high;
    return tiers.base;
  }

  if (model.pricing_input == null) return null;
  return {
    input: model.pricing_input,
    output: model.pricing_output ?? 0,
    cacheRead: model.pricing_cache_read ?? 0,
    cacheWrite: model.pricing_cache_write,
  };
}

export function calculateCost(db: Database.Database, modelName: string, usage: Usage): number {
  const pricing = resolvePricing(db, modelName, usage.prompt_tokens);
  if (!pricing) return 0;

  const input = (usage.prompt_tokens / 1_000_000) * pricing.input;
  const output = (usage.completion_tokens / 1_000_000) * pricing.output;
  const cacheCreate =
    pricing.cacheWrite != null ? (usage.cache_creation_tokens / 1_000_000) * pricing.cacheWrite : 0;
  const cacheRead = (usage.cache_read_tokens / 1_000_000) * pricing.cacheRead;

  return input + output + cacheCreate + cacheRead;
}
