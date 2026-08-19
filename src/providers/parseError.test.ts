// src/providers/parseError.test.ts
import { describe, expect, it } from 'vitest';
import { parseError } from './parseError.js';

function resp(body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, { status: 403, headers });
}

describe('parseError', () => {
  it('extracts MiniMax base_resp.status_code', () => {
    const r = parseError(
      resp('{"base_resp":{"status_code":1008}}'),
      '{"base_resp":{"status_code":1008}}'
    );
    expect(r.baseRespCode).toBe(1008);
    expect(r.errorCode).toBeUndefined();
  });

  it('extracts the OpenAI/New-API error.code from the error envelope', () => {
    const body =
      '{"error":{"message":"预扣费额度失败","code":"insufficient_user_quota","type":"new_api_error"}}';
    const r = parseError(resp(body), body);
    expect(r.errorCode).toBe('insufficient_user_quota');
    expect(r.message).toBe(body);
  });

  it('extracts a top-level code fallback', () => {
    const r = parseError(resp('{"code":"invalid_api_key"}'), '{"code":"invalid_api_key"}');
    expect(r.errorCode).toBe('invalid_api_key');
  });

  it('returns undefined errorCode when no code is present', () => {
    const body = '{"error":{"message":"Invalid token (request id: abc)"}}';
    const r = parseError(resp(body), body);
    expect(r.errorCode).toBeUndefined();
    expect(r.message).toBe(body);
  });

  it('survives non-JSON bodies', () => {
    const r = parseError(resp('<html>bad gateway</html>'), '<html>bad gateway</html>');
    expect(r.baseRespCode).toBeUndefined();
    expect(r.errorCode).toBeUndefined();
    expect(r.message).toBe('<html>bad gateway</html>');
  });
});
