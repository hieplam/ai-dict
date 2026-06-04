# Chrome Extension E2E Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the two ad-hoc Playwright specs into a maintainable, two-tier Chrome e2e suite that covers the real lookup flow, its error states, cache/history behavior, settings, the side panel, selection UX, and light/dark theme rendering — built on one shared fixture.

**Architecture:** One Playwright `test.extend` fixture (worker-scoped persistent context + extension id, plus an auto per-test storage reset) replaces the duplicated `beforeAll` blocks. Specs split into **Tier 1** (extension-context: options, side-panel, storage, theme — runs everywhere) and **Tier 2** (real content-script → service-worker flow — auto-skips unless `PLAYWRIGHT_RUN_LOOKUP_E2E=1`, exactly as CI runs today under `xvfb`).

**Tech Stack:** TypeScript, Playwright (`@playwright/test`), Bun, MV3 Chrome extension (esbuild bundle in `dist/`).

---

## ⚠️ ADDENDUM (2026-06-04 spike results — these OVERRIDE the gating below)

Two throwaway spikes were run on macOS against the built `dist/` with **bundled
Chromium, headful** (`headless:false`, no `channel`):

1. **Content-script → service-worker round-trip WORKS locally.** The cache-hit flow
   (select → Define → card renders) passed. The original `lookup.spec.ts` skip was
   **stale** — it does not reproduce on Playwright 1.60 / current Chromium.
2. **`context.route` intercepts the service worker's Gemini fetch.** The cache-miss
   flow (faked Gemini via `context.route` → card renders) passed and the route
   counter incremented. Task 7's SW-`self.fetch`-stub fallback is therefore **not
   needed**; use `mockGemini(context, …)` everywhere.

**Consequences for implementation (follow these, not the Tier-2 gating text):**

- **No `requireRealChromeFlow()` / `test.skip()` gating.** Every spec runs in both
  local dev and CI. Headless is the default via Chromium's NEW headless mode
  (`--headless=new` in the fixture launch args); pass `HEADED=1` to watch a window.
  Only the OLD headless mode (`headless:true`) is unsupported — it cannot register
  the MV3 service worker — so the fixture keeps Playwright `headless:false` and opts
  into new headless via the arg.
- Drop `requireRealChromeFlow` from `fixtures.ts` and every spec's first line.
- `mockGemini` uses `context.route` (confirmed). Keep it.
- Real Chrome via `channel:'chrome'` does **not** work on macOS (Chrome ≥137 blocks
  `--load-extension` even with the workaround flag) — so the optional
  `PLAYWRIGHT_CHROME_CHANNEL` path is dropped; bundled Chromium is the only browser.
- Run command for the full suite, everywhere: `bunx playwright test` (no env flags).

The Tier-1/Tier-2 split below is retained only as _documentation of which surface
each spec exercises_; it no longer implies any skip behavior.

## Decisions locked (resolved §8 open items from the design)

These were verified against the code during planning. The engineer does **not** need to re-investigate.

1. **History UI does not exist.** `options.ts` only fires a `history.clear` runtime message; there is no history page. The cache/history spec therefore asserts against **storage keys** (`history:<uuid>`, index `history:index`), never a UI.
2. **Side-panel states are driven directly.** `side-panel.ts` listens on `chrome.runtime.onMessage`, accepts a message only when `sender.id === chrome.runtime.id` **and** `msg.to === 'side-panel'`, then maps `{state:'loading'|'result'|'error', payload}` onto the card via its `state` setter. A Playwright **extension page** calling `chrome.runtime.sendMessage({to:'side-panel', state, payload})` satisfies the guard and is delivered to the open `side-panel.html` page. No service worker round-trip needed → Tier 1.
3. **Tier-2 gate = `PLAYWRIGHT_RUN_LOOKUP_E2E=1`.** CI runs bundled Chromium **headful under `xvfb`** with that env var (`.github/workflows/ci.yml:195,209`). There is no real-Chrome `channel` in CI. We keep that gate and additionally honor an optional `PLAYWRIGHT_CHROME_CHANNEL` env (e.g. `chrome`) so a developer with real Chrome can run Tier 2 locally. No fragile filesystem auto-detection.
4. **The Gemini fetch happens in the service worker, not the page.** `sw.ts` constructs `GeminiLookupClient({ fetch:(u,i)=>fetch(u,i) })`; the network call originates in the SW scope. Therefore `page.route` will **not** intercept it. The cache-miss Tier-2 test uses `context.route` (primary) with an SW-level `self.fetch` stub via `serviceWorker.evaluate` as a verified fallback (Task 7, Step 1 is a spike that picks the working one).

## Verified constants (assert against these exact values)

- **Gemini endpoint host glob:** `https://generativelanguage.googleapis.com/**`
- **Gemini OK body:** `{ candidates: [{ content: { parts: [{ text: '## bank\nA financial institution.' }] } }] }`
- **`sanitizeMarkdown('## bank\nA financial institution.')`** renders an `<h2>bank</h2>` + `<p>A financial institution.</p>`; the card therefore contains the text **`financial institution`**.
- **Canonical lookup fixture:** word `bank`, sentence `The bank by the river is steep.`, target `vi`.
- **Cache key for that fixture:** `fbf304968493913a` (verified: `fnv1a64Hex('bank|The bank by the river is steep.|vi')`). Stored at `cache:fbf304968493913a`; LRU index at `cache:index`.
- **History keys:** each entry at `history:<uuid>`; index newest-first at `history:index`.
- **Exact error → card text** (from `packages/core/src/error-mapper.ts`):

  | Mock trigger                                          | `error.message` shown in card                 |
  | ----------------------------------------------------- | --------------------------------------------- |
  | settings with `apiKey:''` (no key)                    | `Add your Gemini API key in Settings.`        |
  | `route.abort('failed')` (offline)                     | `Network failed. Check connection and retry.` |
  | HTTP 401 / 403                                        | `Google rejected the API key.`                |
  | HTTP 400 + body `{error:{status:'INVALID_ARGUMENT'}}` | `Google rejected the API key.`                |
  | HTTP 429                                              | `Hit Gemini rate limit.`                      |
  | HTTP ≥ 500                                            | `Gemini server error. Retry.`                 |
  | HTTP 200 + non-JSON / empty-text body                 | `Gemini returned unexpected output.`          |

