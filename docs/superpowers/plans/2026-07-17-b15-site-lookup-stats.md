# B15 Site Lookup Stats Implementation Plan

> **For agentic workers:** implement task-by-task, TDD (red → green → commit) per task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** the side panel shows a small, always-visible "Sites" section, below Recent, listing the
top 5 domains the reader has looked words up on — lookup count and save count per site — computed
entirely from data the extension already stores (existing `history:*`/`saved:*` entries), with
zero new tracking. Two additive, non-breaking primitives make this possible: `HistoryEntry` gains
an optional `url` field (it had none before this card), and a new `saved.list` wire message lists
every saved word (nothing did before this card).

**Architecture:** a new pure domain module (`packages/app/src/domain/site-stats-policy.ts`, `c3-1`,
grouped under the existing `c3-112 persistence-policies` component) computes the tally from
`HistoryEntry[]` + `SavedWordEntry[]` the side panel's composition root
(`packages/extension-chrome/src/side-panel.ts`) already fetches over the wire. The panel's UI
(`packages/app/src/ui/side-panel-view.ts`) renders whatever the composition root hands it — no
domain logic in the UI layer. Full design rationale, including why `HistoryEntry` lacks `url`
today and why the wire needs a new message, is in
`docs/superpowers/specs/2026-07-17-b15-site-lookup-stats-design.md` — read it before Task 1.

**Tech Stack:** TypeScript, Vitest + happy-dom (unit), Playwright (e2e), Zod (wire schemas).

## Global Constraints

- Implementer: dispatch each implementation/fix task to the `hunter` subagent — never a generic
  implementer.
- Start in a fresh git worktree under `.claude/worktrees/` on branch `feature/B15SiteLookupStats`.
- Commit subject convention for every task in this plan:
  `[B15SiteLookupStats] feat: <imperative summary> (B15)`. No `Co-Authored-By` trailer, no
  attribution footer.
- `bun run lint` and `bun run format:check` must be clean before every commit.
- Every task must leave `cd packages/app && bun run typecheck` (and, from Task 5 on,
  `cd packages/extension-chrome && bun run typecheck`) green.
- **Task 2 (the new `saved.list` wire message) touches `wire.ts` AND `router.ts` in the SAME
  task** — CONTRACTS' exhaustive-`switch(msg.type)`-with-no-`default` rule means they cannot
  typecheck apart. Do not split it.
- **Every task that edits `packages/app/src/wire.ts` ends with regenerating
  `packages/app/wire-schema.snapshot.json`** via
  `cd packages/app && bunx vitest run test/wire-schema.test.ts -u`, then committing the
  regenerated file alongside the code change that caused the diff. Never hand-edit the snapshot.
- `HistoryEntry.url` is **optional** (`url?: string`) — never make it required, and never write a
  migration for entries that predate this card. `extractSiteKey` treats a missing/empty/malformed
  url as "no site" (excluded from the tally), never a crash.
- `computeSiteLookupStats`/`extractSiteKey` are pure — no `Storage`/wire/DOM access inside
  `site-stats-policy.ts`. The side panel's composition root does all the fetching and hands
  already-resolved arrays to the pure function.
- UI additions read only `--ad-*`/`--adp-*` design tokens (no hard-coded colors) — the new
  "Sites" section reuses the exact same rule shapes as the existing "Recent" section.
- No new manifest permission, no new storage keyspace (`ref-kv-storage-prefixes` unaffected —
  only the existing `history:*`/`saved:*` prefixes are read).
- The e2e build must clear any ambient `GEMINI_API_KEY`
  (`GEMINI_API_KEY= bun run build:chrome:e2e`) before running Task 6's suite.
- `.c3/` is CLI-only — Task 7 notes the C3 sweep rather than hand-editing `.c3/`.

---

### Task 1: `HistoryEntry` gains `url` — types, wire schema, router population

**Files:**

- Modify: `packages/app/src/domain/types.ts`
- Modify: `packages/app/src/wire.ts`
- Modify: `packages/app/src/app/router.ts`
- Modify: `packages/app/test/history-policy.test.ts`
- Modify: `packages/app/test/wire-schema.test.ts`
- Modify: `packages/app/test/app/router.test.ts`
- Regenerate: `packages/app/wire-schema.snapshot.json`

**Interfaces:**

```ts
export interface HistoryEntry {
  id: string;
  word: string;
  context: string;
  url?: string; // NEW
  result: LookupResult;
  createdAt: number;
}
```

- [ ] **Step 1: Write the failing tests.**

In `packages/app/test/history-policy.test.ts`, insert a new test right after the existing
`'historyGet returns the stored entry, or null on miss'` test (after line 110's closing `});`,
before `'historyDelete removes only the targeted entry...'`):

```ts
it('round-trips an entry carrying url (B15)', async () => {
  const s = memStorage();
  const e = { ...entry('1'), url: 'https://example.com/article' };
  await historyAppend({ storage: s }, e);
  const { entries } = await historyList({ storage: s }, {});
  expect(entries[0]!.url).toBe('https://example.com/article');
});

it('an entry written before url existed round-trips with url undefined (B15 back-compat)', async () => {
  const s = memStorage();
  await historyAppend({ storage: s }, entry('1')); // entry() never sets url
  const { entries } = await historyList({ storage: s }, {});
  expect(entries[0]!.url).toBeUndefined();
});
```

