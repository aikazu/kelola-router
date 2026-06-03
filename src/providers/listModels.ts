import type Database from 'better-sqlite3';
import { upsertModel } from '../db/repos/models.js';
import { getBaseUrl } from './baseUrl.js';
import { buildHeaders } from './headers.js';

function detectFamily(name: string): string {
  if (name.includes('M3')) return 'm3';
  if (name.includes('M2.7')) return 'm2.7';
  if (name.includes('M2.5')) return 'm2.5';
  if (name.includes('M2.1')) return 'm2.1';
  if (name.includes('M2-her')) return 'm2-her';
  if (name.includes('M2')) return 'm2';
  return 'custom';
}

export interface FetchModelsResult {
  ok: boolean;
  added?: number;
  status?: number;
  error?: string;
}

export async function fetchModels(
  db: Database.Database,
  apiKey: string
): Promise<FetchModelsResult> {
  const account = { provider: 'minimax' as const, baseUrl: null };
  const candidatePaths = ['/v1/models'];
  const headers = buildHeaders({ provider: 'minimax', apiKey }, false, 'openai');

  for (const p of candidatePaths) {
    const url = `${getBaseUrl(account, 'openai')}${p}`;
    const resp = await fetch(url, { method: 'GET', headers });
    if (resp.ok) {
      const data = (await resp.json()) as { data: { id: string }[] };
      let added = 0;
      for (const m of data.data ?? []) {
        const existing = db.prepare(`SELECT id FROM models WHERE name = ?`).get(m.id);
        if (!existing) added++;
        upsertModel(db, {
          name: m.id,
          upstream_model: m.id,
          display_name: m.id,
          family: detectFamily(m.id),
          source: 'fetched',
          enabled: 1,
        });
      }
      return { ok: true, added };
    }
    if (resp.status === 404) continue;
    const text = await resp.text().catch(() => '');
    return {
      ok: false,
      status: resp.status,
      error: `upstream returned ${resp.status}: ${text.slice(0, 200)}`,
    };
  }
  return {
    ok: false,
    status: 404,
    error:
      'MiniMax upstream does not expose a model list endpoint at the OpenAI base URL; use the seeded models instead',
  };
}
