# C3 — Guided first lookup

> **Revision history**
> **2026-07-16 v2 — mechanism superseded per the roadmap's landing-page revision** (`docs/ROADMAP.md`
> §4 C3, §8 decision log entry "Category C revision · The landing page becomes an onboarding
> asset"). v1's mechanism — the options page hosting a real lookup pipeline in-page (a new
> `mountTryIt` composition wiring `runLookupWorkflow`/`DomSelectionSource`/`ChromeFloatingTrigger`/
> `InlineBottomSheetRenderer`/`MessageRelayLookupClient` plus a scoped `createDomReader` domain
> change) — is **fully replaced**, not layered on top of. The new mechanism opens the project's
> public landing page (`docs/index.html`, served at <https://hieplam.github.io/ai-dict/>) to a
> practice section where **the real, already-running content script** performs the real gesture.
> Effort drops **M → S**; zero domain/`packages/app` core code changes; zero `wire.ts`/`router.ts`
> changes (both true in v1 too, but v1 still needed a new domain factory function and a large
> composition-root wiring block — v2 needs neither). This document is v2, written fresh against
> the current (pre-C2, pre-C3) code; nothing below should be read as v1 with edits — v1's
> options-page pipeline recomposition is not part of this design at all.

Roadmap card: `docs/ROADMAP.md` §4 C3 (Impact 5 · Effort S · Score 5.0, revised 2026-07-16).
Depends on: C2 (verified activation) — this card starts from C2's post-activation **success**
state and treats every C2 decision as frozen (see
`docs/superpowers/specs/2026-07-16-c2-verified-activation-design.md`): persist-first key testing,
persist-only-on-pass, the "Save anyway" escape hatch scoped strictly to `NETWORK`-class failures,
and zero changes to `wire.ts`/`router.ts`. This spec adds no wire message and no router case
either.

## 1. Problem (grounded in code)

Today, the moment a key is saved (activated), `mountOnboarding`'s `save` listener
(`packages/extension-chrome/src/options.ts:189-206`, current pre-C2 code — C2's own spec rewrites
this same listener, §4.2 there) persists it and swaps straight to the settings screen with a
single status sentence:

> "You're all set. Highlight any word while reading and choose Define to look it up."
> (`options.ts:202`)

That sentence is the _entire_ handoff — the reader is told what to do, then sent away to do it
alone, on some other page, at some later moment. Nothing on this screen lets them practice the
gesture or see a real result before they leave. The roadmap's revised **Missing** is precise:
"After verified activation (C2), the success screen offers one primary action — 'Try it on a real
page' — which opens the landing page's try-it section: a curated practice passage where the user
performs the REAL gesture (select a word → the real Define pill → the real card, their key, one
explicitly-labelled call)." C2 closes "did my key work?"; C3 closes "do I know how to use this?" —
and, as of this revision, it closes it on a page we already own and that the extension already
runs on.

## 2. The revision's key fact: the landing page already runs the real content script

`docs/index.html` is a normal webpage, served by GitHub Pages from `/docs` on `master`
(`docs/ROADMAP.md` §4 Category C intro, "The landing page is an onboarding asset"). It is not a
`chrome-extension://` page. `manifest.json`'s `content_scripts` match `<all_urls>`
(`packages/extension-chrome/src/manifest.json:29-40`), and `content.ts` — the exact same script
that runs on every reading page — composes the real pipeline unconditionally at module load
(`packages/extension-chrome/src/content.ts:1-33`):

```ts
const settings = new MessageRelaySettingsStore(chrome.runtime);
// ...
runLookupWorkflow({
  selection: new DomSelectionSource(document, ...),
  trigger: new ChromeFloatingTrigger(),
  renderer: /* InlineBottomSheetRenderer-backed */,
  client: new MessageRelayLookupClient(chrome.runtime),
  settings: themedSettings,
  ...
});
```

An installed, activated extension therefore already renders the real "Define" pill and the real
card on `https://hieplam.github.io/ai-dict/` today, on any selectable text, with **zero code
change** — the same way it already does on every other page on the internet. This is the fact that
drops Effort M → S: v1's entire reason for existing (the options page is a trusted
`chrome-extension://` context that content scripts cannot reach, so it needed its own bespoke
in-page pipeline, §2.1-2.2 of v1) simply does not apply to a page the content script already
covers. **This card's job is not "build a lookup surface" — it already exists. This card's job is
(a) give that surface a good practice passage and a stable anchor, and (b) put a button in front
of the activated user that sends them there.**

