/**
 * Format an ISO timestamp as a human-readable relative time ("2 min ago").
 * Falls back to locale string for >7 days ago.
 */
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = new Date(iso.replace(" ", "T") + (iso.endsWith("Z") ? "" : "Z")).getTime();
  if (Number.isNaN(t)) return iso;
  const diff = Date.now() - t;
  const sec = Math.round(diff / 1000);
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(t).toLocaleString();
}
