import { Hono } from "hono";
import type Database from "better-sqlite3";
import { listModels, enableModel, disableModel } from "../../db/repos/models.js";
import { handleApiError } from "./middleware.js";

export const modelRoutes = new Hono();

modelRoutes.get("/", (c) => {
  try {
    const db = c.get("db") as Database.Database;
    return c.json(listModels(db, { includeDisabled: true }).map(m => ({
      name: m.name, displayName: m.display_name, family: m.family,
      contextWindow: m.context_window, thinkingEnabled: !!m.thinking_enabled,
      source: m.source, enabled: !!m.enabled,
    })));
  } catch (e) { return handleApiError(e); }
});

modelRoutes.post("/:name/disable", (c) => {
  try {
    disableModel(c.get("db") as Database.Database, decodeURIComponent(c.req.param("name")));
    return new Response(null, { status: 204 });
  } catch (e) { return handleApiError(e); }
});

modelRoutes.post("/:name/enable", (c) => {
  try {
    enableModel(c.get("db") as Database.Database, decodeURIComponent(c.req.param("name")));
    return new Response(null, { status: 204 });
  } catch (e) { return handleApiError(e); }
});

modelRoutes.post("/fetch", (c) => {
  try {
    // Placeholder: actual upstream fetch is in src/server.ts. We just touch upsertModel to validate route.
    const db = c.get("db") as Database.Database;
    const before = listModels(db).length;
    return c.json({ added: 0, updated: 0, total: before });
  } catch (e) { return handleApiError(e); }
});
