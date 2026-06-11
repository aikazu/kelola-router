# Kiro Frame-Decode Deduplication — Plan B

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ekstrak pola decode loop (`ChunkAccumulator + decodeFrames`) yang identik di tiga tempat menjadi satu helper `consumeKiroStream`, sehingga tiga call sites tinggal memanggil helper tersebut.

**Architecture:** Buat satu fungsi `consumeKiroStream<T>(body: ReadableStream<Uint8Array>, onEvent: (e: KiroEvent) => T[]): AsyncGenerator<T>` di file baru `src/providers/kiro/streamConsumer.ts`. Ketiga fungsi (`kiroResponseToAnthropicSSE`, `kiroResponseToOpenAISSE`, `kiroResponseToOpenAIJson`) direfactor untuk memakai helper ini. Logic assembler tidak berubah — hanya layer decode yang dikonsolidasikan.

**Tech Stack:** TypeScript strict, Vitest, `AsyncGenerator`, `TransformStream`, `ReadableStream`, `ChunkAccumulator`, `decodeFrames`

---

### Task 1: Pahami exact shape ketiga decode loop sebelum menulis apapun

**Files:**
- Read: `src/providers/kiro/anthropicSse.ts:237–265`
- Read: `src/providers/kiro/assembler.ts:229–260` (SSE path)
- Read: `src/providers/kiro/assembler.ts:291–315` (JSON/buffered path)
- Read: `src/providers/kiro/chunkAccumulator.ts`
- Read: `src/providers/kiro/eventstream.ts`

- [ ] **Step 1: Catat exact signature dari `decodeFrames`**

```bash
grep -n 'decodeFrames\|export function decodeFrames\|interface KiroEvent\|type KiroEvent' src/providers/kiro/eventstream.ts
```

Expected: lihat return type `{ events: KiroEvent[]; rest: Uint8Array }` dan shape `KiroEvent`

- [ ] **Step 2: Catat perbedaan antara SSE path dan JSON path**

SSE path (anthropicSse + assembler SSE):
- Gunakan `TransformStream<Uint8Array, Uint8Array>`
- `controller.enqueue(serialized)` per event
- Ada `flush(controller)` untuk drain assembler

JSON path (assembler.ts kiroResponseToOpenAIJson):
- Gunakan `reader.read()` loop (async for)
- Kumpulkan hasil ke array `chunks[]`
- Panggil `assembler.flush()` di akhir

Dua shape berbeda → helper harus support keduanya, atau buat dua helper berbeda.

- [ ] **Step 3: Putuskan desain**

Lihat kode lagi:

```bash
sed -n '228,270p' src/providers/kiro/assembler.ts
sed -n '291,330p' src/providers/kiro/assembler.ts
sed -n '236,270p' src/providers/kiro/anthropicSse.ts
```

Keputusan: Buat satu helper `consumeKiroFrames` sebagai `AsyncGenerator` yang yields `KiroEvent` dari `ReadableStream`. Ini bekerja untuk kedua path:
- SSE path: pipe generator output ke TransformStream (atau gunakan pola push)
- JSON path: collect semua events dari generator ke array

---

### Task 2: Buat `src/providers/kiro/streamConsumer.ts` dengan unit test

**Files:**
- Create: `src/providers/kiro/streamConsumer.ts`
- Create: `src/providers/kiro/streamConsumer.test.ts`

- [ ] **Step 1: Tulis failing test dulu (TDD)**