In `packages/app/test/wire-schema.test.ts`, insert a new test right after the existing
`'lookup result carries an optional nudge flag; old results still parse (B7)'` test (after its
closing `});`, before the `'promptEnvelope is required on settings...'` test, around line 366):

```ts
it('a history reply entry carries an optional url; old entries (no url) still parse (B15)', () => {
  const result = {
    markdown: 'm',
    word: 'w',
    target: 'vi',
    model: 'x',
    fromCache: false,
    fetchedAt: 1,
  };
  const withUrl = {
    ok: true,
    type: 'history',
    entries: [
      { id: '1', word: 'bank', context: 'c', url: 'https://example.com', result, createdAt: 1 },
    ],
  };
  expect(WireReplySchema.safeParse(withUrl).success).toBe(true);
  const withoutUrl = {
    ok: true,
    type: 'history',
    entries: [{ id: '1', word: 'bank', context: 'c', result, createdAt: 1 }],
  };
  expect(WireReplySchema.safeParse(withoutUrl).success).toBe(true);
});
```

In `packages/app/test/app/router.test.ts`, insert a new test right after the existing
`'lookup miss → calls client, caches, appends history, replies result (D1)'` test (after its
closing `});`, around line 83):

```ts
it('a lookup miss carries req.url onto the resulting HistoryEntry (B15)', async () => {
  const d = deps();
  const route = buildRouter(d);
  await route({
    type: 'lookup',
    req: { ...req, url: 'https://example.com/piece' },
    requestId: 'a',
  });
  const { entries } = await historyList({ storage: d.kv }, {});
  expect(entries[0]!.url).toBe('https://example.com/piece');
});
```

Run:

```
cd packages/app && bunx vitest run test/history-policy.test.ts test/wire-schema.test.ts test/app/router.test.ts
```

Expected: the two new `history-policy.test.ts` tests pass already (TypeScript will currently
reject `url` on the entry literal — a compile error, not a runtime failure, since `HistoryEntry`
has no `url` field yet); the new `wire-schema.test.ts` test fails on the `withUrl` case
(`HistoryEntrySchema` is `z.strictObject` and rejects the unknown `url` key); the new
`router.test.ts` test fails (`entries[0]!.url` is `undefined`, not the expected string).

- [ ] **Step 2: Implement.**

In `packages/app/src/domain/types.ts`, change `HistoryEntry` (currently lines 136-142):

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

In `packages/app/src/wire.ts`, change `HistoryEntrySchema` (currently lines 70-76):

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

In `packages/app/src/app/router.ts`, change `handleLookup`'s `HistoryEntry` construction
(currently lines 141-147):

```ts
if (saveHistory) {
  const entry: HistoryEntry = {
    id: crypto.randomUUID(),
    word: req.word,
    context: req.context,
    url: req.url, // B15
    result: storableResult,
    createdAt: result.fetchedAt,
  };
  await deps.queue.run(() => historyAppend({ storage: deps.kv }, entry));
}
```

Run:

```
cd packages/app && bunx vitest run test/history-policy.test.ts test/wire-schema.test.ts test/app/router.test.ts
cd packages/app && bun run typecheck
```

Expected: all tests pass (existing + 5 new across the three files); typecheck clean.

- [ ] **Step 3: Regenerate the wire-schema snapshot.**

```
cd packages/app && bunx vitest run test/wire-schema.test.ts -u
```

Expected: `packages/app/wire-schema.snapshot.json` is rewritten (its `HistoryEntry` JSON-schema
entry now includes `url`); `git diff --stat packages/app/wire-schema.snapshot.json` shows a
change.

- [ ] **Step 4: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd .. && cd .. && bun run lint && bun run format:check
```

Commit:

```
git add packages/app/src/domain/types.ts packages/app/src/wire.ts packages/app/src/app/router.ts \
  packages/app/test/history-policy.test.ts packages/app/test/wire-schema.test.ts \
  packages/app/test/app/router.test.ts packages/app/wire-schema.snapshot.json
git commit -m "[B15SiteLookupStats] feat: add optional url to HistoryEntry (B15)" \
  -m $'Tribe-Card: b15-site-lookup-stats\nTribe-Task: 1/7'
```

---

### Task 2: `saved.list` wire message + router case (ONE task — wire arm and router case cannot typecheck apart)

**Files:**

- Modify: `packages/app/src/wire.ts`
- Modify: `packages/app/src/app/router.ts`
- Modify: `packages/app/test/wire-schema.test.ts`
- Modify: `packages/app/test/app/router.test.ts`
- Regenerate: `packages/app/wire-schema.snapshot.json`

**Interfaces:**

```ts
// Request (payload-free, mirrors settings.get / cache.clear):
{ type: 'saved.list' }
// Reply:
{ ok: true, type: 'saved.list', entries: SavedWordEntry[] }
```

- [ ] **Step 1: Write the failing tests.**

In `packages/app/test/wire-schema.test.ts`, inside the existing
`describe('saved.save / saved.delete wire messages (B1)', ...)` block, add these tests right
before its closing `});` (after the `'rejects a saved.setStatus message missing word or status
(B5)'` test, around line 496):

