# Add a Dashboard Page

Add a new Preact page to the dashboard SPA. The router uses hash-routing (`#/admin/<page>`), TanStack Query for data fetching, and an Obsidian Gold theme.

## Goal

A new page, e.g. `/admin/widgets` that:
- Renders a list of widgets from `GET /api/admin/widgets/`
- Has a button to create a new widget via `POST /api/admin/widgets/`
- Shows toast on success / error
- Is reachable from the sidebar + command palette + `g w` keyboard shortcut

## Prerequisites

- Read [`AGENTS.md`](../../AGENTS.md): Dashboard section
- Read [`../reference/admin-api-routes.md`](../reference/admin-api-routes.md): your endpoint
- Read one small existing page as a reference: `client/src/pages/Aliases.tsx` (CRUD) or `client/src/pages/Quota.tsx` (read-only with polling)
- Dev env: `cd client && npm run dev` (proxies `/api` to the running server on :20137)

## File map

```
client/src/
├── pages/
│   └── Widgets.tsx            NEW: your page component
├── layout/
│   ├── AppShell.tsx           EXTEND: register the lazy import + KNOWN_ROUTES + switch case
│   └── Sidebar.tsx            EXTEND: add a sidebar entry
├── lib/
│   └── api.ts                 (read-only: use apiFetch helper)
└── components/
    └── WidgetForm.tsx         NEW (optional): extracted form if the page is big
```

## Steps

### 1. Create the page component

**File:** `client/src/pages/Widgets.tsx` (new)

```tsx
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'preact/hooks';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { ErrorState } from '../components/ErrorState';
import { useToast } from '../components/ToastProvider';
import { TopBar } from '../layout/TopBar';
import { apiFetch } from '../lib/api';

interface Widget {
  id: string;
  name: string;
  created_at: string;
}

export function Widgets() {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState('');

  const { data: widgets = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ['widgets'],
    queryFn: () => apiFetch<{ widgets: Widget[] }>('/api/admin/widgets/'),
    select: (r) => r.widgets,
  });

  const createMut = useMutation({
    mutationFn: (n: string) =>
      apiFetch<Widget>('/api/admin/widgets/', {
        method: 'POST',
        json: { name: n },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['widgets'] });
      setName('');
      toast.success('Widget created');
    },
    onError: (e: unknown) => {
      toast.error((e as { message?: string }).message ?? 'Failed to create widget');
    },
  });

  return (
    <>
      <TopBar title="Widgets" />
      <div style={{ padding: 24, display: 'grid', gap: 16 }}>
        <Card title="Create">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) createMut.mutate(name.trim());
            }}
            style={{ display: 'flex', gap: 8 }}
          >
            <input
              type="text"
              value={name}
              onInput={(e) => setName((e.target as HTMLInputElement).value)}
              placeholder="widget-name"
              maxLength={128}
              style={{ flex: 1 }}
            />
            <Button type="submit" disabled={createMut.isPending || !name.trim()}>
              {createMut.isPending ? 'Creating…' : 'Create'}
            </Button>
          </form>
        </Card>

        <Card title="All widgets">
          {isLoading && <p>Loading…</p>}
          {isError && <ErrorState error={error} onRetry={refetch} />}
          {!isLoading && !isError && widgets.length === 0 && (
            <p style={{ color: 'var(--text-3)' }}>No widgets yet.</p>
          )}
          {widgets.length > 0 && (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {widgets.map((w) => (
                <li key={w.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
                  <code>{w.name}</code>
                  <span style={{ color: 'var(--text-3)', marginLeft: 8, fontSize: 12 }}>
                    {new Date(w.created_at).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
```

**Why:** TanStack Query gives you caching + retry + invalidation for free. The `select` option reshapes the response without re-fetching. TopBar + Card are the project's standard layout primitives.

### 2. Register the page in `AppShell`

**File:** `client/src/layout/AppShell.tsx`

Three edits:

