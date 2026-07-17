# B13 Related Words Implementation Plan

> **For agentic workers:** implement task-by-task, TDD (red → green → commit) per task. Steps
> use checkbox (`- [ ]`) syntax for tracking. Dispatch each task to the `hunter` subagent.
>
> **Prerequisite: A3 (follow-up chips) must already be merged to master.** Every task below
> assumes A3's `RefineKind`/`REFINE_CHIPS`/`REFINE_INSTRUCTIONS`/`{refine_instruction}` slot/
> `ResultRenderContext.onRefine`/`InlineBottomSheetRenderer.restoreOriginal`/`content.ts`'s
> `lastOriginalSavePayload` are already on disk exactly as
> `docs/superpowers/plans/2026-07-17-a3-follow-up-chips.md` built them. If any anchor snippet
> quoted below does not match what's actually in the file, STOP — A3 shipped differently than its
> plan, and this plan needs re-grounding against the real A3 diff before proceeding, not a
> best-effort patch.

**Goal:** a 5th refine chip, **Related words**, alongside A3's existing 4 (Simpler / More
examples / Etymology / Use it): a one-shot re-run of the same selection that asks the model for
synonyms/antonyms/word-family, shown in the card exactly like any other refine result. When the
headword is **already saved**, the parsed word list is automatically persisted onto the saved
entry's current sense (`SavedWordSense.related?: string[]`, additive under the E1 lock) with
**zero** extra user action and **zero** extra tokens. When the headword is **not** saved, the
result still shows in the card but nothing is written to storage. A normal re-save (star click)
does not preserve a previously-persisted `related` array — it is cleared, consistent with every
other sense field's existing last-write-wins replacement.

**Architecture:** almost the entire change is additive plumbing through mechanisms A3 already
built end-to-end (the `refine`/`RefineKind` one-shot request, the `{refine_instruction}` prompt
slot, the generic refine-chip row). The one genuinely new piece is the persistence path: a new
signal-line parser (`domain/related-line.ts`, mirrors B2's `translation-line.ts`), a new
`LookupResult.related` transient field, a new `SavedWordSense.related` persisted field, a new
`saved.setRelated` wire message whose domain function (`savedWordSetRelated`, mirrors
`savedWordSetStatus`) no-ops server-side when the word isn't currently saved, and one new
fire-and-forget call site in the Chrome composition root (`content.ts`). Full design rationale,
every rejected alternative, and the exact pinned prompt copy:
`docs/superpowers/specs/2026-07-17-b13-related-words-design.md`.

**Tech Stack:** TypeScript, Vitest + happy-dom (unit), Playwright (e2e), Zod (wire schema).

## Global Constraints

- Implementer: dispatch each task to the `hunter` subagent — never a generic implementer.
- Start in a fresh git worktree under `.claude/worktrees/` on branch `feature/B13RelatedWords`,
  branched from a `master` that already contains A3's merged PR.
- Commit subject: `[B13RelatedWords] feat: <imperative summary> (B13)` — matches repo history
  convention (CONTRACTS §2; e.g. `[A3FollowUpChips] feat: add ResultRenderContext.onRefine +
workflow one-shot refine re-run (A3)`). No `Co-Authored-By` trailer, no attribution footer.
- `bun run lint` and `bun run format:check` green before every commit; `cd packages/app && bun run
typecheck` green after every task from Task 1 onward; `cd packages/extension-chrome && bun run
typecheck` green after every task from Task 5 onward (once `content.ts` is touched).
- **Do not redesign any A3 mechanism.** `RefineKind`'s one-shot request/response shape, the
  `{refine_instruction}` prompt-assembly mechanism, the refine-chip row rendering, and the
  Back-to-original restore are all already reviewed and shipped — this plan only widens their
  data (one more union member, one more array entry, one more `Record` key). If a task seems to
  need changing how any of those already work, stop; that means an assumption about A3's shipped
  shape broke and needs re-grounding, not an ad hoc redesign.
- **`saved.setRelated` is a NEW `WireMessageSchema` discriminant arm** — its `wire.ts` arm and its
  `router.ts` case land in ONE task (Task 4), per the repo's standing rule (exhaustive
  `switch(msg.type)`, no `default` — they cannot typecheck apart; `docs/ROADMAP.md` §8 Decision
  Log, 2026-07-16 B5/B3 entry).
- **Prompt copy in Task 1 is pinned verbatim** in the design spec §2.2/§3.3 — copy it exactly, do
  not paraphrase or "improve" the wording.
- **"Only persists when the word IS saved" is enforced server-side, never client-side.** Do not
  add any `lastSaved`-style tracking to `content.ts` to decide whether to send
  `saved.setRelated` — always send it (fire-and-forget) whenever a `'related'` result carries a
  non-empty `related` array; `savedWordSetRelated`'s own no-op-on-a-miss behavior is what makes
  "don't persist when unsaved" correct. See design spec §2.5 for why client-side tracking cannot
  work here.
- **A normal re-save (star click) does NOT preserve a previously-persisted `related` array —
  this is intentional, not a gap.** Do not add preserve-on-upsert logic to `savedWordUpsert`. See
  design spec §2.6.
- **Two already-shipped A3 tests and one already-shipped A3 e2e assertion WILL fail once
  `REFINE_CHIPS`/`REFINE_INSTRUCTIONS` widen to 5 entries — fixing them is part of this plan
  (Tasks 1, 3, 6), not a follow-up.** Do not treat a failing pre-existing A3 test as "not my
  problem" — the fix is a required step in the task that causes the break.
- S1: no field carrying the API key is touched by this card; `saved.setRelated`'s payload is
  `{word, related}` only.
- S4: a `'related'` result's markdown flows through the exact same, single `sanitizeMarkdown` call
  as any other result; the `RELATED:` signal line is stripped BEFORE that call, exactly like
  `TRANSLATION:`/`DEFINED_AS:` already are — never rendered, never needs its own sanitize path.
- UI additions read only `--ad-*`/`--adp-*` design tokens — Task 3 adds zero new CSS (reuses A3's
  existing `.refine-chip` rule wholesale).
- E2e build clears any ambient `GEMINI_API_KEY` (`GEMINI_API_KEY= bun run build:chrome` /
  `build:chrome:e2e`) — never rely on shell state.
- Merge: regular merge commit only — squash prohibited (owner ruling 2026-07-16).

---

### Task 1: Type/schema/prompt plumbing — widen `RefineKind`, add `REFINE_INSTRUCTIONS.related`, `LookupResult.related`, `SavedWordSense.related`

**Files:**

- Modify: `packages/app/src/domain/types.ts`
- Modify: `packages/app/src/wire.ts`
- Modify: `packages/app/src/domain/default-template.ts`
- Modify: `packages/app/test/default-template.test.ts`
- Modify: `packages/app/test/wire-schema.test.ts`

**Interfaces:**

```ts
export type RefineKind = 'simpler' | 'examples' | 'etymology' | 'usage' | 'related'; // domain/types.ts, widened
// LookupResult gains: related?: string[] | undefined;
// SavedWordSense gains: related?: string[];
const RefineKindEnum = z.enum(['simpler', 'examples', 'etymology', 'usage', 'related']); // wire.ts, widened
// LookupResultSchema gains: related: z.array(z.string()).optional()
// SavedWordSenseSchema gains: related: z.array(z.string()).optional()
export const REFINE_INSTRUCTIONS: Record<RefineKind, string>; // default-template.ts, gains a `related` key
```

