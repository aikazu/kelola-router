---
name: add-dashboard-page
description: Add a new Preact page to the dashboard SPA with TanStack Query, hash routing, and sidebar entry.
when-to-use: When the user asks to add a new page, screen, or tab to the dashboard.
---

# Add a Dashboard Page

Full playbook: `docs/guides/add-a-dashboard-page.md`. Read it first.

## Steps

1. **Page component**: `client/src/pages/<Name>.tsx`. Use `useQuery` for data, `useMutation` for writes, `useToast` for feedback. Layout: `<TopBar title="<Name>" />` + `<Card>` blocks. Use `apiFetch<T>('/api/admin/<path>')` not raw `fetch`.
2. **Register in AppShell**: `client/src/layout/AppShell.tsx`:
   - Lazy import: `const <Name> = lazy(() => import('../pages/<Name>').then((m) => ({ default: m.<Name> })));`
   - Add `'<name>'` to `KNOWN_ROUTES` (alphabetical).
   - Add `case '<name>': return <<Name> />;` in the switch.
3. **Sidebar entry**: `client/src/layout/Sidebar.tsx`: add `{ to: '/admin/<name>', label: '<Name>', icon: <SomeIcon />, hotkey: '<letter>' }` to the nav array. Pick a unique hotkey letter.
4. **(Optional) extract**: if the page grows past ~200 LOC, extract sub-components to `client/src/components/`.
5. **Test**: `client/src/__tests__/<Name>.test.tsx`. Mock `apiFetch` (not global `fetch`). Wrap render in `<QueryClientProvider>`.
6. **Build**: `cd client && npm run build` catches missing imports.

## Test

```bash
cd client
npm run typecheck
npm test
npm run build
```

## Commit

```bash
git commit -m "feat(client): add /admin/<name> page

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

## See also

- `docs/guides/add-a-dashboard-page.md`: full playbook with code
- `client/src/layout/AppShell.tsx`: KNOWN_ROUTES + switch
- `client/src/layout/Sidebar.tsx`: nav array
- `client/src/lib/api.ts`: `apiFetch` helper
- Recent patterns (v0.18): model-lock visibility, inline label editing, Account column. See Accounts.tsx / Models.tsx.
