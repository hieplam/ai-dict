# B12 LLM Auto-Grouping Implementation Plan

> **For agentic workers:** implement task-by-task, TDD (red → green → commit) per task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a new "Organize my words" button in the side panel sends the reader's saved words
(capped at the 200 most recent) to their configured AI provider in **one** model call, gated by an
explicit token-cost confirmation; the model's strict-JSON clustering response is validated,
rejecting any hallucinated word or malformed shape; accepted groups are persisted as an additive
`tags` field on each word's saved entry and rendered as editable (rename/remove) tag groups in the
panel. No background/scheduled calls anywhere; a rename or remove makes zero further model calls.

**Architecture:** `packages/app/src/domain/auto-group-policy.ts` (new, domain-pure) owns prompt
assembly, the 200-word batching cap, and strict validation/parsing of the model's response —
zero imports outward, fully unit-testable without a wire or a provider. `packages/app/src/app/
router.ts` gains one new handler, `handleOrganize`, that follows the exact
"call `deps.client.lookup()` directly, bypass cache/history" pattern `handleConnectionTest`
already established (`router.ts:195-211`) — Organize never touches the cache or "Recent" history.
Two new wire messages (`saved.organize`, `saved.setTags`) ride the existing `WireMessageSchema`/
`WireReplySchema` discriminated unions (`packages/app/src/wire.ts`). The UI lives in
`packages/app/src/ui/side-panel-view.ts` (a new "Saved words" section, mirroring the existing
`.recent` section's pattern) and `packages/extension-chrome/src/side-panel.ts` (the composition
root that owns the `window.confirm()` gate and the wire calls — the same trusted-extension-page
pattern `side-panel.ts` already uses for `saved.save`/`saved.setStatus`). Full design rationale,
including why a new port method and a plain `lookup` reuse were both rejected in favor of the
existing full-prompt-envelope override:
`docs/superpowers/specs/2026-07-17-b12-llm-auto-grouping-design.md`.

**Tech Stack:** TypeScript, Vitest + happy-dom (unit), Playwright (e2e), Zod (wire schemas).

## Global Constraints

- Implementer: dispatch each implementation/fix task to the `hunter` subagent — never a generic
  implementer.
- Start in a fresh git worktree under `.claude/worktrees/` on branch `feature/B12LlmAutoGrouping`.
- **Do not touch `packages/app/src/domain/prompt-template.ts`, `default-template.ts`,
  `defined-as.ts`, or `translation-line.ts`.** The design spec's §2/§6.9/§6.10 establish that the
  existing `LookupRequest.promptEnvelope` full-override mechanism already does everything this
  card needs, and that the organize response can never match the `DEFINED_AS:`/`TRANSLATION:`
  signal-line regexes. If a task in this plan seems to need a change there, stop — that means the
  override assumption broke somewhere and the plan needs re-grounding.
- **Do not route the organize call through the plain `lookup` wire message or `handleLookup`.**
  It would silently pollute cache/history/the B7 nudge counter (design spec §2). `handleOrganize`
  calls `deps.client.lookup()` directly, exactly like `handleConnectionTest`.
- **Wire + router in ONE task** (Task 4 below): `saved.organize`/`saved.setTags`'s `WireMessageSchema`
  arms and `router.ts`'s matching `switch` cases are added together — the exhaustive
  `switch(msg.type)` with no `default` (`router.ts:213+`) means neither half type-checks alone.
- **Constraint 4 (every model call is user-triggered, token spend is announced first):** exactly
  one `client.lookup()` call per confirmed "Organize my words"/"Organize again" click, gated by a
  `window.confirm()` naming the 200-word cap explicitly. Renaming/removing a tag makes **zero**
  further model calls (plain `saved.setTags` KV writes only).
- **200-word batching cap, newest-saved-first** — grounded in the card's own roadmap payoff line
  ("200 loose words…"), not an arbitrary number (design spec §4). Words beyond the cap are left
  untouched, reported via `skippedCount`.
- **Word-identity is enforced in `parseOrganizeResponse`; completeness is not** (design spec §3) —
  a response containing any word outside the sent set is rejected outright; a response that
  simply omits a few sent words is still accepted.
- S1/S4: nothing here touches the API key or a new HTML-rendering surface — tags render via
  `.textContent`/`.value` only, never `innerHTML` (existing `ICON_TRASH` SVG excepted, which is a
  static app constant, not model output).
- UI additions read only `--ad-*`/`--adp-*` design tokens (no hard-coded colors); the new
  `.organize-busy` spinner honors `prefers-reduced-motion` exactly like the existing `.loadrow`
  rule it mirrors.
- `bun run lint` and `bun run format:check` clean before every commit.
- Every task must leave `cd packages/app && bun run typecheck` green; from Task 4 on,
  `cd packages/extension-chrome && bun run typecheck` too.
- The e2e build must clear any ambient `GEMINI_API_KEY` (`GEMINI_API_KEY= bun run build:chrome`).
- E2e must never fetch the live landing page — this card's e2e uses only the existing
  `http://test.fixture/` local fixture and mocked provider routes.
- Commit subject convention for every task in this plan (per `CONTRACTS.md` §2 / repo
  git-conventions): `[B12LlmAutoGrouping] feat: <task summary> (B12)`.

---

### Task 1: `SavedWordEntry.tags` — additive schema field (types.ts + wire.ts)

**Files:**

- Modify: `packages/app/src/domain/types.ts`
- Modify: `packages/app/src/wire.ts`
- Modify: `packages/app/test/wire-schema.test.ts`

**Interfaces:**

```ts
export interface SavedWordEntry {
  word: string;
  status: SavedWordStatus;
  savedAt: number;
  senses: SavedWordSense[];
  tags?: string[]; // NEW
}
```

- [ ] **Step 1: Write the failing tests.** Append to `packages/app/test/wire-schema.test.ts`,
      inside the existing `describe('saved.save / saved.delete wire messages (B1)', ...)` block
      (starts at `:412`, not the top `describe('wire-schema', ...)` block — this file has 3
      top-level `describe` blocks; the B1 one is the topical home for `SavedWordEntry`-shaped
      tests), just before its closing `});`:

```ts
it('[B12] SavedWordEntrySchema accepts an entry with a tags array', () => {
  const ok = WireReplySchema.safeParse({
    ok: true,
    type: 'saved',
    entry: {
      word: 'bank',
      status: 'learning',
      savedAt: 1_700_000_000_000,
      senses: [{ definition: 'd', translation: '', sentence: 's', url: '', title: '' }],
      tags: ['Finance'],
    },
  });
  expect(ok.success).toBe(true);
});

it('[B12] SavedWordEntrySchema still accepts an entry with no tags field (back-compat)', () => {
  const ok = WireReplySchema.safeParse({
    ok: true,
    type: 'saved',
    entry: {
      word: 'bank',
      status: 'learning',
      savedAt: 1_700_000_000_000,
      senses: [{ definition: 'd', translation: '', sentence: 's', url: '', title: '' }],
    },
  });
  expect(ok.success).toBe(true);
});
```

Run: `cd packages/app && bunx vitest run test/wire-schema.test.ts`
Expected: the first new test **fails** (`ok.success` is `false` — `z.strictObject` rejects the
extra `tags` key today); the second new test already passes (no regression risk to prove yet).

- [ ] **Step 2: Implement.**

In `packages/app/src/domain/types.ts`, add `tags?: string[];` to `SavedWordEntry` (`:246-251`),
with a doc comment recording the E1-lock precedent:

```ts
/**
 * B1's ratified entry shape (escalation E1, owner-approved before this card was dispatched).
 * `word` is the case-insensitive unique key (enforced by saved-words-policy's
 * normalizeWordKey — B14 is the future richer merge-on-collision UX, not the uniqueness itself).
 * `senses` starts as a single-entry array; growing it into a real multi-sense collection is
 * B14's job.
 */
export interface SavedWordEntry {
  word: string;
  status: SavedWordStatus;
  savedAt: number;
  senses: SavedWordSense[];
  /**
   * B12: topic tag(s) assigned by "Organize my words," entry-level (not per-sense — a word's
   * topic doesn't vary by which sentence it was met in). ADDITIVE field under the E1 lock
   * (docs/ROADMAP.md §8 Decision Log, B1/B2 entry: future additive fields stay lead-decidable;
   * restructuring/removing a ratified field is a new escalation). Absent or `[]` means "never
   * organized." v1 writes at most one tag per word per Organize run (`[tag]`).
   */
  tags?: string[];
}
```

