# B6 — Words page

Roadmap card: `docs/ROADMAP.md` §4 B6 (Impact 4 · Effort M · Score 2.0 · _needs B1, B2_).
Depends on: B1 (save word — shipped), B2 (rich context capture — shipped). Escalate: none (card's
own fence).

## 1. Problem (grounded in code)

Today the side panel (`packages/app/src/ui/side-panel-view.ts`) shows exactly one persistent
surface: the current lookup's **focus** region plus a flat, linear **Recent** list drawn from
`history.list` (`side-panel-view.ts:181-198`, `side-panel.ts:130-143`). Recent is capped at 500
entries by `history-policy.ts`'s `DEFAULT_CAP` and has no search box, no filter, and no sort
control — it is a scrollable list and nothing else. Saved words (B1/B2) are a completely separate
keyspace (`saved:*`, `domain/saved-words-policy.ts:4`) with **no collection UI anywhere**: the only
places a saved word's status is visible today are (a) the single currently-open card/panel focus,
via `renderSaveRow`/`renderStatusBtn` (`packages/app/src/ui/lookup-card.ts:322-380`), which shows
one word at a time and only while its lookup is on-screen, and (b) raw `chrome.storage.local`,
which no UI ever lists. A reader with 300 saved words has no way to see, search, or manage them —
exactly the "junk drawer" the card names.

The domain primitive to list them already exists and was built anticipating this exact card:

```ts
/** Newest-saved-first (mirrors historyList's index order). Full list, no pagination — B6 (Words
 * page) is the future consumer; B1 ships the primitive, not pagination (no callers need it yet). */
export async function savedWordsList(deps: SavedWordsDeps): Promise<SavedWordEntry[]> { … }
```

(`packages/app/src/domain/saved-words-policy.ts:108-118`) — but it is never called by
`buildRouter` (`packages/app/src/app/router.ts`) and has no wire-protocol exposure. This is the
one genuinely missing piece; see §2.1 below, which corrects an assumption in this card's dispatch
brief.

## 2. Design questions (the card's "Lead decides" list), pinned

### 2.1 What wire surface exists today for `saved:*`, and what is actually missing?

The dispatch brief for this card lists "saved.save/saved.list/saved.setStatus" as what already
exists and asks whether _delete_ needs a new message. Direct reading of the worktree shows the
opposite split:

| Message                | Exists?        | Where                                                                                                                                                                    |
| ---------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `saved.save`           | ✅             | `wire.ts:111-119`, `router.ts:242-257`                                                                                                                                   |
| `saved.delete`         | ✅             | `wire.ts:120`, `router.ts:258-260`                                                                                                                                       |
| `saved.setStatus` (B5) | ✅             | `wire.ts:123-127`, `router.ts:261-266`                                                                                                                                   |
| `saved.list`           | ❌ **missing** | domain fn exists (`saved-words-policy.ts:110`) but no wire arm, no router case, no caller anywhere (`grep -rn "saved\.list" packages/` returns nothing before this card) |

**Pinned: `saved.list` is the only new wire message this card adds; `saved.delete` is reused
verbatim, unchanged.** Per the B5/B3 plan-authoring rule (`docs/ROADMAP.md` §8, 2026-07-16 —
`router.ts`'s exhaustive `switch(msg.type)` has no `default`, so a new arm and its case cannot
typecheck apart), the `wire.ts` arm and `router.ts` case for `saved.list` are ONE task (Task 2
below).

### 2.2 Where does the collection view live?

**Pinned: a new custom element, `<words-page-view>`, permanently mounted in `side-panel.html`
alongside `<side-panel-view>`, shown/hidden via inline `style.display` toggled by a new "My Words"
header button.** Concretely:

- `side-panel-view.ts` gains a header nav button (next to the existing Settings button,
  `side-panel-view.ts:130-140`) that dispatches a composed `open-words` event.
- `side-panel.html` gains a second top-level element: `<words-page-view style="display:none">`.
- The Chrome composition root (`side-panel.ts`) listens for `open-words` → hides
  `<side-panel-view>` / shows `<words-page-view>` (and fetches `saved.list`); `<words-page-view>`
  dispatches `back` → the reverse.

**Rejected alternatives:**

- **(a) Reuse `renderCardState`'s single-focus surface** (`lookup-card.ts:240-288`,
  `renderSaveRow`/`renderStatusBtn`). That machinery is built around ONE word bound to
  composition-root closures (`lastSavePayload`/`lastStatus` in `side-panel.ts:38-51`) — it has no
  concept of a list of many independent rows, each needing its own click target carrying its own
  word/status. Retrofitting it to a list would mean rewriting its core contract, not reusing it.
- **(b) A new tab / options page.** Directly forbidden by the card's own scope fence: "Lives in the
  side panel, not a new options tab."
- **(c) `document.body.replaceChildren(...)`** (the pattern `options.ts`'s `mountOnboarding`/
  `mountSettings` use, `options.ts:84-111,181-207`). That destroys and recreates the DOM node on
  every navigation — for the options page that's fine (onboarding→settings is a one-way,
  one-time transition), but here it would tear down `<side-panel-view>`'s live focus/Recent state
  (and its `renderFocus`/`renderRecent` internal fields) every time the reader glances at their
  word list and comes back — a real regression versus today's persistent panel. Keeping both
  elements mounted and toggling visibility preserves exactly what's on screen when the reader
  returns.

**A grounded implementation gotcha this pin depends on — do NOT use the `hidden` boolean
attribute for the toggle.** `side-panel-view.ts:33`'s host rule is:

```css
:host{…;display:flex;flex-direction:column;height:100dvh;…}
```

This is an unconditioned author-stylesheet declaration inside the component's own shadow DOM. Per
CSS cascade-origin ordering, **author-normal declarations always beat user-agent-normal
declarations at equal specificity, regardless of selector weight** — and the browser's own
`[hidden]{display:none}` rule is exactly a user-agent-normal declaration. Setting the light-DOM
`hidden` attribute on `<side-panel-view>` would therefore do nothing: the shadow root's own
`:host{display:flex}` keeps winning and the element stays visible. `<words-page-view>` will have
the identical `:host{display:flex;…}` top-level rule (§3.4), so it has the same problem. **Pinned
fix: toggle `element.style.display` (an inline style) from the composition root instead** — an
inline style outranks every stylesheet-origin declaration, author or UA, so it reliably wins
regardless of what either component's own `:host{}` rule says.

### 2.3 Filter/sort UI shape

**Pinned, exact controls (all native form elements, no new dependency):**

