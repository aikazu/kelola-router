/**
 * Notion 3-step login + cookie persistence.
 *
 * The auth flow is email-based with a temporary password emailed to the user
 * (NOT a 6-digit OTP). After login, Notion sets a suite of cookies that the
 * router stores in `accounts.provider_data` JSON and replays on every
 * subsequent API request.
 *
 * Cookie format: `Set-Cookie` responses can carry multiple cookies in a single
 * header value, separated by `, ` (note: commas within Expires dates complicate
 * naive splitting — we use a regex that captures `name=value` before the first
 * `;` per cookie).
 *
 * See docs/notion/wire-format.md §1 for full protocol details.
 */
import { NOTION_AUDIT_LOG_PLATFORM, NOTION_BASE, NOTION_CLIENT_VERSION } from './constants.js';

const JSON_HEADERS = {
  'notion-client-version': NOTION_CLIENT_VERSION,
  'notion-audit-log-platform': NOTION_AUDIT_LOG_PLATFORM,
  'content-type': 'application/json',
  origin: 'https://app.notion.com',
  referer: 'https://app.notion.com/login',
  baggage:
    'sentry-environment=production,sentry-release=' +
    NOTION_CLIENT_VERSION +
    ',sentry-public_key=704fe3b1898d4ccda1d05fe1ee79a1f7,sentry-org_id=324374',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-origin',
} as const;

export class NotionAuthError extends Error {
  constructor(
    public code:
      | 'no_account'
      | 'password_required'
      | 'wrong_password'
      | 'otp_expired'
      | 'rate_limited'
      | 'network'
      | 'unknown',
    message?: string
  ) {
    super(message ?? `notion auth: ${code}`);
    this.name = 'NotionAuthError';
  }
}

export interface LoginOptions {
  hasAccount: boolean;
  samlSignIn: string;
  passwordSignIn: boolean;
  mustReverify: boolean;
  loginOptionsToken: string;
}

export async function getLoginOptions(email: string): Promise<LoginOptions> {
  const res = await fetch(`${NOTION_BASE}/api/v3/getLoginOptions`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ email, requireWorkTypeEmail: false }),
  });
  if (!res.ok) {
    throw new NotionAuthError('unknown', `getLoginOptions HTTP ${res.status}`);
  }
  const data = (await res.json()) as LoginOptions;
  if (!data.hasAccount) {
    throw new NotionAuthError('no_account', `no Notion account for ${email}`);
  }
  if (data.passwordSignIn) {
    throw new NotionAuthError(
      'password_required',
      'account requires password login (not supported by router v1)'
    );
  }
  return data;
}

export async function sendTemporaryPassword(
  email: string,
  loginOptionsToken: string,
  deviceId: string
): Promise<{ csrfState: string }> {
  const res = await fetch(`${NOTION_BASE}/api/v3/sendTemporaryPassword`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({
      email,
      disableLoginLink: false,
      native: false,
      isSignup: false,
      shouldHidePasscode: false,
      loginOptionsToken,
      deviceId,
      appSource: 'notion',
      loginRouteOrigin: 'login',
    }),
  });
  if (!res.ok) {
    throw new NotionAuthError('unknown', `sendTemporaryPassword HTTP ${res.status}`);
  }
  return (await res.json()) as { csrfState: string };
}

export interface LoginResult {
  cookies: Record<string, string>;
  userId: string;
}

/**
 * Extract cookies from a Set-Cookie response header value. Handles:
 * - Multiple cookies in one header separated by `, ` (per RFC 7230 section 3.2.2
 *   for Set-Cookie, but Notion joins them with `, `)
 * - Quoted values (e.g. `name="value with spaces"`)
 * - Cookies with attributes (`Path`, `Domain`, `Expires`, `HttpOnly`, `Secure`)
 *
 * Returns map of cookie name → raw cookie value (URL-decoded if needed by caller).
 */
export function parseSetCookieHeader(headerValue: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headerValue) return out;

  // Split on `, ` but not on commas inside dates like `Thu, 17 Jun 2027 ...`.
  // Each cookie segment starts with `<name>=<value>` and ends before the next
  // `, <name>=`. We use a regex that captures each `<name>=<value>` token up
  // to the first `;` or end-of-segment.
  const segments = headerValue.split(/,\s*(?=[a-zA-Z0-9_-]+=)/);
  for (const segment of segments) {
    const trimmed = segment.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^([^=]+)=((?:"[^"]*"|[^;]*))/);
    if (!match) continue;
    const name = match[1].trim();
    let value = match[2].trim();
    // Strip surrounding quotes
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    out[name] = value;
  }
  return out;
}

export async function loginWithEmail(csrfState: string, password: string): Promise<LoginResult> {
  const res = await fetch(`${NOTION_BASE}/api/v3/loginWithEmail`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({
      state: csrfState,
      password,
      appSource: 'notion',
      loginRouteOrigin: 'login',
    }),
  });

  // Get Set-Cookie from response — fetch exposes it via headers.get.
  const setCookieHeader = res.headers.get('set-cookie') ?? '';
  const cookies = parseSetCookieHeader(setCookieHeader);

  if (!res.ok) {
    // Try to parse error code from body
    const body = await res.text();
    let code: NotionAuthError['code'] = 'unknown';
    try {
      const parsed = JSON.parse(body) as { code?: string };
      if (parsed.code === 'wrong_password') code = 'wrong_password';
      else if (parsed.code === 'otp_expired') code = 'otp_expired';
      else if (parsed.code === 'rate_limited') code = 'rate_limited';
    } catch {
      // ignore parse error, keep 'unknown'
    }
    throw new NotionAuthError(code, `loginWithEmail HTTP ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as { isNewSignup: boolean; userId: string };
  return { cookies, userId: data.userId };
}
