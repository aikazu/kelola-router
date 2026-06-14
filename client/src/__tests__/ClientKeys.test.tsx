import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import type { Mock } from 'vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientKeys } from '../pages/ClientKeys';

// Toast is incidental to the reveal flow — stub it so error toasts don't leak
// into DOM assertions.
vi.mock('../components/ToastProvider', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

// Sample row used across tests.
const SAMPLE_KEY = {
  id: 7,
  label: 'my-app',
  enabled: true,
  createdAt: '2026-06-14T10:00:00.000Z',
  keyPreview: 'rk_***abc',
};
const RAW_KEY = 'rk_live_12345';
const LIST_URL = '/api/admin/client-keys';
const KEY_URL = `/api/admin/client-keys/${SAMPLE_KEY.id}/key`;
const VERIFY_URL = '/api/admin/reauth/verify';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

type MeData = { authed: boolean; passwordSet: boolean };

/**
 * Router-style fetch mock. Map URL → (init) => Response. Unmocked URLs return
 * 404 so tests fail loudly if the component hits an unexpected endpoint.
 */
type FetchHandler = (init?: RequestInit) => Response;

function mockFetch(handlers: Record<string, FetchHandler>): Mock {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    const handler = handlers[url];
    if (!handler) return jsonResponse({ error: 'not_mocked', url }, 404);
    return handler(init);
  });
  vi.spyOn(globalThis, 'fetch').mockImplementation(fn);
  return fn;
}

