# Apply release-please Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add release-please to automate version bumping (root `package.json` + Chrome manifest) and CHANGELOG generation, while leaving Safari, Xcode, and the existing tag-triggered `release.yml` build pipeline unchanged.

**Architecture:** Single-root-version mode. release-please workflow runs on every push to `master`, opens/updates a Release PR that bumps versions in lockstep and writes CHANGELOG. Merging that PR pushes a `vX.Y.Z` tag → existing `release.yml` fires on `push: tags: ['v*']` and attaches build artifacts to the GitHub Release shell release-please creates.

**Tech Stack:** GitHub Actions, `googleapis/release-please-action@v4.4.1` (SHA `5c625bfb5d1ff62eadeeb3772007f7f66fdcf071`), Conventional Commits.

**Spec:** [`docs/superpowers/specs/2026-06-06-release-please-design.md`](../specs/2026-06-06-release-please-design.md)

**Pre-flight:** Confirm you are on branch `feat/release-please` in the worktree at `.claude/worktrees/release-please`. If not, stop and ask.

---

## Why no TDD?

This change is pure CI configuration and a documentation edit — no application code or unit-testable functions are introduced. The verification model is therefore:

- **Local static checks:** JSON syntactic validity, GitHub Actions workflow syntax validity (via `gh workflow view` after push, or `actionlint`).
- **End-to-end validation (post-merge):** After the PR merges, observe the release-please workflow opening a Release PR with the expected diff. That observation closes the loop — it is performed in **Task 6: Post-merge validation**.

We still keep changes minimal and commit per-task to enable easy revert.

---

## File map

| Path                                   | Action | Purpose                                                                          |
| -------------------------------------- | ------ | -------------------------------------------------------------------------------- |
| `release-please-config.json`           | Create | Per-package release-please config (which files to bump, which release-type)      |
| `.release-please-manifest.json`        | Create | State file anchoring the current version per package                             |
| `.github/workflows/release-please.yml` | Create | Workflow that runs release-please on every `master` push and `workflow_dispatch` |
| `RELEASE_CHECKLIST.md`                 | Modify | Replace the manual `release:bump` step with "merge the Release PR"               |

No other files are touched. Specifically NOT touched: `scripts/release-bump.mjs`, `packages/extension-safari/src/manifest.json`, `packages/extension-safari/xcode/*.pbxproj`, `.github/workflows/release.yml`, `.github/workflows/ci.yml`, `packages/extension-chrome/src/manifest.json` (will be bumped automatically by release-please starting from the next merged Release PR — not pre-bumped here).

---

## Task 1: Add `release-please-config.json`

**Files:**

- Create: `release-please-config.json`

- [ ] **Step 1: Create the config file**

Path: `release-please-config.json` (repo root)

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

Notes:

- `release-type: node` → release-please bumps the root `package.json` `version` field natively.
- `include-component-in-tag: false` → tags stay `vX.Y.Z` (not `ai-dict-vX.Y.Z`), preserving compatibility with `release.yml`'s `tags: ['v*']` trigger.
- `extra-files` with `jsonpath: $.version` → Chrome manifest `version` key is bumped in lockstep.
- Safari manifest is intentionally NOT in `extra-files`.

- [ ] **Step 2: Verify JSON is valid**

Run from repo root:

```bash
bun --print "JSON.parse(require('fs').readFileSync('release-please-config.json', 'utf8'))" >/dev/null && echo OK
```

Expected output:

```
OK
```

If you see a `SyntaxError`, fix the file before continuing.

- [ ] **Step 3: Commit**

```bash
git add release-please-config.json
git commit -m "chore: add release-please-config.json"
```

---

## Task 2: Add `.release-please-manifest.json`

**Files:**

- Create: `.release-please-manifest.json`

- [ ] **Step 1: Create the manifest file**

Path: `.release-please-manifest.json` (repo root)

```json
{
  ".": "0.0.0"
}
```

This anchors release-please at the current root version. The first merged Release PR will compute the next version from Conventional Commits since this anchor lands.

- [ ] **Step 2: Verify JSON is valid**

```bash
bun --print "JSON.parse(require('fs').readFileSync('.release-please-manifest.json', 'utf8'))" >/dev/null && echo OK
```

Expected: `OK`.

- [ ] **Step 3: Confirm root `package.json` version matches the manifest**

```bash
bun --print "JSON.parse(require('fs').readFileSync('package.json','utf8')).version"
```

Expected output:

```
0.0.0
```

If the value differs from `0.0.0`, update `.release-please-manifest.json` to match, then re-run step 2. Do NOT edit `package.json`.

- [ ] **Step 4: Commit**

```bash
git add .release-please-manifest.json
git commit -m "chore: add release-please manifest"
```

---

## Task 3: Add the `release-please` workflow

**Files:**

- Create: `.github/workflows/release-please.yml`

- [ ] **Step 1: Create the workflow file**

Path: `.github/workflows/release-please.yml`

