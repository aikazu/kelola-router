const MAX_BODY_BYTES = 100_000;
const MAX_SSE_EVENTS = 20;

const DEFAULT_HEADER_FIELDS = [
  'content-type',
  'x-request-id',
  'x-ratelimit-remaining',
  'x-ratelimit-reset',
  'retry-after',
] as const;

export function truncateBody(text: string | null | undefined): string | null {
  // Distinguish null (caller has no body) from '' (upstream returned empty).
  if (text === null || text === undefined) return null;
  if (text === '') return '';
  if (text.length <= MAX_BODY_BYTES) return text;
  return `${text.slice(0, MAX_BODY_BYTES)}...truncated...`;
}

export function truncateSseEvents(text: string | null | undefined): string | null {
  if (!text) return null;
  const events = text.split('\n\n');
  if (events.length <= MAX_SSE_EVENTS) return text;
  return `${events.slice(0, MAX_SSE_EVENTS).join('\n\n')}\n\n...truncated...`;
}

/**
 * Capture a Headers object as a JSON string. By default only a small set of
 * observability-relevant fields is included (cheaper, smaller row in
 * request_logs). Pass `null` to capture all headers.
 */
export function headersToJson(
  headers: Headers,
  fields: readonly string[] | null = DEFAULT_HEADER_FIELDS
): string {
  if (fields === null) {
    const obj: Record<string, string> = {};
    headers.forEach((v, k) => {
      obj[k] = v;
    });
    return JSON.stringify(obj);
  }
  const obj: Record<string, string> = {};
  for (const f of fields) {
    const v = headers.get(f);
    if (v !== null) obj[f] = v;
  }
  return JSON.stringify(obj);
}