Buat `src/providers/kiro/streamConsumer.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { consumeKiroFrames } from './streamConsumer.js';
import { type KiroEvent } from './eventstream.js';

// Build a minimal valid AWS event-stream frame for testing.
// Frame layout: 4-byte total-length + 4-byte header-length + 4-byte prelude-CRC
// + headers + payload + 4-byte message-CRC.
// For unit testing we use the real decodeFrames — feed it pre-encoded bytes
// from a known-good source, OR mock decodeFrames.
// We mock decodeFrames to keep the test self-contained.

import * as eventstreamModule from './eventstream.js';
import { vi } from 'vitest';

function makeStream(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  });
}

describe('consumeKiroFrames', () => {
  it('yields events decoded from a single chunk', async () => {
    const fakeEvent: KiroEvent = { type: 'assistantResponseEvent', payload: { content: 'hi' } };
    vi.spyOn(eventstreamModule, 'decodeFrames').mockReturnValue({
      events: [fakeEvent],
      rest: new Uint8Array(0),
    });

    const stream = makeStream([new Uint8Array([1, 2, 3])]);
    const results: KiroEvent[] = [];
    for await (const ev of consumeKiroFrames(stream)) {
      results.push(ev);
    }

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual(fakeEvent);
    vi.restoreAllMocks();
  });

  it('handles leftover bytes across chunks', async () => {
    const fakeEvent: KiroEvent = { type: 'assistantResponseEvent', payload: { content: 'x' } };
    let callCount = 0;
    vi.spyOn(eventstreamModule, 'decodeFrames').mockImplementation(() => {
      callCount++;
      if (callCount === 1) return { events: [], rest: new Uint8Array([9, 9]) }; // leftover
      return { events: [fakeEvent], rest: new Uint8Array(0) };
    });

    const stream = makeStream([new Uint8Array([1]), new Uint8Array([2])]);
    const results: KiroEvent[] = [];
    for await (const ev of consumeKiroFrames(stream)) {
      results.push(ev);
    }

    expect(results).toHaveLength(1);
    vi.restoreAllMocks();
  });

  it('yields nothing for empty stream', async () => {
    vi.spyOn(eventstreamModule, 'decodeFrames').mockReturnValue({
      events: [],
      rest: new Uint8Array(0),
    });
    const stream = makeStream([]);
    const results: KiroEvent[] = [];
    for await (const ev of consumeKiroFrames(stream)) results.push(ev);
    expect(results).toHaveLength(0);
    vi.restoreAllMocks();
  });
});
```

- [ ] **Step 2: Jalankan test — pastikan FAIL**

```bash
npx vitest run src/providers/kiro/streamConsumer.test.ts
```

Expected: FAIL — `consumeKiroFrames` not found

- [ ] **Step 3: Buat implementasi minimal di `src/providers/kiro/streamConsumer.ts`**

```typescript
import { ChunkAccumulator } from './chunkAccumulator.js';
import { decodeFrames, type KiroEvent } from './eventstream.js';

/**
 * Consume a Kiro binary response body and yield decoded KiroEvents one by one.
 * Handles partial frames via ChunkAccumulator — safe to call with any chunk size.
 */
export async function* consumeKiroFrames(
  body: ReadableStream<Uint8Array>
): AsyncGenerator<KiroEvent> {
  const reader = body.getReader();
  const acc = new ChunkAccumulator();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    acc.push(value);
    const merged = acc.view();
    const { events, rest: leftover } = decodeFrames(merged);
    acc.consume(merged.length - leftover.length);
    for (const event of events) yield event;
  }
}
```

- [ ] **Step 4: Jalankan test — pastikan PASS**

```bash
npx vitest run src/providers/kiro/streamConsumer.test.ts
```

Expected: 3 PASS

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/providers/kiro/streamConsumer.ts src/providers/kiro/streamConsumer.test.ts
git commit -m "feat(kiro): add consumeKiroFrames helper to consolidate decode loop"
```

---

### Task 3: Refactor `kiroResponseToOpenAIJson` di `assembler.ts` pakai helper

**Files:**
- Modify: `src/providers/kiro/assembler.ts:291–315`

Path ini paling simpel — sudah async for-loop, tinggal ganti decode loop dengan `consumeKiroFrames`.

- [ ] **Step 1: Test baseline assembler**

```bash
npx vitest run src/providers/kiro/
```

Expected: PASS semua

- [ ] **Step 2: Tambahkan import di assembler.ts**

Edit `src/providers/kiro/assembler.ts`, tambahkan di baris import (setelah import ChunkAccumulator dan decodeFrames):

```typescript
import { consumeKiroFrames } from './streamConsumer.js';
```

- [ ] **Step 3: Refactor `kiroResponseToOpenAIJson`**

Temukan fungsi ini (sekitar baris 291). Ganti body loop lama:

```typescript
// LAMA (hapus ini):
  const assembler = new KiroAssembler(model);
  const chunks: OpenAIChunk[] = [];
  if (response.body) {
    const reader = response.body.getReader();
    const acc = new ChunkAccumulator();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      acc.push(value);
      const merged = acc.view();
      const { events, rest: leftover } = decodeFrames(merged);
      acc.consume(merged.length - leftover.length);
      for (const event of events) chunks.push(...assembler.process(event));
    }
  }
  chunks.push(...assembler.flush());
