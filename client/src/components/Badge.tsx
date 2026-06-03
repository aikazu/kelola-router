import type { ComponentChildren } from 'preact';

type Variant = 'active' | 'error' | 'muted' | 'warn' | 'default';

export function Badge({
  children,
  variant = 'default',
  pulse,
}: {
  children: ComponentChildren;
  variant?: Variant;
  pulse?: boolean;
}) {
  const cls = variant === 'default' ? 'badge' : `badge badge-${variant}`;
  return <span class={`${cls}${pulse ? ' badge-pulse' : ''}`}>{children}</span>;
}
