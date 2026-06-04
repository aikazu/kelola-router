import type Database from 'better-sqlite3';
import type { Account } from '../db/repos/accounts.js';
import { insertQuotaSnapshot } from '../db/repos/quotaSnapshots.js';
import { getBaseUrl } from './baseUrl.js';
import { buildHeaders } from './headers.js';

// Real MiniMax shape (both token_plan and coding_plan endpoints return this):
// { model_remains: [ { model_name, current_interval_*, current_weekly_*, remains_time, ... } ] }
interface ModelRemain {
  model_name: string;
  start_time?: number;
  end_time?: number;
  remains_time?: number;
  current_interval_total_count?: number;
  current_interval_usage_count?: number;
  current_interval_remaining_percent?: number;
  current_weekly_total_count?: number;
  current_weekly_usage_count?: number;
  current_weekly_remaining_percent?: number;
  weekly_start_time?: number;
  weekly_end_time?: number;
  weekly_remains_time?: number;
}

interface ModelRemainsResponse {
  model_remains?: ModelRemain[];
}

type ParsedSnapshot = {
  account_id: string;
  source: string;
  model_name: string | null;
  total_count: number | null;
  remaining_count: number | null;
  used_count: number | null;
  remaining_percent: number | null;
  remains_time: number | null;
  window_type: string | null;
  window_start: string | null;
  window_end: string | null;
};

const isoOrNull = (ms?: number): string | null =>
  ms && ms > 0 ? new Date(ms).toISOString() : null;

export async function pullQuota(
  db: Database.Database,
  account: Account
): Promise<{ ok: boolean; error?: string }> {
  if (account.credit_type !== 'token-plan') {
    return { ok: true };
  }

  const accountLite = {
    provider: 'minimax' as const,
    baseUrl: account.base_url ?? '',
    apiKey: account.api_key,
  };
  const base = getBaseUrl(accountLite, 'openai');
  const headers = buildHeaders(accountLite, false, 'openai');

  const tried = [
    { source: 'token_plan', url: `${base}/v1/token_plan/remains` },
    { source: 'coding_plan', url: `${base}/v1/api/openplatform/coding_plan/remains` },
  ];

  let lastError = 'upstream not ok';
  for (const t of tried) {
    try {
      const resp = await fetch(t.url, { method: 'GET', headers });
      if (!resp.ok) {
        lastError = `upstream ${resp.status}`;
        continue;
      }
      const data: ModelRemainsResponse = await resp.json();
      const snapshots = parseModelRemains(data, account.id, t.source);
      if (snapshots.length === 0) {
        lastError = 'empty model_remains';
        continue;
      }
      const raw = JSON.stringify(data);
      for (const s of snapshots) insertQuotaSnapshot(db, { ...s, raw_response: raw });
      return { ok: true };
    } catch (e: unknown) {
      lastError = (e as Error).message;
    }
  }

  return { ok: false, error: lastError };
}

function parseModelRemains(
  data: ModelRemainsResponse,
  accountId: string,
  source: string
): ParsedSnapshot[] {
  const out: ParsedSnapshot[] = [];
  for (const m of data.model_remains ?? []) {
    // No model_name -> ungroupable in the dashboard; skip rather than store a NULL-model row.
    if (!m.model_name) continue;
    const iTotal = m.current_interval_total_count ?? 0;
    const iUsed = m.current_interval_usage_count ?? 0;
    out.push({
      account_id: accountId,
      source,
      model_name: m.model_name,
      window_type: '5h',
      total_count: iTotal,
      used_count: iUsed,
      remaining_count: Math.max(0, iTotal - iUsed),
      remaining_percent: m.current_interval_remaining_percent ?? null,
      remains_time: m.remains_time ?? null,
      window_start: isoOrNull(m.start_time),
      window_end: isoOrNull(m.end_time),
    });

    const wTotal = m.current_weekly_total_count ?? 0;
    const wUsed = m.current_weekly_usage_count ?? 0;
    out.push({
      account_id: accountId,
      source,
      model_name: m.model_name,
      window_type: 'weekly',
      total_count: wTotal,
      used_count: wUsed,
      remaining_count: Math.max(0, wTotal - wUsed),
      remaining_percent: m.current_weekly_remaining_percent ?? null,
      remains_time: m.weekly_remains_time ?? null,
      window_start: isoOrNull(m.weekly_start_time),
      window_end: isoOrNull(m.weekly_end_time),
    });
  }
  return out;
}
