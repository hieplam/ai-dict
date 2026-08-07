# A14 — Double-click trigger

Roadmap card: `docs/ROADMAP.md` §4 A14 (`docs/ROADMAP.md:288-296`, Impact 2 · Effort S · Score
2.0). Depends on: — (independent). Scope fence (quoted verbatim): "Off by default (many pages use
double-click natively). Never fires in text fields or interactive elements." **Lead decides:**
guard list. **Escalate:** none.

## 1. Problem (grounded in code)

Today a lookup is always two gestures, wired entirely through `runLookupWorkflow`
(`packages/app/src/domain/workflow.ts:37-148`):

- `DomSelectionSource` (`packages/app/src/app/dom-selection-source.ts:35-51`) listens for
  `mouseup`/`touchend` on `document`, reads `window.getSelection()` via `defaultReader()`
  (`dom-selection-source.ts:15-31`), and — when the reader yields a non-null `SelectionEvent` —
  invokes the workflow's callback (`dom-selection-source.ts:42-45`: `const e = this.read(); if (e)
cb(e);`). **Corrected on 2026-07-23 re-review:** an earlier draft of this spec assumed A15
  (trigger-latency-budget)'s `SELECTION_FIRED_MARK` instrumentation had already landed in this
  file. Verified against this worktree today: it has not — A15 has only a spec/plan pair on disk
  (`docs/superpowers/specs/2026-07-17-a15-trigger-latency-budget-design.md`), no branch, no
  `SELECTION_FIRED_MARK` export anywhere in `packages/app/src`. This card's plan therefore
  implements against the file exactly as it stands today, with no perf-mark line. See §6.3 and §9
  Concurrency for the (fully symmetric) handling if A15 lands first.
- The workflow's `onSelection` callback (`workflow.ts:123-139`) calls
  `deps.trigger.show(e.anchor, onClick)` — this is gesture 1, the floating **Define** bubble
  (`ChromeFloatingTrigger`, `packages/extension-chrome/src/adapters/chrome-floating-trigger.ts:29-42`).
- Only when the reader clicks that bubble does `onClick` fire (`workflow.ts:124-138`): a
  cooldown check (`COOLDOWN_MS = 2000`, `workflow.ts:17`), then `runLookup(e)`
  (`workflow.ts:45-121`), which fetches settings, builds the `LookupRequest`, and calls
  `deps.client.lookup(...)`. This is gesture 2.

There is no code path anywhere that fires a lookup directly off a selection event — every lookup
requires the explicit second click on the bubble. `SelectionSource` (`packages/app/src/ports.ts:12-14`)
exposes only `onSelection(cb)`; `SelectionEvent` (`packages/app/src/domain/types.ts:8-14`) carries
`text, sentence, anchor, url, title` and nothing that distinguishes _how_ the selection was made
(drag-select vs. native double-click word-select both look identical to the reader).

`PublicSettings` (`domain/types.ts:164-176`) has no per-behavior toggle for this — the closest
precedent is `theme`/`configuredProviders`, both required fields threaded through
`ChromeStorageStore.get()` (`packages/extension-chrome/src/adapters/chrome-storage-store.ts:44-60`)
and the `PublicSettingsSchema` wire schema (`packages/app/src/wire.ts:61-68`).

## 2. Design question 1 — where does double-click _detection_ live, and how?

Three ways to detect "this selection came from a double-click, not a drag":

**(a) A brand-new `dblclick` listener** alongside the existing `mouseup`/`touchend` pair in
`DomSelectionSource`.

**(b) Inspect `MouseEvent.detail` on the existing `mouseup` listener.** The UI Events spec (and
every evergreen browser) sets `detail` to the current click count for a mouse-button event —
`1` for a normal click, `2` for the second click of a recognized double-click, `3` for a triple
click, and so on, based on the browser's own temporal/spatial "was this close enough to the last
click to count as a multi-click" logic. Chromium, Firefox, and WebKit all implement this
identically; nothing OS- or extension-specific is involved.

**(c) A separate SelectionSource method** (e.g. `onDoubleClick(cb)`) added to the `SelectionSource`
port, so double-click is a distinct signal from `onSelection`.

### Pinned: (b) — read `MouseEvent.detail` on the existing `mouseup` handler

Grounding fact that makes this the only 1-line-of-logic option: a real double-click's **first**
mouseup (a plain click, no drag) leaves the page selection **collapsed**
(`window.getSelection().isCollapsed === true`), so `defaultReader()` returns `null`
(`dom-selection-source.ts:17`, the `if (!sel || sel.isCollapsed || sel.rangeCount === 0) return
null;` guard) and the existing handler's one-line `if (e) cb(e);` guard
(`dom-selection-source.ts:44`) already skips it — `cb` is never invoked for that first mouseup.
Only the **second** mouseup — the one the browser fires at the exact moment it auto-selects the
double-clicked word — produces a real (non-collapsed) selection, and that is precisely the same
event object whose `.detail === 2`. So checking `detail` on the mouseup that already reaches `cb`
costs one boolean expression; no event race, no double-invocation, no new listener registration/
teardown pair to manage.

Rejected — (a) a new `dblclick` listener: would fire as a **third**, later event on top of the two
mouseups the double-click already generates, forcing either an extra debounce (to stop `mouseup`
from independently reporting the same selection first) or accepting the button flashing open then
snapping into the auto-fired state. (b) has no such race because it reuses the exact mouseup that
already carries the correct selection.

Rejected — (c) a new port method: `SelectionSource` is implemented once
(`DomSelectionSource`, shared verbatim by both Chrome and Safari content scripts — see
`packages/extension-chrome/src/content.ts:74`, `packages/extension-safari/src/content.ts:35`) and
consumed by exactly one call site (`workflow.ts:123`). A second port method would double every
future `SelectionSource` fake/implementation for a distinction that (b) expresses as one field on
the existing event payload. Enriching the payload (`viaDoubleClick?: boolean` on `SelectionEvent`)
is the smaller, `ref-core-dependency-rule`-compliant change — no port surface grows.

**Triple-click is deliberately excluded** — `detail === 2` exactly, not `>= 2`. A triple-click
conventionally selects a whole sentence/paragraph (`https://` spec behavior every browser follows);
auto-firing a lookup on an entire paragraph would silently balloon the request size and violate the
card's own "double-click on **a word**" framing. A reader who triple-clicks still just sees the
normal Define bubble, exactly like any other multi-word selection today.

