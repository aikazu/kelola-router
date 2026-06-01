#!/usr/bin/env tsx
import { ulid } from "ulid";
import { openDb } from "../src/db/index.js";
import { createAccount, listAccounts } from "../src/db/repos/accounts.js";
import { log } from "../src/util/log.js";

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : null;
}

const label = arg("label");
const creditType = arg("credit-type") as "payg" | "token-plan" | null;
const apiKey = arg("api-key");
const baseUrl = arg("base-url");

if (!label || !creditType || !apiKey) {
  console.error("Usage: add-account.ts --label <label> --credit-type payg|token-plan --api-key <minimax_key> [--base-url <url>]");
  process.exit(1);
}

const db = openDb();
const existing = listAccounts(db);
const account = createAccount(db, {
  id: `acc_${ulid()}`,
  label,
  credit_type: creditType,
  api_key: apiKey,
  base_url: baseUrl,
});
log.info({ id: account.id, label, credit_type: creditType }, "upstream account created");
console.log(`Upstream account created: ${account.label} (${account.id})`);
console.log(`  credit_type: ${creditType}`);
console.log(`  total accounts in pool: ${existing.length + 1}`);
