# Phase 4: v0.4 — RTK + Caveman + Cache Injection

> Part of [Master Plan](./2026-06-01-minimax-router.md). Requires Phase 3 done.
> Spec: `docs/spec/IMPLEMENTATION.md` §6 v0.4
> Target: 2-3h

**Goal:** Tool-output compression (smart-truncate, dedup-log), terse-prompt injection (caveman), dual cache_control breakpoint auto-injection. All global toggles in settings table, hot-reload.

**Done when:** tool_result blocks >500B get compressed, system prompt gets caveman injected, Anthropic requests get dual cache_control markers, idempotent (no double-markers).

---

## Task 4.1: Settings repo (KV with 1s cache)

**Files:**
- Create: `src/db/repos/settings.ts`
- Create: `src/db/repos/settings.test.ts`

- [x] **Step 1: Write failing tests**

`src/db/repos/settings.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { openDb } from "../index.js";
import { getSetting, setSetting } from "./settings.js";

beforeEach(() => {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), "s-")), "t.db");
});

describe("settings repo", () => {
  it("getSetting returns null for missing key", () => {
    const db = openDb();
    expect(getSetting(db, "nope")).toBeNull();
  });

  it("setSetting + getSetting roundtrip", () => {
    const db = openDb();
    setSetting(db, "caveman", { level: "terse" });
    expect(getSetting(db, "caveman")).toEqual({ level: "terse" });
  });

  it("setSetting overwrites existing", () => {
    const db = openDb();
    setSetting(db, "caveman", { level: "terse" });
    setSetting(db, "caveman", { level: "ultra" });
    expect(getSetting(db, "caveman")).toEqual({ level: "ultra" });
  });

  it("cache returns fresh value within 1s", () => {
    const db = openDb();
    setSetting(db, "caveman", { level: "off" });
    expect(getSetting(db, "caveman")).toEqual({ level: "off" });
    setSetting(db, "caveman", { level: "terse" });
    expect(getSetting(db, "caveman")).toEqual({ level: "terse" });
  });
});
```

- [x] **Step 2: Run tests (expect fail)**

Run: `npm test`
Expected: FAIL

- [x] **Step 3: Write `src/db/repos/settings.ts`**

```ts
import type Database from "better-sqlite3";

const cache = new Map<string, { value: unknown; expiry: number }>();
const TTL_MS = 1000;

export function getSetting<T = unknown>(db: Database.Database, key: string): T | null {
  const cached = cache.get(key);
  if (cached && cached.expiry > Date.now()) return cached.value as T;

  const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as { value: string } | undefined;
  if (!row) return null;

  const value = JSON.parse(row.value);
  cache.set(key, { value, expiry: Date.now() + TTL_MS });
  return value as T;
}

export function setSetting(db: Database.Database, key: string, value: unknown): void {
  const json = JSON.stringify(value);
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `).run(key, json);
  cache.delete(key);
}
```

- [x] **Step 4: Run tests (expect pass)**

Run: `npm test`
Expected: PASS — 100 tests (4 new)

- [x] **Step 5: Commit**

```bash
git add src/db/repos/settings.ts src/db/repos/settings.test.ts
git commit -m "feat: settings repo (KV with 1s cache)"
```

---

## Task 4.2: RTK core (constants, applyFilter, autodetect)

**Files:**
- Create: `src/rtk/constants.ts`
- Create: `src/rtk/types.ts`
- Create: `src/rtk/applyFilter.ts`
- Create: `src/rtk/{constants,applyFilter}.test.ts`

- [x] **Step 1: Write `src/rtk/constants.ts`**

```ts
export const RAW_CAP = 10 * 1024 * 1024;
export const MIN_COMPRESS_SIZE = 500;
export const DETECT_WINDOW = 1024;
export const SMART_TRUNCATE_HEAD = 120;
export const SMART_TRUNCATE_TAIL = 60;
export const SMART_TRUNCATE_MIN_LINES = 250;
export const DEDUP_LINE_MAX = 2000;
```

- [x] **Step 2: Write `src/rtk/types.ts`**

```ts
export interface FilterFn {
  (text: string): string;
  filterName: string;
}

