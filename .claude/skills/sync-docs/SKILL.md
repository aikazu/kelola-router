---
name: sync-docs
description: Audit every doc/skill/ADR against live code and fix staleness. Reads what shipped since the last doc-sync, finds where docs lag the code, verifies each finding, applies fixes, commits.
when-to-use: After shipping features, before a release, or whenever the user says "check docs", "docs lag", "update docs", "sync docs", "are the docs stale". Run it periodically — docs rot every release.
---

# Sync Docs

Keep prose in lockstep with code. Docs drift one direction only: code ships, docs lag. This skill finds the lag and closes it.

**Golden rule: code is truth.** When a doc and the source disagree, the doc is wrong. Verify every claim against the actual file/grep/`npm test` output — never trust a number a doc states, and never trust a number an audit *guesses*. Run the command.

## What's in scope

Root: `AGENTS.md` (single source of truth — replaces `CLAUDE.md`), `ARCHITECTURE.md`, `README.md`, `CONTRIBUTING.md`, `MEMORY.md`, `CHANGELOG.md`. `CLAUDE.md` is now a one-paragraph pointer; do not sync it.
Trees: `docs/reference/*`, `docs/adr/*`, `docs/guides/*`, `docs/roadmap.md`, `docs/notes/*`, `.claude/skills/*/SKILL.md`

Out of scope: `docs/superpowers/` plans+specs (point-in-time records — never "stale"), `docs/minimax-reference/` (vendor docs), `docs/idea/`.

## Step 1 — Find the delta (cheap)

Find the last doc-sync so you only re-audit what changed since:

```bash
git log --oneline -30
git log -1 --format='%H %ci' --grep='docs: sync' --grep='chore(release)' -E   # last sync/release anchor
git log <anchor>..HEAD --oneline                                              # commits to reconcile
git log -1 --format=%ci -- docs/ AGENTS.md ARCHITECTURE.md README.md          # when docs last moved
```

The commits between the anchor and HEAD ARE the staleness surface. A `feat:` with no matching doc commit after it = a doc gap. Skim those commits — they tell you which providers / migrations / pages / settings changed.

## Step 2 — Snapshot ground truth (run, don't guess)

These five drift the most. Capture real values before auditing:

```bash
grep '"version"' package.json                          # current version
npm test 2>&1 | grep -E 'Tests +[0-9]'                 # real test count (README/CHANGELOG cite this)
ls src/db/migrations/                                   # highest migration N -> user_version
ls client/src/pages/                                    # dashboard Pages list
ls src/proxy/ src/providers/                            # providers wired (handlers + protocol dirs)
grep -rn '?? {' src/api/admin/settings.ts              # real settings DEFAULTS (docs invert these)
grep -rc "source: 'builtin'" scripts/seed-models.ts    # real seeded-model count
```

## Step 3 — Audit (fan out, one agent per doc cluster)

For a broad sweep, dispatch parallel read-only agents (`Explore` / `cavecrew-investigator`) — one per cluster (AGENTS.md, ARCHITECTURE.md, README, docs/reference, docs/adr+roadmap, skills, MEMORY). Each agent: read the doc, verify EVERY factual claim against source, return findings as `{loc, severity, problem, evidence, fix}`. Tell each agent the Step-2 ground-truth numbers so it doesn't re-derive them.

For a narrow change (one feature shipped), skip the fan-out — just grep the affected docs for the old name/number.

**Recurring rot checklist** (where lag lands every release):
- New provider/feature shipped → missing from AGENTS.md "Upstream providers" / "Architecture", ARCHITECTURE upstream diagram + module map, README Features.
- New migration → `db-tables.md` table + schema columns + `user_version`; `ARCHITECTURE.md` migrations line; `add-migration` skill "current = N".
- Test count changed → README badge + Features line + dev section; CHANGELOG verification line.
- Settings added/changed → `settings-keys.md` keys AND defaults (defaults are often documented inverted — check `?? {...}` in `settings.ts`).
- New dashboard page → AGENTS.md "Dashboard" pages list, README.
- New CLI script → `cli-scripts.md`, README; note if it's `tsx`-only (not in `package.json`).
- Big architectural decision with no ADR → `docs/adr/` gap (next number after the highest existing).
- Guides/reference written after a "(when written)" placeholder → drop the placeholder.

## Step 4 — Verify before fixing (adversarial)

Every high/med finding gets confirmed against code before you touch a doc — auditors hallucinate discrepancies. Re-grep / re-read the cited source. Default to "auditor was wrong" unless code concretely backs the claim. Drop refuted findings.

## Step 5 — Fix (delegate, minimal edits)

Dispatch one `cavecrew-builder` per file (parallel). Each: targeted `Edit`s only, match existing markdown / ASCII-diagram / table style, no rewrites. Hand the builder the exact old→new strings and verified numbers. ADRs need rationale (read the source first) — use a `general-purpose` agent, not a mechanical builder.

## Step 6 — Review + commit

- `cavecrew-reviewer` on the diff: factual errors, mangled tables, misaligned box-drawing chars, cross-file contradictions. (Last run it caught a `18→9` miss in one file — always review.)
- Clean scratch artifacts a test run dropped (`router.db`, `t.db`, `*.db-wal/-shm`) before staging. They're gitignored, but `git add -A` from a dirty tree still surprises.
- Commit: `docs: sync ... with v<X.Y> (...)` listing the buckets touched. Per global rules: commit after the change; **never push without asking.**

## See also

- `../../docs/roadmap.md` — shipped history; newest-first; the v-section you add here mirrors CHANGELOG
- `../../docs/adr/template.md` — ADR format for Step 5 ADR gaps
- `ship-release` skill — run **this** skill before cutting a release so the release ships current docs
