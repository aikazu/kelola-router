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
