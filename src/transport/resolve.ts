import type Database from 'better-sqlite3';
import type { Account } from '../db/repos/accounts.js';
import { getSetting } from '../db/repos/settings.js';
import { getTransport } from '../db/repos/transports.js';
import {
  getResolvedTransportCache,
  setResolvedTransportCache,
  setResolvedTransportPoolCache,
} from './resolvedCache.js';
import type { ProxyKind, RelayKind, TransportConfig } from './types.js';

interface ActiveProxyTransport {
  kind: ProxyKind;
  url: string;
}

function pickFromActivePool(account: Account, active: ActiveProxyTransport[]): TransportConfig {
  const every = Math.max(1, account.proxy_rotate_every || 1);
  const state = rotation.get(account.id) ?? { cursor: 0, count: 0 };
  const idx = state.cursor % active.length;
  const picked = active[idx]!;
  state.count += 1;
  if (state.count >= every) {
    state.count = 0;
    state.cursor = (state.cursor + 1) % active.length;
  }
  rotation.set(account.id, state);
  return { relay: null, proxy: { kind: picked.kind, url: picked.url } };
}

function activeProxyPool(db: Database.Database, poolIds: string[]): ActiveProxyTransport[] {
  return poolIds
    .map((id) => getTransport(db, id))
    .filter((t): t is NonNullable<typeof t> => !!t && t.type === 'proxy' && t.enabled)
    .map((t) => ({ kind: t.kind as ProxyKind, url: t.url }));
}

/**
 * In-memory rotation state for proxy pools, keyed by account id.
 *
 * `count` is the number of resolutions served by the current `cursor` member;
 * once it reaches the account's `proxy_rotate_every`, the cursor advances.
 * State is intentionally process-local: it resets on restart (rotation simply
 * starts again from the first pool member), which is fine for a single-user
 * self-host and avoids a DB write on every request.
 */
interface RotationState {
  cursor: number;
  count: number;
}
const rotation = new Map<string, RotationState>();

/** Test helper — clears all in-memory rotation counters. */
export function __resetRotationState(): void {
  rotation.clear();
}

interface GlobalTransportSetting {
  relay: { kind: RelayKind; url: string } | null;
  proxy: { kind: ProxyKind; url: string } | null;
}

function globalTransport(db: Database.Database): TransportConfig | null {
  const g = getSetting<GlobalTransportSetting>(db, 'transport');
  if (!g) return null;
  if (!g.relay && !g.proxy) return null;
  return { relay: g.relay ?? null, proxy: g.proxy ?? null };
}

function parsePool(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function asProxyConfig(db: Database.Database, id: string): TransportConfig | null {
  const t = getTransport(db, id);
  if (!t || t.type !== 'proxy' || !t.enabled) return null;
  return { relay: null, proxy: { kind: t.kind as ProxyKind, url: t.url } };
}

/**
 * Resolve the transport for a single upstream request on `account`.
 *
 * Priority:
 *   1. relay_id        -> relay (proxy ignored; relay replaces the fetch target)
 *   2. proxy_pool      -> round-robin proxy, advancing every `proxy_rotate_every`
 *   3. proxy_id        -> single proxy
 *   4. global setting  -> settings.transport (legacy/global default)
 *   5. null            -> direct
 *
 * Side effect: advances the in-memory rotation cursor when a pool is used.
 */
export function resolveTransportForAccount(
  db: Database.Database,
  account: Account
): TransportConfig | null {
  const cached = getResolvedTransportCache(db, account);
  if (cached?.kind === 'value') return cached.value;
  if (cached?.kind === 'pool' && cached.active.length > 0) {
    return pickFromActivePool(account, cached.active);
  }

  // 1. Relay (mutually exclusive with proxy).
  if (account.relay_id) {
    const t = getTransport(db, account.relay_id);
    if (t && t.type === 'relay' && t.enabled) {
      return setResolvedTransportCache(db, account, {
        relay: { kind: t.kind as RelayKind, url: t.url },
        proxy: null,
      });
    }
  }

  // 2. Proxy pool (round-robin, skipping disabled members).
  const poolIds = parsePool(account.proxy_pool);
  if (poolIds.length > 0) {
    const active = activeProxyPool(db, poolIds);
    if (active.length > 0) {
      setResolvedTransportPoolCache(db, account, active);
      return pickFromActivePool(account, active);
    }
  }

  // 3. Single proxy.
  if (account.proxy_id) {
    const cfg = asProxyConfig(db, account.proxy_id);
    if (cfg) return setResolvedTransportCache(db, account, cfg);
  }

  // 4. Global fallback should stay uncached so settings.transport updates are visible immediately.
  const global = globalTransport(db);
  if (global) return global;

  // 5. null (direct) remains cacheable for unassigned accounts.
  return setResolvedTransportCache(db, account, null);
}
