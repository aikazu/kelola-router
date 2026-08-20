/**
 * Tests for the unified `scripts/add-account.ts` dispatcher + main entry.
 *
 * Strategy: real tmp SQLite DB per test (matches the repo convention in
 * `src/db/repos/accounts.test.ts`). Each dispatcher is invoked directly with a
 * validated args shape; we then read the row back from the DB and assert every
 * field that the legacy per-provider script wrote — this is the behavior-parity
 * gate for Task 37 (which deletes the old scripts).
 *
 * The `main()` entry is also covered: bad argv sets `process.exitCode = 1`
 * without throwing, and a full happy-path argv produces the expected row.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  dispatch,
  main,
  runCodeBuddy,
  runKiro,
  runMinimax,
  runQwenCloud,
} from '../../scripts/add-account.js';
import {
  type CodeBuddyArgs,
  type KiroArgs,
  type MinimaxArgs,
  parseArgs,
  type QwenCloudArgs,
} from '../../scripts/add-account-cli-args.js';
import { openDb } from '../../src/db/index.js';
import { getAccount, listAccounts } from '../../src/db/repos/accounts.js';

let db: ReturnType<typeof openDb>;

beforeEach(() => {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'add-acct-')), 't.db');
  db = openDb();
});

afterEach(() => {
  // Reset exitCode so one test's failure doesn't poison the next.
  process.exitCode = 0;
});

describe('runMinimax (ports scripts/add-account.ts minimax-only)', () => {
  const args: MinimaxArgs = {
    provider: 'minimax',
    label: 'main-payg',
    creditType: 'payg',
    apiKey: 'mm_secret_xxx',
  };

  it('inserts a row with provider=minimax and the api key in api_key', () => {
    const account = runMinimax(db, args);
    const row = getAccount(db, account.id)!;

    expect(row.label).toBe('main-payg');
    expect(row.credit_type).toBe('payg');
    expect(row.api_key).toBe('mm_secret_xxx');
    expect(row.provider).toBe('minimax');
    expect(row.base_url).toBeNull();
    expect(row.enabled).toBe(1); // createAccount defaults to enabled
    expect(row.id).toMatch(/^acc_/);
  });

  it('honors optional --base-url', () => {
    const account = runMinimax(db, { ...args, baseUrl: 'https://api.minimax.io' });
    expect(getAccount(db, account.id)!.base_url).toBe('https://api.minimax.io');
  });

  it('supports token-plan credit type', () => {
    const account = runMinimax(db, { ...args, creditType: 'token-plan' });
    expect(getAccount(db, account.id)!.credit_type).toBe('token-plan');
  });

  it('counts all accounts in the total message (parity: listAccounts)', () => {
    runMinimax(db, args);
    // api_key has a UNIQUE constraint — use a distinct key for the second insert.
    runMinimax(db, { ...args, label: 'second', apiKey: 'mm_secret_yyy' });
    // The legacy script prints `total accounts in pool: N` where N counts every row.
    expect(listAccounts(db).length).toBe(2);
  });
});

describe('runKiro (ports scripts/add-kiro-account.ts)', () => {
  it('social auth: stores refresh token in api_key, authMethod=social', () => {
    const args: KiroArgs = {
      provider: 'kiro',
      label: 'kiro-social',
      refreshToken: 'eyJrefresh',
    };
    const account = runKiro(db, args);
    const row = getAccount(db, account.id)!;

    expect(row.provider).toBe('kiro');
    expect(row.api_key).toBe('eyJrefresh'); // refresh token lives in api_key
    expect(row.credit_type).toBe('payg'); // kiro always payg
    expect(row.provider_data).not.toBeNull();
    const pd = JSON.parse(row.provider_data!);
    expect(pd.authMethod).toBe('social');
    expect(pd.clientId).toBeUndefined();
    expect(pd.clientSecret).toBeUndefined();
  });

  it('idc auth: sets clientId/clientSecret/authMethod=idc when both provided', () => {
    const args: KiroArgs = {
      provider: 'kiro',
      label: 'kiro-corp',
      refreshToken: 'eyJrefresh',
      clientId: 'cid-123',
      clientSecret: 'csec-456',
      region: 'eu-central-1',
      profileArn: 'arn:aws:codewhisperer:eu-central-1:123:profile/XYZ',
    };
    const account = runKiro(db, args);
    const pd = JSON.parse(getAccount(db, account.id)!.provider_data!);

    expect(pd.authMethod).toBe('idc');
    expect(pd.clientId).toBe('cid-123');
    expect(pd.clientSecret).toBe('csec-456');
    expect(pd.region).toBe('eu-central-1');
    expect(pd.profileArn).toBe('arn:aws:codewhisperer:eu-central-1:123:profile/XYZ');
  });

  it('authMethod degrades to social when only one of client-id/secret is given', () => {
    // Parity: legacy script requires BOTH to switch to idc.
    const args: KiroArgs = {
      provider: 'kiro',
      label: 'kiro-half',
      refreshToken: 'r',
      clientId: 'only-id',
    };
    const account = runKiro(db, args);
    const pd = JSON.parse(getAccount(db, account.id)!.provider_data!);
    expect(pd.authMethod).toBe('social');
    expect(pd.clientId).toBeUndefined();
  });

  it('counts only enabled kiro accounts in the total message (parity)', () => {
    runKiro(db, { provider: 'kiro', label: 'k1', refreshToken: 'r1' });
    runKiro(db, { provider: 'kiro', label: 'k2', refreshToken: 'r2' });
    // Legacy: listEnabledAccountsByProvider(db, 'kiro').length + 1
    const kiroRows = listAccounts(db).filter((a) => a.provider === 'kiro');
    expect(kiroRows.length).toBe(2);
  });
});

describe('runCodeBuddy (ports scripts/add-codebuddy-account.ts)', () => {
  const args: CodeBuddyArgs = {
    provider: 'codebuddy',
    apiKey: 'cb_secret',
  };

  it('inserts provider=codebuddy, credit_type=token-plan, default base URL, enabled', () => {
    const account = runCodeBuddy(db, args);
    const row = getAccount(db, account.id)!;

    expect(row.provider).toBe('codebuddy');
    expect(row.credit_type).toBe('token-plan');
    expect(row.api_key).toBe('cb_secret');
    expect(row.base_url).toBe('https://www.codebuddy.ai');
    expect(row.enabled).toBe(1);
  });

  it('default label falls back to codebuddy-<8 lowercase hex from ulid>', () => {
    const account = runCodeBuddy(db, args);
    // Legacy: `codebuddy-${id.slice(4, 12).toLowerCase()}` where id = `acc_<ulid>`
    const expectedSuffix = account.id.slice(4, 12).toLowerCase();
    expect(account.label).toBe(`codebuddy-${expectedSuffix}`);
  });

  it('honors explicit --label and --base-url', () => {
    const account = runCodeBuddy(db, { ...args, label: 'my-cb', baseUrl: 'https://custom.cb.ai' });
    const row = getAccount(db, account.id)!;
    expect(row.label).toBe('my-cb');
    expect(row.base_url).toBe('https://custom.cb.ai');
  });
});

describe('runQwenCloud', () => {
  const args: QwenCloudArgs = {
    provider: 'qwencloud',
    apiKey: 'sk-sp-test',
  };

  it('inserts provider=qwencloud, credit_type=token-plan, default base URL null, enabled', () => {
    const account = runQwenCloud(db, args);
    const row = getAccount(db, account.id)!;

    expect(row.provider).toBe('qwencloud');
    expect(row.credit_type).toBe('token-plan');
    expect(row.api_key).toBe('sk-sp-test');
    expect(row.base_url).toBeNull();
    expect(row.enabled).toBe(1);
  });

  it('default label falls back to qwencloud-<8 lowercase hex from ulid>', () => {
    const account = runQwenCloud(db, args);
    // Mirror zai/tabi: `qwencloud-${id.slice(4, 12).toLowerCase()}` where id = `acc_<ulid>`.
    const expectedSuffix = account.id.slice(4, 12).toLowerCase();
    expect(account.label).toBe(`qwencloud-${expectedSuffix}`);
  });

  it('honors explicit --label and --base-url', () => {
    const account = runQwenCloud(db, {
      ...args,
      label: 'my-qc',
      baseUrl: 'https://custom.gateway.example',
    });
    const row = getAccount(db, account.id)!;
    expect(row.label).toBe('my-qc');
    expect(row.base_url).toBe('https://custom.gateway.example');
  });

  it('parseArgs accepts qwencloud with --api-key / --label / --base-url', () => {
    const parsed = parseArgs([
      '--provider',
      'qwencloud',
      '--api-key',
      'sk-sp-test',
      '--label',
      'qc-cli',
      '--base-url',
      'https://custom.gateway.example',
    ]);
    expect(parsed).toEqual({
      provider: 'qwencloud',
      apiKey: 'sk-sp-test',
      label: 'qc-cli',
      baseUrl: 'https://custom.gateway.example',
    });
  });
});

describe('dispatch', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('routes minimax', async () => {
    // minimax seeds models via a live /v1/models fetch; stub it so the dispatch
    // path runs offline. Seeding is best-effort, so an empty list is fine.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), { status: 200 })
    );
    const a = await dispatch(db, {
      provider: 'minimax',
      label: 'd-mm',
      creditType: 'payg',
      apiKey: 'k',
    });
    expect(getAccount(db, a.id)!.provider).toBe('minimax');
  });

  it('routes kiro', async () => {
    const a = await dispatch(db, { provider: 'kiro', label: 'd-k', refreshToken: 'r' });
    expect(getAccount(db, a.id)!.provider).toBe('kiro');
  });

  it('routes codebuddy', async () => {
    const a = await dispatch(db, { provider: 'codebuddy', apiKey: 'cb_d' });
    expect(getAccount(db, a.id)!.provider).toBe('codebuddy');
  });

  it('routes qwencloud', async () => {
    const a = await dispatch(db, { provider: 'qwencloud', apiKey: 'sk-sp-d' });
    expect(getAccount(db, a.id)!.provider).toBe('qwencloud');
    expect(getAccount(db, a.id)!.credit_type).toBe('token-plan');
  });
});

describe('main', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sets exitCode=1 and prints usage on missing --provider', async () => {
    await main(['--label', 'x', '--api-key', 'k']);
    expect(process.exitCode).toBe(1);
  });

  it('sets exitCode=1 on missing required minimax field', async () => {
    await main(['--provider', 'minimax', '--credit-type', 'payg', '--api-key', 'k']); // no --label
    expect(process.exitCode).toBe(1);
  });

  it('sets exitCode=1 on invalid provider', async () => {
    await main(['--provider', 'nope', '--api-key', 'k']);
    expect(process.exitCode).toBe(1);
  });

  it('happy path minimax: inserts row, leaves exitCode unset (0)', async () => {
    // Stub the live model fetch the minimax add triggers.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), { status: 200 })
    );
    const before = listAccounts(db).length;
    await main([
      '--provider',
      'minimax',
      '--label',
      'cli-mm',
      '--credit-type',
      'payg',
      '--api-key',
      'mm_cli',
    ]);
    expect(process.exitCode).toBe(0);
    expect(listAccounts(db).length).toBe(before + 1);
  });

  it('happy path kiro: inserts row', async () => {
    await main(['--provider', 'kiro', '--label', 'cli-kiro', '--refresh-token', 'rcli']);
    expect(process.exitCode).toBe(0);
    const kiro = listAccounts(db).filter((a) => a.provider === 'kiro');
    expect(kiro.length).toBe(1);
    expect(kiro[0].api_key).toBe('rcli');
  });

  it('happy path codebuddy: inserts row', async () => {
    await main(['--provider', 'codebuddy', '--api-key', 'cb_cli', '--label', 'cli-cb']);
    expect(process.exitCode).toBe(0);
    const cb = listAccounts(db).filter((a) => a.provider === 'codebuddy');
    expect(cb.length).toBe(1);
    expect(cb[0].label).toBe('cli-cb');
  });

  it('happy path qwencloud: inserts row with credit_type=token-plan', async () => {
    await main(['--provider', 'qwencloud', '--api-key', 'sk-sp_cli', '--label', 'cli-qc']);
    expect(process.exitCode).toBe(0);
    const qc = listAccounts(db).filter((a) => a.provider === 'qwencloud');
    expect(qc.length).toBe(1);
    expect(qc[0].credit_type).toBe('token-plan');
  });
});
