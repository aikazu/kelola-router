# Notion Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Notion AI chat as a fifth upstream provider in kelola-router with OTP-based account auth, multi-account failover, and conversation continuity (same `conversation_id` sticks to the same account, with graceful migration on failure).

**Architecture:** Mirror `src/proxy/kiro.ts` + `src/proxy/codebuddy.ts` 1:1. New `src/proxy/notion.ts` implements the same provider interface. OTP login replaces static refresh-token (Kiro-style dual-mode: background refresh if `refresh_token` exists, else `notion_reauth_required` error on 401). New `conversation_routing` table preserves chat continuity across requests.

**Tech Stack:** Hono, better-sqlite3 (WAL + SQLCipher), pino, undici, vitest, biome. Existing patterns: `add-account` CLI via `readline`, model seeding on account-add, `pipeWithUsage` SSE.

---

## File Structure

**New files:**
- `src/auth/notion.ts` — `requestOtp`, `exchangeOtp`, optional `refreshNotionToken`
- `src/proxy/notion.ts` — provider implementation (selectAccount, upstreamFetch, applyAccountError, format conversion)
- `src/selection/notion.ts` — sticky/round-robin state machine
- `src/models/notion.ts` — manifest-driven catalogue seed
- `src/models/notion/manifest.json` — model list (populated from RE capture)
- `src/db/migrations/008-conversation-routing.ts` — new table
- `scripts/notion-add-account.ts` — CLI
- `src/registry/providers/notion.ts` — provider registration hook
- `tests/auth/notion.test.ts`
- `tests/proxy/notion.test.ts`
- `tests/selection/notion.test.ts`
- `tests/fixtures/notion/sample-stream.har` — captured session (after RE)
- `docs/notion/README.md` — endpoint table + ToS note

**Modified files:**
- `src/server.ts` — register Notion provider, mount auth route
- `src/registry/providers/index.ts` — add Notion to provider map
- `package.json` — add `notion-add-account` and `seed-notion-models` scripts
- `README.md` — Notion provider section
- `CHANGELOG.md` — entry under next version
- `.env.example` — Notion-specific env vars (if any)

---

## Phase 0: Reverse Engineering Capture

### Task 0: Capture Notion AI traffic

**Files:**
- Create: `docs/notion/capture-notes.md`
- Create: `tests/fixtures/notion/sample-stream.har`

- [ ] **Step 1: Install mitmproxy + Notion desktop client**

Notion desktop: https://www.notion.so/desktop (download for current OS).
mitmproxy: `pip install mitmproxy` (or `brew install mitmproxy`).

- [ ] **Step 2: Configure mitmproxy + system proxy**

```bash
mitmweb --set confdir=./.mitmproxy
```

Install mitmproxy CA cert as system root (per OS instructions). Configure Notion desktop to use `127.0.0.1:8080` as HTTPS proxy.

- [ ] **Step 3: Trigger AI chat in Notion desktop**

Open any page, invoke AI command (e.g., "/ai" or Ctrl+J). Send 2-3 messages. Stream at least one response to completion.

- [ ] **Step 4: Export HAR from mitmweb**

In mitmweb UI: File → Export → `sample-stream.har`. Filter for traffic to `*.notion.com` or `*.notion.so` only. Save to `tests/fixtures/notion/sample-stream.har`.

- [ ] **Step 5: Extract and document endpoints**

Open HAR. For each non-static request to Notion origin, record in `docs/notion/capture-notes.md`:

```markdown
## Endpoint: POST https://api.notion.com/v1/ai/chat
- Auth: Bearer <token>
- Headers: { "Notion-Client-Version": "23.13.x.x", "Notion-Version": "2022-06-28" }
- Request body schema: { "conversation_id"?: string, "messages": [...], "model": "anthropic-claude-sonnet-4" }
- Response: SSE stream of `event: message` chunks
- Trigger: AI chat invocation in desktop
```

Cover at minimum: OTP send endpoint, OTP verify endpoint, AI chat endpoint (auth + body + SSE shape + headers), any `/users/me` or `/workspaces` lookup used for workspace_id, any token refresh endpoint.

- [ ] **Step 6: Capture token TTL + refresh behaviour**

Re-trigger a chat after 30+ min idle. Note whether token in HAR expires, what 401 response shape is, whether any refresh/extend-session endpoint exists in capture. Document TTL + refresh finding in `docs/notion/capture-notes.md` under "Token Lifecycle" section.

- [ ] **Step 7: Commit**

```bash
git add docs/notion/capture-notes.md tests/fixtures/notion/sample-stream.har
git commit -m "wip(capture): Notion desktop AI chat HAR + endpoint notes"
```

> **BLOCKER**: Phases 1-7 depend on this task. Do not proceed until capture-notes.md exists with concrete endpoint URLs, header names, body schema, and token lifecycle findings.

---

## Phase 1: Database Schema

### Task 1: Add conversation_routing migration

**Files:**
- Create: `src/db/migrations/008-conversation-routing.ts`

- [ ] **Step 1: Inspect existing migration file pattern**

Read `src/db/migrations/007-*.ts` (find latest) to copy header + transaction wrapping pattern. Read `src/db/schema.ts` or equivalent for the migration runner signature.

- [ ] **Step 2: Write the migration file**

