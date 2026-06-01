#!/usr/bin/env tsx
import { homedir } from "os";
import { join } from "path";
import { existsSync, unlinkSync, statSync } from "fs";
import { log } from "../src/util/log.js";

function defaultDbPath(): string {
  if (process.env.ROUTER_DB_PATH) return process.env.ROUTER_DB_PATH;
  const home = homedir();
  if (process.platform === "darwin") return join(home, "Library/Application Support/kelola-router/router.db");
  if (process.platform === "win32") return join(process.env.APPDATA || home, "kelola-router/router.db");
  return join(process.env.XDG_DATA_HOME || join(home, ".local/share"), "kelola-router/router.db");
}

const args = process.argv.slice(2);
const yes = args.includes("--yes") || args.includes("-y");
const dbPath = defaultDbPath();
const sidecars = [`${dbPath}-wal`, `${dbPath}-shm`];
const allPaths = [dbPath, ...sidecars];

const existing = allPaths.filter(p => existsSync(p));
if (existing.length === 0) {
  console.log(`No database to remove at ${dbPath}`);
  process.exit(0);
}

if (!yes) {
  console.error("Refusing to reset without --yes. This will delete:");
  for (const p of existing) {
    const size = statSync(p).size;
    console.error(`  ${p}  (${size} bytes)`);
  }
  console.error("Run with --yes to confirm.");
  process.exit(1);
}

for (const p of existing) {
  unlinkSync(p);
  log.info({ path: p }, "removed");
}
console.log(`Removed ${existing.length} file(s). Next start will recreate schema.`);
