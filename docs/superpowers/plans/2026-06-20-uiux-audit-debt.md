# UI/UX Audit Debt & Deferred Items Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining debt from the UI/UX audit commit `6741fd6` — fix one visual regression it introduced, finish the deferred Overview URL-sync, pay down small CSS a11y debt (touch targets, overscroll), and optionally consolidate ~55 inline form-label fixes into a reusable `Field` component.

**Architecture:** Preact + TypeScript SPA (hash-routed, TanStack Query). Dark "Obsidian Gold" theme. Styles in three global CSS files (`base.css`, `components.css`, `animations.css`). Tests are Vitest + `@testing-library/preact`, living in `client/src/__tests__/` and beside components as `*.test.tsx`. The audit already achieved WCAG compliance inline; this plan removes a regression and reduces structural debt — it does NOT add new compliance surface except where noted.

**Tech Stack:** Preact, TypeScript (strict, no `any`), Vitest, @testing-library/preact, Biome, Vite.

**Context recap — what's already done (commit `6741fd6`, do NOT redo):**
- 149 audit findings applied inline (keyboard access, aria-labels, names/autocomplete, focus-visible, i18n, copy).
- `Button` has `aria-label`/`aria-pressed`; `Icon` optional `label`; `Card` title → `h2`; `Stat` → `dl/dt/dd`.
- Form labels associated via `htmlFor`/`id` inline across account/model/transport modals + Login/Settings.

**Cross-cutting conventions (apply to every task):**
- Preact JSX: `class=` not `className`; `onInput`/`onChange` read `(e.target as HTMLInputElement).value`.
- Preact lowercases some DOM props: use `spellcheck` NOT `spellCheck` (TS error otherwise — this bit us already).
- Strict TS, no `any`. Run `cd client && npx tsc --noEmit` — must report 0 errors.
- After CSS-only changes (not unit-testable in jsdom): verify with `cd client && npx vite build` (must succeed) + the exact grep assertions given.
- Commit per task. Conventional Commits. English commit messages.
- Line endings: files must stay LF. If your editor writes CRLF on Windows, the diff will balloon — after editing run `sed -i 's/\r$//' <file>` on touched files before `git add`, and confirm with `file <path>` showing no "CRLF".

---

## File Structure

| File | Responsibility | Tasks |
|---|---|---|
| `client/src/styles/base.css` | Add missing `.sr-only` utility (P0 regression fix) | 1 |
| `client/src/pages/Settings.tsx` | Consumer of `.sr-only` — verify after fix | 1 |
| `client/src/pages/Overview.tsx` | Add URL hash sync for `days` range | 2 |
| `client/src/__tests__/Overview.test.tsx` | New test for Overview URL-sync | 2 |
| `client/src/styles/components.css` | Touch-target min-height on `.btn-sm`; overscroll on sidebar drawer | 3 |
| `client/src/components/Field.tsx` | NEW reusable label+input wrapper (optional G1) | 4 |
| `client/src/components/__tests__/Field.test.tsx` | NEW test for Field | 4 |
| `client/src/components/models/AddModelModal.tsx` | First migration to `Field` (proof) | 5 |

---

## Task 1: Fix `.sr-only` regression (P0)

**Problem:** Commit `6741fd6` added `<label class="sr-only">` in `Settings.tsx` (lines 56, 70, 212) to give password/select fields accessible names without visible duplicate labels. But `.sr-only` is **not defined** in any CSS file (only `.skip-link` exists). Result: those three labels render as plain visible text — a visual regression. Fix = define the standard screen-reader-only utility.

**Files:**
- Modify: `client/src/styles/base.css` (add `.sr-only` near `.skip-link`, ~line 186)
- Verify (no edit): `client/src/pages/Settings.tsx:56,70,212`

- [ ] **Step 1: Confirm the regression exists**

Run:
```bash
cd client && grep -rn 'class="sr-only"' src/ && grep -rn '\.sr-only' src/styles/
```
Expected: 3 usages in `Settings.tsx`, and **zero** matches in `src/styles/` (class undefined → bug confirmed).

