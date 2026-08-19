/**
 * Pure helpers extracted from the proxy handler pipeline.
 *
 * These functions carry no side-effects (no fetch, no log, no console).
 * They are shared between minimax, kiro, codebuddy, and combo handlers.
 */

import type { FallbackDecision } from '../accounts/error-rules.js';
import type { AccountState } from '../accounts/types.js';
import type { Account } from '../db/repos/accounts.js';
import { headersToJson, truncateBody } from './capture.js';
import { safeJsonParse } from './helpers.js';

// ---------------------------------------------------------------------------
// Db interface — abstract enough to mock in unit tests without better-sqlite3
// ---------------------------------------------------------------------------

export interface Db {
  updateAccount(id: string, patch: Partial<Account>): void;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LogRowContext {
  clientKeyId: number;
  accountId: string;
  model: string;
  requestedModel: string | null;
  endpoint: string;
  format: string;
  promptTokens: number;
  completionTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  costUsd: number;
  latencyMs: number;
  statusCode: number;
  baseRespCode: number | undefined;
  stream: 0 | 1;
  rtkBytesSaved: number;
  requestBody: string | null;
  responseBody: string | null;
  requestHeaders: Headers;
  responseHeaders: Headers;
  reqId: string;
}

export interface LogRowInput {
  client_key_id: number;
  account_id: string;
  model: string;
  requested_model: string | null;
  endpoint: string;
  format: string;
  prompt_tokens: number;
  completion_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  total_tokens: number;
  cost_usd: number;
  latency_ms: number;
  status_code: number;
  base_resp_code: number | null;
  stream: 0 | 1;
  rtk_bytes_saved: number;
  request_body: string | null;
  response_body: string | null;
  request_headers: string | null;
  response_headers: string | null;
  req_id: string;
}

// ---------------------------------------------------------------------------
// buildAccountStates
// ---------------------------------------------------------------------------

/**
 * Transform a list of Account rows (DB shape) into AccountState objects
 * (in-memory shape). Pure — no DB access.
 */
export function buildAccountStates(accounts: Account[]): AccountState[] {
  return accounts.map((a) => ({
    id: a.id,
    backoffLevel: a.backoff_level,
    rateLimitedUntil: a.rate_limited_until ?? null,
    lastError: a.last_error ? (safeJsonParse(a.last_error) as AccountState['lastError']) : null,
    status: a.status as AccountState['status'],
    enabled: !!a.enabled,
  }));
}

// ---------------------------------------------------------------------------
// buildLogRow
// ---------------------------------------------------------------------------

/**
 * Build a 20-field LogRowInput from a LogRowContext.
 * Used by all proxy handlers to prepare the row for insertRequestLogDeferred.
 */
export function buildLogRow(ctx: LogRowContext): LogRowInput {
  return {
    client_key_id: ctx.clientKeyId,
    account_id: ctx.accountId,
    model: ctx.model,
    requested_model: ctx.requestedModel,
    endpoint: ctx.endpoint,
    format: ctx.format,
    prompt_tokens: ctx.promptTokens,
    completion_tokens: ctx.completionTokens,
    cache_creation_tokens: ctx.cacheCreationTokens,
    cache_read_tokens: ctx.cacheReadTokens,
    total_tokens: ctx.totalTokens,
    cost_usd: ctx.costUsd,
    latency_ms: ctx.latencyMs,
    status_code: ctx.statusCode,
    base_resp_code: ctx.baseRespCode ?? null,
    stream: ctx.stream,
    rtk_bytes_saved: ctx.rtkBytesSaved ?? 0,
    request_body: truncateBody(ctx.requestBody),
    response_body: truncateBody(ctx.responseBody),
    request_headers: headersToJson(ctx.requestHeaders),
    response_headers: headersToJson(ctx.responseHeaders),
    req_id: ctx.reqId,
  };
}

// ---------------------------------------------------------------------------
// applyErrorState
// ---------------------------------------------------------------------------

/**
 * Write an error state to the DB for a single account.
 * Calls db.updateAccount with rate_limited_until, backoff_level, last_error, status.
 */
export function applyErrorState(
  db: Db,
  acc: AccountState,
  decision: FallbackDecision,
  errBody: string,
  parsed: { status: number; baseRespCode?: number }
): void {
  const rateLimitedUntil =
    decision.cooldownMs > 0 ? new Date(Date.now() + decision.cooldownMs).toISOString() : null;

  db.updateAccount(acc.id, {
    rate_limited_until: rateLimitedUntil,
    backoff_level: decision.newBackoffLevel ?? acc.backoffLevel,
    last_error: JSON.stringify({
      status: parsed.status,
      message: errBody.slice(0, 500),
      timestamp: new Date().toISOString(),
      baseRespCode: parsed.baseRespCode,
    }),
    status: parsed.status === 401 ? 'error' : acc.status,
  });
}

// ---------------------------------------------------------------------------
// clearErrorState
// ---------------------------------------------------------------------------

/**
 * Reset account error state in the DB if any field is dirty.
 * Guards against no-op — returns early when all fields are already clean.
 */
export function clearErrorState(db: Db, acc: AccountState): void {
  if (
    acc.backoffLevel === 0 &&
    acc.status === 'active' &&
    acc.rateLimitedUntil === null &&
    acc.lastError === null
  ) {
    return;
  }
  db.updateAccount(acc.id, {
    rate_limited_until: null,
    backoff_level: 0,
    last_error: null,
    status: 'active',
  });
}