```yaml
name: release-please

on:
  push:
    branches: [master]
  workflow_dispatch:

permissions:
  contents: read

jobs:
  release-please:
    runs-on: ubuntu-latest
    permissions:
      contents: write # push the version-bump commit and the vX.Y.Z tag
      pull-requests: write # open and update the Release PR
    steps:
      - name: Run release-please
        uses: googleapis/release-please-action@5c625bfb5d1ff62eadeeb3772007f7f66fdcf071 # v4.4.1
        with:
          config-file: release-please-config.json
          manifest-file: .release-please-manifest.json
```

Notes:

- Action pinned by commit SHA (matches the convention used elsewhere in `release.yml` — `actions/checkout`, `oven-sh/setup-bun`, etc.).
- Top-level `permissions: contents: read` keeps the default least-privilege; the job overrides to `write` only for what release-please needs.
- No `secrets:` — `GITHUB_TOKEN` is used implicitly by the action.
- Triggers: every push to `master` keeps the Release PR up to date; `workflow_dispatch` lets you re-run manually if needed.

- [ ] **Step 2: Verify YAML is syntactically valid**

```bash
bun --print "const yaml = require('node:fs').readFileSync('.github/workflows/release-please.yml','utf8'); console.log(yaml.length > 0 ? 'OK' : 'EMPTY')"
```

Expected: `OK`.

For stricter validation (optional, if `actionlint` is installed locally):

```bash
actionlint .github/workflows/release-please.yml
```

Expected: no output (success).

If `actionlint` isn't installed locally, GitHub itself will validate it on push — that is sufficient.

- [ ] **Step 3: Confirm the SHA and version tag align**

```bash
gh api repos/googleapis/release-please-action/git/refs/tags/v4.4.1 --jq '.object.sha'
```

Expected output (exactly):

```
5c625bfb5d1ff62eadeeb3772007f7f66fdcf071
```

If the returned SHA differs, the upstream tag has moved — update the workflow's `uses:` SHA to the new value and re-run this step.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/release-please.yml
git commit -m "ci: add release-please workflow"
```

---

## Task 4: Update `RELEASE_CHECKLIST.md`

**Files:**

- Modify: `RELEASE_CHECKLIST.md`

- [ ] **Step 1: Read the existing checklist**

```bash
cat RELEASE_CHECKLIST.md
```

Locate the line under **Pre-tag**:

```
- [ ] `release:bump X.Y.Z` ran: root `package.json` version + both manifests + Xcode `MARKETING_VERSION` all equal the tag.
```

- [ ] **Step 2: Replace that line with the release-please flow**

Open `RELEASE_CHECKLIST.md` and replace the `release:bump` line above with these two lines (keep them at the same position in the list):

```
- [ ] release-please's open Release PR has been reviewed and merged on `master`; root `package.json` and `packages/extension-chrome/src/manifest.json` now both equal the tag version.
- [ ] If the release includes Safari changes: run `bun scripts/release-bump.mjs X.Y.Z` to sync `packages/extension-safari/src/manifest.json` and Xcode `MARKETING_VERSION`, then commit before tagging.
```

Rationale:

- Chrome flow is fully automated by release-please.
- Safari flow keeps its manual step for now (matches the design's Chrome-only scope).

- [ ] **Step 3: Verify the file still parses as markdown (sanity)**

```bash
head -20 RELEASE_CHECKLIST.md
```

Confirm the **Pre-tag** section still lists the surrounding bullets unchanged and your edit is in place.

- [ ] **Step 4: Check whether `README.md` already documents the release flow**

```bash
grep -nEi 'release|changelog|version' README.md | head -20
```

Decision rule:

- If you find an existing "Releases" / "How releases work" / "Versioning" section, **leave `README.md` alone**.
- If you find no such section, append the following at the end of `README.md` (keep the blank line before the heading):

```markdown
## How releases work

