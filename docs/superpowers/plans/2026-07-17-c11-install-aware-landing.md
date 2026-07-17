# C11 Install-Aware Landing Page Implementation Plan

> **For agentic workers:** implement task-by-task, TDD (red → green → commit) per task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** the landing page (`docs/index.html`, served at <https://hieplam.github.io/ai-dict/>)
adapts its hero CTA and `#start` checklist for a visitor who already has the extension installed —
"Install ✓ — next: add your key" once installed but keyless, "All set ✓ — you're ready to read"
once a key is configured — using a minimal, non-sensitive marker (`data-ad-dict-installed` /
`data-ad-dict-version` / `data-ad-dict-ready`) the extension's own already-running content script
stamps on `<html>`, landing-origin only.

**Architecture:** three small, independent pieces. (1) A new pure adapter,
`packages/extension-chrome/src/adapters/landing-marker.ts` (`c3-201` chrome-adapters) — origin
detection + two DOM-write helpers, unit-tested. (2) One gated block added to the existing
`packages/extension-chrome/src/content.ts` composition root (`c3-211` chrome-content-script),
reusing the settings fetch it already performs on every page load. (3) Static markup/CSS/script
additions to `docs/index.html`, entirely client-side, no build step. **Zero changes** to
`packages/app/src/wire.ts`, `packages/app/src/app/router.ts`, `packages/app/src/ports.ts`, or
`packages/extension-chrome/src/manifest.json` — see the design spec §2 for why none of the three
pieces need them. Full design rationale, including every rejected alternative:
`docs/superpowers/specs/2026-07-17-c11-install-aware-landing-design.md`.

**Tech Stack:** TypeScript (adapter + content script), Vitest + happy-dom (unit), Playwright (e2e),
plain ES5 inline JS (the landing page itself — matches its existing zero-build-step convention).

## Global Constraints

- Implementer: dispatch each task to the `hunter` subagent — never a generic implementer.
- Start in a fresh git worktree under `.claude/worktrees/` on branch `feature/C11InstallAwareLanding`.
- Commit subject convention for every task in this plan:
  `[C11InstallAwareLanding] feat: <task summary> (C11)`. No `Co-Authored-By` trailer, no
  attribution footer.
- `bun run lint` and `bun run format:check` green before every commit; per-package
  `bun run typecheck` green after every task that touches TypeScript (Tasks 1–2).
- **No wire message is added by this card** — there is nothing to put in `wire.ts`/`router.ts`, and
  the "wire arm + router case = ONE task" rule does not apply here.
- The e2e build must clear any ambient `GEMINI_API_KEY`
  (`GEMINI_API_KEY= bun run build:chrome`) before Task 4's Playwright run — a baked-in env key
  changes onboarding-adjacent behavior elsewhere in the same build the e2e run shares (C10's
  documented flake, `docs/ROADMAP.md` §4 C10); this card's own scenarios don't touch onboarding but
  the shared `dist/` build must still be deterministic.
- **E2e must never fetch the live landing page.** Task 4's spec intercepts
  `https://hieplam.github.io/ai-dict/**` with `page.route(...)` and fulfills a local fixture —
  never a real network request.
- UI reads only `--ad-*`/`--adp-*` design tokens (no hard-coded colors); no new
  transition/animation is introduced, so there is nothing to gate behind
  `prefers-reduced-motion`.
- S1: the marker never carries the API key, only `PublicSettings.hasKey` (a boolean already
  wire-safe today). S4 does not apply — this card renders no model output.
- `docs/index.html`'s new inline script is written in plain ES5 (`var`, `function` — no
  `const`/`let`/arrow functions), matching every existing inline script in that file exactly (zero
  ES6+ syntax anywhere in the file today — confirmed by grep in the design spec §1).
- `.c3/` is CLI-only — this card changes no architecture (new file lands inside the existing
  `c3-201 chrome-adapters` component boundary), so no change-unit task is needed.
- PR: title `[C11InstallAwareLanding] Install-aware landing page`; no `.github/
PULL_REQUEST_TEMPLATE` file exists in this repo (verified 2026-07-17) — the required body element
  is a written **"Testing performed"** section (suites, counts, e2e scenarios, gates), no
  screenshots or video (owner ruling 2026-07-16).