### 2.1 What this means was true, and is no longer true

v1 pinned "the options page runs the real pipeline in-page" (v1 §2.2) because a bundled/embedded
demo page was rejected (v1 §2.1) and the options page was the only surface at hand. Both of those
premises were correct _for the options page_. They are simply moot once the practice surface moves
to a page content scripts already reach. Nothing in v1 §2 was wrong when written; it answered a
question ("how does the options page host a real lookup?") that this revision no longer asks.

## 3. The change

### 3.1 `docs/index.html` — a new `#try` section

**Pinned anchor: `#try`.** Placed after `#start` (Get started) and before `#faq`
(`docs/index.html:1477-1534`), i.e. right where a reader who just finished setup naturally lands
next, and just above the FAQ that already carries the "why doesn't Define show up" troubleshooting
entry (`faq-q6`/`faq-a6`, `docs/index.html:1809-1810`) this section can point to.

**Pinned passage: reuse the existing "serendipity" practice sentence**, `Finding that café was
pure serendipity.` — the same sentence v1 put on the options page (v1 §5.2) and the same one
`packages/app/src/ui/settings-form.ts`'s own `DEV_DEMO` constant already uses
(`settings-form.ts:20-24`, `context: 'Finding that café was pure serendipity.'`). Reusing it is
deliberate, not laziness: it is already the demo sentence a developer sees in Settings' developer
mode, so the whole codebase's "canonical practice sentence" stays one sentence, not two to keep in
sync.

**Distinct from the hero's static mock — pinned, not reused.** `docs/index.html`'s hero already
renders a hand-built, CSS-only "tableau" mimicking the card for visitors who haven't installed
anything (`.tableau`/`.sel-anchor`/`.selected-word`/`.define-pill`/`.ad-card`,
`docs/index.html:1023-1080`) — it is `role="img"`, inert markup, not real selectable text wired to
anything, and it must stay that way (it is the product's cold-visitor pitch and must render
identically with or without the extension installed). The new `#try` section is the opposite: a
plain `<p>` of real page text with no special markup beyond a `<mark>` for the target word — the
_only_ thing that makes its "Define" pill real is that it is ordinary HTML on an ordinary page the
already-running content script already covers. The two must never be confused or merged: the hero
tableau is marketing, `#try` is a live practice surface, and only `#try` can plausibly render a
real card (for an installed, activated visitor) or nothing at all (for everyone else, gracefully —
§3.3).

Markup (inserted between the existing `<hr class="rule" />` that currently separates `#start` and
`#faq`, `docs/index.html:1531`):

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

Nav link (`docs/index.html:963`, between the existing `#start` and `#faq` entries):

```html
<a href="#start" data-i18n="nav-start">Get started</a>
<a href="#try" data-i18n="nav-try">Try it</a>
<a href="#faq" data-i18n="nav-faq">FAQ</a>
```

