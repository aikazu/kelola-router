import { useQuery } from '@tanstack/react-query';
import type { ComponentChildren } from 'preact';
import { apiFetch } from '../lib/api';

/** Mirrors `/api/health` — pool liveness drives the top-bar LED. */
interface PoolHealth {
  ok: boolean;
  pool?: { size: number };
}
function PoolHealthIndicator() {
  const { data } = useQuery({
    queryKey: ['pool-health'],
    queryFn: () => apiFetch<PoolHealth>('/health'),
    refetchInterval: 5000,
    retry: false,
  });
  const live = data?.ok === true;
  return (
    <span
      class="pool-health"
      role="status"
      aria-live="polite"
      aria-label={live ? 'Pool live' : 'Pool unreachable'}
    >
      <span class={`dot${live ? ' dot--pulse' : ''}`} />
      {live ? 'Pool · live' : 'Pool · down'}
    </span>
  );
}

export function TopBar({
  title,
  eyebrow,
  subtitle,
  actions,
  meta,
  hidePoolHealth,
}: {
  title: ComponentChildren;
  eyebrow?: string;
  /** One-line page description rendered under the title (dim mono). */
  subtitle?: string;
  actions?: ComponentChildren;
  /** Right-side status row (e.g. pool-health LED). Renders before actions. */
  meta?: ComponentChildren;
  /** Skip the default pool-health LED on the right. */
  hidePoolHealth?: boolean;
}) {
  const indicator = meta ?? (hidePoolHealth ? null : <PoolHealthIndicator />);
  return (
    <div class="topbar">
      <div class="topbar-head">
        <span class="topbar-eyebrow">{eyebrow ?? 'kelola-router'}</span>
        <h1 class="topbar-title">{title}</h1>
        {subtitle && <span class="topbar-subtitle">{subtitle}</span>}
      </div>
      {(indicator || actions) && (
        <div class="topbar-actions">
          {indicator}
          {indicator && actions && <span class="topbar-divider" aria-hidden="true" />}
          {actions}
        </div>
      )}
    </div>
  );
}