**Touch is out of scope** — the `touchend` listener is untouched. Real double-tap has no reliable,
spec-guaranteed `detail`-style click-count signal the way mouse events do (browsers do not
consistently populate a multi-tap count on synthetic touch-derived events), and the card's own
framing ("dictionary power-users expect double-click from tools like Eudic/GoldenDict") is a
desktop-mouse comparison. Double-tap-to-define is explicitly left as unscoped future work, not
silently half-implemented.

## 3. Design question 2 — the guard list (the card's one "Lead decides")

The card names an illustrative list with one open item: "guard list (input, textarea,
`[contenteditable]`, select, button, a?)". Pinned:

**Guarded (never auto-fire the double-click bypass there): `input`, `textarea`, `select`,
`button`, and any element matching `[contenteditable]:not([contenteditable="false"])`** (nearest
ancestor via `Element.closest(...)`, so a `<b>` inside a `<button>` or inside a contenteditable
`<div>` is still caught).

**`<a>` (anchor) is deliberately NOT guarded.** Rationale: a native double-click never navigates —
only a single click does — so there is no accidental-navigation risk to guard against. Excluding
anchors would instead silently kill the feature on exactly the content where one-gesture lookup
pays off the most: link-dense prose (Wikipedia-style articles, footnoted essays, news sites that
wrap named entities in links). The card's own "Why" ("heavy users … dictionary power-users") reads
those pages constantly. Rejected alternative: guarding `a` too, for symmetry with "interactive
elements" — rejected because it trades away the feature's best use case for a safety property
(preventing navigation) that double-click never threatens in the first place.

**Why the guard suppresses only the flag, not the selection event itself:** guarded elements keep
their exact pre-existing behavior unchanged — whatever the ordinary select-then-click-the-button
flow already does inside an `<input>`/`[contenteditable]` today is untouched by this card. The
guard's only job is to stop the **new** auto-fire bypass from ever activating there; it is not a
retroactive change to selection behavior in form/editable contexts.

**Why the guard is an explicit target check, not reliance on `window.getSelection()`'s native
inability to see inside `<input>`/`<textarea>`:** it's true that real browsers never expose a
`Selection` spanning into a native form control's internal text buffer (so `defaultReader()` would
already return `null` there without any extra code). But that's an implicit, engine-dependent side
effect, not a designed guarantee — and it says nothing about `[contenteditable]`, `<select>`, or
`<button>`, where real DOM text selection _is_ visible to `window.getSelection()`. An explicit,
directly-testable target check is correct, portable, and covers every case in one place instead of
depending on incidental per-element selection semantics.

## 4. Design question 3 — the opt-in setting: field, shape, and where it's read

**Pinned:** a new optional field, `doubleClickLookup?: boolean`, on `PublicSettings`
(`domain/types.ts:164-176`) and its wire mirror `PublicSettingsSchema`
(`wire.ts:61-68`) — **optional, not required**, and a new settings-form checkbox
(§6.5) that persists it exactly like `cacheEnabled`/`saveHistory` do today.

**Why optional, when `hasKey`/`theme`/`configuredProviders` are all required fields on the same
type:** `PublicSettings` is read (as a wire reply) or hand-built as a test fixture in roughly a
dozen places across `packages/app/test/**`, `packages/extension-chrome/**`, and
`packages/extension-safari/**` (`grep -rl "configuredProviders:" packages` → 16 files, verified in
this worktree). Every one of those is a `z.strictObject`-validated or `toEqual`-asserted literal.
Adding a **required** field would force a same-card edit to every one of them just to keep the
existing suite compiling/green — collateral churn wildly out of proportion to an "Effort S" card,
and it multiplies merge-conflict surface with every other card mid-flight against those same files.
Declaring it **optional** (mirroring the established evolution pattern already used for
`LookupRequest.provider?`, `LookupRequest.forceLiteral?`, `LookupResult.definedAs?/.translation?/
.nudge?` — all additive, all optional) means every existing literal that omits the key stays
valid TypeScript and stays passing under `z.strictObject`'s optional-key handling — zero edits to
files this card doesn't otherwise need to touch. This is squarely CONTRACTS §3's "wire evolution
precedent": _"optional in-flight request/response fields are ordinary evolution, not an
escalation."_ `PublicSettings` isn't a request/response payload, but the same reasoning — an
additive, backward-compatible capability flag — applies without qualification.