```

```typescript
// BARU (tulis ini):
  const assembler = new KiroAssembler(model);
  const chunks: OpenAIChunk[] = [];
  if (response.body) {
    for await (const event of consumeKiroFrames(response.body)) {
      chunks.push(...assembler.process(event));
    }
  }
  chunks.push(...assembler.flush());
```

- [ ] **Step 4: Hapus import yang tidak lagi dipakai di assembler.ts**

Cek apakah `ChunkAccumulator` dan `decodeFrames` masih dipakai di assembler.ts (untuk `kiroResponseToOpenAISSE`):

```bash
grep -n 'ChunkAccumulator\|decodeFrames' src/providers/kiro/assembler.ts
```

Jika masih ada (untuk SSE path di Task 4 nanti) — biarkan import. Jika sudah tidak ada — hapus import.

- [ ] **Step 5: Typecheck + test**

```bash
npm run typecheck && npx vitest run src/providers/kiro/
```

Expected: no errors, PASS

- [ ] **Step 6: Commit**

```bash
git add src/providers/kiro/assembler.ts
git commit -m "refactor(kiro): use consumeKiroFrames in kiroResponseToOpenAIJson"
```

---

### Task 4: Refactor `kiroResponseToOpenAISSE` di `assembler.ts` pakai helper

**Files:**
- Modify: `src/providers/kiro/assembler.ts:229–260`

Path SSE pakai TransformStream — butuh sedikit lebih banyak adaptasi karena `consumeKiroFrames` adalah async generator, bukan TransformStream transformer langsung.

- [ ] **Step 1: Baca exact shape `kiroResponseToOpenAISSE` sekarang**

```bash
sed -n '228,265p' src/providers/kiro/assembler.ts
```

- [ ] **Step 2: Refactor**

Ganti implementasi `kiroResponseToOpenAISSE`:

```typescript
// LAMA:
export function kiroResponseToOpenAISSE(response: Response, model: string): Response {
  const assembler = new KiroAssembler(model);
  const acc = new ChunkAccumulator();

  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      acc.push(chunk);
      const merged = acc.view();
      const { events, rest: leftover } = decodeFrames(merged);
      acc.consume(merged.length - leftover.length);
      for (const event of events) {
        for (const c of assembler.process(event)) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(c)}\n\n`));
        }
      }
    },
    flush(controller) {
      for (const c of assembler.flush()) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(c)}\n\n`));
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
    },
  });

  // ... pipe + headers
}
```

```typescript
// BARU:
export function kiroResponseToOpenAISSE(response: Response, model: string): Response {
  const assembler = new KiroAssembler(model);

  const outputStream = new ReadableStream<Uint8Array>({
    async start(controller) {
      if (response.body) {
        for await (const event of consumeKiroFrames(response.body)) {
          for (const c of assembler.process(event)) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(c)}\n\n`));
          }
        }
      }
      for (const c of assembler.flush()) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(c)}\n\n`));
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });

  // Pertahankan headers yang sama persis:
  return new Response(outputStream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
```

Catatan: Periksa exact header shape di kode asli sebelum menulis — `sed -n '260,280p' src/providers/kiro/assembler.ts`

- [ ] **Step 3: Typecheck + test**

```bash
npm run typecheck && npx vitest run src/providers/kiro/
```

Expected: no errors, PASS

- [ ] **Step 4: Hapus import ChunkAccumulator dan decodeFrames dari assembler.ts jika tidak lagi dipakai**

```bash
grep -n 'ChunkAccumulator\|decodeFrames' src/providers/kiro/assembler.ts
```

Jika zero hits — hapus dari import baris 9–10.

- [ ] **Step 5: Commit**

```bash
git add src/providers/kiro/assembler.ts
git commit -m "refactor(kiro): use consumeKiroFrames in kiroResponseToOpenAISSE"
```

---

### Task 5: Refactor `kiroResponseToAnthropicSSE` di `anthropicSse.ts` pakai helper

**Files:**
- Modify: `src/providers/kiro/anthropicSse.ts:237–270`

Shape identik dengan Task 4 (SSE path), beda hanya di assembler class dan serializer.

- [ ] **Step 1: Baca exact shape**

```bash
sed -n '236,275p' src/providers/kiro/anthropicSse.ts
```

- [ ] **Step 2: Tambahkan import**

Edit `src/providers/kiro/anthropicSse.ts` — tambahkan import:

```typescript
import { consumeKiroFrames } from './streamConsumer.js';
```

- [ ] **Step 3: Refactor `kiroResponseToAnthropicSSE`**

Ganti TransformStream loop dengan ReadableStream + consumeKiroFrames:

```typescript
// LAMA (loop di dalam TransformStream):
  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      acc.push(chunk);
      const merged = acc.view();
      const { events, rest: leftover } = decodeFrames(merged);
      acc.consume(merged.length - leftover.length);
      for (const event of events) {
        for (const ev of assembler.process(event)) controller.enqueue(serialize(ev));
      }
    },
    flush(controller) {
      for (const ev of assembler.flush()) controller.enqueue(serialize(ev));
      controller.enqueue(serialize({ event: 'message_stop', data: { type: 'message_stop' } }));
    },
  });
