# Chrome Web Store Publish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing Chrome MV3 extension installable from the Chrome Web Store with one click and auto-updates, and have every `release-please` version upload + publish itself via CI.

**Architecture:** Add the store-required icon set to the extension package (`c3-2`), produce the listing assets (screenshots, promo tile, copy, privacy policy) as repo-versioned content, and extend the workflow that actually runs on release (`release-please.yml`) with a guarded publish step using the pinned `chrome-webstore-upload-cli`. Account creation, the first listing, and OAuth secrets are a one-time manual step the owner performs from a runbook; everything else is automated.

**Tech Stack:** Bun, esbuild, Playwright (bundled Chromium, used for both screenshots and icon rasterization), GitHub Actions, `release-please`, `chrome-webstore-upload-cli@4.0.1` (bin `chrome-webstore-upload`), C3 (`.c3/`).

---

## Pre-flight (read once, do not skip)

- **Worktree:** all work happens in the existing worktree `/.claude/worktrees/chrome-web-store` on branch `feat/chrome-web-store-publish`. Run every command from that directory.
- **C3 handle (define once per shell that runs `c3`):**
  ```bash
  c3() { C3X_MODE=agent bash /Users/home/.claude/skills/c3/bin/c3x.sh "$@"; }
  ```
- **Playwright Chromium** must be installed locally for Tasks 2 and 7 (icon rasterization + screenshots):
  ```bash
  cd packages/extension-chrome && bunx playwright install chromium && cd ../..
  ```
- **Commit hygiene:** the repo's pre-commit hook runs `bun run format:check` over the whole tree. Before every commit, run `bunx prettier --write <files-you-changed>` (binary `.png` files are ignored by prettier). No `Co-Authored-By` / "Generated with" trailers (owner convention).
- **Asset vs. evidence:** icons ship inside the extension (`src/icons/`) and store assets live in `docs/store/chrome/` — these are legitimate versioned product content. _PR evidence_ (before/after images, the publish-step recording) is different: host it on a throwaway `pr-assets/*` branch and reference it with same-origin `github.com/.../raw/...` URLs (private-repo requirement). Do not commit PR evidence into the source branch.
- **Security invariant (`rule-api-key-isolation`, S1):** never set `GEMINI_API_KEY` in any build/release step. The distributed build must ask each user for their own key.

---

## Task 1: Open the C3 ADR (work order)

C3 requires a `change` to start with an ADR before code is touched.

**Files:**

- Create (via CLI only): `.c3/adr/adr-20260614-chrome-web-store-publish.md`

- [ ] **Step 1: Inspect the ADR contract**

```bash
c3() { C3X_MODE=agent bash /Users/home/.claude/skills/c3/bin/c3x.sh "$@"; }
c3 schema adr
```

Read the `REJECT IF` block and the per-section `fill:` / `rejected when:` lines first — they are the acceptance contract.

- [ ] **Step 2: Draft the ADR body to a temp file**

Write `/tmp/adr-cws.md` with one section per heading reported by `c3 schema adr`. Use this content, mapped onto the schema's section names (use `N.A - <reason>` for any required row that does not apply):

- **Context:** End users have no real install path (only sideloading); `manifest.json` declares no icons; nothing publishes to the Chrome Web Store. Full rationale: `docs/superpowers/specs/2026-06-14-chrome-web-store-publish-design.md`.
- **Decision:** Publish to the Chrome Web Store. Add a 16/32/48/128 icon set + `action.default_icon` to the Chrome manifest; produce listing assets (screenshots, promo, copy, `PRIVACY.md`); add a guarded `chrome-webstore-upload-cli` publish step to `release-please.yml`. iOS/Safari App Store is a separate follow-up.
- **Affected components:** `c3-2` (extension-chrome) and its `c3-210` (chrome-service-worker, which owns `manifest.json`).
- **Rules honored:** `rule-api-key-isolation` — the release build leaves `GEMINI_API_KEY` unset; a CI guard enforces it.
- **Parent Delta:** No new component. `c3-2` already owns "the MV3 `manifest.json`, the esbuild bundle"; adding icon metadata is packaging detail — record **no-delta** against c3-2's Components/Responsibilities.
- **Alternatives considered:** keep sideloading (rejected: not one-click, no auto-update); manual store upload each release (rejected: owner chose automation).
- **Consequences:** one-time owner setup (account, item/App ID, OAuth secrets) is unavoidable; thereafter releases publish themselves; Google review gates go-live.
- **Verification:** `bun test` + `bun run lint` green; `bun run build:chrome` yields `dist/icons/*` and a manifest with icons; workflow publishes when secrets are present and skips when absent.

- [ ] **Step 3: Create the ADR (status starts `proposed`)**

```bash
c3 add adr chrome-web-store-publish --file /tmp/adr-cws.md
c3 check --include-adr
```