**Where it's produced:** `ChromeStorageStore.get()` (`chrome-storage-store.ts:44-60`) and
`SafariStorageStore.get()` (`packages/extension-safari/src/adapters/safari-storage-store.ts:39-55`)
each gain one conditional-spread line: `...(s?.doubleClickLookup ? { doubleClickLookup: true } : {})`.
**Pinned: conditionally spread the key in, never emit an explicit `false`.** Both adapters' `get()`
methods are asserted with exact `toEqual({...})` in their existing test suites
(`chrome-storage-store.test.ts:29-36,65-72`, `safari-storage-store.test.ts:33-40,46-53`) — an
object with extra key `doubleClickLookup: false` would fail those `toEqual`s (Vitest's `toEqual`
rejects extra properties, unlike `toMatchObject`). Omitting the key entirely when unset/false keeps
every existing assertion passing untouched, is exactly what "optional" means, and is the same
conditional-spread idiom `workflow.ts` already uses for `ctx.providers`/`ctx.onSwitchProvider`
(`workflow.ts:92-102`).

**Where it's consumed:** only `workflow.ts`'s selection callback (§5.2) — nothing on the wire/
router path needs it. `sw.ts`'s `readFullSettings()` (both shells) is unrelated (it exists to feed
the lookup-client/provider-key/toggle plumbing, none of which this card touches) and needs no
change.

## 5. Design question 4 — where the auto-fire decision executes, and avoiding a button flash

`workflow.ts`'s `onSelection` callback currently shows the trigger bubble synchronously and defines
the cooldown-gated fire logic inline as the bubble's `onClick` (`workflow.ts:123-139`). Two options
for wiring the double-click bypass:

**(a) Always call `trigger.show(...)` first, then separately check settings and call the same
onClick function if enabled.** Simple, but for an opted-in reader the bubble would render for one
paint and then almost immediately get torn down by the auto-fired `runLookup`'s
`trigger.hide()` (`workflow.ts:56-58`) — a visible flash on every single double-click.

