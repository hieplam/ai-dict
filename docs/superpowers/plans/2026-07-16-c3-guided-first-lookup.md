# C3 Guided First Lookup Implementation Plan

> **Revision history**
> **2026-07-16 v2 — mechanism superseded per the roadmap's landing-page revision** (`docs/ROADMAP.md`
> §4 C3, §8 decision log). v1 was a 4-task plan that recomposed the real lookup pipeline inside the
> options page (a new domain factory `createDomReader`, a large `mountTryIt` composition-root
> wiring block, a scoped-selection unit-test task). **All of that is gone.** v2 is a 3-task plan:
> a settings-form CTA, an options.ts tab-opener, and a `docs/index.html` content edit — because the
> real lookup surface (the landing page, already covered by the content script) needs no new code
> at all. Read `docs/superpowers/specs/2026-07-16-c3-guided-first-lookup-design.md` (v2) first; do
> not reference the old plan's Task 1/Task 3 body text, both are fully superseded.

> **For agentic workers:** implement task-by-task, TDD (red → green → commit) per task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** immediately after a **verified** activation (C2), the settings screen shows a small
"Try it now" CTA — a button labelled "Try it on a real page" plus "uses your key" microcopy.
Clicking it opens `https://hieplam.github.io/ai-dict/#try` in a new tab, where a real practice
sentence sits on the project's own public landing page. Because that page is an ordinary webpage
already covered by the extension's `<all_urls>` content script, selecting the practice word there
pops the real "Define" pill and runs the real lookup — the exact same `content.ts` pipeline every
other reading page uses. No fake data, no new wire message, no new renderer, and (unlike v1) no
new pipeline-hosting code anywhere in the extension.

**Architecture:** three small, independent-ish changes:

1. `packages/app/src/ui/settings-form.ts` — a hidden-by-default CTA section + one settable
   property (`tryIt`) + one dispatched event (`tryit-open`). Pure UI, no pipeline code.
2. `packages/extension-chrome/src/options.ts` — the composition root wires the CTA's `tryit-open`
   event to `chrome.tabs.create({ url: TRY_IT_URL })`, and passes `{ showTryIt: true }` from the
   (C2-authored) activation-success branch only.
3. `docs/index.html` — a new `#try` section (English-authored markup + CSS + nav link) plus the
   matching Vietnamese strings in the page's existing `VI` translation object. Content-only; no
   JavaScript added to the page.

Full design rationale, including why this is smaller than v1 and the corrected
`configuredProviders` finding: `docs/superpowers/specs/2026-07-16-c3-guided-first-lookup-design.md`.