This repo uses [release-please](https://github.com/googleapis/release-please) to automate version bumps and changelog generation.

- Land changes on `master` using [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `feat!:` / `BREAKING CHANGE:` …).
- release-please opens and keeps a **Release PR** up to date on `master` with the computed next version and a `CHANGELOG.md` section.
- Merging the Release PR pushes a `vX.Y.Z` tag, which triggers `.github/workflows/release.yml` to build the Chrome zip (and Safari assets) and attach them to the GitHub Release.
- Safari/iOS version sync is still manual via `bun scripts/release-bump.mjs <version>` — see `RELEASE_CHECKLIST.md`.
```

Stage only if you edited the file:

```bash
git diff --stat README.md
```

- [ ] **Step 5: Commit**

```bash
git add RELEASE_CHECKLIST.md README.md
git commit -m "docs: replace manual release:bump step with release-please flow"
```

(If you did not modify `README.md`, the `git add README.md` is a no-op — safe to keep.)

---

## Task 5: Open the pull request

**Files:** none (PR only).

- [ ] **Step 1: Push the branch**

From the worktree directory (`.claude/worktrees/release-please`):

```bash
git push -u origin feat/release-please
```

- [ ] **Step 2: Open the PR with evidence**

```bash
gh pr create --title "ci: apply release-please (Chrome-only scope)" --body "$(cat <<'EOF'
## Summary

- Adds `release-please-config.json`, `.release-please-manifest.json`, and `.github/workflows/release-please.yml`.
- On every push to `master`, release-please opens / updates a Release PR that bumps the root `package.json` and `packages/extension-chrome/src/manifest.json` in lockstep, and updates `CHANGELOG.md` from Conventional Commits.
- Merging that Release PR pushes a `vX.Y.Z` tag → existing `release.yml` fires unchanged and attaches the Chrome zip (and Safari assets) to release-please's release shell.
- Updates `RELEASE_CHECKLIST.md` to point at the Release PR instead of the manual `release:bump` step.

Scope is **Chrome-only**: Safari manifest, Xcode `MARKETING_VERSION`, and `scripts/release-bump.mjs` are untouched and stay available for manual Safari cuts.

Design: `docs/superpowers/specs/2026-06-06-release-please-design.md`

## Before

Manual `bun run release:bump <ver>` had to be invoked locally before every tag. The chosen version had to be remembered and applied consistently across root `package.json`, both manifests, and Xcode `MARKETING_VERSION`.

## After

Conventional Commits land on `master` → release-please keeps a Release PR up to date with the computed next version + CHANGELOG section. Merging it ships the tag.

## Verification (post-merge, recorded in the PR thread as a follow-up comment)

Once this PR is merged, the `release-please` workflow run on the merge commit should:

1. Succeed (green).
2. Either open a new Release PR titled `chore(master): release <next-version>` whose diff bumps `package.json` and `packages/extension-chrome/src/manifest.json` to the same value and updates `CHANGELOG.md`, OR produce no PR if there are no `feat:`/`fix:` commits since the anchor (not a failure — see plan Task 6).
3. NOT modify Safari manifest, Xcode pbxproj, `release.yml`, `ci.yml`, or `release-bump.mjs`.

## Test plan

- [ ] CI passes on this branch.
- [ ] After merge: `release-please` workflow runs and either opens a Release PR or no-ops cleanly.
- [ ] The Release PR's diff is limited to `package.json`, `packages/extension-chrome/src/manifest.json`, `.release-please-manifest.json`, and `CHANGELOG.md`.
EOF
)"
```

- [ ] **Step 3: Capture the PR URL**

```bash
gh pr view --json url --jq '.url'
```

Record the URL — you'll need it in Task 6.

---

## Task 6: Post-merge validation

**This task runs AFTER the PR from Task 5 is reviewed and merged into `master`.** Do not start it before merge.

- [ ] **Step 1: Wait for the `release-please` workflow to run on the merge commit**

```bash
gh run list --workflow=release-please.yml --branch=master --limit=1
```

Wait until the latest run shows `completed` + `success`. If it shows `failure`, fetch logs:

```bash
gh run view --workflow=release-please.yml --log-failed
```

and fix the workflow file in a follow-up PR. Do not retry by force-pushing to `master`.

- [ ] **Step 2: Check whether a Release PR was opened**

```bash
gh pr list --search "chore(master): release in:title" --state=open
```

Two valid outcomes:

- **A Release PR was opened.** Inspect its diff:

  ```bash
  gh pr diff <release-pr-number>
  ```

  Expected files in the diff:
  - `package.json` (`version` bumped)
  - `packages/extension-chrome/src/manifest.json` (`version` bumped to the same value)
  - `.release-please-manifest.json` (`.` value bumped to the same value)
  - `CHANGELOG.md` (new section appended)
    No other files should appear. If they do, comment on the PR with the unexpected diff and pause for review.

- **No Release PR was opened.** That's fine if there are no `feat:`/`fix:` commits since the anchor — release-please correctly no-ops. Confirm by running:

  ```bash
  git log master --oneline -- ':!.claude' ':!docs' | head
  ```

  and checking whether the recent commits are only `chore:`/`docs:`/`style:` (which don't trigger a release). If a clearly release-worthy commit was skipped, capture the workflow log and investigate.

- [ ] **Step 3: Comment on the merged PR with the outcome**

```bash
gh pr comment <merged-pr-number> --body "Post-merge validation: release-please workflow run succeeded; Release PR <url-or-'no-op as expected'>."
```

This closes the loop and provides evidence the change works end-to-end.

- [ ] **Step 4: Done**

The release-please adoption is complete. From now on:

1. Land Conventional-Commit changes on `master`.
2. Review and merge the open Release PR when ready to ship.
3. Tag-triggered `release.yml` builds and attaches Chrome zip to the release shell.

---

## Out of scope (do NOT do as part of this plan)

- Pre-bumping `packages/extension-chrome/src/manifest.json` to anything other than the current `0.0.0`. release-please will do this on the first Release PR — manually bumping it here would create a spurious diff.
- Editing `.github/workflows/release.yml`, `.github/workflows/ci.yml`, `scripts/release-bump.mjs`, `packages/extension-safari/src/manifest.json`, or Xcode pbxproj files.
- Adding auto-merge for the Release PR.
- Adding per-package versioning / manifest-mode monorepo configuration.

If you find yourself wanting to do any of the above mid-task, stop and ask.
