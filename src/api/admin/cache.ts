type Entry<T> = {
  expiresAt: number;
  value: T;
};

const adminCache = new Map<string, Entry<unknown>>();

export function getAdminCached<T>(key: string): T | null {
  const entry = adminCache.get(key);
  if (!entry) {
    return null;
  }

  if (entry.expiresAt <= Date.now()) {
    adminCache.delete(key);
    return null;
  }

  return entry.value as T;
}

export function setAdminCached<T>(key: string, value: T, ttlMs = 1000): T {
  adminCache.set(key, {
    expiresAt: Date.now() + ttlMs,
    value,
  });
  return value;
}

export function clearAdminCache(): void {
  adminCache.clear();
}

export type { Entry };
