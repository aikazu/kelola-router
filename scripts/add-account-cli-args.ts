/**
 * CLI argument schema + parser for the unified `scripts/add-account.ts` script.
 *
 * Schema is inert — no top-level side effects, no `process.argv` reads at import time.
 * Call `parseArgs(argv)` with the raw argument list to validate.
 *
 * Discriminated union by `provider` field enables type-safe per-branch field access
 * in Task 36's implementation (switch on `args.provider`).
 *
 * Valibot v1.4.1 is already a project dependency (Task 1 commit 6e667a6).
 * This module establishes the project's valibot idiom for the unified add-account flow.
 */

import * as v from 'valibot';

// ---------------------------------------------------------------------------
// Shared enum
// ---------------------------------------------------------------------------

const CreditTypeEnum = v.picklist(['payg', 'token-plan']);
export type CreditType = 'payg' | 'token-plan';

// ---------------------------------------------------------------------------
// Per-provider argument shapes (discriminated union members)
// ---------------------------------------------------------------------------

export interface MinimaxArgs {
  provider: 'minimax';
  label: string;
  creditType: CreditType;
  apiKey: string;
  baseUrl?: string;
}

export interface KiroArgs {
  provider: 'kiro';
  label: string;
  refreshToken: string;
  region?: string;
  clientId?: string;
  clientSecret?: string;
  profileArn?: string;
}

export interface CodeBuddyArgs {
  provider: 'codebuddy';
  apiKey: string;
  label?: string;
  baseUrl?: string;
}

export interface PioneerArgs {
  provider: 'pioneer';
  apiKey: string;
  label?: string;
  baseUrl?: string;
}

export interface ZaiArgs {
  provider: 'zai';
  apiKey: string;
  label?: string;
  baseUrl?: string;
}

export interface TabiArgs {
  provider: 'tabi';
  apiKey: string;
  label?: string;
  baseUrl?: string;
}

export interface QwenCloudArgs {
  provider: 'qwencloud';
  apiKey: string;
  label?: string;
  baseUrl?: string;
}

// ---------------------------------------------------------------------------
// Discriminated union
// ---------------------------------------------------------------------------

export type AddAccountArgs =
  | MinimaxArgs
  | KiroArgs
  | CodeBuddyArgs
  | PioneerArgs
  | ZaiArgs
  | TabiArgs
  | QwenCloudArgs;

// ---------------------------------------------------------------------------
// Valibot schemas (one per provider)
// ---------------------------------------------------------------------------

const BaseFlagsSchema = v.object({
  provider: v.literal('minimax'),
});

const MinimaxSchema = v.intersect([
  BaseFlagsSchema,
  v.object({
    label: v.string('Missing required --label'),
    creditType: CreditTypeEnum,
    apiKey: v.string('Missing required --api-key'),
    baseUrl: v.optional(v.string()),
  }),
]);

const KiroSchema = v.intersect([
  v.object({ provider: v.literal('kiro') }),
  v.object({
    label: v.string('Missing required --label'),
    refreshToken: v.string('Missing required --refresh-token'),
    region: v.optional(v.string()),
    clientId: v.optional(v.string()),
    clientSecret: v.optional(v.string()),
    profileArn: v.optional(v.string()),
  }),
]);

const CodeBuddySchema = v.intersect([
  v.object({ provider: v.literal('codebuddy') }),
  v.object({
    apiKey: v.string('Missing required --api-key'),
    label: v.optional(v.string()),
    baseUrl: v.optional(v.string()),
  }),
]);

const PioneerSchema = v.intersect([
  v.object({ provider: v.literal('pioneer') }),
  v.object({
    apiKey: v.string('Missing required --api-key'),
    label: v.optional(v.string()),
    baseUrl: v.optional(v.string()),
  }),
]);

const ZaiSchema = v.intersect([
  v.object({ provider: v.literal('zai') }),
  v.object({
    apiKey: v.string('Missing required --api-key'),
    label: v.optional(v.string()),
    baseUrl: v.optional(v.string()),
  }),
]);

const TabiSchema = v.intersect([
  v.object({ provider: v.literal('tabi') }),
  v.object({
    apiKey: v.string('Missing required --api-key'),
    label: v.optional(v.string()),
    baseUrl: v.optional(v.string()),
  }),
]);

const QwenCloudSchema = v.intersect([
  v.object({ provider: v.literal('qwencloud') }),
  v.object({
    apiKey: v.string('Missing required --api-key'),
    label: v.optional(v.string()),
    baseUrl: v.optional(v.string()),
  }),
]);

// ---------------------------------------------------------------------------
// Helper: extract a --flag <value> pair from argv
// ---------------------------------------------------------------------------

function getArg(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}

function getOptionalFlag(argv: string[], name: string): string | undefined {
  return getArg(argv, name);
}

// ---------------------------------------------------------------------------
// Main parser
// ---------------------------------------------------------------------------

