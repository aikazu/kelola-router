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
