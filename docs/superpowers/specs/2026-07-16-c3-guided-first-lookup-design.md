# C3 — Guided first lookup

Roadmap card: `docs/ROADMAP.md` §4 C3 (Impact 5 · Effort M · Score 2.5). Depends on: C2 (verified
activation) — this card starts from C2's post-activation **success** state and treats every C2
decision as frozen (see `docs/superpowers/specs/2026-07-16-c2-verified-activation-design.md`):
persist-first key testing, persist-only-on-pass, the "Save anyway" escape hatch scoped strictly to
`NETWORK`-class failures, and **zero changes to `wire.ts`/`router.ts`**. This spec adds no wire
message and no router case either — the entire feature composes existing, already-exported pieces.

## 1. Problem (grounded in code)

Today, the moment a key is saved (activated), `mountOnboarding`'s `save` listener
(`packages/extension-chrome/src/options.ts:189-206`) persists it and swaps straight to the
settings screen with a single status sentence:

> "You're all set. Highlight any word while reading and choose Define to look it up."
> (`options.ts:201-203`)

That sentence is the _entire_ handoff — the reader is told what to do, then sent away to do it
alone, on some other page, at some later moment. Nothing on this screen lets them practice the
gesture or see a real result before they leave. The roadmap's **Missing** is precise: "Right after
verified activation, a 'Try it now' sentence appears on the same page; the user selects a word
there and runs a real lookup... seeing the real card render in place." C2 closes "did my key
work?"; C3 closes "do I know how to use this?" — the two remaining beats of the funnel audit.

## 2. The critical design question: how does the options page host a real lookup?

The card explicitly leaves this open: "options page sends `lookup.request` like the panel vs.
bundled demo page." Grounding both options in code:

### 2.1 Rejected: a bundled demo page

Content scripts are what normally drive the select→Define→lookup gesture
(`packages/extension-chrome/src/content.ts`), but they cannot run on the options page at all.
`manifest.json`'s `content_scripts` matches are `<all_urls>` (`manifest.json:30-42`) — that pattern
governs ordinary web pages; Chrome's extension model never injects content scripts into the
extension's own `chrome-extension://` pages, regardless of any match pattern (there is no
`chrome-extension://` entry in `content_scripts.matches` and none would help — this is a platform
invariant, not a config gap). So a "bundled demo page" would still need to run the full lookup
pipeline itself, in-page, exactly like option (a) below — it isn't a different mechanism, only a
worse home for the identical code (a second page to load, navigate to, and keep in sync with
settings state). Rejected: no benefit, real cost.

### 2.2 Pinned: the options page runs the real pipeline in-page (option a)

The options page is architecturally identical to the side panel: a same-world, trusted extension
page (`packages/extension-chrome/src/side-panel.ts`), not a cross-world content script. The side
panel already proves the pattern this card needs — it renders lookup results with the shared
`renderCardState` helper (`side-panel-view.ts:4,191`) and sends the same wire messages a content
script does, directly via `chrome.runtime.sendMessage` (e.g. `history.list`, `settings.get`,
`saved.save` — `side-panel.ts:134,222,190`). Nothing about "same-world extension page talking to
the router" is new; the options page just hasn't used it for lookups before.

The exact real pipeline already exists as one composable function, `runLookupWorkflow`
(`packages/app/src/domain/workflow.ts:37-148`), taking a `SelectionSource`, `TriggerUI`,
`ResultRenderer`, `LookupClient`, and `SettingsStore` (`ports.ts:12-69`) and driving:
select → show the Define bubble → click → `settings.get` → build a `LookupRequest` → send the
existing `{ type: 'lookup', req, requestId }` wire message (`wire.ts:96`) → render the reply. Every
one of those five collaborators already has a ready-made, exported implementation:

