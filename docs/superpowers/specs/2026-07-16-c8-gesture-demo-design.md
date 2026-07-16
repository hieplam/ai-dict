# C8 — Gesture demo on the welcome screen

Roadmap card: `docs/ROADMAP.md` §4 Category C, C8 (Impact 4 · Effort S · Score 4.0),
`docs/ROADMAP.md:637-650`. Depends on: — (pairs naturally with C3 "Guided first lookup",
`docs/ROADMAP.md:650`, but C3 is out of scope and not required for this card). Sequenced after
C7, before C3, per the category's lead order (`docs/ROADMAP.md:598`).

## 1. Problem (grounded in code)

The welcome screen's lead paragraph _tells_ the product's core gesture but never _shows_ it:

> `packages/app/src/ui/onboarding-view.ts:81` — `<p class="lead">Look up any English word right
where you're reading, translated into your language, powered by your own free Google Gemini
key. Nothing leaves your device but the word you choose.</p>`

The only other place the gesture is described in words, not motion, is the post-activation
settings status line:

> `packages/extension-chrome/src/options.ts:202` — `"You're all set. Highlight any word while
reading and choose Define to look it up."`

Neither surface shows the actual motion: select text → a small pill-shaped "Define" button
appears beside the selection → the reader taps it. That real interaction lives in
`packages/app/src/ui/lookup-trigger.ts` — a floating `<button>` in its own shadow root, styled as
a pill (`border-radius:var(--adp-radius-pill)`, `box-shadow:var(--ad-shadow-trigger)`,
`packages/app/src/ui/lookup-trigger.ts:16`) carrying the brand mark plus a "Define" label
(`packages/app/src/ui/lookup-trigger.ts:38`: `` `${BRAND_MARK_SVG}<span class="label">Define</span>` ``).
A first-time user who has never selected text on a page has no way to preview what that pill
looks like or what triggers it, before they leave onboarding to go find out. The roadmap's own
framing: _"The product's trigger is an invisible gesture; users who never learn it churn with a
correctly configured key"_ (`docs/ROADMAP.md:645-646`).

**The gap is entirely presentational.** `onboarding-view.ts` already renders a complete,
self-contained welcome screen (hero + "Finish setup" panel) with zero wire-protocol or
`chrome.*` calls anywhere in the file (confirmed: its only imports are `adoptStyles` and the
token/icon exports from `./styles/*`, `onboarding-view.ts:1-2`) — nothing here talks to a
provider, a key, or the extension's messaging layer. Adding a demo is additive markup + CSS to
one file; it cannot regress activation, key handling, or any wire path because none of those are
touched.

## 2. Decision: placement, animation mechanism, and the reduced-motion fallback

### 2.1 Placement — between the hero lead and "Finish setup"

The demo goes in a new `<section class="demo">`, inserted in `MARKUP` right after the `.hero`
div closes and right before the existing `<section class="panel" aria-labelledby="setup-h">`
(`packages/app/src/ui/onboarding-view.ts:82-83`). Rationale:

1. **Narrative order matches the reading order of the page.** The hero explains _what_ the
   product does in prose (`.lead`); the demo immediately follows to _show_ it; the "Finish
   setup" panel then asks for the one blocking action (the key). A reader scans:
   what it does → what the gesture looks like → what I need to do. Putting the demo after the
   panel would separate the explanation from the demonstration by the full setup form.
2. **It does not compete with or interrupt the setup flow.** The panel's own internal structure
   (`.panel-head`, `.steps`, `.actions`, `#status`) is unchanged — the demo is a new sibling
   section, not an insertion inside the panel.
3. Visually it reuses the panel's own established "distinct card" language — 1px
   `var(--ad-line)` border, 14px radius (`onboarding-view.ts:39`, `.panel` rule) — so it reads
   as a second, quieter card rather than a foreign element bolted onto the hero.

### 2.2 Animation mechanism — pure CSS `@keyframes`, zero new JavaScript

**Decision: no new JS at all** — not a timer, not an `IntersectionObserver`, not even the
`matchMedia` + host-attribute pattern `bottom-sheet.ts` uses for its own reduced-motion guard
(`packages/app/src/ui/bottom-sheet.ts:39-40`, `:host([reduced])` at line 28). Two CSS
`@keyframes` rules animate `transform`/`opacity` only (compositor-only properties — no layout or
paint work, so the infinite loop is cheap even while the tab sits idle on the welcome screen) on
plain `<span>`s inside the existing static `MARKUP` template string. `prefers-reduced-motion` is
handled entirely by a `@media (prefers-reduced-motion:reduce)` block in the same stylesheet.