CSS (token-only, added to the existing `<style>` block, mirroring `.lede`/`.caption`'s existing
rules elsewhere in the file — no hard-coded color; `mark` reuses the same accent-soft/accent-ink
pairing the rest of the page's info callouts use):

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

**i18n — the page's existing pattern, not a new one.** `docs/index.html` is bilingual via a small
inline script (`docs/index.html:1819-1862`): every element tagged `data-i18n="<key>"` has its
_authored_ (English) `textContent` captured into an in-memory `EN` map the first time any language
is applied, and the `VI` object (a plain JS dictionary literal, `docs/index.html:1705-1817`)
supplies the Vietnamese string for that same key when the visitor picks VI. There is no build step
— the English strings are simply what is typed into the HTML above, and this card's only added
responsibility is appending the matching six keys to the `VI` object (inserted after the existing
`'start-onboarding-img-alt'` entry, `docs/index.html:1796`, before `'faq-eyebrow'`,
`docs/index.html:1797`):

```js
'nav-try': 'Dùng thử',
'try-eyebrow': 'Không phải bản demo',
'try-h2': 'Dùng thử ngay tại đây',
'try-lede': 'Đây là văn bản thật trên trang, không phải bản dựng sẵn. Nếu bạn đã cài AI Dictionary và kích hoạt khoá, hãy chọn một từ bất kỳ bên dưới — hoặc bất cứ đâu trên trang này — rồi chọn Define. Thẻ hiện ra là thẻ thật, chạy bằng khoá của chính bạn.',
'try-caption': 'Không có gì chạy cho đến khi bạn chọn văn bản và bấm Define — một lượt tra cứu duy nhất, dùng khoá đã lưu của bạn. Nút không hiện? Xem mục “Tại sao nút Define không xuất hiện?” bên dưới.',
'try-faq-link': '“Tại sao nút Define không xuất hiện?”',
```

The practice sentence itself (`#try-sentence`) is **not** translated — it stays the fixed English
practice sentence in both languages, the same way the hero tableau's sample sentence is English in
both languages today (`docs/index.html:1032-1038` carries no `data-i18n`). This is not an
oversight: the product's source-language handling is English-only today (`{source_lang}` is
hard-coded, roadmap A12), and A12's own 2026-07-16 escalation ruling was "build, don't advertise" —
this card does not touch source-language detection and must not quietly imply it does by
translating the one piece of source text on the page.

### 3.2 `packages/app/src/ui/settings-form.ts` — the activation-success CTA

New markup, inserted in `MARKUP` right after `<h1 class="title">Settings</h1>`
(`settings-form.ts:143`) and before the Connection `<section>` (`settings-form.ts:144`) — the same
insertion point v1 used, but far smaller content (a CTA, not a practice section):

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

New CSS (token-only, mirroring the existing `.env-notice` info-panel treatment at
`settings-form.ts:102` for the section surface, and reusing the already-defined `button.primary`
style at `settings-form.ts:116` — no new button CSS needed):

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

New public API on the `SettingsForm` class (near `keyFromEnv`/`errorReporting`,
`settings-form.ts:409-428`) — a single property, versus v1's three (`tryIt`, `containsTryIt`,
`markTryItSucceeded`); there is no in-page selection to scope and no in-page success state to
track, because there is no in-page lookup at all:

```ts
/** C3: show/hide the post-activation "Try it now" CTA. Set true exactly once, by the
 * composition root, right after a verified activation succeeds (see options.ts). */
set tryIt(show: boolean) {
  if (!this.shadowRoot) return;
  this.q<HTMLElement>('#tryit-cta').hidden = !show;
}
```

Wire the button in `connectedCallback` (alongside the existing `relay(...)` calls at
`settings-form.ts:309-312`):

```ts
this.relay('#tryit-open', 'tryit-open');
```

`SettingsFormValue`/`collect()` (`settings-form.ts:29-45`) are untouched — the CTA is ephemeral UI,
never persisted, never part of the settings save contract.

### 3.3 `packages/extension-chrome/src/options.ts` — composition root

1. A new top-level constant (Chrome-shell-only; not exported from `@ai-dict/app`, since the
   landing page URL is a Chrome-build/store detail, not a portable-core concern):

```ts
const TRY_IT_URL = 'https://hieplam.github.io/ai-dict/#try';
```

2. `mountSettings` gains a 3rd optional argument (`options.ts:84-111`):

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

`chrome.tabs.create` needs no manifest permission beyond what is already granted — MV3's `tabs.*`
CRUD calls (`create`/`update`/`remove`) work without the `tabs` permission; that permission only
gates reading another tab's `url`/`title`/`favIconUrl`, which this call never does.
`sw.ts:195` already calls `chrome.tabs.sendMessage` today with the same unmodified
`"permissions": ["storage", "sidePanel"]` set (`manifest.json:14`), confirming the pattern needs
nothing new.

3. The (C2-rewritten) activation success branch passes the flag — the **only** change to that
   listener this card makes:

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

