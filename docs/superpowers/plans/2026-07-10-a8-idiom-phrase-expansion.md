# A8 Phrase & Idiom Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this
> plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Guarantee that when a reader's selection is part of an idiom or phrasal verb, the card
defines the whole idiomatic unit and labels it — with one tap ("Show literal word") to force the
literal single-word reading instead. Per the roadmap: card shows **defined as "kick the bucket"
(idiom): to die**, with one tap to force the literal single word.

**Architecture:** All behavior lives in `packages/app/src/**` (the portable core, `c3-1`). The
model is asked to emit one machine-parseable `DEFINED_AS: "<term>" | idiom|literal` line as the
first line of its response (prompt instruction, code-owned envelope — never user-editable); a
pure domain parser strips and reads that line; the result flows through the existing
`LookupResult`/`ResultRenderContext`/`CardState` plumbing exactly like the existing
`provider`/`switch-provider` one-shot-override feature. Zero changes to
`packages/extension-chrome/**` or `packages/extension-safari/**` — both shells inherit this for
free because both compose the same `runLookupWorkflow` + `InlineBottomSheetRenderer` +
`<lookup-card>` from the core. Full design rationale:
`docs/superpowers/specs/2026-07-10-a8-idiom-phrase-expansion-design.md`.

**Tech Stack:** TypeScript, Zod (wire schema), Vitest + happy-dom (unit), Playwright (e2e).

## Global Constraints

- Implementer: dispatch each implementation/fix task to the `hunter` subagent — never a generic
  implementer.
- **No idiom-detection engine** (roadmap A8 scope fence) — all idiom/phrasal-verb detection is
  delegated to the model via the prompt instruction; our code only parses a structured signal
  and degrades gracefully (no label) when the model doesn't emit it. Never write heuristic
  detection logic.
- **No new manifest permission, no wire-protocol surface beyond the two new optional fields**
  (`LookupRequest.forceLiteral`, `LookupResult.definedAs`) — both guarded by the existing
  compile-time `AssertEqual` drift check in `packages/app/src/wire.ts`.
- **No change to `packages/extension-chrome/**`or`packages/extension-safari/**`** in this plan
  — everything routes through the shared core (`ref-core-dependency-rule`). If a task's own
  gate run surfaces a need to touch a shell file, STOP and report `NEEDS_CONTEXT` rather than
  improvising.
- UI additions read only `--ad-*`/`--adp-*` design tokens (no hard-coded colors) — the new
  `.defined-as__literal-btn` is a visual twin of the existing `.prov-switch` button.
- `bun run lint` and `bun run format:check` clean before every commit.

---

### Task 1: `parseDefinedAs` — pure DEFINED_AS line parser

**Files:**

- Create: `packages/app/src/domain/defined-as.ts`
- Create: `packages/app/test/defined-as.test.ts`

**Interfaces:** Produces `DefinedAs` (`{ term: string; isIdiom: boolean }`) and
`parseDefinedAs(markdown: string): { definedAs?: DefinedAs; body: string }` — consumed by Task 5
(`http-lookup-client.ts`).

- [ ] **Step 1: Write the failing test** — `packages/app/test/defined-as.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseDefinedAs } from '../src/domain/defined-as';

describe('parseDefinedAs', () => {
  it('extracts an idiom DEFINED_AS line and strips it (plus one following blank line)', () => {
    const md = 'DEFINED_AS: "kick the bucket" | idiom\n\n## kick the bucket\nTo die.';
    const out = parseDefinedAs(md);
    expect(out.definedAs).toEqual({ term: 'kick the bucket', isIdiom: true });
    expect(out.body).toBe('## kick the bucket\nTo die.');
  });

  it('extracts a literal DEFINED_AS line', () => {
    const md = 'DEFINED_AS: "bucket" | literal\n\n## bucket\nA pail.';
    const out = parseDefinedAs(md);
    expect(out.definedAs).toEqual({ term: 'bucket', isIdiom: false });
    expect(out.body).toBe('## bucket\nA pail.');
  });

  it('returns the ENTIRE original text unchanged when no DEFINED_AS line is present (graceful degradation)', () => {
    const md = '## bank\nA financial institution.';
    const out = parseDefinedAs(md);
    expect(out.definedAs).toBeUndefined();
    expect(out.body).toBe(md);
  });

  it('tolerates the line appearing after leading whitespace/blank lines', () => {
    const md = '\n\nDEFINED_AS: "give up" | idiom\n## give up\nTo stop trying.';
    const out = parseDefinedAs(md);
    expect(out.definedAs).toEqual({ term: 'give up', isIdiom: true });
    expect(out.body).toBe('## give up\nTo stop trying.');
  });

  it('does not strip anything beyond the matched line and its one following blank line', () => {
    const md = 'DEFINED_AS: "x" | literal\n\n\n## x\nmeaning';
    const out = parseDefinedAs(md);
    // Only ONE following blank line is consumed; the second blank line survives in body.
    expect(out.body).toBe('\n## x\nmeaning');
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `cd packages/app && bunx vitest run test/defined-as.test.ts`
Expected: FAIL — cannot find module `../src/domain/defined-as`.

- [ ] **Step 3: Implement** — `packages/app/src/domain/defined-as.ts`:

```ts
/**
 * A8 — phrase & idiom expansion. Extracts the model's DEFINED_AS signal line (emitted per the
 * PROMPT_ENVELOPE's idiom instruction — see default-template.ts) from the raw response text,
 * and returns the remaining body with that line (plus one immediately following blank line)
 * stripped.
 *
 * Pure text processing — no idiom detection happens here (roadmap A8 scope fence: "No
 * idiom-detection engine — the LLM already holds the sentence"). If the model didn't emit a
 * recognisable DEFINED_AS line (legacy behavior, a non-compliant model, or a custom prompt
 * envelope override that omits the instruction), `definedAs` is undefined and `body` is the
 * ENTIRE original text unchanged — a strict superset of pre-A8 behavior.
 *
 * Domain-pure: zero imports (rule-domain-purity).
 */
export interface DefinedAs {
  term: string;
  isIdiom: boolean;
}

const DEFINED_AS_LINE = /^DEFINED_AS:\s*"([^"]+)"\s*\|\s*(idiom|literal)\s*$/m;

export function parseDefinedAs(markdown: string): { definedAs?: DefinedAs; body: string } {
  const match = DEFINED_AS_LINE.exec(markdown);
  if (!match) return { body: markdown };
  const [line, term, tag] = match;
  const before = markdown.slice(0, match.index);
  const after = markdown.slice(match.index + line.length).replace(/^\n/, '');
  return { definedAs: { term: term!, isIdiom: tag === 'idiom' }, body: (before + after).trim() };
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `cd packages/app && bunx vitest run test/defined-as.test.ts`
Expected: PASS — 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/domain/defined-as.ts packages/app/test/defined-as.test.ts
git commit -m "feat(a8): pure DEFINED_AS line parser"
```

---

### Task 2: Idiom prompt instructions + `{idiom_instruction}` envelope slot

**Files:**

- Modify: `packages/app/src/domain/default-template.ts`
- Modify: `packages/app/test/default-template.test.ts`

**Interfaces:** Produces `IDIOM_AUTO_INSTRUCTION`, `IDIOM_FORCE_LITERAL_INSTRUCTION` — consumed
by Task 3 (`prompt-template.ts`). Adds `{idiom_instruction}` to `PROMPT_ENVELOPE`.

- [ ] **Step 1: Write the failing tests** — append to
      `packages/app/test/default-template.test.ts` (inside the file, after the existing
      `describe('PROMPT_ENVELOPE', …)` block's closing `});`):

```ts
describe('PROMPT_ENVELOPE (A8 idiom slot)', () => {
  it('carries the {idiom_instruction} placeholder', () => {
    expect(PROMPT_ENVELOPE).toContain('{idiom_instruction}');
  });
});

