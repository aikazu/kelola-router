import type { ComponentChildren } from 'preact';
export function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub?: ComponentChildren;
}) {
  return (
    <dl class="stat">
      <dt class="stat-label">{label}</dt>
      <dd class="stat-value">{value}</dd>
      {sub && <div class="stat-sub">{sub}</div>}
    </dl>
  );
}