| Port              | Implementation                                              | Reused from                                                                   |
| ----------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `SelectionSource` | `DomSelectionSource(document, ...)`                         | `app/dom-selection-source.ts` (content.ts:74)                                 |
| `TriggerUI`       | `ChromeFloatingTrigger`                                     | `extension-chrome/src/adapters/chrome-floating-trigger.ts` (content.ts:14,22) |
| `ResultRenderer`  | `InlineBottomSheetRenderer(document.body)`                  | `app/inline-bottom-sheet-renderer.ts` (content.ts:20)                         |
| `LookupClient`    | `MessageRelayLookupClient(chrome.runtime)`                  | `app/message-relay-lookup-client.ts` (content.ts:114)                         |
| `SettingsStore`   | a 3-line adapter over options.ts's existing `send()` helper | new, composition-root-only                                                    |

**Pinned: option (a).** The try-it section on the settings screen composes these same five pieces
— the identical `lookup` wire message, the identical router path (`handleLookup`,
`router.ts:97-172`, including cache/history/nudge exactly as any real lookup gets), and the
identical `renderCardState`/`InlineBottomSheetRenderer` rendering (S4 sanitization included, via
`sanitizeMarkdown` at `inline-bottom-sheet-renderer.ts:11,28`). **Zero lines change in `wire.ts` or
`router.ts`.** "No separate demo renderer" is satisfied structurally, not by convention: there is
no second renderer to keep in sync.

### 2.3 A gap this reuse surfaces: `registerContentElements()` was never called on the options page

`InlineBottomSheetRenderer` and `ChromeFloatingTrigger` both call `document.createElement(...)` on
custom element tags (`'bottom-sheet'`/`'lookup-card'` at `inline-bottom-sheet-renderer.ts:49-50`;
`'lookup-trigger'` at `chrome-floating-trigger.ts:32`) — these only upgrade into real, styled
elements if `customElements.define` has run for them. `options.ts` today calls only
`registerSettingsForm()` and `registerOnboarding()` (`options.ts:15-16`); the trio
`lookup-trigger`/`lookup-card`/`bottom-sheet` is registered by `registerContentElements()`
(`register.ts:8-12`), which the options page has never called (it has never needed a lookup card
before). **The change adds this one missing registration call.** (By contrast, `side-panel.ts`
never hits this gap because `renderCardState` returns plain nodes it inlines into its own shadow
tree directly — `side-panel-view.ts:191` — rather than instantiating the `<lookup-card>` custom
element the floating renderer uses.)

### 2.4 Faithfulness of the gesture: scoped selection, not page-wide

`DomSelectionSource` listens for `mouseup`/`touchend` on the _whole_ `document`
(`dom-selection-source.ts:35-50`) — correct for a content script (the whole page is fair game) but
wrong verbatim for the options page, which also contains the entire settings form (labels, a
prompt-format textarea, etc.). Selecting any of that text must never pop the Define bubble.

The reader-side selection logic (`defaultReader`, `dom-selection-source.ts:15-31`) was private and
unscoped. **Pinned:** refactor it into an exported factory, `createDomReader(isInScope?: (node:
Node) => boolean)`, that gates on the selection `Range`'s `commonAncestorContainer` before doing
any other work; `DomSelectionSource`'s own constructor is unchanged (it already accepts an
injectable `read` function — `dom-selection-source.ts:37-39` — so this is purely additive). The
try-it section passes a predicate scoped to its own practice sentence
(`SettingsForm.containsTryIt`, §5.2) — **the practiced gesture IS the real gesture**: the same
`mouseup` listener, the same floating "Define" pill, the same click handler, just gated to one
sentence instead of one page.

### 2.5 A blocking gap this card must close: `configuredProviders` is never set on activation

