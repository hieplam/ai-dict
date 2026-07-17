# B11 — Casual review flip

Roadmap card: `docs/ROADMAP.md` §4 B11 (Impact 3 · Effort M · Score 1.5). Depends on: B1 (shipped,
PR #99), B5 (shipped, PR #105). Escalate: none (`docs/ROADMAP.md:549`). Lead decides: deck window,
card UI (`docs/ROADMAP.md:549`) — this spec pins both below.

## 1. Problem (grounded in code)

Today there is no way to revisit a saved word except reading the flat saved-word collection one
entry at a time:

- `savedWordsList` (`packages/app/src/domain/saved-words-policy.ts:110-118`) returns every
  `SavedWordEntry` newest-saved-first, fully implemented and fully unit-tested — but it has **zero
  callers anywhere in the repo** (confirmed by `grep -rn savedWordsList packages`; its own doc
  comment already names the gap: "B6 (Words page) is the future consumer," line 108-109). No wire
  message can list the saved-word collection either: `WireMessageSchema`
  (`packages/app/src/wire.ts:95-141`) has exactly three `saved.*` arms — `saved.save`,
  `saved.delete`, `saved.setStatus` (added by B5) — each acting on **one** word; none lists the
  collection.
- `SavedWordEntry.status` (`packages/app/src/domain/types.ts:246-251`) already carries exactly the
  2-state lifecycle this card's "optionally mark known" step needs: B5 shipped
  `savedWordSetStatus` (`saved-words-policy.ts:86-98`), the `saved.setStatus` wire message
  (`wire.ts:121-127`), and its router case (`packages/app/src/app/router.ts:261-266`, replies
  `{ ok:true, type:'saved', entry }` on a hit or `{ ok:true, type:'ack' }` on an unknown word). B11
  is the second consumer of this exact path — not a new write mechanism.
- The side panel (`packages/app/src/ui/side-panel-view.ts`) has exactly two live regions today: the
  current lookup (`focusState`, `CardState`-shaped) and a capped "Recent" history list
  (`recent`, ≤50 rows via `refreshRecent()`,
  `packages/extension-chrome/src/side-panel.ts:130-143`). Nothing in the panel ever re-surfaces a
  saved word's original sentence for active recall — the panel is a one-way funnel (lookup → save)
  with no return trip.
- `SavedWordSense` (`domain/types.ts:231-237`) already stores exactly what a review card needs per
  saved word — `sentence`, `definition`, `translation` — captured at save time. `SavedWordEntry.
savedAt` (`types.ts:249`) is the entry-level save timestamp B11's "last 14 days" window reads.

The gap is entirely **retrieval + a review UI + one composition-root wiring** — no new persisted
field, no new status mechanism.

## 2. Design questions (pinned)

### 2.1 How does the panel retrieve every saved word, given no listing message exists?

**Pinned — a new `saved.list` wire message**, zero-payload request, replying with every stored
`SavedWordEntry`:

```
{ type: 'saved.list' } → { ok: true, type: 'saved.list', entries: SavedWordEntry[] }
```

The router handler is a straight call to the already-implemented, already-tested `savedWordsList`
domain function — this card (or whichever sibling card lands first, see the concurrency note below)
is simply its first wire consumer.

**This exact message is also independently pinned by `docs/superpowers/specs/
2026-07-17-b10-weekly-digest-design.md` §2.4** (authored in the same spec-authoring batch as this
card, for its own "saved this week" stat). Both specs need the identical primitive — "every saved
word, over the wire" — and there is exactly one sane shape for it, so this spec pins the **same**
name, request shape, and reply shape B10 already specified, rather than inventing a second,
differently-named message that would leave two ways to ask the same question. **Whichever of B10 /
B11 is implemented first adds the message; the other reuses it verbatim.** Plan Task 2 below makes
this concrete and non-blocking: it starts with a repo-state check and has a fully-specified branch
for either outcome — this is not a placeholder, it is a resolved fork.

Rejected alternative — **B11 invents its own message** (e.g. `review.deck` that does the filtering
server-side in the router). Rejected because: (a) it would duplicate `saved.list`'s exact "give me
every saved word" retrieval the moment B10 lands, permanently forking the wire protocol for no
reason; (b) per §2.5 below, the filtering/shuffling belongs in a pure domain function testable in
isolation — pushing it into the router would need a second, router-level test suite instead of one
pure-function suite, and would make the service worker own a product decision (the 14-day window,
the shuffle) that belongs in the domain layer per `rule-domain-purity`
(`ref-core-dependency-rule`), exactly the reasoning B10's own §2.5 already established for its
digest.

Per the global "wire message + router case in ONE task" convention
(`docs/ROADMAP.md` §8's B5/B3 ruling — `router.ts`'s `switch (msg.type)` is exhaustive with no
`default` arm, so a new case cannot type-check independently of its schema arm), Task 2 of the plan
lands `wire.ts` + `router.ts` + their tests together (or, if `saved.list` already exists, verifies
it and adds only the regression test — see Task 2's exact branching).

### 2.2 The review window and filter (card text: "learning words from the last 14 days")

**Pinned — `status === 'learning'` AND `savedAt` inside a rolling, inclusive 14-day window**:
`cutoff = nowMs - 14 * 24 * 60 * 60 * 1000`; a word qualifies when `cutoff <= savedAt <= nowMs`
(both ends inclusive — a word saved exactly 14 days ago still counts, mirroring B10's own rolling-
window inclusivity convention, `weekly-digest.ts`'s `windowStart <= createdAt <= nowMs`). `savedAt`
is the only timestamp `SavedWordEntry` carries (`types.ts:249`) — there is no per-encounter or
per-sense timestamp to read instead (`SavedWordSense`, `types.ts:231-237`, has none), so "last 14
days" can only mean "saved within the last 14 days," not "last seen"/"last reviewed." No calendar-
day handling is needed — like B10, this codebase uses epoch-ms timestamps throughout (`savedAt`,
`createdAt`, `fetchedAt`), so a rolling window needs no timezone logic.

Rejected alternative — **a calendar-day window** ("saved since midnight 14 days ago"). Rejected for
the identical reason B10's design spec §2.2 rejects calendar-week: it makes the result depend on
what time of day the reader opens the review, requires timezone handling this 100%-local extension
has no existing primitive for, and every other rolling window in this codebase (B7's 30-day nudge
window, B10's 7-day digest window) is already rolling-from-now, not calendar-aligned. Consistency
with the two existing precedents outweighs any benefit of calendar alignment here.

### 2.3 Shuffle — deterministic for tests, real randomness at runtime

**Pinned — an injectable `shuffle` function, defaulting to a Fisher-Yates shuffle over
`Math.random()`.** This mirrors the existing `now: () => number` DI seam every other domain policy
module in this codebase already uses for non-determinism (`SavedWordsDeps.now`,
`RouterDeps.now`, B7's `evaluateNudge`) — the seam here is randomness instead of the clock, but the
shape (an optional override, defaulting to the real, impure primitive) is identical. Tests supply a
deterministic override (e.g. `(arr) => arr` or `(arr) => [...arr].reverse()`) and assert exact
output; production code omits the override and gets a real per-session shuffle. This keeps
`buildReviewDeck` pure and unit-testable per the repo's test-first standard, without inventing a new
DI pattern.

Rejected alternative — **no shuffle, always newest-saved-first** (matching `savedWordsList`'s own
ordering). Rejected because the roadmap card's own Missing/Payoff line is explicit — "shuffled"
(`docs/ROADMAP.md:545`) — a fixed order would always put the same word first every session, which
is exactly the kind of "overdue queue" feel the card's permanent anti-goal (no scheduling, no due
dates) is written to avoid; a fresh shuffle each session keeps every review casual and unordered.

### 2.4 Which sense does the deck show for a multi-sense entry?

**Pinned — `senses[0]` only, unconditionally.** `SavedWordEntry.senses` is ratified as an array
because B14 (sense-aware dedup, not yet shipped — confirmed by `docs/ROADMAP.md`'s absence of a "✅
Implemented" status on B14) is the future feature that will ever populate more than one entry;
`savedWordUpsert` (`saved-words-policy.ts:41-68`) today always replaces `senses` with a single-
element array on every save/re-save (line 60: `senses: [sense]`), so every entry `buildReviewDeck`
sees today has exactly one sense. Showing `senses[0]` is not a simplification that drops data today
— it is the only data that exists today. When B14 ships, its own spec is the correct place to decide
how a multi-sense review card should behave (e.g., cycle senses, show all inline) — this card does
not attempt to anticipate that design.

Rejected alternative — **flatten every sense of every entry into its own deck slot** (so a 3-sense
word contributes 3 cards). Rejected as premature: it speculatively designs for a schema shape
(`senses.length > 1`) nothing in the shipped codebase produces yet, and doing so now would make
B14's future spec inherit an assumption about review-card cardinality it never asked for. `senses[0]`
is grounded in what `savedWordUpsert` actually writes today.

### 2.5 Compute location — pure domain function, computed once per "Review" click

**Pinned — a pure domain function, `buildReviewDeck(entries, opts)`, called once each time the
reader opens review (not on panel boot, not recomputed while the deck is open).** New file
`packages/app/src/domain/review-deck-policy.ts`:

```ts
export function buildReviewDeck(
  entries: SavedWordEntry[],
  opts: { nowMs: number; shuffle?: (entries: SavedWordEntry[]) => SavedWordEntry[] },
): SavedWordEntry[];
```

No I/O, no ambient `Date.now()`/`Math.random()` call unless the caller omits the optional overrides
— the same DI seam every other domain policy module in this codebase already uses (§2.3). The
composition root (`packages/extension-chrome/src/side-panel.ts`) calls it exactly once inside its
new `openReview()` function, itself triggered only by the reader clicking the new "Review" button —
never from the boot sequence, never from the live-mirror listener that handles in-flight lookups.
This is the direct implementation of the card's own permanent fence: **"no scheduling algorithm, no
due dates, no streaks"** (`docs/ROADMAP.md:547`) — there is no persisted review position, no
background computation, and no state that survives closing the review view; every open is a fresh
fetch + a fresh shuffle.

Rejected alternative — **a router-side `review.deck` message that computes the filtered/shuffled
deck in the service worker**, already covered by §2.1's rejected-alternative reasoning (same
argument B10's §2.5 makes for its own digest: aggregation/filtering is a product decision that
belongs in the domain layer, not the router).

### 2.6 Entry-point placement in the side panel

**Pinned — a plain text button, `Review`, in the side panel's header, between the brand mark and
the settings gear** (`packages/app/src/ui/side-panel-view.ts`'s `header.append(brand, settings)`,
line 140, becomes `header.append(brand, review, settings)`). It is **always visible**, including
when there is nothing to review — clicking it with zero eligible words shows the review surface's
own empty state (§2.8), which teaches the feature exists for later, exactly like B10's digest
section stays visible at zero (`docs/superpowers/specs/2026-07-17-b10-weekly-digest-design.md`
§2.7's identical reasoning: hiding an unused feature makes a first-time reader unable to discover
it).

Rejected alternative — **a new icon button, reusing/extending the canonical §5.10 icon set**
(`packages/app/src/ui/styles/tokens.ts:174-181`, the pinned `ICON_*` glyphs). Rejected to avoid
extending a set the codebase explicitly documents as "pinned … so the set can never drift again"
(`tokens.ts:175-176`) for a single new button; a plain text button costs nothing architecturally,
matches the existing `.settings` button's minimal-chrome styling, and needs no new SVG design
decision. If a future card wants an icon for this entry point, that is a follow-up, not part of
B11's scope fence.

Rejected alternative — **a section inside the panel body** (like B10's digest or the "Recent" list),
always rendered inline rather than a full takeover. Rejected because a review session is a distinct,
focused mode (one card at a time, sequential, dismissible) — cramming it into the same scroll region
as the current lookup + Recent + (B10's) digest would either force the reader to scroll past
unrelated content mid-review or require its own separate scroll boundary, adding complexity for no
benefit over a clean full-panel swap (§2.7).

### 2.7 Full-panel takeover mechanism — a NEW top-level custom element, not a mode flag on `SidePanelView`

**Pinned — a brand-new custom element, `<review-flip-view>` (new file
`packages/app/src/ui/review-flip-view.ts`), and the composition root
(`packages/extension-chrome/src/side-panel.ts`) swaps it in for `<side-panel-view>` inside a shared
`#app` container** — the exact same swap-by-DOM-replacement pattern
`packages/extension-chrome/src/options.ts`'s `mountSettings`/`mountOnboarding` already establishes
(`app.replaceChildren(form)` / `app.replaceChildren(view)`, `options.ts:84-111,181-207`), not a new
mechanism.

This requires `packages/extension-chrome/src/side-panel.html` to gain a wrapping `<div id="app">`
around `<side-panel-view>` (today it has none — the element sits directly in `<body>`, unlike
`options.html`'s `<div id="app"></div>`). `side-panel.ts` then holds `app`/`view` element references
and swaps `app`'s single child between the persistent `view` and a lazily-created `reviewView`.

Why not a `mode`/`hidden` flag directly on `<side-panel-view>` instead of a whole new element +
container-level swap: a custom element that sets `:host{display:flex}` unconditionally in its own
shadow-scoped CSS (as `SidePanelView` does, `side-panel-view.ts:33`) **cannot be reliably hidden by
the light-DOM `hidden` attribute alone** — per the CSS cascade, an author-origin rule (the
component's own `:host{...}` block, however low its specificity) always wins over the browser's
user-agent-origin `[hidden]{display:none}` default, because origin is the primary sort key in the
cascade, ahead of specificity. Toggling `hidden` on `<side-panel-view>` would silently do nothing
without the component itself special-casing `:host([hidden])`, which nothing in this codebase does
today. **DOM removal/insertion (`replaceChildren`) sidesteps this pitfall entirely** and is already
the codebase's own established pattern for exactly this "swap between two top-level screens"
scenario (`options.ts`). Detaching `<side-panel-view>` is safe: its `connectedCallback`
(`side-panel-view.ts:114-118`) already guards `if (this.shadowRoot) { this.renderFocus(); return; }`
— re-attachment re-renders only the focus region and leaves the (untouched, still-in-memory)
`recentList`/any B10 `digestEl` content exactly as it was, because the shadow tree itself is never
destroyed by detaching the host element from the light DOM. This exact detach/reattach safety is
already unit-tested today: `packages/app/test/ui/side-panel-view.test.ts`'s "does not re-initialize
the shadow on reconnect" test (`side-panel-view.test.ts:232-237`) proves the precise mechanism this
card now relies on.

Rejected alternative — **a `PanelFocusState`-style new `kind` value inside `SidePanelView` itself**
(e.g. `{ kind: 'review'; ... }` alongside the existing `CardState | { kind: 'empty' }` union,
`side-panel-view.ts:13`). Rejected because it would make `SidePanelView`'s single `focusState`
region simultaneously own "the current lookup" and "the review session," two concerns with
different lifecycles (a lookup can arrive mid-review via the live mirror listener,
`side-panel.ts:237-275` — a review session must not be silently clobbered by that), forcing new
guard logic to protect review state from being overwritten by an incoming lookup broadcast. A
separate element sidesteps this entirely: while `<review-flip-view>` is mounted, `<side-panel-view>`
is detached and simply does not receive the live-mirror `chrome.runtime.onMessage` broadcasts
routed by `msg.to === 'side-panel'` matching (the listener is registered on the module-level
`chrome.runtime.onMessage`, not on the element, so it keeps firing — but writes to `view.focusState`
on a detached element are inert until reattachment, harmlessly queuing the latest state for when the
reader closes review, which is the correct behavior: "keep showing the last lookup," matching the
panel's own existing "state === 'close' is intentionally ignored" precedent, `side-panel.ts:272-273`).

### 2.8 Card UI — the flip mechanic itself

**Pinned exact flow** (per-card, within `<review-flip-view>`):

- **Front:** the headword (serif `<h2>`, matching the panel's own `.focus h2` treatment) + the
  saved sentence verbatim (`senses[0].sentence`, plain text — it is the reader's own captured page
  text via `extractSentence`, `dom-selection-source.ts:5-12`, never LLM output, so no
  `sanitizeMarkdown` call applies to it; S4 governs model output, not this field) + one button,
  **"Reveal meaning."** The word is visibly present in its original sentence exactly as saved — this
  card does not blank/mask it (that is a fill-in-the-blank quiz mechanic the roadmap card never
  asks for; the recall test is "do I remember what this word means in this sentence," not "can I
  spot the word").
- **Reveal** (tap "Reveal meaning"): shows the saved definition (`senses[0].definition`, rendered as
  sanitized HTML — see §2.9, this field **is** model output and S4 applies) + the saved translation
  (`senses[0].translation`, plain text, omitted entirely when `''` — legacy pre-B2 entries may still
  carry an empty translation) + two buttons, **"Mark known"** and **"Next."**
- **"Mark known"**: fires the composed `mark-known` event (detail `{ word }`); the composition root
  sends the existing `saved.setStatus` message (§2.1's B5 precedent) with `status: 'known'`,
  fire-and-forget (matches `content.ts`/`side-panel.ts`'s existing `toggle-status` listener style,
  `side-panel.ts:203-211`). The component **advances to the next card immediately** (optimistic, no
  round trip awaited) — a word just marked known no longer belongs in a "still learning" deck, so
  leaving it on screen would be visibly stale.
- **"Next"**: advances to the next card without touching status — for "I remember this one, but I'm
  not ready to retire it yet."
- **Deck exhausted:** a "Nice work — you reviewed N word(s)" completion screen with a "Back to
  panel" button.
- **Empty deck** (nothing eligible): "Nothing to review yet — words you save show up here for 14
  days while you're still learning them," with a "Back to panel" button.
- **Close (×)**, in the header, available at every stage: returns to the normal panel immediately.
  No progress is persisted — reopening review always starts a fresh shuffled deck (§2.5's fence).

Rejected alternative — **fill-in-the-blank (mask the word in the sentence)**. Rejected per the
front-state reasoning above: the roadmap card's own payoff line is "shows the **original** sentence"
(`docs/ROADMAP.md:545`), not a redacted one; masking would also require exactly the kind of
word-boundary matching logic B3 (re-encounter highlighting) already owns as its dedicated feature,
and re-implementing a lighter version here risks drifting from B3's matching rules for a mechanic
the card never asked for.

Rejected alternative — **a "Skip" action on the front, before reveal**. Rejected as unnecessary
complexity: revealing costs nothing (no API call, no token spend — it's a local KV read already in
memory), so there is no cost to forcing a reveal before the reader decides Next vs. Mark known; a
separate skip-without-revealing path would just be a third way to reach the same "advance, do
nothing" outcome "Next" already provides after one extra tap.

### 2.9 S4 — the stored definition is model output and must be re-sanitized at render time

**Pinned — the composition root (`side-panel.ts`) calls `sanitizeMarkdown` on each card's
`senses[0].definition` before it ever reaches `<review-flip-view>`**, exactly mirroring
`side-panel.ts`'s own existing `resultToFocus` (`side-panel.ts:112-128`, `sanitizeMarkdown(r.
markdown)`). This is easy to miss: `senses[0].definition` is **stored** data (written by
`trackSaveContext`, `side-panel.ts:56-77`/`content.ts`'s equivalent, as the raw `r.markdown` at save
time — confirmed by reading `trackSaveContext`'s `definition: r.markdown` line), not a live LLM
response, but it is still 100% model-produced markdown that has never itself been sanitized before
storage (only the live in-card render path sanitizes; the star button persists the raw string
straight through `saved.save`'s wire payload). Rendering it later without re-sanitizing would be a
direct S4 violation. `<review-flip-view>` itself never sanitizes — it only ever receives
already-`SafeHtml`-branded strings and assigns them via `.innerHTML`, exactly mirroring
`renderCardState`'s own `body.innerHTML = state.safeHtml; // trusted: sanitized upstream`
(`lookup-card.ts:279`) pattern.

## 3. The change

### 3.1 `packages/app/src/domain/review-deck-policy.ts` (new)

```ts
import type { SavedWordEntry } from './types';

/** B11: only learning-status words saved within the last REVIEW_WINDOW_DAYS days enter the deck
 * — see the design spec §2.2 for why this reads `savedAt`, not a per-sense timestamp. */
export const REVIEW_WINDOW_DAYS = 14;
const REVIEW_WINDOW_MS = REVIEW_WINDOW_DAYS * 24 * 60 * 60 * 1000;

/** Fisher-Yates. Only ever called via buildReviewDeck's default parameter (impure — Math.random);
 * tests always supply an override (design spec §2.3, the SavedWordsDeps.now DI pattern). */
function defaultShuffle(entries: SavedWordEntry[]): SavedWordEntry[] {
  const out = entries.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

export interface BuildReviewDeckOptions {
  /** Wall clock; injectable so tests are deterministic (mirrors SavedWordsDeps.now/RouterDeps.now). */
  nowMs: number;
  /** Deterministic override for tests; defaults to defaultShuffle (real randomness) when omitted. */
  shuffle?: (entries: SavedWordEntry[]) => SavedWordEntry[];
}

/**
 * B11: the casual-review deck = learning-status words saved within the last REVIEW_WINDOW_DAYS
 * days, shuffled. Pure function — no I/O; the only non-determinism (Math.random) is confined to
 * the optional `shuffle` DI seam. PERMANENT fence (roadmap B11): no scheduling algorithm, no due
 * dates, no streaks — this function filters + shuffles, nothing else, every time it runs; there is
 * no persisted notion of "already reviewed" or "overdue."
 */
export function buildReviewDeck(
  entries: SavedWordEntry[],
  opts: BuildReviewDeckOptions,
): SavedWordEntry[] {
  const cutoff = opts.nowMs - REVIEW_WINDOW_MS;
  const eligible = entries.filter(
    (e) => e.status === 'learning' && e.savedAt >= cutoff && e.savedAt <= opts.nowMs,
  );
  const shuffle = opts.shuffle ?? defaultShuffle;
  return shuffle(eligible);
}
```

### 3.2 `packages/app/src/wire.ts` — new `saved.list` message (or reuse, see §2.1)

New zero-payload request arm, placed next to the other `saved.*` arms:

```ts
// B10/B11: list every currently saved word. First specified by whichever of the weekly-digest
// (B10) or casual-review-flip (B11) cards lands first — see either design spec's §2.1/§2.4 for
// why both need the identical primitive. No payload.
z.object({ type: z.literal('saved.list') }),
```

`MessageTypeEnum` gains `'saved.list'`. New reply arm on `WireReplySchema`:

```ts
z.object({
  ok: z.literal(true),
  type: z.literal('saved.list'),
  entries: z.array(SavedWordEntrySchema),
}),
```

The compile-time `AssertEqual` drift guard (`wire.ts:201-209`) needs no new tuple entry — `saved.
list`'s reply reuses the existing `SavedWordEntrySchema`/`SavedWordEntry` pair the guard already
covers via its `SavedWordEntry` check.

### 3.3 `packages/app/src/app/router.ts` — new `saved.list` case (or reuse, see §2.1)

```ts
case 'saved.list': {
  const entries = await savedWordsList({ storage: deps.kv });
  return { ok: true, type: 'saved.list', entries };
}
```

`savedWordsList` joins the existing `savedWordUpsert`/`savedWordDelete`/`savedWordSetStatus` import
from `../index`. No `readToggles`/cache/queue involvement — a pure read, exactly like `settings.get`.

### 3.4 `packages/app/src/index.ts`

One new barrel line, next to the other domain re-exports:

```ts
export * from './domain/review-deck-policy';
```

### 3.5 `packages/app/src/ui/review-flip-view.ts` (new)

New custom element `<review-flip-view>`, self-contained (own shadow root, own `CSS` block, own
`BASE_VARS`/`THEME_CSS` adoption — mirrors `onboarding-view.ts`'s/`side-panel-view.ts`'s own
pattern). Exports:

```ts
export interface ReviewCard {
  word: string;
  sentence: string;
  safeHtml: SafeHtml; // pre-sanitized by the composition root — see design spec §2.9
  translation: string;
}
export class ReviewFlipView extends HTMLElement {
  /* set/get deck(cards: ReviewCard[]) */
}
```

Full implementation (Task 3 of the plan carries the exact code + CSS + markup + events: `close`
composed on the header × button and on the empty/done screens' "Back to panel" button; `mark-known`
composed with `detail: { word }` on the revealed state's "Mark known" button). Internal state:
`_deck: ReviewCard[]`, `_index: number` (0-based), `_revealed: boolean` — reset to `0`/`false` every
time `.deck` is set (§2.5/§2.8: no persisted position).

### 3.6 `packages/app/src/ui/register.ts`

```ts
export function registerReviewFlip(): void {
  if (!customElements.get('review-flip-view'))
    customElements.define('review-flip-view', ReviewFlipView);
}
```

(new `import { ReviewFlipView } from './review-flip-view';` at the top).

### 3.7 `packages/app/src/ui/index.ts`

```ts
export * from './review-flip-view';
```

### 3.8 `packages/app/src/ui/side-panel-view.ts` — the "Review" entry point

New CSS rule, placed immediately after the existing `.settings svg{width:15px;height:15px;
pointer-events:none}` rule (`side-panel-view.ts:43`):

```css
.review-btn {
  display: inline-flex;
  align-items: center;
  margin-left: 8px;
  border: 0;
  background: transparent;
  color: var(--ad-ink-soft);
  font: inherit;
  font-size: var(--adp-text-xs);
  font-weight: var(--adp-weight-semi);
  padding: 5px 8px;
  border-radius: var(--adp-radius-control);
  cursor: pointer;
  transition:
    background var(--adp-dur-fast) var(--adp-ease),
    color var(--adp-dur-fast) var(--adp-ease);
}
.review-btn:hover {
  background: var(--ad-surface-raised);
  color: var(--ad-ink);
}
.review-btn:focus-visible {
  outline: 2px solid var(--ad-accent);
  outline-offset: 2px;
}
@media (prefers-reduced-motion: reduce) {
  .review-btn {
    transition: none;
  }
}
```

`connectedCallback`'s header-building block (`side-panel-view.ts:126-140`) gains a new button,
created between `brand` and `settings`:

```ts
// B11: entry point into the casual-review deck. A plain text button, not part of the pinned
// §5.10 icon set (design spec §2.6) — always visible, including with nothing to review, so the
// feature is discoverable even at zero saved words.
const review = document.createElement('button');
review.type = 'button';
review.className = 'review-btn';
review.textContent = 'Review';
review.setAttribute('aria-label', 'Review your saved words');
review.addEventListener('click', () =>
  this.dispatchEvent(new CustomEvent('open-review', { bubbles: true, composed: true })),
);
```

and the final line of that block changes from `header.append(brand, settings);` to
`header.append(brand, review, settings);`. Nothing else in this file changes — `focusState`,
`recent`, `renderFocus`, `renderRecent`, and (if B10 has landed) `digest`/`renderDigest` are
untouched.

### 3.9 `packages/extension-chrome/src/side-panel.html`

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>AI Dictionary</title>
  </head>
  <body>
    <div id="app">
      <side-panel-view></side-panel-view>
    </div>
    <script type="module" src="side-panel.js"></script>
  </body>
</html>
```

(Only the addition of the wrapping `<div id="app">` — everything else in the file is unchanged.)

### 3.10 `packages/extension-chrome/src/side-panel.ts` — wiring

New imports (added to the existing `@ai-dict/app` import list): `registerReviewFlip`,
`buildReviewDeck`, `type ReviewFlipView`, `type ReviewCard`, `type SavedWordEntry`. New call
`registerReviewFlip();` next to the existing `registerSidePanel();` (line 19). New element
references:

```ts
const app = document.querySelector('#app') as HTMLElement;
const view = document.querySelector('side-panel-view') as SidePanelView;
```

(`view`'s declaration is unchanged in substance — it now resolves inside `#app`, per §3.9 — only the
new `app` const is added alongside it.)

New module state:

```ts
// B11: the panel's currently-applied theme, captured by initFromSettings, re-stamped onto the
// review view the moment it's created — mirrors options.ts stamping data-ad-theme on every
// screen it mounts.
let currentTheme = 'sepia';
// B11: created lazily on the first "Review" click; reused for the rest of the panel session so
// its close/mark-known listeners are registered exactly once.
let reviewView: ReviewFlipView | undefined;
```

`initFromSettings` (`side-panel.ts:220-234`) gains one line right after its existing
`view.setAttribute('data-ad-theme', reply.settings.theme);`:

```ts
currentTheme = reply.settings.theme;
```

New functions, plus one new listener on `view`:

```ts
function ensureReviewView(): ReviewFlipView {
  if (!reviewView) {
    reviewView = document.createElement('review-flip-view') as ReviewFlipView;
    reviewView.addEventListener('close', () => {
      app.replaceChildren(view);
    });
    // B11: reuses the exact saved.setStatus message B5 shipped — no new wire message for this.
    reviewView.addEventListener('mark-known', (e) => {
      const { word } = (e as CustomEvent<{ word: string }>).detail;
      void chrome.runtime
        .sendMessage({ type: 'saved.setStatus', word, status: 'known' })
        .catch(() => undefined);
    });
  }
  return reviewView;
}

// B11: fetch every saved word, build this session's shuffled deck, and swap the panel over to
// the review surface. Best-effort like refreshRecent/recoverFocus: a failed fetch shows the
// review view's own empty state rather than a separate error UI (design spec §2.5/§2.8).
async function openReview(): Promise<void> {
  const rv = ensureReviewView();
  rv.setAttribute('data-ad-theme', currentTheme);
  let cards: ReviewCard[] = [];
  try {
    const raw: unknown = await chrome.runtime.sendMessage({ type: 'saved.list' });
    const reply = raw as WireReply | undefined;
    if (reply && reply.ok && reply.type === 'saved.list') {
      const deck = buildReviewDeck(reply.entries as SavedWordEntry[], { nowMs: Date.now() });
      cards = deck.map((e) => ({
        word: e.word,
        sentence: e.senses[0]?.sentence ?? '',
        // S4: senses[0].definition is stored model output — re-sanitize at render time, exactly
        // like resultToFocus does for a live lookup (design spec §2.9).
        safeHtml: sanitizeMarkdown(e.senses[0]?.definition ?? ''),
        translation: e.senses[0]?.translation ?? '',
      }));
    }
  } catch {
    // cards stays [] — the review view's own empty state covers this (design spec §2.8).
  }
  rv.deck = cards;
  app.replaceChildren(rv);
}

view.addEventListener('open-review', () => void openReview());
```

`sanitizeMarkdown`, `WireReply` are already imported in this file. No change to the final boot
sequence (`refreshRecent()`/`initFromSettings()`/`recoverFocus()`, and — if B10 has landed —
`loadDigest()`): review is entirely on-demand, never fetched at panel-open.

## 4. No change to…

- **`packages/app/src/domain/saved-words-policy.ts`** — `savedWordsList`/`savedWordSetStatus` are
  reused verbatim; this card is (at most) their first/second wire consumer, never a modifier.
- **`packages/app/src/domain/types.ts`** — no new field on any type. Unlike B10 (which adds
  `HistoryEntry.url?`/`.title?`), B11 introduces no schema change of any kind — `SavedWordEntry`/
  `SavedWordSense`/`SavedWordStatus` are read exactly as ratified.
- **`packages/app/src/ui/lookup-card.ts`** — `CardState`/`renderCardState`/`renderSaveRow` are
  untouched. A review card is a deliberately independent UI surface (§2.7), not a new `CardState`
  variant; an implementer must resist folding this into the existing card state machine.
- **`packages/app/src/app/inbound.ts`** (`classifyInbound`) — validates against `WireMessageSchema.
safeParse` generically; the new `saved.list` arm (if this card adds it) is automatically covered
  with no code change here, exactly as B10's own design spec §4 notes for the same message.
- **`packages/extension-chrome/src/content.ts`** — the in-page card has no review surface; this
  card lives entirely in the side panel.
- **`packages/extension-chrome/src/manifest.json`** — no new permission. `saved.list` and
  `saved.setStatus` are ordinary `chrome.runtime` messages the extension already has permission to
  send to its own service worker.
- **`packages/app/src/app/history-export.ts`, `side-panel-messages.ts`** — neither history export
  nor the side panel's focus-recovery messaging is implicated; review sessions are never persisted
  or recovered across a panel reload (§2.5/§2.8's fence).

## 5. Scope fence (from the card, held exactly)

- **Permanently no scheduling algorithm, no due dates, no streaks** (`docs/ROADMAP.md:547`,
  restated as "stated so no future contributor 'improves' it into Anki"): `buildReviewDeck` computes
  a fresh filter+shuffle on every call, with no persisted "already reviewed"/"due" state anywhere —
  confirmed by §3.1's implementation carrying zero storage reads/writes of its own.
- **Deck = learning-status words from the last 14 days, shuffled** (`docs/ROADMAP.md:545`) — pinned
  exactly in §2.2/§2.3/§3.1.
- **Do 5 or 50, nothing is "overdue"** — the deck is the full eligible set every time; there is no
  per-session cap and no concept of a word falling behind.
- **Constraint 4 (no background LLM calls)** — not implicated; this card makes **zero** LLM calls.
  Every read (`saved.list`) and write (`saved.setStatus`) is a local KV operation triggered by an
  explicit "Review"/"Mark known" click.
- **S1** — untouched; `saved.list`'s reply carries `SavedWordEntry[]` (the ratified E1 shape, which
  never carried a key field).
- **S4** — the stored `senses[0].definition` is re-sanitized at render time before reaching
  `<review-flip-view>` (§2.9); the sentence/translation fields are plain text, never treated as
  trusted HTML.
- **Design tokens only** — `review-flip-view.ts`'s CSS and `side-panel-view.ts`'s new `.review-btn`
  rule read exclusively `--ad-*`/`--adp-*` custom properties; no hard-coded color, no
  `prefers-color-scheme` branch (reduced-motion is respected via the existing
  `@media (prefers-reduced-motion: reduce)` pattern used throughout the codebase).
- **No manifest/permission change** — confirmed in §4.

## 6. Testing strategy

1. **Unit — new `packages/app/test/review-deck-policy.test.ts`** (pure function, no fakes needed):
   a learning word saved exactly `REVIEW_WINDOW_DAYS` days ago is included (inclusive boundary); one
   saved 1ms past the window is excluded; a `known`-status word is excluded even if saved today; the
   injected `shuffle` override is used verbatim (assert exact output order via a non-identity
   override); omitting `shuffle` still returns every eligible entry (assert as a set, not an order);
   empty input → empty deck.
2. **Unit — `packages/app/test/wire-schema.test.ts` additions**: a bare `{ type: 'saved.list' }`
   request parses; a `{ ok:true, type:'saved.list', entries: [...] }` reply parses with a
   well-formed `SavedWordEntry[]` and rejects one containing a malformed entry (reuses the existing
   `strictObject` sense-shape rejection already proven for `saved.save`'s reply). The JSON-schema
   snapshot test (`wire-schema.test.ts:405-409`) is regenerated via `vitest -u`, not hand-edited —
   **only if this card is the one that lands the `saved.list` arm** (see Task 2's branching).
3. **Unit — `packages/app/test/app/router.test.ts` additions**: `saved.list` on an empty store
   replies `{ ok:true, type:'saved.list', entries: [] }`; after two `saved.save` calls, `saved.list`
   replies with both entries — **only if this card lands the arm**; otherwise this task instead adds
   a single regression assertion proving the already-shipped arm behaves this way, without
   re-declaring the schema/router case.
4. **Unit — new `packages/app/test/ui/review-flip-view.test.ts`**: empty deck shows the empty-state
   copy; the first card's front shows the headword + sentence with no meaning/translation visible;
   clicking "Reveal meaning" shows the sanitized definition HTML + translation and swaps in "Mark
   known"/"Next"; clicking "Mark known" fires a composed `mark-known` event carrying `{ word }` and
   advances; clicking "Next" advances without firing `mark-known`; reaching the end of a 2-card deck
   shows "You reviewed 2 words."; the header × button fires a composed `close` event from every
   state (front, empty, done); setting a new `.deck` value always resets to card 1, unrevealed, even
   mid-session; an axe-violations check on the front-of-card state.
5. **Unit — `packages/app/test/ui/side-panel-view.test.ts` additions**: the header renders a
   `.review-btn` labelled "Review your saved words"; clicking it dispatches a composed `open-review`
   event; an axe-violations check with the new button present.
6. **e2e — new `packages/extension-chrome/e2e/b11-casual-review-flip.spec.ts`**: seed `saved:*`
   entries directly into `chrome.storage.local` (mirroring `side-panel.spec.ts`'s existing
   `seedHistory` pattern, `side-panel.spec.ts:35-40`) covering: a `learning` word saved today (in
   window), a `learning` word saved 20 days ago (out of window, must be excluded), a `known` word
   saved today (must be excluded despite being in-window). Open `side-panel.html`, click "Review",
   assert exactly the one in-window `learning` word's sentence renders on the front, "Reveal
   meaning" shows its definition/translation, "Mark known" flips `chrome.storage.local`'s
   `saved:<word>` entry to `status: 'known'` (asserted via the service-worker storage dump pattern
   `saved-word.spec.ts` already establishes) and advances to the done screen ("You reviewed 1
   word."), and the × button returns to the normal panel (Recent/focus region visible again). A
   second test seeds zero eligible saved words and asserts the empty-state copy + a working "Back to
   panel" button.

## 7. Testing performed (PR evidence — replaces screenshot/video capture)

Per this worktree's `CLAUDE.md` (owner ruling 2026-07-16): **no screenshots or video for this PR.**
The PR body's "Testing performed" section carries the evidence instead — suites run, test counts,
e2e scenarios exercised, and gates passed (lint, format check, typecheck, unit, e2e), matching §6
above exactly. No `pr-assets/*` branch is created for this card.

## 8. Risk / rollback

- **Risk: low-moderate.** The riskiest surface is shared with whichever sibling card (B10) also
  needs `saved.list` — a genuine two-writer race on `wire.ts`/`router.ts`. Task 2's grep-first,
  fully-specified-both-branches design (§2.1) is the concrete mitigation: it can never produce two
  competing `saved.list` arms, only "add it" or "verify it," decided mechanically from repo state at
  execution time. The DOM swap mechanism (§2.7) reuses a pattern (`options.ts`'s `replaceChildren`)
  already proven safe by an existing regression test (`side-panel-view.test.ts:232-237`), so its risk
  is low despite being new wiring in `side-panel.ts`.
- **No data migration.** `SavedWordEntry`/`SavedWordSense`/`SavedWordStatus` shapes are completely
  unchanged; `buildReviewDeck` and `<review-flip-view>` are pure readers of the existing ratified
  shape.
- **Rollback:** revert the single PR. If this card landed `saved.list` first, B10 (or any other
  future consumer) simply re-adds it in its own PR — the message is additive to the wire union, so
  reverting this PR does not orphan any other in-flight card's already-merged code (per the
  concurrency note in §9, no other card should have merged a dependency on this PR's `saved.list`
  arm before this PR itself is confirmed merged).

## 9. Files touched (summary)

| File                                                           | Change                                                                                                           |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `packages/app/src/domain/review-deck-policy.ts`                | **new** — `buildReviewDeck`, `REVIEW_WINDOW_DAYS`, `BuildReviewDeckOptions`                                      |
| `packages/app/src/wire.ts`                                     | + `saved.list` request + reply arms; `MessageTypeEnum` + `'saved.list'` — **only if not already present** (§2.1) |
| `packages/app/src/app/router.ts`                               | + `saved.list` case — **only if not already present** (§2.1)                                                     |
| `packages/app/src/index.ts`                                    | + `export * from './domain/review-deck-policy'`                                                                  |
| `packages/app/src/ui/review-flip-view.ts`                      | **new** — `<review-flip-view>`, `ReviewCard`                                                                     |
| `packages/app/src/ui/register.ts`                              | + `registerReviewFlip()`                                                                                         |
| `packages/app/src/ui/index.ts`                                 | + `export * from './review-flip-view'`                                                                           |
| `packages/app/src/ui/side-panel-view.ts`                       | + `.review-btn` header button, `open-review` event, CSS                                                          |
| `packages/extension-chrome/src/side-panel.html`                | + wrapping `<div id="app">`                                                                                      |
| `packages/extension-chrome/src/side-panel.ts`                  | + `registerReviewFlip()` call, `openReview()`/`ensureReviewView()`, `open-review`/`close`/`mark-known` wiring    |
| `packages/app/test/review-deck-policy.test.ts`                 | **new**                                                                                                          |
| `packages/app/test/wire-schema.test.ts`                        | + tests (§6.2) — conditional on §2.1                                                                             |
| `packages/app/test/app/router.test.ts`                         | + tests (§6.3) — conditional on §2.1                                                                             |
| `packages/app/test/ui/review-flip-view.test.ts`                | **new**                                                                                                          |
| `packages/app/test/ui/side-panel-view.test.ts`                 | + tests (§6.5)                                                                                                   |
| `packages/extension-chrome/e2e/b11-casual-review-flip.spec.ts` | **new** (§6.6)                                                                                                   |

No change to `packages/app/src/domain/saved-words-policy.ts`, `packages/app/src/domain/types.ts`,
`packages/app/src/ui/lookup-card.ts`, `packages/app/src/app/inbound.ts`,
`packages/extension-chrome/src/content.ts`, `packages/extension-chrome/src/manifest.json`,
`packages/app/src/app/history-export.ts`, or `packages/extension-chrome/src/side-panel-messages.ts`
— see §4.

## 10. Concurrency (per CONTRACTS §5)

This card touches:

- **`packages/app/src/ui/side-panel-view.ts` + `packages/extension-chrome/src/side-panel.ts`** —
  CONTRACTS' own hot-file list flags the side panel as shared with A2, B6, B10, B11; serialize this
  card against any of those three still in flight. This card's own edits are deliberately narrow and
  additive (a header button + one new event listener in `side-panel-view.ts`; new standalone
  functions + one new listener + two new consts in `side-panel.ts`) to minimize textual overlap with
  B10's concurrent additions to the same two files (B10 touches `main`'s children/CSS and the boot
  sequence; this card touches `header` and adds new top-level functions) — but both cards still land
  in the same files and must not be merged in parallel without a rebase.
- **`packages/app/src/wire.ts` + `packages/app/src/app/router.ts`** — CONTRACTS flags wire+router as
  hot for "any card adding messages." **This is the primary concurrency risk for this card**: B10's
  own already-authored design spec (`docs/superpowers/specs/2026-07-17-b10-weekly-digest-design.md`
  §2.4/§3.4-3.5) independently pins the identical `saved.list` message this card needs, with the
  identical shape. §2.1 above resolves this: whichever of B10/B11 is dispatched first adds the
  message (Task 2's grep-first check makes this mechanical, not a judgment call); the second card's
  Task 2 must skip re-adding it and instead only add its own regression test. **The orchestrator
  must not dispatch B10 and B11's Task 2 concurrently** — even though the outcome is deterministic
  either way, a true concurrent write to the same `z.discriminatedUnion([...])` array and the same
  exhaustive `switch` would still produce a git merge conflict; serialize the two cards' wire/router
  tasks specifically (the rest of each card's tasks touch disjoint files and can run in parallel).
- **`packages/extension-chrome/src/side-panel.html`** — not on CONTRACTS' pre-declared hot-file
  list; this card is (as of this authoring) the first to touch it, adding the `<div id="app">`
  wrapper. Flagged here so a future card that also needs to mount a third top-level side-panel
  screen reuses this same `#app` swap container rather than inventing a second one.
- No other in-flight card is known to touch `saved-words-policy.ts`, introduce a
  `review-deck-policy.ts`/`review-flip-view.ts`-named file, or modify `lookup-card.ts`'s `CardState`
  union for this purpose.
