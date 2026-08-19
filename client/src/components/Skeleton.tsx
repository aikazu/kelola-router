/** Skeleton placeholder rows for tables while data loads. */
export function TableSkeleton({ rows = 5, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <table class="tbl">
      <thead>
        <tr>
          {Array.from({ length: cols }).map((_, i) => (
            <th key={i}> </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: rows }).map((_, r) => (
          <tr key={r}>
            {Array.from({ length: cols }).map((_, c) => (
              <td key={c}>
                <div class="skeleton-cell" />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function StatSkeleton() {
  return (
    <div class="stat">
      <div class="skeleton-cell" style={{ height: 10, width: '60%' }} />
      <div class="skeleton-cell" style={{ height: 28, width: '40%', marginTop: 8 }} />
    </div>
  );
}

/**
 * Page-level loading scaffold — mirrors the Overview layout (topbar placeholders,
 * stat strip, module grid, log surfaces) so any route swap feels like the real
 * page is warming up instead of a bare "Loading…" text.
 */
export function PageSkeleton() {
  return (
    <div class="page-skeleton" aria-hidden="true">
      <div class="ps-topbar">
        <div class="skeleton-cell" style={{ width: 90, height: 9 }} />
        <div class="skeleton-cell" style={{ width: 200, height: 20, marginTop: 8 }} />
      </div>
      <div class="ps-strip">
        {Array.from({ length: 6 }).map((_, i) => (
          <div class="ps-stat" key={i}>
            <div class="skeleton-cell" style={{ height: 15, width: '72%' }} />
            <div class="skeleton-cell" style={{ height: 8, width: '48%', marginTop: 6 }} />
          </div>
        ))}
      </div>
      <div class="ps-grid">
        {Array.from({ length: 3 }).map((_, i) => (
          <div class="surface module--active ps-card" key={i}>
            <div class="skeleton-cell" style={{ width: '42%', height: 9 }} />
            <div class="skeleton-cell" style={{ width: '58%', height: 16, marginTop: 12 }} />
            <div class="skeleton-cell" style={{ width: '100%', height: 84, marginTop: 16 }} />
          </div>
        ))}
      </div>
      <div class="surface ps-card">
        <div class="skeleton-cell" style={{ width: 180, height: 9 }} />
        {Array.from({ length: 3 }).map((_, i) => (
          <div class="skeleton-cell" key={i} style={{ width: '100%', height: 11, marginTop: 12 }} />
        ))}
      </div>
    </div>
  );
}
