import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../db/index.js';
import { clearCacheForDb, setSetting } from '../db/repos/settings.js';
import {
  getDbKey,
  getDbPath,
  getHost,
  getLogLevel,
  getPort,
  getRegion,
  getRequestLogRetentionDays,
  getUpstreamFormat,
  isConsoleFlowEnabled,
} from './env.js';

describe('env getters', () => {
  beforeEach(() => {
    delete process.env.HOST;
    delete process.env.PORT;
    delete process.env.MINIMAX_REGION;
    delete process.env.ROUTER_DB_PATH;
    delete process.env.ROUTER_DB_KEY;
    delete process.env.LOG_LEVEL;
    delete process.env.REQUEST_LOG_RETENTION_DAYS;
    delete process.env.CONSOLE_FLOW;
  });

  it('getHost defaults to 127.0.0.1', () => {
    expect(getHost()).toBe('127.0.0.1');
  });

  it('getHost honors HOST', () => {
    process.env.HOST = '0.0.0.0';
    expect(getHost()).toBe('0.0.0.0');
  });

  it('getPort defaults to 20137', () => {
    expect(getPort()).toBe(20137);
  });

  it('getPort parses PORT', () => {
    process.env.PORT = '8080';
    expect(getPort()).toBe(8080);
  });

  it('getRegion defaults to intl', () => {
    expect(getRegion()).toBe('intl');
  });

  it('getRegion returns cn when MINIMAX_REGION=cn', () => {
    process.env.MINIMAX_REGION = 'cn';
    expect(getRegion()).toBe('cn');
  });

  it('getDbPath returns null when ROUTER_DB_PATH not set (caller resolves default)', () => {
    expect(getDbPath()).toBeNull();
  });

  it('getDbPath returns override when set', () => {
    process.env.ROUTER_DB_PATH = '/tmp/x.db';
    expect(getDbPath()).toBe('/tmp/x.db');
  });

  // ─── getDbKey ─────────────────────────────────────────────────────────

  it('getDbKey returns undefined when ROUTER_DB_KEY unset', () => {
    expect(getDbKey()).toBeUndefined();
  });

  it('getDbKey returns undefined when ROUTER_DB_KEY is empty string', () => {
    process.env.ROUTER_DB_KEY = '';
    expect(getDbKey()).toBeUndefined();
  });

  it('getDbKey returns value when ROUTER_DB_KEY is set', () => {
    process.env.ROUTER_DB_KEY = 'secret';
    expect(getDbKey()).toBe('secret');
  });

  it('getDbKey trims whitespace when ROUTER_DB_KEY has surrounding spaces', () => {
    process.env.ROUTER_DB_KEY = '  secret  ';
    expect(getDbKey()).toBe('secret');
  });

  it('getDbKey returns undefined when ROUTER_DB_KEY is whitespace-only', () => {
    process.env.ROUTER_DB_KEY = '   ';
    expect(getDbKey()).toBeUndefined();
  });

  it('getLogLevel defaults to info', () => {
    expect(getLogLevel()).toBe('info');
  });

  // ─── getRequestLogRetentionDays ───────────────────────────────────────

  it('getRequestLogRetentionDays with env unset → 30', () => {
    expect(getRequestLogRetentionDays()).toBe(30);
  });

  it('getRequestLogRetentionDays with env = "7" → 7', () => {
    process.env.REQUEST_LOG_RETENTION_DAYS = '7';
    expect(getRequestLogRetentionDays()).toBe(7);
  });

  // ─── isConsoleFlowEnabled ────────────────────────────────────────────

  it('isConsoleFlowEnabled with env unset → true', () => {
    expect(isConsoleFlowEnabled()).toBe(true);
  });

  it('isConsoleFlowEnabled with env = "0" → false', () => {
    process.env.CONSOLE_FLOW = '0';
    expect(isConsoleFlowEnabled()).toBe(false);
  });
});

describe('env getters (db)', () => {
  let db: Database.Database;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'env-test-'));
    process.env.ROUTER_DB_PATH = join(dir, 't.db');
    db = openDb();
    delete process.env.ROUTER_UPSTREAM_FORMAT;
    clearCacheForDb(db);
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  // ─── getUpstreamFormat ────────────────────────────────────────────────

  it('getUpstreamFormat with settings set, env unset → returns settings value', () => {
    setSetting(db, 'minimax', { upstreamFormat: 'openai' });
    expect(getUpstreamFormat(db)).toBe('openai');
  });

  it('getUpstreamFormat with settings unset, env set → returns env value', () => {
    process.env.ROUTER_UPSTREAM_FORMAT = 'anthropic';
    expect(process.env.ROUTER_UPSTREAM_FORMAT).toBe('anthropic'); // sanity
    expect(getUpstreamFormat(db)).toBe('anthropic');
  });

  it('getUpstreamFormat with both unset → returns auto', () => {
    expect(getUpstreamFormat(db)).toBe('auto');
  });
});
