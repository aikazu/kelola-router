#!/usr/bin/env tsx
/**
 * Notion account CLI — 3-step login + cookie storage + model manifest seed.
 *
 * Usage:
 *   tsx scripts/notion-add-account.ts --label personal --email user@example.com
 *
 * Flow:
 *   1. getLoginOptions → check hasAccount + passwordSignIn
 *   2. sendTemporaryPassword → email 6-char temp password
 *   3. read password from stdin → loginWithEmail → cookies + userId
 *   4. (optional) getAvailableModels → verify AI eligibility, capture spaceId
 *   5. insert accounts row with provider_data JSON containing cookies + spaceId
 *   6. seed models from manifest.json
 *
 * Exit codes: 0 success, 1 invalid args, 2 auth failed, 3 ineligible for AI.
 */
import { randomUUID } from 'node:crypto';
import { argv, stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { ulid } from 'ulid';
import { openDb } from '../src/db/index.js';
import { createAccount, listEnabledAccountsByProvider } from '../src/db/repos/accounts.js';
import { seedModelsForProviderBestEffort } from '../src/db/seedBuiltinModels.js';
import { NOTION_BASE, NOTION_CLIENT_VERSION } from '../src/providers/notion/constants.js';

function arg(name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

interface LoginOptions {
  hasAccount: boolean;
  passwordSignIn: boolean;
  loginOptionsToken: string;
}

interface TempPasswordResponse {
  csrfState: string;
}

interface LoginWithEmailResponse {
  isNewSignup: boolean;
  userId: string;
}

function parseSetCookie(headerValue: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headerValue) return out;
  const segments = headerValue.split(/,\s*(?=[a-zA-Z0-9_-]+=)/);
  for (const seg of segments) {
    const m = seg.trim().match(/^([^=]+)=((?:"[^"]*"|[^;]*))/);
    if (m) out[m[1].trim()] = m[2].trim().replace(/^"|"$/g, '');
  }
  return out;
}

async function postJson<T>(
  path: string,
  body: unknown
): Promise<{ status: number; json: T; setCookie: string | null }> {
  const res = await fetch(`${NOTION_BASE}${path}`, {
    method: 'POST',
    headers: {
      'notion-client-version': NOTION_CLIENT_VERSION,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const setCookie = res.headers.get('set-cookie');
  const text = await res.text();
  let json: T;
  try {
    json = JSON.parse(text) as T;
  } catch {
    json = text as unknown as T;
  }
  return { status: res.status, json, setCookie };
}

async function main(): Promise<number> {
  const label = arg('label');
  const email = arg('email');
  if (!label || !email) {
    console.error('usage: notion-add-account --label <name> --email <addr>');
    return 1;
  }

  // Step 1
  console.log('Checking Notion account...');
  const step1 = await postJson<LoginOptions>('/api/v3/getLoginOptions', {
    email,
    requireWorkTypeEmail: false,
  });
  if (step1.status !== 200) {
    console.error(`getLoginOptions HTTP ${step1.status}:`, step1.json);
    return 2;
  }
  if (!step1.json.hasAccount) {
    console.error(`No Notion account for ${email}`);
    return 2;
  }
  if (step1.json.passwordSignIn) {
    console.error('Account requires password login (not supported by router v1)');
    return 2;
  }
  console.log('Account exists');

  // Step 2
  const deviceId = randomUUID();
  console.log(`Sending temporary password to ${email}...`);
  const step2 = await postJson<TempPasswordResponse>('/api/v3/sendTemporaryPassword', {
    email,
    redirectURL: '/',
    disableLoginLink: false,
    native: true,
    isSignup: false,
    shouldHidePasscode: false,
    loginOptionsToken: step1.json.loginOptionsToken,
    deviceId,
    appSource: 'notion',
    loginRouteOrigin: 'login',
  });
  if (step2.status !== 200) {
    console.error(`sendTemporaryPassword HTTP ${step2.status}:`, step2.json);
    return 2;
  }

  // Step 3
  const rl = createInterface({ input: stdin, output: stdout });
  const password = (await rl.question('Enter 6-character password from email: ')).trim();
  rl.close();
  if (!password) {
    console.error('No password provided');
    return 2;
  }

  const step3 = await fetch(`${NOTION_BASE}/api/v3/loginWithEmail`, {
    method: 'POST',
    headers: {
      'notion-client-version': NOTION_CLIENT_VERSION,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      state: step2.json.csrfState,
      password,
      appSource: 'notion',
      loginRouteOrigin: 'login',
    }),
  });
  const setCookieHeader = step3.headers.get('set-cookie');
  const loginCookies = parseSetCookie(setCookieHeader);
  const loginBody = (await step3.json()) as LoginWithEmailResponse;
  if (step3.status !== 200) {
    console.error(`loginWithEmail HTTP ${step3.status}:`, loginBody);
    return 2;
  }
  console.log(`Logged in (userId=${loginBody.userId})`);

  // Step 4: fetch spaceId via getAvailableModels
  let spaceId: string | undefined;
  // The first model request from a thread usually requires a spaceId. We can
  // pull it from the getAvailableModels response context if present, else
  // require user to provide it via --space-id flag.
  spaceId = arg('space-id');
  if (!spaceId) {
    console.log('No --space-id provided; will be populated on first chat request.');
    console.log('To populate manually, run a chat request then update the DB:');
    console.log(
      `  UPDATE accounts SET provider_data = json_set(provider_data, '$.spaceId', '<uuid>') WHERE id = '<account-id>';`
    );
  }

  // Step 5: insert into DB
  const db = openDb();
  try {
    const id = ulid();
    const providerData = JSON.stringify({
      cookies: loginCookies,
      userId: loginBody.userId,
      deviceId,
      spaceId: spaceId ?? null,
      cookiesFetchedAt: new Date().toISOString(),
    });

    createAccount(db, {
      id,
      label,
      credit_type: 'token-plan', // Notion AI is subscription-based
      api_key: loginBody.userId, // use userId as api_key (Notion has no API key)
      enabled: true,
      provider: 'notion',
      provider_data: providerData,
    });
    console.log(`✓ Account '${label}' added (id=${id})`);

    // Step 6: seed models
    const added = await seedModelsForProviderBestEffort(db, 'notion');
    console.log(`✓ Seeded ${added} Notion model(s)`);

    // Show account
    const accounts = listEnabledAccountsByProvider(db, 'notion');
    console.log(`\nTotal Notion accounts: ${accounts.length}`);
  } finally {
    db.close();
  }

  return 0;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error('Fatal:', e);
    process.exit(99);
  }
);
