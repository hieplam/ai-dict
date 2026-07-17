# B15 — Site lookup stats

Roadmap card: `docs/ROADMAP.md` §4 B15 (Impact 2 · Effort S · Score 2.0). Depends on: — (independent).
Card-specific pins (Shaman dispatch notes,
`.okra/runs/spec-all-cards-2026-07-17/DISPATCH-NOTES.md` "## B15 site-lookup-stats"): per-domain
tally from EXISTING history only — never page tracking (quote the fence as a rule); pin where it
renders, domain extraction from history entry url, top-N presentation, empty state; pure domain
function + unit tests.

## 1. Problem (grounded in code)

**The card's premise ("domain extraction from history entry url") does not hold today — the
grounding fact this spec exists to fix.** `HistoryEntry` (`packages/app/src/domain/types.ts:136-142`)
is:

```ts
export interface HistoryEntry {
  id: string;
  word: string;
  context: string;
  result: LookupResult;
  createdAt: number;
}
```

**There is no `url` field.** `LookupRequest` (`types.ts:16-39`) carries `url: string` (16-19), and
the router receives it on every lookup, but `handleLookup`'s `HistoryEntry` construction
(`packages/app/src/app/router.ts:141-147`) never copies it across:

```ts
const entry: HistoryEntry = {
  id: crypto.randomUUID(),
  word: req.word,
  context: req.context,
  result: storableResult,
  createdAt: result.fetchedAt,
};
```

The gap is corroborated by an existing code comment, written for an unrelated reason but
confirming the same fact: `packages/extension-chrome/src/side-panel.ts:145-146`, above the
side panel's "Recent row clicked" handler — _"Re-show a past lookup in the focus region when its
row is clicked. HistoryEntry has no url/title (that gap is exactly why B2 exists) — sentence comes
from the stored context."_ (That comment's "B2" attribution is itself imprecise — B2 populated
`SavedWordEntry`/`LookupResult.translation`, not `HistoryEntry.url` — but the observed fact,
"HistoryEntry has no url", is correct and independently confirmed by reading `types.ts` above.)

There is also **no domain-extraction helper anywhere in the codebase** (confirmed:
`grep -rln "hostname\|registrable\|new URL(" packages/app/src packages/extension-chrome/src`
returns only `domain/error-report.ts`, unrelated) and **no wire message that lists all saved
words**. `domain/saved-words-policy.ts:108-118` exports `savedWordsList(deps): Promise<SavedWordEntry[]>`
("Full list, no pagination — B6 (Words page) is the future consumer; B1 ships the primitive, not
pagination — no callers need it yet"), but `WireMessageSchema` (`packages/app/src/wire.ts:95-141`)
has no `saved.list` arm and `router.ts`'s exhaustive switch (`router.ts:213-287`) has no case that
calls it. Today nothing outside a test can ask the service worker "what are all my saved words."

**Consequently, B15 cannot be built as a pure presentation layer over existing data** — the two
data points its "per-domain tally — lookups and saves per site" (roadmap §4 B15) needs are
partially unavailable: lookups-per-site needs a `url` on `HistoryEntry` that isn't there, and
saves-per-site needs a way to fetch all saved words that isn't there. Both are **additive,
lead-decidable changes** under the wire-evolution precedent CONTRACTS §3 states ("optional
in-flight request/response fields are ordinary evolution, not an escalation... restructuring or
removing a ratified field is a new escalation") — `HistoryEntry` and the existence of a
`saved.list` message are not part of the E1 (`SavedWordEntry`) or E2 (backup envelope) locks, so
adding to them needs no owner escalation. §2 below pins exactly what to add.

## 2. Design questions (each "Lead decides" item pinned)

### 2.1 How does a history entry know its site? — Pinned: add `HistoryEntry.url?: string`

**Pinned:** add an **optional** `url?: string` field to `HistoryEntry`, populated in
`router.ts`'s `handleLookup` from the already-available `req.url` (`LookupRequest.url`, never
persisted before now). Optional, not required, for the same reason `LookupResult.definedAs` /
`.translation` / `.nudge` are optional (`types.ts:64,75,85`): **legacy entries** written before
this card ships lack the field, and `JSON.parse` on an old stored record simply produces
`url: undefined` at runtime — an optional type is the honest reflection of that, not a runtime
guarantee this spec can't back. `extractSiteKey` (§2.2) treats a missing/empty url as "no site",
which degrades legacy entries to "excluded from the tally" rather than crashing or mis-tallying
them under an empty-string bucket.

_Rejected: make `url` required with a `''` default written by a migration._ No migration
mechanism exists for `history:*` entries (contrast `legacy-templates.ts`'s read-time migration for
settings) and this repo's precedent for exactly this situation — a new field that old stored JSON
won't have — is "optional field, treat absence as displayed-differently" (`definedAs`,
`translation`, `nudge` all do this). Writing a one-off migration for one field on one card is
disproportionate to an Impact 2 · Effort S card.

_Rejected: derive the site from `LookupResult` instead of `HistoryEntry`._ `LookupResult`
(`types.ts:41-86`) has no `url` field either and _shouldn't_ gain one — it's the model's answer
payload (markdown, word, target, provider metadata), not page context; `url`/`title`/`sentence`
have always lived on `LookupRequest`/`SavedWordSense`, never on the result. Keeping `url` on
`HistoryEntry` itself (a sibling of `result`, like `word`/`context`/`createdAt` already are) matches
the existing shape's own precedent.

### 2.2 What counts as "the site"? — Pinned: lowercase hostname, `www.` stripped (naive, v1)

**Pinned:** a new pure function `extractSiteKey(url: string | undefined): string | null` in a new
domain module (§3.1) that does `new URL(url).hostname.toLowerCase()`, then strips a leading
`"www."`. Returns `null` for an empty/missing/unparsable url.

