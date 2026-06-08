export function Progress({ value, max, warn }: { value: number; max: number; warn?: boolean }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div
      class="progress"
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
    >
      <div class={`progress-fill${warn ? ' warn' : ''}`} style={{ width: `${pct}%` }} />
    </div>
  );
}
