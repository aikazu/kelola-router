import { render, screen, waitFor } from '@testing-library/preact';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Overview } from '../pages/Overview';

vi.mock('../lib/api', () => ({
  apiFetch: vi.fn(() =>
    Promise.resolve({
      stats: {
        totalCost: 0,
        totalRequests: 0,
        totalTokens: 0,
        enabledAccounts: 0,
        totalAccounts: 0,
        activeClientKeys: 0,
      },
      byModel: [],
      recent: [],
    }),
  ),
}));

function renderOverview() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Overview />
    </QueryClientProvider>,
  );
}

// Preact aliases `onChange` on a <select> to the DOM `change` event. In the
// happy-dom test environment, @testing-library's fireEvent.change/input does
// not reliably carry the handler through for a controlled <select value={number}>,
// so we set the value explicitly and dispatch a native `change` event instead.
// This exercises the production onChange handler without altering the component.
function changeSelect(select: HTMLSelectElement, value: string) {
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('Overview URL-sync', () => {
  beforeEach(() => {
    history.replaceState(null, '', '#/admin/overview');
  });

  it('writes the selected range to the URL hash', async () => {
    renderOverview();
    const select = screen.getByLabelText('Select date range') as HTMLSelectElement;
    changeSelect(select, '7');
    await waitFor(() => expect(location.hash).toContain('days=7'));
  });

  it('reads the range from the URL hash on mount', async () => {
    history.replaceState(null, '', '#/admin/overview?days=30');
    renderOverview();
    // The number-valued <select> doesn't reflect .value under happy-dom, so
    // assert the derived eyebrow text — the real signal that the range was read.
    await waitFor(() => {
      expect(screen.getByText(/Operations \/ last 30 days/)).toBeTruthy();
    });
  });
});
