import type Database from 'better-sqlite3';
import type { Account } from '../db/repos/accounts.js';
import type { ProxyKind, TransportConfig } from './types.js';

interface PoolMember {
  kind: ProxyKind;
  url: string;
}

interface BaseEntry {
  expiresAt: number;
  accountKey: string;
}

interface ValueEntry extends BaseEntry {
  kind: 'value';
  value: TransportConfig | null;
}

interface PoolEntry extends BaseEntry {
  kind: 'pool';
  active: PoolMember[];
}

export type ResolvedTransportCacheEntry = ValueEntry | PoolEntry;

const TTL_MS = 1000;
const cacheByDb = new WeakMap<Database.Database, Map<string, ResolvedTransportCacheEntry>>();

function getDbCache(db: Database.Database): Map<string, ResolvedTransportCacheEntry> {
  const existing = cacheByDb.get(db);
  if (existing) return existing;

  const created = new Map<string, ResolvedTransportCacheEntry>();
  cacheByDb.set(db, created);
  return created;
}

function accountKey(account: Account): string {
  return [
    account.relay_id ?? '',
    account.proxy_id ?? '',
    account.proxy_pool ?? '',
    String(account.proxy_rotate_every ?? ''),
  ].join('|');
}

export function getResolvedTransportCache(
  db: Database.Database,
  account: Account
): ResolvedTransportCacheEntry | undefined {
  const dbCache = cacheByDb.get(db);
  if (!dbCache) return undefined;

  const entry = dbCache.get(account.id);
  if (!entry) return undefined;

  if (entry.expiresAt <= Date.now()) {
    dbCache.delete(account.id);
    return undefined;
  }

  const key = accountKey(account);
  if (entry.accountKey !== key) {
    dbCache.delete(account.id);
    return undefined;
  }

  return entry;
}

export function setResolvedTransportCache(
  db: Database.Database,
  account: Account,
  value: TransportConfig | null
): TransportConfig | null {
  getDbCache(db).set(account.id, {
    kind: 'value',
    expiresAt: Date.now() + TTL_MS,
    accountKey: accountKey(account),
    value,
  });
  return value;
}

export function setResolvedTransportPoolCache(
  db: Database.Database,
  account: Account,
  active: PoolMember[]
): PoolMember[] {
  getDbCache(db).set(account.id, {
    kind: 'pool',
    expiresAt: Date.now() + TTL_MS,
    accountKey: accountKey(account),
    active,
  });
  return active;
}

export function invalidateResolvedTransportCache(db?: Database.Database): void {
  if (!db) return;
  cacheByDb.delete(db);
}

export { TTL_MS };