Note for whoever implements this: by the time this task runs, C2 will already be merged, so the
exact surrounding code is C2's real `save` listener, not the pre-C2 snippet quoted in §1 — anchor
on the literal status string `"You're all set."`, which is stable across both.

**Not done, and deliberately so:** `registerContentElements()`, `runLookupWorkflow`,
`DomSelectionSource`, `createDomReader`, `InlineBottomSheetRenderer`, `MessageRelayLookupClient`,
`ChromeFloatingTrigger` — none of v1's reused pipeline pieces are imported into `options.ts` by
this revision. The options page hosts a button, nothing else; the real lookup pipeline it points at
already runs, unmodified, wherever the content script already runs. **Zero lines change in
`packages/app/src/wire.ts`, `packages/app/src/app/router.ts`, `packages/app/src/ports.ts`, or
`packages/app/src/app/dom-selection-source.ts`.**

### 3.4 Offline / unreachable fallback — one wall, satisfied by construction

**Pinned: the button stays visible unconditionally; today's status copy is never removed or
replaced.** The activation success screen already shows the frozen C2 status sentence, "You're all
set. Highlight any word while reading and choose Define to look it up." — this card adds the
`#tryit-cta` block alongside that sentence (`form.setStatus(...)` and `form.tryIt = true` are two
independent calls touching two independent, always-both-visible parts of the DOM, §3.2/§3.3). There
is no branch that hides the button when offline, for three reasons, each closing a failure mode:

1. **Clicking it is harmless even with no network.** `chrome.tabs.create({ url })` always succeeds
   as a browser call (a tab opens); if the network is down, that tab shows Chrome's own native
   offline error page — no console error, no extension-side exception, no dangling state, and zero
   API/token cost (constraint 4 — this is a navigation, not a lookup).
2. **The original settings tab is untouched.** Opening a new tab never closes or navigates the
   settings tab the reader is already on, so the frozen "Highlight any word…" instruction is still
   sitting right there, unobscured, the moment they look back.
3. **`navigator.onLine`-style pre-checks are unreliable and were rejected.** Feature-detecting
   connectivity client-side is a known false-positive/false-negative trap (captive portals, DNS-only
   outages, browser inconsistency) — hiding the button on a wrong guess would remove a working path
   for a reader who is, in fact, online. Always-showing plus a harmless failure mode dominates a
   flaky guess.

This satisfies the card's "Offline/unreachable fallback... the button can still be shown" note
directly, and needs no new code to do it — it falls out of never touching the existing status
line.

### 3.5 A corrected claim from v1: `configuredProviders` was never actually a blocker

v1 §2.5 claimed the onboarding write's stale persisted `configuredProviders: []`
(`options.ts:194`, current pre-C2 code — never sets this field) would block a real lookup, because
`runLookupWorkflow`'s client-side guard reads `settings.configuredProviders.length === 0`
(`packages/app/src/domain/workflow.ts:60`) before ever calling the lookup client. **Re-verified for
this revision and found incorrect as a blocker claim:** that guard reads `PublicSettings`, which is
never the raw stored object — it is _computed fresh_ on every `settings.get()` call by
`ChromeStorageStore.get()` (`packages/extension-chrome/src/adapters/chrome-storage-store.ts:44-60`):

```ts
configuredProviders: configuredProvidersFor(s ?? {}, { envGeminiKey: this.envGeminiKey }),
```