```ts
it('accepts a valid saved.list message (B15)', () => {
  expect(WireMessageSchema.safeParse({ type: 'saved.list' }).success).toBe(true);
});

it('a saved.list reply carries an array of ratified entries; empty array is valid (B15)', () => {
  expect(WireReplySchema.safeParse({ ok: true, type: 'saved.list', entries: [] }).success).toBe(
    true,
  );
  const entry = {
    word: 'bank',
    status: 'learning',
    savedAt: 1,
    senses: [{ definition: 'd', translation: 't', sentence: 's', url: 'u', title: 'ti' }],
  };
  expect(
    WireReplySchema.safeParse({ ok: true, type: 'saved.list', entries: [entry] }).success,
  ).toBe(true);
});

it('rejects a saved.list reply with a malformed entry inside the array (B15)', () => {
  const bad = { word: 'bank', status: 'archived', savedAt: 1, senses: [] };
  expect(WireReplySchema.safeParse({ ok: true, type: 'saved.list', entries: [bad] }).success).toBe(
    false,
  );
});
```

In `packages/app/test/app/router.test.ts`, insert new tests right after the existing
`'saved.setStatus is case-insensitive on the word key (B5)'` test (after its closing `});`,
before `describe('errlog routing', ...)`, around line 651):

```ts
it('saved.list on an empty store replies with an empty array (B15)', async () => {
  const route = buildRouter(deps());
  const reply = await route({ type: 'saved.list' });
  expect(reply).toMatchObject({ ok: true, type: 'saved.list', entries: [] });
});

it('saved.list includes a word saved via saved.save (B15)', async () => {
  const d = deps();
  const route = buildRouter(d);
  await route({
    type: 'saved.save',
    word: 'bank',
    definition: 'a financial institution',
    translation: '',
    sentence: 'the river bank',
    url: 'https://example.com',
    title: 'Example',
  });
  const reply = await route({ type: 'saved.list' });
  expect(reply).toMatchObject({
    ok: true,
    type: 'saved.list',
    entries: [{ word: 'bank', status: 'learning' }],
  });
});
```

Run:

```
cd packages/app && bunx vitest run test/wire-schema.test.ts test/app/router.test.ts
```

Expected: all 5 new tests fail — `WireMessageSchema`/`WireReplySchema` reject `'saved.list'`
(unknown discriminant), and `route({ type: 'saved.list' })` is a TypeScript error (not a member of
the `WireMessage` union) until Step 2 lands.

- [ ] **Step 2: Implement.**

In `packages/app/src/wire.ts`, add a new arm to `WireMessageSchema` (currently lines 95-141),
placed right after the existing `saved.setStatus` arm and before `cache.clear`:

```ts
  z.object({ type: z.literal('cache.clear') }),
```

becomes:

```ts
  // B15: list every saved word (no filter/pagination — mirrors savedWordsList's own contract).
  // Consumed by the side panel's per-domain save tally; B6 (words page) is a documented future
  // consumer of this same message (see the design spec's §2.3).
  z.object({ type: z.literal('saved.list') }),
  z.object({ type: z.literal('cache.clear') }),
```

Add `'saved.list'` to `MessageTypeEnum` (currently lines 143-158):

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

Add a new reply arm to `WireReplySchema` (currently lines 160-189), placed right after the
existing `{ ok: true, type: 'saved', entry: SavedWordEntrySchema }` arm:

```ts
  z.object({ ok: z.literal(true), type: z.literal('saved'), entry: SavedWordEntrySchema }),
```

becomes:

```ts
  z.object({ ok: z.literal(true), type: z.literal('saved'), entry: SavedWordEntrySchema }),
  // B15: the full saved-word list. A distinct reply `type` from the singular 'saved' reply
  // (saved.save/saved.setStatus reply with one entry; this replies with all of them).
  z.object({
    ok: z.literal(true),
    type: z.literal('saved.list'),
    entries: z.array(SavedWordEntrySchema),
  }),
```

In `packages/app/src/app/router.ts`, add `savedWordsList` to the import block from `'../index'`
(currently lines 1-24):

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

Add a new switch case, placed right after the existing `'saved.setStatus'` case (currently lines
261-266) and before `'cache.clear'`:

```ts
      case 'saved.setStatus': {
        const entry = await deps.queue.run(() =>
          savedWordSetStatus({ storage: deps.kv }, msg.word, msg.status),
        );
        return entry ? { ok: true, type: 'saved', entry } : { ok: true, type: 'ack' };
      }
      case 'saved.list': {
        const entries = await savedWordsList({ storage: deps.kv });
        return { ok: true, type: 'saved.list', entries };
      }
      case 'cache.clear':
```

Run:

```
cd packages/app && bunx vitest run test/wire-schema.test.ts test/app/router.test.ts
cd packages/app && bun run typecheck
```

Expected: all tests pass (existing + 5 new); typecheck clean (the exhaustive `switch` in
`router.ts` still covers every `WireMessage['type']`).

- [ ] **Step 3: Regenerate the wire-schema snapshot.**

