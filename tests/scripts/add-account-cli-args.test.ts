/**
 * Smoke tests for scripts/add-account.cliArgs.ts
 *
 * Covers:
 * - Happy path for each provider (minimax, kiro, codebuddy)
 * - Missing required fields → throws ValiError
 * - Invalid provider → throws ValiError
 */

import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import { parseArgs } from '../../scripts/add-account-cli-args.js';

describe('parseArgs', () => {
  // -------------------------------------------------------------------------
  // Minimax happy path
  // -------------------------------------------------------------------------
  it('minimax: parses required fields', () => {
    const args = parseArgs([
      '--provider',
      'minimax',
      '--label',
      'my-minimax',
      '--credit-type',
      'payg',
      '--api-key',
      'sk_test_xxx',
    ]);

    expect(args.provider).toBe('minimax');
    expect(args.label).toBe('my-minimax');
    expect(args.creditType).toBe('payg');
    expect(args.apiKey).toBe('sk_test_xxx');
  });

  it('minimax: parses optional --base-url', () => {
    const args = parseArgs([
      '--provider',
      'minimax',
      '--label',
      'my-minimax',
      '--credit-type',
      'token-plan',
      '--api-key',
      'sk_test_xxx',
      '--base-url',
      'https://api.minimax.io',
    ]);

    expect(args.baseUrl).toBe('https://api.minimax.io');
  });

  // -------------------------------------------------------------------------
  // Kiro happy path
  // -------------------------------------------------------------------------
  it('kiro: parses required fields', () => {
    const args = parseArgs([
      '--provider',
      'kiro',
      '--label',
      'my-kiro',
      '--refresh-token',
      'eyJxxx',
    ]);

    expect(args.provider).toBe('kiro');
    expect(args.label).toBe('my-kiro');
    expect(args.refreshToken).toBe('eyJxxx');
  });

  it('kiro: parses optional region, client-id, client-secret, profile-arn', () => {
    const args = parseArgs([
      '--provider',
      'kiro',
      '--label',
      'my-kiro',
      '--refresh-token',
      'eyJxxx',
      '--region',
      'us-west-2',
      '--client-id',
      'my-client-id',
      '--client-secret',
      'my-client-secret',
      '--profile-arn',
      'arn:aws:codewhisperer:us-west-2:123:profile/XYZ',
    ]);

    expect(args.region).toBe('us-west-2');
    expect(args.clientId).toBe('my-client-id');
    expect(args.clientSecret).toBe('my-client-secret');
    expect(args.profileArn).toBe('arn:aws:codewhisperer:us-west-2:123:profile/XYZ');
  });

  // -------------------------------------------------------------------------
  // CodeBuddy happy path
  // -------------------------------------------------------------------------
  it('codebuddy: parses required --api-key only', () => {
    const args = parseArgs(['--provider', 'codebuddy', '--api-key', 'cb_secret_xxx']);

    expect(args.provider).toBe('codebuddy');
    expect(args.apiKey).toBe('cb_secret_xxx');
    expect(args.label).toBeUndefined();
    expect(args.baseUrl).toBeUndefined();
  });

  it('codebuddy: parses optional --label and --base-url', () => {
    const args = parseArgs([
      '--provider',
      'codebuddy',
      '--api-key',
      'cb_secret_xxx',
      '--label',
      'my-codebuddy',
      '--base-url',
      'https://custom.codebuddy.ai',
    ]);

    expect(args.label).toBe('my-codebuddy');
    expect(args.baseUrl).toBe('https://custom.codebuddy.ai');
  });

  // -------------------------------------------------------------------------
  // Discriminated union: TypeScript narrowing
  // -------------------------------------------------------------------------
  it('discriminated union: switch on provider narrows correctly', () => {
    const argv = [
      '--provider',
      'minimax',
      '--label',
      'test-label',
      '--credit-type',
      'payg',
      '--api-key',
      'sk_xxx',
    ];
    const args = parseArgs(argv);

    // TypeScript should infer args is MinimaxArgs here via the discriminated union
    if (args.provider === 'minimax') {
      expect(args.creditType).toBe('payg'); // only on MinimaxArgs
    } else if (args.provider === 'kiro') {
      expect(args.refreshToken).toBeTruthy(); // only on KiroArgs
    } else {
      expect(args.apiKey).toBe('cb_xxx'); // only on CodeBuddyArgs
    }
  });

  // -------------------------------------------------------------------------
  // Missing required fields → throws
  // -------------------------------------------------------------------------
  it('minimax: throws without --label', () => {
    expect(() =>
      parseArgs(['--provider', 'minimax', '--credit-type', 'payg', '--api-key', 'sk_xxx'])
    ).toThrow(v.ValiError);
  });

  it('minimax: throws without --api-key', () => {
    expect(() =>
      parseArgs(['--provider', 'minimax', '--label', 'my-key', '--credit-type', 'payg'])
    ).toThrow(v.ValiError);
  });

  it('minimax: throws without --credit-type', () => {
    expect(() =>
      parseArgs(['--provider', 'minimax', '--label', 'my-key', '--api-key', 'sk_xxx'])
    ).toThrow(v.ValiError);
  });

  it('kiro: throws without --label', () => {
    expect(() => parseArgs(['--provider', 'kiro', '--refresh-token', 'eyJxxx'])).toThrow(
      v.ValiError
    );
  });

  it('kiro: throws without --refresh-token', () => {
    expect(() => parseArgs(['--provider', 'kiro', '--label', 'my-kiro'])).toThrow(v.ValiError);
  });

  it('codebuddy: throws without --api-key', () => {
    expect(() => parseArgs(['--provider', 'codebuddy'])).toThrow(v.ValiError);
  });

  // -------------------------------------------------------------------------
  // Invalid provider → throws
  // -------------------------------------------------------------------------
  it('throws without --provider', () => {
    expect(() => parseArgs(['--label', 'my-key', '--api-key', 'sk_xxx'])).toThrow(v.ValiError);
  });

  it('throws with unknown provider', () => {
    expect(() =>
      parseArgs([
        '--provider',
        'unknown-provider',
        '--label',
        'my-key',
        '--credit-type',
        'payg',
        '--api-key',
        'sk_xxx',
      ])
    ).toThrow(v.ValiError);
  });
});
