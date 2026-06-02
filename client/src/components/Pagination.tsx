export interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  onPageChange: (p: number) => void;
  onPageSizeChange: (n: number) => void;
}

export function Pagination({ page, pageSize, total, totalPages, onPageChange, onPageSizeChange }: PaginationProps) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const pages = visiblePages(page, totalPages);
  return (
    <div class="pagination">
      <div>
        Showing {from}–{to} of {total.toLocaleString()}
        {total > 0 && <> · page {page} of {totalPages.toLocaleString()}</>}
      </div>
      <div class="pagination-controls">
        <select value={pageSize} onChange={(e) => onPageSizeChange(Number((e.target as HTMLSelectElement).value))} style={{ background: "var(--ink-1)", border: "1px solid var(--ink-3)", color: "var(--text-1)", padding: "4px 8px", borderRadius: 3, fontSize: 12, fontFamily: "inherit" }}>
          {[25, 50, 100, 200].map(n => <option key={n} value={n}>{n}/page</option>)}
        </select>
        <button onClick={() => onPageChange(1)} disabled={page <= 1}>«</button>
        <button onClick={() => onPageChange(page - 1)} disabled={page <= 1}>‹</button>
        {pages.map((p, i) => p === "…" ? <span key={i} style={{ color: "var(--text-3)" }}>…</span> :
          <button key={i} onClick={() => onPageChange(p as number)} class={p === page ? "active" : ""}>{p}</button>)}
        <button onClick={() => onPageChange(page + 1)} disabled={page >= totalPages}>›</button>
        <button onClick={() => onPageChange(totalPages)} disabled={page >= totalPages}>»</button>
      </div>
    </div>
  );
}

function visiblePages(current: number, total: number): Array<number | "…"> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out: Array<number | "…"> = [1];
  if (current > 3) out.push("…");
  for (let p = Math.max(2, current - 1); p <= Math.min(total - 1, current + 1); p++) out.push(p);
  if (current < total - 2) out.push("…");
  out.push(total);
  return out;
}
