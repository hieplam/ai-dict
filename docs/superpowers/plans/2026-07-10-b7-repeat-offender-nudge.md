# B7 Repeat-Offender Nudge Implementation Plan

> **For agentic workers:** implement task-by-task, TDD (red → green → commit) per task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** on the 3rd lookup of the same headword within a rolling 30-day window, the lookup card
(and its live-mirrored side-panel counterpart) shows a one-line nudge banner — **"3rd time
meeting this word — save it?"** — whose Save button reuses B1's exact `toggle-save` flow and
whose dismiss control needs no wire round-trip. The nudge fires **once per word, ever**: the
moment the router computes that a word's within-window history count first crosses the
threshold, it persists a permanent `nudge:<word>` marker, so every later lookup of that word
(saved, dismissed, or ignored) never nudges again.

**Architecture:** everything lives in the portable core (`packages/app/src/**`, `c3-1`) except
two small, untested-by-design composition-root edits (`content.ts`, `side-panel.ts`, verified by
e2e). `nudge` is a transient, non-persisted field on `LookupResult` — exactly like `fallbackFrom`
— so it flows through every existing relay (`MessageRelayLookupClient` → `runLookupWorkflow` →
`ResultRenderer.renderResult` → `InlineBottomSheetRenderer` / `ChromeSidePanelMirror` → the side
panel's `resultToFocus`) with zero extra threading. Full design rationale:
`docs/superpowers/specs/2026-07-10-b7-repeat-offender-nudge-design.md`.

**Tech Stack:** TypeScript, Zod (wire schema), Vitest + happy-dom (unit), Playwright (e2e).

## Global Constraints

- Implementer: dispatch each implementation/fix task to the `hunter` subagent — never a generic
  implementer.
- **Reuse B1's save path verbatim.** The nudge's Save button dispatches the exact same
  `toggle-save` CustomEvent (`{ detail: { word } }`, bubbles + composed) the star button already
  dispatches. Do not add a second `saved.save`/`saved.delete` trigger, a second wire message, or
  any new persistence call for saving.
- **Do not touch `SavedWordEntry`/`SavedWordSense`/`SavedWordStatus`** (E1's ratified schema, in
  `packages/app/src/domain/types.ts` and mirrored in `wire.ts`'s `SavedWordEntrySchema`). No task
  in this plan edits those types or `saved-words-policy.ts`'s stored shapes — only its exported
  `normalizeWordKey` helper is imported (reused, not duplicated).
- **`nudge` is a transient reply annotation, never persisted** — stripped from cache/history
  writes the same way `fallbackFrom` already is (it simply isn't computed yet at the point
  `storableResult` is built, so no extra destructuring is needed — see Task 4).
- **New keyspace `nudge:<word>`** (case-insensitive, normalized), independent of
  `saved:*`/`history:*`/`cache:*`. Never touched by `historyClear`/`cacheClear`/
  `savedWordsClear`.
- **No new `WireMessage`/`WireReply` type.** Dismiss needs no round-trip (design decision D2 in
  the spec) — do not invent a `nudge.dismiss` message.
- UI additions read only `--ad-*`/`--adp-*` design tokens (no hard-coded colors) — the new
  `.nudge-row` and its buttons are styled like the existing `.defined-as`/`.save-btn` rows.
- `bun run lint` and `bun run format:check` clean before every commit.
- Every task must leave `bun run --filter @ai-dict/app typecheck` green — tasks are ordered so a
  type used by a later task (e.g. `LookupResult.nudge`) is always introduced before anything
  spreads it into a literal that would otherwise trip an excess-property check.

---

### Task 1: `historyListSince` — bounded recent-history read

**Files:**

- Modify: `packages/app/src/domain/history-policy.ts`
- Modify: `packages/app/test/history-policy.test.ts`

**Interfaces:**

```ts
export async function historyListSince(deps: HistoryDeps, sinceMs: number): Promise<HistoryEntry[]>;
```

- [x] **Step 1: Write the failing tests.** Append to
      `packages/app/test/history-policy.test.ts`, just before the closing `});` of the
      `describe('history-policy', ...)` block (after the existing `it('clear removes all', ...)`
      test):

```ts
it('historyListSince returns only entries with createdAt >= sinceMs, newest-first', async () => {
  const s = memStorage();
  await historyAppend({ storage: s }, entry('1000'));
  await historyAppend({ storage: s }, entry('2000'));
  await historyAppend({ storage: s }, entry('3000'));
  const recent = await historyListSince({ storage: s }, 2000);
  expect(recent.map((e) => e.id)).toEqual(['3000', '2000']);
});

it('historyListSince stops scanning at the first stale entry (bounded read)', async () => {
  const s = memStorage();
  await historyAppend({ storage: s }, entry('1000'));
  await historyAppend({ storage: s }, entry('2000'));
  await historyAppend({ storage: s }, entry('3000'));
  const calls: string[] = [];
  const spied: Storage = {
    ...s,
    getItem: (k) => {
      calls.push(k);
      return s.getItem(k);
    },
  };
  await historyListSince({ storage: spied }, 2000);
  // Newest-first walk: history:3000 (kept), history:2000 (kept), history:1000 (stale — the
  // scan reads it once to discover it's stale, then breaks). Never a read beyond that.
  expect(calls.filter((k) => k.startsWith('history:') && k !== 'history:index')).toEqual([
    'history:3000',
    'history:2000',
    'history:1000',
  ]);
});

it('historyListSince on empty history returns []', async () => {
  const s = memStorage();
  expect(await historyListSince({ storage: s }, 0)).toEqual([]);
});
```

Add `historyListSince` to the existing import list at the top of the file:

```ts
import {
  historyAppend,
  historyList,
  historyListSince,
  historyClear,
  historyGet,
  historyDelete,
} from '../src/domain/history-policy';
```

Run: `cd packages/app && bunx vitest run test/history-policy.test.ts`
Expected: 3 new failures — `historyListSince is not a function` (or a TS error to that effect).

- [x] **Step 2: Implement.** In `packages/app/src/domain/history-policy.ts`, add this export
      right after `historyList` (before `historyGet`):

```ts
/**
 * B7: entries with `createdAt >= sinceMs`, newest-first — used to count recent same-word
 * lookups without reading the full (cap-500) history log on every lookup. History is
 * insertion-ordered newest-first (`historyAppend` always prepends the newest id), so
 * `createdAt` only decreases as the index is walked; this stops at the first entry older than
 * `sinceMs` instead of scanning to the end.
 */
export async function historyListSince(
  deps: HistoryDeps,
  sinceMs: number,
): Promise<HistoryEntry[]> {
  const idx = await readIndex(deps.storage);
  const out: HistoryEntry[] = [];
  for (const id of idx) {
    const raw = await deps.storage.getItem(`history:${id}`);
    if (!raw) continue;
    const parsed = JSON.parse(raw) as HistoryEntry;
    if (parsed.createdAt < sinceMs) break;
    out.push(parsed);
  }
  return out;
}
```

Run: `cd packages/app && bunx vitest run test/history-policy.test.ts`
Expected: all tests pass (existing + 3 new).

- [x] **Step 3: Gate + commit.**

```bash
cd packages/app && bun run typecheck && cd ../.. && bun run lint && bun run format:check
git add packages/app/src/domain/history-policy.ts packages/app/test/history-policy.test.ts
git commit -m "feat(b7): historyListSince — bounded within-window history read"
```

---

### Task 2: `nudge-policy.ts` — domain module

**Files:**

- Create: `packages/app/src/domain/nudge-policy.ts`
- Create: `packages/app/test/nudge-policy.test.ts`
- Modify: `packages/app/src/index.ts` (barrel export)

**Interfaces:**

```ts
export const NUDGE_THRESHOLD = 3;
export const NUDGE_WINDOW_MS: number; // 30 days in ms
export interface NudgeDeps {
  storage: Storage;
  now?: () => number;
}
export async function nudgeAlreadyShown(deps: NudgeDeps, word: string): Promise<boolean>;
export async function nudgeMarkShown(deps: NudgeDeps, word: string): Promise<void>;
export async function evaluateNudge(deps: NudgeDeps, word: string): Promise<boolean>;
```

- [x] **Step 1: Write the failing tests.** Create `packages/app/test/nudge-policy.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  evaluateNudge,
  nudgeAlreadyShown,
  nudgeMarkShown,
  NUDGE_THRESHOLD,
  NUDGE_WINDOW_MS,
} from '../src/domain/nudge-policy';
import { historyAppend } from '../src/domain/history-policy';
import type { Storage, HistoryEntry } from '../src';

function memStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => Promise.resolve(m.get(k) ?? null),
    setItem: (k, v) => {
      m.set(k, v);
      return Promise.resolve();
    },
    removeItem: (k) => {
      m.delete(k);
      return Promise.resolve();
    },
    keys: (p) => Promise.resolve([...m.keys()].filter((k) => !p || k.startsWith(p))),
  };
}

function historyEntry(id: string, word: string, createdAt: number): HistoryEntry {
  return {
    id,
    word,
    context: '',
    createdAt,
    result: {
      markdown: '',
      word,
      target: 'vi',
      model: 'gemini-2.5-flash',
      fromCache: false,
      fetchedAt: createdAt,
    },
  };
}

describe('nudge-policy', () => {
  it('NUDGE_THRESHOLD is 3 and NUDGE_WINDOW_MS is 30 days', () => {
    expect(NUDGE_THRESHOLD).toBe(3);
    expect(NUDGE_WINDOW_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it('returns false below the threshold', async () => {
    const s = memStorage();
    await historyAppend({ storage: s }, historyEntry('1', 'bank', 1000));
    await historyAppend({ storage: s }, historyEntry('2', 'bank', 2000));
    expect(await evaluateNudge({ storage: s, now: () => 3000 }, 'bank')).toBe(false);
  });

  it('returns true exactly when the within-window count first reaches 3', async () => {
    const s = memStorage();
    await historyAppend({ storage: s }, historyEntry('1', 'bank', 1000));
    await historyAppend({ storage: s }, historyEntry('2', 'bank', 2000));
    await historyAppend({ storage: s }, historyEntry('3', 'bank', 3000));
    expect(await evaluateNudge({ storage: s, now: () => 3000 }, 'bank')).toBe(true);
  });

  it('never fires again for the same word once marked, even as the count keeps growing', async () => {
    const s = memStorage();
    await historyAppend({ storage: s }, historyEntry('1', 'bank', 1000));
    await historyAppend({ storage: s }, historyEntry('2', 'bank', 2000));
    await historyAppend({ storage: s }, historyEntry('3', 'bank', 3000));
    expect(await evaluateNudge({ storage: s, now: () => 3000 }, 'bank')).toBe(true);
    await historyAppend({ storage: s }, historyEntry('4', 'bank', 4000));
    expect(await evaluateNudge({ storage: s, now: () => 4000 }, 'bank')).toBe(false);
  });

  it('excludes entries older than the 30-day window from the count', async () => {
    const s = memStorage();
    const day = 24 * 60 * 60 * 1000;
    await historyAppend({ storage: s }, historyEntry('1', 'bank', 0));
    await historyAppend({ storage: s }, historyEntry('2', 'bank', 31 * day));
    await historyAppend({ storage: s }, historyEntry('3', 'bank', 31 * day + 1000));
    const now = 31 * day + 2000; // entry '1' (t=0) is now 31+ days old — outside the window
    expect(await evaluateNudge({ storage: s, now: () => now }, 'bank')).toBe(false);
  });

  it('word matching is case-insensitive (reuses saved-words-policy normalizeWordKey)', async () => {
    const s = memStorage();
    await historyAppend({ storage: s }, historyEntry('1', 'Bank', 1000));
    await historyAppend({ storage: s }, historyEntry('2', 'bank', 2000));
    await historyAppend({ storage: s }, historyEntry('3', 'BANK', 3000));
    expect(await evaluateNudge({ storage: s, now: () => 3000 }, 'bank')).toBe(true);
  });

  it('does not mix counts across different words', async () => {
    const s = memStorage();
    await historyAppend({ storage: s }, historyEntry('1', 'bank', 1000));
    await historyAppend({ storage: s }, historyEntry('2', 'shore', 2000));
    await historyAppend({ storage: s }, historyEntry('3', 'shore', 3000));
    expect(await evaluateNudge({ storage: s, now: () => 3000 }, 'shore')).toBe(false);
  });

  it('nudgeAlreadyShown / nudgeMarkShown round-trip, case-insensitive', async () => {
    const s = memStorage();
    expect(await nudgeAlreadyShown({ storage: s }, 'Bank')).toBe(false);
    await nudgeMarkShown({ storage: s }, 'Bank');
    expect(await nudgeAlreadyShown({ storage: s }, 'bank')).toBe(true);
  });

  it('evaluateNudge persists the marker under the nudge: prefix, independent of saved:/history:', async () => {
    const s = memStorage();
    await historyAppend({ storage: s }, historyEntry('1', 'bank', 1000));
    await historyAppend({ storage: s }, historyEntry('2', 'bank', 2000));
    await historyAppend({ storage: s }, historyEntry('3', 'bank', 3000));
    await evaluateNudge({ storage: s, now: () => 3000 }, 'bank');
    expect(await s.getItem('nudge:bank')).not.toBeNull();
    expect(await s.getItem('saved:bank')).toBeNull();
  });
});
```

Run: `cd packages/app && bunx vitest run test/nudge-policy.test.ts`
Expected: fails — `Cannot find module '../src/domain/nudge-policy'`.

- [x] **Step 2: Implement.** Create `packages/app/src/domain/nudge-policy.ts`:

```ts
import type { Storage } from '../ports';
import { historyListSince } from './history-policy';
import { normalizeWordKey } from './saved-words-policy';

const NUDGE_PREFIX = 'nudge:';

/** How many within-window lookups of the same headword trigger the nudge. */
export const NUDGE_THRESHOLD = 3;
/** The rolling window the count is evaluated over: 30 days. */
export const NUDGE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export interface NudgeDeps {
  storage: Storage;
  /** Wall clock for the 30-day window; injectable so tests control it. Defaults to Date.now
   * (ref-dependency-injection) — mirrors the `now` seam CacheDeps/HistoryDeps/SavedWordsDeps
   * already use. */
  now?: () => number;
}

export async function nudgeAlreadyShown(deps: NudgeDeps, word: string): Promise<boolean> {
  const key = normalizeWordKey(word);
  return (await deps.storage.getItem(`${NUDGE_PREFIX}${key}`)) !== null;
}

export async function nudgeMarkShown(deps: NudgeDeps, word: string): Promise<void> {
  const key = normalizeWordKey(word);
  await deps.storage.setItem(`${NUDGE_PREFIX}${key}`, '1');
}

/**
 * B7: should THIS lookup's reply carry the repeat-offender nudge? True exactly once per word,
 * ever — the moment the word's within-window history count first reaches NUDGE_THRESHOLD, this
 * marks the word as nudged (so every future call for the same word returns false, regardless of
 * whether the reader saves, dismisses, or ignores this one) and returns true for this call only.
 * Callers attach the return value as `LookupResult.nudge` and must never persist it (like
 * `fallbackFrom`, it is a transient annotation on the reply, not part of the cached/historied
 * record).
 */
export async function evaluateNudge(deps: NudgeDeps, word: string): Promise<boolean> {
  if (await nudgeAlreadyShown(deps, word)) return false;
  const key = normalizeWordKey(word);
  const now = deps.now?.() ?? Date.now();
  const recent = await historyListSince({ storage: deps.storage }, now - NUDGE_WINDOW_MS);
  const count = recent.filter((e) => normalizeWordKey(e.word) === key).length;
  if (count < NUDGE_THRESHOLD) return false;
  await nudgeMarkShown(deps, word);
  return true;
}
```

Add the barrel export. In `packages/app/src/index.ts`, right after
`export * from './domain/saved-words-policy';`, add:

```ts
export * from './domain/nudge-policy';
```

Run: `cd packages/app && bunx vitest run test/nudge-policy.test.ts`
Expected: all 9 tests pass.

- [x] **Step 3: Gate + commit.**

```bash
cd packages/app && bun run typecheck && cd ../.. && bun run lint && bun run format:check
git add packages/app/src/domain/nudge-policy.ts packages/app/test/nudge-policy.test.ts packages/app/src/index.ts
git commit -m "feat(b7): nudge-policy domain module (evaluateNudge, one-per-word-ever marker)"
```

---

### Task 3: `LookupResult.nudge` field + wire schema

**Files:**

- Modify: `packages/app/src/domain/types.ts`
- Modify: `packages/app/src/wire.ts`
- Modify: `packages/app/test/wire-schema.test.ts`

**Interfaces:** `LookupResult` gains `nudge?: boolean | undefined`.

- [x] **Step 1: Write the failing test.** Append to `packages/app/test/wire-schema.test.ts`,
      right after the existing `it('lookup result carries optional provider + fallbackFrom; old
results still parse', ...)` test (inside the same `describe` block):

```ts
it('lookup result carries an optional nudge flag; old results still parse (B7)', () => {
  const result = {
    markdown: 'm',
    word: 'w',
    target: 'vi',
    model: 'x',
    fromCache: false,
    fetchedAt: 1,
  };
  expect(
    WireReplySchema.safeParse({
      ok: true,
      type: 'lookup',
      requestId: '1',
      result: { ...result, nudge: true },
    }).success,
  ).toBe(true);
  // Old-shaped result (no nudge) still parses — back-compat.
  expect(
    WireReplySchema.safeParse({ ok: true, type: 'lookup', requestId: '1', result }).success,
  ).toBe(true);
});
```

Run: `cd packages/app && bunx vitest run test/wire-schema.test.ts`
Expected: fails — `result: { ...result, nudge: true }` is rejected by `z.strictObject` (unknown
key `nudge`), so `.success` is `false`, not `true`.

- [x] **Step 2: Implement.** In `packages/app/src/domain/types.ts`, add to `LookupResult` (right
      after the `translation?: string | undefined;` field, before the closing `}`):

```ts
  /**
   * B7: set by the router the instant this lookup's within-30-day history count for `word`
   * first reaches the repeat-offender threshold (3). Transient per-reply annotation, like
   * `fallbackFrom` — stripped before cache/history writes (never computed until after
   * `storableResult` is built in router.ts) so a stored/replayed entry never re-triggers the
   * nudge. Once stamped `true` for a word, `domain/nudge-policy.ts`'s `nudge:<word>` marker
   * guarantees every later reply for that word omits this field forever — "one nudge per word,
   * ever" (roadmap B7 scope fence).
   */
  nudge?: boolean | undefined;
```

In `packages/app/src/wire.ts`, add to `LookupResultSchema` (right after the `translation:
z.string().optional(),` line):

```ts
  // B7: set once, ever, per word — see LookupResult.nudge's doc comment (domain/types.ts).
  nudge: z.boolean().optional(),
```

Run: `cd packages/app && bunx vitest run test/wire-schema.test.ts`
Expected: all tests pass.

- [x] **Step 3: Gate + commit.**

```bash
cd packages/app && bun run typecheck && cd ../.. && bun run lint && bun run format:check
git add packages/app/src/domain/types.ts packages/app/src/wire.ts packages/app/test/wire-schema.test.ts
git commit -m "feat(b7): LookupResult.nudge transient field + wire schema"
```

---

### Task 4: Router — evaluate the nudge on every lookup reply

**Files:**

- Modify: `packages/app/src/app/router.ts`
- Modify: `packages/app/test/app/router.test.ts`

**Interfaces:** `RouterDeps` gains an optional `now?: () => number` (DI seam, mirrors
`CacheDeps`/`HistoryDeps`/`SavedWordsDeps`).

- [x] **Step 1: Write the failing tests.** In `packages/app/test/app/router.test.ts`, update the
      imports at the top to also bring in `historyAppend` and `cachePut`:

```ts
import {
  historyList,
  historyAppend,
  type LookupResult,
  type WireMessage,
  type LookupRequest,
  type PublicSettings,
} from '../../src';
import { cachePut } from '../../src/domain/cache-policy';
```

Update the `DepsOverrides` interface and `deps()` factory to accept an optional `now`:

```ts
interface DepsOverrides {
  client?: { lookup: LookupMock };
  readToggles?: () => Promise<{ cacheEnabled: boolean; saveHistory: boolean }>;
  now?: () => number;
}

function deps(over: DepsOverrides = {}) {
  const kv = fakeStorage();
  const lookupFn = over.client?.lookup ?? makeLookupMock();
  const getFn = vi.fn<() => Promise<PublicSettings>>(() =>
    Promise.resolve({
      targetLang: 'vi',
      outputFormat: 'tpl',
      promptEnvelope: 'ENV-R',
      hasKey: true,
      theme: 'sepia' as const,
      configuredProviders: [],
    }),
  );
  return {
    kv,
    client: { lookup: lookupFn },
    settings: {
      get: getFn,
      set: vi.fn<
        (patch: Partial<Pick<PublicSettings, 'targetLang' | 'outputFormat'>>) => Promise<void>
      >(),
    },
    readToggles:
      over.readToggles ?? vi.fn(() => Promise.resolve({ cacheEnabled: true, saveHistory: true })),
    queue: new WriteQueue(),
    ...(over.now ? { now: over.now } : {}),
  };
}
```

Add a new `describe` block at the end of the file (before the final closing, if the file ends
with `});` for `describe('buildRouter', ...)`, add this as a **sibling** top-level block after
it):

```ts
describe('B7 repeat-offender nudge', () => {
  it('does not nudge on the 1st or 2nd lookup of a word', async () => {
    let t = 1_000_000;
    const d = deps({
      readToggles: () => Promise.resolve({ cacheEnabled: false, saveHistory: true }),
      now: () => t,
    });
    const route = buildRouter(d);
    const r1 = await route(lookupMsg('a'));
    expect(r1.ok && r1.type === 'lookup' ? r1.result.nudge : undefined).toBeUndefined();
    t += 1000;
    const r2 = await route(lookupMsg('b'));
    expect(r2.ok && r2.type === 'lookup' ? r2.result.nudge : undefined).toBeUndefined();
  });

  it('nudges on the 3rd lookup of the same word within the window', async () => {
    let t = 1_000_000;
    const d = deps({
      readToggles: () => Promise.resolve({ cacheEnabled: false, saveHistory: true }),
      now: () => t,
    });
    const route = buildRouter(d);
    await route(lookupMsg('a'));
    t += 1000;
    await route(lookupMsg('b'));
    t += 1000;
    const r3 = await route(lookupMsg('c'));
    expect(r3).toMatchObject({ ok: true, result: { nudge: true } });
  });

  it('never nudges again after the 3rd (4th+ lookups)', async () => {
    let t = 1_000_000;
    const d = deps({
      readToggles: () => Promise.resolve({ cacheEnabled: false, saveHistory: true }),
      now: () => t,
    });
    const route = buildRouter(d);
    for (const id of ['a', 'b', 'c']) {
      await route(lookupMsg(id));
      t += 1000;
    }
    const r4 = await route(lookupMsg('d'));
    expect(r4.ok && r4.type === 'lookup' ? r4.result.nudge : undefined).toBeUndefined();
  });

  it('a stored history entry never carries a nudge field', async () => {
    let t = 1_000_000;
    const d = deps({
      readToggles: () => Promise.resolve({ cacheEnabled: false, saveHistory: true }),
      now: () => t,
    });
    const route = buildRouter(d);
    for (const id of ['a', 'b', 'c']) {
      await route(lookupMsg(id));
      t += 1000;
    }
    const { entries } = await historyList({ storage: d.kv }, {});
    expect(entries.every((e) => !('nudge' in e.result))).toBe(true);
  });

  it('entries outside the 30-day window are not counted', async () => {
    let t = 1_000_000;
    const d = deps({
      readToggles: () => Promise.resolve({ cacheEnabled: false, saveHistory: true }),
      now: () => t,
    });
    const route = buildRouter(d);
    await route(lookupMsg('a'));
    await route(lookupMsg('b'));
    t += 31 * 24 * 60 * 60 * 1000; // jump past the 30-day window
    const r3 = await route(lookupMsg('c'));
    expect(r3.ok && r3.type === 'lookup' ? r3.result.nudge : undefined).toBeUndefined();
  });

  it('a cache-hit reply can also carry nudge:true once the pre-existing history count already met the threshold', async () => {
    const d = deps({
      readToggles: () => Promise.resolve({ cacheEnabled: true, saveHistory: true }),
    });
    // Seed 3 prior history entries directly (bypassing the router/evaluateNudge), simulating a
    // reader who already has 3 recent lookups before this cache-hit request.
    for (const id of ['x', 'y', 'z']) {
      await historyAppend(
        { storage: d.kv },
        { id, word: req.word, context: req.context, result, createdAt: Date.now() },
      );
    }
    // Seed the cache so this request is a genuine cache hit.
    await cachePut(
      { storage: d.kv },
      { word: req.word, context: req.context, target: req.target },
      result,
    );
    const route = buildRouter(d);
    const reply = await route(lookupMsg('a'));
    expect(reply).toMatchObject({ ok: true, result: { fromCache: true, nudge: true } });
    expect(d.client.lookup).not.toHaveBeenCalled();
  });
});
```

Run: `cd packages/app && bunx vitest run test/app/router.test.ts`
Expected: the 6 new tests fail — `result.nudge` is always `undefined` (not wired yet).

- [x] **Step 2: Implement.** In `packages/app/src/app/router.ts`:

Add `evaluateNudge` to the existing import block from `'../index'` (alongside `savedWordUpsert`,
etc.):

```ts
  savedWordUpsert,
  savedWordDelete,
  evaluateNudge,
```

Add `now?: () => number;` to `RouterDeps`, right after the `queue: WriteQueue;` line, with a doc
comment:

```ts
  /**
   * B7: wall clock for the repeat-offender nudge's 30-day window; injectable so tests control it
   * deterministically. Defaults to Date.now inside evaluateNudge when omitted (composition roots
   * omit it and get the real clock) — mirrors the `now` DI seam CacheDeps/HistoryDeps/
   * SavedWordsDeps already use.
   */
  now?: () => number;
```

Replace the cache-hit branch and the tail of `handleLookup`:

```ts
if (cacheEnabled && req.provider === undefined && req.forceLiteral !== true) {
  const hit = await cacheGet({ storage: deps.kv }, keyReq);
  if (hit) return { ok: true, type: 'lookup', result: { ...hit, fromCache: true }, requestId };
}
```

becomes:

```ts
if (cacheEnabled && req.provider === undefined && req.forceLiteral !== true) {
  const hit = await cacheGet({ storage: deps.kv }, keyReq);
  if (hit) {
    const nudge = await deps.queue.run(() =>
      evaluateNudge({ storage: deps.kv, ...(deps.now ? { now: deps.now } : {}) }, req.word),
    );
    return {
      ok: true,
      type: 'lookup',
      result: { ...hit, fromCache: true, ...(nudge ? { nudge: true } : {}) },
      requestId,
    };
  }
}
```

and:

```ts
if (saveHistory) {
  const entry: HistoryEntry = {
    id: crypto.randomUUID(),
    word: req.word,
    context: req.context,
    result: storableResult,
    createdAt: result.fetchedAt,
  };
  await deps.queue.run(() => historyAppend({ storage: deps.kv }, entry));
}
return { ok: true, type: 'lookup', result, requestId };
```

becomes:

```ts
if (saveHistory) {
  const entry: HistoryEntry = {
    id: crypto.randomUUID(),
    word: req.word,
    context: req.context,
    result: storableResult,
    createdAt: result.fetchedAt,
  };
  await deps.queue.run(() => historyAppend({ storage: deps.kv }, entry));
}
// B7: evaluated AFTER the history write above so a fresh lookup's own entry counts toward
// its own threshold-crossing. Queued through the same WriteQueue as every other KV write
// so concurrent lookups of the same word never double-mark it. `result` here still lacks
// `fallbackFrom` in storage only (storableResult) — the LIVE reply keeps it; `nudge` is
// computed fresh here and was never part of storableResult, so it can never leak into the
// persisted history entry.
const nudge = await deps.queue.run(() =>
  evaluateNudge({ storage: deps.kv, ...(deps.now ? { now: deps.now } : {}) }, req.word),
);
return {
  ok: true,
  type: 'lookup',
  result: { ...result, ...(nudge ? { nudge: true } : {}) },
  requestId,
};
```

Run: `cd packages/app && bunx vitest run test/app/router.test.ts`
Expected: all tests pass (existing + 6 new).

- [x] **Step 3: Gate + commit.**

```bash
cd packages/app && bun run typecheck && cd ../.. && bun run lint && bun run format:check
git add packages/app/src/app/router.ts packages/app/test/app/router.test.ts
git commit -m "feat(b7): router evaluates the repeat-offender nudge on every lookup reply"
```

- [x] **Step 4 (Warchief, not the Hunter): sync C3.** From the worktree root:

```bash
c3 write c3-112 --section "Parent Fit" --file /dev/stdin <<'EOF'
| Field | Value |
| --- | --- |
| Parent container | c3-1 (app) |
| Category | Feature |
| Runtime | service worker |
| Public surface | cacheGet, cachePut, cacheClear, cacheDelete, CacheDeps, deriveCacheKey, fnv1a64Hex (cache-policy); historyAppend, historyList, historyListSince, historyClear, historyGet, historyDelete, HistoryDeps, HistoryPage (history-policy); evaluateNudge, nudgeAlreadyShown, nudgeMarkShown, NudgeDeps, NUDGE_THRESHOLD, NUDGE_WINDOW_MS (nudge-policy, B7) |
| Bundled into | packages/app/src/domain/cache-policy.ts, packages/app/src/domain/history-policy.ts, and packages/app/src/domain/nudge-policy.ts |
| Depends on | c3-102 Storage port; c3-101 LookupResult and HistoryEntry types; c3-118 saved-words-policy (normalizeWordKey, reused) |
| Consumed by | c3-111 (lookup-router) which calls these functions after a successful lookup and for single-entry deletion (history.delete) |
EOF
```

(Adjust the exact `c3 write` invocation to whatever the installed `c3` CLI's `write --section`
syntax accepts — the goal is only that c3-112's `Public surface`/`Bundled into` rows list the new
`nudge-policy.ts` exports and file, matching the pattern already used for cache/history.) Then
add the file to the component's code-map glob and validate:

```bash
c3 set c3-112 codemap.add packages/app/src/domain/nudge-policy.ts
c3 set c3-112 codemap.add packages/app/test/nudge-policy.test.ts
c3 check
```

If the installed CLI does not expose a `codemap.add` verb, edit is CLI-only per the skill's hard
rule — use whatever the `c3 --help` / `c3 set --help` output shows for adding a file pattern to a
component's `code-map.yaml` entry; do not hand-edit `.c3/code-map.yaml`. Commit the `.c3/` diff
separately: `git add .c3/ && git commit -m "docs(c3): register nudge-policy.ts under c3-112"`.

---

## CHECKPOINT: skinner audit #1 (after Task 4)

Dispatch the `skinner` agent against the branch diff so far, pointed at this plan + the design
spec + `c3-112`'s rules (`ref-kv-storage-prefixes`, `ref-dependency-injection`,
`rule-domain-purity`). It must RUN `bun run --filter @ai-dict/app typecheck`, `bun run --filter
@ai-dict/app test`, `bun run lint`, `bun run format:check` — not just read the diff. Confirm: (1)
`nudge:*` keyspace is genuinely independent (no cross-writes into `saved:*`/`history:*`/
`cache:*`), (2) `nudge` is never present on a persisted `history:<id>` entry, (3)
`SavedWordEntry`/`SavedWordSense`/`SavedWordStatus` are untouched by the diff, (4)
`historyListSince`'s early-exit is covered by a call-counting test. Fix any Critical/Important
finding with a fresh Hunter and re-audit (cap 3 rounds) before continuing to Task 5.

---

### Task 5: UI — `CardState.nudge` + the nudge banner

**Files:**

- Modify: `packages/app/src/ui/lookup-card.ts`
- Modify: `packages/app/test/ui/lookup-card.test.ts`

**Interfaces:** `CardState`'s `'result'` variant gains `nudge?: boolean`.

- [x] **Step 1: Write the failing tests.** Append to `packages/app/test/ui/lookup-card.test.ts`,
      as a new top-level `describe` block placed right after the existing B1 save/star affordance
      describe block (the one titled "save/star affordance (B1)"):

```ts
describe('<lookup-card> repeat-offender nudge (B7)', () => {
  it('a result with nudge:true renders the banner with the exact copy', () => {
    const el = mountCard();
    el.state = {
      kind: 'result',
      word: 'bank',
      target: 'vi',
      safeHtml: safe('<p>money place</p>'),
      nudge: true,
    };
    const row = el.querySelector('.nudge-row')!;
    expect(row).not.toBeNull();
    expect(row.textContent).toContain('3rd time meeting this word — save it?');
  });

  it('clicking the nudge Save button fires the SAME composed toggle-save event the star uses', () => {
    const el = mountCard();
    el.state = {
      kind: 'result',
      word: 'bank',
      target: 'vi',
      safeHtml: safe('<p>money place</p>'),
      nudge: true,
    };
    const handler = vi.fn();
    document.body.addEventListener('toggle-save', handler);
    el.querySelector<HTMLButtonElement>('.nudge-row__save-btn')!.click();
    document.body.removeEventListener('toggle-save', handler);
    expect(handler).toHaveBeenCalledTimes(1);
    const event = handler.mock.calls[0]![0] as CustomEvent<{ word: string }>;
    expect(event.detail).toEqual({ word: 'bank' });
  });

  it('clicking the dismiss button fires a composed dismiss-nudge event', () => {
    const el = mountCard();
    el.state = {
      kind: 'result',
      word: 'bank',
      target: 'vi',
      safeHtml: safe('<p>money place</p>'),
      nudge: true,
    };
    const handler = vi.fn();
    document.body.addEventListener('dismiss-nudge', handler);
    el.querySelector<HTMLButtonElement>('.nudge-row__dismiss-btn')!.click();
    document.body.removeEventListener('dismiss-nudge', handler);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('nudge absent/false renders no banner (back-compat)', () => {
    const el = mountCard();
    el.state = { kind: 'result', word: 'bank', target: 'vi', safeHtml: safe('<p>money place</p>') };
    expect(el.querySelector('.nudge-row')).toBeNull();
  });

  it('the loading and error states render no nudge row (only result carries it)', () => {
    const { nodes } = loadingCaption();
    expect(nodes.some((n) => n instanceof HTMLElement && n.classList.contains('nudge-row'))).toBe(
      false,
    );
  });

  it('has no axe violations (result state with nudge banner)', async () => {
    const el = mountCard();
    el.state = {
      kind: 'result',
      word: 'bank',
      target: 'vi',
      safeHtml: safe('<p>money place</p>'),
      nudge: true,
    };
    expect(await axeViolations(el)).toEqual([]);
  });
});
```

Run: `cd packages/app && bunx vitest run test/ui/lookup-card.test.ts`
Expected: fails — `.nudge-row` is `null` (no such element exists yet).

- [x] **Step 2: Implement.** In `packages/app/src/ui/lookup-card.ts`:

Add `nudge?: boolean;` to the `CardState` `'result'` variant, right after `saved?: boolean;`:

```ts
      /** B1: whether this word is currently starred/saved — drives the save row's fill state. */
      saved?: boolean;
      /** B7: whether to show the repeat-offender nudge banner — stamped once, ever, per word by
       * the router the moment its within-30-day history count first crosses the threshold. */
      nudge?: boolean;
```

Add the CSS rule at the end of the `CSS` template literal (right after
`::slotted(.save-row){display:flex;margin:6px 0 10px}`):

```
::slotted(.nudge-row){display:flex;align-items:center;gap:8px;margin:0 0 10px;padding:7px 10px;border:1px solid var(--ad-accent);border-radius:var(--adp-radius-control);background:var(--ad-surface-raised)}`;
```

(i.e. the template literal's final line changes from ending in
`::slotted(.save-row){display:flex;margin:6px 0 10px}\`;`to appending the`.nudge-row` rule
before the closing backtick-semicolon.)