**(b) Decide before ever showing the bubble.** For a `viaDoubleClick` event, await
`deps.settings.get()` first; only call `deps.trigger.show(...)` in the branch where the setting is
off (or settings couldn't be read) — the branch where the setting is on skips `show()` entirely
and calls the SAME cooldown-gated `fire()` the button's click would have called.

**Pinned: (b).** `deps.settings.get()` is already awaited in the exact same file for every lookup
(`workflow.ts:56`), routes through `MessageRelaySettingsStore`'s in-memory cache
(`packages/extension-chrome/src/adapters/message-relay-settings-store.ts:15-23`, invalidated only
on `chrome.storage.onChanged`), so this extra call is a cache hit in the overwhelmingly common case
and adds no perceptible latency — while (a) guarantees a visible flash on literally every opted-in
double-click.

The cooldown-gated fire logic itself is factored out of the inline arrow function into a named
`fire()` closure, called from **both** the button's `onClick` and the double-click auto-fire branch
— so the spam gate (`COOLDOWN_MS`, `workflow.ts:129-133`) and `runLookup`'s abort-in-flight
semantics (`workflow.ts:50-52`) apply **identically** regardless of which gesture triggered it. This
is what the card's "both can coexist; dblclick bypasses trigger" line means concretely: the trigger
button keeps working exactly as it does today; a double-click, when the setting is on, is simply a
second way to reach the same `fire()`.

Settings-read failure (rejected promise) falls back to showing the bubble normally — never a silent
no-op — matching the same "fail toward the existing behavior" instinct as the rest of this file
(e.g. `runLookup`'s `try/finally` around `deps.trigger.hide()`, `workflow.ts:54-58`).

## 6. The change

### 6.1 `packages/app/src/domain/types.ts`

- `SelectionEvent` (`types.ts:8-14`) gains one optional field:

```ts
export interface SelectionEvent {
  text: string;
  sentence: string;
  anchor: AnchorRect;
  url: string;
  title: string;
  /** A14: true when this selection came from a native double-click (MouseEvent.detail === 2)
   * on a non-guarded element, rather than a manual drag-select or the touchend path. Absent for
   * every other selection. */
  viaDoubleClick?: boolean;
}
```

- `PublicSettings` (`types.ts:164-176`) gains one optional field, placed after
  `configuredProviders`:

```ts
export interface PublicSettings {
  targetLang: string;
  outputFormat: string;
  promptEnvelope: string;
  hasKey: boolean;
  theme: Theme;
  configuredProviders: Provider[];
  /** A14: opt-in — double-click a word to define it immediately, bypassing the trigger button.
   * Off (absent/falsy) by default. Read by runLookupWorkflow's selection handler only; nothing
   * on the router/wire path branches on it. */
  doubleClickLookup?: boolean;
}
```

### 6.2 `packages/app/src/wire.ts`

`PublicSettingsSchema` (`wire.ts:61-68`) gains the matching optional field:

```ts
const PublicSettingsSchema = z.strictObject({
  targetLang: z.string(),
  outputFormat: z.string(),
  promptEnvelope: z.string(),
  hasKey: z.boolean(),
  theme: z.enum(['sepia', 'dark', 'contrast', 'system']),
  configuredProviders: z.array(ProviderEnum),
  doubleClickLookup: z.boolean().optional(),
});
```

The compile-time drift guard (`wire.ts:206`,
`AssertEqual<z.infer<typeof PublicSettingsSchema>, PublicSettings>`) fails `tsc` if these two ever
disagree — both sides are edited in the same task (§ plan Task 1) for exactly that reason.

### 6.3 `packages/app/src/app/dom-selection-source.ts`

Per §2/§3, add a module-private guard helper and enrich the `mouseup` handler. **Concurrency
note (corrected 2026-07-23):** verified directly against this worktree today — A15
(trigger-latency-budget) has **not** landed here (no `SELECTION_FIRED_MARK` export anywhere in
`packages/app/src`, no A15 branch). The diff below is written against the file exactly as it
stands right now — no perf-mark line, no `SELECTION_FIRED_MARK` import/export. **If A15 lands
first** (before this plan's Task 2 executes), its own spec adds `export const
SELECTION_FIRED_MARK = 'ai-dict:selection-fired';` near the top of the file and one
`performance.mark(SELECTION_FIRED_MARK);` line as the first statement inside the `if (e) {`
block below — purely additive, no conflict with anything in this diff; the implementer keeps
that line and adds this card's `viaDoubleClick` logic immediately after it. See §9 Concurrency.

```ts
import type { SelectionSource, SelectionEvent, AnchorRect } from '../index';

const TERMINATORS = ['.', '!', '?'];

// A14: elements where a native double-click means "select text to edit/operate", not "define
// this word" — the opt-in double-click trigger stays silent there. The ordinary select-then-
// click-the-button flow is completely UNCHANGED for these elements (this guard only ever
// suppresses the extra `viaDoubleClick` flag, never the SelectionEvent itself). `a` (anchor) is
// deliberately NOT in this list — see the design spec's "Guard list" section (§3) for why
// excluding links would defeat the feature on link-dense reading pages for no safety benefit (a
// dblclick never navigates; only a single click does).
const GUARDED_SELECTOR =
  'input, textarea, select, button, [contenteditable]:not([contenteditable="false"])';

function isGuardedTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(GUARDED_SELECTOR) !== null;
}

export function extractSentence(full: string, selStart: number, selEnd: number): string {
  const before = full.slice(0, selStart);
  const start = Math.max(...TERMINATORS.map((t) => before.lastIndexOf(t))) + 1;
  const after = full.slice(selEnd);
  const ends = TERMINATORS.map((t) => after.indexOf(t)).filter((i) => i >= 0);
  const end = ends.length ? selEnd + Math.min(...ends) + 1 : full.length;
  return full.slice(start, end).trim();
}

// Default DOM reader: window selection → SelectionEvent. Thin + covered by e2e; unit tests inject a fake.
function defaultReader(): SelectionEvent | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const text = sel.toString().trim();
  if (!text) return null;
  const range = sel.getRangeAt(0);
  const full = range.startContainer.textContent ?? text;
  const r = range.getBoundingClientRect();
  const anchor: AnchorRect = { x: r.x, y: r.y, w: r.width, h: r.height };
  return {
    text,
    sentence: extractSentence(full, range.startOffset, range.endOffset),
    anchor,
    url: location.href,
    title: document.title,
  };
}

type DocEvents = Pick<Document, 'addEventListener' | 'removeEventListener'>;

export class DomSelectionSource implements SelectionSource {
  constructor(
    private readonly doc: DocEvents,
    private readonly read: () => SelectionEvent | null = defaultReader,
  ) {}

  onSelection(cb: (e: SelectionEvent) => void): () => void {
    const handler = (ev: Event): void => {
      const e = this.read();
      if (e) {
        // A14: a native double-click delivers detail === 2 on its second mouseup (UI Events'
        // click-count semantics; identical across Chromium/Firefox/WebKit) — the exact event
        // that also carries the browser's auto-selected word, because a plain first click alone
        // leaves the selection collapsed (this.read() returns null for it, so this branch is
        // never reached on the first click of a double-click — see design spec §2). Triple-click
        // (detail 3, "select the paragraph") deliberately does NOT count. touchend never sets
        // this flag: double-tap is out of scope (design spec §2).
        const viaDoubleClick =
          ev.type === 'mouseup' && (ev as MouseEvent).detail === 2 && !isGuardedTarget(ev.target);
        cb(viaDoubleClick ? { ...e, viaDoubleClick: true } : e);
      }
    };
    for (const t of ['mouseup', 'touchend'] as const) this.doc.addEventListener(t, handler);
    return () => {
      for (const t of ['mouseup', 'touchend'] as const) this.doc.removeEventListener(t, handler);
    };
  }
}
```

### 6.4 `packages/app/src/domain/workflow.ts`

Replace the `onSelection` callback (`workflow.ts:123-139`) — the cooldown-gated click logic is
factored into a named `fire()` closure, reused by both the button and the new auto-fire branch:

```ts
const teardown = deps.selection.onSelection((e) => {
  // Cooldown gate, checked BEFORE runLookup. runLookup begins by aborting the in-flight
  // request, so gating here means a too-fast second click neither fires a new request NOR
  // cancels the first one already in flight — first-come-first-served. Shared by the trigger
  // button's click AND the A14 double-click auto-fire below — both routes to firing a lookup
  // go through this exact same gate.
  const fire = (): void => {
    const t = now();
    if (t - lastFireAt < COOLDOWN_MS) {
      deps.trigger.hide();
      deps.renderer.renderError(mapError({ kind: 'cooldown' }));
      return;
    }
    lastFireAt = t;
    void runLookup(e).catch((err) =>
      deps.renderer.renderError(mapError({ kind: 'thrown', error: err })),
    );
  };
  // A14: an opt-in double-click bypasses the trigger button entirely. Decide BEFORE ever
  // showing the bubble, so an opted-in reader never sees it flash open and instantly close
  // (design spec §5) — settings.get() resolves first, then either fires immediately (on) or
  // shows the button exactly like any other selection (off, the default). A settings-read
  // failure fails toward the existing behavior: show the button rather than silently doing
  // nothing.
  if (e.viaDoubleClick) {
    void deps.settings.get().then(
      (s) => {
        if (s.doubleClickLookup) fire();
        else deps.trigger.show(e.anchor, fire);
      },
      () => deps.trigger.show(e.anchor, fire),
    );
    return;
  }
  deps.trigger.show(e.anchor, fire);
});
```

No other line in `workflow.ts` changes; `runLookup`, the cooldown constant, and the teardown
function are untouched.

### 6.5 `packages/app/src/ui/settings-form.ts`

- `SettingsFormValue` (`settings-form.ts:29-45`) gains one optional field, after `saveHistory`:

```ts
export interface SettingsFormValue {
  provider: Provider;
  apiKey: string;
  openaiApiKey: string;
  anthropicApiKey: string;
  targetLang: string;
  outputFormat: string;
  promptEnvelope: string;
  cacheEnabled: boolean;
  saveHistory: boolean;
  /** A14: opt-in double-click-to-define. Optional so existing test fixtures that predate this
   * field stay valid; collect()/the `set value()` setter always supply a concrete boolean. */
  doubleClickLookup?: boolean;
  theme: Theme;
}
```

- New markup section, inserted right after the "Appearance" section's closing `</section>`
  (`settings-form.ts:201`) and before "Privacy & data" (`settings-form.ts:202`) — reuses the
  existing `.check` and `.seg-help` classes (zero new CSS):

```html
<section class="sec" aria-labelledby="sec-trigger">
  <h2 class="sec-h" id="sec-trigger">Trigger</h2>
  <label class="check"><input type="checkbox" id="dblclick-lookup" /> Double-click to define</label>
  <p class="seg-help">
    Off by default. Double-click a word to look it up immediately, skipping the Define button — each
    double-click spends a lookup. Never fires in text fields, form controls, or editable text.
  </p>
</section>
```

(This puts the copy's cost-disclosure — "each double-click spends a lookup" — directly next to
the control, per constraint 4: "features that spend tokens say so first.")

- `collect()` (`settings-form.ts:563-580`) gains one line:

```ts
      doubleClickLookup: this.q<HTMLInputElement>('#dblclick-lookup').checked,
```

- `set value(v)` (`settings-form.ts:582-611`) gains one line (defaulting the checkbox when the
  optional field is absent from a stored/legacy value):

```ts
this.q<HTMLInputElement>('#dblclick-lookup').checked = v.doubleClickLookup ?? false;
```

### 6.6 `packages/extension-chrome/src/adapters/chrome-storage-store.ts`

`get()` (`chrome-storage-store.ts:44-60`) gains one conditionally-spread line — **never an
explicit `false`** (§4):

```ts
  async get(): Promise<PublicSettings> {
    const s = await this.read();
    return {
      targetLang: s?.targetLang ?? DEFAULT_TARGET,
      outputFormat: s?.outputFormat ?? DEFAULT_OUTPUT_FORMAT,
      promptEnvelope: resolvePromptEnvelope(s ?? {}),
      hasKey: hasKeyFor(s ?? {}) || this.envGeminiKey,
      theme: normalizeTheme(s?.theme),
      configuredProviders: configuredProvidersFor(s ?? {}, { envGeminiKey: this.envGeminiKey }),
      ...(s?.doubleClickLookup ? { doubleClickLookup: true } : {}),
    };
  }
```

`defaults()` and `set()` in this file are unchanged — `set()` only ever patches
`targetLang`/`outputFormat` (unaffected by this card), and `doubleClickLookup` reaches storage via
the settings-form's full-object save path (§6.8), not through `SettingsStore.set()`.

### 6.7 `packages/extension-safari/src/adapters/safari-storage-store.ts`

Identical one-line change to `get()` (`safari-storage-store.ts:39-55`), for platform parity — the
shared `workflow.ts`/`dom-selection-source.ts` core already gives Safari's content script
(`packages/extension-safari/src/content.ts:34-40`) the double-click behavior automatically; without
this adapter change the setting would render on Safari's options page (it reuses the same shared
`settings-form.ts`) but silently do nothing there, which is a worse outcome than not shipping it at
all. Same conditional-spread line, same rationale as §6.6.

### 6.8 `packages/extension-chrome/src/options.ts`

`toFormValue()` (`options.ts:67-80`) gains one line so a previously-saved value survives a page
reload — without this, the checkbox would always render unchecked regardless of what's in storage,
even though `collect()` would still fail to erase what was already saved (it's not this line's job
to persist; only to correctly _display_ the persisted value):

```ts
function toFormValue(s: Settings): SettingsFormValue {
  return {
    provider: s.provider,
    apiKey: s.apiKey,
    openaiApiKey: s.openaiApiKey,
    anthropicApiKey: s.anthropicApiKey ?? '',
    targetLang: s.targetLang,
    outputFormat: s.outputFormat,
    promptEnvelope: s.promptEnvelope,
    cacheEnabled: s.cacheEnabled,
    saveHistory: s.saveHistory,
    doubleClickLookup: s.doubleClickLookup,
    theme: s.theme,
  };
}
```

`wireSettings`'s `save` listener (`options.ts:114-134`) needs **no change**: it already does
`{ ...cur, ...next, hasKey: ..., configuredProviders: ... }`, and `next` (a `SettingsFormValue`)
now includes `doubleClickLookup` from `collect()` — the existing spread carries it through to
`chrome.storage.local.set(...)` automatically, exactly like `cacheEnabled`/`saveHistory` already do.

### 6.9 `packages/extension-safari/src/options.ts` — no change

Safari's options page assigns the whole stored `Settings` object directly as the form's `.value`
(`packages/extension-safari/src/options.ts:37`: `(form as unknown as { value: Settings }).value =
s;`), rather than rebuilding a narrower literal — so it already carries `doubleClickLookup` through
verbatim once §6.1/§6.7 land. Its `save` listener (`options.ts:56-70`) uses the same
`{ ...cur, ...next }` spread as Chrome's, so persistence needs no change either.

### 6.10 No change to `packages/extension-chrome/src/sw.ts` / `packages/extension-safari/src/sw.ts`

`readFullSettings()` in both files exists purely to feed the lookup-client/provider-key/toggle
plumbing (`readToggles`, `getApiKey`, `getProvider`) — none of which reads or needs
`doubleClickLookup`. Left untouched, including its inline default-settings literal (the field is
optional; omitting it there is exactly as valid as every other file that doesn't mention it).

### 6.11 No change to `packages/app/src/app/router.ts` / no new wire message

`settings.get`'s handler (`router.ts:219-220`) already returns `deps.settings.get()` verbatim —
whatever `ChromeStorageStore`/`SafariStorageStore` produce (§6.6/§6.7) flows through unmodified.
This card adds no wire message type, so the CONTRACTS §2 "wire.ts arm + router.ts case = ONE task"
rule does not apply — there is no new arm.

### 6.12 No change to `packages/extension-chrome/src/manifest.json` / no new permission

The feature is pure client-side gating of an existing, already-permitted flow (selection → lookup);
nothing about it needs a new host permission or content-script registration.

### 6.13 `packages/extension-chrome/e2e/helpers.ts` — two new fixture helpers

**Defect found in the original draft of this spec (fixed 2026-07-23):** §8.5's testing strategy
said "double-click 'bank' on the fixture paragraph" and "the fixture also has a
`<div id="edit" contenteditable="true">` region", but neither capability existed in this worktree's
e2e harness. Verified: `selectWord` (`helpers.ts:198-215`) dispatches its synthetic `mouseup` on
`document` itself (`document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))`) with no
`detail` option — `event.target` is `document`, which is never `instanceof Element`, so
`isGuardedTarget` would trivially always read "unguarded" regardless of the fixture, and there is
no `detail: 2` anywhere. `gotoFixture` (`helpers.ts:158-172`) only ever serves a single `<p id="t">`
paragraph — no contenteditable region exists to guard-test against. Two small additions close
this, following the exact pattern `gotoResetFixture` already established for fixture variants:

```ts
/**
 * A14: like selectWord, but dispatches the synthetic mouseup ON the container element (not
 * document) with detail: 2 — the UI Events click-count value a real double-click's second
 * mouseup carries. Dispatching on the container (not document) means `event.target` is that
 * element, so DomSelectionSource's `isGuardedTarget(ev.target)` check exercises the real guard
 * list against whatever element actually contains the word (see design spec §2/§3).
 */
