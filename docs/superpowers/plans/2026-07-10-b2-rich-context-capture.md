# B2 Rich Context Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this
> plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** make the `translation` field on a newly-saved word (`SavedWordEntry.senses[0]
.translation`, `packages/app/src/domain/types.ts`) populate with real, model-produced content
instead of B1's placeholder `''`, while `definition`/`sentence`/`url`/`title` continue to populate
exactly as B1 already shipped them (regression-safe). Full design rationale, including why a
model-emitted signal line beats scraping the visible "Eng -> {target_lang}" section:
`docs/superpowers/specs/2026-07-10-b2-rich-context-capture-design.md`.

**The ratified schema is settled law and is NOT touched by this plan:**

```ts
export type SavedWordStatus = 'learning' | 'known';
export interface SavedWordSense {
  definition: string;
  translation: string;
  sentence: string;
  url: string;
  title: string;
}
export interface SavedWordEntry {
  word: string;
  status: SavedWordStatus;
  savedAt: number;
  senses: SavedWordSense[];
}
```

No field is added, renamed, or dropped on `SavedWordEntry`/`SavedWordSense`/`SavedWordStatus`.
This plan only changes WHAT VALUE flows into the already-existing `translation` field.

**Architecture:** mirrors A8's proven `DEFINED_AS` signal-line pattern exactly
(`packages/app/src/domain/defined-as.ts`). The code-owned `PROMPT_ENVELOPE` gains a
`{translation_instruction}` slot (sibling to the existing `{idiom_instruction}` slot) that asks
the model to always emit a `TRANSLATION: "<text>"` line, decoupled from the user-customizable
"Card format" (`outputFormat`). A new domain-pure parser strips and extracts it. The one shared
HTTP skeleton (`runHttpLookup`, `packages/app/src/app/http-lookup-client.ts`) that backs all
three provider clients (Gemini/OpenAI/Anthropic) surfaces it as a new optional
`LookupResult.translation` field. The two Chrome composition roots that build the save payload
(`content.ts`, `side-panel.ts`) read it instead of hard-coding `''`.

**Tech Stack:** TypeScript, Zod (wire schema), Vitest + happy-dom (unit), Playwright (e2e).

## Global Constraints

- Implementer: dispatch each implementation/fix task to the `hunter` subagent — never a generic
  implementer.
- **The ratified `SavedWordEntry`/`SavedWordSense`/`SavedWordStatus` shape is NOT touched by this
  plan.** Do not add, rename, remove, or restructure a field there. The only type-level addition
  in this plan is a new OPTIONAL `translation` field on the unrelated `LookupResult` type (an
  in-flight display/result type — same category as the existing `definedAs`/`provider`/
  `fallbackFrom` fields — not the persisted saved-word shape).
- **No new manifest permission, no new network call.** One extra instruction paragraph rides
  inside the SAME prompt request already made for every lookup; the new `TRANSLATION:` signal
  line is parsed from the SAME HTTP response already received. Nothing new leaves or enters the
  browser.
- **No backfill/migration for existing `saved:*` entries.** Only new saves/re-saves get a
  populated translation; entries already saved by B1 keep `translation: ''` until re-saved. This
  is the recommended v1-additive default from the dispatch, not an owner escalation.
- **Every existing regression assertion for `definition`/`sentence`/`url`/`title` population
  (`packages/app/test/app/router.test.ts`, the original B1 test in
  `packages/extension-chrome/e2e/saved-word.spec.ts`) must keep passing UNCHANGED.** This plan
  only ADDS tests/assertions; it never edits or removes an existing one.
- Safari stays untouched — the new `LookupResult.translation` field is optional, so
  `packages/extension-safari/**` compiles unchanged. If a task's own gate run surfaces a need to
  touch `packages/extension-safari/**`, STOP and report `NEEDS_CONTEXT` rather than improvising.
- `bun run lint` and `bun run format:check` clean before every commit.

---

### Task 1: `{translation_instruction}` prompt slot (`default-template.ts`, `prompt-template.ts`)

**Files:**

- Modify: `packages/app/src/domain/default-template.ts`
- Modify: `packages/app/src/domain/prompt-template.ts`
- Modify: `packages/app/test/default-template.test.ts`
- Modify: `packages/app/test/prompt-template.test.ts`