1. Add the lazy import at the top (keep alphabetical order):
```tsx
const Widgets = lazy(() => import('../pages/Widgets').then((m) => ({ default: m.Widgets })));
```

2. Add `'widgets'` to `KNOWN_ROUTES` (keep alphabetical):
```ts
const KNOWN_ROUTES = [
  'aliases',
  'combos',
  // ...
  'widgets',
];
```

3. Add the switch case in the `<Page>` component:
```tsx
case 'widgets':
  return <Widgets />;
```

**Why:** The `KNOWN_ROUTES` array is what `g w` (go-to hotkey) and the `not found` fallback consult. If you don't add your route there, the page renders `<NotFound />` even if the switch case is correct.

### 3. Add a sidebar entry

**File:** `client/src/layout/Sidebar.tsx`

Find the array of nav items (likely `const NAV` or `const ITEMS`; search for the existing routes). Add:

```tsx
{ to: '/admin/widgets', label: 'Widgets', icon: <SomeIcon />, hotkey: 'w' }
```

Use an existing icon from `client/src/components/Icon.tsx` if one fits. The `hotkey` field powers the `g w` jump (the `KNOWN_ROUTES` list mirrors the available letters).

**Why:** Sidebar is the primary navigation. Command palette (`⌘K`) also reads this list.

### 4. (Optional) extract a sub-component

If the page grows past ~200 LOC, extract a `WidgetForm` or `WidgetRow` component to `client/src/components/`. Use the patterns from existing `AccountsTable.tsx` / `KiroDeviceFlowForm.tsx`.

**Why:** Pages that are too big are hard to test. Extracted components can be unit-tested in isolation.

### 5. Write a component test

**File:** `client/src/__tests__/Widgets.test.tsx` (new)

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/preact';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Widgets } from '../pages/Widgets';
import * as api from '../lib/api';

vi.mock('../lib/api');

describe('Widgets', () => {
  it('renders the list and a create form', async () => {
    vi.mocked(api.apiFetch).mockResolvedValueOnce({
      widgets: [{ id: 'widget_1', name: 'foo', created_at: '2026-01-01T00:00:00Z' }],
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <Widgets />
      </QueryClientProvider>
    );
    await waitFor(() => {
      expect(screen.getByText('foo')).toBeInTheDocument();
    });
  });
});
```

**Why:** Component tests catch regressions when the API contract changes. Mock the `apiFetch` helper, not the fetch global.

### 6. Add a row to the route map in `MEMORY.md`

**File:** `MEMORY.md`

Under "Read first" or "Knowledge resources", add a link to the new page if it's a major surface (skip for trivial additions).

## Test

```bash
cd client
npm run typecheck
npm test
npm run build
```

Expected: typecheck clean, tests green, build succeeds (catches missing imports + syntax errors).

## Commit

```bash
git add client/src/pages/Widgets.tsx \
        client/src/layout/AppShell.tsx \
        client/src/layout/Sidebar.tsx \
        client/src/components/WidgetForm.tsx \
        client/src/__tests__/Widgets.test.tsx

git commit -m "feat(client): add /admin/widgets page

List + create widgets via /api/admin/widgets/. Wired into
AppShell (lazy import, KNOWN_ROUTES, switch), Sidebar, and
tested in client/src/__tests__/Widgets.test.tsx.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

## Checklist

- [ ] `client/src/pages/Widgets.tsx` exports `Widgets`
- [ ] `AppShell.tsx` lazy imports + `KNOWN_ROUTES` + switch case
- [ ] `Sidebar.tsx` has a nav entry with a hotkey
- [ ] Component test green
- [ ] `cd client && npm run typecheck` green
- [ ] `cd client && npm run build` succeeds
- [ ] `MEMORY.md` updated (if major surface)

## See also

- [`../reference/admin-api-routes.md`](../reference/admin-api-routes.md): your endpoint contract
- [`../../AGENTS.md`](../../AGENTS.md): Dashboard section + TDD + test patterns
- [`add-an-admin-endpoint.md`](add-an-admin-endpoint.md): if you need a new backend route first