export async function dblclickWord(page: Page, id: string, word: string): Promise<void> {
  await page.evaluate(
    ({ id, word }) => {
      const container = document.getElementById(id)!;
      const textNode = container.firstChild!;
      const text = textNode.textContent ?? '';
      const start = text.indexOf(word);
      const range = document.createRange();
      range.setStart(textNode, start);
      range.setEnd(textNode, start + word.length);
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
      container.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, detail: 2 }));
    },
    { id, word },
  );
}

/**
 * A14: like gotoFixture, but the page also ships a `<div id="edit" contenteditable="true">`
 * region — the guarded-target e2e proves the double-click bypass never fires inside it even
 * with the feature switched on (design spec §3's guard list).
 */
export async function gotoEditableFixture(
  page: Page,
  paragraph = 'The bank by the river is steep.',
  editableText = 'Edit this bank statement.',
): Promise<void> {
  await page.route('http://test.fixture/', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: `<html><body><p id="t">${paragraph}</p><div id="edit" contenteditable="true">${editableText}</div></body></html>`,
    }),
  );
  await page.goto('http://test.fixture/');
}
```

Both are additive exports; no existing helper's signature changes.

## 7. Scope fence (from the card, held exactly)

- **Off by default.** `doubleClickLookup` is optional/absent until a reader explicitly checks the
  new "Trigger" section's box and saves — §4, §6.5.
- **Never fires in text fields or interactive elements.** `isGuardedTarget` — §3, §6.3. The
  ordinary select-then-click flow is completely unaffected inside guarded elements; only the new
  auto-fire bypass is suppressed there.
- **Both flows coexist; dblclick bypasses the trigger.** The button keeps working exactly as
  today; a double-click, when enabled, is a second way to reach the same cooldown-gated `fire()`
  — §5, §6.4.
- **Constraint 4 (token-spending features say so first):** the settings-form copy states the cost
  ("each double-click spends a lookup") directly beside the checkbox, before it can be enabled —
  §6.5. Every lookup this feature triggers remains user-initiated (the double-click itself is the
  explicit action) — no background/unattended LLM call is introduced.
- **S1 untouched:** no code in this card reads, logs, or exports `apiKey`/`openaiApiKey`/
  `anthropicApiKey`; the new setting is a plain boolean alongside `theme`/`cacheEnabled`.
- **Tokens/permissions/manifest untouched** — §6.12; UI reads only the existing `.check`/
  `.seg-help` classes (already `--ad-*`-token-based), no new colors or CSS.

## 8. Testing strategy

1. **Unit — `packages/app/test/app/dom-selection-source.test.ts`:**
   - a `detail: 2` `mouseup` dispatched on a plain (unguarded) element stamps
     `viaDoubleClick: true` onto the emitted event.
   - a `detail: 1` `mouseup` and a `detail: 3` `mouseup` on the same element do **not** set the
     flag (exact-match, not `>= 2`).
   - `detail: 2` dispatched with target = each of `input`, `textarea`, `select`, `button` does
     **not** set the flag (guarded), but the event still fires (unflagged) — the existing
     select-then-click path is unaffected.
   - `detail: 2` dispatched on a nested element inside a `[contenteditable="true"]` ancestor does
     not set the flag (closest() walk).
   - `detail: 2` dispatched with target = an `<a href="#">` **does** set the flag (anchors are not
     guarded — §3).
   - a `touchend` dispatch never carries `viaDoubleClick`, regardless of any `detail` value.
2. **Unit — `packages/app/test/workflow.test.ts`:** extend the existing `pub()`/`harness()`
   helpers with an optional `doubleClickLookup` param, then:
   - `doubleClickLookup: true` + a `viaDoubleClick: true` selection auto-fires `runLookup` with no
     call to `trigger.click()`.
   - the setting off (default) + the same double-click selection only shows the trigger (no
     `result`/`loading` render) until the button is actually clicked.
   - the setting on + a plain (non-double-click) selection never auto-fires — only
     `viaDoubleClick` events bypass the button.
   - the double-click auto-fire path is still cooldown-gated: a second double-click inside
     `COOLDOWN_MS` renders the same `RATE_LIMIT`/"Slow down" error as a rapid double-button-click
     does today.
3. **Unit — `packages/app/test/ui/settings-form.test.ts`:** update the "groups controls into ...
   sections" test to include `'Trigger'` in the expected heading order (between `'Appearance'` and
   `'Privacy & data'`); add `'#dblclick-lookup'` to the "keeps every required control" list; new
   test asserting the checkbox defaults unchecked, round-trips `true`/`false` through
   `value`/`collect()`, and is included (optionally, matching existing fixtures) in the emitted
   `save` event detail.
4. **Unit — `chrome-storage-store.test.ts` / `safari-storage-store.test.ts`:** new test per file —
   `get()` omits `doubleClickLookup` entirely when unset (does not add a stray `false` key,
   verified with `'doubleClickLookup' in pub === false` so the existing exact `toEqual` assertions
   keep passing unmodified) and surfaces `doubleClickLookup: true` when the stored settings object
   has it.
5. **e2e — new `packages/extension-chrome/e2e/a14-double-click-trigger.spec.ts`**, using the two
   new helpers from §6.13 (`dblclickWord`, `gotoEditableFixture`):
   - Off by default: `seedSettings(page)` (no override) + `mockGemini(context)`, `dblclickWord`
     "bank" on the fixture paragraph → the trigger bubble is still shown, no card renders, and
     `calls.count` stays `0` until the bubble is actually clicked.
   - Opted in: `seedSettings(page, { doubleClickLookup: true })` + `mockGemini(context)`,
     `dblclickWord` "bank" → `bottom-sheet lookup-card` renders the result **without** ever calling
     `openTrigger()`, and `calls.count === 1`.
   - Opted in but guarded: same settings, `gotoEditableFixture` (adds the
     `<div id="edit" contenteditable="true">` region) — `dblclickWord`ing a word inside it never
     renders a card (`calls.count` stays `0`), proving the guard applies even with the feature on.

## 9. Testing performed (PR evidence — replaces screenshot/video capture)

Per this worktree's `CLAUDE.md` (owner ruling 2026-07-16): **no screenshots or video for this PR.**
The PR body's "Testing performed" section carries the evidence instead — suites run, test counts,
e2e scenarios exercised, and gates passed (lint, format check, typecheck, unit, e2e), matching
exactly what §8 enumerates. No `pr-assets/*` branch.

## 10. Risk / rollback

- **Risk: low.** The change is additive everywhere (new optional fields, one new guarded branch in
  an already-covered handler, one new settings-form section). The riskiest single line is the
  `detail === 2` check in `dom-selection-source.ts` — if a future browser ever changed multi-click
  semantics this would silently stop firing (fails toward "feature does nothing," not toward
  "feature fires unexpectedly"), which is the safe failure direction for an opt-in feature.
- **Known accepted edge case:** two very fast, separate drag-selects at the same screen position
  could in principle share a browser-assigned `detail === 2` (multi-click counting is
  temporal/spatial proximity based, not "was there a mousedown-move-mouseup drag involved"). Worst
  case this fires the double-click bypass for what was actually two rapid manual selections — still
  bounded (feature is opt-in, cooldown-gated, and the reader gets a normal lookup either way, just
  one gesture sooner than expected). Not treated as a defect worth extra guarding; noted here so a
  future report of "it auto-fired when I didn't double-click" has a documented, understood cause.
- **No data migration.** `PublicSettings`/`Settings`/`SettingsFormValue` are extended with an
  optional field only; every existing stored settings object remains valid as-is (reads as "off").
- **Rollback:** revert the single PR. Every touched file's non-A14 behavior is unchanged (verified
  by the untouched existing test assertions in §8's unit suites), so reverting drops exactly the
  double-click behavior and nothing else.

## 11. Files touched (summary)

| File                                                                  | Change                                                                                                    |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `packages/app/src/domain/types.ts`                                    | + `SelectionEvent.viaDoubleClick?`, + `PublicSettings.doubleClickLookup?`                                 |
| `packages/app/src/wire.ts`                                            | `PublicSettingsSchema` + `doubleClickLookup: z.boolean().optional()`                                      |
| `packages/app/src/app/dom-selection-source.ts`                        | + guard helper + `detail === 2` double-click detection on the `mouseup` handler                           |
| `packages/app/test/app/dom-selection-source.test.ts`                  | + tests (§8.1)                                                                                            |
| `packages/app/src/domain/workflow.ts`                                 | `onSelection` callback refactored: named `fire()` + double-click auto-fire branch                         |
| `packages/app/test/workflow.test.ts`                                  | `pub()`/`harness()` extended + new tests (§8.2)                                                           |
| `packages/app/src/ui/settings-form.ts`                                | + `SettingsFormValue.doubleClickLookup?`, + "Trigger" section/checkbox, `collect()`/`set value()` updated |
| `packages/app/test/ui/settings-form.test.ts`                          | 2 existing tests updated (section list, control list) + new test (§8.3)                                   |
| `packages/extension-chrome/src/adapters/chrome-storage-store.ts`      | `get()` + conditional `doubleClickLookup` spread                                                          |
| `packages/extension-chrome/src/adapters/chrome-storage-store.test.ts` | + test (§8.4)                                                                                             |
| `packages/extension-safari/src/adapters/safari-storage-store.ts`      | same one-line change, platform parity                                                                     |
| `packages/extension-safari/src/adapters/safari-storage-store.test.ts` | + test (§8.4)                                                                                             |
| `packages/extension-chrome/src/options.ts`                            | `toFormValue()` + `doubleClickLookup` passthrough                                                         |
| `packages/extension-chrome/e2e/helpers.ts`                            | `SettingsOverrides` + `doubleClickLookup?: boolean`; + `dblclickWord()` + `gotoEditableFixture()` (§6.13) |
| `packages/extension-chrome/e2e/a14-double-click-trigger.spec.ts`      | new — functional e2e (§8.5)                                                                               |

No change to `packages/app/src/app/router.ts`, `packages/extension-chrome/src/sw.ts`,
`packages/extension-safari/src/sw.ts`, `packages/extension-safari/src/options.ts`,
`packages/extension-safari/src/content.ts`, `packages/extension-chrome/src/content.ts`, or any
manifest file.

## 12. Concurrency

Files this card modifies that other unshipped cards in this batch also modify (CONTRACTS §5) —
the orchestrator should serialize:

- **`packages/app/src/app/dom-selection-source.ts`** — **A15** (trigger-latency-budget) is planned
  (spec+plan on disk) to add `SELECTION_FIRED_MARK` instrumentation to this exact file/method, but
  has **not** landed as of this review (2026-07-23, verified: no export, no branch). This card's
  Task 2 implements against the file as it stands today; see §6.3's concurrency note for the
  additive, non-conflicting composition if A15 lands first.
- **`packages/app/src/domain/workflow.ts`** — part of the broader content-script/trigger surface
  CONTRACTS §5 flags as shared across A5, A6, A13, A14, A15, B3, B4, even though this specific file
  isn't separately named.
- **`packages/app/src/ui/settings-form.ts`** — explicitly flagged hot file, shared with A5, A9,
  A13, B6, C9. This card's edit (one new section, additive) is intentionally scoped to avoid
  touching any existing control those cards might also be editing.
- **`packages/app/src/domain/types.ts` / `packages/app/src/wire.ts`** — implicit shared surface:
  most cards that add an optional settings/result field touch these two files together (the
  `AssertEqual` drift guard forces it). This card's edit is a single optional field on each,
  minimizing overlap risk.
- **`packages/extension-chrome/src/options.ts`** — not separately flagged in CONTRACTS §5, but
  touched by any card that adds a settings-form field with a Chrome-side default/hydration path.
