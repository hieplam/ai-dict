# A9 — Instant cache hits

Roadmap card: `docs/ROADMAP.md` §4 A9 (Impact 3 · Effort S · Score 3.0). Depends on: — (none).
Sequenced in the "Run the roadmap" (2026-07-16) campaign among the S-effort A-cards (A6, A9,
A10, A15) — no ordering dependency on any of them.

## 1. Problem (grounded in code)

The roadmap card's stated gap: _"A cache toggle exists, but a repeat lookup still feels fresh —
same wait pattern, and nothing tells you the answer came from cache. Missing: a hard repeat-speed
guarantee (< 100 ms) + a visible 'cached' badge; the cache key must include the sense/context,
not just the word."_

Reading the actual pipeline (`c3-112 persistence-policies`, read first per the card's scope
fence) shows the engine is **already** doing the hard part; only the reader-facing signal is
missing:

- **The cache key already includes the sentence, not just the word.**
  `deriveCacheKey` (`packages/app/src/domain/cache-policy.ts:15-18`) hashes
  `` `${word.trim().toLowerCase()}|${context.trim()}|${target}` ``. `context` here is not a
  free-floating field — `runLookupWorkflow` builds every `LookupRequest` with
  `context: e.sentence` (`packages/app/src/domain/workflow.ts:67`, the full sentence the word was
  selected in), and the router re-derives the identical `keyReq = { word: req.word, context:
req.context, target: req.target }` before every cache read/write
  (`packages/app/src/app/router.ts:108`, used at `:115` for `cacheGet` and `:139` for `cachePut`).
  So the "bank" (river) vs. "bank" (money) collision the card worries about **cannot happen
  today**: two different sentences hash to two different keys. There is no sense/context gap to
  close — the roadmap card's premise about the current key is out of date.
- **A cache hit already makes zero network calls.** `handleLookup`
  (`packages/app/src/app/router.ts:97-124`) reads `cacheGet` _before_ ever touching
  `deps.client.lookup(...)`; on a hit it returns immediately
  (`packages/app/src/app/router.ts:115-124`) — the HTTP-calling branch
  (`packages/app/src/app/router.ts:133`, `deps.client.lookup(...)`) is never reached. "Zero tokens on hit" is already
  true, not a gap to build.
- **`fromCache` is already a required, always-populated field.** `LookupResult.fromCache: boolean`
  (`packages/app/src/domain/types.ts:47`) and the matching wire field `fromCache: z.boolean()`
  (`packages/app/src/wire.ts:48`, in `LookupResultSchema`) are non-optional; `cacheGet` stamps
  `fromCache: true` on every hit (`packages/app/src/domain/cache-policy.ts:55`) and `cachePut`
  stamps `fromCache: false` on every write (`packages/app/src/domain/cache-policy.ts:66`). The
  signal already crosses the wire on **every** reply.
- **…and then nothing reads it.** `grep -rn fromCache packages/app/src/ui packages/app/src/app
packages/extension-chrome/src` (repo search) turns up only the type/schema declarations above —
  `InlineBottomSheetRenderer.renderResult` (`packages/app/src/app/inline-bottom-sheet-renderer.ts:88-105`)
  and `side-panel.ts`'s `resultToFocus` (`packages/extension-chrome/src/side-panel.ts:114-128`)
  both thread `provider`, `fallbackFrom`, `definedAs`/`nudge` from `LookupResult` into `CardState`,
  but never `fromCache`. `CardState` itself (`packages/app/src/ui/lookup-card.ts:30-54`) has no
  `fromCache` field, so `renderMetaRow` (`packages/app/src/ui/lookup-card.ts:431-503`) has nothing
  to render even if it wanted to.

**What A9 actually is, given the above:** a UI-threading card, not a caching-engine card. The
entire "hard repeat-speed guarantee" is already structurally true (no network I/O on a hit); the
work is (a) surfacing that fact as a badge, (b) writing down the guarantee precisely enough that a
regression is testable, and (c) leaving a documentation trail so a future reader doesn't re-raise
the sense/collision question this spec just closed.

## 2. Design questions (the card's "Lead decides" list), pinned

### 2.1 Cache key composition — **pinned: unchanged, exactly as it is today**