- [ ] **Step 2: Add the `.sr-only` utility to base.css**

Open `client/src/styles/base.css`, find the `.skip-link` block (around line 186). Immediately **before** it, add:

```css
/* Screen-reader-only: visually hidden but exposed to assistive tech.
   Used for <label> elements that name a control which already has a
   visible context, so the label must not render visibly. */
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
```

- [ ] **Step 3: Verify the rule is present and class is now defined**

Run:
```bash
cd client && grep -n '\.sr-only' src/styles/base.css
```
Expected: one match showing the new selector.

- [ ] **Step 4: Verify build succeeds (CSS compiles, class shipped)**

Run:
```bash
cd client && npx vite build 2>&1 | tail -3
```
Expected: `✓ built in ...ms`, no CSS errors.

- [ ] **Step 5: Normalize line endings + commit**

```bash
cd client && sed -i 's/\r$//' src/styles/base.css && file src/styles/base.css
git add src/styles/base.css
git commit -m "fix(ui): define missing .sr-only utility used by Settings labels

Commit 6741fd6 added class=\"sr-only\" labels in Settings.tsx but never
defined the class, so the labels rendered visibly. Add the standard
screen-reader-only utility next to .skip-link."
```

---

## Task 2: Overview page URL-sync for date range (deferred / nav)

**Problem:** `Usage.tsx` syncs all its filters to the URL hash (deep-linkable, back/forward works). `Overview.tsx` has the same `days` range select but keeps it only in `useState` — no deep linking, no back/forward. Mirror the Usage pattern for the single `days` param.

**Reference pattern:** `client/src/pages/Usage.tsx:83-97` (read on mount + `hashchange` listener) and `Usage.tsx:115-120` (`replaceState` on change). Overview only needs the `days` param, so it's a trimmed version.

**Files:**
- Modify: `client/src/pages/Overview.tsx` (add `useEffect` import + two effects; current state at line 40 `const [days, setDays] = useState(1)`)
- Test: `client/src/__tests__/Overview.test.tsx` (new)

- [ ] **Step 1: Write the failing test**

Create `client/src/__tests__/Overview.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Overview } from '../pages/Overview';

// Stub the API so the component renders without network.
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
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd client && npx vitest run src/__tests__/Overview.test.tsx
```
Expected: FAIL — first test fails because `location.hash` never gets `days=7` (no sync code yet).

- [ ] **Step 3: Add the URL-sync effects**

In `client/src/pages/Overview.tsx`:

a) Change the hooks import on line 2 from:
```tsx
import { useState } from 'preact/hooks';
```
to:
```tsx
import { useEffect, useState } from 'preact/hooks';
```

b) Immediately after the `const [days, setDays] = useState(1);` line (line 40), add:

```tsx
  // URL sync: read days on mount + react to hashchange (back/forward).
  useEffect(() => {
    const onHash = () => {
      const p = new URLSearchParams(location.hash.split('?')[1] ?? '');
      if (p.get('days') !== null) setDays(Number(p.get('days')));
    };
    onHash();
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // URL sync: write days on change.
  useEffect(() => {
    const newHash = `#/admin/overview?days=${days}`;
    if (location.hash !== newHash) history.replaceState(null, '', newHash);
  }, [days]);
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd client && npx vitest run src/__tests__/Overview.test.tsx
```
Expected: PASS (2 tests).

- [ ] **Step 5: Run full client gates**

Run:
```bash
cd client && npx tsc --noEmit && npx vitest run 2>&1 | grep -E "Test Files|Tests "
```
Expected: tsc 0 errors; all test files pass.

- [ ] **Step 6: Normalize + commit**

```bash
cd client && sed -i 's/\r$//' src/pages/Overview.tsx src/__tests__/Overview.test.tsx
git add src/pages/Overview.tsx src/__tests__/Overview.test.tsx
git commit -m "feat(overview): sync date range to URL hash for deep linking

