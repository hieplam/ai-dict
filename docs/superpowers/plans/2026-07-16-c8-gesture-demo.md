# C8 Gesture Demo Implementation Plan

> **For agentic workers:** implement task-by-task, TDD (red → green → commit) per task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the welcome screen (`onboarding-view`) shows, not just tells, the product's core
gesture — a small inline demo where a word visibly "gets selected" and a "Define" pill (mirroring
`lookup-trigger.ts`'s real pill) appears beside it, looping. Reduced-motion users get a static
"1/2/3" step list instead, which doubles as the always-present screen-reader text alternative.
Zero API calls, zero video assets, `--ad-*`/`--adp-*` tokens only, works before a key exists —
the demo is pure additive markup + CSS on the one pre-key screen.

**Architecture:** everything lives in one file, `packages/app/src/ui/onboarding-view.ts` (`c3-1`
→ `c3-117 ui-components`, governed by `ref-web-components-shadow-dom`) — two string constants
(`MARKUP`, `CSS`) get additive changes, zero methods change. No new JavaScript: the
reduced-motion swap is a pure `@media (prefers-reduced-motion:reduce)` CSS block (see the design
spec §2.2 for why this is the simpler fit than `bottom-sheet.ts`'s JS+host-attribute pattern).
Full design rationale: `docs/superpowers/specs/2026-07-16-c8-gesture-demo-design.md`.

**Tech Stack:** TypeScript, Vitest + happy-dom (unit, `axe-core` a11y gate), Playwright (e2e).

## Global Constraints

- Implementer: dispatch each implementation task to the `hunter` subagent — never a generic
  implementer.
- **Single file touched for the component change:** `packages/app/src/ui/onboarding-view.ts`.
  Do not touch `lookup-trigger.ts`, `lookup-card.ts`, `bottom-sheet.ts`, `settings-form.ts`,
  `register.ts`, or any composition root (`content.ts`, `side-panel.ts`, `options.ts`, `sw.ts`) —
  this card has no dependency on any of them.
- **No new JavaScript in `onboarding-view.ts`.** `connectedCallback`, `submit`,
  `refreshProgress`, `setStatus`, the `value` setter, and `q<T>` are unmodified. The
  reduced-motion behavior is CSS-only (design spec §2.2) — if a task finds itself adding a
  `matchMedia` call or a new host attribute, stop; that is not this plan.
- **UI additions read only `--ad-*`/`--adp-*` design tokens** (no hard-coded colors) — see the
  design spec §3.3 for the full token inventory this plan uses. The one non-token numeric value
  (`4.4s` keyframe duration) is motion timing, not color, and follows the existing
  `lookup-trigger.ts:22` precedent for hard-coded animation durations on narrative/looping
  animations (as opposed to `--adp-dur-*`-token-driven short interactive transitions).
- `bun run lint` and `bun run format:check` clean before every commit.
- Every task must leave `cd packages/app && bun run typecheck` green. (No `extension-chrome`
  typecheck gate is needed until Task 2, whose e2e spec lives in that package.)
- Commit subject convention for every task in this plan: `feat: gesture demo — <task summary> (C8)`.
- **e2e build determinism:** before building for e2e (Task 2), `unset GEMINI_API_KEY` in the
  build shell. `esbuild.config.mjs:12-13` bakes any `GEMINI_API_KEY` present in the environment
  into the Chrome bundle, which makes `options.ts:211` skip mounting `onboarding-view` entirely
  (`KEY_FROM_ENV || hasKeyFor(s)` routes straight to `settings-form`) — this is the exact live
  flake the 2026-07-16 funnel audit hit and that roadmap card C10 exists to fix
  (`docs/ROADMAP.md:698-701`). C10 is not a dependency of this card, but its finding is: an
  onboarding e2e run on a machine/shell with `GEMINI_API_KEY` exported will never see
  `onboarding-view` at all, and Task 2's tests would fail for a reason that has nothing to do
  with this card's change.

---

### Task 1: gesture demo markup + CSS in `onboarding-view.ts`

**Files:**

- Modify: `packages/app/src/ui/onboarding-view.ts`
- Modify: `packages/app/test/ui/onboarding-view.test.ts`

- [ ] **Step 1: Write the failing tests.** Append to
      `packages/app/test/ui/onboarding-view.test.ts`, inside the existing
      `describe('<onboarding-view>', ...)` block, just before its closing `});` (after the
      existing `'uses a single adopted stylesheet'` test and before the `'does not re-initialize
the shadow on reconnect'` test — placement inside the block does not matter for Vitest, but
      keep it grouped with the other structural/CSS tests for readability):

```ts
it('renders the gesture demo between the hero and the Finish-setup panel (C8)', () => {
  const r = mount().shadowRoot!;
  const main = r.querySelector('main')!;
  const classNames = [...main.children].map((el) => el.className);
  const heroIdx = classNames.findIndex((c) => c === 'hero');
  const demoIdx = classNames.findIndex((c) => c === 'demo');
  const panelIdx = classNames.findIndex((c) => c === 'panel');
  expect(heroIdx).toBeGreaterThanOrEqual(0);
  expect(demoIdx).toBeGreaterThan(heroIdx);
  expect(panelIdx).toBeGreaterThan(demoIdx);
});

it('the animated sentence is aria-hidden and contains no focusable element (C8)', () => {
  const r = mount().shadowRoot!;
  const anim = r.querySelector('.demo-anim')!;
  expect(anim.getAttribute('aria-hidden')).toBe('true');
  // A real <button> here would still be keyboard-focusable despite an ancestor's
  // aria-hidden, which axe flags as aria-hidden-focus — guard against that regression.
  expect(anim.querySelector('button')).toBeNull();
});

it('the step list states the gesture in plain text and is screen-reader-only by default (C8)', () => {
  const r = mount().shadowRoot!;
  const steps = r.querySelector('.demo-steps')!;
  expect(steps.classList.contains('sr-only')).toBe(true);
  const text = steps.textContent ?? '';
  expect(text).toMatch(/select a word/i);
  expect(text).toMatch(/define/i);
  expect(text).toMatch(/definition/i);
});

it('the demo pill mirrors the real Define trigger: brand mark + "Define" label (C8)', () => {
  const r = mount().shadowRoot!;
  const pill = r.querySelector('.demo-pill')!;
  expect(pill.querySelector('svg')).not.toBeNull();
  expect(pill.querySelector('.label')!.textContent).toBe('Define');
});

it('declares a reduced-motion fallback: the animation hides, the step list becomes static (C8)', () => {
  const sheet = mount().shadowRoot!.adoptedStyleSheets[0]!;
  const rules = [...sheet.cssRules];
  const media = rules.find(
    (r): r is CSSMediaRule =>
      r instanceof CSSMediaRule && r.conditionText.includes('prefers-reduced-motion'),
  );
  expect(media).toBeTruthy();
  const styleRules = [...media!.cssRules].filter(
    (r): r is CSSStyleRule => r instanceof CSSStyleRule,
  );
  const animRule = styleRules.find((r) => r.selectorText === '.demo-anim');
  expect(animRule!.style.display).toBe('none');
  const stepsRule = styleRules.find((r) => r.selectorText === '.demo-steps.sr-only');
  expect(stepsRule!.style.position).toBe('static');
});
```

Run: `cd packages/app && bunx vitest run test/ui/onboarding-view.test.ts`
Expected: 5 new failures — `.demo`/`.demo-anim`/`.demo-steps`/`.demo-pill` don't exist yet, and
no `CSSMediaRule` with a `prefers-reduced-motion` condition exists in the stylesheet.

- [ ] **Step 2: Implement.** In `packages/app/src/ui/onboarding-view.ts`:
  1. In `MARKUP`, insert this new section between the existing `</div>` that closes `.hero` and
     the existing `<section class="panel" aria-labelledby="setup-h">`
     (`onboarding-view.ts:82-83` in the pre-change file):

```html
<section class="demo" aria-labelledby="demo-h">
  <h2 class="demo-h" id="demo-h">See it in action</h2>
  <p class="demo-anim" aria-hidden="true">
    Select a word — like <span class="demo-word">wanderlust</span
    ><span class="demo-pill"
      >${BRAND_MARK_SVG.replace('class="mark"', 'class="mark demo-mark"')}<span class="label"
        >Define</span
      ></span
    >
    — and a definition appears.
  </p>
  <ol class="demo-steps sr-only">
    <li>Select a word while reading.</li>
    <li>Tap the &quot;Define&quot; button that appears.</li>
    <li>See the definition instantly.</li>
  </ol>
</section>
```

2. In `CSS`, append these rules right after the existing `.lead{...}` rule and before the
   existing `.panel{...}` rule:

```css
.demo {
  margin: 20px 0 0;
  border: 1px solid var(--ad-line);
  border-radius: 14px;
  padding: 14px clamp(14px, 4vw, 20px);
}
.demo-h {
  margin: 0 0 8px;
  font-size: var(--adp-text-2xs);
  font-weight: var(--adp-weight-bold);
  letter-spacing: var(--adp-tracking-label);
  text-transform: uppercase;
  color: var(--ad-ink-faint);
}
.demo-anim {
  position: relative;
  margin: 0;
  font-size: 14.5px;
  line-height: 1.7;
  color: var(--ad-ink-soft);
}
.demo-word {
  position: relative;
  color: var(--ad-ink);
  font-weight: var(--adp-weight-semi);
}
.demo-word::before {
  content: '';
  position: absolute;
  inset: -1px -3px;
  border-radius: 3px;
  background: var(--ad-selection);
  transform: scaleX(0);
  transform-origin: left center;
  animation: demo-select 4.4s var(--adp-ease) infinite;
}
.demo-pill {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-left: 6px;
  padding: 4px 10px 4px 7px;
  border: 1px solid var(--ad-line-strong);
  border-radius: var(--adp-radius-pill);
  background: var(--ad-surface);
  box-shadow: var(--ad-shadow-trigger);
  font: var(--adp-weight-semi) var(--adp-text-2xs)/1 var(--adp-font-sans);
  color: var(--ad-ink);
  opacity: 0;
  transform: translateY(2px) scale(0.92);
  animation: demo-pill 4.4s var(--adp-ease) infinite;
}
.demo-pill .demo-mark {
  width: 12px;
  height: 12px;
  flex: none;
}
@keyframes demo-select {
  0%,
  8% {
    transform: scaleX(0);
  }
  26%,
  72% {
    transform: scaleX(1);
  }
  90%,
  100% {
    transform: scaleX(0);
  }
}
@keyframes demo-pill {
  0%,
  26% {
    opacity: 0;
    transform: translateY(2px) scale(0.92);
  }
  38%,
  64% {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
  84%,
  100% {
    opacity: 0;
    transform: translateY(2px) scale(0.92);
  }
}
@media (prefers-reduced-motion: reduce) {
  .demo-anim {
    display: none;
  }
  .demo-steps.sr-only {
    position: static;
    width: auto;
    height: auto;
    padding: 0;
    margin: 0;
    overflow: visible;
    clip: auto;
    white-space: normal;
    list-style: decimal;
    padding-left: 20px;
    color: var(--ad-ink-soft);
    font-size: 14.5px;
    line-height: 1.7;
  }
  .demo-steps.sr-only li {
    padding: 2px 0;
  }
  .demo-word::before,
  .demo-pill {
    animation: none;
  }
}
```

No import changes — `BRAND_MARK_SVG` is already imported at the top of the file
(`onboarding-view.ts:2`). No changes to any class method.

Run: `cd packages/app && bunx vitest run test/ui/onboarding-view.test.ts`
Expected: all tests pass (existing + 5 new), including the existing `'uses a single adopted
stylesheet'` and `'has no axe violations'` tests, unmodified, still green.

- [ ] **Step 3: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

Commit:

```
git add packages/app/src/ui/onboarding-view.ts packages/app/test/ui/onboarding-view.test.ts
git commit -m "feat: gesture demo — add animated demo + reduced-motion fallback to onboarding-view (C8)" \
  -m $'Tribe-Card: c8-gesture-demo\nTribe-Task: 1/2'
```

---

### Task 2: e2e coverage — demo presence + reduced-motion fallback

**Files:**

- Modify: `packages/extension-chrome/e2e/onboarding.spec.ts`

No new spec file — this extends the existing onboarding e2e file, which already exercises the
same pre-key `onboarding-view` screen with the same shadow-piercing locator pattern
(`onboarding.spec.ts:7-31`).

- [ ] **Step 1: Write the tests.** Append to
      `packages/extension-chrome/e2e/onboarding.spec.ts`, after the existing third test (`'no-key
card shows the setup invite and "Open Settings" opens the options page'`):

```ts
test('welcome screen shows the gesture demo animated by default (C8)', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await page.waitForSelector('onboarding-view');

  // Assert the actual toggled CSS property, not toBeVisible()/toBeHidden(): the sr-only clip
  // technique gives .demo-steps a non-empty 1x1px box, which Playwright's visibility heuristic
  // can read as "visible" even though it is clipped to nothing on screen.
  await expect(page.locator('onboarding-view .demo-anim')).not.toHaveCSS('display', 'none');
  await expect(page.locator('onboarding-view .demo-steps')).toHaveCSS('position', 'absolute');
});

test('reduced motion swaps the animated demo for the static step list (C8)', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  // Must emulate BEFORE navigating: onboarding-view's shadow DOM is static markup assigned
  // once in connectedCallback, so the media state has to already be in effect when the
  // element connects (mirrors theme.spec.ts:28-29's emulateMedia → gotoFixture ordering for
  // colorScheme).
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await page.waitForSelector('onboarding-view');

  await expect(page.locator('onboarding-view .demo-anim')).toHaveCSS('display', 'none');
  await expect(page.locator('onboarding-view .demo-steps')).toHaveCSS('position', 'static');
});
```

- [ ] **Step 2: Build and run.** Clear any baked-in Gemini key first (Global Constraints —
      e2e build determinism):

```
unset GEMINI_API_KEY
bun run build:chrome
cd packages/extension-chrome && bunx playwright test onboarding
```

Expected: 5 passed (the existing 3 onboarding tests, unaffected, plus the 2 new tests).

- [ ] **Step 3: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd ../extension-chrome && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

Commit:

```
git add packages/extension-chrome/e2e/onboarding.spec.ts
git commit -m "feat: gesture demo — add e2e coverage for demo presence and reduced motion (C8)" \
  -m $'Tribe-Card: c8-gesture-demo\nTribe-Task: 2/2'
```

---

## Final gate (run once, after Task 2, before opening the PR)

```
unset GEMINI_API_KEY
cd packages/app && bun run typecheck
cd ../extension-chrome && bun run typecheck
cd ../..
bun run test
bun run lint
bun run format:check
bun run build:chrome
cd packages/extension-chrome && bunx playwright test onboarding
```

Expected: typecheck clean on both packages; the full Vitest suite green (including the 5 new
`onboarding-view.test.ts` assertions); lint/format clean; the Chrome build succeeds with no
env-baked Gemini key; the full `onboarding.spec.ts` suite (5 tests: 3 pre-existing + 2 new) green.

## PR notes

- **Merge:** regular merge, never squash (repo convention).
- **PR body:** per the repo's retired-media-evidence convention, include a written **"Testing
  performed"** section (suites run, counts, the 2 new e2e scenarios by name) instead of any
  screenshot/video — this also satisfies the card's own "no video assets" scope fence, so there
  is nothing to reconcile between the two.
- **JIRA:** none — this repo carries no Jira tracker at all (confirmed absent); the `## JIRA
ticket` section always reads `n/a — this repo is not Jira-tracked`, including when this plan is
  actually executed by a Hunter/Warchief pair against a real feature branch. This repo's own
  `git-conventions.md` governs branch naming/PR shape as normal; it does not carry a Jira-link
  requirement.
