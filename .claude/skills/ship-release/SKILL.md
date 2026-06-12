---
name: ship-release
description: Cut a versioned release — bump package.json, update CHANGELOG.md, tag, push, and create a GitHub release.
when-to-use: Maintainer-only. When the user asks to ship / release / cut a new version of kelola-router.
---

# Ship a Release

Full playbook: `docs/guides/ship-a-release.md`. Read it first.

**Maintainer only.** Confirm maintainer privilege before proceeding.

## Steps

1. **Survey** — `git log v<prev>..HEAD --oneline`. Bucket commits into Keep-a-Changelog sections (Added / Changed / Fixed / Removed / Security).
2. **Bump** — `package.json` `version`. Semver:
   - MAJOR: breaking public surface change
   - MINOR: new feature, additive (most common; project is pre-1.0)
   - PATCH: bug fix only
3. **Changelog** — prepend `## [<version>] — YYYY-MM-DD` to `CHANGELOG.md` with Added/Changed/Fixed/Verification sections. Match the prose style of the most recent version.
4. **Commit** — `chore(release): vX.Y.Z` with a one-paragraph body summarizing the release.
5. **Tag** — `git tag -a vX.Y.Z -m "vX.Y.Z — <one-liner>"`.
6. **Push** — **ask the user first.** Then `git push origin main && git push origin vX.Y.Z`.
7. **GitHub release** — `gh release create vX.Y.Z --title "vX.Y.Z — <one-liner>" --notes-file <(sed -n '/## \[X.Y.Z\]/,/## \[<prev>\]/p' CHANGELOG.md)`.
8. **(Optional) Docker** — `docker build -t kelola-router:X.Y.Z -t kelola-router:latest . && docker push …`.
9. **Smoke test** — `docker run … kelola-router:X.Y.Z` then `curl -fsS http://localhost:20137/v1/models`.

## Pre-tag gate (all must be green)

```bash
npm test
cd client && npm test && cd ..
npm run typecheck
cd client && npm run typecheck && cd ..
npm run lint
npm run build
```

## Commit

The version-bump commit (step 4) is the only commit for the release. `git commit -m "chore(release): vX.Y.Z"`.

## See also

- `docs/guides/ship-a-release.md` — full playbook
- `CHANGELOG.md` — current changelog
- `../../CLAUDE.md` (root) — never push without asking