- **Card DOM:** result → `<h2>{word}</h2>` + `<div>{html}</div>`; error → `<h2>Lookup failed</h2>` + `<p class="err">{message}</p>`; loading → text `Looking up…`.
- **Card host text color** (`lookup-card.ts`) and **trigger button color** (`lookup-trigger.ts`) are both pinned to `#202124` → computed `rgb(32, 33, 36)`.
- **Inline (content-script) card selector:** `bottom-sheet lookup-card`. **Side-panel card selector:** `lookup-card` (in `side-panel.html`).

## File structure

```
packages/extension-chrome/e2e/
  fixtures.ts            ← NEW: test.extend (worker context + extensionId), auto storage reset, Tier-2 gate
  helpers.ts            ← NEW: seedSettings, mockGemini, gotoFixture, selectWord, openTrigger, storageDump
  settings.spec.ts      ← REWRITE onto fixture (Tier 1) + key/lang/defaults cases
  theme.spec.ts         ← NEW (Tier 1): Define button + result card visible in light AND dark
  side-panel.spec.ts    ← NEW (Tier 1): loading/result/error states + guards
  lookup.spec.ts        ← REWRITE onto fixture (Tier 2): cache hit, cache miss, repeat-from-cache
  lookup-errors.spec.ts ← NEW (Tier 2): table-driven error → card text
  cache-history.spec.ts ← NEW (Tier 2): cache off, history write, saveHistory:false, index update
  selection.spec.ts     ← NEW (Tier 2): collapsed→no trigger, phrase→trigger, dismiss→re-select
  fixtures/page.html    ← unchanged
```

---

## Task 0: Branch & build prerequisite

**Files:** none created; environment only.

- [ ] **Step 1: Confirm branch and clean tree**

Run: `git branch --show-current && git status --porcelain`
Expected: branch is `e2e-coverage-expansion`; no uncommitted changes (the design doc is already committed).

- [ ] **Step 2: Build the extension dist (specs load `../dist`)**

Run: `bun run --filter @ai-dict/extension-chrome build`
Expected: `packages/extension-chrome/dist/` contains `sw.js`, `content.js`, `content-elements.js`, `options.html`, `side-panel.html`, `manifest.json`.

- [ ] **Step 3: Baseline the current suite (must stay green)**

Run: `cd packages/extension-chrome && bunx playwright test`
Expected: `settings.spec.ts` (2 tests) PASS; `lookup.spec.ts` shows **1 skipped** (the env flag is unset locally). Record this as the baseline.

---

## Task 1: Shared fixture (`fixtures.ts`)

This is the load-bearing harness. It launches one persistent context per worker, finds the extension id, resets storage before each test, and exposes the Tier-2 gate. Built on Playwright's documented Chrome-extension fixture pattern (worker-scoped `context` + `extensionId`).

**Files:**

- Create: `packages/extension-chrome/e2e/fixtures.ts`

- [ ] **Step 1: Write a smoke spec that exercises the fixture**

Create a temporary spec to prove the fixture launches and resets storage. It will be deleted in Step 5.

Create `packages/extension-chrome/e2e/_fixture-smoke.spec.ts`:

```ts
import { test, expect } from './fixtures';

test('fixture exposes an extension id and a working extension page', async ({
  context,
  extensionId,
}) => {
  expect(extensionId).toMatch(/^[a-p]{32}$/); // MV3 extension ids are 32 chars a–p
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await page.waitForSelector('settings-form');
  await page.close();
});

test('auto storage reset clears data left by a prior test', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  // The beforeEach reset should have wiped anything seeded earlier.
  const dump = await page.evaluate(() => chrome.storage.local.get(null));
  expect(Object.keys(dump)).toHaveLength(0);
  await page.close();
});
```

- [ ] **Step 2: Run it to verify it fails (module missing)**

Run: `cd packages/extension-chrome && bunx playwright test e2e/_fixture-smoke.spec.ts`
Expected: FAIL — `Cannot find module './fixtures'`.

- [ ] **Step 3: Implement `fixtures.ts`**

```ts
import { test as base, expect, chromium, type BrowserContext } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { E2E_HEADLESS } from '../playwright.config';

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');

/**
 * Worker-scoped Chrome-extension fixture (Playwright's documented pattern).
 * One persistent context per worker; `extensionId` resolved from the registered SW.
 * An auto per-test hook resets chrome.storage.local so cache/history/settings never
 * leak between tests (the persistent context shares storage across the whole worker).
 */
export const test = base.extend<{ context: BrowserContext; extensionId: string }>({
  context: [
    async ({}, use) => {
      const context = await chromium.launchPersistentContext('', {
        // Optional real-Chrome channel for local Tier-2 runs; undefined = bundled Chromium.
        channel: process.env.PLAYWRIGHT_CHROME_CHANNEL || undefined,
        // Headless only under xvfb (CI sets PLAYWRIGHT_HEADLESS=1); see playwright.config.ts.
        headless: E2E_HEADLESS,
        args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
      });
      await use(context);
      await context.close();
    },
    { scope: 'worker' },
  ],
  extensionId: [
    async ({ context }, use) => {
      let [sw] = context.serviceWorkers();
      if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 10_000 });
      await use(new URL(sw.url()).hostname);
    },
    { scope: 'worker' },
  ],
});

// Reset extension storage before EVERY test (applies to all specs importing this `test`).
test.beforeEach(async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await page.evaluate(() => chrome.storage.local.clear());
  await page.close();
});

export { expect };

/**
 * Tier-2 gate. The content-script → service-worker round-trip only completes under a
 * headful real Chrome build: CI runs bundled Chromium headful under xvfb with
 * PLAYWRIGHT_RUN_LOOKUP_E2E=1; locally a developer may instead set PLAYWRIGHT_CHROME_CHANNEL.
 */
export const REAL_CHROME_FLOW =
  process.env.PLAYWRIGHT_RUN_LOOKUP_E2E === '1' || Boolean(process.env.PLAYWRIGHT_CHROME_CHANNEL);

export function requireRealChromeFlow(): void {
  test.skip(
    !REAL_CHROME_FLOW,
    'Content-script → SW round-trip only runs under headful real Chrome (set PLAYWRIGHT_RUN_LOOKUP_E2E=1 under xvfb, or PLAYWRIGHT_CHROME_CHANNEL locally)',
  );
}
```