```
cd packages/app && bunx vitest run test/wire-schema.test.ts -u
```

Expected: `packages/app/wire-schema.snapshot.json` changes again (now including the `saved.list`
message/reply shapes).

- [ ] **Step 4: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd .. && cd .. && bun run lint && bun run format:check
```

Commit:

```
git add packages/app/src/wire.ts packages/app/src/app/router.ts packages/app/test/wire-schema.test.ts \
  packages/app/test/app/router.test.ts packages/app/wire-schema.snapshot.json
git commit -m "[B15SiteLookupStats] feat: add saved.list wire message + router case (B15)" \
  -m $'Tribe-Card: b15-site-lookup-stats\nTribe-Task: 2/7'
```

---

### Task 3: `site-stats-policy.ts` — the pure domain function

**Files:**

- Create: `packages/app/src/domain/site-stats-policy.ts`
- Create: `packages/app/test/site-stats-policy.test.ts`
- Modify: `packages/app/src/index.ts`

**Interfaces:**

```ts
export const DEFAULT_TOP_SITES = 5;
export interface SiteLookupStat {
  site: string;
  lookups: number;
  saves: number;
}
export function extractSiteKey(url: string | undefined): string | null;
export function computeSiteLookupStats(
  history: readonly HistoryEntry[],
  saved: readonly SavedWordEntry[],
  topN?: number,
): SiteLookupStat[];
```

- [ ] **Step 1: Write the failing tests.** Create `packages/app/test/site-stats-policy.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  extractSiteKey,
  computeSiteLookupStats,
  DEFAULT_TOP_SITES,
} from '../src/domain/site-stats-policy';
import type { HistoryEntry, SavedWordEntry } from '../src';

const result = {
  markdown: '',
  word: 'w',
  target: 'vi',
  model: 'gemini-2.5-flash',
  fromCache: false,
  fetchedAt: 0,
};

function historyEntry(id: string, url: string | undefined): HistoryEntry {
  return { id, word: 'w', context: '', url, result, createdAt: Number(id) || 0 };
}

function savedEntry(word: string, urls: string[]): SavedWordEntry {
  return {
    word,
    status: 'learning',
    savedAt: 0,
    senses: urls.map((url) => ({
      definition: 'd',
      translation: '',
      sentence: 's',
      url,
      title: 't',
    })),
  };
}

describe('extractSiteKey', () => {
  it('lowercases the hostname and strips a leading www.', () => {
    expect(extractSiteKey('https://WWW.Example.com/path')).toBe('example.com');
  });
  it('leaves a hostname with no www. prefix unchanged (lowercased)', () => {
    expect(extractSiteKey('https://Reddit.com/r/x')).toBe('reddit.com');
  });
  it('does not strip "www" when it is not the leading label (naive v1 — see design spec §2.2)', () => {
    expect(extractSiteKey('https://mywww.example.com')).toBe('mywww.example.com');
  });
  it('returns null for undefined, empty, and malformed urls', () => {
    expect(extractSiteKey(undefined)).toBeNull();
    expect(extractSiteKey('')).toBeNull();
    expect(extractSiteKey('not a url')).toBeNull();
  });
});

describe('computeSiteLookupStats', () => {
  it('tallies lookups per site, ignoring entries with no resolvable url', () => {
    const history = [
      historyEntry('1', 'https://example.com/a'),
      historyEntry('2', 'https://example.com/b'),
      historyEntry('3', 'https://reddit.com/r/x'),
      historyEntry('4', undefined),
      historyEntry('5', ''),
    ];
    const stats = computeSiteLookupStats(history, []);
    expect(stats).toEqual([
      { site: 'example.com', lookups: 2, saves: 0 },
      { site: 'reddit.com', lookups: 1, saves: 0 },
    ]);
  });

  it('tallies saves per site, counting a multi-sense entry on the SAME site once', () => {
    const saved = [
      savedEntry('bank', ['https://example.com/a', 'https://example.com/b']), // same site twice
      savedEntry('ledger', ['https://reddit.com/r/x']),
    ];
    const stats = computeSiteLookupStats([], saved);
    expect(stats).toEqual([
      { site: 'example.com', lookups: 0, saves: 1 },
      { site: 'reddit.com', lookups: 0, saves: 1 },
    ]);
  });

  it('a save on a different site than any lookup still contributes its own row', () => {
    const history = [historyEntry('1', 'https://example.com/a')];
    const saved = [savedEntry('bank', ['https://reddit.com/r/x'])];
    const stats = computeSiteLookupStats(history, saved);
    expect(stats).toContainEqual({ site: 'reddit.com', lookups: 0, saves: 1 });
    expect(stats).toContainEqual({ site: 'example.com', lookups: 1, saves: 0 });
  });

  it('sorts by lookups desc, ties broken by saves desc, then alphabetically', () => {
    const history = [
      historyEntry('1', 'https://a.com'),
      historyEntry('2', 'https://b.com'),
      historyEntry('3', 'https://b.com'),
      historyEntry('4', 'https://c.com'),
      historyEntry('5', 'https://c.com'),
    ];
    const saved = [savedEntry('w1', ['https://c.com'])];
    const stats = computeSiteLookupStats(history, saved);
    // b.com and c.com both have 2 lookups; c.com has 1 save, b.com has 0 → c.com first.
    expect(stats.map((s) => s.site)).toEqual(['c.com', 'b.com', 'a.com']);
  });

  it('respects topN, defaulting to DEFAULT_TOP_SITES', () => {
    const history = Array.from({ length: 6 }, (_, i) =>
      historyEntry(String(i), `https://site${i}.com`),
    );
    expect(computeSiteLookupStats(history, [])).toHaveLength(DEFAULT_TOP_SITES);
    expect(computeSiteLookupStats(history, [], 6)).toHaveLength(6);
  });

  it('returns [] for empty inputs', () => {
    expect(computeSiteLookupStats([], [])).toEqual([]);
  });
});
```

Run: `cd packages/app && bunx vitest run test/site-stats-policy.test.ts`
Expected: fails — the module `../src/domain/site-stats-policy` does not exist.

- [ ] **Step 2: Implement.** Create `packages/app/src/domain/site-stats-policy.ts`:

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
 * handing it entries it already fetched over the wire.
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

In `packages/app/src/index.ts`, add a new export line right after the existing
`export * from './domain/nudge-policy';`:

```ts
export * from './domain/nudge-policy';
export * from './domain/site-stats-policy';
```

Run:

```
cd packages/app && bunx vitest run test/site-stats-policy.test.ts
cd packages/app && bun run typecheck
```

Expected: all 13 tests pass; typecheck clean.

- [ ] **Step 3: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd .. && cd .. && bun run lint && bun run format:check
```

