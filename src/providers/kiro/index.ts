/**
 * Kiro executor — turns an OpenAI chat-completions request into a Kiro
 * (AWS CodeWhisperer) call and returns an OpenAI-shaped response (SSE chunk
 * stream or buffered chat.completion). Adapted from the 9router reference (MIT).
 */
import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { Account } from '../../db/repos/accounts.js';
import { type ProxyFetchOpts, proxyAwareFetch } from '../../transport/proxy-fetch.js';
import type { TransportConfig } from '../../transport/types.js';
import { kiroResponseToOpenAIJson, type OpenAICompletion } from './assembler.js';
import { ensureAccessToken, type KiroAuth } from './auth.js';
import {
  KIRO_DEFAULT_REGION,
  type KiroPersona,
  kiroCliAmzUserAgent,
  kiroCliUserAgent,
  resolveKiroEndpoint,
  resolveKiroPersona,
} from './constants.js';
import { ensureProfileArn } from './profile.js';
import type { KiroProviderData } from './token-refresh.js';
import { buildKiroPayload, type OpenAIChatBody } from './transform.js';

const KIRO_SDK_VERSION = '1.0.0';
const KIRO_IDE_VERSION = '0.12.292';

function regionFor(providerData: KiroProviderData | null): string {
  const arn = providerData?.profileArn;
  if (arn) {
    const parts = arn.split(':');
    if (parts.length >= 4 && parts[3]) return parts[3];
  }
  return providerData?.region || KIRO_DEFAULT_REGION;
}

/** Per-account fingerprint headers Kiro upstream validates (stable machineId). */
function buildKiroHeaders(auth: KiroAuth, persona: KiroPersona): Record<string, string> {
  if (persona === 'cli') {
    // Mirror the real kiro-cli wire format (aws-sdk-rust, AmazonQ-For-CLI).
    return {
      'Content-Type': 'application/x-amz-json-1.0',
      Accept: '*/*',
      'X-Amz-Target': 'AmazonCodeWhispererStreamingService.GenerateAssistantResponse',
      'Amz-Sdk-Invocation-Id': randomUUID(),
      'Amz-Sdk-Request': 'attempt=1; max=3',
      'User-Agent': kiroCliUserAgent(),
      'x-amz-user-agent': kiroCliAmzUserAgent(),
      'x-amzn-codewhisperer-optout': 'false',
      'Accept-Encoding': 'gzip',
      Authorization: `Bearer ${auth.accessToken}`,
    };
  }

  // IDE (legacy) path: aws-sdk-js + KiroIDE fingerprint against codewhisperer host.
  const seed =
    auth.providerData?.clientId || auth.providerData?.profileArn || auth.accessToken || 'kiro';
  const machineId = createHash('sha256').update(String(seed)).digest('hex');
  const userAgent =
    `aws-sdk-js/${KIRO_SDK_VERSION} ua/2.1 os/windows#10.0.26200 lang/js ` +
    `md/nodejs#22.21.1 api/codewhispererruntime#${KIRO_SDK_VERSION} m/N,E ` +
    `KiroIDE-${KIRO_IDE_VERSION}-${machineId}`;
  return {
    'Content-Type': 'application/json',
    Accept: 'application/vnd.amazon.eventstream',
    'X-Amz-Target': 'AmazonCodeWhispererStreamingService.GenerateAssistantResponse',
    'Amz-Sdk-Invocation-Id': randomUUID(),
    'Amz-Sdk-Request': 'attempt=1; max=3',
    'User-Agent': userAgent,
    'x-amz-user-agent': `aws-sdk-js/${KIRO_SDK_VERSION} KiroIDE-${KIRO_IDE_VERSION}-${machineId}`,
    Authorization: `Bearer ${auth.accessToken}`,
  };
}

export interface KiroExecuteResult {
  ok: boolean;
  status: number;
  /** Raw upstream Kiro binary event-stream Response when stream=true and ok. */
  rawStreamResponse?: Response;
  /** Buffered OpenAI completion when stream=false and ok. */
  json?: OpenAICompletion;
  /** Raw upstream error body when !ok. */
  errorBody?: string;
  /** Parsed `retry-after` header (seconds) when !ok and header present. */
  retryAfterSec?: number;
  upstreamModel: string;
}

export async function executeKiro(args: {
  db: Database.Database;
  account: Account;
  model: string;
  body: OpenAIChatBody;
  stream: boolean;
  transport: TransportConfig | null;
  proxyOpts?: ProxyFetchOpts;
  signal?: AbortSignal;
}): Promise<KiroExecuteResult> {
  const { db, account, model, body, stream, transport, proxyOpts, signal } = args;

  const auth = await ensureAccessToken(db, account, transport);
  const persona = resolveKiroPersona(auth.providerData?.persona);
  // The CLI runtime host requires a profileArn; discover + cache it on first use.
  if (persona === 'cli') {
    await ensureProfileArn(db, account, auth, transport, signal);
  }
  const { payload, upstreamModel } = buildKiroPayload(model, body, {
    accessToken: auth.accessToken,
    providerData: auth.providerData,
    persona,
  });
  const url = resolveKiroEndpoint(persona, regionFor(auth.providerData));
  const headers = buildKiroHeaders(auth, persona);

  const resp = await proxyAwareFetch(
    url,
    { method: 'POST', headers, body: JSON.stringify(payload), signal },
    transport,
    proxyOpts
  );

  if (!resp.ok) {
    const ra = resp.headers.get('retry-after');
    return {
      ok: false,
      status: resp.status,
      errorBody: await resp.text(),
      upstreamModel,
      retryAfterSec: ra ? parseInt(ra, 10) : undefined,
    };
  }

  if (stream) {
    return {
      ok: true,
      status: resp.status,
      rawStreamResponse: resp,
      upstreamModel,
    };
  }
  return {
    ok: true,
    status: resp.status,
    json: await kiroResponseToOpenAIJson(resp, model),
    upstreamModel,
  };
}
