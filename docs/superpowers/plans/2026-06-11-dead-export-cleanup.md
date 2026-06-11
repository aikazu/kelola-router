# Dead Export Cleanup — Plan A

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hapus keyword `export` dari simbol-simbol yang terbukti tidak pernah diimport di luar file definisi atau test file.

**Architecture:** Pure visibility reduction — tidak ada perubahan logic, tidak ada perubahan test. Hanya hapus `export` keyword. Typecheck + test suite harus tetap hijau.

**Tech Stack:** TypeScript strict, Vitest, Biome (lint), `npx vitest run`, `npm run typecheck`

---

### Task 1: Hapus export dari `applyErrorState` dan `resetAccountState` di `src/accounts/state.ts`

**Files:**
- Modify: `src/accounts/state.ts:9` — hapus `export` dari `applyErrorState`
- Modify: `src/accounts/state.ts:41` — hapus `export` dari `resetAccountState`
- Modify: `src/accounts/state.ts:4` — hapus `export` dari interface `ApplyErrorResult` (dipakai oleh `applyErrorState`, juga hanya test yang import)

Catatan: `src/accounts/state.test.ts` import keduanya — harus diupdate agar test tetap bisa akses fungsi ini.

- [ ] **Step 1: Verifikasi state.test.ts import pattern**

```bash
grep -n 'import' src/accounts/state.test.ts
```

Expected: ada import `applyErrorState`, `resetAccountState`, `ApplyErrorResult` dari `./state.js`

- [ ] **Step 2: Jalankan test sekarang untuk pastikan baseline hijau**

```bash
npx vitest run src/accounts/state.test.ts
```

Expected: PASS semua test

- [ ] **Step 3: Hapus `export` keyword dari ketiga simbol**

Edit `src/accounts/state.ts`:

```typescript
// Baris 4: ubah dari:
export interface ApplyErrorResult {
// menjadi:
interface ApplyErrorResult {

// Baris 9: ubah dari:
export function applyErrorState(
// menjadi:
function applyErrorState(

// Baris 41: ubah dari:
export function resetAccountState(account: AccountState): AccountState {
// menjadi:
function resetAccountState(account: AccountState): AccountState {
```

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```

Expected: error TS di `state.test.ts` karena import simbol non-exported

- [ ] **Step 5: Update state.test.ts — ganti import jadi langsung call fungsi internal**

Karena test butuh akses fungsi ini untuk verifikasi unit behavior, ada dua opsi:
- Opsi A: Pindahkan test ke dalam file yang sama (tidak ideal)
- Opsi B: Export ulang hanya untuk test via `export { applyErrorState, resetAccountState, ApplyErrorResult }` di bawah file dengan comment `// @internal`

Pilih Opsi B — lebih eksplisit:

Edit `src/accounts/state.ts`, tambahkan di baris terakhir:

```typescript
// @internal — exported for unit tests only; do not import in production code
export { applyErrorState, resetAccountState };
export type { ApplyErrorResult };
```

Dan hapus `export` keyword dari definisi (sudah dilakukan Step 3).

- [ ] **Step 6: Typecheck ulang**

```bash
npm run typecheck
```

Expected: no errors

- [ ] **Step 7: Jalankan test**

```bash
npx vitest run src/accounts/state.test.ts
```

Expected: PASS semua test

- [ ] **Step 8: Commit**

```bash
git add src/accounts/state.ts
git commit -m "refactor: mark applyErrorState and resetAccountState as internal"
```

---

### Task 2: Hapus export dari `_resetLockCleanupThrottle` di `src/accounts/locks.ts`

**Files:**
- Modify: `src/accounts/locks.ts:46`

Catatan: `_resetLockCleanupThrottle` sudah punya JSDoc comment `/** Test-only: ... */` — fungsinya benar test-only. Underscore prefix sudah sinyal konvensi. Bisa tetap `export` tapi dengan comment lebih tegas, atau bisa kita pindah ke pattern yang sama dengan Task 1.

Karena test file (`locks.test.ts`, `locks-throttle.test.ts`) import langsung dari `locks.js`, kita pertahankan export tapi buat lebih eksplisit di bawah file:

- [ ] **Step 1: Jalankan test baseline**

```bash
npx vitest run src/accounts/locks.test.ts src/accounts/locks-throttle.test.ts
```

Expected: PASS

- [ ] **Step 2: Pindahkan `_resetLockCleanupThrottle` ke bawah file, beri comment eksplisit**

Edit `src/accounts/locks.ts` — hapus fungsi dari posisi saat ini (baris 45–48), tambahkan di bagian paling bawah:

```typescript
// @internal — test-only; resets the 30-second throttle gate so each test starts clean
export function _resetLockCleanupThrottle(): void {
  lastCleanupAt = 0;
}
```

(Hapus JSDoc `/** Test-only: ... */` yang lama, ganti dengan inline comment)

- [ ] **Step 3: Jalankan test**

```bash
npx vitest run src/accounts/locks.test.ts src/accounts/locks-throttle.test.ts
```

Expected: PASS

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```

Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add src/accounts/locks.ts
git commit -m "refactor: move _resetLockCleanupThrottle to bottom of file as @internal"
```

---

### Task 3: Hapus export dari `extractUsageFromSSE` di `src/streaming/extractUsage.ts`

**Files:**
- Modify: `src/streaming/extractUsage.ts:16`

Produksi pakai `extractUsageFromSSEStream` (di `pipeWithUsage.ts:1,48,54`). `extractUsageFromSSE` hanya di `extractUsage.test.ts`.

- [ ] **Step 1: Verifikasi test import**

```bash
grep -n 'import' src/streaming/extractUsage.test.ts
```

Expected: `import { extractUsageFromSSE } from './extractUsage.js'`

- [ ] **Step 2: Test baseline**

```bash
npx vitest run src/streaming/extractUsage.test.ts
```

Expected: PASS

- [ ] **Step 3: Hapus `export` dari `extractUsageFromSSE`, tambahkan re-export @internal di bawah**

Edit `src/streaming/extractUsage.ts`:

```typescript
// Baris 16: ubah dari:
export function extractUsageFromSSE(raw: string, format: 'openai' | 'anthropic'): SSEParseResult {
// menjadi:
function extractUsageFromSSE(raw: string, format: 'openai' | 'anthropic'): SSEParseResult {
```

Tambahkan di baris paling bawah file:

```typescript
// @internal — exported for unit tests only; production code uses extractUsageFromSSEStream
export { extractUsageFromSSE };
```

- [ ] **Step 4: Typecheck + test**

```bash
npm run typecheck && npx vitest run src/streaming/extractUsage.test.ts
```

Expected: no errors, PASS

- [ ] **Step 5: Commit**

```bash
git add src/streaming/extractUsage.ts
git commit -m "refactor: mark extractUsageFromSSE as @internal, production uses extractUsageFromSSEStream"
```

---

### Task 4: Hapus export dari `discoverProfileArn` di `src/providers/kiro/profile.ts`

**Files:**
- Modify: `src/providers/kiro/profile.ts:39`

`discoverProfileArn` adalah private helper — dipanggil oleh `ensureProfileArn` di baris 88 dalam file yang sama. Test import langsung karena ingin test unit helper ini secara terpisah.

- [ ] **Step 1: Test baseline**

```bash
npx vitest run src/providers/kiro/profile.test.ts
```

Expected: PASS

- [ ] **Step 2: Hapus `export` dari definisi, tambahkan re-export @internal di bawah**

Edit `src/providers/kiro/profile.ts`:

```typescript
// Baris 39: ubah dari:
export async function discoverProfileArn(
// menjadi:
async function discoverProfileArn(
```

Tambahkan di baris paling bawah:

```typescript
// @internal — exported for unit tests only; callers should use ensureProfileArn
export { discoverProfileArn };
```

- [ ] **Step 3: Typecheck + test**

```bash
npm run typecheck && npx vitest run src/providers/kiro/profile.test.ts
```

Expected: no errors, PASS

- [ ] **Step 4: Commit**

