import type Database from "better-sqlite3";
import { insertQuotaSnapshot } from "../db/repos/quotaSnapshots.js";
import { getBaseUrl } from "./baseUrl.js";
import { buildHeaders } from "./headers.js";
import type { Account } from "../db/repos/accounts.js";

type TokenPlanResponse = {
  current_interval_total_count: number;
  current_interval_usage_count: number;
  start_time?: number;
  end_time?: number;
  current_weekly_total_count: number;
  current_weekly_usage_count: number;
  weekly_start_time?: number;
  weekly_end_time?: number;
};

type CodingPlanResponse = {
  model_remains?: Array<{
    model_name: string;
    current_interval_total_count: number;
    current_interval_usage_count: number;
    start_time?: number;
    end_time?: number;
  }>;
};

export async function pullQuota(
  db: Database.Database,
  account: Account,
): Promise<{ ok: boolean; error?: string }> {
  if (account.credit_type !== "token-plan") {
    return { ok: true };
  }

  const accountLite = {
    provider: "minimax" as const,
    baseUrl: account.base_url ?? "",
    apiKey: account.api_key,
  };

  try {
    const url = `${getBaseUrl(accountLite, "openai")}/v1/token_plan/remains`;
    const resp = await fetch(url, {
      method: "GET",
      headers: buildHeaders(accountLite, false, "openai"),
    });
    if (resp.ok) {
      const data: TokenPlanResponse = await resp.json();
      const snapshots = parseTokenPlanRemains(data, account.id);
      const raw = JSON.stringify(data);
      for (const s of snapshots) insertQuotaSnapshot(db, { ...s, raw_response: raw });
      return { ok: true };
    }
  } catch (e: unknown) {
    console.warn(
      `[quota] token_plan pull failed for ${account.id}, falling back:`,
      (e as Error).message,
    );
  }

  try {
    const url = `${getBaseUrl(accountLite, "openai")}/v1/api/openplatform/coding_plan/remains`;
    const resp = await fetch(url, {
      method: "GET",
      headers: buildHeaders(accountLite, false, "openai"),
    });
    if (resp.ok) {
      const data: CodingPlanResponse = await resp.json();
      const snapshots = parseCodingPlanRemains(data, account.id);
      const raw = JSON.stringify(data);
      for (const s of snapshots) insertQuotaSnapshot(db, { ...s, raw_response: raw });
      return { ok: true };
    }
  } catch (e: unknown) {
    return { ok: false, error: (e as Error).message };
  }

  return { ok: false, error: "upstream not ok" };
}

function parseTokenPlanRemains(
  data: TokenPlanResponse,
  accountId: string,
): Array<{
  account_id: string;
  source: string;
  total_count: number | null;
  remaining_count: number | null;
  used_count: number | null;
  window_type: string | null;
  window_start: string | null;
  window_end: string | null;
}> {
  return [
    {
      account_id: accountId,
      source: "token_plan",
      window_type: "5h",
      total_count: data.current_interval_total_count ?? null,
      remaining_count: data.current_interval_usage_count ?? null,
      used_count:
        (data.current_interval_total_count ?? 0) -
        (data.current_interval_usage_count ?? 0),
      window_start: data.start_time ? new Date(data.start_time).toISOString() : null,
      window_end: data.end_time ? new Date(data.end_time).toISOString() : null,
    },
    {
      account_id: accountId,
      source: "token_plan",
      window_type: "weekly",
      total_count: data.current_weekly_total_count ?? null,
      remaining_count: data.current_weekly_usage_count ?? null,
      used_count:
        (data.current_weekly_total_count ?? 0) -
        (data.current_weekly_usage_count ?? 0),
      window_start: data.weekly_start_time
        ? new Date(data.weekly_start_time).toISOString()
        : null,
      window_end: data.weekly_end_time
        ? new Date(data.weekly_end_time).toISOString()
        : null,
    },
  ];
}

function parseCodingPlanRemains(
  data: CodingPlanResponse,
  accountId: string,
): Array<{
  account_id: string;
  source: string;
  total_count: number | null;
  remaining_count: number | null;
  used_count: number | null;
  window_type: string | null;
  window_start: string | null;
  window_end: string | null;
}> {
  return (data.model_remains ?? []).map((m) => ({
    account_id: accountId,
    source: "coding_plan",
    window_type: "5h",
    total_count: m.current_interval_total_count ?? null,
    remaining_count: m.current_interval_usage_count ?? null,
    used_count:
      (m.current_interval_total_count ?? 0) - (m.current_interval_usage_count ?? 0),
    window_start: m.start_time ? new Date(m.start_time).toISOString() : null,
    window_end: m.end_time ? new Date(m.end_time).toISOString() : null,
  }));
}