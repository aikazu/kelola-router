import type Database from 'better-sqlite3';
import { listEnabledAccountsByProvider, type ProviderName } from '../../db/repos/accounts.js';
import type { Model } from '../../db/repos/models.js';
import { executeCodeBuddy } from '../../providers/codebuddy/index.js';
import { executeKiro } from '../../providers/kiro/index.js';
import { upstreamHeaders, upstreamUrl } from '../../providers/minimax.js';
import { executePioneer } from '../../providers/pioneer/index.js';
import { upstreamFetch } from '../../providers/upstreamFetch.js';
import { resolveTransportForAccount } from '../../transport/resolve.js';

export interface ModelTestResult {
  ok: boolean;
  latencyMs: number;
  error?: string;
}

/**
 * Fire a minimal 1-turn request at the model's upstream using the first
 * enabled account of its provider. Stateless: nothing written to request_logs.
 */
export async function testModelUpstream(
  db: Database.Database,
  model: Model
): Promise<ModelTestResult> {
  const provider = (model.provider ?? 'minimax') as ProviderName;
  const account = listEnabledAccountsByProvider(db, provider)[0];
  if (!account) {
    return { ok: false, latencyMs: 0, error: `Tidak ada account ${provider} yang aktif` };
  }

  const transport = resolveTransportForAccount(db, account);
  const started = Date.now();
  try {
    if (provider === 'kiro') {
      const result = await executeKiro({
        db,
        account,
        model: model.upstream_model,
        body: {
          model: model.upstream_model,
          messages: [{ role: 'user', content: 'ping' }],
        },
        stream: false,
        transport,
      });
      const latencyMs = Date.now() - started;
      if (!result.ok) {
        return {
          ok: false,
          latencyMs,
          error: result.errorBody?.slice(0, 200) || `HTTP ${result.status}`,
        };
      }
      return { ok: true, latencyMs };
    }

    if (provider === 'pioneer') {
      const resp = await executePioneer({
        body: {
          model: model.upstream_model,
          messages: [{ role: 'user', content: 'ping' }],
        },
        account: { api_key: account.api_key, base_url: account.base_url },
        transport,
        clientFormat: 'openai',
        upstreamModel: model.upstream_model,
      });
      const latencyMs = Date.now() - started;
      if (!resp.ok) {
        const text = await resp.text();
        return { ok: false, latencyMs, error: text.slice(0, 200) || `HTTP ${resp.status}` };
      }
      return { ok: true, latencyMs };
    }

    if (provider === 'codebuddy') {
      const resp = await executeCodeBuddy({
        body: {
          model: model.upstream_model,
          messages: [{ role: 'user', content: 'ping' }],
        },
        account: { api_key: account.api_key, base_url: account.base_url },
        transport,
        clientFormat: 'openai',
      });
      const latencyMs = Date.now() - started;
      if (!resp.ok) {
        const text = await resp.text();
        return { ok: false, latencyMs, error: text.slice(0, 200) || `HTTP ${resp.status}` };
      }
      return { ok: true, latencyMs };
    }

    const acct = {
      provider: 'minimax' as const,
      apiKey: account.api_key,
      baseUrl: account.base_url,
    };
    const url = upstreamUrl(acct, 'openai', '/v1/chat/completions');
    const headers = upstreamHeaders(acct, false, 'openai');
    const resp = await upstreamFetch(
      url,
      {
        model: model.upstream_model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
        stream: false,
      },
      headers,
      transport
    );
    const latencyMs = Date.now() - started;
    if (!resp.ok) {
      const text = await resp.text();
      return { ok: false, latencyMs, error: text.slice(0, 200) || `HTTP ${resp.status}` };
    }
    // MiniMax signals errors via base_resp inside an HTTP 200 body.
    const json = (await resp.json()) as {
      base_resp?: { status_code?: number; status_msg?: string };
    };
    if (json.base_resp && json.base_resp.status_code !== 0) {
      return {
        ok: false,
        latencyMs,
        error: `base_resp ${json.base_resp.status_code}: ${json.base_resp.status_msg ?? ''}`
          .trim()
          .slice(0, 200),
      };
    }
    return { ok: true, latencyMs };
  } catch (e) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