In `packages/app/src/wire.ts`, add `tags` to `SavedWordEntrySchema` (`:88-93`):

```ts
// B1: the ratified saved-word entry shape (escalation E1). No `id` field — the (normalized)
// `word` itself is the storage key.
const SavedWordEntrySchema = z.strictObject({
  word: z.string(),
  status: z.enum(['learning', 'known']),
  savedAt: z.number(),
  senses: z.array(SavedWordSenseSchema),
  // B12: additive tag(s) assigned by "Organize my words" — see types.ts's doc comment.
  tags: z.array(z.string()).optional(),
});
```

Run: `cd packages/app && bunx vitest run test/wire-schema.test.ts`
Expected: both new tests pass, but the pre-existing `'JSON-schema snapshot is stable (spec §8.5)'`
test (inside the top `describe('wire-schema', ...)` block, using `toMatchFileSnapshot('
../wire-schema.snapshot.json')`) now **fails** — `SavedWordEntrySchema`'s new optional `tags` key
changes `wireJsonSchema()`'s output, so the on-disk snapshot (`packages/app/wire-schema.
snapshot.json`) is stale. This is expected; fixed in the next sub-step.

Regenerate the snapshot:

```
cd packages/app && bunx vitest run test/wire-schema.test.ts -u
```

Expected: the snapshot file updates and the run reports all tests passing. Re-run once more
WITHOUT `-u` to confirm the snapshot is now stable: `cd packages/app && bunx vitest run
test/wire-schema.test.ts` → all pass.

Also run the full existing suite to confirm the drift-guard
`AssertEqual<z.infer<typeof SavedWordEntrySchema>, SavedWordEntry>` (`wire.ts:208`) still
type-checks: `cd packages/app && bun run typecheck` (clean — both sides gained the identical
optional field).

- [ ] **Step 3: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd .. && cd .. && bun run lint && bun run format:check
```

Commit:

```
git add packages/app/src/domain/types.ts packages/app/src/wire.ts packages/app/test/wire-schema.test.ts packages/app/wire-schema.snapshot.json
git commit -m "[B12LlmAutoGrouping] feat: additive tags field on SavedWordEntry (B12)" \
  -m $'Tribe-Card: b12-llm-auto-grouping\nTribe-Task: 1/7'
```

---

### Task 2: `savedWordSetTags` domain function

**Files:**

- Modify: `packages/app/src/domain/saved-words-policy.ts`
- Modify: `packages/app/test/saved-words-policy.test.ts`

**Interfaces:**

```ts
export async function savedWordSetTags(
  deps: SavedWordsDeps,
  word: string,
  tags: string[],
): Promise<SavedWordEntry | null>;
```

- [ ] **Step 1: Write the failing tests.** Append to `packages/app/test/saved-words-policy.test.ts`,
      inside the existing `describe('saved-words-policy', ...)` block, just before its closing
      `});` (after the existing `'savedWordSetStatus on an unsaved word is a no-op...'` test).
      First add `savedWordSetTags` to the top import list (alongside `savedWordSetStatus`):

```ts
import {
  savedWordUpsert,
  savedWordDelete,
  savedWordGet,
  savedWordsList,
  savedWordsClear,
  savedWordSetStatus,
  savedWordSetTags,
  normalizeWordKey,
} from '../src/domain/saved-words-policy';
```

Then append:

```ts
it('savedWordSetTags writes the tags array onto an existing entry, preserving other fields (B12)', async () => {
  const s = memStorage();
  const original = await savedWordUpsert({ storage: s, now: () => 1000 }, input('bank'));
  const updated = await savedWordSetTags({ storage: s }, 'bank', ['Finance']);
  expect(updated).not.toBeNull();
  expect(updated!.tags).toEqual(['Finance']);
  expect(updated!.status).toBe(original.status);
  expect(updated!.savedAt).toBe(original.savedAt);
  expect(updated!.senses).toEqual(original.senses);
  expect(await s.getItem('saved:bank')).toBe(JSON.stringify(updated));
});

it('savedWordSetTags overwrites a previous tags array (last-organize-wins) (B12)', async () => {
  const s = memStorage();
  await savedWordUpsert({ storage: s, now: () => 1000 }, input('bank'));
  await savedWordSetTags({ storage: s }, 'bank', ['Finance']);
  const updated = await savedWordSetTags({ storage: s }, 'bank', ['Money', 'Business']);
  expect(updated!.tags).toEqual(['Money', 'Business']);
});

it('savedWordSetTags is case-insensitive on the word key (B12)', async () => {
  const s = memStorage();
  await savedWordUpsert({ storage: s, now: () => 1000 }, input('Bank'));
  const updated = await savedWordSetTags({ storage: s }, 'BANK', ['Finance']);
  expect(updated!.tags).toEqual(['Finance']);
});

it('savedWordSetTags on an unsaved word is a no-op returning null (no throw) (B12)', async () => {
  const s = memStorage();
  await expect(savedWordSetTags({ storage: s }, 'ghost', ['Finance'])).resolves.toBeNull();
});
```

Run: `cd packages/app && bunx vitest run test/saved-words-policy.test.ts`
Expected: failures — `savedWordSetTags` is not exported / not a function.

- [ ] **Step 2: Implement.** In `packages/app/src/domain/saved-words-policy.ts`, add, right after
      `savedWordSetStatus` (`:86-98`):

```ts
/**
 * B12: overwrite an existing saved word's tag(s) — used both by "Organize my words" (one call
 * per grouped word, immediately after a successful cluster) and by the tag-edit UI (rename via
 * a full-array replace, remove via filtering the removed tag out before calling this). No-op
 * (returns null) when the word isn't currently saved, mirroring savedWordSetStatus's contract.
 */
export async function savedWordSetTags(
  deps: SavedWordsDeps,
  word: string,
  tags: string[],
): Promise<SavedWordEntry | null> {
  const key = normalizeWordKey(word);
  const raw = await deps.storage.getItem(`saved:${key}`);
  if (!raw) return null;
  const existing = JSON.parse(raw) as SavedWordEntry;
  const entry: SavedWordEntry = { ...existing, tags };
  await deps.storage.setItem(`saved:${key}`, JSON.stringify(entry));
  return entry;
}
```

Run: `cd packages/app && bunx vitest run test/saved-words-policy.test.ts`
Expected: all tests pass (existing + 4 new).

- [ ] **Step 3: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd .. && cd .. && bun run lint && bun run format:check
```

Commit:

```
git add packages/app/src/domain/saved-words-policy.ts packages/app/test/saved-words-policy.test.ts
git commit -m "[B12LlmAutoGrouping] feat: savedWordSetTags domain function (B12)" \
  -m $'Tribe-Card: b12-llm-auto-grouping\nTribe-Task: 2/7'
