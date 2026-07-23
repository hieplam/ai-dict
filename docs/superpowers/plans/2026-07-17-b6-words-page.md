# B6 Words Page Implementation Plan

> **For agentic workers:** implement task-by-task, TDD (red → green → commit) per task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** a "My Words" button in the side panel's header opens a new, permanently-mounted
`<words-page-view>` collection surface — search, filter by status/site, sort by date or
alphabetically, edit status, and delete — covering every saved word (`saved:*`), reusing the
existing `saved.setStatus`/`saved.delete` wire messages verbatim and adding exactly one new
read-only message, `saved.list`, to expose the already-built `savedWordsList` domain primitive.
Zero LLM calls; zero new manifest permissions; the side panel gains a second view, nothing else in
the extension changes behavior.

**Architecture:** a new pure domain module (`packages/app/src/domain/words-page-policy.ts`) owns
filter/sort/site logic; a new custom element (`packages/app/src/ui/words-page-view.ts`) owns
rendering and dispatches `back`/`toggle-status`/`delete-word` events; the Chrome composition root
(`packages/extension-chrome/src/side-panel.ts`) owns the `saved.list` fetch, the visibility toggle
between `<side-panel-view>` and `<words-page-view>`, and forwards row actions to the existing
`saved.setStatus`/`saved.delete` wire messages. Full design rationale, including the two
implementation gotchas this plan depends on (the `saved.list` gap and the `hidden`-attribute
cascade-origin bug), plus every rejected alternative:
`docs/superpowers/specs/2026-07-17-b6-words-page-design.md`.

**Tech Stack:** TypeScript, Vitest + happy-dom (unit), Playwright (e2e), Zod (wire schemas).

## Global Constraints

- Implementer: dispatch each implementation/fix task to the `hunter` subagent — never a generic
  implementer.
- Work happens on branch `feature/B6WordsPage`, started from a fresh worktree under
  `.claude/worktrees/` per this repo's `CLAUDE.md`.
- Commit subject convention for every task: `[B6WordsPage] feat: <imperative summary> (B6)`
  (`test:` prefix for the e2e-only task). No `Co-Authored-By` trailer, no attribution footer.
- **Task 2 (wire.ts + router.ts) is ONE task** — per the B5/B3 plan-authoring rule
  (`docs/ROADMAP.md` §8, 2026-07-16): `router.ts`'s exhaustive `switch(msg.type)` has no
  `default` arm, so a new wire arm and its router case cannot typecheck apart.
- `bun run lint` and `bun run format:check` green before every commit.
- `cd packages/app && bun run typecheck` green after every task from Task 1 on;
  `cd packages/extension-chrome && bun run typecheck` green from Task 6 on.
- **Do not touch** `packages/app/src/ui/lookup-card.ts`, `packages/app/src/ui/settings-form.ts`,
  `packages/extension-chrome/src/content.ts`, `packages/app/src/domain/types.ts`, or
  `packages/app/src/domain/saved-words-policy.ts` — the design spec's §3.10 confirms none of them
  need a change for this card. If a task in this plan seems to need one, stop; that means an
  assumption broke and the plan needs re-grounding, not an ad hoc edit.
- Row actions (status edit, delete) reuse `saved.setStatus`/`saved.delete` **verbatim** — no
  payload/schema change to either.
- Toggle `<side-panel-view>`/`<words-page-view>` visibility via `element.style.display`, **never**
  the `hidden` attribute (design spec §2.2 — a real, grounded CSS cascade-origin bug, not a style
  preference).
- UI additions read only `--ad-*`/`--adp-*` design tokens; honor `prefers-reduced-motion`.
- S1: nothing in this card ever reads/writes `apiKey`/`Settings`; only `PublicSettings`-free,
  key-less `SavedWordEntry` data flows through the new surfaces.
- S4: saved-entry text is rendered via `.textContent` only, never `.innerHTML`/markdown-rendered
  (design spec §2.7) — there is no sanitize step to add because nothing here turns model text into
  HTML.
- Constraint 4: zero LLM calls anywhere in this card.
- The e2e build must clear any ambient `GEMINI_API_KEY` (`GEMINI_API_KEY= bun run build:chrome`),
  matching every other card's e2e precedent.

---

### Task 1: `words-page-policy.ts` — pure filter/sort/site domain helpers

**Files:**

- Create: `packages/app/src/domain/words-page-policy.ts`
- Create: `packages/app/test/words-page-policy.test.ts`

**Interfaces:**

```ts
export type WordsSortOrder = 'newest' | 'oldest' | 'alpha';
export type WordsStatusFilter = 'all' | SavedWordStatus;
export interface WordsFilterState {
  query: string;
  status: WordsStatusFilter;
  site: string;
  sort: WordsSortOrder;
}
export const DEFAULT_WORDS_FILTER: WordsFilterState;
export const UNKNOWN_SITE: string;
export function siteHostnames(entry: SavedWordEntry): string[];
export function siteFilterOptions(entries: SavedWordEntry[]): string[];
export function filterAndSortSavedWords(
  entries: SavedWordEntry[],
  filter: WordsFilterState,
): SavedWordEntry[];
```

