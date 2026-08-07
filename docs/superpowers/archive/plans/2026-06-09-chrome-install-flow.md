# Chrome Install Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give end users a working way to install the AI Dictionary Chrome extension by publishing a prebuilt `dist-chrome.zip` on every GitHub Release and documenting two install paths (a one-line `curl | bash` for non-tech users, explicit fetch commands for tech users) that both download that same artifact.

**Architecture:** Fix the broken release pipeline by building + uploading the Chrome zip from inside `release-please.yml` (gated on the action's `release_created` output), sidestepping the `GITHUB_TOKEN`-can't-trigger-workflows limitation that left `release.yml` with zero runs. Add a repo-root `scripts/install-chrome.sh` that downloads the latest-release zip, unzips it, and prints the manual `chrome://extensions` finish. Document both paths in `README.md`. No install path compiles from source.

**Tech Stack:** GitHub Actions (`release-please-action` v4), bun, esbuild (existing Chrome build), bash + curl + unzip, Prettier (YAML/Markdown gate via `.githooks` pre-commit `format:check`).

---

## File Structure

- **Modify** `.github/workflows/release-please.yml` — add a build-and-upload-`dist-chrome.zip` step set, gated on `release_created`.
- **Create** `scripts/install-chrome.sh` — non-tech one-line installer; downloads + unzips the release artifact, prints Load-unpacked steps. Reads `AI_DICT_DIR` and `AI_DICT_ZIP_URL` env overrides (for default behaviour and for offline testing).
- **Create** `scripts/install-chrome.test.sh` — offline bash test: builds a fixture zip, serves it via `file://`, runs the installer, asserts extraction.
- **Modify** `README.md` — add `## Install (Chrome)` section above the existing developer "Build the Chrome extension" section.

> `dist/` is git-ignored (the artifact is CI-built, never committed). Reference: spec `docs/superpowers/specs/2026-06-09-chrome-install-flow-design.md`.

---

## Task 1: Publish `dist-chrome.zip` from the release-please workflow

**Files:**

- Modify: `.github/workflows/release-please.yml`

**Context:** The current file runs only the `release-please-action` step. We add `id: release` to it, then append checkout + bun + build + zip + upload steps, each guarded by `if: ${{ steps.release.outputs.release_created }}` so they run only when a release is actually cut. The job already declares `permissions: contents: write`, which `gh release upload` requires. `gh` is preinstalled on `ubuntu-latest`. Do **not** set `GEMINI_API_KEY` — leaving it unset keeps the key out of the published artifact (`esbuild.config.mjs` only injects it when present), preserving `rule-api-key-isolation`.

- [ ] **Step 1: Replace the workflow body with the build+upload steps**

Replace the entire contents of `.github/workflows/release-please.yml` with:

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
        id: release
        uses: googleapis/release-please-action@5c625bfb5d1ff62eadeeb3772007f7f66fdcf071 # v4.4.1
        with:
          config-file: release-please-config.json
          manifest-file: .release-please-manifest.json

      # When a release is cut, attach the prebuilt Chrome extension zip so end
      # users have a real artifact to download. Runs in THIS workflow (not the
      # tag-triggered release.yml) because release-please's GITHUB_TOKEN tags do
      # not trigger tag-push workflows.
      - name: Checkout
        if: ${{ steps.release.outputs.release_created }}
        uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5 # v4.3.1

      - name: Set up bun
        if: ${{ steps.release.outputs.release_created }}
        uses: oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0
        with:
          bun-version-file: .bun-version

      - name: Cache bun install
        if: ${{ steps.release.outputs.release_created }}
        uses: actions/cache@0057852bfaa89a56745cba8c7296529d2fc39830 # v4.3.0
        with:
          path: ~/.bun/install/cache
          key: bun-${{ runner.os }}-${{ hashFiles('bun.lock') }}
          restore-keys: bun-${{ runner.os }}-

      - name: Install deps
        if: ${{ steps.release.outputs.release_created }}
        run: bun install --frozen-lockfile

      - name: Build Chrome extension
        if: ${{ steps.release.outputs.release_created }}
        run: bun run --filter @ai-dict/extension-chrome build

      - name: Zip unpacked dist -> dist-chrome.zip
        if: ${{ steps.release.outputs.release_created }}
        run: cd packages/extension-chrome/dist && zip -r "$GITHUB_WORKSPACE/dist-chrome.zip" .

      - name: Upload dist-chrome.zip to the release
        if: ${{ steps.release.outputs.release_created }}
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: gh release upload "${{ steps.release.outputs.tag_name }}" dist-chrome.zip --clobber
```

- [ ] **Step 2: Verify the YAML parses (Prettier is the syntax gate)**

Run: `cd /Users/home/repos/ai-dict/.claude/worktrees/chrome-install && bunx prettier --check .github/workflows/release-please.yml`
Expected: `All matched files use Prettier code style!` (Prettier parses YAML; invalid YAML fails here). If it reports style issues, run `bunx prettier --write .github/workflows/release-please.yml` and re-check.

- [ ] **Step 3: Commit**

```bash
cd /Users/home/repos/ai-dict/.claude/worktrees/chrome-install
git add .github/workflows/release-please.yml
git commit -m "ci(release): attach prebuilt dist-chrome.zip to each release"
```

> Real end-to-end proof (the asset actually appearing on a release) is deferred to Task 4, which requires a release to be cut.

---

## Task 2: `scripts/install-chrome.sh` (TDD)

**Files:**

- Create: `scripts/install-chrome.sh`
- Test: `scripts/install-chrome.test.sh`

**Context:** The installer downloads `dist-chrome.zip` from `AI_DICT_ZIP_URL` (default: the latest-release URL) into `$AI_DICT_DIR/dist` (default `$HOME/.ai-dict`). curl accepts `file://` URLs, so the test points `AI_DICT_ZIP_URL` at a locally-built fixture zip and `AI_DICT_DIR` at a temp dir — fully offline, no network, no extra deps. The release zip is created with `zip -r ... .` from inside `dist/`, so `manifest.json` sits at the zip's top level and extracts to `$AI_DICT_DIR/dist/manifest.json`.

- [ ] **Step 1: Write the failing test**

Create `scripts/install-chrome.test.sh`:

```bash
#!/usr/bin/env bash
# Offline test for install-chrome.sh: build a fixture zip, serve it via file://,
# run the installer against a temp dir, assert the extension extracted.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
script="$here/install-chrome.sh"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# Build a fixture that mirrors the real release zip: manifest.json at top level.
fixture_src="$work/dist-src"
mkdir -p "$fixture_src"
printf '%s\n' '{"manifest_version":3,"name":"AI Dictionary","version":"0.0.0"}' \
  > "$fixture_src/manifest.json"
fixture_zip="$work/dist-chrome.zip"
( cd "$fixture_src" && zip -qr "$fixture_zip" . )

install_dir="$work/install"
AI_DICT_DIR="$install_dir" AI_DICT_ZIP_URL="file://$fixture_zip" bash "$script"

if [ ! -f "$install_dir/dist/manifest.json" ]; then
  echo "FAIL: expected $install_dir/dist/manifest.json to exist" >&2
  exit 1
fi
echo "PASS: install-chrome.sh extracted the extension to $install_dir/dist"
```

Make it executable:

```bash
cd /Users/home/repos/ai-dict/.claude/worktrees/chrome-install
chmod +x scripts/install-chrome.test.sh
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/home/repos/ai-dict/.claude/worktrees/chrome-install && bash scripts/install-chrome.test.sh`
Expected: FAIL — `bash: scripts/install-chrome.sh: No such file or directory` (the installer doesn't exist yet).

- [ ] **Step 3: Write the installer**

Create `scripts/install-chrome.sh`:

```bash
#!/usr/bin/env bash
# AI Dictionary — Chrome installer (non-tech, one command).
# Downloads the prebuilt extension from the latest GitHub Release, unzips it,
# and prints the manual chrome://extensions steps. Re-run any time to update.
#
# Overrides (mainly for testing):
#   AI_DICT_DIR      install location           (default: $HOME/.ai-dict)
#   AI_DICT_ZIP_URL  zip to download            (default: latest release asset)
set -euo pipefail

DIR="${AI_DICT_DIR:-$HOME/.ai-dict}"
URL="${AI_DICT_ZIP_URL:-https://github.com/hieplam/ai-dict/releases/latest/download/dist-chrome.zip}"
DEST="$DIR/dist"

for cmd in curl unzip; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Error: '$cmd' is required but not installed." >&2
    exit 1
  fi
done

echo "Downloading AI Dictionary…"
tmp_zip="$(mktemp)"
trap 'rm -f "$tmp_zip"' EXIT
curl -fSL "$URL" -o "$tmp_zip"

# Clean any previous install so re-runs upgrade in place.
rm -rf "$DEST"
mkdir -p "$DEST"
unzip -q -o "$tmp_zip" -d "$DEST"

cat <<EOF

✅ AI Dictionary downloaded to:
   $DEST

Finish installing in Chrome (Chrome can't auto-install extensions):
  1. Open  chrome://extensions
  2. Turn on  Developer mode  (top-right)
  3. Click  Load unpacked  and select:
     $DEST
  4. Open the extension's Options page and paste your Gemini API key
  5. Select any word on a page to look it up

To update later, just run this installer again.
EOF
```

Make it executable:

```bash
cd /Users/home/repos/ai-dict/.claude/worktrees/chrome-install
chmod +x scripts/install-chrome.sh
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /Users/home/repos/ai-dict/.claude/worktrees/chrome-install && bash scripts/install-chrome.test.sh`
Expected: `PASS: install-chrome.sh extracted the extension to <tmp>/install/dist`

- [ ] **Step 5: Commit**

```bash
cd /Users/home/repos/ai-dict/.claude/worktrees/chrome-install
git add scripts/install-chrome.sh scripts/install-chrome.test.sh
git commit -m "feat(install): add one-line Chrome installer that fetches the release build"
```

---

## Task 3: Document both install paths in the README

**Files:**

- Modify: `README.md`

**Context:** Insert a new `## Install (Chrome)` section immediately **before** the existing `## Build the Chrome extension` section (which stays, for contributors). The anchor text to insert before is the line `## Build the Chrome extension`. Non-tech path first, tech path second, shared manual finish.

- [ ] **Step 1: Insert the Install section**

In `README.md`, find the line:

```markdown
## Build the Chrome extension
```

Insert the following block immediately **above** that line (leave the existing section intact below it):

````markdown
## Install (Chrome)

Both methods download the **same prebuilt build** attached to the
[latest GitHub Release](https://github.com/hieplam/ai-dict/releases/latest) — nothing is
compiled from source. Chrome cannot auto-install extensions, so every method ends with two
clicks in `chrome://extensions`.

### Non-technical — one command

```bash
curl -fsSL https://github.com/hieplam/ai-dict/raw/master/scripts/install-chrome.sh | bash
```

This downloads the extension to `~/.ai-dict/dist` and prints the finishing steps. Re-run it
any time to update.

### Technical — fetch the build yourself

```bash
# plain curl
curl -fsSL https://github.com/hieplam/ai-dict/releases/latest/download/dist-chrome.zip -o dist-chrome.zip
unzip dist-chrome.zip -d ai-dict-dist

# …or with the GitHub CLI
gh release download --repo hieplam/ai-dict --pattern dist-chrome.zip
```

### Finish in Chrome (all methods)

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top-right).
3. Click **Load unpacked** and select the unzipped folder
   (`~/.ai-dict/dist` for the one-command install).
4. Open the extension's **options** page and paste your Gemini API key.
5. Select a word on any page to trigger a lookup.

> Want to build from source instead? See **Build the Chrome extension** below.
````

- [ ] **Step 2: Verify Markdown formatting**

Run: `cd /Users/home/repos/ai-dict/.claude/worktrees/chrome-install && bunx prettier --check README.md`
Expected: `All matched files use Prettier code style!` If it reports issues, run `bunx prettier --write README.md` and re-check.

- [ ] **Step 3: Commit**

```bash
cd /Users/home/repos/ai-dict/.claude/worktrees/chrome-install
git add README.md
git commit -m "docs(readme): add end-user Chrome install section (non-tech + tech)"
```

---

## Task 4: Verify end-to-end after merge (cut the first asset-bearing release)

**Context:** This task is **operational** and runs **after the feature PR is merged to `master`** — it can't be done from the worktree branch. Merging this PR lets release-please open/refresh its Release PR; merging _that_ cuts the next version (e.g. `v1.1.1`) and, via Task 1's new steps, uploads `dist-chrome.zip`. Until that asset exists, the install commands will 404.

- [ ] **Step 1: Merge the release-please PR** so a new version is tagged. (Maintainer action.)

- [ ] **Step 2: Confirm the asset is attached**

Run: `gh release view <new-tag> --repo hieplam/ai-dict --json assets --jq '.assets[].name'`
Expected: includes `dist-chrome.zip`.

- [ ] **Step 3: Confirm the latest-release URL resolves**

Run: `curl -fsSIL https://github.com/hieplam/ai-dict/releases/latest/download/dist-chrome.zip -o /dev/null && echo OK`
Expected: `OK` (no curl error).

- [ ] **Step 4: Smoke-test the one-command installer against the real release**

Run: `AI_DICT_DIR="$(mktemp -d)/ai-dict" bash scripts/install-chrome.sh && echo INSTALLED`
Expected: prints the finish steps and `INSTALLED`; the printed dir contains `dist/manifest.json`.

---

## Self-Review

**Spec coverage:**

- Pipeline fix (spec §1) → Task 1. ✓
- Non-tech `curl | bash` installer (spec §2) → Task 2 + README non-tech block (Task 3). ✓
- Tech path fetching the same artifact, no source build (spec §3) → README tech block (Task 3). ✓
- README `## Install (Chrome)` placement (spec §4) → Task 3 inserts above the dev build section. ✓
- `rule-api-key-isolation` (no baked key) → Task 1 Step 1 leaves `GEMINI_API_KEY` unset (noted in context). ✓
- Cut-over + verification (spec "Cut-over" / "Verification") → Task 4. ✓
- Out-of-scope items (Safari `release.yml`, Web Store, native Windows) → untouched; no tasks. ✓

**Placeholder scan:** No TBD/TODO; all code blocks are complete; all commands have expected output. ✓

**Type/name consistency:** `AI_DICT_DIR` and `AI_DICT_ZIP_URL` env names match between installer, test, and README. Install dir `~/.ai-dict/dist` consistent across script, test assertion, and README. Asset name `dist-chrome.zip` consistent across Task 1 (zip + upload), Task 3 (download URLs), and Task 4 (verify). Latest-release URL identical in script default, README tech block, and Task 4. ✓

```

```