```

---

### Task 3: `auto-group-policy.ts` — prompt builder, batching cap, response parser

**Files:**

- Create: `packages/app/src/domain/auto-group-policy.ts`
- Create: `packages/app/test/auto-group-policy.test.ts`
- Modify: `packages/app/src/index.ts`

**Interfaces:**

```ts
export const MAX_WORDS_TO_ORGANIZE = 200;
export function excerptDefinition(markdown: string, maxChars?: number): string;
export function selectWordsToOrganize(entries: SavedWordEntry[]): {
  selected: SavedWordEntry[];
  skippedCount: number;
};
export function buildOrganizePrompt(entries: SavedWordEntry[]): string;
export interface TagGroup {
  tag: string;
  words: string[];
}
export function parseOrganizeResponse(
  raw: string,
  validWords: readonly string[],
): TagGroup[] | null;
```

- [ ] **Step 1: Write the failing tests.** Create `packages/app/test/auto-group-policy.test.ts`:

````ts
import { describe, it, expect } from 'vitest';
import {
  MAX_WORDS_TO_ORGANIZE,
  excerptDefinition,
  selectWordsToOrganize,
  buildOrganizePrompt,
  parseOrganizeResponse,
} from '../src/domain/auto-group-policy';
import type { SavedWordEntry } from '../src/domain/types';

function entry(word: string, definition: string): SavedWordEntry {
  return {
    word,
    status: 'learning',
    savedAt: 1000,
    senses: [{ definition, translation: '', sentence: 's', url: '', title: '' }],
  };
}

describe('auto-group-policy', () => {
  describe('excerptDefinition', () => {
    it('strips common markdown syntax and collapses whitespace', () => {
      expect(excerptDefinition('## bank\n\nA **financial** institution.')).toBe(
        'bank A financial institution.',
      );
    });

    it('caps length with an ellipsis when the plain text exceeds maxChars', () => {
      const long = 'word '.repeat(40).trim(); // 199 chars
      const out = excerptDefinition(long, 20);
      expect(out.length).toBe(21); // 20 chars + '…'
      expect(out.endsWith('…')).toBe(true);
    });

    it('leaves short text untouched (no trailing ellipsis)', () => {
      expect(excerptDefinition('A short one.')).toBe('A short one.');
    });
  });

  describe('selectWordsToOrganize', () => {
    it('returns every entry with skippedCount 0 when under the cap', () => {
      const entries = [entry('a', 'd'), entry('b', 'd')];
      const { selected, skippedCount } = selectWordsToOrganize(entries);
      expect(selected).toEqual(entries);
      expect(skippedCount).toBe(0);
    });

    it(`caps at ${MAX_WORDS_TO_ORGANIZE} and reports the correct skippedCount when over`, () => {
      const entries = Array.from({ length: MAX_WORDS_TO_ORGANIZE + 7 }, (_, i) =>
        entry(`w${i}`, 'd'),
      );
      const { selected, skippedCount } = selectWordsToOrganize(entries);
      expect(selected).toHaveLength(MAX_WORDS_TO_ORGANIZE);
      expect(skippedCount).toBe(7);
      // Newest-first order preserved — the FIRST MAX_WORDS_TO_ORGANIZE entries are selected.
      expect(selected[0]!.word).toBe('w0');
      expect(selected.at(-1)!.word).toBe(`w${MAX_WORDS_TO_ORGANIZE - 1}`);
    });
  });

  describe('buildOrganizePrompt', () => {
    it('embeds every selected word and its excerpted definition, numbered', () => {
      const prompt = buildOrganizePrompt([
        entry('bank', 'A financial institution.'),
        entry('serendipity', 'A fortunate accident.'),
      ]);
      expect(prompt).toContain('1. "bank" — A financial institution.');
      expect(prompt).toContain('2. "serendipity" — A fortunate accident.');
    });

    it('contains no envelope placeholder tokens (must pass through buildPrompt unmodified)', () => {
      const prompt = buildOrganizePrompt([entry('bank', 'A financial institution.')]);
      expect(prompt).not.toContain('{word}');
      expect(prompt).not.toContain('{context}');
      expect(prompt).not.toContain('{output_format}');
      expect(prompt).not.toContain('{idiom_instruction}');
      expect(prompt).not.toContain('{translation_instruction}');
    });

    it('instructs strict JSON output with the exact response shape', () => {
      const prompt = buildOrganizePrompt([entry('bank', 'A financial institution.')]);
      expect(prompt).toContain('Output ONLY strict JSON');
      expect(prompt).toContain('"tag"');
      expect(prompt).toContain('"words"');
    });
  });

  describe('parseOrganizeResponse', () => {
    const words = ['bank', 'equity', 'serendipity'];

    it('accepts a well-formed response', () => {
      const raw = JSON.stringify([
        { tag: 'Finance', words: ['bank', 'equity'] },
        { tag: 'Miscellaneous', words: ['serendipity'] },
      ]);
      expect(parseOrganizeResponse(raw, words)).toEqual([
        { tag: 'Finance', words: ['bank', 'equity'] },
        { tag: 'Miscellaneous', words: ['serendipity'] },
      ]);
    });

    it('strips a ```json fence some models wrap strict JSON in anyway', () => {
      const raw = '```json\n' + JSON.stringify([{ tag: 'Finance', words: ['bank'] }]) + '\n```';
      expect(parseOrganizeResponse(raw, words)).toEqual([{ tag: 'Finance', words: ['bank'] }]);
    });

    it('rejects malformed JSON (returns null, never throws)', () => {
      expect(parseOrganizeResponse('not json at all', words)).toBeNull();
    });

    it('rejects a response whose shape does not match (missing "words")', () => {
      const raw = JSON.stringify([{ tag: 'Finance' }]);
      expect(parseOrganizeResponse(raw, words)).toBeNull();
    });

    it('rejects the WHOLE response when it contains a word outside the valid set', () => {
      const raw = JSON.stringify([{ tag: 'Finance', words: ['bank', 'invented-word'] }]);
      expect(parseOrganizeResponse(raw, words)).toBeNull();
    });

    it('accepts a response that omits some valid words (completeness not enforced)', () => {
      const raw = JSON.stringify([{ tag: 'Finance', words: ['bank'] }]);
      expect(parseOrganizeResponse(raw, words)).toEqual([{ tag: 'Finance', words: ['bank'] }]);
    });

    it("keeps a word's FIRST group placement when the model duplicates it across groups", () => {
      const raw = JSON.stringify([
        { tag: 'Finance', words: ['bank'] },
        { tag: 'Miscellaneous', words: ['bank', 'serendipity'] },
      ]);
      expect(parseOrganizeResponse(raw, words)).toEqual([
        { tag: 'Finance', words: ['bank'] },
        { tag: 'Miscellaneous', words: ['serendipity'] },
      ]);
    });

    it('rejects a non-array top-level response', () => {
      expect(
        parseOrganizeResponse(JSON.stringify({ tag: 'Finance', words: ['bank'] }), words),
      ).toBeNull();
    });
  });
});
````

Run: `cd packages/app && bunx vitest run test/auto-group-policy.test.ts`
Expected: failures — the module `../src/domain/auto-group-policy` does not exist yet.

- [ ] **Step 2: Implement.** Create `packages/app/src/domain/auto-group-policy.ts`:

````ts
/**
 * B12 — LLM auto-grouping. Domain-pure: zero imports outward except `./types`
 * (rule-domain-purity). Owns the entire "cluster my saved words" contract: how much of the
 * saved list is sent per run (the batching cap), how the prompt is assembled (a single
 * self-contained string fed through LookupRequest.promptEnvelope's existing full-override
 * mechanism — see the design spec §2), and how the model's strict-JSON response is validated
 * before a single byte of it is trusted or persisted.
 */
import type { SavedWordEntry } from './types';

/**
 * Batching cap for one "Organize my words" run. NOT an arbitrary round number — lifted directly
 * from this card's own roadmap payoff line ("200 loose words → a dozen meaningful groups").
 * `savedWordsList` already returns newest-saved-first (saved-words-policy.ts's index is a
 * prepend), so capping at the front is "the 200 most recently saved words."
 */
export const MAX_WORDS_TO_ORGANIZE = 200;

/** How much of each definition's plain-text excerpt is fed into the prompt per word. */
const DEFINITION_EXCERPT_CHARS = 100;

/**
 * Strip common markdown syntax and collapse whitespace, then cap length. This text is prompt
 * INPUT only (never rendered to the DOM), so it is not a sanitize-model-output (S4) concern —
 * it exists purely to bound token cost while keeping enough topical signal for clustering.
 */
