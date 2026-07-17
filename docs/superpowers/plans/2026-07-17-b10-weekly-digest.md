# B10 Weekly Digest Implementation Plan

> **For agentic workers:** implement task-by-task, TDD (red → green → commit) per task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the side panel gains a "This week" section, computed once when the panel opens: lookups
this week, words saved this week, repeat lookups, and up to 3 top source sites — derived entirely
from existing `history:*`/`saved:*` data, with zero background jobs and zero new tokens spent.

**Architecture:** a new pure domain function (`packages/app/src/domain/weekly-digest.ts`,
`computeWeeklyDigest`) aggregates already-fetched `HistoryEntry[]`/`SavedWordEntry[]` rows into a
`WeeklyDigest`. Two small plumbing additions feed it: `HistoryEntry` gains optional `url?`/`title?`
(populated by `router.ts`'s existing `handleLookup`, `packages/app/src/app/router.ts`) so the digest
can compute "top source sites," and a new zero-payload `saved.list` wire message
(`packages/app/src/wire.ts` + `router.ts`) exposes the already-implemented but previously
unreachable `savedWordsList` domain function. The Chrome composition root
(`packages/extension-chrome/src/side-panel.ts`) fetches both once on boot and hands the result to a
new `SidePanelView.digest` setter (`packages/app/src/ui/side-panel-view.ts`). Full design rationale,
including every rejected alternative:
`docs/superpowers/specs/2026-07-17-b10-weekly-digest-design.md`.

**Tech Stack:** TypeScript, Vitest + happy-dom (unit), Playwright (e2e).

## Global Constraints

- Implementer: dispatch each implementation/fix task to the `hunter` subagent — never a generic
  implementer.
- Start in a fresh git worktree under `.claude/worktrees/` on branch `feature/B10WeeklyDigest`.
- Commit subject convention for every task in this plan (CONTRACTS §2 format —
  `[<BranchSuffix>] feat: <summary> (<card>)`): `[B10WeeklyDigest] feat: weekly digest — <task
summary> (B10)`. No `Co-Authored-By` trailer, no attribution footer.
- `bun run lint` and `bun run format:check` clean before every commit.
- Every task must leave `cd packages/app && bun run typecheck` (and, from Task 3 on,
  `cd packages/extension-chrome && bun run typecheck`) green.
- **`wire.ts` arm + `router.ts` case + their tests land in ONE task** (`router.ts`'s
  `switch (msg.type)` is exhaustive with no `default` arm — a new case cannot type-check
  independently of its schema arm; ROADMAP §8's B5/B3 ruling). Task 3 below is that task for
  `saved.list`.
- `HistoryEntry`'s new `url?`/`title?` fields are **optional** — every existing stored entry (no
  `url`/`title` in its JSON) must keep parsing/rendering exactly as before. Every task touching
  `HistoryEntry` must preserve this back-compat (design spec §2.3).
- The digest is computed **exactly once per panel-open**, never re-triggered by the live-mirror
  listener or any timer (design spec §2.5, card scope fence: "no background jobs"). Do not wire
  `loadDigest()` into any recurring callback.
- No new `chrome.*` permission, no manifest change (design spec §4/§5).
- UI additions read only `--ad-*`/`--adp-*` design tokens (no hard-coded colors).

---

### Task 1: `weekly-digest.ts` — the pure aggregation function + `HISTORY_CAP` export

**Files:**

- Modify: `packages/app/src/domain/history-policy.ts`
- Create: `packages/app/src/domain/weekly-digest.ts`
- Modify: `packages/app/src/index.ts`
- Create: `packages/app/test/weekly-digest.test.ts`

**Interfaces:**

```ts
export const HISTORY_CAP: number; // history-policy.ts, aliases the existing DEFAULT_CAP = 500
export const DIGEST_WINDOW_MS: number; // weekly-digest.ts, 7 * 24 * 60 * 60 * 1000
export const TOP_SITES_N: number; // weekly-digest.ts, = 3
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
export function computeWeeklyDigest(
  history: HistoryEntry[],
  savedWords: SavedWordEntry[],
  nowMs: number,
): WeeklyDigest;
```

- [ ] **Step 1: Write the failing tests.** Create `packages/app/test/weekly-digest.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeWeeklyDigest, DIGEST_WINDOW_MS, TOP_SITES_N } from '../src/domain/weekly-digest';
import type { HistoryEntry, SavedWordEntry } from '../src';

const NOW = 1_700_000_000_000; // fixed clock for deterministic window math

function historyEntry(over: Partial<HistoryEntry> & { id: string; word: string }): HistoryEntry {
  return {
    id: over.id,
    word: over.word,
    context: over.context ?? '',
    createdAt: over.createdAt ?? NOW,
    url: over.url,
    title: over.title,
    result: over.result ?? {
      markdown: '',
      word: over.word,
      target: 'vi',
      model: 'gemini-2.5-flash',
      fromCache: false,
      fetchedAt: over.createdAt ?? NOW,
    },
  };
}

function savedEntry(
  over: Partial<SavedWordEntry> & { word: string; savedAt: number },
): SavedWordEntry {
  return {
    word: over.word,
    status: over.status ?? 'learning',
    savedAt: over.savedAt,
    senses: over.senses ?? [{ definition: '', translation: '', sentence: '', url: '', title: '' }],
  };
}

describe('computeWeeklyDigest', () => {
  it('empty history and saved words → an all-zero digest', () => {
    const d = computeWeeklyDigest([], [], NOW);
    expect(d).toEqual({
      windowStart: NOW - DIGEST_WINDOW_MS,
      lookups: 0,
      saves: 0,
      repeatWords: 0,
      topSites: [],
    });
  });

  it('counts only entries inside the rolling 7-day window (inclusive boundary)', () => {
    const windowStart = NOW - DIGEST_WINDOW_MS;
    const history = [
      historyEntry({ id: 'in-1', word: 'bank', createdAt: NOW }),
      historyEntry({ id: 'in-2', word: 'ledger', createdAt: windowStart }), // exactly on the boundary — included
      historyEntry({ id: 'out', word: 'stale', createdAt: windowStart - 1 }), // 1ms outside — excluded
    ];
    const d = computeWeeklyDigest(history, [], NOW);
    expect(d.lookups).toBe(2);
  });

  it('saves are counted by SavedWordEntry.savedAt inside the window, independent of history', () => {
    const windowStart = NOW - DIGEST_WINDOW_MS;
    const saved = [
      savedEntry({ word: 'bank', savedAt: NOW }),
      savedEntry({ word: 'ledger', savedAt: windowStart }),
      savedEntry({ word: 'ancient', savedAt: windowStart - 1 }), // outside — excluded
    ];
    const d = computeWeeklyDigest([], saved, NOW);
    expect(d.saves).toBe(2);
  });

  it('repeatWords counts distinct words with >=2 in-window lookups only', () => {
    const history = [
      historyEntry({ id: '1', word: 'bank', createdAt: NOW }),
      historyEntry({ id: '2', word: 'Bank', createdAt: NOW }), // case-insensitive same word
      historyEntry({ id: '3', word: 'ledger', createdAt: NOW }), // looked up once — not a repeat
    ];
    const d = computeWeeklyDigest(history, [], NOW);
    expect(d.lookups).toBe(3);
    expect(d.repeatWords).toBe(1); // only "bank"
  });

  it('topSites aggregates by hostname with a leading www. stripped, sorted desc by count', () => {
    const history = [
      historyEntry({ id: '1', word: 'a', createdAt: NOW, url: 'https://www.nautil.us/article-1' }),
      historyEntry({ id: '2', word: 'b', createdAt: NOW, url: 'https://nautil.us/article-2' }),
      historyEntry({ id: '3', word: 'c', createdAt: NOW, url: 'https://nautil.us/article-3' }),
      historyEntry({ id: '4', word: 'd', createdAt: NOW, url: 'https://en.wikipedia.org/wiki/X' }),
    ];
    const d = computeWeeklyDigest(history, [], NOW);
    expect(d.topSites).toEqual([
      { domain: 'nautil.us', count: 3 },
      { domain: 'en.wikipedia.org', count: 1 },
    ]);
  });

  it('ties in topSites break alphabetically by domain', () => {
    const history = [
      historyEntry({ id: '1', word: 'a', createdAt: NOW, url: 'https://zzz.example/1' }),
      historyEntry({ id: '2', word: 'b', createdAt: NOW, url: 'https://aaa.example/1' }),
    ];
    const d = computeWeeklyDigest(history, [], NOW);
    expect(d.topSites.map((s) => s.domain)).toEqual(['aaa.example', 'zzz.example']);
  });

  it('caps topSites at TOP_SITES_N', () => {
    expect(TOP_SITES_N).toBe(3);
    const history = ['a', 'b', 'c', 'd'].map((letter, i) =>
      historyEntry({
        id: String(i),
        word: letter,
        createdAt: NOW,
        url: `https://${letter}.example/`,
      }),
    );
    const d = computeWeeklyDigest(history, [], NOW);
    expect(d.topSites).toHaveLength(3);
  });

  it('entries with an empty url are excluded from topSites but still counted in lookups', () => {
    const history = [historyEntry({ id: '1', word: 'a', createdAt: NOW, url: '' })];
    const d = computeWeeklyDigest(history, [], NOW);
    expect(d.lookups).toBe(1);
    expect(d.topSites).toEqual([]);
  });

  it('entries with no url field at all (legacy pre-B10 entries) are excluded from topSites only', () => {
    const legacy: HistoryEntry = {
      id: '1',
      word: 'a',
      context: '',
      createdAt: NOW,
      result: {
        markdown: '',
        word: 'a',
        target: 'vi',
        model: 'gemini-2.5-flash',
        fromCache: false,
        fetchedAt: NOW,
      },
      // url/title intentionally omitted — simulates JSON read from storage pre-B10
    };
    const d = computeWeeklyDigest([legacy], [], NOW);
    expect(d.lookups).toBe(1);
    expect(d.topSites).toEqual([]);
  });

  it('entries with a malformed url are excluded from topSites, not thrown', () => {
    const history = [historyEntry({ id: '1', word: 'a', createdAt: NOW, url: 'not a url' })];
    expect(() => computeWeeklyDigest(history, [], NOW)).not.toThrow();
    expect(computeWeeklyDigest(history, [], NOW).topSites).toEqual([]);
  });

  it('is pure: does not read Date.now() — identical input always produces identical output', () => {
    const history = [historyEntry({ id: '1', word: 'a', createdAt: NOW })];
    const a = computeWeeklyDigest(history, [], NOW);
    const b = computeWeeklyDigest(history, [], NOW);
    expect(a).toEqual(b);
  });
});
```

Run: `cd packages/app && bunx vitest run test/weekly-digest.test.ts`
Expected: failures — `../src/domain/weekly-digest` does not exist (module resolution error).

- [ ] **Step 2: Implement.**

In `packages/app/src/domain/history-policy.ts`, right after the existing `const DEFAULT_CAP = 500;`
(line 5), add:

```ts
/** Public name for DEFAULT_CAP — the side panel's weekly digest (B10) fetches every currently
 * stored entry via `history.list` with `limit: HISTORY_CAP`; since the store can never hold more
 * than this many entries (historyAppend evicts past it), that single call always returns
 * everything. Mirrors ERROR_BUFFER_CAP's naming (error-report.ts). */
