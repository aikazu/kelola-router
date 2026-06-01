import type Database from "better-sqlite3";
import { getModel, type Model } from "../db/repos/models.js";

export interface ResolvedModel {
  upstreamModel: string;
  bodyTransform: (body: any) => void;
}

export function resolveModel(db: Database.Database, requestedName: string, _body: any): ResolvedModel {
  const model: Model | null = getModel(db, requestedName);
  if (!model) throw new Error(`unknown model: ${requestedName}`);
  if (!model.enabled) throw new Error(`model disabled: ${requestedName}`);

  return {
    upstreamModel: model.upstream_model,
    bodyTransform: (b: any) => {
      if (model.thinking_enabled && !b.thinking) {
        b.thinking = { type: "enabled", budget_tokens: model.thinking_budget ?? 4096 };
      }
    },
  };
}