Expected: `c3 check` reports no errors for the new ADR. The id is date-stamped — `c3 add` prints `adr-20260614-chrome-web-store-publish` when created today; if you implement on another day, use the exact id it prints in Tasks 1.4, 11.2, and 11.3. If a section is rejected as thin, expand it and re-run.

- [ ] **Step 4: Accept the ADR (transition `proposed → accepted`)**

```bash
c3 set adr-20260614-chrome-web-store-publish status accepted   # use the id printed by `c3 add`
c3 check --include-adr
```

(The `proposed → implemented` jump is blocked; it is moved to `implemented` in Task 11.)

- [ ] **Step 5: Commit**

```bash
git add .c3/
bunx prettier --write .c3/**/*.md 2>/dev/null || true
git -c commit.gpgsign=false commit -m "docs(c3): ADR for Chrome Web Store publish"
```

---

## Task 2: Generate brand assets — icon set (16/32/48/128) + promo tile (440×280)

No SVG rasterizer (`rsvg-convert`/`magick`/`inkscape`/`sharp`) exists in this environment; only Playwright's bundled Chromium. Rasterize via Chromium (also satisfies the "bundled/standalone Chromium" screenshot guardrail). PNGs are committed; the build only copies them.

**Files:**

- Create: `packages/extension-chrome/src/icons/icon.svg`
- Create: `packages/extension-chrome/scripts/generate-brand-assets.mjs`
- Generated (committed): `packages/extension-chrome/src/icons/icon-16.png`, `-32.png`, `-48.png`, `-128.png`
- Generated (committed): `docs/store/chrome/promo-440x280.png`

- [ ] **Step 1: Create the icon master `packages/extension-chrome/src/icons/icon.svg`**

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="28" fill="#2f6f4e"/>
  <text x="64" y="88" text-anchor="middle"
        font-family="Georgia, 'Times New Roman', 'DejaVu Serif', serif"
        font-size="86" font-weight="700" fill="#ffffff">A</text>
  <rect x="40" y="100" width="48" height="8" rx="4" fill="#bfe3cf"/>
</svg>
```

- [ ] **Step 2: Create the generator `packages/extension-chrome/scripts/generate-brand-assets.mjs`**

```js
// Rasterize brand assets with Playwright's bundled Chromium (no SVG-rasterizer dependency,
// and not the installed Google Chrome — per the repo screenshot guardrail). Run locally to
// (re)generate committed PNGs: `cd packages/extension-chrome && bun scripts/generate-brand-assets.mjs`
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, '..');
const repoRoot = resolve(pkgRoot, '../..');
const iconsDir = resolve(pkgRoot, 'src/icons');
const storeDir = resolve(repoRoot, 'docs/store/chrome');
const svg = await readFile(resolve(iconsDir, 'icon.svg'), 'utf8');