This is a deliberate choice between the two reduced-motion patterns already present in this
codebase:

- `bottom-sheet.ts` reads `matchMedia` once in `connectedCallback` and stamps a `reduced`
  attribute on the host, because its reduced-motion guard turns off a **JS-driven** transition
  tied to open/close _state_ (`this.setState`) — there is already a JS call site to hang the
  check on.
- `settings-form.ts` uses **pure CSS** `@media (prefers-reduced-motion:reduce)` with no JS at all
  for its own reduced-motion guards (`packages/app/src/ui/settings-form.ts:108,137`), because
  those guards gate purely presentational, state-free CSS behavior.

C8's demo has no JS state machine — it is static markup that loops or doesn't. That makes it the
same shape as `settings-form.ts`'s guards, not `bottom-sheet.ts`'s, so the pure-CSS pattern is
the correct (and simplest) fit. An `IntersectionObserver` was considered and rejected: the demo
sits a few hundred pixels below the fold-line at most (immediately after the hero, before a
single-panel form — `onboarding-view.ts`'s own `main{max-width:560px}` keeps the whole page
short), and Chromium already throttles/pauses CSS animations in backgrounded or off-screen tabs
natively — adding an observer would duplicate a browser guarantee for no measurable benefit,
violating the card's "decide the simplest" instruction.

The one precedent for a **hard-coded, non-token animation duration** on a long-running/narrative
animation (as opposed to a short interactive transition, which must use `--adp-dur-*`) is already
in this codebase: `lookup-trigger.ts:22` — `.spinner{...animation:spin .77s linear infinite}`.
The demo's `4.4s` loop duration follows that same precedent; only the easing curve is a token
(`--adp-ease`, the same "gentle, no bounce" curve used everywhere else in Paperlight motion).

**Choreography** (one 4.4s loop, both keyframes share the duration so they stay in lock-step):

| Phase         | `demo-select` (highlight sweep, `transform:scaleX`) | `demo-pill` (Define pill, `opacity`+`transform`) |
| ------------- | --------------------------------------------------- | ------------------------------------------------ |
| 0% – 8%       | not yet swept (`scaleX(0)`)                         | hidden                                           |
| 8% – 26%      | sweeping in                                         | hidden                                           |
| 26% – 64%/72% | fully swept, holds                                  | fading in (26–38%), holds visible (38–64%)       |
| 64% – 90%     | still fully swept                                   | fading out (64–84%), hidden by 84%               |
| 90% – 100%    | sweeping back out                                   | hidden                                           |

Read as a sentence: _select the word → the "Define" pill appears → it lingers → it fades → the
selection clears → a brief pause → repeat._ This is the same order of events as the real gesture
(`lookup-trigger.ts` renders only after a real text selection), just looped.

### 2.3 The word/sentence and the pill's markup

A single demo sentence, hard-coded (not derived from real lookup data — constraint 4/S1 exempt
this demo entirely, since it never calls a provider): _"Select a word — like **wanderlust** —
and a definition appears."_ with `wanderlust` as the word that visibly "gets selected."

The pill mirrors `lookup-trigger.ts`'s real markup structure faithfully — same brand mark +
label composition, same token set for border/radius/shadow/color — scaled down for its inline,
in-sentence context (a floating full-size trigger button would visually overwhelm one word in a
paragraph):

```ts
// lookup-trigger.ts:38 (the real pill, for comparison)
btn.innerHTML = `${BRAND_MARK_SVG}<span class="label">Define</span>`;

// onboarding-view.ts demo pill — same composition, `BRAND_MARK_SVG` already imported
// (onboarding-view.ts:2), same `.replace('class="mark"', ...)` sizing-override idiom already
// used once in this file for the hero mark (onboarding-view.ts:79)
`<span class="demo-pill" aria-hidden="true">${BRAND_MARK_SVG.replace(
  'class="mark"',
  'class="mark demo-mark"',
)}<span class="label">Define</span></span>`;
```

### 2.4 Accessibility — one node serves as both the text alternative and the reduced-motion fallback

Two accessibility requirements from the card collapse into a single piece of markup instead of
two:

- _"aria-hidden on the decorative animation"_ — the whole animated sentence (`.demo-anim`,
  containing the sentence, the highlighted word, and the pill) carries `aria-hidden="true"` on
  its wrapping element. One attribute hides the whole decorative subtree from assistive tech;
  individual descendants do not need their own `aria-hidden`.
