# B7 — Repeat-offender nudge (design)

> Roadmap idea **B7** (`docs/ROADMAP.md`): _Impact 4 · Effort S · Score 4.0_. Category B
> (structuring learned words). Decision authority: **Lead decides** threshold copy (3×/30d is
> the proposed default) and every implementation choice below. **Escalate: none.** Depends on
> **B1** (shipped, PR #99 — the star/save UI + `saved-words-policy.ts`).

## Problem

Today the extension has a goldfish memory for _patterns_, even though it remembers individual
lookups. A reader can look up "ubiquitous" five times across a month — each one silently logged
to `history:*` (`packages/app/src/domain/history-policy.ts`) — and nothing on the card ever
says "you keep coming back to this word." The signal that a word isn't sticking (repeat lookups)
is the single most honest evidence of "I keep failing to retain this," and today it's thrown
away the instant the FIFO history log scrolls past it.

B1 already shipped the mechanism for turning "this matters" into a permanent record — the star
button, `saved-words-policy.ts`, the `saved:*` keyspace. What's missing is the **prompt**: notice
the pattern for the reader and hand them the star, right when the evidence is freshest.

## Goal

On the **3rd lookup of the same headword within a rolling 30-day window**, the lookup card shows
a one-line nudge banner: **"3rd time meeting this word — save it?"** with a **Save** action
(reusing B1's exact save path) and a dismiss control. The nudge fires **once per word, ever** —
whether the reader saves, dismisses, or simply ignores it, it never shows again for that
headword.

## Grounding (current behavior, file:line)

- **History already has everything needed to count.** `historyAppend` (`packages/app/src/domain/
history-policy.ts:21`) writes one `HistoryEntry { id, word, context, result, createdAt }` per
  successful lookup (cap 500, FIFO), keyed by a newest-first id index at `history:index`
  (`history-policy.ts:4`). `createdAt` is `result.fetchedAt` — a real wall-clock timestamp
  (`router.ts:128`). **No new tracking keyspace is needed to count "how many times was this
  headword looked up in the last 30 days"** — `word` + `createdAt` on every stored entry answers
  it directly. This satisfies the card's scope fence ("uses existing history counts") without
  investigation turning up a gap.
- **One known pre-existing quirk, not something B7 fixes:** `handleLookup` (`router.ts:88`)
  returns early on a **cache hit** (`router.ts:105-109`) _before_ `historyAppend` ever runs — an
  identical word+sentence+target lookup that hits the LRU cache is never logged to history. In
  practice this only suppresses the count when the reader re-triggers the _exact same_ selection
  (same sentence) a second time; encountering the word in a **different** sentence (the normal
  "met this word again in a different article" case the card describes) always misses the cache
  (different cache key) and always appends to history. B7 rides on top of this existing
  behavior rather than changing it — a genuinely new tracking layer would be needed to fix it,
  which the card's scope fence explicitly tells us to avoid unless existing data "genuinely
  can't answer" the question; it can, for the common case, so this is accepted as-is.
- **B1's save mechanism (reused verbatim, not re-built).** The star button
  (`packages/app/src/ui/lookup-card.ts:299` `renderSaveRow`) dispatches a composed
  `toggle-save` CustomEvent carrying only `{ word }` (bubbles + composed, crosses the MV3
  world boundary). `content.ts:136` and `side-panel.ts:150` each listen for `toggle-save` on
  their own composition root, look up a locally-tracked `lastSavePayload` (word, definition,
  translation, sentence, url, title — captured from the `LookupResult` + `ResultRenderContext`
  at render time), and send `saved.save` / `saved.delete` to the router, which calls
  `savedWordUpsert`/`savedWordDelete` (`saved-words-policy.ts`). **B7's nudge "Save" button
  dispatches this exact same `toggle-save` event with the exact same `{ word }` detail** — it is
  a second trigger for the identical flow, not a parallel save path.
- **`LookupResult` already carries transient, non-persisted annotations.** `fallbackFrom`
  (`domain/types.ts:56`) is stamped on a live result, flows over the wire
  (`wire.ts:51 LookupResultSchema`), reaches the card/panel, but is explicitly stripped before
  the cache/history write (`router.ts:118-119`, `const { fallbackFrom: _f, ...storableResult }
= result`). B7's `nudge` flag follows this exact precedent.
- **`CardState`/`renderCardState` is the single shared rendering surface**
  (`packages/app/src/ui/lookup-card.ts:218`) consumed by both the in-page card
  (`InlineBottomSheetRenderer`, `packages/app/src/app/inline-bottom-sheet-renderer.ts`) and the
  side panel (`packages/app/src/ui/side-panel-view.ts`, `PanelFocusState = CardState |
{ kind: 'empty' }`). Adding one optional field to `CardState`'s `'result'` variant renders it
  identically on both surfaces for free — the same mechanism A8's `definedAs` and B1's `saved`
  already used.
- **Chrome-only wiring precedent, already established by B1.** Safari's `content.ts`
  (`packages/extension-safari/src/content.ts`) never registered a `toggle-save` listener — the
  star button renders there (shared UI) but tapping it is inert. B7 inherits this exact same gap
  for the nudge's Save button (also inert on Safari, also a fast-follow not a regression) —
  consistent with B1's own documented scope fence, not a new limitation B7 introduces.

## Design decisions (How, all within Lead authority — Escalate: none on the card)

### D1 — Threshold & window are fixed constants, not configurable

`NUDGE_THRESHOLD = 3`, `NUDGE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000` (30 days). No settings-page
toggle — the card proposes 3×/30d as the default and nothing in the roadmap asks for it to be
user-configurable. Revisiting this is a future card, not this one.

### D2 — "One nudge per word, ever" is enforced by marking at the moment of computation, not at dismissal

Two readings of "dismiss = never nag for that word again" (Payoff) vs. "one nudge per word,
ever" (scope fence) are possible: (a) suppress only once the reader explicitly dismisses/saves,
or (b) suppress unconditionally the instant the nudge is shown, regardless of what the reader
does next. **Decision: (b).** The scope fence's wording is unconditional ("ever"), and (a) risks
re-showing the nudge on every subsequent lookup of an ignored word — the opposite of "not
building a recurring nagging system," which is exactly what the scope fence is guarding against.
Concretely: the moment the router computes "this lookup's count crossed the threshold and the
word has never been nudged," it **synchronously persists a `nudge:<word>` marker** before
replying — the reply carries `nudge: true` for this one lookup, and every future lookup of the
same word (regardless of save/dismiss/ignore) evaluates `nudge: false` from then on, forever.

**Consequence:** the reader's Save/Dismiss taps on the banner need **no round-trip wire message
of their own** — permanence is already guaranteed before the card ever renders. Save reuses
`toggle-save` (already wired, see above). Dismiss is a **pure client-side DOM/state action** on
the currently-rendered card only (remove the banner from _this_ view) — there is nothing left
for a "dismiss" message to tell the backend that it doesn't already know. This keeps the change
small: no new `WireMessage` type at all.

**Accepted trade-off:** if the `lookup` wire reply is lost in transit (e.g. the tab closes mid-
flight) after the marker was written, that one nudge opportunity is silently spent. This is a
soft UX nudge, not a correctness-critical feature — acceptable and documented, not a defect.

### D3 — Counting reads only the within-window slice of history, not the full cap-500 log

`historyList` (existing) has no cursor for "give me only entries newer than X," so a naive
"read everything, filter, count" would do up to 500 sequential `chrome.storage.local.get` calls
on **every single lookup** (the Chrome `Storage` adapter's `getItem` is one native call per key —
`packages/extension-chrome/src/adapters/chrome-kv-store.ts:17`). History's index is
insertion-ordered newest-first and `createdAt` only decreases as you walk it (each append
prepends), so a new `historyListSince(deps, sinceMs)` helper added to `history-policy.ts` walks
from the newest entry and **stops at the first entry older than the cutoff** — it reads only
"how many history entries exist in the last 30 days," not the full log. Worst case (a reader who
made 500+ lookups inside one 30-day window) degrades to the old behavior; the common case is
cheap.

### D4 — `nudge` lives on `LookupResult`, not on `ResultRenderContext`

Unlike `saved` (which needed `ResultRenderContext` because a star's checked state isn't
knowable from the result alone), `nudge` **is** a pure function of the result's word — so it is
computed by the router and stamped directly onto the reply's `LookupResult`, exactly like
`fallbackFrom`/`definedAs`/`translation`. This means it needs **zero extra threading**: every
consumer that already forwards `LookupResult` end-to-end (`MessageRelayLookupClient` →
`domain/workflow.ts` → `ResultRenderer.renderResult(r, ctx)` → `InlineBottomSheetRenderer` /
`ChromeSidePanelMirror` → side panel's `resultToFocus`) picks it up automatically. It also means
a _stored_ `HistoryEntry.result` never carries `nudge` (never persisted, exactly like
`fallbackFrom`), so re-opening a word from "Recent" never re-shows a stale nudge.

### D5 — New keyspace `nudge:<word>`, independent of `saved:*`/`history:*`/`cache:*`

One key per word (case-insensitive, reusing `saved-words-policy.ts`'s existing
`normalizeWordKey` — not a second normalization function), value is a plain marker (`'1'`); no
index needed (nudge markers are never listed/paginated, only point-checked). Never touched by
`historyClear`/`cacheClear`/`savedWordsClear` and does not touch `SavedWordEntry`/
`SavedWordSense`/`SavedWordStatus` (E1's ratified schema stays untouched, confirmed by omission —
no file under this plan touches `saved-words-policy.ts`'s type shapes, only its exported
`normalizeWordKey` helper via import).

### D6 — Nudge copy

Card's proposed copy is used near-verbatim: **"3rd time meeting this word — save it?"** — the
Save button reads **"Save"**, the dismiss control is an icon-only "×" (reusing `ICON_CLOSE`,
already imported in `lookup-card.ts`) with `aria-label="Dismiss nudge"`.

## Non-goals (scope fence)

- **No settings-page control for the threshold/window.** Fixed constants (D1).
- **No new `WireMessage`/`WireReply` type.** Save reuses `toggle-save` → `saved.save`
  (unchanged); Dismiss needs no wire round-trip (D2).
- **No touch to `SavedWordEntry`/`SavedWordSense`/`SavedWordStatus`** (E1's ratified shape) —
  confirmed untouched by this plan.
- **No new manifest permission, no new network call, nothing new leaves the browser.** The nudge
  is computed from data already local (`history:*`) and persists one small local marker
  (`nudge:*`) via the existing `Storage` port.
- **No fix to the cache-hit-skips-history quirk** (Grounding, above) — out of scope; existing
  behavior, accepted.
- **Chrome first, Safari inert-but-harmless** — same precedent B1 set. `CardState`/wire fields
  are optional so `packages/extension-safari/**` typechecks unchanged; the nudge banner renders
  there (shared UI) but its Save tap is a no-op (no listener), matching the star button's current
  Safari behavior exactly.
- **No B6 "Words page" work, no B5 status lifecycle, no B8 export** — unrelated cards.

## Testing strategy

- **Domain (`packages/app/test/`, Vitest + `fakeStorage()`):**
  - `history-policy.test.ts`: new tests for `historyListSince` — returns only entries with
    `createdAt >= sinceMs`, newest-first; stops scanning at the first stale entry (asserted via
    a call-counting `Storage` wrapper); empty history returns `[]`.
  - `nudge-policy.test.ts` (new file): `evaluateNudge` returns `false` below threshold; `true`
    exactly when the within-window count first reaches 3; `false` on every subsequent call for
    the same word (marker persists, even though the count keeps growing); entries outside the
    30-day window are excluded from the count; case-insensitive word matching (`Bank`/`bank`
    collide, reusing `normalizeWordKey`); `nudgeAlreadyShown`/`nudgeMarkShown` round-trip.
- **Wire (`packages/app/test/wire-schema.test.ts` or adjacent):** `LookupResultSchema` accepts
  `nudge: true` / omits it cleanly; the compile-time `AssertEqual` guard forces `LookupResult`
  and the schema to stay in sync.
- **Router (`packages/app/test/app/router.test.ts`):** 3rd lookup of the same word within the
  window replies `result.nudge === true`; 1st/2nd don't; 4th+ doesn't (already marked); the
  persisted `history:<id>` entry never carries a `nudge` key (mirrors the existing `fallbackFrom`
  regression test at `router.test.ts:120`); a cache-hit reply can also carry `nudge: true` when
  the pre-existing history count already met the threshold.
- **UI (`packages/app/test/ui/lookup-card.test.ts` or adjacent, happy-dom):**
  `renderCardState` with `nudge: true` renders the banner with the exact copy, a Save button
  that dispatches `toggle-save` with `{ word }`, and a dismiss button that dispatches
  `dismiss-nudge`; `nudge` absent/false renders no banner; axe-core has no new violations.
- **`inline-bottom-sheet-renderer.test.ts`:** `renderResult` with `r.nudge === true` sets
  `CardState.nudge = true`; `setSaved` clears `nudge`; a new `dismissNudge()` method clears
  `nudge` without touching `saved`.
- **e2e functional (`packages/extension-chrome/e2e/b7-repeat-nudge.spec.ts`, Playwright):** three
  distinct lookups of "bank" (via `gotoFixture` + `selectWord` + `openTrigger`, `cacheEnabled:
false` so each lookup is a fresh history append) show the nudge only on the 3rd; tapping the
  nudge's Save button persists `saved:bank` (same assertion shape as `saved-word.spec.ts`);
  reloading and looking the word up again never re-shows the nudge (marker persisted); dismissing
  without saving also permanently suppresses it.
- **e2e evidence (`packages/extension-chrome/e2e/b7-evidence.spec.ts`):** recorded video, gated
  behind `PLAYWRIGHT_RUN_EVIDENCE=1` exactly like `b1-evidence.spec.ts` — three lookups of the
  same word, the nudge banner appearing on the 3rd, tapping Save, the star flipping to "Saved."

## Evidence plan

Short **video** (this is a new visible interaction — banner appearing + tap-to-save — not a
static visual tweak), captured through the Playwright e2e harness exactly like B1's
`b1-evidence.spec.ts`:

- **BEFORE**: `master` build (`df3129c`) — three lookups of the same word, no nudge ever
  appears (B7 doesn't exist yet).
- **AFTER**: branch build — three lookups of the same word; the nudge banner appears on the 3rd
  with the exact copy; tap Save; banner clears and the star shows "Saved."
- Hosted on a throwaway `pr-assets/b7-repeat-offender-nudge` branch, embedded in the PR via
  same-origin `https://github.com/hieplam/ai-dict/raw/pr-assets/b7-repeat-offender-nudge/<file>`
  URLs only (never `raw.githubusercontent.com`).

## Risk / rollback

- **Risk:** the "mark at compute time, not at dismiss time" design (D2) means a lost wire reply
  silently spends the one nudge for that word. Accepted (soft UX feature, documented above).
- **Risk:** `historyListSince`'s early-exit assumes history entries are strictly newest-first by
  `createdAt` (true today — `historyAppend` always prepends the newest id, `history-policy.ts:24`
  — but would silently under-count if a future change ever re-orders the index). Mitigated by an
  explicit unit test asserting the ordering assumption via a call-counting storage wrapper, so a
  future regression fails loudly in `history-policy.test.ts` rather than silently under-counting.
- **Rollback:** every change is additive (new file, new optional fields, one new domain module);
  reverting the PR is a clean single-commit revert with no data migration (the `nudge:*` keyspace
  is inert if unread, and no existing schema is touched).

## Open questions

None — the card explicitly delegates threshold copy and all "How" decisions to the Lead, and no
change here requires a new manifest permission, changes what leaves the browser, or touches the
ratified E1 schema.
