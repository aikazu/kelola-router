// src/providers/qwencloud/index.ts
import type { ProxyFetchOpts } from '../../transport/proxy-fetch.js';
import type { TransportConfig } from '../../transport/types.js';
import { upstreamFetch } from '../upstream-fetch.js';
import { prepareQwenCloudBody } from './transform.js';

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * QwenCloud (Aliyun token-plan) is a single Anthropic-Messages-compatible
 * endpoint. Base URL is the gateway root; the messages path is appended below.
 * See docs/qwencloud/wire-format.md + docs/qwencloud/auth.md.
 */
export const QWENCLOUD_BASE_URL =
  'https://token-plan.ap-southeast-1.maas.aliyuncs.com/apps/anthropic';
export const QWENCLOUD_MESSAGES_ENDPOINT = '/v1/messages';

// ─── Execute ─────────────────────────────────────────────────────────────────

/**
 * Execute a request to the QwenCloud upstream.
 *
 * QwenCloud authenticates with a long-lived Bearer token (`accounts.api_key`,
 * prefix `sk-sp-`), speaks Anthropic Messages at `/v1/messages`, and streams
 * native Anthropic Messages SSE when asked (`Accept: text/event-stream`;
 * request body carries `stream:true`, see wire-format.md).
 */
export async function executeQwenCloud(opts: {
  body: Record<string, unknown>;
  account: { api_key: string; base_url?: string | null };
  transport: TransportConfig | null;
  proxyOpts?: ProxyFetchOpts;
  /** Resolved upstream model id (DB stores bare names — no `qctp/` prefix). */
  upstreamModel?: string;
  signal?: AbortSignal;
}): Promise<Response> {
  const { body, account, transport, proxyOpts, upstreamModel, signal } = opts;

  const prepared = prepareQwenCloudBody(body, upstreamModel);
  const baseUrl = account.base_url || QWENCLOUD_BASE_URL;
  const url = `${baseUrl}${QWENCLOUD_MESSAGES_ENDPOINT}`;

  const extraHeaders: Record<string, string> = {
    Authorization: `Bearer ${account.api_key}`,
    'Content-Type': 'application/json',
    // Not mandated by the gateway today but recommended for forward
    // compatibility and parity with Anthropic's own API (see auth.md).
    'anthropic-version': '2023-06-01',
  };

  // Request body is always streaming (transform forces stream:true), so send
  // the SSE Accept header to get Anthropic-native SSE back.
  if (prepared.stream === true) {
    extraHeaders.Accept = 'text/event-stream';
  }

  return upstreamFetch(url, prepared, extraHeaders, transport, proxyOpts, signal);
}
