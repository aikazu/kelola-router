---
name: ship-release
description: Cut a versioned release, bump package.json, update CHANGELOG.md, tag, push, and create a GitHub release.
when-to-use: Maintainer-only. When the user asks to ship / release / cut a new version of kelola-router.
---

# Ship a Release

Full playbook: `docs/guides/ship-a-release.md`. Read it first.

**Maintainer only.** Confirm maintainer privilege before proceeding.

**Invoking this skill = user authorizes the whole release flow, including push.** The push step (6) is pre-authorized by the skill invocation; do not re-ask. (Contrast: an ad-hoc `git push` outside a release still needs explicit confirmation per `AGENTS.md`.)

## Steps

1. **Survey**: `git log v<prev>..HEAD --oneline`. Bucket commits into Keep-a-Changelog sections (Added / Changed / Fixed / Removed / Security).
2. **Bump**: `package.json` `version` AND `client/package.json` `version` (keep them in sync; they drift easily). Semver:
   - MAJOR: breaking public surface change
   - MINOR: new feature, additive (most common; project is pre-1.0)
   - PATCH: bug fix / internal refactor only
3. **Changelog**: prepend `## [<version>] - YYYY-MM-DD` to `CHANGELOG.md` with Added/Changed/Fixed/Removed/Verification sections. Match the prose style of the most recent version. Also prepend a matching entry to `docs/roadmap.md` (newest-first, under the version heading).
4. **Commit**: `chore(release): vX.Y.Z` with a one-paragraph body summarizing the release. If a sync-docs sweep ran first, its commit is separate and already in the history before this one.
5. **Tag**: `git tag -a vX.Y.Z -m "vX.Y.Z - <one-liner>"`.
6. **Push**: `git push origin main && git push origin vX.Y.Z`.
7. **GitHub release**: `gh release create vX.Y.Z --title "vX.Y.Z - <one-liner>" --notes "$(sed -n '/^## \[X.Y.Z\]/,/^## \[<prev>\]/{/^## \[<prev>\]/d;p}' CHANGELOG.md)"`.
8. **(Optional) Docker**: `docker build -t kelola-router:X.Y.Z -t kelola-router:latest . && docker push …`.
9. **Smoke test**: `docker run … kelola-router:X.Y.Z` then `curl -fsS http://localhost:20137/v1/models`.

## Pre-tag gate (all must be green)

```bash
# 1. Sync docs against the live code FIRST. Every release ships current docs.
#    See ../sync-docs/SKILL.md for the sweep (read-only verify of MEMORY.md /
#    ARCHITECTURE.md / docs/reference/* / docs/adr/* / .claude/skills/*).
#    Run this even if nothing changed since the last release: it catches the
#    silent drift that accumulates between releases.
npm run typecheck
cd client && npm run typecheck && cd ..

# 2. Tests + lint + build
npm test
cd client && npm test && cd ..
npm run lint
npm run build
```

If `npm test` segfaults (better-sqlite3 native under file-parallelism), fall back to the single-fork pool. It produces the same pass/fail, just serially:

```bash
npx vitest run --pool=forks --poolOptions.forks.singleFork=true
```

## Commit

The version-bump commit (step 4) is the only commit for the release itself: `chore(release): vX.Y.Z`. A prior sync-docs commit (`docs: sync …`) is separate and expected; it lands before the release commit so the release tag points at current docs.

## See also

- `docs/guides/ship-a-release.md`: full playbook
- `../sync-docs/SKILL.md`: run before tagging so the release ships current docs
- `CHANGELOG.md`: current changelog
- `../../AGENTS.md` (root): never push without asking (outside this skill)
