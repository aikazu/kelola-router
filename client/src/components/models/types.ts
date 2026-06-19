// Page-local types and pure helpers for the Models page and its extracted
// sub-components. Kept here (not in shared lib/types.ts) to keep the
// pure-refactor scope tight — do not mutate shared type contracts.

export interface Model {
  name: string;
  displayName: string | null;
  family: string | null;
  contextWindow: number | null;
  contextOutput: number | null;
  provider: string;
  pricingInput: number | null;
  pricingOutput: number | null;
  source: string;
  enabled: boolean;
  aliasCount: number;
  comboCount: number;
}

export type Provider = 'minimax' | 'kiro' | 'codebuddy' | 'pioneer' | 'notion' | 'zai';

export type TestState =
  | { state: 'loading' }
  | { state: 'ok'; ms: number }
  | { state: 'fail'; error: string };

export interface AddModelForm {
  name: string;
  displayName: string;
  contextWindow: string;
  pricingInput: string;
  pricingOutput: string;
}

export function fmtContext(n: number | null): string {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}K`;
  return String(n);
}

export function fmtPrice(n: number | null): string {
  if (n == null) return '—';
  return `$${n}`;
}