```bash
git add src/providers/kiro/profile.ts
git commit -m "refactor: mark discoverProfileArn as @internal, callers use ensureProfileArn"
```

---

### Task 5: Hapus `export` dari 7 simbol internal di `src/providers/kiro/constants.ts`

**Files:**
- Modify: `src/providers/kiro/constants.ts`

Simbol yang pure internal (hanya dipakai dalam file sama, tidak diimport di manapun):
- `kiroEndpoint` (baris 31) — dipakai oleh `resolveKiroEndpoint` baris 50
- `kiroCliEndpoint` (baris 36) — dipakai oleh `resolveKiroEndpoint` baris 50
- `isAgenticModel` (baris 146) — dipakai oleh `resolveKiroModel` baris 163
- `isThinkingModel` (baris 150) — dipakai oleh `resolveKiroModel` baris 167
- `KIRO_AGENTIC_SUFFIX` (baris 111) — dipakai oleh `isAgenticModel` dan `resolveKiroModel`
- `KIRO_THINKING_SUFFIX` (baris 112) — dipakai oleh `isThinkingModel` dan `resolveKiroModel`
- `KIRO_THINKING_BUDGET_DEFAULT` (baris 113) — dipakai oleh `buildThinkingSystemPrefix`

`KiroModelResolution` (baris 140) — interface yang dipakai sebagai return type `resolveKiroModel` baris 159. Tidak diimport di luar file tapi dibutuhkan sebagai return type. Hapus `export`.

- [ ] **Step 1: Grep verifikasi tidak ada import dari luar**

```bash
grep -rn 'kiroEndpoint\|kiroCliEndpoint\|isAgenticModel\|isThinkingModel\|KIRO_AGENTIC_SUFFIX\|KIRO_THINKING_SUFFIX\|KIRO_THINKING_BUDGET_DEFAULT\|KiroModelResolution' src/ --include='*.ts' | grep -v 'constants\.ts'
```

Expected: hanya baris dari test files untuk `KiroModelResolution` via `resolveKiroModel` return type check (jika ada). Jika zero hits — aman hapus semua.

- [ ] **Step 2: Test baseline**

```bash
npx vitest run src/providers/kiro/constants.test.ts
```

Expected: PASS

- [ ] **Step 3: Hapus `export` dari 8 simbol**

Edit `src/providers/kiro/constants.ts` — ubah setiap baris berikut (hapus `export` keyword):

```typescript
// Baris 31:
function kiroEndpoint(region: string = KIRO_DEFAULT_REGION): string {

// Baris 36:
function kiroCliEndpoint(region: string = KIRO_DEFAULT_REGION): string {

// Baris 111:
const KIRO_AGENTIC_SUFFIX = '-agentic';

// Baris 112:
const KIRO_THINKING_SUFFIX = '-thinking';

// Baris 113:
const KIRO_THINKING_BUDGET_DEFAULT = 16000;

// Baris 140:
interface KiroModelResolution {

// Baris 146:
function isAgenticModel(model: string): boolean {

// Baris 150:
function isThinkingModel(model: string): boolean {
```

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```

Expected: no errors (semua simbol masih dipakai internal)

- [ ] **Step 5: Jalankan test**

```bash
npx vitest run src/providers/kiro/constants.test.ts
```

Expected: PASS

- [ ] **Step 6: Jalankan seluruh test suite**

```bash
npm test
```

Expected: all PASS

- [ ] **Step 7: Commit**

```bash
git add src/providers/kiro/constants.ts
git commit -m "refactor: unexport internal symbols in kiro/constants.ts (8 symbols)"
```

---

### Task 6: Final verification

- [ ] **Step 1: Typecheck full**

```bash
npm run typecheck
```

Expected: no errors

- [ ] **Step 2: Lint**

```bash
npm run lint
```

Expected: no errors

- [ ] **Step 3: Full test suite**

```bash
npm test
```

Expected: all PASS

- [ ] **Step 4: Commit jika ada perubahan lint auto-fix**

```bash
git diff --stat
# jika ada perubahan dari lint:fix
npm run lint:fix
git add -A
git commit -m "chore: lint fixes after dead export cleanup"
```