describe('IDIOM_AUTO_INSTRUCTION / IDIOM_FORCE_LITERAL_INSTRUCTION', () => {
  it('the auto instruction asks the model to emit a DEFINED_AS line and mentions {word}', () => {
    expect(IDIOM_AUTO_INSTRUCTION).toContain('DEFINED_AS:');
    expect(IDIOM_AUTO_INSTRUCTION).toContain('{word}');
    expect(IDIOM_AUTO_INSTRUCTION).toContain('idiom');
  });
  it('the force-literal instruction asks for the literal reading only and still emits DEFINED_AS', () => {
    expect(IDIOM_FORCE_LITERAL_INSTRUCTION).toContain('DEFINED_AS:');
    expect(IDIOM_FORCE_LITERAL_INSTRUCTION).toContain('{word}');
    expect(IDIOM_FORCE_LITERAL_INSTRUCTION.toLowerCase()).toContain('literal');
  });
});
```

Also widen the top import in that same test file to:

```ts
import {
  PROMPT_ENVELOPE,
  DEFAULT_OUTPUT_FORMAT,
  IDIOM_AUTO_INSTRUCTION,
  IDIOM_FORCE_LITERAL_INSTRUCTION,
} from '../src/domain/default-template';
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `cd packages/app && bunx vitest run test/default-template.test.ts`
Expected: FAIL — `IDIOM_AUTO_INSTRUCTION`/`IDIOM_FORCE_LITERAL_INSTRUCTION` are not exported yet,
and `PROMPT_ENVELOPE` does not contain `{idiom_instruction}`.

- [ ] **Step 3: Implement** — replace the full contents of
      `packages/app/src/domain/default-template.ts`:

```ts
/**
 * The prompt is assembled from two parts (see `buildPrompt` in prompt-template.ts):
 *
 *  - PROMPT_ENVELOPE — code-owned scaffold. Holds the persona, the {word}/{context}/
 *    {title} placeholders, the idiom-detection instruction slot, the safety + length
 *    constraints, and one {output_format} slot. Users cannot edit or delete any of this, so
 *    the constraints always ship (defense-in-depth for rule-sanitize-model-output).
 *  - DEFAULT_OUTPUT_FORMAT — the ONLY user-editable piece (the "Card format" field):
 *    the section layout shown in the card.
 *
 * Domain-pure: zero imports (rule-domain-purity).
 */

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

export const DEFAULT_OUTPUT_FORMAT = `1. **Eng -> Eng** — a full, complete explanation of the meaning (do not summarize long senses).
2. **Eng -> {target_lang}** — translate the full meaning into the selected language.`;

/**
 * A8 — phrase & idiom expansion. Default (auto-detect) idiom instruction: asks the model to
 * notice when the selection is part of an idiom/phrasal verb and, if so, define the whole unit
 * instead of the literal word, always prefixing its answer with a machine-parseable
 * `DEFINED_AS: "<term>" | idiom|literal` line (read by domain/defined-as.ts's parseDefinedAs).
 * "No idiom-detection engine" (roadmap scope fence) — detection is entirely the model's job;
 * this is the instruction that asks for it.
 */
export const IDIOM_AUTO_INSTRUCTION = `If "{word}" is part of an idiom, fixed expression, or phrasal verb in the sentence context (e.g. "kick the bucket", "give up"), define the WHOLE idiomatic unit — not just the selected word — and begin your response with exactly this line before any other output:
DEFINED_AS: "<the full idiom or phrasal verb, exactly as it appears in the sentence>" | idiom
Otherwise, "{word}" is used with its literal, standalone meaning; begin your response with exactly this line:
DEFINED_AS: "{word}" | literal`;

/**
 * A8 — the "Show literal word" override. Selected when LookupRequest.forceLiteral is true (the
 * card's one-shot re-run button): tells the model to ignore any idiom/phrasal-verb reading and
 * define only the literal selected word.
 */
export const IDIOM_FORCE_LITERAL_INSTRUCTION = `Define ONLY the literal, standalone word "{word}" exactly as selected, even if it is part of a larger idiom or phrasal verb in the sentence context. Do not define the idiom. Begin your response with exactly this line before any other output:
DEFINED_AS: "{word}" | literal`;
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `cd packages/app && bunx vitest run test/default-template.test.ts`
Expected: PASS — all tests green (existing + the 2 new `describe` blocks).

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/domain/default-template.ts packages/app/test/default-template.test.ts
git commit -m "feat(a8): idiom prompt instructions + envelope slot"
```

---

### Task 3: `buildPrompt` gains an optional `forceLiteral` switch

**Files:**

- Modify: `packages/app/src/domain/prompt-template.ts`
- Modify: `packages/app/test/prompt-template.test.ts`

**Interfaces:** `buildPrompt(outputFormat, vars, envelope?, forceLiteral?)` — the new 4th
parameter is consumed by Task 5 (`http-lookup-client.ts`, passing `req.forceLiteral`).

- [ ] **Step 1: Write the failing tests** — append a new `describe` block at the end of
      `packages/app/test/prompt-template.test.ts`:

```ts
describe('buildPrompt idiom instruction (A8)', () => {
  const vars = { word: 'bucket', context: 'He kicked the bucket.', target_lang: 'Vietnamese' };

  it('default (no forceLiteral) emits the auto-detect idiom instruction', () => {
    const out = buildPrompt('1. define it', vars);
    expect(out).toContain('DEFINED_AS:');
    expect(out).toContain('is part of an idiom');
  });

  it('forceLiteral=true emits the force-literal instruction, not the auto-detect one', () => {
    const out = buildPrompt('1. define it', vars, undefined, true);
    expect(out).toContain('DEFINED_AS:');
    expect(out).toContain('Define ONLY the literal');
    expect(out).not.toContain('is part of an idiom');
  });

  it('does not leak the {idiom_instruction} slot into the final prompt', () => {
    expect(buildPrompt('1. define it', vars)).not.toContain('{idiom_instruction}');
  });

  it('a custom envelope without {idiom_instruction} is unaffected by forceLiteral', () => {
    const withFlag = buildPrompt('FMT', vars, 'ENV {word}', true);
    const without = buildPrompt('FMT', vars, 'ENV {word}', false);
    expect(withFlag).toBe(without);
    expect(withFlag).toBe('ENV bucket');
  });

  it('a custom envelope WITH {idiom_instruction} still resolves the nested {word}', () => {
    const out = buildPrompt('FMT', vars, 'E {idiom_instruction}');
    expect(out).toContain('DEFINED_AS: "bucket" | literal'); // resolved inside the instruction text
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `cd packages/app && bunx vitest run test/prompt-template.test.ts`
Expected: FAIL — `buildPrompt` doesn't accept a 4th argument yet / envelope has no
`{idiom_instruction}` substitution.

- [ ] **Step 3: Implement** — replace `packages/app/src/domain/prompt-template.ts` in full:

```ts
import {
  PROMPT_ENVELOPE,
  IDIOM_AUTO_INSTRUCTION,
  IDIOM_FORCE_LITERAL_INSTRUCTION,
} from './default-template';
import { redactPII } from './pii';

export interface TemplateVars {
  word: string;
  context: string;
  target_lang: string;
  source_lang?: string;
  url?: string;
  title?: string;
}

const SUPPORTED = ['word', 'context', 'target_lang', 'source_lang', 'url', 'title'] as const;

export function renderTemplate(template: string, vars: TemplateVars): string {
  const resolved: Record<string, string | undefined> = {
    ...vars,
    source_lang: vars.source_lang ?? 'English',
  };
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    if (!SUPPORTED.includes(name as (typeof SUPPORTED)[number])) return match;
    const value = resolved[name];
    return value ?? match;
  });
}