export const HISTORY_CAP = DEFAULT_CAP;
```

Create `packages/app/src/domain/weekly-digest.ts`:

```ts
import type { HistoryEntry, SavedWordEntry } from './types';

/** Rolling window, not calendar-week — design spec §2.2. */
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

/**
 * hostname minus a leading "www." — a deliberately lightweight heuristic, not eTLD+1 parsing.
 * See the design spec §2.6 for why (B15 owns the rigorous registrable-domain rule for its own
 * feature). Returns undefined for an empty/unparseable url — the caller excludes those from the
 * site tally only, never from the lookup count.
 */
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

In `packages/app/src/index.ts`, add one line next to the other domain re-exports (immediately after
`export * from './domain/nudge-policy';`):

```ts
export * from './domain/weekly-digest';
```

Run: `cd packages/app && bunx vitest run test/weekly-digest.test.ts`
Expected: all 11 tests pass.

- [ ] **Step 3: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd .. && cd .. && bun run lint && bun run format:check
```

Commit:

```
git add packages/app/src/domain/history-policy.ts packages/app/src/domain/weekly-digest.ts packages/app/src/index.ts packages/app/test/weekly-digest.test.ts
git commit -m "[B10WeeklyDigest] feat: weekly digest — export HISTORY_CAP + computeWeeklyDigest pure function (B10)" \
  -m $'Tribe-Card: b10-weekly-digest\nTribe-Task: 1/6'
