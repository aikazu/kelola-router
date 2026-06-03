export function parseError(
  resp: Response,
  bodyText: string
): { baseRespCode?: number; windowResetMs?: number; retryAfterSec?: number; message: string } {
  let baseRespCode: number | undefined;
  let windowResetMs: number | undefined;
  try {
    const parsed = JSON.parse(bodyText);
    baseRespCode = parsed?.base_resp?.status_code;
    if (baseRespCode === 2056 || baseRespCode === 2061) {
      const m = parsed?.model_remains?.[0];
      if (m?.end_time) windowResetMs = Math.max(0, m.end_time - Date.now());
    }
  } catch {}
  const ra = resp.headers.get('retry-after');
  const retryAfterSec = ra ? parseInt(ra, 10) : undefined;
  return { baseRespCode, windowResetMs, retryAfterSec, message: bodyText || `HTTP ${resp.status}` };
}