**Interfaces:** Produces `TRANSLATION_INSTRUCTION` (exported constant) and the
`{translation_instruction}` slot inside `PROMPT_ENVELOPE` — consumed by Task 3
(`http-lookup-client.ts` sends the assembled prompt; the model's compliant response is what
Task 2's parser reads).

- [ ] **Step 1: Write the failing tests.**

Append to `packages/app/test/default-template.test.ts` (add `TRANSLATION_INSTRUCTION` to the
existing import line, then add two new `describe` blocks at the end of the file):

```ts
import {
  PROMPT_ENVELOPE,
  DEFAULT_OUTPUT_FORMAT,
  IDIOM_AUTO_INSTRUCTION,
  IDIOM_FORCE_LITERAL_INSTRUCTION,
  TRANSLATION_INSTRUCTION,
} from '../src/domain/default-template';
```

```ts
describe('PROMPT_ENVELOPE (B2 translation slot)', () => {
  it('carries the {translation_instruction} placeholder', () => {
    expect(PROMPT_ENVELOPE).toContain('{translation_instruction}');
  });
});

describe('TRANSLATION_INSTRUCTION', () => {
  it('asks the model to emit a TRANSLATION line and mentions {word}/{target_lang}', () => {
    expect(TRANSLATION_INSTRUCTION).toContain('TRANSLATION:');
    expect(TRANSLATION_INSTRUCTION).toContain('{word}');
    expect(TRANSLATION_INSTRUCTION).toContain('{target_lang}');
  });
});
```

Append to `packages/app/test/prompt-template.test.ts` (new `describe` block at the end of the
file):

```ts
describe('buildPrompt translation instruction (B2)', () => {
  const vars = { word: 'bank', context: 'river bank', target_lang: 'Vietnamese' };

  it('emits a TRANSLATION instruction alongside DEFINED_AS by default', () => {
    const out = buildPrompt('1. define it', vars);
    expect(out).toContain('TRANSLATION:');
  });

  it('does not leak the {translation_instruction} slot into the final prompt', () => {
    expect(buildPrompt('1. define it', vars)).not.toContain('{translation_instruction}');
  });

  it('a custom envelope without {translation_instruction} is unaffected (opt-out, mirrors the idiom slot)', () => {
    const out = buildPrompt('FMT', vars, 'ENV {word}');
    expect(out).toBe('ENV bank');
    expect(out).not.toContain('TRANSLATION:');
  });

  it('a custom envelope WITH {translation_instruction} resolves the nested {word}/{target_lang}', () => {
    const out = buildPrompt('FMT', vars, 'E {translation_instruction}');
    expect(out).toContain('TRANSLATION:');
    expect(out).toContain('bank');
    expect(out).toContain('Vietnamese');
  });
});
```

- [ ] **Step 2: Run the tests, verify they fail**

Run: `cd packages/app && bunx vitest run test/default-template.test.ts test/prompt-template.test.ts`
Expected: FAIL — `TRANSLATION_INSTRUCTION` is not exported from `default-template.ts`, and
`PROMPT_ENVELOPE` does not contain `{translation_instruction}`.

- [ ] **Step 3: Implement.**

In `packages/app/src/domain/default-template.ts`, replace the `PROMPT_ENVELOPE` constant:

```ts
export const PROMPT_ENVELOPE = `You are a bilingual dictionary for {target_lang} learners of English.
Word/phrase: "{word}"
Sentence context: "{context}"
Page title: "{title}"

{idiom_instruction}

Output Markdown with these sections, in this exact order:
{output_format}

Constraints:
- Disambiguate the sense based on the sentence context.
- Do not include any HTML.
- Do not repeat the user's input verbatim more than once.
- Keep the response under 200 words.`;
```

with:

```ts
export const PROMPT_ENVELOPE = `You are a bilingual dictionary for {target_lang} learners of English.
Word/phrase: "{word}"
Sentence context: "{context}"
Page title: "{title}"

{idiom_instruction}

{translation_instruction}

Output Markdown with these sections, in this exact order:
{output_format}

Constraints:
- Disambiguate the sense based on the sentence context.
- Do not include any HTML.
- Do not repeat the user's input verbatim more than once.
- Keep the response under 200 words.`;
```

Then append this new exported constant directly after `IDIOM_FORCE_LITERAL_INSTRUCTION` (end of
file):

```ts
/**
 * B2 — rich context capture. Asks the model to emit a machine-parseable TRANSLATION signal line
 * immediately after DEFINED_AS, decoupled from the user-customizable Card format
 * (`{output_format}`) so a saved word's translation survives no matter how the reader has
 * renamed/reordered/removed the visible "Eng -> {target_lang}" section. Read by
 * domain/translation-line.ts's parseTranslation, which strips the line before the markdown
 * reaches the card — same contract as parseDefinedAs/DEFINED_AS above.
 */
export const TRANSLATION_INSTRUCTION = `Immediately after the DEFINED_AS line, before any other output, also emit exactly this line:
TRANSLATION: "<a natural, concise {target_lang} translation of the meaning of "{word}" in this context>"`;
```

In `packages/app/src/domain/prompt-template.ts`, change the import:

```ts
import {
  PROMPT_ENVELOPE,
  IDIOM_AUTO_INSTRUCTION,
  IDIOM_FORCE_LITERAL_INSTRUCTION,
} from './default-template';
```

to:

```ts
import {
  PROMPT_ENVELOPE,
  IDIOM_AUTO_INSTRUCTION,
  IDIOM_FORCE_LITERAL_INSTRUCTION,
  TRANSLATION_INSTRUCTION,
} from './default-template';
```

Then in `buildPrompt`, change:

```ts
const idiomInstruction = forceLiteral ? IDIOM_FORCE_LITERAL_INSTRUCTION : IDIOM_AUTO_INSTRUCTION;
composed = composed.includes('{idiom_instruction}')
  ? composed.replace('{idiom_instruction}', idiomInstruction)
  : composed;
return renderTemplate(composed, { ...vars, title: redactPII(vars.title ?? '') });
```

to:

```ts
const idiomInstruction = forceLiteral ? IDIOM_FORCE_LITERAL_INSTRUCTION : IDIOM_AUTO_INSTRUCTION;
composed = composed.includes('{idiom_instruction}')
  ? composed.replace('{idiom_instruction}', idiomInstruction)
  : composed;
composed = composed.includes('{translation_instruction}')
  ? composed.replace('{translation_instruction}', TRANSLATION_INSTRUCTION)
  : composed;
return renderTemplate(composed, { ...vars, title: redactPII(vars.title ?? '') });
```

- [ ] **Step 4: Run the tests, verify they pass**

Run: `cd packages/app && bunx vitest run test/default-template.test.ts test/prompt-template.test.ts`
Expected: PASS — all tests in both files green (including every pre-existing test; none were
modified).

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/domain/default-template.ts packages/app/src/domain/prompt-template.ts \
  packages/app/test/default-template.test.ts packages/app/test/prompt-template.test.ts
git commit -m "feat(b2): add {translation_instruction} prompt slot"
```

---

### Task 2: `translation-line.ts` — pure parser for the TRANSLATION signal line

**Files:**

- Create: `packages/app/src/domain/translation-line.ts`
- Create: `packages/app/test/translation-line.test.ts`

**Interfaces:** Produces `parseTranslation(markdown: string): { translation?: string; body:
string }` — consumed by Task 3 (`http-lookup-client.ts`).

- [ ] **Step 1: Write the failing test** — create `packages/app/test/translation-line.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseTranslation } from '../src/domain/translation-line';

