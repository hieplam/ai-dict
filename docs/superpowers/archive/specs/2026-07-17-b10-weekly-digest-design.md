# B10 — Weekly digest

Roadmap card: `docs/ROADMAP.md` §4 B10 (Impact 3 · Effort M · Score 1.5). Depends on: — (none).
Escalate: none (`docs/ROADMAP.md:536`). Lead decides: which stats (`docs/ROADMAP.md:536`) — this
spec pins that choice in §2.1 below.

## 1. Problem (grounded in code)

Today the side panel has exactly two live regions and nothing that sums activity over time:

- `SidePanelView` (`packages/app/src/ui/side-panel-view.ts`) renders `focusState` — the current
  lookup, one of `loading | result | error | empty` (`side-panel-view.ts:13`, 172-193 `renderFocus`)
  — and `recent`, a list of up to 50 history rows (`side-panel-view.ts:181-198` `renderRecent`).
  `side-panel.ts`'s `refreshRecent()` (`packages/extension-chrome/src/side-panel.ts:130-143`) is the
  only history read on panel-open, and it caps at `limit: 50` (`side-panel.ts:134`). A reader who
  looked up 40 words this week sees the identical UI shape as one who looked up 2 — nothing on the
  panel ever answers "how much did I actually read this week."
- `HistoryEntry` (`packages/app/src/domain/types.ts:136-142`) is exactly:

  ```ts
  export interface HistoryEntry {
    id: string;
    word: string;
    context: string;
    result: LookupResult;
    createdAt: number;
  }
  ```

  No `url`/`title` field exists, even though every lookup that produces a `HistoryEntry` already
  carries both: `LookupRequest` (`domain/types.ts:16-39`) has required `url: string; title: string;`
  fields, populated at `domain/workflow.ts:65-73` —

  ```ts
  const req: LookupRequest = {
    word: e.text,
    context: e.sentence,
    url: e.url,
    title: e.title,
    ...
  };
  ```

  (`workflow.ts:68-69`, `e` being the page's `SelectionEvent`). `router.ts`'s `handleLookup`
  (`packages/app/src/app/router.ts:140-149`) builds the stored entry from `req`/`result` but never
  copies `req.url`/`req.title` across:

  ```ts
  const entry: HistoryEntry = {
    id: crypto.randomUUID(),
    word: req.word,
    context: req.context,
    result: storableResult,
    createdAt: result.fetchedAt,
  };
  ```

  So there is today no way to answer "which sites do I actually read on" from stored history — the
  data reaches the router on every lookup and is thrown away before the write.

- `SavedWordEntry` (`domain/types.ts:246-251`, the ratified E1 shape) carries a `savedAt: number`
  per word — exactly the primitive a "saved this week" count needs — but nothing ever lists the
  saved-word collection over the wire. `savedWordsList` (`domain/saved-words-policy.ts:110-118`,
  fully implemented, newest-first) has **zero callers outside its own test file** (no wire/router
  consumer) — confirmed by `grep -rn savedWordsList packages/app/src`; its own doc comment already
  flags the gap: "B6 (Words page)
  is the future consumer" (`saved-words-policy.ts:108-109`). `WireMessageSchema`
  (`packages/app/src/wire.ts:95-141`) has no `saved.list` arm — the only saved-word wire messages
  today are `saved.save`, `saved.delete`, `saved.setStatus` (each acts on exactly one word; none
  lists the collection).
- No card authored before this one in the current batch adds a saved-word listing message either —
  `docs/superpowers/specs/`/`docs/superpowers/plans/` in this worktree contain no `b6-*` files as of
  this card's authoring (confirmed by `ls`), so B10 cannot assume B6 will have shipped `saved.list`
  first; this card grounds itself only in what exists in the worktree today.

## 2. Design questions (pinned)

### 2.1 The exact stats (card says "Lead decides: which stats")

**Pinned — four stats, matching the roadmap card's own payoff line verbatim** ("Open the panel
Friday → '23 lookups, 6 saved, 3 repeat offenders, mostly from nautil.us.'", `docs/ROADMAP.md:534`):

| Stat                  | Definition                                                                                                                                                | Source                          |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| **Lookups this week** | Count of `HistoryEntry` rows with `createdAt` inside the rolling window (§2.2).                                                                           | `history:*` (existing keyspace) |
| **Saved this week**   | Count of `SavedWordEntry` rows with `savedAt` inside the rolling window.                                                                                  | `saved:*` (existing keyspace)   |
| **Repeat lookups**    | Count of **distinct words** that appear ≥2 times among this week's `HistoryEntry` rows.                                                                   | derived from the same window    |
| **Top source sites**  | Up to 3 registrable-ish domains extracted from this week's `HistoryEntry.url` (new field, §2.3), ranked by lookup count desc, ties broken alphabetically. | derived from the same window    |

Rejected alternatives:

- **"Words met" as the roadmap's missing-line phrasing** (`docs/ROADMAP.md:530`) — the roadmap uses
  "words met this week, repeat lookups, top source sites" in its problem statement but "23 lookups"
  in its own payoff line one paragraph later. Both describe the same count (one `HistoryEntry` = one
  lookup = one word "met"); this spec pins the field/copy name to **"lookups"** because the payoff
  line is the more concrete, owner-facing artifact and matches what the stored data actually
  measures (a history append, not a distinct-word count).
- **"Saved" = total saved-word library size, not saved-this-week** — rejected. The whole frame of
  this feature is "this week"; a reader with 200 words saved over months would see "200 saved" every
  single Friday forever, which is not a progress signal and directly undermines the card's own
  rationale ("gentle awareness sustains a habit… a reader-first user would hate streaks and badges,"
  `docs/ROADMAP.md:532-533` — a static giant number is exactly the kind of number that stops meaning
  anything, the same failure mode streaks have). Total-saved-ever belongs to the future B6 Words
  page, not this glance card.
- **"Repeat lookups" reusing B7's nudge machinery** (`domain/nudge-policy.ts`, `NUDGE_THRESHOLD=3`,
  a 30-day rolling window, a one-time-ever `nudge:<word>` KV marker) — rejected. B7's nudge is a
  stateful, mutating feature (it writes a permanent "already nudged" flag and never re-fires) built
  for a completely different purpose (a one-shot in-card banner). Reusing it here would mix a
  read-only weekly summary with a write-owning KV keyspace and a different window (30d vs 7d),
  breaking the "pure domain function, no side effects" pin in §2.4. B10's repeat-lookup count is a
  plain re-count of this week's own `HistoryEntry` rows — independent of whatever B7 has or hasn't
  marked.
