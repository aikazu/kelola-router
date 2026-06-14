import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../index.js';
import {
  createTransport,
  deleteTransport,
  getTransport,
  listTransports,
  setTransportCountry,
  updateTransport,
} from './transports.js';

let db: ReturnType<typeof openDb>;

beforeEach(() => {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'tp-')), 't.db');
  db = openDb();
});

describe('transports repo', () => {
  it('createTransport stores a proxy', () => {
    const t = createTransport(db, {
      id: 'tp_1',
      label: 'home socks',
      type: 'proxy',
      kind: 'socks5',
      url: 'socks5://127.0.0.1:1080',
    });
    expect(t.id).toBe('tp_1');
    expect(t.type).toBe('proxy');
    expect(t.kind).toBe('socks5');
    expect(t.enabled).toBe(true);
  });

  it('createTransport stores a relay', () => {
    const t = createTransport(db, {
      id: 'tp_relay',
      label: 'vercel edge',
      type: 'relay',
      kind: 'vercel',
      url: 'https://relay.vercel.app/api',
    });
    expect(t.type).toBe('relay');
    expect(t.kind).toBe('vercel');
  });

  it('getTransport returns by id, null when missing', () => {
    createTransport(db, {
      id: 'tp_a',
      label: 'A',
      type: 'proxy',
      kind: 'http',
      url: 'http://h:8080',
    });
    expect(getTransport(db, 'tp_a')?.label).toBe('A');
    expect(getTransport(db, 'nope')).toBeNull();
  });

  it('listTransports returns all ordered by created_at', () => {
    createTransport(db, { id: 'tp_1', label: 'one', type: 'proxy', kind: 'http', url: 'http://1' });
    createTransport(db, {
      id: 'tp_2',
      label: 'two',
      type: 'relay',
      kind: 'cloudflare',
      url: 'http://2',
    });
    const all = listTransports(db);
    expect(all.map((t) => t.id)).toEqual(['tp_1', 'tp_2']);
  });

  it('updateTransport patches fields', () => {
    createTransport(db, { id: 'tp_u', label: 'old', type: 'proxy', kind: 'http', url: 'http://o' });
    updateTransport(db, 'tp_u', { label: 'new', enabled: false });
    const t = getTransport(db, 'tp_u');
    expect(t?.label).toBe('new');
    expect(t?.enabled).toBe(false);
  });

  it('deleteTransport removes the row', () => {
    createTransport(db, { id: 'tp_d', label: 'D', type: 'proxy', kind: 'http', url: 'http://d' });
    deleteTransport(db, 'tp_d');
    expect(getTransport(db, 'tp_d')).toBeNull();
  });

  it('country defaults to null and setTransportCountry persists a code', () => {
    createTransport(db, {
      id: 'tp_geo',
      label: 'geo',
      type: 'proxy',
      kind: 'http',
      url: 'http://g',
    });
    expect(getTransport(db, 'tp_geo')?.country).toBeNull();
    setTransportCountry(db, 'tp_geo', 'SG');
    expect(getTransport(db, 'tp_geo')?.country).toBe('SG');
  });

  it('createTransport accepts an initial country', () => {
    const t = createTransport(db, {
      id: 'tp_cc',
      label: 'cc',
      type: 'proxy',
      kind: 'http',
      url: 'http://c',
      country: 'US',
    });
    expect(t.country).toBe('US');
  });

  it('createTransport defaults enabled to true and accepts enabled:false', () => {
    const t = createTransport(db, {
      id: 'tp_off',
      label: 'off',
      type: 'proxy',
      kind: 'http',
      url: 'http://x',
      enabled: false,
    });
    expect(t.enabled).toBe(false);
  });
});
