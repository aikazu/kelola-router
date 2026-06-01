#!/usr/bin/env tsx
import { openDb } from "../src/db/index.js";
import { createUser } from "../src/db/repos/users.js";
import { log } from "../src/util/log.js";

const args = process.argv.slice(2);
const nameIdx = args.indexOf("--name");
const name = nameIdx >= 0 ? args[nameIdx + 1] : null;
if (!name) {
  console.error("Usage: add-user.ts --name <name>");
  process.exit(1);
}

const db = openDb();
const user = createUser(db, name);
log.info({ id: user.id, name: user.name }, "user created");
console.log(`User created: ${user.name}`);
console.log(`  api_key:  ${user.api_key}    (use for proxy requests)`);
console.log(`  admin_key: ${user.admin_key}    (use for /admin/* routes)`);