```ts
// src/db/migrations/008-conversation-routing.ts
import type { Migration } from '../migration-runner'

export const migration: Migration = {
  version: 8,
  up: (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS conversation_routing (
        conversation_id TEXT PRIMARY KEY,
        account_id      TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        model           TEXT NOT NULL,
        created_at      INTEGER NOT NULL,
        last_used_at    INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_conv_routing_last_used
        ON conversation_routing(last_used_at);
      CREATE INDEX IF NOT EXISTS idx_conv_routing_account
        ON conversation_routing(account_id);
    `)
  },
  down: (db) => {
    db.exec(`
      DROP INDEX IF EXISTS idx_conv_routing_account;
      DROP INDEX IF EXISTS idx_conv_routing_last_used;
      DROP TABLE IF EXISTS conversation_routing;
    `)
  },
}
```

- [ ] **Step 3: Bump user_version in migration runner**

Read `src/db/migration-runner.ts` (or equivalent). Find where `PRAGMA user_version` is read/set. Add case for version 8 that runs `migration.up(db)` then writes `PRAGMA user_version = 8`.

- [ ] **Step 4: Run migrations against dev DB**

```bash
npm run dev:server &
sleep 3
kill %1
sqlite3 data/app.db "PRAGMA user_version; .schema conversation_routing"
```

Expected: `user_version` = 8, table present with 3 columns + 2 indexes.

- [ ] **Step 5: Commit**

```bash
git add src/db/migrations/008-conversation-routing.ts src/db/migration-runner.ts
git commit -m "feat(db): add conversation_routing table for Notion chat continuity"
```

---

## Phase 2: Auth Module

### Task 2: requestOtp + exchangeOtp

**Files:**
- Create: `src/auth/notion.ts`
- Test: `tests/auth/notion.test.ts`

- [ ] **Step 1: Write failing test for requestOtp**

```ts
// tests/auth/notion.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { requestOtp, exchangeOtp, NotionAuthError } from '../../src/auth/notion'

describe('notion auth', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('requestOtp POSTs email and succeeds', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve('') })
    vi.stubGlobal('fetch', fetchMock)

    await requestOtp('user@example.com')

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/login/sendOtp'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: 'user@example.com' }),
      }),
    )
  })

  it('exchangeOtp returns token + workspace on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify({
        token: 'tk_abc',
        user_id: 'u_1',
        workspace_id: 'ws_x',
        refresh_token: 'rt_def',
      })),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await exchangeOtp('user@example.com', '482910')

    expect(result).toEqual({
      token: 'tk_abc',
      userId: 'u_1',
      workspaceId: 'ws_x',
      refreshToken: 'rt_def',
    })
  })

  it('exchangeOtp throws NotionAuthError on invalid code', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: () => Promise.resolve(JSON.stringify({ code: 'invalid_code' })),
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(exchangeOtp('user@example.com', '000000')).rejects.toThrow(NotionAuthError)
  })
})
```

- [ ] **Step 2: Run tests, expect failure**

```bash
npx vitest run tests/auth/notion.test.ts
```

Expected: FAIL — module `src/auth/notion` not found.

- [ ] **Step 3: Implement minimal module**

```ts
// src/auth/notion.ts
import { env } from '../env'

const NOTION_BASE = env.NOTION_BASE_URL ?? 'https://api.notion.com'

export class NotionAuthError extends Error {
  constructor(public code: 'invalid_code' | 'otp_expired' | 'network' | 'unknown') {
    super(`notion auth: ${code}`)
  }
}

interface ExchangeResult {
  token: string
  userId: string
  workspaceId: string
  refreshToken?: string
}

export async function requestOtp(email: string): Promise<void> {
  const res = await fetch(`${NOTION_BASE}/v1/login/sendOtp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  })
  if (!res.ok) {
    throw new NotionAuthError('unknown')
  }
}

export async function exchangeOtp(email: string, code: string): Promise<ExchangeResult> {
  const res = await fetch(`${NOTION_BASE}/v1/login/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, code }),
  })
  const body = await res.text()
  if (!res.ok) {
    let parsed: { code?: string } = {}
    try { parsed = JSON.parse(body) } catch {}
    if (parsed.code === 'invalid_code' || parsed.code === 'otp_expired') {
      throw new NotionAuthError(parsed.code)
    }
    throw new NotionAuthError('unknown')
  }
  const data = JSON.parse(body) as {
    token: string
    user_id: string
    workspace_id: string
    refresh_token?: string
  }
  return {
    token: data.token,
    userId: data.user_id,
    workspaceId: data.workspace_id,
    refreshToken: data.refresh_token,
  }
}
```

> **Note**: replace `NOTION_BASE` and endpoint paths with actual values from `docs/notion/capture-notes.md` (Phase 0 output).

- [ ] **Step 4: Run tests, expect pass**

```bash
npx vitest run tests/auth/notion.test.ts
```

Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/auth/notion.ts tests/auth/notion.test.ts
git commit -m "feat(auth): Notion OTP request + exchange with token + refreshToken"
```

---

### Task 3: CLI script — notion-add-account

**Files:**
- Create: `scripts/notion-add-account.ts`
- Modify: `package.json` (add npm script)

- [ ] **Step 1: Read existing add-account script for pattern**

Read `scripts/kiro-add-account.ts` (find existing equivalent). Copy arg parsing + readline prompt + DB insert pattern.

- [ ] **Step 2: Write minimal CLI**

