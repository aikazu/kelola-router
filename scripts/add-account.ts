#!/usr/bin/env tsx
import type Database from 'better-sqlite3';
import { ulid } from 'ulid';
/**
 * Unified add-account CLI — inserts one upstream account into the `accounts` table.
 *
 * Dispatches on `--provider` (minimax | kiro | codebuddy) to a provider-specific
 * runner. Each runner ports the logic of the legacy per-provider script verbatim:
 *
 *   minimax   ← scripts/add-account.ts (pre-Task-36 minimax-only version)
 *   kiro      ← scripts/add-kiro-account.ts        (deleted in Task 37)
 *   codebuddy ← scripts/add-codebuddy-account.ts   (deleted in Task 37)
 *
 * Behavior is a pure consolidation — no semantic changes. The old scripts remain
 * untouched in this task so they can be diffed against this implementation.
 *
 * Examples:
 *   tsx scripts/add-account.ts --provider minimax --label main \
 *     --credit-type payg --api-key mm_xxx [--base-url https://api.minimax.io]
 *
 *   tsx scripts/add-account.ts --provider kiro --label kiro1 \
 *     --refresh-token eyJ... [--client-id i --client-secret s] [--region eu-central-1] \
 *     [--profile-arn arn:...]
 *
 *   tsx scripts/add-account.ts --provider codebuddy --api-key cb_xxx \
 *     [--label my-cb] [--base-url https://www.codebuddy.ai]
 *
 *   tsx scripts/add-account.ts --provider pioneer --api-key pio_sk_xxx \
 *     [--label my-pio] [--base-url https://api.pioneer.ai]
 *
 * Exit codes: 0 on success, 1 on validation or runtime error.
 */
import * as v from 'valibot';
import { openDb } from '../src/db/index.js';
import {
  type Account,
  createAccount,
  listAccounts,
  listEnabledAccountsByProvider,
} from '../src/db/repos/accounts.js';
import { seedModelsForProviderBestEffort } from '../src/db/seedBuiltinModels.js';
import { log } from '../src/util/log.js';
import {
  type AddAccountArgs,
  type CodeBuddyArgs,
  type KiroArgs,
  type MinimaxArgs,
  type PioneerArgs,
  parseArgs,
  type TabiArgs,
  type ZaiArgs,
} from './add-account.cliArgs.js';

// ---------------------------------------------------------------------------
// Per-provider dispatchers
// ---------------------------------------------------------------------------
// Each takes an already-open `db` handle (so tests inject a tmp DB) and the
// validated args union member for its provider. Returns the created Account.
// Side effects mirror the legacy script exactly: DB insert + identical log/console lines.

/**
 * Minimax runner — ports the pre-Task-36 `scripts/add-account.ts` (minimax-only).
 * Stores the long-lived MiniMax API key directly in `api_key`.
 */
export function runMinimax(db: Database.Database, args: MinimaxArgs): Account {
  const account = createAccount(db, {
    id: `acc_${ulid()}`,
    label: args.label,
    credit_type: args.creditType,
    api_key: args.apiKey,
    base_url: args.baseUrl ?? null,
    provider: 'minimax',
  });

  const total = listAccounts(db).length;
  log.info(
    { id: account.id, label: args.label, credit_type: args.creditType },
    'upstream account created'
  );
  console.log(`Upstream account created: ${account.label} (${account.id})`);
  console.log(`  credit_type: ${args.creditType}`);
  console.log(`  total accounts in pool: ${total}`);
  return account;
}

/**
 * Kiro runner — ports `scripts/add-kiro-account.ts`.
 *
 * The OAuth *refresh token* is stored in `api_key`; the router mints short-lived
 * access tokens from it at request time. `provider_data` carries the auth family:
 *   - social (Builder ID): just the refresh token
 *   - idc (corporate SSO): clientId + clientSecret + optional region/profileArn
 */