export function excerptDefinition(markdown: string, maxChars = DEFINITION_EXCERPT_CHARS): string {
  const plain = markdown
    .replace(/[#*_`>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > maxChars ? `${plain.slice(0, maxChars).trimEnd()}…` : plain;
}

/** Cap at MAX_WORDS_TO_ORGANIZE, taking the front of the (already newest-first) list. */
export function selectWordsToOrganize(entries: SavedWordEntry[]): {
  selected: SavedWordEntry[];
  skippedCount: number;
} {
  const selected = entries.slice(0, MAX_WORDS_TO_ORGANIZE);
  return { selected, skippedCount: Math.max(0, entries.length - selected.length) };
}

/**
 * Assemble the full organize prompt. Deliberately embeds every word LITERALLY (never as a
 * `{word}`-style placeholder) and contains none of PROMPT_ENVELOPE's placeholder tokens, so it
 * passes through `buildPrompt`/`renderTemplate` completely unmodified when supplied as
 * `LookupRequest.promptEnvelope` (the advanced full-override mechanism, #62) — see design spec
 * §2/§6.9 for why no change to prompt-template.ts/default-template.ts is needed.
 */
export function buildOrganizePrompt(entries: SavedWordEntry[]): string {
  const lines = entries.map((e, i) => {
    const def = e.senses[0] ? excerptDefinition(e.senses[0].definition) : '';
    return `${i + 1}. "${e.word}" — ${def}`;
  });
  return `You are organizing a language learner's saved vocabulary list into topic groups.

Below is a numbered list of saved words with a short excerpt of their definitions:
${lines.join('\n')}

Group these words into topic tags that would help the learner review by theme (e.g. "Finance",
"Emotions", "Words From Latin Spec-"). Rules:
- Every word listed above must appear in EXACTLY ONE group — do not omit any word, do not invent
  words that are not in the numbered list.
- Choose however many groups (between 2 and 12) best fit the words given — do not force unrelated
  words into the same group just to reduce the count.
- Each tag is a short topic label (2-4 words), Title Case, letters/numbers/spaces/hyphens only —
  no punctuation, no emoji.
- If a word genuinely fits no theme, place it in a group named exactly "Miscellaneous".

Output ONLY strict JSON — no markdown code fences, no commentary, no text before or after —
matching exactly this shape (an array of objects, each with a "tag" string and a "words" array of
strings copied verbatim from the numbered list above):
[{"tag":"Finance","words":["bank","equity"]},{"tag":"Miscellaneous","words":["serendipity"]}]`;
}

export interface TagGroup {
  tag: string;
  words: string[];
}

const MAX_TAG_LEN = 40;

function sanitizeTag(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.replace(/\s+/g, ' ').trim().slice(0, MAX_TAG_LEN);
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Parse + validate the model's organize response. Returns null (never throws) on ANY
 * non-conforming shape — malformed JSON, wrong types, or a word that wasn't sent — so the
 * caller shows one clear error rather than persisting partial/garbage output. Word-identity is
 * enforced (a hallucinated/mistyped word invalidates the WHOLE response); completeness is not
 * (a response that omits a few valid words is still accepted) — see design spec §3 for the
 * rationale split.
 */
export function parseOrganizeResponse(
  raw: string,
  validWords: readonly string[],
): TagGroup[] | null {
  const validSet = new Set(validWords.map((w) => w.toLowerCase()));
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const seen = new Set<string>();
  const groups: TagGroup[] = [];
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) return null;
    const tag = sanitizeTag((item as Record<string, unknown>).tag);
    const wordsRaw = (item as Record<string, unknown>).words;
    if (tag === null || !Array.isArray(wordsRaw)) return null;
    const groupWords: string[] = [];
    for (const w of wordsRaw) {
      if (typeof w !== 'string') return null;
      const key = w.toLowerCase();
      if (!validSet.has(key)) return null; // hallucinated/mistyped word → reject the whole reply
      if (seen.has(key)) continue; // duplicate placement across groups → keep the first
      seen.add(key);
      groupWords.push(w);
    }
    if (groupWords.length > 0) groups.push({ tag, words: groupWords });
  }
  return groups.length > 0 ? groups : null;
}
````

In `packages/app/src/index.ts`, add one barrel export line right after the existing
`export * from './domain/saved-words-policy';` line:

```ts
export * from './domain/saved-words-policy';
export * from './domain/auto-group-policy';
```

Run: `cd packages/app && bunx vitest run test/auto-group-policy.test.ts`
Expected: all tests pass.

- [ ] **Step 3: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd .. && cd .. && bun run lint && bun run format:check
```

Commit:

```
git add packages/app/src/domain/auto-group-policy.ts packages/app/test/auto-group-policy.test.ts packages/app/src/index.ts
git commit -m "[B12LlmAutoGrouping] feat: auto-group-policy prompt builder + response parser (B12)" \
  -m $'Tribe-Card: b12-llm-auto-grouping\nTribe-Task: 3/7'
```

---

### Task 4: wire messages + router handler (`saved.organize`, `saved.setTags`)

**Files:**

- Modify: `packages/app/src/wire.ts`
- Modify: `packages/app/src/app/router.ts`
- Modify: `packages/app/test/app/router.test.ts`

**Interfaces:**

```ts
// New WireMessageSchema arms:
{ type: 'saved.organize' }
{ type: 'saved.setTags'; word: string; tags: string[] }
// New WireReplySchema arm:
{ ok: true; type: 'organized'; groups: TagGroup[]; organizedCount: number; skippedCount: number }
// saved.setTags reuses the existing 'saved' reply arm (entry now carries tags).
```

- [ ] **Step 1: Write the failing tests.** Add `savedWordUpsert` to the existing import list from
      `'../../src'` at the top of `packages/app/test/app/router.test.ts` (it currently imports
      `historyList, historyAppend, type LookupResult, type WireMessage, type LookupRequest, type
PublicSettings` — add `savedWordUpsert` alongside them). Then append, inside the existing
      `describe('buildRouter', ...)` block, just before its closing `});`:

```ts
it('saved.organize with no saved words replies organized/0 without calling the client (B12)', async () => {
  const d = deps();
  const reply = await buildRouter(d)({ type: 'saved.organize' });
  expect(reply).toEqual({
    ok: true,
    type: 'organized',
    groups: [],
    organizedCount: 0,
    skippedCount: 0,
  });
  expect(d.client.lookup).not.toHaveBeenCalled();
});

it('saved.organize calls the client once, persists tags, and replies the parsed groups (B12)', async () => {
  const d = deps({
    client: {
      lookup: makeLookupMock(() =>
        Promise.resolve({
          ...result,
          markdown: JSON.stringify([{ tag: 'Finance', words: ['bank'] }]),
        }),
      ),
    },
  });
  await savedWordUpsert(
    { storage: d.kv },
    {
      word: 'bank',
      definition: 'A financial institution.',
      translation: '',
      sentence: 's',
      url: '',
      title: '',
    },
  );
  const reply = await buildRouter(d)({ type: 'saved.organize' });
  expect(d.client.lookup).toHaveBeenCalledTimes(1);
  expect(d.client.lookup.mock.calls[0]?.[0]).toMatchObject({
    promptEnvelope: expect.stringContaining('"bank"'),
  });
  expect(reply).toEqual({
    ok: true,
    type: 'organized',
    groups: [{ tag: 'Finance', words: ['bank'] }],
    organizedCount: 1,
    skippedCount: 0,
  });
  const stored = JSON.parse((await d.kv.getItem('saved:bank'))!);
  expect(stored.tags).toEqual(['Finance']);
});

it('saved.organize replies ok:false/PARSE and writes no tags on a malformed model response (B12)', async () => {
  const d = deps({
    client: { lookup: makeLookupMock(() => Promise.resolve({ ...result, markdown: 'not json' })) },
  });
  await savedWordUpsert(
    { storage: d.kv },
    { word: 'bank', definition: 'def', translation: '', sentence: 's', url: '', title: '' },
  );
  const reply = await buildRouter(d)({ type: 'saved.organize' });
  expect(reply).toMatchObject({ ok: false, type: 'saved.organize', error: { code: 'PARSE' } });
  const stored = JSON.parse((await d.kv.getItem('saved:bank'))!);
  expect(stored.tags).toBeUndefined();
});

it('saved.setTags updates an existing entry and returns it (B12)', async () => {
  const d = deps();
  await savedWordUpsert(
    { storage: d.kv },
    { word: 'bank', definition: 'def', translation: '', sentence: 's', url: '', title: '' },
  );
  const reply = await buildRouter(d)({ type: 'saved.setTags', word: 'bank', tags: ['Finance'] });
  expect(reply).toMatchObject({ ok: true, type: 'saved', entry: { tags: ['Finance'] } });
});