**Depends on C2** (`docs/superpowers/specs/2026-07-16-c2-verified-activation-design.md`) —
Task 2 below edits C2's own rewritten `save` listener. Do not start Task 2 until C2 is merged;
Task 1 and Task 3 have no dependency on C2 and can proceed independently (and in parallel with
each other and with C2's own work).

**Tech Stack:** TypeScript, Vitest + happy-dom (unit), Playwright (e2e), plain HTML/CSS/JS
(`docs/index.html`, no build step).

## Global Constraints

- Implementer: dispatch each implementation/fix task to the `hunter` subagent — never a generic
  implementer.
- **Zero changes to `packages/app/src/wire.ts`, `packages/app/src/app/router.ts`,
  `packages/app/src/ports.ts`, or `packages/app/src/app/dom-selection-source.ts`.** Nothing in this
  plan needs a new domain factory or a new wire message — the real pipeline this card points at
  already runs, unmodified, on the landing page.
- **Do not import `runLookupWorkflow`, `DomSelectionSource`, `InlineBottomSheetRenderer`,
  `MessageRelayLookupClient`, `ChromeFloatingTrigger`, or `registerContentElements` into
  `options.ts`.** If a task seems to need one of these, stop — that would mean the mechanism has
  drifted back toward v1's superseded design; re-read the v2 spec §2 before proceeding.
- **The CTA never renders on the `save-anyway` (NETWORK bypass) path** — only the verified-success
  branch of the (C2) `save` listener passes `{ showTryIt: true }`.
- **`docs/index.html`'s only change is content** — markup, CSS, and entries in the existing `VI`
  translation object. No new `<script>` block, no new JavaScript logic on the page (spec §4: the
  landing page must never touch the API key, S1 — the simplest way to guarantee that is to add no
  code that could read it).
- UI additions read only `--ad-*`/`--adp-*` design tokens (no hard-coded colors) in
  `settings-form.ts`; `docs/index.html`'s new CSS follows the same rule using that page's own
  `--ad-*` custom-property definitions.
- `bun run lint` and `bun run format:check` clean before every commit — this includes
  `docs/index.html`, which IS covered by Prettier (`.prettierignore` was checked; `docs/index.html`
  is not excluded).
- Every task must leave `cd packages/app && bun run typecheck` (and, from Task 2 on,
  `cd packages/extension-chrome && bun run typecheck`) green.
- **Merging to `master` deploys `docs/index.html` live** (GitHub Pages serves `/docs` from
  `master` directly). Treat Task 3's PR merge as a production release of the public landing page,
  not "just docs."
- Commit subject convention for every task in this plan: `feat: guided first lookup — <task summary> (C3)`.

---

### Task 1: `SettingsForm` — "Try it now" CTA

**Files:**

- Modify: `packages/app/src/ui/settings-form.ts`
- Modify: `packages/app/test/ui/settings-form.test.ts`

**Interfaces:**

```ts
set tryIt(show: boolean): void;
// dispatches a composed 'tryit-open' event (no detail) when #tryit-open is clicked
```

- [ ] **Step 1: Write the failing tests.** Append to `packages/app/test/ui/settings-form.test.ts`
      as a new top-level `describe` block, after the closing `});` of the existing A16
      sticky-save-bar `describe` block (the file's last block). Reuse the file's existing
      `mountForm()` helper (`settings-form.test.ts:15-19`) verbatim — do not introduce a second
      mounting helper; `vi` is already imported at the top of the file:

```ts
describe('<settings-form> try it now CTA (C3)', () => {
  it('the try-it CTA starts hidden', () => {
    const form = mountForm();
    expect(form.shadowRoot!.getElementById('tryit-cta')!.hidden).toBe(true);
  });

  it('tryIt = true reveals the CTA; tryIt = false hides it again', () => {
    const form = mountForm();
    form.tryIt = true;
    expect(form.shadowRoot!.getElementById('tryit-cta')!.hidden).toBe(false);
    form.tryIt = false;
    expect(form.shadowRoot!.getElementById('tryit-cta')!.hidden).toBe(true);
  });

  it('clicking "Try it on a real page" dispatches a composed tryit-open event', () => {
    const form = mountForm();
    form.tryIt = true;
    const handler = vi.fn();
    document.body.addEventListener('tryit-open', handler);
    (form.shadowRoot!.getElementById('tryit-open') as HTMLButtonElement).click();
    document.body.removeEventListener('tryit-open', handler);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
```

Check the file's existing imports/mount helper first (e.g. `mountForm`, or however the file
currently constructs a connected `<settings-form>` for its other tests) and reuse it verbatim —
do not introduce a second mounting helper.

Run: `cd packages/app && bunx vitest run test/ui/settings-form.test.ts`
Expected: 3 new failures (`#tryit-cta` not found / `tryIt` not a setter, or TS errors to that
effect); all pre-existing tests in this file still pass.

- [ ] **Step 2: Implement.** In `packages/app/src/ui/settings-form.ts`:
  1. Insert this markup into `MARKUP` (`settings-form.ts:140-221`), right after
     `<h1 class="title">Settings</h1>` and before the Connection `<section>`:

```html
<section class="tryit-cta" id="tryit-cta" hidden aria-labelledby="tryit-cta-h">
  <h2 class="tryit-cta-h" id="tryit-cta-h">Try it now</h2>
  <p class="tryit-cta-lead">
    See a real definition card in seconds, on a practice page — using your own key.
  </p>
  <div class="inline-actions">
    <button type="button" id="tryit-open" class="primary">Try it on a real page</button>
  </div>
  <p class="tryit-cta-caption">
    Uses your key — nothing runs until you select a word and click Define there.
  </p>
</section>
```

2. Add these CSS rules to `CSS` (`settings-form.ts:78-138`), anywhere after the `.col` rule:

```css
.tryit-cta {
  margin: 0 0 16px;
  border: 1px solid var(--ad-accent);
  border-radius: 12px;
  padding: 16px 20px;
  background: var(--ad-accent-soft);
}
.tryit-cta-h {
  margin: 0 0 6px;
  font-size: var(--adp-text-body);
  font-weight: var(--adp-weight-bold);
  color: var(--ad-ink);
}
.tryit-cta-lead {
  margin: 0 0 12px;
  font-size: var(--adp-text-sm);
  line-height: 1.5;
  color: var(--ad-ink-soft);
}
.tryit-cta-caption {
  margin: 10px 0 0;
  font-size: var(--adp-text-xs);
  color: var(--ad-ink-faint);
}
```

3. In `connectedCallback` (`settings-form.ts:250` onward), alongside the existing `this.relay(...)`
   calls (`settings-form.ts:309-312`), add:

```ts
this.relay('#tryit-open', 'tryit-open');
```

4. Add the one public member to the class body (near `keyFromEnv`/`errorReporting`,
   `settings-form.ts:409-428`):

```ts
/** C3: show/hide the post-activation "Try it now" CTA. Set true exactly once, by the
 * composition root, right after a verified activation succeeds (see options.ts). */
set tryIt(show: boolean) {
  if (!this.shadowRoot) return;
  this.q<HTMLElement>('#tryit-cta').hidden = !show;
}
```

Run: `cd packages/app && bunx vitest run test/ui/settings-form.test.ts`
Expected: all tests pass (existing + 3 new).

- [ ] **Step 3: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

Commit:

```
git add packages/app/src/ui/settings-form.ts packages/app/test/ui/settings-form.test.ts
git commit -m "feat: guided first lookup — add try-it-now CTA to settings-form (C3)" \
  -m $'Tribe-Card: c3-guided-first-lookup\nTribe-Task: 1/3'
```

---

### Task 2: Composition root — wire the CTA to a new tab in `options.ts`

**Files:**

- Modify: `packages/extension-chrome/src/options.ts`

**Precondition:** C2 (`docs/superpowers/plans/2026-07-16-c2-verified-activation.md`) must already
be merged — this task edits C2's rewritten activation `save` listener. If C2 has not landed when
this task starts, STOP and report back rather than guessing at C2's exact final code; anchor edits
on the literal status string `"You're all set."`, which is stable across the pre-C2 and post-C2
versions.

No dedicated unit test exists for `options.ts` in this repo (a composition root, same precedent as
B5/C2's own composition-root edits) — this task's correctness is proven by Task 3's... no — by
the e2e added alongside this task (see Step 2 below; the e2e spec ships in this same task since
there is no separate "e2e task" in this smaller v2 plan). Still run the gate commands below at the
end of this task so a regression in existing behavior (onboarding, settings save, etc.) is caught
immediately.

- [ ] **Step 1: Implement.** In `packages/extension-chrome/src/options.ts`:
  1. Add a new top-level constant, near the other top-level constants (`KEY_FROM_ENV`,
     `DEFAULTS`, `options.ts:28-43`):

```ts
// Where C3's post-activation "Try it on a real page" button sends the user — the public landing
// page's practice section (docs/index.html's #try). Chrome-shell-only constant: the landing page
// URL is a store/build detail, not a portable-core concern, so it is not exported from @ai-dict/app.
const TRY_IT_URL = 'https://hieplam.github.io/ai-dict/#try';
```

2. Change `mountSettings`'s signature (`options.ts:84`) to accept a 3rd optional argument, and
   wire the CTA at the end of the function body:

```ts
function mountSettings(initial: Settings, status?: string, opts?: { showTryIt?: boolean }): void {
  // ...existing body, unchanged...
  if (status) form.setStatus(status);
  if (opts?.showTryIt) {
    form.tryIt = true;
    form.addEventListener('tryit-open', () => {
      void chrome.tabs.create({ url: TRY_IT_URL });
    });
  }
}
```

3. In C2's rewritten `save` listener's verified-success branch, pass `{ showTryIt: true }`:

```ts
if (r.ok) {
  void load().then((s) =>
    mountSettings(
      s,
      "You're all set. Highlight any word while reading and choose Define to look it up.",
      { showTryIt: true },
    ),
  );
  return;
}
```

Do **not** add `showTryIt` to the `save-anyway` listener's success path — that path never
verified the key (design spec §3.4).

4. **Optional, same-diff consistency tidy (not a correctness fix — see design spec §3.5 for the
   corrected finding that this was never actually a blocker):** in the same
   `chrome.storage.local.set(...)` call that persists the pasted key in the verified-success path,
   add `configuredProviders: apiKey ? ['gemini'] : []`, matching the computation
   `wireSettings`'s own `save` listener already does (`options.ts:116-119`). Do this ONLY if it
   costs nothing extra (the line is already being touched in this same task) — do not open a
   separate diff or re-touch C2's file for this alone.

Run:

```
cd packages/extension-chrome && bun run typecheck
```

Expected: clean (no type errors).

- [ ] **Step 2: Write and run the e2e.** Create
      `packages/extension-chrome/e2e/c3-guided-first-lookup.spec.ts`, modeled on
      `onboarding.spec.ts`'s pattern for capturing an opened tab
      (`context.waitForEvent('page')`, already used there for the no-key card's "Open Settings"
      button, `onboarding.spec.ts:64-69`), extended with `mockGemini`/`selectWord`/`openTrigger`
      from `./helpers`:

```ts
import { test, expect } from './fixtures';
import { mockGemini, selectWord, openTrigger, GEMINI_OK_BODY } from './helpers';

// A LOCAL stand-in for the landing page's #try section — mirrors docs/index.html's real markup
// (design spec §3.1) without ever fetching the live site (C10's rule: e2e must never fetch
// hieplam.github.io).
const TRY_IT_FIXTURE_HTML = `<html><body>
  <p id="try-sentence">Finding that café was pure <mark>serendipity</mark>.</p>
</body></html>`;

test.describe('C3 guided first lookup', () => {
  test('activating with a verified key shows the try-it CTA; the button opens the landing page and a real lookup runs there', async ({
    context,
    extensionId,
  }) => {
    const gemini = await mockGemini(context);
    // Never fetch the live site: fulfill the landing page URL locally.
    await context.route('https://hieplam.github.io/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: TRY_IT_FIXTURE_HTML }),
    );

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.waitForSelector('onboarding-view');
    await page.locator('onboarding-view #key').fill('AIza-activated');
    await page.locator('onboarding-view #activate').click();

    await page.waitForSelector('settings-form');
    const cta = page.locator('settings-form #tryit-cta');
    await expect(cta).toBeVisible();
    await expect(page.locator('settings-form .tryit-cta-caption')).toContainText('uses your key', {
      ignoreCase: true,
    });

    // Activation's own connection.test (C2) already made one real (mocked) call.
    const beforeTryIt = gemini.count;

    const newPagePromise = context.waitForEvent('page');
    await page.locator('settings-form #tryit-open').click();
    const tryItPage = await newPagePromise;
    await tryItPage.waitForLoadState();
    expect(tryItPage.url()).toContain('hieplam.github.io/ai-dict/#try');

    await selectWord(tryItPage, 'try-sentence', 'serendipity');
    await openTrigger(tryItPage);
    await expect(tryItPage.locator('bottom-sheet lookup-card')).toContainText(
      'financial institution',
      { timeout: 10_000 },
    );
    expect(gemini.count).toBe(beforeTryIt + 1);
  });

  test('the "Save anyway" (unverified) path never shows the try-it CTA', async ({
    context,
    extensionId,
  }) => {
    await mockGemini(context, { abort: true });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.locator('onboarding-view #key').fill('AIza-activated');
    await page.locator('onboarding-view #activate').click();

    await page.waitForSelector('settings-form #save-anyway', { state: 'visible' });
    await page.locator('settings-form #save-anyway').click();
    await page.waitForSelector('settings-form');
    await expect(page.locator('settings-form #tryit-cta')).toHaveCount(0);
  });
});
```

Note for the implementer: the second test's selectors (`onboarding-view #save-anyway`, the "Save
anyway" flow) come from C2's own spec/plan — if C2's final button id or event flow differs from
what's assumed here, adjust to match C2's actual shipped markup; the assertion that matters is
"`#tryit-cta` has count 0" after the unverified-save path, not the exact steps to get there.

Run:

```
GEMINI_API_KEY= bun run build:chrome
cd packages/extension-chrome && bunx playwright test c3-guided-first-lookup
```

Expected: 2 passed.

- [ ] **Step 3: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd ../extension-chrome && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

Commit:

```
git add packages/extension-chrome/src/options.ts packages/extension-chrome/e2e/c3-guided-first-lookup.spec.ts
git commit -m "feat: guided first lookup — wire try-it CTA to the landing page + e2e (C3)" \
  -m $'Tribe-Card: c3-guided-first-lookup\nTribe-Task: 2/3'
```

---

### Task 3: `docs/index.html` — the landing page's `#try` section

**Files:**

- Modify: `docs/index.html`

**No unit/e2e test** — this file has no existing test harness (design spec §5.4) and this plan
does not add one; Task 2's e2e already proves the real gesture works against a local stand-in of
this exact markup. Verification here is: (a) the diff matches the design spec §3.1 markup/CSS/i18n
keys, (b) `bun run format:check` passes, and (c) a manual local render (see Step 2).

- [ ] **Step 1: Implement.** In `docs/index.html`:
  1. Add the nav link, between the existing `#start` and `#faq` entries (`docs/index.html:963-964`):

```html
<a href="#start" data-i18n="nav-start">Get started</a>
<a href="#try" data-i18n="nav-try">Try it</a>
<a href="#faq" data-i18n="nav-faq">FAQ</a>
```

2. Insert the new section between the existing `#start` section's closing `</section>` and the
   `#faq` section, replacing the single `<hr class="rule" />` currently between them
   (`docs/index.html:1531`) with:

```html
<hr class="rule" />

<!-- ============================ TRY IT ============================ -->
<section id="try" class="reveal">
  <p class="eyebrow" data-i18n="try-eyebrow">Not a demo</p>
  <h2 data-i18n="try-h2">Try it right here</h2>
  <p class="lede prose" data-i18n="try-lede">
    This is real page text, not a mockup. If you've already installed AI Dictionary and activated a
    key, select any word below — or anywhere else on this page — and choose
    <strong>Define</strong>. The card that appears is the real thing, running on your own key.
  </p>
  <p class="try-sentence" id="try-sentence">Finding that café was pure <mark>serendipity</mark>.</p>
  <p class="caption" data-i18n="try-caption">
    Nothing runs until you select text and click Define — one lookup, using your own saved key.
    Button not showing? See
    <a href="#faq" data-i18n="try-faq-link">“Why doesn’t the Define button appear?”</a> below.
  </p>
</section>

<hr class="rule" />
```

3. Add the CSS rules to the existing `<style>` block, anywhere near the other section-specific
   rules (e.g. after `.steps` — this page's `<style>` block is one flat sheet, not scoped, so
   placement only matters for readability):

```css
#try .try-sentence {
  font-family: var(--adp-font-serif, serif);
  font-size: 1.15rem;
  line-height: 1.6;
  margin: 22px 0 14px;
  color: var(--ad-ink);
}
#try .try-sentence mark {
  background: var(--ad-accent-soft);
  color: var(--ad-ink);
  padding: 1px 6px;
  border-radius: 5px;
  box-decoration-break: clone;
}
```

4. Add the six translation keys to the `VI` object (`docs/index.html:1705-1817`), inserted after
   the existing `'start-onboarding-img-alt'` entry (`docs/index.html:1796`) and before
   `'faq-eyebrow'` (`docs/index.html:1797`):

```js
'nav-try': 'Dùng thử',
'try-eyebrow': 'Không phải bản demo',
'try-h2': 'Dùng thử ngay tại đây',
'try-lede': 'Đây là văn bản thật trên trang, không phải bản dựng sẵn. Nếu bạn đã cài AI Dictionary và kích hoạt khoá, hãy chọn một từ bất kỳ bên dưới — hoặc bất cứ đâu trên trang này — rồi chọn Define. Thẻ hiện ra là thẻ thật, chạy bằng khoá của chính bạn.',
'try-caption': 'Không có gì chạy cho đến khi bạn chọn văn bản và bấm Define — một lượt tra cứu duy nhất, dùng khoá đã lưu của bạn. Nút không hiện? Xem mục “Tại sao nút Define không xuất hiện?” bên dưới.',
'try-faq-link': '“Tại sao nút Define không xuất hiện?”',
```

**Do not** add a `data-i18n` attribute to `#try-sentence` itself — the practice sentence stays
fixed English in both languages (design spec §3.1's explicit reasoning: source-language handling
is out of this card's scope, and A12 — the card that would generalize this — is "build, don't
advertise" per its own 2026-07-16 owner ruling).

- [ ] **Step 2: Manual verification.** From the repo root:

```
cd docs && python3 -m http.server 8080
```

Open `http://localhost:8080/` and confirm:

- The `#try` section renders between "Get started" and "FAQ", with the practice sentence and its
  highlighted `serendipity`.
- The nav's new "Try it" link scrolls to it.
- Clicking the VI language toggle swaps every new string (nav link, eyebrow, heading, lede,
  caption, FAQ link text) to Vietnamese, and the practice sentence itself stays in English.
- The `#faq` link inside the new caption navigates to the FAQ section.
- The Sepia/Dark/Contrast theme toggle re-themes the new section identically to its neighbors (no
  hard-coded colors visible as a mismatch).

- [ ] **Step 3: Commit** — gate, then commit:

```
bun run format:check
```

Commit:

```
git add docs/index.html
git commit -m "feat: guided first lookup — add landing page try-it section (C3)" \
  -m $'Tribe-Card: c3-guided-first-lookup\nTribe-Task: 3/3'
```

---

## Final gate (run once, after Task 3, before opening the PR)

```
cd packages/app && bun run typecheck
cd ../extension-chrome && bun run typecheck
cd ../..
bun run test
bun run lint
bun run format:check
GEMINI_API_KEY= bun run build:chrome
cd packages/extension-chrome && bunx playwright test onboarding c2-verified-activation c3-guided-first-lookup
```

Expected: typecheck clean on both packages; the full Vitest suite green (including the
`settings-form` additions from Task 1); lint/format clean (including `docs/index.html`); the
Chrome build succeeds with the env key cleared; `onboarding.spec.ts` (regression guard — the
pre-C3 onboarding flow must be unaffected), `c2-verified-activation.spec.ts` (regression guard —
C2's own flow must be unaffected by this card), and the new `c3-guided-first-lookup.spec.ts` suite
all pass.

## PR

Follow `.github/PULL_REQUEST_TEMPLATE`, a regular merge commit (never squash — owner ruling
2026-07-16), and a "Testing performed" section per this worktree's `CLAUDE.md` (owner ruling
2026-07-16 — no screenshots/video) listing exactly what the Final gate above ran. **Call out
explicitly in the PR description that merging deploys `docs/index.html` live** to
<https://hieplam.github.io/ai-dict/> (GitHub Pages serves `/docs` from `master` directly) — this is
a production release of the public landing page, not just an internal doc change.