Mirror the Usage page pattern so the Overview range is deep-linkable and
survives browser back/forward."
```

---

## Task 3: Touch-target & overscroll CSS debt (a11y polish)

**Problem (two parts):**
1. **Touch targets:** `.btn-sm` (used densely in table row actions like TransportsTable: Edit/Test/Disable/Delete) has no `min-height`. WCAG 2.5.5 / mobile usability wants ≥44px hit targets. Add a touch-only floor so desktop density is preserved but coarse-pointer (touch) devices get bigger targets.
2. **Overscroll:** `.modal-body` already has `overscroll-behavior: contain` (components.css:553), but the mobile sidebar drawer (`.sidebar-open` / `.sidebar-overlay`, components.css:1182/1200) does not — scroll momentum can leak to the page behind the open drawer.

**Files:**
- Modify: `client/src/styles/components.css` (`.btn-sm` block ~line 120; sidebar mobile block ~line 1182/1200)

- [ ] **Step 1: Confirm current state**

Run:
```bash
cd client && sed -n '120,128p' src/styles/components.css && echo "--- sidebar mobile ---" && sed -n '1180,1205p' src/styles/components.css
```
Expected: `.btn-sm` has no `min-height`; `.sidebar-overlay`/`.sidebar-open` have no `overscroll-behavior`.

- [ ] **Step 2: Add a touch-only min-height for small buttons**

In `client/src/styles/components.css`, immediately **after** the closing `}` of the `.btn-sm { ... }` block (around line 120-124), add:

```css
/* On touch/coarse-pointer devices, floor small buttons to a 44px hit target
   (WCAG 2.5.5). Desktop fine-pointer density is left unchanged. */
@media (pointer: coarse) {
  .btn-sm {
    min-height: 44px;
  }
}
```

- [ ] **Step 3: Add overscroll containment to the mobile drawer**

In `client/src/styles/components.css`, inside the mobile media query, find the `.sidebar-overlay { ... }` rule (around line 1200). Add `overscroll-behavior: contain;` to its declaration block. If `.sidebar-open` (the opened drawer, ~line 1182) is the scrollable element, add the same line there too:

```css
  .sidebar-overlay {
    /* ...existing declarations... */
    overscroll-behavior: contain;
  }
```

(Only add to `.sidebar-open` if it sets `overflow-y: auto`/`scroll`; inspect the block first — if it does not scroll, the overlay rule is sufficient and you should note that in the commit.)

- [ ] **Step 4: Verify the rules are present**

Run:
```bash
cd client && grep -n 'pointer: coarse' src/styles/components.css && grep -c 'overscroll-behavior' src/styles/components.css
```
Expected: one `pointer: coarse` match; `overscroll-behavior` count increased from 1 to 2 (or 3 if `.sidebar-open` also got it).

- [ ] **Step 5: Verify build**

Run:
```bash
cd client && npx vite build 2>&1 | tail -3
```
Expected: `✓ built`.

- [ ] **Step 6: Normalize + commit**

```bash
cd client && sed -i 's/\r$//' src/styles/components.css && file src/styles/components.css
git add src/styles/components.css
git commit -m "fix(ui): touch-target floor for .btn-sm and overscroll containment for mobile drawer

