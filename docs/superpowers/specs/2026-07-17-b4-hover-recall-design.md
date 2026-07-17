# B4 — Hover-recall (design)

Roadmap card: `docs/ROADMAP.md` §4 B4 (Impact 4 · Effort S · Score 4.0 · _needs B3_). Depends on:
B3 (re-encounter highlighting, spec/plan authored 2026-07-16, **unshipped** — its design is frozen
and this card consumes its exported names verbatim, per this batch's CONTRACTS §4) → B1 (save,
shipped) → B5 (status lifecycle, shipped). Feeds: nothing yet (leaf card in the current batch).

Authored by the Shaman (campaign protocol 2026-07-17: the Shaman answers How; the Warchief
executes). Because B3 is unshipped, none of the files it introduces
(`domain/highlight-policy.ts`, `app/page-highlighter.ts`, the `saved.learningWords` wire arm, the
`highlightSavedWords` setting) exist in this worktree yet — every citation below to those exports
is to **B3's spec/plan documents**, not to code on disk. B4's own plan tasks assume B3 has shipped
by the time a Hunter executes them (the roadmap's own dependency ordering — §4 B4's `needs B3`
tag, `docs/ROADMAP.md:854` `B3 --> B4`) and cite B3's frozen signatures as the contract to build
against.

## 1. Problem (grounded in code)

Today, re-meeting a saved word costs a full round trip even though the answer is already sitting
in local storage:

- B3 (once shipped) paints a dotted underline under every on-page occurrence of a
  learning-status saved word via the CSS Custom Highlight API — `CSS.highlights.set('ad-saved-word',
new Highlight(...ranges))` (B3 spec §D1,
  `docs/superpowers/specs/2026-07-16-b3-re-encounter-highlighting-design.md:28`). Crucially, the
  Custom Highlight API paints **without creating any DOM element** — there is no `<mark>`, no
  wrapper, nothing `document.elementFromPoint()` can ever resolve to "the highlighted span." B3's
  `PageHighlighter` (`app/page-highlighter.ts`, B3 plan Task 4,
  `docs/superpowers/plans/2026-07-16-b3-re-encounter-highlighting.md:139-153`) exposes exactly
  three imperative methods (`apply`/`refresh`/`clear`) plus one readonly test seam —
  `readonly ranges: ReadonlyArray<Range>` (B3 plan:151) — and nothing else. There is no hover, no
  click handler, no hit-testing of any kind on the painted spans.