Add the descendant rules at the end of `CARD_DOC_CSS` (right after the existing
`@media (prefers-reduced-motion:reduce){lookup-card .save-btn{transition:none}}` line, before the
closing backtick):

```
lookup-card .nudge-row__text{flex:1 1 auto;min-width:0;font-size:var(--adp-text-2xs);color:var(--ad-ink)}
lookup-card .nudge-row__save-btn{flex:none;border:1px solid var(--ad-accent);background:var(--ad-accent);color:var(--ad-on-accent);border-radius:var(--adp-radius-control);padding:3px 11px;font:inherit;font-size:var(--adp-text-2xs);font-weight:var(--adp-weight-semi);cursor:pointer}
lookup-card .nudge-row__save-btn:hover{filter:brightness(1.06)}
lookup-card .nudge-row__save-btn:focus-visible{outline:2px solid var(--ad-accent);outline-offset:2px}
lookup-card .nudge-row__dismiss-btn{flex:none;display:inline-grid;place-items:center;width:22px;height:22px;border:0;background:transparent;color:var(--ad-ink-faint);border-radius:var(--adp-radius-control);cursor:pointer}
lookup-card .nudge-row__dismiss-btn svg{width:12px;height:12px;pointer-events:none}
lookup-card .nudge-row__dismiss-btn:hover{background:var(--ad-surface);color:var(--ad-ink)}
lookup-card .nudge-row__dismiss-btn:focus-visible{outline:2px solid var(--ad-accent);outline-offset:2px}
```

