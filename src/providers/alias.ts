import type Database from "better-sqlite3";
import { getModel, type Model } from "../db/repos/models.js";
import { getSetting } from "../db/repos/settings.js";

export interface ResolvedModel {
  upstreamModel: string;
  bodyTransform: (body: any) => void;
}

export function resolveModel(db: Database.Database, requestedName: string, _body: any): ResolvedModel {
  const model: Model | null = getModel(db, requestedName);
  if (!model) throw new Error(`unknown model: ${requestedName}`);
  if (!model.enabled) throw new Error(`model disabled: ${requestedName}`);

  const minimaxSettings = getSetting<{ reasoningSplitDefault?: boolean; m3DefaultMaxCompletionTokens?: number }>(db, "minimax");
  const m3DefaultMax = minimaxSettings?.m3DefaultMaxCompletionTokens ?? 131072; // M3 recommended 128K
  const reasoningSplitDefault = minimaxSettings?.reasoningSplitDefault ?? false;

  return {
    upstreamModel: model.upstream_model,
    bodyTransform: (b: any) => {
      if (model.thinking_enabled && !b.thinking) {
        b.thinking = { type: "enabled", budget_tokens: model.thinking_budget ?? 4096 };
      }
      // M3: default max_completion_tokens if caller didn't set one
      if (model.name === "MiniMax-M3" && b.max_completion_tokens === undefined && b.max_tokens === undefined) {
        b.max_completion_tokens = m3DefaultMax;
      }
      // reasoning_split (OpenAI): when enabled, model returns reasoning_details separately
      if (reasoningSplitDefault && b.reasoning_split === undefined) {
        b.reasoning_split = true;
      }
    },
  };
}