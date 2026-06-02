import type Database from "better-sqlite3";
import { getModel, type Model } from "../db/repos/models.js";
import { getSetting } from "../db/repos/settings.js";

/**
 * Models that the MiniMax reference docs (docs/minimax-reference/) list as
 * supporting thinking. The router injects `thinking: { type: "adaptive" }`
 * for these models when the client has not already set `thinking`. Add a
 * model here when upstream ships a new thinking-capable variant.
 */
export const ADAPTIVE_THINKING_MODELS: ReadonlySet<string> = new Set([
  "MiniMax-M3",
  "MiniMax-M2.7",
  "MiniMax-M2.7-highspeed",
  "MiniMax-M2.5",
  "MiniMax-M2.5-highspeed",
  "MiniMax-M2.1",
  "MiniMax-M2.1-highspeed",
  "MiniMax-M2",
]);

/**
 * Retired built-in model names. Requests for these names resolve to their
 * modern equivalent so older clients keep working. Logged at warn-level on
 * first hit per process so production dashboards can surface migrations.
 */
export const LEGACY_MODEL_ALIASES: Record<string, string> = {
  "MiniMax-M2.7-thinking": "MiniMax-M2.7",
  "MiniMax-M3-thinking": "MiniMax-M3",
};

const legacyWarned = new Set<string>();
function warnLegacyOnce(name: string, target: string): void {
  if (legacyWarned.has(name)) return;
  legacyWarned.add(name);
  console.warn(`[alias] legacy model '${name}' → '${target}' (will be removed in a future release)`);
}

export interface ResolvedModel {
  upstreamModel: string;
  bodyTransform: (body: any) => void;
}

export function resolveModel(db: Database.Database, requestedName: string, _body: any): ResolvedModel {
  const target = LEGACY_MODEL_ALIASES[requestedName] ?? requestedName;
  if (target !== requestedName) warnLegacyOnce(requestedName, target);

  const model: Model | null = getModel(db, target);
  if (!model) throw new Error(`unknown model: ${requestedName}`);
  if (!model.enabled) throw new Error(`model disabled: ${requestedName}`);

  const minimaxSettings = getSetting<{ m3DefaultMaxCompletionTokens?: number }>(db, "minimax");
  const m3DefaultMax = minimaxSettings?.m3DefaultMaxCompletionTokens ?? 131072;

  return {
    upstreamModel: model.upstream_model,
    bodyTransform: (b: any) => {
      // Inject adaptive thinking for docs-listed models when the client
      // didn't set `thinking` themselves. The model itself decides whether
      // to think on each turn (per upstream docs).
      if (ADAPTIVE_THINKING_MODELS.has(model.upstream_model) && b.thinking === undefined) {
        b.thinking = { type: "adaptive" };
      }
      // M3: default max_completion_tokens if caller didn't set one
      if (model.name === "MiniMax-M3" && b.max_completion_tokens === undefined && b.max_tokens === undefined) {
        b.max_completion_tokens = m3DefaultMax;
      }
      // reasoning_split auto-on whenever thinking is present (router- or
      // client-injected). Explicit client value still wins.
      if (b.thinking && b.reasoning_split === undefined) {
        b.reasoning_split = true;
      }
    },
  };
}