`runLookupWorkflow` has its own client-side pre-flight guard: if
`settings.configuredProviders.length === 0` it renders the `NO_KEY` card and never calls the
lookup client at all (`workflow.ts:59-63`). Today's onboarding write —
`chrome.storage.local.set({ settings: { ...cur, apiKey, targetLang, hasKey: Boolean(apiKey) } })`
(`options.ts:192-195`) — **never sets `configuredProviders`.** It stays whatever `cur` already
held, which for a first-time install is `[]` (`DEFAULTS.configuredProviders`, `options.ts:35`).
C2's own rewritten activation path (spec §4.2) copies this exact object shape verbatim and doesn't
touch this field either — C2 never needed it, because `handleConnectionTest`
(`router.ts:195-211`) calls `deps.client.lookup(...)` directly, bypassing the client-side
`configuredProviders` gate entirely. **C3 is the first thing that ever reads this field right
after onboarding**, and without a fix, try-it would render the wrong story — a freshly, correctly
activated key would show the "Set up AI Dictionary" no-key card, not a real lookup.

This is not a change to any C2 decision (C2 never asserted anything about `configuredProviders`);
it is a small, additive, necessary fix in the same write C2 already touches. **Pinned:** the
onboarding activation write also sets `configuredProviders: apiKey ? ['gemini'] : []` — the same
single-provider computation `wireSettings`'s own `save` listener already does for the settings form
(`options.ts:116-119`), extended to the one write path that was missing it. Onboarding is
Gemini-only today (C4 generalizes this later); `['gemini']` is exactly right for this path.

## 3. Where try-it lives, and its persistence semantics

**Pinned:** a new section on the `settings-form` component itself (`packages/app/src/ui/
settings-form.ts`), inserted once, by the composition root, immediately after a **verified**
activation succeeds — never on any other path.

- **Not shown on "Save anyway."** C2's `NETWORK`-only escape hatch (C2 spec §3) explicitly means
  the key was _never verified_. Firing a real "Try it now" lookup immediately after telling the
  reader "couldn't verify — check later" risks an instant second failure and contradicts that
  message. Try-it is wired to exactly one call site: the success branch of the (C2-rewritten)
  `save` listener, never the `save-anyway` listener.
- **Shown exactly once per activation, with no new storage.** `mountSettings` gains an optional
  3rd argument, `{ showTryIt?: boolean }`; only the activation-success call site passes
  `showTryIt: true`. Every other call to `mountSettings` — the page's normal route-on-load
  (`options.ts:210-213`) or a later settings-form save (`wireSettings`'s `save` listener never
  remounts the form: `options.ts:114-134`) — passes nothing, so the section never reappears after
  a reload. No storage flag, no new keyspace: the "shows once, right after activation" requirement
  falls out of _which call site_ passes the flag, not out of persisted state.
- **Stays visible until dismissed or superseded by success — not both required.** Once shown, the
  section stays up so the reader can select the practice word more than once if they want, until
  **either** (a) they click the small "Hide" control, which tears down the section's own selection
  listener and closes any open card, **or** (b) a lookup succeeds at least once, at which point a
  quiet confirmation line appears under the sentence (`markTryItSucceeded`, §5.2) — the section
  itself stays (so a curious reader can try a second time), it just stops _asking_.

## 4. Failure handling and two intentionally inert affordances

**Reuses existing card error rendering, verbatim — no new copy.** A failed try-it lookup renders
through the identical `renderCardState` error branch every other surface uses
(`lookup-card.ts:263-274`): `INVALID_KEY` gets the message + an "Open Settings" CTA, everything
else gets the message alone. `NO_KEY` cannot occur in the normal path (§2.5 closes it), but if it
somehow did (a race with a concurrent key clear from another tab), the shared setup-invite card
would render exactly as it does everywhere else — not a special case to build, just a fact this
design doesn't fight.

Two of the shared card's affordances are **deliberately left inert** (dispatched, un-listened-to —
not broken, not silently modified) when the card renders inside the try-it section:

1. **The card's Settings gear** (`open-settings`, `lookup-card.ts:575-579`) — there is nowhere
   further to go; the reader is already on Settings. No listener is added; the click is a no-op.
   Building a smarter destination (e.g. focusing the key field) is exactly the "fix-key mode"
   `docs/ROADMAP.md`'s C6 card owns ("deep-links to the options page in a fix-key mode (key row
   focused...)") — out of scope here, and not needed for try-it's own success case.
