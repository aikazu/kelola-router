/**
 * Shared client-IP extraction. Returns the left-most entry of the
 * `x-forwarded-for` header (the original caller when behind a reverse proxy),
 * or `'unknown'` when the header is absent. Project precedent: we do NOT
 * consult `x-real-ip` (non-standard, nginx-only) — if a proxy needs it later,
 * swap one line here.
 */
export function clientIp(c: { req: { header: (name: string) => string | undefined } }): string {
  const xff = c.req.header('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  return 'unknown';
}
