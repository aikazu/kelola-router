import type { ComponentChildren } from 'preact';
import type { JSX } from 'preact';

type Variant = 'active' | 'error' | 'muted' | 'warn' | 'default';

export function Badge({
  children,
  variant = 'default',
  pulse,
  style,
}: {
  children: ComponentChildren;
  variant?: Variant;
  pulse?: boolean;
  style?: JSX.CSSProperties;
}) {
  const cls = variant === 'default' ? 'badge' : `badge badge-${variant}`;
  return (
    <span class={`${cls}${pulse ? ' badge-pulse' : ''}`} style={style}>
      {children}
    </span>
  );
}
