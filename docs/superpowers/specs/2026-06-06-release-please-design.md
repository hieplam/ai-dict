# Apply release-please (Chrome-only scope)

**Date:** 2026-06-06
**Status:** Approved design
**Branch:** `feat/release-please`

## Goal

Automate the version-bump and CHANGELOG step of releases by adopting
[release-please](https://github.com/googleapis/release-please). Replace the
manual `bun run release:bump <ver>` action with a **Release PR** that
release-please opens and keeps up-to-date on `master`. Merging that PR pushes a
`vX.Y.Z` tag and creates a GitHub Release shell; the existing
`.github/workflows/release.yml` continues to fire on `push: tags: ['v*']` and
attaches the Chrome zip (and Safari assets) to that shell.

Scope is **Chrome-only**: release-please bumps the root `package.json` and the
Chrome manifest. Safari manifest, Xcode `MARKETING_VERSION`, and
`scripts/release-bump.mjs` are untouched and stay available for whenever Safari
release work resumes.

## Why this fits the current repo

- Recent commits already follow Conventional Commits
  (`feat(app):`, `fix(app):`, `docs(design):`, `style(spec):`), which is the
  input release-please needs to compute versions and write the CHANGELOG.
- Root `package.json` is already the single source of truth for version (the
  existing `release-bump.mjs` fans out from it). release-please's
  single-root-version mode mirrors that model exactly.
- The current `release.yml` already triggers on `push: tags: ['v*']`. The tags
  release-please pushes have that exact shape (`vX.Y.Z`), so the build pipeline
  needs zero changes.

## Files added

### 1. `.github/workflows/release-please.yml`

Runs on every push to `master` and on manual `workflow_dispatch`. Uses
`googleapis/release-please-action@v4` pinned by commit SHA (matches the
existing convention in `release.yml`).

Permissions:

- `contents: write` — to push the version-bump commit and the `vX.Y.Z` tag
- `pull-requests: write` — to open and update the Release PR

The job reads configuration from `release-please-config.json` and
`.release-please-manifest.json` in the repo root.

### 2. `release-please-config.json`

```json
{
  "$schema": "https://raw.githubusercontent.com/googleapis/release-please/main/schemas/config.json",
  "release-type": "node",
  "include-component-in-tag": false,
  "packages": {
    ".": {
      "package-name": "ai-dict",
      "changelog-path": "CHANGELOG.md",
      "extra-files": [
        {
          "type": "json",
          "path": "packages/extension-chrome/src/manifest.json",
          "jsonpath": "$.version"
        }
      ]
    }
  }
}
```

Key choices:

- `release-type: node` — bumps root `package.json` natively.
- `extra-files` + `jsonpath: $.version` — bumps the Chrome manifest's
  `version` key in lockstep.
- `include-component-in-tag: false` — tag stays `vX.Y.Z` (not
  `ai-dict-vX.Y.Z`), preserving compatibility with the existing
  `tags: ['v*']` trigger in `release.yml`.

### 3. `.release-please-manifest.json`

```json
{ ".": "0.0.0" }
```

Anchors release-please at the current root `package.json` version. The first
merged Release PR computes the next version from the Conventional Commits
since this anchor (`feat:` → minor bump, `fix:` → patch bump,
`feat!:`/`BREAKING CHANGE:` → major bump).

## Files NOT touched

- `scripts/release-bump.mjs` — kept verbatim. Still useful for cutting a
  Safari release manually (it updates the Safari manifest and Xcode
  `MARKETING_VERSION`).
- `packages/extension-safari/src/manifest.json` — its `version` will drift
  behind the Chrome manifest until `release:bump` is run manually. Acceptable
  for the Chrome-only scope.
- `packages/extension-safari/xcode/*.pbxproj` — untouched.
- `.github/workflows/release.yml` — untouched. Continues to fire on
  `push: tags: ['v*']` and attaches the Chrome zip + iOS `.ipa`/`.xcarchive`
  to release-please's release shell.
- `.github/workflows/ci.yml` — untouched.

## Flow after this lands

```
master:  feat: ...   fix: ...   feat!: ...
          │            │           │
          ▼            ▼           ▼
   release-please workflow runs on each push
          │
          ▼
   Opens / updates "chore(master): release X.Y.Z" PR
   ├─ bumps package.json
   ├─ bumps packages/extension-chrome/src/manifest.json
   └─ writes / updates CHANGELOG.md section
          │
          ▼ (maintainer merges it)
   release-please pushes tag vX.Y.Z + creates GitHub Release shell
          │
          ▼
   Existing release.yml fires on push: tags ['v*']
   ├─ build-chrome → dist-chrome.zip
   ├─ build-safari-ios → .ipa + .xcarchive  (unchanged)
   └─ github-release → attaches assets to the release shell
```

## Bootstrap

- Current root version is `0.0.0`.
- First Release PR will compute the next version from Conventional Commits
  since this commit lands. Most likely `0.1.0` (a `feat:` exists in recent
  history) or `0.0.1` (only `fix:` commits since the anchor).
- `bootstrap-sha` is intentionally **not** set: existing recent
  Conventional-Commit history will be summarised into the first release notes.

## Documentation touch-ups

- `RELEASE_CHECKLIST.md`
  - Replace the "`release:bump X.Y.Z` ran" line with "merge the open
    release-please PR; verify the bumped versions in `package.json` and
    `packages/extension-chrome/src/manifest.json` match the tag".
  - Leave Safari/Xcode lines intact (manual via `release-bump.mjs` until
    that scope is automated too).
- `README.md`
  - Add a brief "How releases work" subsection pointing at the release-please
    Release PR flow. Only if no equivalent section exists today; otherwise
    skip.

## Edge cases & risks

- **Safari manifest drift.** Chrome manifest stays in sync via `extra-files`;
  Safari manifest does not. Accepted trade-off for the Chrome-only scope.
- **Permissions.** The release-please workflow needs `contents: write` and
  `pull-requests: write`. No org-level approval expected for a personal
  private repo.
- **Branch protection.** If `master` requires PR review, release-please's
  own PR must still be merged by a maintainer (the action does not auto-merge).
  This matches the current human-in-the-loop release process.
- **Supply chain.** Pin `googleapis/release-please-action` by commit SHA (not
  by `v4`), matching the convention in `release.yml` (`actions/checkout`,
  `oven-sh/setup-bun`, etc.).
- **Empty first run.** If no Conventional-Commit `feat:`/`fix:` exists since
  the anchor, release-please will not open a PR. Not a failure — just means
  there is nothing release-worthy to ship yet.

## Out of scope (explicit)

- Per-package versioning / manifest-mode monorepo.
- Safari manifest, Xcode `MARKETING_VERSION`, and retiring `release-bump.mjs`.
- Changing `.github/workflows/release.yml` or `ci.yml`.
- Auto-merging the Release PR.

## Acceptance criteria

1. `release-please-config.json`, `.release-please-manifest.json`, and
   `.github/workflows/release-please.yml` exist with the content specified
   above (action pinned by SHA).
2. Pushing a Conventional-Commit change to `master` (after this lands) causes
   the release-please workflow to either open or update a Release PR that
   bumps `package.json` and `packages/extension-chrome/src/manifest.json` in
   lockstep, and updates `CHANGELOG.md`.
3. Merging that Release PR pushes a `vX.Y.Z` tag, creates a GitHub Release
   shell, and triggers the existing `release.yml` build pipeline.
4. `scripts/release-bump.mjs`, `packages/extension-safari/src/manifest.json`,
   `packages/extension-safari/xcode/*.pbxproj`, `.github/workflows/ci.yml`,
   and `.github/workflows/release.yml` are byte-identical before and after
   this change.
5. `RELEASE_CHECKLIST.md` reflects the new "merge the Release PR" step.