- [ ] **Step 4: Run the smoke spec to verify it passes**

Run: `cd packages/extension-chrome && bunx playwright test e2e/_fixture-smoke.spec.ts`
Expected: both tests PASS (the context launches; storage dump is empty after reset).

- [ ] **Step 5: Delete the smoke spec and commit the fixture**

```bash
rm packages/extension-chrome/e2e/_fixture-smoke.spec.ts
git add packages/extension-chrome/e2e/fixtures.ts
git commit -m "test(e2e): add shared Chrome-extension fixture with per-test storage reset"
```

---

## Task 2: Reusable helpers (`helpers.ts`)

**Files:**

- Create: `packages/extension-chrome/e2e/helpers.ts`

- [ ] **Step 1: Write a temporary helper smoke spec**

Create `packages/extension-chrome/e2e/_helpers-smoke.spec.ts`:

```ts
import { test, expect } from './fixtures';
import { seedSettings, storageDump } from './helpers';

test('seedSettings writes a settings object with the given overrides', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page, { targetLang: 'en', cacheEnabled: false });
  const dump = await storageDump(page);
  expect((dump.settings as { targetLang: string }).targetLang).toBe('en');
  expect((dump.settings as { cacheEnabled: boolean }).cacheEnabled).toBe(false);
  expect((dump.settings as { apiKey: string }).apiKey).toBe('AIza-test'); // default kept
  await page.close();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/extension-chrome && bunx playwright test e2e/_helpers-smoke.spec.ts`
Expected: FAIL — `Cannot find module './helpers'`.

- [ ] **Step 3: Implement `helpers.ts`**

```ts
import type { Page, BrowserContext } from '@playwright/test';

export const GEMINI_GLOB = 'https://generativelanguage.googleapis.com/**';

/** Default OK Gemini body for the canonical "bank" fixture. */
export const GEMINI_OK_BODY = JSON.stringify({
  candidates: [{ content: { parts: [{ text: '## bank\nA financial institution.' }] } }],
});

export interface SettingsOverrides {
  targetLang?: string;
  promptTemplate?: string;
  apiKey?: string;
  cacheEnabled?: boolean;
  saveHistory?: boolean;
  hasKey?: boolean;
}

/** Write a full settings object to storage. Overrides merge onto sensible defaults. */
export async function seedSettings(page: Page, overrides: SettingsOverrides = {}): Promise<void> {
  await page.evaluate((o) => {
    return chrome.storage.local.set({
      settings: {
        targetLang: 'vi',
        promptTemplate: 'Define {word}',
        apiKey: 'AIza-test',
        cacheEnabled: true,
        saveHistory: true,
        hasKey: true,
        ...o,
      },
    });
  }, overrides);
}

/** Read the entire extension storage as a plain object. */
export async function storageDump(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => chrome.storage.local.get(null) as Promise<Record<string, unknown>>);
}

export interface MockGeminiOpts {
  status?: number;
  body?: string;
  headers?: Record<string, string>;
  abort?: boolean; // route.abort('failed') to simulate offline
}

/**
 * Fake the Gemini endpoint and count hits. Routes on the CONTEXT (not the page) because the
 * real fetch originates in the extension's service worker, which page.route cannot intercept.
 * Returns a live counter object: read `.count` after the flow completes.
 */
export async function mockGemini(
  context: BrowserContext,
  opts: MockGeminiOpts = {},
): Promise<{ count: number }> {
  const calls = { count: 0 };
  await context.route(GEMINI_GLOB, async (route) => {
    calls.count++;
    if (opts.abort) {
      await route.abort('failed');
      return;
    }
    await route.fulfill({
      status: opts.status ?? 200,
      contentType: 'application/json',
      headers: opts.headers ?? {},
      body: opts.body ?? GEMINI_OK_BODY,
    });
  });
  return calls;
}

/** Navigate to a synthetic http page so the content script injects on <all_urls>. */
export async function gotoFixture(
  page: Page,
  paragraph = 'The bank by the river is steep.',
): Promise<void> {
  await page.route('http://test.fixture/', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: `<html><body><p id="t">${paragraph}</p></body></html>`,
    }),
  );
  await page.goto('http://test.fixture/');
}

/** Make a deterministic, non-collapsed selection over `word` inside `#${id}` and dispatch mouseup. */
export async function selectWord(page: Page, id: string, word: string): Promise<void> {
  await page.evaluate(
    ({ id, word }) => {
      const p = document.getElementById(id)!;
      const textNode = p.firstChild!;
      const text = textNode.textContent ?? '';
      const start = text.indexOf(word);
      const range = document.createRange();
      range.setStart(textNode, start);
      range.setEnd(textNode, start + word.length);
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    },
    { id, word },
  );
}

/** Wait for the floating trigger and click it. */
export async function openTrigger(page: Page): Promise<void> {
  await page.locator('lookup-trigger').waitFor({ state: 'attached', timeout: 5_000 });
  await page.locator('lookup-trigger').click();
}
```

- [ ] **Step 4: Run the helper smoke spec to verify it passes**

Run: `cd packages/extension-chrome && bunx playwright test e2e/_helpers-smoke.spec.ts`
Expected: PASS.

- [ ] **Step 5: Delete the smoke spec and commit**

```bash
rm packages/extension-chrome/e2e/_helpers-smoke.spec.ts
git add packages/extension-chrome/e2e/helpers.ts
git commit -m "test(e2e): add reusable e2e helpers (seedSettings, mockGemini, selectWord)"
```

---

## Task 3: Settings spec on the fixture (Tier 1)

Rewrite the existing `settings.spec.ts` onto the shared fixture and add key/lang/defaults coverage. These run everywhere (extension-context only).

**Files:**

- Modify (rewrite): `packages/extension-chrome/e2e/settings.spec.ts`

- [ ] **Step 1: Replace the file contents**

```ts
import { test, expect } from './fixtures';
import { seedSettings, storageDump } from './helpers';

