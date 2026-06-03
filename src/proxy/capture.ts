const MAX_BODY_BYTES = 100_000;
const MAX_SSE_EVENTS = 20;

export function truncateBody(text: string | null | undefined): string | null {
  if (!text) return null;
  if (text.length <= MAX_BODY_BYTES) return text;
  return text.slice(0, MAX_BODY_BYTES) + '...truncated...';
}

export function truncateSseEvents(text: string | null | undefined): string | null {
  if (!text) return null;
  const events = text.split('\n\n');
  if (events.length <= MAX_SSE_EVENTS) return text;
  return events.slice(0, MAX_SSE_EVENTS).join('\n\n') + '\n\n...truncated...';
}

export function headersToJson(headers: Headers): string {
  const obj: Record<string, string> = {};
  headers.forEach((v, k) => {
    obj[k] = v;
  });
  return JSON.stringify(obj);
}