- [ ] **Step 1: Write the failing tests.**

Modify `packages/app/test/default-template.test.ts`: find A3's existing test inside
`describe('REFINE_INSTRUCTIONS', ...)`:

```ts
it('has exactly the 4 v1 refine kinds, each a non-empty string', () => {
  expect(Object.keys(REFINE_INSTRUCTIONS).sort()).toEqual([
    'etymology',
    'examples',
    'simpler',
    'usage',
  ]);
  for (const text of Object.values(REFINE_INSTRUCTIONS)) {
    expect(text.length).toBeGreaterThan(0);
  }
});
```

Replace it with (this existing test WILL fail until Step 2 lands `REFINE_INSTRUCTIONS.related` —
that is the expected red state):

```ts
it('has exactly the 5 refine kinds (4 from A3 + related from B13), each a non-empty string', () => {
  expect(Object.keys(REFINE_INSTRUCTIONS).sort()).toEqual([
    'etymology',
    'examples',
    'related',
    'simpler',
    'usage',
  ]);
  for (const text of Object.values(REFINE_INSTRUCTIONS)) {
    expect(text.length).toBeGreaterThan(0);
  }
});
```

Append, inside the same `describe` block, right after the existing `'examples and usage each
mention {word}'` test:

```ts
it('related mentions {word} (B13)', () => {
  expect(REFINE_INSTRUCTIONS.related).toContain('{word}');
});
```

Modify `packages/app/test/wire-schema.test.ts`: find A3's existing test (inside `describe('wire-
schema', ...)` or wherever it landed — search for `'lookup req accepts an optional refine kind'`)
and append a new assertion loop entry for `'related'` alongside the existing 4-value loop, OR add
a standalone new test right after it:

```ts
it('lookup req accepts refine="related" (B13)', () => {
  const base = {
    word: 'w',
    context: 'c',
    url: '',
    title: '',
    target: 'vi',
    outputFormat: 'f',
    promptEnvelope: '',
  };
  const ok = WireMessageSchema.safeParse({
    type: 'lookup',
    requestId: '1',
    req: { ...base, refine: 'related' },
  });
  expect(ok.success).toBe(true);
});
```

Append, near `LookupResultSchema`'s existing coverage (search for where `nudge`/`translation` on
`LookupResultSchema` are tested — if no dedicated test exists for those individual optional
fields, add a new standalone block). This file already imports `WireMessageSchema,
WireReplySchema, wireJsonSchema` from `'../src/wire'` at the top — reuse that existing import,
do not add any new import or a `require(...)` call:

```ts
describe('LookupResultSchema.related (B13)', () => {
  const okResult = {
    markdown: '#',
    word: 'bank',
    target: 'vi',
    model: 'gemini-2.5-flash',
    fromCache: false,
    fetchedAt: 1,
  };
  it('accepts an optional related string array', () => {
    expect(
      WireReplySchema.safeParse({
        ok: true,
        type: 'lookup',
        requestId: 'r',
        result: { ...okResult, related: ['shore', 'embankment'] },
      }).success,
    ).toBe(true);
  });
  it('rejects a non-string entry in related', () => {
    expect(
      WireReplySchema.safeParse({
        ok: true,
        type: 'lookup',
        requestId: 'r',
        result: { ...okResult, related: [1, 2] },
      }).success,
    ).toBe(false);
  });
});
```

Append a matching block for `SavedWordSenseSchema` (via `SavedWordEntrySchema`, exercised through
the existing `saved.save`/`saved` reply path — reuse the `senseFields` constant already declared
in the file's `describe('saved.save / saved.delete wire messages (B1)', ...)` block if in scope,
otherwise declare locally):

```ts
describe('SavedWordEntrySchema senses[].related (B13)', () => {
  it('a saved reply with senses[0].related accepted', () => {
    expect(
      WireReplySchema.safeParse({
        ok: true,
        type: 'saved',
        entry: {
          word: 'bank',
          status: 'learning',
          savedAt: 1,
          senses: [
            {
              definition: 'd',
              translation: '',
              sentence: 's',
              url: 'u',
              title: 't',
              related: ['shore', 'embankment'],
            },
          ],
        },
      }).success,
    ).toBe(true);
  });
});
```

Run:

```
cd packages/app && bunx vitest run test/default-template.test.ts test/wire-schema.test.ts
```

Expected: failures — `REFINE_INSTRUCTIONS.related` is not exported yet, `LookupResultSchema`/
`SavedWordSenseSchema` reject the extra `related` key (strict-object rejection), `RefineKindEnum`
rejects `'related'`.

- [ ] **Step 2: Implement.**