export interface CompressHit {
  shape: string;
  filter: string;
  saved: number;
}

export interface CompressStats {
  bytesBefore: number;
  bytesAfter: number;
  hits: CompressHit[];
}
```

- [x] **Step 3: Write failing test for applyFilter**

`src/rtk/applyFilter.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { safeApply } from "./applyFilter.js";
import type { FilterFn } from "./types.js";

describe("safeApply", () => {
  it("returns original if filter is undefined", () => {
    expect(safeApply(undefined, "hello")).toBe("hello");
  });

  it("returns filter output on success", () => {
    const f: FilterFn = ((t: string) => t.toUpperCase()) as FilterFn;
    f.filterName = "upper";
    expect(safeApply(f, "hi")).toBe("HI");
  });

  it("returns original if filter throws", () => {
    const f = (() => { throw new Error("boom"); }) as unknown as FilterFn;
    f.filterName = "boom";
    expect(safeApply(f, "data")).toBe("data");
  });

  it("returns original if filter returns non-string", () => {
    const f = ((_t: string) => 42 as unknown as string) as FilterFn;
    f.filterName = "weird";
    expect(safeApply(f, "x")).toBe("x");
  });
});
```

- [x] **Step 4: Write `src/rtk/applyFilter.ts`**

```ts
import type { FilterFn } from "./types.js";

export function safeApply(fn: FilterFn | undefined, text: string): string {
  if (typeof fn !== "function") return text;
  try {
    const out = fn(text);
    if (typeof out !== "string") return text;
    return out;
  } catch (err: any) {
    const name = fn.filterName || "anonymous";
    console.warn(`[rtk] warning: filter '${name}' panicked — passing through: ${err?.message || err}`);
    return text;
  }
}
```

- [x] **Step 5: Run tests (expect pass)**

Run: `npm test`
Expected: PASS — 104 tests (4 new)

- [x] **Step 6: Commit**

```bash
git add src/rtk/
git commit -m "feat: rtk core (constants, types, applyFilter)"
```

---

## Task 4.3: RTK filters (smartTruncate, dedupLog)

**Files:**
- Create: `src/rtk/filters/smartTruncate.ts`
- Create: `src/rtk/filters/dedupLog.ts`
- Create: `src/rtk/filters/{smartTruncate,dedupLog}.test.ts`

- [x] **Step 1: Write failing tests**

`src/rtk/filters/smartTruncate.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { smartTruncate } from "./smartTruncate.js";

describe("smartTruncate", () => {
  it("returns original for short text", () => {
    const text = Array(100).fill("line").join("\n");
    expect(smartTruncate(text)).toBe(text);
  });

  it("truncates text with >250 lines, keeps head + tail", () => {
    const lines = Array(500).fill(0).map((_, i) => `line ${i}`);
    const out = smartTruncate(lines.join("\n"));
    expect(out).toContain("line 0");
    expect(out).toContain("line 499");
    expect(out).toContain("[320 lines truncated]");
    expect(out.split("\n").length).toBeLessThan(500);
  });
});

describe("dedupLog", () => {
  it("collapses repeated lines after 3 occurrences", async () => {
    const { dedupLog } = await import("./dedupLog.js");
    const lines = ["a", "a", "a", "a", "a", "b", "b", "b", "b"];
    const out = dedupLog(lines.join("\n"));
    expect(out).toContain("a\na\na\n... [a repeated]");
    expect(out).toContain("b\nb\nb\n... [b repeated]");
  });
});
```

- [x] **Step 2: Write `src/rtk/filters/smartTruncate.ts`**

```ts
import { SMART_TRUNCATE_HEAD, SMART_TRUNCATE_TAIL, SMART_TRUNCATE_MIN_LINES } from "../constants.js";
import type { FilterFn } from "../types.js";