```

```typescript
// BARU:
  const outputStream = new ReadableStream<Uint8Array>({
    async start(controller) {
      if (response.body) {
        for await (const event of consumeKiroFrames(response.body)) {
          for (const ev of assembler.process(event)) controller.enqueue(serialize(ev));
        }
      }
      for (const ev of assembler.flush()) controller.enqueue(serialize(ev));
      controller.enqueue(serialize({ event: 'message_stop', data: { type: 'message_stop' } }));
      controller.close();
    },
  });
```

Periksa exact `flush` output dan header shape di kode asli sebelum menulis.

- [ ] **Step 4: Hapus import ChunkAccumulator dan decodeFrames dari anthropicSse.ts**

```bash
grep -n 'ChunkAccumulator\|decodeFrames' src/providers/kiro/anthropicSse.ts
```

Jika zero hits setelah refactor — hapus dari import.

- [ ] **Step 5: Typecheck + test**

```bash
npm run typecheck && npx vitest run src/providers/kiro/
```

Expected: no errors, PASS

- [ ] **Step 6: Full test suite**

```bash
npm test
```

Expected: all PASS

- [ ] **Step 7: Commit**

```bash
git add src/providers/kiro/anthropicSse.ts
git commit -m "refactor(kiro): use consumeKiroFrames in kiroResponseToAnthropicSSE"
```

---

### Task 6: Final cleanup + verification

- [ ] **Step 1: Pastikan ChunkAccumulator dan decodeFrames hanya diimport oleh streamConsumer**

```bash
grep -rn 'ChunkAccumulator\|from.*chunkAccumulator\|from.*eventstream' src/providers/kiro/ --include='*.ts' | grep -v test | grep -v streamConsumer
```

Expected: tidak ada hasil (atau hanya constants.ts / eventstream.ts sendiri)

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: no errors

- [ ] **Step 3: Lint**

```bash
npm run lint
```

Expected: no errors

- [ ] **Step 4: Full test suite**

```bash
npm test
```

Expected: all PASS

- [ ] **Step 5: Commit akhir jika ada sisa**

```bash
git diff --stat
git add -A
git commit -m "chore(kiro): remove now-unused ChunkAccumulator/decodeFrames imports after decode dedup"
```
