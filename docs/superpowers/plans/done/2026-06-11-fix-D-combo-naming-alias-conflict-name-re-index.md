# Fix D: Naming — combo shadow alias detection + NAME_RE sync + redundant index cleanup

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tiga perbaikan naming/consistency: (1) deteksi konflik jika combo name sama dengan model alias yang sudah ada, (2) sinkronkan frontend `NAME_RE` ke backend regex + tambah max-length guard, (3) hapus `CREATE UNIQUE INDEX` yang redundant di migration 005.

**Architecture:**
- Konflik alias: `createCombo` dan `updateCombo` di repo cek via `resolveAlias` apakah name sudah dipakai alias — jika ya, throw error yang di-handle sebagai 409 di API.
- NAME_RE: frontend `client/src/pages/Combos.tsx` update regex ke `/^[A-Za-z0-9._:-]{1,128}$/` dan tambah visual hint max 128 chars.
- Redundant index: hapus baris `CREATE UNIQUE INDEX` dari `src/db/migrations/005-combos.ts` — ini hanya SQL string, tidak ada migration baru diperlukan karena existing DBs sudah punya index dari column UNIQUE.

**Tech Stack:** TypeScript, Preact, better-sqlite3, Vitest

---

### Task 1: Test — createCombo reject name yang konflik dengan alias

**Files:**
- Modify: `src/db/repos/combos.test.ts`
- Modify: `src/db/repos/combos.ts`

- [ ] **Step 1: Tambah failing test**

Tambah di `src/db/repos/combos.test.ts` — perlu import tambahan:

```typescript
import { openDb } from '../index.js'; // sudah ada
// Tambah import:
import { upsertAlias } from './aliases.js';
```

Lalu tambah test:

```typescript
it('createCombo throws conflict error when name matches existing alias', () => {
  // Insert alias 'fast' → 'MiniMax-M3'
  db.prepare(
    `INSERT INTO model_aliases (alias_name, upstream_model, created_at)
     VALUES ('fast', 'MiniMax-M3', datetime('now'))`
  ).run();
  expect(() => createCombo(db, 'fast', ['MiniMax-M3'])).toThrow('alias_conflict');
});

it('updateCombo throws conflict error when new name matches existing alias', () => {
  db.prepare(
    `INSERT INTO model_aliases (alias_name, upstream_model, created_at)
     VALUES ('smart', 'MiniMax-M3', datetime('now'))`
  ).run();
  const combo = createCombo(db, 'my-combo', ['MiniMax-M3']);
  expect(() => updateCombo(db, combo.id, { name: 'smart' })).toThrow('alias_conflict');
});
```

- [ ] **Step 2: Jalankan test, pastikan FAIL**

```bash
npx vitest run src/db/repos/combos.test.ts -t "alias_conflict"
```

Expected: FAIL — `createCombo` tidak check alias.

---

### Task 2: Fix — tambah alias conflict check di createCombo dan updateCombo

**Files:**
- Modify: `src/db/repos/combos.ts`

- [ ] **Step 1: Tambah import dan alias check**

Di atas `src/db/repos/combos.ts`, tambah import (setelah `import { ulid } from 'ulid';`):

```typescript
import { listAliases } from './aliases.js';
```

Tambah helper function setelah `rowToCombo`:

```typescript
function checkAliasConflict(db: Database.Database, name: string, excludeComboId?: string): void {
  const aliases = listAliases(db);
  const aliasNames = new Set(aliases.map((a) => a.aliasName));
  if (aliasNames.has(name)) {
    throw new Error(`alias_conflict: combo name '${name}' is already used as a model alias`);
  }
}
```

Di `createCombo`, tambah check sebelum INSERT:

```typescript
export function createCombo(db: Database.Database, name: string, models: string[]): Combo {
  checkAliasConflict(db, name);
  const id = `combo_${ulid()}`;
  // ... sisa sama
```

Di `updateCombo`, tambah check di dalam transaksi jika name berubah:

