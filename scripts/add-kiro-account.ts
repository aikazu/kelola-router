#!/usr/bin/env tsx
/**
 * Add a Kiro (AWS CodeWhisperer) upstream account.
 *
 * Kiro authenticates with an OAuth *refresh token* (from `kiro-cli login` or the
 * Kiro IDE). The router stores that refresh token in the account's `api_key`
 * column, then mints + caches short-lived access tokens automatically.
 *
 * Two auth families:
 *   - Social auth (Builder ID via Kiro desktop): only the refresh token.
 *   - AWS SSO OIDC (IDC / corporate): also pass --client-id + --client-secret
 *     (+ optional --region, --profile-arn). authMethod is set to "idc".
 *
 * Examples:
 *   tsx scripts/add-kiro-account.ts --label kiro1 --refresh-token eyJ...
 *   tsx scripts/add-kiro-account.ts --label kiro-corp --refresh-token eyJ... \
 *     --client-id abc --client-secret def --region eu-central-1 \
 *     --profile-arn arn:aws:codewhisperer:eu-central-1:123:profile/XYZ
 */
import { ulid } from 'ulid';
import { openDb } from '../src/db/index.js';
import { createAccount, listEnabledAccountsByProvider } from '../src/db/repos/accounts.js';
import { log } from '../src/util/log.js';

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

const label = arg('label');
const refreshToken = arg('refresh-token');
const clientId = arg('client-id');
const clientSecret = arg('client-secret');
const region = arg('region');
const profileArn = arg('profile-arn');

if (!label || !refreshToken) {
  console.error(
    'Usage: add-kiro-account.ts --label <label> --refresh-token <token> ' +
      '[--client-id <id> --client-secret <secret>] [--region <region>] [--profile-arn <arn>]'
  );
  process.exit(1);
}

const providerData: Record<string, string> = {};
if (clientId && clientSecret) {
  providerData.clientId = clientId;
  providerData.clientSecret = clientSecret;
  providerData.authMethod = 'idc';
} else {
  providerData.authMethod = 'social';
}
if (region) providerData.region = region;
if (profileArn) providerData.profileArn = profileArn;

const db = openDb();
const existing = listEnabledAccountsByProvider(db, 'kiro');
const account = createAccount(db, {
  id: `acc_${ulid()}`,
  label,
  credit_type: 'payg',
  api_key: refreshToken, // Kiro: api_key holds the OAuth refresh token
  provider: 'kiro',
  provider_data: JSON.stringify(providerData),
});

log.info({ id: account.id, label, authMethod: providerData.authMethod }, 'kiro account created');
console.log(`Kiro account created: ${account.label} (${account.id})`);
console.log(`  auth method: ${providerData.authMethod}`);
console.log(`  total Kiro accounts: ${existing.length + 1}`);
console.log('Run `tsx scripts/seed-kiro-models.ts` if you have not seeded Kiro models yet.');
