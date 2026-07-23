# B14 Sense-Aware Dedup Implementation Plan

> **For agentic workers:** implement task-by-task, TDD (red → green → commit) per task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** saving an already-saved headword (case-insensitive exact match) with a genuinely new
sentence/url no longer silently overwrites the stored sense — the router replies
`saved.conflict`, and the card/panel show an "Add as new sense?" prompt. Confirming appends a new
element to `SavedWordEntry.senses[]`; declining writes nothing. An exact sentence+url repeat is a
silent no-op (idempotent, no prompt).

**Architecture:** the merge decision lives entirely in
`packages/app/src/domain/saved-words-policy.ts`'s `savedWordUpsert` (now returns a
`{kind:'saved'|'conflict', ...}` union instead of a bare entry); the router
(`packages/app/src/app/router.ts`) translates a `conflict` result into a new `saved.conflict` wire
reply; the two composition roots (`packages/extension-chrome/src/content.ts` and
`.../side-panel.ts`) each independently show a merge prompt (new `packages/app/src/ui/merge-prompt.ts`
helper, appended on demand — the same pattern `error-consent.ts`'s `buildConsentFooter` already
uses) and, on confirm, re-send `saved.save` with `confirmNewSense: true`. The ratified
`SavedWordEntry`/`SavedWordSense` shapes (E1) are completely unchanged. Full design rationale,
including the two rejected merge-prompt/wire designs:
`docs/superpowers/specs/2026-07-17-b14-sense-aware-dedup-design.md`.

**Tech Stack:** TypeScript, Zod (wire schemas), Vitest + happy-dom (unit), Playwright (e2e).

## Global Constraints

- Implementer: dispatch each implementation/fix task to the `hunter` subagent — never a generic
  implementer.
- Start in a fresh git worktree under `.claude/worktrees/` on branch `feature/B14SenseAwareDedup`.
- Commit subject: `[B14SenseAwareDedup] feat: <imperative summary> (B14)` — no Co-Authored-By
  trailer, no attribution footer.
- **Do not touch `packages/app/src/domain/types.ts`.** `SavedWordEntry`/`SavedWordSense`/
  `SavedWordStatus` are the E1-ratified shape and stay byte-for-byte unchanged — this card only
  changes how `senses[]` grows, never its element shape or the entry's own shape. If a task in this
  plan seems to need a `types.ts` edit, stop; the design spec's §4.8 says this should never happen.