function renderKeys(me: MeData): void {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  // Seed both the mode-detection cache and the list cache so the component
  // renders synchronously with a row to click "Show" on.
  qc.setQueryData(['me'], me);
  qc.setQueryData(['client-keys'], [SAMPLE_KEY]);

  render(
    <QueryClientProvider client={qc}>
      <ClientKeys />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ClientKeys — reveal-key flow (Task 16)', () => {
  describe('open mode (passwordSet=false)', () => {
    it('clicking Show fetches the key and reveals it inline WITHOUT opening a modal', async () => {
      const fetchCalls = mockFetch({
        [LIST_URL]: () => jsonResponse([SAMPLE_KEY]),
        [KEY_URL]: () => jsonResponse({ key: RAW_KEY }),
      });
      renderKeys({ authed: true, passwordSet: false });

      // No dialog before click.
      expect(screen.queryByRole('dialog')).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: 'Show' }));

      // Inline `<code>` appears with the raw key; no modal dialog.
      await waitFor(() => {
        expect(screen.getByTestId(`reveal-inline-${SAMPLE_KEY.id}`).textContent).toBe(
          RAW_KEY,
        );
      });
      expect(screen.queryByRole('dialog')).toBeNull();

      // Verify endpoint: only GET /:id/key (no reauth/verify call).
      const urls = fetchCalls.mock.calls.map((c) => c[0] as string);
      expect(urls).toContain(KEY_URL);
      expect(urls.some((u: string) => u.includes('/reauth/verify'))).toBe(false);
    });

    it('Hide button re-masks the row after inline reveal', async () => {
      mockFetch({
        [LIST_URL]: () => jsonResponse([SAMPLE_KEY]),
        [KEY_URL]: () => jsonResponse({ key: RAW_KEY }),
      });
      renderKeys({ authed: true, passwordSet: false });

      fireEvent.click(screen.getByRole('button', { name: 'Show' }));
      await waitFor(() => {
        expect(screen.getByTestId(`reveal-inline-${SAMPLE_KEY.id}`)).toBeInTheDocument();
      });

      // Two "Hide" buttons exist after reveal (one in the cell, one in actions).
      // Click the first.
      fireEvent.click(screen.getAllByRole('button', { name: 'Hide' })[0]);
      await waitFor(() => {
        expect(screen.queryByTestId(`reveal-inline-${SAMPLE_KEY.id}`)).toBeNull();
      });
      // Masked preview returns.
      expect(screen.getByText('rk_***abc')).toBeInTheDocument();
    });
  });

  describe('password mode (passwordSet=true)', () => {
    it('clicking Show opens the reauth modal with a password input', async () => {
      mockFetch({
        [LIST_URL]: () => jsonResponse([SAMPLE_KEY]),
      });
      renderKeys({ authed: true, passwordSet: true });

      expect(screen.queryByRole('dialog')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Show' }));

      const dialog = await screen.findByRole('dialog');
      expect(dialog).toBeInTheDocument();
      expect(within(dialog).getByLabelText('Dashboard password')).toBeInTheDocument();
      // The label name is rendered inside a <strong>; scope to the dialog so we
      // don't match the row label cell.
      expect(within(dialog).getByText('my-app')).toBeInTheDocument();

      // The raw key endpoint is NOT called yet — gate is closed.
      expect(globalThis.fetch).not.toHaveBeenCalledWith(
        KEY_URL,
        expect.anything(),
      );
    });

    it('wrong password → inline "Wrong password" error and modal stays open for retry', async () => {
      mockFetch({
        [LIST_URL]: () => jsonResponse([SAMPLE_KEY]),
        [VERIFY_URL]: () =>
          jsonResponse({ error: 'wrong_password', message: 'wrong password' }, 401),
      });
      renderKeys({ authed: true, passwordSet: true });

      fireEvent.click(screen.getByRole('button', { name: 'Show' }));
      const input = await screen.findByLabelText('Dashboard password');

      fireEvent.input(input, { target: { value: 'guess' } });
      fireEvent.click(screen.getByRole('button', { name: 'Reveal' }));

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent(/wrong password/i);
      });

      // Modal still open; key still hidden.
      expect(screen.queryByTestId('reveal-key-pre')).toBeNull();
      // Password field is cleared after each submit per the spec.
      expect((screen.getByLabelText('Dashboard password') as HTMLInputElement).value).toBe(
        '',
      );
    });

    it('correct password → reauth cookie set + key fetched + revealed with Copy', async () => {
      const verifySpy = vi.fn(() => jsonResponse({ ok: true }, 200)) as FetchHandler & {
        mock: Mock['mock'];
      };
      const keySpy = vi.fn(() => jsonResponse({ key: RAW_KEY })) as FetchHandler & {
        mock: Mock['mock'];
      };
      mockFetch({
        [LIST_URL]: () => jsonResponse([SAMPLE_KEY]),
        [VERIFY_URL]: verifySpy,
        [KEY_URL]: keySpy,
      });
      renderKeys({ authed: true, passwordSet: true });

      fireEvent.click(screen.getByRole('button', { name: 'Show' }));
      const input = await screen.findByLabelText('Dashboard password');

      fireEvent.input(input, { target: { value: 'correct-horse' } });
      fireEvent.click(screen.getByRole('button', { name: 'Reveal' }));

      // Verify was called with the password as JSON body, then /:id/key.
      await waitFor(() => {
        expect(screen.getByTestId('reveal-key-pre').textContent).toBe(RAW_KEY);
      });

      expect(verifySpy).toHaveBeenCalledTimes(1);
      const verifyInit = verifySpy.mock.calls[0][0] as RequestInit;
      expect(JSON.parse(verifyInit.body as string)).toEqual({ password: 'correct-horse' });
      expect(verifyInit.method).toBe('POST');

      expect(keySpy).toHaveBeenCalledTimes(1);

      // Copy + Close buttons render in the success footer. Use getByText for
      // "Close" because the × modal-close button has aria-label="Close" but no
      // text content, so role+name would be ambiguous.
      expect(screen.getByRole('button', { name: 'Copy key' })).toBeInTheDocument();
      expect(screen.getByText('Close')).toBeInTheDocument();

      // Password field is gone (success view replaces the form).
      expect(screen.queryByLabelText('Dashboard password')).toBeNull();
    });

    it('closing after a successful reveal clears all modal state', async () => {
      mockFetch({
        [LIST_URL]: () => jsonResponse([SAMPLE_KEY]),
        [VERIFY_URL]: () => jsonResponse({ ok: true }, 200),
        [KEY_URL]: () => jsonResponse({ key: RAW_KEY }),
      });
      renderKeys({ authed: true, passwordSet: true });

      fireEvent.click(screen.getByRole('button', { name: 'Show' }));
      fireEvent.input(await screen.findByLabelText('Dashboard password'), {
        target: { value: 'pw' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Reveal' }));
      await waitFor(() =>
        expect(screen.getByTestId('reveal-key-pre').textContent).toBe(RAW_KEY),
      );

      // Close → modal unmounted. Click by text (× button has aria-label="Close"
      // too, so role+name is ambiguous — use the text "Close" from the footer).
      fireEvent.click(screen.getByText('Close'));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(screen.queryByTestId('reveal-key-pre')).toBeNull();
    });
  });
});