export const smartTruncate: FilterFn = (text: string): string => {
  const lines = text.split("\n");
  if (lines.length < SMART_TRUNCATE_MIN_LINES) return text;
  const head = lines.slice(0, SMART_TRUNCATE_HEAD);
  const tail = lines.slice(-SMART_TRUNCATE_TAIL);
  const skipped = lines.length - SMART_TRUNCATE_HEAD - SMART_TRUNCATE_TAIL;
  return [...head, `... [${skipped} lines truncated] ...`, ...tail].join("\n");
};
smartTruncate.filterName = "smart-truncate";
```

- [x] **Step 3: Write `src/rtk/filters/dedupLog.ts`**

```ts
import { DEDUP_LINE_MAX } from "../constants.js";
import type { FilterFn } from "../types.js";

export const dedupLog: FilterFn = (text: string): string => {
  const lines = text.split("\n");
  const seen = new Map<string, number>();
  const result: string[] = [];

  for (const line of lines) {
    const count = seen.get(line) ?? 0;
    if (count < 3) {
      result.push(line);
      seen.set(line, count + 1);
    } else if (count === 3) {
      result.push(`... [${line} repeated]`);
      seen.set(line, count + 1);
    }
  }

  if (result.length > DEDUP_LINE_MAX) {
    return result.slice(0, DEDUP_LINE_MAX).join("\n") + `\n... [truncated to ${DEDUP_LINE_MAX} lines]`;
  }
  return result.join("\n");
};
dedupLog.filterName = "dedup-log";
```

- [x] **Step 4: Run tests (expect pass)**

Run: `npm test`
Expected: PASS — 106 tests (2 new)

- [x] **Step 5: Commit**

```bash
git add src/rtk/filters/
git commit -m "feat: rtk filters (smartTruncate, dedupLog)"
```

---

## Task 4.4: RTK autodetect + registry + compressMessages

**Files:**
- Create: `src/rtk/registry.ts`
- Create: `src/rtk/autodetect.ts`
- Create: `src/rtk/index.ts`
- Create: `src/rtk/{autodetect,index}.test.ts`

- [x] **Step 1: Write `src/rtk/registry.ts`**

```ts
import type { FilterFn } from "./types.js";
import { smartTruncate } from "./filters/smartTruncate.js";
import { dedupLog } from "./filters/dedupLog.js";

const FILTERS: Record<string, FilterFn> = {
  "smart-truncate": smartTruncate,
  "dedup-log": dedupLog,
};

export function getFilter(name: string): FilterFn | undefined {
  return FILTERS[name];
}
```

- [x] **Step 2: Write `src/rtk/autodetect.ts`**

```ts
import { getFilter } from "./registry.js";
import { DETECT_WINDOW } from "./constants.js";
import type { FilterFn } from "./types.js";

const SIGNATURES: Record<string, RegExp | null> = {
  "smart-truncate": null,
  "dedup-log": /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/m,
};

export function autoDetectFilter(text: string): FilterFn {
  const window = text.slice(0, DETECT_WINDOW);
  for (const [name, sig] of Object.entries(SIGNATURES)) {
    if (sig === null) continue;
    if (sig.test(window)) return getFilter(name)!;
  }
  return getFilter("smart-truncate")!;
}
```

- [x] **Step 3: Write failing test for compressMessages**

`src/rtk/index.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { compressMessages } from "./index.js";