```typescript
  const run = db.transaction(() => {
    const existing = getComboById(db, id);
    if (!existing) throw new Error(`combo not found: ${id}`);
    const newName = updates.name ?? existing.name;
    if (updates.name !== undefined && updates.name !== existing.name) {
      checkAliasConflict(db, updates.name);
    }
    // ... sisa sama
```

- [ ] **Step 2: Update API handler untuk map alias_conflict ke 409**

Di `src/api/admin/combos.ts`, pada POST dan PUT handler `catch` block, tambah deteksi:

POST handler catch (setelah UNIQUE constraint check):
```typescript
    if (e instanceof Error && e.message.startsWith('alias_conflict:')) {
      return handleApiError(
        new ApiError('alias_conflict', e.message.replace('alias_conflict: ', ''), 409)
      );
    }
```

PUT handler catch (setelah UNIQUE constraint check dan combo not found check):
```typescript
    if (e instanceof Error && e.message.startsWith('alias_conflict:')) {
      return handleApiError(
        new ApiError('alias_conflict', e.message.replace('alias_conflict: ', ''), 409)
      );
    }
```

- [ ] **Step 3: Jalankan test**

```bash
npx vitest run src/db/repos/combos.test.ts
```

Expected: semua PASS.

- [ ] **Step 4: Jalankan full test suite**

```bash
npm test
```

Expected: semua PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db/repos/combos.ts src/api/admin/combos.ts src/db/repos/combos.test.ts
git commit -m "fix(combos): reject combo name that conflicts with existing model alias"
```

---

### Task 3: Fix — sinkronkan frontend NAME_RE ke backend

**Files:**
- Modify: `client/src/pages/Combos.tsx:26`

- [ ] **Step 1: Update NAME_RE dan tambah length hint**

Cari baris 26 di `client/src/pages/Combos.tsx`:

```typescript
const NAME_RE = /^[a-zA-Z0-9._-]+$/;
```

Ganti dengan:

```typescript
const NAME_RE = /^[A-Za-z0-9._:-]{1,128}$/;
```

- [ ] **Step 2: Tambah hint di name input jika lebih dari 128 char**

Cari di modal form — tempat `nameValid` digunakan (sekitar baris 196). Cari blok input untuk name dan tambah helper text. Cari pola seperti:

```tsx
const nameValid = NAME_RE.test(name);
```

Ganti dengan:

```tsx
const nameValid = NAME_RE.test(name);
const nameTooLong = name.length > 128;
```

Lalu di tempat error/hint ditampilkan untuk name field, tambah kondisi `nameTooLong`. Cari existing validation hint untuk name — biasanya ada teks seperti `invalid name` di dekat input. Tambahkan:

```tsx
{nameTooLong && (
  <span class="field-hint field-hint--error">max 128 characters</span>
)}
```

- [ ] **Step 3: Build client dan cek tidak ada TypeScript error**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/Combos.tsx
git commit -m "fix(frontend): sync combo NAME_RE with backend — allow colon, enforce 128 char limit"
```

---

### Task 4: Cleanup — hapus redundant UNIQUE INDEX dari migration 005

**Files:**
- Modify: `src/db/migrations/005-combos.ts:19`

Catatan: ini hanya cleanup source code. Existing DBs yang sudah deploy memiliki index ini. Index tetap ada di production DB (tidak ada harm). Yang dihapus hanya baris SQL di source supaya tidak confusing.

- [ ] **Step 1: Hapus baris CREATE UNIQUE INDEX**

Cari `src/db/migrations/005-combos.ts` baris 19:

```typescript
    CREATE UNIQUE INDEX IF NOT EXISTS idx_combos_name ON combos(name);
```

Hapus baris ini. File menjadi:

```typescript
export const migration_005 = {
  id: 5,
  name: 'combos',
  sql: `
    CREATE TABLE IF NOT EXISTS combos (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL UNIQUE,
      models     TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `,
};
```

- [ ] **Step 2: Jalankan test suite untuk pastikan migration test tidak broke**

```bash
npx vitest run src/db/migrations/
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/db/migrations/005-combos.ts
git commit -m "chore(db): remove redundant explicit UNIQUE INDEX on combos.name (column UNIQUE already creates implicit index)"
```