- Merge: **regular merge commit only — squash prohibited** (owner ruling 2026-07-16).
- **Concurrency:** `docs/index.html` is also touched by C3's (unimplemented) spec/plan. Per the
  design spec §8, coordinate with whoever owns C3's dispatch — merge one PR, rebase the other —
  before opening this card's PR if both are in flight at the same time.

---

### Task 1: `landing-marker.ts` — pure adapter + unit tests

**Files:**

- Create: `packages/extension-chrome/src/adapters/landing-marker.ts`
- Create: `packages/extension-chrome/src/adapters/landing-marker.test.ts`

**Interfaces:**

```ts
export const LANDING_ORIGIN: string;
export const LANDING_PATH_PREFIX: string;
export function isLandingPage(loc: Pick<Location, 'origin' | 'pathname'>): boolean;
export function stampInstallMarker(root: HTMLElement, version: string): void;
export function stampReadyMarker(root: HTMLElement, ready: boolean): void;
```

- [ ] **Step 1: Write the failing tests.** Create
      `packages/extension-chrome/src/adapters/landing-marker.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  LANDING_ORIGIN,
  LANDING_PATH_PREFIX,
  isLandingPage,
  stampInstallMarker,
  stampReadyMarker,
} from './landing-marker';

describe('landing-marker (C11)', () => {
  describe('isLandingPage', () => {
    it('is true for the exact landing origin + path prefix', () => {
      expect(isLandingPage({ origin: LANDING_ORIGIN, pathname: LANDING_PATH_PREFIX })).toBe(true);
    });

    it('is true for a deeper path under the prefix', () => {
      expect(
        isLandingPage({ origin: LANDING_ORIGIN, pathname: `${LANDING_PATH_PREFIX}index.html` }),
      ).toBe(true);
    });

    it('is false for a different origin', () => {
      expect(isLandingPage({ origin: 'https://example.com', pathname: LANDING_PATH_PREFIX })).toBe(
        false,
      );
    });

    it('is false for a different path prefix on the same origin', () => {
      expect(isLandingPage({ origin: LANDING_ORIGIN, pathname: '/other-repo/' })).toBe(false);
    });

    it('is false for a non-HTTPS scheme on the same host', () => {
      expect(
        isLandingPage({ origin: 'http://hieplam.github.io', pathname: LANDING_PATH_PREFIX }),
      ).toBe(false);
    });
  });

  describe('stampInstallMarker', () => {
    it('sets both the installed flag and the exact version string on any root element', () => {
      const root = document.createElement('div');
      stampInstallMarker(root, '1.8.0');
      expect(root.getAttribute('data-ad-dict-installed')).toBe('true');
      expect(root.getAttribute('data-ad-dict-version')).toBe('1.8.0');
    });
  });

  describe('stampReadyMarker', () => {
    it('stamps the string "true" when ready is true', () => {
      const root = document.createElement('div');
      stampReadyMarker(root, true);
      expect(root.getAttribute('data-ad-dict-ready')).toBe('true');
    });

    it('stamps the string "false" when ready is false', () => {
      const root = document.createElement('div');
      stampReadyMarker(root, false);
      expect(root.getAttribute('data-ad-dict-ready')).toBe('false');
    });
  });
});
```

Run: `cd packages/extension-chrome && bunx vitest run src/adapters/landing-marker.test.ts`
Expected: failure — `./landing-marker` does not exist yet (module resolution error).

- [ ] **Step 2: Implement.** Create `packages/extension-chrome/src/adapters/landing-marker.ts`:

```ts
/** C11: the landing page (docs/index.html, served at https://hieplam.github.io/ai-dict/) is a
 * normal <all_urls> page content.ts already runs on. These three pure helpers are the entire
 * marker surface: detect that origin, and stamp/read three non-sensitive attributes on <html> so
 * the static page can adapt its checklist/CTA. See design spec §2 for the full rationale. */

export const LANDING_ORIGIN = 'https://hieplam.github.io';
export const LANDING_PATH_PREFIX = '/ai-dict/';

/** True only for the real landing origin+path prefix — never spoofable by page content. */
export function isLandingPage(loc: Pick<Location, 'origin' | 'pathname'>): boolean {
  return loc.origin === LANDING_ORIGIN && loc.pathname.startsWith(LANDING_PATH_PREFIX);
}

/** Stamp "the extension is here" + its version. Called unconditionally once isLandingPage() is
 * true — never carries settings, a key, or any other user data (S1 + the card's own fence). */
export function stampInstallMarker(root: HTMLElement, version: string): void {
  root.setAttribute('data-ad-dict-installed', 'true');
  root.setAttribute('data-ad-dict-version', version);
}

/** Stamp the one additional boolean the fence allows: "has the reader finished setup?" Derived
 * from PublicSettings.hasKey (packages/app/src/domain/types.ts:172) — never the key itself. */
export function stampReadyMarker(root: HTMLElement, ready: boolean): void {
  root.setAttribute('data-ad-dict-ready', String(ready));
}
```