describe("compressMessages", () => {
  it("returns null when body is null", () => {
    expect(compressMessages(null, true)).toBeNull();
  });

  it("returns null when enabled=false", () => {
    expect(compressMessages({ messages: [] }, false)).toBeNull();
  });

  it("returns null when no messages or input", () => {
    expect(compressMessages({ model: "x" }, true)).toBeNull();
  });

  it("compresses OpenAI tool string > 500 bytes with many lines", () => {
    const bigText = Array(300).fill("output line").join("\n");
    const body = { messages: [{ role: "tool", content: bigText }] };
    const stats = compressMessages(body, true);
    expect(stats).not.toBeNull();
    expect(stats!.bytesBefore).toBeGreaterThan(500);
    expect(stats!.bytesAfter).toBeLessThan(stats!.bytesBefore);
    expect(stats!.hits.length).toBeGreaterThan(0);
    expect(body.messages[0].content.length).toBeLessThan(bigText.length);
  });

  it("compresses Anthropic tool_result content block", () => {
    const bigText = Array(300).fill("x").join("\n");
    const body = {
      system: "you are helpful",
      messages: [{ role: "user", content: [{ type: "tool_result", content: bigText }] }],
    };
    const stats = compressMessages(body, true);
    expect(stats).not.toBeNull();
    expect(body.messages[0].content[0].content.length).toBeLessThan(bigText.length);
  });

  it("leaves short tool results alone", () => {
    const body = { messages: [{ role: "tool", content: "short" }] };
    const stats = compressMessages(body, true);
    expect(stats).toBeNull();
  });

  it("leaves error tool_results alone (is_error=true)", () => {
    const bigText = Array(300).fill("x").join("\n");
    const body = { messages: [{ role: "user", content: [{ type: "tool_result", content: bigText, is_error: true }] }] };
    const stats = compressMessages(body, true);
    expect(stats).toBeNull();
  });
});
```

- [x] **Step 4: Write `src/rtk/index.ts`**

```ts
import { RAW_CAP, MIN_COMPRESS_SIZE } from "./constants.js";
import { autoDetectFilter } from "./autodetect.js";
import { safeApply } from "./applyFilter.js";
import type { CompressStats } from "./types.js";

export function compressMessages(body: any, enabled: boolean): CompressStats | null {
  if (!enabled) return null;
  if (!body) return null;

  const items: any[] | null = Array.isArray(body.messages) ? body.messages
    : Array.isArray(body.input) ? body.input
    : null;
  if (!items) return null;

  const stats: CompressStats = { bytesBefore: 0, bytesAfter: 0, hits: [] };
  try {
    for (const msg of items) {
      if (!msg) continue;
      if (msg.type === "function_call_output") {
        if (typeof msg.output === "string") msg.output = compressText(msg.output, stats, "openai-responses");
        else if (Array.isArray(msg.output)) {
          for (const part of msg.output) {
            if (part?.type === "input_text" && typeof part.text === "string") {
              part.text = compressText(part.text, stats, "openai-responses-array");
            }
          }
        }
        continue;
      }
      if (msg.role === "tool" && typeof msg.content === "string") {
        msg.content = compressText(msg.content, stats, "openai-tool");
        continue;
      }
      if (msg.role === "tool" && Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part?.type === "text" && typeof part.text === "string") {
            part.text = compressText(part.text, stats, "openai-tool-array");
          }
        }
        continue;
      }
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (!block || block.type !== "tool_result") continue;
          if (block.is_error === true) continue;
          if (typeof block.content === "string") {
            block.content = compressText(block.content, stats, "claude-string");
          } else if (Array.isArray(block.content)) {
            for (const part of block.content) {
              if (part?.type === "text" && typeof part.text === "string") {
                part.text = compressText(part.text, stats, "claude-array");
              }
            }
          }
        }
      }
    }
  } catch (e: any) {
    console.warn("[RTK] compressMessages error:", e.message);
    return null;
  }
  return stats;
}