test('persists settings to storage and reloads them on the options page', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page, { apiKey: 'AIza-testkey' });
  await page.reload();
  await page.waitForSelector('settings-form');
  const stored = await page.evaluate(async () => {
    const { settings } = (await chrome.storage.local.get('settings')) as {
      settings: { apiKey: string };
    };
    return settings.apiKey;
  });
  expect(stored).toBe('AIza-testkey');
});

test('chrome.storage.local.clear empties stored settings', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page);
  await page.evaluate(() => chrome.storage.local.clear());
  const dump = await storageDump(page);
  expect(dump.settings).toBeUndefined();
});

test('options page applies defaults when storage is empty', async ({ context, extensionId }) => {
  // beforeEach already cleared storage; options.ts should fall back to DEFAULTS.
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await page.waitForSelector('settings-form');
  // The form should reflect the default target language 'vi' without any stored settings.
  const targetLang = await page.evaluate(() => {
    const form = document.querySelector('settings-form') as unknown as {
      value: { targetLang: string };
    };
    return form.value.targetLang;
  });
  expect(targetLang).toBe('vi');
});

test('targetLang round-trips through storage', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page, { targetLang: 'en' });
  const dump = await storageDump(page);
  expect((dump.settings as { targetLang: string }).targetLang).toBe('en');
});
```

> Note for Step 1: the `settings-form.value` getter shape is assumed from `options.ts:toFormValue`. If the custom element exposes `value` differently, adjust the "defaults" test to read `chrome.storage.local` instead. Confirm by reading `packages/shared-ui/src/settings-form.ts` before running.

- [ ] **Step 2: Run the spec**

Run: `cd packages/extension-chrome && bunx playwright test e2e/settings.spec.ts`
Expected: 4 tests PASS.

- [ ] **Step 3: Sanity — confirm a test can fail**

Temporarily change `expect(stored).toBe('AIza-testkey')` to `toBe('WRONG')`, run the first test, confirm it FAILS, then revert.

- [ ] **Step 4: Commit**

```bash
git add packages/extension-chrome/e2e/settings.spec.ts
git commit -m "test(e2e): migrate settings spec to fixture, add defaults/lang coverage"
```

---

## Task 4: Theme spec — Define button + result card visible in light AND dark (Tier 1)

This is the explicit dark-theme requirement. It is a **real-browser regression guard** for the historical bug where the trigger button had no explicit text color and turned (near-)white on dark-theme pages. The content script auto-injects `content-elements.js` on `<all_urls>`, registering `<lookup-trigger>`/`<lookup-card>` in the page's MAIN world, so we can instantiate and measure them with no service-worker messaging → Tier 1, runs everywhere.

**Files:**

- Create: `packages/extension-chrome/e2e/theme.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from './fixtures';
import { gotoFixture } from './helpers';

// Both components pin text color #202124 → computed rgb(32, 33, 36). The regression: the
// trigger button previously inherited the system color, which goes (near-)white under a dark
// theme and vanished on its white background. Asserting the explicit value under dark
// emulation fails if anyone removes the color pin.
const PINNED = 'rgb(32, 33, 36)';

async function waitForElements(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForFunction(
    () => !!customElements.get('lookup-trigger') && !!customElements.get('lookup-card'),
    null,
    { timeout: 10_000 },
  );
}

for (const scheme of ['light', 'dark'] as const) {
  test(`Define button label stays visible in ${scheme} theme`, async ({ context }) => {
    const page = await context.newPage();
    await page.emulateMedia({ colorScheme: scheme });
    await gotoFixture(page);
    await waitForElements(page);

    const { label, color } = await page.evaluate(() => {
      const el = document.createElement('lookup-trigger');
      document.body.append(el);
      const btn = (el as HTMLElement).shadowRoot!.querySelector('button')!;
      return { label: btn.textContent, color: getComputedStyle(btn).color };
    });

    expect(label).toBe('Define');
    expect(color).toBe(PINNED);
    await page.close();
  });

  test(`result card text stays visible in ${scheme} theme`, async ({ context }) => {
    const page = await context.newPage();
    await page.emulateMedia({ colorScheme: scheme });
    await gotoFixture(page);
    await waitForElements(page);

    const { text, color } = await page.evaluate(() => {
      const card = document.createElement('lookup-card');
      document.body.append(card);
      // Drive the card via its public state setter (same world as the page).
      (card as unknown as { state: unknown }).state = {
        kind: 'result',
        safeHtml: '<p>A financial institution.</p>',
        word: 'bank',
        target: 'vi',
      };
      return { text: (card as HTMLElement).textContent, color: getComputedStyle(card).color };
    });

    expect(text).toContain('financial institution');
    expect(color).toBe(PINNED);
    await page.close();
  });
}
```

- [ ] **Step 2: Run the spec**

Run: `cd packages/extension-chrome && bunx playwright test e2e/theme.spec.ts`
Expected: 4 tests PASS (button + card, each in light + dark).

- [ ] **Step 3: Prove it guards the real regression**

Temporarily edit `packages/shared-ui/src/lookup-trigger.ts` to delete `color:#202124` from the `button{…}` rule, rebuild (`bun run --filter @ai-dict/extension-chrome build`), and run the dark button test:
Run: `cd packages/extension-chrome && bunx playwright test e2e/theme.spec.ts -g "Define button label stays visible in dark"`
Expected: FAIL (computed color is no longer `rgb(32, 33, 36)`). **Revert the edit and rebuild.**

- [ ] **Step 4: Commit**

```bash
git add packages/extension-chrome/e2e/theme.spec.ts
git commit -m "test(e2e): assert Define button and result card stay visible in light and dark theme"
```

---

## Task 5: Side-panel spec (Tier 1)

Drive the side-panel card by broadcasting runtime messages from an extension page. Verifies loading/result/error rendering, the malformed-payload guard, and the foreign-sender guard.

**Files:**

- Create: `packages/extension-chrome/e2e/side-panel.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from './fixtures';

// Open side-panel.html as a normal tab, then post {to:'side-panel', state, payload} from a
// SECOND extension page. chrome.runtime.sendMessage broadcasts to other extension contexts;
// side-panel.ts accepts it (sender.id === runtime.id) and maps it onto the card.
async function openPanelAndSender(
  context: import('@playwright/test').BrowserContext,
  extensionId: string,
) {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/side-panel.html`);
  await panel.waitForSelector('lookup-card');
  const sender = await context.newPage();
  await sender.goto(`chrome-extension://${extensionId}/options.html`);
  return { panel, sender };
}