```

---

### Task 2: `HistoryEntry` gains `url?`/`title?` — types, wire schema, router write path

**Files:**

- Modify: `packages/app/src/domain/types.ts`
- Modify: `packages/app/src/wire.ts`
- Modify: `packages/app/src/app/router.ts`
- Modify: `packages/app/test/app/router.test.ts`
- Modify: `packages/app/test/wire-schema.test.ts`

**Interfaces:**

```ts
export interface HistoryEntry {
  id: string;
  word: string;
  context: string;
  result: LookupResult;
  createdAt: number;
  url?: string;
  title?: string;
}
```

- [ ] **Step 1: Write the failing tests.**

In `packages/app/test/app/router.test.ts`, insert this test immediately after the existing `it('lookup
miss → calls client, caches, appends history, replies result (D1)', ...)` test (currently ending at
line 83, right before `it('lookup cache hit → fromCache:true, no client call (D1)', ...)`):

```ts
it('lookup miss stores the request url/title on the history entry (B10)', async () => {
  const d = deps();
  const route = buildRouter(d);
  await route({
    type: 'lookup',
    req: { ...req, url: 'https://nautil.us/article', title: 'An Article' },
    requestId: 'a',
  });
  const { entries } = await historyList({ storage: d.kv }, {});
  expect(entries[0]).toMatchObject({
    url: 'https://nautil.us/article',
    title: 'An Article',
  });
});
```

