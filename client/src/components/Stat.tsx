import type { ComponentChildren } from "preact";
export function Stat({ label, value, sub }: { label: string; value: string | number; sub?: ComponentChildren }) {
  return (
    <div class="stat">
      <div class="stat-label">{label}</div>
      <div class="stat-value">{value}</div>
      {sub && <div class="stat-sub">{sub}</div>}
    </div>
  );
}