Run: `cd packages/extension-chrome && bunx vitest run src/adapters/landing-marker.test.ts`
Expected: all 8 tests pass.

- [ ] **Step 3: Commit** — gate, then commit:

```
cd packages/extension-chrome && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

Commit:

```
git add packages/extension-chrome/src/adapters/landing-marker.ts packages/extension-chrome/src/adapters/landing-marker.test.ts
git commit -m "[C11InstallAwareLanding] feat: add landing-marker pure adapter + unit tests (C11)"
```

---

### Task 2: `content.ts` — wire the landing-marker stamping

**Files:**

- Modify: `packages/extension-chrome/src/content.ts`

No dedicated unit test exists for `content.ts` in this repo — it is a composition root, excluded
from the coverage-gate include list (`packages/extension-chrome/vitest.config.ts:23-28`), matching
the exact precedent set by C2's own plan for `options.ts` ("No dedicated unit test exists for
`options.ts` in this repo — it is a composition root, covered by e2e only",
`docs/superpowers/plans/2026-07-16-c2-verified-activation.md` Task 2). This task's correctness is
proven by Task 4's e2e; still run the typecheck gate below at the end so a regression in existing
behavior (theming, save/status listeners, etc. — all in the same file) is caught immediately.

- [ ] **Step 1: Implement.** In `packages/extension-chrome/src/content.ts`:

1. Add the import alongside the existing adapter imports (`content.ts:14-16`):

```ts
import { ChromeFloatingTrigger } from './adapters/chrome-floating-trigger';
import { MessageRelaySettingsStore } from './adapters/message-relay-settings-store';
import { ChromeSidePanelMirror } from './adapters/chrome-side-panel-mirror';
import { isLandingPage, stampInstallMarker, stampReadyMarker } from './adapters/landing-marker';
```

2. Replace the single seed line (currently `content.ts:38`):

```ts
void themedSettings.get().catch(() => undefined); // seed before the first lookup; light until known
```

with:

```ts
const initialSettings = themedSettings.get();
void initialSettings.catch(() => undefined); // seed before the first lookup; light until known

// C11: install-aware landing page — stamp a minimal, non-sensitive marker (install + version +
// setup-finished) on <html> so docs/index.html's checklist/CTA can adapt. Landing origin only
// (see design spec §2.2); only PublicSettings.hasKey (a boolean, S1-safe — never the key itself)
// crosses into the marker. See design spec §2.4 for why this does not live-update later.
if (isLandingPage(location)) {
  stampInstallMarker(document.documentElement, chrome.runtime.getManifest().version);
  void initialSettings
    .then((s) => stampReadyMarker(document.documentElement, s.hasKey))
    .catch(() => undefined);
}
```

No other line in `content.ts` changes.

Run:

```
cd packages/extension-chrome && bun run typecheck
```

Expected: clean (no type errors).

- [ ] **Step 2: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd ../extension-chrome && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

Commit:

```
git add packages/extension-chrome/src/content.ts
git commit -m "[C11InstallAwareLanding] feat: wire landing-marker stamping into content.ts (C11)"
```

---

### Task 3: `docs/index.html` — checklist/CTA markup, CSS, and adaptation script

**Files:**

- Modify: `docs/index.html`

Static content with no build step and no existing test harness (confirmed in the design spec §6.3,
matching the identical precedent already set for this file by C3's own design spec §5.4). This
task's behavior is proven by Task 4's e2e (which runs the real script against a local fixture) plus
a manual check below; there is no red/green unit step for this task.

- [ ] **Step 1: Hero CTA gains an id.** In `docs/index.html`, find the hero's primary CTA anchor
      (`docs/index.html:996-1002`) and add `id="hero-cta"`:

```html
<a
  class="btn btn-primary"
  id="hero-cta"
  href="https://chromewebstore.google.com/detail/ai-dictionary/ipnmjhndmlkbhnifhmbknjjomdocgkeg"
  data-i18n="hero-cta-primary"