In `packages/app/src/domain/types.ts`, replace the existing A3 `RefineKind` type + its doc comment
(currently ending "...B13 (a later, separate card) appends 'related' to this union — see the A3
design spec §2.8 for the full extension-point contract. Do not add 'related' here."):

```ts
/**
 * A3: the fixed v1 refine chip kinds — one-shot re-runs of a lookup asking for a different cut
 * of the same answer. B13 (wave 2) appended 'related' — the result of that refine, when the
 * word is currently saved, is what B13 persists onto the saved entry's current sense (see
 * domain/saved-words-policy.ts's savedWordSetRelated and this card's design spec §2.4/§2.5).
 */
export type RefineKind = 'simpler' | 'examples' | 'etymology' | 'usage' | 'related';
```

In the same file, add to `LookupResult` (immediately after the existing `nudge?: boolean |
undefined;` field):

```ts
  /**
   * B13: the model's RELATED words for this sense (synonyms/antonyms/family), extracted from
   * the RELATED: "..." signal line emitted per REFINE_INSTRUCTIONS.related (see
   * domain/related-line.ts's parseRelated) — present only on a result from a `'related'` refine
   * call. Transient result metadata, like `translation`; NOT itself the persisted field (that is
   * SavedWordSense.related, written by content.ts via the saved.setRelated wire message).
   */
  related?: string[] | undefined;
```

Add to `SavedWordSense` (immediately after the existing `title: string;` field):

```ts
  /**
   * B13: synonyms/antonyms/word-family for this specific sense, captured from a 'related' refine
   * tap and persisted ONLY while this headword is already saved (see savedWordSetRelated). Absent
   * on every entry saved before this card, and on any sense the reader never tapped the chip for
   * — never blocks rendering (per-sense, per design spec §2.4; ADDITIVE under the E1 lock, per
   * docs/ROADMAP.md's Decision Log 2026-07-10 B1/B2 entry which names this exact field).
   */
  related?: string[];
```

In `packages/app/src/wire.ts`, widen the existing A3 `RefineKindEnum`:

```ts
const RefineKindEnum = z.enum(['simpler', 'examples', 'etymology', 'usage', 'related']);
```

Add to `LookupResultSchema` (immediately after the existing `nudge: z.boolean().optional(),`
line):

```ts
  // B13: parsed RELATED words for this sense; present only on a 'related' refine result.
  related: z.array(z.string()).optional(),
```

Add to `SavedWordSenseSchema` (immediately after the existing `title: z.string(),` line):

```ts
  // B13: additive under the E1 lock — see domain/types.ts's SavedWordSense.related doc comment.
  related: z.array(z.string()).optional(),
```

In `packages/app/src/domain/default-template.ts`, add a 5th key to the existing A3
`REFINE_INSTRUCTIONS` object (this is required for `Record<RefineKind, string>` to typecheck the
moment `RefineKind` widens above — TypeScript will report "Property 'related' is missing" until
this lands):

```ts
  related: `The reader wants this word's RELATED WORDS — synonyms, antonyms, and word-family members (words sharing the same root), disambiguated for THIS sentence context. In addition to the normal sections, add a new "**Related words**" section listing them, grouped under "Synonyms", "Antonyms", and "Family" sub-headings where each group has at least one entry (omit an empty group entirely). Immediately after the TRANSLATION line, before any other output, also emit exactly this line:
RELATED: "word1, word2, word3"
List at most 8 comma-separated words or short phrases, most relevant to "{word}" in this sentence context first, no explanations on that line.`,
```

Run:

```
cd packages/app && bunx vitest run test/default-template.test.ts test/wire-schema.test.ts
```

Expected: all tests pass (existing + the ones modified/added in Step 1).

- [ ] **Step 3: Regenerate the wire JSON-schema snapshot.**

```
cd packages/app && bunx vitest run test/wire-schema.test.ts -u
```

Expected: the `'JSON-schema snapshot is stable (spec §8.5)'` test now passes, and `git diff
packages/app/wire-schema.snapshot.json` shows the new `related` fields in the `LookupResult`/
`SavedWordSense` JSON schemas. Re-run without `-u` once to confirm stability:

```
cd packages/app && bunx vitest run test/wire-schema.test.ts
```

Expected: all pass, no further snapshot diff.

- [ ] **Step 4: Gate + commit.**

```
cd packages/app && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

```
git add packages/app/src/domain/types.ts packages/app/src/wire.ts packages/app/src/domain/default-template.ts packages/app/test/default-template.test.ts packages/app/test/wire-schema.test.ts packages/app/wire-schema.snapshot.json
git commit -m "[B13RelatedWords] feat: widen RefineKind + add related fields to LookupResult/SavedWordSense (B13)"
```

---

### Task 2: `related-line.ts` parser + `http-lookup-client.ts` wiring

**Files:**

- Create: `packages/app/src/domain/related-line.ts`
- Create: `packages/app/test/related-line.test.ts`
- Modify: `packages/app/src/app/http-lookup-client.ts`
- Modify: `packages/app/test/app/gemini-lookup-client.test.ts`

**Interfaces:**

```ts
export function parseRelated(markdown: string): { related?: string[]; body: string }; // domain/related-line.ts
```

- [ ] **Step 1: Write the failing tests.**

Create `packages/app/test/related-line.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseRelated } from '../src/domain/related-line';

describe('parseRelated', () => {
  it('extracts a RELATED line and strips it (plus one following blank line)', () => {
    const md = 'RELATED: "shore, embankment, bluff"\n\n## bank\nA financial institution.';
    const out = parseRelated(md);
    expect(out.related).toEqual(['shore', 'embankment', 'bluff']);
    expect(out.body).toBe('## bank\nA financial institution.');
  });

  it('returns the ENTIRE original text unchanged when no RELATED line is present (graceful degradation)', () => {
    const md = '## bank\nA financial institution.';
    const out = parseRelated(md);
    expect(out.related).toBeUndefined();
    expect(out.body).toBe(md);
  });

  it('tolerates the line appearing after leading whitespace/blank lines', () => {
    const md = '\n\nRELATED: "shore, embankment"\n## bank\nmeaning';
    const out = parseRelated(md);
    expect(out.related).toEqual(['shore', 'embankment']);
    expect(out.body).toBe('## bank\nmeaning');
  });

  it('does not strip anything beyond the matched line and its one following blank line', () => {
    const md = 'RELATED: "x"\n\n\n## x\nmeaning';
    const out = parseRelated(md);
    expect(out.body).toBe('\n## x\nmeaning');
  });

  it('finds the RELATED line even when it is not the first line (real pipeline order: DEFINED_AS, then TRANSLATION, then RELATED)', () => {
    const md = '## bank\nRELATED: "shore, embankment"\n\nA financial institution.';
    const out = parseRelated(md);
    expect(out.related).toEqual(['shore', 'embankment']);
    expect(out.body).toBe('## bank\nA financial institution.');
  });

  it('comma-splits and trims each entry', () => {
    const md = 'RELATED: " shore ,embankment,  bluff "\n\nbody';
    const out = parseRelated(md);
    expect(out.related).toEqual(['shore', 'embankment', 'bluff']);
  });

  it('drops empty entries from stray double-commas', () => {
    const md = 'RELATED: "shore,,embankment"\n\nbody';
    const out = parseRelated(md);
    expect(out.related).toEqual(['shore', 'embankment']);
  });

  it('caps at 8 entries even when the model lists more', () => {
    const words = Array.from({ length: 12 }, (_, i) => `word${i}`).join(', ');
    const md = `RELATED: "${words}"\n\nbody`;
    const out = parseRelated(md);
    expect(out.related).toHaveLength(8);
    expect(out.related).toEqual([
      'word0',
      'word1',
      'word2',
      'word3',
      'word4',
      'word5',
      'word6',
      'word7',
    ]);
  });
});
```

Run:

```
cd packages/app && bunx vitest run test/related-line.test.ts
```

Expected: failure — the module does not exist yet.

Append to `packages/app/test/app/gemini-lookup-client.test.ts`, as a new top-level `describe`
right after the existing `describe('B2 translation extraction via runHttpLookup', ...)` block
closes:

```ts
describe('B13 related words extraction via runHttpLookup', () => {
  it('a DEFINED_AS + TRANSLATION + RELATED triple is parsed into result.related and all three lines are stripped from markdown', async () => {
    const body = {
      candidates: [
        {
          content: {
            parts: [
              {
                text: 'DEFINED_AS: "bank" | literal\nTRANSLATION: "ngân hàng"\nRELATED: "shore, embankment, bluff"\n\n## bank\nA financial institution.',
              },
            ],
          },
        },
      ],
    };
    const c = client(() => Promise.resolve(res({ ok: true, status: 200, body })));
    const out = await c.lookup(req);
    expect(out.definedAs).toEqual({ term: 'bank', isIdiom: false });
    expect(out.translation).toBe('ngân hàng');
    expect(out.related).toEqual(['shore', 'embankment', 'bluff']);
    expect(out.markdown).toBe('## bank\nA financial institution.');
  });

  it('a response with no RELATED line leaves related undefined (back-compat)', async () => {
    const c = client(() => Promise.resolve(res({ ok: true, status: 200, body: okBody })));
    const out = await c.lookup(req);
    expect(out.related).toBeUndefined();
  });

  it('req.refine="related" reaches the prompt as the related instruction', async () => {
    let captured: { url: string; init: Parameters<FetchLike>[1] } | null = null;
    const c = client((url, init) => {
      captured = { url, init };
      return Promise.resolve(res({ ok: true, status: 200, body: okBody }));
    });
    await c.lookup({ ...req, refine: 'related' });
    const sent =
      (JSON.parse(captured!.init.body) as { contents: { parts: { text: string }[] }[] }).contents[0]
        ?.parts[0]?.text ?? '';
    expect(sent).toContain('RELATED WORDS');
    expect(sent).not.toContain('SIMPLER');
  });
});
```

Run:

```
cd packages/app && bunx vitest run test/app/gemini-lookup-client.test.ts
```

Expected: failures — `result.related` is always undefined (not wired yet).

- [ ] **Step 2: Implement.**

Create `packages/app/src/domain/related-line.ts`:

```ts
/**
 * B13 — related words on save. Extracts the model's RELATED signal line (emitted per
 * PROMPT_ENVELOPE's {refine_instruction} slot when LookupRequest.refine === 'related' — see
 * default-template.ts's REFINE_INSTRUCTIONS.related) from the raw response text, and returns the
 * remaining body with that line (plus one immediately following blank line) stripped.
 *
 * Mirrors parseTranslation's contract exactly (domain/translation-line.ts) — a dedicated signal
 * line decoupled from the user-customizable Card format, for the same reason B2 needed one:
 * markdown-section parsing is fragile against arbitrary formatting/headings the reader may have
 * customized, while a fixed-shape line the extension owns end-to-end is reliable regardless.
 *
 * Comma-split, trimmed, empty entries dropped, capped at 8 (matches the prompt's own "at most 8"
 * instruction — a client-side backstop in case a model ignores it, bounding stored data size).
 *
 * Pure text processing — no synonym/antonym knowledge lives here (mirrors A8/B2's "no detection
 * engine" precedent). If the model didn't emit a recognisable RELATED line (a non-refine lookup,
 * legacy cached/history entries, a non-compliant model, or a custom envelope override that omits
 * {refine_instruction}), `related` is undefined and `body` is the ENTIRE input text unchanged.
 *
 * Domain-pure: zero imports (rule-domain-purity).
 */
