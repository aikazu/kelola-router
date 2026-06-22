# UI/UX Audit Debt: Follow-up Items

> Created 2026-06-20 after merging `feat/uiux-audit-debt` (merge commit `97e4b18`).
> These are **pre-existing** issues surfaced during that work, out of scope for the
> audit-debt branch, tracked here for separate cleanup commits.

## 1. `npm run lint` is a silent no-op (P1: tooling correctness)

**Symptom:** `cd client && npm run lint` (invokes `biome check .`) reports
`Checked 0 files ... × No files were processed in the specified paths.` and exits
without scanning anything. Lint has effectively never run on the client tree.

**Root cause:** `client/biome.json` sets `"root": false`, so Biome resolves up to the
repo-root `biome.json`, whose `files.includes` contains `"!client"` (root `biome.json:14`),
which excludes the entire client subtree.

**Fix options (pick one):**
- Drop `"!client"` from root `biome.json` `files.includes`, OR
- Change the client script to scope explicitly:
  `"lint": "biome check --config-path=./biome.json src"`

**Heads-up:** when lint actually runs, ~124 errors / ~21 warnings surface immediately.
All of them are **pre-existing** formatter + a11y noise across the whole tree
(e.g. `Icon.tsx noSvgWithoutTitle`). That cleanup is its own task; do not bundle it
with the lint-config fix.

## 2. Dead imports in `Overview.tsx` (P3: trivial)

`client/src/pages/Overview.tsx:6-7` import `StatSkeleton` and `Stat`, both unused
(only appear on the import lines; verified via grep). `TableSkeleton` on line 6 **is**
used (3x); keep it.

**Fix:**
- Line 6: `import { StatSkeleton, TableSkeleton } from '../components/Skeleton';`
  becomes `import { TableSkeleton } from '../components/Skeleton';`
- Line 7: delete entirely (`import { Stat } from '../components/Stat';`)

`tsc` doesn't catch these because `noUnusedLocals` is off. Biome (once #1 is fixed) will.
Suggested commit: `chore(overview): remove unused Stat/StatSkeleton imports`.

## 3. `.field-hint` CSS rule missing (P3: latent)

The `Field` component (`client/src/components/Field.tsx`) renders
`<span class="field-hint">{hint}</span>` when a `hint` prop is passed, but `.field-hint`
is **not defined** in `components.css` (only `.field` and `.field-label` exist). No current
caller passes `hint`, so it's latent: the span would render unstyled if used. Either add a
minimal `.field-hint` rule (mono, small, muted; mirror `.field-label`) or drop the `hint`
prop until a consumer needs it.

## 4. Field migration: remaining intentional non-migrations (informational, NOT debt)

These were correctly left as manual markup; documenting so a future sweep doesn't
"fix" them by mistake:

- **AddModelModal / EditModelModal** pricing inputs use a side-by-side `<label style={{flex:1}}>`
  flex row. `Field`'s `<div class="field">` wrapper would break the 2-column layout.
- **AddAccountModal** text inputs use `aria-required="true"` (advisory), not the HTML
  `required` attribute. `Field` only emits `required` (constraint validation), which is a
  different a11y contract. `Field` cannot represent `aria-required`. Migrating would change
  behavior. If wanted, extend `Field` with an `ariaRequired?` prop first.
- **TransportAssignment**: 0 eligible; 3 selects, 1 checkbox, 1 number input with `min={1}`
  plus clamping logic (`Field` has no `min`/`max`/`step`).

`Field` is **text-input only** by design (`Field.tsx:18-21`). Extending it to selects,
textareas, `min`, or `aria-required` is a deliberate future decision, not leftover debt.