2. **The card's Save star** (`toggle-save`, `lookup-card.ts:343-351`) — deliberately **not** wired.
   `InlineBottomSheetRenderer`'s reuse is otherwise byte-for-byte identical to content.ts's, but
   content.ts additionally listens for `toggle-save`/`toggle-status` and persists them
   (`content.ts:150-185`). Wiring the identical listeners here would let a curious tap on the
   practice word's star silently write "serendipity" — sourced from a canned onboarding sentence,
   not something the reader was actually reading — into their permanent saved-word list
   (`saved:*` keyspace, B1/B2). That is real user data pollution from a demo action, and nothing in
   the roadmap card asks for it. The star renders (faithful to the real card) but does nothing if
   tapped — the same inert-but-present pattern as the Settings gear above.

**Accepted, honest side effect: try-it writes real cache/history.** Because this reuses the actual
`lookup` wire message end-to-end, `handleLookup` (`router.ts:97-172`) caches the result and appends
a real history entry exactly as it would for any page lookup — this is the necessary consequence
of "no separate demo renderer," not an oversight. The entry's `url`/`title` come from
`location.href`/`document.title` at try-it time (`dom-selection-source.ts:28-29`) — i.e. the
options page itself — which is simply true, not sensitive, and visible only in the reader's own
Recent list.

## 5. The change

### 5.1 `packages/app/src/app/dom-selection-source.ts`

Extract the existing private `defaultReader` (`dom-selection-source.ts:15-31`) into an exported
factory that optionally gates on scope:

```ts
export function createDomReader(isInScope?: (node: Node) => boolean): () => SelectionEvent | null {
  return () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
    const text = sel.toString().trim();
    if (!text) return null;
    const range = sel.getRangeAt(0);
    if (isInScope && !isInScope(range.commonAncestorContainer)) return null;
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
  };
}

const defaultReader = createDomReader();
```

`DomSelectionSource`'s own class body (`dom-selection-source.ts:35-51`) is untouched — its
constructor already defaults `read` to `defaultReader`, which now simply comes from the factory
instead of being its own top-level function. No caller anywhere (content.ts, existing tests) sees a
behavior change: `createDomReader()` with no argument is byte-identical to the old `defaultReader`.

### 5.2 `packages/app/src/ui/settings-form.ts`

New markup, inserted in `MARKUP` right after `<h1 class="title">Settings</h1>`
(`settings-form.ts:143`) and before the Connection section (`settings-form.ts:144`):

```html
<section class="tryit" id="tryit" hidden aria-labelledby="tryit-h">
  <h2 class="tryit-h" id="tryit-h">Try it now</h2>
  <p class="tryit-lead">See it in action — select the highlighted word below and choose Define.</p>
  <p class="tryit-sentence" id="tryit-sentence">
    Finding that café was pure <mark class="tryit-word">serendipity</mark>.
  </p>
  <p class="tryit-caption">This sends one real lookup using your own key.</p>
  <p class="tryit-done" id="tryit-done" hidden>
    ✓ Nice — that's your key at work. Look up any word this way while you read.
  </p>
  <button type="button" class="link" id="tryit-hide">Hide</button>
</section>
```

New CSS rules (token-only, mirroring the existing `.env-notice` info-panel treatment at
`settings-form.ts:102` for the section background, and reusing the already-defined `button.link`
style at `settings-form.ts:113-114` for Hide — no new button CSS needed):