Add 44px min-height for small buttons on coarse pointers (WCAG 2.5.5) and
contain scroll momentum on the mobile sidebar drawer."
```

---

## Task 4 (OPTIONAL — G1): Create reusable `Field` component

> **Decision gate:** Compliance is ALREADY met inline (commit `6741fd6`). This task and Task 5 are a structural refactor to stop repeating the label+input boilerplate across ~55 sites and prevent future drift. Do this only if reducing that duplication is wanted now. If skipping, stop after Task 3 — the codebase is fully compliant without it.

**Scope:** `Field` handles the common **text/number input + visible label** case only. Selects and textareas keep their existing manual `<label htmlFor>` markup (their markup varies too much to unify cheaply — YAGNI).

**Files:**
- Create: `client/src/components/Field.tsx`
- Test: `client/src/components/__tests__/Field.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `client/src/components/__tests__/Field.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { Field } from '../Field';

describe('Field', () => {
  it('associates the label with the input via htmlFor/id', () => {
    render(
      <Field id="email" label="Email" value="" onInput={() => {}} type="email" />,
    );
    const input = screen.getByLabelText('Email');
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute('id', 'email');
    expect(input).toHaveAttribute('type', 'email');
  });

  it('forwards name, autocomplete, placeholder, required', () => {
    render(
      <Field
        id="key"
        label="API key"
        value=""
        onInput={() => {}}
        name="api_key"
        autocomplete="off"
        placeholder="mm_…"
        required
      />,
    );
    const input = screen.getByLabelText('API key');
    expect(input).toHaveAttribute('name', 'api_key');
    expect(input).toHaveAttribute('autocomplete', 'off');
    expect(input).toHaveAttribute('placeholder', 'mm_…');
    expect(input).toBeRequired();
  });

  it('calls onInput with the new value', () => {
    const onInput = vi.fn();
    render(<Field id="n" label="Name" value="" onInput={onInput} />);
    fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'abc' } });
    expect(onInput).toHaveBeenCalledWith('abc');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd client && npx vitest run src/components/__tests__/Field.test.tsx
```
Expected: FAIL — `Field` not found / cannot resolve `../Field`.

- [ ] **Step 3: Implement `Field`**

Create `client/src/components/Field.tsx`:

```tsx
import type { JSX } from 'preact';

interface FieldProps {
  id: string;
  label: string;
  value: string;
  onInput: (value: string) => void;
  type?: 'text' | 'number' | 'email' | 'password' | 'search' | 'url';
  name?: string;
  autocomplete?: string;
  placeholder?: string;
  required?: boolean;
  inputMode?: JSX.HTMLAttributes<HTMLInputElement>['inputMode'];
  spellcheck?: boolean;
  hint?: string;
}

/**
 * Label + text/number input with guaranteed htmlFor/id association.
 * Consolidates the repeated form-field boilerplate (audit finding G1).
 * Selects and textareas keep their own markup — Field is text-input only.
 */
export function Field({
  id,
  label,
  value,
  onInput,
  type = 'text',
  name,
  autocomplete,
  placeholder,
  required,
  inputMode,
  spellcheck,
  hint,
}: FieldProps) {
  return (
    <div class="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type={type}
        name={name}
        value={value}
        onInput={(e) => onInput((e.target as HTMLInputElement).value)}
        autocomplete={autocomplete}
        placeholder={placeholder}
        required={required}
        inputMode={inputMode}
        spellcheck={spellcheck}
        class="input"
      />
      {hint && <span class="field-hint">{hint}</span>}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd client && npx vitest run src/components/__tests__/Field.test.tsx
```
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck**

Run:
```bash
cd client && npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 6: Normalize + commit**

```bash
cd client && sed -i 's/\r$//' src/components/Field.tsx src/components/__tests__/Field.test.tsx
git add src/components/Field.tsx src/components/__tests__/Field.test.tsx
git commit -m "feat(ui): add reusable Field component (label + associated input)

Consolidates the repeated form-field boilerplate from the audit (G1).
Text-input only; selects/textareas keep their own markup."
```

---

## Task 5 (OPTIONAL — G1 cont.): Migrate AddModelModal to `Field` as proof

**Purpose:** Prove `Field` is a drop-in and the modal still passes its tests, before fanning out to the other modals. AddModelModal currently has 3 text/number inputs with manual `<label htmlFor>` (lines 88, 101, 113) plus two pricing inputs (128, 142).

**Files:**
- Modify: `client/src/components/models/AddModelModal.tsx`
- Existing test (must still pass): `client/src/__tests__/` — check for an AddModelModal test; ProviderModelsSection has one. Run the suite to be safe.

- [ ] **Step 1: Read the current modal to capture exact field props**

Run:
```bash
cd client && sed -n '85,160p' src/components/models/AddModelModal.tsx
```
Capture for each input: its `id`, label text, `value` binding, `onInput` handler, `name`, `type`, `placeholder`, `autocomplete`. These exact values must be preserved in the migration (do not invent new ones).

- [ ] **Step 2: Add the import**

At the top of `client/src/components/models/AddModelModal.tsx`, add:
```tsx
import { Field } from '../Field';
```

- [ ] **Step 3: Replace each text/number `<label htmlFor>…<input/></label>` block with `<Field />`**

For each of the three standalone inputs (name, display-name, context-window), replace the manual label+input pair with a `Field` using the **same** `id`, label text, `value`, `name`, `type`, `placeholder`, and `autocomplete` you captured in Step 1. Example for the name field (adapt values to what Step 1 showed):

```tsx
<Field
  id="add-model-name"
  label="Call name"
  value={form.name}
  onInput={(v) => onFormChange({ ...form, name: v })}
  name="model-name"
  autocomplete="off"
  placeholder="<keep existing placeholder>"
