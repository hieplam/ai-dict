# ai-dict

**AI Dictionary** — a Manifest V3 browser extension (Chrome + Safari/iOS) that looks up
the word or phrase you select on a page using Google's Gemini API and shows the result
in an in-page card / side panel.

It's a **bun workspace monorepo**:

| Package                     | Role                                                                                                      |
| --------------------------- | --------------------------------------------------------------------------------------------------------- |
| `packages/core`             | Pure domain logic (lookup workflow, prompt/cache/history policies, wire schema). No DOM, no browser APIs. |
| `packages/shared-ui`        | Framework-free Web Components (`<lookup-card>`, `<bottom-sheet>`, `<settings-form>`, …).                  |
| `packages/adapters-shared`  | Gemini client + markdown sanitization shared by both extensions.                                          |
| `packages/extension-chrome` | Chrome MV3 extension (service worker, content scripts, options, side panel).                              |
| `packages/extension-safari` | Safari/iOS MV3 extension + Xcode wrapper.                                                                 |

## Prerequisites

- **[bun](https://bun.sh) `1.3.14`** — the only required toolchain (pinned in `.bun-version`).
  Install with `curl -fsSL https://bun.sh/install | bash`. Node.js is **not** required.
- **Safari/iOS builds only:** macOS with **Xcode** installed.
- A **Google Gemini API key** (entered in the extension's options page at runtime — not needed to build).

## Setup

Install all workspace dependencies from the committed lockfile:

```bash
bun install
```

## Development workflow

All commands run from the repo root.

| Command                | What it does                                            |
| ---------------------- | ------------------------------------------------------- |
| `bun run test`         | Run the full test suite once (vitest).                  |
| `bun run test:watch`   | Re-run tests on change (TDD loop).                      |
| `bun run typecheck`    | Type-check every package (`tsc --noEmit`).              |
| `bun run lint`         | Lint with ESLint.                                       |
| `bun run format`       | Auto-format with Prettier.                              |
| `bun run format:check` | Verify formatting (CI gate).                            |
| `bun run size`         | Check built bundles against the size budgets.           |
| `bun run e2e:chrome`   | Run the Chrome extension end-to-end tests (Playwright). |
| `bun run build:chrome` | Build Chrome extension.                                 |
| `bun run build:safari` | Build Safari extension.                                 |

Run a script in a single package with `--filter`, e.g. only the core tests:

```bash
bun run --filter @ai-dict/core test
```

There is no bundler watch mode — re-run the build command (below) after changing
extension code, then reload the extension in the browser.

## Build the Chrome extension

```bash
bun run --filter @ai-dict/extension-chrome build
```

This bundles into `packages/extension-chrome/dist/` (service worker, content scripts,
options + side-panel pages, and the manifest).

**Load it in Chrome:**

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top-right).
3. Click **Load unpacked** and select `packages/extension-chrome/dist`.
4. Open the extension's **options** page and paste your Gemini API key.
5. Select a word on any page to trigger a lookup.

After editing code, re-run the build and click **Reload** on the extension card.

> Build both extensions at once with `bun run build` (root).

## Build the Safari / iOS extension

Safari packaging requires **macOS + Xcode**.

```bash
# 1. Bundle the web extension
bun run --filter @ai-dict/extension-safari build
```

**First-time setup** generates the Xcode project from the bundle via
`xcrun safari-web-extension-converter` — see
[`packages/extension-safari/xcode/README.md`](packages/extension-safari/xcode/README.md)
for the exact command and resulting structure.

**After each rebuild**, sync the fresh `dist/` into the Xcode project, then build/run
in Xcode (iOS Simulator):

```bash
bun run --filter @ai-dict/extension-safari build
bun run --filter @ai-dict/extension-safari xcode:sync
```

Then open the generated `.xcodeproj` in Xcode, run on the iOS Simulator, and enable
**AI Dictionary** under **Settings → Safari → Extensions**. The manual release pass is
documented in `packages/extension-safari/e2e/ios-simulator-checklist.md`.

## Known tradeoffs

- **zod ships in the browser bundle.** To keep the architecture simple, message
  validation uses [`zod`](https://zod.dev) directly in the extension's service worker and
  content script, instead of a hand-written zero-dependency shim. zod is ~250 kB
  unminified (smaller gzipped, but still over the old 30 kB service-worker size budget we
  used to enforce). We accept this for now in exchange for a single, un-duplicated
  validation schema. **Revisit if** service-worker cold-start latency or bundle size
  becomes a problem — at which point a build-time shim or a lighter validator can be
  reintroduced.

## More

- Release steps: [`RELEASE_CHECKLIST.md`](RELEASE_CHECKLIST.md).
- Design & plans: `docs/superpowers/`.