```css
.tryit {
  margin: 0 0 16px;
  border: 1px solid var(--ad-accent);
  border-radius: 12px;
  padding: 16px 20px;
  background: var(--ad-accent-soft);
}
.tryit-h {
  margin: 0 0 6px;
  font-size: var(--adp-text-body);
  font-weight: var(--adp-weight-bold);
  color: var(--ad-ink);
}
.tryit-lead {
  margin: 0 0 10px;
  font-size: var(--adp-text-sm);
  line-height: 1.5;
  color: var(--ad-ink-soft);
}
.tryit-sentence {
  margin: 0 0 6px;
  font-size: 15px;
  line-height: 1.6;
  color: var(--ad-ink);
}
.tryit-word {
  background: var(--ad-accent);
  color: var(--ad-on-accent);
  padding: 1px 5px;
  border-radius: 5px;
}
.tryit-caption {
  margin: 0 0 12px;
  font-size: var(--adp-text-xs);
  color: var(--ad-ink-faint);
}
.tryit-done {
  margin: 10px 0 0;
  font-size: var(--adp-text-sm);
  font-weight: var(--adp-weight-semi);
  color: var(--ad-accent-ink);
}
```

New public API on the `SettingsForm` class (`settings-form.ts:223` onward), mirroring the existing
`keyFromEnv`/`errorReporting` settable-property style (`settings-form.ts:409-428`):

```ts
/** C3: show/hide the post-activation "Try it now" practice section. Set true exactly once, by
 * the composition root, right after a verified activation succeeds (see options.ts). */
set tryIt(show: boolean) {
  if (!this.shadowRoot) return;
  this.q<HTMLElement>('#tryit').hidden = !show;
  if (!show) this.q<HTMLElement>('#tryit-done').hidden = true; // reset for the rare re-show
}

/** C3: whether `node` lies inside the try-it practice sentence — lets the composition root scope
 * a document-wide selection listener to just this sentence without reaching into the shadow DOM
 * itself (keeps the shadow boundary intact; mirrors `value`/`setStatus` as the component's only
 * other cross-boundary contact points). */
containsTryIt(node: Node): boolean {
  return this.shadowRoot?.getElementById('tryit-sentence')?.contains(node) ?? false;
}

/** C3: mark the practice lookup as completed at least once — reveals a quiet confirmation line.
 * Idempotent; a second successful lookup doesn't need a second confirmation. */
markTryItSucceeded(): void {
  if (this.shadowRoot) this.q<HTMLElement>('#tryit-done').hidden = false;
}
```

Wire the Hide button in `connectedCallback` (alongside the existing `relay(...)` calls at
`settings-form.ts:309-312`):

```ts
this.relay('#tryit-hide', 'tryit-dismiss');
```

`SettingsFormValue`/`collect()` (`settings-form.ts:29-45`) are untouched — try-it state is
ephemeral UI, never persisted, never part of the settings save contract.

### 5.3 `packages/extension-chrome/src/options.ts`

1. Register the missing custom elements (§2.3), alongside the existing calls at `options.ts:15-16`:

```ts
registerSettingsForm();
registerOnboarding();
registerContentElements();
```

2. Import the reused pipeline pieces:

```ts
import {
  // ...existing imports...
  registerContentElements,
  runLookupWorkflow,
  DomSelectionSource,
  createDomReader,
  InlineBottomSheetRenderer,
  MessageRelayLookupClient,
} from '@ai-dict/app';
import { ChromeFloatingTrigger } from './adapters/chrome-floating-trigger';
```

3. `mountSettings` gains a 3rd optional argument (`options.ts:84-111`):

```ts
function mountSettings(initial: Settings, status?: string, opts?: { showTryIt?: boolean }): void {
  // ...existing body, unchanged...
  if (status) form.setStatus(status);
  if (opts?.showTryIt) mountTryIt(form);
}
```

4. New composition function, mirroring content.ts's own top-level wiring style:

```ts
function mountTryIt(form: SettingsForm): void {
  form.tryIt = true;
  const baseRenderer = new InlineBottomSheetRenderer(document.body);
  let succeeded = false;
  const teardown = runLookupWorkflow({
    selection: new DomSelectionSource(
      document,
      createDomReader((n) => form.containsTryIt(n)),
    ),
    trigger: new ChromeFloatingTrigger(),
    renderer: {
      renderLoading: (w) => baseRenderer.renderLoading(w),
      renderResult: (r, ctx) => {
        baseRenderer.renderResult(r, ctx);
        if (!succeeded) {
          succeeded = true;
          form.markTryItSucceeded();
        }
      },
      renderError: (e) => baseRenderer.renderError(e),
      close: () => baseRenderer.close(),
    },
    client: new MessageRelayLookupClient(chrome.runtime),
    settings: {
      get: () =>
        send({ type: 'settings.get' }).then((r) => {
          if (r.ok && r.type === 'settings') return r.settings;
          throw new Error('try-it: settings.get failed');
        }),
      set: () => Promise.resolve(), // try-it never writes settings
    },
  });
  form.addEventListener('tryit-dismiss', () => {
    teardown();
    form.tryIt = false;
  });
}
```

5. The (C2-rewritten) activation success branch passes the flag and gets the `configuredProviders`
   fix (§2.5) in the same edit — both land inside the persist step C2's own spec already rewrites
   (C2 spec §4.2):

```ts
return chrome.storage.local.set({
  settings: {
    ...cur,
    apiKey,
    targetLang,
    hasKey: Boolean(apiKey),
    configuredProviders: apiKey ? ['gemini'] : [],
  },
});
// ...
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

## 6. Scope fence (from the card, held exactly)

- **User-triggered only** — no lookup fires without an explicit select-then-click, identical to
  every other surface (`runLookupWorkflow`'s own gesture-driven design, §2.2).
- **Visible "uses your key" microcopy** — the `.tryit-caption` line (§5.2), always present
  alongside the practice sentence, before any click.
- **Reuses the real lookup pipeline and card rendering, including S4** — §2.2/§2.4; no new
  renderer, no new sanitization path.
- **Skipped silently if the page can't host it** — trivially satisfied: try-it only ever mounts on
  the options page, a controlled, always-DOM-capable extension page (unlike an arbitrary reading
  page), and the existing `defaultReader`/`createDomReader` guard (`!sel`) already no-ops when
  selection APIs are unavailable.
- **Zero `wire.ts`/`router.ts` changes** — §2.2.
- **No new manifest permission** — nothing here touches `manifest.json`.
- **Tokens law** — every new rule in §5.2 reads `--ad-*`/`--adp-*` only.

## 7. Testing strategy

1. **Unit — `packages/app/test/app/dom-selection-source.test.ts`**: `createDomReader()` with no
   predicate behaves exactly like the old `defaultReader` (existing tests, unchanged, must stay
   green); a new test asserts a selection whose range is outside a given `isInScope` predicate
   yields `null` (no `SelectionEvent`), and one inside it still returns the event.
2. **Unit — `packages/app/test/ui/settings-form.test.ts`**: `#tryit` starts `hidden`;
   `form.tryIt = true` reveals it and `form.tryIt = false` hides it again (and re-hides
   `#tryit-done`); `containsTryIt` returns `true` for a node inside `#tryit-sentence` and `false`
   for a node elsewhere in the form (e.g. the `#tpl` textarea); `markTryItSucceeded()` reveals
   `#tryit-done`; clicking `#tryit-hide` dispatches a composed `tryit-dismiss` event.
3. **e2e — new `packages/extension-chrome/e2e/c3-guided-first-lookup.spec.ts`**, following the
   `onboarding.spec.ts`/`saved-word.spec.ts` pattern (`mockGemini`, `selectWord`, `openTrigger`):
   - Happy path: activate with a mocked 200 Gemini response → the settings screen shows "Try it
     now" → `selectWord(page, 'tryit-sentence', 'serendipity')` → `openTrigger` → the real card
     renders `financial institution`-style sanitized content (reusing the default `GEMINI_OK_BODY`
     fixture) → the confirmation line appears → `chrome.storage.local`'s history gains one entry.
     Note for the implementer: activation's own `connection.test` (C2) already fires one real
     lookup call, so the Gemini mock's `.count` will be 2 after this flow (one from `connection.