- [ ] **Step 1: Write the failing tests.** Create `packages/app/test/words-page-policy.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  filterAndSortSavedWords,
  siteHostnames,
  siteFilterOptions,
  DEFAULT_WORDS_FILTER,
  UNKNOWN_SITE,
  type WordsFilterState,
} from '../src/domain/words-page-policy';
import type { SavedWordEntry, SavedWordSense } from '../src';

function sense(over: Partial<SavedWordSense> = {}): SavedWordSense {
  return {
    definition: 'a definition',
    translation: '',
    sentence: 'a sentence',
    url: 'https://example.com/article',
    title: 'Example',
    ...over,
  };
}

function makeEntry(
  over: Partial<SavedWordEntry> & { word: string; senses?: SavedWordSense[] },
): SavedWordEntry {
  return {
    word: over.word,
    status: over.status ?? 'learning',
    savedAt: over.savedAt ?? 1_700_000_000_000,
    senses: over.senses ?? [sense({ sentence: `a sentence with ${over.word}` })],
  };
}

describe('words-page-policy', () => {
  it('siteHostnames extracts the hostname from every sense url, deduped', () => {
    const e = makeEntry({
      word: 'bank',
      senses: [
        sense({ url: 'https://a.com/x' }),
        sense({ url: 'https://a.com/y' }),
        sense({ url: 'https://b.com/z' }),
      ],
    });
    expect(siteHostnames(e).sort()).toEqual(['a.com', 'b.com']);
  });

  it('siteHostnames ignores an empty or unparseable url', () => {
    const e = makeEntry({ word: 'bank', senses: [sense({ url: '' })] });
    expect(siteHostnames(e)).toEqual([]);
  });

  it('siteFilterOptions returns distinct sorted hostnames, with UNKNOWN_SITE last only if some entry has none', () => {
    const withSite = makeEntry({ word: 'bank', senses: [sense({ url: 'https://z.com' })] });
    const withoutSite = makeEntry({ word: 'cat', senses: [sense({ url: '' })] });
    const other = makeEntry({ word: 'dog', senses: [sense({ url: 'https://a.com' })] });
    expect(siteFilterOptions([withSite, withoutSite, other])).toEqual([
      'a.com',
      'z.com',
      UNKNOWN_SITE,
    ]);
    expect(siteFilterOptions([withSite, other])).toEqual(['a.com', 'z.com']);
    expect(siteFilterOptions([])).toEqual([]);
  });

  it('filterAndSortSavedWords matches the query against word, definition, translation, and sentence (case-insensitive)', () => {
    const bank = makeEntry({
      word: 'Bank',
      senses: [
        sense({
          definition: 'financial institution',
          translation: 'ngân hàng',
          sentence: 'the river bank',
        }),
      ],
    });
    const cat = makeEntry({ word: 'cat' });
    const byTranslation: WordsFilterState = { ...DEFAULT_WORDS_FILTER, query: 'NGÂN' };
    expect(filterAndSortSavedWords([bank, cat], byTranslation)).toEqual([bank]);
    const byWord: WordsFilterState = { ...DEFAULT_WORDS_FILTER, query: 'CAT' };
    expect(filterAndSortSavedWords([bank, cat], byWord)).toEqual([cat]);
    const noMatch: WordsFilterState = { ...DEFAULT_WORDS_FILTER, query: 'zzz-nope' };
    expect(filterAndSortSavedWords([bank, cat], noMatch)).toEqual([]);
  });

  it('filterAndSortSavedWords filters by status', () => {
    const learning = makeEntry({ word: 'a', status: 'learning' });
    const known = makeEntry({ word: 'b', status: 'known' });
    expect(
      filterAndSortSavedWords([learning, known], { ...DEFAULT_WORDS_FILTER, status: 'known' }),
    ).toEqual([known]);
    expect(
      filterAndSortSavedWords([learning, known], { ...DEFAULT_WORDS_FILTER, status: 'all' }),
    ).toHaveLength(2);
  });

  it('filterAndSortSavedWords filters by site, including the UNKNOWN_SITE bucket', () => {
    const withSite = makeEntry({ word: 'a', senses: [sense({ url: 'https://a.com' })] });
    const withoutSite = makeEntry({ word: 'b', senses: [sense({ url: '' })] });
    expect(
      filterAndSortSavedWords([withSite, withoutSite], { ...DEFAULT_WORDS_FILTER, site: 'a.com' }),
    ).toEqual([withSite]);
    expect(
      filterAndSortSavedWords([withSite, withoutSite], {
        ...DEFAULT_WORDS_FILTER,
        site: UNKNOWN_SITE,
      }),
    ).toEqual([withoutSite]);
  });

  it('filterAndSortSavedWords sorts newest-first by default', () => {
    const older = makeEntry({ word: 'a', savedAt: 1 });
    const newer = makeEntry({ word: 'b', savedAt: 2 });
    expect(filterAndSortSavedWords([older, newer], DEFAULT_WORDS_FILTER)).toEqual([newer, older]);
  });

  it('filterAndSortSavedWords sorts oldest-first', () => {
    const older = makeEntry({ word: 'a', savedAt: 1 });
    const newer = makeEntry({ word: 'b', savedAt: 2 });
    expect(
      filterAndSortSavedWords([newer, older], { ...DEFAULT_WORDS_FILTER, sort: 'oldest' }),
    ).toEqual([older, newer]);
  });

  it('filterAndSortSavedWords sorts alphabetically by word', () => {
    const b = makeEntry({ word: 'banana', savedAt: 1 });
    const a = makeEntry({ word: 'apple', savedAt: 2 });
    expect(filterAndSortSavedWords([b, a], { ...DEFAULT_WORDS_FILTER, sort: 'alpha' })).toEqual([
      a,
      b,
    ]);
  });

  it('filterAndSortSavedWords composes query + status + site + sort together', () => {
    const match = makeEntry({
      word: 'bank',
      status: 'learning',
      savedAt: 5,
      senses: [sense({ definition: 'money', url: 'https://x.com' })],
    });
    const wrongStatus = makeEntry({
      word: 'bankroll',
      status: 'known',
      savedAt: 6,
      senses: [sense({ definition: 'money', url: 'https://x.com' })],
    });
    const wrongSite = makeEntry({
      word: 'banking',
      status: 'learning',
      savedAt: 7,
      senses: [sense({ definition: 'money', url: 'https://y.com' })],
    });
    const filter: WordsFilterState = {
      query: 'money',
      status: 'learning',
      site: 'x.com',
      sort: 'newest',
    };
    expect(filterAndSortSavedWords([match, wrongStatus, wrongSite], filter)).toEqual([match]);
  });
});
```

