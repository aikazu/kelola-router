#!/usr/bin/env tsx
import { ulid } from "ulid";
import { openDb } from "../src/db/index.js";
import { createAccount, listAccountsByUser } from "../src/db/repos/accounts.js";
import { log } from "../src/util/log.js";

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : null;
}

const userId = arg("user");
const label = arg("label");
const creditType = arg("credit-type") as "payg" | "token-plan" | null;
const apiKey = arg("api-key");
const baseUrl = arg("base-url");

if (!userId || !label || !creditType || !apiKey) {
  console.error("Usage: add-account.ts --user <id> --label <label> --credit-type payg|token-plan --api-key <key> [--base-url <url>]");
  process.exit(1);
}

const db = openDb();
const existing = listAccountsByUser(db, parseInt(userId, 10));
const account = createAccount(db, {
  id: `acc_${ulid()}`,
  user_id: parseInt(userId, 10),
  label,
  credit_type: creditType,
  api_key: apiKey,
  base_url: baseUrl,
  position: existing.length,
});
log.info({ id: account.id, label }, "account created");
console.log(`Account created: ${account.label} (${account.id})`);