test('renders a result delivered via runtime message', async ({ context, extensionId }) => {
  const { panel, sender } = await openPanelAndSender(context, extensionId);
  await sender.evaluate(() =>
    chrome.runtime.sendMessage({
      to: 'side-panel',
      state: 'result',
      payload: { markdown: '## bank\nA financial institution.', word: 'bank', target: 'vi' },
    }),
  );
  await expect(panel.locator('lookup-card')).toContainText('financial institution', {
    timeout: 5_000,
  });
});

test('renders the loading state', async ({ context, extensionId }) => {
  const { panel, sender } = await openPanelAndSender(context, extensionId);
  await sender.evaluate(() => chrome.runtime.sendMessage({ to: 'side-panel', state: 'loading' }));
  await expect(panel.locator('lookup-card')).toContainText('Looking up', { timeout: 5_000 });
});

test('renders an error state', async ({ context, extensionId }) => {
  const { panel, sender } = await openPanelAndSender(context, extensionId);
  await sender.evaluate(() =>
    chrome.runtime.sendMessage({
      to: 'side-panel',
      state: 'error',
      payload: {
        code: 'NO_KEY',
        message: 'Add your Gemini API key in Settings.',
        retryable: false,
      },
    }),
  );
  await expect(panel.locator('lookup-card')).toContainText('Add your Gemini API key in Settings.', {
    timeout: 5_000,
  });
});

test('ignores a malformed result payload (guard) and keeps prior content', async ({
  context,
  extensionId,
}) => {
  const { panel, sender } = await openPanelAndSender(context, extensionId);
  // First a valid result, then a malformed one — the card must keep the valid content.
  await sender.evaluate(() =>
    chrome.runtime.sendMessage({
      to: 'side-panel',
      state: 'result',
      payload: { markdown: '## ok\nFirst valid content.', word: 'ok', target: 'vi' },
    }),
  );
  await expect(panel.locator('lookup-card')).toContainText('First valid content.', {
    timeout: 5_000,
  });
  await sender.evaluate(() =>
    chrome.runtime.sendMessage({ to: 'side-panel', state: 'result', payload: { not: 'a result' } }),
  );
  // Give the listener a tick; content must NOT change.
  await panel.waitForTimeout(300);
  await expect(panel.locator('lookup-card')).toContainText('First valid content.');
});
```

> Note: `chrome.runtime.sendMessage` from one extension page is delivered to other extension contexts but **not** back to the sender. The panel and sender are separate pages, so delivery is correct. If a message is ever observed reaching the SW instead, that is fine — the SW ignores `{to:'side-panel'}` payloads (its router only handles typed `WireMessage`s).

- [ ] **Step 2: Run the spec**

Run: `cd packages/extension-chrome && bunx playwright test e2e/side-panel.spec.ts`
Expected: 4 tests PASS.

- [ ] **Step 3: If delivery does not occur (fallback)**

If the result/loading/error tests time out (message not delivered page→page in this build), switch the sender to drive the panel via the service worker instead: replace `sender.evaluate(...)` with a `context.serviceWorkers()[0].evaluate(...)` that calls `chrome.runtime.sendMessage(...)`. Document whichever path works in a one-line comment at the top of the file.

- [ ] **Step 4: Commit**

```bash
git add packages/extension-chrome/e2e/side-panel.spec.ts
git commit -m "test(e2e): cover side-panel render states and payload/sender guards"
```

---

## Task 6: Lookup spec on the fixture (Tier 2)

Rewrite `lookup.spec.ts` onto the fixture: keep the cache-hit flow, add cache-miss (covered in Task 7 spike-dependent form is here too), and repeat-from-cache. **Tier 2 — auto-skips locally.**

**Files:**

- Modify (rewrite): `packages/extension-chrome/e2e/lookup.spec.ts`

- [ ] **Step 1: Write the cache-hit test (no Gemini call)**

```ts
import { test, expect, requireRealChromeFlow } from './fixtures';
import { seedSettings, gotoFixture, selectWord, openTrigger } from './helpers';

const CACHE_KEY = 'fbf304968493913a'; // fnv1a64Hex('bank|The bank by the river is steep.|vi')

test('cache hit: selecting "bank" renders the cached result without a network call', async ({
  context,
  extensionId,
}) => {
  requireRealChromeFlow();
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page);
  await page.evaluate((key) => {
    const result = {
      markdown: '## bank\nA financial institution.',
      word: 'bank',
      target: 'vi',
      model: 'gemini-2.5-flash',
      fromCache: false,
      fetchedAt: 1,
    };
    return chrome.storage.local.set({
      [`cache:${key}`]: JSON.stringify(result),
      'cache:index': JSON.stringify([{ key, atime: 1 }]),
    });
  }, CACHE_KEY);

  await gotoFixture(page);
  await page.waitForTimeout(1_000); // let the content workflow initialise
  await selectWord(page, 't', 'bank');
  await openTrigger(page);
  await expect(page.locator('bottom-sheet lookup-card')).toContainText('financial institution', {
    timeout: 10_000,
  });
});
```

- [ ] **Step 2: Run locally — verify it SKIPS**

Run: `cd packages/extension-chrome && bunx playwright test e2e/lookup.spec.ts`
Expected: 1 skipped (no `PLAYWRIGHT_RUN_LOOKUP_E2E`).

- [ ] **Step 3: Run under the flag — verify it PASSES**

Run: `cd packages/extension-chrome && PLAYWRIGHT_RUN_LOOKUP_E2E=1 xvfb-run -a bunx playwright test e2e/lookup.spec.ts`
(On macOS without xvfb, set `PLAYWRIGHT_CHROME_CHANNEL=chrome` and drop `xvfb-run` if real Chrome is installed.)
Expected: 1 PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/extension-chrome/e2e/lookup.spec.ts
git commit -m "test(e2e): migrate lookup cache-hit flow onto the shared fixture"
```

---

## Task 7: Cache-miss + repeat-from-cache (Tier 2) — with Gemini-interception spike

The real "click Define → Gemini called → render" path. **The fetch is in the service worker**, so this task first determines how to intercept it, then writes the tests.

**Files:**

