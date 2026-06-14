#!/usr/bin/env tsx
/**
 * Add a CodeBuddy account to kelola-router.
 *
 * Usage:
 *   bun scripts/add-codebuddy-account.ts <api_key> [label] [base_url]
 *
 * The API key is a long-lived token created by the sidecar via CodeBuddy's
 * /console/api/client/v1/api-keys endpoint after Google OAuth login.
 *
 * Accounts should be assigned a proxy_pool or proxy_id pointing to a
 * residential proxy — CodeBuddy's APISIX gateway blocks datacenter IPs.
 */
import { ulid } from 'ulid';
import { openDb } from '../src/db/index.js';
import { createAccount } from '../src/db/repos/accounts.js';

const [apiKey, label, baseUrl] = process.argv.slice(2);

if (!apiKey) {
  console.error('Usage: bun scripts/add-codebuddy-account.ts <api_key> [label] [base_url]');
  console.error('');
  console.error('  api_key   - CodeBuddy API key (Bearer token)');
  console.error('  label     - Human-friendly label (default: codebuddy-<ulid>)');
  console.error('  base_url  - Override upstream URL (default: https://www.codebuddy.ai)');
  process.exit(1);
}

const db = openDb();
const id = `acc_${ulid()}`;
const accountLabel = label || `codebuddy-${id.slice(4, 12).toLowerCase()}`;

createAccount(db, {
  id,
  label: accountLabel,
  credit_type: 'token-plan',
  api_key: apiKey,
  base_url: baseUrl || 'https://www.codebuddy.ai',
  provider: 'codebuddy',
  enabled: true,
});

console.log(`✓ Added CodeBuddy account: ${accountLabel} (${id})`);
console.log(`  Base URL: ${baseUrl || 'https://www.codebuddy.ai'}`);
console.log('');
console.log('⚠ Remember to assign a residential proxy (proxy_pool or proxy_id)');
console.log('  via the admin dashboard — CodeBuddy blocks datacenter IPs.');