- **`saved.conflict` is a reply-only literal, never a request type.** Do not add it to
  `MessageTypeEnum` in `wire.ts` (that enum is only for the generic `ok:false` error reply's `type`
  field, keyed by the _original request's_ type, which stays `'saved.save'` for this whole flow).
- `bun run lint` and `bun run format:check` green before every commit; `cd packages/app && bun run
typecheck` green after every task that touches `packages/app`; `cd packages/extension-chrome && bun
run typecheck` green from Task 4 on.
- E2e builds clear the ambient key: `GEMINI_API_KEY= bun run build:chrome` (or
  `build:chrome:e2e`); never rely on shell state.
- UI reads only `--ad-*`/`--adp-*` tokens; no hard-coded colors; honor reduced-motion (no new
  animation is introduced by this card, so no new reduced-motion rule is required).
- S1/S4/constraint 4: not implicated by this card (no key, no model output, no LLM calls) — noted
  for completeness, nothing to enforce beyond what already exists.
- `.c3/` is CLI-only and this card changes no architecture — every touched file
  (`saved-words-policy.ts`, `wire.ts`, `router.ts`, `lookup-card.ts`, `side-panel-view.ts`,
  `content.ts`, `side-panel.ts`) already lives inside an onboarded C3 component (`c3-118`, `c3-103`,
  `c3-111`, `c3-117`, `c3-211`), and the one new file (`merge-prompt.ts`) is a plain addition inside
  the already-onboarded `c3-117 ui-components` boundary — no new component, no new port, so no C3
  change-unit is needed for this card.
- PR: title `[B14SenseAwareDedup] Sense-aware dedup on re-save`; body carries a written **"Testing
  performed"** section (no screenshots/video — owner ruling 2026-07-16). Merge: regular merge
  commit only — squash prohibited.

---

### Task 1: `saved-words-policy.ts` + wire + router — sense-aware `savedWordUpsert` end-to-end

> **Merged task.** `savedWordUpsert`'s return type changes from `Promise<SavedWordEntry>` to
> `Promise<SavedWordUpsertResult>`; its sole production caller is the router's `saved.save` case.
> Landing the domain change without the router change in the same commit fails `bun run
typecheck` — the same "they cannot typecheck apart → ONE task" law this repo already applies to
> wire+router pairs (CONTRACTS §2 / ROADMAP §8). Domain, wire, and router therefore land together
> in one task with one commit.

**Files:**

- Modify: `packages/app/src/domain/saved-words-policy.ts`
- Modify: `packages/app/test/saved-words-policy.test.ts`
- Modify: `packages/app/src/wire.ts`
- Modify: `packages/app/src/app/router.ts`
- Modify: `packages/app/test/wire-schema.test.ts`
- Modify: `packages/app/test/app/router.test.ts`
- Regenerate: `packages/app/wire-schema.snapshot.json`

**Interfaces:**

```ts
export type SavedWordUpsertResult =
  | { kind: 'saved'; entry: SavedWordEntry }
  | { kind: 'conflict'; senseCount: number };

export function savedWordUpsert(
  deps: SavedWordsDeps,
  input: SavedWordInput,
  opts?: { confirmNewSense?: boolean },
): Promise<SavedWordUpsertResult>;
```

```ts
// New optional field on the existing saved.save message:
{ type: 'saved.save', word: string, definition: string, translation: string, sentence: string,
  url: string, title: string, confirmNewSense?: boolean }
// New reply variant:
{ ok: true, type: 'saved.conflict', word: string, senseCount: number }
```

- [ ] **Step 1: Write the failing tests.** Replace the entire contents of
      `packages/app/test/saved-words-policy.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  savedWordUpsert,
  savedWordDelete,
  savedWordGet,
  savedWordsList,
  savedWordsClear,
  savedWordSetStatus,
  normalizeWordKey,
} from '../src/domain/saved-words-policy';
import type { Storage, SavedWordInput, SavedWordEntry, SavedWordsDeps } from '../src';

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

const input = (word: string, overrides: Partial<SavedWordInput> = {}): SavedWordInput => ({
  word,
  definition: `${word} definition`,
  translation: '',
  sentence: `a sentence with ${word}`,
  url: 'https://example.com/article',
  title: 'Example Article',
  ...overrides,
});

/** Test helper: call savedWordUpsert and unwrap the 'saved' branch, failing loudly if the call
 * instead returned a B14 conflict — every pre-B14 test path expects an outright write. */
async function upsertOk(
  deps: SavedWordsDeps,
  in_: SavedWordInput,
  opts?: { confirmNewSense?: boolean },
): Promise<SavedWordEntry> {
  const result = await savedWordUpsert(deps, in_, opts);
  if (result.kind !== 'saved') throw new Error(`expected 'saved', got '${result.kind}'`);
  return result.entry;
}

describe('saved-words-policy', () => {
  it('normalizeWordKey trims and lowercases', () => {
    expect(normalizeWordKey('  Bank ')).toBe('bank');
  });

  it('upsert creates a new entry: status learning, savedAt = now(), one sense', async () => {
    const s = memStorage();
    const entry = await upsertOk({ storage: s, now: () => 1000 }, input('Serendipity'));
    expect(entry).toEqual({
      word: 'Serendipity',
      status: 'learning',
      savedAt: 1000,
      senses: [
        {
          definition: 'Serendipity definition',
          translation: '',
          sentence: 'a sentence with Serendipity',
          url: 'https://example.com/article',
          title: 'Example Article',
        },
      ],
    });
    expect(await s.getItem('saved:serendipity')).toBe(JSON.stringify(entry));
  });

  it('upsert preserves a manually-set status (e.g. known) across an exact-duplicate re-save', async () => {
    const s = memStorage();
    await upsertOk({ storage: s, now: () => 1000 }, input('bank'));
    // Simulate a future B5 marking it known directly in storage (no B5 UI exists yet).
    const stored = JSON.parse((await s.getItem('saved:bank'))!) as { status: string };
    stored.status = 'known';
    await s.setItem('saved:bank', JSON.stringify(stored));
    // Same word, same sentence/url as the first save (input()'s defaults) — an exact-duplicate
    // no-op, not a conflict, so this still returns 'saved' with the preserved status.
    const again = await upsertOk({ storage: s, now: () => 3000 }, input('bank'));
    expect(again.status).toBe('known');
  });

  it('B14: a second upsert for the same word with a DIFFERENT sentence/url returns a conflict and writes nothing', async () => {
    const s = memStorage();
    await upsertOk({ storage: s, now: () => 1000 }, input('Bank', { definition: 'first' }));
    const before = await s.getItem('saved:bank');
    const result = await savedWordUpsert(
      { storage: s, now: () => 2000 },
      input('bank', {
        definition: 'second',
        sentence: 'a different sentence',
        url: 'https://other.example/',
      }),
    );
    expect(result).toEqual({ kind: 'conflict', senseCount: 1 });
    expect(await s.getItem('saved:bank')).toBe(before); // byte-identical — no write happened
  });

  it('B14: confirmNewSense:true appends a new sense, preserving savedAt/status, updating word casing', async () => {
    const s = memStorage();
    await upsertOk({ storage: s, now: () => 1000 }, input('Bank', { definition: 'first def' }));
    const entry = await upsertOk(
      { storage: s, now: () => 2000 },
      input('bank', {
        definition: 'second def',
        sentence: 'a different sentence',
        url: 'https://other.example/',
      }),
      { confirmNewSense: true },
    );
    expect(entry.savedAt).toBe(1000); // preserved from the first save
    expect(entry.status).toBe('learning');
    expect(entry.word).toBe('bank'); // latest casing wins for display
    expect(entry.senses).toHaveLength(2);
    expect(entry.senses[0]!.definition).toBe('first def'); // original sense untouched
    expect(entry.senses[1]!.definition).toBe('second def'); // appended, not replaced
  });

  it('B14: an exact sentence+url repeat is a silent no-op (kind:saved, unchanged entry, no write)', async () => {
    const s = memStorage();
    const first = await upsertOk(
      { storage: s, now: () => 1000 },
      input('bank', { definition: 'first' }),
    );
    const before = await s.getItem('saved:bank');
    const result = await savedWordUpsert(
      { storage: s, now: () => 2000 },
      input('bank', { definition: 'second' }),
    );
    expect(result).toEqual({ kind: 'saved', entry: first });
    expect(await s.getItem('saved:bank')).toBe(before); // byte-identical — no write happened
  });

  it('B14: a THIRD upsert after a decline (no confirmNewSense) still offers the conflict again, never accumulates silently', async () => {
    const s = memStorage();
    await upsertOk({ storage: s, now: () => 1000 }, input('bank'));
    const declined = await savedWordUpsert(
      { storage: s, now: () => 2000 },
      input('bank', { sentence: 'second sentence', url: 'https://second.example/' }),
    );
    expect(declined).toEqual({ kind: 'conflict', senseCount: 1 });
    const declinedAgain = await savedWordUpsert(
      { storage: s, now: () => 3000 },
      input('bank', { sentence: 'second sentence', url: 'https://second.example/' }),
    );
    expect(declinedAgain).toEqual({ kind: 'conflict', senseCount: 1 }); // still 1 — nothing was ever written
  });

  it('savedWordGet returns the stored entry (case-insensitively), or null on miss', async () => {
    const s = memStorage();
    await upsertOk({ storage: s, now: () => 1000 }, input('bank'));
    expect(await savedWordGet({ storage: s }, 'BANK')).not.toBeNull();
    expect(await savedWordGet({ storage: s }, 'ghost')).toBeNull();
  });

  it('savedWordDelete removes the entry and its index id; idempotent on unknown word', async () => {
    const s = memStorage();
    await upsertOk({ storage: s, now: () => 1000 }, input('bank'));
    await savedWordDelete({ storage: s }, 'BANK');
    expect(await s.getItem('saved:bank')).toBeNull();
    expect(await savedWordsList({ storage: s })).toEqual([]);
    await expect(savedWordDelete({ storage: s }, 'ghost')).resolves.toBeUndefined();
  });

  it('savedWordsList returns every saved entry', async () => {
    const s = memStorage();
    await upsertOk({ storage: s, now: () => 1000 }, input('bank'));
    await upsertOk({ storage: s, now: () => 2000 }, input('river'));
    const list = await savedWordsList({ storage: s });
    expect(list.map((e) => e.word).sort()).toEqual(['bank', 'river']);
  });

  it('savedWordsClear removes all saved:* keys and nothing else (scope fence)', async () => {
    const s = memStorage();
    await upsertOk({ storage: s, now: () => 1000 }, input('bank'));
    await s.setItem('history:x', '{}'); // unrelated keyspace must survive
    await savedWordsClear({ storage: s });
    expect(await savedWordsList({ storage: s })).toEqual([]);
    expect(await s.getItem('history:x')).toBe('{}');
  });

  it('savedWordSetStatus flips an existing entry to known, preserving senses/savedAt', async () => {
    const s = memStorage();
    const original = await upsertOk({ storage: s, now: () => 1000 }, input('bank'));
    const updated = await savedWordSetStatus({ storage: s }, 'bank', 'known');
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe('known');
    expect(updated!.savedAt).toBe(original.savedAt);
    expect(updated!.senses).toEqual(original.senses);
    expect(await s.getItem('saved:bank')).toBe(JSON.stringify(updated));
  });

  it('savedWordSetStatus is case-insensitive on the word key', async () => {
    const s = memStorage();
    await upsertOk({ storage: s, now: () => 1000 }, input('Bank'));
    const updated = await savedWordSetStatus({ storage: s }, 'BANK', 'known');
    expect(updated!.status).toBe('known');
  });

  it('savedWordSetStatus can flip back from known to learning', async () => {
    const s = memStorage();
    await upsertOk({ storage: s, now: () => 1000 }, input('bank'));
    await savedWordSetStatus({ storage: s }, 'bank', 'known');
    const back = await savedWordSetStatus({ storage: s }, 'bank', 'learning');
    expect(back!.status).toBe('learning');
  });

  it('savedWordSetStatus on an unsaved word is a no-op returning null (no throw)', async () => {
    const s = memStorage();
    await expect(savedWordSetStatus({ storage: s }, 'ghost', 'known')).resolves.toBeNull();
  });
});
```

Run: `cd packages/app && bunx vitest run test/saved-words-policy.test.ts`
Expected: failures — `savedWordUpsert` still returns a bare entry (not `{kind, entry}`), so
`upsertOk`'s `result.kind !== 'saved'` check throws on every call, and the two new conflict-shaped
assertions fail outright.

- [ ] **Step 2: Implement.** In `packages/app/src/domain/saved-words-policy.ts`, replace the whole
      file:

```ts
import type { Storage } from '../ports';
import type { SavedWordEntry, SavedWordSense, SavedWordStatus } from './types';

const INDEX_KEY = 'saved:index';

export interface SavedWordsDeps {
  storage: Storage;
  /** Wall clock for `savedAt`; injectable so tests control it (ref-dependency-injection). */
  now?: () => number;
}

/** The input a caller supplies to upsert one saved word — everything EXCEPT the policy-owned
 * `status`/`savedAt` fields (defaulted/preserved by savedWordUpsert itself). */
export interface SavedWordInput {
  word: string;
  definition: string;
  translation: string;
  sentence: string;
  url: string;
  title: string;
}

/** `word` is the case-insensitive unique key (B1's ratified schema). Trim + lowercase so
 * "Bank" and "bank" collide on the same storage entry. */
export function normalizeWordKey(word: string): string {
  return word.trim().toLowerCase();
}

async function readIndex(s: Storage): Promise<string[]> {
  const raw = await s.getItem(INDEX_KEY);
  return raw ? (JSON.parse(raw) as string[]) : [];
}

/**
 * B14: the outcome of a savedWordUpsert call. `'saved'` means a write happened (or an
 * exact-duplicate sense made a write unnecessary — either way the caller's payload is now
 * reflected in `entry`). `'conflict'` means the word is already saved under a DIFFERENT
 * sentence/url and NOTHING was written — the caller must re-call with `confirmNewSense: true`
 * to append, or do nothing (decline = no write, roadmap B14 fence).
 */
export type SavedWordUpsertResult =
  | { kind: 'saved'; entry: SavedWordEntry }
  | { kind: 'conflict'; senseCount: number };

/**
 * Create or update the saved entry for `input.word`. A brand-new word gets
 * `status: 'learning'` and `savedAt: now()`. An existing entry (same normalized key):
 *  - an EXACT sentence+url repeat of an already-stored sense is a silent no-op (idempotent,
 *    returns the unchanged entry, no write, no confirmation needed);
 *  - a genuinely different sentence/url needs `opts.confirmNewSense: true` to append — without
 *    it, this returns `{kind:'conflict', senseCount}` and writes nothing (B14: sense-aware
 *    dedup — see the design spec for the full merge-prompt UX this return shape drives).
 */
export async function savedWordUpsert(
  deps: SavedWordsDeps,
  input: SavedWordInput,
  opts: { confirmNewSense?: boolean } = {},
): Promise<SavedWordUpsertResult> {
  const key = normalizeWordKey(input.word);
  const now = deps.now ?? Date.now;
  const existingRaw = await deps.storage.getItem(`saved:${key}`);
  const existing = existingRaw ? (JSON.parse(existingRaw) as SavedWordEntry) : null;
  const sense: SavedWordSense = {
    definition: input.definition,
    translation: input.translation,
    sentence: input.sentence,
    url: input.url,
    title: input.title,
  };

  if (existing) {
    const isDuplicate = existing.senses.some(
      (s) => s.sentence === sense.sentence && s.url === sense.url,
    );
    if (isDuplicate) return { kind: 'saved', entry: existing };

    if (opts.confirmNewSense !== true) {
      return { kind: 'conflict', senseCount: existing.senses.length };
    }

    const entry: SavedWordEntry = {
      ...existing,
      word: input.word, // latest casing wins for display — same rule every prior write already used
      senses: [...existing.senses, sense],
    };
    await deps.storage.setItem(`saved:${key}`, JSON.stringify(entry));
    return { kind: 'saved', entry };
  }

  const entry: SavedWordEntry = {
    word: input.word,
    status: 'learning',
    savedAt: now(),
    senses: [sense],
  };
  await deps.storage.setItem(`saved:${key}`, JSON.stringify(entry));
  const idx = [key, ...(await readIndex(deps.storage))];
  await deps.storage.setItem(INDEX_KEY, JSON.stringify(idx));
  return { kind: 'saved', entry };
}

/** Idempotent: removing an unknown word is a no-op, matching historyDelete's contract. */
export async function savedWordDelete(deps: SavedWordsDeps, word: string): Promise<void> {
  const key = normalizeWordKey(word);
  await deps.storage.removeItem(`saved:${key}`);
  const idx = (await readIndex(deps.storage)).filter((k) => k !== key);
  await deps.storage.setItem(INDEX_KEY, JSON.stringify(idx));
}

/**
 * B5: manually flip an existing saved word's status between 'learning' (default) and 'known'.
 * Exactly 2 states, no auto-promotion (roadmap B5 scope fence) — this is the only place status
 * ever changes after the initial save/re-save (savedWordUpsert preserves it). No-op (returns
 * null) when the word isn't currently saved — the toggle only ever renders on an already-saved
 * word's own surface, so this guards a race (e.g. deleted between render and click), not the
 * expected path.
 */
export async function savedWordSetStatus(
  deps: SavedWordsDeps,
  word: string,
  status: SavedWordStatus,
): Promise<SavedWordEntry | null> {
  const key = normalizeWordKey(word);
  const raw = await deps.storage.getItem(`saved:${key}`);
  if (!raw) return null;
  const existing = JSON.parse(raw) as SavedWordEntry;
  const entry: SavedWordEntry = { ...existing, status };
  await deps.storage.setItem(`saved:${key}`, JSON.stringify(entry));
  return entry;
}

export async function savedWordGet(
  deps: SavedWordsDeps,
  word: string,
): Promise<SavedWordEntry | null> {
  const raw = await deps.storage.getItem(`saved:${normalizeWordKey(word)}`);
  return raw ? (JSON.parse(raw) as SavedWordEntry) : null;
}

/** Newest-saved-first (mirrors historyList's index order). Full list, no pagination — B6 (Words
 * page) is the future consumer; B1 ships the primitive, not pagination (no callers need it yet). */
export async function savedWordsList(deps: SavedWordsDeps): Promise<SavedWordEntry[]> {
  const idx = await readIndex(deps.storage);
  const out: SavedWordEntry[] = [];
  for (const key of idx) {
    const raw = await deps.storage.getItem(`saved:${key}`);
    if (raw) out.push(JSON.parse(raw) as SavedWordEntry);
  }
  return out;
}

/** Removes every `saved:*` key including the index. Never called by historyClear/cacheClear —
 * saved words are an independent keyspace (roadmap B1 scope fence). */
export async function savedWordsClear(deps: SavedWordsDeps): Promise<void> {
  for (const k of await deps.storage.keys('saved:')) await deps.storage.removeItem(k);
}
```

Run: `cd packages/app && bunx vitest run test/saved-words-policy.test.ts`
Expected: all tests pass (15 total).

- [ ] **Step 3: Write the failing wire tests.** In `packages/app/test/wire-schema.test.ts`, inside the
      existing `describe('saved.save / saved.delete wire messages (B1)', ...)` block
      (`wire-schema.test.ts:412-497`), add these tests right after the existing
      `'accepts a valid saved.save message'` test (after line 425, before
      `'rejects a saved.save message missing a required field'`):

```ts
it('accepts a saved.save message with confirmNewSense:true (B14)', () => {
  const parsed = WireMessageSchema.safeParse({
    type: 'saved.save',
    ...senseFields,
    confirmNewSense: true,
  });
  expect(parsed.success).toBe(true);
});

it('rejects a saved.save message with a non-boolean confirmNewSense (B14)', () => {
  const parsed = WireMessageSchema.safeParse({
    type: 'saved.save',
    ...senseFields,
    confirmNewSense: 'yes',
  });
  expect(parsed.success).toBe(false);
});
```

And add these tests right after the existing
`'rejects an invalid status value inside a saved reply entry'` test (after line 469, before
`'accepts a valid saved.setStatus message (B5)'`):

```ts
it('accepts a saved.conflict reply (B14)', () => {
  const parsed = WireReplySchema.safeParse({
    ok: true,
    type: 'saved.conflict',
    word: 'bank',
    senseCount: 1,
  });
  expect(parsed.success).toBe(true);
});

it('rejects a saved.conflict reply missing senseCount, or with a non-numeric one (B14)', () => {
  expect(
    WireReplySchema.safeParse({ ok: true, type: 'saved.conflict', word: 'bank' }).success,
  ).toBe(false);
  expect(
    WireReplySchema.safeParse({
      ok: true,
      type: 'saved.conflict',
      word: 'bank',
      senseCount: 'one',
    }).success,
  ).toBe(false);
});
```

Run: `cd packages/app && bunx vitest run test/wire-schema.test.ts`
Expected: 4 new failures (the schema doesn't know `confirmNewSense` or `saved.conflict` yet — note
`z.strictObject`/plain `z.object` with an unrecognized literal `type` fails `WireMessageSchema`'s
discriminated union match entirely, and `saved.conflict` has no matching arm in `WireReplySchema`
yet); the JSON-schema snapshot test also now needs regeneration once the schema changes (Step 5).

- [ ] **Step 4: Implement.** In `packages/app/src/wire.ts`:
  1. Add `confirmNewSense` to the `saved.save` arm (`wire.ts:111-119`):

```ts
  // B1: save/unsave a word into the independent `saved:*` keyspace. Sent by the card's star
  // button (via the composition root) or the side panel's own toggle-save listener.
  z.object({
    type: z.literal('saved.save'),
    word: z.string(),
    definition: z.string(),
    translation: z.string(),
    sentence: z.string(),
    url: z.string(),
    title: z.string(),
    // B14: explicit confirmation to append this context as a NEW sense on an already-saved
    // headword, after a prior saved.save reply signalled `type: 'saved.conflict'`. Absent/false
    // on every normal first-attempt save (including a brand-new word, or an exact sentence+url
    // repeat, which the router treats as a no-op, not a conflict).
    confirmNewSense: z.boolean().optional(),
  }),
```

2. Add a new reply arm to `WireReplySchema` (`wire.ts:160-189`), right after the existing `saved`
   arm:

```ts
  z.object({ ok: z.literal(true), type: z.literal('saved'), entry: SavedWordEntrySchema }),
  // B14: returned instead of `saved` when `word` already has a saved entry with a DIFFERENT
  // sentence+url than the incoming payload and confirmNewSense wasn't set — NO write happened.
  // The caller must re-send saved.save with confirmNewSense:true to append, or do nothing
  // (decline = no write, roadmap B14 fence).
  z.object({
    ok: z.literal(true),
    type: z.literal('saved.conflict'),
    word: z.string(),
    senseCount: z.number(),
  }),
```

(Leave `MessageTypeEnum` at `wire.ts:143-158` untouched — `saved.conflict` is a reply-only
literal, never a request `type`, per the plan's Global Constraints.)

Run: `cd packages/app && bunx vitest run test/wire-schema.test.ts -t "B14"`
Expected: the 4 new B14 tests pass. The snapshot test (`'JSON-schema snapshot is stable'`) now
fails — expected, fixed in Step 5.

- [ ] **Step 5: Regenerate the JSON-schema snapshot.**

```
cd packages/app && bunx vitest run test/wire-schema.test.ts -u
```

This rewrites `packages/app/wire-schema.snapshot.json` to include `confirmNewSense` and
`saved.conflict`. Then confirm it's now stable:

```
cd packages/app && bunx vitest run test/wire-schema.test.ts
```

Expected: all tests pass, including the snapshot test (no `-u` needed this second run).

- [ ] **Step 6: Update the router.** In `packages/app/src/app/router.ts`, replace the `saved.save`
      case (`router.ts:242-257`):

```ts
      case 'saved.save': {
        const result = await deps.queue.run(() =>
          savedWordUpsert(
            { storage: deps.kv },
            {
              word: msg.word,
              definition: msg.definition,
              translation: msg.translation,
              sentence: msg.sentence,
              url: msg.url,
              title: msg.title,
            },
            { confirmNewSense: msg.confirmNewSense === true },
          ),
        );
        return result.kind === 'conflict'
          ? { ok: true, type: 'saved.conflict', word: msg.word, senseCount: result.senseCount }
          : { ok: true, type: 'saved', entry: result.entry };
      }
```

- [ ] **Step 7: Write the failing router tests.** In `packages/app/test/app/router.test.ts`,
      replace the existing test
      `'a second saved.save for the same word (different casing) preserves savedAt, replaces senses'`
      (`router.test.ts:474-500`) with:

```ts
it('B14: a second saved.save for the same word with a DIFFERENT sentence replies saved.conflict and writes nothing', async () => {
  const d = deps();
  const route = buildRouter(d);
  await route({
    type: 'saved.save',
    word: 'Bank',
    definition: 'first def',
    translation: '',
    sentence: 's1',
    url: 'u1',
    title: 't1',
  });
  const before = await d.kv.getItem('saved:bank');
  const reply = await route({
    type: 'saved.save',
    word: 'bank',
    definition: 'second def',
    translation: '',
    sentence: 's2',
    url: 'u2',
    title: 't2',
  });
  expect(reply).toMatchObject({ ok: true, type: 'saved.conflict', word: 'bank', senseCount: 1 });
  expect(await d.kv.getItem('saved:bank')).toBe(before); // byte-identical — no write happened
});

it('B14: confirmNewSense:true appends a second sense, preserving savedAt', async () => {
  const d = deps();
  const route = buildRouter(d);
  const first = await route({
    type: 'saved.save',
    word: 'Bank',
    definition: 'first def',
    translation: '',
    sentence: 's1',
    url: 'u1',
    title: 't1',
  });
  const firstSavedAt = (first as { entry: { savedAt: number } }).entry.savedAt;
  const reply = await route({
    type: 'saved.save',
    word: 'bank',
    definition: 'second def',
    translation: '',
    sentence: 's2',
    url: 'u2',
    title: 't2',
    confirmNewSense: true,
  });
  const entry = (reply as { entry: { savedAt: number; senses: unknown[] } }).entry;
  expect(entry.savedAt).toBe(firstSavedAt);
  expect(entry.senses).toHaveLength(2);
  expect((entry.senses[1] as { definition: string }).definition).toBe('second def');
});

it('B14: a saved.save with the EXACT same sentence+url as an existing sense is a silent no-op (still replies saved)', async () => {
  const d = deps();
  const route = buildRouter(d);
  await route({
    type: 'saved.save',
    word: 'bank',
    definition: 'first def',
    translation: '',
    sentence: 's1',
    url: 'u1',
    title: 't1',
  });
  const reply = await route({
    type: 'saved.save',
    word: 'bank',
    definition: 'second def', // different definition text, but SAME sentence+url — a duplicate
    translation: '',
    sentence: 's1',
    url: 'u1',
    title: 't1',
  });
  expect(reply).toMatchObject({
    ok: true,
    type: 'saved',
    entry: { senses: [{ definition: 'first def' }] }, // unchanged — the "second def" write never happened
  });
});
```

Run: `cd packages/app && bunx vitest run test/app/router.test.ts`
Expected: the 3 new B14 tests fail against the OLD router (still replies `type:'saved'` with
replaced senses for the different-sentence case) until Step 6's router change lands; since Step 6
is already applied above, run this AFTER Step 6 and expect all pass. (If following strict red-green
ordering, run this file's tests once before Step 6 to confirm the 3 new tests fail against the old
router — `git stash` the Step 6 router.ts edit temporarily, run, then `git stash pop` — a
convenience note, not a hard requirement given Step 6 is small and already reviewed above.)

Expected (after Step 6): all tests in `router.test.ts` pass, including the 3 new B14 tests and the
`'saved.save persists a new entry'`, `'saved.delete removes the entry'`, and
`'history.clear and cache.clear never touch saved:*'` tests unchanged from before.

- [ ] **Step 8: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd .. && cd .. && bun run lint && bun run format:check
```

Commit:

```
git add packages/app/src/domain/saved-words-policy.ts packages/app/test/saved-words-policy.test.ts packages/app/src/wire.ts packages/app/src/app/router.ts packages/app/test/wire-schema.test.ts packages/app/test/app/router.test.ts packages/app/wire-schema.snapshot.json
git commit -m "[B14SenseAwareDedup] feat: sense-aware dedup — upsert conflict result + wire/router (B14)"
```

---

### Task 2: `merge-prompt.ts` — the "Add as new sense?" UI helper

**Files:**

- Create: `packages/app/src/ui/merge-prompt.ts`
- Create: `packages/app/test/ui/merge-prompt.test.ts`
- Modify: `packages/app/src/index.ts`

**Interfaces:**

```ts
export function buildMergePrompt(opts: {
  word: string;
  senseCount: number;
  onChoice: (add: boolean) => void;
}): HTMLElement;
```

- [ ] **Step 1: Write the failing test.** Create `packages/app/test/ui/merge-prompt.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { buildMergePrompt } from '../../src/ui/merge-prompt';

describe('buildMergePrompt', () => {
  it('renders "Add as new sense" and "Not now" buttons and fires the callback with the choice', () => {
    const onChoice = vi.fn();
    const node = buildMergePrompt({ word: 'bank', senseCount: 1, onChoice });
    const buttons = node.querySelectorAll('button');
    expect(buttons).toHaveLength(2);
    expect(buttons[0]!.textContent).toBe('Add as new sense');
    expect(buttons[1]!.textContent).toBe('Not now');
    (buttons[0] as HTMLButtonElement).click();
    expect(onChoice).toHaveBeenCalledWith(true);
    (buttons[1] as HTMLButtonElement).click();
    expect(onChoice).toHaveBeenCalledWith(false);
  });

  it('uses singular copy for senseCount:1 and plural copy for senseCount > 1', () => {
    const one = buildMergePrompt({ word: 'bank', senseCount: 1, onChoice: () => undefined });
    expect(one.textContent).toContain('a different sentence');
    const two = buildMergePrompt({ word: 'bank', senseCount: 2, onChoice: () => undefined });
    expect(two.textContent).toContain('already has 2 saved senses');
  });

  it('interpolates the word into the prompt copy', () => {
    const node = buildMergePrompt({
      word: 'serendipity',
      senseCount: 1,
      onChoice: () => undefined,
    });
    expect(node.textContent).toContain('serendipity');
  });
});
```

Run: `cd packages/app && bunx vitest run test/ui/merge-prompt.test.ts`
Expected: failure — `src/ui/merge-prompt.ts` does not exist yet (module not found).

- [ ] **Step 2: Implement.** Create `packages/app/src/ui/merge-prompt.ts`:

```ts
/**
 * B14: the "add as a new sense?" merge prompt, appended on demand to the card/panel when a
 * saved.save reply comes back `type: 'saved.conflict'` (the headword is already saved under a
 * DIFFERENT sentence/url than the one just submitted — see the design spec §2.1/§2.4). Mirrors
 * error-consent.ts's buildConsentFooter: a light-DOM node appended via
 * InlineBottomSheetRenderer.appendToCard / SidePanelView.appendToFocus, never baked into
 * CardState/renderCardState, so the pure card-state renderer stays untouched.
 */
export function buildMergePrompt(opts: {
  word: string;
  senseCount: number;
  onChoice: (add: boolean) => void;
}): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'merge-prompt';

  const text = document.createElement('p');
  text.className = 'merge-prompt-text';
  text.textContent =
    opts.senseCount === 1
      ? `You already saved "${opts.word}" from a different sentence. Add this as a new sense?`
      : `"${opts.word}" already has ${opts.senseCount} saved senses. Add this one too?`;
  wrap.appendChild(text);

  const row = document.createElement('div');
  row.className = 'merge-prompt-actions';

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'merge-prompt-add';
  add.textContent = 'Add as new sense';
  add.addEventListener('click', () => opts.onChoice(true));

  const not = document.createElement('button');
  not.type = 'button';
  not.className = 'merge-prompt-dismiss';
  not.textContent = 'Not now';
  not.addEventListener('click', () => opts.onChoice(false));

  row.append(add, not);
  wrap.appendChild(row);
  return wrap;
}
```

Add the barrel export to `packages/app/src/index.ts`, right after the existing
`export { buildConsentFooter } from './ui/error-consent';` line:

```ts
export { buildMergePrompt } from './ui/merge-prompt';
```

Run: `cd packages/app && bunx vitest run test/ui/merge-prompt.test.ts`
Expected: all 3 tests pass.

- [ ] **Step 3: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd .. && cd .. && bun run lint && bun run format:check
```

Commit:

```
git add packages/app/src/ui/merge-prompt.ts packages/app/test/ui/merge-prompt.test.ts packages/app/src/index.ts
git commit -m "[B14SenseAwareDedup] feat: buildMergePrompt UI helper (B14)"
```

---

### Task 3: `side-panel-view.ts` — `appendToFocus` + merge-prompt CSS

**Files:**

- Modify: `packages/app/src/ui/side-panel-view.ts`
- Modify: `packages/app/test/ui/side-panel-view.test.ts`

**Interfaces:**

```ts
class SidePanelView extends HTMLElement {
  appendToFocus(node: Node): boolean;
}
```

- [ ] **Step 1: Write the failing test.** Append to
      `packages/app/test/ui/side-panel-view.test.ts`, inside the existing
      `describe('<side-panel-view>', ...)` block, just before its closing `});`:

```ts
it('B14: appendToFocus appends a node into the focus region when a result is showing; false on the empty state', () => {
  const el = mount();
  const extra = document.createElement('div');
  extra.textContent = 'merge prompt';
  expect(el.appendToFocus(extra)).toBe(false); // still on the empty teaching state
  el.focusState = {
    kind: 'result',
    safeHtml: safe('<p>ok</p>'),
    word: 'bank',
    target: 'vi',
  };
  expect(el.appendToFocus(extra)).toBe(true);
  expect(el.shadowRoot!.querySelector('.focus')!.contains(extra)).toBe(true);
});
```

Run: `cd packages/app && bunx vitest run test/ui/side-panel-view.test.ts`
Expected: failure — `appendToFocus` is not a function on `SidePanelView`.

- [ ] **Step 2: Implement.** In `packages/app/src/ui/side-panel-view.ts`:
  1. Add the CSS rules right after the existing
     `.focus .save-btn[aria-pressed="true"] svg{...}` line and its reduced-motion block
     (`side-panel-view.ts:67-68`):

```css
.focus .merge-prompt {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0 0 10px;
  padding: 10px 12px;
  border: 1px solid var(--ad-line-strong);
  border-radius: var(--adp-radius-control);
  background: var(--ad-surface-raised);
}
.focus .merge-prompt-text {
  margin: 0;
  font-size: var(--adp-text-xs);
  color: var(--ad-ink);
}
.focus .merge-prompt-actions {
  display: flex;
  gap: 8px;
}
.focus .merge-prompt-add {
  flex: none;
  border: 1px solid var(--ad-accent);
  background: var(--ad-accent);
  color: var(--ad-on-accent);
  border-radius: var(--adp-radius-control);
  padding: 5px 12px;
  font: inherit;
  font-size: var(--adp-text-xs);
  font-weight: var(--adp-weight-semi);
  cursor: pointer;
}
.focus .merge-prompt-add:hover {
  filter: brightness(1.06);
}
.focus .merge-prompt-add:focus-visible {
  outline: 2px solid var(--ad-accent);
  outline-offset: 2px;
}
.focus .merge-prompt-dismiss {
  flex: none;
  border: 1px solid var(--ad-line);
  background: transparent;
  color: var(--ad-ink-soft);
  border-radius: var(--adp-radius-control);
  padding: 5px 12px;
  font: inherit;
  font-size: var(--adp-text-xs);
  cursor: pointer;
}
.focus .merge-prompt-dismiss:hover {
  background: var(--ad-surface-raised);
  color: var(--ad-ink);
}
.focus .merge-prompt-dismiss:focus-visible {
  outline: 2px solid var(--ad-accent);
  outline-offset: 2px;
}
```

2. Add the new public method to the `SidePanelView` class, directly after the private
   `renderFocus()` method (`side-panel-view.ts:190-193`):

```ts
  /**
   * B14: append an extra light-DOM node (the sense-merge prompt) into the panel's focus region
   * without a full re-render. Mirrors InlineBottomSheetRenderer.appendToCard's contract exactly
   * — false when the focus region isn't currently showing a result (nothing sensible to append
   * to; also guards against appending before connectedCallback has built focusEl).
   */
  appendToFocus(node: Node): boolean {
    if (this._focus.kind !== 'result') return false;
    this.focusEl.append(node);
    return true;
  }
```

Run: `cd packages/app && bunx vitest run test/ui/side-panel-view.test.ts`
Expected: all tests pass (existing + the new B14 test).

- [ ] **Step 3: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd .. && cd .. && bun run lint && bun run format:check
```

Commit:

```
git add packages/app/src/ui/side-panel-view.ts packages/app/test/ui/side-panel-view.test.ts
git commit -m "[B14SenseAwareDedup] feat: SidePanelView.appendToFocus + merge-prompt CSS (B14)"
```

---

### Task 4: `lookup-card.ts` CSS + `content.ts` — card-side merge-prompt wiring

**Files:**

- Modify: `packages/app/src/ui/lookup-card.ts`
- Modify: `packages/extension-chrome/src/content.ts`

No dedicated unit test exists for `content.ts` in this repo — it is a composition root, covered by
e2e only (same precedent as C2's `options.ts` and B5's own `content.ts` edits). `lookup-card.ts`'s
change here is CSS-only (no new exported function, no new `CardState` field), so it needs no new
unit test either — Task 6's e2e visually/structurally exercises both files together. Run the
typecheck/lint gate below so a regression elsewhere in either file is still caught immediately.

- [ ] **Step 1: Implement the CSS.** In `packages/app/src/ui/lookup-card.ts`:
  1. In the shadow `CSS` template literal, add a new line right after the existing
     `::slotted(.nudge-row){...}` rule (`lookup-card.ts:139`, currently the last line before the
     closing backtick):

```ts
const CSS = `:host{${BASE_VARS};display:block;box-sizing:border-box;width:100%;max-width:var(--adp-card-width);margin:0 auto;font:var(--adp-text-body)/var(--adp-leading-body) var(--adp-font-sans);color:var(--ad-ink);background:var(--ad-glow),var(--ad-surface);border-radius:var(--adp-radius-card);box-shadow:var(--ad-shadow-card);overflow:hidden;color-scheme:light}
${THEME_CSS}
::selection{background:var(--ad-selection)}
/* The 3px spruce→clay accent strip replaces the old festive rainbow ribbon: one quiet sweep,
   clipped by the card's 18px radius. Decorative — aria-hidden on the element. */
.accent{height:3px;background:linear-gradient(90deg,var(--ad-accent),var(--ad-warm) 92%)}
/* One consistent 22px horizontal gutter on bar, body region and footer (§5.11) so the brand
   mark, headword, body text and footer line all share the same left edge and an equal right
   margin — mirrors the reference .ad-card__bar/.ad-body-region/.ad-footer padding. */
.bar{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:14px 22px 6px}
.brand{display:inline-flex;align-items:center;gap:7px;font-size:var(--adp-text-xs);font-weight:var(--adp-weight-bold);letter-spacing:var(--adp-tracking-label);color:var(--ad-accent-ink)}
.mark{width:21px;height:21px;flex:none}
.actions{display:inline-flex;align-items:center;gap:4px}
button[data-act]{display:inline-grid;place-items:center;height:var(--adp-action-size);width:var(--adp-action-size);border:0;background:transparent;color:var(--ad-ink-faint);border-radius:var(--adp-radius-control);cursor:pointer;font:inherit;transition:background var(--adp-dur-fast) var(--adp-ease),color var(--adp-dur-fast) var(--adp-ease)}
button[data-act]:hover{background:var(--ad-surface-raised);color:var(--ad-ink)}
button[data-act]:focus-visible{outline:2px solid var(--ad-accent);outline-offset:2px}
button[data-act] svg{pointer-events:none;flex:none}
/* Close stays a bare icon — its X is universally understood and keeps the right-most spot. */
button[data-act="close"] svg{width:14px;height:14px}
button[data-act="side-panel"] svg{width:15px;height:15px}
/* Settings is the labeled .text variant: gear + the word "Settings", widened, hover-fill like
   the other icon buttons. The visible word removes the icon ambiguity with Close. */
button[data-act="settings"]{display:inline-flex;align-items:center;gap:5px;width:auto;padding:0 11px 0 9px;font-size:var(--adp-text-xs);font-weight:var(--adp-weight-semi);letter-spacing:.01em}
button[data-act="settings"] svg{width:15px;height:15px}
button[data-act="settings"] .lbl{line-height:1}
@media (prefers-reduced-motion:reduce){button[data-act]{transition:none}}
.region{padding:2px 22px 2px}
.footer{display:flex;align-items:center;gap:6px;margin:8px 22px 0;padding:10px 0 13px;border-top:1px solid var(--ad-line);font-size:var(--adp-text-2xs);color:var(--ad-ink-faint)}
.footer svg{width:13px;height:13px;flex:none}
/* The signature headword: one serif (Georgia), with a 44×3px spruce→clay underline swatch —
   reads like a dictionary entry's rule. Georgia is the ONLY serif on the surface. */
::slotted(h2){font-family:var(--adp-font-serif);font-size:var(--adp-text-headword);line-height:var(--adp-leading-tight);letter-spacing:var(--adp-tracking-head);margin:.1em 0 .4em;color:var(--ad-ink);display:inline-block;max-width:100%;overflow-wrap:anywhere;padding-bottom:5px;background:linear-gradient(90deg,var(--ad-accent),var(--ad-warm)) left bottom/44px 3px no-repeat}
::slotted(.err){color:var(--ad-error);font-weight:500}
::slotted(.mark){display:block !important;width:34px !important;height:34px !important;margin:16px auto 2px !important}
::slotted(.setup-title){text-align:center !important;margin:8px 0 0 !important;font-size:var(--adp-text-lg) !important;font-weight:var(--adp-weight-bold) !important;color:var(--ad-ink) !important}
::slotted(.setup-text){text-align:center !important;margin:6px auto 0 !important;max-width:32ch !important;font-size:13.5px !important;line-height:1.55 !important;color:var(--ad-ink-soft) !important}
::slotted(.setup-cta){display:block !important;margin:15px auto 6px !important;padding:9px 18px !important;border:0 !important;border-radius:var(--adp-radius-control) !important;background:var(--ad-accent) !important;color:var(--ad-on-accent) !important;font:inherit !important;font-size:var(--adp-text-sm) !important;font-weight:var(--adp-weight-semi) !important;text-align:center !important;cursor:pointer !important}
::slotted(.setup-cta:hover){filter:brightness(1.06)}
::slotted(.setup-cta:focus-visible){outline:2px solid var(--ad-accent) !important;outline-offset:2px !important}
@keyframes spin{to{transform:rotate(360deg)}}
::slotted(.loadrow){display:flex;align-items:center;gap:9px;margin:4px 0 9px;color:var(--ad-ink-soft);font-size:14px}
::slotted(.loadrow)::before{content:"";display:block;width:15px;height:15px;flex:none;border:2px solid var(--ad-line);border-top-color:var(--ad-accent);border-radius:50%;animation:spin .77s linear infinite}
@media (prefers-reduced-motion:reduce){::slotted(.loadrow)::before{animation:none}}
::slotted(.errlog-consent){margin:10px 16px 0;padding-top:10px;border-top:1px solid var(--ad-line);font-size:var(--adp-text-2xs);color:var(--ad-ink-soft)}
/* The result metadata row (provider badge + fallback note + one-shot picker). Only the row is a
   direct slotted child, so ::slotted sets its layout + the color/font its children inherit; the
   children's own box decorations live in CARD_DOC_CSS (::slotted cannot reach a slotted node's
   descendants). */
::slotted(.meta-row){display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:9px 0 0;font-size:var(--adp-text-2xs);color:var(--ad-ink-faint)}
::slotted(.defined-as){display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:2px 0 8px;font-size:var(--adp-text-2xs);color:var(--ad-ink-soft)}
::slotted(.save-row){display:flex;margin:6px 0 10px}
::slotted(.nudge-row){display:flex;align-items:center;gap:8px;margin:0 0 10px;padding:7px 10px;border:1px solid var(--ad-accent);border-radius:var(--adp-radius-control);background:var(--ad-surface-raised)}
::slotted(.merge-prompt){display:flex;flex-direction:column;gap:8px;margin:0 0 10px;padding:10px 12px;border:1px solid var(--ad-line-strong);border-radius:var(--adp-radius-control);background:var(--ad-surface-raised)}`;
```

2. In `CARD_DOC_CSS`, add these lines right after the existing
   `lookup-card .nudge-row__dismiss-btn:focus-visible{...}` rule (`lookup-card.ts:180`, currently
   the last line before the closing backtick):

```ts
const CARD_DOC_CSS = `@keyframes spin{to{transform:rotate(360deg)}}
lookup-card .prov-badge{border:1px solid var(--ad-line);border-radius:var(--adp-radius-control);padding:1px 8px;color:var(--ad-ink-soft)}
lookup-card .fallback-note{font-style:italic;color:var(--ad-ink-faint)}
lookup-card .prov-switch{margin-left:auto;border:1px solid var(--ad-line);background:transparent;color:var(--ad-ink-soft);border-radius:var(--adp-radius-control);padding:2px 10px;font:inherit;font-size:var(--adp-text-2xs);cursor:pointer}
lookup-card .prov-switch:hover{background:var(--ad-surface-raised);color:var(--ad-ink)}
lookup-card .prov-switch:focus-visible{outline:2px solid var(--ad-accent);outline-offset:2px}
lookup-card .prov-menu{display:flex;flex-wrap:wrap;gap:5px;width:100%;margin-top:2px}
lookup-card .prov-menu[hidden]{display:none}
lookup-card .prov-menu [role=option]{border:1px solid var(--ad-line);background:var(--ad-surface);color:var(--ad-ink-soft);border-radius:var(--adp-radius-control);padding:2px 10px;font:inherit;font-size:var(--adp-text-2xs);cursor:pointer}
lookup-card .prov-menu [role=option]:hover:not([disabled]){background:var(--ad-surface-raised);color:var(--ad-ink)}
lookup-card .prov-menu [role=option]:focus-visible{outline:2px solid var(--ad-accent);outline-offset:2px}
lookup-card .prov-menu [role=option][disabled]{opacity:.55;cursor:default}
lookup-card .defined-as__label{font-style:italic}
lookup-card .defined-as__literal-btn{border:1px solid var(--ad-line);background:transparent;color:var(--ad-ink-soft);border-radius:var(--adp-radius-control);padding:2px 10px;font:inherit;font-size:var(--adp-text-2xs);cursor:pointer}
lookup-card .defined-as__literal-btn:hover{background:var(--ad-surface-raised);color:var(--ad-ink)}
lookup-card .defined-as__literal-btn:focus-visible{outline:2px solid var(--ad-accent);outline-offset:2px}
lookup-card .save-btn{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--ad-line);background:transparent;color:var(--ad-ink-soft);border-radius:var(--adp-radius-control);padding:5px 12px;font:inherit;font-size:var(--adp-text-xs);font-weight:var(--adp-weight-semi);cursor:pointer;transition:background var(--adp-dur-fast) var(--adp-ease),color var(--adp-dur-fast) var(--adp-ease),border-color var(--adp-dur-fast) var(--adp-ease)}
lookup-card .save-btn svg{width:15px;height:15px;pointer-events:none;fill:none;stroke:currentColor}
lookup-card .save-btn:hover{background:var(--ad-surface-raised);color:var(--ad-ink)}
lookup-card .save-btn:focus-visible{outline:2px solid var(--ad-accent);outline-offset:2px}
lookup-card .save-btn[aria-pressed="true"]{border-color:var(--ad-accent);color:var(--ad-accent-ink)}
lookup-card .save-btn[aria-pressed="true"] svg{fill:var(--ad-accent);stroke:var(--ad-accent)}
@media (prefers-reduced-motion:reduce){lookup-card .save-btn{transition:none}}
lookup-card .status-btn{display:inline-flex;align-items:center;margin-left:8px;border:1px solid var(--ad-line);background:transparent;color:var(--ad-ink-soft);border-radius:var(--adp-radius-control);padding:5px 12px;font:inherit;font-size:var(--adp-text-xs);font-weight:var(--adp-weight-semi);cursor:pointer;transition:background var(--adp-dur-fast) var(--adp-ease),color var(--adp-dur-fast) var(--adp-ease),border-color var(--adp-dur-fast) var(--adp-ease)}
lookup-card .status-btn:hover{background:var(--ad-surface-raised);color:var(--ad-ink)}
lookup-card .status-btn:focus-visible{outline:2px solid var(--ad-accent);outline-offset:2px}
lookup-card .status-btn[aria-pressed="true"]{border-color:var(--ad-accent);color:var(--ad-accent-ink)}
@media (prefers-reduced-motion:reduce){lookup-card .status-btn{transition:none}}
lookup-card .nudge-row__text{flex:1 1 auto;min-width:0;font-size:var(--adp-text-2xs);color:var(--ad-ink)}
lookup-card .nudge-row__save-btn{flex:none;border:1px solid var(--ad-accent);background:var(--ad-accent);color:var(--ad-on-accent);border-radius:var(--adp-radius-control);padding:3px 11px;font:inherit;font-size:var(--adp-text-2xs);font-weight:var(--adp-weight-semi);cursor:pointer}
lookup-card .nudge-row__save-btn:hover{filter:brightness(1.06)}
lookup-card .nudge-row__save-btn:focus-visible{outline:2px solid var(--ad-accent);outline-offset:2px}
lookup-card .nudge-row__dismiss-btn{flex:none;display:inline-grid;place-items:center;width:22px;height:22px;border:0;background:transparent;color:var(--ad-ink-faint);border-radius:var(--adp-radius-control);cursor:pointer}
lookup-card .nudge-row__dismiss-btn svg{width:12px;height:12px;pointer-events:none}
lookup-card .nudge-row__dismiss-btn:hover{background:var(--ad-surface);color:var(--ad-ink)}
lookup-card .nudge-row__dismiss-btn:focus-visible{outline:2px solid var(--ad-accent);outline-offset:2px}
lookup-card .merge-prompt-text{margin:0;font-size:var(--adp-text-xs);color:var(--ad-ink)}
lookup-card .merge-prompt-actions{display:flex;gap:8px}
lookup-card .merge-prompt-add{flex:none;border:1px solid var(--ad-accent);background:var(--ad-accent);color:var(--ad-on-accent);border-radius:var(--adp-radius-control);padding:5px 12px;font:inherit;font-size:var(--adp-text-xs);font-weight:var(--adp-weight-semi);cursor:pointer}
lookup-card .merge-prompt-add:hover{filter:brightness(1.06)}
lookup-card .merge-prompt-add:focus-visible{outline:2px solid var(--ad-accent);outline-offset:2px}
lookup-card .merge-prompt-dismiss{flex:none;border:1px solid var(--ad-line);background:transparent;color:var(--ad-ink-soft);border-radius:var(--adp-radius-control);padding:5px 12px;font:inherit;font-size:var(--adp-text-xs);cursor:pointer}
lookup-card .merge-prompt-dismiss:hover{background:var(--ad-surface);color:var(--ad-ink)}
lookup-card .merge-prompt-dismiss:focus-visible{outline:2px solid var(--ad-accent);outline-offset:2px}`;
```

- [ ] **Step 2: Implement `content.ts`.** In `packages/extension-chrome/src/content.ts`:
  1. Add `buildMergePrompt` to the existing `@ai-dict/app` import list (`content.ts:1-11`):

```ts
import {
  runLookupWorkflow,
  InlineBottomSheetRenderer,
  DomSelectionSource,
  MessageRelayLookupClient,
  buildConsentFooter,
  buildMergePrompt,
  createSaveReplyGuard,
  type SettingsStore,
  type SavedWordStatus,
  type WireReply,
} from '@ai-dict/app';
```

2. Replace the `toggle-save` listener (`content.ts:150-171`):

```ts
document.addEventListener('toggle-save', () => {
  if (!lastSavePayload) return;
  const willSave = !lastSaved;
  lastSaved = willSave;
  inline.setSaved(willSave);
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
        inline.setStatus(lastStatus);
      } else if (willSave && reply?.ok && reply.type === 'saved.conflict') {
        // B14: the headword is already saved under a different sentence/url. Nothing was
        // written server-side — revert the optimistic star and ask before appending a new sense.
        lastSaved = false;
        inline.setSaved(false);
        const payload = lastSavePayload;
        const prompt = buildMergePrompt({
          word: reply.word,
          senseCount: reply.senseCount,
          onChoice: (add) => {
            prompt.remove();
            if (!add) return; // decline = no write (B14 fence) — nothing was ever persisted
            lastSaved = true;
            inline.setSaved(true);
            const token2 = saveReplyGuard.next();
            void chrome.runtime
              .sendMessage({ type: 'saved.save' as const, ...payload, confirmNewSense: true })
              .then((raw2: unknown) => {
                if (!saveReplyGuard.isCurrent(token2)) return;
                const reply2 = raw2 as WireReply | undefined;
                if (reply2?.ok && reply2.type === 'saved') {
                  lastStatus = reply2.entry.status;
                  inline.setStatus(lastStatus);
                }
              })
              .catch(() => undefined);
          },
        });
        inline.appendToCard(prompt);
      }
    })
    .catch(() => undefined);
});
```

Run:

```
cd packages/app && bun run typecheck && cd ../extension-chrome && bun run typecheck
```

Expected: clean (no type errors) in both packages.

- [ ] **Step 3: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd ../extension-chrome && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

Commit:

```
git add packages/app/src/ui/lookup-card.ts packages/extension-chrome/src/content.ts
git commit -m "[B14SenseAwareDedup] feat: card-side merge-prompt CSS + toggle-save conflict wiring (B14)"
```

---

### Task 5: `side-panel.ts` — panel-side merge-prompt wiring

**Files:**

- Modify: `packages/extension-chrome/src/side-panel.ts`

Same "composition root, e2e-only" note as Task 4 applies here — no dedicated unit test file exists
for `side-panel.ts`.

- [ ] **Step 1: Implement.** In `packages/extension-chrome/src/side-panel.ts`:
  1. Add `buildMergePrompt` to the existing `@ai-dict/app` import list (`side-panel.ts:1-13`):

```ts
import {
  registerSidePanel,
  sanitizeMarkdown,
  mapError,
  buildMergePrompt,
  createSaveReplyGuard,
  type PanelFocusState,
  type SidePanelView,
  type LookupResult,
  type LookupError,
  type HistoryEntry,
  type WireReply,
  type SavedWordStatus,
} from '@ai-dict/app';
```

2. Replace the `toggle-save` listener (`side-panel.ts:179-200`):

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
      } else if (willSave && reply?.ok && reply.type === 'saved.conflict') {
        // B14: mirrors content.ts's own conflict branch — the panel is its own independent
        // composition root (same reasoning as trackSaveContext's B1-era comment above).
        lastSaved = false;
        setSaved(false);
        const payload = lastSavePayload;
        const prompt = buildMergePrompt({
          word: reply.word,
          senseCount: reply.senseCount,
          onChoice: (add) => {
            prompt.remove();
            if (!add) return; // decline = no write (B14 fence)
            lastSaved = true;
            setSaved(true);
            const token2 = saveReplyGuard.next();
            void chrome.runtime
              .sendMessage({ type: 'saved.save' as const, ...payload, confirmNewSense: true })
              .then((raw2: unknown) => {
                if (!saveReplyGuard.isCurrent(token2)) return;
                const reply2 = raw2 as WireReply | undefined;
                if (reply2?.ok && reply2.type === 'saved') {
                  lastStatus = reply2.entry.status;
                  setStatus(lastStatus);
                }
              })
              .catch(() => undefined);
          },
        });
        view.appendToFocus(prompt);
      }
    })
    .catch(() => undefined);
});
```