- Modify: `packages/extension-chrome/e2e/lookup.spec.ts` (append tests)

- [ ] **Step 1: SPIKE — confirm how to fake the SW's Gemini call**

Write a throwaway test that seeds settings with a key, no cache, mocks Gemini via `context.route`, runs a lookup, and checks the route counter:

```ts
test('SPIKE: does context.route intercept the SW Gemini fetch?', async ({
  context,
  extensionId,
}) => {
  requireRealChromeFlow();
  const calls = await mockGemini(context); // from helpers
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page); // has key, cacheEnabled true, but no cache entry seeded
  await gotoFixture(page);
  await page.waitForTimeout(1_000);
  await selectWord(page, 't', 'bank');
  await openTrigger(page);
  await expect(page.locator('bottom-sheet lookup-card')).toContainText('financial institution', {
    timeout: 10_000,
  });
  expect(calls.count).toBeGreaterThanOrEqual(1); // <-- proves context.route saw the SW fetch
});
```

Run: `cd packages/extension-chrome && PLAYWRIGHT_RUN_LOOKUP_E2E=1 xvfb-run -a bunx playwright test e2e/lookup.spec.ts -g SPIKE`

- If `calls.count >= 1` and the card renders → **use `context.route` (`mockGemini`)** for the real tests below. Delete the SPIKE test.
- If the card renders but `calls.count === 0` (interception missed the SW), switch to the **SW fetch stub**: before the lookup, run

  ```ts
  const [sw] = context.serviceWorkers();
  await sw.evaluate(() => {
    // @ts-expect-error patch the SW's global fetch
    self.fetch = async () =>
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: '## bank\nA financial institution.' }] } }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
  });
  ```

  Record the chosen approach in a comment at the top of the appended block.

- [ ] **Step 2: Write the cache-miss test (uses the approach chosen in Step 1)**

```ts
test('cache miss: clicking Define calls the (faked) Gemini server and renders the result', async ({
  context,
  extensionId,
}) => {
  requireRealChromeFlow();
  const calls = await mockGemini(context); // OR the SW fetch stub from Step 1
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page); // key present, cache enabled, NO cache entry
  await gotoFixture(page);
  await page.waitForTimeout(1_000);
  await selectWord(page, 't', 'bank');
  await openTrigger(page);
  await expect(page.locator('bottom-sheet lookup-card')).toContainText('financial institution', {
    timeout: 10_000,
  });
  expect(calls.count).toBe(1); // exactly one network call on a cold cache
});
```

- [ ] **Step 3: Write the repeat-from-cache test**

```ts
test('second lookup of the same word is served from cache (no extra network call)', async ({
  context,
  extensionId,
}) => {
  requireRealChromeFlow();
  const calls = await mockGemini(context);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page);
  await gotoFixture(page);
  await page.waitForTimeout(1_000);

  await selectWord(page, 't', 'bank');
  await openTrigger(page);
  await expect(page.locator('bottom-sheet lookup-card')).toContainText('financial institution', {
    timeout: 10_000,
  });

  // Dismiss and look up the same word again — should hit cache, not the network.
  await page.reload();
  await gotoFixture(page);
  await page.waitForTimeout(1_000);
  await selectWord(page, 't', 'bank');
  await openTrigger(page);
  await expect(page.locator('bottom-sheet lookup-card')).toContainText('financial institution', {
    timeout: 10_000,
  });
  expect(calls.count).toBe(1); // still only one network call total
});
```

> Add the missing imports at the top of `lookup.spec.ts`: `import { seedSettings, gotoFixture, selectWord, openTrigger, mockGemini } from './helpers';`

- [ ] **Step 4: Run under the flag**

Run: `cd packages/extension-chrome && PLAYWRIGHT_RUN_LOOKUP_E2E=1 xvfb-run -a bunx playwright test e2e/lookup.spec.ts`
Expected: cache-hit + cache-miss + repeat-from-cache all PASS; SPIKE deleted.

- [ ] **Step 5: Commit**

```bash
git add packages/extension-chrome/e2e/lookup.spec.ts
git commit -m "test(e2e): cover cache-miss Gemini call and repeat-from-cache"
```

---

## Task 8: Error-state spec (Tier 2, table-driven)

One parametrised test per error mapping, asserting the exact card text. Table-driven to stay DRY.

**Files:**

- Create: `packages/extension-chrome/e2e/lookup-errors.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect, requireRealChromeFlow } from './fixtures';
import { seedSettings, gotoFixture, selectWord, openTrigger, mockGemini } from './helpers';
import type { MockGeminiOpts, SettingsOverrides } from './helpers';

interface Case {
  name: string;
  settings?: SettingsOverrides;
  mock?: MockGeminiOpts;
  expected: string;
}

const CASES: Case[] = [
  {
    name: 'no API key',
    settings: { apiKey: '', hasKey: false },
    expected: 'Add your Gemini API key in Settings.',
  },
  {
    name: 'offline / aborted',
    mock: { abort: true },
    expected: 'Network failed. Check connection and retry.',
  },
  { name: 'HTTP 401', mock: { status: 401, body: '{}' }, expected: 'Google rejected the API key.' },
  {
    name: 'HTTP 400 INVALID_ARGUMENT',
    mock: { status: 400, body: JSON.stringify({ error: { status: 'INVALID_ARGUMENT' } }) },
    expected: 'Google rejected the API key.',
  },
  { name: 'HTTP 429', mock: { status: 429, body: '{}' }, expected: 'Hit Gemini rate limit.' },
  { name: 'HTTP 500', mock: { status: 500, body: '{}' }, expected: 'Gemini server error. Retry.' },
  {
    name: 'malformed body',
    mock: { status: 200, body: 'not json' },
    expected: 'Gemini returned unexpected output.',
  },
];

for (const c of CASES) {
  test(`error: ${c.name} → "${c.expected}"`, async ({ context, extensionId }) => {
    requireRealChromeFlow();
    if (c.mock) await mockGemini(context, c.mock);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page, c.settings);
    await gotoFixture(page);
    await page.waitForTimeout(1_000);
    await selectWord(page, 't', 'bank');
    await openTrigger(page);
    await expect(page.locator('bottom-sheet lookup-card')).toContainText(c.expected, {
      timeout: 10_000,
    });
  });
}
```

