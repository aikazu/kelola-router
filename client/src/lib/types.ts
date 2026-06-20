// Shared domain types for the Accounts page and its extracted sub-components/hooks.

export interface Account {
  id: string;
  label: string;
  provider?: string;
  authMethod?: string | null;
  persona?: string | null;
  creditType: string;
  status: string;
  enabled: boolean;
  lastError: string | null;
  backoffLevel: number;
  rateLimitedUntil: string | null;
  relayId?: string | null;
  proxyId?: string | null;
  proxyPool?: string[];
  proxyRotateEvery?: number;
  lockedModels?: number;
}

export interface Transport {
  id: string;
  label: string;
  type: 'proxy' | 'relay';
  kind: string;
  url: string;
  enabled: boolean;
}

export interface ModelLock {
  model: string;
  locked_until: string;
}

export interface TransportState {
  mode: 'none' | 'proxy' | 'pool' | 'relay';
  proxyId: string;
  relayId: string;
  pool: string[];
  rotate: number;
}

export interface DeviceCodeData {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
  clientId: string;
  clientSecret: string;
  region: string;
  authMethod: string;
  startUrl: string;
}

// Shape produced by GET /api/admin/quota. Kept in sync with QuotaWindow in
// src/api/admin/quota.ts (no cross-bundle import to keep client/server bundles separate).
export interface QuotaWindow {
  modelName: string;
  windowType: string;
  usedCount: number;
  totalCount: number;
  remainingCount: number;
  remainingPercent: number | null;
  remainsTime: number | null;
  windowEnd: string | null;
  fetchedAt: string;
}