In `packages/app/test/wire-schema.test.ts`, insert this test immediately after the existing
`it('accepts history.list message (with limit and cursor)', ...)` test (currently ending at line
125, right before `it('accepts history.clear message', ...)`):

```ts
it('a history reply entry accepts optional url/title (B10), and still parses without them (back-compat)', () => {
  const base = {
    id: 'h1',
    word: 'bank',
    context: 'river bank',
    createdAt: 1,
    result: {
      markdown: '#',
      word: 'bank',
      target: 'vi',
      model: 'gemini-2.5-flash',
      fromCache: false,
      fetchedAt: 1,
    },
  };
  expect(
    WireReplySchema.safeParse({
      ok: true,
      type: 'history',
      entries: [{ ...base, url: 'https://nautil.us', title: 'Nautilus' }],
    }).success,
  ).toBe(true);
  // Back-compat: an entry recorded before B10 has no url/title at all.
  expect(WireReplySchema.safeParse({ ok: true, type: 'history', entries: [base] }).success).toBe(
    true,
  );
});
```

Run:

```
cd packages/app && bunx vitest run test/app/router.test.ts test/wire-schema.test.ts
```

Expected: the two new tests fail — `HistoryEntry`/`HistoryEntrySchema` have no `url`/`title`, so
`entries[0].url` is `undefined` (assertion fails) and the wire test currently passes already (the
schema strips unknown keys — `HistoryEntrySchema` is `z.strictObject`, so an unrecognised `url` key
today makes `safeParse` **fail**, which is the actual red state to fix). Confirm the first assertion
in the new wire test fails before Step 2.

- [ ] **Step 2: Implement.**

In `packages/app/src/domain/types.ts`, extend `HistoryEntry` (currently lines 136-142):

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

In `packages/app/src/wire.ts`, extend `HistoryEntrySchema` (currently lines 70-76):

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

In `packages/app/src/app/router.ts`, extend `handleLookup`'s history-write branch (currently lines
140-149):

```ts
if (saveHistory) {
  const entry: HistoryEntry = {
    id: crypto.randomUUID(),
    word: req.word,
    context: req.context,
    result: storableResult,
    createdAt: result.fetchedAt,
    // B10: carried straight from the request so the weekly digest can compute "top
    // source sites" without a second round trip — req.url/req.title are the same
    // fields domain/workflow.ts already builds from the page's selection event.
    url: req.url,
    title: req.title,
  };
  await deps.queue.run(() => historyAppend({ storage: deps.kv }, entry));
}
```

Run:

```
cd packages/app && bunx vitest run test/app/router.test.ts test/wire-schema.test.ts
```

Expected: both new tests pass, and the full existing suite in both files still passes (this is an
additive/optional-field change — no other assertion should need updating).

Also regenerate the JSON-schema snapshot (the new optional `url`/`title` fields change
`wireJsonSchema()`'s output):

```
cd packages/app && bunx vitest run test/wire-schema.test.ts -u
```

Expected: the `JSON-schema snapshot is stable (spec §8.5)` test's snapshot file
(`packages/app/wire-schema.snapshot.json`) is rewritten to include `url`/`title` on the history
entry schema; re-run `bunx vitest run test/wire-schema.test.ts` once more (without `-u`) and confirm
it's green now that the snapshot matches.

- [ ] **Step 3: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd .. && cd .. && bun run lint && bun run format:check
```

Commit:

```
git add packages/app/src/domain/types.ts packages/app/src/wire.ts packages/app/src/app/router.ts packages/app/test/app/router.test.ts packages/app/test/wire-schema.test.ts packages/app/wire-schema.snapshot.json
git commit -m "[B10WeeklyDigest] feat: weekly digest — HistoryEntry carries url/title from the request (B10)" \
  -m $'Tribe-Card: b10-weekly-digest\nTribe-Task: 2/6'
```

---

### Task 3: `saved.list` wire message + router case (ONE task per the exhaustive-switch rule)

**Files:**

- Modify: `packages/app/src/wire.ts`
- Modify: `packages/app/src/app/router.ts`
- Modify: `packages/app/test/wire-schema.test.ts`
- Modify: `packages/app/test/app/router.test.ts`

**Interfaces:**

```ts
// Request
{ type: 'saved.list' }
// Reply
{ ok: true, type: 'saved.list', entries: SavedWordEntry[] }
```

- [ ] **Step 1: Write the failing tests.**

In `packages/app/test/wire-schema.test.ts`, insert these tests immediately before the closing `});`
of the `describe('saved.save / saved.delete wire messages (B1)', ...)` block (currently right after
the `it('rejects a saved.setStatus message missing word or status (B5)', ...)` test, which ends at
line 496, before the block's closing `});` at line 497):

```ts
it('accepts a valid saved.list message (B10)', () => {
  expect(WireMessageSchema.safeParse({ type: 'saved.list' }).success).toBe(true);
});