- **Top sites unbounded / top 1 only** — rejected both directions: unbounded risks the glance card
  growing into a leaderboard (against the card's own "no gamification" spirit); top-1 discards
  signal for very little UI cost. **Pinned: top 3** (`TOP_SITES_N = 3`, §3.2), sorted by count desc
  then domain ascending for deterministic ties.

### 2.2 The week window

**Pinned — rolling 7 days**, per the card's own scope fence ("Computed on open… ", the card text
doesn't specify calendar-week vs rolling, but the DISPATCH note for this card is explicit: "the week
window definition (rolling 7d)"). `DIGEST_WINDOW_MS = 7 * 24 * 60 * 60 * 1000` (§3.2). An entry
qualifies when `windowStart <= createdAt <= nowMs` where `windowStart = nowMs - DIGEST_WINDOW_MS`
(inclusive both ends — a lookup made exactly `DIGEST_WINDOW_MS` ago still counts).

Rejected alternative: **calendar week (Mon–Sun)** — rejected because it makes the stat's meaning
depend on which day the reader opens the panel (a Tuesday-open would only cover 1-2 days of "this
week," understating activity right after a calendar boundary) and requires timezone handling the
rest of this 100%-local, no-account extension has no existing primitive for. Rolling-7d is simpler,
timezone-agnostic (uses epoch ms throughout, like every other timestamp in this codebase —
`createdAt`, `savedAt`, `fetchedAt` are all plain `number`), and matches what "computed on open"
already implies: "how much did I do in the last 7 days," not "how much did I do since Monday."

### 2.3 `HistoryEntry` gains `url?`/`title?` — where, and is this an escalation?

**Pinned — add optional `url?: string; title?: string;` to `HistoryEntry`** (`domain/types.ts`),
populated by `router.ts`'s `handleLookup` from `req.url`/`req.title` (always-present strings on
`LookupRequest`) at the exact point the entry is already being constructed (§1). Mirrored on
`HistoryEntrySchema` in `wire.ts` as `.optional()` fields (the wire evolution precedent, CONTRACTS
§3: "optional in-flight request/response fields are ordinary evolution, not an escalation" — the
same reasoning A8/B2/B7 already established for `LookupResult.definedAs`/`.translation`/`.nudge`).
**This is not an E1/E2-locked shape** — CONTRACTS §3 names exactly two ratified/locked shapes
(`SavedWordEntry` and the backup envelope); `HistoryEntry` is not one of them, and this change is
purely additive (existing stored entries lacking the fields parse as `url: undefined, title:
undefined` — no migration, no write-time backfill).

Back-compat: entries written before this card ships have no `url`/`title` in their stored JSON.
`JSON.parse` of an object literal missing a key simply omits it — reading `.url` off such an object
returns `undefined` at runtime, which is exactly what the optional-field type says. §3.2's digest
function treats a missing/empty `url` as "exclude from the site tally, still count toward lookups"
(§2.1's "Top source sites" row) — no entry is ever dropped or crashes the computation for lacking
the new field.

Rejected alternative — **a new `since`-mode wire message for `history.list`** (add an optional
`since?: number` request field, route it through the already-existing `historyListSince` domain
function, `domain/history-policy.ts:58-72`, currently used only internally by the router's B7 nudge
check) instead of touching `HistoryEntry`'s shape at all. Rejected in favor of the plain field
addition because: (a) the digest still needs `url` on each entry to compute "top source sites" no
matter which retrieval mode fetches them — a `since` mode alone doesn't remove the need to touch
`HistoryEntry`/`wire.ts`/`router.ts`; (b) introducing a second retrieval mode into one message type
(limit/cursor pagination vs. an unbounded since-walk) adds real test surface (two mutually-exclusive
branches, is `since` allowed to combine with `limit`/`cursor`?) for no efficiency win —
`historyListSince` walks the same newest-first index from the front exactly like `historyList`
does, and the store can never hold more than `HISTORY_CAP` (500, §3.1) entries total, so a
since-bounded walk is never cheaper than a limit-bounded one by more than that fixed constant. §2.4
below covers how the panel actually retrieves the week's entries without a `since` mode at all.

### 2.4 How does the panel obtain a week's worth of history, given `history.list`'s `limit: 50` cap on "Recent"?

**Pinned — reuse the existing `history.list` message exactly as-is, with `limit: HISTORY_CAP`**
(§3.1 exports the existing `DEFAULT_CAP = 500` from `history-policy.ts` as `HISTORY_CAP`, the same
naming pattern `error-report.ts` already uses for `ERROR_BUFFER_CAP`). Since the store can never
hold more than `HISTORY_CAP` entries (`historyAppend` evicts the oldest past the cap,
`history-policy.ts:21-30`), asking for `limit: HISTORY_CAP` always returns **every** entry currently
stored — no pagination, no `since` field, zero wire/router changes beyond §2.3's `url`/`title`
addition. The digest's pure domain function (§3.2) then filters that full set down to the rolling
7-day window itself. This is a second call the panel already makes a similar one of today
(`refreshRecent()`'s `limit: 50` call) — one extra `chrome.runtime.sendMessage` round trip on panel
open, not a new mechanism.

Rejected: see §2.3's rejected `since`-mode alternative — the same reasoning applies here, since that
alternative was really "add a since mode AND use it for the digest fetch," rejected as one unit.

**Saved words: a new `saved.list` wire message.** No existing message can list saved words (§1). A
new zero-payload message is required:

```
{ type: 'saved.list' } → { ok: true, type: 'saved.list', entries: SavedWordEntry[] }
```

Router handler is a straight call to the already-implemented, already-tested `savedWordsList`
domain function (`saved-words-policy.ts:110-118`) — this card is simply its first wire consumer.
Per the global "wire message + router case in ONE task" convention (`docs/ROADMAP.md` §8's B5/B3
ruling — `router.ts`'s `switch (msg.type)` is exhaustive with no `default` arm, so a new case cannot
type-check independently of its schema arm), §Task 3 of the plan lands `wire.ts` + `router.ts` +
their tests together.

Naming: the reply type is `'saved.list'`, not `'saved'` — `'saved'` is already taken by the
single-entry reply shape (`{ ok:true, type:'saved', entry: SavedWordEntry }` from `saved.save`/
`saved.setStatus`). Since `WireReplySchema` is a `z.union` discriminated by `type`, reusing `'saved'`
for a list-shaped payload (`entries: SavedWordEntry[]`) would make the same `type` literal describe
two incompatible payloads — not a valid discriminated shape. `'saved.list'` (mirroring the request
type) keeps the discriminant unambiguous, at the cost of diverging slightly from `history.list` →
`'history'`'s naming (that pattern was free to drop the `.list` suffix only because `'history'`
wasn't already claimed by another reply shape).

### 2.5 Compute location and recompute cadence

**Pinned — a pure domain function, computed exactly once per panel-open, never re-triggered by
subsequent lookups while the panel stays open.** New file `packages/app/src/domain/weekly-digest.ts`
exports:

```ts
export function computeWeeklyDigest(
  history: HistoryEntry[],
  savedWords: SavedWordEntry[],
  nowMs: number,
): WeeklyDigest;
```

Pure: no I/O, no `Date.now()` internally (caller injects `nowMs`, the same DI seam every other
domain policy module uses — `SavedWordsDeps.now`, `RouterDeps.now` — so the function is
deterministically unit-testable). `side-panel.ts`'s composition root calls it once, in its existing
boot sequence (alongside `refreshRecent()`/`initFromSettings()`, `side-panel.ts:312-313`), and
assigns the result to a new `SidePanelView.digest` setter. It is **never** recomputed by the live
mirror listener (`side-panel.ts:237-275`, which handles in-flight lookup broadcasts) — a completed
lookup does not retrigger the digest fetch. This is the direct implementation of the card's own
scope fence: **"Computed on open — no background jobs, no notifications, no streaks"**
(`docs/ROADMAP.md:535`). Extra KV reads on every lookup (rather than once per panel session) would
be exactly the kind of background-triggered work the fence forbids.

Rejected alternative — **a router-side `digest.get` message that computes the stats in the service
worker** — rejected because the DISPATCH note for this card explicitly pins "the compute location
(pure domain function + panel render; unit-test the pure part)," and because `runLookupWorkflow`/
`RouterDeps` deliberately keep product-shape decisions (which stats, what window) out of the
router — the router forwards raw entries (`history.list`) and raw saves (`saved.list`) exactly like
every other read path; doing the aggregation there would need a second, router-level test suite
instead of one pure-function suite, and would make the SW own a decision (which 4 stats) that
belongs in the domain layer per `rule-domain-purity` (`ref-core-dependency-rule`).

### 2.6 Top-site domain extraction heuristic

**Pinned — `hostname` from `new URL(entry.url)`, with a leading `www.` stripped; anything that
fails to parse (empty string, malformed URL) is excluded from the site tally only** (still counted
toward "lookups this week" — §2.1's table). No public-suffix-list / eTLD+1 parsing (e.g. a `tldts`-
style dependency) is added.

Rejected alternative — **full registrable-domain (eTLD+1) parsing**, which would correctly fold
`en.wikipedia.org`/`de.wikipedia.org` into one `wikipedia.org` bucket. Rejected for this card
specifically because: (a) it requires either a new dependency (this is a 100%-local, dependency-
light extension — CONTRACTS' standing constraints don't forbid dependencies outright, but B10's
"Effort M" budget doesn't justify adding and bundling a suffix-list library for a glance stat); (b)
the roadmap's own B15 (site-lookup-stats, sequenced after B10 in the current campaign order,
`docs/ROADMAP.md §8`) is the card explicitly chartered to "pin the registrable-domain rule" for its
dedicated per-domain feature — its own DISPATCH note says exactly that. B10 deliberately does the
minimum needed for a 3-line "mostly from" glance and leaves the rigorous rule to the card that
exists to own it; B15's future author should ground against `HistoryEntry.url` as added by this
card (§2.3) rather than re-deriving it.

### 2.7 Empty-state copy

**Pinned exact copy**, shown when `lookups === 0` for the window: **"Nothing yet this week — look
something up and check back."** Reasoning: mirrors the panel's existing teaching tone for its other
empty state (`renderEmpty()`, `side-panel-view.ts:96-105`: "Select a word on any page…") — plain,
un-gamified, no streak/guilt language, consistent with the card's own "Why" (`docs/ROADMAP.md:532`).

Rejected alternative — **hide the whole `.digest` section when there's no activity** (instead of a
soft empty state). Rejected because hiding it entirely would make the feature invisible to a
brand-new reader who has never seen it — a first "This week" section, even empty, teaches that the
feature exists for next time. The section is still hidden **before the async fetch resolves**
(§4.1's `hidden` default) to avoid a load-flash, but never hidden once real (possibly zero) data has
loaded.

## 3. The change

### 3.1 `packages/app/src/domain/history-policy.ts`

Export the existing cap under a public name (currently a private `const DEFAULT_CAP = 500`,
`history-policy.ts:5`, used only inside this file):

```ts
const DEFAULT_CAP = 500;
/** Public name for DEFAULT_CAP — the side panel's weekly digest (B10) fetches every currently
 * stored entry via `history.list` with `limit: HISTORY_CAP`; since the store can never hold more
 * than this many entries (historyAppend evicts past it), that single call always returns
 * everything. Mirrors ERROR_BUFFER_CAP's naming (error-report.ts). */
export const HISTORY_CAP = DEFAULT_CAP;
```

No other line in this file changes; `historyAppend`/`historyList` keep using the private
`DEFAULT_CAP` identifier internally (§2.4 grounds why `HISTORY_CAP` is safe to lean on).

### 3.2 `packages/app/src/domain/weekly-digest.ts` (new)

```ts
import type { HistoryEntry, SavedWordEntry } from './types';

/** Rolling window, not calendar-week — see the design spec §2.2. */
export const DIGEST_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Cap on the "top source sites" row — design spec §2.1. */
export const TOP_SITES_N = 3;

export interface DigestSite {
  domain: string;
  count: number;
}

export interface WeeklyDigest {
  windowStart: number;
  lookups: number;
  saves: number;
  repeatWords: number;
  topSites: DigestSite[];
}

/** hostname minus a leading "www." — a deliberately lightweight heuristic, not eTLD+1 parsing.
 * See the design spec §2.6 for why (B15 owns the rigorous rule for its own feature). Returns
 * undefined for an empty/unparseable url — the caller excludes those from the site tally only. */
function siteOf(url: string): string | undefined {
  if (!url) return undefined;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.startsWith('www.') ? host.slice(4) : host;
  } catch {
    return undefined;
  }
}

/**
 * Pure aggregation over already-fetched history/saved-word rows. No I/O, no Date.now() — the
 * caller injects `nowMs` (same DI seam as SavedWordsDeps.now/RouterDeps.now). Design spec §2.5.
 */
export function computeWeeklyDigest(
  history: HistoryEntry[],
  savedWords: SavedWordEntry[],
  nowMs: number,
): WeeklyDigest {
  const windowStart = nowMs - DIGEST_WINDOW_MS;
  const inWindow = history.filter((e) => e.createdAt >= windowStart && e.createdAt <= nowMs);

  const wordCounts = new Map<string, number>();
  const siteCounts = new Map<string, number>();
  for (const e of inWindow) {
    const wordKey = e.word.trim().toLowerCase();
    wordCounts.set(wordKey, (wordCounts.get(wordKey) ?? 0) + 1);
    const site = e.url ? siteOf(e.url) : undefined;
    if (site) siteCounts.set(site, (siteCounts.get(site) ?? 0) + 1);
  }

  const repeatWords = [...wordCounts.values()].filter((count) => count >= 2).length;

  const topSites = [...siteCounts.entries()]
    .sort(([domainA, countA], [domainB, countB]) =>
      countB !== countA ? countB - countA : domainA.localeCompare(domainB),
    )
    .slice(0, TOP_SITES_N)
    .map(([domain, count]) => ({ domain, count }));

  const saves = savedWords.filter((s) => s.savedAt >= windowStart && s.savedAt <= nowMs).length;

  return { windowStart, lookups: inWindow.length, saves, repeatWords, topSites };
}
```

### 3.3 `packages/app/src/domain/types.ts`

Add two optional fields to `HistoryEntry` (§2.3):

```ts
export interface HistoryEntry {
  id: string;
  word: string;
  context: string;
  result: LookupResult;
  createdAt: number;
  /**
   * B10: the page the lookup happened on, carried straight from LookupRequest.url/.title at
   * write time (router.ts's handleLookup) — used to compute "top source sites" in the weekly
   * digest (domain/weekly-digest.ts). Absent on entries recorded before B10 shipped; the digest
   * excludes those from its site tally while still counting them toward the lookup total.
   */
  url?: string;
  title?: string;
}
```

No other field on `HistoryEntry`, `LookupResult`, `LookupRequest`, or `SavedWordEntry` changes.

### 3.4 `packages/app/src/wire.ts`

`HistoryEntrySchema` gains the matching optional fields:

```ts
const HistoryEntrySchema = z.strictObject({
  id: z.string(),
  word: z.string(),
  context: z.string(),
  result: LookupResultSchema,
  createdAt: z.number(),
  // B10: see HistoryEntry's doc comment (domain/types.ts) — absent on pre-B10 entries.
  url: z.string().optional(),
  title: z.string().optional(),
});
```

New zero-payload request arm added to `WireMessageSchema` (§2.4), placed next to the other
`saved.*` arms:

```ts
// B10: list every currently saved word (savedWordsList's first wire consumer). No payload.
z.object({ type: z.literal('saved.list') }),
```

`MessageTypeEnum` gains `'saved.list'` (keeps the `ok:false` generic-failure reply's `type` field
exhaustive across every message type — matches the pattern already used for the other 14 arms).

New reply arm added to `WireReplySchema` (§2.4's naming rationale):

```ts
z.object({
  ok: z.literal(true),
  type: z.literal('saved.list'),
  entries: z.array(SavedWordEntrySchema),
}),
```

The compile-time `AssertEqual` drift guard (`wire.ts:201-209`) needs no new tuple entry — it only
checks types that have BOTH a domain interface and a matching wire schema payload
(`LookupRequest`/`LookupResult`/`PublicSettings`/`HistoryEntry`/`SavedWordEntry`); `saved.list`'s
reply reuses the existing `SavedWordEntrySchema`/`SavedWordEntry` pair already covered by that
guard's `SavedWordEntry` check, so a schema/type mismatch on an individual entry still fails `tsc`.

### 3.5 `packages/app/src/app/router.ts`

`handleLookup`'s history-write branch (currently `router.ts:140-149`) now copies `url`/`title`
across:

```ts
if (saveHistory) {
  const entry: HistoryEntry = {
    id: crypto.randomUUID(),
    word: req.word,
    context: req.context,
    result: storableResult,
    createdAt: result.fetchedAt,
    // B10: carried straight from the request so the weekly digest can compute "top source
    // sites" without a second round trip — req.url/req.title are the same fields
    // domain/workflow.ts already builds from the page's selection event.
    url: req.url,
    title: req.title,
  };
  await deps.queue.run(() => historyAppend({ storage: deps.kv }, entry));
}
```

Import list gains `savedWordsList` (already re-exported by `../index`, alongside the existing
`savedWordUpsert`/`savedWordDelete`/`savedWordSetStatus` imports). New `switch` case, added inside
the exhaustive `switch (msg.type)` (`router.ts:213-287`), next to the other `saved.*` cases:

```ts
case 'saved.list': {
  const entries = await savedWordsList({ storage: deps.kv });
  return { ok: true, type: 'saved.list', entries };
}
```

No `readToggles`/cache/queue involvement — `saved.list` is a pure read, exactly like the existing
`settings.get` case.

### 3.6 `packages/app/src/index.ts`

One new barrel line, next to the other domain re-exports:

```ts
export * from './domain/weekly-digest';
```

### 3.7 `packages/app/src/ui/side-panel-view.ts`

New import:

```ts
import type { WeeklyDigest } from '../domain/weekly-digest';
```

New CSS rules (reusing existing `--ad-*`/`--adp-*` tokens, sibling to the existing `.recent-*`
block — placed right after the `.recent-context` rule, `side-panel-view.ts:87`):

```css
.digest[hidden] {
  display: none;
}
.digest-head {
  margin: 0;
  padding: 14px 0 8px;
  border-top: 1px solid var(--ad-line);
  font-size: var(--adp-text-2xs);
  font-weight: var(--adp-weight-bold);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ad-ink-soft);
}
.digest-list {
  list-style: none;
  margin: 0 0 10px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.digest-row {
  font-size: 14px;
  line-height: 1.5;
  color: var(--ad-ink);
}
.digest-empty {
  margin: 0 0 10px;
  font-size: var(--adp-text-sm);
  line-height: 1.5;
  color: var(--ad-ink-soft);
}
```

New private field + element, created in `connectedCallback` right after `this.recentEl` is built
(`side-panel-view.ts:151-160`) and appended to `main` alongside it:

```ts
this.digestEl = document.createElement('section');
this.digestEl.className = 'digest';
this.digestEl.setAttribute('aria-label', 'This week');
// Hidden until `digest` is explicitly set — avoids a flash of empty content before the panel's
// async history.list/saved.list round trip resolves (design spec §2.7).
this.digestEl.hidden = true;
...
main.append(this.focusEl, this.recentEl, this.digestEl);
```

New public accessor (mirrors the existing `recent` setter's shape, `side-panel-view.ts:182-188`):

```ts
/** The weekly digest (B10), computed once per panel-open. `undefined` = not loaded yet (section
 * stays hidden); once set, it stays visible for the rest of the session, including a zero-stat
 * empty state — never re-hidden. */
set digest(d: WeeklyDigest | undefined) {
  this._digest = d;
  if (this.shadowRoot) this.renderDigest();
}
get digest(): WeeklyDigest | undefined {
  return this._digest;
}
```

New private field `_digest: WeeklyDigest | undefined = undefined;` alongside the existing `_focus`/
`_recent` fields, and `digestEl!: HTMLElement;` alongside `recentEl!`/`recentList!`.

New private render method, called once from `connectedCallback` alongside `renderFocus()`/
`renderRecent()`:

```ts
private renderDigest(): void {
  this.digestEl.hidden = this._digest === undefined;
  const d = this._digest;
  if (d === undefined) return;
  const head = document.createElement('h2');
  head.className = 'digest-head';
  head.textContent = 'This week';
  const nodes: Node[] = [head];
  if (d.lookups === 0) {
    const p = document.createElement('p');
    p.className = 'digest-empty';
    p.textContent = 'Nothing yet this week — look something up and check back.';
    nodes.push(p);
  } else {
    const rows = [
      `${d.lookups} lookup${d.lookups === 1 ? '' : 's'} this week`,
      `${d.saves} saved`,
      `${d.repeatWords} repeat lookup${d.repeatWords === 1 ? '' : 's'}`,
    ];
    if (d.topSites.length > 0) {
      rows.push(`Mostly from ${d.topSites.map((s) => s.domain).join(', ')}`);
    }
    const list = document.createElement('ul');
    list.className = 'digest-list';
    for (const text of rows) {
      const li = document.createElement('li');
      li.className = 'digest-row';
      li.textContent = text;
      list.append(li);
    }
    nodes.push(list);
  }
  this.digestEl.replaceChildren(...nodes);
}
```

### 3.8 `packages/extension-chrome/src/side-panel.ts`

New imports: `HISTORY_CAP`, `computeWeeklyDigest` from `@ai-dict/app`. New function, called once
from the boot sequence:

```ts
// B10: fetch a week's worth of history + every saved word, once, on panel open — never
// re-triggered by the live mirror listener below (design spec §2.5: "computed on open," no
// background recompute). Best-effort, like refreshRecent/recoverFocus: on any failure the
// section simply stays hidden (view.digest stays undefined).
async function loadDigest(): Promise<void> {
  try {
    const [historyRaw, savedRaw] = await Promise.all([
      chrome.runtime.sendMessage({ type: 'history.list', limit: HISTORY_CAP }),
      chrome.runtime.sendMessage({ type: 'saved.list' }),
    ]);
    const historyReply = historyRaw as WireReply | undefined;
    const savedReply = savedRaw as WireReply | undefined;
    if (!historyReply || !historyReply.ok || historyReply.type !== 'history') return;
    if (!savedReply || !savedReply.ok || savedReply.type !== 'saved.list') return;
    view.digest = computeWeeklyDigest(historyReply.entries, savedReply.entries, Date.now());
  } catch {
    // Best-effort probe; the digest section simply never appears.
  }
}
```

Final boot lines (currently `side-panel.ts:312-313`) gain one more fire-and-forget call:

```ts
void refreshRecent();
void initFromSettings().then(() => recoverFocus());
void loadDigest();
```

## 4. No change to…

- **`packages/app/src/domain/saved-words-policy.ts`** — `savedWordsList` is reused verbatim; this
  card is its first caller, not a modifier.
- **`packages/app/src/app/history-export.ts`** — `buildHistoryExport` reconstructs each entry
  field-by-field (an explicit allowlist, the file's own S1 comment explains why) and deliberately
  omits the new `url`/`title` fields; an implementer must not add them here. Including a reader's
  browsing URLs in a downloadable export file is a materially different privacy posture than
  showing an aggregated domain count inside the extension's own panel, and is out of this card's
  scope fence.
- **`packages/extension-chrome/src/side-panel-messages.ts`** — `SidePanelFocus`'s existing comment
  ("no url/title until B2") describing the "Recent"-row-click path (`side-panel.ts`'s `select`
  listener, which calls `trackSaveContext(entry.result, { sentence: entry.context })` without
  `url`/`title`) is now stale in the sense that `HistoryEntry.url`/`.title` exist — but wiring them
  into that save-context path is a different concern (completing the save payload for a re-opened
  history row) than this card's digest feature. Left untouched deliberately, so a reviewer doesn't
  read a `select`-listener diff as part of B10's scope.
- **`packages/app/src/app/inbound.ts`** (`classifyInbound`) — it validates against
  `WireMessageSchema.safeParse` generically; the new `saved.list` arm is automatically covered with
  no code change here.
- **`packages/app/src/domain/nudge-policy.ts`, `packages/app/src/domain/history-policy.ts`'s
  `historyListSince`** — neither is touched; §2.1/§2.4 grounds why the digest doesn't reuse either.
- **`packages/extension-chrome/src/manifest.json`** — no new permission; `saved.list` and the wider
  `history.list` call are ordinary `chrome.runtime` messages the extension already has permission to
  send to its own service worker.
- **`packages/app/src/ui/lookup-card.ts`, `onboarding-view.ts`, `settings-form.ts`** — the in-page
  card and settings/onboarding surfaces are unrelated to this card; the digest lives entirely in the
  side panel.

## 5. Scope fence (from the card, held exactly)

- **Computed on open — no background jobs, no notifications, no streaks** (`docs/ROADMAP.md:535`):
  `loadDigest()` fires exactly once per panel session, never from the live-mirror listener, never on
  a timer. No new `chrome.alarms`/`chrome.notifications` permission or API use anywhere in this
  change.
- **From existing history entries only** — no new tracking surface; `url`/`title` were already being
  computed and sent on every lookup (`workflow.ts:68-69`) and simply weren't persisted. No new data
  is collected that wasn't already flowing through the existing lookup pipeline.
- **Lead decides: which stats** — pinned in §2.1, with rationale and rejected alternatives.
- **S4 (`rule-sanitize-model-output`) is not implicated** — the digest never renders model output;
  every string it displays (`domain` names, integers) is either a `new URL().hostname` (browser-
  normalized, not LLM-produced markdown) or an interpolated count. No `sanitizeMarkdown` call is
  needed or added for this card.
- **S1 (`rule-api-key-isolation`)** — untouched; the digest never reads or displays anything from
  `Settings`/the API key. `saved.list`'s reply carries `SavedWordEntry[]` (the ratified E1 shape,
  which never carried a key field to begin with).
- **Design tokens only** — §3.7's new CSS reads exclusively `--ad-*`/`--adp-*` custom properties,
  matching the existing `.recent-*` rules it sits beside; no hard-coded color, no
  `prefers-color-scheme` branch.
- **No manifest/permission change** — confirmed in §4.

## 6. Testing strategy

1. **Unit — new `packages/app/test/weekly-digest.test.ts`** (pure function, no fakes needed):
   entries inside vs. outside the rolling window (inclusive boundary at exactly `nowMs -
DIGEST_WINDOW_MS`); `saves` counted by `savedAt` in-window; `repeatWords` counts distinct words
   with ≥2 in-window lookups and excludes single-lookup words; `topSites` aggregates by
   `www.`-stripped hostname, sorted desc by count then domain ascending, capped at `TOP_SITES_N`;
   entries with an empty/unparseable `url` are excluded from `topSites` but still counted in
   `lookups`; empty history + empty saved words → an all-zero digest with `topSites: []`.
2. **Unit — `packages/app/test/app/router.test.ts` additions**: a `lookup` message with a non-empty
   `req.url`/`req.title` produces a stored `HistoryEntry` carrying both (read back via
   `historyList`); `saved.list` on an empty store replies `{ ok:true, type:'saved.list', entries: []
}`; after two `saved.save` calls, `saved.list` replies with both entries (order not asserted —
   `savedWordsList`'s own ordering is already covered by `saved-words-policy.test.ts`).
3. **Unit — `packages/app/test/wire-schema.test.ts` additions**: `history.list`'s reply accepts
   entries both with and without `url`/`title` (back-compat); a bare `{ type: 'saved.list' }`
   request parses; a `{ ok:true, type:'saved.list', entries: [...] }` reply parses with a
   well-formed `SavedWordEntry[]` and rejects one containing a malformed entry (reuses the existing
   `strictObject` sense-shape rejection already proven for the `saved.save` reply). The JSON-schema
   snapshot test (`wire-schema.test.ts:405-409`) is regenerated, not hand-edited (Task 3's plan
   step runs `vitest -u`).
4. **Unit — `packages/app/test/ui/side-panel-view.test.ts` additions**: the `.digest` section is
   `hidden` before `digest` is ever set; setting a zero-stat digest (`lookups: 0`) shows the pinned
   empty copy; setting a real digest renders all four stat rows with the exact pluralization rules
   (singular "1 lookup this week" vs. plural); a digest with an empty `topSites` array omits the
   "Mostly from" row entirely; an axe-violations check with a populated digest.
5. **e2e — new `packages/extension-chrome/e2e/b10-weekly-digest.spec.ts`**: seed `history:*` entries
   with `createdAt` computed relative to the browser's own `Date.now()` (some inside the 7-day
   window with a `url`, some outside it, one inside the window with no `url` at all) plus `saved:*`
   entries with `savedAt` inside/outside the window, open `side-panel.html`, and assert the rendered
   "This week" section shows the correct counts and the expected top site. A second test seeds no
   history/saved data and asserts the pinned empty-state copy renders.

## 7. Testing performed (PR evidence — replaces screenshot/video capture)

Per this worktree's `CLAUDE.md` (owner ruling 2026-07-16): **no screenshots or video for this PR.**
The PR body's "Testing performed" section carries the evidence instead — suites run, test counts,
e2e scenarios exercised, and gates passed (lint, format check, typecheck, unit, e2e), matching §6
above exactly. No `pr-assets/*` branch is created for this card.

## 8. Risk / rollback

- **Risk: low.** The riskiest surface is `router.ts`'s `handleLookup` edit — a two-field addition to
  an object literal already under heavy existing test coverage (§6.2 adds a direct regression guard
  for it). `computeWeeklyDigest` is a brand-new pure function with no callers outside
  `side-panel.ts`, so a bug in it cannot affect any other feature. The new `saved.list` message is
  strictly additive to the wire union; no existing message's shape changes.
- **No data migration.** `HistoryEntry`'s new fields are optional; nothing rewrites existing stored
  entries. A pre-B10 entry simply contributes to `lookups`/`repeatWords` but never to `topSites`.
- **Rollback:** revert the single PR. `HistoryEntry`/`wire.ts`/`router.ts` return to their pre-B10
  shape; no stored data becomes invalid (the optional fields on already-written post-B10 entries are
  simply ignored by the reverted code, exactly like any other unknown JSON property).

## 9. Files touched (summary)

| File                                                      | Change                                                                                                                   |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `packages/app/src/domain/history-policy.ts`               | + exported `HISTORY_CAP` (aliases the existing private `DEFAULT_CAP`)                                                    |
| `packages/app/src/domain/weekly-digest.ts`                | **new** — `computeWeeklyDigest`, `DIGEST_WINDOW_MS`, `TOP_SITES_N`, `WeeklyDigest`/`DigestSite` types                    |
| `packages/app/src/domain/types.ts`                        | `HistoryEntry` + optional `url?`/`title?`                                                                                |
| `packages/app/src/wire.ts`                                | `HistoryEntrySchema` + optional `url`/`title`; new `saved.list` request + reply arms; `MessageTypeEnum` + `'saved.list'` |
| `packages/app/src/app/router.ts`                          | `handleLookup` writes `url`/`title` into the stored entry; new `saved.list` case                                         |
| `packages/app/src/index.ts`                               | + `export * from './domain/weekly-digest'`                                                                               |
| `packages/app/src/ui/side-panel-view.ts`                  | + `.digest` section, `digest` accessor, `renderDigest()`, CSS                                                            |
| `packages/extension-chrome/src/side-panel.ts`             | + `loadDigest()`, called once from the boot sequence                                                                     |
| `packages/app/test/weekly-digest.test.ts`                 | **new**                                                                                                                  |
| `packages/app/test/app/router.test.ts`                    | + tests (§6.2)                                                                                                           |
| `packages/app/test/wire-schema.test.ts`                   | + tests (§6.3); snapshot regenerated                                                                                     |
| `packages/app/test/ui/side-panel-view.test.ts`            | + tests (§6.4)                                                                                                           |
| `packages/extension-chrome/e2e/b10-weekly-digest.spec.ts` | **new** (§6.5)                                                                                                           |

No change to `packages/app/src/domain/saved-words-policy.ts`, `history-export.ts`,
`side-panel-messages.ts`, `inbound.ts`, `nudge-policy.ts`, `lookup-card.ts`, `onboarding-view.ts`,
`settings-form.ts`, or any manifest file — see §4.

## 10. Concurrency (per CONTRACTS §5)

This card touches:

- **`packages/app/src/ui/side-panel-view.ts` + `packages/extension-chrome/src/side-panel.ts`** —
  CONTRACTS' own hot-file list already flags the side panel as shared with A2, B6, B10, B11;
  serialize this card against any of those three still in flight (a concurrent editor of
  `side-panel-view.ts`'s `main` region or `side-panel.ts`'s boot sequence would conflict textually
  even where the features are logically independent).
- **`packages/app/src/wire.ts` + `packages/app/src/app/router.ts`** — CONTRACTS flags wire+router as
  hot for "any card adding messages"; this card adds `saved.list`. Serialize against any other
  in-flight card also adding a wire message (its new arm would land in the same
  `z.discriminatedUnion([...])` array and the same exhaustive `switch`).
- **`packages/app/src/domain/types.ts`** (`HistoryEntry` gains `url?`/`title?`) — not on CONTRACTS'
  pre-declared hot-file list, but flagged here because **B15** (site-lookup-stats, sequenced after
  B10 in the current campaign order) explicitly plans to consume `HistoryEntry.url` for its own
  per-domain stats feature (its DISPATCH note: "domain extraction from history entry url… cite
  entry shape"). B15 must be sequenced **after** this card lands so its spec grounds itself in the
  real (shipped) field rather than a hypothetical one — the existing campaign order already places
  B15 after B10, so no reordering is required, only a note for whoever authors/executes B15 next.
- No other in-flight card is known to touch `saved-words-policy.ts`, `history-policy.ts`, or
  introduce a `weekly-digest.ts`/`digest`-named file.