export function runKiro(db: Database.Database, args: KiroArgs): Account {
  const providerData: Record<string, string> = {};
  if (args.clientId && args.clientSecret) {
    providerData.clientId = args.clientId;
    providerData.clientSecret = args.clientSecret;
    providerData.authMethod = 'idc';
  } else {
    providerData.authMethod = 'social';
  }
  if (args.region) providerData.region = args.region;
  if (args.profileArn) providerData.profileArn = args.profileArn;

  const total = listEnabledAccountsByProvider(db, 'kiro').length + 1;
  const account = createAccount(db, {
    id: `acc_${ulid()}`,
    label: args.label,
    credit_type: 'payg',
    api_key: args.refreshToken, // Kiro: api_key holds the OAuth refresh token
    provider: 'kiro',
    provider_data: JSON.stringify(providerData),
  });

  log.info(
    { id: account.id, label: args.label, authMethod: providerData.authMethod },
    'kiro account created'
  );
  console.log(`Kiro account created: ${account.label} (${account.id})`);
  console.log(`  auth method: ${providerData.authMethod}`);
  console.log(`  total Kiro accounts: ${total}`);
  return account;
}

/**
 * CodeBuddy runner — ports `scripts/add-codebuddy-account.ts`.
 *
 * The legacy script took positional args; the unified schema uses --flags. The
 * default-label fallback (`codebuddy-<ulid8>`) and default base URL are preserved.
 */