Add `renderNudgeRow`, right after the `renderSaveRow` function definition:

```ts
/**
 * B7: the repeat-offender nudge banner — shown once per word, ever, when `state.nudge === true`
 * (stamped by the router the moment a word's within-30-day lookup count first crosses the
 * threshold; see domain/nudge-policy.ts). "Save" dispatches the exact same `toggle-save` event
 * the star button dispatches — not a second save path. "Dismiss" is a pure client-side action:
 * the backend has already permanently marked this word as nudged before this reply was ever
 * sent, so there is nothing left for a dismiss round-trip to tell it.
 */
function renderNudgeRow(state: { word: string }): HTMLElement {
  const row = document.createElement('div');
  row.className = 'nudge-row';
  row.setAttribute('role', 'status');
  const text = document.createElement('span');
  text.className = 'nudge-row__text';
  text.textContent = '3rd time meeting this word — save it?';
  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'nudge-row__save-btn';
  saveBtn.textContent = 'Save';
  saveBtn.addEventListener('click', () =>
    saveBtn.dispatchEvent(
      new CustomEvent('toggle-save', {
        detail: { word: state.word },
        bubbles: true,
        composed: true,
      }),
    ),
  );
  const dismissBtn = document.createElement('button');
  dismissBtn.type = 'button';
  dismissBtn.className = 'nudge-row__dismiss-btn';
  dismissBtn.setAttribute('aria-label', 'Dismiss nudge');
  dismissBtn.innerHTML = ICON_CLOSE; // decorative aria-hidden SVG; name comes from aria-label
  dismissBtn.addEventListener('click', () =>
    dismissBtn.dispatchEvent(new CustomEvent('dismiss-nudge', { bubbles: true, composed: true })),
  );
  row.append(text, saveBtn, dismissBtn);
  return row;
}
```