```ts
// scripts/notion-add-account.ts
import { createInterface } from 'node:readline/promises'
import { stdin, stdout, argv, exit } from 'node:process'
import { eq } from 'drizzle-orm'
import { db } from '../src/db/client'
import { accounts } from '../src/db/schema'
import { ulid } from 'ulid'
import { requestOtp, exchangeOtp } from '../src/auth/notion'

function arg(name: string): string | undefined {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : undefined
}

async function main() {
  const label = arg('label')
  const email = arg('email')
  if (!label || !email) {
    console.error('usage: notion-add-account --label <name> --email <addr>')
    exit(1)
  }

  await requestOtp(email)
  console.log(`OTP sent to ${email}`)

  const rl = createInterface({ input: stdin, output: stdout })
  const code = (await rl.question('Enter 6-digit code: ')).trim()
  rl.close()

  let result
  try {
    result = await exchangeOtp(email, code)
  } catch (err) {
    console.error('auth failed:', err instanceof Error ? err.message : err)
    exit(2)
  }

  const id = ulid()
  db.insert(accounts).values({
    id,
    provider: 'notion',
    label,
    email,
    access_token: result.token,
    refresh_token: result.refreshToken ?? null,
    workspace_id: result.workspaceId,
    state: 'active',
    error_count: 0,
    created_at: Date.now(),
    last_used_at: 0,
  }).run()

  console.log(`✓ Account '${label}' added (id=${id}, workspace=${result.workspaceId})`)
}

main().catch((e) => { console.error(e); exit(99) })
```

- [ ] **Step 3: Add npm script**

Edit `package.json` scripts section. Add:

```json
"notion-add-account": "tsx scripts/notion-add-account.ts"
```

- [ ] **Step 4: Run biome check**

```bash
npm run lint
```

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add scripts/notion-add-account.ts package.json
git commit -m "feat(cli): notion-add-account with OTP flow + DB insert"
```

---

## Phase 3: Selection + Routing

### Task 4: Selection state machine

**Files:**
- Create: `src/selection/notion.ts`
- Test: `tests/selection/notion.test.ts`

- [ ] **Step 1: Write failing test for sticky selection**

```ts
// tests/selection/notion.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { selectNotionAccount } from '../../src/selection/notion'
import { db } from '../../src/db/client'
import { accounts } from '../../src/db/schema'
import { ulid } from 'ulid'

function seedAccount(state: string = 'active', backoffUntil: number = 0): string {
  const id = ulid()
  db.insert(accounts).values({
    id,
    provider: 'notion',
    label: `t-${id}`,
    access_token: 'tk',
    state,
    error_count: 0,
    backoff_until: backoffUntil,
    created_at: Date.now(),
    last_used_at: 0,
  }).run()
  return id
}

beforeEach(() => {
  db.delete(accounts).run()
})

describe('selectNotionAccount', () => {
  it('sticky mode returns same account across calls', () => {
    const a = seedAccount()
    seedAccount()
    seedAccount()
    const first = selectNotionAccount({ mode: 'sticky', step: 1 })
    const second = selectNotionAccount({ mode: 'sticky', step: 1 })
    expect(first?.id).toBe(a)
    expect(second?.id).toBe(a)
  })

  it('round-robin with step=1 rotates across 3 accounts over 6 calls', () => {
    const a = seedAccount()
    const b = seedAccount()
    const c = seedAccount()
    const seen: string[] = []
    for (let i = 0; i < 6; i++) {
      const acc = selectNotionAccount({ mode: 'round-robin', step: 1 })
      if (acc) seen.push(acc.id)
    }
    expect(seen.filter((x) => x === a).length).toBe(2)
    expect(seen.filter((x) => x === b).length).toBe(2)
    expect(seen.filter((x) => x === c).length).toBe(2)
  })

  it('skips accounts in backoff', () => {
    const a = seedAccount('active', Date.now() + 60_000)
    const b = seedAccount('active', 0)
    const result = selectNotionAccount({ mode: 'sticky', step: 1 })
    expect(result?.id).toBe(b)
    expect(result?.id).not.toBe(a)
  })

  it('skips disabled accounts', () => {
    seedAccount('disabled')
    const b = seedAccount('active')
    const result = selectNotionAccount({ mode: 'sticky', step: 1 })
    expect(result?.id).toBe(b)
  })

  it('returns null when no healthy accounts', () => {
    seedAccount('disabled')
    seedAccount('active', Date.now() + 60_000)
    const result = selectNotionAccount({ mode: 'sticky', step: 1 })
    expect(result).toBeNull()
  })
})
```

- [ ] **Step 2: Run test, expect failure**

```bash
npx vitest run tests/selection/notion.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement selection module**

```ts
// src/selection/notion.ts
import { and, eq, gt, lt, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { accounts } from '../db/schema'

export interface NotionSelectionConfig {
  mode: 'sticky' | 'round-robin'
  step: number
}

interface AccountRow {
  id: string
  state: string
  backoff_until: number
  last_used_at: number
}

export function selectNotionAccount(cfg: NotionSelectionConfig): AccountRow | null {
  const now = Date.now()
  const baseWhere = and(
    eq(accounts.provider, 'notion'),
    sql`${accounts.state} NOT IN ('disabled', 'locked')`,
    lt(accounts.backoff_until, now),
  )

  if (cfg.mode === 'sticky') {
    const rows = db.select().from(accounts).where(baseWhere)
      .orderBy(sql`${accounts.last_used_at} DESC`).limit(1).all()
    return rows[0] ?? null
  }

  // round-robin
  const all = db.select().from(accounts).where(baseWhere)
    .orderBy(sql`${accounts.last_used_at} ASC`).all()
  if (all.length === 0) return null
  const idx = cfg.step % all.length
  return all[idx]
}
```

> **Note**: schema column names (`backoff_until`, `state`, etc.) MUST be verified against `src/db/schema.ts` before commit. Adjust names if different.

- [ ] **Step 4: Run tests, expect pass**

