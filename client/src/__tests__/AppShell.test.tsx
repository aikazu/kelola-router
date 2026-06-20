import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from '../layout/AppShell';

/**
 * Task 20 — SecurityBanner ↔ AppShell integration tests.
 *
 * The banner is data-driven by `GET /api/admin/security/status`
 * (`{ adminPasswordSet, dbEncrypted }`). AppShell mounts <SecurityBanner>
 * only after that query resolves. Task 5's component returns null when both
 * flags are safe, so the all-clear case is "banner not in DOM".
 *
 * Route hash is set to an unknown route so NotFound renders (no extra
 * queries beyond `/api/me` inside Page).
 */

const ME_OK = { authed: true, passwordSet: false };

function mockFetch(securityStatus: { adminPasswordSet: boolean; dbEncrypted: boolean }) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.endsWith('/api/me')) {
      return new Response(JSON.stringify(ME_OK), { status: 200 });
    }
    if (url.includes('/api/admin/security/status')) {
      return new Response(JSON.stringify(securityStatus), { status: 200 });
    }
    // Any other endpoint (Overview counters, etc.) — empty 200.
    return new Response(JSON.stringify({}), { status: 200 });
  });
}

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={qc}>
      <AppShell />
    </QueryClientProvider>
  );
}

describe('AppShell — SecurityBanner integration', () => {
  const origHash = location.hash;

  beforeEach(() => {
    // Route to an unknown page so Page renders NotFound (no extra queries).
    location.hash = '#/admin/__banner_test__';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    location.hash = origHash;
  });

  it('renders the open-mode banner when adminPasswordSet is false', async () => {
    mockFetch({ adminPasswordSet: false, dbEncrypted: false });
    const { container } = wrap();
    // Banner is lazy-gated on the status query resolving; wait for it.
    await waitFor(() => {
      expect(container.querySelector('.security-banner')).not.toBeNull();
    });
    // Open-mode copy + eyebrow (Task 5 contract).
    expect(container.textContent).toMatch(/Router runs in open mode/i);
    expect(container.textContent).toMatch(/Security · Open mode/i);
  });

  it('renders the softer db-unencrypted banner when password is set but DB is plain', async () => {
    mockFetch({ adminPasswordSet: true, dbEncrypted: false });
    const { container } = wrap();
    await waitFor(() => {
      expect(container.querySelector('.security-banner')).not.toBeNull();
    });
    expect(container.textContent).toMatch(/Database encryption is OFF/i);
    // Soft variant modifier per Task 5.
    expect(container.querySelector('.security-banner')).toHaveClass('security-banner--soft');
  });

  it('does NOT render any banner when password is set AND db is encrypted', async () => {
    mockFetch({ adminPasswordSet: true, dbEncrypted: true });
    const { container } = wrap();
    // Give the query a chance to resolve before asserting absence.
    await waitFor(() => {
      expect(container.querySelector('.app-body')).not.toBeNull();
    });
    expect(container.querySelector('.security-banner')).toBeNull();
  });
});
