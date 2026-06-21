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

describe('RequestDetail response tab', () => {
  it('renders reconstructed SSE text and raw sub-tab', async () => {
    const sse = [
      'event: message_start',
      'data: {"type":"message_start","message":{"model":"x"}}',
      '',
      'event: content_block_start',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text"}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hello"}}',
      '',
      'event: message_stop',
      'data: {"type":"message_stop"}',
      '',
    ].join('\n');
    mockLog({
      responseBody: sse,
      responseHeaders: { 'content-type': 'text/event-stream' },
    });
    render(withClient(<RequestDetail id={1} onClose={() => {}} />));
    await openTab(/^response$/i);
    await waitFor(() => expect(screen.getByText('hello')).toBeTruthy());
  });

  it('renders unpacked non-stream completion content', async () => {
    mockLog({
      responseBody: JSON.stringify({
        choices: [{ finish_reason: 'stop', message: { content: 'final answer' } }],
      }),
      responseHeaders: { 'content-type': 'application/json' },
    });
    render(withClient(<RequestDetail id={1} onClose={() => {}} />));
    await openTab(/^response$/i);
    await waitFor(() => expect(screen.getByText('final answer')).toBeTruthy());
  });

  it('renders Raw fallback when response decode throws', async () => {
    mockLog({ responseBody: 'fetch failed', responseHeaders: null });
    render(withClient(<RequestDetail id={1} onClose={() => {}} />));
    await openTab(/^response$/i);
    await waitFor(() => expect(screen.getByText('fetch failed')).toBeTruthy());
  });
});