test`, one from try-it) — assert the increment, not an absolute count of 1.
   - Selecting text OUTSIDE `#tryit-sentence` (e.g. inside the Connection section's label text)
     never shows `lookup-trigger` — proves the scoped reader, not just that _a_ reader exists.
   - Failure path: mock a 400 `INVALID_ARGUMENT` body → the try-it card shows "Google rejected the
     API key." with an inert "Open Settings" button (present, click does not navigate or error).
   - Dismiss: clicking `#tryit-hide` removes `#tryit`, and a subsequent selection over
     "serendipity" no longer shows `lookup-trigger` (the workflow's teardown actually ran, not just
     a CSS hide).
   - The "Save anyway" (`NETWORK`) path never shows `#tryit` at all — asserts §3's pinned
     exclusion.
4. **Global constraint reminder (this repo, not new to this card):** build the e2e bundle with
   `GEMINI_API_KEY` cleared, e.g. `GEMINI_API_KEY= bun run build:chrome` (C10's documented flake) —
   a baked-in env key skips onboarding entirely and silently disables every onboarding-path e2e,
   including all of the above.

## 8. Testing performed (PR evidence — replaces screenshot/video capture)

Per this worktree's `CLAUDE.md` (owner ruling 2026-07-16): **no screenshots or video for this PR.**
The PR body's "Testing performed" section carries the evidence instead — the suites run, test
counts, e2e scenarios exercised, and gates passed (lint, format check, typecheck, unit, e2e),
matching exactly what §7 above enumerates. No `pr-assets/*` branch is created for this card.

## 9. Risk / rollback

- **Risk: low-moderate.** The riskiest correctness surface is the scoped selection predicate
  (§2.4/§5.1) — a bug there could either leak the Define bubble onto unrelated settings text or
  fail to trigger on the practice sentence at all; both are directly asserted by the e2e "selecting
  outside the sentence" and "happy path" scenarios (§7.3). Everything else is additive: one new
  exported factory function (old behavior preserved via a zero-arg call), one new hidden-by-default
  UI section gated behind an explicit property, and one new composition function that only ever
  runs from one call site.
- **No data-shape risk.** No wire, router, or persisted-schema change; `configuredProviders` (§2.5)
  gains a value on a field that already exists and was simply never populated on this one path.
- **Rollback:** revert the single PR. Onboarding's post-activation behavior returns to exactly
  today's single status sentence; no stored data becomes invalid (the `configuredProviders` fix is
  strictly additive-correct, not a shape change, so leaving it in even after a partial revert is
  harmless).

## 10. Files touched (summary)

| File                                                           | Change                                                                                                                            |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `packages/app/src/app/dom-selection-source.ts`                 | + exported `createDomReader(isInScope?)`, `defaultReader` now built from it (behavior-preserving)                                 |
| `packages/app/src/ui/settings-form.ts`                         | + `.tryit` section markup/CSS, `tryIt`/`containsTryIt`/`markTryItSucceeded`, `tryit-dismiss` event                                |
| `packages/extension-chrome/src/options.ts`                     | + `registerContentElements()`, `mountTryIt`, `mountSettings`'s `showTryIt` opt, `configuredProviders` fix on the onboarding write |
| `packages/app/test/app/dom-selection-source.test.ts`           | + tests for scoped reading                                                                                                        |
| `packages/app/test/ui/settings-form.test.ts`                   | + tests for the try-it section                                                                                                    |
| `packages/extension-chrome/e2e/c3-guided-first-lookup.spec.ts` | new — functional e2e (§7.3)                                                                                                       |

No change to `packages/app/src/wire.ts`, `packages/app/src/app/router.ts`,
`packages/app/src/ports.ts`, or any manifest file.