> If Task 7's spike chose the SW fetch stub over `context.route`, replace `mockGemini(context, c.mock)` here with an equivalent SW `self.fetch` stub that returns the case's status/body. Keep the table; only swap the faking mechanism.

- [ ] **Step 2: Run locally — verify all SKIP**

Run: `cd packages/extension-chrome && bunx playwright test e2e/lookup-errors.spec.ts`
Expected: 7 skipped.

- [ ] **Step 3: Run under the flag — verify all PASS**

Run: `cd packages/extension-chrome && PLAYWRIGHT_RUN_LOOKUP_E2E=1 xvfb-run -a bunx playwright test e2e/lookup-errors.spec.ts`
Expected: 7 PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/extension-chrome/e2e/lookup-errors.spec.ts
git commit -m "test(e2e): table-driven error-state coverage with exact card text"
```

---

## Task 9: Cache & history spec (Tier 2)

Asserts the storage side-effects of a lookup: cache-disabled hits the network every time; a successful lookup writes a `history:` entry; `saveHistory:false` writes none; the `cache:index` is updated on a cache-miss write.

**Files:**

- Create: `packages/extension-chrome/e2e/cache-history.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect, requireRealChromeFlow } from './fixtures';
import {
  seedSettings,
  gotoFixture,
  selectWord,
  openTrigger,
  mockGemini,
  storageDump,
} from './helpers';

async function doLookup(page: import('@playwright/test').Page): Promise<void> {
  await gotoFixture(page);
  await page.waitForTimeout(1_000);
  await selectWord(page, 't', 'bank');
  await openTrigger(page);
  await expect(page.locator('bottom-sheet lookup-card')).toContainText('financial institution', {
    timeout: 10_000,
  });
}

test('cacheEnabled:false hits the network on every lookup', async ({ context, extensionId }) => {
  requireRealChromeFlow();
  const calls = await mockGemini(context);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page, { cacheEnabled: false });
  await doLookup(page);
  await page.reload();
  await doLookup(page);
  expect(calls.count).toBe(2); // no caching → two calls
});

test('a successful lookup writes a history entry when saveHistory is true', async ({
  context,
  extensionId,
}) => {
  requireRealChromeFlow();
  await mockGemini(context);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page, { saveHistory: true });
  await doLookup(page);
  const dump = await storageDump(page);
  const historyKeys = Object.keys(dump).filter(
    (k) => k.startsWith('history:') && k !== 'history:index',
  );
  expect(historyKeys.length).toBeGreaterThanOrEqual(1);
  expect(dump['history:index']).toBeDefined();
});

test('saveHistory:false writes no history entry', async ({ context, extensionId }) => {
  requireRealChromeFlow();
  await mockGemini(context);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page, { saveHistory: false });
  await doLookup(page);
  const dump = await storageDump(page);
  const historyKeys = Object.keys(dump).filter((k) => k.startsWith('history:'));
  expect(historyKeys).toHaveLength(0);
});

test('a cache-miss write updates cache:index', async ({ context, extensionId }) => {
  requireRealChromeFlow();
  await mockGemini(context);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page, { cacheEnabled: true });
  await doLookup(page);
  const dump = await storageDump(page);
  expect(dump['cache:fbf304968493913a']).toBeDefined();
  const index = JSON.parse(dump['cache:index'] as string) as { key: string }[];
  expect(index.some((e) => e.key === 'fbf304968493913a')).toBe(true);
});
```

- [ ] **Step 2: Run under the flag**

Run: `cd packages/extension-chrome && PLAYWRIGHT_RUN_LOOKUP_E2E=1 xvfb-run -a bunx playwright test e2e/cache-history.spec.ts`
Expected: 4 PASS. (Locally: 4 skipped.)

- [ ] **Step 3: Commit**

```bash
git add packages/extension-chrome/e2e/cache-history.spec.ts
git commit -m "test(e2e): cover cache toggle and history write side-effects"
```

---

## Task 10: Selection UX spec (Tier 2)

Asserts the trigger appears only for a real selection and supports phrase selection and re-selection.

**Files:**

- Create: `packages/extension-chrome/e2e/selection.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect, requireRealChromeFlow } from './fixtures';
import { seedSettings, gotoFixture, selectWord, openTrigger, mockGemini } from './helpers';

test('a collapsed selection shows no trigger', async ({ context, extensionId }) => {
  requireRealChromeFlow();
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page);
  await gotoFixture(page);
  await page.waitForTimeout(1_000);
  // Collapse the caret and dispatch mouseup — defaultReader returns null for isCollapsed.
  await page.evaluate(() => {
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await page.waitForTimeout(500);
  await expect(page.locator('lookup-trigger')).toHaveCount(0);
});

test('a multi-word phrase selection shows a trigger and renders a result', async ({
  context,
  extensionId,
}) => {
  requireRealChromeFlow();
  await mockGemini(context);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page);
  await gotoFixture(page, 'The river bank is steep here.');
  await page.waitForTimeout(1_000);
  await selectWord(page, 't', 'river bank');
  await openTrigger(page);
  await expect(page.locator('bottom-sheet lookup-card')).toContainText('financial institution', {
    timeout: 10_000,
  });
});