const RELATED_LINE = /^RELATED:\s*"([^"]+)"[ \t]*$/m;

export function parseRelated(markdown: string): { related?: string[]; body: string } {
  const match = RELATED_LINE.exec(markdown);
  if (!match) return { body: markdown };
  const [line, raw] = match;
  const related = raw!
    .split(',')
    .map((w) => w.trim())
    .filter((w) => w.length > 0)
    .slice(0, 8);
  const before = markdown.slice(0, match.index).trim();
  const after = markdown
    .slice(match.index + line.length)
    .replace(/^\n/, '')
    .replace(/^\n/, '');
  return {
    ...(related.length > 0 ? { related } : {}),
    body: before ? `${before}\n${after}` : after,
  };
}
```

In `packages/app/src/app/http-lookup-client.ts`, add the import alongside the existing
`parseDefinedAs`/`parseTranslation` imports:

```ts
import { parseRelated } from '../domain/related-line';
```

Update the parse chain + result construction (currently ending with `...(translation !==
undefined ? { translation } : {}),\n    };`):

```ts
const { definedAs, body: afterDefinedAs } = parseDefinedAs(text);
const { translation, body: afterTranslation } = parseTranslation(afterDefinedAs);
const { related, body: parsedBody } = parseRelated(afterTranslation);
return {
  markdown: parsedBody,
  word: req.word,
  target: req.target,
  model: spec.model,
  provider: spec.provider,
  fromCache: false,
  fetchedAt: Date.now(),
  ...(definedAs !== undefined ? { definedAs } : {}),
  ...(translation !== undefined ? { translation } : {}),
  ...(related !== undefined ? { related } : {}),
};
```

Run:

```
cd packages/app && bunx vitest run test/related-line.test.ts test/app/gemini-lookup-client.test.ts
```

Expected: all tests pass (existing + the ones added in Step 1).

- [ ] **Step 3: Gate + commit.**

```
cd packages/app && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

```
git add packages/app/src/domain/related-line.ts packages/app/test/related-line.test.ts packages/app/src/app/http-lookup-client.ts packages/app/test/app/gemini-lookup-client.test.ts
git commit -m "[B13RelatedWords] feat: parse RELATED signal line and thread it through runHttpLookup (B13)"
```

---

### Task 3: `REFINE_CHIPS` 5th entry + fix the two already-shipped A3 tests it breaks

**Files:**

- Modify: `packages/app/src/ui/lookup-card.ts`
- Modify: `packages/app/test/ui/lookup-card.test.ts`
- Modify: `packages/app/test/app/inline-bottom-sheet-renderer.test.ts`

**Interfaces:**

```ts
// REFINE_CHIPS (lookup-card.ts) gains a 5th entry: { id: 'related', label: 'Related words' }
```

- [ ] **Step 1: Write the failing tests (fixing the two broken A3 assertions IS this step).**

In `packages/app/test/ui/lookup-card.test.ts`, find A3's existing test inside `describe('<lookup-
card> refine chips + back-to-original (A3)', ...)`:

```ts
it('renders exactly 4 refine chips with the pinned copy, in order, none active', () => {
  const el = mountCard();
  el.state = resultState();
  const chips = [...el.querySelectorAll<HTMLButtonElement>('.refine-chip')];
  expect(chips.map((b) => b.textContent)).toEqual([
    'Simpler',
    'More examples',
    'Etymology',
    'Use it',
  ]);
  for (const chip of chips) {
    expect(chip.getAttribute('aria-pressed')).toBe('false');
    expect(chip.disabled).toBe(false);
  }
  expect(el.querySelector('.refine-back-btn')).toBeNull();
});
```

Replace it with (this WILL fail until Task 3 Step 2 lands the 5th `REFINE_CHIPS` entry — expected
red state):

```ts
it('renders exactly 5 refine chips with the pinned copy, in order, none active (4 from A3 + related from B13)', () => {
  const el = mountCard();
  el.state = resultState();
  const chips = [...el.querySelectorAll<HTMLButtonElement>('.refine-chip')];
  expect(chips.map((b) => b.textContent)).toEqual([
    'Simpler',
    'More examples',
    'Etymology',
    'Use it',
    'Related words',
  ]);
  for (const chip of chips) {
    expect(chip.getAttribute('aria-pressed')).toBe('false');
    expect(chip.disabled).toBe(false);
  }
  expect(el.querySelector('.refine-back-btn')).toBeNull();
});
```

No other test in that `describe` block needs a change — re-verify by reading the block: the
active-chip test loops generically over `chips` (not a hardcoded count), the click/back-event
tests target specific chips by index/text unaffected by a 5th entry, and the
`refineChips`-absent test checks for zero rows regardless of array length.

In `packages/app/test/app/inline-bottom-sheet-renderer.test.ts`, find A3's existing test:

```ts
it('renderResult always sets refineChips:true so the card shows the 4-chip row (A3)', () => {
  const h = host();
  new InlineBottomSheetRenderer(h).renderResult(result);
  expect(card(h).querySelectorAll('.refine-chip').length).toBe(4);
});
```

Replace it with (this WILL fail until Task 3 Step 2 lands — expected red state):

```ts
it('renderResult always sets refineChips:true so the card shows the 5-chip row (4 from A3 + related from B13)', () => {
  const h = host();
  new InlineBottomSheetRenderer(h).renderResult(result);
  expect(card(h).querySelectorAll('.refine-chip').length).toBe(5);
});
```

Run:

```
cd packages/app && bunx vitest run test/ui/lookup-card.test.ts test/app/inline-bottom-sheet-renderer.test.ts
```

Expected: the two modified tests fail (4 chips actually render; 5 expected). Every other existing
test in both files still passes.

