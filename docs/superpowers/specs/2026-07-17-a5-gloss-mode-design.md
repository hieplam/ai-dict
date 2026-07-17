# A5 — Gloss mode

Roadmap card: `docs/ROADMAP.md` §4 A5 (Impact 4 · Effort M · Score 2.0). Depends on: — (independent).
Card text (`docs/ROADMAP.md:264-275`): opt-in "Compact gloss" setting; Define shows a one-line
translation floating at the word; click expands into the full card. Scope fence: **no
auto-detection of "simple words" — no difficulty classifier.** Lead decides: gloss anchor/
positioning, setting copy.

## 1. Problem (grounded in code)

Today every successful lookup — regardless of how trivial the word — opens the same full
`<lookup-card>` inside a modal `<bottom-sheet>`:

- `InlineBottomSheetRenderer.renderResult()` (`packages/app/src/app/inline-bottom-sheet-renderer.ts:88-107`)
  always calls `this.setState(...)`, which always calls `this.ensureCard().replaceChildren(...renderCardState(state))`
  (`inline-bottom-sheet-renderer.ts:74-82`, `ensureCard` at `:47-72`). `ensureCard()` creates a
  `<bottom-sheet>` wrapping a `<lookup-card>` and appends it to `this.host` (`:68`, `document.body`
  by default per `content.ts:20`).
- `<bottom-sheet>` (`packages/app/src/ui/bottom-sheet.ts`) is a fixed, full-viewport modal: `.panel`
  is `position:absolute;left:0;right:0;bottom:0` with an `--ad-scrim` dimming the whole page
  (`bottom-sheet.ts:21-26`) — there is no "compact" or anchor-positioned mode.
- The floating "Define" bubble (`<lookup-trigger>`, positioned at the selection's `AnchorRect` by
  `ChromeFloatingTrigger.show()` — `packages/extension-chrome/src/adapters/chrome-floating-trigger.ts:29-42`,
  position math at `:39-41`) is hidden the instant a lookup fires
  (`packages/app/src/domain/workflow.ts:56-58`, inside `runLookup`'s `settings.get().finally(...)`),
  well before any result exists. Nothing today renders anything **at the anchor** once a lookup is
  in flight or has returned — the reader always gets the full card, dead centre/bottom of the
  screen, dimming everything else, even for a one-word "what does 'bank' mean again?" glance.
- A one-line translation of the headword already exists as data: B2 shipped
  `LookupResult.translation?: string` (`packages/app/src/domain/types.ts:65-75`), populated by
  `parseTranslation()` (`packages/app/src/domain/translation-line.ts:21-37`) extracting the
  model's `TRANSLATION: "…"` signal line. Today this field is used for exactly one thing — feeding
  `saved.save`'s payload when the reader stars a word (`packages/extension-chrome/src/content.ts:93`,
  `packages/extension-chrome/src/side-panel.ts:69`) — **it is never rendered to the DOM anywhere**
  (confirmed: `grep -rn '\.translation\b' packages/app/src packages/extension-chrome/src` has zero
  rendering call sites). This is exactly the one-line, single-phrase string the card wants, already
  computed on every successful lookup, just never shown.

There is no user setting today that changes what a successful lookup renders — `PublicSettings`
(`domain/types.ts:164-176`) has no such field, and `SettingsFormValue` (`ui/settings-form.ts:29-45`)
has no such checkbox.

## 2. Design questions (every "Lead decides" item pinned)

### 2.1 Where does the gloss element live?

**Pinned: a new, portable custom element `<lookup-gloss>`**
(`packages/app/src/ui/lookup-gloss.ts`, c3-117), owned and positioned by
`InlineBottomSheetRenderer` (`packages/app/src/app/inline-bottom-sheet-renderer.ts`, c3-1) as a
**second surface alongside** the existing `<bottom-sheet>+<lookup-card>` pair — not a mode of
either existing component.

