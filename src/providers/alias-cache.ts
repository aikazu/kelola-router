import type Database from 'better-sqlite3';
import { listAliases } from '../db/repos/aliases.js';

type Cache = { map: Map<string, string>; loadedAt: number };
let cache: Cache | null = null;
const TTL_MS = 30_000;

export function resolveAlias(db: Database.Database, name: string): string {
  const now = Date.now();
  if (!cache || now - cache.loadedAt > TTL_MS) {
    const map = new Map<string, string>();
    for (const a of listAliases(db)) map.set(a.aliasName, a.upstreamModel);
    cache = { map, loadedAt: now };
  }
  return cache.map.get(name) ?? name;
}

export function clearAliasCache(): void {
  cache = null;
}