>
  Add to Chrome, it’s free
</a>
```

- [ ] **Step 2: Add the hidden status line inside `#start`.** Right after `#start`'s `<h2>`
      (`docs/index.html:1478-1479`), before the existing `<ol class="steps">`:

```html
<section id="start" class="reveal">
  <p class="eyebrow" data-i18n="start-eyebrow">Two minutes, once</p>
  <h2 data-i18n="start-h2">Get started</h2>
  <p class="start-status" id="start-status" hidden></p>
  <ol class="steps"></ol>
</section>
```

- [ ] **Step 3: Add the CSS.** In the existing `<style>` block, insert `.start-status` right after
      the `.steps p` rule (`docs/index.html:850-854`), before the `/* FAQ */` comment:

```css
.start-status {
  display: inline-block;
  margin: 4px 0 20px;
  padding: 8px 14px;
  border-radius: 999px;
  font: 600 var(--adp-text-sm) / 1.3 var(--adp-font-sans);
  background: var(--ad-accent-soft);
  color: var(--ad-ink);
  border: 1px solid var(--ad-accent);
}
```

Insert `.btn[aria-disabled='true']` right after the existing `.btn-quiet` rule
(`docs/index.html:420-424`), before `.privacy-line`:

```css
.btn[aria-disabled='true'] {
  opacity: 0.72;
  cursor: default;
  pointer-events: none;
}
```

