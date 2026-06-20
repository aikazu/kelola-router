import { render, screen, fireEvent, waitFor } from '@testing-library/preact';
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

describe('Overview URL-sync', () => {
  beforeEach(() => {
    history.replaceState(null, '', '#/admin/overview');
  });

  it('writes the selected range to the URL hash', async () => {
    renderOverview();
    const select = screen.getByLabelText('Select date range') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: '7' } });
    await waitFor(() => expect(location.hash).toContain('days=7'));
  });

  it('reads the range from the URL hash on mount', async () => {
    history.replaceState(null, '', '#/admin/overview?days=30');
    renderOverview();
    await waitFor(() => {
      const select = screen.getByLabelText('Select date range') as HTMLSelectElement;
      expect(select.value).toBe('30');
    });
  });
});