it('a saved.list reply carries an array of the ratified entry shape (B10)', () => {
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

it('a saved.list reply rejects a malformed entry inside the array (B10)', () => {
  const bad = {
    word: 'bank',
    status: 'archived', // not 'learning' | 'known'
    savedAt: 1,
    senses: [],
  };
  expect(WireReplySchema.safeParse({ ok: true, type: 'saved.list', entries: [bad] }).success).toBe(
    false,
  );
});
```

In `packages/app/test/app/router.test.ts`, insert this test immediately after the existing
`it('saved.setStatus is case-insensitive on the word key (B5)', ...)` test (currently ending at
line 579, right before `it('lookup.cancel with no inflight request still returns ack (no crash)',
...)`):

```ts
it('saved.list on an empty store replies with an empty array (B10)', async () => {
  const route = buildRouter(deps());
  const reply = await route({ type: 'saved.list' });
  expect(reply).toMatchObject({ ok: true, type: 'saved.list', entries: [] });
});

it('saved.list returns every saved word (B10)', async () => {
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
    word: 'ledger',
    definition: 'd2',
    translation: '',
    sentence: 's2',
    url: 'u2',
    title: 't2',
  });
  const reply = await route({ type: 'saved.list' });
  expect(reply).toMatchObject({ ok: true, type: 'saved.list' });
  const words = (reply as { entries: { word: string }[] }).entries.map((e) => e.word).sort();
  expect(words).toEqual(['bank', 'ledger']);
});
```

Run:

```
cd packages/app && bunx vitest run test/wire-schema.test.ts test/app/router.test.ts
```

Expected: all 5 new tests fail. The 3 wire-schema tests fail because `WireMessageSchema`/
`WireReplySchema` reject `'saved.list'` as an unknown discriminant (`.success` is `false`). The 2
router tests fail because `buildRouter`'s exhaustive switch has no `'saved.list'` case yet — with no
matching case and no `default` arm, the switch falls through and the handler resolves `undefined`,
which fails the `toMatchObject` assertion (this is a runtime red, not a `tsc` failure — `vitest run`
does not type-check by default; `bun run typecheck` in Step 3 is what will catch a real type error
if the implementation is wrong).

- [ ] **Step 2: Implement.**

In `packages/app/src/wire.ts`, add a new request arm to `WireMessageSchema` (currently lines 95-141)
— insert right after the `saved.setStatus` arm (currently lines 123-127) and before `cache.clear`:

```ts
  // B10: list every currently saved word (savedWordsList's first wire consumer). No payload.
  z.object({ type: z.literal('saved.list') }),
```

Add `'saved.list'` to `MessageTypeEnum` (currently lines 143-158) — insert it in the array alongside
the other `saved.*` entries:

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

Add a new reply arm to `WireReplySchema` (currently lines 160-189) — insert right after the existing
`saved` reply arm (currently lines 175):

```ts
  z.object({
    ok: z.literal(true),
    type: z.literal('saved.list'),
    entries: z.array(SavedWordEntrySchema),
  }),
```

In `packages/app/src/app/router.ts`, add `savedWordsList` to the import list from `'../index'`
(currently lines 1-24) — insert it next to `savedWordSetStatus`:

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

Add a new `case 'saved.list':` inside the exhaustive `switch (msg.type)` (currently lines 213-287)
— insert it right after the `case 'saved.setStatus':` block (currently lines 261-266):

```ts
      case 'saved.list': {
        const entries = await savedWordsList({ storage: deps.kv });
        return { ok: true, type: 'saved.list', entries };
      }
```

Run:

```
cd packages/app && bunx vitest run test/wire-schema.test.ts test/app/router.test.ts
```

Expected: all 5 new tests pass; full existing suites in both files stay green.

Regenerate the JSON-schema snapshot again (a new message arm changes `wireJsonSchema()`'s output):

```
cd packages/app && bunx vitest run test/wire-schema.test.ts -u
cd packages/app && bunx vitest run test/wire-schema.test.ts
```

Expected: second run green (snapshot now matches).

- [ ] **Step 3: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd .. && cd .. && bun run lint && bun run format:check
```

Commit:

```
git add packages/app/src/wire.ts packages/app/src/app/router.ts packages/app/test/wire-schema.test.ts packages/app/test/app/router.test.ts packages/app/wire-schema.snapshot.json
git commit -m "[B10WeeklyDigest] feat: weekly digest — add saved.list wire message + router case (B10)" \
  -m $'Tribe-Card: b10-weekly-digest\nTribe-Task: 3/6'
```

---

### Task 4: `SidePanelView` — the "This week" digest section

**Files:**

- Modify: `packages/app/src/ui/side-panel-view.ts`
- Modify: `packages/app/test/ui/side-panel-view.test.ts`