This is **not** a full public-suffix-list registrable-domain parse — `a.b.co.uk` stays
`a.b.co.uk`, not `b.co.uk`. That is a deliberate, named v1 limitation, not an oversight, and it
follows the exact precedent B3's design already set for this roadmap: _"Matching = exact
word-boundary + naive plural/-ed/-ing only, no lemmatizer in v1"_ (`docs/ROADMAP.md` §4 B3 scope
fence) — B3 chose naive-first and reserved the harder case (a real lemmatizer) as an owner
escalation (E5) if ever needed. B15 makes the same call for the same reason: the common case
(`www.nytimes.com`, `en.wikipedia.org`, `reddit.com`) is exactly right, the co.uk-style edge case
groups a handful of second-level-domain sites under a slightly-too-specific key instead of a
slightly-too-broad one — a cosmetic miscount, not a data leak or a wrong feature, and safely
correctable later without a schema change (the fix lives entirely inside `extractSiteKey`).

_Rejected: pull in a public-suffix-list library (e.g. `tldts`, `psl`)._ Adds a runtime dependency
and a data file that needs updating as TLDs change, for an Impact 2 · Effort S card whose payoff is
"glanceable," not authoritative analytics. No such dependency exists in this repo today
(`package.json` has none) and none of B15's roadmap text asks for exact eTLD+1 correctness.