Run: `cd packages/app && bunx vitest run test/words-page-policy.test.ts`
Expected: failures — the module `../src/domain/words-page-policy` does not exist yet.

- [ ] **Step 2: Implement.** Create `packages/app/src/domain/words-page-policy.ts`:

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

/** The bucket value for entries with no parseable site. Never a real hostname. */
export const UNKNOWN_SITE = 'unknown';

/**
 * Every distinct hostname a saved entry's senses point at, deduped. A future multi-sense entry
 * (B14) still matches every site it was met on, not just the first — today's `savedWordUpsert`
 * always writes exactly one sense, so in practice this returns at most one hostname per entry
 * until B14 ships, but the shape costs nothing extra now.
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

Add `export * from './domain/words-page-policy';` to `packages/app/src/index.ts`, alongside the
other domain exports (after `export * from './domain/saved-words-policy';`).

Run: `cd packages/app && bunx vitest run test/words-page-policy.test.ts`
Expected: all tests pass.

- [ ] **Step 3: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

Commit:

```
git add packages/app/src/domain/words-page-policy.ts packages/app/src/index.ts packages/app/test/words-page-policy.test.ts
git commit -m "[B6WordsPage] feat: pure filter/sort/site domain helpers for the words page (B6)"
```

---

### Task 2: `saved.list` — wire message + router handler + tests (ONE task)

**Files:**

- Modify: `packages/app/src/wire.ts`
- Modify: `packages/app/src/app/router.ts`
- Modify: `packages/app/test/wire-schema.test.ts`
- Modify: `packages/app/test/app/router.test.ts`
- Regenerate: `packages/app/wire-schema.snapshot.json`

**Interfaces:**

```ts
// New WireMessage arm:
{ type: 'saved.list' }
// New WireReply arm:
{ ok: true, type: 'saved.list', entries: SavedWordEntry[] }
```

- [ ] **Step 1: Write the failing tests.**

In `packages/app/test/wire-schema.test.ts`, inside the existing
`describe('saved.save / saved.delete wire messages (B1)', ...)` block, add (after the existing
`'rejects a saved.setStatus message missing word or status (B5)'` test, just before its closing
`});`):

```ts
it('accepts a valid saved.list message (no payload) (B6)', () => {
  expect(WireMessageSchema.safeParse({ type: 'saved.list' }).success).toBe(true);
});

it('accepts a saved.list reply carrying an array of saved entries, including an empty list (B6)', () => {
  const entry = {
    word: 'bank',
    status: 'learning',
    savedAt: 1,
    senses: [{ definition: 'd', translation: 't', sentence: 's', url: 'u', title: 'ti' }],
  };
  expect(
    WireReplySchema.safeParse({ ok: true, type: 'saved.list', entries: [entry] }).success,
  ).toBe(true);
  expect(WireReplySchema.safeParse({ ok: true, type: 'saved.list', entries: [] }).success).toBe(
    true,
  );
});
```

In `packages/app/test/app/router.test.ts`, inside the same `describe('buildRouter', ...)` block,
right after the existing `'saved.delete removes the entry; idempotent on an unknown word'` test
(`router.test.ts:502-518`), add:

```ts
it('saved.list returns every saved entry, newest-first (matches savedWordsList index order)', async () => {
  const d = deps();
  const route = buildRouter(d);
  await route({
    type: 'saved.save',
    word: 'bank',
    definition: 'd1',
    translation: '',
    sentence: 's1',
    url: 'u1',
    title: 't1',
  });
  await route({
    type: 'saved.save',
    word: 'cat',
    definition: 'd2',
    translation: '',
    sentence: 's2',
    url: 'u2',
    title: 't2',
  });
  const reply = await route({ type: 'saved.list' });
  expect(reply).toMatchObject({
    ok: true,
    type: 'saved.list',
    entries: [{ word: 'cat' }, { word: 'bank' }],
  });
});

it('saved.list returns an empty array when nothing is saved', async () => {
  const d = deps();
  const route = buildRouter(d);
  const reply = await route({ type: 'saved.list' });
  expect(reply).toMatchObject({ ok: true, type: 'saved.list', entries: [] });
});
```

Run:

```
cd packages/app && bunx vitest run test/wire-schema.test.ts test/app/router.test.ts
```

Expected: failures — `WireMessageSchema`/`WireReplySchema` reject `saved.list` (unknown
discriminant), and `router.test.ts`'s two new tests fail (`buildRouter`'s switch has no
`'saved.list'` case, so the message falls through the exhaustive switch and TypeScript itself
would flag this once Step 2's types are in place — but before Step 2, the schema parse already
fails the `WireMessageSchema.safeParse` call inside these router tests too, since `route()`'s
input type requires a valid `WireMessage`).

- [ ] **Step 2: Implement.**

If `saved.list` already exists in `wire.ts`/`router.ts` (landed via another card — B8, B10, and
B15 pin the identical shape), verify it matches this exact request/reply shape byte-for-byte and
SKIP creation; a shape mismatch is a STOP-and-report, not a local edit.

In `packages/app/src/wire.ts`, add the new message arm to `WireMessageSchema`'s array, right after
the `'saved.setStatus'` arm (`wire.ts:121-127`) and before `'cache.clear'` (`wire.ts:128`):

```ts
  // B6: fetch the full saved-word collection for the words page. Payload-free — the words page
  // loads everything and filters/sorts client-side; no pagination params, unlike history.list.
  z.object({ type: z.literal('saved.list') }),
```

Add `'saved.list'` to `MessageTypeEnum` (`wire.ts:143-158`), alongside the other `saved.*`
members:

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
  'saved.list',
]);
```

Add the reply arm to `WireReplySchema`'s union, right after the `saved` reply arm (`wire.ts:175`):

```ts
  z.object({
    ok: z.literal(true),
    type: z.literal('saved.list'),
    entries: z.array(SavedWordEntrySchema),
  }),
```

In `packages/app/src/app/router.ts`, add `savedWordsList` to the import list from `'../index'`
(`router.ts:1-24`), alongside `savedWordUpsert`/`savedWordDelete`/`savedWordSetStatus`:

```ts
import {
  mapError,
  isLookupError,
  cacheGet,
  cachePut,
  cacheClear,
  cacheDelete,
  historyAppend,
  historyList,
  historyClear,
  historyGet,
  historyDelete,
  savedWordUpsert,
  savedWordDelete,
  savedWordSetStatus,
  savedWordsList,
  evaluateNudge,
  type WireMessage,
  type WireReply,
  type LookupError,
  type LookupClient,
  type SettingsStore,
  type Storage,
  type HistoryEntry,
} from '../index';
```

Add one case to the exhaustive switch, right after `'saved.setStatus'` (`router.ts:261-266`) and
before `'cache.clear'` (`router.ts:267-269`):

```ts
      case 'saved.list': {
        const entries = await savedWordsList({ storage: deps.kv });
        return { ok: true, type: 'saved.list', entries };
      }
```

Run:

```
cd packages/app && bun run typecheck
bunx vitest run test/wire-schema.test.ts test/app/router.test.ts
```

Expected: typecheck clean; all tests pass EXCEPT `wire-schema.test.ts`'s
`'JSON-schema snapshot is stable (spec §8.5)'` test, which now fails because the new arms changed
`wireJsonSchema()`'s output and the on-disk snapshot is stale.

- [ ] **Step 3: Regenerate the snapshot.**

```
cd packages/app && bunx vitest run test/wire-schema.test.ts -u
```

Expected: the snapshot test now writes/updates `packages/app/wire-schema.snapshot.json`. Re-run
without `-u` to confirm it's now stable:

```
bunx vitest run test/wire-schema.test.ts
```

Expected: all tests pass, including the snapshot test.

- [ ] **Step 4: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

Commit:

```
git add packages/app/src/wire.ts packages/app/src/app/router.ts packages/app/test/wire-schema.test.ts packages/app/test/app/router.test.ts packages/app/wire-schema.snapshot.json
git commit -m "[B6WordsPage] feat: saved.list wire message + router handler (B6)"
```

---

### Task 3: `words-page-view.ts` — the collection view custom element

**Files:**

- Create: `packages/app/src/ui/styles/tokens.ts` (modify — add two icons)
- Create: `packages/app/src/ui/words-page-view.ts`
- Modify: `packages/app/src/ui/register.ts`
- Modify: `packages/app/src/ui/index.ts`
- Create: `packages/app/test/ui/words-page-view.test.ts`

**Interfaces:**

```ts
class WordsPageView extends HTMLElement {
  set entries(list: SavedWordEntry[]): void;
  get entries(): SavedWordEntry[];
}
// Dispatches (bubbles, composed): 'back' (no detail),
// 'toggle-status' ({ word: string; status: SavedWordStatus }),
// 'delete-word' ({ word: string })
```

- [ ] **Step 1: Write the failing tests.** Create `packages/app/test/ui/words-page-view.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { axeViolations } from './a11y';
import { WordsPageView } from '../../src/ui/words-page-view';
import { registerSidePanel } from '../../src/ui/register';
import type { SavedWordEntry } from '../../src/domain/types';

beforeAll(() => {
  registerSidePanel();
});

function mount(): WordsPageView {
  const el = document.createElement('words-page-view') as WordsPageView;
  document.body.append(el);
  return el;
}

function entry(
  over: Partial<SavedWordEntry> & { word: string; senses?: SavedWordEntry['senses'] },
): SavedWordEntry {
  return {
    word: over.word,
    status: over.status ?? 'learning',
    savedAt: over.savedAt ?? 1_700_000_000_000,
    senses: over.senses ?? [
      {
        definition: `${over.word} definition`,
        translation: '',
        sentence: `a sentence with ${over.word}`,
        url: 'https://example.com/article',
        title: 'Example',
      },
    ],
  };
}

describe('<words-page-view>', () => {
  it('shows the "no saved words yet" empty state before any entries are set', () => {
    const el = mount();
    expect(el.shadowRoot!.textContent).toMatch(/no saved words yet/i);
  });

  it('renders one row per entry, newest-first by default, with word and first-sense sentence', () => {
    const el = mount();
    el.entries = [entry({ word: 'bank', savedAt: 1 }), entry({ word: 'cat', savedAt: 2 })];
    const rows = el.shadowRoot!.querySelectorAll('.word-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain('cat');
    expect(rows[0]!.textContent).toContain('a sentence with cat');
    expect(rows[1]!.textContent).toContain('bank');
  });

  it('shows a distinct empty state when filters match nothing', () => {
    const el = mount();
    el.entries = [entry({ word: 'bank' })];
    const search = el.shadowRoot!.querySelector<HTMLInputElement>('.search')!;
    search.value = 'zzz-no-match';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(el.shadowRoot!.textContent).toMatch(/no words match/i);
  });

  it('search filters rows by word', () => {
    const el = mount();
    el.entries = [entry({ word: 'bank' }), entry({ word: 'cat' })];
    const search = el.shadowRoot!.querySelector<HTMLInputElement>('.search')!;
    search.value = 'ban';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    const rows = el.shadowRoot!.querySelectorAll('.word-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.textContent).toContain('bank');
  });

  it('status filter shows only matching entries', () => {
    const el = mount();
    el.entries = [
      entry({ word: 'bank', status: 'known' }),
      entry({ word: 'cat', status: 'learning' }),
    ];
    const statusSel = el.shadowRoot!.querySelector<HTMLSelectElement>('.status-filter')!;
    statusSel.value = 'known';
    statusSel.dispatchEvent(new Event('change', { bubbles: true }));
    const rows = el.shadowRoot!.querySelectorAll('.word-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.textContent).toContain('bank');
  });

  it('site filter <select> is populated from the current entries and filters rows', () => {
    const el = mount();
    el.entries = [
      entry({
        word: 'bank',
        senses: [
          {
            definition: 'd',
            translation: '',
            sentence: 's',
            url: 'https://a.com/x',
            title: 't',
          },
        ],
      }),
      entry({
        word: 'cat',
        senses: [
          {
            definition: 'd',
            translation: '',
            sentence: 's',
            url: 'https://b.com/y',
            title: 't',
          },
        ],
      }),
    ];
    const siteSel = el.shadowRoot!.querySelector<HTMLSelectElement>('.site-filter')!;
    const optionValues = [...siteSel.options].map((o) => o.value);
    expect(optionValues).toEqual(['all', 'a.com', 'b.com']);
    siteSel.value = 'b.com';
    siteSel.dispatchEvent(new Event('change', { bubbles: true }));
    const rows = el.shadowRoot!.querySelectorAll('.word-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.textContent).toContain('cat');
  });

  it('sort <select> reorders rows (A–Z)', () => {
    const el = mount();
    el.entries = [entry({ word: 'zebra', savedAt: 2 }), entry({ word: 'apple', savedAt: 1 })];
    const sortSel = el.shadowRoot!.querySelector<HTMLSelectElement>('.sort')!;
    sortSel.value = 'alpha';
    sortSel.dispatchEvent(new Event('change', { bubbles: true }));
    const rows = el.shadowRoot!.querySelectorAll('.word-row');
    expect(rows[0]!.textContent).toContain('apple');
    expect(rows[1]!.textContent).toContain('zebra');
  });

  it('clicking the status button dispatches a composed toggle-status with the flipped status', () => {
    const el = mount();
    el.entries = [entry({ word: 'bank', status: 'learning' })];
    let captured: { word: string; status: string } | undefined;
    document.body.addEventListener('toggle-status', (e) => {
      captured = (e as CustomEvent<{ word: string; status: string }>).detail;
    });
    el.shadowRoot!.querySelector<HTMLButtonElement>('.status-btn')!.click();
    expect(captured).toEqual({ word: 'bank', status: 'known' });
  });

  it('clicking the delete button dispatches a composed delete-word event', () => {
    const el = mount();
    el.entries = [entry({ word: 'bank' })];
    let captured: { word: string } | undefined;
    document.body.addEventListener('delete-word', (e) => {
      captured = (e as CustomEvent<{ word: string }>).detail;
    });
    el.shadowRoot!.querySelector<HTMLButtonElement>('.del-btn')!.click();
    expect(captured).toEqual({ word: 'bank' });
  });

  it('clicking Back dispatches a composed back event', () => {
    const el = mount();
    let fired = false;
    document.body.addEventListener('back', () => {
      fired = true;
    });
    el.shadowRoot!.querySelector<HTMLButtonElement>('.back')!.click();
    expect(fired).toBe(true);
  });

  it('the count line reflects filtered vs. total', () => {
    const el = mount();
    el.entries = [entry({ word: 'bank' }), entry({ word: 'cat' })];
    const search = el.shadowRoot!.querySelector<HTMLInputElement>('.search')!;
    search.value = 'ban';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(el.shadowRoot!.querySelector('.count')!.textContent).toBe('1 of 2');
  });

  it('has no detectable a11y violations with rows rendered', async () => {
    const el = mount();
    el.entries = [entry({ word: 'bank' })];
    const violations = await axeViolations(el);
    expect(violations).toEqual([]);
  });
});
```

Run: `cd packages/app && bunx vitest run test/ui/words-page-view.test.ts`
Expected: failures — the module `../../src/ui/words-page-view` does not exist yet.

- [ ] **Step 2: Add the two new icons.** In `packages/app/src/ui/styles/tokens.ts`, append after
      `ICON_STAR` (`tokens.ts:213-215`):

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

- [ ] **Step 3: Implement the component.** Create `packages/app/src/ui/words-page-view.ts`:

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
      ctx.textContent = sentence; // plain text, never innerHTML — S4 is a non-issue by design
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

- [ ] **Step 4: Register and export.** In `packages/app/src/ui/register.ts`, import `WordsPageView`
      and register it inside `registerSidePanel()`, as two anchored edits (current file is 27
      lines):
  - Insert the import after `register.ts:5` (`import { SidePanelView } from './side-panel-view';`):

  ```ts
  import { WordsPageView } from './words-page-view';
  ```

  - Insert the registration call after `register.ts:16` (the existing
    `customElements.define('side-panel-view', SidePanelView);` line, i.e. right before
    `registerSidePanel()`'s closing `}` on line 17):

  ```ts
  if (!customElements.get('words-page-view'))
    customElements.define('words-page-view', WordsPageView);
  ```

In `packages/app/src/ui/index.ts`, append the new barrel export after `index.ts:5`
(`export * from './side-panel-view';`, current file is 8 lines):

```ts
export * from './words-page-view';
```

Run:

```
cd packages/app && bun run typecheck
bunx vitest run test/ui/words-page-view.test.ts
```

Expected: typecheck clean; all 12 tests pass.

- [ ] **Step 5: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

Commit:

```
git add packages/app/src/ui/styles/tokens.ts packages/app/src/ui/words-page-view.ts packages/app/src/ui/register.ts packages/app/src/ui/index.ts packages/app/test/ui/words-page-view.test.ts
git commit -m "[B6WordsPage] feat: words-page-view custom element (B6)"
```

---

### Task 4: `side-panel-view.ts` — "My Words" nav entry point

**Files:**

- Modify: `packages/app/src/ui/side-panel-view.ts`
- Modify: `packages/app/test/ui/side-panel-view.test.ts`

**Interfaces:** dispatches a new composed `open-words` event (no detail) from a `.words-nav`
button.

- [ ] **Step 1: Write the failing test.** In `packages/app/test/ui/side-panel-view.test.ts`, inside
      the existing `describe('<side-panel-view>', ...)` block, add a new test (placed near the
      other header-button test, if one exists, otherwise anywhere inside the block before its
      closing `});`):

```ts
it('the My Words button dispatches a composed open-words event', () => {
  const el = mount();
  let fired = false;
  document.body.addEventListener('open-words', () => {
    fired = true;
  });
  el.shadowRoot!.querySelector<HTMLButtonElement>('.words-nav')!.click();
  expect(fired).toBe(true);
});
```

Run: `cd packages/app && bunx vitest run test/ui/side-panel-view.test.ts`
Expected: failure — `.words-nav` does not exist yet (`querySelector` returns `null`, so
`.click()` throws).

- [ ] **Step 2: Implement.** In `packages/app/src/ui/side-panel-view.ts`:

1. Add `ICON_WORDS_LIST` to the existing token import (`side-panel-view.ts:3`):

```ts
import {
  BASE_VARS,
  THEME_CSS,
  BRAND_MARK_SVG,
  ICON_SHIELD,
  ICON_TRASH,
  ICON_WORDS_LIST,
} from './styles/tokens';
```

2. Replace the CSS's single-selector `.settings{…}` rule block (`side-panel-view.ts:40-43`) with
   a combined selector shared with the new nav button, and move the right-aligning
   `margin-left:auto` onto `.words-nav` (now the first of the two right-aligned buttons in DOM
   order):

```
header{display:flex;align-items:center;gap:8px;padding:13px 18px 11px;flex:none}
.brand{display:inline-flex;align-items:center;gap:8px;font-size:var(--adp-text-sm);font-weight:var(--adp-weight-bold);letter-spacing:var(--adp-tracking-label);color:var(--ad-accent-ink)}
.words-nav{margin-left:auto}
.settings,.words-nav{display:inline-grid;place-items:center;width:var(--adp-action-size);height:var(--adp-action-size);border:0;background:transparent;color:var(--ad-ink-faint);border-radius:var(--adp-radius-control);cursor:pointer;font:inherit;transition:background var(--adp-dur-fast) var(--adp-ease),color var(--adp-dur-fast) var(--adp-ease)}
.settings:hover,.words-nav:hover{background:var(--ad-surface-raised);color:var(--ad-ink)}
.settings:focus-visible,.words-nav:focus-visible{outline:2px solid var(--ad-accent);outline-offset:2px}
.settings svg,.words-nav svg{width:15px;height:15px;pointer-events:none}
```

3. In `connectedCallback()`, replace the header-building block
   (`side-panel-view.ts:126-140`) with:

```ts
const header = document.createElement('header');
const brand = document.createElement('span');
brand.className = 'brand';
brand.innerHTML = `${BRAND_MARK_SVG}<span>AI Dictionary</span>`;
// B6: opens the saved-word collection. Caught by the panel's composition root, same
// "trusted page, own listener" pattern as the settings button below.
const words = document.createElement('button');
words.type = 'button';
words.className = 'words-nav';
words.setAttribute('aria-label', 'My Words');
words.innerHTML = ICON_WORDS_LIST; // decorative aria-hidden SVG; name comes from aria-label
words.addEventListener('click', () =>
  this.dispatchEvent(new CustomEvent('open-words', { bubbles: true, composed: true })),
);
// Persistent path to the options page; same `open-settings` contract as the lookup card,
// caught by the panel's composition root (a trusted page, it calls openOptionsPage itself).
const settings = document.createElement('button');
settings.type = 'button';
settings.className = 'settings';
settings.setAttribute('aria-label', 'Settings');
settings.innerHTML = ICON_SETTINGS; // decorative aria-hidden SVG; name comes from aria-label
settings.addEventListener('click', () =>
  this.dispatchEvent(new CustomEvent('open-settings', { bubbles: true, composed: true })),
);
header.append(brand, words, settings);
```

Run: `cd packages/app && bunx vitest run test/ui/side-panel-view.test.ts`
Expected: all tests pass (existing + the new one).

- [ ] **Step 3: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

Commit:

```
git add packages/app/src/ui/side-panel-view.ts packages/app/test/ui/side-panel-view.test.ts
git commit -m "[B6WordsPage] feat: My Words nav entry point on the side panel (B6)"
```

---

### Task 5: Wire the words page into the Chrome side panel composition root

**Files:**

- Modify: `packages/extension-chrome/src/side-panel.html`
- Modify: `packages/extension-chrome/src/side-panel.ts`

No dedicated unit test exists for `side-panel.ts` in this repo — it is a composition root, covered
by e2e only (same precedent C2's `options.ts` edit and B5's `content.ts`/`side-panel.ts` edits
followed). Task 6's e2e proves this task's correctness; still run the typecheck/lint gate below so
a regression in this file's EXISTING behavior (Recent, save/status/delete, nudge) is caught
immediately.

- [ ] **Step 1: Update the HTML.** In `packages/extension-chrome/src/side-panel.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>AI Dictionary</title>
  </head>
  <body>
    <side-panel-view></side-panel-view>
    <words-page-view style="display:none"></words-page-view>
    <script type="module" src="side-panel.js"></script>
  </body>
</html>
```

- [ ] **Step 2: Wire the composition root.** In `packages/extension-chrome/src/side-panel.ts`:

1. Extend the `@ai-dict/app` import (currently `side-panel.ts:1-13`):

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

2. Right after the existing `const view = document.querySelector('side-panel-view') as
SidePanelView;` (`side-panel.ts:29`), add:

```ts
const wordsView = document.querySelector('words-page-view') as WordsPageView;
```

3. Right after the existing `// B7: the panel's own focus region bubbles the same composed
dismiss-nudge event…` block and its `view.addEventListener('dismiss-nudge', () =>
dismissNudge());` line (`side-panel.ts:213-215`), and before the `// On open, one settings
probe…` comment (`side-panel.ts:217`), add:

```ts
// B6: "My Words" nav — swap the panel from the current lookup focus to the saved-word
// collection. Both elements stay permanently mounted (side-panel.html) so SidePanelView's own
// focus/Recent state survives the round trip; visibility is toggled via inline style.display,
// NOT the `hidden` attribute — side-panel-view.ts's (and words-page-view.ts's) `:host{display:
// flex}` rule is an unconditioned author-stylesheet declaration, which the CSS cascade lets win
// over the UA stylesheet's `[hidden]{display:none}` regardless of the boolean attribute, so
// `hidden` alone would silently do nothing on either element (design spec §2.2).
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
// actions. Optimistic, no-rollback update mirrors the existing toggle-save/toggle-status
// listeners above in this same file — a failed round trip just leaves the words page's local
// view slightly stale until the next saved.list fetch.
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

Run:

```
cd packages/extension-chrome && bun run typecheck
```

Expected: clean (no type errors).

- [ ] **Step 3: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd ../extension-chrome && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

Commit:

```
git add packages/extension-chrome/src/side-panel.html packages/extension-chrome/src/side-panel.ts
git commit -m "[B6WordsPage] feat: wire the words page into the Chrome side panel composition root (B6)"
```

---

### Task 6: e2e coverage for the words page

**Files:**

- Create: `packages/extension-chrome/e2e/b6-words-page.spec.ts`

- [ ] **Step 1: Write the spec.** Create `packages/extension-chrome/e2e/b6-words-page.spec.ts`:

```ts
import { test, expect } from './fixtures';
import { seedSettings } from './helpers';
import type { Page } from '@playwright/test';

/** Seed `saved:*` entries directly into extension storage, matching the ratified E1 shape
 * (index newest-first, mirroring saved-words-policy.ts's own savedWordUpsert ordering) — the
 * same "seed storage directly, skip the real save flow" precedent side-panel.spec.ts's own
 * local seedHistory() helper already uses. */