it('saved.setTags on an unsaved word replies ack (idempotent no-op) (B12)', async () => {
  const d = deps();
  const reply = await buildRouter(d)({ type: 'saved.setTags', word: 'ghost', tags: ['x'] });
  expect(reply).toEqual({ ok: true, type: 'ack' });
});
```

Run: `cd packages/app && bunx vitest run test/app/router.test.ts`
Expected: failures — `WireMessage` has no `'saved.organize'`/`'saved.setTags'` variants yet (type
errors) and `buildRouter` has no matching cases (runtime: `msg.type` falls through the exhaustive
switch, which today is a compile error the moment the test file references the new message
literals — this is expected and resolves once Step 2 lands both halves together).

- [ ] **Step 2: Implement.**

In `packages/app/src/wire.ts`, add two new `WireMessageSchema` arms right after the existing
`saved.setStatus` arm (`:123-127`):

```ts
  // B5: manually set an existing saved word's status ('learning' default | 'known' manual).
  // No-op server-side when the word isn't currently saved — see savedWordSetStatus's doc comment.
  z.object({
    type: z.literal('saved.setStatus'),
    word: z.string(),
    status: z.enum(['learning', 'known']),
  }),
  // B12: cluster ALL saved words (server-reads the list itself, capped at 200 most-recent — see
  // auto-group-policy.ts) into topic tags via ONE model call. Payload-free; gated client-side by
  // an explicit confirm() before this is ever sent (constraint 4).
  z.object({ type: z.literal('saved.organize') }),
  // B12: overwrite one word's tag array — used by both the post-organize persistence step and
  // the tag-edit UI (rename/remove), never by a model call.
  z.object({
    type: z.literal('saved.setTags'),
    word: z.string(),
    tags: z.array(z.string()),
  }),
```

Add both new type literals to `MessageTypeEnum` (`:143-158`):

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
  'saved.organize',
  'saved.setTags',
]);
```

Add one new `WireReplySchema` arm right after the existing `'saved'` arm (`:175`):

```ts
  z.object({ ok: z.literal(true), type: z.literal('saved'), entry: SavedWordEntrySchema }),
  // B12: the parsed+persisted clustering result. `groups` mirrors domain/auto-group-policy.ts's
  // TagGroup shape (kept as an inline zod shape here, like every other reply-only arm — no
  // AssertEqual drift guard needed since there is no single persisted domain type this mirrors).
  z.object({
    ok: z.literal(true),
    type: z.literal('organized'),
    groups: z.array(z.strictObject({ tag: z.string(), words: z.array(z.string()) })),
    organizedCount: z.number(),
    skippedCount: z.number(),
  }),
```

In `packages/app/src/app/router.ts`, extend the top import block from `'../index'` (currently
`:1-24`) to add the new domain functions:

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
  savedWordSetTags,
  buildOrganizePrompt,
  parseOrganizeResponse,
  selectWordsToOrganize,
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

Add `handleOrganize` right after `handleConnectionTest` (`:195-211`):

```ts
/**
 * B12: cluster every saved word (capped at MAX_WORDS_TO_ORGANIZE, newest-saved-first) into
 * topic tags via ONE model call. Mirrors handleConnectionTest's own pattern — calls
 * deps.client.lookup() directly, bypassing handleLookup's cache/history/nudge writes entirely
 * (this is not a "lookup," it must never pollute Recent or the cache). Only entries the model
 * actually placed into a group get their tags written; a parse failure writes nothing.
 */
async function handleOrganize(): Promise<RouterReply> {
  const all = await savedWordsList({ storage: deps.kv });
  if (all.length === 0) {
    return { ok: true, type: 'organized', groups: [], organizedCount: 0, skippedCount: 0 };
  }
  const { selected, skippedCount } = selectWordsToOrganize(all);
  try {
    const s = await deps.settings.get();
    const result = await deps.client.lookup({
      word: 'organize',
      context: '',
      url: '',
      title: '',
      target: s.targetLang,
      outputFormat: '',
      promptEnvelope: buildOrganizePrompt(selected),
    });
    const groups = parseOrganizeResponse(
      result.markdown,
      selected.map((e) => e.word),
    );
    if (!groups) {
      return { ok: false, type: 'saved.organize', error: mapError({ kind: 'parse' }) };
    }
    const tagByWord = new Map<string, string>();
    for (const g of groups) for (const w of g.words) tagByWord.set(w.toLowerCase(), g.tag);
    await deps.queue.run(async () => {
      for (const entry of selected) {
        const tag = tagByWord.get(entry.word.toLowerCase());
        if (tag !== undefined) await savedWordSetTags({ storage: deps.kv }, entry.word, [tag]);
      }
    });
    return {
      ok: true,
      type: 'organized',
      groups,
      organizedCount: selected.length,
      skippedCount,
    };
  } catch (err) {
    return { ok: false, type: 'saved.organize', error: toLookupError(err) };
  }
}
```

Add two new switch cases right after the existing `'saved.setStatus'` case (`:261-264`):

```ts
      case 'saved.organize':
        return handleOrganize();
      case 'saved.setTags': {
        const entry = await deps.queue.run(() =>
          savedWordSetTags({ storage: deps.kv }, msg.word, msg.tags),
        );
        return entry ? { ok: true, type: 'saved', entry } : { ok: true, type: 'ack' };
      }
```

Run: `cd packages/app && bunx vitest run test/app/router.test.ts test/wire-schema.test.ts`
Expected: the 5 new router tests pass, but — same mechanism as Task 1 — the
`'JSON-schema snapshot is stable (spec §8.5)'` test in `wire-schema.test.ts` now fails again,
since the two new `WireMessageSchema` arms and the new `organized` `WireReplySchema` arm change
`wireJsonSchema()`'s output further. Regenerate it the same way:

```
cd packages/app && bunx vitest run test/wire-schema.test.ts -u
cd packages/app && bunx vitest run test/app/router.test.ts test/wire-schema.test.ts
```

Expected: all pass (existing + 5 new router tests; snapshot stable).

- [ ] **Step 3: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd .. && cd .. && bun run lint && bun run format:check
```

Commit:

```
git add packages/app/src/wire.ts packages/app/src/app/router.ts packages/app/test/app/router.test.ts packages/app/wire-schema.snapshot.json
git commit -m "[B12LlmAutoGrouping] feat: saved.organize/saved.setTags wire messages + router (B12)" \
  -m $'Tribe-Card: b12-llm-auto-grouping\nTribe-Task: 4/7'
```

---

### Task 5: side panel UI — "Saved words" organize section

**Files:**

- Modify: `packages/app/src/ui/side-panel-view.ts`
- Modify: `packages/app/test/ui/side-panel-view.test.ts`

**Interfaces:**

```ts
export type OrganizeState =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'result'; groups: TagGroup[]; organizedCount: number; skippedCount: number }
  | { kind: 'error'; message: string };