- [ ] **Step 4: Add the adaptation script.** Append a new `<script>` block right before `</body>`
      (after the existing i18n IIFE's closing `</script>` at `docs/index.html:1863`):

```html
<!-- ====================== C11: INSTALL-AWARE LANDING ====================== -->
<script>
  // The extension's content script (packages/extension-chrome/src/content.ts, landing-origin
  // gated — see design spec §2.2) stamps three attributes on <html> once it runs here:
  // data-ad-dict-installed="true", data-ad-dict-version="<semver>", and
  // data-ad-dict-ready="true"|"false" (PublicSettings.hasKey only — never the key itself, S1).
  // This script adapts the hero CTA + the #start checklist when those attributes appear. Without
  // the extension (or before it stamps them), nothing here runs and the page is exactly as
  // authored — see design spec §2.5's "must render perfectly without it".
  (function () {
    var COPY = {
      en: {
        ctaInstalled: 'Open setup',
        ctaReady: 'You’re all set ✓',
        statusInstalled: 'Install ✓ — next: add your key.',
        statusReady: 'All set ✓ — you’re ready to read.',
      },
      vi: {
        ctaInstalled: 'Mở phần thiết lập',
        ctaReady: 'Đã kích hoạt ✓',
        statusInstalled: 'Đã cài ✓ — tiếp theo: thêm khoá của bạn.',
        statusReady: 'Đã xong ✓ — bạn đã sẵn sàng đọc.',
      },
    };

    function applyInstallState() {
      var root = document.documentElement;
      var installed = root.getAttribute('data-ad-dict-installed') === 'true';
      if (!installed) return; // not installed (or not yet stamped): page stays exactly as authored
      var ready = root.getAttribute('data-ad-dict-ready') === 'true';
      var lang = root.lang === 'vi' ? 'vi' : 'en';
      var t = COPY[lang];

      var cta = document.getElementById('hero-cta');
      if (cta) {
        cta.removeAttribute('data-i18n'); // this script now owns this element's text/lang sync
        if (ready) {
          cta.textContent = t.ctaReady;
          cta.removeAttribute('href');
          cta.setAttribute('aria-disabled', 'true');
          cta.setAttribute('tabindex', '-1');
        } else {
          cta.textContent = t.ctaInstalled;
          cta.setAttribute('href', '#start');
          cta.removeAttribute('aria-disabled');
          cta.removeAttribute('tabindex');
        }
      }

      var status = document.getElementById('start-status');
      if (status) {
        status.textContent = ready ? t.statusReady : t.statusInstalled;
        status.hidden = false;
      }
    }

    applyInstallState();
    new MutationObserver(applyInstallState).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-ad-dict-installed', 'data-ad-dict-ready', 'lang'],
    });
  })();
</script>
```

- [ ] **Step 5: Manual verification (no automated test for this file).** From `docs/`, run
      `python3 -m http.server`, open the page in a plain browser tab **with no extension loaded**,
      and confirm: `#start-status` stays hidden, the hero CTA still reads "Add to Chrome, it's
      free" with its original Chrome Web Store link, and the language toggle still swaps every
      other section's copy (regression check — confirms this task's script does not throw when no
      marker is ever present, since `applyInstallState()`'s first branch is `if (!installed)
return;` and the `MutationObserver` only ever fires on attribute changes that, absent the
      extension, never happen).

- [ ] **Step 6: Commit** — gate, then commit:

```
bun run lint && bun run format:check
```

Commit:

```
git add docs/index.html
git commit -m "[C11InstallAwareLanding] feat: install-aware checklist/CTA markup + script in docs/index.html (C11)"
```

---

### Task 4: e2e coverage — the full install-aware flow against a local fixture

**Files:**

- Create: `packages/extension-chrome/e2e/c11-install-aware-landing.spec.ts`

- [ ] **Step 1: Write the spec.** Create
      `packages/extension-chrome/e2e/c11-install-aware-landing.spec.ts`:

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { test, expect } from './fixtures';
import { seedSettings } from './helpers';

// Read the real, current extension version from source — never hardcode it, so a future
// release-bump can't silently desync this assertion from packages/extension-chrome/src/manifest.json.
const manifestPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../src/manifest.json',
);
const EXTENSION_VERSION = (JSON.parse(readFileSync(manifestPath, 'utf8')) as { version: string })
  .version;

const LANDING_URL = 'https://hieplam.github.io/ai-dict/';

// Byte-for-byte the same script docs/index.html ships (design spec §3.3(d) / plan Task 3 Step 4).
const INSTALL_STATE_SCRIPT = `
  (function () {
    var COPY = {
      en: {
        ctaInstalled: 'Open setup',
        ctaReady: 'You’re all set ✓',
        statusInstalled: 'Install ✓ — next: add your key.',
        statusReady: 'All set ✓ — you’re ready to read.',
      },
      vi: {
        ctaInstalled: 'Mở phần thiết lập',
        ctaReady: 'Đã kích hoạt ✓',
        statusInstalled:
          'Đã cài ✓ — tiếp theo: thêm khoá của bạn.',
        statusReady: 'Đã xong ✓ — bạn đã sẵn sàng đọc.',
      },
    };

    function applyInstallState() {
      var root = document.documentElement;
      var installed = root.getAttribute('data-ad-dict-installed') === 'true';
      if (!installed) return;
      var ready = root.getAttribute('data-ad-dict-ready') === 'true';
      var lang = root.lang === 'vi' ? 'vi' : 'en';
      var t = COPY[lang];

      var cta = document.getElementById('hero-cta');
      if (cta) {
        cta.removeAttribute('data-i18n');
        if (ready) {
          cta.textContent = t.ctaReady;
          cta.removeAttribute('href');
          cta.setAttribute('aria-disabled', 'true');
          cta.setAttribute('tabindex', '-1');
        } else {
          cta.textContent = t.ctaInstalled;
          cta.setAttribute('href', '#start');
          cta.removeAttribute('aria-disabled');
          cta.removeAttribute('tabindex');
        }
      }

      var status = document.getElementById('start-status');
      if (status) {
        status.textContent = ready ? t.statusReady : t.statusInstalled;
        status.hidden = false;
      }
    }

    applyInstallState();
    new MutationObserver(applyInstallState).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-ad-dict-installed', 'data-ad-dict-ready', 'lang'],
    });
  })();
`;

// Minimal local stand-in for docs/index.html's #start/hero markup — mirrors the real structure
// (design spec §3.3(a)/(b)) plus a bare-bones stand-in for the real language-toggle click handler
// (docs/index.html:1856-1859) so the "lang" MutationObserver filter has something to react to.
const FIXTURE_HTML = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /></head>
  <body>
    <div class="lang-switch">
      <button type="button" data-lang="en">EN</button>
      <button type="button" data-lang="vi">VI</button>
    </div>
    <div class="cta-row">
      <a
        class="btn btn-primary"
        id="hero-cta"
        href="https://chromewebstore.google.com/detail/ai-dictionary/ipnmjhndmlkbhnifhmbknjjomdocgkeg"
        data-i18n="hero-cta-primary"
        >Add to Chrome, it&rsquo;s free</a
      >
    </div>
    <section id="start">
      <h2 data-i18n="start-h2">Get started</h2>
      <p class="start-status" id="start-status" hidden></p>
    </section>
    <script>
      document.querySelectorAll('.lang-switch [data-lang]').forEach(function (b) {
        b.addEventListener('click', function () {
          document.documentElement.lang = b.getAttribute('data-lang');
        });
      });
    </script>
    <script>${INSTALL_STATE_SCRIPT}</script>
  </body>
</html>`;