/**
 * Assemble the final prompt sent to the model.
 *
 * The user-editable `outputFormat` (the card's section layout) is inserted into
 * the code-owned PROMPT_ENVELOPE FIRST, then the combined string is rendered.
 * Insert-before-render matters: a single `renderTemplate` pass cannot recurse
 * into a replacement value, so doing the insert first lets a `{target_lang}`
 * written inside the user's format still resolve. The constraints live in the
 * envelope, so an empty `outputFormat` still ships them.
 *
 * The page title is passed through `redactPII` here so masking is guaranteed for
 * every caller, independent of the lookup client.
 *
 * Advanced override (#62): a non-blank `envelope` replaces the code-owned
 * `PROMPT_ENVELOPE`. If it omits `{output_format}` it becomes the complete prompt
 * (restoring a legacy full-prompt user's exact behavior); the title is still
 * routed through `redactPII` either way. A blank/absent `envelope` means "built-in".
 *
 * A8: `forceLiteral` selects which idiom instruction fills `{idiom_instruction}` — the
 * auto-detect instruction by default, or the "literal only" override when the reader taps
 * the card's "Show literal word" button. Substituted the same way as `{output_format}` (a
 * direct replace, not the generic SUPPORTED-vars system), so a custom envelope override that
 * omits `{idiom_instruction}` is simply unaffected — consistent with how it already opts out
 * of other envelope-owned text.
 */
export function buildPrompt(
  outputFormat: string,
  vars: TemplateVars,
  envelope?: string,
  forceLiteral?: boolean,
): string {
  const env = envelope !== undefined && envelope.trim() !== '' ? envelope : PROMPT_ENVELOPE;
  let composed = env.includes('{output_format}')
    ? env.replace('{output_format}', outputFormat)
    : env;
  const idiomInstruction = forceLiteral ? IDIOM_FORCE_LITERAL_INSTRUCTION : IDIOM_AUTO_INSTRUCTION;
  composed = composed.includes('{idiom_instruction}')
    ? composed.replace('{idiom_instruction}', idiomInstruction)
    : composed;
  return renderTemplate(composed, { ...vars, title: redactPII(vars.title ?? '') });
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `cd packages/app && bunx vitest run test/prompt-template.test.ts`
Expected: PASS — all tests green (existing + the new `describe` block).

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/domain/prompt-template.ts packages/app/test/prompt-template.test.ts
git commit -m "feat(a8): buildPrompt forceLiteral switch selects the idiom instruction"
```

---

### Task 4: `LookupRequest.forceLiteral` / `LookupResult.definedAs` — types + wire schema

**Files:**

- Modify: `packages/app/src/domain/types.ts`
- Modify: `packages/app/src/wire.ts`
- Modify: `packages/app/test/wire-schema.test.ts`

**Interfaces:** Extends `LookupRequest`/`LookupResult` — consumed by Task 5 (`http-lookup-client.ts`
stamps `definedAs`, reads `forceLiteral`), Task 6 (`router.ts` reads `forceLiteral`), Task 7
(`workflow.ts` reads `result.definedAs`, sets `req.forceLiteral`), Task 8 (`lookup-card.ts` CardState).

- [ ] **Step 1: Write the failing tests** — append to `packages/app/test/wire-schema.test.ts`
      (near the existing `'lookup req accepts an optional provider override…'` test):

```ts
it('lookup req accepts an optional forceLiteral flag and rejects a non-boolean', () => {
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
    req: { ...base, forceLiteral: true },
  });
  expect(ok.success).toBe(true);
  const bad = WireMessageSchema.safeParse({
    type: 'lookup',
    requestId: '1',
    req: { ...base, forceLiteral: 'yes' },
  });
  expect(bad.success).toBe(false);
});

it('lookup result carries an optional definedAs; rejects an unknown key inside it (strictObject)', () => {
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
      result: { ...result, definedAs: { term: 'kick the bucket', isIdiom: true } },
    }).success,
  ).toBe(true);
  expect(
    WireReplySchema.safeParse({
      ok: true,
      type: 'lookup',
      requestId: '1',
      result: { ...result, definedAs: { term: 'x', isIdiom: true, extra: 'nope' } },
    }).success,
  ).toBe(false);
  // Old-shaped result (no definedAs) still parses — back-compat.
  expect(
    WireReplySchema.safeParse({ ok: true, type: 'lookup', requestId: '1', result }).success,
  ).toBe(true);
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `cd packages/app && bunx vitest run test/wire-schema.test.ts`
Expected: FAIL — `forceLiteral`/`definedAs` are rejected by `z.strictObject` (unknown keys), so
the "accepts" assertions fail.

- [ ] **Step 3: Implement.**

In `packages/app/src/domain/types.ts`, modify `LookupRequest` and `LookupResult`:

```ts
export interface LookupRequest {
  word: string;
  context: string;
  url: string;
  title: string;
  target: string;
  outputFormat: string;
  /** Full prompt envelope override (advanced, #62). `''` = use the built-in envelope. */
  promptEnvelope: string;
  /**
   * One-shot provider override from the card's manual picker. When set, the pool
   * tries this provider first (bypassing the stored default) and the router skips
   * the cache read so the picked provider actually answers. Declared
   * `Provider | undefined` for Zod/EOP alignment with the optional wire field.
   */
  provider?: Provider | undefined;
  /**
   * A8: one-shot request to define ONLY the literal, single selected word, bypassing idiom/
   * phrasal-verb detection (the card's "Show literal word" button). Re-runs the SAME selection
   * once; does not persist. The router skips the cache read for the same reason as `provider`
   * above — a hit would echo back the smart idiom-aware answer instead.
   */
  forceLiteral?: boolean | undefined;
}

export interface LookupResult {
  markdown: string;
  word: string;
  target: string;
  /** Display-only metadata naming the model that produced the result (e.g. 'gemini-2.5-flash', 'gpt-4o-mini'). */
  model: string;
  fromCache: boolean;
  fetchedAt: number;
  /** The provider that produced this result. Stamped by each lookup client. */
  provider?: Provider | undefined;
  /**
   * Set by the fallback pool when a non-primary provider answered.
   * Stripped before cache/history writes — transient per-request annotation.
   * Declared `Provider | undefined` (not just `Provider`) for Zod/EOP alignment.
   */
  fallbackFrom?: Provider | undefined;
  /**
   * A8: the unit the model actually defined — its literal selection, or, when the selection is
   * part of an idiom/phrasal verb, the whole idiomatic unit. Stamped by the shared HTTP lookup
   * skeleton from the model's DEFINED_AS line (see domain/defined-as.ts). Absent when the model
   * didn't emit a recognisable line (legacy cached/history entries, a non-compliant model, or a
   * custom envelope override that omits the instruction) — never blocks rendering.
   */
  definedAs?: { term: string; isIdiom: boolean } | undefined;
}
```

In `packages/app/src/wire.ts`, add a `DefinedAsSchema` and extend both request/result schemas:

```ts
const ProviderEnum = z.enum(['gemini', 'openai', 'anthropic']);

// A8: the idiom/literal unit the model actually defined.
const DefinedAsSchema = z.strictObject({ term: z.string(), isIdiom: z.boolean() });

const LookupRequestSchema = z.strictObject({
  word: z.string(),
  context: z.string(),
  url: z.string(),
  title: z.string(),
  target: z.string(),
  outputFormat: z.string(),
  // Full prompt envelope override (advanced, #62); '' = built-in envelope.
  promptEnvelope: z.string(),
  // One-shot manual provider override from the card picker; absent on normal lookups.
  provider: ProviderEnum.optional(),
  // A8: one-shot "Show literal word" override; absent on normal lookups.
  forceLiteral: z.boolean().optional(),
});

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

(Every other line in both files stays exactly as-is; only the two interfaces/schemas above
change.)

- [ ] **Step 4: Run the test, verify it passes**

Run: `cd packages/app && bunx vitest run test/wire-schema.test.ts`
Expected: PASS — all tests green (existing + the 2 new tests).

- [ ] **Step 5: Typecheck** (the compile-time `AssertEqual` drift guard in `wire.ts` fires here
      if the interface and schema ever drift)

Run: `cd packages/app && bun run typecheck`
Expected: exits 0, no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/domain/types.ts packages/app/src/wire.ts packages/app/test/wire-schema.test.ts
git commit -m "feat(a8): LookupRequest.forceLiteral + LookupResult.definedAs (types + wire schema)"
```

