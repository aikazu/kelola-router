---
name: add-provider
description: Wire a new upstream provider (e.g. Azure, Bedrock, llama.cpp) alongside MiniMax / Kiro in the proxy pipeline.
when-to-use: When the user asks to add a new upstream LLM provider, integrate a non-MiniMax/non-Kiro API, or wire a new auth/streaming protocol.
---

# Add an Upstream Provider

Full playbook: `docs/guides/add-a-provider.md`. Read it first.

## Steps

1. **Extend provider enum** — `src/db/repos/accounts.ts`: `ProviderName = 'minimax' | 'kiro' | '<name>'`. Find all switch-on-provider sites with `grep -rEn "provider.*'minimax'|'kiro'" src/`.
2. **Register the model prefix.** Add your prefix to `PREFIX_TO_PROVIDER` in `src/providers/modelPrefix.ts` (e.g. `mm`→minimax, `kr`→kiro, `cb`→codebuddy). Prefixed model names are looked up literally and the model's `provider` column must agree. Combo members must carry a prefix. Unprefixed names resolve only as alias/combo.
3. **Migration (if needed)** — `src/db/migrations/00X-<name>.ts`: additive `ALTER TABLE ADD COLUMN` only. Register in `src/db/migrations/index.ts` `ALL_MIGRATIONS`. Bump ID past current `user_version` (currently 6, next = 7).
4. **Auth module** — `src/providers/<name>/auth.ts`: `ensureAccessToken(db, account): Promise<string>` + `refresh<Name>Token`. Mirror `src/providers/kiro/auth.ts`.
5. **Transform** — `src/providers/<name>/transform.ts`: `build<Name>Payload(openaiBody, account)`. Convert OpenAI chat-completions → provider wire format. Handle system/tool folding, images, tools, stream flag.
6. **Stream** — `src/providers/<name>/stream.ts`: parse provider stream → OpenAI SSE chunks + buffered `chat.completion`. See `kiro/{eventstream,assembler,anthropicSse}.ts` if binary protocol.
7. **Proxy handler** — `src/proxy/<name>.ts`: `handle<Name>Proxy(c, format, upstreamPath)`. Mirror `src/proxy/kiro.ts`. Emit `start`/`account`/`transport`/`done`/`error` to `consoleBus`.
8. **Wire dispatch** — Add the dispatch branch inside `handleProxy` in **src/proxy/minimax.ts** (after the kiro/codebuddy checks): `if (peek.provider === '<name>') return handle<Name>Proxy(...)`. Then export the handler from src/server.ts: `export { handle<Name>Proxy } from './proxy/<name>.js';`.
9. **CLI scripts** — `scripts/seed-<name>-models.ts` + `scripts/add-<name>-account.ts` + `package.json` `scripts` entries.
10. **Dashboard card** — `client/src/pages/Accounts.tsx`: add `<FooCard />` parallel to `<KiroCard />`. If new auth flow needed, add `client/src/components/<Name>AuthForm.tsx` + `client/src/hooks/use<Name>Auth.ts`.
11. **Docs** — `docs/<name>/{wire-format,auth}.md`. Update `MEMORY.md`.

## Test

```bash
npm run typecheck
cd client && npm run typecheck && cd ..
npm test -- <name>
npx vitest run src/proxy/<name>.test.ts src/providers/<name>/
```

## Commit

```bash
git commit -m "feat(<name>): add <name> upstream provider

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

## See also

- `docs/guides/add-a-provider.md` — full playbook with code examples + checklist
- `docs/notes/kiro-cli-reverse-engineering.md` — pattern for reverse-engineering an undocumented protocol