test('dismiss then re-select shows the trigger again', async ({ context, extensionId }) => {
  requireRealChromeFlow();
  await mockGemini(context);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page);
  await gotoFixture(page);
  await page.waitForTimeout(1_000);

  await selectWord(page, 't', 'bank');
  await page.locator('lookup-trigger').waitFor({ state: 'attached', timeout: 5_000 });

  // Collapse to dismiss, then re-select.
  await page.evaluate(() => {
    window.getSelection()!.removeAllRanges();
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await selectWord(page, 't', 'bank');
  await openTrigger(page);
  await expect(page.locator('bottom-sheet lookup-card')).toContainText('financial institution', {
    timeout: 10_000,
  });
});
```

> Note: the phrase test relies on `selectWord` finding `'river bank'` as a contiguous substring in the fixture paragraph — the helper uses `indexOf`, so the paragraph passed to `gotoFixture` must contain that exact phrase. The cache key differs from `bank`'s; that is fine because Gemini is mocked.

- [ ] **Step 2: Run under the flag**

Run: `cd packages/extension-chrome && PLAYWRIGHT_RUN_LOOKUP_E2E=1 xvfb-run -a bunx playwright test e2e/selection.spec.ts`
Expected: 3 PASS. (Locally: 3 skipped.)

- [ ] **Step 3: Commit**

```bash
git add packages/extension-chrome/e2e/selection.spec.ts
git commit -m "test(e2e): cover selection trigger behaviour (collapsed, phrase, re-select)"
```

---

## Task 11: Convenience script, CI note & docs

**Files:**

- Modify: `packages/extension-chrome/package.json`
- Create: `packages/extension-chrome/e2e/README.md`
- Modify: `README.md` (repo root, e2e row only — read it first to match the table format)

- [ ] **Step 1: Add Tier-1 convenience scripts**

In `packages/extension-chrome/package.json` `scripts`, add alongside the existing `"e2e": "playwright test"`:

```json
    "e2e:tier1": "playwright test settings.spec.ts theme.spec.ts side-panel.spec.ts",
    "e2e:full": "PLAYWRIGHT_RUN_LOOKUP_E2E=1 playwright test"
```

- [ ] **Step 2: Verify the Tier-1 script runs everything that should run locally**

Run: `cd packages/extension-chrome && bun run e2e:tier1`
Expected: settings (4) + theme (4) + side-panel (4) all PASS, no skips.

- [ ] **Step 3: Write `e2e/README.md`**

```markdown
# Chrome extension e2e tests

Two tiers, built on a shared fixture (`fixtures.ts`).

## Tier 1 — runs everywhere (`bun run e2e:tier1`)

Extension-context only (options, side panel, storage, theme). No service-worker
round-trip required, so it runs under Playwright's bundled Chromium locally.

- `settings.spec.ts` — persist/clear/defaults/lang
- `theme.spec.ts` — Define button + result card stay visible in light AND dark
- `side-panel.spec.ts` — render states + payload/sender guards

## Tier 2 — real content-script → service-worker flow

The select → Define → Gemini → card flow only completes under a **headful real
Chrome** build. It auto-skips unless one of these is set:

- `PLAYWRIGHT_RUN_LOOKUP_E2E=1` — CI sets this and runs bundled Chromium headful
  under `xvfb` (`bun run e2e:full` mirrors it locally on Linux).
- `PLAYWRIGHT_CHROME_CHANNEL=chrome` — use a locally installed real Chrome.

Specs: `lookup.spec.ts`, `lookup-errors.spec.ts`, `cache-history.spec.ts`, `selection.spec.ts`.

Gemini is **always faked** (`mockGemini` via `context.route`, or an SW `self.fetch`
stub — see the comment at the top of `lookup.spec.ts`). No real network call is ever made.
```

- [ ] **Step 4: Update the root README e2e row**

Read `README.md`, find the e2e/testing row, and update it to mention the two tiers and that Tier 2 needs `PLAYWRIGHT_RUN_LOOKUP_E2E=1` (xvfb in CI) or `PLAYWRIGHT_CHROME_CHANNEL`. Match the existing table/markdown style exactly — do not reformat other rows.

- [ ] **Step 5: Confirm CI needs no change**

`.github/workflows/ci.yml` `e2e-chrome` already builds the dist, installs Chromium, and runs `xvfb-run -a bunx playwright test` with `PLAYWRIGHT_RUN_LOOKUP_E2E=1`. It discovers the new specs automatically. No edit required — note this in the commit body.

- [ ] **Step 6: Commit**

```bash
git add packages/extension-chrome/package.json packages/extension-chrome/e2e/README.md README.md
git commit -m "docs(e2e): add tier scripts and document the two-tier Chrome e2e suite"
```

---

## Final verification

- [ ] **Tier 1 everywhere:** `cd packages/extension-chrome && bun run e2e:tier1` → all PASS, no skips.
- [ ] **Full suite locally:** `cd packages/extension-chrome && bunx playwright test` → Tier 1 PASS; Tier 2 (lookup, lookup-errors, cache-history, selection) **skipped**.
- [ ] **Full suite gated:** `cd packages/extension-chrome && PLAYWRIGHT_RUN_LOOKUP_E2E=1 xvfb-run -a bunx playwright test` (Linux) **or** `PLAYWRIGHT_CHROME_CHANNEL=chrome bunx playwright test` (macOS w/ real Chrome) → everything PASS.
- [ ] **Typecheck unaffected:** `cd packages/extension-chrome && bun run typecheck` → clean.

---

## Self-review (run by author against the design)

**1. Spec coverage** — design §4 settings → Task 3; §4 side-panel → Task 5; §5 lookup (hit/miss/repeat) → Tasks 6–7; §5 lookup-errors → Task 8; §5 cache-history → Task 9; §5 selection → Task 10; §2 harness/fixture → Task 1; §3 helpers → Task 2; §6 CI/docs → Task 11. **Added** `theme.spec.ts` (Task 4) to honor the user's explicit dark-theme requirement, which the design did not separately enumerate. Visual/screenshot regression and Safari remain out of scope (§7).

**2. Placeholder scan** — every step has runnable code or an exact command + expected output. The two genuinely environment-dependent decisions (SW Gemini interception in Task 7; page→page side-panel delivery in Task 5) are written as a spike with both branches spelled out, not as "TBD".

**3. Type/name consistency** — `seedSettings`, `mockGemini(context,…)`, `gotoFixture`, `selectWord(page,id,word)`, `openTrigger`, `storageDump`, `requireRealChromeFlow`, `GEMINI_GLOB`, `GEMINI_OK_BODY`, `REAL_CHROME_FLOW` are defined in Tasks 1–2 and used with those exact signatures throughout. `MockGeminiOpts`/`SettingsOverrides` are exported from `helpers.ts` and imported in Task 8.

**Open risks flagged for the implementer (not blockers):**

- [risk] Task 7 SW-fetch interception: if neither `context.route` nor the `self.fetch` stub works under the CI build, escalate — the cache-miss network assertion is the one place a real environment limit could bite. The card-render assertion still holds via the stub.
- [scope] `theme.spec.ts` is an addition beyond the committed design. If the user wants the suite to match the design exactly, drop Task 4 — but they explicitly named light/dark theme as a main case, so it is included by default.