_Rejected: use the full page `title` as the grouping key instead of the hostname._ Titles are
free text (i18n'd, changes per-article) and would fragment one site into dozens of "sites" — the
opposite of what a tally is for.

### 2.3 How is "saves per site" computed without a new tracking surface? — Pinned: reuse `SavedWordSense.url` via a new `saved.list` message

**Pinned:** add a wire message `{ type: 'saved.list' }` (payload-free, mirrors `settings.get` /
`cache.clear`) whose router case calls the existing, already-implemented
`savedWordsList({ storage: deps.kv })` (`domain/saved-words-policy.ts:110`) and replies
`{ ok: true, type: 'saved.list', entries: SavedWordEntry[] }`. The side panel's composition root
(§3.3) fetches this alongside `history.list` and both feed `computeSiteLookupStats` (§3.1), which
extracts a site key from each `SavedWordEntry.senses[].url` — a field that has existed since B1's
ratified E1 schema shipped (`SavedWordSense.url`, `types.ts:235`) and needs **no schema change** —
only a way to read _all_ saved entries at once, which is exactly what `saved.list` adds.

This is the reason the roadmap fence — _"Counts from existing lookup history ONLY — never track
pages read or page content (that would be surveillance)"_ (`docs/ROADMAP.md` §4 B15) — is held
exactly: `saved.list` adds **zero new data collection**. Every `url` it reads was already written
by an explicit user action (a lookup, then a star-tap) for an unrelated reason (B1/B2's own save
context capture) long before this card exists. B15 only adds a way to _list_ records the user
already caused to exist, the same way `history.list` already lists what lookups already caused to
exist.

_Rejected: skip "saves" and tally lookups only._ The roadmap's own Missing/Payoff text is explicit
— _"Missing: A per-domain tally — lookups AND saves per site"_ — cutting saves would ship a
narrower feature than the card asks for without an escalation-worthy reason to.

_Rejected: derive "saved" purely by cross-referencing `HistoryEntry.word` against
`SavedWordEntry.word`, skipping a `saved.list` message._ Still needs to enumerate all saved words
from _somewhere_ to build the cross-reference set — the missing `saved.list` primitive is
unavoidable either way, and deriving saves-per-site from history-entry membership (rather than the
saved entry's own `senses[].url`) would silently misattribute a save to whichever site the word was
_first ever looked up on_, not the site the save actually captured — wrong when a word is looked up
on site A, ignored, then re-looked-up and saved on site B (B2's context-capture writes the _save
time_ sentence/url, not history's).

**Wire-evolution classification:** this is a **new message**, not an optional field on an existing
one, so CONTRACTS §2's rule applies directly: _"If the card adds a wire message: the `wire.ts` arm
and its `router.ts` case are ONE task (exhaustive `switch(msg.type)`, no default — they cannot
typecheck apart)."_ Plan Task 2 does exactly this.

**Future reuse — flagged for the orchestrator, not resolved here (no escalation needed):** two
other backlog cards will want the exact same primitives this card is about to create, and should
consume them rather than re-invent them, mirroring the A3→B13 "produce clean extension points and
say so" precedent (CONTRACTS §4):

- **B10 (weekly digest)** lists _"top source sites"_ as part of its stats v1 (`docs/ROADMAP.md` §4
  B10) — it should read `HistoryEntry.url` and reuse `extractSiteKey`/`computeSiteLookupStats`
  (§3.1) instead of adding a second domain-extraction function.
- **B6 (words page)** will need to list all saved words for its collection view
  (`docs/ROADMAP.md` §4 B6) — it should reuse the `saved.list` wire message this card adds instead
  of adding a second "list all saved words" message.

If either card's spec is authored after this one lands, its author should read this spec first.

### 2.4 Where does it render? — Pinned: an always-visible "Sites" section in the side panel, below Recent

**Pinned:** a new section in `side-panel-view.ts`, structurally a sibling of the existing
`.recent` section (`packages/app/src/ui/side-panel-view.ts:150-160`), placed directly below it
inside `<main>`. Always rendered (not behind a settings toggle or a click-to-reveal button),
hidden via the exact same `hidden`-when-empty contract `.recent` already uses
(`side-panel-view.ts:196`, `this.recentEl.hidden = this._recent.length === 0`).

_Rejected: a click-to-expand/lazy-loaded section (only fetch `history.list`/`saved.list` on first
open)._ The roadmap's own payoff language is _"Payoff: A glanceable 'where do I actually learn?'"_
(`docs/ROADMAP.md` §4 B15) — "glanceable" means visible without an extra click, exactly like
Recent already is. A lazy toggle would also need a loading-state contract Recent doesn't have,
adding complexity an Impact 2 · Effort S card doesn't need.

_Rejected: a dedicated full-page "Sites" view (mirroring B6's future words page)._ B6 is a
`needs B1, B2` `Impact 4 · Effort M` card explicitly scoped as a full collection view "search,
filter by status/site, sort by date" — a permanent page. B15 is `Impact 2 · Effort S`; a small,
glanceable panel section matches its scope, and nothing about a small section blocks B6 from later
adding a fuller "Sites" surface if the roadmap ever calls for one.

_Rejected: the in-page floating card (`lookup-card.ts`) instead of the side panel._ The floating
card is transient (dies on click-away/scroll — `docs/ROADMAP.md` §4 A7's own "Today" line) and
per-lookup; a cross-lookup aggregate belongs on the one persistent surface, matching where Recent
(the other cross-lookup view) already lives.

### 2.5 Top-N presentation — Pinned: fixed top 5 by lookup count, no "show more"

**Pinned:** `computeSiteLookupStats` (§3.1) takes a `topN` parameter defaulting to 5 (exported as
`DEFAULT_TOP_SITES = 5`), sorted by `lookups` descending, ties broken by `saves` descending, then
alphabetically by site — deterministic output for a deterministic input, which is what makes the
function unit-testable without a snapshot.

_Rejected: show all sites, let the section scroll._ An unbounded list works against "glanceable" —
a reader with 40 sites in their history would get a scrolling wall of text instead of the
"where do I actually learn?" answer the payoff promises. Five rows is enough to see a clear
leader (the card's own example: _"The Economist drives 10× the lookups of Reddit"_ — a two-line
answer, not a top-40 table).

_Rejected: a user-configurable N in settings._ Adds a settings-form field and a stored preference
for a card whose fence explicitly frames this as "Constraint is a rule, not a choice" for the
no-page-tracking rule — over-engineering the presentation knob isn't warranted by the card's own
Impact/Effort sizing.

### 2.6 Empty state — Pinned: same hidden-when-empty contract as Recent (no separate "0 sites" message)

**Pinned:** `computeSiteLookupStats([], [])` returns `[]`; the side panel's `siteStats` setter
hides the whole section when the array is empty (§3.2), identically to how `.recent` already hides
when `_recent.length === 0` (`side-panel-view.ts:196`) and how the panel's own top-level `.empty`
teaching state already covers "you haven't looked anything up yet" (`side-panel-view.ts:96-105`,
`renderEmpty()`). A brand-new install shows the panel's existing empty state and nothing else;
there is no third, redundant "no site data yet" message to design or maintain.

_Rejected: a dedicated empty-state message inside the Sites section itself_ (e.g. "No site data
yet"). The panel's top-level empty state already teaches "select a word on any page" for the exact
same underlying condition (zero history). A second, section-scoped empty message right below it
would be a near-duplicate the reader sees at the same time, adding noise instead of clarity.

## 3. The change

### 3.1 New — `packages/app/src/domain/site-stats-policy.ts`

Pure, zero-dependency (only imports the two domain types it reads), matching `rule-domain-purity`
exactly the way `nudge-policy.ts`/`history-policy.ts` do:

```ts
import type { HistoryEntry, SavedWordEntry } from './types';

/**
 * B15: default number of sites shown in the side panel's "Sites" section — enough to spot a
 * clear leader without turning into a scrolling table (roadmap: Impact 2 · Effort S, "glanceable"
 * payoff). See the design spec §2.5 for the rejected "show all" / "user-configurable N" alternatives.
 */
export const DEFAULT_TOP_SITES = 5;

export interface SiteLookupStat {
  /** Naive site key: lowercase hostname, leading "www." stripped. See extractSiteKey's doc
   * comment for why this is not a full registrable-domain (eTLD+1) parse in v1. */
  site: string;
  /** Count of HistoryEntry rows whose url resolves to this site. */
  lookups: number;
  /** Count of SavedWordEntry rows with at least one sense whose url resolves to this site. An
   * entry with senses on two different sites counts once for EACH site (never twice for the
   * same site — see the per-entry Set dedup below), so a future multi-sense save (B14) can't
   * inflate a single site's save count just because one word has several senses on that site. */
  saves: number;
}

/**
 * Naive site-key extraction: lowercase hostname with a leading "www." stripped. NOT a full
 * public-suffix-list registrable-domain parse (e.g. "a.b.co.uk" stays "a.b.co.uk", not
 * "b.co.uk") — a deliberate v1 limitation, the same naive-first posture as B3's word matching
 * (roadmap: "no lemmatizer in v1"). Returns null for an empty/missing/unparsable url — the state
 * every HistoryEntry written before this card shipped is in (HistoryEntry.url is optional; see
 * the design spec §2.1), and the state a connection-test's `url: ''` is always in.
 */
export function extractSiteKey(url: string | undefined): string | null {
  if (!url) return null;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (!host) return null;
  return host.startsWith('www.') ? host.slice(4) : host;
}

/**
 * B15: per-domain lookup + save tally, computed ENTIRELY from data the extension already stores
 * for other reasons (history entries from every lookup, saved-word senses from every star tap) —
 * no new tracking surface, honoring the roadmap fence ("counts from existing lookup history
 * only — never track pages read or page content"). Pure and side-effect-free so it is
 * unit-testable without a Storage fake; the side panel composition root is the one caller,
 * handing it entries it already fetched over the wire (see design spec §3.3).
 */
export function computeSiteLookupStats(
  history: readonly HistoryEntry[],
  saved: readonly SavedWordEntry[],
  topN: number = DEFAULT_TOP_SITES,
): SiteLookupStat[] {
  const lookups = new Map<string, number>();
  for (const e of history) {
    const site = extractSiteKey(e.url);
    if (site) lookups.set(site, (lookups.get(site) ?? 0) + 1);
  }
  const saves = new Map<string, number>();
  for (const entry of saved) {
    const sites = new Set<string>();
    for (const sense of entry.senses) {
      const site = extractSiteKey(sense.url);
      if (site) sites.add(site);
    }
    for (const site of sites) saves.set(site, (saves.get(site) ?? 0) + 1);
  }
  const allSites = new Set<string>([...lookups.keys(), ...saves.keys()]);
  const stats: SiteLookupStat[] = [...allSites].map((site) => ({
    site,
    lookups: lookups.get(site) ?? 0,
    saves: saves.get(site) ?? 0,
  }));
  stats.sort((a, b) => b.lookups - a.lookups || b.saves - a.saves || a.site.localeCompare(b.site));
  return stats.slice(0, topN);
}
```

Exported from the package barrel: `packages/app/src/index.ts` gains
`export * from './domain/site-stats-policy';` (alongside the existing
`export * from './domain/nudge-policy';` line).

### 3.2 `packages/app/src/domain/types.ts` — `HistoryEntry` gains `url?`

```ts
export interface HistoryEntry {
  id: string;
  word: string;
  context: string;
  /** B15: the page the lookup happened on, for the side panel's per-domain tally
   * (domain/site-stats-policy.ts). Optional: entries written before this field existed have no
   * `url` at all once JSON.parse'd back from storage — extractSiteKey treats that as "no site"
   * (excluded from the tally), not a crash or a bogus empty-string bucket. */
  url?: string;
  result: LookupResult;
  createdAt: number;
}
```

### 3.3 `packages/app/src/wire.ts` — `HistoryEntrySchema` gets `url`, plus the new `saved.list` message

```ts
const HistoryEntrySchema = z.strictObject({
  id: z.string(),
  word: z.string(),
  context: z.string(),
  url: z.string().optional(), // B15
  result: LookupResultSchema,
  createdAt: z.number(),
});
```

New arm on `WireMessageSchema` (placed after the existing `saved.setStatus` arm, before
`cache.clear`, keeping every `saved.*` arm grouped):

```ts
  // B15: list every saved word (no filter/pagination — mirrors savedWordsList's own contract).
  // Consumed today by the side panel's per-domain save tally; B6 (words page) is a documented
  // future consumer of this same message (design spec §2.3).
  z.object({ type: z.literal('saved.list') }),
```

New entry in `MessageTypeEnum` (alphabetically grouped with the other `saved.*` entries):

```ts
const MessageTypeEnum = z.enum([
  'lookup',
  'lookup.cancel',
  'settings.get',
  'history.list',
  'history.clear',
  'history.delete',
  'cache.clear',
  'connection.test',
  'open-options',
  'errlog.status',
  'errlog.set-consent',
  'saved.save',
  'saved.delete',
  'saved.setStatus',
  'saved.list', // B15
]);
```

New arm on `WireReplySchema` (placed after the existing `'saved'` reply arm):

```ts
  // B15: the full saved-word list. A distinct reply `type` from the singular 'saved' reply
  // (saved.save/saved.setStatus reply with one entry; this replies with all of them).
  z.object({
    ok: z.literal(true),
    type: z.literal('saved.list'),
    entries: z.array(SavedWordEntrySchema),
  }),
```

No change to the `AssertEqual` compile-time drift-guard block (`wire.ts:201-210`) — it checks
`HistoryEntrySchema` against `HistoryEntry` (still holds after §3.2's matching edits) and does not
enumerate individual `WireMessageSchema`/`WireReplySchema` arms (only the five payload-shape
types), so adding a new discriminated-union arm needs no new assertion there.

**`wire-schema.snapshot.json` must be regenerated** (`packages/app/wire-schema.snapshot.json`,
asserted by the `'JSON-schema snapshot is stable (spec §8.5)'` test in `wire-schema.test.ts:405-409`
via `toMatchFileSnapshot`) — Plan Tasks 1 and 2 each end with
`cd packages/app && bunx vitest run test/wire-schema.test.ts -u` to regenerate it against the
updated schema, then commit the file alongside the code change that caused the diff.

### 3.4 `packages/app/src/app/router.ts` — carry `url` into history, add the `saved.list` case

`handleLookup`'s `HistoryEntry` construction (`router.ts:141-147`) gains one field:

```ts
const entry: HistoryEntry = {
  id: crypto.randomUUID(),
  word: req.word,
  context: req.context,
  url: req.url, // B15
  result: storableResult,
  createdAt: result.fetchedAt,
};
```

New import (`router.ts:1-24`'s import block gains `savedWordsList` alongside the existing
`savedWordUpsert, savedWordDelete, savedWordSetStatus` imports from `../index`).

New switch case, placed after the existing `'saved.setStatus'` case (`router.ts:261-266`), before
`'cache.clear'`:

```ts
      case 'saved.list': {
        const entries = await savedWordsList({ storage: deps.kv });
        return { ok: true, type: 'saved.list', entries };
      }
```

Read-only — no `deps.queue.run(...)` wrapper needed (matches `handleHistoryList`'s own read-only
pattern, `router.ts:183-193`, which also skips the write queue).

### 3.5 `packages/app/src/ui/side-panel-view.ts` — new "Sites" section

New import: `import type { SiteLookupStat } from '../domain/site-stats-policy';` (alongside the
existing `import type { HistoryEntry } from '../domain/types';`).

New CSS rules, inserted immediately after the existing `.recent-context{...}` rule and before
`footer{...}` (`side-panel-view.ts:87-88`):

```css
.sites {
  margin-top: 6px;
}
.sites[hidden] {
  display: none;
}
.sites-head {
  margin: 0;
  padding: 14px 0 8px;
  border-top: 1px solid var(--ad-line);
  font-size: var(--adp-text-2xs);
  font-weight: var(--adp-weight-bold);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ad-ink-soft);
}
.sites-list {
  list-style: none;
  margin: 0 0 8px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.site-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px;
  margin: 0 -10px;
  border-radius: var(--adp-radius-control);
}
.site-name {
  font-size: 14px;
  font-weight: var(--adp-weight-semi);
  color: var(--ad-ink);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.site-counts {
  flex: none;
  font-size: var(--adp-text-xs);
  color: var(--ad-ink-soft);
}
```

(Every value is an existing `--ad-*`/`--adp-*` token or a bare layout number, exactly like the
`.recent-*` rules it sits beside — no new colors, no hard-coded hex/oklch.)

New private fields on the `SidePanelView` class (alongside `recentEl`/`recentList`):
`sitesEl!: HTMLElement`, `sitesList!: HTMLUListElement`, `_siteStats: SiteLookupStat[] = []`.

`connectedCallback`'s DOM-construction block (`side-panel-view.ts:150-162`) gains the sites
section, built the same way `recentEl` is, and `main.append(...)` now includes it:

```ts
// B15: per-domain lookup/save tally — same hidden-when-empty contract as Recent (§2.6). A
// plain-text heading (no icon), matching Recent's own no-icon heading.
this.sitesEl = document.createElement('section');
this.sitesEl.className = 'sites';
this.sitesEl.setAttribute('aria-label', 'Site lookup stats');
this.sitesEl.hidden = true;
const sitesHead = document.createElement('h2');
sitesHead.className = 'sites-head';
sitesHead.textContent = 'Sites';
this.sitesList = document.createElement('ul');
this.sitesList.className = 'sites-list';
this.sitesEl.append(sitesHead, this.sitesList);

main.append(this.focusEl, this.recentEl, this.sitesEl);
```

The existing `this.renderFocus(); this.renderRecent();` call at the end of the first-time setup
block gains a third call: `this.renderSites();`.

New setter/getter (alongside the existing `recent` accessor pair, `side-panel-view.ts:181-188`):

```ts
  /** B15: per-domain tally, top-N already applied by the caller (computeSiteLookupStats). An
   * empty array collapses the section — same contract as `recent`. */
  set siteStats(stats: SiteLookupStat[]) {
    this._siteStats = stats;
    if (this.shadowRoot) this.renderSites();
  }
  get siteStats(): SiteLookupStat[] {
    return this._siteStats;
  }
```

New render methods (alongside `renderRecent`/`recentRow`, `side-panel-view.ts:195-237`):

```ts
  private renderSites(): void {
    this.sitesEl.hidden = this._siteStats.length === 0;
    this.sitesList.replaceChildren(...this._siteStats.map((s) => this.siteRow(s)));
  }

  private siteRow(s: SiteLookupStat): HTMLLIElement {
    const li = document.createElement('li');
    li.className = 'site-row';
    const name = document.createElement('span');
    name.className = 'site-name';
    name.textContent = s.site;
    const counts = document.createElement('span');
    counts.className = 'site-counts';
    const lookupWord = s.lookups === 1 ? 'lookup' : 'lookups';
    counts.textContent =
      s.saves > 0 ? `${s.lookups} ${lookupWord} · ${s.saves} saved` : `${s.lookups} ${lookupWord}`;
    li.append(name, counts);
    return li;
  }
```

No interactivity (no click handler, no events dispatched) — a read-only list, matching §2.4's
pinned scope (no drill-down surface in v1).

### 3.6 `packages/extension-chrome/src/side-panel.ts` — fetch + wire the tally

New import additions to the existing `@ai-dict/app` import block:
`computeSiteLookupStats, type SiteLookupStat`.

New function, placed directly after `refreshRecent` (`side-panel.ts:130-143`):

```ts
/**
 * B15: per-domain lookup/save tally shown in the panel's "Sites" section. Computed from the
 * FULL stored history/saved-word log, not just the last-50 slice `refreshRecent` shows to
 * Recent — `history.list` with no `limit` returns every entry (history-policy's own default),
 * the exact same call shape "Export history" already uses (options.ts:158-160), so a site's
 * true lifetime lookup count is never undercounted by Recent's display cap. Both `history.list`
 * and `saved.list` are read-only; no new tracking surface (design spec §2.3).
 */
async function refreshSiteStats(): Promise<void> {
  try {
    const [historyRaw, savedRaw]: [unknown, unknown] = await Promise.all([
      chrome.runtime.sendMessage({ type: 'history.list' }),
      chrome.runtime.sendMessage({ type: 'saved.list' }),
    ]);
    const historyReply = historyRaw as WireReply | undefined;
    const savedReply = savedRaw as WireReply | undefined;
    const history =
      historyReply && historyReply.ok && historyReply.type === 'history'
        ? historyReply.entries
        : [];
    const saved =
      savedReply && savedReply.ok && savedReply.type === 'saved.list' ? savedReply.entries : [];
    view.siteStats = computeSiteLookupStats(history, saved);
  } catch {
    // Site stats are a convenience view; a failed query just leaves the section as-is.
  }
}
```

Four call sites (each already has a natural place to add one line):

1. Boot sequence (`side-panel.ts:312-313`) — alongside the existing `void refreshRecent();`:

```ts
void refreshRecent();
void refreshSiteStats(); // B15
void initFromSettings().then(() => recoverFocus());
```

2. The `'delete'` listener (`side-panel.ts:159-168`) — its `finally` block currently awaits only
   `refreshRecent()`; a history delete can also change a site's lookup count:

```ts
view.addEventListener('delete', (e) => {
  const { id } = (e as CustomEvent<{ id: string }>).detail;
  void (async () => {
    try {
      await chrome.runtime.sendMessage({ type: 'history.delete', id });
    } finally {
      await Promise.all([refreshRecent(), refreshSiteStats()]); // B15: also refresh the tally
    }
  })();
});
```

3. The mirror `onMessage` handler's `'result'` branch (`side-panel.ts:256-268`) — a fresh lookup
   changes the lookup tally the moment it lands, and the router has already appended it to
   history by the time this message arrives (mirrors the existing `void refreshRecent();` comment
   at `side-panel.ts:267`):

```ts
// The router just appended this lookup to history; pull it into Recent + the site tally.
void refreshRecent();
void refreshSiteStats(); // B15
```

4. The `'toggle-save'` listener (`side-panel.ts:179-200`) — a save/unsave changes the saves
   tally; appended after the existing `.catch(() => undefined);`:

```ts
void chrome.runtime
  .sendMessage(message)
  .then((raw: unknown) => {
    if (!saveReplyGuard.isCurrent(token)) return; // a later click/render already superseded this reply
    const reply = raw as WireReply | undefined;
    if (willSave && reply?.ok && reply.type === 'saved') {
      lastStatus = reply.entry.status;
      setStatus(lastStatus);
    }
  })
  .catch(() => undefined)
  .finally(() => void refreshSiteStats()); // B15: a save/unsave changes the saves tally
```

**No change** to `content.ts` or `chrome-side-panel-mirror.ts`. A save made from the **in-page**
card (not the side panel) does not currently notify the panel at all — the mirror
(`chrome-side-panel-mirror.ts`) only posts `loading`/`result`/`error`/`close` states, never a
save/unsave — so the side panel's `recent` list _already_ has this exact same
staleness-until-next-panel-action characteristic today (confirmed by reading `content.ts:146-169`
and `chrome-side-panel-mirror.ts` in full: no save-related message is ever posted to `{ to:
'side-panel' }`). Site stats inherit the identical, already-accepted freshness model: the panel's
own data refreshes on the panel's own actions and whenever it mirrors a fresh lookup from any
surface; a save made purely from the in-page card becomes visible in the panel the next time the
panel opens (its own boot-time `refreshSiteStats()`) or mirrors a new lookup. This is not a new
limitation B15 introduces — it is Recent's existing contract, inherited unchanged.

### 3.7 No change to `packages/extension-chrome/src/content.ts`

Confirmed in §3.6 above — the in-page floating card has no site-stats surface (§2.4 pins the side
panel as the only presentation surface) and needs no new listeners.

### 3.8 No change to `packages/app/src/app/history-export.ts`

`buildHistoryExport` (`history-export.ts:10-32`) deliberately reconstructs each exported field
by hand rather than spreading the entry, specifically so a stray property can never leak into an
exported file (its own doc comment: _"so any stray property that rode along on an entry ... can
never survive into the exported file"_). Adding `url` to the export whitelist is a legitimate
future enhancement but is **out of scope for B15** — this card's fence is about the side panel's
tally, not about what "Export history" (a B8/B9-adjacent feature) includes. Leaving the export
function untouched means B15 cannot accidentally change B8/B9's already-shipped/spec'd export
contract.

### 3.9 No change to `packages/app/src/domain/history-policy.ts`, `cache-policy.ts`, `saved-words-policy.ts`

`historyAppend`/`historyList`/etc. already round-trip whatever shape `HistoryEntry` has via
`JSON.stringify`/`JSON.parse` (`history-policy.ts:23,44` etc.) — adding an optional field to the
type needs no change to the functions that persist/read it. `savedWordsList` already exists and is
reused verbatim (§3.4) — no change needed there either. No new storage keyspace is introduced
(`ref-kv-storage-prefixes` is unaffected — B15 reads the existing `history:*` and `saved:*`
prefixes only).

### 3.10 C3 note

No new C3 entity. `site-stats-policy.ts` groups under the existing `c3-112 persistence-policies`
component, the same grouping `cache-policy.ts`/`history-policy.ts`/`nudge-policy.ts` already share
(per `REPO-FACTS.md` §0's topology summary — the `c3` CLI itself was not available in this
authoring session to run `c3 lookup`/`c3 sweep` directly; this grouping is inferred from the
documented topology, not independently re-verified by CLI, and is listed under "facts I could not
verify" below). The plan's final task notes this as the C3 sweep item per CONTRACTS §2 (`.c3/` is
CLI-only) rather than hand-editing `.c3/`.

## 4. Scope fence (from the card, held exactly)

- **"Counts from existing lookup history ONLY — never track pages read or page content"** — held:
  every field B15 reads (`HistoryEntry.url`, `SavedWordSense.url`) is written by an _existing_,
  already-shipped user action (a lookup, a save) for a reason that predates this card. No new
  event listener, no new "page visited" hook, no new keyspace. §2.3 above states this explicitly.
- **No background computation** — `computeSiteLookupStats` runs only when the side panel
  fetches fresh data (panel open, a delete, a fresh mirrored lookup, a save/unsave) — never on a
  timer, never in the service worker.
- **No new manifest permission** — nothing in this card touches `manifest.json`; `history.list`/
  `saved.list` are ordinary `chrome.runtime` messages the extension already sends constantly.
- **Design tokens only** — §3.5's new CSS rules are 100% `--ad-*`/`--adp-*` values.
- **S1 unaffected** — `url` (a page address) and site keys derived from it are not secrets; no
  path in this card touches `apiKey`/`openaiApiKey`/`anthropicApiKey`. `saved.list`'s reply is the
  existing `SavedWordEntrySchema` (`z.strictObject`, no key field ever existed on it).
- **S4 unaffected** — this card renders plain text (site names, counts) via `textContent`, never
  `innerHTML` of model output; no markdown, no sanitize-step interaction.

## 5. Testing strategy

1. **Unit — new `packages/app/test/site-stats-policy.test.ts`:**
   - `extractSiteKey` strips a leading `www.`, lowercases the host, returns `null` for `''`/
     `undefined`/a malformed string (`'not a url'`).
   - `computeSiteLookupStats` tallies lookups per site from `HistoryEntry[]`, ignoring entries
     with no resolvable `url` (undefined, empty, malformed).
   - Tallies saves per site from `SavedWordEntry[]`, counting a multi-sense entry on the SAME
     site only once (dedup via the per-entry `Set`).
   - Sorts by `lookups` desc, ties broken by `saves` desc, then alphabetically.
   - Respects `topN` (default 5; a 6th site is dropped by the default, present when `topN` is
     raised).
   - Returns `[]` for empty inputs.
2. **Unit — `packages/app/test/history-policy.test.ts` extension:** a round-trip test — append an
   entry carrying `url`, read it back via `historyList`, assert `url` survived
   (`historyAppend`/`historyList` are pure JSON round-trip, so this is really asserting the type
   change didn't break anything, not new logic).
3. **Unit — `packages/app/test/wire-schema.test.ts` extension:** `saved.list` message parses;
   `saved.list` reply parses with an empty and a populated `entries` array; a `HistoryEntrySchema`
   parse with and without `url` both succeed (back-compat, mirroring the existing `definedAs`/
   `translation`/`nudge` back-compat tests already in this file).
4. **Unit — `packages/app/test/app/router.test.ts` extension:** `saved.list` on an empty store
   replies `{ ok: true, type: 'saved.list', entries: [] }`; after a `saved.save`, `saved.list`
   includes it; a `lookup` miss's resulting `HistoryEntry` (read back via `historyList`) carries
   `url: req.url`.
5. **Unit — `packages/app/test/ui/side-panel-view.test.ts` extension:** `siteStats = []` hides
   `.sites`; a populated array shows rows in the given order (sorting is the domain function's
   job, not the view's) with the exact `"N lookups · M saved"` / `"1 lookup"` (singular) text;
   `.sites` has no interactive elements (no `button`/`a` inside `.site-row`); an axe-violations
   check with `siteStats` populated (mirrors the file's existing a11y checks).
6. **e2e — new `packages/extension-chrome/e2e/b15-site-lookup-stats.spec.ts`:**
   - Two lookups on one fixture site + one lookup on a second, differently-hosted fixture route
     (a second `page.route(...)` registered inline in the spec, not added to the shared
     `helpers.ts`, to avoid touching a file other in-flight cards may also be editing — see §6
     Concurrency) → opening the side panel shows both sites, the first with `"2 lookups"`, the
     second with `"1 lookup"`.
   - Star-saving one of the looked-up words → the side panel's row for that word's site gains
     `"· 1 saved"`.
   - A fresh profile with zero history → the `.sites` section is not present in the accessibility
     tree (hidden), matching the panel's existing empty teaching state.

## 6. Testing performed (PR evidence — replaces screenshot/video capture)

Per this worktree's `CLAUDE.md` (owner ruling 2026-07-16): **no screenshots or video for this PR.**
The PR body's "Testing performed" section lists the suites above with pass counts (lint, format
check, typecheck for both `packages/app` and `packages/extension-chrome`, the full unit suite,
and the new/updated e2e specs run with `GEMINI_API_KEY=` cleared) — matching exactly what §5
enumerates.

## 7. Risk / rollback

- **Risk: low.** The two additive wire changes (`HistoryEntry.url`, `saved.list`) are both
  read/append-only extensions of existing, already-well-tested primitives
  (`historyAppend`/`historyList`, `savedWordsList`) — no existing behavior branches on the new
  field or message, so nothing existing can regress by their mere presence. The riskiest single
  line is `router.ts`'s one-line `url: req.url` addition to `handleLookup`, covered directly by
  the router test in §5.4.
- **Known, accepted perf characteristic (not a new regression):** `refreshSiteStats()` calls
  `history.list` with no `limit`, which — like the "Export history" call it mirrors
  (`options.ts:158-160`) — reads every stored history entry (up to the existing 500-entry cap)
  via `historyList`'s sequential per-id `storage.getItem` loop (`history-policy.ts:41-45`). This
  is the same O(n) pattern `historyList`/`savedWordsList` have always had (no batch-read exists on
  the `Storage` port) — B15 does not introduce a new performance characteristic, it is simply the
  first _panel-open-time_ caller of the unlimited variant (the existing caller, "Export history",
  is an explicit, occasional user click). Bounded by the same 500-entry cap `cache-policy.ts`/
  `history-policy.ts` already enforce; no new cap is needed. Left as a known v1 characteristic
  rather than optimized, matching the card's own Impact 2 · Effort S sizing — a future card could
  add a running counter if this ever proves slow in practice.
- **No data migration.** `HistoryEntry.url` is optional; every entry written before this card
  ships simply lacks it, and `extractSiteKey` treats that as "excluded from the tally" — never a
  crash, never a mis-tally.
- **Rollback:** revert the single PR. `HistoryEntry`/`WireMessageSchema`/`WireReplySchema` return
  to their pre-B15 shapes; no stored data becomes invalid (an entry written _with_ `url` by a
  B15-era build simply has an extra field a rolled-back build ignores, same as any other additive
  field rollback in this codebase's history — e.g. B7's `nudge` field).

## 8. Files touched (summary)

| File                                                          | Change                                                                                                        |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `packages/app/src/domain/site-stats-policy.ts`                | **New** — `extractSiteKey`, `computeSiteLookupStats`, `SiteLookupStat`, `DEFAULT_TOP_SITES`                   |
| `packages/app/src/index.ts`                                   | + `export * from './domain/site-stats-policy';`                                                               |
| `packages/app/src/domain/types.ts`                            | `HistoryEntry` + `url?: string`                                                                               |
| `packages/app/src/wire.ts`                                    | `HistoryEntrySchema` + `url`; new `saved.list` message arm, `MessageTypeEnum` entry, and reply arm            |
| `packages/app/wire-schema.snapshot.json`                      | Regenerated (`vitest -u`) after each wire.ts change                                                           |
| `packages/app/src/app/router.ts`                              | `handleLookup`'s `HistoryEntry` gains `url: req.url`; new `'saved.list'` switch case; import `savedWordsList` |
| `packages/app/src/ui/side-panel-view.ts`                      | New "Sites" section: CSS, fields, `siteStats` accessor, `renderSites`/`siteRow`                               |
| `packages/extension-chrome/src/side-panel.ts`                 | New `refreshSiteStats()`; wired into boot, `'delete'`, mirror `'result'`, `'toggle-save'`                     |
| `packages/app/test/site-stats-policy.test.ts`                 | **New** — unit tests for the pure domain function                                                             |
| `packages/app/test/history-policy.test.ts`                    | + url round-trip test                                                                                         |
| `packages/app/test/wire-schema.test.ts`                       | + `saved.list` message/reply tests, `HistoryEntrySchema.url` back-compat test                                 |
| `packages/app/test/app/router.test.ts`                        | + `saved.list` tests, history-entry-carries-url test                                                          |
| `packages/app/test/ui/side-panel-view.test.ts`                | + `siteStats` rendering/hidden/a11y tests                                                                     |
| `packages/extension-chrome/e2e/b15-site-lookup-stats.spec.ts` | **New** — functional e2e (§5.6)                                                                               |

No change to `packages/app/src/app/history-export.ts`, `packages/app/src/domain/history-policy.ts`,
`packages/app/src/domain/cache-policy.ts`, `packages/app/src/domain/saved-words-policy.ts`,
`packages/extension-chrome/src/content.ts`, `packages/extension-chrome/src/adapters/chrome-side-panel-mirror.ts`,
`packages/app/src/ui/settings-form.ts`, or any manifest file.

## 9. Concurrency

Files this card modifies that other **unshipped** roadmap cards also modify, per CONTRACTS §5's
known-hot-file table (some of these additions are not yet listed in that table — flagged
explicitly below so the orchestrator can serialize correctly):

- **`packages/app/src/ui/side-panel-view.ts` / `packages/extension-chrome/src/side-panel.ts`** —
  CONTRACTS §5 already lists the side panel as a hot file for **A2, B6, B10, B11**; **B15 must be
  added to that set** (it was not listed there, but this card demonstrably touches both files).
  Serialize B15 against whichever of A2/B6/B10/B11 is in flight at the same time.
- **`packages/app/src/wire.ts` / `packages/app/src/app/router.ts`** — CONTRACTS §5 lists
  "wire+router (any card adding messages)" as a hot-file class; B15 adds `saved.list`, joining
  A3 (`LookupRequest.refine`), B12, B14, and any future B6 delete-message work in that class.
  Two cards adding _different_ new message types to the same `switch` in parallel will conflict on
  the same few lines even though their payloads are unrelated — serialize.
- **`packages/app/src/domain/types.ts`** — touched by this card (`HistoryEntry.url?`) and by every
  E1-schema-adjacent card (B13, B14) touching `SavedWordEntry`/`SavedWordSense` instead — different
  interfaces in the same file, low collision risk, but still worth a diff-before-rebase check if
  landing concurrently with B13/B14.
- **Forward pointer (not a same-file conflict today, a design-reuse note):** per §2.3's "future
  reuse" callout, **B10**'s "top source sites" stat and **B6**'s "list all saved words" need
  should consume `extractSiteKey`/`computeSiteLookupStats` and the `saved.list` message this card
  adds, respectively, rather than re-implementing either. Whichever of {B15, B10} or {B15, B6}
  ships its spec first should be read by the other's author before that author's own design
  questions are pinned.

## 10. Facts I could not verify

- **The `c3` CLI was not available in this authoring session** (`c3 lookup`/`c3 list` both failed
  with "command not found"). §3.10's "no new C3 entity, groups under `c3-112`" conclusion is
  inferred from `REPO-FACTS.md`'s documented topology summary, not independently re-confirmed by
  running `c3 lookup packages/app/src/domain/history-policy.ts` myself. The plan's final task
  still routes this through the standard "run the C3 sweep, don't hand-edit `.c3/`" instruction so
  a real CLI run at implementation time will catch any mismatch.
- **The e2e suite was not executed in this authoring session** (no build/run step was performed;
  REPO-FACTS.md §14 notes the same limitation repo-wide as of 2026-07-17). The new
  `b15-site-lookup-stats.spec.ts` scenarios in §5.6 are designed against the same fixtures/helpers
  patterns every other passing spec in `packages/extension-chrome/e2e/` uses, but have not
  themselves been run.