describe('parseTranslation', () => {
  it('extracts a TRANSLATION line and strips it (plus one following blank line)', () => {
    const md = 'TRANSLATION: "ngân hàng"\n\n## bank\nA financial institution.';
    const out = parseTranslation(md);
    expect(out.translation).toBe('ngân hàng');
    expect(out.body).toBe('## bank\nA financial institution.');
  });

  it('returns the ENTIRE original text unchanged when no TRANSLATION line is present (graceful degradation)', () => {
    const md = '## bank\nA financial institution.';
    const out = parseTranslation(md);
    expect(out.translation).toBeUndefined();
    expect(out.body).toBe(md);
  });

  it('tolerates the line appearing after leading whitespace/blank lines', () => {
    const md = '\n\nTRANSLATION: "bỏ cuộc"\n## give up\nTo stop trying.';
    const out = parseTranslation(md);
    expect(out.translation).toBe('bỏ cuộc');
    expect(out.body).toBe('## give up\nTo stop trying.');
  });

  it('does not strip anything beyond the matched line and its one following blank line', () => {
    const md = 'TRANSLATION: "x"\n\n\n## x\nmeaning';
    const out = parseTranslation(md);
    expect(out.body).toBe('\n## x\nmeaning');
  });

  it('finds the TRANSLATION line even when it is not the first line (real pipeline order: DEFINED_AS is stripped first)', () => {
    const md = '## kick the bucket\nTRANSLATION: "chết"\n\nTo die.';
    const out = parseTranslation(md);
    expect(out.translation).toBe('chết');
    expect(out.body).toBe('## kick the bucket\nTo die.');
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `cd packages/app && bunx vitest run test/translation-line.test.ts`
Expected: FAIL — cannot find module `../src/domain/translation-line`.

- [ ] **Step 3: Implement.** Create `packages/app/src/domain/translation-line.ts`:

```ts
/**
 * B2 — rich context capture. Extracts the model's TRANSLATION signal line (emitted per
 * PROMPT_ENVELOPE's {translation_instruction} slot — see default-template.ts) from the raw
 * response text, and returns the remaining body with that line (plus one immediately following
 * blank line) stripped.
 *
 * Mirrors parseDefinedAs's contract exactly (domain/defined-as.ts) — decoupled from the
 * user-customizable Card format (`outputFormat`) so a saved word's translation is captured
 * reliably regardless of how the reader has edited (or removed) the visible
 * "Eng -> {target_lang}" section.
 *
 * Pure text processing — no translation happens here. If the model didn't emit a recognisable
 * TRANSLATION line (legacy cached/history entries, a non-compliant model, or a custom prompt
 * envelope override that omits {translation_instruction}), `translation` is undefined and `body`
 * is the ENTIRE input text unchanged — a strict superset of pre-B2 behavior.
 *
 * Domain-pure: zero imports (rule-domain-purity).
 */
const TRANSLATION_LINE = /^TRANSLATION:\s*"([^"]+)"[ \t]*$/m;

export function parseTranslation(markdown: string): { translation?: string; body: string } {
  const match = TRANSLATION_LINE.exec(markdown);
  if (!match) return { body: markdown };
  const [line, translation] = match;
  // Leading whitespace/blank lines (or preceding text) before the matched line are trimmed.
  const before = markdown.slice(0, match.index).trim();
  // Strip the matched line's own line terminator, then (at most) one following blank line's
  // terminator — anything beyond that single blank line survives in the body untouched.
  const after = markdown
    .slice(match.index + line.length)
    .replace(/^\n/, '')
    .replace(/^\n/, '');
  return {
    translation: translation!,
    body: before ? `${before}\n${after}` : after,
  };
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `cd packages/app && bunx vitest run test/translation-line.test.ts`
Expected: PASS — all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/domain/translation-line.ts packages/app/test/translation-line.test.ts
git commit -m "feat(b2): translation-line parser (mirrors defined-as's signal-line contract)"
```

---

### Task 3: Wire `translation` into `LookupResult` — types, wire schema, `runHttpLookup`

**Files:**

- Modify: `packages/app/src/domain/types.ts`
- Modify: `packages/app/src/wire.ts`
- Modify: `packages/app/src/app/http-lookup-client.ts`
- Modify: `packages/app/test/app/gemini-lookup-client.test.ts`
- Modify: `packages/app/test/wire-schema.test.ts`

**Interfaces:** `LookupResult` gains `translation?: string | undefined`. Consumed by Task 4
(`content.ts`/`side-panel.ts` read `result.translation` when building the save payload).

- [ ] **Step 1: Write the failing tests.**

Append to `packages/app/test/app/gemini-lookup-client.test.ts` (new `describe` block at the end of
the file, after the existing `'A8 idiom expansion via runHttpLookup'` block):

```ts
describe('B2 translation extraction via runHttpLookup', () => {
  it('a DEFINED_AS + TRANSLATION pair is parsed into result.translation and both lines are stripped from markdown', async () => {
    const body = {
      candidates: [
        {
          content: {
            parts: [
              {
                text: 'DEFINED_AS: "bank" | literal\nTRANSLATION: "ngân hàng"\n\n## bank\nA financial institution.',
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
    expect(out.markdown).toBe('## bank\nA financial institution.');
  });

  it('a response with DEFINED_AS but no TRANSLATION line leaves translation undefined (back-compat)', async () => {
    const body = {
      candidates: [
        {
          content: {
            parts: [{ text: 'DEFINED_AS: "bank" | literal\n\n## bank\nA financial institution.' }],
          },
        },
      ],
    };
    const c = client(() => Promise.resolve(res({ ok: true, status: 200, body })));
    const out = await c.lookup(req);
    expect(out.translation).toBeUndefined();
    expect(out.markdown).toBe('## bank\nA financial institution.');
  });

  it('a response with neither DEFINED_AS nor TRANSLATION leaves both undefined and markdown unchanged (regression guard)', async () => {
    const c = client(() => Promise.resolve(res({ ok: true, status: 200, body: okBody })));
    const out = await c.lookup(req);
    expect(out.definedAs).toBeUndefined();
    expect(out.translation).toBeUndefined();
    expect(out.markdown).toBe('# def');
  });

  it('the sent prompt includes the TRANSLATION instruction by default', async () => {
    let captured: { url: string; init: Parameters<FetchLike>[1] } | null = null;
    const c = client((url, init) => {
      captured = { url, init };
      return Promise.resolve(res({ ok: true, status: 200, body: okBody }));
    });
    await c.lookup(req);
    const sent =
      (JSON.parse(captured!.init.body) as { contents: { parts: { text: string }[] }[] }).contents[0]
        ?.parts[0]?.text ?? '';
    expect(sent).toContain('TRANSLATION:');
  });
});
```

Append to `packages/app/test/wire-schema.test.ts` (new test inside the existing top-level
`describe` block, directly after the `'lookup result carries an optional definedAs...'` test):

```ts
it('lookup result carries an optional translation; back-compat with results that omit it', () => {
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
      result: { ...result, translation: 'ngân hàng' },
    }).success,
  ).toBe(true);
  // Old-shaped result (no translation) still parses — back-compat.
  expect(
    WireReplySchema.safeParse({ ok: true, type: 'lookup', requestId: '1', result }).success,
  ).toBe(true);
});
```

- [ ] **Step 2: Run the tests, verify they fail**

Run:
`cd packages/app && bunx vitest run test/app/gemini-lookup-client.test.ts test/wire-schema.test.ts`
Expected: FAIL — `out.translation` is `undefined` in the new positive-case test (property doesn't
exist yet / isn't parsed), and the wire schema test fails because `LookupResultSchema` rejects the
unknown `translation` key (`z.strictObject`).

- [ ] **Step 3: Implement.**

In `packages/app/src/domain/types.ts`, inside the `LookupResult` interface, add a new field
directly after the existing `definedAs` field (end of the interface, before its closing `}`):

```ts
  /**
   * A8: the unit the model actually defined — its literal selection, or, when the selection is
   * part of an idiom/phrasal verb, the whole idiomatic unit. Stamped by the shared HTTP lookup
   * skeleton from the model's DEFINED_AS line (see domain/defined-as.ts). Absent when the model
   * didn't emit a recognisable line (legacy cached/history entries, a non-compliant model, or a
   * custom envelope override that omits the instruction) — never blocks rendering.
   */
  definedAs?: { term: string; isIdiom: boolean } | undefined;
```

to:

```ts
  /**
   * A8: the unit the model actually defined — its literal selection, or, when the selection is
   * part of an idiom/phrasal verb, the whole idiomatic unit. Stamped by the shared HTTP lookup
   * skeleton from the model's DEFINED_AS line (see domain/defined-as.ts). Absent when the model
   * didn't emit a recognisable line (legacy cached/history entries, a non-compliant model, or a
   * custom envelope override that omits the instruction) — never blocks rendering.
   */
  definedAs?: { term: string; isIdiom: boolean } | undefined;
  /**
   * B2: the model's direct {target_lang} translation of the word's meaning, extracted from the
   * TRANSLATION: "..." signal line (see domain/translation-line.ts's parseTranslation) —
   * decoupled from the user-customizable Card format so it survives regardless of how the reader
   * has edited the visible "Eng -> {target_lang}" section. Absent when the model didn't emit a
   * recognisable line (legacy cached/history entries, a non-compliant model, or a custom prompt
   * envelope override that omits {translation_instruction}) — never blocks rendering; saved-word
   * writers fall back to '' exactly as B1 already does. NOT part of the ratified SavedWordEntry
   * shape — this is display/result metadata on LookupResult only.
   */
  translation?: string | undefined;
```

In `packages/app/src/wire.ts`, inside `LookupResultSchema`, change:

```ts
const LookupResultSchema = z.strictObject({
  markdown: z.string(),
  word: z.string(),
  target: z.string(),
  // Display-only model id; non-empty string rather than a per-provider literal
  // so adding a provider never requires a wire-schema change.
  model: z.string().min(1),
  fromCache: z.boolean(),
  fetchedAt: z.number(),
  provider: ProviderEnum.optional(),
  fallbackFrom: ProviderEnum.optional(),
  // A8: the idiom/literal unit actually defined; absent for legacy/non-compliant responses.
  definedAs: DefinedAsSchema.optional(),
});
```

to:

```ts
const LookupResultSchema = z.strictObject({
  markdown: z.string(),
  word: z.string(),
  target: z.string(),
  // Display-only model id; non-empty string rather than a per-provider literal
  // so adding a provider never requires a wire-schema change.
  model: z.string().min(1),
  fromCache: z.boolean(),
  fetchedAt: z.number(),
  provider: ProviderEnum.optional(),
  fallbackFrom: ProviderEnum.optional(),
  // A8: the idiom/literal unit actually defined; absent for legacy/non-compliant responses.
  definedAs: DefinedAsSchema.optional(),
  // B2: the model's direct target-language translation; absent for legacy/non-compliant
  // responses or a custom envelope override that omits {translation_instruction}.
  translation: z.string().optional(),
});
```

In `packages/app/src/app/http-lookup-client.ts`, add the import:

```ts
import { parseDefinedAs } from '../domain/defined-as';
```

to:

```ts
import { parseDefinedAs } from '../domain/defined-as';
import { parseTranslation } from '../domain/translation-line';
```

Then change:

```ts
const { definedAs, body: parsedBody } = parseDefinedAs(text);
return {
  markdown: parsedBody,
  word: req.word,
  target: req.target,
  model: spec.model,
  provider: spec.provider,
  fromCache: false,
  fetchedAt: Date.now(),
  ...(definedAs !== undefined ? { definedAs } : {}),
};
```

to:

```ts
const { definedAs, body: afterDefinedAs } = parseDefinedAs(text);
const { translation, body: parsedBody } = parseTranslation(afterDefinedAs);
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
};
```

- [ ] **Step 4: Run the tests, verify they pass**

Run:
`cd packages/app && bunx vitest run test/app/gemini-lookup-client.test.ts test/wire-schema.test.ts`
Expected: PASS — all tests in both files green (including every pre-existing test; none were
modified).

Then run the full app package suite + typecheck (proves the `AssertEqual` drift guard in
`wire.ts` still holds and every OpenAI/Anthropic client test — which also routes through
`runHttpLookup` — is unaffected):

Run: `cd packages/app && bun run typecheck && bunx vitest run`
Expected: both exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/domain/types.ts packages/app/src/wire.ts \
  packages/app/src/app/http-lookup-client.ts \
  packages/app/test/app/gemini-lookup-client.test.ts packages/app/test/wire-schema.test.ts
git commit -m "feat(b2): surface LookupResult.translation from the parsed TRANSLATION signal"
```

---

## Checkpoint: dispatch a `skinner` audit here

After Task 3, the entire core logic change is complete and covered by unit tests (prompt slot,
parser, wire, all three provider clients via the shared skeleton). Before continuing to the
composition-root wiring and e2e/evidence tasks, dispatch a `skinner` audit against the diff so
far, pointed at this plan + the design spec. Fix any Critical/Important finding (capped at 3
rounds per the Warchief's own governance) before proceeding to Task 4.

---

### Task 4: Populate the save payload — `content.ts` + `side-panel.ts`

**Files:**

- Modify: `packages/extension-chrome/src/content.ts`
- Modify: `packages/extension-chrome/src/side-panel.ts`

**Interfaces:** None new — these are composition roots, excluded from the unit coverage gate;
correctness is proven by Task 5's e2e spec against the built extension (same precedent as B1's
Task 9/Task 10).

- [ ] **Step 1: Implement directly** (no unit test — composition roots are e2e-verified only).

In `packages/extension-chrome/src/content.ts`, inside the `renderResult(r, ctx)` handler, change:

```ts
    renderResult(r, ctx) {
      lastFocus = { state: 'result', payload: r };
      lastSavePayload = {
        word: r.word,
        definition: r.markdown,
        translation: '',
        sentence: ctx?.sentence ?? '',
        url: ctx?.url ?? '',
        title: ctx?.title ?? '',
      };
```

to:

```ts
    renderResult(r, ctx) {
      lastFocus = { state: 'result', payload: r };
      lastSavePayload = {
        word: r.word,
        definition: r.markdown,
        // B2: real translation from the parsed TRANSLATION signal line, when the model emitted
        // one; '' fallback preserves B1's exact behavior for legacy/non-compliant responses.
        translation: r.translation ?? '',
        sentence: ctx?.sentence ?? '',
        url: ctx?.url ?? '',
        title: ctx?.title ?? '',
      };
```

In `packages/extension-chrome/src/side-panel.ts`, inside `trackSaveContext`, change:

```ts
function trackSaveContext(
  r: LookupResult,
  extra: {
    sentence?: string | undefined;
    url?: string | undefined;
    title?: string | undefined;
  } = {},
): void {
  lastSavePayload = {
    word: r.word,
    definition: r.markdown,
    translation: '',
    sentence: extra.sentence ?? '',
    url: extra.url ?? '',
    title: extra.title ?? '',
  };
  lastSaved = false;
}
```

to:

```ts
function trackSaveContext(
  r: LookupResult,
  extra: {
    sentence?: string | undefined;
    url?: string | undefined;
    title?: string | undefined;
  } = {},
): void {
  lastSavePayload = {
    word: r.word,
    definition: r.markdown,
    // B2: real translation from the parsed TRANSLATION signal line, when the model emitted
    // one; '' fallback preserves B1's exact behavior for legacy/non-compliant responses.
    translation: r.translation ?? '',
    sentence: extra.sentence ?? '',
    url: extra.url ?? '',
    title: extra.title ?? '',
  };
  lastSaved = false;
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `cd packages/extension-chrome && bun run typecheck && cd .. && bun run lint`
Expected: both exit 0.

- [ ] **Step 3: Commit**

```bash
git add packages/extension-chrome/src/content.ts packages/extension-chrome/src/side-panel.ts
git commit -m "feat(b2): read real translation into the save payload (in-page card + side panel)"
```

---

### Task 5: e2e coverage — real translation persisted + regression guard on the other fields

**Files:**

- Modify: `packages/extension-chrome/e2e/saved-word.spec.ts`

**Interfaces:** Uses the existing `mockGemini`/`seedSettings`/`gotoFixture`/`selectWord`/
`openTrigger`/`storageDump` helpers (`packages/extension-chrome/e2e/helpers.ts`) unmodified. Adds
one new mock-response constant local to the spec file. Does NOT modify any existing `test(...)`
block in this file — the original B1 tests (including the `translation).toBe('')` assertion on
the default mock body) stay byte-for-byte as they are, since they remain valid regression
coverage: the default `GEMINI_OK_BODY` fixture has no signal lines, so `translation` correctly
stays `''` there, exactly as B1 shipped it.

- [ ] **Step 1: Write the new tests** — append to
      `packages/extension-chrome/e2e/saved-word.spec.ts`, as a new `test.describe` block placed
      directly after the closing `});` of the existing `'B1 save word (star)'` describe block (do
      not touch anything inside that existing block):

```ts
const GEMINI_WITH_TRANSLATION_BODY = JSON.stringify({
  candidates: [
    {
      content: {
        parts: [
          {
            text: 'DEFINED_AS: "bank" | literal\nTRANSLATION: "ngân hàng"\n\n## bank\nA financial institution.',
          },
        ],
      },
    },
  ],
});

test.describe('B2 rich context capture (translation)', () => {
  test('tapping the star persists a real translation when the model emits a TRANSLATION line', async ({
    context,
    extensionId,
  }) => {
    await mockGemini(context, { body: GEMINI_WITH_TRANSLATION_BODY });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);
    await doLookup(page);

    // The visible card never leaks the machine-readable signal lines.
    await expect(page.locator('bottom-sheet lookup-card')).not.toContainText('TRANSLATION:');
    await expect(page.locator('bottom-sheet lookup-card')).not.toContainText('DEFINED_AS:');

    const star = page.locator('bottom-sheet lookup-card .save-btn');
    await star.click();
    await expect.poll(async () => (await storageDump(page))['saved:bank']).toBeDefined();

    const dump = await storageDump(page);
    const entry = JSON.parse(dump['saved:bank'] as string);
    // New in B2: translation is populated with real content, not ''.
    expect(entry.senses[0].translation).toBe('ngân hàng');
    // Regression guard (B1): definition/sentence/url/title are still correctly populated and
    // the machine-readable signal lines never leak into the stored definition.
    expect(entry.senses[0].definition).toContain('financial institution');
    expect(entry.senses[0].definition).not.toContain('TRANSLATION:');
    expect(entry.senses[0].definition).not.toContain('DEFINED_AS:');
    expect(entry.senses[0].sentence.length).toBeGreaterThan(0);
    expect(typeof entry.senses[0].url).toBe('string');
    expect(typeof entry.senses[0].title).toBe('string');
  });

  test('a mocked response with no TRANSLATION line still saves translation as "" (B1 back-compat)', async ({
    context,
    extensionId,
  }) => {
    await mockGemini(context); // default GEMINI_OK_BODY — no signal lines at all
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);
    await doLookup(page);

    await page.locator('bottom-sheet lookup-card .save-btn').click();
    await expect.poll(async () => (await storageDump(page))['saved:bank']).toBeDefined();

    const dump = await storageDump(page);
    const entry = JSON.parse(dump['saved:bank'] as string);
    expect(entry.senses[0].translation).toBe('');
    expect(entry.senses[0].definition).toContain('financial institution');
  });
});
```

- [ ] **Step 2: Build the extension, then run the new + existing specs**

Run: `bun run build:chrome && cd packages/extension-chrome && bunx playwright test saved-word`
Expected: PASS — all 6 tests green (4 pre-existing B1 tests, unmodified, + 2 new B2 tests). (First
run: `bunx playwright install --with-deps chromium` if the browser isn't installed yet.)

- [ ] **Step 3: Full gate verification**

Run, in order, from the repo root:

```bash
bun run lint
bun run format:check
bun run typecheck
bun run test
bun run build:chrome
bun run build:safari
```

Expected: every command exits 0. If `format:check` fails, run `bun run format` and re-verify.
`build:safari` must stay green — proof the Safari shell composes the changed core cleanly (no
Safari-specific code was touched anywhere in this plan).

- [ ] **Step 4: Commit**

```bash
git add packages/extension-chrome/e2e/saved-word.spec.ts
git commit -m "test(b2): e2e coverage — real translation persisted, empty-translation back-compat guard"
```

---

### Task 6: Before/after evidence spec (storage-dump screenshot, gated, not run in CI)

**Files:**

- Create: `packages/extension-chrome/e2e/b2-evidence.spec.ts`

**Interfaces:** None (evidence-only, gated, not part of the normal suite — mirrors
`packages/extension-chrome/e2e/b1-evidence.spec.ts`'s exact gating mechanism). This is a
data-completeness fix, not a new visible interaction (the star/save UI is pixel-identical to
B1), so the evidence is a screenshot of the actual persisted JSON entry, not a UI-flow video.

- [ ] **Step 1: Write the evidence spec** — create
      `packages/extension-chrome/e2e/b2-evidence.spec.ts`:

```ts
/**
 * B2 before/after evidence: a storage-dump screenshot proving the saved entry's `translation`
 * field is populated with real content (not '') after the save flow, while
 * definition/sentence/url/title stay correctly populated (regression-safe vs B1). This is a
 * data-completeness fix, not a new visible interaction — the star/save UI is pixel-identical to
 * B1 — so the evidence is a screenshot of the actual persisted JSON, not a UI-flow video.
 * Not part of the normal suite. (Re)record with:
 *   PLAYWRIGHT_RUN_EVIDENCE=1 SHOT_LABEL=after B2_OUT_DIR=/abs/path \
 *     bunx playwright test b2-evidence
 * Capture BEFORE from a `master` build (no TRANSLATION parsing exists — translation stays '')
 * and AFTER from the branch build (translation is real text), then host the .png per the
 * private-repo rule (pr-assets branch + same-origin github.com/.../raw URLs).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { test, chromium } from '@playwright/test';
import { seedSettings, gotoFixture, selectWord, openTrigger, GEMINI_OK_BODY } from './helpers';
import { E2E_HEADLESS } from '../playwright.config';

const RUN = process.env.PLAYWRIGHT_RUN_EVIDENCE === '1';
const LABEL = process.env.SHOT_LABEL ?? 'after';
const OUT = process.env.B2_OUT_DIR ?? '.';
const here = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(here, '../dist');
const SIZE = { width: 900, height: 700 };

// AFTER only: a mock response with a real TRANSLATION line — what the branch's new
// {translation_instruction} prompt actually elicits from a compliant model. BEFORE uses the
// plain default body (no signal lines at all), accurately representing what master returns and
// stores today (master has no TRANSLATION parsing to strip the line even if it were present).
const GEMINI_WITH_TRANSLATION_BODY = JSON.stringify({
  candidates: [
    {
      content: {
        parts: [
          {
            text: 'DEFINED_AS: "bank" | literal\nTRANSLATION: "ngân hàng"\n\n## bank\nA financial institution.',
          },
        ],
      },
    },
  ],
});

test.describe('B2 rich context capture — evidence', () => {
  test.skip(!RUN, 'set PLAYWRIGHT_RUN_EVIDENCE=1 to (re)record B2 before/after screenshots');

  test(`select → Define → star → Saved, storage dump (${LABEL})`, async () => {
    const context = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        ...(E2E_HEADLESS ? ['--headless=new'] : []),
        `--disable-extensions-except=${distDir}`,
        `--load-extension=${distDir}`,
      ],
      viewport: SIZE,
    });
    try {
      const body = LABEL === 'after' ? GEMINI_WITH_TRANSLATION_BODY : GEMINI_OK_BODY;
      await context.route('https://generativelanguage.googleapis.com/**', (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body }),
      );

      const page = await context.newPage();
      const [sw] = context.serviceWorkers();
      const worker = sw ?? (await context.waitForEvent('serviceworker', { timeout: 10_000 }));
      const extensionId = new URL(worker.url()).hostname;

      await page.goto(`chrome-extension://${extensionId}/options.html`);
      await seedSettings(page);
      await gotoFixture(page);
      await page.waitForTimeout(800);

      await selectWord(page, 't', 'bank');
      await openTrigger(page);
      await page.waitForTimeout(1_000);

      await page.locator('bottom-sheet lookup-card .save-btn').click();
      await page.waitForTimeout(800);

      const dump: Record<string, unknown> = await worker.evaluate(
        () => chrome.storage.local.get(null) as Promise<Record<string, unknown>>,
      );
      const entry: unknown = dump['saved:bank'] ? JSON.parse(dump['saved:bank'] as string) : null;

      await page.evaluate(
        (json) => {
          const pre = document.createElement('pre');
          pre.id = 'b2-evidence-dump';
          pre.textContent = json;
          pre.style.cssText =
            'position:fixed;top:0;left:0;right:0;bottom:0;margin:0;background:#fdf6e3;' +
            'color:#3b3b3b;padding:32px;font:16px/1.6 ui-monospace,monospace;z-index:999999;' +
            'white-space:pre-wrap;overflow:auto;box-sizing:border-box';
          document.body.appendChild(pre);
        },
        JSON.stringify({ 'saved:bank': entry }, null, 2),
      );
      await page.waitForTimeout(300);

      await mkdir(OUT, { recursive: true });
      await page.screenshot({ path: path.join(OUT, `b2-${LABEL}.png`) });
    } finally {
      await context.close().catch(() => {});
    }
  });
});
```

- [ ] **Step 2: Confirm the gated spec is skipped in the normal run** (it must never run in CI)

Run: `cd packages/extension-chrome && bunx playwright test b2-evidence`
Expected: 1 test SKIPPED (not run) — because `PLAYWRIGHT_RUN_EVIDENCE` is unset in this run.

- [ ] **Step 3: Commit**

```bash
git add packages/extension-chrome/e2e/b2-evidence.spec.ts
git commit -m "test(b2): before/after evidence recording spec (gated, not run in CI)"
```

---

## After all tasks: evidence capture + PR (Warchief, not a Hunter task)

1. Create a scratch `master` worktree (e.g. `.claude/worktrees/b2-evidence-master-scratch`),
   `bun install` there. Copy `packages/extension-chrome/e2e/b2-evidence.spec.ts` from this branch
   into that scratch checkout (its only imports — `seedSettings`, `gotoFixture`, `selectWord`,
   `openTrigger`, `GEMINI_OK_BODY`, `E2E_HEADLESS` — already exist on `master` since B1/A8
   shipped them, so no other file needs copying). `bun run build:chrome` there, then run
   `PLAYWRIGHT_RUN_EVIDENCE=1 SHOT_LABEL=before B2_OUT_DIR=/private/tmp/b2-evidence bunx
playwright test b2-evidence` to capture BEFORE (`translation: ''`).
2. On this branch, `bun run build:chrome`, then run
   `PLAYWRIGHT_RUN_EVIDENCE=1 SHOT_LABEL=after B2_OUT_DIR=/private/tmp/b2-evidence bunx
playwright test b2-evidence` to capture AFTER (`translation: "ngân hàng"`,
   definition/sentence/url/title still correctly populated in the same dump).
3. Push both `.png` files to a throwaway `pr-assets/b2-rich-context-capture` branch; embed via
   same-origin `https://github.com/hieplam/ai-dict/raw/pr-assets/b2-rich-context-capture/<file>`
   URLs only.
4. Remove the scratch `master` worktree.
5. Full-branch `skinner` audit against this plan + the design spec before opening the PR.
6. Open the PR into `master` with the embedded evidence, wait for CI green, squash-merge.
