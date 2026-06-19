type Entry<T> = {
  expiresAt: number;
  value: T;
  version: number;
};

const adminCache = new Map<string, Entry<unknown>>();

// Module-private version counter. Bumping it invalidates every cached entry
// regardless of TTL — used by write paths (e.g. deferred request-log flush)
// to guarantee fresh data on the next read.
let cacheVersion = 0;

export function bumpAdminCacheVersion(): void {
  cacheVersion++;
}

export function getAdminCached<T>(key: string): T | null {
  const entry = adminCache.get(key);
  if (!entry) {
    return null;
  }

  if (entry.version !== cacheVersion) {
    adminCache.delete(key);
    return null;
  }

  if (entry.expiresAt <= Date.now()) {
    adminCache.delete(key);
    return null;
  }

  return entry.value as T;
}

const DEFAULT_TTL_MS = 250;

export function setAdminCached<T>(key: string, value: T, ttlMs = DEFAULT_TTL_MS): T {
  adminCache.set(key, {
    expiresAt: Date.now() + ttlMs,
    value,
    version: cacheVersion,
  });
  return value;
}

export function clearAdminCache(): void {
  adminCache.clear();
}

export type { Entry };