Commit:

```
git add packages/app/src/domain/site-stats-policy.ts packages/app/test/site-stats-policy.test.ts \
  packages/app/src/index.ts
git commit -m "[B15SiteLookupStats] feat: add site-stats-policy pure domain function (B15)" \
  -m $'Tribe-Card: b15-site-lookup-stats\nTribe-Task: 3/7'
```

---

### Task 4: `side-panel-view.ts` — the "Sites" section

**Files:**

- Modify: `packages/app/src/ui/side-panel-view.ts`
- Modify: `packages/app/test/ui/side-panel-view.test.ts`

**Interfaces:**

```ts
set siteStats(stats: SiteLookupStat[]): void;
get siteStats(): SiteLookupStat[];
```

- [ ] **Step 1: Write the failing tests.** Append to
      `packages/app/test/ui/side-panel-view.test.ts`, inside the existing
      `describe('<side-panel-view>', ...)` block, just before its closing `});` (after the
      `'has no axe violations (no-key setup invite)'` test):

```ts
it('hides the Sites section entirely when there is no data (B15)', () => {
  const el = mount();
  el.siteStats = [];
  const sites = el.shadowRoot!.querySelector('.sites') as HTMLElement;
  expect(sites.hidden).toBe(true);
});

it('lists site rows in the given order with lookup/save counts (B15)', () => {
  const el = mount();
  el.siteStats = [
    { site: 'example.com', lookups: 2, saves: 1 },
    { site: 'reddit.com', lookups: 1, saves: 0 },
  ];
  const sites = el.shadowRoot!.querySelector('.sites') as HTMLElement;
  expect(sites.hidden).toBe(false);
  const rows = sites.querySelectorAll('.site-row');
  expect(rows.length).toBe(2);
  expect(rows[0]!.querySelector('.site-name')!.textContent).toBe('example.com');
  expect(rows[0]!.querySelector('.site-counts')!.textContent).toBe('2 lookups · 1 saved');
  expect(rows[1]!.querySelector('.site-name')!.textContent).toBe('reddit.com');
  expect(rows[1]!.querySelector('.site-counts')!.textContent).toBe('1 lookup');
});

it('the Sites section has no interactive elements in v1 (read-only list, B15)', () => {
  const el = mount();
  el.siteStats = [{ site: 'example.com', lookups: 1, saves: 0 }];
  const sites = el.shadowRoot!.querySelector('.sites') as HTMLElement;
  expect(sites.querySelectorAll('button, a').length).toBe(0);
});

it('has no axe violations (Sites section populated, B15)', async () => {
  const el = mount();
  el.siteStats = [
    { site: 'example.com', lookups: 2, saves: 1 },
    { site: 'reddit.com', lookups: 1, saves: 0 },
  ];
  expect(await axeViolations(el)).toEqual([]);
});
```

Run: `cd packages/app && bunx vitest run test/ui/side-panel-view.test.ts`
Expected: failures — `.sites` element does not exist, `siteStats` is not a recognized property
(TypeScript compile error on `el.siteStats = ...` until Step 2 lands).

- [ ] **Step 2: Implement.** In `packages/app/src/ui/side-panel-view.ts`:

1. Add the import (right after the existing `import type { HistoryEntry } from
'../domain/types';`):

```ts
import type { HistoryEntry } from '../domain/types';
import type { SiteLookupStat } from '../domain/site-stats-policy';
```

2. Add new CSS rules to `CSS`, immediately after the existing `.recent-context{...}` rule and
   before `footer{...}` (`side-panel-view.ts:87-88`):

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

3. Add new private fields to the `SidePanelView` class (alongside `recentEl`/`recentList`):