function compressText(text: string, stats: CompressStats, shape: string): string {
  const bytesIn = text.length;
  stats.bytesBefore += bytesIn;
  if (bytesIn < MIN_COMPRESS_SIZE || bytesIn > RAW_CAP) {
    stats.bytesAfter += bytesIn;
    return text;
  }
  const fn = autoDetectFilter(text);
  if (!fn) { stats.bytesAfter += bytesIn; return text; }
  const out = safeApply(fn, text);
  if (!out || out.length === 0 || out.length >= bytesIn) {
    stats.bytesAfter += bytesIn;
    return text;
  }
  stats.bytesAfter += out.length;
  stats.hits.push({ shape, filter: fn.filterName, saved: bytesIn - out.length });
  return out;
}

export function formatRtkLog(stats: CompressStats | null): string | null {
  if (!stats || !stats.hits?.length) return null;
  const saved = stats.bytesBefore - stats.bytesAfter;
  const pct = stats.bytesBefore > 0 ? ((saved / stats.bytesBefore) * 100).toFixed(1) : "0";
  const filters = [...new Set(stats.hits.map(h => h.filter))].join(",");
  return `[RTK] saved ${saved}B / ${stats.bytesBefore}B (${pct}%) via [${filters}] hits=${stats.hits.length}`;
}
```

- [x] **Step 5: Run tests (expect pass)**

Run: `npm test`
Expected: PASS — 113 tests (7 new)

- [x] **Step 6: Commit**

```bash
git add src/rtk/
git commit -m "feat: rtk compressMessages + formatRtkLog"
```

---

## Task 4.5: Caveman injection

**Files:**
- Create: `src/caveman/prompts.ts`
- Create: `src/caveman/index.ts`
- Create: `src/caveman/index.test.ts`

- [x] **Step 1: Write `src/caveman/prompts.ts`**

```ts
export const CAVEMAN_PROMPTS: Record<string, string> = {
  terse: "Be concise. Use short sentences. No filler. No preamble. Get straight to the answer.",
  ultra: "Reply like a caveman. Few words. No politeness. Just answer.",
};

export type CavemanLevel = "off" | "terse" | "ultra";
```

- [x] **Step 2: Write failing test**

`src/caveman/index.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { injectCaveman } from "./index.js";

describe("injectCaveman", () => {
  it("no-op when level=off", () => {
    const body: any = { system: "hi" };
    injectCaveman(body, "off");
    expect(body.system).toBe("hi");
  });

  it("appends to Anthropic string system", () => {
    const body: any = { system: "you are helpful" };
    injectCaveman(body, "terse");
    expect(body.system).toContain("you are helpful");
    expect(body.system).toContain("Be concise");
  });

  it("creates system array with text+cache_control when missing", () => {
    const body: any = { system: [{ type: "text", text: "a" }, { type: "text", text: "b", cache_control: { type: "ephemeral" } }] };
    injectCaveman(body, "terse");
    expect(body.system.length).toBe(3);
    expect(body.system[0].text).toBe("a");
    expect(body.system[1].text).toBe("b");
    expect(body.system[1].cache_control).toBeDefined();
    expect(body.system[2].text).toBe("Be concise");
  });

  it("appends to OpenAI messages[0] (system role)", () => {
    const body: any = { messages: [{ role: "system", content: "old" }, { role: "user", content: "hi" }] };
    injectCaveman(body, "terse");
    expect(body.messages[0].content).toContain("old");
    expect(body.messages[0].content).toContain("Be concise");
  });

  it("prepends new system message if no system role exists", () => {
    const body: any = { messages: [{ role: "user", content: "hi" }] };
    injectCaveman(body, "ultra");
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[0].content).toContain("Reply like a caveman");
  });

  it("appends to messages[] content array system", () => {
    const body: any = { messages: [{ role: "system", content: [{ type: "text", text: "old" }] }] };
    injectCaveman(body, "terse");
    expect(body.messages[0].content.length).toBe(2);
    expect(body.messages[0].content[1].text).toBe("Be concise");
  });
});
```

- [x] **Step 3: Write `src/caveman/index.ts`**

```ts
import { CAVEMAN_PROMPTS } from "./prompts.js";
import type { CavemanLevel } from "./prompts.js";