async function gotoRoutedLanding(page: import('@playwright/test').Page): Promise<void> {
  await page.route(`${LANDING_URL}**`, (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: FIXTURE_HTML }),
  );
  await page.goto(LANDING_URL);
  // The content script gates on isLandingPage(location) and runs at document_idle — wait for its
  // marker rather than a fixed timeout.
  await page.locator('html[data-ad-dict-installed="true"]').waitFor({ timeout: 10_000 });
}

test.describe('C11 install-aware landing page', () => {
  test('installed, no key: hero CTA + checklist status show "next: add your key"', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page, { apiKey: '', hasKey: false });

    await gotoRoutedLanding(page);

    await expect(page.locator('html')).toHaveAttribute('data-ad-dict-version', EXTENSION_VERSION);
    await expect(page.locator('html')).toHaveAttribute('data-ad-dict-ready', 'false');

    const cta = page.locator('#hero-cta');
    await expect(cta).toHaveText('Open setup');
    expect(await cta.getAttribute('href')).toBe('#start');
    expect(await cta.getAttribute('aria-disabled')).toBeNull();

    const status = page.locator('#start-status');
    await expect(status).toBeVisible();
    await expect(status).toHaveText('Install ✓ — next: add your key.');
  });

  test('installed and ready: hero CTA + checklist status show "all set"', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page, { apiKey: 'AIza-test', hasKey: true });

    await gotoRoutedLanding(page);

    await expect(page.locator('html')).toHaveAttribute('data-ad-dict-ready', 'true');

    const cta = page.locator('#hero-cta');
    await expect(cta).toHaveText('You’re all set ✓');
    expect(await cta.getAttribute('href')).toBeNull();
    expect(await cta.getAttribute('aria-disabled')).toBe('true');

    const status = page.locator('#start-status');
    await expect(status).toHaveText('All set ✓ — you’re ready to read.');
  });

  test('switching language re-syncs the adapted CTA and status copy', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page, { apiKey: '', hasKey: false });

    await gotoRoutedLanding(page);
    await expect(page.locator('#hero-cta')).toHaveText('Open setup');

    await page.locator('.lang-switch [data-lang="vi"]').click();

    await expect(page.locator('#hero-cta')).toHaveText('Mở phần thiết lập');
    await expect(page.locator('#start-status')).toHaveText(
      'Đã cài ✓ — tiếp theo: thêm khoá của bạn.',
    );
  });
});
```

Run:

```
GEMINI_API_KEY= bun run build:chrome
cd packages/extension-chrome && bunx playwright test c11-install-aware-landing
```

Expected: 3 passed.

- [ ] **Step 2: Commit** — gate, then commit:

```
GEMINI_API_KEY= bun run build:chrome
bun run lint && bun run format:check
```

Commit:

```
git add packages/extension-chrome/e2e/c11-install-aware-landing.spec.ts
git commit -m "[C11InstallAwareLanding] feat: e2e coverage for the install-aware landing page (C11)"
```

---

## Final gate (run once, after Task 4, before opening the PR)

```
cd packages/app && bun run typecheck
cd ../extension-chrome && bun run typecheck
cd ../..
bun run test
bun run lint
bun run format:check
GEMINI_API_KEY= bun run build:chrome
cd packages/extension-chrome && bunx playwright test c11-install-aware-landing onboarding options-actions
```

Expected: typecheck clean on both packages; the full Vitest suite green (including the 8
`landing-marker.test.ts` additions); lint/format clean; the Chrome build succeeds with the env key
cleared; the new `c11-install-aware-landing.spec.ts` (3 passed) plus `onboarding.spec.ts` and
`options-actions.spec.ts` (regression guards for the composition roots this card's Task 2 shares a
file with) all pass.

## PR

Regular merge (no squash). Jira link per the repo convention. Include a **"Testing performed"**
section per this worktree's evidence policy (§7 of the design spec) instead of screenshots/video —
list the suites above with pass counts. Note in the PR description that `docs/index.html`'s edit
ships live the moment the merge commit lands on `master` (GitHub Pages serves `/docs` directly), and
flag the C3 concurrency note (design spec §8) if C3's PR is open at the same time.