export function runCodeBuddy(db: Database.Database, args: CodeBuddyArgs): Account {
  const id = `acc_${ulid()}`;
  const label = args.label ?? `codebuddy-${id.slice(4, 12).toLowerCase()}`;
  const baseUrl = args.baseUrl ?? 'https://www.codebuddy.ai';

  const account = createAccount(db, {
    id,
    label,
    credit_type: 'token-plan',
    api_key: args.apiKey,
    base_url: baseUrl,
    provider: 'codebuddy',
    enabled: true,
  });

  console.log(`\u2713 Added CodeBuddy account: ${label} (${id})`);
  console.log(`  Base URL: ${baseUrl}`);
  console.log('');
  console.log('\u26a0 Remember to assign a residential proxy (proxy_pool or proxy_id)');
  console.log('  via the admin dashboard — CodeBuddy blocks datacenter IPs.');
  return account;
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/**
 * Pioneer runner — same shape as CodeBuddy but with a different default base
 * URL and Pioneer's `X-API-Key` HTTP auth header.
 */
export function runPioneer(db: Database.Database, args: PioneerArgs): Account {
  const id = `acc_${ulid()}`;
  const label = args.label ?? `pioneer-${id.slice(4, 12).toLowerCase()}`;
  const baseUrl = args.baseUrl ?? 'https://api.pioneer.ai';

  const account = createAccount(db, {
    id,
    label,
    credit_type: 'payg',
    api_key: args.apiKey,
    base_url: baseUrl,
    provider: 'pioneer',
    enabled: true,
  });

  console.log(`✓ Added Pioneer account: ${label} (${id})`);
  console.log(`  Base URL: ${baseUrl}`);
  console.log('  Pioneer bills per credit; pricing in the dashboard is seeded at zero.');
  return account;
}

/**
 * Z.AI runner — Bearer API key auth. Defaults to the dual base URLs defined
 * in `src/providers/zai/index.ts` (Anthropic Messages + OpenAI Chat
 * Completions) but a custom `--base-url` lets users point at a private
 * gateway or alternate region.
 */
export function runZai(db: Database.Database, args: ZaiArgs): Account {
  const id = `acc_${ulid()}`;
  const label = args.label ?? `zai-${id.slice(4, 12).toLowerCase()}`;
  const baseUrl = args.baseUrl ?? null; // null lets executeZai fall back to provider defaults per clientFormat

  const account = createAccount(db, {
    id,
    label,
    credit_type: 'payg',
    api_key: args.apiKey,
    base_url: baseUrl,
    provider: 'zai',
    enabled: true,
  });

  console.log(`✓ Added Z.AI account: ${label} (${id})`);
  console.log(
    `  Routes: Anthropic Messages → ${baseUrl ? `${baseUrl}/v1/messages` : 'https://api.z.ai/api/anthropic/v1/messages'}, OpenAI Chat → ${baseUrl ? `${baseUrl}/chat/completions` : 'https://api.z.ai/api/coding/paas/v4/chat/completions'}`
  );
  console.log('  Z.AI is a flat-rate subscription; pricing in the dashboard is seeded at zero.');
  return account;
}

/**
 * TabiToken runner — Bearer API key auth. Defaults to the gateway's API
 * server `https://tabitoken.cc` (`/v1/chat/completions`) — the `.com` front
 * is Cloudflare-WAF'd and blocks non-browser user agents; a custom
 * `--base-url` lets users point at a mirror / alternate gateway.
 */
export function runTabi(db: Database.Database, args: TabiArgs): Account {
  const id = `acc_${ulid()}`;
  const label = args.label ?? `tabi-${id.slice(4, 12).toLowerCase()}`;
  const baseUrl = args.baseUrl ?? 'https://tabitoken.cc';

  const account = createAccount(db, {
    id,
    label,
    credit_type: 'payg',
    api_key: args.apiKey,
    base_url: baseUrl,
    provider: 'tabi',
    enabled: true,
  });

  console.log(`✓ Added TabiToken account: ${label} (${id})`);
  console.log(`  Base URL: ${baseUrl}`);
  console.log('  TabiToken is an OpenAI-compatible reseller gateway; clients call tabi/<model>.');
  return account;
}

export async function dispatch(db: Database.Database, args: AddAccountArgs): Promise<Account> {
  let account: Account;
  let apiKey: string | undefined;
  let baseUrl: string | undefined;
  switch (args.provider) {
    case 'minimax':
      account = runMinimax(db, args);
      apiKey = args.apiKey;
      baseUrl = args.baseUrl;
      break;
    case 'kiro':
      account = runKiro(db, args);
      break;
    case 'codebuddy':
      account = runCodeBuddy(db, args);
      break;
    case 'pioneer':
      account = runPioneer(db, args);
      apiKey = args.apiKey;
      baseUrl = args.baseUrl;
      break;
    case 'zai':
      account = runZai(db, args);
      apiKey = args.apiKey;
      baseUrl = args.baseUrl;
      break;
    case 'tabi':
      account = runTabi(db, args);
      apiKey = args.apiKey;
      baseUrl = args.baseUrl;
      break;
  }

  // Seed the provider's model catalogue now that the account exists, mirroring
  // the dashboard's add-account flow (live fetch for minimax/pioneer, builtins
  // for kiro/codebuddy). Best-effort: a seed failure must not fail the add.
  const seeded = await seedModelsForProviderBestEffort(db, args.provider, { apiKey, baseUrl });
  if (seeded > 0) console.log(`  Imported ${seeded} model${seeded === 1 ? '' : 's'}.`);

  return account;
}

// ---------------------------------------------------------------------------
// Main entry (executed only when run directly, not on import)
// ---------------------------------------------------------------------------

const USAGE_MINIMAX =
  '  minimax:   add-account --provider minimax --label <l> --credit-type payg|token-plan --api-key <k> [--base-url <u>]';
const USAGE_KIRO =
  '  kiro:      add-account --provider kiro --label <l> --refresh-token <t> [--client-id <i> --client-secret <s>] [--region <r>] [--profile-arn <a>]';
const USAGE_CODEBUDDY =
  '  codebuddy: add-account --provider codebuddy --api-key <k> [--label <l>] [--base-url <u>]';
const USAGE_PIONEER =
  '  pioneer:   add-account --provider pioneer --api-key <k> [--label <l>] [--base-url <u>]';
const USAGE_ZAI =
  '  zai:       add-account --provider zai --api-key <k> [--label <l>] [--base-url <u>]';
const USAGE_TABI =
  '  tabi:      add-account --provider tabi --api-key <k> [--label <l>] [--base-url <u>]';

export async function main(argv: string[]): Promise<void> {
  let args: AddAccountArgs;
  try {
    args = parseArgs(argv);
  } catch (err) {
    if (err instanceof v.ValiError) {
      console.error(`Error: ${err.message}`);
      for (const issue of err.issues) {
        if (issue.message) console.error(`  - ${issue.message}`);
      }
      console.error('');
      console.error('Usage:');
      console.error(USAGE_MINIMAX);
      console.error(USAGE_KIRO);
      console.error(USAGE_CODEBUDDY);
      console.error(USAGE_PIONEER);
      console.error(USAGE_ZAI);
      console.error(USAGE_TABI);
    } else {
      console.error('Unexpected error parsing arguments:', err);
    }
    process.exitCode = 1;
    return;
  }

  try {
    const db = openDb();
    await dispatch(db, args);
  } catch (err) {
    console.error('Failed to create account:', err);
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2));
}
