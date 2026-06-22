# Contributing to kelola-router

Thanks for contributing. This guide covers the human-side workflow. AI coding agents should also read `AGENTS.md` (or the human can refer them to it). `AGENTS.md` is the single source of truth for project overview + workflow + conventions. `CLAUDE.md` is just a pointer to it.

## Quick start

```bash
# 1. Fork + clone
git clone git@github.com:<you>/kelola-router.git
cd kelola-router
npm ci

# 2. Branch from main
git checkout -b feat/<short-name>

# 3. Run dev (server + client in parallel)
npm run dev          # :20137 server, :5173 client

# 4. Run tests in watch mode in a second terminal
npm run test:watch

# 5. Before commit
npm test             # server tests
cd client && npm test && cd ..   # client tests (if you touched client/)
npm run typecheck    # server
cd client && npm run typecheck && cd ..   # client (root tsc skips this!)
npm run lint
```

## Branch naming

- `feat/<scope>-<short>`: new feature
- `fix/<scope>-<short>`: bug fix
- `refactor/<scope>-<short>`: refactor with no behavior change
- `docs/<topic>`: docs only
- `test/<scope>`: tests only

Scope examples: `accounts`, `proxy`, `kiro`, `console`, `client`, `db`, `transports`. Keep it short (≤ 3 words).

## Commit format

[Conventional Commits](https://www.conventionalcommits.org/). Subject ≤ 72 chars. Body explains *why*.

```bash
git commit -m "feat(accounts): per-key budget cap

Add budget_usd_daily column + 429 short-circuit in requireApiKey.
Single-user local-host case; per-key rate limit is a follow-up."
```

Common types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `perf`, `style`.

## Pull request

1. Branch up to date with `main` (`git fetch && git rebase origin/main`).
2. CI green: `npm test` + `cd client && npm test` + `npm run typecheck` + `cd client && npm run typecheck` + `npm run lint` all pass.
3. One logical change per PR. Multiple commits ok; squash if the maintainer prefers.
4. PR description: what changed, why, how to verify (commands + expected output). Link related issues.
5. The maintainer reviews and merges. **Never self-merge without approval.**

## Test requirements

- Every behavior change ships with a test. New endpoint → integration test. New helper → unit test. Bug fix → regression test that fails on `main` and passes on the branch.
- Test isolation: see `AGENTS.md` "Test patterns": `process.env.ROUTER_DB_PATH` + `resetDb()` in `beforeEach`.
- Coverage: the project doesn't gate on a percentage, but every code path in changed files should be exercised. New helper with no test → PR is blocked.

## Code style

Biome handles formatting. Run `npm run lint:fix` before commit; if it changes lines you didn't intend, re-read the diff before adding it.

- TypeScript strict mode, no `any`
- `const` over `let`, early returns over nested `if/else`
- `?? null` to coerce `better-sqlite3` `undefined` to `null`
- Single quotes, 2-space indent, 100-col soft wrap, `es5` trailing commas
- English for code/comments, Indonesian for user-facing strings (per global CLAUDE.md)

## Filing issues

- **Bug**: repro steps, expected, actual, environment (OS, Node version, install method), relevant logs from `~/.local/share/kelola-router/router.log` or the dashboard Console page.
- **Feature request**: problem statement, proposed solution, alternatives considered. The maintainer may ask you to write a design doc in `docs/superpowers/specs/` first.

## Release process

Maintainer runs `npm run build`, bumps the version in `package.json`, updates `CHANGELOG.md` from the last release's commit range, tags, and pushes. Contributors do not release.

## Code of conduct

Be kind. Disagree on the technical merits, not the person. The maintainer has final say on merge/reject.