/**
 * Parse raw CLI argv and validate against the provider-specific schema.
 *
 * @param argv - e.g. `['--provider', 'minimax', '--label', 'my-key', '--api-key', 'sk_xxx']`
 * @returns A discriminated-union member; throw `v.ValiError` on validation failure.
 *
 * Usage in Task 36:
 * ```ts
 * try {
 *   const args = parseArgs(process.argv.slice(2));
 *   switch (args.provider) {
 *     case 'minimax':  // args is MinimaxArgs — label, creditType, apiKey … all typed
 *     case 'kiro':      // args is KiroArgs    — label, refreshToken, region … all typed
 *     case 'codebuddy': // args is CodeBuddyArgs
 *     case 'pioneer':  // args is PioneerArgs
 *   }
 * } catch (err) {
 *   if (err instanceof v.ValiError) console.error(err.message);
 * }
 * ```
 */
export function parseArgs(argv: string[]): AddAccountArgs {
  const provider = getArg(argv, 'provider');

  switch (provider) {
    case 'minimax':
      return v.parse(
        MinimaxSchema,
        Object.fromEntries(
          [
            ['provider', 'minimax'],
            ['label', getArg(argv, 'label')],
            ['creditType', getArg(argv, 'credit-type')],
            ['apiKey', getArg(argv, 'api-key')],
            ['baseUrl', getOptionalFlag(argv, 'base-url')],
          ].filter(([, v]) => v !== undefined)
        ),
        'Invalid minimax arguments'
      ) as MinimaxArgs;

    case 'kiro':
      return v.parse(
        KiroSchema,
        Object.fromEntries(
          [
            ['provider', 'kiro'],
            ['label', getArg(argv, 'label')],
            ['refreshToken', getArg(argv, 'refresh-token')],
            ['region', getOptionalFlag(argv, 'region')],
            ['clientId', getOptionalFlag(argv, 'client-id')],
            ['clientSecret', getOptionalFlag(argv, 'client-secret')],
            ['profileArn', getOptionalFlag(argv, 'profile-arn')],
          ].filter(([, v]) => v !== undefined)
        ),
        'Invalid kiro arguments'
      ) as KiroArgs;

    case 'codebuddy':
      return v.parse(
        CodeBuddySchema,
        Object.fromEntries(
          [
            ['provider', 'codebuddy'],
            ['apiKey', getArg(argv, 'api-key')],
            ['label', getOptionalFlag(argv, 'label')],
            ['baseUrl', getOptionalFlag(argv, 'base-url')],
          ].filter(([, v]) => v !== undefined)
        ),
        'Invalid codebuddy arguments'
      ) as CodeBuddyArgs;

    case 'pioneer':
      return v.parse(
        PioneerSchema,
        Object.fromEntries(
          [
            ['provider', 'pioneer'],
            ['apiKey', getArg(argv, 'api-key')],
            ['label', getOptionalFlag(argv, 'label')],
            ['baseUrl', getOptionalFlag(argv, 'base-url')],
          ].filter(([, v]) => v !== undefined)
        ),
        'Invalid pioneer arguments'
      ) as PioneerArgs;

    case 'zai':
      return v.parse(
        ZaiSchema,
        Object.fromEntries(
          [
            ['provider', 'zai'],
            ['apiKey', getArg(argv, 'api-key')],
            ['label', getOptionalFlag(argv, 'label')],
            ['baseUrl', getOptionalFlag(argv, 'base-url')],
          ].filter(([, v]) => v !== undefined)
        ),
        'Invalid zai arguments'
      ) as ZaiArgs;

    case 'tabi':
      return v.parse(
        TabiSchema,
        Object.fromEntries(
          [
            ['provider', 'tabi'],
            ['apiKey', getArg(argv, 'api-key')],
            ['label', getOptionalFlag(argv, 'label')],
            ['baseUrl', getOptionalFlag(argv, 'base-url')],
          ].filter(([, v]) => v !== undefined)
        ),
        'Invalid tabi arguments'
      ) as TabiArgs;

    case 'qwencloud':
      return v.parse(
        QwenCloudSchema,
        Object.fromEntries(
          [
            ['provider', 'qwencloud'],
            ['apiKey', getArg(argv, 'api-key')],
            ['label', getOptionalFlag(argv, 'label')],
            ['baseUrl', getOptionalFlag(argv, 'base-url')],
          ].filter(([, v]) => v !== undefined)
        ),
        'Invalid qwencloud arguments'
      ) as QwenCloudArgs;

    default:
      throw new v.ValiError([
        {
          reason: 'literal',
          validation: 'literal',
          path: [
            {
              type: 'property',
              input: {},
              key: 'provider',
              message:
                'Missing required --provider (minimax | kiro | codebuddy | pioneer | zai | tabi | qwencloud)',
            },
          ],
        },
      ]);
  }
}