- **Search** — `<input type="search" class="search">`, live-filtered on `input` (no debounce — see
  §2.4 for why that's cheap enough). Matches (case-insensitive substring) against `entry.word` OR
  any sense's `definition`/`translation`/`sentence`.
- **Status filter** — `<select class="status-filter">`: `All statuses` (default) / `Learning` /
  `Known`.
- **Site filter** — `<select class="site-filter">`: `All sites` (default), then one option per
  distinct hostname found across the loaded entries' `senses[].url`, alphabetical, plus an
  `Unknown site` bucket (value `unknown`) that appears **only** if at least one entry has no
  parseable url. Options are rebuilt every time the full entry list changes (not on every
  keystroke — see `words-page-view.ts`'s `refreshSiteOptions`, §3.4).
- **Sort** — `<select class="sort">`: `Newest first` (default) / `Oldest first` / `A–Z`.

**Site precision — plain hostname, not registrable-domain.** The roadmap already anticipates a
"registrable domain" concept for A13/B15, but neither is built yet — `grep -rn
"registrable.domain\|eTLD\|public.suffix" packages/` returns nothing in this worktree. Building or
vendoring a public-suffix-list parser for this one card would be new scope disproportionate to a
words-page filter; `new URL(sense.url).hostname` (e.g. `"docs.example.com"`, not folded to
`"example.com"`) is the pinned extraction, wrapped in `try/catch` so an empty/legacy/unparseable
url contributes to the `unknown` bucket instead of throwing. If A13/B15 later add a shared
registrable-domain utility, this filter is a natural, isolated follow-up to adopt it — out of
scope here.

**Sort — "newest/oldest/alphabetical" only; NOT "lookup-count."** The roadmap's original card text
(§4) says "sort by date **or lookup-count**"; this card's dispatch brief narrows the required set
to "sort by date" and omits lookup-count — that narrowing is treated as the binding scope here.
Lookup-count would need cross-referencing `history.list`, which is cursor-paginated and capped at
500 (`history-policy.ts` `DEFAULT_CAP`) — a word looked up more than the cap's worth of times ago,
or whose history entries have scrolled off, could never get an accurate count without fetching
every page up to the cap on every panel open. That is real, independent scope (arguably its own
future idea, and adjacent to B15's "per-domain tally from existing history" pattern) — deferred,
not silently dropped.

### 2.4 Virtualization/pagination stance for 300+ entries

**Pinned: no virtualization, no cap. Every filtered/sorted match renders, full `replaceChildren`
on any filter/sort/data change.** This mirrors the exact pattern the Recent list already uses
today (`side-panel-view.ts`'s `renderRecent`: `this.recentList.replaceChildren(...this._recent
.map(...))`, `side-panel-view.ts:197`) — the same codebase precedent, just applied to the (larger,
but still local, text-only) saved-word set.

Rationale:

- Rows are plain text (word, one sentence line, a status button, a delete icon) — no images, no
  iframes, no canvas. Chromium lays out hundreds of simple flex rows in single-digit milliseconds;
  this is not the workload virtual-scrolling libraries exist to solve.
- The project ships zero DOM-virtualization dependency today (`package.json` audit across all
  three packages) and the whole UI layer is framework-free custom elements by deliberate
  architecture (`design-system/IMPLEMENTATION_GUIDE.md`, "Paperlight"). Pulling in a windowing
  library for one feature — or hand-rolling DOM recycling — is a real new complexity/bug surface
  for a data volume ("hundreds" of rows) that does not need it.
- The card's own payoff is "any saved word findable in under 5 seconds" — an unpaginated,
  fully-rendered list is what makes the search box actually search **everything** at once;
  windowed/paginated rendering would either need the search to defeat the pagination (fetch
  everything anyway) or accept "can't find a word that's off-screen/unpaginated," which is the
  opposite of the card's goal.

**Rejected: cursor-based pagination riding a paginated `saved.list`.** `savedWordsList` has no
pagination primitive today (`saved-words-policy.ts:110-118` — full list only); inventing one is
strictly more wire/router/domain surface than the plain, full-list `saved.list` this card needs
(§2.1), for a benefit (bounded payload size) that a local vocabulary of even a few thousand small
JSON objects doesn't need — `chrome.storage.local` has no meaningful read-latency cliff at that
scale for a side-panel-local operation.

### 2.5 Row actions — status edit and delete

**Pinned: reuse `saved.setStatus` (B5) and `saved.delete` (B1) verbatim — zero new messages for
either.** Each row's status button computes the flip itself (it already has the entry's current
`status` in hand, unlike the single-focus surface's closure-based flip in `side-panel.ts:203-211`)
and dispatches a composed `toggle-status` event carrying `{ word, status: <next> }`; the delete
icon dispatches a composed `delete-word` event carrying `{ word }`. The Chrome composition root
applies an **optimistic, no-rollback** local update (splice/patch the in-memory array, re-render)
and fires the corresponding wire message with `.catch(() => undefined)` — the exact same tolerance
`side-panel.ts`'s existing `toggle-save`/`toggle-status` listeners already apply
(`side-panel.ts:179-211`). A failed round trip (extension context torn down mid-flight, the only
realistic failure mode for a local KV write) leaves the panel's view momentarily stale until the
next `saved.list` fetch — an accepted, already-precedented trade-off, not a new risk.

The event name `delete-word` (not `delete`) is deliberate: `<side-panel-view>` already dispatches
a `delete` event carrying `{ id }` (a history-entry id, `side-panel-view.ts:230-234`) — reusing the
name on a different element with a different payload shape (`{ word }`) invites exactly the kind
of copy-paste handler mixup the two nearly-identical `side-panel.ts` listener blocks are already
prone to; a distinct name removes the ambiguity for free.

### 2.6 Loading state while `saved.list` round-trips

**Pinned: no dedicated loading UI.** `entries` defaults to `[]`, so the words page may show its
"no saved words yet" empty state for the few milliseconds before the `saved.list` reply lands on a
list that actually has entries. This is deliberately different from `CardState.loading`
(`lookup-card.ts:30-55`), whose spinner exists because that path crosses the network to an LLM
provider (multi-second latency, worth animating). `chrome.storage.local` reads are local,
uncached-but-synchronous-fast (no network hop) — the round trip through `chrome.runtime
.sendMessage` is the only asynchrony, and it resolves in low single-digit milliseconds in
practice. Building a second loading-state variant for an operation this fast is not worth the
added `PanelFocusState`-style union complexity.

### 2.7 Row preview text — plain text, not rendered markdown

**Pinned: a row's context line (`entry.senses[0].sentence`) and any future search-match preview
are written via `.textContent`, never `.innerHTML`.** `entry.senses[0].definition` is stored as
the model's raw markdown (`trackSaveContext` in `side-panel.ts:64-77` sets
`definition: r.markdown` — the un-sanitized source, sanitization happens only at _render_ time via
`sanitizeMarkdown`, `app/markdown-sanitize.ts:67-82`, S4). This card never renders that field as
HTML at all — the words page shows only the **sentence** per row, as plain escaped text — so there
is no HTML-injection surface to sanitize in the first place (S4 governs turning model text into
rendered HTML; a `.textContent` assignment can never do that, by construction). The one accepted
cosmetic side effect: if a saved definition or sentence happens to contain literal markdown syntax
characters, they display literally (e.g. `**word**`) rather than rendered — a non-issue since the
words page never shows the `definition` field at all, only `sentence`, which the reader typed on
the source page, not the model.

## 3. The change

### 3.1 New — `packages/app/src/domain/words-page-policy.ts`

Pure filter/sort logic (`rule-domain-purity` — zero imports outward except `./types`), unit-tested
without DOM (test-first mindset, same "extract a pure helper" precedent A6 sets).

```ts
import type { SavedWordEntry, SavedWordStatus } from './types';

export type WordsSortOrder = 'newest' | 'oldest' | 'alpha';
export type WordsStatusFilter = 'all' | SavedWordStatus;

export interface WordsFilterState {
  query: string;
  status: WordsStatusFilter;
  site: string; // 'all' | UNKNOWN_SITE | a hostname
  sort: WordsSortOrder;
}

export const DEFAULT_WORDS_FILTER: WordsFilterState = {
  query: '',
  status: 'all',
  site: 'all',
  sort: 'newest',
};

/** The bucket value for entries with no parseable site (§2.3). Never a real hostname. */
export const UNKNOWN_SITE = 'unknown';

/**
 * Every distinct hostname a saved entry's senses point at, deduped. A future multi-sense entry
 * (B14) still matches every site it was met on, not just the first — today's `savedWordUpsert`
 * always writes exactly one sense (`saved-words-policy.ts:56-61`), so in practice this returns at
 * most one hostname per entry until B14 ships, but the shape costs nothing extra now.
 */
export function siteHostnames(entry: SavedWordEntry): string[] {
  const out = new Set<string>();
  for (const sense of entry.senses) {
    if (!sense.url) continue;
    try {
      out.add(new URL(sense.url).hostname);
    } catch {
      // Not a parseable absolute URL (empty/legacy/hand-seeded data) — contributes to the
      // UNKNOWN_SITE bucket via siteFilterOptions/matchesSite instead of throwing.
    }
  }
  return [...out];
}

/** Distinct site values for the filter <select>, alphabetical; UNKNOWN_SITE appended last, and
 * only, when at least one entry has no parseable site. */
export function siteFilterOptions(entries: SavedWordEntry[]): string[] {
  const sites = new Set<string>();
  let hasUnknown = false;
  for (const e of entries) {
    const hosts = siteHostnames(e);
    if (hosts.length === 0) hasUnknown = true;
    hosts.forEach((h) => sites.add(h));
  }
  const sorted = [...sites].sort((a, b) => a.localeCompare(b));
  return hasUnknown ? [...sorted, UNKNOWN_SITE] : sorted;
}

function matchesQuery(entry: SavedWordEntry, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return true;
  if (entry.word.toLowerCase().includes(q)) return true;
  return entry.senses.some(
    (s) =>
      s.definition.toLowerCase().includes(q) ||
      s.translation.toLowerCase().includes(q) ||
      s.sentence.toLowerCase().includes(q),
  );
}

function matchesStatus(entry: SavedWordEntry, status: WordsStatusFilter): boolean {
  return status === 'all' || entry.status === status;
}

function matchesSite(entry: SavedWordEntry, site: string): boolean {
  if (site === 'all') return true;
  const hosts = siteHostnames(entry);
  if (site === UNKNOWN_SITE) return hosts.length === 0;
  return hosts.includes(site);
}

/**
 * Pure: filter + sort a saved-word list for the words page (B6). No storage/DOM access — the UI
 * layer (words-page-view.ts) owns rendering only; this function owns the logic, unit-tested
 * directly.
 */
export function filterAndSortSavedWords(
  entries: SavedWordEntry[],
  filter: WordsFilterState,
): SavedWordEntry[] {
  const filtered = entries.filter(
    (e) =>
      matchesQuery(e, filter.query) &&
      matchesStatus(e, filter.status) &&
      matchesSite(e, filter.site),
  );
  const sorted = [...filtered];
  if (filter.sort === 'alpha') {
    sorted.sort((a, b) => a.word.localeCompare(b.word));
  } else if (filter.sort === 'oldest') {
    sorted.sort((a, b) => a.savedAt - b.savedAt);
  } else {
    sorted.sort((a, b) => b.savedAt - a.savedAt); // 'newest' — also the default tie-break
  }
  return sorted;
}
```

### 3.2 `packages/app/src/wire.ts`

Add one payload-free message arm (after `saved.setStatus`, before `cache.clear`,
`wire.ts:127-128`):

```ts
// B6: fetch the full saved-word collection for the words page. Payload-free — the words page
// loads everything and filters/sorts client-side (see the design spec's virtualization pin,
// §2.4); no pagination params, unlike history.list.
z.object({ type: z.literal('saved.list') }),
```

Add `'saved.list'` to `MessageTypeEnum` (`wire.ts:143-158`, alongside the other `saved.*` members).

Add one reply arm (after the `saved` reply arm, `wire.ts:175`):

```ts
z.object({
  ok: z.literal(true),
  type: z.literal('saved.list'),
  entries: z.array(SavedWordEntrySchema),
}),
```

No change to `SavedWordEntrySchema`/`SavedWordSenseSchema` (`wire.ts:78-93`) or the compile-time
`AssertEqual` drift-guard tuple (`wire.ts:201-210`) — this card adds a wire arm, not a data shape.

### 3.3 `packages/app/src/app/router.ts`

Add `savedWordsList` to the import list from `'../index'` (`router.ts:1-24`, alongside
`savedWordUpsert`/`savedWordDelete`/`savedWordSetStatus`).

Add one case to the exhaustive switch (after `'saved.setStatus'`, before `'cache.clear'`,
`router.ts:266-267`):

```ts
case 'saved.list': {
  const entries = await savedWordsList({ storage: deps.kv });
  return { ok: true, type: 'saved.list', entries };
}
```

Read-only — no `deps.queue.run(...)` wrapper, matching `handleHistoryList`'s own precedent
(`router.ts:183-193`, also a read with no queue involvement; only writes go through `WriteQueue`).

### 3.4 New — `packages/app/src/ui/words-page-view.ts`

```ts
import type { SavedWordEntry, SavedWordStatus } from '../domain/types';
import {
  filterAndSortSavedWords,
  siteFilterOptions,
  UNKNOWN_SITE,
  DEFAULT_WORDS_FILTER,
  type WordsFilterState,
} from '../domain/words-page-policy';
import { adoptStyles } from './styles/adopt';
import { BASE_VARS, THEME_CSS, ICON_BACK, ICON_TRASH } from './styles/tokens';

const CSS = `:host{${BASE_VARS};display:flex;flex-direction:column;height:100dvh;box-sizing:border-box;font:var(--adp-text-body)/var(--adp-leading-body) var(--adp-font-sans);color:var(--ad-ink);background:var(--ad-glow),var(--ad-surface);color-scheme:light}
${THEME_CSS}
*{box-sizing:border-box}
::selection{background:var(--ad-selection)}
.accent{height:3px;flex:none;background:linear-gradient(90deg,var(--ad-accent),var(--ad-warm) 92%)}
header{display:flex;align-items:center;gap:8px;padding:13px 18px 8px;flex:none}
.back{display:inline-grid;place-items:center;width:var(--adp-action-size);height:var(--adp-action-size);border:0;background:transparent;color:var(--ad-ink-faint);border-radius:var(--adp-radius-control);cursor:pointer;font:inherit;transition:background var(--adp-dur-fast) var(--adp-ease),color var(--adp-dur-fast) var(--adp-ease)}
.back:hover{background:var(--ad-surface-raised);color:var(--ad-ink)}
.back:focus-visible{outline:2px solid var(--ad-accent);outline-offset:2px}
.back svg{width:16px;height:16px;pointer-events:none}
.title{font-size:var(--adp-text-sm);font-weight:var(--adp-weight-bold);letter-spacing:var(--adp-tracking-label);color:var(--ad-accent-ink)}
.count{margin-left:auto;font-size:var(--adp-text-2xs);color:var(--ad-ink-faint)}
.controls{display:flex;flex-wrap:wrap;gap:6px;padding:0 18px 10px;flex:none}
.search{flex:1 1 100%;min-width:0;padding:8px 12px;border:1px solid var(--ad-line);border-radius:var(--adp-radius-control);background:var(--ad-surface-sunken);color:var(--ad-ink);font:inherit;font-size:var(--adp-text-sm)}
.search:focus-visible{outline:2px solid var(--ad-accent);outline-offset:2px}
select{appearance:none;cursor:pointer;flex:1 1 auto;min-width:0;padding:7px 30px 7px 10px;border:1px solid var(--ad-line);border-radius:var(--adp-radius-control);background:var(--ad-surface-sunken);color:var(--ad-ink);font:inherit;font-size:var(--adp-text-xs);background-image:linear-gradient(45deg,transparent 50%,var(--ad-ink-faint) 50%),linear-gradient(135deg,var(--ad-ink-faint) 50%,transparent 50%);background-position:calc(100% - 16px) 50%,calc(100% - 11px) 50%;background-size:5px 5px,5px 5px;background-repeat:no-repeat}
select:focus-visible{outline:2px solid var(--ad-accent);outline-offset:2px}
main{flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:0 18px 14px}
.word-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:2px}
.word-row{display:flex;align-items:center;gap:6px;padding:9px 0;border-top:1px solid var(--ad-line)}
.word-row:first-child{border-top:0}
.word-main{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:1px}
.word-text{font-size:14px;font-weight:var(--adp-weight-semi);color:var(--ad-ink)}
.word-context{font-size:var(--adp-text-xs);line-height:1.4;color:var(--ad-ink-soft);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.status-btn{flex:none;border:1px solid var(--ad-line);background:transparent;color:var(--ad-ink-soft);border-radius:var(--adp-radius-control);padding:5px 10px;font:inherit;font-size:var(--adp-text-2xs);font-weight:var(--adp-weight-semi);cursor:pointer;transition:background var(--adp-dur-fast) var(--adp-ease),color var(--adp-dur-fast) var(--adp-ease),border-color var(--adp-dur-fast) var(--adp-ease)}
.status-btn:hover{background:var(--ad-surface-raised);color:var(--ad-ink)}
.status-btn:focus-visible{outline:2px solid var(--ad-accent);outline-offset:2px}
.status-btn[aria-pressed="true"]{border-color:var(--ad-accent);color:var(--ad-accent-ink)}
.del-btn{flex:none;display:inline-grid;place-items:center;width:var(--adp-action-size);height:var(--adp-action-size);border:0;background:transparent;color:var(--ad-ink-faint);border-radius:var(--adp-radius-control);cursor:pointer;font:inherit}
.del-btn:hover{background:var(--ad-surface-raised);color:var(--ad-error)}
.del-btn:focus-visible{outline:2px solid var(--ad-accent);outline-offset:2px}
.del-btn svg{width:14px;height:14px;pointer-events:none}
.empty-row{padding:40px 6px;text-align:center;color:var(--ad-ink-soft);font-size:var(--adp-text-sm);line-height:1.55}
@media (prefers-reduced-motion:reduce){.back{transition:none}.status-btn{transition:none}}`;

function statusLabel(s: SavedWordStatus): string {
  return s === 'known' ? 'Known' : 'Learning';
}

export class WordsPageView extends HTMLElement {
  private _entries: SavedWordEntry[] = [];
  private _filter: WordsFilterState = { ...DEFAULT_WORDS_FILTER };
  private countEl!: HTMLElement;
  private searchEl!: HTMLInputElement;
  private statusEl!: HTMLSelectElement;
  private siteEl!: HTMLSelectElement;
  private sortEl!: HTMLSelectElement;
  private listEl!: HTMLUListElement;

  connectedCallback(): void {
    if (this.shadowRoot) {
      this.renderList();
      return;
    }
    const root = this.attachShadow({ mode: 'open' });
    adoptStyles(root, CSS);

    const accent = document.createElement('div');
    accent.className = 'accent';
    accent.setAttribute('aria-hidden', 'true');

    const header = document.createElement('header');
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'back';
    back.setAttribute('aria-label', 'Back to lookup');
    back.innerHTML = ICON_BACK; // decorative aria-hidden SVG; name comes from aria-label
    back.addEventListener('click', () =>
      this.dispatchEvent(new CustomEvent('back', { bubbles: true, composed: true })),
    );
    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = 'My Words';
    this.countEl = document.createElement('span');
    this.countEl.className = 'count';
    header.append(back, title, this.countEl);

    const controls = document.createElement('div');
    controls.className = 'controls';

    this.searchEl = document.createElement('input');
    this.searchEl.type = 'search';
    this.searchEl.className = 'search';
    this.searchEl.placeholder = 'Search your words…';
    this.searchEl.setAttribute('aria-label', 'Search saved words');
    this.searchEl.addEventListener('input', () => {
      this._filter = { ...this._filter, query: this.searchEl.value };
      this.renderList();
    });

    this.statusEl = document.createElement('select');
    this.statusEl.className = 'status-filter';
    this.statusEl.setAttribute('aria-label', 'Filter by status');
    this.statusEl.innerHTML =
      '<option value="all">All statuses</option>' +
      '<option value="learning">Learning</option>' +
      '<option value="known">Known</option>';
    this.statusEl.addEventListener('change', () => {
      this._filter = {
        ...this._filter,
        status: this.statusEl.value as WordsFilterState['status'],
      };
      this.renderList();
    });

    this.siteEl = document.createElement('select');
    this.siteEl.className = 'site-filter';
    this.siteEl.setAttribute('aria-label', 'Filter by site');
    this.siteEl.addEventListener('change', () => {
      this._filter = { ...this._filter, site: this.siteEl.value };
      this.renderList();
    });

    this.sortEl = document.createElement('select');
    this.sortEl.className = 'sort';
    this.sortEl.setAttribute('aria-label', 'Sort');
    this.sortEl.innerHTML =
      '<option value="newest">Newest first</option>' +
      '<option value="oldest">Oldest first</option>' +
      '<option value="alpha">A–Z</option>';
    this.sortEl.addEventListener('change', () => {
      this._filter = { ...this._filter, sort: this.sortEl.value as WordsFilterState['sort'] };
      this.renderList();
    });

    controls.append(this.searchEl, this.statusEl, this.siteEl, this.sortEl);

    const main = document.createElement('main');
    this.listEl = document.createElement('ul');
    this.listEl.className = 'word-list';
    this.listEl.setAttribute('aria-label', 'Saved words');
    main.append(this.listEl);

    root.append(accent, header, controls, main);
    this.refreshSiteOptions();
    this.renderList();
  }

  /** The full, unfiltered saved-word collection — set once by the composition root after a
   * saved.list round trip (or optimistically patched after a status/delete action). */
  set entries(list: SavedWordEntry[]) {
    this._entries = list;
    this.refreshSiteOptions();
    if (this.shadowRoot) this.renderList();
  }
  get entries(): SavedWordEntry[] {
    return this._entries;
  }

  private refreshSiteOptions(): void {
    if (!this.siteEl) return;
    const current = this.siteEl.value || 'all';
    const options = siteFilterOptions(this._entries);
    const frag = document.createDocumentFragment();
    const allOpt = document.createElement('option');
    allOpt.value = 'all';
    allOpt.textContent = 'All sites';
    frag.append(allOpt);
    for (const s of options) {
      const opt = document.createElement('option');
      opt.value = s;
      opt.textContent = s === UNKNOWN_SITE ? 'Unknown site' : s;
      frag.append(opt);
    }
    this.siteEl.replaceChildren(frag);
    const stillExists = current === 'all' || options.includes(current);
    this.siteEl.value = stillExists ? current : 'all';
    if (!stillExists) this._filter = { ...this._filter, site: 'all' };
  }

  private renderList(): void {
    const filtered = filterAndSortSavedWords(this._entries, this._filter);
    this.countEl.textContent = `${filtered.length} of ${this._entries.length}`;
    if (this._entries.length === 0) {
      this.listEl.replaceChildren(
        this.emptyRow('No saved words yet — tap the star on a lookup to start your list.'),
      );
      return;
    }
    if (filtered.length === 0) {
      this.listEl.replaceChildren(this.emptyRow('No words match your search and filters.'));
      return;
    }
    this.listEl.replaceChildren(...filtered.map((e) => this.wordRow(e)));
  }

  private emptyRow(text: string): HTMLLIElement {
    const li = document.createElement('li');
    li.className = 'empty-row';
    li.textContent = text;
    return li;
  }

  private wordRow(entry: SavedWordEntry): HTMLLIElement {
    const li = document.createElement('li');
    li.className = 'word-row';

    const main = document.createElement('div');
    main.className = 'word-main';
    const word = document.createElement('span');
    word.className = 'word-text';
    word.textContent = entry.word;
    main.append(word);
    const sentence = entry.senses[0]?.sentence;
    if (sentence) {
      const ctx = document.createElement('span');
      ctx.className = 'word-context';
      ctx.textContent = sentence; // plain text, never innerHTML — see design spec §2.7
      main.append(ctx);
    }

    const isKnown = entry.status === 'known';
    const statusBtn = document.createElement('button');
    statusBtn.type = 'button';
    statusBtn.className = 'status-btn';
    statusBtn.setAttribute('aria-pressed', String(isKnown));
    statusBtn.setAttribute(
      'aria-label',
      isKnown ? `Mark ${entry.word} as learning` : `Mark ${entry.word} as known`,
    );
    statusBtn.textContent = statusLabel(entry.status);
    statusBtn.addEventListener('click', () => {
      const next: SavedWordStatus = isKnown ? 'learning' : 'known';
      this.dispatchEvent(
        new CustomEvent('toggle-status', {
          detail: { word: entry.word, status: next },
          bubbles: true,
          composed: true,
        }),
      );
    });

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'del-btn';
    delBtn.setAttribute('aria-label', `Delete ${entry.word} from your word list`);
    delBtn.innerHTML = ICON_TRASH; // decorative aria-hidden SVG; name comes from aria-label
    delBtn.addEventListener('click', () =>
      this.dispatchEvent(
        new CustomEvent('delete-word', {
          detail: { word: entry.word },
          bubbles: true,
          composed: true,
        }),
      ),
    );

    li.append(main, statusBtn, delBtn);
    return li;
  }
}
```

### 3.5 `packages/app/src/ui/styles/tokens.ts`

Append two icons to the pinned §5.10 icon set (after `ICON_STAR`, `tokens.ts:215`), same style
convention (stroke="currentColor", aria-hidden, geometric):

```ts
// Back (return to lookup) — words page header, B6.
export const ICON_BACK =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M15 5l-7 7 7 7"/></svg>';

// Words list (My Words nav) — side-panel header, B6. Three lines of decreasing length, reads as
// a compact list glyph distinct from the two-line/two-knob Settings icon.
export const ICON_WORDS_LIST =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">' +
  '<line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="16" y2="12"/><line x1="4" y1="17" x2="18" y2="17"/></svg>';
```

### 3.6 `packages/app/src/ui/side-panel-view.ts`

Add a "My Words" nav button to the header, next to the existing Settings button
(`side-panel-view.ts:126-140`):

```ts
const header = document.createElement('header');
const brand = document.createElement('span');
brand.className = 'brand';
brand.innerHTML = `${BRAND_MARK_SVG}<span>AI Dictionary</span>`;
// B6: opens the saved-word collection. Caught by the panel's composition root, same
// "trusted page, own listener" pattern as the existing settings button below.
const words = document.createElement('button');
words.type = 'button';
words.className = 'words-nav';
words.setAttribute('aria-label', 'My Words');
words.innerHTML = ICON_WORDS_LIST; // decorative aria-hidden SVG; name comes from aria-label
words.addEventListener('click', () =>
  this.dispatchEvent(new CustomEvent('open-words', { bubbles: true, composed: true })),
);
const settings = document.createElement('button');
settings.type = 'button';
settings.className = 'settings';
settings.setAttribute('aria-label', 'Settings');
settings.innerHTML = ICON_SETTINGS;
settings.addEventListener('click', () =>
  this.dispatchEvent(new CustomEvent('open-settings', { bubbles: true, composed: true })),
);
header.append(brand, words, settings);
```

Import `ICON_WORDS_LIST` alongside the file's existing token imports (`side-panel-view.ts:3`).

CSS: rename the existing single-selector `.settings{…}` block (`side-panel-view.ts:40-43`) to a
combined selector shared with the new button, since both are plain icon-only header buttons with
identical sizing/hover/focus rules:

```css
.settings,
.words-nav {
  display: inline-grid;
  place-items: center;
  width: var(--adp-action-size);
  height: var(--adp-action-size);
  border: 0;
  background: transparent;
  color: var(--ad-ink-faint);
  border-radius: var(--adp-radius-control);
  cursor: pointer;
  font: inherit;
  transition:
    background var(--adp-dur-fast) var(--adp-ease),
    color var(--adp-dur-fast) var(--adp-ease);
}
.settings:hover,
.words-nav:hover {
  background: var(--ad-surface-raised);
  color: var(--ad-ink);
}
.settings:focus-visible,
.words-nav:focus-visible {
  outline: 2px solid var(--ad-accent);
  outline-offset: 2px;
}
.settings svg,
.words-nav svg {
  width: 15px;
  height: 15px;
  pointer-events: none;
}
```

`.settings{margin-left:auto}` (the auto-margin that pushes the button group to the header's right
edge, currently baked into `.settings`'s own rule at `side-panel-view.ts:40`) moves to
`.words-nav{margin-left:auto}` instead, since `.words-nav` is now the FIRST of the two right-aligned
buttons in DOM order (`header.append(brand, words, settings)`) — the auto-margin must sit on
whichever button is adjacent to `brand` to push the whole trailing group right.

No other change to `side-panel-view.ts` — `renderFocus`/`renderRecent`/`recentRow` and the
`focusState`/`recent` setters are untouched.

### 3.7 `packages/app/src/ui/register.ts` and `packages/app/src/ui/index.ts`

`register.ts`: import `WordsPageView` and register it alongside `SidePanelView` inside the same
`registerSidePanel()` function (both are side-panel surfaces used together, so one register call
covers both — no new register function, no new call site needed in `side-panel.ts`):

```ts
import { WordsPageView } from './words-page-view';

export function registerSidePanel(): void {
  if (!customElements.get('side-panel-view'))
    customElements.define('side-panel-view', SidePanelView);
  if (!customElements.get('words-page-view'))
    customElements.define('words-page-view', WordsPageView);
}
```

`index.ts`: add `export * from './words-page-view';` alongside the other UI barrel exports.

### 3.8 `packages/extension-chrome/src/side-panel.html`

Add the second top-level element, initially hidden via inline style (§2.2 — NOT the `hidden`
attribute):

```html
<body>
  <side-panel-view></side-panel-view>
  <words-page-view style="display:none"></words-page-view>
  <script type="module" src="side-panel.js"></script>
</body>
```

### 3.9 `packages/extension-chrome/src/side-panel.ts`

Add `normalizeWordKey` to the existing `@ai-dict/app` import, plus the `WordsPageView` and
`SavedWordEntry` types:

```ts
import {
  registerSidePanel,
  sanitizeMarkdown,
  mapError,
  createSaveReplyGuard,
  normalizeWordKey,
  type PanelFocusState,
  type SidePanelView,
  type WordsPageView,
  type LookupResult,
  type LookupError,
  type HistoryEntry,
  type WireReply,
  type SavedWordStatus,
  type SavedWordEntry,
} from '@ai-dict/app';
```

After the existing `const view = document.querySelector('side-panel-view') as SidePanelView;`
(`side-panel.ts:29`), add:

```ts
const wordsView = document.querySelector('words-page-view') as WordsPageView;
```

Add new listeners (placed after the existing `dismiss-nudge` listener, `side-panel.ts:215`, before
`initFromSettings`):

```ts
// B6: "My Words" nav — swap the panel from the current lookup focus to the saved-word
// collection. Both elements stay permanently mounted (side-panel.html) so SidePanelView's own
// focus/Recent state survives the round trip; visibility is toggled via inline style.display,
// NOT the `hidden` attribute — see the design spec §2.2: side-panel-view.ts's (and
// words-page-view.ts's) `:host{display:flex}` rule is an unconditioned author-stylesheet
// declaration, which the CSS cascade lets win over the UA stylesheet's `[hidden]{display:none}`
// regardless of the boolean attribute — so `hidden` alone would silently do nothing here.
view.addEventListener('open-words', () => {
  view.style.display = 'none';
  wordsView.style.display = '';
  void loadSavedWords();
});

wordsView.addEventListener('back', () => {
  wordsView.style.display = 'none';
  view.style.display = '';
});

async function loadSavedWords(): Promise<void> {
  try {
    const raw: unknown = await chrome.runtime.sendMessage({ type: 'saved.list' });
    const reply = raw as WireReply | undefined;
    if (reply && reply.ok && reply.type === 'saved.list') {
      wordsView.entries = reply.entries;
    }
  } catch {
    // Best-effort; the words page's own "no saved words yet" empty state is a fine fallback.
  }
}

// B6: reuse saved.setStatus (B5) / saved.delete (B1) verbatim — no new wire messages for row
// actions (design spec §2.5). Optimistic, no-rollback update mirrors the existing
// toggle-save/toggle-status listeners above in this same file — a failed round trip just leaves
// the words page's local view slightly stale until the next saved.list fetch.
wordsView.addEventListener('toggle-status', (e) => {
  const { word, status } = (e as CustomEvent<{ word: string; status: SavedWordStatus }>).detail;
  wordsView.entries = wordsView.entries.map((entry: SavedWordEntry) =>
    normalizeWordKey(entry.word) === normalizeWordKey(word) ? { ...entry, status } : entry,
  );
  void chrome.runtime.sendMessage({ type: 'saved.setStatus', word, status }).catch(() => undefined);
});

wordsView.addEventListener('delete-word', (e) => {
  const { word } = (e as CustomEvent<{ word: string }>).detail;
  wordsView.entries = wordsView.entries.filter(
    (entry: SavedWordEntry) => normalizeWordKey(entry.word) !== normalizeWordKey(word),
  );
  void chrome.runtime.sendMessage({ type: 'saved.delete', word }).catch(() => undefined);
});
```

### 3.10 No change to X (files an implementer would reflexively touch)

- **`packages/app/src/ui/lookup-card.ts`** — `renderSaveRow`/`renderStatusBtn` are untouched. B6
  does not reuse them (§2.2's rejected alternative (a)); it builds its own row renderer scoped to
  `words-page-view.ts`, styled consistently but structurally independent (a list of N rows is a
  different contract from one closure-bound focus row).
- **`packages/app/src/ui/settings-form.ts`** — CONTRACTS §5's hot-file list names `settings-form`
  as a B6-touching file; this design does not touch it at all. The words page is reached from the
  side-panel header nav, not a settings toggle, and needs no new settings field. Flagged here
  explicitly since it contradicts that list — for the orchestrator's Concurrency bookkeeping
  (§9 below), this card's real footprint is narrower than the hot-file table implies.
- **`packages/extension-chrome/src/content.ts`** — the in-page card's save/status/delete flows
  (star button, status toggle, nudge) are completely unaffected; B6 is side-panel-only per the
  card's own fence ("Lives in the side panel, not a new options tab").
- **`packages/app/src/domain/types.ts`** — no field added, no restructuring of the ratified E1
  `SavedWordEntry`/`SavedWordSense` shape (`domain/types.ts:223-251`). `words-page-policy.ts`
  reads the existing shape as-is; this is a pure UI/filter feature, not a schema change.
- **`packages/extension-chrome/src/manifest.json`** — no new permission; the words page runs
  entirely inside the existing `sidePanel` surface already declared.
- **`packages/app/src/domain/saved-words-policy.ts`** — `savedWordsList` (`saved-words-policy
.ts:110-118`) is called as-is by the new router case; no signature change.

## 4. Scope fence held

- **"Lives in the side panel, not a new options tab"** — held exactly: `<words-page-view>` is
  mounted in `side-panel.html` only; no `options.html` change, no new manifest entry point.
- **Filter/sort UI shape ("Lead decides")** — pinned in full at §2.3.
- **Constraint 4 (every LLM call is user-triggered)** — the words page makes **zero** LLM calls;
  it reads/writes only the local `saved:*` keyspace via `chrome.runtime.sendMessage`. No
  `LookupClient` is ever invoked from this feature.
- **S1 (API key isolation)** — `saved.list`'s reply schema is `SavedWordEntrySchema` (unchanged,
  `wire.ts:88-93`), which has no key field and predates this card; nothing in `words-page-view.ts`
  or the composition-root wiring ever reads `apiKey`/`Settings` (only `PublicSettings`-shaped data
  ever reaches this surface, and this card doesn't even touch settings).
- **S4 (sanitize model output)** — no model markdown is ever rendered as HTML by this feature;
  see §2.7's grounding (`.textContent` only, never `.innerHTML`, for any saved-entry field).
- **Design tokens only** — every new CSS rule in `words-page-view.ts` and the `side-panel-view.ts`
  header addition reads exclusively `--ad-*`/`--adp-*` custom properties; no hard-coded color, no
  per-component `prefers-color-scheme` branch (theme flows through the existing `data-ad-theme`
  attribute mechanism, `tokens.ts` §12 — this card adds no new theming code, it inherits
  `BASE_VARS`/`THEME_CS` exactly like every other component).
- **Reduced motion** — the new `.back`/`.status-btn` hover transitions get the same
  `@media (prefers-reduced-motion:reduce)` neutralization every other button in the codebase uses
  (see the CSS block in §3.4's last line).
- **No new manifest permission** — confirmed at §3.10.

## 5. Testing strategy

### 5.1 Unit — `packages/app/test/words-page-policy.test.ts` (new)

Pure-function coverage, no DOM: `siteHostnames` dedupes across senses and skips unparseable/empty
urls; `siteFilterOptions` returns sorted distinct hostnames with `UNKNOWN_SITE` appended only when
warranted; `filterAndSortSavedWords` covers query matching (word/definition/translation/sentence,
case-insensitive), status filtering, site filtering (including the unknown bucket), each of the
three sort orders, and a composed query+status+site+sort scenario.

### 5.2 Unit — `packages/app/test/ui/words-page-view.test.ts` (new)

Mount via `document.createElement('words-page-view')` (mirrors `side-panel-view.test.ts`'s own
`mount()` helper): the "no saved words yet" empty state before any `entries` are set; the "no
words match" empty state once a filter yields zero from a non-empty entry set; row rendering
(word + sentence) and count text (`"N of M"`); search/status/site/sort each narrow or reorder rows
as expected; the site `<select>`'s options are derived from the entries set; clicking a row's
status button dispatches a composed `toggle-status` with the flipped status; clicking a row's
delete icon dispatches a composed `delete-word`; clicking Back dispatches a composed `back`; an
`axeViolations` a11y check (same pattern as `side-panel-view.test.ts`) with rows rendered.

### 5.3 Unit — `packages/app/test/ui/side-panel-view.test.ts` (extend)

One new test: clicking `.words-nav` dispatches a composed `open-words` event.

### 5.4 Unit — `packages/app/test/app/router.test.ts` (extend)

`saved.list` returns every saved entry in the same newest-first index order `savedWordsList`
already guarantees; `saved.list` on an empty `saved:*` keyspace returns `{ entries: [] }`.

### 5.5 Unit — `packages/app/test/wire-schema.test.ts` (extend)

`saved.list` message parses with no payload; a `saved.list` reply with an array of entries (and
with an empty array) parses; the JSON-schema snapshot test
(`wire-schema.test.ts:405-409`, `toMatchFileSnapshot`) is regenerated as part of this change (Task
2 below runs it with `-u`) since the new arms change `wireJsonSchema()`'s output.

### 5.6 e2e — new `packages/extension-chrome/e2e/b6-words-page.spec.ts`

Three scenarios, each seeding `saved:*` directly into `chrome.storage.local` (mirrors
`side-panel.spec.ts`'s own local `seedHistory` helper precedent — no real lookup/save round trip
needed, keeping the spec fast and deterministic):

1. **Nav + search/filter/sort + Back**: seed two saved words on different sites/statuses/dates;
   open the panel, click `.words-nav`, assert both rows render newest-first; search narrows to
   one; the status filter narrows to the known word; the site filter narrows to the matching
   hostname; the sort selector reorders A–Z; clicking `.back` returns to `<side-panel-view>` and
   hides `<words-page-view>` (asserted via Playwright's `toBeVisible`/`toBeHidden`, which read
   computed `display`).
2. **Status edit + delete persist**: seed one word; toggle its status via the row's status button
   and assert both the visible label flips AND `chrome.storage.local.get('saved:<word>')`'s
   `status` field updates; delete it and assert both the row disappears (replaced by the "no saved
   words yet" empty state) AND the storage key is gone.
3. **Empty state**: no saved words seeded — opening the words page shows "No saved words yet…"
   immediately.

No existing e2e spec needs updating — this card adds a new entry point without touching any
existing lookup/save/history/status flow (§3.10 confirms `content.ts` is untouched, and
`side-panel.ts`'s existing listeners are unmodified, only extended).

## 6. Testing performed policy (PR evidence)

Per this worktree's `CLAUDE.md` (owner ruling 2026-07-16, media-evidence capture retired): **no
screenshots or video for this PR.** The PR body's "Testing performed" section carries the suites
run, test counts, and e2e scenarios exercised instead — matching exactly what §5 above enumerates.
No `pr-assets/*` branch is created for this card.

## 7. Risk / rollback

- **Risk: low.** The one piece of genuinely new server-side surface (`saved.list`) is a read-only
  wire message with no side effects, following an existing, already-tested pattern
  (`handleHistoryList`) almost exactly. The UI is entirely new and additive (a new custom element,
  a new header button) — it cannot regress the existing lookup/Recent/save/status/delete flows
  because none of their code paths change, only `side-panel-view.ts`'s header markup gains one
  more button and `side-panel.ts` gains new, independent listeners.
- **The one implementation detail worth double-checking under a real Chromium run** (not just
  jsdom/happy-dom unit tests): the `hidden`-attribute-vs-`:host{display:flex}` cascade-origin
  reasoning in §2.2. It is grounded directly in the literal CSS text at
  `side-panel-view.ts:33`, but CSS cascade-origin behavior is exactly the kind of thing worth a
  real-browser e2e assertion (§5.6 scenario 1's `toBeVisible`/`toBeHidden` checks), not just
  trusting the reasoning.
- **No data migration.** `SavedWordEntry`/`SavedWordSense` are read, never restructured; nothing
  about stored data changes shape.
- **Rollback:** revert the single PR — but this is only unconditionally safe if no sibling card
  has landed its own `saved.list` copy first. `grep` across every other card's spec for
  `saved.list` finds it referenced in B8, B9, B10, B11, B12, and B15, not zero: B8, B10, and B15
  each independently author the identical wire arm (`{ type: 'saved.list' }` → `{ ok: true, type:
'saved.list', entries: SavedWordEntry[] }`) as their own task; B9 and B11 also depend on that
  same request/reply shape for their own flows; B12 mentions `saved.list` only inside a
  rejected-alternative discussion and does not actually consume it. Once any of B8/B9/B10/B11/B15
  lands its copy, `saved.list` is shared infrastructure, not B6-owned surface — rollback at that
  point must leave the wire arm and router case in place rather than deleting them, or the landed
  sibling(s) break. Before B6 or any sibling has landed, the pre-B6 side panel (single lookup +
  Recent) returns exactly as it was.

## 8. Files touched (summary)

| File                                                  | Change                                                                                  |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `packages/app/src/domain/words-page-policy.ts`        | **new** — pure filter/sort/site helpers                                                 |
| `packages/app/src/wire.ts`                            | + `saved.list` message arm, reply arm, `MessageTypeEnum` entry                          |
| `packages/app/src/app/router.ts`                      | + `savedWordsList` import, `'saved.list'` case                                          |
| `packages/app/src/ui/words-page-view.ts`              | **new** — the collection view custom element                                            |
| `packages/app/src/ui/styles/tokens.ts`                | + `ICON_BACK`, `ICON_WORDS_LIST`                                                        |
| `packages/app/src/ui/side-panel-view.ts`              | + "My Words" header nav button, `open-words` event, `.words-nav`/`.settings` shared CSS |
| `packages/app/src/ui/register.ts`                     | `registerSidePanel()` also defines `words-page-view`                                    |
| `packages/app/src/ui/index.ts`                        | + `export * from './words-page-view'`                                                   |
| `packages/extension-chrome/src/side-panel.html`       | + `<words-page-view style="display:none">`                                              |
| `packages/extension-chrome/src/side-panel.ts`         | + nav/back/list-load/status/delete wiring                                               |
| `packages/app/test/words-page-policy.test.ts`         | **new** — domain unit tests (§5.1)                                                      |
| `packages/app/test/ui/words-page-view.test.ts`        | **new** — component unit tests (§5.2)                                                   |
| `packages/app/test/ui/side-panel-view.test.ts`        | + `open-words` nav test (§5.3)                                                          |
| `packages/app/test/app/router.test.ts`                | + `saved.list` tests (§5.4)                                                             |
| `packages/app/test/wire-schema.test.ts`               | + `saved.list` schema tests; snapshot regenerated (§5.5)                                |
| `packages/app/wire-schema.snapshot.json`              | regenerated (new message/reply arms)                                                    |
| `packages/extension-chrome/e2e/b6-words-page.spec.ts` | **new** — functional e2e (§5.6)                                                         |

No change to `packages/app/src/ui/lookup-card.ts`, `packages/app/src/ui/settings-form.ts`,
`packages/extension-chrome/src/content.ts`, `packages/app/src/domain/types.ts`,
`packages/app/src/domain/saved-words-policy.ts`, or any manifest file (§3.10).

## 9. Concurrency

Per CONTRACTS §5, the known hot-file list is: "the lookup-card UI (A1 A2 A3 A5 A7 A10),
content-script/trigger (A5 A6 A13 A14 A15 B3 B4), settings-form (A5 A9 A13 **B6** C9), side panel
(A2 **B6** B10 B11), prompt-builder (A12 B12), `docs/index.html` (C3 C11), wire+router (any card
adding messages)."

This card's ACTUAL footprint among those groups:

- **Side panel** (`side-panel-view.ts`, `side-panel.ts`, `side-panel.html`) — touched, as listed.
  Serialize against **A2** (recursive lookup — touches the panel's focus-region rendering),
  **B10** (weekly digest — adds a new panel section), and **B11** (casual review flip — adds a new
  panel entry point) if any run concurrently with this card; all four modify files this spec also
  modifies (`side-panel-view.ts` and/or `side-panel.ts`).
- **wire+router** — touched (new `saved.list` arm/case). Serialize against ANY other
  concurrently-run card that also adds a wire message (per the general wire+router rule) — check
  the batch's dispatch order before running two wire-adding cards in parallel worktrees, since
  both would touch `wire.ts`'s `WireMessageSchema` array and `MessageTypeEnum`, and
  `router.ts`'s exhaustive switch, in the same region.
- **settings-form** — listed by CONTRACTS §5 but **NOT actually touched** by this design (§3.10).
  No serialization needed against A5/A9/A13/C9 on this file for this card specifically — flagging
  this so the orchestrator doesn't hold B6 back waiting on settings-form availability it doesn't
  need.
- **lookup-card UI / content-script/trigger / prompt-builder / `docs/index.html`** — not touched
  by this card at all; no serialization needed against A1/A2/A3/A5/A6/A7/A10/A13/A14/A15/B3/B4/
  A12/B12/C3/C11 on those files.