---

### Task 5: `runHttpLookup` parses the response and stamps `definedAs`

**Files:**

- Modify: `packages/app/src/app/http-lookup-client.ts`
- Modify: `packages/app/test/app/gemini-lookup-client.test.ts`

**Interfaces:** Consumes `parseDefinedAs` (Task 1) and `req.forceLiteral` (Task 4); every
provider client (Gemini/OpenAI/Anthropic) gets this for free since all three route through this
one shared skeleton.

- [ ] **Step 1: Write the failing tests** — append to
      `packages/app/test/app/gemini-lookup-client.test.ts` (a new `describe` block, using the
      existing `req`/`client`/`res` helpers already defined at the top of the file):

```ts
describe('A8 idiom expansion via runHttpLookup', () => {
  it('a DEFINED_AS idiom line is parsed into result.definedAs and stripped from markdown', async () => {
    const body = {
      candidates: [
        {
          content: {
            parts: [
              { text: 'DEFINED_AS: "kick the bucket" | idiom\n\n## kick the bucket\nTo die.' },
            ],
          },
        },
      ],
    };
    const c = client(() => Promise.resolve(res({ ok: true, status: 200, body })));
    const out = await c.lookup(req);
    expect(out.definedAs).toEqual({ term: 'kick the bucket', isIdiom: true });
    expect(out.markdown).toBe('## kick the bucket\nTo die.');
  });

  it('a response with no DEFINED_AS line leaves definedAs undefined and markdown unchanged (back-compat)', async () => {
    const c = client(() => Promise.resolve(res({ ok: true, status: 200, body: okBody })));
    const out = await c.lookup(req);
    expect(out.definedAs).toBeUndefined();
    expect(out.markdown).toBe('# def');
  });

  it('req.forceLiteral=true reaches the prompt as the force-literal instruction', async () => {
    let captured: { url: string; init: Parameters<FetchLike>[1] } | null = null;
    const c = client((url, init) => {
      captured = { url, init };
      return Promise.resolve(res({ ok: true, status: 200, body: okBody }));
    });
    await c.lookup({ ...req, forceLiteral: true });
    const sent =
      (JSON.parse(captured!.init.body) as { contents: { parts: { text: string }[] }[] }).contents[0]
        ?.parts[0]?.text ?? '';
    expect(sent).toContain('Define ONLY the literal');
    expect(sent).not.toContain('is part of an idiom');
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `cd packages/app && bunx vitest run test/app/gemini-lookup-client.test.ts`
Expected: FAIL — `out.definedAs` is `undefined` in the idiom case (should be the parsed object)
and `out.markdown` still contains the raw `DEFINED_AS:` line; the `forceLiteral` prompt
assertion fails because `req.forceLiteral` is not yet threaded into `buildPrompt`.

- [ ] **Step 3: Implement** — in `packages/app/src/app/http-lookup-client.ts`:

Add the import at the top (alongside the existing `../index` import):

```ts
import {
  mapError,
  buildPrompt,
  type LookupRequest,
  type LookupResult,
  type LookupError,
  type Provider,
} from '../index';
import { parseDefinedAs } from '../domain/defined-as';
```

Change the `buildPrompt` call inside `runHttpLookup` to pass `req.forceLiteral`:

```ts
const prompt = buildPrompt(
  req.outputFormat,
  {
    word: req.word,
    context: req.context,
    target_lang: req.target,
    url: req.url,
    title: req.title,
  },
  req.promptEnvelope,
  req.forceLiteral,
);
```

Change the success-path result construction (the `const text = spec.parseOk(json); …` block) to:

```ts
const text = spec.parseOk(json);
if (typeof text !== 'string' || text.length === 0)
  rejectWith(mapError({ kind: 'parse', provider: spec.provider }));

const { definedAs, body } = parseDefinedAs(text);
return {
  markdown: body,
  word: req.word,
  target: req.target,
  model: spec.model,
  provider: spec.provider,
  fromCache: false,
  fetchedAt: Date.now(),
  ...(definedAs !== undefined ? { definedAs } : {}),
};
```

(No other lines in the file change.)

- [ ] **Step 4: Run the test, verify it passes**

Run: `cd packages/app && bunx vitest run test/app/gemini-lookup-client.test.ts`
Expected: PASS — all tests green (existing + the 3 new tests).

- [ ] **Step 5: Run the full app unit suite** (the OpenAI/Anthropic clients share this exact
      skeleton and must keep passing unmodified)

Run: `cd packages/app && bun run test`
Expected: all suites green, including
`test/app/openai-lookup-client.test.ts`/`test/app/anthropic-lookup-client.test.ts` (unmodified,
proving the shared skeleton change didn't break either sibling client).

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/app/http-lookup-client.ts packages/app/test/app/gemini-lookup-client.test.ts
git commit -m "feat(a8): runHttpLookup stamps definedAs from the model's DEFINED_AS line"
```

---

### Task 6: Router — cache-read bypass for `forceLiteral`

**Files:**

- Modify: `packages/app/src/app/router.ts`
- Modify: `packages/app/test/app/router.test.ts`

**Interfaces:** Consumes `req.forceLiteral` (Task 4). Mirrors the existing `req.provider`
cache-read bypass at `router.ts:101` exactly.

- [ ] **Step 1: Write the failing test** — append to `packages/app/test/app/router.test.ts`,
      right after the existing `'manual provider override (req.provider) skips the cache
read…'` test:

```ts
it('forceLiteral override (req.forceLiteral) skips the cache read — the literal answer is fetched fresh', async () => {
  const d = deps();
  const route = buildRouter(d);
  await route(lookupMsg('a')); // populate cache with the default (idiom-aware) answer
  d.client.lookup.mockClear();
  const reply = await route({
    type: 'lookup',
    req: { ...req, forceLiteral: true },
    requestId: 'b',
  });
  expect(reply).toMatchObject({ ok: true, type: 'lookup', result: { fromCache: false } });
  expect(d.client.lookup).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `cd packages/app && bunx vitest run test/app/router.test.ts`
Expected: FAIL — the cache hit is served (`fromCache: true`) and `d.client.lookup` is never
called, because `req.forceLiteral` isn't checked yet.

- [ ] **Step 3: Implement** — in `packages/app/src/app/router.ts`, change the cache-read guard:

```ts
      // A manual provider pick (req.provider set) must reach the picked provider: the cache key
      // ignores provider, so a hit would echo back the previous provider's answer. Skip the read.
      // A8: the same reasoning applies to a forced-literal re-run (req.forceLiteral) — a hit
      // would echo back the smart idiom-aware answer instead of the literal one requested.
      if (cacheEnabled && req.provider === undefined && req.forceLiteral !== true) {
```

(This is the ONLY line that changes in the file — everything else, including the cache **write**
a few lines below, stays exactly as-is per the design doc's §5 decision.)

- [ ] **Step 4: Run the test, verify it passes**

Run: `cd packages/app && bunx vitest run test/app/router.test.ts`
Expected: PASS — all tests green (existing + the 1 new test).

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/app/router.ts packages/app/test/app/router.test.ts
git commit -m "feat(a8): router skips the cache read on a forceLiteral override"
```

---

### Task 7: `runLookupWorkflow` — `onForceLiteral` context wiring

**Files:**

- Modify: `packages/app/src/ports.ts`
- Modify: `packages/app/src/domain/workflow.ts`
- Modify: `packages/app/test/workflow.test.ts`

**Interfaces:** Adds `ResultRenderContext.onForceLiteral`; `runLookupWorkflow`'s internal
`runLookup` gains a `forceLiteral` parameter. Consumed by Task 9
(`inline-bottom-sheet-renderer.ts`).

- [ ] **Step 1: Write the failing tests** — append to `packages/app/test/workflow.test.ts`,
      right after the existing `'onSwitchProvider re-runs the SAME selection with req.provider
override, bypassing cooldown'` test. First widen the top import to also pull in
      `LookupResult`'s `definedAs`-carrying shape (no new import needed — `LookupResult` is
      already imported):