**Interfaces:**

```ts
set digest(d: WeeklyDigest | undefined): void;
get digest(): WeeklyDigest | undefined;
```

- [ ] **Step 1: Write the failing tests.** Append to `packages/app/test/ui/side-panel-view.test.ts`,
      inside the existing `describe('<side-panel-view>', ...)` block, right before its closing
      `});` (after the existing `'has no axe violations (no-key setup invite)'` test, which ends at
      line 258):

```ts
it('the digest section is hidden before `digest` is ever set (B10)', () => {
  const el = mount();
  const digest = el.shadowRoot!.querySelector('.digest') as HTMLElement;
  expect(digest.hidden).toBe(true);
});

it('a zero-stat digest shows the pinned empty-state copy (B10)', () => {
  const el = mount();
  el.digest = { windowStart: 0, lookups: 0, saves: 0, repeatWords: 0, topSites: [] };
  const digest = el.shadowRoot!.querySelector('.digest') as HTMLElement;
  expect(digest.hidden).toBe(false);
  expect(digest.textContent).toContain('Nothing yet this week — look something up and check back.');
});

it('renders all four stat rows with correct singular/plural copy (B10)', () => {
  const el = mount();
  el.digest = {
    windowStart: 0,
    lookups: 1,
    saves: 1,
    repeatWords: 1,
    topSites: [{ domain: 'nautil.us', count: 3 }],
  };
  const rows = [...el.shadowRoot!.querySelectorAll('.digest-row')].map((r) => r.textContent);
  expect(rows).toEqual([
    '1 lookup this week',
    '1 saved',
    '1 repeat lookup',
    'Mostly from nautil.us',
  ]);
});

it('pluralizes stat copy for counts other than 1 (B10)', () => {
  const el = mount();
  el.digest = {
    windowStart: 0,
    lookups: 23,
    saves: 6,
    repeatWords: 3,
    topSites: [
      { domain: 'nautil.us', count: 5 },
      { domain: 'wikipedia.org', count: 2 },
    ],
  };
  const rows = [...el.shadowRoot!.querySelectorAll('.digest-row')].map((r) => r.textContent);
  expect(rows).toEqual([
    '23 lookups this week',
    '6 saved',
    '3 repeat lookups',
    'Mostly from nautil.us, wikipedia.org',
  ]);
});

it('omits the "Mostly from" row when topSites is empty (B10)', () => {
  const el = mount();
  el.digest = { windowStart: 0, lookups: 4, saves: 0, repeatWords: 0, topSites: [] };
  const rows = [...el.shadowRoot!.querySelectorAll('.digest-row')].map((r) => r.textContent);
  expect(rows).toEqual(['4 lookups this week', '0 saved', '0 repeat lookups']);
});

it('has no axe violations (populated digest) (B10)', async () => {
  const el = mount();
  el.digest = {
    windowStart: 0,
    lookups: 23,
    saves: 6,
    repeatWords: 3,
    topSites: [{ domain: 'nautil.us', count: 5 }],
  };
  expect(await axeViolations(el)).toEqual([]);
});
```

Run: `cd packages/app && bunx vitest run test/ui/side-panel-view.test.ts`
Expected: failures — `.digest` doesn't exist in the shadow DOM, and `el.digest = ...` is a type
error (`SidePanelView` has no `digest` setter yet).

- [ ] **Step 2: Implement.** In `packages/app/src/ui/side-panel-view.ts`:

1. Add the import, alongside the existing `HistoryEntry` import (line 1):

```ts
import type { HistoryEntry } from '../domain/types';
import type { WeeklyDigest } from '../domain/weekly-digest';
```

2. Add new CSS rules to the `CSS` template literal, right after the existing `.recent-context` rule
   (currently line 87), before `footer{...}`:

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

3. Add the private fields, alongside the existing `_focus`/`_recent`/`recentEl`/`recentList` fields
   (currently lines 108-112):

```ts
export class SidePanelView extends HTMLElement {
  private _focus: PanelFocusState = { kind: 'empty' };
  private _recent: HistoryEntry[] = [];
  private _digest: WeeklyDigest | undefined = undefined;
  private focusEl!: HTMLElement;
  private recentEl!: HTMLElement;
  private recentList!: HTMLUListElement;
  private digestEl!: HTMLElement;
```

4. In `connectedCallback`, right after the existing `recentEl`/`recentList` construction and BEFORE
   `main.append(this.focusEl, this.recentEl);` (currently line 162), build the digest section and
   include it in the same `append` call:

```ts
// The weekly digest (B10). Hidden until `digest` is explicitly set — avoids a flash of empty
// content before the panel's async history.list/saved.list round trip resolves.
this.digestEl = document.createElement('section');
this.digestEl.className = 'digest';
this.digestEl.setAttribute('aria-label', 'This week');
this.digestEl.hidden = true;

main.append(this.focusEl, this.recentEl, this.digestEl);
```

