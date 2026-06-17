import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getLoginOptions,
  sendTemporaryPassword,
  loginWithEmail,
  parseSetCookieHeader,
  NotionAuthError,
} from '../../../src/providers/notion/auth';

/**
 * Helper: build a minimal Response-like mock. Real `Response` exposes
 * `headers.get(name)` but vitest mocks often omit it. Provide a Headers instance.
 */
function mockResponse(opts: {
  status?: number;
  ok?: boolean;
  body?: string;
  setCookie?: string;
}): Response {
  const status = opts.status ?? 200;
  const ok = opts.ok ?? (status >= 200 && status < 300);
  const body = opts.body ?? '';
  const headers = new Headers();
  if (opts.setCookie) headers.set('set-cookie', opts.setCookie);
  return new Response(body, { status, headers });
}

describe('notion auth — login flow', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('getLoginOptions parses response correctly', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse({
        body: JSON.stringify({
          hasAccount: true,
          samlSignIn: 'unavailable',
          passwordSignIn: false,
          mustReverify: false,
          loginOptionsToken: 'v02:login_options:abc',
        }),
      })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const out = await getLoginOptions('user@example.com');

    expect(out).toEqual({
      hasAccount: true,
      samlSignIn: 'unavailable',
      passwordSignIn: false,
      mustReverify: false,
      loginOptionsToken: 'v02:login_options:abc',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/getLoginOptions'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: 'user@example.com', requireWorkTypeEmail: false }),
      })
    );
  });

  it('sendTemporaryPassword posts loginOptionsToken + deviceId', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse({ body: JSON.stringify({ csrfState: 'v02:temp_password:xyz' }) })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const out = await sendTemporaryPassword(
      'user@example.com',
      'v02:login_options:abc',
      'device-uuid'
    );

    expect(out.csrfState).toBe('v02:temp_password:xyz');
    const callBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(callBody).toMatchObject({
      email: 'user@example.com',
      loginOptionsToken: 'v02:login_options:abc',
      deviceId: 'device-uuid',
      appSource: 'notion',
      isSignup: false,
      native: true,
    });
  });

  it('loginWithEmail parses Set-Cookie + returns userId', async () => {
    const setCookie =
      'token_v2=v03:abc; Domain=app.notion.com; Path=/; Expires=Thu, 17 Jun 2027 19:50:55 GMT; HttpOnly; Secure, ' +
      'notion_user_id=382d872b-594c-81ff-b89c-00021216a6b0; Domain=app.notion.com; Path=/; Expires=Thu, 17 Jun 2027 19:50:55 GMT; Secure';
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse({
        body: JSON.stringify({ isNewSignup: false, userId: '382d872b-594c-81ff-b89c-00021216a6b0' }),
        setCookie,
      })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const out = await loginWithEmail('v02:temp_password:xyz', 'hdqiGs');

    expect(out.userId).toBe('382d872b-594c-81ff-b89c-00021216a6b0');
    expect(out.cookies.token_v2).toBe('v03:abc');
    expect(out.cookies.notion_user_id).toBe('382d872b-594c-81ff-b89c-00021216a6b0');
  });

  it('loginWithEmail throws NotionAuthError on 401', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse({
        status: 401,
        ok: false,
        body: '{"code":"wrong_password"}',
      })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(loginWithEmail('v02:temp_password:xyz', 'wrong')).rejects.toThrow(
      NotionAuthError
    );
  });
});

describe('parseSetCookieHeader', () => {
  it('extracts single cookie', () => {
    expect(parseSetCookieHeader('token=abc; Path=/; HttpOnly')).toEqual({ token: 'abc' });
  });

  it('extracts multiple cookies from concatenated header', () => {
    const h =
      'token_v2=v03:abc; Domain=app.notion.com; Path=/; HttpOnly, ' +
      'notion_user_id=uuid-1; Domain=app.notion.com; Path=/; Secure';
    expect(parseSetCookieHeader(h)).toEqual({
      token_v2: 'v03:abc',
      notion_user_id: 'uuid-1',
    });
  });

  it('handles quoted values', () => {
    expect(parseSetCookieHeader('name="quoted value"; Path=/')).toEqual({ name: 'quoted value' });
  });

  it('returns empty object for empty input', () => {
    expect(parseSetCookieHeader('')).toEqual({});
  });
});