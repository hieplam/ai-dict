# Chrome install flow — design

**Date:** 2026-06-09
**Status:** Approved (brainstorming)
**Scope:** Chrome on desktop (PC/Mac/Linux). Safari/iOS is explicitly out of scope.

## Problem

End users have no way to install the AI Dictionary Chrome extension. The README only
documents a **developer** flow (install the Bun toolchain, `bun install`, build from
source, Load unpacked). There is no end-user path, and — more fundamentally — **there is
no downloadable build to point them at**: GitHub Releases `v1.0.0` and `v1.1.0` carry
**zero assets**.

### Root cause of the empty releases

`.github/workflows/release.yml` is supposed to build `dist-chrome.zip` and attach it to
the release, but it triggers on `push: tags: ['v*']`. Those tags are created by
`release-please` using the default `GITHUB_TOKEN`, and **GitHub deliberately does not
trigger workflows from `GITHUB_TOKEN`-created events** (anti-recursion). Result: the
Release workflow has **0 runs**, so no asset is ever uploaded. The release object exists
(release-please creates it) but is empty.

## Goal

1. Fix the pipeline so every GitHub Release carries a real, prebuilt `dist-chrome.zip`.
2. Ship **two** end-user install paths, **both fetching that same prebuilt artifact** from
   the latest GitHub Release. **No path compiles from source. No `bun install`.**

## Single source of truth

The **latest GitHub Release** and its attached `dist-chrome.zip` are the one canonical
build. Both install paths download that exact asset — they differ only in _how_, not in
_what_ they install. Stable URL:

```
https://github.com/hieplam/ai-dict/releases/latest/download/dist-chrome.zip
```

(`releases/latest/download/<asset>` is GitHub's documented redirect to the newest
release's asset of that name.)

## Design

### 1. Pipeline fix — publish `dist-chrome.zip` from `release-please.yml`

Build and upload the Chrome zip **inside `release-please.yml`**, gated on the
release-please action's `release_created` output. This runs in the _same_ workflow that
already owns a working token context, sidestepping the `GITHUB_TOKEN`-trigger block.

- Give the existing release-please step `id: release`.
- Add steps, all guarded by `if: ${{ steps.release.outputs.release_created }}`:
  - `actions/checkout`
  - `oven-sh/setup-bun` (pinned, `bun-version-file: .bun-version`) + bun cache (mirror the
    pattern already used across `ci.yml`)
  - `bun install --frozen-lockfile`
  - `bun run --filter @ai-dict/extension-chrome build`
  - zip the unpacked dist: `cd packages/extension-chrome/dist && zip -r "$GITHUB_WORKSPACE/dist-chrome.zip" .`
  - upload to the just-created release:
    `gh release upload "${{ steps.release.outputs.tag_name }}" dist-chrome.zip --clobber`
    with `env: GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}`.
- The job already has `permissions: contents: write`, which is sufficient for
  `gh release upload`.
- **Do not bake `GEMINI_API_KEY`** into the release build — `esbuild.config.mjs` only
  injects it when the env var is present; CI must leave it unset so the published artifact
  asks each user for their own key via the options page (preserves `rule-api-key-isolation`).

`release.yml` (Safari/iOS, macOS/Xcode, already `continue-on-error`) is left untouched.

**Cut-over:** after merge, cut one patch release (`v1.1.1`) so the _latest_ release
actually carries `dist-chrome.zip`. Verify the asset is present and downloadable before
the install docs are considered live.

### 2. Non-tech path — `scripts/install-chrome.sh`

A POSIX/bash script, committed at `scripts/install-chrome.sh`, run as:

```bash
curl -fsSL https://github.com/hieplam/ai-dict/raw/master/scripts/install-chrome.sh | bash
```

Behaviour:

1. Resolve an install dir (default `~/.ai-dict`; honour an override env var, e.g. `AI_DICT_DIR`).
2. Download `dist-chrome.zip` from the latest-release URL above (curl, fail-fast `-fSL`).
3. Unzip into `<dir>/dist` (clean any prior contents first so re-runs upgrade in place).
4. Require `curl` and `unzip`; if missing, print a clear message and exit non-zero.
5. Print the **manual finish** (Chrome cannot self-install extensions) with the exact path
   to paste:
   - Open `chrome://extensions`
   - Enable **Developer mode** (top-right)
   - Click **Load unpacked** → select `<dir>/dist`
   - Open the extension **options** page and paste your Gemini API key
6. Idempotent and safe to re-run to update.

The script must not assume the repo is checked out — it only needs network + `unzip`.

### 3. Tech path — fetch the same prebuilt artifact, manually

Explicit, inspectable commands that download the **same** `dist-chrome.zip` (no build):

```bash
# option A — plain curl
curl -fsSL https://github.com/hieplam/ai-dict/releases/latest/download/dist-chrome.zip -o dist-chrome.zip
unzip dist-chrome.zip -d ai-dict-dist
# option B — gh CLI (pin a version if desired)
gh release download --repo hieplam/ai-dict --pattern dist-chrome.zip
```

Then: `chrome://extensions` → Developer mode → **Load unpacked** → select the unzipped
folder → set the Gemini API key in options.

### 4. Docs

Add an **`## Install (Chrome)`** section to `README.md`, placed above the existing
developer "Build the Chrome extension" section, containing both paths (non-tech first,
tech second) and the manual Load-unpacked finish. The existing developer build section
stays for contributors. Reference `scripts/install-chrome.sh` from the non-tech path.

## Out of scope

- Safari/iOS install (separate macOS/Xcode flow; `release.yml` untouched).
- Chrome Web Store publishing.
- Auto-update of the unpacked extension (Chrome reloads unpacked manually; re-running the
  script re-downloads the latest build).
- Windows `.cmd`/PowerShell variant of the install script (bash flow covers WSL/Git-Bash;
  revisit only if requested).

## Verification / evidence

- CI: after merge + `v1.1.1`, confirm `gh release view v1.1.1` lists `dist-chrome.zip` and
  the asset downloads.
- Non-tech: run the `curl | bash` line on a clean dir; confirm `~/.ai-dict/dist/manifest.json`
  exists and Chrome loads it.
- Tech: run the curl+unzip commands; confirm the same.
- Per repo convention, attach Before/After evidence to the PR (release assets screenshot +
  a screen recording of the install flow ending in a working lookup), using same-origin
  `github.com/.../raw/...` asset URLs.

## C3 note

`scripts/`, `.github/workflows/`, and `README.md` are repo-level (not inside a C3
component's source). The Chrome build artifact belongs to `c3-2` (extension-chrome). Run
`c3 lookup` on touched paths during implementation; the security-relevant constraint is
`rule-api-key-isolation` (do not bake the key into the released build — see §1).