// SidePanelView gains: set/get organize(s: OrganizeState)
// New composed events: 'organize-click' (no detail), 'rename-tag' ({tag,newTag}), 'remove-tag' ({tag})
```

- [ ] **Step 1: Write the failing tests.** Append to `packages/app/test/ui/side-panel-view.test.ts`,
      inside the existing `describe('<side-panel-view>', ...)` block, just before its closing
      `});`:

```ts
describe('B12 — organize section', () => {
  it('renders the idle CTA by default and dispatches organize-click on click', () => {
    const el = mount();
    const section = el.shadowRoot!.querySelector('.organize')!;
    expect(section).not.toBeNull();
    const btn = section.querySelector<HTMLButtonElement>('.organize-btn')!;
    expect(btn.textContent).toContain('Organize my words');
    let fired = false;
    el.addEventListener('organize-click', () => (fired = true));
    btn.click();
    expect(fired).toBe(true);
  });

  it('shows a busy row and no button while organize is busy', () => {
    const el = mount();
    el.organize = { kind: 'busy' };
    const section = el.shadowRoot!.querySelector('.organize')!;
    expect(section.querySelector('.organize-busy')).not.toBeNull();
    expect(section.querySelector('.organize-btn')).toBeNull();
  });

  it('renders one row per group with its words on a result', () => {
    const el = mount();
    el.organize = {
      kind: 'result',
      groups: [
        { tag: 'Finance', words: ['bank', 'equity'] },
        { tag: 'Miscellaneous', words: ['serendipity'] },
      ],
      organizedCount: 3,
      skippedCount: 0,
    };
    const rows = el.shadowRoot!.querySelectorAll('.tag-group');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.querySelector<HTMLInputElement>('.tag-input')!.value).toBe('Finance');
    expect(rows[0]!.querySelector('.tag-words')!.textContent).toBe('bank, equity');
    expect(rows[1]!.querySelector('.tag-words')!.textContent).toBe('serendipity');
  });

  it('shows the empty-list copy when organizedCount is 0', () => {
    const el = mount();
    el.organize = { kind: 'result', groups: [], organizedCount: 0, skippedCount: 0 };
    expect(el.shadowRoot!.querySelector('.organize-summary')!.textContent).toMatch(
      /no saved words/i,
    );
  });

  it('shows an error message and a retry button on error', () => {
    const el = mount();
    el.organize = { kind: 'error', message: 'Hit Gemini rate limit.' };
    const section = el.shadowRoot!.querySelector('.organize')!;
    expect(section.textContent).toContain('Hit Gemini rate limit.');
    const retry = section.querySelector<HTMLButtonElement>('.organize-btn')!;
    let fired = false;
    el.addEventListener('organize-click', () => (fired = true));
    retry.click();
    expect(fired).toBe(true);
  });

  it('editing a tag input and blurring dispatches a composed rename-tag event', () => {
    const el = mount();
    el.organize = {
      kind: 'result',
      groups: [{ tag: 'Finance', words: ['bank'] }],
      organizedCount: 1,
      skippedCount: 0,
    };
    const input = el.shadowRoot!.querySelector<HTMLInputElement>('.tag-input')!;
    let detail: { tag: string; newTag: string } | undefined;
    document.body.addEventListener('rename-tag', (e) => {
      detail = (e as CustomEvent<{ tag: string; newTag: string }>).detail;
    });
    input.value = 'Money';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(detail).toEqual({ tag: 'Finance', newTag: 'Money' });
  });

  it('an empty rename reverts the input instead of dispatching', () => {
    const el = mount();
    el.organize = {
      kind: 'result',
      groups: [{ tag: 'Finance', words: ['bank'] }],
      organizedCount: 1,
      skippedCount: 0,
    };
    const input = el.shadowRoot!.querySelector<HTMLInputElement>('.tag-input')!;
    let fired = false;
    el.addEventListener('rename-tag', () => (fired = true));
    input.value = '   ';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(fired).toBe(false);
    expect(input.value).toBe('Finance');
  });

  it("clicking a group's trash button dispatches a composed remove-tag event", () => {
    const el = mount();
    el.organize = {
      kind: 'result',
      groups: [{ tag: 'Finance', words: ['bank'] }],
      organizedCount: 1,
      skippedCount: 0,
    };
    const del = el.shadowRoot!.querySelector<HTMLButtonElement>('.tag-del')!;
    let detail: { tag: string } | undefined;
    document.body.addEventListener('remove-tag', (e) => {
      detail = (e as CustomEvent<{ tag: string }>).detail;
    });
    del.click();
    expect(detail).toEqual({ tag: 'Finance' });
  });
});
```

Run: `cd packages/app && bunx vitest run test/ui/side-panel-view.test.ts`
Expected: failures — `.organize` section doesn't exist, `organize` is not a settable property.

- [ ] **Step 2: Implement.** In `packages/app/src/ui/side-panel-view.ts`:

1. Add the import (alongside the existing `HistoryEntry` import at `:1`):

```ts
import type { HistoryEntry } from '../domain/types';
import type { TagGroup } from '../domain/auto-group-policy';
```

2. Add the new exported type, right after `PanelFocusState` (`:13`):

```ts
/** B12: what the "Saved words" section currently shows. */
export type OrganizeState =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'result'; groups: TagGroup[]; organizedCount: number; skippedCount: number }
  | { kind: 'error'; message: string };