Run: `cd packages/extension-chrome && bun run typecheck`
Expected: clean (no type errors).

- [ ] **Step 2: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd ../extension-chrome && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

Commit:

```
git add packages/extension-chrome/src/side-panel.ts
git commit -m "[B14SenseAwareDedup] feat: panel-side merge-prompt wiring (B14)"
```

---

### Task 6: e2e coverage — `b14-sense-aware-dedup.spec.ts`

**Files:**

- Create: `packages/extension-chrome/e2e/b14-sense-aware-dedup.spec.ts`

- [ ] **Step 1: Write the spec.** Create `packages/extension-chrome/e2e/b14-sense-aware-dedup.spec.ts`:

```ts
import { test, expect } from './fixtures';
import { seedSettings, gotoFixture, selectWord, openTrigger, mockGemini } from './helpers';
import type { BrowserContext } from '@playwright/test';

async function swStorageDump(context: BrowserContext): Promise<Record<string, unknown>> {
  const [sw] = context.serviceWorkers();
  return sw.evaluate(() => chrome.storage.local.get(null) as Promise<Record<string, unknown>>);
}

async function doLookup(page: import('@playwright/test').Page, paragraph: string): Promise<void> {
  await gotoFixture(page, paragraph);
  await page.waitForTimeout(1_000);
  await selectWord(page, 't', 'bank');
  await openTrigger(page);
  await expect(page.locator('bottom-sheet lookup-card')).toContainText('financial institution', {
    timeout: 10_000,
  });
}

test.describe('B14 sense-aware dedup', () => {
  test('saving the same headword from a different sentence offers a merge prompt; confirming appends a second sense', async ({
    context,
    extensionId,
  }) => {
    await mockGemini(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);

    await doLookup(page, 'The bank by the river is steep.');
    await page.locator('bottom-sheet lookup-card .save-btn').click();
    await expect.poll(async () => (await swStorageDump(context))['saved:bank']).toBeDefined();
    let dump = await swStorageDump(context);
    let entry = JSON.parse(dump['saved:bank'] as string);
    expect(entry.senses).toHaveLength(1);

    await doLookup(page, 'The bank approved my loan application today.');
    const star = page.locator('bottom-sheet lookup-card .save-btn');
    await star.click();

    const prompt = page.locator('bottom-sheet lookup-card .merge-prompt');
    await expect(prompt).toBeVisible({ timeout: 10_000 });
    await expect(star).toHaveAttribute('aria-pressed', 'false'); // reverted — nothing written yet
    dump = await swStorageDump(context);
    entry = JSON.parse(dump['saved:bank'] as string);
    expect(entry.senses).toHaveLength(1); // still 1 — the conflict reply wrote nothing

    await prompt.locator('.merge-prompt-add').click();
    await expect(star).toHaveAttribute('aria-pressed', 'true', { timeout: 10_000 });
    await expect(prompt).toBeHidden();
    await expect
      .poll(async () => {
        const d = await swStorageDump(context);
        return JSON.parse(d['saved:bank'] as string).senses.length;
      })
      .toBe(2);
  });

  test('declining the merge prompt writes nothing and leaves the word unstarred', async ({
    context,
    extensionId,
  }) => {
    await mockGemini(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);

    await doLookup(page, 'The bank by the river is steep.');
    await page.locator('bottom-sheet lookup-card .save-btn').click();
    await expect.poll(async () => (await swStorageDump(context))['saved:bank']).toBeDefined();

    await doLookup(page, 'The bank approved my loan application today.');
    const star = page.locator('bottom-sheet lookup-card .save-btn');
    await star.click();
    const prompt = page.locator('bottom-sheet lookup-card .merge-prompt');
    await expect(prompt).toBeVisible({ timeout: 10_000 });

    await prompt.locator('.merge-prompt-dismiss').click();
    await expect(prompt).toBeHidden();
    await expect(star).toHaveAttribute('aria-pressed', 'false');

    const dump = await swStorageDump(context);
    const entry = JSON.parse(dump['saved:bank'] as string);
    expect(entry.senses).toHaveLength(1); // unchanged — decline = no write
  });

  test('re-saving the exact same sentence is a silent no-op — no merge prompt, still 1 sense', async ({
    context,
    extensionId,
  }) => {
    await mockGemini(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);

    await doLookup(page, 'The bank by the river is steep.');
    const star = page.locator('bottom-sheet lookup-card .save-btn');
    await star.click();
    await expect.poll(async () => (await swStorageDump(context))['saved:bank']).toBeDefined();
    await star.click(); // unsave
    await expect(star).toHaveAttribute('aria-pressed', 'false');
    await star.click(); // re-save — SAME fixture paragraph/sentence + SAME fixture URL

    await expect(star).toHaveAttribute('aria-pressed', 'true', { timeout: 10_000 });
    await expect(page.locator('bottom-sheet lookup-card .merge-prompt')).toHaveCount(0);
    const dump = await swStorageDump(context);
    const entry = JSON.parse(dump['saved:bank'] as string);
    expect(entry.senses).toHaveLength(1);
  });
});
```