**Rejected: extend `<lookup-trigger>` to also show the result.** The "Define" bubble is already
positioned at the anchor and already gets hidden the instant a lookup fires
(`workflow.ts:56-58`), so reusing it looks tempting. Rejected because `TriggerUI` (`ports.ts:16-19`)
is a narrow, single-purpose port — `show(anchor, onClick)` / `hide()` — whose only job is "fire a
lookup"; `ResultRenderer` (`ports.ts:50-60`) is the port responsible for showing results. Folding
gloss rendering into `TriggerUI` would make one port do both jobs, forcing **every** `TriggerUI`
implementation (`ChromeFloatingTrigger`, Safari's `SafariFloatingTrigger`) to grow result-rendering
logic it has nothing to do with, and would require the pure `runLookupWorkflow`
(`domain/workflow.ts`) to conditionally skip `deps.trigger.hide()` based on a render-mode setting —
pushing a UI-surface decision into the ports-architecture boundary the roadmap's own standing
constraint 6 (`docs/ROADMAP.md:91-92`, `ref-core-dependency-rule`) exists to keep clean.

**Rejected: add a compact `CardState` variant to `<lookup-card>`.** `CardState`
(`ui/lookup-card.ts:30-55`) and `renderCardState()` (`:240-288`) already carry 6 features (B1 save
row, B5 status toggle, B7 nudge banner, A8 idiom label, the provider picker, the NO_KEY/
INVALID_KEY setup invites). Rejected because the gloss bubble is positioned at the **selection
anchor** (fixed `x`/`y`, like `<lookup-trigger>`), while `<lookup-card>` lives inside
`<bottom-sheet>`'s own fixed, bottom-anchored, full-viewport layout (`bottom-sheet.ts:21-26`) — a
fundamentally different positioning parent. Threading anchor-aware positioning into a 596-line
component 6 other features already share, just to grow a 7th "compact" branch, is strictly riskier
than one small additive file with zero lines touched in `lookup-card.ts`.

### 2.2 How is the one-line translation obtained?

**Pinned: reuse `LookupResult.translation` verbatim** (B2's parsed `TRANSLATION:` signal line, see
§1). No new prompt slot, no new signal line, no new parsing.

**Rejected: a dedicated gloss prompt slot / new signal line.** The card explicitly asks for "a
one-line translation" (`docs/ROADMAP.md:268`) — `translation` already **is** exactly that: a single
target-language phrase, already extracted, already threaded onto every `LookupResult`. Inventing a
second signal line would duplicate B2's already-shipped parsing for zero added value while growing
the prompt/parsing surface (one more line for `prompt-template.ts`/`default-template.ts` to own,
one more thing a custom `promptEnvelope` override could omit).

**Fallback (not a Lead choice — it's the field's existing contract):** `translation` is already
optional — absent for legacy/cached entries, non-compliant model output, or a custom
`promptEnvelope` override that omits `{translation_instruction}` (`domain/types.ts:65-75`,
`translation-line.ts:12-15`). When absent or blank, gloss mode has nothing to show compactly, so
**this one result always renders the full card**, exactly like today — never a silently-dropped or
empty bubble. See §4.2's exact gate.

### 2.3 What happens to the loading state?

**Pinned: the loading state also renders compactly when gloss mode applies**, not just the result.
`ResultRenderer.renderLoading` (`ports.ts:56`) gains an optional second parameter, `anchor?:
AnchorRect`, and `runLookupWorkflow` passes `e.anchor` (already in scope inside `runLookup`,
`domain/workflow.ts:45-49`) through unchanged. Without this, gloss mode would still flash open the
full modal `<bottom-sheet>` (with its page-dimming `--ad-scrim`) for the ~1 request round-trip,
then need to collapse back down into a bubble the instant the result lands — a jarring double
motion for exactly the "quick 2-second glance" case the card exists to serve
(`docs/ROADMAP.md:270-272`). Passing the SAME `AnchorRect` the trigger bubble already used means the
reader perceives the "Define" pill turning into a small loading pill in place, with no gap.

**Errors are never compact — pinned exception.** `renderError` is untouched: NO_KEY (setup invite),
INVALID_KEY ("Open Settings" CTA), and generic failures always render the full card, regardless of
gloss mode. Rationale: these states carry an actionable control (`renderSetupInvite()`,
`lookup-card.ts:216-228`; the `INVALID_KEY` "Open Settings" branch, `lookup-card.ts:273`) that a
one-line pill has no room for, and first-run setup guidance getting silently squeezed into an
easy-to-miss bubble would directly work against Category C's whole activation-funnel effort. This
is a deliberate, permanent branch, not a temporary gap — no future card is expected to compact
errors.

### 2.4 What happens once the reader expands to the full card?

**Pinned: once the full card is open for the current on-page session (whether reached by
expanding a gloss OR by a gloss-ineligible render), every subsequent render for that session keeps
updating the SAME open card — it never regresses back into a mini bubble.**

Today, once `ensureCard()` first creates the `<bottom-sheet>+<lookup-card>` pair, that same pair is
reused (memoized at `inline-bottom-sheet-renderer.ts:48`: `if (this.card && this.sheet) return
this.card`) for every later `renderLoading`/`renderResult` call, including a **provider switch**
(the card's own "Switch" picker, `lookup-card.ts:481-497`, which re-runs `runLookup` via
`ctx.onSwitchProvider`, `workflow.ts:95-100`) or an A8 **"Show literal word"** override
(`ctx.onForceLiteral`, `workflow.ts:105-113`) fired from a control that only exists **inside** the
already-open card. Without an explicit guard, a reader who expands the gloss, opens the picker, and
taps "Switch" would trigger a fresh `renderLoading`/`renderResult` pair for the SAME anchor and
(likely) the SAME translation — which would satisfy the gloss gate again and shrink the card the
reader just opened back down to a bubble mid-interaction.

Mechanism: a private `cardOpen: boolean` flag on `InlineBottomSheetRenderer`, `false` initially and
reset to `false` only in `close()` (§4.1's exact state machine). `renderLoading`/`renderResult` only
ever consider the gloss branch when `cardOpen === false`; expanding the gloss (§4.1's `expand()`)
sets it `true`. This also means: for every existing install that leaves gloss mode at its default
OFF, `cardOpen` becomes `true` on the very first render and stays `true` forever (until `close()`)
— i.e. **zero behavior change for the non-opted-in path**, which is the majority case and the exact
thing the "no auto-detection" fence protects.

### 2.5 Setting name, storage, and copy

**Pinned field name:** `PublicSettings.glossMode?: boolean` (and, since `Settings extends
PublicSettings`, `Settings.glossMode` for free — `domain/types.ts:164-176,210-217`). **Declared
optional**, not required like `theme`. Rejected making it required (matching `theme`/
`cacheEnabled`'s existing required-field style) because `PublicSettings`-shaped object literals are
constructed at ~10 call sites across both shells' composition roots and 100+ test assertions
(`packages/app/test/ui/settings-form.test.ts` alone has 900+ lines with many `el.value = {...}`
literals); forcing every one of those to grow a new required key for a single opt-in boolean is
unjustifiable churn for zero behavioral gain — every real reader (adapter) that needs a concrete
`true`/`false` still normalizes it explicitly (§4.3), exactly like `theme` already normalizes a
legacy-missing value via `normalizeTheme()` (`domain/types.ts:159-162`) despite `theme` itself being
required. This mirrors the A8/B2/B7 precedent (`docs/ROADMAP.md` §8 Decision Log, 2026-07-10 entry)
that optional in-flight fields are ordinary evolution, not an escalation — extended here to a ports/
settings field (an even lighter case: no zod wire schema forces a hand either, see §4.3).

**Pinned copy (settings-form.ts, "Appearance" section, right after the Theme control):**

```html
<label class="check"><input type="checkbox" id="gloss-mode" /> Compact gloss</label>
<p class="seg-help" id="gloss-mode-help">
  Define shows a one-line translation next to the word — click it to open the full card. Falls back
  to the full card automatically when no one-line translation is available.
</p>
```

**Rejected placement: a new "Reading" section.** The existing "Appearance" section
(`settings-form.ts:190-201`) already governs "how the lookup card... looks"
(`settings-form.ts:200`'s help text); a render-mode toggle for the card fits that framing exactly.
A whole new section for one checkbox is unwarranted section proliferation.

**Pinned visibility gate: `glossModeAvailable` (a settable boolean property on `<settings-form>`,
default `false`, hides/shows the checkbox row — the checkbox itself always exists in the DOM and
always round-trips through `collect()`/`set value()` regardless of visibility).** Rejected shipping
the checkbox unconditionally visible on both shells: Safari's own `options.ts` mounts the exact
same shared `<settings-form>` element (`packages/extension-safari/src/options.ts:11,13`) — but
Safari's `content.ts` has no gloss-rendering code at all (§4.5) and none is added by this card. An
unconditionally-visible checkbox would let a Safari reader toggle a setting that visibly does
nothing, which reads as a bug, not a feature. This mirrors an existing precedent exactly:
`<lookup-card>`'s own `side-panel` attribute — "Chrome opts in to the 'Open in side panel'
affordance... Safari leaves it off" (`inline-bottom-sheet-renderer.ts:52-55`) — and
`<settings-form>`'s own `keyFromEnv`/Konami-gated Developer-mode-panel pattern (hidden until a
composition root or a gesture unlocks it) is the same "present in the DOM, hidden until flagged"
shape already used twice in this exact file. Chrome's `options.ts` sets
`form.glossModeAvailable = true` before hydrating `.value` (§4.6); Safari's `options.ts` never sets
it, so the row stays hidden there, but a Safari `chrome.storage.local` value written by some future
sync mechanism would still round-trip correctly (never silently reset — see §4.4's test for this
exact regression).

## 3. Scope fence (from the card, held exactly)

- **Opt-in, default OFF** (`glossMode` absent/false everywhere until the reader checks the box).
- **No difficulty auto-detection, no classifier.** Gloss vs. full card is a pure function of (a)
  the reader's own setting and (b) whether `translation` is present/non-blank for _this_ result —
  never word length, frequency, or any heuristic about the word itself.
- **Errors always render the full card** (§2.3) — the setup/recovery CTAs never get squeezed into a
  bubble.
- **The side panel is untouched.** `ChromeSidePanelMirror` (`packages/extension-chrome/src/
adapters/chrome-side-panel-mirror.ts`) is a separate class from `InlineBottomSheetRenderer` and is
  not modified by this card — the side panel is explicitly a "persistent surface"
  (`content.ts:101-102`'s existing comment) with no anchor concept; it always shows the full result,
  exactly as it does today for every other feature (A8's idiom label, B7's nudge — see
  `idiom-expansion.spec.ts`'s own "side panel mirror shows the idiom result WITHOUT..." test for the
  established precedent of the mirror deliberately omitting card-only affordances).
- **Safari ships no gloss _rendering_ this card.** `PublicSettings`/`Settings` gaining an optional
  field ripples into Safari's `SettingsStore` adapters as a compile-safe default (§4.3) — that is a
  typecheck/consistency necessity, not a feature; Safari's `content.ts` is not modified and its
  settings-form checkbox stays hidden (§2.5). This matches existing precedent: B1/B5/B7/A8 (save,
  status, nudge, idiom) are ALL Chrome-only today too — `packages/extension-safari/src/content.ts`
  wires none of them (confirmed by reading the file in full, 49 lines, no save/status/nudge/idiom
  event listeners).
- **S1 untouched.** No key handling anywhere in this card.
- **S4 held.** The gloss one-liner goes through the exact same `sanitizeMarkdown()` trust boundary
  (`app/markdown-sanitize.ts:67-82`) as the card body already does — no second trust boundary
  invented (§4.2).
- **Tokens only.** `<lookup-gloss>`'s CSS reads only `--ad-*`/`--adp-*` tokens (§4.2), matching
  `<lookup-trigger>`'s existing token-only pill styling verbatim where structurally identical.
- **No new wire message.** `translation` already rides the existing `lookup` reply
  (`wire.ts`'s `LookupResultSchema`, unchanged); `glossMode` rides the existing `settings.get` reply
  (`PublicSettingsSchema`, one field added — §4.3). Neither is a new message type, so the "wire+
  router in one task" rule (CONTRACTS §2) does not force a router.ts change, and indeed `router.ts`
  is untouched (its `settings.get`/`lookup` handlers proxy `deps.settings.get()`/`deps.client.lookup()`
  verbatim — `router.ts:219-220`, `:97-172`).

## 4. The change

### 4.1 `packages/app/src/app/inline-bottom-sheet-renderer.ts` — the core of the feature

New private fields:

```ts
private glossMode = false;
private glossEl: LookupGloss | null = null;
private cardOpen = false;
private readonly onOutsidePress = (e: Event): void => {
  if (this.glossEl && !e.composedPath().includes(this.glossEl)) this.removeGloss();
};
```

New public accessor (mirrors the existing `theme` setter at `:38-45` exactly):

```ts
set glossMode(v: boolean) { this._glossMode = v; }
get glossMode(): boolean { return this._glossMode; }
```

(Implementation detail: the field above is named `_glossMode` internally to avoid shadowing the
accessor; every reference in this doc to "`this.glossMode`" inside methods means the private
backing field's current value.)

New private helpers:

```ts
private ensureGloss(): LookupGloss {
  if (this.glossEl) return this.glossEl;
  const el = document.createElement('lookup-gloss') as LookupGloss;
  el.setAttribute('data-ad-theme', this._theme);
  el.addEventListener('expand', () => this.expand());
  this.host.append(el);
  document.addEventListener('mousedown', this.onOutsidePress, true);
  document.addEventListener('touchstart', this.onOutsidePress, true);
  this.glossEl = el;
  return el;
}

private positionGloss(anchor: AnchorRect): void {
  const el = this.ensureGloss();
  el.style.position = 'fixed';
  el.style.left = `${anchor.x}px`;
  el.style.top = `${anchor.y + anchor.h}px`;
}

private removeGloss(): void {
  if (!this.glossEl) return;
  document.removeEventListener('mousedown', this.onOutsidePress, true);
  document.removeEventListener('touchstart', this.onOutsidePress, true);
  this.glossEl.remove();
  this.glossEl = null;
}

/** Reader tapped the gloss bubble — show the ALREADY-COMPUTED state in the full card, no
 * re-lookup. Mirrors setSaved()/setStatus()'s "no-op if nothing rendered yet" caution, though in
 * practice a gloss element only ever exists after at least one renderLoading/renderResult. */
private expand(): void {
  this.cardOpen = true;
  this.removeGloss();
  if (this.lastState) this.setState(this.lastState);
}
```

Positioning math (`el.style.position/left/top`) is copied verbatim from
`ChromeFloatingTrigger.show()` (`chrome-floating-trigger.ts:39-41`) — the exact same `AnchorRect` →
fixed-position formula, so the gloss bubble lands at the identical spot the "Define" pill just
vacated.

`renderLoading` — signature gains the optional anchor; behavior branches once (§2.3, §2.4):

```ts
renderLoading(word?: string, anchor?: AnchorRect): void {
  if (!this.cardOpen && this._glossMode && anchor) {
    this.lastState = word === undefined ? { kind: 'loading' } : { kind: 'loading', word };
    this.positionGloss(anchor);
    this.glossEl!.replaceChildren(...renderGlossState(this.lastState));
    return;
  }
  this.removeGloss(); // clear a stale bubble from a prior gloss-eligible render, if any
  this.setState(word === undefined ? { kind: 'loading' } : { kind: 'loading', word });
}
```

`renderResult` — the existing `onSwitch`/`onForceLiteral` assignment stays unconditional (both
branches need it once the card exists — §2.4); the gloss gate is evaluated after:

```ts
renderResult(r: LookupResult, ctx?: ResultRenderContext): void {
  this.onSwitch = ctx?.onSwitchProvider;
  this.onForceLiteral = ctx?.onForceLiteral;
  const state: CardState = {
    kind: 'result',
    safeHtml: this.sanitize(r.markdown),
    word: r.word,
    target: r.target,
    ...(r.provider !== undefined ? { provider: r.provider } : {}),
    ...(r.fallbackFrom !== undefined ? { fallbackFrom: r.fallbackFrom } : {}),
    ...(r.definedAs !== undefined ? { definedAs: r.definedAs } : {}),
    ...(ctx?.providers !== undefined ? { providers: ctx.providers } : {}),
    saved: ctx?.saved === true,
    nudge: r.nudge === true,
  };
  const hasGloss = typeof r.translation === 'string' && r.translation.trim() !== '';
  if (!this.cardOpen && this._glossMode && ctx?.anchor && hasGloss) {
    this.lastState = state;
    this.positionGloss(ctx.anchor);
    this.glossEl!.replaceChildren(
      ...renderGlossState({ kind: 'result', word: r.word, safeHtml: this.sanitize(r.translation!) }),
    );
    return;
  }
  this.removeGloss();
  this.cardOpen = true;
  this.setState(state);
}
```

(`this.sanitize(r.translation!)` reuses the SAME injected sanitizer function the body already goes
through — no second trust boundary, per §3's S4 fence. Note `state` is now built once, inline,
rather than through the old anonymous object literal passed straight to `setState` — a
non-behavioral refactor needed so the SAME `CardState` can be reused as `this.lastState` in the
gloss branch without duplicating the field-spread logic.)

`renderError` — unchanged except for one added line clearing a stale gloss bubble, so an error
following a gloss-eligible loading state doesn't leave the mini pill behind next to the newly-opened
error card:

```ts
renderError(e: LookupError): void {
  this.removeGloss();
  this.cardOpen = true;
  this.setState({ kind: 'error', error: e });
}
```

`close()` — gains gloss cleanup and the `cardOpen` reset (the one place it resets to `false`):

```ts
close(): void {
  this.removeGloss();
  this.cardOpen = false;
  this.sheet?.remove();
  this.sheet = null;
  this.card = null;
  this.lastState = null;
}
```

Imports gain `type { AnchorRect }` from `../ports` (already re-exported from `domain/types.ts`) and
`{ renderGlossState, type LookupGloss }` from `../ui/index`.

### 4.2 `packages/app/src/ui/lookup-gloss.ts` — new component

Structurally closest to `<lookup-trigger>` (`ui/lookup-trigger.ts`): a shadow root wrapping a single
native `<button>`, styled as a small pill with the SAME token set
(`--ad-surface`/`--ad-line-strong`/`--ad-shadow-trigger`/`--adp-radius-pill` — copied from
`lookup-trigger.ts:16-23`), so a reader can't visually tell "gloss bubble" and "Define bubble" are
different design languages, only different content.

Content is written to the element's **light DOM** and projected through a `<slot>` inside the
shadow button — the SAME cross-world-safe pattern `<lookup-card>` already uses
(`lookup-card.ts:230-239`'s doc comment: an isolated-world content script can write shared-DOM
light-DOM nodes but cannot reach a MAIN-world class's JS property setter, Chromium bug 390807).
`InlineBottomSheetRenderer` therefore writes via `replaceChildren(...)`, never a `.state` setter —
mirroring `renderCardState()`'s exact contract:

```ts
export type GlossState =
  | { kind: 'loading'; word?: string }
  | { kind: 'result'; word: string; safeHtml: SafeHtml };

export function renderGlossState(state: GlossState): Node[] {
  const word = document.createElement('strong');
  word.textContent = state.word ?? '…';
  if (state.kind === 'loading') {
    const spinner = document.createElement('span');
    spinner.className = 'gloss-spinner';
    spinner.setAttribute('aria-hidden', 'true');
    return [word, spinner];
  }
  const text = document.createElement('span');
  text.className = 'gloss-text';
  text.innerHTML = state.safeHtml; // trusted: sanitized upstream (S4) — same boundary as the card body
  return [word, text];
}

export class LookupGloss extends HTMLElement {
  connectedCallback(): void {
    if (this.shadowRoot) return;
    const root = this.attachShadow({ mode: 'open' });
    adoptStyles(root, CSS);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.append(document.createElement('slot'));
    btn.addEventListener('click', () =>
      this.dispatchEvent(new CustomEvent('expand', { bubbles: true, composed: true })),
    );
    root.append(btn);
  }
}
```

CSS (new block, tokens only):

```css
:host {
  all: initial;
  ${BASE_VARS};
  z-index: var(--adp-z-overlay);
  color-scheme: light;
}
${THEME_CSS}
button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 280px;
  font: var(--adp-weight-semi) var(--adp-text-sm)/1.3 var(--adp-font-sans);
  color: var(--ad-ink);
  background: var(--ad-surface);
  border: 1px solid var(--ad-line-strong);
  padding: 7px 13px;
  border-radius: var(--adp-radius-pill);
  box-shadow: var(--ad-shadow-trigger);
  cursor: pointer;
}
button:hover { background: var(--ad-surface-raised); }
button:focus-visible { outline: 2px solid var(--ad-accent); outline-offset: 2px; }
.gloss-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ad-ink-soft);
}
.gloss-text p { display: inline; margin: 0; } /* sanitizeMarkdown wraps plain text in <p> */
@keyframes spin { to { transform: rotate(360deg); } }
.gloss-spinner {
  display: inline-block;
  width: 12px;
  height: 12px;
  border: 2px solid var(--ad-line);
  border-top-color: var(--ad-accent);
  border-radius: 50%;
  animation: spin 0.77s linear infinite;
}
@media (prefers-reduced-motion: reduce) { .gloss-spinner { animation: none; } }
```

Every click dispatches a composed `expand` event (mirrors `<lookup-trigger>`'s `lookup-click` and
`<lookup-card>`'s action-button events) regardless of `loading`/`result` state — clicking while
still loading is harmless: `InlineBottomSheetRenderer.expand()` (§4.1) shows whatever `lastState`
currently is, which for an early click is simply the full card's own loading spinner instead of the
gloss's mini one. No disabled-state bookkeeping needed.

Accessible name: `aria-label` set fresh on the host element by `InlineBottomSheetRenderer` whenever
it calls `positionGloss`/writes content — `` `Define result for "${word}" — tap for full card` ``
— word is known in both `loading` and `result` kinds, so the label is stable and always accurate,
mirroring `<lookup-trigger>`'s own "aria-label stays stable across states" precedent
(`lookup-trigger.ts:35-38`'s comment).

### 4.3 `packages/app/src/wire.ts` + every `SettingsStore` implementation — ONE task

`PublicSettingsSchema` (`wire.ts:61-67`) gains one optional field:

```ts
const PublicSettingsSchema = z.strictObject({
  targetLang: z.string(),
  outputFormat: z.string(),
  promptEnvelope: z.string(),
  hasKey: z.boolean(),
  theme: z.enum(['sepia', 'dark', 'contrast', 'system']),
  configuredProviders: z.array(ProviderEnum),
  glossMode: z.boolean().optional(),
});
```

This is bundled into ONE task with every file that constructs a `PublicSettings` value, because
`wire.ts:206`'s compile-time `AssertEqual<z.infer<typeof PublicSettingsSchema>, PublicSettings>`
tuple check couples the zod schema and the domain type — they cannot drift apart, the exact same
"cannot typecheck apart" reasoning CONTRACTS §2 already applies to wire+router pairs, extended here
to schema+adapters:

- `packages/extension-chrome/src/adapters/chrome-storage-store.ts` — `get()` (`:44-59`) gains
  `glossMode: s?.glossMode ?? false` (a concrete default, mirroring `hasKey`/`theme`'s own
  normalization style even though the TYPE is optional); `defaults()` (`:14-29`) gains
  `glossMode: false`.
- `packages/extension-safari/src/adapters/safari-storage-store.ts` — identical two additions
  (`:39-54` and `:14-29`) — **compile/consistency only, no new Safari behavior** (§3).
- `packages/extension-safari/src/adapters/message-relay-settings-store.ts` — the field-by-field
  `stripped` object (`:22-29`) gains `glossMode: reply.settings.glossMode`.
- `packages/extension-chrome/src/adapters/message-relay-settings-store.ts` — **no change**: it
  passes `reply.settings` through whole (`:19-20`), so it picks up the new field automatically.

### 4.4 Tests updated by §4.3 (existing exact-shape assertions)

Two existing tests assert `ChromeStorageStore.get()`'s return value with an exact `toEqual({...})`
that will start failing the moment `get()` always returns a concrete `glossMode` key
(`toEqual` does not ignore a _defined_ extra key on the actual side):

- `packages/extension-chrome/src/adapters/chrome-storage-store.test.ts:29-36` (`hasKey: true` case)
  and `:65-72` (all-empty/defaults case) — both gain `glossMode: false`.
- `packages/extension-safari/src/adapters/safari-storage-store.test.ts:33-40` and `:46-53` —
  same two additions.

`packages/extension-safari/src/adapters/message-relay-settings-store.test.ts` needs **no changes**
— its `pub`/`settingsWithExtra` fixtures (`:4`, `:44-50`) are plain object literals missing
`theme`/`configuredProviders` already, and Vitest's `toEqual` treats an `undefined`-valued property
(what `reply.settings.glossMode` resolves to when the fixture omits it) as equal to a missing key —
confirmed by the fact those two fields are _already_ omitted from the fixtures today with the
existing tests passing.

### 4.5 `packages/app/src/ports.ts` + `packages/app/src/domain/workflow.ts`

`ResultRenderContext` (`ports.ts:26-48`) gains one field, positioned next to the other "rides along
from the selection event" fields it already documents:

```ts
/** A5: the selection's on-page anchor, so a gloss-mode renderer can position a compact bubble at
 * the word. Always present alongside sentence/url/title (both come from the same SelectionEvent
 * in scope at runLookup) — absent only for a renderer that predates this field, which simply
 * never enters the gloss branch (see InlineBottomSheetRenderer §4.1). */
anchor?: AnchorRect;
```

`ResultRenderer.renderLoading` (`ports.ts:56`) gains an optional second parameter:

```ts
renderLoading(word?: string, anchor?: AnchorRect): void;
```

`domain/workflow.ts` — two call sites updated inside `runLookup` (`:45-121`):

- `:64`, `deps.renderer.renderLoading(e.text)` → `deps.renderer.renderLoading(e.text, e.anchor)`.
- The `ctx: ResultRenderContext` object literal (`:88-114`) gains `anchor: e.anchor` alongside the
  existing unconditional `sentence`/`url`/`title` (`:89-91`) — always present, same reasoning
  ("ctx is therefore now always defined... not just when the picker/idiom override applies",
  `workflow.ts:85-87`'s existing comment, extended verbatim to `anchor`).

Neither `ChromeSidePanelMirror` (`extension-chrome/src/adapters/chrome-side-panel-mirror.ts`) nor
the object-literal `renderer` in `content.ts` (`:76-113`, see §4.6) require signature edits to
satisfy TypeScript — a narrower-arity implementation of an interface method (e.g. `renderLoading
(word?: string): void` implementing `renderLoading(word?: string, anchor?: AnchorRect): void`) is
structurally assignable; only `content.ts` needs a **body** edit (§4.6) to actually forward the new
argument to `inline`.

`packages/app/test/fakes/index.ts`'s `FakeResultRenderer` (`:44-66`) gains a `loadingAnchor:
AnchorRect | undefined` field, set inside `renderLoading`, so `workflow.test.ts` can assert the
pass-through.

### 4.6 `packages/extension-chrome/src/content.ts` + `packages/extension-chrome/src/options.ts`

`content.ts`'s `themedSettings.get()` wrapper (`:29-38`) gains one more re-applied field, exactly
parallel to the existing `theme` line:

```ts
get: () =>
  settings.get().then((s) => {
    trigger.theme = s.theme;
    inline.theme = s.theme;
    inline.glossMode = s.glossMode === true;
    return s;
  }),
```

The `renderer` object literal passed to `runLookupWorkflow` (`:76-113`) forwards the new
`renderLoading` argument to `inline` only (the mirror never takes gloss mode — §3):

```ts
renderLoading(word, anchor) {
  lastFocus = word === undefined ? { state: 'loading' } : { state: 'loading', word };
  lastSavePayload = undefined;
  lastSaved = false;
  lastStatus = undefined;
  saveReplyGuard.next();
  inline.renderLoading(word, anchor);
  mirror.renderLoading(word);
},
```

(`renderResult`'s existing body already forwards the whole `ctx` object to `inline.renderResult(r,
ctx)` unchanged — `content.ts:103` — so it needs no edit; `ctx.anchor` simply arrives with it.)

`options.ts` — `DEFAULTS` (`:30-43`) gains `glossMode: false`; `toFormValue()` (`:67-80`) gains
`glossMode: s.glossMode === true`; `mountSettings()` (`:84-111`) sets the visibility gate right
before hydrating the form's value:

```ts
function mountSettings(initial: Settings, status?: string): void {
  const form = document.createElement('settings-form') as unknown as SettingsForm;
  if (KEY_FROM_ENV) form.keyFromEnv = true;
  form.glossModeAvailable = true;
  (form as unknown as HTMLElement).setAttribute('data-ad-theme', initial.theme);
  app.replaceChildren(form);
  (form as unknown as { value: SettingsFormValue }).value = toFormValue(initial);
  // ...unchanged below
```

`wireSettings`'s `save` listener (`:113-134`) needs **no change** — it already spreads the full
`next` (= `collect()`'s return) onto storage (`:122-124`), so `glossMode` flows through exactly like
`cacheEnabled`/`theme` already do, with no named key to add.

### 4.7 `packages/extension-safari/src/options.ts`

`DEFAULTS` (`:14-27`) gains `glossMode: false` — compile/consistency parity only (§3), matching
§4.3's adapter changes. `form.glossModeAvailable` is **never set**, so the checkbox row stays
hidden (§2.5) — no other line in this file changes.

### 4.8 `packages/app/src/ui/settings-form.ts`

`SettingsFormValue` (`:29-45`) gains `glossMode?: boolean`.

New markup, `.actions`... (right after the existing Theme control, before the closing
`</section>` at `:201`):

```html
<div class="row" id="gloss-mode-row" hidden>
  <label class="check"><input type="checkbox" id="gloss-mode" /> Compact gloss</label>
  <p class="seg-help" id="gloss-mode-help">
    Define shows a one-line translation next to the word — click it to open the full card. Falls
    back to the full card automatically when no one-line translation is available.
  </p>
</div>
```

New public accessor (mirrors `keyFromEnv`'s existing shape):

```ts
set glossModeAvailable(v: boolean) {
  this.q<HTMLElement>('#gloss-mode-row').hidden = !v;
}
```

`collect()` (`:563-580`) gains one line, reading the checkbox regardless of its row's visibility:

```ts
glossMode: this.q<HTMLInputElement>('#gloss-mode').checked,
```

`set value()` (`:582-611`) gains the matching hydration line, defaulting a missing/undefined value
to `false` (so every pre-existing test literal in `settings-form.test.ts` that doesn't mention
`glossMode` continues to hydrate the checkbox to its correct default, unchanged):

```ts
this.q<HTMLInputElement>('#gloss-mode').checked = v.glossMode === true;
```

No change needed to the dirty-tracking wiring (`:302-308`) — the new checkbox lives inside the same
`<form>` the delegated `input`/`change` listener already covers, exactly like `#cache`/`#history`
today.

### 4.9 Registration + barrel exports

`packages/app/src/ui/register.ts`'s `registerContentElements()` (`:8-12`) gains one line:
`if (!customElements.get('lookup-gloss')) customElements.define('lookup-gloss', LookupGloss);`.
`packages/app/src/ui/index.ts` gains `export * from './lookup-gloss';`.

### 4.10 No change to X (explicit, per house style)

- **`packages/app/src/ui/lookup-card.ts`** — zero lines touched (§2.1).
- **`packages/app/src/ui/bottom-sheet.ts`** — zero lines touched; the full card still opens exactly
  the same modal it always has.
- **`packages/app/src/app/router.ts`** — `settings.get`/`lookup` handlers proxy the injected
  `SettingsStore`/`LookupClient` verbatim; no new case, no new message (§3).
- **`packages/extension-chrome/src/adapters/chrome-side-panel-mirror.ts`** — untouched (§3).
- **`packages/extension-safari/src/content.ts`** — untouched; no gloss rendering ships on Safari
  this card (§3, §4.7).
- **`packages/app/src/domain/prompt-template.ts` / `default-template.ts`** — untouched; no new
  prompt slot (§2.2).
- **`docs/index.html`** — untouched; this card carries no landing-page/marketing surface.

## 5. Testing strategy

### 5.1 Unit — `packages/app/test/ui/lookup-gloss.test.ts` (new)

- `renderGlossState({kind:'loading', word:'bank'})` returns a `<strong>bank</strong>` + a
  `.gloss-spinner` node, no `.gloss-text`.
- `renderGlossState({kind:'result', word:'bank', safeHtml:'<p>ngân hàng</p>' as SafeHtml})` returns
  `<strong>bank</strong>` + a `.gloss-text` span whose `innerHTML` is the given safe HTML verbatim
  (no re-sanitization inside the component — it trusts the caller, exactly like `lookup-card.ts`'s
  `body.innerHTML = state.safeHtml` at `:279` trusts its caller).
- Mounting `<lookup-gloss>` and clicking its shadow `<button>` dispatches a composed `expand` event
  audible on `document`.
- A hostile `safeHtml` containing `<script>` (a stand-in for "what if a future caller forgot to
  sanitize") still renders inert when written via `innerHTML` — this is the SAME assertion style
  `inline-bottom-sheet-renderer.test.ts:63-71` already uses for the card body, ported here for
  defense-in-depth (the real trust boundary is `sanitizeMarkdown`, not this component).

### 5.2 Unit — `packages/app/test/app/inline-bottom-sheet-renderer.test.ts` (append)

- **Regression, glossMode default false:** `renderResult` with a `translation`-bearing result and
  `ctx.anchor` set still opens the full `bottom-sheet > lookup-card` immediately — no `<lookup-gloss>`
  ever mounts. (Proves zero behavior change for the default/majority path.)
- **glossMode=true + anchor + translation:** `renderResult` mounts `<lookup-gloss>` (not
  `bottom-sheet`), positioned per the anchor's `x`/`y+h` math; `bottom-sheet` is absent from the DOM.
- **glossMode=true + anchor, translation undefined:** falls back to the full card (the exact
  no-separable-one-liner fallback, §2.2).
- **glossMode=true, translation present, NO anchor:** falls back to the full card (missing-anchor
  guard).
- **glossMode=true, renderLoading(word, anchor):** mounts a loading-state `<lookup-gloss>`
  (`.gloss-spinner` present), no `bottom-sheet` in the DOM.
- **Expand path:** after a gloss-mode `renderResult`, dispatching `expand` on the mounted
  `<lookup-gloss>` (simulating a click) swaps to the full card showing the SAME word/definition
  (asserts `lookup-card`'s `h2` + sanitized body content match the original result, i.e. no
  re-lookup happened, no second `sanitize` call recorded by a spy), and removes `<lookup-gloss>`
  from the DOM.
- **Post-expand stays expanded (§2.4):** after expanding, a second `renderResult` call (same anchor,
  same translation-bearing result — simulating a provider-switch re-run) updates the SAME open card
  in place; `<lookup-gloss>` never reappears.
- **Error always full card:** `renderError` after a gloss-mode `renderLoading` removes the loading
  gloss bubble and shows the full error card, regardless of `glossMode`.
- **Outside-press dismiss:** with a gloss bubble showing, a `mousedown` outside it removes the
  bubble and mounts nothing else (no card opens) — mirrors
  `chrome-floating-trigger.test.ts`'s existing outside-press assertion style for `<lookup-trigger>`.
- **`close()` resets `cardOpen`** — after `close()`, a fresh gloss-eligible `renderResult` mounts a
  gloss bubble again (not forced into the full card by a stale `cardOpen=true`).

### 5.3 Unit — `packages/app/test/workflow.test.ts` (append)

- `renderer.loadingAnchor` (new `FakeResultRenderer` field, §4.5) equals the emitted
  `SelectionEvent.anchor` after a lookup fires.
- `renderer.lastCtx?.anchor` equals the same `AnchorRect`, alongside the existing
  sentence/url/title assertions at `:108-119`.

### 5.4 Unit — `packages/app/test/wire-schema.test.ts` (append)

- A `settings` reply carrying `glossMode: true` parses successfully; one omitting it entirely
  (today's exact existing fixtures) still parses successfully (proves `.optional()` holds).

### 5.5 Unit — adapter tests (update + append)

- `chrome-storage-store.test.ts` / `safari-storage-store.test.ts`: the two existing `toEqual`
  updates from §4.4, plus one new case each: a stored `glossMode: true` round-trips through `get()`.

### 5.6 Unit — `packages/app/test/ui/settings-form.test.ts` (append)

- `glossModeAvailable = false` (the default, no call at all) leaves `#gloss-mode-row` hidden.
- `glossModeAvailable = true` un-hides it.
- **Regression-safety (the exact bug §2.5 calls out):** `el.value = {...(existing full literal),
glossMode: true}` while `glossModeAvailable` is left at its default `false` (row hidden) — then
  `collect()` (triggered via a form submit, matching the file's existing pattern at `:32-49`) still
  reports `glossMode: true`. Proves a hidden row never silently resets a previously-true stored
  value, the concrete failure mode gating-via-visual-`hidden` alone (without keeping the checkbox
  live in the DOM) would risk.
- A submitted `save` event's detail includes `glossMode` reflecting the checkbox's checked state
  when the row IS visible and the reader toggles it.

### 5.7 e2e (Chrome only) — `packages/extension-chrome/e2e/a5-gloss-mode.spec.ts` (new)

Using a new mock body constant with a `TRANSLATION:` line (`packages/extension-chrome/e2e/
helpers.ts` gains `GEMINI_TRANSLATION_BODY` alongside the existing `GEMINI_OK_BODY`, and
`SettingsOverrides` gains `glossMode?: boolean`):

1. **Gloss mode ON + translation present:** seed `glossMode: true`, mock the translation-bearing
   body, select a word, click Define → `lookup-gloss` appears (not `bottom-sheet`), containing the
   translation text; clicking `lookup-gloss` opens `bottom-sheet lookup-card` with the full
   definition, and `lookup-gloss` is gone.
2. **Gloss mode ON + translation absent:** seed `glossMode: true`, mock the plain `GEMINI_OK_BODY`
   (no `TRANSLATION:` line) → Define opens the full card directly; `lookup-gloss` never appears.
3. **Gloss mode OFF (default):** seed no override (glossMode absent/false), mock the
   translation-bearing body → Define opens the full card directly even though a one-liner WAS
   available — proves the setting, not data availability alone, gates the feature.
4. **Gloss mode ON + NO_KEY:** seed no API key, `glossMode: true` → Define shows the full setup-invite
   card, never a gloss bubble (§2.3's error exception).
5. **Settings page:** the "Compact gloss" checkbox is visible on `options.html` (Chrome mounts
   `glossModeAvailable = true`) and, once checked and saved, `chrome.storage.local`'s
   `settings.glossMode` is `true`.

### 5.8 Global constraint reminder (not new to this card)

The e2e build must run with `GEMINI_API_KEY` cleared (`GEMINI_API_KEY= bun run build:chrome`) —
unrelated to this card's own logic, but every e2e spec in this repo depends on it (`docs/ROADMAP.md`
§4 C10).

## 6. Testing performed (PR evidence — replaces screenshot/video capture)

Per this worktree's `CLAUDE.md` (owner ruling 2026-07-16): **no screenshots or video for this PR.**
The PR body's "Testing performed" section lists the suites run, test counts, e2e scenarios
exercised (§5.7's 5 scenarios by name), and gates passed (lint, format check, typecheck×2 packages,
unit×3 packages, the Chrome build with the env key cleared, and the affected e2e spec files). No
`pr-assets/*` branch is created for this card.

## 7. Risk / rollback

- **Risk: moderate.** The highest-risk surface is the `cardOpen` state machine (§2.4) — getting it
  wrong either regresses an expanded card back into a bubble mid-interaction (jarring) or leaves
  `cardOpen` stuck `true` after a `close()` that should have reset it (gloss mode silently stops
  working until the next page load). Both failure modes are directly covered by §5.2's dedicated
  "post-expand stays expanded" and "`close()` resets `cardOpen`" tests, which assert DOM presence/
  absence, not just text content.
- **Second-highest risk:** the §4.4 regression on `chrome-storage-store.test.ts`/
  `safari-storage-store.test.ts`'s exact-shape `toEqual` assertions — an implementer who adds
  `glossMode` to the source but forgets the two existing test files will see an immediate, obvious
  local test failure (not a silent gap), and §5.5 makes updating them an explicit step.
- **No data migration.** `glossMode` is a brand-new optional field; a settings object stored before
  this card shipped simply has it read as `undefined` → normalized to `false` everywhere it's
  consumed (§4.3, §4.6) — the exact same "coerce a legacy-missing value" shape `theme`'s own
  `normalizeTheme()` already established.
- **Rollback:** revert the single PR. `translation` and `PublicSettings`'s other fields are
  unchanged; no stored data becomes invalid; a reader who had switched gloss mode on simply reverts
  to always seeing the full card (the pre-A5, and still current-if-OFF, behavior) with no other
  side effect — `glossMode` in already-written storage is simply ignored again.

## 8. Files touched (summary)

| File                                                                     | Change                                                                                                  |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `packages/app/src/ports.ts`                                              | `ResultRenderContext.anchor?`, `ResultRenderer.renderLoading` gains optional `anchor?` param            |
| `packages/app/src/domain/workflow.ts`                                    | pass `e.anchor` into `renderLoading` + `ctx`                                                            |
| `packages/app/src/domain/types.ts`                                       | `PublicSettings.glossMode?: boolean`                                                                    |
| `packages/app/src/wire.ts`                                               | `PublicSettingsSchema.glossMode` optional field                                                         |
| `packages/app/src/app/inline-bottom-sheet-renderer.ts`                   | gloss lifecycle, `cardOpen` state machine, `renderLoading`/`renderResult`/`renderError`/`close` updates |
| `packages/app/src/ui/lookup-gloss.ts`                                    | new — `<lookup-gloss>` component + `renderGlossState`/`GlossState`                                      |
| `packages/app/src/ui/register.ts`                                        | register `lookup-gloss`                                                                                 |
| `packages/app/src/ui/index.ts`                                           | export `lookup-gloss`                                                                                   |
| `packages/app/src/ui/settings-form.ts`                                   | `SettingsFormValue.glossMode?`, checkbox markup, `glossModeAvailable`, `collect()`/`set value()`        |
| `packages/app/test/fakes/index.ts`                                       | `FakeResultRenderer.loadingAnchor`                                                                      |
| `packages/app/test/ui/lookup-gloss.test.ts`                              | new                                                                                                     |
| `packages/app/test/app/inline-bottom-sheet-renderer.test.ts`             | + gloss-mode tests                                                                                      |
| `packages/app/test/workflow.test.ts`                                     | + anchor pass-through tests                                                                             |
| `packages/app/test/wire-schema.test.ts`                                  | + `glossMode` schema tests                                                                              |
| `packages/app/test/ui/settings-form.test.ts`                             | + `glossModeAvailable`/regression tests                                                                 |
| `packages/extension-chrome/src/content.ts`                               | `themedSettings.get()` sets `inline.glossMode`; `renderLoading` forwards anchor                         |
| `packages/extension-chrome/src/options.ts`                               | `DEFAULTS`, `toFormValue()`, `mountSettings()` gate flag                                                |
| `packages/extension-chrome/src/adapters/chrome-storage-store.ts`         | `glossMode` in `get()`/`defaults()`                                                                     |
| `packages/extension-chrome/src/adapters/chrome-storage-store.test.ts`    | update 2 existing `toEqual` + 1 new test                                                                |
| `packages/extension-safari/src/adapters/safari-storage-store.ts`         | `glossMode` in `get()`/`defaults()` (compile parity, §3)                                                |
| `packages/extension-safari/src/adapters/safari-storage-store.test.ts`    | update 2 existing `toEqual`                                                                             |
| `packages/extension-safari/src/adapters/message-relay-settings-store.ts` | `glossMode` in `stripped` object (compile parity)                                                       |
| `packages/extension-safari/src/options.ts`                               | `DEFAULTS.glossMode` (compile parity; `glossModeAvailable` never set)                                   |
| `packages/extension-chrome/e2e/helpers.ts`                               | `GEMINI_TRANSLATION_BODY`, `SettingsOverrides.glossMode?`                                               |
| `packages/extension-chrome/e2e/a5-gloss-mode.spec.ts`                    | new — 5 scenarios (§5.7)                                                                                |

No change to `packages/app/src/ui/lookup-card.ts`, `packages/app/src/ui/bottom-sheet.ts`,
`packages/app/src/app/router.ts`, `packages/extension-chrome/src/adapters/
chrome-side-panel-mirror.ts`, `packages/extension-safari/src/content.ts`, `packages/app/src/domain/
prompt-template.ts`, `packages/app/src/domain/default-template.ts`, `docs/index.html`, or any
manifest file.

## 9. Concurrency

Per CONTRACTS §5's hot-file groupings, this card touches files other not-yet-shipped Category A/B
cards also modify:

- **Lookup-card UI group (A1 A2 A3 A5 A7 A10):** this card does NOT touch `lookup-card.ts` itself
  (§4.10), but DOES touch `inline-bottom-sheet-renderer.ts`, which A1 (streamed answers) and A7 (pin
  cards) are also likely to touch (both concern how/where the card renders). Serialize against A1/
  A7 on this file specifically.
- **Content-script/trigger group (A5 A6 A13 A14 A15 B3 B4):** this card touches `content.ts` (a
  small, additive edit — one new line in `themedSettings.get()`, one signature change in the
  `renderer` literal's `renderLoading`). Serialize against A6/A13/A14/A15/B3/B4 on `content.ts`.
- **Settings-form group (A5 A9 A13 B6 C9):** this card adds one checkbox + one gating property to
  `settings-form.ts`. Serialize against A9/A13/C9 (B6 is side-panel/words-page, unlikely to touch
  `settings-form.ts` itself, but listed per CONTRACTS' own grouping).
- **`packages/app/src/ports.ts` / `packages/app/src/domain/workflow.ts`:** not in CONTRACTS §5's
  named hot-file list, but any other in-flight card that also extends `ResultRenderContext` or
  `ResultRenderer` (none currently known) would need to serialize here too — flagging for the
  orchestrator's awareness since these are small, central, easy-to-collide files.
- **`packages/app/src/wire.ts` (any card adding messages):** this card does NOT add a message, only
  one optional field to an existing reply schema — lower collision risk than a new message arm, but
  still the same file other cards' wire changes touch.