```

3. Add new CSS rules, right after the existing `.recent-context` rule (`:87`) and before
   `footer{...}` (`:88`) — reuses the existing `@keyframes spin` (`:90`) rather than redefining it:

```css
.organize {
  margin-top: 6px;
}
.organize-head {
  margin: 0;
  padding: 14px 0 8px;
  border-top: 1px solid var(--ad-line);
  font-size: var(--adp-text-2xs);
  font-weight: var(--adp-weight-bold);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ad-ink-soft);
}
.organize-hint {
  margin: 0 0 10px;
  font-size: var(--adp-text-sm);
  line-height: 1.5;
  color: var(--ad-ink-soft);
}
.organize-summary {
  margin: 0 0 8px;
  font-size: var(--adp-text-sm);
  color: var(--ad-ink-soft);
}
.organize-btn {
  display: block;
  width: 100%;
  margin: 0 0 4px;
  padding: 10px 16px;
  border: 0;
  border-radius: var(--adp-radius-control);
  background: var(--ad-accent);
  color: var(--ad-on-accent);
  font: inherit;
  font-size: 14px;
  font-weight: var(--adp-weight-semi);
  cursor: pointer;
}
.organize-btn:hover {
  filter: brightness(1.06);
}
.organize-btn:focus-visible {
  outline: 2px solid var(--ad-accent);
  outline-offset: 2px;
}
.organize-busy {
  display: flex;
  align-items: center;
  gap: 9px;
  margin: 4px 0 12px;
  color: var(--ad-ink-soft);
  font-size: 14px;
}
.organize-busy::before {
  content: '';
  display: block;
  width: 15px;
  height: 15px;
  flex: none;
  border: 2px solid var(--ad-line);
  border-top-color: var(--ad-accent);
  border-radius: 50%;
  animation: spin 0.77s linear infinite;
}
@media (prefers-reduced-motion: reduce) {
  .organize-busy::before {
    animation: none;
  }
}
.tag-groups {
  list-style: none;
  margin: 0 0 10px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.tag-group {
  border: 1px solid var(--ad-line);
  border-radius: 10px;
  padding: 8px 10px;
}
.tag-group-head {
  display: flex;
  align-items: center;
  gap: 4px;
}
.tag-input {
  flex: 1;
  min-width: 0;
  border: 1px solid transparent;
  background: transparent;
  color: var(--ad-ink);
  font: inherit;
  font-weight: var(--adp-weight-semi);
  font-size: 14px;
  padding: 4px 6px;
  border-radius: 6px;
}
.tag-input:hover,
.tag-input:focus {
  border-color: var(--ad-line-strong);
  background: var(--ad-surface-sunken);
}
.tag-input:focus-visible {
  outline: 2px solid var(--ad-accent);
  outline-offset: 1px;
}
.tag-del {
  display: inline-grid;
  place-items: center;
  width: var(--adp-action-size);
  height: var(--adp-action-size);
  flex: none;
  border: 0;
  background: transparent;
  color: var(--ad-ink-faint);
  border-radius: var(--adp-radius-control);
  cursor: pointer;
}
.tag-del:hover {
  background: var(--ad-surface-raised);
  color: var(--ad-error);
}
.tag-del:focus-visible {
  outline: 2px solid var(--ad-accent);
  outline-offset: 2px;
}
.tag-del svg {
  width: 14px;
  height: 14px;
  pointer-events: none;
}
.tag-words {
  margin: 6px 0 0;
  font-size: var(--adp-text-xs);
  line-height: 1.5;
  color: var(--ad-ink-soft);
}
.organize-error-msg {
  margin: 0 0 10px;
}
```

4. Add the `_organize` field + `organizeEl` to the class fields (alongside `_recent`/`recentEl`,
   `:108-112`):

```ts
export class SidePanelView extends HTMLElement {
  private _focus: PanelFocusState = { kind: 'empty' };
  private _recent: HistoryEntry[] = [];
  private _organize: OrganizeState = { kind: 'idle' };
  private focusEl!: HTMLElement;
  private recentEl!: HTMLElement;
  private recentList!: HTMLUListElement;
  private organizeEl!: HTMLElement;
```

5. In `connectedCallback`, right after the existing `main.append(this.focusEl, this.recentEl);`
   line (`:162`), create and append the new section, and call its render at the end (alongside
   the existing `this.renderFocus(); this.renderRecent();`, `:168-169`):

```ts
// B12: "Saved words" — the Organize entry point + its results, always visible (unlike
// .recent, which hides when empty — Organize is a stable CTA, not a dynamic list).
this.organizeEl = document.createElement('section');
this.organizeEl.className = 'organize';
this.organizeEl.setAttribute('aria-label', 'Saved words organizer');

main.append(this.focusEl, this.recentEl, this.organizeEl);

const footer = document.createElement('footer');
footer.innerHTML = `${ICON_SHIELD}<span>Stays on your device</span>`;

root.append(accent, header, main, footer);
this.renderFocus();
this.renderRecent();
this.renderOrganize();
```

(This replaces the existing `main.append(this.focusEl, this.recentEl);` /
`root.append(accent, header, main, footer); this.renderFocus(); this.renderRecent();` lines
verbatim — same footer construction, just the one extra section threaded through.)

6. Add the `organize` accessor pair, right after the existing `recent` accessor (`:181-188`):

```ts
  /** B12: the "Saved words" organizer's current state. */
  set organize(s: OrganizeState) {
    this._organize = s;
    if (this.shadowRoot) this.renderOrganize();
  }
  get organize(): OrganizeState {
    return this._organize;
  }
```

7. Add the render methods, right after `renderRecent`/`recentRow` (after `:237`, the closing
   brace of the class before its final `}`):

```ts
  private renderOrganize(): void {
    const o = this._organize;
    const nodes: Node[] = [];
    const head = document.createElement('h2');
    head.className = 'organize-head';
    head.textContent = 'Saved words';
    nodes.push(head);

    if (o.kind === 'idle') {
      const hint = document.createElement('p');
      hint.className = 'organize-hint';
      hint.textContent = 'Group your saved words into topic tags with AI.';
      nodes.push(hint, this.organizeButton('Organize my words'));
    } else if (o.kind === 'busy') {
      const row = document.createElement('div');
      row.className = 'organize-busy';
      row.textContent = 'Organizing…';
      nodes.push(row);
    } else if (o.kind === 'result') {
      const summary = document.createElement('p');
      summary.className = 'organize-summary';
      summary.textContent =
        o.organizedCount === 0
          ? 'No saved words yet — save a few, then come back to organize them.'
          : o.skippedCount > 0
            ? `Organized ${o.organizedCount} of ${o.organizedCount + o.skippedCount} saved words (most recent first).`
            : `Organized ${o.organizedCount} saved word${o.organizedCount === 1 ? '' : 's'}.`;
      nodes.push(summary);
      if (o.groups.length > 0) {
        const list = document.createElement('ul');
        list.className = 'tag-groups';
        for (const g of o.groups) list.append(this.tagGroupRow(g));
        nodes.push(list);
      }
      nodes.push(this.organizeButton('Organize again'));
    } else {
      const err = document.createElement('p');
      err.className = 'err organize-error-msg';
      err.textContent = o.message;
      nodes.push(err, this.organizeButton('Try again'));
    }
    this.organizeEl.replaceChildren(...nodes);
  }

  private organizeButton(label: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'organize-btn';
    btn.textContent = label;
    btn.addEventListener('click', () =>
      this.dispatchEvent(new CustomEvent('organize-click', { bubbles: true, composed: true })),
    );
    return btn;
  }

  private tagGroupRow(g: TagGroup): HTMLLIElement {
    const li = document.createElement('li');
    li.className = 'tag-group';
    const headRow = document.createElement('div');
    headRow.className = 'tag-group-head';
    const input = document.createElement('input');
    input.className = 'tag-input';
    input.value = g.tag;
    input.setAttribute('aria-label', `Rename tag ${g.tag}`);
    input.addEventListener('change', () => {
      const newTag = input.value.trim();
      if (newTag.length === 0 || newTag === g.tag) {
        input.value = g.tag;
        return;
      }
      this.dispatchEvent(
        new CustomEvent('rename-tag', {
          detail: { tag: g.tag, newTag },
          bubbles: true,
          composed: true,
        }),
      );
    });
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'tag-del';
    del.setAttribute('aria-label', `Remove tag ${g.tag}`);
    del.innerHTML = ICON_TRASH; // decorative aria-hidden SVG; name comes from aria-label
    del.addEventListener('click', () =>
      this.dispatchEvent(
        new CustomEvent('remove-tag', { detail: { tag: g.tag }, bubbles: true, composed: true }),
      ),
    );
    headRow.append(input, del);
    const words = document.createElement('p');
    words.className = 'tag-words';
    words.textContent = g.words.join(', ');
    li.append(headRow, words);
    return li;
  }
```

Run: `cd packages/app && bunx vitest run test/ui/side-panel-view.test.ts`
Expected: all tests pass (existing + 9 new).

- [ ] **Step 3: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd .. && cd .. && bun run lint && bun run format:check
```

Commit:

```
git add packages/app/src/ui/side-panel-view.ts packages/app/test/ui/side-panel-view.test.ts
git commit -m "[B12LlmAutoGrouping] feat: Saved words organize section in the side panel (B12)" \
  -m $'Tribe-Card: b12-llm-auto-grouping\nTribe-Task: 5/7'
```

---

### Task 6: composition root — `side-panel.ts` wiring (confirm → wire calls → tag edits)

**Files:**

- Modify: `packages/extension-chrome/src/side-panel.ts`

No dedicated unit test exists for `side-panel.ts` today (a composition root, e2e-covered only —
same precedent the C2 design spec records for `options.ts`). This task's correctness is proven by
Task 7's e2e; still run the typecheck/lint gate below so a regression in existing behavior (save/
status toggles, Recent, etc. — all in the same file) is caught immediately.

- [ ] **Step 1: Implement.** In `packages/extension-chrome/src/side-panel.ts`, add three new
      listeners right after the existing `toggle-status` listener (`:202-211`):

```ts
// B12: "Organize my words" — gated by an explicit token-cost confirm() (constraint 4), then
// exactly one saved.organize round trip. The panel is a trusted extension page, so it can
// call window.confirm and send the wire message directly, same style as toggle-save above.
view.addEventListener('organize-click', () => {
  const ok = window.confirm(
    'Organize your saved words with AI? This sends up to 200 of your most recently saved ' +
      'words to your AI provider and uses your API quota.',
  );
  if (!ok) return;
  view.organize = { kind: 'busy' };
  void chrome.runtime
    .sendMessage({ type: 'saved.organize' })
    .then((raw: unknown) => {
      const reply = raw as WireReply | undefined;
      if (reply?.ok && reply.type === 'organized') {
        view.organize = {
          kind: 'result',
          groups: reply.groups,
          organizedCount: reply.organizedCount,
          skippedCount: reply.skippedCount,
        };
      } else {
        const message =
          reply && !reply.ok ? reply.error.message : 'Could not reach the extension. Try again.';
        view.organize = { kind: 'error', message };
      }
    })
    .catch(() => {
      view.organize = { kind: 'error', message: 'Could not reach the extension. Try again.' };
    });
});

// B12: rename a tag across every word currently carrying it. Zero model calls — plain
// saved.setTags writes, one per affected word. Updates the local view immediately so the
// renamed label reflects without waiting on every write to resolve.
view.addEventListener('rename-tag', (e) => {
  const { tag, newTag } = (e as CustomEvent<{ tag: string; newTag: string }>).detail;
  if (view.organize.kind !== 'result') return;
  const groups = view.organize.groups.map((g) => (g.tag === tag ? { ...g, tag: newTag } : g));
  const words = groups.find((g) => g.tag === newTag)?.words ?? [];
  view.organize = { ...view.organize, groups };
  for (const word of words) {
    void chrome.runtime
      .sendMessage({ type: 'saved.setTags', word, tags: [newTag] })
      .catch(() => undefined);
  }
});

// B12: remove a tag from every word currently carrying it (the words themselves are never
// deleted — only their tag). Zero model calls.
view.addEventListener('remove-tag', (e) => {
  const { tag } = (e as CustomEvent<{ tag: string }>).detail;
  if (view.organize.kind !== 'result') return;
  const removed = view.organize.groups.find((g) => g.tag === tag);
  const groups = view.organize.groups.filter((g) => g.tag !== tag);
  view.organize = { ...view.organize, groups };
  for (const word of removed?.words ?? []) {
    void chrome.runtime
      .sendMessage({ type: 'saved.setTags', word, tags: [] })
      .catch(() => undefined);
  }
});
```

`WireReply` is already imported at the top of this file (`:11`); `view` is the existing
`SidePanelView` instance (`:29`). No other imports needed.

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
git commit -m "[B12LlmAutoGrouping] feat: side-panel.ts confirm/wire/tag-edit wiring (B12)" \
  -m $'Tribe-Card: b12-llm-auto-grouping\nTribe-Task: 6/7'