async function seedSaved(
  page: Page,
  entries: { word: string; status: 'learning' | 'known'; savedAt: number; url: string }[],
): Promise<void> {
  await page.evaluate((es) => {
    const items: Record<string, string> = {
      'saved:index': JSON.stringify(es.map((e) => e.word.toLowerCase())),
    };
    for (const e of es) {
      items[`saved:${e.word.toLowerCase()}`] = JSON.stringify({
        word: e.word,
        status: e.status,
        savedAt: e.savedAt,
        senses: [
          {
            definition: `${e.word} definition`,
            translation: '',
            sentence: `a sentence with ${e.word}`,
            url: e.url,
            title: 'Example',
          },
        ],
      });
    }
    return chrome.storage.local.set(items);
  }, entries);
}

test.describe('B6 words page', () => {
  test('My Words opens the saved-word collection with search/filter/sort and returns via Back', async ({
    context,
    extensionId,
  }) => {
    const setup = await context.newPage();
    await setup.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(setup);
    await seedSaved(setup, [
      { word: 'bank', status: 'learning', savedAt: 1, url: 'https://a.example/x' },
      { word: 'cat', status: 'known', savedAt: 2, url: 'https://b.example/y' },
    ]);

    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/side-panel.html`);
    await panel.waitForSelector('side-panel-view');

    await panel.locator('side-panel-view .words-nav').click();
    await expect(panel.locator('words-page-view')).toBeVisible();
    await expect(panel.locator('side-panel-view')).toBeHidden();

    const rows = panel.locator('words-page-view .word-row');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText('cat'); // newest-first default: savedAt 2 before 1
    await expect(rows.nth(1)).toContainText('bank');

    await panel.locator('words-page-view .search').fill('ban');
    await expect(panel.locator('words-page-view .word-row')).toHaveCount(1);
    await expect(panel.locator('words-page-view .word-row')).toContainText('bank');
    await panel.locator('words-page-view .search').fill('');

    await panel.locator('words-page-view .status-filter').selectOption('known');
    await expect(panel.locator('words-page-view .word-row')).toHaveCount(1);
    await expect(panel.locator('words-page-view .word-row')).toContainText('cat');
    await panel.locator('words-page-view .status-filter').selectOption('all');

    await panel.locator('words-page-view .site-filter').selectOption('a.example');
    await expect(panel.locator('words-page-view .word-row')).toHaveCount(1);
    await expect(panel.locator('words-page-view .word-row')).toContainText('bank');
    await panel.locator('words-page-view .site-filter').selectOption('all');

    await panel.locator('words-page-view .sort').selectOption('alpha');
    const alphaRows = panel.locator('words-page-view .word-row');
    await expect(alphaRows.nth(0)).toContainText('bank');
    await expect(alphaRows.nth(1)).toContainText('cat');

    await panel.locator('words-page-view .back').click();
    await expect(panel.locator('side-panel-view')).toBeVisible();
    await expect(panel.locator('words-page-view')).toBeHidden();
  });

  test('editing status and deleting a word from the words page persists to chrome.storage.local', async ({
    context,
    extensionId,
  }) => {
    const setup = await context.newPage();
    await setup.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(setup);
    await seedSaved(setup, [
      { word: 'bank', status: 'learning', savedAt: 1, url: 'https://a.example/x' },
    ]);

    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/side-panel.html`);
    await panel.waitForSelector('side-panel-view');
    await panel.locator('side-panel-view .words-nav').click();

    const statusBtn = panel.locator('words-page-view .status-btn');
    await expect(statusBtn).toHaveText('Learning');
    await statusBtn.click();
    await expect(statusBtn).toHaveText('Known');
    await expect
      .poll(async () => {
        const dump = (await panel.evaluate(() => chrome.storage.local.get('saved:bank'))) as {
          'saved:bank'?: string;
        };
        return dump['saved:bank']
          ? (JSON.parse(dump['saved:bank']) as { status: string }).status
          : undefined;
      })
      .toBe('known');

    await panel.locator('words-page-view .del-btn').click();
    await expect(panel.locator('words-page-view .word-row')).toHaveCount(0);
    await expect(panel.locator('words-page-view')).toContainText(/no saved words yet/i);
    await expect
      .poll(async () => {
        const dump = (await panel.evaluate(() => chrome.storage.local.get('saved:bank'))) as {
          'saved:bank'?: string;
        };
        return dump['saved:bank'];
      })
      .toBeUndefined();
  });

  test('the words page shows its teaching empty state when nothing is saved yet', async ({
    context,
    extensionId,
  }) => {
    const setup = await context.newPage();
    await setup.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(setup);

    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/side-panel.html`);
    await panel.waitForSelector('side-panel-view');
    await panel.locator('side-panel-view .words-nav').click();

    await expect(panel.locator('words-page-view')).toContainText(/no saved words yet/i);
  });
});
```

Run:

```
GEMINI_API_KEY= bun run build:chrome
cd packages/extension-chrome && bunx playwright test b6-words-page
```

Expected: 3 passed.

- [ ] **Step 2: Commit** — gate, then commit:

```
GEMINI_API_KEY= bun run build:chrome
bun run lint && bun run format:check
```

Commit:

```
git add packages/extension-chrome/e2e/b6-words-page.spec.ts
git commit -m "[B6WordsPage] test: e2e coverage for the words page (B6)"
```

---

## Final gate (run once, after Task 6, before opening the PR)

```
cd packages/app && bun run typecheck
cd ../extension-chrome && bun run typecheck
cd ../..
bun run test
bun run lint
bun run format:check
GEMINI_API_KEY= bun run build:chrome
cd packages/extension-chrome && bunx playwright test b6-words-page side-panel saved-word b5-status-lifecycle side-panel-delete
```

Expected: typecheck clean on both packages; the full Vitest suite green (including the new
`words-page-policy.test.ts`, `ui/words-page-view.test.ts`, and the extensions to
`ui/side-panel-view.test.ts`, `app/router.test.ts`, `wire-schema.test.ts`); lint/format clean; the
Chrome build succeeds with the env key cleared; the new `b6-words-page.spec.ts` and the
regression-guard specs that share files with this card (`side-panel.spec.ts`,
`saved-word.spec.ts`, `b5-status-lifecycle.spec.ts`, `side-panel-delete.spec.ts` — all exercise
`side-panel.ts`/`side-panel-view.ts`/the `saved.*` wire messages this card extends) all pass.

## PR

Regular merge (no squash — owner ruling 2026-07-16). Title: `[B6WordsPage] Words page`. Jira link
per the repo convention: `https://prospa.atlassian.net/browse/B6WordsPage`. Include a **"Testing
performed"** section per this worktree's evidence policy (design spec §6) instead of
screenshots/video — list every suite above with pass counts (unit test file count, e2e scenario
count, gates run). No `pr-assets/*` branch for this card.
