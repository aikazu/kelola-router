import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/preact';
import type { VNode } from 'preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SelectionControls } from '../components/SelectionControls';

vi.mock('../components/ToastProvider', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

function wrap(ui: VNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SelectionControls', () => {
  it('shows step input with fetched value when mode is round-robin', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ mode: 'round-robin', step: 3 }));
    wrap(<SelectionControls provider="minimax" />);
    await waitFor(() => expect(screen.getByLabelText('Step')).toBeTruthy());
    expect((screen.getByLabelText('Step') as HTMLInputElement).value).toBe('3');
  });

  it('hides step input when mode is lowest-backoff', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ mode: 'lowest-backoff', step: 1 })
    );
    wrap(<SelectionControls provider="kiro" />);
    await waitFor(() => {
      const sel = screen.getByRole('combobox') as HTMLSelectElement;
      expect(sel.value).toBe('lowest-backoff');
    });
    expect(screen.queryByLabelText('Step')).toBeNull();
  });
});