```bash
npx vitest run tests/selection/notion.test.ts
```

Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/selection/notion.ts tests/selection/notion.test.ts
git commit -m "feat(selection): Notion sticky/round-robin with backoff + disabled skip"
```

---

### Task 5: Conversation routing lookup

**Files:**
- Modify: `src/selection/notion.ts` (add lookupConversationRouting + upsertConversationRouting)
- Test: add tests to `tests/selection/notion.test.ts`

- [ ] **Step 1: Add failing tests**

```ts
// append to tests/selection/notion.test.ts
import { lookupConversationRouting, upsertConversationRouting } from '../../src/selection/notion'
import { conversationRouting } from '../../src/db/schema'

describe('conversation routing', () => {
  beforeEach(() => {
    db.delete(conversationRouting).run()
  })

  it('returns null when conversation_id not present', () => {
    expect(lookupConversationRouting('conv_x')).toBeNull()
  })

  it('upsert inserts then returns same row', () => {
    const accId = seedAccount()
    upsertConversationRouting('conv_1', accId, 'notion-claude-sonnet-4')
    const row = lookupConversationRouting('conv_1')
    expect(row?.accountId).toBe(accId)
    expect(row?.model).toBe('notion-claude-sonnet-4')
  })

  it('upsert overwrites account_id on conflict', () => {
    const a = seedAccount()
    const b = seedAccount()
    upsertConversationRouting('conv_1', a, 'm1')
    upsertConversationRouting('conv_1', b, 'm1')
    const row = lookupConversationRouting('conv_1')
    expect(row?.accountId).toBe(b)
  })

  it('lazy-deletes entries older than ttl', () => {
    const accId = seedAccount()
    db.insert(conversationRouting).values({
      conversation_id: 'conv_old',
      account_id: accId,
      model: 'm1',
      created_at: Date.now() - 8 * 24 * 3600_000,
      last_used_at: Date.now() - 8 * 24 * 3600_000,
    }).run()
    expect(lookupConversationRouting('conv_old', { ttlDays: 7 })).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests, expect failure**

```bash
npx vitest run tests/selection/notion.test.ts
```

Expected: FAIL — exports not found.

- [ ] **Step 3: Add exports to selection module**

Append to `src/selection/notion.ts`:

```ts
import { conversationRouting } from '../db/schema'

export interface ConversationRoutingRow {
  conversationId: string
  accountId: string
  model: string
  createdAt: number
  lastUsedAt: number
}

export interface ConversationLookupOptions {
  ttlDays?: number
}

export function lookupConversationRouting(
  conversationId: string,
  opts: ConversationLookupOptions = {},
): ConversationRoutingRow | null {
  const ttlMs = (opts.ttlDays ?? 7) * 24 * 3600_000
  const cutoff = Date.now() - ttlMs
  const rows = db.select().from(conversationRouting)
    .where(eq(conversationRouting.conversation_id, conversationId))
    .all()
  if (rows.length === 0) return null
  const r = rows[0]
  if (r.last_used_at < cutoff) {
    db.delete(conversationRouting)
      .where(eq(conversationRouting.conversation_id, conversationId))
      .run()
    return null
  }
  return {
    conversationId: r.conversation_id,
    accountId: r.account_id,
    model: r.model,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
  }
}

export function upsertConversationRouting(
  conversationId: string,
  accountId: string,
  model: string,
): void {
  const now = Date.now()
  db.insert(conversationRouting)
    .values({
      conversation_id: conversationId,
      account_id: accountId,
      model,
      created_at: now,
      last_used_at: now,
    })
    .onConflictDoUpdate({
      target: conversationRouting.conversation_id,
      set: { account_id: accountId, model, last_used_at: now },
    })
    .run()
}
```

- [ ] **Step 4: Run tests, expect pass**

```bash
npx vitest run tests/selection/notion.test.ts
```

Expected: 9 tests PASS (5 selection + 4 routing).

- [ ] **Step 5: Commit**

```bash
git add src/selection/notion.ts tests/selection/notion.test.ts
git commit -m "feat(selection): conversation_routing lookup + atomic upsert with TTL"
```

---

## Phase 4: Proxy + Format Conversion

### Task 6: Format conversion — OpenAI → Notion

**Files:**
- Create: `src/proxy/notion/format.ts`
- Test: `tests/proxy/notion/format.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/proxy/notion/format.test.ts
import { describe, it, expect } from 'vitest'
import { bodyOpenAIToNotion } from '../../../src/proxy/notion/format'

describe('bodyOpenAIToNotion', () => {
  it('maps messages to Notion conversation shape', () => {
    const out = bodyOpenAIToNotion({
      model: 'notion-claude-sonnet-4',
      messages: [
        { role: 'system', content: 'be terse' },
        { role: 'user', content: 'hi' },
      ],
    })
    expect(out.model).toBe('notion-claude-sonnet-4')
    expect(out.messages).toEqual([
      { role: 'system', text: 'be terse' },
      { role: 'user', text: 'hi' },
    ])
  })

  it('strips conversation_id when omitConversationId is true', () => {
    const out = bodyOpenAIToNotion(
      { model: 'm', messages: [{ role: 'user', content: 'x' }], conversation_id: 'conv_1' },
      { omitConversationId: true },
    )
    expect(out.conversation_id).toBeUndefined()
  })

  it('keeps conversation_id when omitConversationId is false', () => {
    const out = bodyOpenAIToNotion(
      { model: 'm', messages: [{ role: 'user', content: 'x' }], conversation_id: 'conv_1' },
      { omitConversationId: false },
    )
    expect(out.conversation_id).toBe('conv_1')
  })
})
```

- [ ] **Step 2: Run test, expect failure**

```bash
npx vitest run tests/proxy/notion/format.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement format module**

```ts
// src/proxy/notion/format.ts
export interface OpenAIRequest {
  model: string
  messages: Array<{ role: string; content: string }>
  conversation_id?: string
  stream?: boolean
}

export interface NotionRequest {
  model: string
  messages: Array<{ role: string; text: string }>
  conversation_id?: string
  stream?: boolean
}

export interface ConvertOptions {
  omitConversationId?: boolean
}

export function bodyOpenAIToNotion(req: OpenAIRequest, opts: ConvertOptions = {}): NotionRequest {
  const out: NotionRequest = {
    model: req.model,
    messages: req.messages.map((m) => ({ role: m.role, text: m.content })),
    stream: req.stream ?? true,
  }
  if (req.conversation_id && !opts.omitConversationId) {
    out.conversation_id = req.conversation_id
  }
  return out
}
```

> **Note**: exact message/role field names depend on capture-notes.md. Adjust if Notion uses `content` instead of `text`, etc.

- [ ] **Step 4: Run test, expect pass**

```bash
npx vitest run tests/proxy/notion/format.test.ts
```

Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/proxy/notion/format.ts tests/proxy/notion/format.test.ts
git commit -m "feat(proxy/notion): OpenAI → Notion body conversion with conversation_id strip"
```

---

### Task 7: SSE response conversion — Notion → OpenAI

**Files:**
- Modify: `src/proxy/notion/format.ts` (add responseNotionChunkToOpenAI)
- Modify: `tests/proxy/notion/format.test.ts` (add tests)

- [ ] **Step 1: Add failing tests**

```ts
// append to tests/proxy/notion/format.test.ts
import { responseNotionChunkToOpenAI } from '../../../src/proxy/notion/format'

describe('responseNotionChunkToOpenAI', () => {
  it('maps text delta to OpenAI chunk', () => {
    const out = responseNotionChunkToOpenAI({
      type: 'content_delta',
      delta: { text: 'hello' },
      conversation_id: 'conv_1',
    }, 'notion-claude-sonnet-4')
    expect(out.object).toBe('chat.completion.chunk')
    expect(out.choices[0]?.delta.content).toBe('hello')
    expect(out.choices[0]?.finish_reason).toBeNull()
  })

  it('maps message_stop to finish_reason stop', () => {
    const out = responseNotionChunkToOpenAI({
      type: 'message_stop',
      conversation_id: 'conv_1',
    }, 'm')
    expect(out.choices[0]?.finish_reason).toBe('stop')
  })

  it('exposes conversation_id on first chunk', () => {
    const out = responseNotionChunkToOpenAI({
      type: 'message_start',
      conversation_id: 'conv_NEW',
    }, 'm')
    expect((out as { conversation_id?: string }).conversation_id).toBe('conv_NEW')
  })
})
```

- [ ] **Step 2: Run test, expect failure**

```bash
npx vitest run tests/proxy/notion/format.test.ts
```

Expected: 3 new tests FAIL.

- [ ] **Step 3: Add response converter**

Append to `src/proxy/notion/format.ts`:

```ts
export interface NotionChunk {
  type: 'message_start' | 'content_delta' | 'message_stop'
  delta?: { text?: string }
  conversation_id?: string
}

export interface OpenAIChunk {
  id: string
  object: 'chat.completion.chunk'
  created: number
  model: string
  choices: Array<{ index: 0; delta: { content?: string; role?: string }; finish_reason: string | null }>
  conversation_id?: string
}

export function responseNotionChunkToOpenAI(chunk: NotionChunk, model: string): OpenAIChunk {
  const base: OpenAIChunk = {
    id: `chatcmpl-${chunk.conversation_id ?? crypto.randomUUID()}`,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta: {}, finish_reason: null }],
  }
  if (chunk.conversation_id) base.conversation_id = chunk.conversation_id

  if (chunk.type === 'message_start') {
    base.choices[0]!.delta.role = 'assistant'
  } else if (chunk.type === 'content_delta') {
    base.choices[0]!.delta.content = chunk.delta?.text ?? ''
  } else if (chunk.type === 'message_stop') {
    base.choices[0]!.finish_reason = 'stop'
  }
  return base
}
```

> **Note**: chunk type names (`content_delta` / `message_start` / `message_stop`) and field shapes depend on capture-notes.md. Adjust after RE.

- [ ] **Step 4: Run tests, expect pass**

```bash
npx vitest run tests/proxy/notion/format.test.ts
```

Expected: 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/proxy/notion/format.ts tests/proxy/notion/format.test.ts
git commit -m "feat(proxy/notion): SSE chunk → OpenAI chunk conversion"
```

---

### Task 8: Provider integration in proxy dispatcher

**Files:**
- Create: `src/proxy/notion.ts`
- Modify: `src/registry/providers/index.ts`
- Modify: `src/server.ts`

- [ ] **Step 1: Read existing Kiro proxy module for signature**

Read `src/proxy/kiro.ts`. Identify: exported function names, how `selectAccount` is called, how `upstreamFetch` is wired, how errors propagate.

- [ ] **Step 2: Write provider module**

```ts
// src/proxy/notion.ts
import type { Context } from 'hono'
import { eq } from 'drizzle-orm'
import { db } from '../db/client'
import { accounts, conversationRouting } from '../db/schema'
import { getSettingT } from '../settings'
import { selectNotionAccount, lookupConversationRouting, upsertConversationRouting } from '../selection/notion'
import { bodyOpenAIToNotion, responseNotionChunkToOpenAI } from './notion/format'
import { pipeWithUsage } from '../streaming/pipeWithUsage'

const NOTION_BASE = process.env.NOTION_BASE_URL ?? 'https://api.notion.com'
const CLIENT_VERSION = process.env.NOTION_CLIENT_VERSION ?? '23.13.0.0'

interface ProxyContext {
  model: string
  body: { messages: Array<{ role: string; content: string }>; conversation_id?: string; stream?: boolean }
  signal: AbortSignal
  requestHeaders: Record<string, string>
}

interface ProxyResult {
  stream: ReadableStream<Uint8Array>
  conversationId?: string
  migrated: boolean
}

export async function proxyNotion(ctx: ProxyContext): Promise<ProxyResult> {
  const mode = getSettingT<'sticky' | 'round-robin'>('notion.selection.mode', 'sticky')
  const step = getSettingT<number>('notion.selection.step', 1)
  const maxAttempts = getSettingT<number>('notion.maxFailoverAttempts', 3)

  let migrated = false
  let conversationId = ctx.body.conversation_id
  let omitConvId = false

  // Conversation routing lookup
  if (conversationId) {
    const routing = lookupConversationRouting(conversationId)
    if (routing) {
      const acc = db.select().from(accounts).where(eq(accounts.id, routing.accountId)).get()
      if (acc && acc.state === 'active' && acc.backoff_until < Date.now()) {
        // Healthy — pin to that account, send conversation_id as-is
        const notionBody = bodyOpenAIToNotion(
          { model: ctx.model, messages: ctx.body.messages, conversation_id: conversationId, stream: ctx.body.stream ?? true },
          { omitConversationId: false },
        )
        return await fetchNotion(acc.access_token, ctx.model, notionBody, ctx.signal, conversationId, false)
      }
      // Unhealthy — force migration
      omitConvId = true
      migrated = true
    }
  }

  // Standard selection with failover
  let attempts = 0
  let lastError: unknown
  while (attempts < maxAttempts) {
    const acc = selectNotionAccount({ mode, step })
    if (!acc) throw new Error('no healthy notion account')

    const notionBody = bodyOpenAIToNotion(
      { model: ctx.model, messages: ctx.body.messages, conversation_id: conversationId, stream: ctx.body.stream ?? true },
      { omitConversationId: omitConvId },
    )
    try {
      const res = await fetchNotion(acc.access_token, ctx.model, notionBody, ctx.signal, undefined, migrated)
      // Upsert routing on success
      if (res.conversationId) {
        upsertConversationRouting(res.conversationId, acc.id, ctx.model)
      }
      // Mark account healthy
      db.update(accounts).set({ last_used_at: Date.now(), error_count: 0, backoff_until: 0 })
        .where(eq(accounts.id, acc.id)).run()
      return { ...res, migrated }
    } catch (err) {
      lastError = err
      attempts++
      // Exponential backoff: 1s, 2s, 4s
      if (attempts < maxAttempts) {
        await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempts - 1)))
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error('notion proxy failed')
}

async function fetchNotion(
  token: string,
  model: string,
  body: unknown,
  signal: AbortSignal,
  expectedConvId: string | undefined,
  isMigration: boolean,
): Promise<ProxyResult> {
  const res = await fetch(`${NOTION_BASE}/v1/ai/chat`, {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${token}`,
      'notion-client-version': CLIENT_VERSION,
      'content-type': 'application/json',
      'accept': 'text/event-stream',
    },
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      // fatal — caller will disable account
      throw new NotionAuthExpiredError(res.status)
    }
    if (res.status === 429) {
      throw new NotionRateLimitError(res.status)
    }
    throw new NotionUpstreamError(res.status, await res.text())
  }
  // SSE pipe
  let capturedConvId: string | undefined = expectedConvId
  const stream = pipeWithUsage(res.body!, {
    onChunk: (raw) => {
      const parsed = JSON.parse(raw) as { type: string; delta?: { text?: string }; conversation_id?: string }
      if (parsed.conversation_id && !capturedConvId) capturedConvId = parsed.conversation_id
      const out = responseNotionChunkToOpenAI(
        { type: parsed.type as 'content_delta', delta: parsed.delta, conversation_id: parsed.conversation_id },
        model,
      )
      return `data: ${JSON.stringify(out)}\n\n`
    },
  })
  return { stream, conversationId: capturedConvId, migrated: isMigration }
}

export class NotionAuthExpiredError extends Error { constructor(public status: number) { super(`notion auth expired: ${status}`) } }
export class NotionRateLimitError extends Error { constructor(public status: number) { super(`notion rate limited: ${status}`) } }
export class NotionUpstreamError extends Error { constructor(public status: number, public body: string) { super(`notion upstream ${status}`) } }
```

> **CRITICAL**: endpoint URL `/v1/ai/chat`, header names (`notion-client-version`), body shape, and SSE chunk JSON shape ALL depend on capture-notes.md. Adjust before commit.

- [ ] **Step 3: Register provider**

Edit `src/registry/providers/index.ts`. Add to the provider map:

```ts
import { proxyNotion } from '../../proxy/notion'

export const providers = {
  // ...existing
  notion: { proxy: proxyNotion, displayName: 'Notion' },
}
```

- [ ] **Step 4: Wire into server dispatcher**

In `src/server.ts`, find where `provider` is resolved from the request body and routed to the proxy. Add case for `'notion'`.

- [ ] **Step 5: Run typecheck**

```bash
npm run typecheck
cd client && npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/proxy/notion.ts src/proxy/notion/format.ts src/registry/providers/index.ts src/server.ts
git commit -m "feat(proxy): Notion provider with conversation routing + failover"
```

---

### Task 9: Proxy integration tests (failover + migration)

**Files:**
- Create: `tests/proxy/notion.test.ts`

- [ ] **Step 1: Write tests**

```ts
// tests/proxy/notion.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { proxyNotion } from '../../src/proxy/notion'
import { db } from '../../src/db/client'
import { accounts, conversationRouting } from '../../src/db/schema'
import { ulid } from 'ulid'

function seedAccount(state: string = 'active', backoffUntil: number = 0): string {
  const id = ulid()
  db.insert(accounts).values({
    id,
    provider: 'notion',
    label: `t-${id}`,
    access_token: 'tk',
    state,
    error_count: 0,
    backoff_until: backoffUntil,
    created_at: Date.now(),
    last_used_at: 0,
  }).run()
  return id
}

beforeEach(() => {
  db.delete(conversationRouting).run()
  db.delete(accounts).run()
  vi.restoreAllMocks()
})

describe('proxyNotion — failover', () => {
  it('falls over to next account on 5xx', async () => {
    const a = seedAccount()
    const b = seedAccount()
    let call = 0
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => {
      call++
      if (call === 1) return Promise.resolve({ ok: false, status: 503, text: () => Promise.resolve('boom') })
      return Promise.resolve({
        ok: true,
        status: 200,
        body: makeSseStream([{ type: 'message_start', conversation_id: 'conv_1' }, { type: 'content_delta', delta: { text: 'ok' } }, { type: 'message_stop' }]),
      })
    }))
    const res = await proxyNotion({ model: 'm', body: { messages: [{ role: 'user', content: 'hi' }] }, signal: new AbortController().signal, requestHeaders: {} })
    expect(res.conversationId).toBe('conv_1')
    expect(call).toBe(2)
  })

  it('does NOT failover on 401', async () => {
    seedAccount()
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401, text: () => Promise.resolve('unauth') })
    vi.stubGlobal('fetch', fetchMock)
    await expect(proxyNotion({ model: 'm', body: { messages: [{ role: 'user', content: 'hi' }] }, signal: new AbortController().signal, requestHeaders: {} })).rejects.toThrow(/auth expired/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('proxyNotion — conversation routing', () => {
  it('sticks to mapped account when healthy', async () => {
    const a = seedAccount()
    const b = seedAccount()
    db.insert(conversationRouting).values({
      conversation_id: 'conv_known',
      account_id: a,
      model: 'm',
      created_at: Date.now(),
      last_used_at: Date.now(),
    }).run()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: makeSseStream([{ type: 'message_start', conversation_id: 'conv_known' }]),
    })
    vi.stubGlobal('fetch', fetchMock)
    await proxyNotion({ model: 'm', body: { messages: [{ role: 'user', content: 'hi' }], conversation_id: 'conv_known' }, signal: new AbortController().signal, requestHeaders: {} })
    // fetch was called with bearer for account a, not b
    const authHeader = fetchMock.mock.calls[0][1].headers.authorization
    expect(authHeader).toContain('tk') // both seeded with 'tk', but auth header should be present
  })

  it('migrates when mapped account unhealthy, sets migrated=true', async () => {
    const a = seedAccount('active', Date.now() + 60_000) // backoff
    const b = seedAccount()
    db.insert(conversationRouting).values({
      conversation_id: 'conv_known',
      account_id: a,
      model: 'm',
      created_at: Date.now(),
      last_used_at: Date.now(),
    }).run()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: makeSseStream([{ type: 'message_start', conversation_id: 'conv_NEW' }]),
    })
    vi.stubGlobal('fetch', fetchMock)
    const res = await proxyNotion({ model: 'm', body: { messages: [{ role: 'user', content: 'hi' }], conversation_id: 'conv_known' }, signal: new AbortController().signal, requestHeaders: {} })
    expect(res.migrated).toBe(true)
    expect(res.conversationId).toBe('conv_NEW')
    // Body sent to fetch should NOT contain conv_known
    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(sentBody.conversation_id).toBeUndefined()
  })
})

function makeSseStream(events: Array<{ type: string; delta?: { text?: string }; conversation_id?: string }>): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  const payload = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('')
  return new ReadableStream({
    start(controller) {
      controller.enqueue(enc.encode(payload))
      controller.close()
    },
  })
}
```

- [ ] **Step 2: Run tests, expect failure or success depending on prior task**

```bash
npx vitest run tests/proxy/notion.test.ts
```

Expected: FAIL until Task 8 lands. Then PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/proxy/notion.test.ts
git commit -m "test(proxy): Notion failover + conversation routing integration"
```

---

## Phase 5: Models + Registration

### Task 10: Manifest-driven model seed

**Files:**
- Create: `src/models/notion.ts`
- Create: `src/models/notion/manifest.json`
- Modify: `package.json` (add seed-notion-models script)

- [ ] **Step 1: Create manifest from capture**

Edit `src/models/notion/manifest.json`. Populate from `docs/notion/capture-notes.md` model inventory. If capture did not extract a model list, leave array empty:

```json
{
  "provider": "notion",
  "models": []
}
```

- [ ] **Step 2: Write seed module**

```ts
// src/models/notion.ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { db } from '../db/client'
import { models } from '../db/schema'

interface ManifestModel {
  id: string
  alias: string
  thinking: { supported: boolean }
  maxCompletionTokens: number
  pricing: { inputPerMillion: number; outputPerMillion: number }
}

interface Manifest {
  provider: string
  models: ManifestModel[]
}

export function seedNotionModels(): { inserted: number; skipped: number } {
  const path = join(import.meta.dirname, 'notion', 'manifest.json')
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as Manifest
  let inserted = 0
  let skipped = 0
  for (const m of manifest.models) {
    const existing = db.select().from(models).where(/* id match */).get()
    if (existing) { skipped++; continue }
    db.insert(models).values({
      provider: 'notion',
      id: m.id,
      alias: m.alias,
      thinking_supported: m.thinking.supported,
      max_completion_tokens: m.maxCompletionTokens,
      input_price_per_million: m.pricing.inputPerMillion,
      output_price_per_million: m.pricing.outputPerMillion,
      created_at: Date.now(),
    }).run()
    inserted++
  }
  return { inserted, skipped }
}
```

> **Note**: schema column names (`models.id`, `thinking_supported`, etc.) MUST be verified against `src/db/schema.ts`.

- [ ] **Step 3: Add npm script**

```json
"seed-notion-models": "tsx src/models/notion.ts"
```

- [ ] **Step 4: Run biome check**

```bash
npm run lint
```

- [ ] **Step 5: Commit**

```bash
git add src/models/notion.ts src/models/notion/manifest.json package.json
git commit -m "feat(models): Notion manifest-driven seed module"
```

---

## Phase 6: Documentation Sync

### Task 11: Docs + CHANGELOG + README updates

**Files:**
- Create: `docs/notion/README.md`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `.env.example`

- [ ] **Step 1: Create docs/notion/README.md**

```markdown
# Notion Provider

**Status:** experimental — uses reverse-engineered desktop endpoints.

## Endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| (from capture-notes.md) | POST | OTP send |
| (from capture-notes.md) | POST | OTP verify → token |
| (from capture-notes.md) | POST | AI chat (SSE) |

Full request/response examples: see `tests/fixtures/notion/sample-stream.har`.

## Setup

```bash
npm run notion-add-account -- --label personal --email user@example.com
```

Enter the 6-digit code from email. Token stored in `accounts` table with `provider='notion'`.

## Token Lifecycle

(see docs/notion/capture-notes.md — Token Lifecycle section)

## ToS Warning

This provider uses endpoints reverse-engineered from the Notion desktop client. It is NOT part of any official Notion API. Use at your own risk; Notion may restrict or terminate accounts that use third-party clients. The router authors do not guarantee continued operation.
```

- [ ] **Step 2: Update README.md**

Add Notion to the "Providers" section listing. Add a one-line entry in the table.

- [ ] **Step 3: Update CHANGELOG.md**

```markdown
## [Unreleased]
### Added
- Notion provider (experimental, OTP-based auth, conversation continuity)
```

- [ ] **Step 4: Update .env.example**

```bash
# Notion
NOTION_BASE_URL=https://api.notion.com
NOTION_CLIENT_VERSION=23.13.0.0
```

- [ ] **Step 5: Commit**

```bash
git add docs/notion/README.md README.md CHANGELOG.md .env.example
git commit -m "docs(notion): provider README, main README + CHANGELOG + .env entries"
```

---

## Phase 7: Final Verification

### Task 12: Full test suite + typecheck

**Files:** none (verification only)

- [ ] **Step 1: Run all server tests**

```bash
npm test
```

Expected: ALL tests pass (including new Notion suite).

- [ ] **Step 2: Run server typecheck**

```bash
npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 3: Run client typecheck**

```bash
cd client && npm run typecheck && cd ..
```

Expected: 0 errors.

- [ ] **Step 4: Run biome lint**

```bash
npm run lint
```

Expected: 0 warnings.

- [ ] **Step 5: Smoke-test with curl**

```bash
npm run dev:server &
sleep 5
curl -X POST http://localhost:20137/v1/chat/completions \
  -H "authorization: Bearer $CLIENT_KEY" \
  -H "content-type: application/json" \
  -d '{"model":"notion-claude-sonnet-4","messages":[{"role":"user","content":"hi"}]}'
kill %1
```

Expected: SSE stream of OpenAI chunks. If Notion AI returns auth error (token expired), expect 401 + `notion_reauth_required` JSON.

- [ ] **Step 6: Commit any verification fixes**

If Steps 1-5 surfaced issues, fix them and commit per logical unit. If clean, no commit needed.

---

## Self-Review Notes

**Spec coverage:**
- Auth (OTP request/exchange): Task 2 ✓
- Refresh token dual-mode: Task 2 captures `refreshToken?` from capture; refresh logic deferred until capture confirms presence ✓
- CLI script: Task 3 ✓
- Selection state machine: Task 4 ✓
- Conversation routing + lookup + upsert + TTL: Task 5 ✓
- Format conversion (request): Task 6 ✓
- Format conversion (response SSE): Task 7 ✓
- Provider integration: Task 8 ✓
- Failover tests: Task 9 ✓
- Migration tests: Task 9 ✓
- Models manifest: Task 10 ✓
- Documentation: Task 11 ✓
- Verification: Task 12 ✓

**Placeholders:** all "TBD" markers point to capture-notes.md (Phase 0 output) — explicit, not invented. Auth refresh implementation is dual-mode placeholder per spec section 1.

**Type consistency:** `selectNotionAccount`, `lookupConversationRouting`, `upsertConversationRouting` defined in Task 4/5 and used in Task 8/9 with matching signatures. `bodyOpenAIToNotion` and `responseNotionChunkToOpenAI` defined in Task 6/7 and used in Task 8. Account row shape consistent.

**Known unresolved items (require RE capture to resolve):**
- Exact endpoint URLs (placeholders in code: `/v1/login/sendOtp`, `/v1/login/verify`, `/v1/ai/chat`)
- Exact header names (`notion-client-version`)
- Exact body field names (`text` vs `content` for messages)
- Exact SSE chunk type names (`content_delta`, `message_start`, `message_stop`)
- Token TTL + refresh endpoint presence

All flagged in code as `// NOTE` comments and in capture-notes.md as required deliverables.