Run:

```
GEMINI_API_KEY= bun run build:chrome
cd packages/extension-chrome && bunx playwright test b14-sense-aware-dedup
```

Expected: 3 passed.

- [ ] **Step 2: Commit** — gate, then commit:

```
GEMINI_API_KEY= bun run build:chrome
bun run lint && bun run format:check
```

Commit:

```
git add packages/extension-chrome/e2e/b14-sense-aware-dedup.spec.ts
git commit -m "[B14SenseAwareDedup] feat: e2e coverage for the sense-aware dedup merge-prompt flow (B14)"
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
cd packages/extension-chrome && bunx playwright test b14-sense-aware-dedup saved-word
```

Expected: typecheck clean on both packages; the full Vitest suite green (including the new
`saved-words-policy.test.ts` cases, the 3 new `wire-schema.test.ts` B14 tests + regenerated
snapshot, the 3 new `router.test.ts` B14 tests, `merge-prompt.test.ts`, and the new
`side-panel-view.test.ts` `appendToFocus` case); lint/format clean; the Chrome build succeeds with
the env key cleared; the new `b14-sense-aware-dedup.spec.ts` (3 tests) and `saved-word.spec.ts`
(regression guard for the B1/B2 save flow this task's edits share files with) all pass.

## PR

Regular merge (no squash). Jira link per the repo convention. Include a **"Testing performed"**
section per this worktree's evidence policy (design spec §6.7) instead of screenshots/video — list
the suites above with pass counts:

- `packages/app` unit: full `bun run test` count (existing + new B14 cases across
  `saved-words-policy.test.ts`, `wire-schema.test.ts`, `router.test.ts`, `merge-prompt.test.ts`,
  `side-panel-view.test.ts`).
- Lint / format-check: green.
- Typecheck: both packages green.
- e2e: `b14-sense-aware-dedup.spec.ts` (3/3) + `saved-word.spec.ts` regression guard, run against a
  build with `GEMINI_API_KEY` cleared.
