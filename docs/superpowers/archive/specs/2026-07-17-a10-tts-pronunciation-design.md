# A10 — TTS pronunciation

Roadmap card: `docs/ROADMAP.md` §4 A10 (Impact 3 · Effort S · Score 3.0). Depends on: — (independent).
Related-but-not-blocking: A12 (non-english-source) — see §2.2; A1/A2/A3/A5/A7 all touch the same
card file (see §9 Concurrency).

## 1. Problem (grounded in code)

Today the card's **shipped default** carries no pronunciation information of any kind — which makes
A10's case stronger, not weaker: there is nothing to even misread, let alone hear.

- The prompt is assembled from a code-owned envelope plus one user-editable piece,
  `DEFAULT_OUTPUT_FORMAT` (`packages/app/src/domain/default-template.ts:8-9,32-33` — "the ONLY
  user-editable piece (the 'Card format' field): the section layout shown in the card"). Its full
  text is exactly two sections: `"1. **Eng -> Eng** — a full, complete explanation of the meaning
(do not summarize long senses).\n2. **Eng -> {target_lang}** — translate the full meaning into the
selected language."` (`default-template.ts:32-33`) — **no IPA, no pronunciation section at all.**
  This is genuinely what every real caller seeds: the Chrome and Safari service workers'
  storage-store defaults (`packages/extension-chrome/src/adapters/chrome-storage-store.ts:17,48`,
  `packages/extension-safari/src/adapters/safari-storage-store.ts:17,43`), both `sw.ts`'s inline
  settings fallback (`packages/extension-chrome/src/sw.ts:40`,
  `packages/extension-safari/src/sw.ts:24`), both `options.ts`'s onboarding seed
  (`packages/extension-chrome/src/options.ts:32`, `packages/extension-safari/src/options.ts:16`),
  and settings-form's own "Restore default" action (`packages/app/src/ui/settings-form.ts:518,534`)
  all import and use `DEFAULT_OUTPUT_FORMAT` directly.
- The IPA-bearing templates the roadmap card's "Today" line describes (e.g. `"**IPA** — US
  pronunciation…"`) do exist in the codebase, but only as **pre-#63 legacy** strings kept for a
  narrow migration check: `LEGACY_DEFAULT_TEMPLATES` (`packages/app/src/domain/
legacy-templates.ts:14-63`, doc comment `:1-9`: "Every default prompt template EVER shipped while
  the single-field `promptTemplate` setting existed... A stored value equal to one of these... means
  'the user never customized' — it must NOT be promoted to an envelope override"), consumed
  exclusively by `resolvePromptEnvelope` (`legacy-templates.ts:75-84`) to detect and reset a
  carried-over legacy default at read time — never as a template any current install is seeded
  with. So the only readers who ever see an IPA heading today are (a) an unmigrated legacy install
  whose stored `promptTemplate` still matches one of these three exact strings (transient — the next
  settings read resolves it away, `legacy-templates.ts:79-82`), or (b) a reader who has manually
  typed IPA into their own customized Card format.
- Whatever markdown the model returns (IPA-bearing or not) is sanitized once (S4,
  `packages/app/src/app/markdown-sanitize.ts:67-82`) and dropped into the card as one opaque HTML
  blob: `renderCardState` builds `body.innerHTML = state.safeHtml`
  (`packages/app/src/ui/lookup-card.ts:279`). `body` is **not** the last node in practice: it is
  followed by `renderMetaRow(state)` whenever one is returned (`lookup-card.ts:285-286`), which
  happens whenever `state.provider` is set (`renderMetaRow`'s own guard, `lookup-card.ts:431,436`:
  `if (!state.provider) return null;`) — true for essentially every real result. A10's placement
  logic never depends on body/meta-row ordering either way — it only needs the headword `<h2>`'s
  position (§2.1). There is no `ipa` field anywhere in `LookupResult`
  (`packages/app/src/domain/types.ts:41-86` — only `definedAs`/`translation`/`nudge` are parsed out
  of the model's text; IPA is not, shipped default or legacy) — whatever pronunciation text exists,
  it is always undifferentiated text inside the sanitized blob, never a discrete field.
- There is no speaker/pronunciation control anywhere in `lookup-card.ts`'s current action set
  (`button[data-act]` in the bar: close/side-panel/settings, `:101-113`; the save row's star/status
  buttons, `:322-380`) or in `packages/app/src/ui/styles/tokens.ts`'s icon set
  (`ICON_SETTINGS`/`ICON_CLOSE`/`ICON_SHIELD`/`ICON_TRASH`/`ICON_SIDE_PANEL`/`ICON_STAR`,
  `tokens.ts:184-215`).

Net effect: on the shipped default template, a reader gets **zero** pronunciation information —
nothing to sound out, correctly or not. On a legacy/unmigrated or custom template that does include
IPA, a reader who can't read IPA sees `/ˌsɛrənˈdɪpɪti/` and still has no way to learn how the word
actually sounds. Either way, nothing in the card lets a reader hear the word.

## 2. Design questions (pinned)

### 2.1 Where does the button go, given IPA isn't a real field? ("next to IPA")

The card's fence phrase is "button placement (next to IPA)" (dispatch notes), but §1 establishes
IPA is **not** a discrete, addressable part of the card's data model — it's untyped text inside
`state.safeHtml`, whose shape a reader controls via Card format. Three placements considered:

**(a) Parse/locate the IPA line inside `state.safeHtml` and inject the button next to it via DOM
traversal of the sanitized output.** Rejected: (i) not reliable — a customized Card format may
omit IPA, rename the heading, or put it anywhere; (ii) `body.innerHTML = state.safeHtml`
(`lookup-card.ts:279`) is treated elsewhere in this codebase as the exact, untouched output of the
S4 sanitizer — walking into it and splicing a non-model control node in is a new kind of mutation
this file has never done to sanitized content, and buys fragility for a cosmetic win.

**(b) Wrap the headword `<h2>` in a new header container with the button alongside it.** Rejected:
`renderSaveRow`'s own doc comment (`lookup-card.ts:314-321`) already discovered and documented this
exact trap for the save row — `::slotted()` (CSS Scoping) **only matches top-level assigned
nodes**, so wrapping `<h2>` in a `<div>` would silently drop the entire `::slotted(h2)` rule
(`lookup-card.ts:119` — the serif font, the type scale, and the signature underline-swatch
background). The save row solved this by staying a **top-level sibling of `<h2>`**, never a
wrapper; the same constraint applies here.

**(c) Pinned — a new top-level light-DOM node, `.speak-btn`, inserted as `<h2>`'s next sibling
(before the save row).** `::slotted(h2)` is `display:inline-block` (`lookup-card.ts:119`); giving
`.speak-btn` `display:inline-flex` and placing it immediately after `<h2>` in the node list makes it
flow onto the same visual line as the headword — the closest a top-level-siblings-only DOM model
gets to "next to" the word whose pronunciation it controls, and structurally identical in kind to
how the save row already sits directly under the headword. This is the only option that (i) never
touches sanitized model output, (ii) never risks the `::slotted(h2)` styling contract, (iii) needs
no Card-format-shape assumption.

### 2.2 Voice/lang selection heuristic — and the fence most likely to be missed

The obvious approach — `utterance.lang = 'en-US'` and let the browser pick any matching installed
voice — has a real hazard: `SpeechSynthesisVoice` has a standard `localService: boolean` field
(`readonly localService: boolean` — whether the voice is synthesized on-device or by calling out to
a remote server; part of `lib.dom.d.ts`, no extra typing needed). Many browsers, including Chrome's
bundled "Google US English"-style voices, offer **non-local** voices that send the utterance text to
a remote TTS service to be synthesized. Roadmap §3 constraint 1 is unconditional: **"100% local. No
backend, no accounts... nothing else leaves the browser except the AI API call itself"** — and the
card's own fence says **"No cloud TTS"** in as many words (`docs/ROADMAP.md:209`). Letting the
browser silently pick _any_ matching-language voice would let a remote voice occasionally satisfy
that fence violation on the reader's behalf, invisibly.

**Pinned:** every voice lookup filters to `v.localService === true` first; only local voices are
ever eligible to speak. If zero local voices match, treat it identically to "no voices at all" (hide
the button) — never fall back to a remote voice just to make the button work. Concretely:

```ts
function pickLocalEnglishVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | undefined {
  const local = voices.filter((v) => v.localService && v.lang.toLowerCase().startsWith('en'));
  return local.find((v) => v.lang === 'en-US') ?? local[0];
}
```

**Why English, and why hard-coded (not detected):** `LookupRequest`/`LookupResult` carry no source
language today. `renderTemplate`'s `resolved` object hard-codes
`source_lang: vars.source_lang ?? 'English'` (`packages/app/src/domain/prompt-template.ts:23`), and
no caller ever passes `source_lang` — confirmed by `http-lookup-client.ts`'s `buildPrompt` call
(`packages/app/src/app/http-lookup-client.ts:85-91`), which omits it. Every lookup today is
English-sourced by this fallback, so `'en-US'`-first is not a guess, it is what the product actually
does. **A12 relationship:** A12 (non-english-source, not yet built as of this card) will eventually
add real source-language detection to `LookupRequest`/`LookupResult`. When it ships, this function's
`'en'` prefix filter is the one place that would need to read a per-lookup source language instead
of a hard-coded constant — noted as the extension point, **not implemented here** (A10's own fence
has no dependency on A12, and A12 is sequenced after this card).

**Rejected alternative — let the browser's own `lang` matching pick any voice.** This is exactly the
"any matching voice regardless of `localService`" hazard above; rejected for the same reason.

### 2.3 Availability degradation — "no voices → hide button"

Browsers commonly return `speechSynthesis.getVoices() === []` synchronously on the very first call,
then populate the list asynchronously and fire a one-time `voiceschanged` event
(well-documented Web Speech API behavior; Chrome in particular does this on cold start). A button
that's visible but silently does nothing (`speak()` with no matching voice is a silent no-op) reads
as broken, not absent.

**Pinned:**

1. If `globalThis.speechSynthesis` doesn't exist at all (API entirely unsupported), the button is
   **omitted** (the render function returns `null`, no node is created) — not disabled, not hidden.
   A control that can categorically never work has no reason to occupy layout space.
2. If the API exists, the button renders with the `hidden` attribute set. `pickLocalEnglishVoice` is
   checked synchronously once at render time (covers the common case of a browser that already has
   its voice list warm) — if it finds a match, `hidden` is cleared immediately.
3. If no match yet, a **one-shot** `voiceschanged` listener (`{ once: true }`) re-runs the same
   check; if that populates a matching local voice, `hidden` is cleared then.
4. If `voiceschanged` never fires, or fires but never yields a matching local voice (§2.2), the
   button **stays hidden forever** for that card render — which is exactly the fence's stated
   degradation ("no voices → hide button"), not a bug.
5. The same "no match → do nothing" check is repeated **again at click time** (not just at reveal
   time), because the voice list is a live, mutable global the click handler doesn't own — if it
   degraded between render and click, the click is a safe no-op rather than a guess.

**Rejected alternative — poll `getVoices()` on an interval until non-empty.** Unnecessary: the
platform already provides an event for exactly this ("the voice list changed, check again") and a
poll loop would need its own teardown story for a light-DOM node this file doesn't otherwise track
after render.

### 2.4 Content-script execution context — where does `speechSynthesis` actually run?

`SpeechSynthesis`/`SpeechSynthesisUtterance` are standard `Window` Web APIs (not `chrome.*`), present
in every JS realm this codebase runs UI code in:

- **Chrome, in-page card:** `renderCardState` is invoked by `InlineBottomSheetRenderer.setState`
  (`packages/app/src/app/inline-bottom-sheet-renderer.ts:74-82`), which is instantiated inside
  `content.ts` — the **isolated-world** content script
  (`packages/extension-chrome/src/content.ts:20`: `new InlineBottomSheetRenderer(document.body,
undefined, { sidePanel: true })`). Content scripts in Chrome's default isolated world have their
  own JS globals but do have working access to standard Web Speech APIs (this is the same class of
  API as `fetch`, already used from this exact isolated world elsewhere in the codebase) — calling
  `speechSynthesis.speak()` from here genuinely produces audio in the tab.
- **Chrome, side panel:** `side-panel-view.ts` calls the same shared `renderCardState`
  (`packages/app/src/ui/side-panel-view.ts:191`) from `side-panel.ts`, which is its own ordinary
  extension page (a ordinary top-level document, not a content script at all) — no world-boundary
  question there.
- **Safari:** `content.ts` has no MAIN/isolated split at all — one script registers the custom
  elements and builds `InlineBottomSheetRenderer` in the same world
  (`packages/extension-safari/src/content.ts:11,14`; manifest has a single content script entry,
  `packages/extension-safari/src/manifest.json:12-14`, no `world` key). Speaking from Safari's
  content script needs no extra plumbing either.

**Pinned:** the speak button's click handler calls `speechSynthesis.speak()` **directly**, inline,
in `lookup-card.ts` — the same file that already calls `document.createElement`/`document.head`
directly (`ensureCardDocStyles`, `lookup-card.ts:179-186`) without any platform abstraction. No new
composed DOM event, no `content.ts`/`side-panel.ts`/`sw.ts` wiring: unlike `toggle-save` or
`open-settings`, this control needs no `chrome.*` call and no cross-context relay, so adding one
would only add surface area for zero benefit. This keeps the entire feature to `lookup-card.ts` (+
one new icon in `tokens.ts`) plus one small addition in `inline-bottom-sheet-renderer.ts` (§4.3) —
and it ships to **both** Chrome and Safari for free, since both platforms funnel through the same
shared `InlineBottomSheetRenderer`/`renderCardState`.

**Rejected alternative — dispatch a composed `speak` event to `document`, handled in
`content.ts`/`side-panel.ts` like `toggle-save`/`toggle-status`/`dismiss-nudge`.** Rejected: those
events exist specifically to reach a `chrome.*` API (`chrome.storage`, `chrome.runtime.sendMessage`,
`chrome.runtime.openOptionsPage`) that only the composition root can call. `speechSynthesis` needs no
such relay — routing it through an event round-trip would add two new files' worth of wiring (plus a
third for Safari) to save nothing, and would still execute in the exact same isolated-world context
this section already grounds as safe.

### 2.5 Reduced-motion / no-autoplay

- **No-autoplay:** `speechSynthesis.speak()` is called from exactly one place — the button's
  `click` listener. Nothing in `renderCardState`, `renderSpeakButton`, or the render pipeline ever
  calls `.speak()` on its own; a fresh result render only ever calls `.cancel()` (§4.1), which stops
  audio, never starts it.
- **Reduced-motion:** `.speak-btn` gets the same hover/focus color transition every other
  `data-act`-style icon button in this file already has, and the same
  `@media (prefers-reduced-motion: reduce)` neutralizer (`lookup-card.ts:113` is the existing
  precedent for `button[data-act]`; `.save-btn`/`.status-btn` repeat the pattern in `CARD_DOC_CSS`).
  No new animation is introduced (no pulsing "speaking…" indicator — see §2.6), so this is purely
  "don't regress the existing convention," not a new behavior to design.

### 2.6 Scope not taken: a "speaking…" state / stop affordance

Considered and rejected as scope creep beyond the card's Effort-S fence: a distinct
in-progress/"speaking" visual state, or a dedicated stop button separate from re-clicking speak. The
roadmap card's fence is "Browser `speechSynthesis` only… Speaks the word only… No cloud TTS" — it
says nothing about playback-state UI. §4.1's "cancel before speak" behavior already means a second
click (or a new lookup) cleanly interrupts any in-flight utterance without a dedicated stop control.

## 3. The change

### 3.1 `packages/app/src/ui/styles/tokens.ts`

Add one new icon constant, following the existing stroke-SVG convention (`ICON_STAR` etc.,
`tokens.ts:184-215`), placed after `ICON_STAR`:

```ts
// Speaker (say the word aloud) — card headword row, A10. A speaker cone + two sound-wave arcs,
// stroked with currentColor like every other icon in this set.
export const ICON_SPEAKER =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M4 9.5h3.2L11 6v12l-3.8-3.5H4z"/><path d="M15.2 9.2a4 4 0 0 1 0 5.6"/><path d="M17.7 6.8a7.6 7.6 0 0 1 0 10.4"/></svg>';
```

### 3.2 `packages/app/src/ui/lookup-card.ts`

- Import `ICON_SPEAKER` alongside the existing icon imports at the top of the file.
- New module-private function `pickLocalEnglishVoice` (§2.2's exact code).
- New module-private function `renderSpeakButton(word: string): HTMLButtonElement | null` (§2.3's
  algorithm; full code in the plan's Task 1).
- `renderCardState` gains one line at its very top (before the `state.kind === 'loading'` branch):
  `globalThis.speechSynthesis?.cancel();` — cancels any in-flight utterance on **every** state
  transition (loading, result, or error), so speech never survives past the word it was for.
- The `'result'` branch's `nodes` array construction changes from
  `const nodes: Node[] = [h, renderSaveRow(state)];` to building `h` first, then conditionally
  splicing in `renderSpeakButton(state.word)` right after it, then `renderSaveRow(state)` — full
  diff in the plan.
- CSS: one new `::slotted(.speak-btn)` layout rule in the shadow `CSS` template (top-level-sibling
  placement, §2.1c), and one new `lookup-card .speak-btn{…}` box-decoration block in `CARD_DOC_CSS`
  (mirroring the `.save-btn`/`.status-btn` split — decorations for a slotted node's _own_ box can
  live in `CARD_DOC_CSS` exactly like its siblings already do), including the
  `prefers-reduced-motion` neutralizer (§2.5).

### 3.3 `packages/app/src/app/inline-bottom-sheet-renderer.ts`

`close()` (currently just `sheet.remove()` + nulling out fields, `:168-172`) gains one line at its
top: `globalThis.speechSynthesis?.cancel();` — so dismissing the card (Esc, scrim click, the ×
button, a new keyboard `dismiss-lookup` command) also stops any utterance that was still playing.
`renderCardState`'s own cancel-on-render (§3.2) does not cover this path because `close()` never
calls `renderCardState` — it just removes the sheet.

## 4. No change to

- **`packages/app/src/wire.ts` / `packages/app/src/app/router.ts` / `packages/app/src/ports.ts`.**
  §2.4 pins that TTS needs no `chrome.*` call and therefore no wire message, no router case, and no
  new port — the entire feature is a standard Web API call from existing UI code.
- **`packages/extension-chrome/src/content.ts` / `packages/extension-chrome/src/sw.ts` /
  `packages/extension-safari/src/content.ts` / `packages/extension-safari/src/sw.ts`.** No new
  composed DOM event, no message relay, no service-worker involvement — §2.4's rejected alternative.
- **`packages/app/src/ui/side-panel-view.ts`.** It already calls the shared `renderCardState`
  (`side-panel-view.ts:191`) — the speak button appears there automatically, with no side-panel-view
  code change, because the side panel is just another caller of the same render function.
- **`packages/app/src/domain/types.ts` / `LookupResult` / `LookupRequest`.** No new field — the
  button reads `state.word`, already present on every `CardState` of `kind: 'result'`. No E1-style
  persisted-shape question is raised (this card touches no saved/history data at all).
- **`packages/app/src/ui/settings-form.ts`.** A10 is not an opt-in setting (unlike A5's gloss mode) —
  the roadmap card carries no "Lead decides: setting name" item, and the button's own hidden/shown
  state already fully expresses "does this do anything on this machine" (§2.3). No settings-form
  row, no new `Settings`/`PublicSettings` field.
- **`packages/extension-chrome/src/manifest.json` / `packages/extension-safari/src/manifest.json`.**
  `speechSynthesis` is a standard `Window` API — it needs no manifest permission (unlike e.g.
  `chrome.storage`, which does appear in `"permissions"`, `manifest.json:13`). CSP
  (`manifest.json:56-58`) governs script/style/connect _sources_, not native Web API usage; nothing
  here makes a network request for CSP to gate in the first place.
- **`packages/app/src/domain/prompt-template.ts` / `legacy-templates.ts`.** The model's prompt and
  the IPA text it produces are completely untouched — this card adds a control next to the headword,
  it does not change what the model is asked to return or how that markdown is sanitized.

## 5. Scope fence (from the card, held exactly)

- **Browser `speechSynthesis` only, 0 API calls** — §4's no-wire/no-router/no-manifest-change list;
  nothing in this feature makes an HTTP request of any kind.
- **Speaks the word only, never the whole definition** — `renderSpeakButton(word)` constructs
  `new SpeechSynthesisUtterance(word)` from the single `word` argument; `state.safeHtml`/the
  definition body is never passed to the speech API anywhere in this change.
- **No cloud TTS** — §2.2's `localService === true` filter is the concrete mechanism; a
  voice that only offers a remote/cloud path is never eligible to be selected, and its presence
  never reveals the button (§2.3 step 4 treats "only remote voices exist" identically to "no voices
  exist").
- **No new browser permission** — §4.
- **No UI outside `--ad-*`/`--adp-*` tokens** — `.speak-btn`'s new CSS (§3.2) reads only
  `var(--ad-*)`/`var(--adp-*)` custom properties, exactly like every existing icon button in this
  file; no hard-coded color, no per-component `prefers-color-scheme` branch.
- **No autoplay, reduced-motion honored** — §2.5.

## 6. Testing strategy

1. **Unit — `packages/app/test/ui/lookup-card.test.ts`** (new `describe('A10 speak button (TTS
pronunciation)', …)` block, full test code in the plan's Task 1):
   - Omits the button entirely when `globalThis.speechSynthesis` is `undefined`.
   - Shows the button immediately when a local English voice is already present at render.
   - Renders the button `hidden`, then reveals it once a `voiceschanged` event reports a local
     English voice.
   - Stays hidden forever when the only available voice is non-local (`localService: false`) — the
     "no cloud TTS" fence, asserted even after a `voiceschanged` re-fire.
   - Clicking the button: cancels any in-flight utterance first, then speaks with a
     `SpeechSynthesisUtterance` whose `text` is the bare word (not the definition), `voice` is the
     picked local voice, and `lang` is `'en-US'`.
   - A click makes **zero** `speak()` calls if the voice list degraded to empty between render and
     click (the click-time re-check, §2.3 step 5).
   - The button renders only for `kind: 'result'` — absent from both `loading` and `error` states.
   - DOM placement: `<h2>`'s `nextElementSibling` is `.speak-btn`; `.speak-btn`'s
     `nextElementSibling` is `.save-row`.
   - `renderCardState` calls `speechSynthesis.cancel()` on every call — loading, result, **and**
     error transitions each increment the same cancel-call count.
   - `aria-label` is exactly `Say "<word>" aloud` for the rendered word.
2. **Unit — `packages/app/test/app/inline-bottom-sheet-renderer.test.ts`**: `close()` calls
   `speechSynthesis.cancel()` (isolated from the cancel call `renderResult` itself already makes,
   via `mockClear()` before asserting); `close()` does not throw when `speechSynthesis` is
   `undefined`.
3. **e2e — new `packages/extension-chrome/e2e/a10-tts-pronunciation.spec.ts`**: after a mocked
   lookup renders, `.speak-btn` exists exactly once with `aria-label="Say \"bank\" aloud"`, and a
   forced click (`{ force: true }`, bypassing Playwright's visibility wait) produces **zero**
   `pageerror` events. See §6.1 below for why this suite intentionally does not assert the button's
   `hidden` state or that real audio/`speak()` fired.

### 6.1 Why e2e does not assert voice-driven visibility or actual `speak()` calls

Two independent, grounded reasons, not a coverage shortcut:

- **World boundary.** §2.4 establishes the speak button's click handler runs inside `content.ts`'s
  isolated world (Chrome) — the same class of boundary this codebase has already hit once, on the
  card's own `.state` property setter (documented Chromium bug 390807,
  `inline-bottom-sheet-renderer.ts:76-79`). Playwright's `page.addInitScript` (or any page-level
  script injection) only reaches the page's default **MAIN** world; it cannot patch or observe the
  isolated world's own `speechSynthesis` binding. There is no supported Playwright API for injecting
  into a Chrome extension's isolated content-script world, so `speak()`/`cancel()` calls made from
  there cannot be intercepted from e2e the way `mockGemini`/`mockOpenAI` intercept network calls
  (those work by routing at the **network** layer via `context.route`, which is world-agnostic —
  speech synthesis has no network layer to route).
- **Non-deterministic CI voice list.** Even if the world boundary weren't an issue,
  `speechSynthesis.getVoices()`'s actual contents depend on what TTS engines are installed on the
  machine running the browser (e.g. `speech-dispatcher` on Linux) — something this repo's CI
  environment does not control or guarantee, and asserting a specific outcome (button visible vs.
  hidden) would make the suite flaky in either direction depending on the runner.

Full behavioral coverage of the voice-list branching (§2.2/§2.3) therefore lives entirely in the
unit tests (§6 item 1), where `speechSynthesis`/`SpeechSynthesisUtterance` are fully-controlled
`vi.stubGlobal` doubles — no world boundary exists inside a single Vitest/happy-dom process. The e2e
suite is a structural/non-crash smoke test only: the button exists, is labeled correctly, and a
click — regardless of what this machine's real voice list happens to contain — never throws.

## 7. Testing performed (PR evidence — replaces screenshot/video capture)

Per this worktree's `CLAUDE.md` (owner ruling 2026-07-16): **no screenshots or video for this PR.**
The PR body's "Testing performed" section lists the suites run, test counts, e2e scenarios exercised
(§6), and gates passed (lint, format check, typecheck, unit, e2e) instead. No `pr-assets/*` branch is
created for this card.

## 8. Risk / rollback

- **Risk: low.** The change is additive-only inside one shared render function plus one existing
  `close()` method; no existing node, class, or event this file already emits is removed or
  renamed. The riskiest single behavior — "never let a non-local voice satisfy the no-cloud-TTS
  fence" (§2.2) — is a pure filter with no side effects if it under-matches (worst case: the button
  stays hidden on a machine that actually does have local voices under a language tag this filter
  doesn't recognize, e.g. `'eng'` instead of `'en'` — a availability regression, never a
  cloud-TTS leak).
- **No data migration.** No persisted shape changes anywhere (§4) — nothing about `CardState`,
  `LookupResult`, or storage differs; this card is entirely ephemeral render-time behavior.
- **Rollback:** revert the single PR. `renderCardState`/`close()` return to their pre-A10 bodies
  exactly; no stored data or wire shape needs any follow-up cleanup.

## 9. Files touched (summary)

| File                                                          | Change                                                                                                                                                                       |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/app/src/ui/styles/tokens.ts`                        | + `ICON_SPEAKER`                                                                                                                                                             |
| `packages/app/src/ui/lookup-card.ts`                          | + `pickLocalEnglishVoice`, `renderSpeakButton`; `renderCardState` cancels-on-render + splices in the button; + CSS (`::slotted(.speak-btn)`, `CARD_DOC_CSS` box decorations) |
| `packages/app/src/app/inline-bottom-sheet-renderer.ts`        | `close()` + one `speechSynthesis?.cancel()` line                                                                                                                             |
| `packages/app/test/ui/lookup-card.test.ts`                    | + `describe('A10 speak button …')` block (§6.1)                                                                                                                              |
| `packages/app/test/app/inline-bottom-sheet-renderer.test.ts`  | + 2 tests for `close()`'s cancel call                                                                                                                                        |
| `packages/extension-chrome/e2e/a10-tts-pronunciation.spec.ts` | new — smoke e2e (§6.3)                                                                                                                                                       |

No change to `packages/app/src/wire.ts`, `packages/app/src/app/router.ts`, `packages/app/src/ports.ts`,
`packages/app/src/domain/types.ts`, `packages/app/src/ui/side-panel-view.ts`,
`packages/app/src/ui/settings-form.ts`, `packages/extension-chrome/src/content.ts`,
`packages/extension-chrome/src/sw.ts`, `packages/extension-safari/src/content.ts`,
`packages/extension-safari/src/sw.ts`, or either package's `manifest.json`.

## 10. Concurrency

Per CONTRACTS §5, files this card modifies that other **unshipped** roadmap cards also modify, so
the orchestrator serializes work on them:

- **`packages/app/src/ui/lookup-card.ts`** — the single hottest file in the whole batch: also
  touched by A1 (streamed answers), A2 (recursive lookup), A3 (follow-up chips), A5 (gloss mode), and
  A7 (pin cards). A10's edits are additive and localized (one new top-level sibling node between
  `<h2>` and the save row, one new top-of-function cancel call, two new CSS blocks) — low textual
  overlap with A1/A3's body-rendering changes or A2/A7's card-chrome changes, but still needs
  sequencing/rebasing, not parallel unmediated edits.
- **`packages/app/src/ui/styles/tokens.ts`** — not in CONTRACTS' named hot-file list, but multiple
  other A-cards plausibly add their own icons (A2's Back button, A7's pin icon, etc.); each addition
  is an independent new `export const ICON_*`, so conflicts are expected to be mechanical
  (adjacent-line) rather than semantic.
- **`packages/app/src/app/inline-bottom-sheet-renderer.ts`** — not in CONTRACTS' named list either,
  but A7 (multiple simultaneous pinned cards) is likely to restructure how cards are hosted by this
  file; A10's single added line in `close()` is small but still worth flagging for sequencing.

No other file this card touches (`tokens.ts`'s icon addition aside) appears on CONTRACTS §5's hot-file
list, and this card touches none of the explicitly-called-out shared surfaces (settings-form,
content-script/trigger, side panel, prompt-builder, `docs/index.html`, wire+router).
