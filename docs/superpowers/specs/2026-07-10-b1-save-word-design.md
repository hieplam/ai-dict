# B1 — Save word (star) (design)

> Roadmap idea **B1** (`docs/ROADMAP.md`): _Impact 5 · Effort S · Score 5.0_ · **foundation**.
> Category B (structuring learned words). Decision authority: entry schema escalation **E1 —
> ALREADY RATIFIED by the owner** (see below); all remaining choices are **Lead decides**.

## Ratified entry schema (settled law — do not redesign)

The owner ratified this exact shape via escalation E1. It is implemented **verbatim** — field
names, types, nesting — with zero variance:

```ts
{
  word:    string                   // headword; case-insensitive unique key (B14 fence, future card)
  status:  "learning" | "known"     // defaults to "learning" on save
  savedAt: number                   // timestamp of first save
  senses: [{                        // starts as a single-entry array
    definition:  string             // as shown at save time
    translation: string             // as shown at save time
    sentence:    string             // the sentence the word was selected in
    url:         string             // source page
    title:       string             // source page title
  }]
}
```

No `id` field — the (case-insensitive-normalized) `word` itself is the storage key, which is
also how B1 gets "re-saving the same word is idempotent" for free without implementing any of
B14's future dedup/merge UX.

## Problem

Today every lookup — wanted or accidental — lands in one flat `history:*` keyspace
(`packages/app/src/domain/history-policy.ts`), FIFO-capped at 500, and clearable in one shot from
Settings (which also nukes the cache). There is no way to say "this word matters, keep it
forever, independent of history." `HistoryEntry` (`packages/app/src/domain/types.ts:115`) has no
`status` field and no durability guarantee — and it doesn't carry `url`/`title` either, which is
exactly why a saved-word entry needs its **own** shape (B2's shape, ratified above), not a reuse
of `HistoryEntry`.

## Goal

A star affordance on the lookup card (and its live-mirrored counterpart in the side panel) that,
on tap, persists the current lookup into a **new, independent `saved:*` keyspace** using the
ratified entry shape — banked in one tap, no form, no folder choice, no interruption (the
roadmap's stated Payoff). Tapping again removes it (a star is conventionally a toggle; the card
text doesn't forbid this and every comparable browser affordance — bookmarks, Gmail's star — is
bidirectional).

## Non-goals (scope fence — from the roadmap card + this dispatch, settled)

- **No "Words page" / saved-list viewer.** That is B6 (`needs B1, B2`), a separate card. B1 ships
  the write path (save/unsave) and the storage; nothing renders a saved-words collection.
- **No status lifecycle UI** (learning → known toggle). That is B5. B1 only sets the default
  (`status: 'learning'`) on first save and preserves whatever status is already stored on a
  re-save (so B5, once it ships, is never silently undone by a re-save).
- **No B14 sense-merging.** Re-saving an already-saved word **replaces** its single `senses[0]`
  entry with the fresh context (last-write-wins) rather than growing a `senses[]` array. Turning
  that into an accumulating multi-sense dictionary entry is explicitly B14's job
  (`Uses the senses[] field from B2's schema`).
- **No B2 rich-context wiring beyond what's trivially available today.** `sentence`/`url`/`title`
  come from data the lookup flow already holds in memory at save time (see "Field sourcing"
  below); nothing new is captured, scraped, or requested from the page.
- **history is untouched.** New keyspace (`saved:*`), independent storage functions, independent
  clear. `historyClear`/`cacheClear` must never touch `saved:*`, and there is no `savedWords*`
  call anywhere in `history-policy.ts`'s or `cache-policy.ts`'s own clear paths.
- **No new manifest permission, no new network call.** Saving is a pure `chrome.storage.local`
  write via the existing `Storage` port — zero bytes leave the browser beyond the AI call the
  lookup itself already made.
- **Chrome first, Safari untouched.** Following the established precedent (A4's `chrome.commands`
  work touched only `packages/extension-chrome/**`; A8's core changes used **optional** fields so
  Safari's composition root needed zero changes and still typechecks). Every new field this design
  adds to a shared interface (`ResultRenderContext`, `CardState`) is optional, so
  `packages/extension-safari/**` compiles unchanged and simply doesn't offer the star yet — a
  fast-follow, not a regression, and explicitly allowed by "Lead decides" (nothing in the card
  reserves Safari parity to the owner).

## Field sourcing (a "How" judgment call, documented for the record)

The dispatch instructs: populate every ratified field from data available today; fall back to
`''` only for what genuinely needs B2's dedicated wiring — never `undefined` (keep the shape
stable). Applying that per-field:

| Field         | Source                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Available today? |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `word`        | `LookupResult.word`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Yes              |
| `status`      | Policy default `'learning'` (new) / preserved (re-save)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | N/A (computed)   |
| `savedAt`     | `Date.now()` at first save; preserved on re-save                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | N/A (computed)   |
| `definition`  | `LookupResult.markdown` — the full rendered definition, verbatim, "as shown"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Yes              |
| `sentence`    | `SelectionEvent.sentence` (the context sent with the lookup request)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Yes              |
| `url`         | `SelectionEvent.url`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Yes              |
| `title`       | `SelectionEvent.title`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Yes              |
| `translation` | **Not separately available.** The model returns ONE markdown blob combining every section the user's own **Card format** setting defines (`DEFAULT_OUTPUT_FORMAT`: "Eng->Eng" + "Eng->{target*lang}" as two of arbitrarily many \_user-editable* sections) — there is no structured field isolating "the translation" from "the definition." Reliably splitting them would mean parsing a user-customizable markdown document by (possibly renamed/reordered/removed) section headers — fragile, format-dependent, and squarely the kind of "dedicated wiring" the dispatch says to defer. Stored as `''` for B1; B2 is the natural place to either restructure the prompt to emit a structured translation or do the parsing properly. |

This is **not** a schema-shape deviation — every field name/type/nesting matches verbatim. It is
a data-population choice for one field, made under the dispatch's own explicit delegation
("Use your judgment... if something is genuinely not available without B2's work, populate it as
an empty string").

## Design

### Why the core (`packages/app`), not a shell

Persistence (the keyspace, the CRUD policy) and the star's rendering are portable behavior shared
by both extensions' UI — exactly the `ref-core-dependency-rule` reasoning A8's spec already
established. Everything lives in `packages/app/src/**` except the two **Chrome-only** composition
roots that must exist somewhere to actually call `chrome.runtime.sendMessage` (`content.ts`,
`side-panel.ts`) and the mirror adapter that already only exists for Chrome
(`chrome-side-panel-mirror.ts`, `c3-201`).

### 1. Storage: a new `saved:*` keyspace, independent CRUD module

New file `packages/app/src/domain/saved-words-policy.ts`, mirroring
`packages/app/src/domain/history-policy.ts`'s shape (same `Storage`-port-only dependency, same
index-key pattern) but keyed by **normalized word**, not a generated id:

- `saved:<normalizeWordKey(word)>` — one entry per (case-insensitively unique) headword.
- `saved:index` — a JSON array of normalized keys, mirroring `history:index` /
  `cache:index`'s "index sidecar" pattern (`ref-kv-storage-prefixes`), so a future card (B6) can
  list all saved words without an unbounded `storage.keys('saved:')` scan-and-filter-index every
  time.
- `normalizeWordKey(word) = word.trim().toLowerCase()` — this is what makes `word` "the
  case-insensitive unique key" TRUE today (not just documented for B14 to implement later); B14's
  future job is the **richer** behavior (offering to merge senses on a collision), not the
  uniqueness itself.

Public surface (full CRUD, matching `c3-112`'s documented shape for cache/history, since B1 is
tagged **foundation** and every dependent B-card reads/writes this module):

```ts
savedWordUpsert(deps, input: SavedWordInput): Promise<SavedWordEntry>
savedWordDelete(deps, word: string): Promise<void>
savedWordGet(deps, word: string): Promise<SavedWordEntry | null>
savedWordsList(deps): Promise<SavedWordEntry[]>
savedWordsClear(deps): Promise<void>
```

`savedWordUpsert` preserves `status` and `savedAt` from any existing entry with the same
normalized key (see Non-goals — B14/B5 are never silently undone by a re-save); a brand-new word
gets `status: 'learning'` and `savedAt: now()`.

### 2. Domain types (`packages/app/src/domain/types.ts`)

`SavedWordStatus`, `SavedWordSense`, `SavedWordEntry` — the ratified shape, verbatim.

### 3. Wire protocol (`packages/app/src/wire.ts`)

Two new inbound message types, `saved.save` and `saved.delete`, plus a `SavedWordEntrySchema`
(`z.strictObject`, same trust-boundary treatment as `HistoryEntrySchema`) and a new `'saved'`
reply arm carrying the persisted entry back (so a future consumer — B6, or a test — can read the
actual stored shape straight off the reply without a second round trip). `saved.delete` replies
with the existing generic `ack` arm (same as `history.delete`). An `AssertEqual` drift guard pins
`SavedWordEntrySchema` to `SavedWordEntry`, matching the existing pattern for every other domain
type.

### 4. Router (`packages/app/src/app/router.ts`)

`saved.save` / `saved.delete` handlers, going through the existing `WriteQueue` (same
serialization guarantee `history.delete`/`cache.delete` already rely on to avoid lost-update
races). No new `RouterDeps` field — both handlers only need `deps.kv`, already present.

### 5. Carrying `sentence`/`url`/`title` to the moment of the tap

The star can be tapped **after** the card has already rendered — so the save payload's
`sentence`/`url`/`title` must be captured at render time and held until the tap, not re-derived
from the (already-gone) DOM selection. The only place `SelectionEvent` (sentence/url/title) and
`LookupResult` (word/markdown) are **both** in scope simultaneously is
`runLookupWorkflow`'s `runLookup` (`packages/app/src/domain/workflow.ts`) — so `ResultRenderContext`
(`packages/app/src/ports.ts`) gains three new **optional, plain-data** fields:

```ts
sentence?: string;
url?: string;
title?: string;
```

`runLookup` now **always** builds `ctx` (previously only built when a provider picker or an idiom
override applied) so these three fields are always forwarded — the existing conditional
`providers`/`onSwitchProvider`/`onForceLiteral` fields still only appear when applicable. This
does not violate `rule-domain-purity`: workflow.ts is only forwarding data it already holds, not
calling `chrome.*` or performing any I/O itself — the actual persistence call happens entirely
outside the domain, in the Chrome composition roots (see §7).

### 6. UI — the star itself (`packages/app/src/ui/lookup-card.ts`, `c3-117`)

- One new icon token, `ICON_STAR` (outline star, `stroke="currentColor"`, matching every existing
  icon in `styles/tokens.ts`); filled vs. outline is CSS-driven off `aria-pressed`, not two SVGs.
- `CardState`'s `result` variant gains one new optional field: `saved?: boolean`.
- `renderCardState`'s `result` branch gains a new row (`renderSaveRow`), placed directly under the
  headword (before the idiom label / body) — the single most-reachable spot the "no interruption,
  one tap" Payoff calls for, and it is a plain top-level slotted sibling of `h2` (not a wrapper
  around it), so the existing `::slotted(h2)` rule is untouched — zero regression risk to the
  headword styling.