```ts
export class SidePanelView extends HTMLElement {
  private _focus: PanelFocusState = { kind: 'empty' };
  private _recent: HistoryEntry[] = [];
  private _siteStats: SiteLookupStat[] = [];
  private focusEl!: HTMLElement;
  private recentEl!: HTMLElement;
  private recentList!: HTMLUListElement;
  private sitesEl!: HTMLElement;
  private sitesList!: HTMLUListElement;
```

4. In `connectedCallback`, extend the DOM-construction block. The existing code:

```ts
    main.append(this.focusEl, this.recentEl);

    const footer = document.createElement('footer');
    footer.innerHTML = `${ICON_SHIELD}<span>Stays on your device</span>`;

    root.append(accent, header, main, footer);
    this.renderFocus();
    this.renderRecent();
  }
```

becomes:

```ts
    // B15: per-domain lookup/save tally — same hidden-when-empty contract as Recent. A
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

    const footer = document.createElement('footer');
    footer.innerHTML = `${ICON_SHIELD}<span>Stays on your device</span>`;

    root.append(accent, header, main, footer);
    this.renderFocus();
    this.renderRecent();
    this.renderSites();
  }
```

5. Add the `siteStats` accessor pair, right after the existing `recent` accessor pair:

```ts
  /** Recent lookups, newest-first. An empty list collapses the whole section. */
  set recent(entries: HistoryEntry[]) {
    this._recent = entries;
    if (this.shadowRoot) this.renderRecent();
  }
  get recent(): HistoryEntry[] {
    return this._recent;
  }

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

6. Add the render methods, right after `recentRow`'s closing brace (end of the class):

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
}
```

Run:

```
cd packages/app && bunx vitest run test/ui/side-panel-view.test.ts
cd packages/app && bun run typecheck
```

Expected: all tests pass (existing + 4 new); typecheck clean.

- [ ] **Step 3: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd .. && cd .. && bun run lint && bun run format:check
```

Commit:

```
git add packages/app/src/ui/side-panel-view.ts packages/app/test/ui/side-panel-view.test.ts
git commit -m "[B15SiteLookupStats] feat: add Sites section to side-panel-view (B15)" \
  -m $'Tribe-Card: b15-site-lookup-stats\nTribe-Task: 4/7'
```

---

### Task 5: `side-panel.ts` — fetch + wire the tally into the view

**Files:**

- Modify: `packages/extension-chrome/src/side-panel.ts`

No dedicated unit test exists for `side-panel.ts` in this repo — it is a composition root,
covered by e2e only (same precedent as C2's `options.ts` edit and B5's `content.ts`/`side-panel.ts`
edits). This task's correctness is proven by Task 6's e2e; still run the typecheck/lint gate below
at the end so a regression in existing behavior (Recent refresh, save/unsave, etc. — all in the
same file) is caught immediately.

- [ ] **Step 1: Implement.** In `packages/extension-chrome/src/side-panel.ts`:

1. Extend the `@ai-dict/app` import block (currently lines 1-13) with the two new names:

```ts
import {
  registerSidePanel,
  sanitizeMarkdown,
  mapError,
  createSaveReplyGuard,
  computeSiteLookupStats,
  type SiteLookupStat,
  type PanelFocusState,
  type SidePanelView,
  type LookupResult,
  type LookupError,
  type HistoryEntry,
  type WireReply,
  type SavedWordStatus,
} from '@ai-dict/app';
```

2. Add `refreshSiteStats`, right after the existing `refreshRecent` function (currently lines
   130-143):

```ts
async function refreshRecent(): Promise<void> {
  try {
    // chrome.runtime.sendMessage is typed `any`; pin it to `unknown` first so the WireReply
    // assertion is a real narrowing the linter accepts (and we still gate on the shape below).
    const raw: unknown = await chrome.runtime.sendMessage({ type: 'history.list', limit: 50 });
    const reply = raw as WireReply | undefined;
    if (reply && reply.ok && reply.type === 'history') {
      recent = reply.entries;
      view.recent = recent;
    }
  } catch {
    // History is a convenience; a failed query just leaves the section as-is.
  }
}