const SEP = "\n\n";

export function injectCaveman(body: any, level: CavemanLevel): void {
  const prompt = CAVEMAN_PROMPTS[level];
  if (!body || !prompt) return;

  if (body.system !== undefined) {
    injectClaudeSystem(body, prompt);
  } else {
    injectMessagesSystem(body, prompt);
  }
}

function injectMessagesSystem(body: any, prompt: string): void {
  if (typeof body.instructions === "string") {
    body.instructions = body.instructions ? `${body.instructions}${SEP}${prompt}` : prompt;
    return;
  }
  const arr: any[] | null = Array.isArray(body.messages) ? body.messages
    : Array.isArray(body.input) ? body.input
    : null;
  if (!arr) return;

  const idx = arr.findIndex((m: any) => m && (m.role === "system" || m.role === "developer"));
  if (idx >= 0) {
    appendToOpenAIMessage(arr[idx], prompt);
  } else {
    arr.unshift({ role: "system", content: prompt });
  }
}

function appendToOpenAIMessage(msg: any, prompt: string): void {
  if (typeof msg.content === "string") {
    msg.content = `${msg.content}${SEP}${prompt}`;
  } else if (Array.isArray(msg.content)) {
    msg.content.push({ type: "text", text: prompt });
  } else {
    msg.content = prompt;
  }
}

function injectClaudeSystem(body: any, prompt: string): void {
  if (typeof body.system === "string") {
    body.system = body.system.length > 0 ? `${body.system}${SEP}${prompt}` : prompt;
    return;
  }
  if (Array.isArray(body.system)) {
    const block = { type: "text", text: prompt };
    let lastCacheIdx = -1;
    for (let i = body.system.length - 1; i >= 0; i--) {
      if (body.system[i]?.cache_control) { lastCacheIdx = i; break; }
    }
    if (lastCacheIdx >= 0) {
      body.system.splice(lastCacheIdx, 0, block);
    } else {
      body.system.push(block);
    }
    return;
  }
  body.system = prompt;
}
```

- [x] **Step 4: Run tests (expect pass)**

Run: `npm test`
Expected: PASS — 119 tests (6 new)

- [x] **Step 5: Commit**

```bash
git add src/caveman/
git commit -m "feat: caveman prompt injection (Anthropic + OpenAI shapes)"
```

---

## Task 4.6: Dual cache_control breakpoint injection

**Files:**
- Create: `src/cache-injection.ts`
- Create: `src/cache-injection.test.ts`

- [x] **Step 1: Write failing tests**

`src/cache-injection.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { addDualCacheBreakpoints, augmentRequest } from "./cache-injection.js";

describe("addDualCacheBreakpoints", () => {
  it("no-op for non-Anthropic shape", () => {
    const body: any = { messages: [{ role: "user", content: "hi" }] };
    addDualCacheBreakpoints(body);
    expect(body.messages[0].cache_control).toBeUndefined();
  });

  it("adds marker to last system block (string → array)", () => {
    const body: any = { system: "you are helpful", messages: [] };
    addDualCacheBreakpoints(body);
    expect(Array.isArray(body.system)).toBe(true);
    expect(body.system[0].cache_control).toEqual({ type: "ephemeral" });
  });

  it("adds marker to last system block (array)", () => {
    const body: any = { system: [{ type: "text", text: "a" }, { type: "text", text: "b" }], messages: [] };
    addDualCacheBreakpoints(body);
    expect(body.system[1].cache_control).toEqual({ type: "ephemeral" });
  });

  it("adds marker to last assistant tool_use", () => {
    const body: any = {
      system: [{ type: "text", text: "x", cache_control: { type: "ephemeral" } }],
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: [{ type: "text", text: "thinking..." }, { type: "tool_use", id: "tu_1", name: "x", input: {} }] },
        { role: "user", content: "ok" },
      ],
    };
    addDualCacheBreakpoints(body);
    const lastAssistant = body.messages[1].content[1];
    expect(lastAssistant.cache_control).toEqual({ type: "ephemeral" });
  });

  it("respects existing markers (does not overwrite)", () => {
    const body: any = {
      system: [{ type: "text", text: "x", cache_control: { type: "ephemeral" } }],
      messages: [],
    };
    addDualCacheBreakpoints(body);
    expect(body.system[0].cache_control).toEqual({ type: "ephemeral" });
  });

  it("respectCallerMarkers=false forces marker even if some blocks have them", () => {
    const body: any = {
      system: [{ type: "text", text: "a", cache_control: { type: "ephemeral" } }, { type: "text", text: "b" }],
      messages: [],
    };
    addDualCacheBreakpoints(body, false);
    expect(body.system[1].cache_control).toEqual({ type: "ephemeral" });
  });
});

