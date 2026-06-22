# Ship a Release

Cut a versioned release of `kelola-router`. Maintainer-only workflow. Contributors do not run this; they open a PR and the maintainer ships on merge.

## Goal

A new version on the `main` branch with:
- `package.json` **and** `client/package.json` versions bumped (semver); keep them in sync
- `CHANGELOG.md` updated for the new version
- `docs/roadmap.md` prepended with the new version's shipped entry (newest-first)
- A git tag matching the version
- Docker image rebuilt + pushed (if maintainer controls the image registry)
- A short release note on the GitHub Releases page

## Prerequisites

- Maintainer privileges on the repo
- `npm` + `git` + `gh` (GitHub CLI) in `$PATH`
- Read the most recent release commit to confirm the format: `git show v<previous>` (or `git tag --sort=-v:refname | head -1`)
- Read [`../../CHANGELOG.md`](../../CHANGELOG.md): Keep-a-Changelog format

## File map

No new files. Edits only:
- `package.json` + `client/package.json` (bump `version`; both, in sync)
- `CHANGELOG.md` (add new version section)
- `docs/roadmap.md` (prepend new version heading)
- (Optional) `docs/superpowers/specs/`: link from CHANGELOG if a spec was written for the release

## Steps

### 1. Confirm the release scope

```bash
# What's shipping since the last tag?
git log v<previous>..HEAD --oneline
# What was the last tag?
git tag --sort=-v:refname | head -1
```

Categorize the commits into Keep-a-Changelog sections:
- **Added**: `feat:` commits
- **Changed**: `refactor:` commits that change behavior, `feat!:` (breaking)
- **Deprecated**: `feat(deprecate):` or `chore(deprecate):`
- **Removed**: `feat!:` or `chore(remove):`
- **Fixed**: `fix:` commits
- **Security**: `fix(security):` or explicit security-related fixes

If a commit doesn't fit a section, leave it out of the changelog (housekeeping, tests, docs).

### 2. Bump the version

**File:** `package.json`

```json
{
  "version": "0.18.0"  // bump from 0.17.0
}
```

Semver rules:
- **MAJOR** (1.0.0 → 2.0.0): breaking change to a public surface (env var removed, admin API contract changed, DB schema not backward-compatible). Project is at 0.x so this rarely fires.
- **MINOR** (0.17.0 → 0.18.0): new feature, additive. Most releases.
- **PATCH** (0.17.0 → 0.17.1): bug fix only.

If unsure, MINOR. The router is feature-stacked pre-1.0.

### 3. Update the changelog

**File:** `CHANGELOG.md`

Add a new section at the top (above the most recent version), following Keep-a-Changelog:

```markdown
## [0.18.0] YYYY-MM-DD

### Added

- **Feature name.** One paragraph (or 2-3 bullets) explaining what + why + how to use. Link the GitHub issue/PR if relevant. Example: "**Live Console.** In-process flow event bus that streams per-request proxy events…"

### Changed

- (only if anything changed behavior)

### Fixed

- (only if bugs were fixed)

### Verification

- N/M server tests pass (`npx vitest run`).
- N/M client tests pass (`cd client && npx vitest run`).
- `npm run typecheck` clean.
- `cd client && npm run build` clean.
- Lint baseline: X errors / Y warnings (record deltas, even if 0).
```

Match the prose style of the most recent version section. Be terse but specific. The changelog is the public release note.

**Why:** Keep-a-Changelog is the project's house style (see `CHANGELOG.md` top comment). Future contributors diff releases from this file.

### 4. Commit the version bump

```bash
git add package.json CHANGELOG.md
git commit -m "chore(release): v0.18.0

Bump version to 0.18.0. See CHANGELOG.md for the full list of
additions, changes, and fixes since 0.17.0.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### 5. Tag the release

```bash
git tag -a v0.18.0 -m "v0.18.0 <one-line summary>

<optional 1-2 lines pointing at the most notable feature>"
```

Annotated tags (the default) carry the tagger, date, and message. The tag message becomes the GitHub Release title.

### 6. Build the Docker image (if maintaining the image)

```bash
docker build -t kelola-router:0.18.0 -t kelola-router:latest .
docker push kelola-router:0.18.0
docker push kelola-router:latest
```

(Adjust the registry prefix to match the maintainer's setup. Could be `ghcr.io/<owner>/kelola-router` or a private registry.)

### 7. Push the tag

**Ask the user** before pushing. The user confirms `git push` and `git push --tags` (global CLAUDE.md rule: "Never push without asking").

```bash
git push origin main
git push origin v0.18.0
```

### 8. Create the GitHub release

```bash
gh release create v0.18.0 \
  --title "v0.18.0 <one-line summary>" \
  --notes-file <(sed -n '/## \[0.18.0\]/,/## \[0.17.0\]/p' CHANGELOG.md)
```

The `--notes-file` pulls the changelog section into the GitHub Release body. (Adjust the sed pattern to capture from the new version header to the next version header.)

### 9. Smoke test on the production artifact

```bash
# Pull the freshly built image and run it
docker run --rm -p 20137:20137 \
  -e ROUTER_DB_PATH=/data/router.db \
  -v /tmp/router-data:/data \
  kelola-router:0.18.0

# In another terminal:
curl -fsS http://localhost:20137/v1/models
```

Expected: 200 with the model catalog. If the image doesn't start, revert the tag and fix forward.

## Test

The release is the test. Before tagging, do a dry-run:

```bash
# Full test suite
npm test
cd client && npm test && cd ..

# Typecheck (both)
npm run typecheck
cd client && npm run typecheck && cd ..

# Lint
npm run lint

# Build
npm run build
```

All must be green. If anything is red, fix the commits before tagging. Never ship a release with known red CI.

## Commit

This guide is read-only. The version-bump commit (step 4) is the only commit for the release itself.

## See also

- [`../../CHANGELOG.md`](../../CHANGELOG.md): current changelog
- [`../adr/`](../adr/): past design decisions referenced in release notes
- [`../../AGENTS.md`](../../AGENTS.md): conventions (commit format, etc.) + agent workflow (push/PR rules)
- [Keep a Changelog](https://keepachangelog.com/en/1.1.0/): format reference
- [Semantic Versioning](https://semver.org/spec/v2.0.0.html): semver rules