Wire it into `renderCardState`'s `'result'` branch — change:

```ts
const nodes: Node[] = [h, renderSaveRow(state)];
const definedAsRow = state.definedAs ? renderDefinedAsRow(state.definedAs) : null;
if (definedAsRow) nodes.push(definedAsRow);
```

to:

```ts
const nodes: Node[] = [h, renderSaveRow(state)];
if (state.nudge === true) nodes.push(renderNudgeRow(state));
const definedAsRow = state.definedAs ? renderDefinedAsRow(state.definedAs) : null;
if (definedAsRow) nodes.push(definedAsRow);
```

Run: `cd packages/app && bunx vitest run test/ui/lookup-card.test.ts`
Expected: all tests pass (existing + 6 new).

- [x] **Step 3: Gate + commit.**

```bash
cd packages/app && bun run typecheck && cd ../.. && bun run lint && bun run format:check
git add packages/app/src/ui/lookup-card.ts packages/app/test/ui/lookup-card.test.ts
git commit -m "feat(b7): CardState.nudge + the nudge banner (Save reuses toggle-save, Dismiss is local)"
```

---

### Task 6: `InlineBottomSheetRenderer` — thread `r.nudge`, `dismissNudge()`

**Files:**

- Modify: `packages/app/src/app/inline-bottom-sheet-renderer.ts`
- Modify: `packages/app/test/app/inline-bottom-sheet-renderer.test.ts`