The key stays `` `${word.trim().toLowerCase()}|${context.trim()}|${target}` `` hashed by
`fnv1a64Hex` (`cache-policy.ts:4-18`), where `context` is the full sentence
(`workflow.ts:67`). No new field, no re-normalization.

**Rationale:** per §1, this key already disambiguates by sentence — the collision the card
describes ("bank" river vs. money) requires two _different_ sentences, which already hash
differently. There is nothing left to fix.

**Rejected alternative — a dedicated "sense" field or a re-normalized context string.** Two
reasons: (1) it would be pure rework of an already-correct mechanism, which the card's own scope
fence forbids ("Delta on the existing cache … don't rebuild it"); (2) changing the hash inputs
changes every cache key's hash _value_, which — unlike the "acceptable, it's just a cache" miss
the roadmap card anticipated — is not needed here at all, so taking on that churn for zero
behavioral gain is strictly worse than leaving the key alone.

**Migration:** **none.** The roadmap card assumed a key-shape change and wrote off the fallout as
"old cache entries with old keys simply miss (acceptable — it's a cache)." Because the key is not
changing, that fallout never happens — every entry a reader already has cached stays a hit after
this card ships.

### 2.2 The < 100 ms guarantee — mechanism and how it's enforced

**Pinned mechanism:** the guarantee is structural, not a new fast-path to build. A cache hit
already takes exactly one `chrome.runtime` message round trip (content script → service worker)
plus the cache-hit branch's local reads — **zero network fetch**, because `handleLookup` returns
before reaching `deps.client.lookup(...)` (§1). That branch is not just a single `cacheGet`: the
full hit path (`packages/app/src/app/router.ts:115-126`) is `cacheGet` (one
`chrome.storage.local` read) followed by an unconditional `evaluateNudge` call
(`packages/app/src/domain/nudge-policy.ts:39-48`), which itself does one `nudgeAlreadyShown` read
(`nudge-policy.ts:20-23`, `chrome.storage.local.get('nudge:<word>')`) and — only while the word
has not yet crossed the repeat-offender threshold — a `historyListSince`
(`packages/app/src/domain/history-policy.ts:58-72`) that does one additional `getItem` per
within-30-day history entry it walks (bounded by that window's entry count, not by the cap-500
total history size, and it short-circuits at the first entry older than the window per its own
doc comment). So the accurate claim is: **the hit path is a cache read plus a bounded number of
additional local reads for nudge evaluation, proportional to how much history the reader has
accumulated in the last 30 days — never a network fetch.** All of that I/O is local
`chrome.storage.local` reads, so even on a reader with a busy recent history the path stays far
below any network round trip; the hard, code-enforced guarantee this card tests is **zero network
calls on a hit**, not a specific read count, and that guarantee is unaffected by nudge evaluation
because nudge-policy.ts never touches the network either. This card changes no logic on that path
(§4 has no edits to `cache-policy.ts` behavior, `nudge-policy.ts`, `history-policy.ts`,
`router.ts`, or `workflow.ts`).

**Pinned enforcement (what actually gets asserted in CI):** two checks, not one, because a
wall-clock assertion alone is either too loose to mean anything or flaky:

1. **Hard gate — zero network calls on a hit.** The e2e test mocks the provider endpoint and
   asserts the mock's call counter does **not** increase between the first (miss) and second
   (hit) lookup of the same word+sentence. This is the actual thing that would blow the budget
   (a network round trip, not a local read), so it is asserted as a strict equality, not a
   timing window.
2. **Soft tripwire — wall-clock, generous margin, explicitly not a latency proof.** The e2e test
   also records `Date.now()` immediately before the repeat click and the moment the card's
   `.cache-badge` becomes visible, and asserts the delta is under **500 ms**. This is _not_ the
   product's real-world number — Playwright/CDP message round trips and headless CI scheduling
   add overhead unrelated to the extension's own code path — it exists only to catch a gross
   regression (e.g. someone accidentally re-adding a network call, or an accidental `await`
   chain that serializes work that used to be parallel). The comment in the test says exactly
   this, so a future reader doesn't mistake 500 ms for the product target.