const browser = await chromium.launch();
try {
  for (const size of [16, 32, 48, 128]) {
    const page = await browser.newPage({
      viewport: { width: size, height: size },
      deviceScaleFactor: 1,
    });
    await page.setContent(
      `<!doctype html><meta charset="utf8"><style>*{margin:0;padding:0}html,body{width:${size}px;height:${size}px}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
      { waitUntil: 'networkidle' },
    );
    await page.screenshot({
      path: resolve(iconsDir, `icon-${size}.png`),
      omitBackground: true,
      clip: { x: 0, y: 0, width: size, height: size },
    });
    await page.close();
  }

  await mkdir(storeDir, { recursive: true });
  const promo = await browser.newPage({
    viewport: { width: 440, height: 280 },
    deviceScaleFactor: 1,
  });
  await promo.setContent(
    `<!doctype html><meta charset="utf8"><style>
       *{margin:0;padding:0;box-sizing:border-box}
       body{width:440px;height:280px;display:flex;align-items:center;gap:22px;
            padding:0 34px;background:#2f6f4e;color:#fff;font-family:Georgia,'DejaVu Serif',serif}
       .mark{flex:0 0 96px;height:96px;border-radius:22px;background:#26593f;
             display:flex;align-items:center;justify-content:center;font-size:64px;font-weight:700}
       .mark u{text-decoration:none;border-bottom:6px solid #bfe3cf;padding-bottom:2px}
       h1{font-size:34px;line-height:1.1;margin-bottom:10px}
       p{font-size:16px;color:#d8efe1;font-family:-apple-system,Segoe UI,Roboto,sans-serif}
     </style>
     <div class="mark"><u>A</u></div>
     <div><h1>AI Dictionary</h1><p>Look up any word — right where you're reading.</p></div>`,
    { waitUntil: 'networkidle' },
  );
  await promo.screenshot({
    path: resolve(storeDir, 'promo-440x280.png'),
    clip: { x: 0, y: 0, width: 440, height: 280 },
  });
  await promo.close();
} finally {
  await browser.close();
}
console.log('brand assets generated');
```

- [ ] **Step 3: Generate the assets**

```bash
cd packages/extension-chrome && bun scripts/generate-brand-assets.mjs && cd ../..
```

Expected output: `brand assets generated`.

- [ ] **Step 4: Verify dimensions (macOS `sips`)**

```bash
for f in 16 32 48 128; do sips -g pixelWidth -g pixelHeight packages/extension-chrome/src/icons/icon-$f.png; done
sips -g pixelWidth -g pixelHeight docs/store/chrome/promo-440x280.png
```

Expected: each icon reports `pixelWidth/Height` equal to its size; the promo reports `440 × 280`.

- [ ] **Step 5: Commit**

```bash
git add packages/extension-chrome/src/icons docs/store/chrome/promo-440x280.png packages/extension-chrome/scripts/generate-brand-assets.mjs
git -c commit.gpgsign=false commit -m "feat(extension-chrome): add brand icon set + store promo tile generator"
```

---

## Task 3: Declare icons in the manifest (TDD)

**Files:**

- Test: `packages/extension-chrome/test/manifest.test.ts`
- Modify: `packages/extension-chrome/src/manifest.json`

- [ ] **Step 1: Add the failing test** to `packages/extension-chrome/test/manifest.test.ts`, inside the existing `describe(...)` block (after the last `it`):

```ts
it('declares icons + action.default_icon (16/32/48/128) for toolbar and store', () => {
  const expected = {
    '16': 'icons/icon-16.png',
    '32': 'icons/icon-32.png',
    '48': 'icons/icon-48.png',
    '128': 'icons/icon-128.png',
  };
  expect(manifest.icons).toEqual(expected);
  expect(manifest.action.default_icon).toEqual(expected);
});
```

- [ ] **Step 2: Run the test, verify it fails**

```bash
bun run --filter @ai-dict/extension-chrome test -- manifest
```

Expected: FAIL — `manifest.icons` is `undefined`.

- [ ] **Step 3: Edit `packages/extension-chrome/src/manifest.json`**

Add a top-level `"icons"` key immediately after `"description"`:

```json
  "icons": {
    "16": "icons/icon-16.png",
    "32": "icons/icon-32.png",
    "48": "icons/icon-48.png",
    "128": "icons/icon-128.png"
  },
```

And extend the existing `"action"` block to include `default_icon`:

```json
  "action": {
    "default_title": "AI Dictionary",
    "default_icon": {
      "16": "icons/icon-16.png",
      "32": "icons/icon-32.png",
      "48": "icons/icon-48.png",
      "128": "icons/icon-128.png"
    }
  },
```

Leave `permissions`, `host_permissions`, `content_scripts`, and `content_security_policy` **unchanged**.

- [ ] **Step 4: Run the full package test suite, verify green**

```bash
bun run --filter @ai-dict/extension-chrome test
```

Expected: PASS — the new icons test plus all existing S5/S8 manifest assertions.

- [ ] **Step 5: Commit**

```bash
bunx prettier --write packages/extension-chrome/src/manifest.json packages/extension-chrome/test/manifest.test.ts
git add packages/extension-chrome/src/manifest.json packages/extension-chrome/test/manifest.test.ts
git -c commit.gpgsign=false commit -m "feat(extension-chrome): declare icons + action.default_icon in manifest"
```

---

## Task 4: Copy icons into the build output

**Files:**

- Modify: `packages/extension-chrome/esbuild.config.mjs`

- [ ] **Step 1: Edit `packages/extension-chrome/esbuild.config.mjs`** — after the three existing `await copyFile(...)` lines at the end of the file, append:

```js
await mkdir('dist/icons', { recursive: true });
for (const size of [16, 32, 48, 128]) {
  await copyFile(`src/icons/icon-${size}.png`, `dist/icons/icon-${size}.png`);
}
```

(`mkdir` and `copyFile` are already imported at the top of the file.)

- [ ] **Step 2: Build and verify the icons land in `dist`**

```bash
bun run build:chrome
ls packages/extension-chrome/dist/icons
node -e "const m=require('./packages/extension-chrome/dist/manifest.json');if(!m.icons||!m.action.default_icon)throw new Error('icons missing from built manifest');console.log('built manifest has icons OK')"
```

Expected: `icon-16.png icon-32.png icon-48.png icon-128.png` listed, then `built manifest has icons OK`.

- [ ] **Step 3: Confirm the whole package still builds + tests green**

```bash
bun run --filter @ai-dict/extension-chrome test
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
bunx prettier --write packages/extension-chrome/esbuild.config.mjs
git add packages/extension-chrome/esbuild.config.mjs
git -c commit.gpgsign=false commit -m "build(extension-chrome): copy icon set into dist"
```

---

## Task 5: Privacy policy — `PRIVACY.md`

**Files:**

- Create: `PRIVACY.md` (repo root)

- [ ] **Step 1: Create `PRIVACY.md`**

```markdown
# AI Dictionary — Privacy Policy

_Last updated: 2026-06-14_

AI Dictionary is a browser extension that looks up the meaning of a word or phrase you
select on a web page. It is designed to collect as little as possible.

## What the extension does with your data

- **Selected text + nearby context.** When you ask for a definition, the word or phrase you
  selected and a short snippet of the surrounding sentence are sent **directly from your
  browser** to the AI provider **you choose** (Google Gemini or OpenAI), authenticated with
  **your own** API key, to generate the definition. Nothing else on the page is sent.
- **Your API key and settings.** Your API key, target language, prompt template, and
  preferences are stored **locally** in your browser (`chrome.storage.local`). The key stays on
  your device and is used only by the extension's background service worker to call the
  provider. It is never sent anywhere except, as a bearer credential, to the provider you chose.
- **Lookup history and cache.** Recent lookups are stored **locally** so you can see history and
  avoid repeat calls. You can delete individual entries or clear them from the extension.

## What we do NOT do

- We operate **no server** and **no backend**. Your data never reaches us.
- We do **no analytics**, **no tracking**, and run **no ads**.
- We do **not sell or share** your data with anyone.

## Third parties

Definitions are produced by the provider you select. Your selected text and context are subject
to that provider's privacy policy:

- Google Gemini API: https://ai.google.dev/gemini-api/terms
- OpenAI API: https://openai.com/policies/privacy-policy

## Contact

Questions: open an issue at https://github.com/hieplam/ai-dict/issues
```

- [ ] **Step 2: Commit**

```bash
bunx prettier --write PRIVACY.md
git add PRIVACY.md
git -c commit.gpgsign=false commit -m "docs: add privacy policy for the Chrome Web Store listing"
```

---

## Task 6: Store listing copy — `docs/store/chrome/listing.md`

**Files:**

- Create: `docs/store/chrome/listing.md`

- [ ] **Step 1: Create `docs/store/chrome/listing.md`** (this is the canonical text the owner pastes into the dashboard):

```markdown
# Chrome Web Store listing — AI Dictionary

**Name:** AI Dictionary

**Category:** Productivity
**Language:** English

**Summary (≤132 chars):**
Select any word and get its meaning — in context, on the page — using your own Gemini or OpenAI key. No account, no tracking.

**Privacy policy URL:** https://github.com/hieplam/ai-dict/blob/master/PRIVACY.md

## Detailed description

You're reading an article and hit a word you only half-know. AI Dictionary lets you select it
and get the meaning **right on the page** — built from the word **plus the sentence around it**,
so the answer fits how the word is actually used.

Every result gives you:

- IPA pronunciation
- Part of speech
- A plain, learner-friendly English explanation
- A translation into your language (Vietnamese by default; configurable)
- An example sentence, in both languages

It runs on **your own** Google Gemini API key — or an OpenAI (ChatGPT) key; pick the provider in
Settings. There's no account, no server, and no tracking: your lookups go straight from your
browser to the provider you chose and nowhere else.

## Single purpose

Look up the meaning of a word or phrase you select on a web page, in context, using your own AI
provider API key.

## Permission justifications

- **Host access to all sites (`<all_urls>`) + content scripts:** a dictionary must read the word
  you select — and a little surrounding context — on whatever page you're reading. No remote
  code is loaded; the extension's network access is restricted by its Content Security Policy to
  the provider you chose (`generativelanguage.googleapis.com`, `api.openai.com`).
- **`storage`:** stores your API key, settings, and local lookup history/cache on your device.
- **`sidePanel`:** shows the lookup result and history in Chrome's side panel.

## Data use disclosures (Chrome Web Store form)

- **Personally identifiable information:** No.
- **Authentication information:** Yes — the user's own API key, stored locally and sent only to
  the chosen provider as a bearer credential. Not collected by the developer.
- **Website content:** Yes — the selected text + short surrounding context, sent to the chosen
  provider to generate a definition. Not stored by the developer (no server).
- Certify: data is **not** sold/transferred to third parties beyond the user-chosen provider;
  **not** used for purposes unrelated to the single purpose; **not** used for creditworthiness.

## Assets

- Store icon (128×128): `packages/extension-chrome/src/icons/icon-128.png`
- Screenshots (1280×800): `docs/store/chrome/screenshots/*.png`
- Small promo tile (440×280): `docs/store/chrome/promo-440x280.png`
```

- [ ] **Step 2: Verify the summary length is ≤132 characters**

```bash
node -e "const s='Select any word and get its meaning — in context, on the page — using your own Gemini or OpenAI key. No account, no tracking.';console.log(s.length, s.length<=132?'OK':'TOO LONG')"
```

Expected: a number `≤132` followed by `OK`.

- [ ] **Step 3: Commit**

```bash
bunx prettier --write docs/store/chrome/listing.md
git add docs/store/chrome/listing.md
git -c commit.gpgsign=false commit -m "docs(store): add Chrome Web Store listing copy + disclosures"
```

---

## Task 7: Store screenshots (1280×800) via the existing Playwright fixture

Reuse the e2e fixture (bundled Chromium + unpacked extension). Gate the spec behind an env var so normal CI runs skip it; run it explicitly to (re)generate the committed PNGs.

**Files:**

- Create: `packages/extension-chrome/e2e/store-screenshots.spec.ts`
- Generated (committed): `docs/store/chrome/screenshots/01-result-card.png`, `02-options.png`, `03-side-panel.png`

- [ ] **Step 1: Create `packages/extension-chrome/e2e/store-screenshots.spec.ts`**

```ts
import { test, expect } from './fixtures';
import { seedSettings, mockGemini, selectWord, openTrigger } from './helpers';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RUN = process.env.PLAYWRIGHT_RUN_STORE_SHOTS === '1';
const OUT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../docs/store/chrome/screenshots',
);
const SIZE = { width: 1280, height: 800 };

// A realistic article body and a rich, deterministic definition for a polished listing shot.
const ARTICLE = `<!doctype html><meta charset="utf8"><title>The Atlas</title>
<style>body{margin:0;background:#faf7f0;color:#1c2b24;font:18px/1.7 Georgia,serif}
main{max-width:680px;margin:0 auto;padding:64px 28px}h1{font-size:34px;margin:0 0 18px}</style>
<main><h1>A Voyage of the Unplanned</h1>
<p id="t">It was a fortunate stroke of <b>serendipity</b> that the two researchers, chasing
unrelated questions, met in the same dim archive and changed each other's work forever.</p></main>`;

const RICH = JSON.stringify({
  candidates: [
    {
      content: {
        parts: [
          {
            text:
              '## serendipity\n/ˌsɛr.ənˈdɪp.ɪ.ti/ · noun\n\n' +
              '**English** — the occurrence of events by chance in a happy or beneficial way.\n\n' +
              '**Tiếng Việt** — sự tình cờ may mắn.\n\n' +
              '*Example:* "A fortunate stroke of serendipity brought them together." — ' +
              '"Một sự tình cờ may mắn đã đưa họ đến với nhau."',
          },
        ],
      },
    },
  ],
});

test.describe('store screenshots (1280×800)', () => {
  test.skip(!RUN, 'set PLAYWRIGHT_RUN_STORE_SHOTS=1 to (re)generate store assets');

  test('result card on an article', async ({ context, extensionId }) => {
    await mockGemini(context, { body: RICH });
    const page = await context.newPage();
    await page.setViewportSize(SIZE);
    const setup = await page.goto(`chrome-extension://${extensionId}/options.html`);
    expect(setup?.ok()).toBeTruthy();
    await seedSettings(page, { hasKey: true, apiKey: 'AIza-demo', targetLang: 'vi' });

    await page.route('http://article.test/', (r) =>
      r.fulfill({ status: 200, contentType: 'text/html', body: ARTICLE }),
    );
    await page.goto('http://article.test/');
    await selectWord(page, 't', 'serendipity');
    await openTrigger(page);
    // Proven locator: the in-page result renders as `lookup-card` inside `bottom-sheet`
    // (see e2e/define-fix-demo.spec.ts). The RICH mock makes the card contain "serendipity".
    await expect(page.locator('bottom-sheet lookup-card')).toContainText('serendipity', {
      timeout: 10_000,
    });
    await page.waitForTimeout(400); // let the card settle
    await page.screenshot({ path: `${OUT}/01-result-card.png` });
  });

  test('options / settings page', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.setViewportSize(SIZE);
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page, { hasKey: true, apiKey: 'AIza-demo', provider: 'gemini' });
    await page.reload();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/02-options.png` });
  });

  test('side panel with a lookup', async ({ context, extensionId }) => {
    await mockGemini(context, { body: RICH });
    const seed = await context.newPage();
    await seed.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(seed, { hasKey: true, apiKey: 'AIza-demo', saveHistory: true });
    await seed.route('http://article.test/', (r) =>
      r.fulfill({ status: 200, contentType: 'text/html', body: ARTICLE }),
    );
    await seed.goto('http://article.test/');
    await selectWord(seed, 't', 'serendipity');
    await openTrigger(seed);
    await seed.waitForTimeout(800); // let the lookup persist to history

    const panel = await context.newPage();
    await panel.setViewportSize(SIZE);
    await panel.goto(`chrome-extension://${extensionId}/side-panel.html`);
    await panel.locator('side-panel-view').waitFor({ state: 'attached', timeout: 5_000 });
    await panel.waitForTimeout(400);
    await panel.screenshot({ path: `${OUT}/03-side-panel.png` });
  });
});
```

- [ ] **Step 2: Build the extension (the fixture loads `dist`), then run the spec**

```bash
bun run build:chrome
cd packages/extension-chrome && PLAYWRIGHT_RUN_STORE_SHOTS=1 HEADED=0 bunx playwright test store-screenshots && cd ../..
```

Expected: 3 passed. The element names used here (`bottom-sheet lookup-card`, `side-panel-view`, `lookup-trigger`) are the ones registered in `packages/app/src/ui/register.ts`; if a future refactor renames them, update the locators to match (never leave a locator that matches nothing).

- [ ] **Step 3: Verify the screenshots are 1280×800**

```bash
for f in 01-result-card 02-options 03-side-panel; do sips -g pixelWidth -g pixelHeight docs/store/chrome/screenshots/$f.png; done
```

Expected: each reports `1280 × 800`.

- [ ] **Step 4: Commit**

```bash
bunx prettier --write packages/extension-chrome/e2e/store-screenshots.spec.ts
git add packages/extension-chrome/e2e/store-screenshots.spec.ts docs/store/chrome/screenshots
git -c commit.gpgsign=false commit -m "test(store): generate 1280x800 store screenshots via bundled Chromium"
```

---

## Task 8: Automated publish pipeline — `release-please.yml`

**Files:**

- Modify: `package.json` (root — add the pinned CLI devDependency) + `bun.lock`
- Modify: `.github/workflows/release-please.yml`

- [ ] **Step 1: Add the pinned publisher CLI as a root devDependency**

```bash
bun add -D chrome-webstore-upload-cli@4.0.1
ls node_modules/.bin/chrome-webstore-upload
```

Expected: `bun.lock` + root `package.json` updated; the bin path prints (confirms the bin name is `chrome-webstore-upload`).

- [ ] **Step 2: Add the API-key guard step to `.github/workflows/release-please.yml`**

Insert this step **immediately before** the existing `- name: Build Chrome extension` step:

```yaml
- name: Guard — no API key baked into the release build (rule-api-key-isolation / S1)
  if: ${{ steps.release.outputs.release_created }}
  run: test -z "${GEMINI_API_KEY:-}"
```

- [ ] **Step 3: Expose the extension ID at job level (so the publish `if` can read it)**

In the same file, add an `env:` block to the `release-please` job — directly under `runs-on: ubuntu-latest`, as a sibling of `permissions:`:

```yaml
env:
  CWS_EXTENSION_ID: ${{ secrets.CWS_EXTENSION_ID }}
```

- [ ] **Step 4: Add the publish step at the end of the job**

Append after the existing `- name: Upload dist-chrome.zip to the release` step:

```yaml
- name: Publish to Chrome Web Store
  # Skips (does not fail) until the four CWS_* secrets are configured, so releases still
  # attach dist-chrome.zip before store setup is done. v4 CLI: omitting the `upload`
  # subcommand uploads AND publishes; auth comes from CLIENT_ID/CLIENT_SECRET/REFRESH_TOKEN.
  if: ${{ steps.release.outputs.release_created && env.CWS_EXTENSION_ID != '' }}
  env:
    CLIENT_ID: ${{ secrets.CWS_CLIENT_ID }}
    CLIENT_SECRET: ${{ secrets.CWS_CLIENT_SECRET }}
    REFRESH_TOKEN: ${{ secrets.CWS_REFRESH_TOKEN }}
  run: ./node_modules/.bin/chrome-webstore-upload --source dist-chrome.zip --extension-id "$CWS_EXTENSION_ID"
```

- [ ] **Step 5: Validate the workflow YAML + formatting**

```bash
bun run format:check   # prettier parses the YAML; malformed YAML fails here
node -e "const y=require('fs').readFileSync('.github/workflows/release-please.yml','utf8');if(!/Publish to Chrome Web Store/.test(y)||!/CWS_EXTENSION_ID/.test(y))throw new Error('workflow edit missing');console.log('workflow edit present')"
# Optional deeper lint if installed (not required — prettier already parsed the YAML):
command -v actionlint >/dev/null && actionlint .github/workflows/release-please.yml || echo 'actionlint not installed — skipping'
```

Expected: `format:check` clean; `workflow edit present`; actionlint passes if installed (else skipped).

- [ ] **Step 6: Commit**

```bash
bunx prettier --write .github/workflows/release-please.yml package.json
git add .github/workflows/release-please.yml package.json bun.lock
git -c commit.gpgsign=false commit -m "ci(release): publish to Chrome Web Store on each release (guarded)"
```

---

## Task 9: Owner runbook — `docs/runbooks/chrome-web-store.md`

**Files:**

- Create: `docs/runbooks/chrome-web-store.md`

- [ ] **Step 1: Create `docs/runbooks/chrome-web-store.md`**

````markdown
# Runbook — publishing AI Dictionary to the Chrome Web Store

One-time setup the repo owner performs. After it's done, every `release-please` release
uploads + publishes itself (`.github/workflows/release-please.yml` → "Publish to Chrome Web
Store"). All four `CWS_*` secrets must exist or that step **skips**.

## 1. Developer account (one-time, ~$5)

1. Go to the Chrome Web Store Developer Dashboard: https://chrome.google.com/webstore/devconsole
2. Pay the one-time US$5 registration fee and complete identity verification.

## 2. Build the first package

```bash
bun run build:chrome
cd packages/extension-chrome/dist && zip -r ../../../dist-chrome.zip . && cd ../../..
```

(Or download `dist-chrome.zip` from any GitHub Release.)

## 3. Create the item + fill the listing

1. Dashboard → **Add new item** → upload `dist-chrome.zip`.
2. Fill the listing from `docs/store/chrome/listing.md`: summary, description, **Productivity**
   category, English language, **store icon** (`packages/extension-chrome/src/icons/icon-128.png`),
   **screenshots** (`docs/store/chrome/screenshots/*.png`), **promo tile**
   (`docs/store/chrome/promo-440x280.png`), and the **privacy policy URL**
   (`https://github.com/hieplam/ai-dict/blob/master/PRIVACY.md`).
3. Complete the **Privacy practices / data use** form using the answers in `listing.md`.
4. **Save draft.** Copy the **Item ID** (the long `a…p` id) — this is `CWS_EXTENSION_ID`.

## 4. OAuth credentials (so CI can publish)

1. Google Cloud Console → create/choose a project → **APIs & Services → Library** → enable
   **Chrome Web Store API**.
2. **OAuth consent screen** → User type **External** → fill the minimum fields.
   - ⚠️ **Set Publishing status to "In production"** (Audience tab). A consent screen left in
     **Testing** issues refresh tokens that **expire after 7 days**, which would silently break
     CI publishing every week. This app only calls the Chrome Web Store API for your own account,
     so no Google verification is needed to go to production.
3. **Credentials → Create credentials → OAuth client ID → Desktop app.** Copy the
   **Client ID** (`CWS_CLIENT_ID`) and **Client secret** (`CWS_CLIENT_SECRET`).

## 5. Generate a refresh token (one-time)

Canonical guide for this CLI family:
https://github.com/fregante/chrome-webstore-upload/blob/main/How-to-generate-Google-API-keys.md

Quickest path — Google's OAuth 2.0 Playground (https://developers.google.com/oauthplayground):

1. Click the gear (⚙) → check **Use your own OAuth credentials** → paste the **Client ID** +
   **Client secret** from step 4.
2. In "Input your own scopes", enter `https://www.googleapis.com/auth/chromewebstore` →
   **Authorize APIs** → approve with the Google account that owns the dev dashboard.
3. **Exchange authorization code for tokens** → copy the **Refresh token** → `CWS_REFRESH_TOKEN`.

Because the consent screen is **In production** (step 4), this refresh token does not expire after
7 days.

## 6. Add the GitHub secrets

Repo → **Settings → Secrets and variables → Actions → New repository secret**, four times:

| Secret              | Value                     |
| ------------------- | ------------------------- |
| `CWS_EXTENSION_ID`  | the Item ID from step 3   |
| `CWS_CLIENT_ID`     | OAuth Client ID           |
| `CWS_CLIENT_SECRET` | OAuth Client secret       |
| `CWS_REFRESH_TOKEN` | refresh token from step 5 |

## 7. Publish

- **v1:** once the listing is complete in the dashboard, click **Submit for review** (or let the
  next release's CI step publish it). Google review takes hours–days; the first review of a new
  item with broad host permissions takes longest.
- **Every release after:** merge the `release-please` PR → the workflow uploads the new version
  and publishes it automatically. (The Web Store rejects re-uploading an existing version;
  `release-please` bumps the version every release, so this is always satisfied.)

## 8. Verify + finish

- Confirm the listing is live and install it from the store on a clean profile; set your API key
  in Settings; look up a word.
- Update `README.md`'s Install section with the live "Add to Chrome" URL (replace the interim
  note added in this PR).
````

- [ ] **Step 2: Commit**

```bash
bunx prettier --write docs/runbooks/chrome-web-store.md
git add docs/runbooks/chrome-web-store.md
git -c commit.gpgsign=false commit -m "docs(runbook): one-time Chrome Web Store setup + OAuth secrets"
```

---

## Task 10: Update RELEASE_CHECKLIST.md and README.md

**Files:**

- Modify: `RELEASE_CHECKLIST.md`
- Modify: `README.md`

- [ ] **Step 1: Edit `RELEASE_CHECKLIST.md`** — replace the manual Chrome line under "## Store submission (manual at MVP)". Change:

```markdown
## Store submission (manual at MVP)

- [ ] Chrome Web Store: drag-drop `dist-chrome.zip`.
```

to:

```markdown
## Store submission

- [ ] Chrome Web Store: **automated** — `release-please.yml` uploads + publishes the new version
      once the four `CWS_*` secrets are set (one-time setup: `docs/runbooks/chrome-web-store.md`).
      Confirm the "Publish to Chrome Web Store" job step succeeded for the release tag.
```

(Leave the App Store / iOS line unchanged — it remains the follow-up.)

- [ ] **Step 2: Edit `README.md`** — under the `## Install (Chrome)` heading, add a one-line interim note directly beneath the existing `> [!NOTE]` block (no dead link until the listing is live):

```markdown
> **One-click install via the Chrome Web Store is on the way.** Until the listing is approved,
> use the manual steps below. (Maintainers: publish steps are in `docs/runbooks/chrome-web-store.md`.)
```

- [ ] **Step 3: Verify + commit**

```bash
bunx prettier --write RELEASE_CHECKLIST.md README.md
bun run format:check
git add RELEASE_CHECKLIST.md README.md
git -c commit.gpgsign=false commit -m "docs: mark Chrome publishing automated; note Web Store install is coming"
```

---

## Task 11: C3 finalize — codemap, Parent Delta, ADR → implemented

**Files:**

- `.c3/` (via CLI only)

- [ ] **Step 1: Re-run lookups on touched paths; map-or-exclude the uncharted ones**

```bash
c3() { C3X_MODE=agent bash /Users/home/.claude/skills/c3/bin/c3x.sh "$@"; }
for p in packages/extension-chrome/esbuild.config.mjs packages/extension-chrome/test/manifest.test.ts \
         packages/extension-chrome/src/icons/icon.svg packages/extension-chrome/scripts/generate-brand-assets.mjs \
         packages/extension-chrome/e2e/store-screenshots.spec.ts .github/workflows/release-please.yml \
         README.md RELEASE_CHECKLIST.md PRIVACY.md 'docs/store/**' 'docs/runbooks/**'; do
  echo "== $p =="; c3 lookup "$p"; done
c3 set --help   # confirm the exact codemap field/pattern syntax for this CLI build
```

For paths C3 reports as uncharted that belong to the Chrome package (`esbuild.config.mjs`,
`test/manifest.test.ts`, `src/icons/*`, `scripts/generate-brand-assets.mjs`,
`e2e/store-screenshots.spec.ts`), add them to **c3-2**'s codemap. For repo-level, non-component
paths (`.github/workflows/*`, `README.md`, `RELEASE_CHECKLIST.md`, `PRIVACY.md`, `docs/**`),
add them to the codemap **exclude** list. Use the exact `c3 set c3-2 codemap …` / exclude syntax
printed by `c3 set --help`, following any `help[]` hints.

- [ ] **Step 2: Record the Parent Delta in the ADR**

Confirm c3-2's `Components`/`Responsibilities` need no change (icons are packaging metadata under
the already-listed "MV3 `manifest.json` … esbuild bundle"). Note this **no-delta** in the ADR:

```bash
echo "Parent Delta: no-delta. c3-2 already owns manifest.json + the esbuild bundle; this change adds icon packaging metadata and a guarded CI publish step — no new component, no responsibility change." | \
  c3 write adr-20260614-chrome-web-store-publish --section "Parent Delta"
```

(If `c3 schema adr` named the section differently, use that name.)

- [ ] **Step 3: Transition the ADR to implemented and validate**

```bash
c3 set adr-20260614-chrome-web-store-publish status implemented
c3 check
c3 check --include-adr
```

Expected: both `c3 check` runs report no errors.

- [ ] **Step 4: Commit**

```bash
git add .c3/
git -c commit.gpgsign=false commit -m "docs(c3): chart new paths, record no-delta, mark ADR implemented"
```

---

## Final verification (run before opening the PR)

- [ ] **All tests + lint + format green**

```bash
bun run lint
bun test
bun run format:check
```

Expected: dependency-direction gate passes, ESLint clean, all vitest suites pass, prettier clean.

- [ ] **Build is store-shaped**

```bash
bun run build:chrome
ls packages/extension-chrome/dist/icons   # four PNGs
```

- [ ] **Manual smoke (load unpacked in a _bundled_ Chromium, not installed Google Chrome):** load `packages/extension-chrome/dist`, confirm the toolbar shows the new icon, open Settings, paste a real key, look up a word on a real page, confirm the card renders. (Per the repo guardrail, drive standalone Chromium for any extension screenshotting.)

- [ ] **Open the PR** with Before/After evidence + a short recording of `bun run build:chrome` producing the icon'd zip and the guarded publish step in the workflow. Host evidence on a `pr-assets/chrome-web-store` branch; reference it with `https://github.com/hieplam/ai-dict/raw/pr-assets/chrome-web-store/<path>` (same-origin, private-repo requirement). End the PR body with the standard Claude Code line.

---

## Notes for the executor

- **Out of scope (do not do here):** iOS/Safari App Store publishing; Microsoft Edge Add-ons / Firefox AMO; cleaning up the dead tag-triggered `release.yml`; any change to extension runtime behavior, permissions, or the key boundary.
- **Owner-gated (cannot be done in this PR):** creating the dev account, the first listing/App ID, OAuth secrets. Those live in the Task 9 runbook; the publish step stays dormant (skips) until the secrets exist, so merging this PR is safe.
- The Task 7 locators (`bottom-sheet lookup-card`, `side-panel-view`, `lookup-trigger`) are the real registered element names (`packages/app/src/ui/register.ts`); they only need changing if a future refactor renames them — never commit a screenshot spec whose locator matches nothing.

```

```