- [ ] **Step 2: Implement.**

In `packages/app/src/ui/lookup-card.ts`, add a 5th entry to the existing A3 `REFINE_CHIPS` array:

```ts
export const REFINE_CHIPS: RefineChip[] = [
  { id: 'simpler', label: 'Simpler' },
  { id: 'examples', label: 'More examples' },
  { id: 'etymology', label: 'Etymology' },
  { id: 'usage', label: 'Use it' },
  { id: 'related', label: 'Related words' },
];
```

No other change to this file — `renderRefineRow`'s `for (const chip of REFINE_CHIPS)` loop
renders the 5th chip automatically (confirmed by reading the function: it contains no hardcoded
count or per-kind branch).

Run:

```
cd packages/app && bunx vitest run test/ui/lookup-card.test.ts test/app/inline-bottom-sheet-renderer.test.ts
```

Expected: all tests pass (both modified tests now green, nothing else regresses).

- [ ] **Step 3: Gate + commit.**

```
cd packages/app && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

```
git add packages/app/src/ui/lookup-card.ts packages/app/test/ui/lookup-card.test.ts packages/app/test/app/inline-bottom-sheet-renderer.test.ts
git commit -m "[B13RelatedWords] feat: add Related words as the 5th REFINE_CHIPS entry, fix A3's 4-chip assertions (B13)"
```

---

### Task 4: `saved.setRelated` wire arm + router case + `savedWordSetRelated` domain function

**Files:**

- Modify: `packages/app/src/wire.ts`
- Modify: `packages/app/src/domain/saved-words-policy.ts`
- Modify: `packages/app/src/app/router.ts`
- Modify: `packages/app/test/wire-schema.test.ts`
- Modify: `packages/app/test/saved-words-policy.test.ts`
- Modify: `packages/app/test/app/router.test.ts`
- Modify (generated): `packages/app/wire-schema.snapshot.json`

**Interfaces:**

```ts
// wire.ts — new WireMessageSchema arm:
{ type: 'saved.setRelated', word: string, related: string[] } // reply: 'saved' (entry) | 'ack' (no-op)
export async function savedWordSetRelated(
  deps: SavedWordsDeps,
  word: string,
  related: string[],
): Promise<SavedWordEntry | null>; // domain/saved-words-policy.ts
```

- [ ] **Step 1: Write the failing tests.**

Append to `packages/app/test/wire-schema.test.ts`, as a new top-level `describe` (place it near
the other `saved.*` describe blocks):

```ts
describe('saved.setRelated wire message (B13)', () => {
  it('accepts a valid saved.setRelated message', () => {
    const parsed = WireMessageSchema.safeParse({
      type: 'saved.setRelated',
      word: 'bank',
      related: ['shore', 'embankment'],
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects a saved.setRelated message missing word', () => {
    const parsed = WireMessageSchema.safeParse({
      type: 'saved.setRelated',
      related: ['shore'],
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects a saved.setRelated message missing related', () => {
    const parsed = WireMessageSchema.safeParse({ type: 'saved.setRelated', word: 'bank' });
    expect(parsed.success).toBe(false);
  });

  it('rejects a saved.setRelated message where related contains a non-string', () => {
    const parsed = WireMessageSchema.safeParse({
      type: 'saved.setRelated',
      word: 'bank',
      related: ['shore', 1],
    });
    expect(parsed.success).toBe(false);
  });

  it('accepts an empty related array (clears the field)', () => {
    const parsed = WireMessageSchema.safeParse({
      type: 'saved.setRelated',
      word: 'bank',
      related: [],
    });
    expect(parsed.success).toBe(true);
  });
});
```

Append to `packages/app/test/saved-words-policy.test.ts`, inside the existing `describe('saved-
words-policy', ...)` block, right after the last `savedWordSetStatus` test (`'savedWordSetStatus
can flip back from known to learning'` / the no-op test):

```ts
it('savedWordSetRelated patches senses[0].related on an existing entry, preserving everything else (B13)', async () => {
  const s = memStorage();
  const original = await savedWordUpsert({ storage: s, now: () => 1000 }, input('bank'));
  const updated = await savedWordSetRelated({ storage: s }, 'bank', [
    'shore',
    'embankment',
    'bluff',
  ]);
  expect(updated).not.toBeNull();
  expect(updated!.senses[0]!.related).toEqual(['shore', 'embankment', 'bluff']);
  expect(updated!.status).toBe(original.status);
  expect(updated!.savedAt).toBe(original.savedAt);
  expect(updated!.senses[0]!.definition).toBe(original.senses[0]!.definition);
  expect(await s.getItem('saved:bank')).toBe(JSON.stringify(updated));
});

it('savedWordSetRelated is case-insensitive on the word key (B13)', async () => {
  const s = memStorage();
  await savedWordUpsert({ storage: s, now: () => 1000 }, input('Bank'));
  const updated = await savedWordSetRelated({ storage: s }, 'BANK', ['shore']);
  expect(updated!.senses[0]!.related).toEqual(['shore']);
});

it('savedWordSetRelated on an unsaved word is a no-op returning null (no throw) (B13)', async () => {
  const s = memStorage();
  await expect(savedWordSetRelated({ storage: s }, 'ghost', ['x'])).resolves.toBeNull();
  expect(await s.getItem('saved:ghost')).toBeNull();
});

it('a subsequent plain savedWordUpsert (a normal re-save) clears a previously-persisted related array (B13, design spec §2.6)', async () => {
  const s = memStorage();
  await savedWordUpsert({ storage: s, now: () => 1000 }, input('bank'));
  await savedWordSetRelated({ storage: s }, 'bank', ['shore', 'embankment']);
  const resaved = await savedWordUpsert(
    { storage: s, now: () => 2000 },
    input('bank', { definition: 'new context' }),
  );
  expect(resaved.senses[0]!.related).toBeUndefined();
});
```

Update the file's import list to add `savedWordSetRelated`:

```ts
import {
  savedWordUpsert,
  savedWordDelete,
  savedWordGet,
  savedWordsList,
  savedWordsClear,
  savedWordSetStatus,
  savedWordSetRelated,
  normalizeWordKey,
} from '../src/domain/saved-words-policy';
```

Append to `packages/app/test/app/router.test.ts`, right after the existing `'saved.setStatus is
case-insensitive on the word key (B5)'` test:

```ts
it('saved.setRelated patches an already-saved entry and returns it (B13)', async () => {
  const d = deps();
  const route = buildRouter(d);
  await route({
    type: 'saved.save',
    word: 'bank',
    definition: 'd',
    translation: '',
    sentence: 's',
    url: 'u',
    title: 't',
  });
  const reply = await route({
    type: 'saved.setRelated',
    word: 'bank',
    related: ['shore', 'embankment'],
  });
  expect(reply).toMatchObject({
    ok: true,
    type: 'saved',
    entry: { word: 'bank', senses: [{ related: ['shore', 'embankment'] }] },
  });
});

it('saved.setRelated on an unsaved word replies ack and writes nothing (B13)', async () => {
  const d = deps();
  const route = buildRouter(d);
  const reply = await route({ type: 'saved.setRelated', word: 'ghost', related: ['x'] });
  expect(reply).toMatchObject({ ok: true, type: 'ack' });
  expect(await d.kv.getItem('saved:ghost')).toBeNull();
});

it('saved.setRelated is case-insensitive on the word key (B13)', async () => {
  const d = deps();
  const route = buildRouter(d);
  await route({
    type: 'saved.save',
    word: 'Bank',
    definition: 'd',
    translation: '',
    sentence: 's',
    url: 'u',
    title: 't',
  });
  const reply = await route({
    type: 'saved.setRelated',
    word: 'BANK',
    related: ['shore'],
  });
  expect(reply).toMatchObject({
    ok: true,
    type: 'saved',
    entry: { senses: [{ related: ['shore'] }] },
  });
});
```

Run:

```
cd packages/app && bunx vitest run test/wire-schema.test.ts test/saved-words-policy.test.ts test/app/router.test.ts
```

Expected: failures — `saved.setRelated` is rejected by `WireMessageSchema` (unrecognized
discriminant), `savedWordSetRelated` is not exported, the router has no matching case (a TS
compile error at this point is also expected/acceptable since `router.ts`'s exhaustive switch
does not yet have a `case` for the new arm — proceed to Step 2).

- [ ] **Step 2: Implement.**

In `packages/app/src/wire.ts`, add the new arm to `WireMessageSchema`'s array, positioned
immediately after the existing `saved.setStatus` arm:

```ts
  // B13: patch the related-words list onto an ALREADY-saved entry's current sense. No-op
  // server-side (replies ack, writes nothing) when the word isn't currently saved — see
  // domain/saved-words-policy.ts's savedWordSetRelated. Sent automatically by content.ts the
  // instant a 'related' refine result renders; never sent by any explicit UI button.
  z.object({
    type: z.literal('saved.setRelated'),
    word: z.string(),
    related: z.array(z.string()),
  }),
```

Add `'saved.setRelated'` to the existing `MessageTypeEnum` array (alongside `'saved.setStatus'`).

In `packages/app/src/domain/saved-words-policy.ts`, add the new function immediately after
`savedWordSetStatus`:

```ts
/**
 * B13: patch the related-words list onto an ALREADY-saved word's current (senses[0]) sense.
 * No-op (returns null) when the word isn't currently saved — mirrors savedWordSetStatus's own
 * contract exactly: "only persists when the word IS saved" (roadmap fence) is enforced HERE,
 * atomically, because this is the only place with real ground truth (the composition root's own
 * "is this saved" tracking is reset on every render and cannot answer reliably — see the design
 * spec's §2.5). Targets senses[0] specifically: pre-B14, `senses` is always exactly one entry
 * (savedWordUpsert never produces more), and a 'related' refine tap always answers about the
 * single sense currently on screen.
 */
export async function savedWordSetRelated(
  deps: SavedWordsDeps,
  word: string,
  related: string[],
): Promise<SavedWordEntry | null> {
  const key = normalizeWordKey(word);
  const raw = await deps.storage.getItem(`saved:${key}`);
  if (!raw) return null;
  const existing = JSON.parse(raw) as SavedWordEntry;
  const senses = existing.senses.map((s, i) => (i === 0 ? { ...s, related } : s));
  const entry: SavedWordEntry = { ...existing, senses };
  await deps.storage.setItem(`saved:${key}`, JSON.stringify(entry));
  return entry;
}
```

In `packages/app/src/app/router.ts`, add `savedWordSetRelated` to the existing import list from
`'../index'` (alongside `savedWordSetStatus`), then add the new case immediately after the
existing `'saved.setStatus'` case:

```ts
      case 'saved.setRelated': {
        const entry = await deps.queue.run(() =>
          savedWordSetRelated({ storage: deps.kv }, msg.word, msg.related),
        );
        return entry ? { ok: true, type: 'saved', entry } : { ok: true, type: 'ack' };
      }
```

Run:

```
cd packages/app && bunx vitest run test/wire-schema.test.ts test/saved-words-policy.test.ts test/app/router.test.ts
```

Expected: all tests pass (existing + the ones added in Step 1).

- [ ] **Step 3: Regenerate the wire JSON-schema snapshot (a 2nd time — the new discriminant arm
      changes the schema again).**

```
cd packages/app && bunx vitest run test/wire-schema.test.ts -u
```

Expected: the snapshot test passes; `git diff packages/app/wire-schema.snapshot.json` shows the
new `saved.setRelated` arm added to `WireMessage`'s JSON schema. Re-run without `-u`:

```
cd packages/app && bunx vitest run test/wire-schema.test.ts
```

Expected: all pass, no further diff.

- [ ] **Step 4: Gate + commit.**

```
cd packages/app && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

```
git add packages/app/src/wire.ts packages/app/src/domain/saved-words-policy.ts packages/app/src/app/router.ts packages/app/test/wire-schema.test.ts packages/app/test/saved-words-policy.test.ts packages/app/test/app/router.test.ts packages/app/wire-schema.snapshot.json
git commit -m "[B13RelatedWords] feat: add saved.setRelated wire message + router case + savedWordSetRelated (B13)"
```

---

### Task 5: `content.ts` — auto-fire `saved.setRelated` on a non-empty `'related'` result

**Files:**

- Modify: `packages/extension-chrome/src/content.ts`

No dedicated unit-test file exists for `content.ts` in this repo (confirmed: a composition root,
same precedent A3's own plan already recorded — "covered by e2e only"). This task's correctness
is proven by Task 6's e2e scenarios 2 and 3. Still run the full gate below so a regression in
existing behavior (save/status/nudge/refine-back handling, all in the same file) is caught
immediately.

- [ ] **Step 1: Implement.**

Update the `renderResult` handler inside the `runLookupWorkflow({ renderer: { ... } })` call —
find A3's existing code (already carrying `lastOriginalSavePayload`):

```ts
    renderResult(r, ctx) {
      lastFocus = { state: 'result', payload: r };
      lastSavePayload = {
        word: r.word,
        definition: r.markdown,
        translation: r.translation ?? '',
        sentence: ctx?.sentence ?? '',
        url: ctx?.url ?? '',
        title: ctx?.title ?? '',
      };
      if (ctx?.refine === undefined) lastOriginalSavePayload = lastSavePayload;
      lastSaved = false;
      lastStatus = undefined;
      saveReplyGuard.next();
      inline.renderResult(r, ctx);
      mirror.renderResult(r, ctx);
    },
```

Insert the new block immediately after the `if (ctx?.refine === undefined) lastOriginalSavePayload
= lastSavePayload;` line and before `lastSaved = false;`:

```ts
    renderResult(r, ctx) {
      lastFocus = { state: 'result', payload: r };
      lastSavePayload = {
        word: r.word,
        definition: r.markdown,
        translation: r.translation ?? '',
        sentence: ctx?.sentence ?? '',
        url: ctx?.url ?? '',
        title: ctx?.title ?? '',
      };
      if (ctx?.refine === undefined) lastOriginalSavePayload = lastSavePayload;
      // B13: a 'related' refine tap auto-persists the parsed related-words list onto the
      // ALREADY-saved entry — fire-and-forget; the router's savedWordSetRelated no-ops
      // server-side when the word isn't currently saved (design spec §2.5 — "show but don't
      // persist"). No client-side is-saved tracking needed or possible here: lastSaved is reset
      // below on every render, including this one, so it can never answer "was this saved
      // before this tap" reliably (design spec §2.5's rejected alternative).
      if (ctx?.refine === 'related' && r.related && r.related.length > 0) {
        void chrome.runtime
          .sendMessage({ type: 'saved.setRelated', word: r.word, related: r.related })
          .catch(() => undefined);
      }
      lastSaved = false;
      lastStatus = undefined;
      saveReplyGuard.next();
      inline.renderResult(r, ctx);
      mirror.renderResult(r, ctx);
    },
```

Run:

```
cd packages/extension-chrome && bun run typecheck
```

Expected: clean (no type errors).

- [ ] **Step 2: Gate + commit.**

```
cd packages/app && bun run typecheck && cd ../extension-chrome && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

```
git add packages/extension-chrome/src/content.ts
git commit -m "[B13RelatedWords] feat: auto-persist related words onto an already-saved entry in content.ts (B13)"
```

---

### Task 6: e2e coverage + fix A3's existing e2e assertion + final gate + PR

**Files:**

- Create: `packages/extension-chrome/e2e/b13-related-words.spec.ts`
- Modify: `packages/extension-chrome/e2e/a3-follow-up-chips.spec.ts`

- [ ] **Step 1: Fix the already-shipped A3 e2e assertion this card's 5th chip breaks.**

In `packages/extension-chrome/e2e/a3-follow-up-chips.spec.ts`, find test 1 ("chips render on
every result, none active, no back button"):

```ts
const card = page.locator('bottom-sheet lookup-card');
await expect(card).toContainText('A financial institution.', { timeout: 10_000 });
const chips = card.locator('.refine-chip');
await expect(chips).toHaveCount(4);
await expect(chips.nth(0)).toHaveText('Simpler');
await expect(chips.nth(1)).toHaveText('More examples');
await expect(chips.nth(2)).toHaveText('Etymology');
await expect(chips.nth(3)).toHaveText('Use it');
for (const i of [0, 1, 2, 3]) {
  await expect(chips.nth(i)).toHaveAttribute('aria-pressed', 'false');
  await expect(chips.nth(i)).toBeEnabled();
}
await expect(card.locator('.refine-back-btn')).toHaveCount(0);
```

Replace with:

```ts
const card = page.locator('bottom-sheet lookup-card');
await expect(card).toContainText('A financial institution.', { timeout: 10_000 });
const chips = card.locator('.refine-chip');
await expect(chips).toHaveCount(5); // B13 added the 5th "Related words" chip
await expect(chips.nth(0)).toHaveText('Simpler');
await expect(chips.nth(1)).toHaveText('More examples');
await expect(chips.nth(2)).toHaveText('Etymology');
await expect(chips.nth(3)).toHaveText('Use it');
await expect(chips.nth(4)).toHaveText('Related words');
for (const i of [0, 1, 2, 3, 4]) {
  await expect(chips.nth(i)).toHaveAttribute('aria-pressed', 'false');
  await expect(chips.nth(i)).toBeEnabled();
}
await expect(card.locator('.refine-back-btn')).toHaveCount(0);
```

Also widen test 3's ("Back to original restores the original body with zero extra network calls")
two identical existing loops from:

```ts
for (const i of [0, 1, 2, 3]) {
  await expect(card.locator('.refine-chip').nth(i)).toHaveAttribute('aria-pressed', 'false');
  await expect(card.locator('.refine-chip').nth(i)).toBeEnabled();
}
```

to:

```ts
for (const i of [0, 1, 2, 3, 4]) {
  await expect(card.locator('.refine-chip').nth(i)).toHaveAttribute('aria-pressed', 'false');
  await expect(card.locator('.refine-chip').nth(i)).toBeEnabled();
}
```

This does not fail without the change (it simply leaves the 5th chip unchecked), but is a
low-cost completeness improvement while this file is already open for the required fix above.

Run this one spec alone first to confirm the fix (requires a build — see Step 3 for the full
sequence; a quick local check is optional here and folded into Step 3's full run).

- [ ] **Step 2: Write the new e2e spec.**

Create `packages/extension-chrome/e2e/b13-related-words.spec.ts`:

```ts
import { test, expect } from './fixtures';
import { seedSettings, mockGemini, gotoFixture, selectWord, openTrigger } from './helpers';
import type { BrowserContext } from '@playwright/test';

const ORIGINAL_BODY = JSON.stringify({
  candidates: [{ content: { parts: [{ text: '## bank\nA financial institution.' }] } }],
});

const RELATED_BODY = JSON.stringify({
  candidates: [
    {
      content: {
        parts: [
          {
            text: 'RELATED: "shore, embankment, bluff"\n\n## bank\nA financial institution.\n\n**Related words**\nShore, embankment, bluff.',
          },
        ],
      },
    },
  ],
});

async function swStorageDump(context: BrowserContext): Promise<Record<string, unknown>> {
  const [sw] = context.serviceWorkers();
  return sw.evaluate(() => chrome.storage.local.get(null) as Promise<Record<string, unknown>>);
}

test.describe('B13 related words on save', () => {
  test('tapping the related chip resends the original selection, shows the result, and does NOT persist when the word is not saved', async ({
    context,
    extensionId,
  }) => {
    await mockGemini(context, { body: ORIGINAL_BODY });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);
    await gotoFixture(page, 'The bank by the river is steep.');
    await page.waitForTimeout(800);
    await selectWord(page, 't', 'bank');
    await openTrigger(page);

    const card = page.locator('bottom-sheet lookup-card');
    await expect(card).toContainText('A financial institution.', { timeout: 10_000 });

    let sentPrompt = '';
    await context.unroute('https://generativelanguage.googleapis.com/**');
    await mockGemini(context, {
      body: RELATED_BODY,
      onRequest: (postData) => {
        const parsed = JSON.parse(postData) as { contents: { parts: { text: string }[] }[] };
        sentPrompt = parsed.contents[0]?.parts[0]?.text ?? '';
      },
    });

    await card.locator('.refine-chip', { hasText: 'Related words' }).click();
    await expect(card).toContainText('Shore, embankment, bluff.', { timeout: 10_000 });

    expect(sentPrompt).toContain('RELATED WORDS');
    expect(sentPrompt).toContain('"bank"');
    expect(sentPrompt).toContain('The bank by the river is steep.');

    // The machine-only signal line never leaks into the visible card.
    await expect(card).not.toContainText('RELATED:');

    // Never starred — nothing should be persisted.
    const dump = await swStorageDump(context);
    expect(dump['saved:bank']).toBeUndefined();
  });

  test('tapping the related chip on an ALREADY-saved word persists related onto the existing entry, touching nothing else', async ({
    context,
    extensionId,
  }) => {
    await mockGemini(context, { body: ORIGINAL_BODY });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);
    await gotoFixture(page, 'The bank by the river is steep.');
    await page.waitForTimeout(800);
    await selectWord(page, 't', 'bank');
    await openTrigger(page);

    const card = page.locator('bottom-sheet lookup-card');
    await expect(card).toContainText('A financial institution.', { timeout: 10_000 });

    await card.locator('.save-btn').click();
    await expect.poll(async () => (await swStorageDump(context))['saved:bank']).toBeDefined();
    const before = JSON.parse((await swStorageDump(context))['saved:bank'] as string) as {
      senses: {
        definition: string;
        translation: string;
        sentence: string;
        url: string;
        title: string;
      }[];
    };

    await context.unroute('https://generativelanguage.googleapis.com/**');
    await mockGemini(context, { body: RELATED_BODY });
    await card.locator('.refine-chip', { hasText: 'Related words' }).click();
    await expect(card).toContainText('Shore, embankment, bluff.', { timeout: 10_000 });

    await expect
      .poll(async () => {
        const dump = await swStorageDump(context);
        const entry = dump['saved:bank']
          ? (JSON.parse(dump['saved:bank'] as string) as {
              senses: { related?: string[] }[];
            })
          : null;
        return entry?.senses[0]?.related;
      })
      .toEqual(['shore', 'embankment', 'bluff']);

    const after = JSON.parse((await swStorageDump(context))['saved:bank'] as string) as {
      senses: {
        definition: string;
        translation: string;
        sentence: string;
        url: string;
        title: string;
      }[];
    };
    expect(after.senses[0]!.definition).toBe(before.senses[0]!.definition);
    expect(after.senses[0]!.translation).toBe(before.senses[0]!.translation);
    expect(after.senses[0]!.sentence).toBe(before.senses[0]!.sentence);
    expect(after.senses[0]!.url).toBe(before.senses[0]!.url);
    expect(after.senses[0]!.title).toBe(before.senses[0]!.title);
  });

  test('a subsequent normal re-save clears the previously-persisted related array', async ({
    context,
    extensionId,
  }) => {
    await mockGemini(context, { body: ORIGINAL_BODY });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);
    await gotoFixture(page, 'The bank by the river is steep.');
    await page.waitForTimeout(800);
    await selectWord(page, 't', 'bank');
    await openTrigger(page);

    const card = page.locator('bottom-sheet lookup-card');
    await expect(card).toContainText('A financial institution.', { timeout: 10_000 });
    await card.locator('.save-btn').click();
    await expect.poll(async () => (await swStorageDump(context))['saved:bank']).toBeDefined();

    await context.unroute('https://generativelanguage.googleapis.com/**');
    await mockGemini(context, { body: RELATED_BODY });
    await card.locator('.refine-chip', { hasText: 'Related words' }).click();
    await expect
      .poll(async () => {
        const dump = await swStorageDump(context);
        const entry = JSON.parse(dump['saved:bank'] as string) as {
          senses: { related?: string[] }[];
        };
        return entry.senses[0]?.related;
      })
      .toEqual(['shore', 'embankment', 'bluff']);

    // Simulate a genuine re-save with a fresh lookup+star cycle (fresh navigation, new
    // selection) — gotoFixture re-navigates the page, which is enough to reset the in-page
    // card/trigger state without an extra explicit reload.
    await context.unroute('https://generativelanguage.googleapis.com/**');
    await mockGemini(context, { body: ORIGINAL_BODY });
    await gotoFixture(page, 'The bank by the river is steep.');
    await page.waitForTimeout(800);
    await selectWord(page, 't', 'bank');
    await openTrigger(page);
    await expect(card).toContainText('A financial institution.', { timeout: 10_000 });
    await card.locator('.save-btn').click();

    await expect
      .poll(async () => {
        const dump = await swStorageDump(context);
        const entry = JSON.parse(dump['saved:bank'] as string) as {
          senses: { related?: string[] }[];
        };
        return entry.senses[0]?.related;
      })
      .toBeUndefined();
  });

  test('a related tap always hits the network, even for an already-cached word/sentence/target', async ({
    context,
    extensionId,
  }) => {
    const calls = await mockGemini(context, { body: ORIGINAL_BODY });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);
    await gotoFixture(page, 'The bank by the river is steep.');
    await page.waitForTimeout(800);
    await selectWord(page, 't', 'bank');
    await openTrigger(page);
    await expect(page.locator('bottom-sheet lookup-card')).toContainText(
      'A financial institution.',
      { timeout: 10_000 },
    );
    expect(calls.count).toBe(1);

    const card = page.locator('bottom-sheet lookup-card');
    await card.locator('.refine-chip', { hasText: 'Related words' }).click();
    await expect.poll(() => calls.count, { timeout: 10_000 }).toBe(2);
  });
});
```

Run:

```
GEMINI_API_KEY= bun run build:chrome
cd packages/extension-chrome && bunx playwright test b13-related-words a3-follow-up-chips
```

Expected: 4 passed for `b13-related-words`; all of `a3-follow-up-chips` (6 tests, including the
fixed test 1) still pass.

- [ ] **Step 3: Full gate.**

```
cd packages/app && bun run typecheck
cd ../extension-chrome && bun run typecheck
cd ../..
bun run test
bun run lint
bun run format:check
GEMINI_API_KEY= bun run build:chrome
cd packages/extension-chrome && bunx playwright test b13-related-words a3-follow-up-chips saved-word cache-history idiom-expansion onboarding
```

Expected: typecheck clean on both packages; the full Vitest suite green (690 pre-existing (per
REPO-FACTS §14) + A3's own additions once A3 is merged + this plan's additions: 8 in
`related-line.test.ts`, 1 modified + 1 appended in `default-template.test.ts`, ~9 appended across
`wire-schema.test.ts` [1 for RefineKindEnum + 2 for LookupResultSchema + 1 for
SavedWordEntrySchema + 5 for the new saved.setRelated describe block], 4 appended in
`saved-words-policy.test.ts`, 3 appended in `router.test.ts`, 3 appended in
`gemini-lookup-client.test.ts`, 1 modified in `lookup-card.test.ts`, 1 modified in
`inline-bottom-sheet-renderer.test.ts`); lint/format clean; Chrome build succeeds with the env key
cleared; `b13-related-words.spec.ts` (4 tests) and the regression guards
(`a3-follow-up-chips` — shares `lookup-card.ts`/`content.ts`/the wire schema; `saved-word` —
shares the save-payload/persistence path this card's Task 5 extends; `cache-history` — shares the
cache-bypass guard pattern this card's `related` kind inherits; `idiom-expansion` — shares
`lookup-card.ts`; `onboarding` — shares `content.ts`) all pass.

- [ ] **Step 4: Commit + open the PR.**

```
git add packages/extension-chrome/e2e/b13-related-words.spec.ts packages/extension-chrome/e2e/a3-follow-up-chips.spec.ts
git commit -m "[B13RelatedWords] feat: e2e coverage for related words persistence + fix A3's 4-chip e2e assertion (B13)"
```

Open the PR: title `[B13RelatedWords] Related words on save`, body follows the repo's de facto
PR-body convention (no `.github/PULL_REQUEST_TEMPLATE.md` file exists — confirmed absent in
REPO-FACTS §13; treat "Testing performed" as the required section per owner ruling 2026-07-16),
including:

- **Description** (1-3 sentences): what changed + why, per this plan's Goal.
- **Design choices** (≤3 bullets): link to the design spec for the full rationale; call out the
  **server-side no-op persistence guarantee** (savedWordSetRelated never creates a new saved
  entry) as the one fact a reviewer must not miss.
- **JIRA ticket**: `https://prospa.atlassian.net/browse/B13RelatedWords` (branch-suffix pattern,
  per the repo's git-conventions).
- **Testing performed**: the suite counts and e2e scenario list from Step 3 above — no
  screenshots/video (owner ruling 2026-07-16).

Merge: **regular merge commit only** (squash prohibited, owner ruling 2026-07-16). Wait for CI
green before merging.