describe("augmentRequest", () => {
  it("runs caveman first (mutates system), then cache markers (wrap augmented prefix)", () => {
    const body: any = {
      system: [{ type: "text", text: "a", cache_control: { type: "ephemeral" } }],
      messages: [],
    };
    augmentRequest(body, {
      caveman: { level: "terse" },
      caching: { autoBreakpoints: true, respectCallerMarkers: true },
    });
    expect(body.system.length).toBe(2);
    expect(body.system[1].text).toBe("Be concise");
  });
});
```

- [x] **Step 2: Run tests (expect fail)**

Run: `npm test`
Expected: FAIL

- [x] **Step 3: Write `src/cache-injection.ts`**

```ts
export function addDualCacheBreakpoints(body: any, respectCallerMarkers = true): void {
  if (body.system === undefined) return;

  if (Array.isArray(body.system) && body.system.length > 0) {
    const last = body.system[body.system.length - 1];
    if (!last.cache_control && (!respectCallerMarkers || !hasAnyCacheControl(body.system))) {
      last.cache_control = { type: "ephemeral" };
    }
  } else if (typeof body.system === "string" && body.system.length > 0) {
    body.system = [{ type: "text", text: body.system, cache_control: { type: "ephemeral" } }];
  }

  if (Array.isArray(body.messages)) {
    for (let i = body.messages.length - 1; i >= 0; i--) {
      const msg = body.messages[i];
      if (msg.role === "assistant" && Array.isArray(msg.content)) {
        for (let j = msg.content.length - 1; j >= 0; j--) {
          const block = msg.content[j];
          if (block.type === "tool_use" || block.type === "text") {
            if (!block.cache_control) block.cache_control = { type: "ephemeral" };
            return;
          }
        }
      }
    }
  }
}

function hasAnyCacheControl(arr: any[]): boolean {
  for (const block of arr) {
    if (block?.cache_control) return true;
    if (Array.isArray(block?.content)) {
      for (const part of block.content) {
        if (part?.cache_control) return true;
      }
    }
  }
  return false;
}

