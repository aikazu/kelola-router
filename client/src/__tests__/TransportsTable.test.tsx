import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { VNode } from 'preact';
import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TransportsTable } from '../components/transports/TransportsTable';
import type { Transport } from '../components/transports/types';

vi.mock('../components/ToastProvider', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

vi.mock('../components/Confirm', () => ({
  // Plain function (not vi.fn) so afterEach(restoreAllMocks) can't reset it.
  confirmDialog: () => Promise.resolve(true),
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

const transports: Transport[] = [
  {
    id: 't1',
    label: 'home socks',
    type: 'proxy',
    kind: 'socks5',
    url: 'socks5://127.0.0.1:1080',
    enabled: true,
    country: 'ID',
    createdAt: '',
    usageCount: 2,
  },
  {
    id: 't2',
    label: 'vercel edge',
    type: 'relay',
    kind: 'vercel',
    url: 'https://x.vercel.app',
    enabled: false,
    country: null,
    createdAt: '',
    usageCount: 0,
  },
];

describe('TransportsTable', () => {
  it('renders empty state when there are no transports', () => {
    wrap(
      <TransportsTable
        transports={[]}
        isLoading={false}
        isError={false}
        error={null}
        refetch={vi.fn()}
        onEdit={vi.fn()}
      />
    );
    expect(screen.getByText('No transports')).toBeTruthy();
  });

  it('renders a row per transport with label and id', () => {
    wrap(
      <TransportsTable
        transports={transports}
        isLoading={false}
        isError={false}
        error={null}
        refetch={vi.fn()}
        onEdit={vi.fn()}
      />
    );
    expect(screen.getByText('home socks')).toBeTruthy();
    expect(screen.getByText('vercel edge')).toBeTruthy();
    expect(screen.getByText('t1')).toBeTruthy();
    expect(screen.getByText('t2')).toBeTruthy();
  });

  it('shows the bulk-delete bar with a count after selecting a row', () => {
    wrap(
      <TransportsTable
        transports={transports}
        isLoading={false}
        isError={false}
        error={null}
        refetch={vi.fn()}
        onEdit={vi.fn()}
      />
    );
    fireEvent.click(screen.getByLabelText('Select home socks'));
    expect(screen.getByText('1 selected')).toBeTruthy();
    expect(screen.getByText('Delete 1')).toBeTruthy();
  });

  it('select-all checkbox selects every row', () => {
    wrap(
      <TransportsTable
        transports={transports}
        isLoading={false}
        isError={false}
        error={null}
        refetch={vi.fn()}
        onEdit={vi.fn()}
      />
    );
    fireEvent.click(screen.getByLabelText('Select all transports'));
    expect((screen.getByLabelText('Select home socks') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('Select vercel edge') as HTMLInputElement).checked).toBe(true);
  });

  it('Edit button calls onEdit with the transport', () => {
    const onEdit = vi.fn();
    wrap(
      <TransportsTable
        transports={transports}
        isLoading={false}
        isError={false}
        error={null}
        refetch={vi.fn()}
        onEdit={onEdit}
      />
    );
    fireEvent.click(screen.getAllByText('Edit')[0]);
    expect(onEdit).toHaveBeenCalledWith(transports[0]);
  });

  it('bulk-deletes selected transports after confirm', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ deleted: 2 }));
    wrap(
      <TransportsTable
        transports={transports}
        isLoading={false}
        isError={false}
        error={null}
        refetch={vi.fn()}
        onEdit={vi.fn()}
      />
    );
    fireEvent.click(screen.getByLabelText('Select all transports'));
    fireEvent.click(screen.getByText('Delete 2'));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const calledBulk = fetchSpy.mock.calls.some((c) => String(c[0]).includes('bulk-delete'));
    expect(calledBulk).toBe(true);
  });
});
