import type Database from 'better-sqlite3';
import { getModel, type Model } from '../db/repos/models.js';
import { getSetting } from '../db/repos/settings.js';
import { resolveAlias } from './aliasCache.js';

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
  bodyTransform: (body: any) => void;
  requestedModel: string;
}

export function resolveModel(
  db: Database.Database,
  requestedName: string,
  _body: any
): ResolvedModel {
  const target = resolveAlias(db, requestedName);
  const model: Model | null = getModel(db, target);
  if (!model) throw new Error(`unknown model: ${requestedName}`);
  if (!model.enabled) throw new Error(`model disabled: ${requestedName}`);

  const minimaxSettings = getSetting<{ m3DefaultMaxCompletionTokens?: number }>(db, 'minimax');
  const m3DefaultMax = minimaxSettings?.m3DefaultMaxCompletionTokens ?? 131072;

  return {
    upstreamModel: model.upstream_model,
    requestedModel: requestedName,
    bodyTransform: (b: any) => {
      if (ADAPTIVE_THINKING_MODELS.has(model.upstream_model) && b.thinking === undefined) {
        b.thinking = { type: 'adaptive' };
      }
      if (
        model.name === 'MiniMax-M3' &&
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