export async function augmentRequest(body: any, settings: { caveman?: { level: string }; caching?: { autoBreakpoints: boolean; respectCallerMarkers: boolean } }): Promise<void> {
  if (settings.caveman?.level && settings.caveman.level !== "off") {
    const { injectCaveman } = await import("./caveman/index.js");
    injectCaveman(body, settings.caveman.level as any);
  }
  if (settings.caching?.autoBreakpoints && body.system !== undefined) {
    addDualCacheBreakpoints(body, settings.caching.respectCallerMarkers);
  }
}
```

- [x] **Step 4: Run tests (expect pass)**

Run: `npm test`
Expected: PASS — 126 tests (7 new)

- [x] **Step 5: Commit**

```bash
git add src/cache-injection.ts src/cache-injection.test.ts
git commit -m "feat: dual cache_control breakpoint + augmentRequest orchestrator"
```

---

## Task 4.7: Wire augment + RTK into handleProxy

**Files:**
- Modify: `src/server.ts`

- [x] **Step 1: Write failing test**

`src/server.test.ts` (append):
```ts
describe("augmentation in proxy", () => {
  beforeEach(() => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), "aug-")), "t.db");
  });

  it("caveman=terse: Anthropic request gets caveman injected into system", async () => {
    const db = openDb();
    const u = createUser(db, "u");
    createAccount(db, { id: "acc_a", user_id: u.id, label: "L", credit_type: "payg", api_key: "kk" });
    db.prepare(`UPDATE settings SET value = ? WHERE key = 'caveman'`).run('{"level":"terse"}');
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response('{"content":[{"type":"text","text":"x"}]}', { status: 200 }),
    );
    const req = new Request("http://localhost/v1/messages", {
      method: "POST",
      headers: { Authorization: `Bearer ${u.api_key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "MiniMax-M3", max_tokens: 100, system: "you are helpful", messages: [{ role: "user", content: "hi" }] }),
    });
    const res = await app.request(req);
    expect(res.status).toBe(200);
    const sent = JSON.parse(spy.mock.calls[0][1].body as string);
    expect(sent.system).toContain("Be concise");
  });

  it("caching=autoBreakpoints: Anthropic request gets cache marker", async () => {
    const db = openDb();
    const u = createUser(db, "u");
    createAccount(db, { id: "acc_b", user_id: u.id, label: "L", credit_type: "payg", api_key: "kk" });
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response('{"content":[{"type":"text","text":"x"}]}', { status: 200 }),
    );
    const req = new Request("http://localhost/v1/messages", {
      method: "POST",
      headers: { Authorization: `Bearer ${u.api_key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "MiniMax-M3", max_tokens: 100, system: "you are helpful", messages: [{ role: "user", content: "hi" }] }),
    });
    const res = await app.request(req);
    expect(res.status).toBe(200);
    const sent = JSON.parse(spy.mock.calls[0][1].body as string);
    expect(sent.system[0].cache_control).toEqual({ type: "ephemeral" });
  });
});
```

- [x] **Step 2: Run test (expect fail)**

Run: `npm test`
Expected: FAIL

- [x] **Step 3: Add to `handleProxy` in `src/server.ts`**

Add imports:
```ts
import { augmentRequest } from "./cache-injection.js";
import { compressMessages, formatRtkLog } from "./rtk/index.js";
import { getSetting } from "./db/repos/settings.js";
```

Right after `const body = await c.req.json();`:
```ts
const db = c.get("db");
const settings = {
  caveman: getSetting(db, "caveman") as { level: string } | null,
  caching: getSetting(db, "caching") as { autoBreakpoints: boolean; respectCallerMarkers: boolean } | null,
};
await augmentRequest(body, settings);

const rtkSetting = getSetting(db, "rtk") as { enabled: boolean } | null;
if (rtkSetting?.enabled) {
  const stats = compressMessages(body, true);
  const log = formatRtkLog(stats);
  if (log) console.log(log);
}
```

- [x] **Step 4: Run tests (expect pass)**

Run: `npm test`
Expected: PASS — 128 tests (2 new)

- [x] **Step 5: Commit**

```bash
git add src/server.ts src/server.test.ts
git commit -m "feat: wire caveman + cache injection + RTK into handleProxy"
```

---

## Task 4.8: Phase 4 checkpoint

- [x] **Step 1: Full test suite**

Run: `npm test`
Expected: 128+ tests pass

- [x] **Step 2: Type check**

Run: `npx tsc --noEmit`
Expected: no errors

- [x] **Step 3: Commit + tag**

```bash
git add .
git commit -m "chore: phase 4 v0.4 checkpoint" --allow-empty
git tag v0.4
```

---

**End of Phase 4.** Continue to [Phase 5: v0.5 Quota + Dashboard](./2026-06-01-minimax-router-phase-5-v05-quota-dashboard.md).
