import type Database from 'better-sqlite3';
import { getModel, type Model } from '../db/repos/models.js';
import { getSetting } from '../db/repos/settings.js';
import { resolveAlias } from './aliasCache.js';
import type { AnthropicBody, OpenAIBody } from './format/messageTypes.js';
import { parseModelPrefix } from './modelPrefix.js';

/**
 * Models that the MiniMax reference docs (docs/minimax-reference/) list as
 * supporting thinking. The router injects `thinking: { type: "adaptive" }`
 * for these models when the client has not already set `thinking`. Add a
 * model here when upstream ships a new thinking-capable variant.
 */
export const ADAPTIVE_THINKING_MODELS: ReadonlySet<string> = new Set([
  'MiniMax-M3',
  'MiniMax-M2.7',
  'MiniMax-M2.7-highspeed',
  'MiniMax-M2.5',
  'MiniMax-M2.5-highspeed',
  'MiniMax-M2.1',
  'MiniMax-M2.1-highspeed',
  'MiniMax-M2',
]);

export interface ResolvedModel {
  upstreamModel: string;
  bodyTransform: (body: AnthropicBody | OpenAIBody) => void;
  requestedModel: string;
  provider: string;
}

export function resolveModel(
  db: Database.Database,
  requestedName: string,
  _body?: AnthropicBody | OpenAIBody
): ResolvedModel {
  const parsed = parseModelPrefix(requestedName);

  let model: Model | null;
  let provider: string;

  if (parsed.prefixed) {
    // Literal lookup — no alias expansion. Prefix asserts the provider.
    model = getModel(db, parsed.modelName);
    if (!model) throw new Error(`unknown model: ${requestedName}`);
    const modelProvider = model.provider ?? 'minimax';
    if (modelProvider !== parsed.provider) {
      throw new Error(`model ${parsed.modelName} not available on provider ${parsed.provider}`);
    }
    provider = parsed.provider as string;
  } else {
    // Bare: must be an alias (combos are intercepted earlier in the proxy).
    const target = resolveAlias(db, parsed.modelName);
    if (target === parsed.modelName) throw new Error(`unknown model: ${requestedName}`);
    model = getModel(db, target);
    if (!model) throw new Error(`unknown model: ${requestedName}`);
    provider = model.provider ?? 'minimax';
  }

  if (!model.enabled) throw new Error(`model disabled: ${requestedName}`);

  const minimaxSettings = getSetting<{ m3DefaultMaxCompletionTokens?: number }>(db, 'minimax');
  const m3DefaultMax = minimaxSettings?.m3DefaultMaxCompletionTokens ?? 131072;
  const resolvedModel = model;

  return {
    upstreamModel: resolvedModel.upstream_model,
    requestedModel: requestedName,
    provider,
    bodyTransform: (b: AnthropicBody | OpenAIBody) => {
      if (ADAPTIVE_THINKING_MODELS.has(resolvedModel.upstream_model) && b.thinking === undefined) {
        b.thinking = { type: 'adaptive' };
      }
      if (
        resolvedModel.name === 'MiniMax-M3' &&
        b.max_completion_tokens === undefined &&
        b.max_tokens === undefined
      ) {
        b.max_completion_tokens = m3DefaultMax;
      }
      if (b.thinking && b.reasoning_split === undefined) {
        b.reasoning_split = true;
      }
    },
  };
}