/**
 * B15: per-domain lookup/save tally shown in the panel's "Sites" section. Computed from the
 * FULL stored history/saved-word log, not just the last-50 slice `refreshRecent` shows to
 * Recent — `history.list` with no `limit` returns every entry (history-policy's own default),
 * the exact same call shape "Export history" already uses (options.ts), so a site's true
 * lifetime lookup count is never undercounted by Recent's display cap. Both `history.list` and
 * `saved.list` are read-only; no new tracking surface.
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

3. Extend the `'delete'` listener (currently lines 159-168) so a history delete also refreshes
   the tally:

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

4. Extend the `'toggle-save'` listener (currently lines 179-200) so a save/unsave refreshes the
   tally once the round trip settles:

```ts
view.addEventListener('toggle-save', () => {
  if (!lastSavePayload) return;
  const willSave = !lastSaved;
  lastSaved = willSave;
  setSaved(willSave);
  if (!willSave) lastStatus = undefined;
  const token = saveReplyGuard.next();
  const message = willSave
    ? { type: 'saved.save' as const, ...lastSavePayload }
    : { type: 'saved.delete' as const, word: lastSavePayload.word };
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
});
```

5. Extend the mirror `onMessage` handler's `'result'` branch (currently lines 256-268):

```ts
    } else if (msg.state === 'result') {
      if (!isLookupResult(msg.payload)) {
        console.warn('[side-panel] invalid result payload');
        return;
      }
      view.focusState = resultToFocus(msg.payload);
      trackSaveContext(msg.payload, {
        sentence: typeof msg.sentence === 'string' ? msg.sentence : undefined,
        url: typeof msg.url === 'string' ? msg.url : undefined,
        title: typeof msg.title === 'string' ? msg.title : undefined,
      });
      // The router just appended this lookup to history; pull it into Recent + the site tally.
      void refreshRecent();
      void refreshSiteStats(); // B15
    } else if (msg.state === 'error') {
```

6. Extend the boot sequence (currently lines 309-313):

```ts
// On open, populate Recent from stored history. The focus region stays on its teaching empty
// state until the first lookup mirrors in or a recent row is clicked — unless no key is set,
// in which case initFromSettings swaps it for the setup invite (and stamps the theme).
void refreshRecent();
void refreshSiteStats(); // B15
void initFromSettings().then(() => recoverFocus());
```

Run:

```
cd packages/extension-chrome && bun run typecheck
```

Expected: clean (no type errors).

- [ ] **Step 2: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd ../extension-chrome && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

Commit:

```
git add packages/extension-chrome/src/side-panel.ts
git commit -m "[B15SiteLookupStats] feat: wire site-stats fetch/refresh into side-panel.ts (B15)" \
  -m $'Tribe-Card: b15-site-lookup-stats\nTribe-Task: 5/7'
```

---

### Task 6: e2e coverage

**Files:**

- Create: `packages/extension-chrome/e2e/b15-site-lookup-stats.spec.ts`

- [ ] **Step 1: Write the new functional spec.** Create
      `packages/extension-chrome/e2e/b15-site-lookup-stats.spec.ts`:

```ts
import { test, expect } from './fixtures';
import { seedSettings, selectWord, openTrigger, mockGemini } from './helpers';

/**
 * A second, differently-hosted fixture route — deliberately NOT added to the shared
 * `helpers.ts` (kept local to this spec) to avoid touching a file other in-flight cards may also
 * be editing (design spec §9 Concurrency). Mirrors gotoFixture's own shape.
 */
async function gotoSecondFixture(page: import('@playwright/test').Page): Promise<void> {
  await page.route('http://second.fixture/', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<html><body><p id="t">The ledger by the desk is heavy.</p></body></html>',
    }),
  );
  await page.goto('http://second.fixture/');
}

