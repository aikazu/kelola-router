import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, it } from 'vitest';
import { openDb } from '../index.js';
import { getAllSettings, getSetting, setSetting } from './settings.js';

let db: ReturnType<typeof openDb>;

beforeEach(() => {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'set-')), 't.db');
  db = openDb();
});

it('returns all settings as an object', () => {
  setSetting(db, 'rtk', { enabled: true });
  setSetting(db, 'caveman', { level: 'full' });
  const all = getAllSettings(db);
  expect(all.rtk).toEqual({ enabled: true });
  expect(all.caveman).toEqual({ level: 'full' });
});

it('warms the per-db cache so subsequent getSetting needs no new query', () => {
  setSetting(db, 'minimax', { upstreamFormat: 'auto' });
  getAllSettings(db); // warms cache
  db.prepare("UPDATE settings SET value = ? WHERE key = 'minimax'").run(
    JSON.stringify({ upstreamFormat: 'openai' })
  );
  expect(getSetting(db, 'minimax')).toEqual({ upstreamFormat: 'auto' });
});