```

---

### Task 7: e2e coverage

**Files:**

- Create: `packages/extension-chrome/e2e/b12-llm-auto-grouping.spec.ts`

- [ ] **Step 1: Write the spec.** Create
      `packages/extension-chrome/e2e/b12-llm-auto-grouping.spec.ts`:

```ts
import { test, expect } from './fixtures';
import { seedSettings, mockGemini } from './helpers';

/** Seed two saved:* entries + their index directly (mirrors saved-word.spec.ts's direct-storage
 * style) — Organize needs pre-existing saved words, which is faster to set up this way than
 * driving a full lookup+save flow twice. */
async function seedSavedWords(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(async () => {
    const bank = {
      word: 'bank',
      status: 'learning',
      savedAt: 2000,
      senses: [
        {
          definition: 'A financial institution.',
          translation: '',
          sentence: 'The bank approved the loan.',
          url: 'https://example.com/a',
          title: 'A',
        },
      ],
    };
    const serendipity = {
      word: 'serendipity',
      status: 'learning',
      savedAt: 1000,
      senses: [
        {
          definition: 'A fortunate accident.',
          translation: '',
          sentence: 'Finding it was pure serendipity.',
          url: 'https://example.com/b',
          title: 'B',
        },
      ],
    };
    await chrome.storage.local.set({
      'saved:bank': JSON.stringify(bank),
      'saved:serendipity': JSON.stringify(serendipity),
      'saved:index': JSON.stringify(['bank', 'serendipity']),
    });
  });
}

const ORGANIZE_BODY = JSON.stringify({
  candidates: [
    {
      content: {
        parts: [
          {
            text: JSON.stringify([
              { tag: 'Finance', words: ['bank'] },
              { tag: 'Miscellaneous', words: ['serendipity'] },
            ]),
          },
        ],
      },
    },
  ],
});

test.describe('B12 LLM auto-grouping', () => {
  test('confirming Organize sends exactly one call, renders groups, and persists tags', async ({
    context,
    extensionId,
  }) => {
    const calls = await mockGemini(context, { body: ORGANIZE_BODY });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);

    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/side-panel.html`);
    await panel.waitForSelector('side-panel-view');
    await seedSavedWords(panel);

    panel.on('dialog', (d) => d.accept());
    await panel.locator('side-panel-view .organize-btn').click();

    await expect(panel.locator('side-panel-view .organize-summary')).toContainText(
      'Organized 2 saved words.',
      { timeout: 10_000 },
    );
    const groups = panel.locator('side-panel-view .tag-group');
    await expect(groups).toHaveCount(2);
    await expect(groups.nth(0).locator('.tag-input')).toHaveValue('Finance');
    await expect(groups.nth(0).locator('.tag-words')).toHaveText('bank');
    expect(calls.count).toBe(1);

    const dump = await panel.evaluate(() => chrome.storage.local.get(null));
    const bank = JSON.parse((dump as Record<string, string>)['saved:bank']!);
    const serendipity = JSON.parse((dump as Record<string, string>)['saved:serendipity']!);
    expect(bank.tags).toEqual(['Finance']);
    expect(serendipity.tags).toEqual(['Miscellaneous']);
  });

  test('dismissing the confirm makes zero Gemini calls and leaves the panel idle', async ({
    context,
    extensionId,
  }) => {
    const calls = await mockGemini(context, { body: ORGANIZE_BODY });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);

    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/side-panel.html`);
    await panel.waitForSelector('side-panel-view');
    await seedSavedWords(panel);

    panel.on('dialog', (d) => d.dismiss());
    await panel.locator('side-panel-view .organize-btn').click();
    await panel.waitForTimeout(300); // let any (unwanted) async chain settle

    await expect(panel.locator('side-panel-view .organize-btn')).toContainText('Organize my words');
    expect(calls.count).toBe(0);
  });

  test('a malformed model response shows an error and writes no tags', async ({
    context,
    extensionId,
  }) => {
    await mockGemini(context, {
      body: JSON.stringify({ candidates: [{ content: { parts: [{ text: 'not json at all' }] } }] }),
    });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);

    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/side-panel.html`);
    await panel.waitForSelector('side-panel-view');
    await seedSavedWords(panel);

    panel.on('dialog', (d) => d.accept());
    await panel.locator('side-panel-view .organize-btn').click();

    await expect(panel.locator('side-panel-view .organize-error-msg')).toBeVisible({
      timeout: 10_000,
    });
    const dump = await panel.evaluate(() => chrome.storage.local.get(null));
    const bank = JSON.parse((dump as Record<string, string>)['saved:bank']!);
    expect(bank.tags).toBeUndefined();
  });

  test('renaming a tag updates the label and storage with no additional Gemini call', async ({
    context,
    extensionId,
  }) => {
    const calls = await mockGemini(context, { body: ORGANIZE_BODY });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);

    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/side-panel.html`);
    await panel.waitForSelector('side-panel-view');
    await seedSavedWords(panel);

    panel.on('dialog', (d) => d.accept());
    await panel.locator('side-panel-view .organize-btn').click();
    await expect(panel.locator('side-panel-view .tag-group')).toHaveCount(2, { timeout: 10_000 });

    const financeInput = panel.locator('side-panel-view .tag-group').nth(0).locator('.tag-input');
    await financeInput.fill('Money');
    await financeInput.blur();

    await expect(financeInput).toHaveValue('Money');
    expect(calls.count).toBe(1); // no additional model call from the rename

    await expect
      .poll(async () => {
        const dump = await panel.evaluate(() => chrome.storage.local.get(null));
        return JSON.parse((dump as Record<string, string>)['saved:bank']!).tags;
      })
      .toEqual(['Money']);
  });

  test('Organize with zero saved words shows the empty copy and makes zero Gemini calls', async ({
    context,
    extensionId,
  }) => {
    const calls = await mockGemini(context, { body: ORGANIZE_BODY });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);

    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/side-panel.html`);
    await panel.waitForSelector('side-panel-view');

    panel.on('dialog', (d) => d.accept());
    await panel.locator('side-panel-view .organize-btn').click();

    await expect(panel.locator('side-panel-view .organize-summary')).toContainText(
      'No saved words yet',
      { timeout: 10_000 },
    );
    expect(calls.count).toBe(0);
  });
});
```

Run:

```
GEMINI_API_KEY= bun run build:chrome
cd packages/extension-chrome && bunx playwright test b12-llm-auto-grouping
```

Expected: 5 passed.

- [ ] **Step 2: Commit** — gate, then commit:

```
GEMINI_API_KEY= bun run build:chrome
bun run lint && bun run format:check
```

Commit:

```
git add packages/extension-chrome/e2e/b12-llm-auto-grouping.spec.ts
git commit -m "[B12LlmAutoGrouping] feat: e2e coverage for organize/rename/remove/error paths (B12)" \
  -m $'Tribe-Card: b12-llm-auto-grouping\nTribe-Task: 7/7'
```

---

## Final gate (run once, after Task 7, before opening the PR)

```
cd packages/app && bun run typecheck
cd ../extension-chrome && bun run typecheck
cd ../..
bun run test
bun run lint
bun run format:check
GEMINI_API_KEY= bun run build:chrome
cd packages/extension-chrome && bunx playwright test b12-llm-auto-grouping saved-word side-panel
```

Expected: typecheck clean on both packages; the full Vitest suite green (including the new
`auto-group-policy.test.ts`, the `saved-words-policy.test.ts`/`router.test.ts`/
`side-panel-view.test.ts` additions); lint/format clean; the Chrome build succeeds with the env
key cleared; the new `b12-llm-auto-grouping.spec.ts` (5 tests), plus `saved-word.spec.ts` and
`side-panel*.spec.ts` (regression guards for the files this card's edits share) all pass.

## PR

Regular merge (no squash — owner ruling 2026-07-16). Title: `[B12LlmAutoGrouping] LLM
auto-grouping for saved words`. Jira link per the repo convention
(`https://prospa.atlassian.net/browse/B12LlmAutoGrouping` — adjust to the actual ticket ID if one
exists). Include a **"Testing performed"** section per this worktree's evidence policy (design
spec §8) instead of screenshots/video — list the suites above with pass counts. Note in the PR
body that `CONTRACTS.md` §5's hot-file prediction omitted `side-panel-view.ts`/`side-panel.ts` for
B12 (design spec §11) — flag for the orchestrator serializing against A2/B6/B10/B11.