(Remove the old `main.append(this.focusEl, this.recentEl);` line — this replaces it.)

5. Right after the existing `renderFocus();` / `renderRecent();` calls at the end of
   `connectedCallback` (currently lines 168-169), add:

```ts
this.renderFocus();
this.renderRecent();
this.renderDigest();
```

And in the early-return branch at the top of `connectedCallback` (currently lines 114-118, "if
(this.shadowRoot) { this.renderFocus(); return; }" — the reconnect-without-reinit guard), also
re-render the digest so a detach/reattach doesn't lose it:

```ts
  connectedCallback(): void {
    if (this.shadowRoot) {
      this.renderFocus();
      this.renderRecent();
      this.renderDigest();
      return;
    }
```

6. Add the public accessor, right after the existing `recent` getter/setter (currently lines
   181-188):

```ts
  /** The weekly digest (B10), computed once per panel-open. `undefined` = not loaded yet
   * (section stays hidden); once set, it stays visible for the rest of the session — including
   * a zero-stat empty state — never re-hidden. */
  set digest(d: WeeklyDigest | undefined) {
    this._digest = d;
    if (this.shadowRoot) this.renderDigest();
  }
  get digest(): WeeklyDigest | undefined {
    return this._digest;
  }
```

7. Add the private render method, right after the existing `renderRecent()` method (currently ends
   at line 198):

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

Run: `cd packages/app && bunx vitest run test/ui/side-panel-view.test.ts`
Expected: all tests pass (existing + 6 new).

- [ ] **Step 3: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd .. && cd .. && bun run lint && bun run format:check
```

Commit:

```
git add packages/app/src/ui/side-panel-view.ts packages/app/test/ui/side-panel-view.test.ts
git commit -m "[B10WeeklyDigest] feat: weekly digest — This week section on SidePanelView (B10)" \
  -m $'Tribe-Card: b10-weekly-digest\nTribe-Task: 4/6'
```

---

### Task 5: `side-panel.ts` — fetch + compute once on boot

**Files:**

- Modify: `packages/extension-chrome/src/side-panel.ts`

No dedicated unit test exists for `side-panel.ts` in this repo (composition root, covered by e2e
only — same precedent as C2's `options.ts` edit and this repo's `content.ts`/`side-panel.ts`
history). Task 6's e2e spec proves this task's correctness; still run the typecheck/lint gate below
so a regression in existing behavior (recent list, save toggle, etc. — all in the same file) is
caught immediately.

- [ ] **Step 1: Implement.** In `packages/extension-chrome/src/side-panel.ts`:

1. Extend the `@ai-dict/app` import (currently lines 1-13) to add `HISTORY_CAP` and
   `computeWeeklyDigest`:

```ts
import {
  registerSidePanel,
  sanitizeMarkdown,
  mapError,
  createSaveReplyGuard,
  HISTORY_CAP,
  computeWeeklyDigest,
  type PanelFocusState,
  type SidePanelView,
  type LookupResult,
  type LookupError,
  type HistoryEntry,
  type WireReply,
  type SavedWordStatus,
} from '@ai-dict/app';
```

2. Add `loadDigest()`, placed right after the existing `refreshRecent()` function (currently ends at
   line 143):

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

3. Update the final boot lines (currently lines 312-313):

```ts
// On open, populate Recent from stored history. The focus region stays on its teaching empty
// state until the first lookup mirrors in or a recent row is clicked — unless no key is set,
// in which case initFromSettings swaps it for the setup invite (and stamps the theme).
void refreshRecent();
void initFromSettings().then(() => recoverFocus());
void loadDigest();
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
git commit -m "[B10WeeklyDigest] feat: weekly digest — fetch + compute the digest once on panel boot (B10)" \
  -m $'Tribe-Card: b10-weekly-digest\nTribe-Task: 5/6'
```

---

### Task 6: e2e coverage

**Files:**

- Create: `packages/extension-chrome/e2e/b10-weekly-digest.spec.ts`

- [ ] **Step 1: Write the spec.** Create `packages/extension-chrome/e2e/b10-weekly-digest.spec.ts`:

```ts
import { test, expect } from './fixtures';
import { seedSettings } from './helpers';
import type { Page } from '@playwright/test';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Build a well-formed stored HistoryEntry (matches HistoryEntrySchema, B10's url/title included). */
function entry(id: string, word: string, createdAt: number, url?: string) {
  return {
    id,
    word,
    context: `A sentence with ${word} in it.`,
    createdAt,
    ...(url !== undefined ? { url, title: 'A page' } : {}),
    result: {
      markdown: `## ${word}\nA definition.`,
      word,
      target: 'vi',
      model: 'gemini-2.5-flash',
      fromCache: false,
      fetchedAt: createdAt,
    },
  };
}

/** Seed history into extension storage, newest-first index. */
async function seedHistory(page: Page, entries: ReturnType<typeof entry>[]): Promise<void> {
  await page.evaluate((es) => {
    const items: Record<string, string> = { 'history:index': JSON.stringify(es.map((e) => e.id)) };
    for (const e of es) items[`history:${e.id}`] = JSON.stringify(e);
    return chrome.storage.local.set(items);
  }, entries);
}

/** Seed saved words into extension storage, newest-first index. */
async function seedSaved(page: Page, words: { word: string; savedAt: number }[]): Promise<void> {
  await page.evaluate((ws) => {
    const items: Record<string, string> = {
      'saved:index': JSON.stringify(ws.map((w) => w.word.toLowerCase())),
    };
    for (const w of ws) {
      items[`saved:${w.word.toLowerCase()}`] = JSON.stringify({
        word: w.word,
        status: 'learning',
        savedAt: w.savedAt,
        senses: [{ definition: 'd', translation: '', sentence: 's', url: 'u', title: 't' }],
      });
    }
    return chrome.storage.local.set(items);
  }, words);
}

test('the This week section summarizes lookups, saves, repeats, and the top site', async ({
  context,
  extensionId,
}) => {
  const seeder = await context.newPage();
  await seeder.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(seeder);

  const now = await seeder.evaluate(() => Date.now());
  await seedHistory(seeder, [
    entry('h1', 'bank', now - 1 * DAY_MS, 'https://www.nautil.us/a'),
    entry('h2', 'bank', now - 2 * DAY_MS, 'https://nautil.us/b'), // 2nd "bank" lookup this week → repeat
    entry('h3', 'ledger', now - 3 * DAY_MS, 'https://nautil.us/c'),
    entry('h4', 'stale', now - 8 * DAY_MS, 'https://outside.example/'), // outside the 7d window
  ]);
  await seedSaved(seeder, [
    { word: 'bank', savedAt: now - 1 * DAY_MS },
    { word: 'ancient', savedAt: now - 30 * DAY_MS }, // outside the window
  ]);

  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/side-panel.html`);
  await panel.waitForSelector('side-panel-view');

  const digest = panel.locator('side-panel-view .digest');
  await expect(digest).toContainText('3 lookups this week', { timeout: 5_000 });
  await expect(digest).toContainText('1 saved');
  await expect(digest).toContainText('1 repeat lookup');
  await expect(digest).toContainText('Mostly from nautil.us');
});

test('the This week section shows the empty state when there is no activity in the window', async ({
  context,
  extensionId,
}) => {
  const seeder = await context.newPage();
  await seeder.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(seeder);
  // No history/saved seeded at all.

  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/side-panel.html`);
  await panel.waitForSelector('side-panel-view');

  const digest = panel.locator('side-panel-view .digest');
  await expect(digest).toContainText('Nothing yet this week', { timeout: 5_000 });
});
```

Run:

```
GEMINI_API_KEY= bun run build:chrome
cd packages/extension-chrome && bunx playwright test b10-weekly-digest
```

Expected: 2 passed.

- [ ] **Step 2: Commit** — gate, then commit:

```
GEMINI_API_KEY= bun run build:chrome
bun run lint && bun run format:check
```

Commit:

```
git add packages/extension-chrome/e2e/b10-weekly-digest.spec.ts
git commit -m "[B10WeeklyDigest] feat: weekly digest — e2e coverage for the This week section (B10)" \
  -m $'Tribe-Card: b10-weekly-digest\nTribe-Task: 6/6'
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
cd packages/extension-chrome && bunx playwright test b10-weekly-digest side-panel side-panel-open side-panel-delete
```

Expected: typecheck clean on both packages; the full Vitest suite green (including the 11
`weekly-digest.test.ts` cases, the new `router.test.ts`/`wire-schema.test.ts` additions, and the 6
`side-panel-view.test.ts` additions); lint/format clean; the Chrome build succeeds with the env key
cleared; the new `b10-weekly-digest.spec.ts` (2 tests) and the existing `side-panel*.spec.ts` files
(regression guard for the file this plan's Task 5 shares) all pass.

## PR

Regular merge (no squash). Branch `feature/B10WeeklyDigest`, title
`[B10WeeklyDigest] Weekly digest — side panel "This week" summary`. Jira link per the repo
convention (`https://prospa.atlassian.net/browse/B10WeeklyDigest` if a ticket exists under that
suffix — otherwise the PR body notes no ticket was created for this docs/roadmap-driven card).
Include a **"Testing performed"** section per this worktree's evidence policy (§7 of the design
spec) instead of screenshots/video — list the suites above with pass counts.