```ts
it('a result with definedAs.isIdiom=true yields ctx.onForceLiteral even with only 1 provider configured', async () => {
  const idiomResult: LookupResult = {
    ...okResult,
    definedAs: { term: 'kick the bucket', isIdiom: true },
  };
  const h = harness({ configuredProviders: ['gemini'], impl: () => Promise.resolve(idiomResult) });
  h.selection.emit(sel);
  h.trigger.click();
  await vi.waitFor(() => expect(h.renderer.calls).toContain('result'));
  expect(h.renderer.lastCtx).toBeDefined();
  expect(typeof h.renderer.lastCtx?.onForceLiteral).toBe('function');
  expect(h.renderer.lastCtx?.providers).toBeUndefined(); // still no picker (only 1 provider)
});

it('onForceLiteral re-runs the SAME selection with req.forceLiteral, bypassing cooldown', async () => {
  let t = 5000;
  const idiomResult: LookupResult = {
    ...okResult,
    definedAs: { term: 'kick the bucket', isIdiom: true },
  };
  const literalResult: LookupResult = { ...okResult, word: 'bucket' };
  let calls = 0;
  const h = harness({
    configuredProviders: ['gemini'],
    now: () => t,
    impl: () => Promise.resolve(calls++ === 0 ? idiomResult : literalResult),
  });
  h.selection.emit(sel);
  h.trigger.click();
  await vi.waitFor(() => expect(h.renderer.calls).toContain('result'));
  const forceLiteral = h.renderer.lastCtx!.onForceLiteral!;
  t = 5001; // still inside the cooldown window — a deliberate override must NOT be blocked
  forceLiteral();
  await vi.waitFor(() => expect(h.renderer.calls.filter((c) => c === 'result').length).toBe(2));
  expect(h.client.lastReq).toMatchObject({
    word: 'bank',
    context: 'river bank',
    forceLiteral: true,
  });
  expect(h.renderer.lastError).toBeNull();
});

it('a literal result (no definedAs) with only 1 provider still yields ctx===undefined (regression guard)', async () => {
  const h = harness({ configuredProviders: ['gemini'] }); // okResult has no definedAs
  h.selection.emit(sel);
  h.trigger.click();
  await vi.waitFor(() => expect(h.renderer.calls).toContain('result'));
  expect(h.renderer.lastCtx).toBeUndefined();
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `cd packages/app && bunx vitest run test/workflow.test.ts`
Expected: FAIL — `ResultRenderContext` has no `onForceLiteral`, and `ctx` is currently built only
from `configuredProviders.length >= 2`, so the first two new tests fail (`ctx` is `undefined`
when there's 1 provider, regardless of `definedAs`); the third new test already passes today
(included as an explicit regression lock, not a red step).

- [ ] **Step 3: Implement.**

In `packages/app/src/ports.ts`, extend `ResultRenderContext`:

```ts
/**
 * Optional context handed to `renderResult` so the card can offer a one-shot
 * provider picker and/or a one-shot "force literal" re-run. Omitted entirely when
 * neither applies (fewer than two providers configured AND the result isn't an idiom).
 */
export interface ResultRenderContext {
  /** Providers the reader may switch to (>=2 entries when present). */
  providers?: Provider[];
  /** Re-run the SAME lookup once with this provider; does not persist the choice. */
  onSwitchProvider?: (p: Provider) => void;
  /**
   * A8: re-run the SAME selection once, forcing the literal single-word reading. Present only
   * when the result just rendered is an idiom (`result.definedAs?.isIdiom === true`).
   */
  onForceLiteral?: () => void;
}
```

In `packages/app/src/domain/workflow.ts`, replace the `runLookup` function in full:

```ts
async function runLookup(
  e: SelectionEvent,
  providerOverride?: Provider,
  forceLiteral?: boolean,
): Promise<void> {
  inFlight?.abort();
  const controller = new AbortController();
  inFlight = controller;

  // try/finally ensures hide() fires even if settings.get() rejects (stuck-spinner guard);
  // the abort guard inside finally prevents double-hide when a newer click cancels this run
  const settings = await deps.settings.get().finally(() => {
    if (!controller.signal.aborted) deps.trigger.hide();
  });
  // hide bubble once settings are known — keeps spinner visible during the async gap
  if (settings.configuredProviders.length === 0) {
    deps.renderer.renderError(mapError({ kind: 'no-key' }));
    return;
  }
  deps.renderer.renderLoading(e.text);
  const req: LookupRequest = {
    word: e.text,
    context: e.sentence,
    url: e.url,
    title: e.title,
    target: settings.targetLang,
    outputFormat: settings.outputFormat,
    promptEnvelope: settings.promptEnvelope,
  };
  // A manual pick re-runs THIS selection once against the chosen provider (one-shot).
  if (providerOverride) req.provider = providerOverride;
  // A8: a manual "Show literal word" pick re-runs THIS selection once, forcing the literal
  // single-word reading (one-shot).
  if (forceLiteral) req.forceLiteral = true;
  try {
    const result = await deps.client.lookup(req, { signal: controller.signal });
    // Offer the one-shot picker only when there's more than one provider to choose from.
    const showPicker = settings.configuredProviders.length >= 2;
    // A8: offer the "Show literal word" override only when THIS result is an idiom.
    const isIdiom = result.definedAs?.isIdiom === true;
    const ctx: ResultRenderContext | undefined =
      showPicker || isIdiom
        ? {
            ...(showPicker
              ? {
                  providers: settings.configuredProviders,
                  onSwitchProvider: (p: Provider) => {
                    // Deliberate switch bypasses the Define-spam cooldown — it's not spam.
                    void runLookup(e, p).catch((err) =>
                      deps.renderer.renderError(mapError({ kind: 'thrown', error: err })),
                    );
                  },
                }
              : {}),
            ...(isIdiom
              ? {
                  onForceLiteral: () => {
                    // Deliberate override bypasses the Define-spam cooldown — same reasoning
                    // as onSwitchProvider above.
                    void runLookup(e, undefined, true).catch((err) =>
                      deps.renderer.renderError(mapError({ kind: 'thrown', error: err })),
                    );
                  },
                }
              : {}),
          }
        : undefined;
    if (!controller.signal.aborted) deps.renderer.renderResult(result, ctx);
  } catch (err) {
    if (!controller.signal.aborted) deps.renderer.renderError(toLookupError(err));
  } finally {
    if (inFlight === controller) inFlight = null;
  }
}
```

(No other function in the file changes — `runLookupWorkflow`'s `selection.onSelection` closure
and the returned teardown function are untouched.)

- [ ] **Step 4: Run the test, verify it passes**

Run: `cd packages/app && bunx vitest run test/workflow.test.ts`
Expected: PASS — all tests green (existing + the 3 new tests, including the regression guard).

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/ports.ts packages/app/src/domain/workflow.ts packages/app/test/workflow.test.ts
git commit -m "feat(a8): workflow offers onForceLiteral when a result is an idiom"
```

---

### Task 8: Card label + "Show literal word" button (`<lookup-card>`)

**Files:**

- Modify: `packages/app/src/ui/lookup-card.ts`
- Modify: `packages/app/test/ui/lookup-card.test.ts`