**Rejected alternative — asserting the literal ≤ 100 ms figure as a hard CI gate.** Headless
Chromium scheduling and CI-machine jitter routinely add tens of milliseconds unrelated to the
code under test (the same class of flake the roadmap identifies for A15's own latency budget);
a tight ms-level hard gate would fail intermittently for reasons that have nothing to do with a
real regression. The zero-network-calls assertion in (1) is the one that actually protects the
guarantee; (2) is a coarse sanity net on top of it.

### 2.3 "Cached" badge — copy, placement, and why

**Pinned copy:** the plain text **`Cached`** (no icon, no emoji). **Rationale:** the card's only
existing badge, `.prov-badge` (`lookup-card.ts:440-443`, e.g. "Gemini"/"ChatGPT"/"Claude"), is
plain text with no icon — matching that convention keeps the meta-row visually consistent, and
the icon set in `styles/tokens.ts` (`ICON_CLOSE`, `ICON_SHIELD`, `ICON_SETTINGS`,
`ICON_SIDE_PANEL`, `ICON_STAR`) has no cache/lightning glyph, so introducing one would be a new
asset for an Effort-S card. A `title` attribute carries the fuller explanation
(`"Served from your local cache — no tokens used"`) for a discoverable tooltip without adding
visible copy.

**Pinned placement:** inside the existing `.meta-row` (`lookup-card.ts:431-503`,
`renderMetaRow`) — the same row the provider badge already lives in — as the **first** (leftmost)
child, before the provider badge. Because `renderCardState` (`lookup-card.ts:240-288`) is the one
function both the in-page card (via `InlineBottomSheetRenderer`) and the side panel (via
`side-panel-view.ts`'s `PanelFocusState = CardState`) build their DOM from, adding the badge here
means it shows up in both surfaces for free, with no separate side-panel-specific rendering code.

**Rejected alternative — a dedicated banner row (like B7's `.nudge-row`).** The nudge banner is
_actionable_ (it invites a save); the cache badge is a passive, non-interactive fact about where
the answer came from. Giving it the same visual weight as an actionable banner would overstate
its importance and clutter the card for the overwhelmingly common (already-fast) case. The
lightweight, no-action `.prov-badge` pattern is the right-sized precedent.

**Ordering rationale:** the badge leads because it is the card's own stated payoff — _"you can
see it was free"_ — so it is the first thing a repeat-lookup reader's eye should land on, ahead
of which provider would have answered.

### 2.4 Zero tokens on hit — pinned: already true, no change

Per §1, `handleLookup`'s cache-hit branch never calls `deps.client.lookup(...)`, so zero tokens
are spent. No code changes this fact; the card documents it explicitly (§4, §6) and the e2e test
in §2.2(1) proves it mechanically.

### 2.5 Cache invalidation — pinned: unchanged

`cacheClear`/`cacheDelete` (`packages/app/src/domain/cache-policy.ts:77-89`) and their callers
(`cache.clear` wire handler, `history.delete`'s `cacheDelete` call) are untouched. This card adds
no new invalidation trigger and removes none.

## 3. The change

### 3.1 `packages/app/src/domain/cache-policy.ts` — clarifying comment only, no behavior change

Add a doc comment above `deriveCacheKey` (currently `cache-policy.ts:15`) recording, for future
readers, that the sentence-context disambiguation question was explicitly considered and closed
by A9 — so nobody re-opens "does the cache key need a sense field" again without reading this
first. No line of executable code changes; `packages/app/test/cache-policy.test.ts` passes
unmodified (verified by running it, not by inspection, in Task 1's gate).

### 3.2 `packages/app/src/ui/lookup-card.ts` — `CardState` + `renderMetaRow` gain `fromCache`

- `CardState`'s `'result'` variant (`lookup-card.ts:32-54`) gains one new optional field:
  `fromCache?: boolean`. Optional (not required) to match every other metadata field on this
  variant (`provider?`, `fallbackFrom?`, `nudge?`, …) and so the many existing test literals that
  build a bare `{ kind: 'result', word, target, safeHtml }` continue to compile unchanged.
- `renderMetaRow`'s parameter type (`lookup-card.ts:431-435`) gains the same `fromCache?: boolean`
  field.
- `renderMetaRow`'s guard (`lookup-card.ts:436`, currently `if (!state.provider) return null;`)
  becomes `if (!state.provider && state.fromCache !== true) return null;` — the row is now shown
  when _either_ signal is present, not only when a provider is known.
- Inside the row, a new `.cache-badge` span (textContent `'Cached'`, `title` = `'Served from your
local cache — no tokens used'`) is appended **first**, gated on `state.fromCache === true`.
  The existing provider badge / fallback-note / provider-switcher logic
  (`lookup-card.ts:440-500`) is otherwise unchanged in content and order, just re-nested one level
  under `if (state.provider)` so it never runs against an `undefined` provider (the only case that
  can now reach this function without one: a cache hit with no provider recorded — see the
  existing "entries cached before this feature" precedent at `lookup-card.ts:426`, same class of
  legacy-data tolerance already documented for the provider badge itself).
- `CARD_DOC_CSS` (`lookup-card.ts:145-180`) gains one rule, `lookup-card .cache-badge{…}`, styled
  with the `--ad-accent`/`--ad-accent-soft`/`--ad-accent-ink` tokens already used elsewhere on this
  card (e.g. the save button's pressed state, `lookup-card.ts:165`
  `.save-btn[aria-pressed="true"]{border-color:var(--ad-accent);color:var(--ad-accent-ink)}`)
  so the badge reads as a positive, distinct accent rather than the neutral `--ad-line`/
  `--ad-ink-soft` outline the provider badge uses — visually saying "this one was free."

### 3.3 `packages/app/src/app/inline-bottom-sheet-renderer.ts` — thread `fromCache`

`renderResult` (`inline-bottom-sheet-renderer.ts:88-105`) gains one line in the object literal it
passes to `this.setState`: `fromCache: r.fromCache` — unconditional (not a conditional spread),
because `LookupResult.fromCache` is a required boolean (never `undefined`), matching how `word`/
`target` are already threaded unconditionally on the same lines, rather than the `? {...} : {}`
pattern used for the genuinely optional fields (`provider`, `definedAs`).

### 3.4 `packages/extension-chrome/src/side-panel.ts` — thread `fromCache`

`resultToFocus` (`side-panel.ts:114-128`) gains the same unconditional line,
`fromCache: r.fromCache`, in its returned object — same rationale as §3.3. This is a composition
root with no dedicated unit-test file today (same precedent as `options.ts` in the C2 plan);
correctness is proven by the e2e scenario in §6.3.

### 3.5 No change to `packages/app/src/wire.ts` or `packages/app/src/app/router.ts`

`fromCache` is already a required field on both `LookupResultSchema` (`wire.ts:48`) and the
router's replies (every `RouterReply` of `type: 'lookup'` carries a full `LookupResult`, already
including `fromCache` from `cacheGet`/the HTTP client). Nothing here needs a schema or router
edit — the signal already crosses the wire on every lookup reply, cache hit or not.

### 3.6 No change to `packages/app/src/domain/workflow.ts`

The loading→result transition (`workflow.ts:64-104`) is unchanged: `renderLoading` still fires
before every lookup, cache hit or not. **Rejected alternative — skip the loading state for a
predicted cache hit.** The content script cannot know in advance whether a lookup will hit the
cache (that determination happens inside the router, after the round trip starts) — a "peek"
mechanism to predict a hit before making the request would add a second code path and its own
race conditions for an Effort-S card whose actual fix is speed, not branching. Given §2.2's ≤100 ms
structural guarantee, the loading flash is imperceptibly brief on a hit and does not need a special
case.

### 3.7 No change to `packages/app/src/ui/settings-form.ts`

The cache toggle (`#cache` checkbox) and "Clear cache" button (`settings-form.ts:204,208`)
already exist and already fully gate/clear the caching behavior this card surfaces; A9 adds no
new setting, no new copy, and no new control here. (CONTRACTS §5's hot-file catalog lists
`settings-form.ts` as shared by "A5 A9 A13 B6 C9" — this spec corrects that for A9 specifically:
A9 does not touch this file. See §9 Concurrency.)

## 4. Scope fence (from the card, held exactly)

- **Delta on the existing cache — no rebuild.** §3 touches zero lines of `cache-policy.ts`
  behavior (only a comment) and zero lines of `router.ts`/`wire.ts`. `c3-112
persistence-policies` was read first (§1) precisely to confirm this.
- **No new manifest permission, no new settings, no new wire message.**
- **UI reads only `--ad-*`/`--adp-*` tokens** — the new `.cache-badge` rule uses
  `--ad-accent`/`--ad-accent-soft`/`--ad-accent-ink`/`--adp-radius-control`, all existing tokens;
  no hard-coded color.
- **S4 (sanitize model output)** — not engaged by this card. The badge's text is a static literal
  (`'Cached'`), never model output, so it never passes through `sanitizeMarkdown`; nothing here
  introduces a new unsanitized-content surface.
- **Constraint 4 (no background LLM calls)** — reinforced, not touched: the whole point of this
  card is that a cache hit spends zero tokens, which was already true (§2.4).

## 5. Testing strategy

### 5.1 Unit — `packages/app/test/ui/lookup-card.test.ts`

New `describe('<lookup-card> instant-cache badge (A9)', ...)` block, sibling to the existing
provider-metadata `describe` at `lookup-card.test.ts:352`:

- a result with `fromCache: true` (and a `provider`) renders `.meta-row` containing a
  `.cache-badge` with text `'Cached'`, positioned before `.prov-badge` in DOM order.
- a result with `fromCache: true` and **no** `provider` still renders `.meta-row` with the
  `.cache-badge` (proves the relaxed guard in §3.2 without a provider).
- a result with `fromCache: false` (explicit) renders **no** `.cache-badge`.
- a result with `fromCache` absent (undefined) and no provider renders **no** `.meta-row` at all —
  regression guard for the existing `lookup-card.test.ts:367` "no provider → no meta-row" test,
  proving the new guard didn't accidentally widen when the row shows.

### 5.2 Unit — `packages/app/test/app/inline-bottom-sheet-renderer.test.ts`

New test, sibling to the existing nudge `describe` block (`inline-bottom-sheet-renderer.test.ts:290`):
`renderResult` with `{ ...result, fromCache: true }` renders a `.cache-badge` in the card's light
DOM; with `fromCache: false` (the shared fixture's default, `inline-bottom-sheet-renderer.test.ts:11`)
renders none.

### 5.3 e2e — new `packages/extension-chrome/e2e/a9-instant-cache-hits.spec.ts`

Reuses `gotoFixture`'s default paragraph (`'The bank by the river is steep.'`,
`helpers.ts:158-172`) so two lookups of "bank" in the same test share an identical
word+sentence+target key, guaranteeing the second is a hit:

1. **First lookup (miss) shows no badge; second lookup (hit) of the same word+sentence shows
   `Cached` and makes zero additional network calls.** Asserts `calls.count === 1` after both
   lookups (the hard gate from §2.2(1)) and `.cache-badge` text `'Cached'` present only after the
   second.
2. **`cacheEnabled:false` never shows the badge and always hits the network** — extends the
   existing miss-only scenario already covered in `cache-history.spec.ts`'s
   `'cacheEnabled:false hits the network on every lookup'` test with an explicit
   `.cache-badge` absence check on both lookups.
3. **The side panel shows the same badge for a mirrored `fromCache: true` payload** — using the
   `openPanelAndSender`-style two-page pattern already established in `side-panel.spec.ts`
   (seed a key, open `side-panel.html`, post `{ to: 'side-panel', state: 'result', payload }`
   with `fromCache: true` from a second extension page), proving §3.4's threading without needing
   a dedicated unit test for the composition root.
4. **Wall-clock smoke check (§2.2(2)).** Records `Date.now()` before the repeat click and again
   when `.cache-badge` becomes visible; asserts the delta is under 500 ms, with an inline comment
   citing this spec's §2.2 for why 500 ms (CI-jitter margin) is not the same number as the
   product's ≤ 100 ms structural target.

### 5.4 Regression check for §3.1 (no behavior change)

Run `packages/app/test/cache-policy.test.ts` before and after the comment-only edit; identical
pass count confirms zero behavior drift (Task 1's gate).

## 6. Testing performed (PR evidence — replaces screenshot/video capture)

Per this worktree's `CLAUDE.md` (owner ruling 2026-07-16): **no screenshots or video for this
PR.** The PR body's "Testing performed" section lists the suites above with pass counts (unit:
`lookup-card.test.ts`, `inline-bottom-sheet-renderer.test.ts`, `cache-policy.test.ts`; e2e:
`a9-instant-cache-hits.spec.ts`, plus the pre-existing `cache-history.spec.ts` and
`side-panel.spec.ts` as regression guards) and the gates passed (lint, format check, typecheck,
full unit suite, Chrome build with `GEMINI_API_KEY=` cleared).

## 7. Risk / rollback

- **Risk: low.** Every change is additive (a new optional `CardState` field, a new CSS rule, one
  new line in each of two existing render functions, and a doc comment). No existing field is
  removed or restructured, no wire/router/domain-policy behavior changes, and the guard change in
  `renderMetaRow` is a strict widening (old "provider only" callers behave identically; the new
  branch only fires when `fromCache === true`).
- **No data migration.** §2.1 — the cache key is unchanged, so no stored `cache:*` entry becomes
  invalid or needs re-keying.
- **Rollback:** revert the single PR. `CardState`, `renderMetaRow`, `renderResult`, and
  `resultToFocus` return to their pre-A9 shapes; `fromCache` keeps flowing on the wire exactly as
  it does today (that part was never new), simply unread by the UI again.

## 8. Files touched (summary)

| File                                                          | Change                                                                                                       |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `packages/app/src/domain/cache-policy.ts`                     | + clarifying doc comment above `deriveCacheKey` (no behavior change)                                         |
| `packages/app/src/ui/lookup-card.ts`                          | `CardState.fromCache?: boolean`; `renderMetaRow` guard relaxed + `.cache-badge` render + `CARD_DOC_CSS` rule |
| `packages/app/src/app/inline-bottom-sheet-renderer.ts`        | `renderResult` threads `fromCache: r.fromCache`                                                              |
| `packages/extension-chrome/src/side-panel.ts`                 | `resultToFocus` threads `fromCache: r.fromCache`                                                             |
| `packages/app/test/ui/lookup-card.test.ts`                    | + `describe('<lookup-card> instant-cache badge (A9)', …)`                                                    |
| `packages/app/test/app/inline-bottom-sheet-renderer.test.ts`  | + 2 tests (fromCache true/false)                                                                             |
| `packages/extension-chrome/e2e/a9-instant-cache-hits.spec.ts` | new — 4 e2e scenarios (§5.3)                                                                                 |

No change to `packages/app/src/wire.ts`, `packages/app/src/app/router.ts`,
`packages/app/src/domain/workflow.ts`, `packages/app/src/ui/settings-form.ts`, any manifest file,
or `packages/app/src/domain/history-policy.ts`.

## 9. Concurrency

Files this card modifies, cross-checked against CONTRACTS §5's hot-file catalog and corrected
where that catalog's guess didn't match this card's actual grounding:

- **`packages/app/src/ui/lookup-card.ts`** — CONTRACTS §5 lists "the lookup-card UI (A1 A2 A3 A5
  A7 A10)" as a hot file but does not list A9. **Correction: A9 also modifies this file**
  (`CardState` + `renderMetaRow` + `CARD_DOC_CSS`, §3.2). Serialize with A1, A2, A3, A5, A7, A10
  in addition to the catalog's existing list.
- **`packages/app/test/ui/lookup-card.test.ts`** — same overlap as above, by extension (every
  card touching `lookup-card.ts` also adds tests to its co-located suite).
- **`packages/extension-chrome/src/side-panel.ts`** — CONTRACTS §5 lists "side panel (A2 B6 B10
  B11)" and does not list A9. **Correction: A9 also modifies this file** (`resultToFocus`, §3.4).
  Serialize with A2, B6, B10, B11 in addition to the catalog's existing list.
- **`packages/app/src/app/inline-bottom-sheet-renderer.ts`** — not named in any CONTRACTS §5 hot
  file group; no other unshipped card in this batch is known to touch it. Low overlap risk.
- **`packages/app/src/domain/cache-policy.ts`** — comment-only; not named in any hot-file group.
  No overlap.
- **`packages/extension-chrome/e2e/a9-instant-cache-hits.spec.ts`** — new file, no overlap by
  definition.
- **Correction the other direction:** CONTRACTS §5 lists "settings-form (A5 A9 A13 B6 C9)" as a
  hot file for A9. Per §3.7, **A9 does not modify `settings-form.ts`** — drop A9 from that
  file's serialization set; A5, A13, B6, C9 remain accurate for their own cards.