**Interfaces:** new public method `dismissNudge(): void`.

- [x] **Step 1: Write the failing tests.** Append to
      `packages/app/test/app/inline-bottom-sheet-renderer.test.ts`, as a new `describe` block
      after the existing `describe('InlineBottomSheetRenderer — save state (B1)', ...)` block:

```ts
describe('InlineBottomSheetRenderer — repeat-offender nudge (B7)', () => {
  it('renderResult reflects r.nudge=true', () => {
    const h = host();
    new InlineBottomSheetRenderer(h).renderResult({ ...result, nudge: true });
    expect(card(h).querySelector('.nudge-row')).not.toBeNull();
  });

  it('renderResult defaults nudge to false when r.nudge is absent', () => {
    const h = host();
    new InlineBottomSheetRenderer(h).renderResult(result);
    expect(card(h).querySelector('.nudge-row')).toBeNull();
  });

  it('setSaved(true) also clears the nudge banner', () => {
    const h = host();
    const r = new InlineBottomSheetRenderer(h);
    r.renderResult({ ...result, nudge: true });
    r.setSaved(true);
    expect(card(h).querySelector('.nudge-row')).toBeNull();
  });

  it('dismissNudge() clears the nudge banner without touching saved', () => {
    const h = host();
    const r = new InlineBottomSheetRenderer(h);
    r.renderResult({ ...result, nudge: true }, { saved: true });
    r.dismissNudge();
    const c = card(h);
    expect(c.querySelector('.nudge-row')).toBeNull();
    expect(c.querySelector<HTMLButtonElement>('.save-btn')!.getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('dismissNudge is a no-op when the last state was loading, not a result', () => {
    const h = host();
    const r = new InlineBottomSheetRenderer(h);
    r.renderLoading();
    expect(() => r.dismissNudge()).not.toThrow();
  });

  it('dismissNudge is a no-op before any render (no card mounted)', () => {
    const h = host();
    const r = new InlineBottomSheetRenderer(h);
    expect(() => r.dismissNudge()).not.toThrow();
    expect(h.querySelector('bottom-sheet')).toBeNull();
  });
});
```