**Interfaces:** `CardState`'s `'result'` variant gains `definedAs?: { term: string; isIdiom:
boolean }`. Fires a composed `force-literal` DOM event on button click. Consumed by Task 9
(`inline-bottom-sheet-renderer.ts`). Because `PanelFocusState = CardState | { kind: 'empty' }`
reuses this exact render path, the side panel gets the label/button too UNLESS Task 10
deliberately omits `definedAs` when building its `PanelFocusState` (see Task 10).

- [ ] **Step 1: Write the failing tests** — append to `packages/app/test/ui/lookup-card.test.ts`
      (a new block near the existing "renders a result with a heading…" test):

```ts
describe('<lookup-card> idiom label + force-literal button (A8)', () => {
  it('an idiom result renders the defined-as label and a "Show literal word" button', () => {
    const el = mountCard();
    el.state = {
      kind: 'result',
      word: 'bucket',
      target: 'vi',
      safeHtml: safe('<p>To die.</p>'),
      definedAs: { term: 'kick the bucket', isIdiom: true },
    };
    expect(el.querySelector('.defined-as__label')!.textContent).toBe(
      'Defined as "kick the bucket" (idiom)',
    );
    expect(el.querySelector<HTMLButtonElement>('.defined-as__literal-btn')!.textContent).toBe(
      'Show literal word',
    );
  });

  it('clicking the button fires a composed force-literal event', () => {
    const el = mountCard();
    el.state = {
      kind: 'result',
      word: 'bucket',
      target: 'vi',
      safeHtml: safe('<p>To die.</p>'),
      definedAs: { term: 'kick the bucket', isIdiom: true },
    };
    const handler = vi.fn();
    document.body.addEventListener('force-literal', handler);
    el.querySelector<HTMLButtonElement>('.defined-as__literal-btn')!.click();
    document.body.removeEventListener('force-literal', handler);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('a literal result (isIdiom: false) renders no .defined-as row', () => {
    const el = mountCard();
    el.state = {
      kind: 'result',
      word: 'bucket',
      target: 'vi',
      safeHtml: safe('<p>A pail.</p>'),
      definedAs: { term: 'bucket', isIdiom: false },
    };
    expect(el.querySelector('.defined-as')).toBeNull();
  });

  it('a result with no definedAs renders no .defined-as row (back-compat)', () => {
    const el = mountCard();
    el.state = { kind: 'result', word: 'bank', target: 'vi', safeHtml: safe('<p>money place</p>') };
    expect(el.querySelector('.defined-as')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `cd packages/app && bunx vitest run test/ui/lookup-card.test.ts`
Expected: FAIL — `CardState`'s `'result'` variant has no `definedAs` field, and no
`.defined-as`/`.defined-as__label`/`.defined-as__literal-btn` elements exist yet.

- [ ] **Step 3: Implement.**

In `packages/app/src/ui/lookup-card.ts`, extend `CardState`'s `'result'` variant:

```ts
export type CardState =
  | { kind: 'loading'; word?: string }
  | {
      kind: 'result';
      safeHtml: SafeHtml;
      word: string;
      target: string;
      provider?: Provider;
      fallbackFrom?: Provider;
      /** Providers the reader may switch to; when ≥2, the card shows a one-shot picker. */
      providers?: Provider[];
      /** A8: the idiom/literal unit actually defined; renders a label + "Show literal word"
       * button when `isIdiom` is true. */
      definedAs?: { term: string; isIdiom: boolean };
    }
  | { kind: 'error'; error: LookupError };
```

Add a new function right before `renderMetaRow` (same section of the file):

```ts
/**
 * A8: the idiom label + "Show literal word" override button, shown only when the model
 * reported the selection as part of an idiom/phrasal verb. A literal result needs no extra
 * label (the headword already says the word), so this returns null for `isIdiom: false` —
 * avoiding noise for the overwhelmingly common non-idiom case.
 */
function renderDefinedAsRow(definedAs: { term: string; isIdiom: boolean }): HTMLElement | null {
  if (!definedAs.isIdiom) return null;
  const row = document.createElement('div');
  row.className = 'defined-as';
  const label = document.createElement('span');
  label.className = 'defined-as__label';
  label.textContent = `Defined as "${definedAs.term}" (idiom)`;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'defined-as__literal-btn';
  btn.textContent = 'Show literal word';
  btn.addEventListener('click', () =>
    btn.dispatchEvent(new CustomEvent('force-literal', { bubbles: true, composed: true })),
  );
  row.append(label, btn);
  return row;
}
```

In `renderCardState`'s `'result'` branch, insert the row between the headword and the body:

```ts
const h = document.createElement('h2');
h.textContent = state.word;
const body = document.createElement('div');
body.innerHTML = state.safeHtml; // trusted: sanitized upstream by adapters-shared (S4)
const nodes: Node[] = [h];
const definedAsRow = state.definedAs ? renderDefinedAsRow(state.definedAs) : null;
if (definedAsRow) nodes.push(definedAsRow);
nodes.push(body);
const meta = renderMetaRow(state);
if (meta) nodes.push(meta);
return nodes;
```

(This replaces the existing 4-line block `const nodes: Node[] = [h, body]; …` — everything else
in the function is unchanged.)

CSS: add one `::slotted(.defined-as)` rule next to the existing `::slotted(.meta-row)` rule in
the `CSS` template literal (append right after the `::slotted(.meta-row){…}` line):

```css
::slotted(.defined-as) {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 2px 0 8px;
  font-size: var(--adp-text-2xs);
  color: var(--ad-ink-soft);
}
```

And add descendant rules to the document-scoped `CARD_DOC_CSS` template literal (append right
after the existing `.prov-menu [role=option][disabled]{…}` line — `.defined-as__literal-btn` is
a visual twin of `.prov-switch`):

```css
lookup-card .defined-as__label {
  font-style: italic;
}
lookup-card .defined-as__literal-btn {
  border: 1px solid var(--ad-line);
  background: transparent;
  color: var(--ad-ink-soft);
  border-radius: var(--adp-radius-control);
  padding: 2px 10px;
  font: inherit;
  font-size: var(--adp-text-2xs);
  cursor: pointer;
}
lookup-card .defined-as__literal-btn:hover {
  background: var(--ad-surface-raised);
  color: var(--ad-ink);
}
lookup-card .defined-as__literal-btn:focus-visible {
  outline: 2px solid var(--ad-accent);
  outline-offset: 2px;
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `cd packages/app && bunx vitest run test/ui/lookup-card.test.ts`
Expected: PASS — all tests green (existing + the 4 new tests).

- [ ] **Step 5: Accessibility regression check** (this file's existing test suite runs an axe
      scan — `test/ui/a11y.ts` — over rendered card states)

Run: `cd packages/app && bunx vitest run test/ui/lookup-card.test.ts -t "a11y"`
Expected: PASS, or no tests matched (if the a11y assertions are embedded in other `it` blocks
rather than a separately-named test — in that case Step 4's full-file run already covers it).

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/ui/lookup-card.ts packages/app/test/ui/lookup-card.test.ts
git commit -m "feat(a8): idiom label + Show literal word button on <lookup-card>"
```

---

### Task 9: `InlineBottomSheetRenderer` — wire the `force-literal` event + `definedAs` field

**Files:**

- Modify: `packages/app/src/app/inline-bottom-sheet-renderer.ts`
- Modify: `packages/app/test/app/inline-bottom-sheet-renderer.test.ts`

**Interfaces:** Consumes `ctx.onForceLiteral` (Task 7) and `CardState.definedAs` (Task 8); wires
the card's `force-literal` DOM event to `ctx.onForceLiteral`, mirroring the existing
`switch-provider` wiring exactly.

- [ ] **Step 1: Write the failing tests** — append to
      `packages/app/test/app/inline-bottom-sheet-renderer.test.ts`:

```ts
it('renderResult forwards r.definedAs → the idiom label appears in light DOM', () => {
  const h = host();
  const r = new InlineBottomSheetRenderer(h);
  r.renderResult({ ...result, definedAs: { term: 'kick the bucket', isIdiom: true } });
  const c = card(h);
  expect(c.querySelector('.defined-as__label')!.textContent).toBe(
    'Defined as "kick the bucket" (idiom)',
  );
});

it("clicking the card's force-literal button invokes ctx.onForceLiteral", () => {
  const h = host();
  const r = new InlineBottomSheetRenderer(h);
  const calls: number[] = [];
  r.renderResult(
    { ...result, definedAs: { term: 'kick the bucket', isIdiom: true } },
    { onForceLiteral: () => calls.push(1) },
  );
  card(h).querySelector<HTMLButtonElement>('.defined-as__literal-btn')!.click();
  expect(calls).toEqual([1]);
});

it('a result with no definedAs renders no .defined-as row (back-compat)', () => {
  const h = host();
  new InlineBottomSheetRenderer(h).renderResult(result);
  expect(card(h).querySelector('.defined-as')).toBeNull();
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `cd packages/app && bunx vitest run test/app/inline-bottom-sheet-renderer.test.ts`
Expected: FAIL — `renderResult` doesn't forward `r.definedAs` into `CardState` yet, and no
`force-literal` listener is attached, so clicking the button (once Task 8 renders it) does
nothing.

- [ ] **Step 3: Implement** — in `packages/app/src/app/inline-bottom-sheet-renderer.ts`:

Add a new private field next to the existing `onSwitch`:

```ts
  // Set on every renderResult from the render context; the card's one `switch-provider`
  // listener (attached in ensureCard) reads whatever the latest result installed.
  private onSwitch: ((p: Provider) => void) | undefined;
  // A8: same pattern for the card's one `force-literal` listener.
  private onForceLiteral: (() => void) | undefined;
```

In `ensureCard()`, right after the existing `switch-provider` listener registration, add:

```ts
// One-shot idiom-literal override (A8): the card fires `force-literal` when the reader taps
// "Show literal word"; delegate to the handler the workflow installed via the render context.
card.addEventListener('force-literal', () => this.onForceLiteral?.());
```

In `renderResult()`, set `this.onForceLiteral` and forward `r.definedAs`:

```ts
  renderResult(r: LookupResult, ctx?: ResultRenderContext): void {
    // `sanitize` already returns `SafeHtml` (the trust boundary lives in sanitizeMarkdown, S4).
    // No cast needed here — the DI param type `(md: string) => SafeHtml` guarantees it.
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
    });
  }
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `cd packages/app && bunx vitest run test/app/inline-bottom-sheet-renderer.test.ts`
Expected: PASS — all tests green (existing + the 3 new tests).

- [ ] **Step 5: Full app package gate**

Run, from `packages/app`:

```bash
bun run typecheck
bun run test
```

Expected: both exit 0 — this is the last core-package task, so it is the first point every
prior task's changes are proven to compose together.

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/app/inline-bottom-sheet-renderer.ts packages/app/test/app/inline-bottom-sheet-renderer.test.ts
git commit -m "feat(a8): wire force-literal event + definedAs field into InlineBottomSheetRenderer"
```

---

### Task 10: E2E functional coverage + side-panel omission guard + full gate verification

**Files:**

- Create: `packages/extension-chrome/e2e/idiom-expansion.spec.ts`

**Interfaces:** Uses the existing `mockGemini`/`seedSettings`/`gotoFixture`/`selectWord`/
`openTrigger` helpers (`packages/extension-chrome/e2e/helpers.ts`) unmodified — no new helper
needed for A8 (contrast with A4, which added `getServiceWorker`/`relayCommand`).

- [ ] **Step 1: Write the e2e spec** — create
      `packages/extension-chrome/e2e/idiom-expansion.spec.ts`:

```ts
import { test, expect } from './fixtures';
import { seedSettings, mockGemini, gotoFixture, selectWord, openTrigger } from './helpers';

const IDIOM_BODY = JSON.stringify({
  candidates: [
    {
      content: {
        parts: [
          {
            text:
              'DEFINED_AS: "kick the bucket" | idiom\n\n' +
              '## kick the bucket\nAn informal way of saying someone has died.',
          },
        ],
      },
    },
  ],
});

const LITERAL_BODY = JSON.stringify({
  candidates: [
    {
      content: { parts: [{ text: 'DEFINED_AS: "bucket" | literal\n\n## bucket\nA pail.' }] },
    },
  ],
});

const NO_TAG_BODY = JSON.stringify({
  candidates: [{ content: { parts: [{ text: '## bucket\nA container for carrying liquid.' }] } }],
});

test.describe('A8 phrase & idiom expansion', () => {
  test('idiom selection renders the defined-as label and the Show literal word button', async ({
    context,
    extensionId,
  }) => {
    await mockGemini(context, { body: IDIOM_BODY });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);
    await gotoFixture(page, 'He kicked the bucket last week.');
    await page.waitForTimeout(800);
    await selectWord(page, 't', 'bucket');
    await openTrigger(page);

    const card = page.locator('bottom-sheet lookup-card');
    await expect(card).toContainText('Defined as "kick the bucket" (idiom)', { timeout: 10_000 });
    await expect(card.locator('.defined-as__literal-btn')).toHaveText('Show literal word');
  });

  test('the outbound prompt carries the idiom-detection instruction', async ({
    context,
    extensionId,
  }) => {
    let sentPrompt = '';
    await mockGemini(context, {
      body: IDIOM_BODY,
      onRequest: (postData) => {
        const parsed = JSON.parse(postData) as { contents: { parts: { text: string }[] }[] };
        sentPrompt = parsed.contents[0]?.parts[0]?.text ?? '';
      },
    });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);
    await gotoFixture(page, 'He kicked the bucket last week.');
    await page.waitForTimeout(800);
    await selectWord(page, 't', 'bucket');
    await openTrigger(page);
    await expect(page.locator('bottom-sheet lookup-card')).toContainText('kick the bucket', {
      timeout: 10_000,
    });

    expect(sentPrompt).toContain('DEFINED_AS:');
    expect(sentPrompt).toContain('is part of an idiom');
  });

  test('the Show literal word button re-runs the lookup and switches to the literal reading', async ({
    context,
    extensionId,
  }) => {
    const calls = await mockGemini(context, { body: IDIOM_BODY });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);
    await gotoFixture(page, 'He kicked the bucket last week.');
    await page.waitForTimeout(800);
    await selectWord(page, 't', 'bucket');
    await openTrigger(page);

    const card = page.locator('bottom-sheet lookup-card');
    await expect(card).toContainText('Defined as "kick the bucket" (idiom)', { timeout: 10_000 });

    // Swap the mock to the literal response before the button re-fires the request.
    await context.unroute('https://generativelanguage.googleapis.com/**');
    await mockGemini(context, { body: LITERAL_BODY });

    await card.locator('.defined-as__literal-btn').click();
    await expect(card).toContainText('A pail.', { timeout: 10_000 });
    await expect(card.locator('.defined-as')).toHaveCount(0); // literal result shows no label
    expect(calls.count).toBeGreaterThanOrEqual(1); // first mock's own counter; swapped mock re-counts separately
  });

  test('a literal-tagged response renders no defined-as row', async ({ context, extensionId }) => {
    await mockGemini(context, { body: LITERAL_BODY });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);
    await gotoFixture(page, 'Pass me the bucket, please.');
    await page.waitForTimeout(800);
    await selectWord(page, 't', 'bucket');
    await openTrigger(page);

    const card = page.locator('bottom-sheet lookup-card');
    await expect(card).toContainText('A pail.', { timeout: 10_000 });
    await expect(card.locator('.defined-as')).toHaveCount(0);
  });

  test('a response with no DEFINED_AS line degrades gracefully (no label, no error)', async ({
    context,
    extensionId,
  }) => {
    await mockGemini(context, { body: NO_TAG_BODY });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);
    await gotoFixture(page, 'Pass me the bucket, please.');
    await page.waitForTimeout(800);
    await selectWord(page, 't', 'bucket');
    await openTrigger(page);

    const card = page.locator('bottom-sheet lookup-card');
    await expect(card).toContainText('A container for carrying liquid.', { timeout: 10_000 });
    await expect(card.locator('.defined-as')).toHaveCount(0);
    await expect(card.locator('.err')).toHaveCount(0);
  });

  test('the side panel mirror shows the idiom result WITHOUT the Show literal word button', async ({
    context,
    extensionId,
  }) => {
    await mockGemini(context, { body: IDIOM_BODY });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/side-panel.html`);
    await panel.waitForSelector('side-panel-view');

    await gotoFixture(page, 'He kicked the bucket last week.');
    await page.waitForTimeout(800);
    await selectWord(page, 't', 'bucket');
    await openTrigger(page);
    await expect(page.locator('bottom-sheet lookup-card')).toContainText('kick the bucket', {
      timeout: 10_000,
    });

    // The mirrored panel shows the definition text but, per design §10, never the
    // idiom label/button — resultToFocus deliberately omits definedAs (same precedent as the
    // provider picker, which the panel also omits).
    await expect(panel.locator('side-panel-view')).toContainText('died', { timeout: 5_000 });
    await expect(panel.locator('side-panel-view .defined-as')).toHaveCount(0);
  });
});
```

- [ ] **Step 2: Build the extension, then run the new spec**

Run: `bun run build:chrome && cd packages/extension-chrome && bunx playwright test idiom-expansion`
Expected: PASS — all 6 tests green. (First run: `bunx playwright install --with-deps chromium`
if the browser isn't installed yet.)

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
`build:safari` must stay green (proof the Safari shell composes the changed core cleanly — no
Safari-specific code was touched anywhere in this plan).

- [ ] **Step 4: Commit**

```bash
git add packages/extension-chrome/e2e/idiom-expansion.spec.ts
git commit -m "test(a8): e2e coverage — idiom label, force-literal button, side-panel omission"
```

---

### Task 11: Before/after evidence recording (video)

**Files:**

- Create: `packages/extension-chrome/e2e/a8-evidence.spec.ts`

**Interfaces:** Standalone — no shared helper additions needed (reuses `seedSettings`/
`gotoFixture`/`selectWord`/`openTrigger` from `helpers.ts`, all already present). RUN-gated like
`a4-evidence.spec.ts`/`a16-evidence.spec.ts` — never runs in normal CI.

- [ ] **Step 1: Write the evidence spec** — create
      `packages/extension-chrome/e2e/a8-evidence.spec.ts`:

```ts
/**
 * A8 before/after evidence: a short recorded flow showing the idiom label appear on the card
 * and the "Show literal word" button switch it to the literal reading. Not part of the normal
 * suite. (Re)record with:
 *   PLAYWRIGHT_RUN_EVIDENCE=1 SHOT_LABEL=after A8_OUT_DIR=/abs/path \
 *     bunx playwright test a8-evidence
 * Capture BEFORE from a `master` build (no DEFINED_AS wiring — the mocked response is shown
 * as-is, with no label or button) and AFTER from the branch build, then host the .webm per the
 * private-repo rule (pr-assets branch + same-origin github.com/.../raw URLs).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { test, chromium } from '@playwright/test';
import { seedSettings, gotoFixture, selectWord, openTrigger } from './helpers';
import { E2E_HEADLESS } from '../playwright.config';

const RUN = process.env.PLAYWRIGHT_RUN_EVIDENCE === '1';
const LABEL = process.env.SHOT_LABEL ?? 'after';
const OUT = process.env.A8_OUT_DIR ?? '.';
const here = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(here, '../dist');
const SIZE = { width: 900, height: 620 };

const IDIOM_BODY = JSON.stringify({
  candidates: [
    {
      content: {
        parts: [
          {
            text:
              'DEFINED_AS: "kick the bucket" | idiom\n\n' +
              '## kick the bucket\nAn informal way of saying someone has died.',
          },
        ],
      },
    },
  ],
});

const LITERAL_BODY = JSON.stringify({
  candidates: [
    { content: { parts: [{ text: 'DEFINED_AS: "bucket" | literal\n\n## bucket\nA pail.' }] } },
  ],
});

test.describe('A8 phrase & idiom expansion — evidence', () => {
  test.skip(!RUN, 'set PLAYWRIGHT_RUN_EVIDENCE=1 to (re)record A8 before/after video');

  test(`idiom label + force-literal toggle (${LABEL})`, async () => {
    const videoDir = path.join(OUT, `a8-${LABEL}-raw`);
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
        route.fulfill({ status: 200, contentType: 'application/json', body: IDIOM_BODY }),
      );

      const page = await context.newPage();
      const [sw] = context.serviceWorkers();
      const worker = sw ?? (await context.waitForEvent('serviceworker', { timeout: 10_000 }));
      const extensionId = new URL(worker.url()).hostname;

      await page.goto(`chrome-extension://${extensionId}/options.html`);
      await seedSettings(page, { outputFormat: 'Define {word}' });
      await gotoFixture(page, 'He kicked the bucket last week.');
      await page.waitForTimeout(800);

      await selectWord(page, 't', 'bucket');
      await openTrigger(page);
      await page.waitForTimeout(1_800); // hold on the idiom card (label+button on `after`, plain on `before`)

      // Swap to the literal response, then click the button (a no-op on `before`: no button exists).
      await context.unroute('https://generativelanguage.googleapis.com/**');
      await context.route('https://generativelanguage.googleapis.com/**', (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: LITERAL_BODY }),
      );
      const btn = page.locator('bottom-sheet lookup-card .defined-as__literal-btn');
      if (await btn.count()) await btn.click();
      await page.waitForTimeout(1_800); // hold on the literal outcome

      const video = page.video();
      await page.close();
      await mkdir(OUT, { recursive: true });
      await video?.saveAs(path.join(OUT, `a8-${LABEL}.webm`));
    } finally {
      await context.close().catch(() => {});
    }
  });
});
```

- [ ] **Step 2: Typecheck + lint the new file**

Run: `cd packages/extension-chrome && bun run typecheck && cd /Users/home/repos/ai-dict && bun run lint`
Expected: no errors.

- [ ] **Step 3: Format check**

Run: `bun run format:check`
Expected: clean (run `bun run format` + a follow-up commit if not).

- [ ] **Step 4: Commit**

```bash
git add packages/extension-chrome/e2e/a8-evidence.spec.ts
git commit -m "test(a8): before/after evidence recording spec (gated, not run in CI)"
```

## Self-Review

- **Spec coverage:** DEFINED_AS parser (Task 1), idiom prompt instructions + envelope slot
  (Task 2), `buildPrompt` force-literal switch (Task 3), request/result types + wire schema
  (Task 4), `runHttpLookup` stamping (Task 5, shared by all 3 provider clients), router
  cache-read bypass (Task 6), workflow `onForceLiteral` context (Task 7), card label + button
  (Task 8), renderer wiring (Task 9), e2e functional coverage including the side-panel omission
  guard (Task 10), evidence recording (Task 11). No gaps against the design doc's 11 numbered
  design sections (§1–§11 map 1:1 onto Tasks 1–11, with §10's "no code change" documented as a
  regression-locking e2e test rather than a source change).
- **Placeholder scan:** none — every step has concrete, complete code and an exact command +
  expected result.
- **Type consistency:** `DefinedAs`/`parseDefinedAs` (Task 1) is the exact name imported in
  Task 5's `http-lookup-client.ts`; `IDIOM_AUTO_INSTRUCTION`/`IDIOM_FORCE_LITERAL_INSTRUCTION`
  (Task 2) are the exact names imported in Task 3's `prompt-template.ts`; `forceLiteral`
  (Task 4) is the exact field name read in Tasks 5/6/7 and written in Task 7;
  `definedAs`/`{ term, isIdiom }` (Task 4) is the exact shape produced in Task 5, read in
  Task 7, and rendered in Task 8; `ResultRenderContext.onForceLiteral` (Task 7) is the exact
  name consumed in Task 9; `.defined-as`/`.defined-as__label`/`.defined-as__literal-btn`
  (Task 8) are the exact selectors asserted in Tasks 9 and 10's e2e spec.
- **Scope fence:** no idiom-detection engine anywhere (detection is 100% delegated to the model
  via the prompt instruction — Task 2 — with graceful degradation in Task 1's parser); no new
  manifest permission (zero changes to any `packages/extension-*` file except the two new,
  additive e2e spec files in Tasks 10–11); the two new wire fields are both optional and
  guarded by the existing compile-time `AssertEqual` drift check (Task 4, Step 5).
- **Zero changes to `packages/extension-chrome/src/**`or`packages/extension-safari/**`
  production code** — confirmed by grep in the design doc (§10, §11): only new e2e spec files
  are added under `packages/extension-chrome/e2e/`.
