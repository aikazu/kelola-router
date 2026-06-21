import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import type { VNode } from 'preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RequestDetail } from './RequestDetail';

function mockLog(body: Record<string, unknown>) {
  const base = {
    id: 1,
    createdAt: '2026-06-21T00:00:00Z',
    model: 'test',
    statusCode: 200,
    latencyMs: 10,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cost: 0,
    clientKeyId: null,
    accountId: null,
    requestBody: null,
    responseBody: null,
    requestHeaders: null,
    responseHeaders: null,
    error: null,
    ...body,
  };
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(base), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  );
}

function withClient(node: VNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>;
}

async function openTab(label: RegExp) {
  await waitFor(() => expect(screen.getByRole('tab', { name: label })).toBeTruthy());
  fireEvent.click(screen.getByRole('tab', { name: label }));
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('RequestDetail request tab', () => {
  it('renders decoded message timeline', async () => {
    mockLog({ requestBody: JSON.stringify({ messages: [{ role: 'user', content: 'hi there' }] }) });
    render(withClient(<RequestDetail id={1} onClose={() => {}} />));
    await openTab(/^request$/i);
    await waitFor(() => expect(screen.getByText('hi there')).toBeTruthy());
  });

  it('shows Raw fallback when request body unparseable', async () => {
    mockLog({ requestBody: 'not json {{{' });
    render(withClient(<RequestDetail id={1} onClose={() => {}} />));
    await openTab(/^request$/i);
    await waitFor(() => expect(screen.getByText(/Unparseable request body/i)).toBeTruthy());
  });
});