- Seeing the underline today (once B3 ships) tells the reader "you've saved this" but not **what**
  they saved — the only way to see their own saved meaning is to select the word again and press
  Define, which re-runs `runLookupWorkflow` (`packages/app/src/domain/workflow.ts:37`) — a full
  `LookupClient.lookup()` round trip through `MessageRelayLookupClient` →
  `chrome.runtime.sendMessage({type:'lookup', ...})` → the router's `handleLookup`
  (`packages/app/src/app/router.ts:97-172`) → (cache miss, since a saved word's cache key may have
  since been evicted or never matched a re-selection's exact context string) → a real
  `LookupClient.lookup()` HTTP call, i.e. real tokens and real latency for information the
  extension already has verbatim in `saved:<word>`'s `senses[0].definition`
  (`packages/app/src/domain/types.ts:231-237`).
- There is today no wire message that returns a **single full** saved entry to a content script.
  `packages/app/src/wire.ts:95-141` (current, pre-B3) has `saved.save` (write, replies with the
  full entry it just wrote — `wire.ts:175`), `saved.delete`, and `saved.setStatus` (write, replies
  with the full entry only as a side effect of the status flip — `router.ts:261-266`). B3 adds one
  more, `saved.learningWords`, but it deliberately replies with **headwords only** ("B3 sends only
  what painting needs" — B3 spec §D3,
  `docs/superpowers/specs/2026-07-16-b3-re-encounter-highlighting-design.md:60-62`, which itself
  names B4 as the future consumer that will need more: "B4 (hover-recall) will fetch the full
  entry on demand later"). Content scripts never read `chrome.storage` directly (S1's isolation
  boundary applies to more than just the API key — `ref-kv-storage-prefixes` keeps ALL storage
  access behind the router/`Storage` port), so there is no way, today, for `content.ts` to obtain
  `senses[0].translation`/`.definition` for a specific hovered word.
- The side panel already has a fully general mechanism for showing a **stored** (non-live)
  `LookupResult` as its main "focus" region — clicking a "Recent" row calls
  `resultToFocus(entry.result)` (`packages/extension-chrome/src/side-panel.ts:114-128`,
  `:147-154`), which needs only `{markdown, word, target, provider?, fallbackFrom?, nudge?}` to
  render (`resultToFocus` never touches `model`/`fromCache`/`fetchedAt` — see §2.5). And
  `content.ts` already has a full "open this in the side panel" pipeline — the card's
  `open-side-panel` composed event carries `lastFocus` (a module-scoped `let`,
  `packages/extension-chrome/src/content.ts:40`) to the service worker, which caches it for the
  panel's boot-time recovery (`side-panel.ts:277-307`; proven end-to-end by
  `packages/extension-chrome/e2e/side-panel-open.spec.ts:4-36`, "A freshly-opened panel recovers
  the lookup via the SW get-focus cache"). Nothing today feeds a **saved-word-sourced** focus into
  that pipeline — it only ever carries a real (possibly cached) `LookupResult` from a live lookup.

**Goal (card's payoff, `docs/ROADMAP.md:403`):** "Hover → your meaning in ~0 ms, 0 tokens, 0
network." Hovering a B3-highlighted word shows a small local popup with the reader's own saved
meaning, sourced entirely from `chrome.storage.local` — zero `LookupClient.lookup()` calls, zero
provider HTTP traffic — with a link to see the full saved entry in the side panel.

## 2. Design decisions (all made; executor does not re-open)

### 2.1 — Hover detection over the Custom Highlight API (the hard question)

Because Custom Highlight API ranges are DOM-invisible, `elementFromPoint` can never directly
answer "is the cursor over a highlight." Three candidate mechanisms:

**(a) Caret hit-testing.** On a (throttled) `mousemove`, ask the browser "what text position is
under the cursor" via `document.caretPositionFromPoint(x, y)` (returns `{offsetNode, offset}`) or
its older sibling `document.caretRangeFromPoint(x, y)` (returns a collapsed `Range`; extract
`startContainer`/`startOffset`). Then linearly scan B3's `PageHighlighter.ranges` for one whose
`startContainer === offsetNode && offset` falls within `[startOffset, endOffset]` — exact, because
B3's ranges are each built with a single `range.setStart/setEnd` call on ONE text node (B3 spec
§D4: "per-match `Range` via `range.setStart/setEnd` on the text node using `findWordMatches`
offsets", `docs/superpowers/specs/2026-07-16-b3-re-encounter-highlighting-design.md:70-73`) — no
cross-node ranges exist to complicate the comparison.

**(b) `document.elementFromPoint` + a synthetic re-scan.** Re-run `findWordMatches` against
whatever element `elementFromPoint` returns, ignoring B3's actual highlight state. Rejected: this
duplicates B3's matching pass on every hover tick, can drift from what's actually painted (e.g. a
word inside B3's `maxTextNodes` cap that never got scanned would still "match" here, showing a
hover popup for a headword that has no visible underline — confusing), and still doesn't tell you
_which_ text node/offset range the cursor is over without essentially re-deriving (a).

**(c) Wrap every highlight in a light element after all** (abandon zero-DOM-mutation). Rejected
outright — B3's entire design rationale for the Custom Highlight API over a `<mark>`-wrapping
approach was "no host-page DOM mutation... no layout impact... trivially removable" (B3 spec §D1).
Reversing that for B4 would silently break B3's own scope fence retroactively and reintroduce the
React/Vue-reconciliation risk B3 explicitly avoided.

**Pinned: (a), caret hit-testing against `PageHighlighter.ranges`.** It reuses B3's own live
painted state (never drifts from what's visibly underlined), needs no new scanning pass, and
degrades identically to B3's own `CSS.highlights`-undefined precedent when the platform API is
missing (§2.6).

**Why the fallback path is load-bearing, not just polish:** `packages/extension-chrome/src/manifest.json:5`
pins `"minimum_chrome_version": "116"`. `document.caretPositionFromPoint` did not ship until Chrome
125 (April 2024); `document.caretRangeFromPoint` (the WebKit/Blink legacy form) has existed since
Chrome ~4. Every Chrome build between 116 and 124 that this manifest claims to support has
`caretRangeFromPoint` but not `caretPositionFromPoint` — so the "fallback" is the only path that
makes the manifest's own floor version actually work; it is not a defensive nicety. Playwright
`^1.48.0` (`packages/extension-chrome/package.json:18`) bundles a Chromium build well past 125, so
this repo's e2e suite exercises the modern `caretPositionFromPoint` path only; the legacy
`caretRangeFromPoint` fallback is exercised by a unit test with a stubbed `caretAt` (§4 Testing
strategy) — a documented, deliberate gap (real headless Chromium always takes the modern branch).

### 2.2 — Resolving a hovered `Range` to its saved headword: reuse, don't extend `PageHighlighter`

Once §2.1 finds which `Range` the cursor is over, B4 needs the **headword** that range represents
(`findWordMatches` computed it once, during B3's scan, but `PageHighlighter.ranges`'s frozen type
is `ReadonlyArray<Range>` — bare ranges, no headword attached; B3 plan Task 4:151 calls it a "test
seam," not a general-purpose lookup index).

Two ways to get the headword without widening B3's frozen surface:

**(a) Extend `PageHighlighter` with a new `matches: ReadonlyArray<{range, headword}>` property.**
Rejected for this card: CONTRACTS §4 pins "B4 consumes B3's already-authored interfaces... do not
re-design highlighting" — and while an additive property is low-risk, it is still a change to a
file this card has no task touching (B4's plan never modifies `page-highlighter.ts`), and it is
unnecessary once (b) is available.

**(b) Re-derive the headword locally from the SAME pure functions B3 already exports.** The
matched `Range`'s own text — `range.toString()` (e.g. `"Banks"`) — is exactly the substring
`findWordMatches` tokenized and matched in the first place. `content.ts` already knows the full
list of currently-highlighted learning headwords (it just fetched them to call
`highlighter.refresh(words)` — B3 plan Task 5,
`docs/superpowers/plans/2026-07-16-b3-re-encounter-highlighting.md:181-201`). Building
`buildHighlightMatcher(words)` (B3's own exported pure function, `domain/highlight-policy.ts`) from
that SAME array, then calling `findWordMatches(range.toString(), matcher)[0]?.headword`, resolves
the exact headword using B3's own tokenization/normalization rules (lowercasing, trailing
`'s`/`'` stripping) with **zero duplicated matching logic** and **zero changes to `PageHighlighter`
or `domain/highlight-policy.ts`**.

**Pinned: (b).** `packages/extension-chrome/src/content.ts` gains one extra line inside its
existing (B3-authored) `refreshHighlights()` helper: build and cache
`hoverMatcher = buildHighlightMatcher(words)` alongside the existing `highlighter.refresh(words)`
call, using the identical `words` array — no second wire round trip, no new fetch.

### 2.3 — Fetching the full saved entry: a new `saved.get` wire message

`buildHighlightMatcher`/`findWordMatches` only recover the **headword** — B4 still needs
`senses[0].definition`/`.translation` to render the popup, and the S1-adjacent "content scripts
never read storage" precedent (B3 spec §D3) means this has to come over the wire. No existing
message returns one entry by word on demand (§1). Reusing `saved.save`'s reply shape is not an
option (`saved.save` WRITES; there is no read-only counterpart), so per CONTRACTS §2 ("if the card
adds a wire message: `wire.ts` arm + `router.ts` case = ONE task"), this card adds exactly one:

```
saved.get { word: string } → { ok: true, type: 'savedEntry', entry: SavedWordEntry | null }
```

**Why a new reply arm (`savedEntry`) instead of reusing the existing `saved` arm** (`wire.ts:175`,
`{ok:true, type:'saved', entry: SavedWordEntrySchema}`, non-nullable `entry`): the existing `saved`
reply is a WRITE acknowledgment — every caller of `saved.save`/`saved.setStatus` already assumes a
non-null `entry` (see `content.ts:165-167`, `side-panel.ts:194-196`, both narrow on
`reply.type === 'saved'` and read `reply.entry.status` unconditionally). Overloading that same
reply shape with `entry: SavedWordEntrySchema.nullable()` would force every existing call site to
add a null-check it doesn't need, purely to serve a brand-new READ path — a wider blast radius for
no benefit. A separate, dedicated `savedEntry` reply (nullable by construction, since the word
might have been unsaved in the moment between B3 painting the highlight and the reader hovering
it — a real, if narrow, race) keeps every existing arm's contract untouched. This mirrors B3's own
precedent of adding a fresh `savedWords` reply arm rather than overloading `saved` (B3 spec §D3).

**Router case** (reuses the existing, untouched `savedWordGet` domain function,
`packages/app/src/domain/saved-words-policy.ts:100-106` — already exported, already
case-insensitive via `normalizeWordKey`, already returns `null` for an unknown word):

```ts
case 'saved.get': {
  const entry = await savedWordGet({ storage: deps.kv }, msg.word);
  return { ok: true, type: 'savedEntry', entry };
}
```

Read-only — no `deps.queue.run` needed, mirroring how `saved.learningWords` (B3) and
`history.list` skip the write queue.

### 2.4 — Popup layout (the card's own "Lead decides" item)

Pinned, deliberately minimal (Effort S):

- A new Paperlight shadow-DOM custom element, `<hover-recall-popup>` (`packages/app/src/ui/
hover-recall-popup.ts`), registered through the SAME function that already registers every other
  in-page, `content.ts`-owned element: `registerContentElements()`
  (`packages/app/src/ui/register.ts:8-12`) gains one more `customElements.define`. It is
  MAIN-world-registered by `content-elements.ts` exactly like `lookup-trigger`/`lookup-card`/
  `bottom-sheet` already are (`packages/extension-chrome/src/content-elements.ts`) — no new
  registration entry point.
- Content: the headword (bold), a one-line **plain-text** preview (`senses[0].translation` if
  non-empty, else `senses[0].definition` truncated to 140 chars with a trailing `…`), and a
  "View full entry" button. Deliberately **plain text only (`textContent`, never `innerHTML`)** —
  this sidesteps S4/`sanitizeMarkdown` entirely inside the new component (fewer places doing HTML
  injection = smaller review surface for a brand-new surface). The FULL, sanitized markdown
  rendering happens only at the existing, already-S4-compliant side-panel step (§2.5) when the
  reader clicks through.
- Positioning: `position:fixed`, anchored below the hovered range's `getBoundingClientRect()`
  converted to `AnchorRect` — the exact `{x: r.x, y: r.y, w: r.width, h: r.height}` shape
  `dom-selection-source.ts:27-28` already uses for the SAME kind of Range→viewport-rect
  conversion — flipped above the word when it would overflow the viewport bottom, and clamped
  horizontally so it never overflows the right edge. (A6's future placement heuristic is a
  separate, unshipped card; this is a minimal, self-contained clamp, not a dependency on A6.)
- Styling: `BASE_VARS`/`THEME_CSS` from `packages/app/src/ui/styles/tokens.ts` — no hard-coded
  colors, matching every other Paperlight surface.

### 2.5 — "View full entry" opens the side panel: reuse `lastFocus` + the existing `open-side-panel` event, verbatim

`content.ts`'s `open-side-panel` document listener (`content.ts:199-206`) already does everything
needed — it reads the module-scoped `lastFocus` variable and relays `{type:'open-side-panel',
focus: lastFocus}` to the service worker, which caches it for the panel's boot-time recovery. That
listener's code is untouched by this card. B4 only needs to make `lastFocus` describe the saved
entry before dispatching the SAME event:

```ts
lastFocus = {
  state: 'result',
  payload: {
    markdown: primary.definition,
    word: entry.word,
    target: '', // see rationale below — unused by rendering
    model: 'saved',
    fromCache: true,
    fetchedAt: entry.savedAt,
    ...(primary.translation ? { translation: primary.translation } : {}),
  },
  sentence: primary.sentence,
  url: primary.url,
  title: primary.title,
};
document.dispatchEvent(new CustomEvent('open-side-panel', { bubbles: true, composed: true }));
```

(`primary = entry.senses[0]`.)

**Why `target: ''` is safe:** `LookupResult.target` is a required `string` on the wire schema
(`wire.ts:44`) and on `SidePanelFocus`'s validation gate, `isLookupResult()`
(`side-panel.ts:102-110`, checks `markdown`/`word`/`target` are strings — any string passes). But
`target` is **never read by rendering**: `resultToFocus` (`side-panel.ts:114-128`) copies
`r.target` straight through into the `CardState` `'result'` variant's `target` field
(`lookup-card.ts:36`), and `renderCardState` (`lookup-card.ts:240-288`) never once reads
`state.target` — the target-language translation the reader sees is baked into the model's
markdown output itself (the prompt's `{output_format}` slot, per `prompt-template.ts`), not
rendered from this field. `SavedWordEntry` does not retain which target language a sense was
originally translated for (only the sense's already-computed `translation` string, which flows
through separately), so there is nothing honest to put there; `''` is explicit and harmless.

**Why `model: 'saved'` / `fromCache: true` / `fetchedAt: entry.savedAt` are safe:** none of these
three fields are read by `resultToFocus` or `renderCardState` either — `resultToFocus` only reads
`markdown`, `word`, `target`, `provider`, `fallbackFrom`, `nudge` (`side-panel.ts:117-127`). They
exist purely to satisfy `LookupResult`'s required shape; `model: 'saved'` is a harmless,
self-documenting marker (distinguishes a recalled entry from a live fetch, for any future
diagnostic use) and `fromCache: true`/`fetchedAt: entry.savedAt` are semantically accurate — this
data really did come from local storage, timestamped at save time.

**S4 held:** `primary.definition` is raw markdown (exactly like `HistoryEntry.result.markdown` and
every `SavedWordSense.definition` today — B1 never sanitizes before storing, only at render time).
It reaches the side panel exactly like any other `LookupResult.markdown` and is sanitized at the
SAME existing call site, `resultToFocus`'s `sanitizeMarkdown(r.markdown)` (`side-panel.ts:119`) —
zero new sanitize call sites, zero risk of an unsanitized path.

**No wire/router change for the side-panel hop itself** — `open-side-panel`,
`side-panel.get-focus`, and their reply/cache plumbing (`sw.ts`, `side-panel-messages.ts`,
`side-panel.ts`) are entirely unmodified by this card; only the NEW `saved.get` message (§2.3) is
added, for fetching the entry in the first place.

### 2.6 — No new setting: hover-recall inherits B3's `highlightSavedWords` off-switch for free

The card's scope fence does not mention a setting, and none is needed: `HoverRecallController`'s
entire match surface is `PageHighlighter.ranges` (§2.1). When `highlightSavedWords` is off, B3's
`content.ts` wiring never calls `highlighter.apply/refresh` (B3 spec §D7: "`apply(words)` when
`settings.highlightSavedWords !== false`"), so `ranges` stays permanently empty and hover-recall
structurally never matches anything — no separate gate to add, test, or keep in sync.

### 2.7 — Dismiss semantics (pinned exactly)

- **Show delay `HOVER_DELAY_MS = 200`**: the candidate `Range` must be the SAME range for 200ms
  of continuous hover before the popup appears — a standard hover-intent debounce, avoiding a
  popup flash on every fast mouse pass over highlighted text.
- **Hide grace `LEAVE_DELAY_MS = 250`**: once shown, the popup stays visible while the pointer is
  over the SAME range OR over the popup element itself (its own `<button>` needs a hoverable,
  clickable target); leaving both starts a 250ms grace timer before hiding, so moving diagonally
  from the word to the popup's "View full entry" button never flickers the popup shut mid-transit.
- **Immediate (no-grace) dismiss** on: `Escape` keydown; any `mousedown`/`touchstart` outside the
  popup element (`event.composedPath()`-aware, the exact pattern
  `chrome-floating-trigger.ts:19-21`'s `onOutsidePress` already uses); a page `scroll` event
  (capture phase) — the popup does not attempt to reposition on scroll (documented v1 limitation,
  same spirit as B3's "cross-tab live refresh: out of scope v1"); re-hover after a scroll simply
  re-triggers the normal show flow.
- **Suppressed entirely** (never even starts the show-delay timer) while: an active, non-collapsed
  text selection exists (`document.getSelection()?.isCollapsed === false` — never competes with
  the Define-selection flow); the cursor is over one of the extension's own in-page hosts
  (`elementFromPoint`'s tag is `BOTTOM-SHEET`, `LOOKUP-TRIGGER`, `HOVER-RECALL-POPUP`, or any
  `AD-`-prefixed custom element, or `isContentEditable`) — this list is a small, intentionally
  duplicated subset of B3's own skip-list (B3 spec §D4) since B3 does not export it; hovering the
  lookup card/bottom-sheet (when open) is caught by the same `BOTTOM-SHEET` tag check, so no
  separate "is a lookup in progress" flag is needed.
- **Singleton popup**: exactly one `<hover-recall-popup>` element exists per page (created once at
  `content.ts` module scope, toggled via `show()`/`hide()` — not lazily created/destroyed like
  `ChromeFloatingTrigger`'s bubble, since unlike the Define trigger there is no outside-press
  listener lifecycle tied to its creation).
- **Known, accepted a11y limitation**: this is a hover-only affordance with no keyboard-focus
  equivalent (matching the card's "local-only popup" framing and Effort-S sizing) — not addressed
  by this card; flagged here rather than silently omitted.

### 2.8 — Stale-reply guard on the `saved.get` fetch: reuse `createSaveReplyGuard`

Hovering word A, then B before A's `saved.get` reply resolves, must not let A's stale reply paint
over B's popup. `packages/app/src/app/save-reply-guard.ts:13-24` already exports a generic
generation-token guard (`createSaveReplyGuard(): {next(): number; isCurrent(token): boolean}`) —
its doc comment is written in terms of "save/status listeners" but the implementation carries no
save-specific typing; the shape is exactly "increment a token before an async call, drop the reply
if a newer token has since been issued." Reused as-is in `content.ts`'s hover wiring rather than
writing a second, functionally-identical guard.

## 3. The change (per file)

### 3.1 `packages/app/src/wire.ts`

Add one request arm (after B3's `saved.learningWords` arm, once B3 has landed) and one reply arm
(after B3's `savedWords` reply arm):

```ts
z.object({ type: z.literal('saved.get'), word: z.string() }),
```

```ts
z.object({
  ok: z.literal(true),
  type: z.literal('savedEntry'),
  entry: SavedWordEntrySchema.nullable(),
}),
```

`MessageTypeEnum` gains `'saved.get'` (needed so the `ok:false` error-reply arm's `type` field
type-checks for this message).

### 3.2 `packages/app/src/app/router.ts`

New case, after B3's `saved.learningWords` case (§2.3's exact code).

### 3.3 `packages/app/src/app/hover-recall-controller.ts` (new)

Portable, DOM-allowed core class (same `app/`-tier precedent as `PageHighlighter` — DOM access is
allowed there, unlike `domain/`). Owns: rAF-throttled `mousemove` listening, the caret-hit-test
pipeline (§2.1), the show/hide debounce (§2.7), and the suppression checks. Exports a pure
`findHoverHit(hit, ranges)` helper (unit-testable without any real layout engine) plus the
`HoverRecallController` class itself. Full interface and code: plan Task 2.

### 3.4 `packages/app/src/ui/hover-recall-popup.ts` (new)

The `<hover-recall-popup>` custom element (§2.4). Full interface and code: plan Task 3.

### 3.5 `packages/app/src/ui/register.ts`

`registerContentElements()` gains one more `customElements.define('hover-recall-popup', ...)`
call, alongside its existing three.

### 3.6 `packages/app/src/ui/index.ts` / `packages/app/src/index.ts`

Barrel exports for the two new modules (`export * from './ui/hover-recall-popup'` already covered
by the existing `export * from './ui/index'` re-export once `ui/index.ts` itself exports the new
file; `export * from './app/hover-recall-controller'` added to `packages/app/src/index.ts`
alongside its existing `app/*` export list).

### 3.7 `packages/extension-chrome/src/adapters/chrome-hover-recall-popup.ts` (new)

Chrome-shell adapter (mirrors `chrome-floating-trigger.ts`'s shape 1:1): owns the singleton
`<hover-recall-popup>` element's attachment to `document.body` and its theme attribute, exposing
`show(anchor, value)`/`hide()`/`element` (the last so `content.ts` can pass it as the controller's
`popupEl`, §2.7's "hovering the popup itself" check). Full code: plan Task 4.

### 3.8 `packages/extension-chrome/src/content.ts`

- `refreshHighlights()` (B3-authored) gains one line building `hoverMatcher` (§2.2).
- New module-scope instances: `const hoverPopupAdapter = new ChromeHoverRecallPopup();` and
  `const hoverController = new HoverRecallController(document);`, started once via
  `hoverController.start(() => highlighter.ranges, onMatch, onLeave, hoverPopupAdapter.element)`.
- `onMatch` resolves the headword (§2.2), sends `saved.get` guarded by `createSaveReplyGuard`
  (§2.8), and calls `hoverPopupAdapter.show(anchor, {word, preview})` on a non-null reply.
- The popup's `view-full-entry` event sets `lastFocus` and dispatches the existing
  `open-side-panel` document event verbatim (§2.5) — zero changes to that listener.

### 3.9 No change to `packages/app/src/domain/highlight-policy.ts` or `packages/app/src/app/page-highlighter.ts`

Recorded explicitly (per CONTRACTS §4's own framing: "do not re-design highlighting") — §2.2
resolves the range→headword question without touching either file. Zero lines change in B3's own
deliverables.

### 3.10 No change to `packages/extension-chrome/src/sw.ts`, `side-panel.ts`, `side-panel-messages.ts`

The `open-side-panel`/`side-panel.get-focus` plumbing already does everything this card needs
(§2.5); the only wire/router surface this card touches is the new `saved.get` message (§3.1–3.2).

## 4. Scope fence (from the card, held exactly)

- **Local-only popup, zero tokens, zero network** — the entire hover path is `saved.get` (a local
  `chrome.storage.local` read via the router) plus reading `PageHighlighter.ranges`; no
  `LookupClient.lookup()` call anywhere in this card's code.
- **Links to the full entry** — §2.5's reuse of the existing `open-side-panel`/`lastFocus`
  mechanism; no new side-panel surface, no B6 (words page) dependency.
- **Depends on B3 only** (transitively B1/B5) — no new dependency introduced; the card explicitly
  scopes "Escalate: none," and nothing in this design opens a new escalation.
- **Popup layout** — §2.4, the card's one open "Lead decides" item, pinned.
- **S1 held**: `saved.get`'s reply carries only `SavedWordEntry` fields (word/status/savedAt/
  senses) — never the API key; `PublicSettings`/`Settings` are untouched by this card.
- **S4 held**: the popup itself never renders HTML (plain `textContent` only, §2.4); the one place
  raw markdown IS rendered (the side panel's existing `resultToFocus` → `sanitizeMarkdown` path,
  §2.5) is unmodified, already-audited code.
- **No new manifest permission** — nothing here touches `manifest.json`.
- **No UI outside `--ad-*`/`--adp-*` tokens** — `hover-recall-popup.ts` reuses `BASE_VARS`/
  `THEME_CSS` exactly like every other Paperlight surface.

## 5. Testing strategy

1. **Domain-adjacent pure unit — `packages/app/test/app/hover-recall-controller.test.ts`**:
   `findHoverHit` — a hit inside a range's `[startOffset,endOffset]` on the matching
   `startContainer` resolves that range; a hit on a different text node, or outside the offset
   bounds, or a `null` hit, resolves `null`; multiple ranges on the same node resolve the correct
   one. `HoverRecallController` (fake timers, a stubbed `requestAnimationFrame` that runs
   synchronously — mirrors B3's own "shim in the test file" precedent for APIs happy-dom lacks): a
   200ms-sustained hover over the same range fires `onMatch` exactly once; a hover that moves to a
   different range before 200ms elapses resets the debounce and never fires the stale one; leaving
   the range starts a 250ms hide timer that fires `onLeave` unless a `mousemove` back onto the
   range (or onto the injected `popupEl`) arrives first; `Escape` and an outside `mousedown` both
   fire `onLeave` immediately, bypassing the grace timer; a non-collapsed
   `document.getSelection()` suppresses matching entirely; an `elementFromPoint` result tagged
   `BOTTOM-SHEET`/`LOOKUP-TRIGGER`/`HOVER-RECALL-POPUP`/`AD-*`-prefixed suppresses matching;
   injecting a `caretAt` stub that always returns `null` (simulating neither
   `caretPositionFromPoint` nor `caretRangeFromPoint` existing) never fires `onMatch` — the
   graceful no-op path.
2. **Default `caretAt` selection** (same file, no DOM Range needed): a small pure test stubs
   `document.caretPositionFromPoint`/`caretRangeFromPoint` present/absent in each combination and
   asserts the modern API is preferred and the legacy one is used only as a fallback (§2.1's "not
   just polish" claim, made concrete).
3. **UI unit — `packages/app/test/ui/hover-recall-popup.test.ts`**: `show()` sets the headword and
   preview text via `textContent` (never `innerHTML` — assert `innerHTML` of the preview node
   contains no `<`/`>` even when the input string does, proving no HTML injection path exists);
   `hide()` sets `hidden`; clicking "View full entry" dispatches a composed `view-full-entry`
   event with `{word}` in its detail; the element registers idempotently (`registerContentElements`
   called twice does not throw — mirrors the existing `customElements.get` guard pattern already
   proven by the other three elements' tests).
4. **Wire schema — `packages/app/test/wire-schema.test.ts`**: `saved.get` accepted with a `word`
   string, rejected without one; `savedEntry` reply accepted with a real entry AND with
   `entry: null`; rejected with `entry: 'not-an-object'`.
5. **Router — `packages/app/test/app/router.test.ts`**: `saved.get` after a `saved.save` of 'bank'
   replies `{ok:true, type:'savedEntry', entry:{word:'bank', ...}}`; `saved.get` for a
   never-saved word replies `{ok:true, type:'savedEntry', entry:null}`; case-insensitive
   (`saved.get` with `'BANK'` finds an entry saved as `'Bank'` — mirrors `saved.setStatus`'s own
   case-insensitivity test at `router.test.ts:565-579`).
6. **Chrome adapter — `packages/extension-chrome/src/adapters/chrome-hover-recall-popup.test.ts`**:
   mirrors `chrome-floating-trigger.test.ts`'s style — `show()` creates the element once and
   positions it (`left`/`top` from the `AnchorRect`); repeated `show()` calls reuse the same
   element (no duplicate DOM nodes); `hide()` does not remove the element (unlike
   `ChromeFloatingTrigger`, this is a persistent singleton — §2.7).
7. **e2e — `packages/extension-chrome/e2e/b4-hover-recall.spec.ts`** (new; requires B3's e2e
   fixtures/wiring to exist first, since it seeds the same B3 highlight state):
   - Seed `saved:bank` (`status:'learning'`, a real `senses[0]` with a non-empty `definition` and
     `translation`) + `saved:index`, seed settings (default `highlightSavedWords`), load a fixture
     paragraph containing "bank", wait for `CSS.highlights.has('ad-saved-word')` (B3's own
     assertion, confirms the highlight painted). Hover the word (new `hoverWord(page, id, word)`
     e2e helper, mirroring `selectWord`'s Range→viewport-rect technique, `helpers.ts:198-215`, but
     driving `page.mouse.move` instead of a selection) and wait past `HOVER_DELAY_MS`; assert
     `hover-recall-popup` is visible and contains the seeded translation text. Move the mouse away
     and wait past `LEAVE_DELAY_MS`; assert the popup is hidden again.
   - Clicking "View full entry": after the popup shows, click its button; assert
     `mockGemini(context)`'s call count stays **0** (the zero-tokens fence, made concrete); open a
     fresh `side-panel.html` tab (mirrors `side-panel-open.spec.ts:29-36`'s exact recovery
     pattern) and assert it shows the saved word and definition text.
   - A `known`-status saved word (seeded like B3's own known-word negative test) never shows the
     popup — hovering it produces nothing (no B3 underline to begin with, so nothing to hover).
   - With `highlightSavedWords: false` seeded, hovering the (unpainted) word never shows the popup.

## 6. Testing performed (PR evidence — replaces screenshot/video capture)

Per this worktree's `CLAUDE.md` (owner ruling 2026-07-16): **no screenshots or video for this
PR.** The PR body's "Testing performed" section carries the evidence instead — suites run, test
counts, the e2e scenarios exercised (§5.7's four bullets), and the gates passed (lint, format
check, typecheck on both packages, unit, e2e). No `pr-assets/*` branch is created for this card.

## 7. Risk / rollback

- **Risk: low-moderate.** The only genuinely new runtime surface is the caret hit-test + debounce
  state machine (§2.1/§2.7) — a bug there produces a UX annoyance (popup flicker, wrong-word
  popup, or a popup that never shows), never a data-integrity or security issue, since the popup
  is read-only and `saved.get` cannot mutate storage. The `saved.get` wire/router addition follows
  the exact, already-proven shape of `saved.learningWords`/`saved.setStatus`.
- **No data migration.** `SavedWordEntry`/`SavedWordSense`/`SavedWordStatus` (E1) are completely
  untouched — this card only adds a new READ path over the existing shape.
- **Rollback:** revert the single PR. B3's highlighting behavior is completely unaffected (this
  card never modifies `page-highlighter.ts`/`highlight-policy.ts`); the new `saved.get` message
  and `savedEntry` reply arm simply become unused dead code paths for any client that stops
  sending them — no stored data becomes invalid, no other message's schema changed.

## 8. Files touched (summary)

| File                                                                  | Change                                                                                                                              |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `packages/app/src/wire.ts`                                            | + `saved.get` msg arm, + `savedEntry` reply arm, + `MessageTypeEnum` entry                                                          |
| `packages/app/src/app/router.ts`                                      | + `saved.get` case                                                                                                                  |
| `packages/app/src/app/hover-recall-controller.ts`                     | new — caret hit-test + debounce/dismiss state machine                                                                               |
| `packages/app/src/ui/hover-recall-popup.ts`                           | new — `<hover-recall-popup>` Paperlight element                                                                                     |
| `packages/app/src/ui/register.ts`                                     | `registerContentElements()` + one `customElements.define`                                                                           |
| `packages/app/src/ui/index.ts`                                        | + export the new UI module                                                                                                          |
| `packages/app/src/index.ts`                                           | + export `hover-recall-controller`                                                                                                  |
| `packages/extension-chrome/src/adapters/chrome-hover-recall-popup.ts` | new — singleton popup lifecycle + positioning adapter                                                                               |
| `packages/extension-chrome/src/content.ts`                            | `refreshHighlights()` +1 line; new controller/adapter wiring; `view-full-entry` → `lastFocus` + existing `open-side-panel` dispatch |
| `packages/extension-chrome/e2e/helpers.ts`                            | + `hoverWord()` helper                                                                                                              |
| tests + snapshot + 1 e2e spec                                         | per §5                                                                                                                              |

**Untouched:** `SavedWordEntry`/`SavedWordSense`/`SavedWordStatus` (E1), `ports.ts`,
`domain/highlight-policy.ts`, `app/page-highlighter.ts`, `sw.ts`, `side-panel.ts`,
`side-panel-messages.ts`, `manifest.json`, every existing wire arm/reply arm other than the two
new ones.

## 9. Concurrency

Per CONTRACTS §5, files this card modifies that other unshipped cards in this batch also modify,
so the orchestrator serializes:

- **`packages/extension-chrome/src/content.ts`** — also touched by A5, A6, A13, A14, A15, and B3
  itself (this card's direct dependency; B4's content.ts edits must land strictly after B3's).
- **`packages/app/src/wire.ts` / `packages/app/src/app/router.ts`** — hot for any card adding a
  wire message; B3 (`saved.learningWords`), A3, A12, B9, B12, B14 (per each card's own spec) all
  touch these same two files.
- **`packages/app/src/ui/register.ts` / `packages/app/src/ui/index.ts`** — low-traffic but shared;
  no other card in this batch is known to add a new content-script-registered custom element, so
  no specific conflict is expected, only the general "last writer regenerates cleanly" caution.

No conflict with `settings-form.ts` (no new setting, §2.6) or `docs/index.html` (not a landing-page
card).
