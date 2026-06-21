const SENSITIVE_HEADERS = new Set([
  'authorization',
  'x-api-key',
  'proxy-authorization',
  'cookie',
  'set-cookie',
]);

export function maskHeaderValue(key: string, value: string): string {
  if (!SENSITIVE_HEADERS.has(key.toLowerCase())) return value;
  const spaceIdx = value.indexOf(' ');
  const prefix = spaceIdx >= 0 ? value.slice(0, spaceIdx + 1) : '';
  const rest = spaceIdx >= 0 ? value.slice(spaceIdx + 1) : value;
  const shown = rest.slice(0, 4);
  return `${prefix}${shown}****`;
}

export function HeadersTable({ headers }: { headers: Record<string, string> | null }) {
  if (!headers || Object.keys(headers).length === 0) {
    return (
      <p class="card-sub" style={{ color: 'var(--ink-dim)', marginBottom: 0 }}>
        No headers recorded.
      </p>
    );
  }
  const entries = Object.entries(headers).sort(([a], [b]) => a.localeCompare(b));
  return (
    <div class="specsheet" style={{ marginBottom: 16 }}>
      {entries.map(([k, v]) => (
        // biome-ignore lint/a11y/useSemanticElements: role="row" required for getAllByRole('row') test query; <tr> would force restructuring specsheet CSS shared with RequestDetail/PhaseTimeline.
        <div class="specsheet-row" role="row" tabIndex={0} key={k}>
          <span class="specsheet-label">{k}</span>
          <span class="specsheet-value mono" style={{ wordBreak: 'break-all' }}>
            {maskHeaderValue(k, v)}
          </span>
        </div>
      ))}
    </div>
  );
}