test.describe('B15 site lookup stats', () => {
  test('a fresh profile with no history shows no Sites section', async ({
    context,
    extensionId,
  }) => {
    await mockGemini(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/side-panel.html`);
    await seedSettings(page);
    await page.reload();
    await expect(page.locator('side-panel-view').locator('.sites')).toBeHidden();
  });

  test('lookups across two sites are tallied per site in the side panel', async ({
    context,
    extensionId,
  }) => {
    await mockGemini(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/side-panel.html`);
    await seedSettings(page);

    const lookupPage = await context.newPage();
    await lookupPage.route('http://test.fixture/', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<html><body><p id="t">The bank by the river is steep.</p></body></html>',
      }),
    );
    await lookupPage.goto('http://test.fixture/');
    await lookupPage.waitForTimeout(1_000);
    await selectWord(lookupPage, 't', 'bank');
    await openTrigger(lookupPage);
    await expect(lookupPage.locator('bottom-sheet lookup-card')).toContainText(
      'financial institution',
      { timeout: 10_000 },
    );

    // A second lookup on the SAME site (test.fixture) — should aggregate, not add a new row.
    await lookupPage.reload();
    await lookupPage.waitForTimeout(1_000);
    await selectWord(lookupPage, 't', 'bank');
    await openTrigger(lookupPage);
    await expect(lookupPage.locator('bottom-sheet lookup-card')).toContainText(
      'financial institution',
      { timeout: 10_000 },
    );

    // A lookup on a SECOND, different site.
    await gotoSecondFixture(lookupPage);
    await lookupPage.waitForTimeout(1_000);
    await selectWord(lookupPage, 't', 'ledger');
    await openTrigger(lookupPage);
    await expect(lookupPage.locator('bottom-sheet lookup-card')).toContainText(
      'financial institution',
      { timeout: 10_000 },
    );

    await page.bringToFront();
    await page.reload();
    const sites = page.locator('side-panel-view').locator('.sites');
    await expect(sites).toBeVisible({ timeout: 10_000 });
    const rows = sites.locator('.site-row');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText('test.fixture');
    await expect(rows.nth(0)).toContainText('2 lookups');
    await expect(rows.nth(1)).toContainText('second.fixture');
    await expect(rows.nth(1)).toContainText('1 lookup');
  });

  test('saving a looked-up word adds a "saved" count to its site row', async ({
    context,
    extensionId,
  }) => {
    await mockGemini(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/side-panel.html`);
    await seedSettings(page);

    const lookupPage = await context.newPage();
    await lookupPage.route('http://test.fixture/', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<html><body><p id="t">The bank by the river is steep.</p></body></html>',
      }),
    );
    await lookupPage.goto('http://test.fixture/');
    await lookupPage.waitForTimeout(1_000);
    await selectWord(lookupPage, 't', 'bank');
    await openTrigger(lookupPage);
    await expect(lookupPage.locator('bottom-sheet lookup-card')).toContainText(
      'financial institution',
      { timeout: 10_000 },
    );
    await lookupPage.locator('bottom-sheet lookup-card .save-btn').click();

    await page.bringToFront();
    await page.reload();
    const row = page.locator('side-panel-view').locator('.site-row').first();
    await expect(row).toContainText('1 lookup · 1 saved', { timeout: 10_000 });
  });
});
```

Run:

```
GEMINI_API_KEY= bun run build:chrome
cd packages/extension-chrome && bunx playwright test b15-site-lookup-stats
```

Expected: 3 passed.

- [ ] **Step 2: Commit** — gate, then commit:

```
GEMINI_API_KEY= bun run build:chrome
bun run lint && bun run format:check
```

Commit:

```
git add packages/extension-chrome/e2e/b15-site-lookup-stats.spec.ts
git commit -m "[B15SiteLookupStats] feat: add e2e coverage for the Sites section (B15)" \
  -m $'Tribe-Card: b15-site-lookup-stats\nTribe-Task: 6/7'
```

---

### Task 7: Final gates, C3 sweep note, and PR

**Files:** none (verification + PR only).

- [ ] **Step 1: Run every gate.**

```
cd packages/app && bun run typecheck
cd ../extension-chrome && bun run typecheck
cd ../..
bun run test
bun run lint
bun run format:check
GEMINI_API_KEY= bun run build:chrome
cd packages/extension-chrome && bunx playwright test b15-site-lookup-stats side-panel side-panel-open side-panel-delete cache-history saved-word
```

Expected: typecheck clean on both packages; the full Vitest suite green (including all new tests
from Tasks 1-4); lint/format clean; the Chrome build succeeds with the env key cleared; the new
`b15-site-lookup-stats.spec.ts` plus the existing side-panel/cache-history/saved-word regression
suites (files this card's changes share with — Task 5 touches the same file B1/B5/B7 already
cover) all pass.

- [ ] **Step 2: C3 sweep note.** `.c3/` is CLI-only (never hand-edit). Run, if the `c3` CLI is
      available in the implementer's environment:

```
c3 sweep
```

`site-stats-policy.ts` is expected to land under the existing `c3-112 persistence-policies`
component (same grouping as `cache-policy.ts`/`history-policy.ts`/`nudge-policy.ts`) — no new C3
entity should be needed. If the sweep proposes a different grouping, follow the CLI's own
guidance rather than this plan's expectation (the design spec's §10 flags this as unverified —
the CLI was unavailable during authoring).

- [ ] **Step 3: Open the PR.** Regular merge (no squash — owner ruling 2026-07-16). Title
      `[B15SiteLookupStats] Site lookup stats`. No `.github/PULL_REQUEST_TEMPLATE` file exists in
      this repo (verified 2026-07-17) — the required body element is a written
      **"Testing performed"** section (no screenshots/video, per this worktree's `CLAUDE.md`):

```
## Description
Per-domain lookup + save tally in the side panel's new "Sites" section — top 5 sites by lookup
count, computed from existing history/saved-word data (no new tracking). HistoryEntry gains an
optional `url` field and a new `saved.list` wire message lists all saved words; both are additive,
non-breaking primitives no earlier card added.

## Design choices
- Naive site-key extraction (hostname minus `www.`, not a full eTLD+1 parse) — same v1 posture as
  B3's naive word matching; see design spec §2.2.
- Always-visible section (not a lazy/click-to-reveal toggle) — matches the card's own "glanceable"
  payoff language; see design spec §2.4.

## JIRA ticket
* n/a (repo is not Jira-tracked)

## Testing performed
- Unit: `bun run test` — full suite green, including new suites in
  `site-stats-policy.test.ts` (13 tests), plus additions to `history-policy.test.ts` (+2),
  `wire-schema.test.ts` (+6), `app/router.test.ts` (+3), `ui/side-panel-view.test.ts` (+4).
- Typecheck: `packages/app` and `packages/extension-chrome`, both clean.
- Lint + format: clean.
- Build: `GEMINI_API_KEY= bun run build:chrome` succeeds.
- e2e: `b15-site-lookup-stats.spec.ts` (3 new scenarios: empty state, multi-site tally, save
  count) plus the `side-panel`/`side-panel-open`/`side-panel-delete`/`cache-history`/`saved-word`
  regression suites, all green.

## Merge checklist
- [x] Lint/format/typecheck/unit/e2e all green
- [x] No screenshots/video (owner ruling 2026-07-16 — written Testing performed section instead)
- [x] Regular merge commit, no squash
```

Expected: CI green on every job (`typecheck`, `lint`, `format-check`, `test-unit`,
`test-component`, `build-chrome`, `build-safari`, `coverage-gate`, `knip`, `dep-audit`); merge via
a regular merge commit (2 parents), never squash.