- _"a text alternative that states the gesture"_ **and** _"reduced-motion fallback: static
  step 1/2/3 fallback"_ — a single `<ol class="demo-steps sr-only">` with three `<li>`s ("Select
  a word while reading.", "Tap the \"Define\" button that appears.", "See the definition
  instantly.") is **always** in the DOM and **never** `aria-hidden`. Its default visual state
  reuses the file's existing `.sr-only` clip-technique class verbatim
  (`onboarding-view.ts:29`) — visually hidden, always readable by assistive tech, regardless of
  motion preference. Under `@media (prefers-reduced-motion:reduce)`, a higher-specificity
  `.demo-steps.sr-only` override un-clips it into a normal visible ordered list **and**
  `.demo-anim{display:none}` hides the animated version — the same node that was the screen-reader
  text alternative becomes the sighted static fallback. This avoids two parallel, potentially
  drifting copies of the same three sentences.

A plain `<span>`, not a `<button>`, is used for `.demo-pill` — it is inert, decorative content
inside an `aria-hidden` subtree. Using a real `<button>` there would still be keyboard-focusable
even under `aria-hidden` (a button's implicit tabindex is not removed by `aria-hidden` on an
ancestor unless also `tabindex="-1"`/`inert`), which is a known axe violation
(`aria-hidden-focus`) — this repo's own axe gate (`packages/app/test/ui/onboarding-view.test.ts:144-146`,
`'has no axe violations'`) would catch that regression.

## 3. The change

### 3.1 `MARKUP` — `packages/app/src/ui/onboarding-view.ts`

Insert between the existing `</div>` that closes `.hero` and the existing
`<section class="panel" aria-labelledby="setup-h">` (`onboarding-view.ts:82-83`):

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

(`aria-hidden="true"` moves to the `.demo-anim` wrapping `<p>` itself, not repeated on
`.demo-pill` — see §2.4.)

### 3.2 `CSS` — `packages/app/src/ui/onboarding-view.ts`

Append, after the existing `.lead{...}` rule and before the existing `.panel{...}` rule
(`onboarding-view.ts:38-39`) — same minified single-line-per-selector style already used
throughout this file's `CSS` template string:

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

No changes to `connectedCallback`, `submit`, `refreshProgress`, `setStatus`, the `value`
setter, or `q<T>` — this is a pure addition to the two existing string constants (`MARKUP`,
`CSS`); every existing method and its tests are untouched.

### 3.3 Token-law check (self-verification)

Every new declaration above reads only `--ad-*`/`--adp-*` tokens (`--ad-line`, `--ad-ink-faint`,
`--ad-ink-soft`, `--ad-ink`, `--ad-selection`, `--ad-line-strong`, `--ad-surface`,
`--ad-shadow-trigger`, `--adp-text-2xs`, `--adp-weight-bold`, `--adp-weight-semi`,
`--adp-tracking-label`, `--adp-font-sans`, `--adp-radius-pill`, `--adp-ease`) plus one bare
`clamp(14px,4vw,20px)` (matching the existing `main{padding:6px clamp(16px,5vw,22px) 30px}`
idiom at `onboarding-view.ts:34`) and the `4.4s`/percentage keyframe values, which are motion
_timing_, not color — outside the token law's scope per the `lookup-trigger.ts:22` precedent
cited in §2.2. No hex/oklch literal appears anywhere in this diff.

## 4. Scope fence (from the card, held exactly)

- **0 API calls.** `onboarding-view.ts` has no wire-protocol or `chrome.*` import today
  (`onboarding-view.ts:1-2`); this change adds none. Trivially satisfied, not just asserted.
- **No video assets.** The demo is CSS keyframes on inline `<span>`s — no image, GIF, or video
  file is added anywhere in the diff.
- **`--ad-*`/`--adp-*` tokens only.** Verified in §3.3.
- **Honors reduced motion.** `@media (prefers-reduced-motion:reduce)` swaps the animated sentence
  for the always-present static three-step list (§2.4).
- **Works before a key exists.** `onboarding-view` _is_ the pre-key screen — there is no
  "before/after key" branch in this file to get wrong.

## 5. Testing strategy