and `configuredProvidersFor` (`packages/app/src/domain/types.ts:101-110`) derives the array
directly from whether `apiKey`/`openaiApiKey`/`anthropicApiKey` are non-empty — **it never reads
the stored `configuredProviders` field at all.** The onboarding write already sets `apiKey`
(`options.ts:194`, and unchanged by C2's rewrite — C2 spec §4.2 persists `apiKey` the same way), so
the very next `settings.get()` — the one `content.ts`'s `MessageRelaySettingsStore` triggers on
every Define click, exactly the call the landing-page try-it flow makes — computes
`configuredProviders: ['gemini']` correctly regardless of what the stored object's own
`configuredProviders` field says. **There is no blocker on the real content-script path; the stored
field is, and always was, dead for reads through this port.**

The one place a stale `configuredProviders: []` is still _visible_ (not blocking, just present) is
if some other, hypothetical code path ever reads the raw stored `Settings.configuredProviders`
directly instead of going through `SettingsStore.get()` — no such path exists in this codebase
today (`wireSettings`'s own save listener writes it for symmetry, `options.ts:123`, but nothing
reads it back except through the derived `get()`). Given that, this revision does **not** carry
v1's "blocking gap" fix as a required task. It is offered as an optional, low-risk consistency tidy
in §5 Task 2 (write `configuredProviders: apiKey ? ['gemini'] : []` in the same onboarding
persist call C2 already touches, matching `wireSettings`'s existing symmetry) — worth doing while
that exact line is already open in the diff, not worth a dedicated task or a re-open of C2.

## 4. Scope fence (from the revised card, held exactly)

- **User-triggered only** — the try-it lookup on the landing page runs only when the reader selects
  text and clicks the real Define pill there; the extension button here only opens a tab (§3.4
  point 1). No lookup fires automatically anywhere in this card's own code.
- **Visible "uses your key" microcopy** — `.tryit-cta-caption` (§3.2), present on the activation
  success screen before any click, exactly as the card requires.
- **Reuses the real lookup pipeline and card rendering verbatim, including S4** — because it is the
  literal, unmodified `content.ts` pipeline already running on the landing page (§2); no new
  renderer exists to keep in sync.
- **Offline fallback preserved** — §3.4; today's status sentence is never removed.
- **The landing page never touches the API key (S1)** — `docs/index.html`'s only change is static
  markup/CSS/translation strings (§3.1); no new JavaScript is added to the page at all, so there is
  no code path on the page that could read `chrome.storage` or a wire reply even accidentally.
- **Zero `wire.ts`/`router.ts`/`ports.ts` changes** — §3.3.
- **No new manifest permission** — §3.3's `chrome.tabs.create` note; `docs/index.html`'s edit
  touches no manifest at all.
- **Tokens law** — every new rule in §3.1/§3.2 reads `--ad-*`/`--adp-*` only.
- **Merging to `master` deploys the page.** `docs/index.html`'s edit ships live the moment its PR's
  merge commit lands on `master` (GitHub Pages serves `/docs` from `master` directly, no separate
  deploy step) — the §5 plan's PR gate treats this as a production release, not merely "docs."

## 5. Testing strategy

1. **Unit — `packages/app/test/ui/settings-form.test.ts`**: `#tryit-cta` starts `hidden`;
   `form.tryIt = true` reveals it, `form.tryIt = false` hides it again; clicking `#tryit-open`
   dispatches a composed `tryit-open` event (no detail).
2. **e2e — new `packages/extension-chrome/e2e/c3-guided-first-lookup.spec.ts`**, following the
   `onboarding.spec.ts` pattern for capturing an opened tab (`context.waitForEvent('page')`, already
   used there for the no-key card's "Open Settings" button, `onboarding.spec.ts:64-69`) plus
   `mockGemini`/`selectWord`/`openTrigger` from `./helpers`:
   - Activating with a mocked 200 Gemini response shows `#tryit-cta` with the "uses your key"
     caption on the settings screen.
   - **Never fetches the live site.** Before clicking, `context.route('https://hieplam.github.io/**',
...)` is registered to fulfill a small **local** HTML stand-in for the landing page's `#try`
     section — a `<p id="try-sentence">Finding that café was pure <mark>serendipity</mark>.</p>`
     fixture, mirroring exactly what §3.1 puts on the real page (the harness's `gotoFixture` pattern
     applied to a routed URL instead of a fresh navigation) — so no request ever leaves the test
     machine, satisfying the C10-established rule (`docs/ROADMAP.md` §4 C10 landing-page note: "the
     e2e suite must never fetch the live site").
   - Clicking `#tryit-open` opens a new tab whose URL contains `hieplam.github.io/ai-dict/#try`
     (asserted via the captured `page.url()`, the same mechanism `onboarding.spec.ts:64-69` already
     uses for "Open Settings").
   - On that new (stubbed) tab, `selectWord(newPage, 'try-sentence', 'serendipity')` →
     `openTrigger(newPage)` → the real card renders sanitized content (reusing the default
     `GEMINI_OK_BODY` fixture) — proving the full loop end to end: activation success → click try-it
     → tab opens → select word → mocked provider 200 → real card rendered, exactly as this
     revision's brief requires.
   - The "Save anyway" (`NETWORK`) path never shows `#tryit-cta` — asserts §3.4's "only the
     verified-success branch" pin (mirrors C2's own `c2-verified-activation.spec.ts` scenario for the
     bypass path).
3. **Global constraint reminder (this repo, not new to this card):** build the e2e bundle with
   `GEMINI_API_KEY` cleared, e.g. `GEMINI_API_KEY= bun run build:chrome` (C10's documented flake) —
   a baked-in env key skips onboarding entirely and silently disables every onboarding-path e2e,
   including all of the above.
4. **`docs/index.html` — no automated test.** The page is static content with no build step and no
   existing test harness of its own (confirmed: no spec anywhere in `packages/extension-chrome/e2e/`
   navigates to the real `docs/index.html`, and this card does not add one — e2e must use the local
   stand-in per §5.2, not the file itself). Verification for this file is manual: open it locally
   (`python3 -m http.server` from `docs/`, or any static server) and confirm the `#try` section
   renders, the language toggle swaps its copy, and `#faq`'s existing anchor link still resolves.

## 6. Testing performed (PR evidence — replaces screenshot/video capture)

Per this worktree's `CLAUDE.md` (owner ruling 2026-07-16): **no screenshots or video for this PR.**
The PR body's "Testing performed" section carries the evidence instead — the suites run, test
counts, e2e scenarios exercised, and gates passed (lint, format check, typecheck, unit, e2e),
matching exactly what §5 above enumerates. No `pr-assets/*` branch is created for this card.

## 7. Risk / rollback

- **Risk: low.** Lower than v1's already-low-moderate rating — there is no new selection-scoping
  logic to get wrong (§2.1: that whole problem class doesn't exist once the practice surface is a
  page the content script already covers unscoped). The only new interaction logic is a button that
  opens a tab to a fixed URL; the riskiest thing left is a typo in the URL or anchor, caught
  trivially by the e2e's URL assertion (§5.2).
- **No data-shape risk.** No wire, router, or persisted-schema change. The optional
  `configuredProviders` tidy (§3.5) is strictly additive-correct on a field that already exists,
  not a shape change.
- **`docs/index.html` risk is a content risk, not a code risk.** A broken `<mark>` tag or malformed
  `VI` entry could visually break the practice sentence or fail to translate, but cannot affect the
  extension itself — the page has no JavaScript this card adds, and the extension's content script
  reads the page's DOM the same way it reads any other page's DOM, tolerant of arbitrary markup.
- **Rollback:** revert the single PR. Onboarding's post-activation behavior returns to exactly
  today's single status sentence; `docs/index.html` reverts to not having a `#try` section (and,
  because the file is served directly from `master`, the live page reverts the moment the revert PR
  merges); no stored data becomes invalid.

## 8. Files touched (summary)

| File                                                           | Change                                                                                                                                         |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/index.html`                                              | + `#try` section (EN markup), nav link, CSS, 6 `VI` translation keys                                                                           |
| `packages/app/src/ui/settings-form.ts`                         | + `.tryit-cta` markup/CSS, `tryIt` setter, `tryit-open` event                                                                                  |
| `packages/app/test/ui/settings-form.test.ts`                   | + tests for the CTA                                                                                                                            |
| `packages/extension-chrome/src/options.ts`                     | + `TRY_IT_URL` const, `mountSettings`'s `showTryIt` opt + `tryit-open` listener, (optional) `configuredProviders` tidy on the onboarding write |
| `packages/extension-chrome/e2e/c3-guided-first-lookup.spec.ts` | new — functional e2e (§5.2)                                                                                                                    |

No change to `packages/app/src/wire.ts`, `packages/app/src/app/router.ts`,
`packages/app/src/ports.ts`, `packages/app/src/app/dom-selection-source.ts`,
`packages/app/src/domain/workflow.ts`, or any manifest file.