Run: `cd packages/app && bunx vitest run test/app/inline-bottom-sheet-renderer.test.ts`
Expected: fails — `r.dismissNudge is not a function`, and `.nudge-row` assertions fail since
`nudge` isn't threaded yet.

- [x] **Step 2: Implement.** In `packages/app/src/app/inline-bottom-sheet-renderer.ts`, change
      `renderResult`:

```ts
  renderResult(r: LookupResult, ctx?: ResultRenderContext): void {
    this.onSwitch = ctx?.onSwitchProvider;
    this.onForceLiteral = ctx?.onForceLiteral;
    this.setState({
      kind: 'result',
      safeHtml: this.sanitize(r.markdown),
      word: r.word,
      target: r.target,
      ...(r.provider !== undefined ? { provider: r.provider } : {}),
      ...(r.fallbackFrom !== undefined ? { fallbackFrom: r.fallbackFrom } : {}),
      ...(r.definedAs !== undefined ? { definedAs: r.definedAs } : {}),
      ...(ctx?.providers !== undefined ? { providers: ctx.providers } : {}),
      saved: ctx?.saved === true,
    });
  }
```

to:

```ts
  renderResult(r: LookupResult, ctx?: ResultRenderContext): void {
    this.onSwitch = ctx?.onSwitchProvider;
    this.onForceLiteral = ctx?.onForceLiteral;
    this.setState({
      kind: 'result',
      safeHtml: this.sanitize(r.markdown),
      word: r.word,
      target: r.target,
      ...(r.provider !== undefined ? { provider: r.provider } : {}),
      ...(r.fallbackFrom !== undefined ? { fallbackFrom: r.fallbackFrom } : {}),
      ...(r.definedAs !== undefined ? { definedAs: r.definedAs } : {}),
      ...(ctx?.providers !== undefined ? { providers: ctx.providers } : {}),
      saved: ctx?.saved === true,
      // B7: r.nudge is a transient per-reply annotation (never persisted — see router.ts);
      // always explicit true/false, same style as `saved` above.
      nudge: r.nudge === true,
    });
  }
```

Change `setSaved` and add `dismissNudge`:

```ts
  setSaved(saved: boolean): void {
    if (this.lastState?.kind !== 'result') return;
    this.setState({ ...this.lastState, saved });
  }
```

to:

```ts
  setSaved(saved: boolean): void {
    if (this.lastState?.kind !== 'result') return;
    // B7: any save toggle (star OR the nudge banner's own Save button — both dispatch the same
    // toggle-save event) also clears the nudge banner; the reader has acted on the signal.
    this.setState({ ...this.lastState, saved, nudge: false });
  }

  /**
   * B7: hide the nudge banner on the currently-shown result without touching `saved`. The
   * backend already permanently marked this word as nudged before this reply was ever sent
   * (domain/nudge-policy.ts), so dismissal needs no wire round-trip — a pure local re-render,
   * mirroring the guard pattern `setSaved`/`appendToCard` already use.
   */
  dismissNudge(): void {
    if (this.lastState?.kind !== 'result') return;
    this.setState({ ...this.lastState, nudge: false });
  }
```

Run: `cd packages/app && bunx vitest run test/app/inline-bottom-sheet-renderer.test.ts`
Expected: all tests pass (existing + 6 new).

- [x] **Step 3: Gate + commit.**

```bash
cd packages/app && bun run typecheck && cd ../.. && bun run lint && bun run format:check
git add packages/app/src/app/inline-bottom-sheet-renderer.ts packages/app/test/app/inline-bottom-sheet-renderer.test.ts
git commit -m "feat(b7): InlineBottomSheetRenderer threads r.nudge, adds dismissNudge()"
```

---

### Task 7: Chrome composition roots — wire the nudge (`content.ts`, `side-panel.ts`)

**Files:**

- Modify: `packages/extension-chrome/src/content.ts`
- Modify: `packages/extension-chrome/src/side-panel.ts`