1. **Unit tests** (`packages/app/test/ui/onboarding-view.test.ts`, extending the existing
   `describe('<onboarding-view>', ...)` block, happy-dom):
   - The demo section renders in DOM order between `.hero` and `.panel`.
   - `.demo-anim` carries `aria-hidden="true"`; `.demo-anim` contains no `<button>` (guards the
     axe-hidden-focus regression named in §2.4).
   - `.demo-steps` contains the three step strings and carries `class="sr-only"` by default.
   - `.demo-pill` contains the brand-mark SVG and a `.label` with text `"Define"`.
   - CSS-rule inspection (mirroring `lookup-trigger.test.ts:70-79`'s `CSSMediaRule` pattern
     exactly): the adopted stylesheet has exactly one `CSSMediaRule` whose `conditionText`
     includes `prefers-reduced-motion`, and that rule's nested `cssRules` include a `.demo-anim`
     selector declaring `display:none` and a `.demo-steps.sr-only` selector declaring
     `position:static`.
   - The existing `'uses a single adopted stylesheet'` test (`onboarding-view.test.ts:133-135`)
     stays green unmodified — this change extends the one existing `CSS` string, it does not add
     a second stylesheet.
   - The existing `'has no axe violations'` test (`onboarding-view.test.ts:144-146`) stays green
     unmodified and is the primary regression guard for the `aria-hidden`-focusable trap named in
     §2.4.
2. **e2e** (`packages/extension-chrome/e2e/onboarding.spec.ts`, extending the existing file — no
   new spec file, this is presence/visibility coverage on the same screen the existing three
   onboarding tests already exercise):
   Assertions target the actual toggled CSS properties (`display` on `.demo-anim`, `position`
   on `.demo-steps`) rather than Playwright's `toBeVisible()`/`toBeHidden()` — the sr-only
   clip technique gives `.demo-steps` a non-empty 1×1px bounding box, which Playwright's
   visibility heuristic (non-empty box + not `visibility:hidden`) can read as "visible" even
   though it is clipped to nothing on screen; asserting the precise property side-steps that
   false-positive entirely.
   - Default motion: `onboarding-view .demo-anim` (Playwright locator, pierces the open shadow
     root the same way the existing tests already select `onboarding-view #key`) does not have
     `display:none`; `onboarding-view .demo-steps` has `position:absolute` (the sr-only-clipped,
     default state).
   - `page.emulateMedia({ reducedMotion: 'reduce' })`, called **before** `page.goto(...)` (the
     custom element's shadow DOM is static markup assigned once in `connectedCallback` — the
     media state must already be emulated when the element connects; this ordering mirrors
     `theme.spec.ts:28-29`'s `emulateMedia` → `gotoFixture` sequence for `colorScheme`): now
     `.demo-anim` has `display:none` and `.demo-steps` has `position:static` (the reduced-motion
     fallback state).
   - Both new tests reuse the pre-key seeding used by the existing three onboarding tests — no
     `seedSettings`/`mockGemini` needed, matching those tests' own pattern
     (`onboarding.spec.ts:7-31`).

## 6. Evidence plan

**No screenshots or video** — this repo's evidence policy (owner ruling 2026-07-16, `CLAUDE.md`)
retired media capture for PRs; every PR body instead carries a written **"Testing performed"**
section (suites run, counts, e2e scenarios, gates passed). This lines up exactly with the card's
own scope fence (`docs/ROADMAP.md:648`: _"no video assets"_) — there is no tension between the
card's fence and the repo's evidence convention to resolve; both point the same way.

## 7. Risk / rollback

- **Risk: very low.** Single file touched (`onboarding-view.ts`), purely additive to two string
  constants, zero behavioral/JS changes to any existing method, zero new imports, zero new wire
  surface. The only thing that could regress is the existing onboarding tests, all of which are
  either untouched (existing unit tests) or extended additively (this plan adds new `it()`
  blocks, modifies none).
- **Rollback:** revert the single PR. No stored data, no schema, no wire message — nothing to
  migrate or clean up.

## 8. Files touched (summary)

| File                                               | Change                                             |
| -------------------------------------------------- | -------------------------------------------------- |
| `packages/app/src/ui/onboarding-view.ts`           | + `.demo` section markup, + demo CSS/keyframes     |
| `packages/app/test/ui/onboarding-view.test.ts`     | + unit tests (placement, a11y, reduced-motion CSS) |
| `packages/extension-chrome/e2e/onboarding.spec.ts` | + 2 e2e tests (default motion, reduced motion)     |

No change to any other file — no domain type, wire message, router case, composition root, or
other UI component is touched by this card.
