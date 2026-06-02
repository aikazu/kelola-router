import { Hono } from "hono";
import type Database from "better-sqlite3";
import { requireAdminJson } from "./middleware.js";
import { csrfGuard } from "../../auth.js";
import { authRoutes } from "./auth.js";
import { overviewRoutes } from "./overview.js";
import { usageRoutes } from "./usage.js";
import { requestLogRoutes } from "./requestLogs.js";
import { clientKeyRoutes } from "./clientKeys.js";
import { accountRoutes } from "./accounts.js";
import { modelRoutes } from "./models.js";
import { quotaRoutes } from "./quota.js";
import { settingsRoutes } from "./settings.js";

export function adminApi(db: Database.Database): Hono {
  const app = new Hono();
  app.use("*", async (c, next) => { c.set("db", db); await next(); });
  app.use("/admin/*", requireAdminJson);
  app.use("*", csrfGuard);
  app.route("/", authRoutes);
  app.route("/admin", overviewRoutes);
  app.route("/admin", usageRoutes);
  app.route("/admin", requestLogRoutes);
  app.route("/admin/client-keys", clientKeyRoutes);
  app.route("/admin/accounts", accountRoutes);
  app.route("/admin/models", modelRoutes);
  app.route("/admin", quotaRoutes);
  app.route("/admin/settings", settingsRoutes);
  return app;
}