**Interfaces:** none new — both files are composition roots, excluded from the coverage gate
(`packages/extension-chrome/vitest.config.ts`'s `coverage.exclude`); correctness is proven by
Task 8's e2e spec against the built extension, exactly like B1's `content.ts`/`side-panel.ts`
tasks were.

- [x] **Step 1: Implement `content.ts` directly** (no unit test — composition root). In
      `packages/extension-chrome/src/content.ts`, add a new listener right after the existing
      `toggle-save` listener block:

```ts
document.addEventListener('toggle-save', () => {
  if (!lastSavePayload) return;
  const willSave = !lastSaved;
  lastSaved = willSave;
  inline.setSaved(willSave);
  const message = willSave
    ? { type: 'saved.save' as const, ...lastSavePayload }
    : { type: 'saved.delete' as const, word: lastSavePayload.word };
  void chrome.runtime.sendMessage(message).catch(() => undefined);
});
```

— add directly below it:

```ts
// B7: the card's nudge banner bubbles a composed `dismiss-nudge` event when its × is tapped.
// No wire message: the router already permanently marked this word as nudged before this reply
// was sent (domain/nudge-policy.ts) — dismissal is purely local, hiding the banner on this card.
document.addEventListener('dismiss-nudge', () => {
  inline.dismissNudge();
});
```

Expected: no test to run here — `content.ts` is a composition root (coverage-gate-exempt); the
change is proven correct by Task 8's e2e spec once the extension is rebuilt.

- [x] **Step 2: Implement `side-panel.ts` directly** (no unit test — composition root). In
      `packages/extension-chrome/src/side-panel.ts`, change `resultToFocus`:

```ts
function resultToFocus(r: LookupResult): PanelFocusState {
  // Show the provider badge + fallback note in the panel too, but no one-shot picker here
  // (the panel is a persistent surface, not the transient in-page card) — omit `providers`.
  return {
    kind: 'result',
    safeHtml: sanitizeMarkdown(r.markdown),
    word: r.word,
    target: r.target,
    ...(r.provider !== undefined ? { provider: r.provider } : {}),
    ...(r.fallbackFrom !== undefined ? { fallbackFrom: r.fallbackFrom } : {}),
  };
}
```

to:

```ts
function resultToFocus(r: LookupResult): PanelFocusState {
  // Show the provider badge + fallback note in the panel too, but no one-shot picker here
  // (the panel is a persistent surface, not the transient in-page card) — omit `providers`.
  return {
    kind: 'result',
    safeHtml: sanitizeMarkdown(r.markdown),
    word: r.word,
    target: r.target,
    ...(r.provider !== undefined ? { provider: r.provider } : {}),
    ...(r.fallbackFrom !== undefined ? { fallbackFrom: r.fallbackFrom } : {}),
    // B7: nudge is a transient per-reply annotation on LookupResult (never persisted); thread it
    // through so the panel's own focus region shows the same banner the in-page card does.
    ...(r.nudge === true ? { nudge: true } : {}),
  };
}
```

Change `setSaved` and add `dismissNudge`:

```ts
function setSaved(saved: boolean): void {
  if (view.focusState.kind !== 'result') return;
  view.focusState = { ...view.focusState, saved };
}
```

to:

```ts
function setSaved(saved: boolean): void {
  if (view.focusState.kind !== 'result') return;
  // B7: any save toggle also clears the nudge banner — the reader has acted on the signal.
  view.focusState = { ...view.focusState, saved, nudge: false };
}

/** B7: hide the nudge banner without touching `saved` — mirrors
 * InlineBottomSheetRenderer.dismissNudge(). No wire round-trip: the backend already permanently
 * marked this word as nudged before this focus state was ever set (domain/nudge-policy.ts). */
function dismissNudge(): void {
  if (view.focusState.kind !== 'result') return;
  view.focusState = { ...view.focusState, nudge: false };
}
```

Add the listener right after the existing `toggle-save` listener:

```ts
view.addEventListener('toggle-save', () => {
  if (!lastSavePayload) return;
  const willSave = !lastSaved;
  lastSaved = willSave;
  setSaved(willSave);
  const message = willSave
    ? { type: 'saved.save' as const, ...lastSavePayload }
    : { type: 'saved.delete' as const, word: lastSavePayload.word };
  void chrome.runtime.sendMessage(message).catch(() => undefined);
});

// B7: the panel's own focus region bubbles the same composed dismiss-nudge event the in-page
// card does. No wire message needed — see dismissNudge()'s doc comment above.
view.addEventListener('dismiss-nudge', () => dismissNudge());
```

- [x] **Step 3: Gate + commit.**

```bash
cd packages/extension-chrome && bun run typecheck && cd ../.. && bun run lint && bun run format:check
git add packages/extension-chrome/src/content.ts packages/extension-chrome/src/side-panel.ts
git commit -m "feat(b7): wire the nudge into Chrome's two composition roots"
```

---

## CHECKPOINT: skinner audit #2 (after Task 7)

Dispatch the `skinner` agent against the full branch diff so far, pointed at this plan + the
design spec. It must RUN the full unit suite (`bun run --filter @ai-dict/app test`), typecheck,
lint, format:check. Confirm: (1) the nudge Save button dispatches the identical `toggle-save`
event/detail shape the star button does (no parallel save path exists anywhere in the diff), (2)
every new/changed field on a shared interface (`CardState`, `LookupResult`, `PanelFocusState`) is
optional so `packages/extension-safari/**` still typechecks unchanged — run `cd
packages/extension-safari && bun run typecheck` to prove it, (3) no `--ad-*`/`--adp-*` token
rule violation in the new CSS. Fix any Critical/Important finding with a fresh Hunter and
re-audit (cap 3 rounds) before continuing to Task 8.

---

### Task 8: e2e functional coverage

**Files:**

- Create: `packages/extension-chrome/e2e/b7-repeat-nudge.spec.ts`

- [x] **Step 1: Write the spec.**

```ts
import { test, expect } from './fixtures';
import {
  seedSettings,
  gotoFixture,
  selectWord,
  openTrigger,
  mockGemini,
  storageDump,
} from './helpers';

async function doLookup(page: import('@playwright/test').Page): Promise<void> {
  await gotoFixture(page);
  await page.waitForTimeout(1_000);
  await selectWord(page, 't', 'bank');
  await openTrigger(page);
  await expect(page.locator('bottom-sheet lookup-card')).toContainText('financial institution', {
    timeout: 10_000,
  });
}

test.describe('B7 repeat-offender nudge', () => {
  test('the nudge banner appears only on the 3rd lookup of the same word', async ({
    context,
    extensionId,
  }) => {
    await mockGemini(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page, { cacheEnabled: false }); // force a fresh history append each time

    await doLookup(page);
    await expect(page.locator('bottom-sheet lookup-card .nudge-row')).toHaveCount(0);

    await doLookup(page);
    await expect(page.locator('bottom-sheet lookup-card .nudge-row')).toHaveCount(0);

    await doLookup(page);
    await expect(page.locator('bottom-sheet lookup-card .nudge-row')).toBeVisible();
    await expect(page.locator('bottom-sheet lookup-card .nudge-row')).toContainText(
      '3rd time meeting this word',
    );
  });

  test('tapping the nudge Save button persists the word via the same save path as the star', async ({
    context,
    extensionId,
  }) => {
    await mockGemini(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page, { cacheEnabled: false });

    await doLookup(page);
    await doLookup(page);
    await doLookup(page);
    const nudgeSave = page.locator('bottom-sheet lookup-card .nudge-row__save-btn');
    await expect(nudgeSave).toBeVisible();
    await nudgeSave.click();

    await expect(page.locator('bottom-sheet lookup-card .nudge-row')).toHaveCount(0);
    const star = page.locator('bottom-sheet lookup-card .save-btn');
    await expect(star).toHaveAttribute('aria-pressed', 'true');

    await page.goto(`chrome-extension://${extensionId}/options.html`);
    const dump = await storageDump(page);
    expect(dump['saved:bank']).toBeDefined();
  });

  test('the nudge never re-shows for the same word after being shown once (dismiss or ignore)', async ({
    context,
    extensionId,
  }) => {
    await mockGemini(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page, { cacheEnabled: false });

    await doLookup(page);
    await doLookup(page);
    await doLookup(page);
    await expect(page.locator('bottom-sheet lookup-card .nudge-row')).toBeVisible();

    // Dismiss without saving.
    await page.locator('bottom-sheet lookup-card .nudge-row__dismiss-btn').click();
    await expect(page.locator('bottom-sheet lookup-card .nudge-row')).toHaveCount(0);

    // A 4th (and 5th) lookup of the same word must never re-show the banner.
    await doLookup(page);
    await expect(page.locator('bottom-sheet lookup-card .nudge-row')).toHaveCount(0);
    await doLookup(page);
    await expect(page.locator('bottom-sheet lookup-card .nudge-row')).toHaveCount(0);
  });

  test('a different word starts its own fresh count (no cross-word leakage)', async ({
    context,
    extensionId,
  }) => {
    await mockGemini(context, {
      body: JSON.stringify({
        candidates: [{ content: { parts: [{ text: '## steep\nRising sharply.' }] } }],
      }),
    });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page, { cacheEnabled: false });

    await gotoFixture(page);
    await page.waitForTimeout(1_000);
    await selectWord(page, 't', 'steep');
    await openTrigger(page);
    await expect(page.locator('bottom-sheet lookup-card')).toContainText('Rising sharply', {
      timeout: 10_000,
    });
    await expect(page.locator('bottom-sheet lookup-card .nudge-row')).toHaveCount(0);
  });
});
```

- [x] **Step 2: Build + run.**

```bash
bun run build:chrome
cd packages/extension-chrome && bunx playwright test b7-repeat-nudge
```

Expected: all 4 tests pass against the built extension.

- [x] **Step 3: Gate + commit.**

```bash
cd .. && bun run lint && bun run format:check
git add packages/extension-chrome/e2e/b7-repeat-nudge.spec.ts
git commit -m "test(b7): e2e functional coverage for the repeat-offender nudge"
```

---

### Task 9: e2e evidence spec (recording harness, not part of the normal suite)

**Files:**

- Create: `packages/extension-chrome/e2e/b7-evidence.spec.ts`

- [x] **Step 1: Write the spec** (mirrors `b1-evidence.spec.ts` exactly, adapted for 3 lookups +
      the nudge's Save button):

```ts
/**
 * B7 before/after evidence: a short recorded flow showing three lookups of the same word, the
 * repeat-offender nudge appearing on the 3rd, and tapping its Save button. Not part of the
 * normal suite. (Re)record with:
 *   PLAYWRIGHT_RUN_EVIDENCE=1 SHOT_LABEL=after B7_OUT_DIR=/abs/path \
 *     bunx playwright test b7-evidence
 * Capture BEFORE from a `master` build (no nudge ever appears, however many times you look the
 * word up) and AFTER from the branch build, then host the .webm per the private-repo rule
 * (pr-assets branch + same-origin github.com/.../raw URLs).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { test, chromium } from '@playwright/test';
import { seedSettings, gotoFixture, selectWord, openTrigger, GEMINI_OK_BODY } from './helpers';
import { E2E_HEADLESS } from '../playwright.config';

const RUN = process.env.PLAYWRIGHT_RUN_EVIDENCE === '1';
const LABEL = process.env.SHOT_LABEL ?? 'after';
const OUT = process.env.B7_OUT_DIR ?? '.';
const here = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(here, '../dist');
const SIZE = { width: 900, height: 620 };

test.describe('B7 repeat-offender nudge — evidence', () => {
  test.skip(!RUN, 'set PLAYWRIGHT_RUN_EVIDENCE=1 to (re)record B7 before/after video');

  test(`3x lookup → nudge → Save (${LABEL})`, async () => {
    const videoDir = path.join(OUT, `b7-${LABEL}-raw`);
    const context = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        ...(E2E_HEADLESS ? ['--headless=new'] : []),
        `--disable-extensions-except=${distDir}`,
        `--load-extension=${distDir}`,
      ],
      viewport: SIZE,
      recordVideo: { dir: videoDir, size: SIZE },
    });
    try {
      await context.route('https://generativelanguage.googleapis.com/**', (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: GEMINI_OK_BODY }),
      );

      const page = await context.newPage();
      const [sw] = context.serviceWorkers();
      const worker = sw ?? (await context.waitForEvent('serviceworker', { timeout: 10_000 }));
      const extensionId = new URL(worker.url()).hostname;

      await page.goto(`chrome-extension://${extensionId}/options.html`);
      await seedSettings(page, { cacheEnabled: false });

      for (let i = 0; i < 3; i++) {
        await gotoFixture(page);
        await page.waitForTimeout(600);
        await selectWord(page, 't', 'bank');
        await openTrigger(page);
        await page.waitForTimeout(1_200); // hold on the rendered definition
      }

      await page.waitForTimeout(800); // hold on the nudge banner (3rd lookup)
      const nudgeSave = page.locator('bottom-sheet lookup-card .nudge-row__save-btn');
      if (await nudgeSave.count()) await nudgeSave.click(); // no-op on `before` (no nudge exists)
      await page.waitForTimeout(1_800); // hold on the "Saved" confirmation

      const video = page.video();
      await page.close();
      await mkdir(OUT, { recursive: true });
      await video?.saveAs(path.join(OUT, `b7-${LABEL}.webm`));
    } finally {
      await context.close().catch(() => {});
    }
  });
});
```

- [x] **Step 2: Gate + commit** (recording itself happens after Task 9, driven by the Warchief —
      see "After all tasks" below; this step just lands the harness file).

```bash
bun run lint && bun run format:check
git add packages/extension-chrome/e2e/b7-evidence.spec.ts
git commit -m "test(b7): evidence recording harness (before/after video)"
```

Expected: `lint`/`format:check` exit 0 and the commit succeeds; the spec itself stays skipped
(`test.skip(!RUN, ...)`) until the Warchief actually records evidence in the "After all tasks"
section below — it is not run as part of this task's own gate.

---

## FINAL AUDIT (Warchief + skinner, full branch, before evidence capture + PR)

Dispatch the `skinner` agent once more against the **entire branch diff** (`git diff
df3129c...HEAD`), pointed at this plan + the design spec + the roadmap card + all repo governance
(`CLAUDE.md`, `.claude/rules/`, C3 rules). It must RUN:

```bash
bun run typecheck
bun run lint
bun run format:check
bun run --filter @ai-dict/app test
bun run --filter @ai-dict/extension-chrome build
cd packages/extension-chrome && bunx playwright test b7-repeat-nudge
```

Required conformance checks (map 1:1 to the card's scope fence and this dispatch's success
criteria):

1. `SavedWordEntry`/`SavedWordSense`/`SavedWordStatus` (types.ts + wire.ts) are byte-for-byte
   unchanged in the diff.
2. The nudge's Save action dispatches the identical `toggle-save` CustomEvent the B1 star button
   dispatches — grep the diff for any second `saved.save`/`saved.delete` trigger; there must be
   none.
3. `nudge:*` is a new, independent keyspace — `historyClear`/`cacheClear`/`savedWordsClear` never
   touch it, and it's never touched by them either.
4. A persisted `history:<id>` entry never carries a `nudge` key (regression-style check, mirrors
   the existing `fallbackFrom` guarantee).
5. No new `WireMessage`/`WireReply` type was added.
6. No manifest permission changed (`git diff` on both `manifest.json` files is empty).
7. `packages/extension-safari` typechecks unchanged.
8. All UI CSS uses only `--ad-*`/`--adp-*` tokens.

Loop any Critical/Important finding through a fresh Hunter and re-audit, capped at 3 rounds
total across both checkpoints and this final audit combined per the Warchief's governing
contract; a FAIL surviving 3 rounds returns `NEEDS_DIRECTION` with the Skinner's report attached
verbatim rather than a 4th attempt.

## After all tasks: evidence capture + PR (Warchief, not a Hunter task)

1. **BEFORE video**: check out `master` (`df3129c`) into a scratch build dir, e.g. via
   `git worktree add /tmp/b7-before-build df3129c`, then `bun install && bun run build:chrome` in
   that worktree, then run (note: `df3129c` predates this feature, so `b7-evidence.spec.ts`
   doesn't exist there yet — copy just that one spec file from this branch into the `master`
   worktree's `packages/extension-chrome/e2e/` dir first, the same way B1's before-video was
   captured against a pre-B1 tree):
   `PLAYWRIGHT_RUN_EVIDENCE=1 SHOT_LABEL=before B7_OUT_DIR=/tmp/b7-evidence bunx playwright test
b7-evidence`.
2. **AFTER video**: on this branch, `bun run build:chrome`, then run:
   `PLAYWRIGHT_RUN_EVIDENCE=1 SHOT_LABEL=after B7_OUT_DIR=/tmp/b7-evidence bunx playwright test
b7-evidence`.
3. Host both `.webm` files on a throwaway `pr-assets/b7-repeat-offender-nudge` branch (orphan or
   branched off `master`, containing only the two video files), push it.
4. Open the PR into `master` with the before/after videos embedded via same-origin URLs:
   `https://github.com/hieplam/ai-dict/raw/pr-assets/b7-repeat-offender-nudge/b7-before.webm` and
   `.../b7-after.webm` — never `raw.githubusercontent.com`.
5. Wait for CI green (block on `gh run watch`, per the Warchief's governing contract — never
   poll-and-abandon). Squash-merge once green. Sync local master, remove the worktree, delete the
   local branch.
