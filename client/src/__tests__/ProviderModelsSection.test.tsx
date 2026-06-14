import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import type { VNode } from 'preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProviderModelsSection } from '../components/models/ProviderModelsSection';
import type { Model } from '../components/models/types';

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

const minimaxModels: Model[] = [
  {
    name: 'MiniMax-M3',
    displayName: 'M3',
    family: null,
    contextWindow: 1_000_000,
    provider: 'minimax',
    pricingInput: 1,
    pricingOutput: 2,
    source: 'builtin',
    enabled: true,
    aliasCount: 0,
  },
  {
    name: 'MiniMax-M2',
    displayName: null,
    family: null,
    contextWindow: 245_000,
    provider: 'minimax',
    pricingInput: null,
    pricingOutput: null,
    source: 'builtin',
    enabled: false,
    aliasCount: 3,
  },
];

function renderSection(overrides: Partial<Parameters<typeof ProviderModelsSection>[0]> = {}) {
  return wrap(
    <ProviderModelsSection
      title="MiniMax"
      models={minimaxModels}
      selected={new Set()}
      onSelectChange={vi.fn()}
      shadowedNames={new Set()}
      onAddModel={vi.fn()}
      {...overrides}
    />
  );
}

describe('ProviderModelsSection', () => {
  it('renders the empty state when the list is empty', () => {
    renderSection({ models: [] });
    expect(screen.getByText('No MiniMax models.')).toBeInTheDocument();
  });

  it('renders a row per model with name, context, and alias link', () => {
    renderSection();
    expect(screen.getByText('MiniMax-M3')).toBeInTheDocument();
    expect(screen.getByText('MiniMax-M2')).toBeInTheDocument();
    expect(screen.getByText('1M')).toBeInTheDocument(); // fmtContext(1_000_000)
    expect(screen.getByText('245K')).toBeInTheDocument(); // fmtContext(245_000)
    expect(screen.getByText('3 aliases')).toBeInTheDocument();
    // null pricing renders as '—' (M2 has null input + output + M3 has 0 aliases → '—')
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(1);
  });

  it('renders the ⚡ shadowed badge when a model name is shadowed', () => {
    renderSection({ shadowedNames: new Set(['MiniMax-M3']) });
    expect(screen.getByText(/shadowed/)).toBeInTheDocument();
  });

  it('renders header action buttons (Fetch + Add model)', () => {
    renderSection();
    expect(screen.getByText('Fetch from upstream')).toBeInTheDocument();
    expect(screen.getByText('+ Add model')).toBeInTheDocument();
  });

  it('+ Add model button calls onAddModel', () => {
    const onAddModel = vi.fn();
    renderSection({ onAddModel });
    fireEvent.click(screen.getByText('+ Add model'));
    expect(onAddModel).toHaveBeenCalledTimes(1);
  });

  it('Fetch from upstream button hits POST /api/admin/models/fetch', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ added: 0, updated: 0, total: 5 }));
    renderSection();
    fireEvent.click(screen.getByText('Fetch from upstream'));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const calledFetch = fetchSpy.mock.calls.some((c) =>
      String(c[0]).includes('/api/admin/models/fetch')
    );
    expect(calledFetch).toBe(true);
  });

  it('select-all checkbox selects every model in the section', () => {
    const onSelectChange = vi.fn();
    renderSection({ onSelectChange });
    // header checkbox (first checkbox in the thead)
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    expect(onSelectChange).toHaveBeenCalledWith(new Set(['MiniMax-M3', 'MiniMax-M2']));
  });

  it('per-row checkbox toggles a single model into the selection', () => {
    const onSelectChange = vi.fn();
    renderSection({ onSelectChange });
    // first data-row checkbox (second checkbox overall; first is header)
    fireEvent.click(screen.getAllByRole('checkbox')[1]);
    expect(onSelectChange).toHaveBeenCalledWith(new Set(['MiniMax-M3']));
  });

  it('Test button hits POST /api/admin/models/:name/test and shows the latency result', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ ok: true, latencyMs: 42 }));
    renderSection();
    // Two untested rows => two "Test" buttons; click the first (MiniMax-M3).
    fireEvent.click(screen.getAllByRole('button', { name: 'Test' })[0]);
    await waitFor(() =>
      expect(
        fetchSpy.mock.calls.some((c) => String(c[0]).includes('/api/admin/models/MiniMax-M3/test'))
      ).toBe(true)
    );
    await waitFor(() => expect(screen.getByText('✓ 42ms')).toBeInTheDocument());
  });

  it('Test result shows the failure glyph when upstream reports ok:false', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ ok: false, latencyMs: 0, error: 'timeout' })
    );
    renderSection();
    fireEvent.click(screen.getAllByRole('button', { name: 'Test' })[0]);
    await waitFor(() => expect(screen.getByText(/✗ timeout/)).toBeInTheDocument());
  });

  it('disable switch on an enabled model fires POST disable after confirm', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ ok: true }));
    renderSection();
    // MiniMax-M3 is enabled; its switch label is "on"
    fireEvent.click(screen.getByLabelText('on'));
    await waitFor(() =>
      expect(
        fetchSpy.mock.calls.some((c) =>
          String(c[0]).includes('/api/admin/models/MiniMax-M3/disable')
        )
      ).toBe(true)
    );
  });

  it('enable switch on a disabled model fires POST enable without confirm', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ ok: true }));
    renderSection();
    // MiniMax-M2 is disabled; its switch label is "off"
    fireEvent.click(screen.getByLabelText('off'));
    await waitFor(() =>
      expect(
        fetchSpy.mock.calls.some((c) =>
          String(c[0]).includes('/api/admin/models/MiniMax-M2/enable')
        )
      ).toBe(true)
    );
  });
});