- The button dispatches a composed `CustomEvent('toggle-save', { detail: { word }, bubbles: true,
composed: true })` — no persistence payload in the event; the composition root already holds
  the full save context from `ctx` (§5) in a closure, exactly like `open-settings`/
  `open-side-panel` already work today (`content.ts:100-116`). Pure UI, no chrome.\* awareness,
  same separation every other card action already has.
- Because `renderCardState` is shared verbatim by `<side-panel-view>`'s `renderFocus()`
  (`packages/app/src/ui/side-panel-view.ts:183`), the same save row appears in the panel's focus
  region for free; `side-panel-view.ts` only needs its own CSS restatement (`.focus .save-row` /
  `.focus .save-btn`) for the same reason its other `::slotted(...)`-sourced rules are restated
  (content lives directly in the panel's own shadow tree, not projected through a `<slot>`).

### 7. Composition roots (Chrome only)

- `InlineBottomSheetRenderer` (`packages/app/src/app/inline-bottom-sheet-renderer.ts`, `c3-115`,
  portable): passes `ctx?.saved` into `CardState.saved`; gains `setSaved(saved: boolean)` (re-emits
  the last `result` state with the flag flipped — a no-op when the last state wasn't a result or
  no card is mounted), used for optimistic re-render on toggle without a second full lookup.
- `ChromeSidePanelMirror` (`packages/extension-chrome/src/adapters/chrome-side-panel-mirror.ts`,
  `c3-201`): `renderResult(r, ctx?)` now also broadcasts `sentence`/`url`/`title` (when present)
  alongside `payload`, so the side panel's own composition root can build the same save context
  independently of the in-page card. `SidePanelFocus`'s `result` arm gains the same three optional
  fields.
- `content.ts` (`packages/extension-chrome/src/content.ts`): tracks the latest save payload +an
  optimistic local `saved` boolean in closure (mirrors the existing `lastFocus` pattern); a
  `document.addEventListener('toggle-save', …)` sends `saved.save` or `saved.delete` via
  `chrome.runtime.sendMessage` depending on the current local flag, then re-renders via
  `inline.setSaved(...)`.
- `side-panel.ts` (`packages/extension-chrome/src/side-panel.ts`): the same pattern, independently
  — the panel is a trusted extension page and already calls `chrome.runtime.sendMessage` directly
  for `history.delete`/`settings.get`; `saved.save`/`saved.delete` follow the identical style.
  Re-opened "Recent" entries (`HistoryEntry`, which has no `url`/`title` — that gap is exactly why
  B2 exists) save with `sentence: entry.context, url: '', title: ''` — consistent with the
  "populate what's available, empty string for what needs B2" rule stated above.

### Toggle semantics (a "How" decision)

The star is a **local, optimistic toggle within one render session** — it does not round-trip a
"is this word already saved?" query before first paint. A fresh lookup always starts unstarred;
tapping saves and flips the button to "Saved"; tapping again deletes and flips it back. Re-looking
up an already-saved word later in a new render still starts unstarred (a minor, deliberately
accepted rough edge — the button's local state doesn't reflect prior sessions), but tapping it
still correctly (idempotently) upserts, and a _second_ tap in that same session now correctly
un-saves (state is tracked from that point on). This keeps B1 to exactly two new wire messages
(`saved.save`, `saved.delete`) instead of three (adding `saved.get`), and is squarely within
"Lead decides" — nothing in the card requires reflecting cross-session saved state, and the
natural place to solve that properly is B6 (the Words page), which needs a full list view anyway.

## Testing strategy

- **Domain (`saved-words-policy.ts`):** unit tests mirroring `history-policy.test.ts` — upsert
  creates/updates, preserves `status`/`savedAt` across re-save, replaces `senses` on re-save,
  case-insensitive key collision (`Bank` then `bank` hit the same entry), delete removes value +
  index entry (idempotent on unknown word), list returns all, clear removes everything under
  `saved:*` and nothing under `history:*`/`cache:*`.
- **Wire (`wire-schema.test.ts`):** valid `saved.save`/`saved.delete` parse; a `senses[]` element
  with an extra key is rejected (strict object); snapshot regenerated.
- **Router (`router.test.ts`):** `saved.save` persists + returns the entry; a second `saved.save`
  for the same word (different casing) preserves `savedAt`/`status`, replaces `senses`; `saved.delete`
  removes it and is idempotent on an unknown word; `history.clear`/`cache.clear` never touch
  `saved:*` (regression guard for the scope fence).
- **Workflow (`workflow.test.ts`):** `ctx` is now always defined on a result (carries
  `sentence`/`url`/`title`); the two existing "ctx===undefined" regression-guard tests are updated
  to assert ctx is defined but `providers`/`onSwitchProvider`/`onForceLiteral` are absent.
- **UI (`lookup-card.test.ts`):** unsaved star renders `aria-pressed="false"` + "Save" label; saved
  star renders `aria-pressed="true"` + "Saved" label; click dispatches composed `toggle-save` with
  `detail.word`; axe has zero violations with the row present.
- **`InlineBottomSheetRenderer` / `ChromeSidePanelMirror` unit tests:** `ctx.saved` threads into
  `CardState`; `setSaved()` re-renders the last result with the flag flipped and no-ops otherwise;
  the mirror broadcasts `sentence`/`url`/`title` when present in `ctx`, omits them when absent.
- **e2e (`packages/extension-chrome/e2e/saved-word.spec.ts`, new):** tapping the star on a fresh
  in-page lookup persists a `saved:<word>` key in `chrome.storage.local` matching the ratified
  shape exactly (asserted field-by-field, including `translation: ''`); tapping again removes it;
  the same flow from the side panel; `saved:*` survives a `history.clear`.
- **e2e evidence (`b1-evidence.spec.ts`, new, gated like `a8-evidence.spec.ts` — not run in CI):**
  records a short video of select → Define → tap the star → "Saved" confirmation, satisfying the
  "One tap while reading = word banked, no interruption" Payoff visually.

## Evidence plan

Video (per dispatch guidance — a new interactive save/unsave flow, not a static visual tweak).
Captured via the Chrome Playwright e2e harness (`bun run build:chrome` then a `PLAYWRIGHT_RUN_EVIDENCE=1`
gated spec, mirroring `a8-evidence.spec.ts`'s exact recording mechanism): BEFORE from a `master`
build (no star exists — the card renders exactly as it does today), AFTER from the branch build
(star appears, tap → "Saved", tap again → "Save"). Hosted on a throwaway `pr-assets/b1-save-word`
branch, embedded via same-origin `https://github.com/hieplam/ai-dict/raw/pr-assets/b1-save-word/<file>`
URLs only.

## Risk / rollback

Purely additive: a new keyspace, new optional interface fields, two new wire message types, and
one new UI row. Nothing existing is removed or restructured. Rollback is a plain revert — no data
migration risk, because no existing stored shape changes and the new `saved:*` keyspace has no
dependents yet (B2 onward are separate, unshipped cards). The one genuinely hard-to-reverse
decision — the entry shape itself — is not this PR's call; it was ratified before this card was
dispatched.
