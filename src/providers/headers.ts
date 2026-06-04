type AccountLike = { provider: 'minimax'; apiKey: string };

export function buildHeaders(
  account: AccountLike,
  stream: boolean,
  format: 'openai' | 'anthropic'
): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (format === 'anthropic') {
    h['x-api-key'] = account.apiKey;
    h['anthropic-version'] = '2023-06-01';
  } else {
    h.Authorization = `Bearer ${account.apiKey}`;
  }
  if (stream) h.Accept = 'text/event-stream';
  return h;
}