/>
```

Leave the two pricing inputs (lines 128/142) **as-is** if they use a shared-row flex layout with `style={{ flex: 1 }}` on the label — Field's `div.field` wrapper would break that row. Migrate them only if they are standalone; otherwise note them as intentionally skipped.

- [ ] **Step 4: Run the modal/related tests**

Run:
```bash
cd client && npx vitest run 2>&1 | grep -E "Test Files|Tests "
```
Expected: all pass (no test asserted on the old wrapper markup; they query by label text / placeholder, which `Field` preserves).

- [ ] **Step 5: Typecheck + build**

Run:
```bash
cd client && npx tsc --noEmit && npx vite build 2>&1 | tail -2
```
Expected: 0 TS errors; build succeeds.

- [ ] **Step 6: Normalize + commit**

```bash
cd client && sed -i 's/\r$//' src/components/models/AddModelModal.tsx
git add src/components/models/AddModelModal.tsx
git commit -m "refactor(models): migrate AddModelModal text inputs to Field component

Proof migration for the G1 Field consolidation. Behavior and accessible
names unchanged; tests green."
```

- [ ] **Step 7: Decide on remaining migrations**

After this proof, the remaining migration targets (each its own commit, same mechanical pattern) are:
- `client/src/components/models/EditModelModal.tsx`
- `client/src/components/accounts/AddAccountModal.tsx`
- `client/src/components/accounts/EditAccountModal.tsx`
- `client/src/components/transports/AddTransportModal.tsx`
- `client/src/components/transports/EditTransportModal.tsx`
- `client/src/components/transports/BulkImportModal.tsx`
- `client/src/components/TransportAssignment.tsx`

These are optional and low-risk. Stop here unless the duplication reduction is explicitly wanted — compliance does not depend on them.

---

## Self-Review

**1. Spec coverage** — every deferred/debt item from the audit recap is covered:
- ✅ `.sr-only` regression (newly found in re-check) → Task 1
- ✅ Overview URL-sync (deferred/nav) → Task 2
- ✅ Touch targets 44×44 + overscroll on drawer (fase "Later") → Task 3
- ✅ G1 `Field` consolidation (~55 inline fixes) → Tasks 4–5 (optional, with migration list)
- ⏹️ `prefers-reduced-motion` for `.stagger` — intentionally NOT a task: already covered by the global `* { animation-duration: 0.01ms }` rule in `base.css` (verified during audit).
- ⏹️ Heading-semantics polish beyond `Card`/`Stat` — not currently a flagged finding; out of scope.

**2. Placeholder scan** — no TBD/TODO/"add error handling"/"similar to Task N". All code steps contain complete code; migration values are explicitly captured from source in Task 5 Step 1 rather than guessed.

**3. Type consistency** — `Field` prop names (`id`, `label`, `value`, `onInput`, `type`, `name`, `autocomplete`, `placeholder`, `required`, `inputMode`, `spellcheck`, `hint`) are identical in the component (Task 4 Step 3), its test (Task 4 Step 1), and the usage (Task 5 Step 3). `spellcheck` (lowercase) used consistently per the Preact convention noted up top.

**Risk note:** Task 5 Step 3 calls out the flex-row pricing inputs as a layout hazard for `Field` — this is the one place the mechanical migration can break visual layout, hence the explicit "leave as-is" guard.
