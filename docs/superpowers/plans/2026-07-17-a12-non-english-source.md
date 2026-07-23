# A12 Non-English Source Pages Implementation Plan

> **For agentic workers:** implement task-by-task, TDD (red → green → commit) per task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** the prompt's source-language assumption is no longer hard-coded to "English" for every
lookup. The card detects the selected word's source language from the page/element `lang`
attribute, threads a bare BCP-47 code (`'fr'`, `'ja'`, …) through the request into the persona
sentence's `{source_lang}` slot, shows the detected language on the card with a manual one-shot
override control, and falls back to a neutral "infer from context" instruction — never "assume
English" — when nothing can be determined. Target-language logic is completely untouched. Per the
owner's E3 ruling (`docs/ROADMAP.md` §8): **build, don't advertise** — no landing-page, store-listing,
or marketing copy changes anywhere in this plan.

**Architecture:** a new pure domain module (`packages/app/src/domain/source-lang.ts`) owns the fixed,
recognized set of source-language codes and the detection/recognition function; `SelectionEvent`
gains a raw `pageLang` capture at the DOM layer (`app/dom-selection-source.ts`); `LookupRequest` gains
two optional fields (`sourceLang`, `sourceLangOverride`) that ride the existing `lookup` wire message
as ordinary evolution (CONTRACTS §3's A8/B2/B7 precedent — no new message, no router case); the
prompt builder's persona line and fallback both change to respect the resolved value; the card gets a
new "Source: … / Change" row structurally identical to the existing provider-switch row, wired
through the same one-shot re-run pattern `onSwitchProvider`/`onForceLiteral` already use. In-page card
only — no side-panel change (design spec §2.5). Full design rationale, including every rejected
alternative:
`docs/superpowers/specs/2026-07-17-a12-non-english-source-design.md`.

**Tech Stack:** TypeScript, Vitest + happy-dom (unit), Playwright (e2e), zod (wire schema).

## Global Constraints

- Implementer: dispatch each task to the `hunter` subagent — never a generic implementer.
- Start in a fresh git worktree under `.claude/worktrees/` on branch `feature/A12NonEnglishSource`.
- Commit subject: `[A12NonEnglishSource] feat: <imperative summary> (A12)` for every task's commit —
  no `Co-Authored-By` trailer, no attribution footer.
- `bun run lint` && `bun run format:check` green before every commit; `cd packages/app && bun run
typecheck` green after every task from Task 2 onward (Task 1 alone is enough to typecheck on its
  own already).
- **Do not touch `packages/app/src/domain/legacy-templates.ts`, `packages/app/src/domain/
cache-policy.ts`, `packages/app/src/ui/side-panel-view.ts`, `packages/extension-chrome/src/
adapters/chrome-side-panel-mirror.ts`, `packages/extension-chrome/src/side-panel.ts`, or any
  `manifest.json`.** The design spec's §2.5/§4.1 pin these as explicitly out of scope — if a task
  seems to need one of them, stop; the assumption broke somewhere and the plan needs re-grounding,
  not an ad hoc edit.
- **`sourceLang` is always a bare BCP-47 primary subtag** (`'fr'`, not `"French"`) — mirrors how
  `target`/`{target_lang}` already rides the prompt as a bare code (`settings-form.ts`'s `#target`
  select ships `'vi'`/`'en'`). Human-readable names are UI-display-only (`SOURCE_LANG_LABELS` in
  `ui/lookup-card.ts`) and must never leak into `LookupRequest`, the wire schema, or the prompt.
- **A manual source-language override always bypasses the cache** (`sourceLangOverride: true`); an
  ordinary auto-detected lookup does not skip the cache (design spec §2.7 — this is intentional, not
  a bug to "fix" by extending the cache key, which is A9's card).
- S1/S4 are unaffected by this card (no secret data, no change to `markdown-sanitize.ts`) — no special
  handling needed, but do not introduce any.
- UI additions read only `--ad-*`/`--adp-*` design tokens (no hard-coded colors) — the new
  `.src-lang-row`/`.src-lang-row__change`/`.src-lang-menu` rules reuse the exact token set already
  proven by `.meta-row`/`.prov-switch`/`.prov-menu`.
- No manifest permission change anywhere in this plan.
- The e2e build must clear any ambient `GEMINI_API_KEY` (`GEMINI_API_KEY= bun run build:chrome`) —
  same repo-wide requirement as every other card's e2e task.

---

### Task 1: `domain/source-lang.ts` — the recognized source-language table + detection

**Files:**

- Create: `packages/app/src/domain/source-lang.ts`
- Create: `packages/app/test/source-lang.test.ts`
- Modify: `packages/app/src/index.ts`

**Interfaces:**

```ts
export const SOURCE_LANG_CODES: readonly string[]; // 20 entries, see Step 2
export type SourceLangCode = (typeof SOURCE_LANG_CODES)[number];
export function primarySubtag(tag: string): string;
export function detectSourceLangCode(pageLang: string | undefined): SourceLangCode | undefined;
```

- [ ] **Step 1: Write the failing tests.** Create `packages/app/test/source-lang.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { SOURCE_LANG_CODES, primarySubtag, detectSourceLangCode } from '../src/domain/source-lang';

describe('primarySubtag', () => {
  it('lowercases and strips a regional/script suffix', () => {
    expect(primarySubtag('FR-ca')).toBe('fr');
    expect(primarySubtag('en-US')).toBe('en');
    expect(primarySubtag('zh_Hans')).toBe('zh');
  });
  it('returns the tag unchanged (lowercased) when there is no suffix', () => {
    expect(primarySubtag('ja')).toBe('ja');
  });
});

describe('detectSourceLangCode', () => {
  it('returns undefined for undefined/empty input', () => {
    expect(detectSourceLangCode(undefined)).toBeUndefined();
    expect(detectSourceLangCode('')).toBeUndefined();
  });
  it('returns undefined for an unrecognized tag', () => {
    expect(detectSourceLangCode('xx')).toBeUndefined();
    expect(detectSourceLangCode('klingon')).toBeUndefined();
  });
  it('recognizes every code in SOURCE_LANG_CODES verbatim', () => {
    for (const code of SOURCE_LANG_CODES) {
      expect(detectSourceLangCode(code)).toBe(code);
    }
  });
  it('recognizes a regional variant by its primary subtag', () => {
    expect(detectSourceLangCode('en-US')).toBe('en');
    expect(detectSourceLangCode('FR-CA')).toBe('fr');
  });
  it('includes English as a recognized code (explicit, not a no-op exclusion)', () => {
    expect(SOURCE_LANG_CODES).toContain('en');
    expect(detectSourceLangCode('en')).toBe('en');
  });
});
```

Run: `cd packages/app && bunx vitest run test/source-lang.test.ts`
Expected: fails — `../src/domain/source-lang` does not exist.

- [ ] **Step 2: Implement.** Create `packages/app/src/domain/source-lang.ts`:

```ts
/**
 * A12 — non-English source pages. A fixed, code-owned table of BCP-47 primary-subtag source
 * languages this build recognizes for {source_lang} detection/override, mirroring how
 * {target_lang} already rides the prompt as a bare code (settings-form.ts's #target select ships
 * 'vi'/'en', not "Vietnamese"/"English") — {source_lang} follows the same convention. Human-
 * readable display names for the on-card override picker are a UI-only concern
 * (ui/lookup-card.ts's SOURCE_LANG_LABELS), exactly mirroring the Provider/PROVIDER_LABELS split.
 *
 * Domain-pure: zero imports (rule-domain-purity).
 */

/** Canonical order — also the order the card's override picker lists them in. */
export const SOURCE_LANG_CODES = [
  'fr',
  'es',
  'de',
  'it',
  'pt',
  'nl',
  'ja',
  'zh',
  'ko',
  'ru',
  'vi',
  'ar',
  'hi',
  'pl',
  'tr',
  'sv',
  'el',
  'th',
  'id',
  'en',
] as const;

export type SourceLangCode = (typeof SOURCE_LANG_CODES)[number];

const CODE_SET: ReadonlySet<string> = new Set(SOURCE_LANG_CODES);

/** Lowercase + take the primary subtag: "fr-CA" -> "fr", "en-US" -> "en", "EN" -> "en". */
export function primarySubtag(tag: string): string {
  return tag.trim().toLowerCase().split(/[-_]/)[0] ?? '';
}

/**
 * Resolve a raw page/element `lang` attribute value (as captured by
 * app/dom-selection-source.ts's readPageLang) to a recognized SourceLangCode, or undefined when
 * absent or unrecognized. Callers fall back to the neutral auto-phrase in that case — see
 * domain/prompt-template.ts's use of default-template.ts's AUTO_SOURCE_LANG_PHRASE.
 */
export function detectSourceLangCode(pageLang: string | undefined): SourceLangCode | undefined {
  if (!pageLang) return undefined;
  const code = primarySubtag(pageLang);
  return CODE_SET.has(code) ? (code as SourceLangCode) : undefined;
}
```

Add the barrel export in `packages/app/src/index.ts` — insert right after the existing
`export * from './domain/prompt-template';` line:

```ts
export * from './domain/types';
export * from './ports';
export * from './domain/default-template';
export * from './domain/prompt-template';
export * from './domain/source-lang';
export * from './domain/legacy-templates';
```

Run: `cd packages/app && bunx vitest run test/source-lang.test.ts`
Expected: all 8 tests pass.

- [ ] **Step 3: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck
cd ../.. && bun run lint && bun run format:check
```

```
git add packages/app/src/domain/source-lang.ts packages/app/test/source-lang.test.ts packages/app/src/index.ts
git commit -m "[A12NonEnglishSource] feat: add the recognized source-language code table + detection (A12)" \
  -m $'Tribe-Card: a12-non-english-source\nTribe-Task: 1/9'
```

---

### Task 2: `domain/types.ts` + `wire.ts` + `router.ts` — request fields + cache-skip guard

**Files:**

- Modify: `packages/app/src/domain/types.ts`
- Modify: `packages/app/src/wire.ts`
- Modify: `packages/app/src/app/router.ts`
- Modify: `packages/app/test/wire-schema.test.ts`
- Modify: `packages/app/test/app/router.test.ts`

**Interfaces:**

```ts
// domain/types.ts
export interface SelectionEvent {
  text: string;
  sentence: string;
  anchor: AnchorRect;
  url: string;
  title: string;
  pageLang?: string;
}
export interface LookupRequest {
  // ...unchanged fields...
  sourceLang?: string;
  sourceLangOverride?: boolean;
}
```

- [ ] **Step 1: Write the failing tests.**

In `packages/app/test/wire-schema.test.ts`, add (anywhere inside the `describe('wire-schema', ...)`
block):

```ts
it('[A12] accepts an optional req.sourceLang and req.sourceLangOverride on a lookup message', () => {
  const base = {
    type: 'lookup' as const,
    requestId: 'r1',
    req: {
      word: 'a',
      context: 'b',
      url: '',
      title: '',
      target: 'vi',
      outputFormat: 't',
      promptEnvelope: '',
    },
  };
  expect(WireMessageSchema.safeParse(base).success).toBe(true); // both fields omitted
  expect(
    WireMessageSchema.safeParse({
      ...base,
      req: { ...base.req, sourceLang: 'fr', sourceLangOverride: true },
    }).success,
  ).toBe(true);
});
```

In `packages/app/test/app/router.test.ts`, add a test right after the existing `'forceLiteral
override (req.forceLiteral) skips the cache read...'` test (around line 122):

```ts
it('[A12] sourceLangOverride (req.sourceLangOverride) skips the cache read — the re-picked language is fetched fresh', async () => {
  const d = deps();
  const route = buildRouter(d);
  await route(lookupMsg('a')); // populate cache with the default (auto-detected) answer
  d.client.lookup.mockClear();
  const reply = await route({
    type: 'lookup',
    req: { ...req, sourceLang: 'ja', sourceLangOverride: true },
    requestId: 'b',
  });
  expect(reply).toMatchObject({ ok: true, type: 'lookup', result: { fromCache: false } });
  expect(d.client.lookup).toHaveBeenCalledTimes(1);
});

it('[A12] an ordinary req.sourceLang WITHOUT sourceLangOverride still hits the cache normally', async () => {
  const d = deps();
  const route = buildRouter(d);
  await route(lookupMsg('a')); // populate cache
  d.client.lookup.mockClear();
  const reply = await route({
    type: 'lookup',
    req: { ...req, sourceLang: 'fr' },
    requestId: 'b',
  });
  expect(reply).toMatchObject({ ok: true, type: 'lookup', result: { fromCache: true } });
  expect(d.client.lookup).not.toHaveBeenCalled();
});
```

Run:

```
cd packages/app && bunx vitest run test/wire-schema.test.ts test/app/router.test.ts
```

Expected: the two new `router.test.ts` cases and the new `wire-schema.test.ts` case fail (schema
rejects the extra fields / router has no `sourceLangOverride` guard yet).

- [ ] **Step 2: Implement.**

In `packages/app/src/domain/types.ts`, extend `SelectionEvent` (currently 8-14):

```ts
export interface SelectionEvent {
  text: string;
  sentence: string;
  anchor: AnchorRect;
  url: string;
  title: string;
  /**
   * A12: the raw `lang` attribute value captured at selection time (nearest-ancestor
   * `[lang]`, falling back to `document.documentElement.lang`) — see
   * app/dom-selection-source.ts's readPageLang. Unparsed; domain/source-lang.ts's
   * detectSourceLangCode does the recognition step. Absent when neither source declared one.
   */
  pageLang?: string;
}
```

Extend `LookupRequest` — add these two fields right after the existing `forceLiteral?: boolean |
undefined;` field:

```ts
  /**
   * A12: the source language of the word/sentence, as a bare BCP-47 primary subtag (e.g. 'fr'),
   * exactly like `target` already carries {target_lang} as a bare code. Set from
   * domain/source-lang.ts's detectSourceLangCode when recognized, or from a manual card
   * override; absent means "could not be determined" — buildPrompt then falls back to the
   * neutral AUTO_SOURCE_LANG_PHRASE instruction instead of assuming English.
   */
  sourceLang?: string | undefined;
  /**
   * A12: true only when `sourceLang` above came from a manual, one-shot card override (including
   * an explicit re-pick of "Auto-detect") rather than ordinary auto-detection. The router skips
   * the cache read when this is true — mirrors `provider`/`forceLiteral`'s existing skip-cache
   * reasoning (a cache hit would echo back an answer produced under the OLD source-language
   * assumption, silently ignoring the override).
   */
  sourceLangOverride?: boolean | undefined;
```

In `packages/app/src/wire.ts`, extend `LookupRequestSchema` (currently 26-39) — add right after
`forceLiteral: z.boolean().optional(),`:

```ts
const LookupRequestSchema = z.strictObject({
  word: z.string(),
  context: z.string(),
  url: z.string(),
  title: z.string(),
  target: z.string(),
  outputFormat: z.string(),
  promptEnvelope: z.string(),
  provider: ProviderEnum.optional(),
  forceLiteral: z.boolean().optional(),
  // A12: bare BCP-47 primary subtag (e.g. 'fr'); absent = could not be determined.
  sourceLang: z.string().optional(),
  // A12: true only for a manual, one-shot override — see domain/types.ts's doc comment.
  sourceLangOverride: z.boolean().optional(),
});
```

In `packages/app/src/app/router.ts`, extend `handleLookup`'s cache-skip guard (currently lines
110-114):

```ts
      // A manual provider pick (req.provider set) must reach the picked provider: the cache key
      // ignores provider, so a hit would echo back the previous provider's answer. Skip the read.
      // A8: the same reasoning applies to a forced-literal re-run (req.forceLiteral) — a hit
      // would echo back the smart idiom-aware answer instead of the literal one requested.
      // A12: same reasoning for a manual source-language override (req.sourceLangOverride) — a
      // hit would echo back an answer produced under the OLD source-language assumption.
      if (
        cacheEnabled &&
        req.provider === undefined &&
        req.forceLiteral !== true &&
        req.sourceLangOverride !== true
      ) {
        const hit = await cacheGet({ storage: deps.kv }, keyReq);
```

(The rest of the `if` block's body — the `hit` handling — is unchanged; only the condition grows.)

Run:

```
cd packages/app && bunx vitest run test/wire-schema.test.ts test/app/router.test.ts
```

Expected: all pass, including the 3 new cases.

- [ ] **Step 3: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck
cd ../.. && bun run lint && bun run format:check
```

```
git add packages/app/src/domain/types.ts packages/app/src/wire.ts packages/app/src/app/router.ts \
  packages/app/test/wire-schema.test.ts packages/app/test/app/router.test.ts
git commit -m "[A12NonEnglishSource] feat: add sourceLang/sourceLangOverride request fields + cache-skip guard (A12)" \
  -m $'Tribe-Card: a12-non-english-source\nTribe-Task: 2/9'
```

---

### Task 3: `default-template.ts` + `prompt-template.ts` + `http-lookup-client.ts` — the prompt fix itself

**Files:**

- Modify: `packages/app/src/domain/default-template.ts`
- Modify: `packages/app/src/domain/prompt-template.ts`
- Modify: `packages/app/src/app/http-lookup-client.ts`
- Modify: `packages/app/test/default-template.test.ts`
- Modify: `packages/app/test/prompt-template.test.ts`

**Interfaces:**

```ts
// default-template.ts
export const AUTO_SOURCE_LANG_PHRASE: string;
```

- [ ] **Step 1: Write the failing tests.**

In `packages/app/test/default-template.test.ts`, add a new `describe` block (after the existing
`PROMPT_ENVELOPE (B2 translation slot)` block):

```ts
describe('PROMPT_ENVELOPE (A12 source-language slot)', () => {
  it('carries the {source_lang} placeholder, not a hard-coded "English"', () => {
    expect(PROMPT_ENVELOPE).toContain('{source_lang}');
    expect(PROMPT_ENVELOPE).not.toContain('of English');
  });
});

describe('AUTO_SOURCE_LANG_PHRASE', () => {
  it('instructs inference from context rather than assuming English', () => {
    expect(AUTO_SOURCE_LANG_PHRASE.toLowerCase()).toContain('infer');
    expect(AUTO_SOURCE_LANG_PHRASE).not.toBe('English');
  });
});
```

Update the top import to also pull in `AUTO_SOURCE_LANG_PHRASE`:

```ts
import {
  PROMPT_ENVELOPE,
  DEFAULT_OUTPUT_FORMAT,
  IDIOM_AUTO_INSTRUCTION,
  IDIOM_FORCE_LITERAL_INSTRUCTION,
  TRANSLATION_INSTRUCTION,
  AUTO_SOURCE_LANG_PHRASE,
} from '../src/domain/default-template';
```

In `packages/app/test/prompt-template.test.ts`, replace the existing test named `'defaults
{source_lang} to English when not supplied'` (lines 25-28) with:

```ts
it('defaults {source_lang} to the neutral auto-infer phrase when not supplied (A12)', () => {
  expect(renderTemplate('{source_lang}', { word: '', context: '', target_lang: 'vi' })).toBe(
    AUTO_SOURCE_LANG_PHRASE,
  );
});
```

and update its import line:

```ts
import { renderTemplate, buildPrompt } from '../src/domain/prompt-template';
import { DEFAULT_OUTPUT_FORMAT, AUTO_SOURCE_LANG_PHRASE } from '../src/domain/default-template';
```

Also add, inside the existing `describe('buildPrompt', ...)` block (after the `'renders the shipped
default format end-to-end'` test):

```ts
it('a supplied source_lang reaches the assembled persona line (A12)', () => {
  const out = buildPrompt(DEFAULT_OUTPUT_FORMAT, { ...vars, source_lang: 'fr' });
  expect(out).toContain('learners of fr');
});

it('falls back to the neutral auto-infer phrase when source_lang is not supplied (A12)', () => {
  const out = buildPrompt(DEFAULT_OUTPUT_FORMAT, vars); // vars has no source_lang
  expect(out).toContain(AUTO_SOURCE_LANG_PHRASE);
  expect(out).not.toContain('learners of English');
});
```

Run: `cd packages/app && bunx vitest run test/default-template.test.ts test/prompt-template.test.ts`
Expected: the new/changed cases fail (`AUTO_SOURCE_LANG_PHRASE` doesn't exist yet; `PROMPT_ENVELOPE`
still says "of English").

- [ ] **Step 2: Implement.**

In `packages/app/src/domain/default-template.ts`, change line 14's persona sentence:

```ts
export const PROMPT_ENVELOPE = `You are a bilingual dictionary for {target_lang} learners of {source_lang}.
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

(Only the one word "English" → `{source_lang}` on the first line changes; every other line of
`PROMPT_ENVELOPE` is byte-for-byte unchanged.)

Append a new constant at the end of the file, after `TRANSLATION_INSTRUCTION`:

```ts
/**
 * A12 — non-English source pages. Fallback text for {source_lang} when detection found nothing
 * confident (no recognized page/element `lang` attribute) and the reader has not manually
 * overridden it. Replaces the previous hard-coded 'English' default
 * (prompt-template.ts's old `vars.source_lang ?? 'English'`) with an instruction that lets the
 * model infer the source language from the sentence itself, rather than presupposing English for
 * every page whose language could not be determined.
 */
export const AUTO_SOURCE_LANG_PHRASE =
  'an unspecified language — infer the source language of the word/sentence from context; do not assume English';
```

In `packages/app/src/domain/prompt-template.ts`, update the import and the `resolved` fallback:

```ts
import {
  PROMPT_ENVELOPE,
  IDIOM_AUTO_INSTRUCTION,
  IDIOM_FORCE_LITERAL_INSTRUCTION,
  TRANSLATION_INSTRUCTION,
  AUTO_SOURCE_LANG_PHRASE,
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
    source_lang: vars.source_lang ?? AUTO_SOURCE_LANG_PHRASE,
  };
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    if (!SUPPORTED.includes(name as (typeof SUPPORTED)[number])) return match;
    const value = resolved[name];
    return value ?? match;
  });
}
```

(`buildPrompt` itself needs no changes — `{source_lang}` was already part of the generic
`SUPPORTED`/`resolved` substitution pass before this card.)

In `packages/app/src/app/http-lookup-client.ts`, update the `buildPrompt` call inside
`runHttpLookup` (currently lines 83-94):

```ts
const prompt = buildPrompt(
  req.outputFormat,
  {
    word: req.word,
    context: req.context,
    target_lang: req.target,
    ...(req.sourceLang !== undefined ? { source_lang: req.sourceLang } : {}),
    url: req.url,
    title: req.title,
  },
  req.promptEnvelope,
  req.forceLiteral,
);
```

Run: `cd packages/app && bunx vitest run test/default-template.test.ts test/prompt-template.test.ts`
Expected: all pass, including the new/changed cases.

- [ ] **Step 3: Run the full unit suite to catch any other test asserting the old wording:**

```
cd packages/app && bun run test
```

Expected: all pass (no other test in the repo asserts the literal `"learners of English"` string —
verified by `grep -rn "learners of English" packages` returning only `legacy-templates.ts`, which
this task does not touch).

- [ ] **Step 4: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck
cd ../.. && bun run lint && bun run format:check
```

```
git add packages/app/src/domain/default-template.ts packages/app/src/domain/prompt-template.ts \
  packages/app/src/app/http-lookup-client.ts packages/app/test/default-template.test.ts \
  packages/app/test/prompt-template.test.ts
git commit -m "[A12NonEnglishSource] feat: resolve {source_lang} in the persona line instead of hard-coding English (A12)" \
  -m $'Tribe-Card: a12-non-english-source\nTribe-Task: 3/9'
```

---

### Task 4: `dom-selection-source.ts` — capture the page/element language at selection time

**Files:**

- Modify: `packages/app/src/app/dom-selection-source.ts`
- Modify: `packages/app/test/app/dom-selection-source.test.ts`

**Interfaces:**

```ts
// internal, not exported — readPageLang(range: Range): string | undefined
// SelectionEvent (domain/types.ts) already carries the new `pageLang?: string` field from Task 2.
```

- [ ] **Step 1: Write the failing tests.** Add to the existing `describe('defaultReader ...)` block
      in `packages/app/test/app/dom-selection-source.test.ts` (after the existing "whitespace-only"
      test):

```ts
it('captures document.documentElement.lang as pageLang when no ancestor overrides it (A12)', () => {
  document.documentElement.lang = 'fr';
  document.body.innerHTML = '<p id="lang-test">Le petit chat noir.</p>';
  const p = document.getElementById('lang-test')!;
  const textNode = p.firstChild!;
  const sel = window.getSelection()!;
  const range = document.createRange();
  range.setStart(textNode, 3);
  range.setEnd(textNode, 8); // 'petit'
  sel.removeAllRanges();
  sel.addRange(range);

  const src = new DomSelectionSource(document);
  const cb = vi.fn();
  const teardown = src.onSelection(cb);
  document.dispatchEvent(new Event('mouseup'));
  const event = cb.mock.calls[0]?.[0] as SelectionEvent;
  expect(event.pageLang).toBe('fr');

  sel.removeAllRanges();
  teardown();
  document.body.innerHTML = '';
  document.documentElement.lang = '';
});

it('a nearest-ancestor [lang] wins over document.documentElement.lang (A12)', () => {
  document.documentElement.lang = 'en';
  document.body.innerHTML = '<div lang="ja"><p id="lang-test2">日本語のテキスト</p></div>';
  const p = document.getElementById('lang-test2')!;
  const textNode = p.firstChild!;
  const sel = window.getSelection()!;
  const range = document.createRange();
  range.setStart(textNode, 0);
  range.setEnd(textNode, 3);
  sel.removeAllRanges();
  sel.addRange(range);

  const src = new DomSelectionSource(document);
  const cb = vi.fn();
  const teardown = src.onSelection(cb);
  document.dispatchEvent(new Event('mouseup'));
  const event = cb.mock.calls[0]?.[0] as SelectionEvent;
  expect(event.pageLang).toBe('ja');

  sel.removeAllRanges();
  teardown();
  document.body.innerHTML = '';
  document.documentElement.lang = '';
});

it('pageLang is absent (key omitted) when no lang attribute exists anywhere (A12)', () => {
  document.documentElement.lang = '';
  document.body.innerHTML = '<p id="lang-test3">plain text</p>';
  const p = document.getElementById('lang-test3')!;
  const textNode = p.firstChild!;
  const sel = window.getSelection()!;
  const range = document.createRange();
  range.setStart(textNode, 0);
  range.setEnd(textNode, 5);
  sel.removeAllRanges();
  sel.addRange(range);

  const src = new DomSelectionSource(document);
  const cb = vi.fn();
  const teardown = src.onSelection(cb);
  document.dispatchEvent(new Event('mouseup'));
  const event = cb.mock.calls[0]?.[0] as SelectionEvent;
  expect(event.pageLang).toBeUndefined();
  expect('pageLang' in event).toBe(false); // exactOptionalPropertyTypes: key must be OMITTED

  sel.removeAllRanges();
  teardown();
  document.body.innerHTML = '';
});
```

Run: `cd packages/app && bunx vitest run test/app/dom-selection-source.test.ts`
Expected: the 3 new tests fail (`event.pageLang` is always `undefined`/absent today, but the second
test — nearest-ancestor beating `document.documentElement.lang='en'` — would coincidentally also read
`undefined` today, so this is a true red: the assertion `toBe('ja')` fails since nothing populates it
yet).

- [ ] **Step 2: Implement.** In `packages/app/src/app/dom-selection-source.ts`:

```ts
import type { SelectionSource, SelectionEvent, AnchorRect } from '../index';

const TERMINATORS = ['.', '!', '?'];

// A15: cheap, permanent instrumentation mark — the earliest synchronous JS observation of "the
// browser told us the selection gesture ended." See docs/superpowers/specs/
// 2026-07-17-a15-trigger-latency-budget-design.md §3.
export const SELECTION_FIRED_MARK = 'ai-dict:selection-fired';

export function extractSentence(full: string, selStart: number, selEnd: number): string {
  const before = full.slice(0, selStart);
  const start = Math.max(...TERMINATORS.map((t) => before.lastIndexOf(t))) + 1;
  const after = full.slice(selEnd);
  const ends = TERMINATORS.map((t) => after.indexOf(t)).filter((i) => i >= 0);
  const end = ends.length ? selEnd + Math.min(...ends) + 1 : full.length;
  return full.slice(start, end).trim();
}

/**
 * A12: the nearest-ancestor `lang` attribute wins over the page-level default — embedded
 * foreign-language quotes/passages are common on otherwise-English pages (W3C i18n convention:
 * mark the passage, not just <html>). Falls back to document.documentElement.lang when no
 * ancestor declares one. Returns the raw tag, unparsed; domain/source-lang.ts's
 * detectSourceLangCode does the recognition step.
 */
function readPageLang(range: Range): string | undefined {
  const node = range.commonAncestorContainer;
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  const lang = el?.closest('[lang]')?.getAttribute('lang') || document.documentElement.lang;
  return lang || undefined;
}

// Default DOM reader: window selection → SelectionEvent. Thin + covered by e2e; unit tests inject a fake.
function defaultReader(): SelectionEvent | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const text = sel.toString().trim();
  if (!text) return null;
  const range = sel.getRangeAt(0);
  const full = range.startContainer.textContent ?? text;
  const r = range.getBoundingClientRect();
  const anchor: AnchorRect = { x: r.x, y: r.y, w: r.width, h: r.height };
  const pageLang = readPageLang(range);
  return {
    text,
    sentence: extractSentence(full, range.startOffset, range.endOffset),
    anchor,
    url: location.href,
    title: document.title,
    ...(pageLang !== undefined ? { pageLang } : {}),
  };
}

type DocEvents = Pick<Document, 'addEventListener' | 'removeEventListener'>;

export class DomSelectionSource implements SelectionSource {
  constructor(
    private readonly doc: DocEvents,
    private readonly read: () => SelectionEvent | null = defaultReader,
  ) {}

  onSelection(cb: (e: SelectionEvent) => void): () => void {
    const handler = (): void => {
      const e = this.read();
      if (e) {
        performance.mark(SELECTION_FIRED_MARK);
        cb(e);
      }
    };
    for (const t of ['mouseup', 'touchend'] as const) this.doc.addEventListener(t, handler);
    return () => {
      for (const t of ['mouseup', 'touchend'] as const) this.doc.removeEventListener(t, handler);
    };
  }
}
```

**Note for the implementer:** re-read this file before editing. As of this pair's last review
(2026-07-23), A15 has **not** landed — `dom-selection-source.ts` carries zero occurrences of
`SELECTION_FIRED_MARK`/`performance.mark` (verified by grep); only A15's plan exists so far. Apply
the diff (the `readPageLang` function + the `defaultReader` body changes) verbatim against the file
as it stands — do not treat the `SELECTION_FIRED_MARK`/`performance.mark` lines shown above as
pre-existing. If A15 has landed by execution time, its additive marks do not conflict with this
card's change; apply this card's diff around them instead of overwriting them.

Run: `cd packages/app && bunx vitest run test/app/dom-selection-source.test.ts`
Expected: all tests pass (existing + 3 new).

- [ ] **Step 3: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck
cd ../.. && bun run lint && bun run format:check
```

```
git add packages/app/src/app/dom-selection-source.ts packages/app/test/app/dom-selection-source.test.ts
git commit -m "[A12NonEnglishSource] feat: capture page/element lang on selection (A12)" \
  -m $'Tribe-Card: a12-non-english-source\nTribe-Task: 4/9'
```

---

### Task 5: `workflow.ts` + `ports.ts` — thread detection/override through the lookup workflow

**Files:**

- Modify: `packages/app/src/domain/workflow.ts`
- Modify: `packages/app/src/ports.ts`
- Modify: `packages/app/test/workflow.test.ts`

**Interfaces:**

```ts
// ports.ts — ResultRenderContext gains:
sourceLang?: string;
onOverrideSourceLang?: (code: string) => void;
```

- [ ] **Step 1: Write the failing tests.** Add to `packages/app/test/workflow.test.ts`, inside the
      `describe('runLookupWorkflow', ...)` block (after the existing `'a literal result (no
definedAs)...'` test, before the error-mapping tests):

```ts
it('[A12] a recognized e.pageLang yields req.sourceLang and ctx.sourceLang, no sourceLangOverride', async () => {
  const h = harness({});
  h.selection.emit({ ...sel, pageLang: 'fr' });
  h.trigger.click();
  await vi.waitFor(() => expect(h.renderer.calls).toContain('result'));
  expect(h.client.lastReq).toMatchObject({ sourceLang: 'fr' });
  expect(h.client.lastReq?.sourceLangOverride).toBeUndefined();
  expect(h.renderer.lastCtx?.sourceLang).toBe('fr');
});

it('[A12] an unrecognized/absent e.pageLang leaves req.sourceLang and ctx.sourceLang unset', async () => {
  const h = harness({});
  h.selection.emit(sel); // no pageLang
  h.trigger.click();
  await vi.waitFor(() => expect(h.renderer.calls).toContain('result'));
  expect(h.client.lastReq?.sourceLang).toBeUndefined();
  expect(h.renderer.lastCtx?.sourceLang).toBeUndefined();
});

it('[A12] ctx.onOverrideSourceLang always exists (unconditional, unlike the provider picker)', async () => {
  const h = harness({});
  h.selection.emit(sel);
  h.trigger.click();
  await vi.waitFor(() => expect(h.renderer.calls).toContain('result'));
  expect(typeof h.renderer.lastCtx?.onOverrideSourceLang).toBe('function');
});

it('[A12] onOverrideSourceLang re-runs with req.sourceLang + sourceLangOverride:true, bypassing cooldown', async () => {
  let t = 5000;
  const h = harness({ now: () => t });
  h.selection.emit({ ...sel, pageLang: 'fr' });
  h.trigger.click();
  await vi.waitFor(() => expect(h.renderer.calls).toContain('result'));
  const override = h.renderer.lastCtx!.onOverrideSourceLang!;
  t = 5001; // still inside the cooldown window — a deliberate override must NOT be blocked
  override('ja');
  await vi.waitFor(() => expect(h.renderer.calls.filter((c) => c === 'result').length).toBe(2));
  expect(h.client.lastReq).toMatchObject({ sourceLang: 'ja', sourceLangOverride: true });
  expect(h.renderer.lastError).toBeNull();
});

it('[A12] overriding with "auto" clears req.sourceLang but still sets sourceLangOverride:true', async () => {
  let t = 5000;
  const h = harness({ now: () => t });
  h.selection.emit({ ...sel, pageLang: 'fr' });
  h.trigger.click();
  await vi.waitFor(() => expect(h.renderer.calls).toContain('result'));
  const override = h.renderer.lastCtx!.onOverrideSourceLang!;
  t = 5001;
  override('auto');
  await vi.waitFor(() => expect(h.renderer.calls.filter((c) => c === 'result').length).toBe(2));
  expect(h.client.lastReq?.sourceLang).toBeUndefined();
  expect(h.client.lastReq?.sourceLangOverride).toBe(true);
});

it('[A12] onSwitchProvider drops a current forceLiteral (sibling-drop precedent) but threads sourceLangOverride', async () => {
  let t = 5000;
  const idiomResult: LookupResult = {
    ...okResult,
    definedAs: { term: 'kick the bucket', isIdiom: true },
  };
  const h = harness({
    configuredProviders: ['gemini', 'openai'],
    now: () => t,
    impl: () => Promise.resolve(idiomResult),
  });
  h.selection.emit(sel);
  h.trigger.click();
  await vi.waitFor(() => expect(h.renderer.calls).toContain('result'));

  // Set a manual source-language override first.
  t += 1;
  h.renderer.lastCtx!.onOverrideSourceLang!('fr');
  await vi.waitFor(() => expect(h.renderer.calls.filter((c) => c === 'result').length).toBe(2));

  // Force literal from that ctx — forceLiteral becomes true, sourceLangOverride stays threaded.
  t += 1;
  h.renderer.lastCtx!.onForceLiteral!();
  await vi.waitFor(() => expect(h.renderer.calls.filter((c) => c === 'result').length).toBe(3));
  expect(h.client.lastReq?.forceLiteral).toBe(true);

  // Now switch provider from THIS ctx (forceLiteral currently true) — it must be dropped, not
  // threaded, while the source-language override survives.
  t += 1;
  h.renderer.lastCtx!.onSwitchProvider!('openai');
  await vi.waitFor(() => expect(h.renderer.calls.filter((c) => c === 'result').length).toBe(4));
  expect(h.client.lastReq?.provider).toBe('openai');
  expect(h.client.lastReq?.forceLiteral).toBeUndefined();
  expect(h.client.lastReq?.sourceLang).toBe('fr');
  expect(h.client.lastReq?.sourceLangOverride).toBe(true);
  expect(h.renderer.lastError).toBeNull();
});

it('[A12] onForceLiteral drops a current providerOverride (sibling-drop precedent) but threads sourceLangOverride', async () => {
  let t = 5000;
  const idiomResult: LookupResult = {
    ...okResult,
    definedAs: { term: 'kick the bucket', isIdiom: true },
  };
  const h = harness({
    configuredProviders: ['gemini', 'openai'],
    now: () => t,
    impl: () => Promise.resolve(idiomResult),
  });
  h.selection.emit(sel);
  h.trigger.click();
  await vi.waitFor(() => expect(h.renderer.calls).toContain('result'));

  // Set a manual source-language override first.
  t += 1;
  h.renderer.lastCtx!.onOverrideSourceLang!('fr');
  await vi.waitFor(() => expect(h.renderer.calls.filter((c) => c === 'result').length).toBe(2));

  // Switch provider from that ctx — provider becomes 'openai', sourceLangOverride stays threaded.
  t += 1;
  h.renderer.lastCtx!.onSwitchProvider!('openai');
  await vi.waitFor(() => expect(h.renderer.calls.filter((c) => c === 'result').length).toBe(3));
  expect(h.client.lastReq?.provider).toBe('openai');

  // Now force literal from THIS ctx (provider currently 'openai') — it must be dropped, not
  // threaded, while the source-language override survives.
  t += 1;
  h.renderer.lastCtx!.onForceLiteral!();
  await vi.waitFor(() => expect(h.renderer.calls.filter((c) => c === 'result').length).toBe(4));
  expect(h.client.lastReq?.forceLiteral).toBe(true);
  expect(h.client.lastReq?.provider).toBeUndefined();
  expect(h.client.lastReq?.sourceLang).toBe('fr');
  expect(h.client.lastReq?.sourceLangOverride).toBe(true);
  expect(h.renderer.lastError).toBeNull();
});

it('[A12] onOverrideSourceLang always drops BOTH providerOverride and forceLiteral, whichever is currently set', async () => {
  let t = 5000;
  const idiomResult: LookupResult = {
    ...okResult,
    definedAs: { term: 'kick the bucket', isIdiom: true },
  };
  const h = harness({
    configuredProviders: ['gemini', 'openai'],
    now: () => t,
    impl: () => Promise.resolve(idiomResult),
  });
  h.selection.emit(sel);
  h.trigger.click();
  await vi.waitFor(() => expect(h.renderer.calls).toContain('result'));

  // Switch provider — provider becomes 'openai'.
  t += 1;
  h.renderer.lastCtx!.onSwitchProvider!('openai');
  await vi.waitFor(() => expect(h.renderer.calls.filter((c) => c === 'result').length).toBe(2));
  expect(h.client.lastReq?.provider).toBe('openai');

  // Override source lang from THIS ctx — providerOverride must NOT carry through.
  t += 1;
  h.renderer.lastCtx!.onOverrideSourceLang!('ja');
  await vi.waitFor(() => expect(h.renderer.calls.filter((c) => c === 'result').length).toBe(3));
  expect(h.client.lastReq?.provider).toBeUndefined();
  expect(h.client.lastReq?.forceLiteral).toBeUndefined();
  expect(h.client.lastReq?.sourceLang).toBe('ja');
  expect(h.client.lastReq?.sourceLangOverride).toBe(true);

  // Force literal from THIS ctx — forceLiteral becomes true (provider stays dropped).
  t += 1;
  h.renderer.lastCtx!.onForceLiteral!();
  await vi.waitFor(() => expect(h.renderer.calls.filter((c) => c === 'result').length).toBe(4));
  expect(h.client.lastReq?.forceLiteral).toBe(true);
  expect(h.client.lastReq?.provider).toBeUndefined();

  // Override source lang again from THIS ctx — forceLiteral must NOT carry through either.
  t += 1;
  h.renderer.lastCtx!.onOverrideSourceLang!('auto');
  await vi.waitFor(() => expect(h.renderer.calls.filter((c) => c === 'result').length).toBe(5));
  expect(h.client.lastReq?.forceLiteral).toBeUndefined();
  expect(h.client.lastReq?.provider).toBeUndefined();
  expect(h.client.lastReq?.sourceLang).toBeUndefined();
  expect(h.client.lastReq?.sourceLangOverride).toBe(true);
  expect(h.renderer.lastError).toBeNull();
});
```

Run: `cd packages/app && bunx vitest run test/workflow.test.ts`
Expected: the 8 new cases fail (`ResultRenderContext` has no `sourceLang`/`onOverrideSourceLang` yet;
`req` never carries `sourceLang`).

- [ ] **Step 2: Implement.**

In `packages/app/src/ports.ts`, extend `ResultRenderContext` (currently 26-48) — add after the
existing `onForceLiteral` field:

```ts
  /**
   * A12: re-run the SAME selection once, forcing the literal single-word reading. Present only
   * when the result just rendered is an idiom (`result.definedAs?.isIdiom === true`).
   */
  onForceLiteral?: () => void;
  /**
   * A12: the effective source-language code (bare BCP-47 subtag, e.g. 'fr') used for this
   * result — from auto-detection or a manual override. Absent means "could not be determined"
   * (the auto-phrase fallback was used). Always present on the ctx object when set (unlike
   * `providers`, which is conditional on >=2 configured); the card's Source row shows
   * "Auto-detect" when this is absent.
   */
  sourceLang?: string;
  /**
   * A12: re-run the SAME selection once with a manually picked source language (or 'auto' to
   * reset detection). Always present — unlike onSwitchProvider/onForceLiteral, this control is
   * offered unconditionally on every result.
   */
  onOverrideSourceLang?: (code: string) => void;
```

In `packages/app/src/domain/workflow.ts`:

```ts
import type {
  SelectionSource,
  TriggerUI,
  ResultRenderer,
  ResultRenderContext,
  LookupClient,
  SettingsStore,
} from '../ports';
import type { SelectionEvent, LookupRequest, LookupError, Provider } from './types';
import { isLookupError } from './types';
import { mapError } from './error-mapper';
import { detectSourceLangCode, type SourceLangCode } from './source-lang';

// A human spamming Define fires a burst of sequential lookups that trip the provider's
// per-minute quota (Gemini 429 / RESOURCE_EXHAUSTED). Gate lookups to at most one per this
// window — first-come-first-served: the first fires immediately; a follow-up within the
// window is blocked with a 'slow down' message (see the cooldown gate below).
export const COOLDOWN_MS = 2000;

export interface WorkflowDeps {
  selection: SelectionSource;
  trigger: TriggerUI;
  renderer: ResultRenderer;
  client: LookupClient;
  settings: SettingsStore;
  now?: () => number;
}

function toLookupError(err: unknown): LookupError {
  return isLookupError(err) ? err : mapError({ kind: 'thrown', error: err });
}

export function runLookupWorkflow(deps: WorkflowDeps): () => void {
  let inFlight: AbortController | null = null;
  let lastFireAt = -Infinity;
  const now = deps.now ?? (() => Date.now());

  async function runLookup(
    e: SelectionEvent,
    providerOverride?: Provider,
    forceLiteral?: boolean,
    sourceLangOverride?: SourceLangCode | 'auto',
  ): Promise<void> {
    inFlight?.abort();
    const controller = new AbortController();
    inFlight = controller;

    const settings = await deps.settings.get().finally(() => {
      if (!controller.signal.aborted) deps.trigger.hide();
    });
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
    if (providerOverride) req.provider = providerOverride;
    if (forceLiteral) req.forceLiteral = true;
    // A12: a manual override always wins (including an explicit 'auto' reset); otherwise
    // auto-detect from the page/element lang captured on the selection event.
    const effectiveSourceLang: SourceLangCode | undefined =
      sourceLangOverride !== undefined
        ? sourceLangOverride === 'auto'
          ? undefined
          : sourceLangOverride
        : detectSourceLangCode(e.pageLang);
    if (effectiveSourceLang !== undefined) req.sourceLang = effectiveSourceLang;
    if (sourceLangOverride !== undefined) req.sourceLangOverride = true;
    try {
      const result = await deps.client.lookup(req, { signal: controller.signal });
      const showPicker = settings.configuredProviders.length >= 2;
      const isIdiom = result.definedAs?.isIdiom === true;
      const ctx: ResultRenderContext = {
        sentence: e.sentence,
        url: e.url,
        title: e.title,
        // A12: always offered, regardless of provider count/idiom-ness (unlike the picker/
        // force-literal below, which only appear conditionally) — the card always shows the row.
        onOverrideSourceLang: (code: SourceLangCode | 'auto') => {
          // Deliberate override bypasses the Define-spam cooldown — same reasoning as
          // onSwitchProvider/onForceLiteral below. Drops BOTH providerOverride and forceLiteral
          // (a fresh source-language pick is its own independent one-shot), matching the
          // existing sibling-drop precedent those two already follow with each other — see the
          // design spec §5.9's behavior-preserving note.
          void runLookup(e, undefined, undefined, code).catch((err) =>
            deps.renderer.renderError(mapError({ kind: 'thrown', error: err })),
          );
        },
        ...(effectiveSourceLang !== undefined ? { sourceLang: effectiveSourceLang } : {}),
        ...(showPicker
          ? {
              providers: settings.configuredProviders,
              onSwitchProvider: (p: Provider) => {
                // Deliberate switch bypasses the Define-spam cooldown — it's not spam. Drops
                // forceLiteral (existing, already-shipped precedent — unchanged by this card);
                // threads sourceLangOverride through so a manual source-language pick survives.
                void runLookup(e, p, undefined, sourceLangOverride).catch((err) =>
                  deps.renderer.renderError(mapError({ kind: 'thrown', error: err })),
                );
              },
            }
          : {}),
        ...(isIdiom
          ? {
              onForceLiteral: () => {
                // Deliberate override bypasses the Define-spam cooldown — same reasoning
                // as onSwitchProvider above. Drops providerOverride (existing, already-shipped
                // precedent — unchanged by this card); threads sourceLangOverride through.
                void runLookup(e, undefined, true, sourceLangOverride).catch((err) =>
                  deps.renderer.renderError(mapError({ kind: 'thrown', error: err })),
                );
              },
            }
          : {}),
      };
      if (!controller.signal.aborted) deps.renderer.renderResult(result, ctx);
    } catch (err) {
      if (!controller.signal.aborted) deps.renderer.renderError(toLookupError(err));
    } finally {
      if (inFlight === controller) inFlight = null;
    }
  }

  const teardown = deps.selection.onSelection((e) => {
    deps.trigger.show(e.anchor, () => {
      const t = now();
      if (t - lastFireAt < COOLDOWN_MS) {
        deps.trigger.hide();
        deps.renderer.renderError(mapError({ kind: 'cooldown' }));
        return;
      }
      lastFireAt = t;
      void runLookup(e).catch((err) =>
        deps.renderer.renderError(mapError({ kind: 'thrown', error: err })),
      );
    });
  });

  return () => {
    inFlight?.abort();
    inFlight = null;
    deps.trigger.hide();
    deps.renderer.close();
    teardown();
  };
}
```

Run: `cd packages/app && bunx vitest run test/workflow.test.ts`
Expected: all pass (existing + 8 new).

- [ ] **Step 3: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck
cd ../.. && bun run lint && bun run format:check
```

```
git add packages/app/src/domain/workflow.ts packages/app/src/ports.ts packages/app/test/workflow.test.ts
git commit -m "[A12NonEnglishSource] feat: thread source-language detection + one-shot override through the workflow (A12)" \
  -m $'Tribe-Card: a12-non-english-source\nTribe-Task: 5/9'
```

---

### Task 6: `ui/lookup-card.ts` — the "Source: … / Change" row

**Files:**

- Modify: `packages/app/src/ui/lookup-card.ts`
- Modify: `packages/app/test/ui/lookup-card.test.ts`

**Interfaces:**

```ts
export const SOURCE_LANG_LABELS: Record<SourceLangCode, string>;
// CardState's 'result' variant gains: sourceLang?: string;
// dispatches: new CustomEvent('override-source-lang', { detail: { code: string }, bubbles: true, composed: true })
```

- [ ] **Step 1: Write the failing tests.** Add to `packages/app/test/ui/lookup-card.test.ts` (find
      the existing `describe`/`renderCardState` test block and add nearby; adapt the mount/state
      helper already used by the surrounding tests in this file — e.g. if the file exposes a
      `resultState(overrides)` helper or builds state objects inline, follow that file's own existing
      pattern for constructing a `{ kind: 'result', ... }` state):

```ts
describe('renderCardState — source language row (A12)', () => {
  const base = {
    kind: 'result' as const,
    safeHtml: '<p>def</p>' as SafeHtml,
    word: 'bank',
    target: 'vi',
  };

  it('shows "Source: French" when sourceLang is a recognized code', () => {
    const nodes = renderCardState({ ...base, sourceLang: 'fr' });
    const row = nodes.find(
      (n): n is HTMLElement => n instanceof HTMLElement && n.className === 'src-lang-row',
    )!;
    expect(row.textContent).toContain('Source: French');
  });

  it('shows "Source: Auto-detect" when sourceLang is absent', () => {
    const nodes = renderCardState({ ...base });
    const row = nodes.find(
      (n): n is HTMLElement => n instanceof HTMLElement && n.className === 'src-lang-row',
    )!;
    expect(row.textContent).toContain('Source: Auto-detect');
  });

  it('clicking a non-current option dispatches override-source-lang with the picked code', () => {
    const nodes = renderCardState({ ...base, sourceLang: 'fr' });
    const row = nodes.find(
      (n): n is HTMLElement => n instanceof HTMLElement && n.className === 'src-lang-row',
    )!;
    document.body.append(row);
    let captured: string | undefined;
    document.body.addEventListener('override-source-lang', (e) => {
      captured = (e as CustomEvent<{ code: string }>).detail.code;
    });
    row.querySelector<HTMLButtonElement>('.src-lang-row__change')!.click();
    row.querySelector<HTMLButtonElement>('[data-code="ja"]')!.click();
    expect(captured).toBe('ja');
    row.remove();
  });

  it('the current selection is disabled and cannot be clicked', () => {
    const nodes = renderCardState({ ...base, sourceLang: 'fr' });
    const row = nodes.find(
      (n): n is HTMLElement => n instanceof HTMLElement && n.className === 'src-lang-row',
    )!;
    document.body.append(row);
    row.querySelector<HTMLButtonElement>('.src-lang-row__change')!.click();
    const current = row.querySelector<HTMLButtonElement>('[data-code="fr"]')!;
    expect(current.disabled).toBe(true);
    row.remove();
  });
});
```

Run: `cd packages/app && bunx vitest run test/ui/lookup-card.test.ts`
Expected: fails — no `.src-lang-row` is rendered yet.

- [ ] **Step 2: Implement.** In `packages/app/src/ui/lookup-card.ts`:

Update the top import to also pull in the new domain pieces:

```ts
import type { LookupError, Provider, SavedWordStatus, SourceLangCode } from '../index';
import { SOURCE_LANG_CODES } from '../index';
```

Add one field to the `CardState` `result` variant (after `nudge?: boolean;`):

```ts
      /** A12: the effective source-language code for this result (bare code, e.g. 'fr'); absent
       * means auto-detect found nothing and no override was chosen — the row shows "Auto-detect". */
      sourceLang?: string;
```

Add the UI-only labels table, right after `PROVIDER_LABELS`/`providerLabel`:

```ts
/** A12: display names for the fixed source-language picker. UI-only — the wire/prompt only ever
 * carries the bare code (see domain/source-lang.ts's doc comment for why). Keyed by
 * SourceLangCode so a missing entry is a compile error. */
export const SOURCE_LANG_LABELS: Record<SourceLangCode, string> = {
  fr: 'French',
  es: 'Spanish',
  de: 'German',
  it: 'Italian',
  pt: 'Portuguese',
  nl: 'Dutch',
  ja: 'Japanese',
  zh: 'Chinese',
  ko: 'Korean',
  ru: 'Russian',
  vi: 'Vietnamese',
  ar: 'Arabic',
  hi: 'Hindi',
  pl: 'Polish',
  tr: 'Turkish',
  sv: 'Swedish',
  el: 'Greek',
  th: 'Thai',
  id: 'Indonesian',
  en: 'English',
};
```

In the shadow `CSS` template string, add one rule right after the existing `.defined-as` rule
(currently line 137):

```
::slotted(.defined-as){display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:2px 0 8px;font-size:var(--adp-text-2xs);color:var(--ad-ink-soft)}
::slotted(.src-lang-row){display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:2px 0 8px;font-size:var(--adp-text-2xs);color:var(--ad-ink-faint)}
```

In `CARD_DOC_CSS`, add these rules right after the `.defined-as__literal-btn:focus-visible` rule:

```
lookup-card .defined-as__literal-btn:focus-visible{outline:2px solid var(--ad-accent);outline-offset:2px}
lookup-card .src-lang-row__change{border:1px solid var(--ad-line);background:transparent;color:var(--ad-ink-soft);border-radius:var(--adp-radius-control);padding:2px 10px;font:inherit;font-size:var(--adp-text-2xs);cursor:pointer}
lookup-card .src-lang-row__change:hover{background:var(--ad-surface-raised);color:var(--ad-ink)}
lookup-card .src-lang-row__change:focus-visible{outline:2px solid var(--ad-accent);outline-offset:2px}
lookup-card .src-lang-menu{display:flex;flex-wrap:wrap;gap:5px;width:100%;margin-top:2px}
lookup-card .src-lang-menu[hidden]{display:none}
lookup-card .src-lang-menu [role=option]{border:1px solid var(--ad-line);background:var(--ad-surface);color:var(--ad-ink-soft);border-radius:var(--adp-radius-control);padding:2px 10px;font:inherit;font-size:var(--adp-text-2xs);cursor:pointer}
lookup-card .src-lang-menu [role=option]:hover:not([disabled]){background:var(--ad-surface-raised);color:var(--ad-ink)}
lookup-card .src-lang-menu [role=option]:focus-visible{outline:2px solid var(--ad-accent);outline-offset:2px}
lookup-card .src-lang-menu [role=option][disabled]{opacity:.55;cursor:default}
```

Add the new row function right after `renderDefinedAsRow`:

```ts
/**
 * A12: the "Source: <language> / Change" row — always rendered for a result. Structurally
 * identical to renderMetaRow's provider-switch button + listbox: a disclosure button toggles a
 * role="listbox" menu of Auto-detect + every SOURCE_LANG_CODES entry, current selection disabled,
 * others dispatch a composed override-source-lang event.
 */
function renderSourceLangRow(state: { sourceLang?: string }): HTMLElement {
  const row = document.createElement('div');
  row.className = 'src-lang-row';
  const current = state.sourceLang as SourceLangCode | undefined;

  const label = document.createElement('span');
  label.className = 'src-lang-row__label';
  label.textContent = `Source: ${current ? (SOURCE_LANG_LABELS[current] ?? current) : 'Auto-detect'}`;
  row.append(label);

  const changeBtn = document.createElement('button');
  changeBtn.type = 'button';
  changeBtn.className = 'src-lang-row__change';
  changeBtn.setAttribute('aria-haspopup', 'listbox');
  changeBtn.setAttribute('aria-expanded', 'false');
  changeBtn.setAttribute('aria-label', 'Change source language');
  changeBtn.textContent = 'Change';

  const menu = document.createElement('span');
  menu.className = 'src-lang-menu';
  menu.setAttribute('role', 'listbox');
  menu.hidden = true;

  const options: { code: string; label: string }[] = [
    { code: 'auto', label: 'Auto-detect' },
    ...SOURCE_LANG_CODES.map((code) => ({ code, label: SOURCE_LANG_LABELS[code] })),
  ];
  for (const opt of options) {
    const optBtn = document.createElement('button');
    optBtn.type = 'button';
    optBtn.setAttribute('role', 'option');
    optBtn.dataset['code'] = opt.code;
    optBtn.textContent = opt.label;
    const isCurrent = opt.code === (current ?? 'auto');
    optBtn.setAttribute('aria-selected', String(isCurrent));
    if (isCurrent) {
      optBtn.disabled = true;
    } else {
      optBtn.addEventListener('click', () => {
        menu.hidden = true;
        changeBtn.setAttribute('aria-expanded', 'false');
        optBtn.dispatchEvent(
          new CustomEvent('override-source-lang', {
            detail: { code: opt.code },
            bubbles: true,
            composed: true,
          }),
        );
      });
    }
    menu.append(optBtn);
  }

  changeBtn.addEventListener('click', () => {
    const willOpen = menu.hidden;
    menu.hidden = !willOpen;
    changeBtn.setAttribute('aria-expanded', String(willOpen));
  });

  row.append(changeBtn, menu);
  return row;
}
```

Update `renderCardState`'s result branch — insert the new row after the idiom row, before `body`:

```ts
const nodes: Node[] = [h, renderSaveRow(state)];
if (state.nudge === true) nodes.push(renderNudgeRow(state));
const definedAsRow = state.definedAs ? renderDefinedAsRow(state.definedAs) : null;
if (definedAsRow) nodes.push(definedAsRow);
nodes.push(renderSourceLangRow(state)); // A12: always shown for a result
nodes.push(body);
const meta = renderMetaRow(state);
if (meta) nodes.push(meta);
return nodes;
```

Run: `cd packages/app && bunx vitest run test/ui/lookup-card.test.ts`
Expected: all pass, including the 4 new cases.

- [ ] **Step 3: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck
cd ../.. && bun run lint && bun run format:check
```

```
git add packages/app/src/ui/lookup-card.ts packages/app/test/ui/lookup-card.test.ts
git commit -m "[A12NonEnglishSource] feat: add the card's Source language row + override picker (A12)" \
  -m $'Tribe-Card: a12-non-english-source\nTribe-Task: 6/9'
```

---

### Task 7: `inline-bottom-sheet-renderer.ts` — wire the card's override event to the workflow

**Files:**

- Modify: `packages/app/src/app/inline-bottom-sheet-renderer.ts`
- Modify: `packages/app/test/app/inline-bottom-sheet-renderer.test.ts`

- [ ] **Step 1: Write the failing tests.** Add to `packages/app/test/app/inline-bottom-sheet-
renderer.test.ts`, inside the main `describe('InlineBottomSheetRenderer', ...)` block (near
      the existing `switch-provider`/`force-literal` tests):

```ts
it('[A12] renderResult forwards ctx.sourceLang into the card light DOM', () => {
  const r = new InlineBottomSheetRenderer(document.body);
  r.renderResult(okResult, { sourceLang: 'fr', onOverrideSourceLang: () => {} });
  expect(document.body.querySelector('.src-lang-row')?.textContent).toContain('Source: French');
});

it('[A12] renderResult shows "Auto-detect" when ctx.sourceLang is absent', () => {
  const r = new InlineBottomSheetRenderer(document.body);
  r.renderResult(okResult, { onOverrideSourceLang: () => {} });
  expect(document.body.querySelector('.src-lang-row')?.textContent).toContain(
    'Source: Auto-detect',
  );
});

it("[A12] clicking the card's source-language option invokes ctx.onOverrideSourceLang", () => {
  const r = new InlineBottomSheetRenderer(document.body);
  const picks: string[] = [];
  r.renderResult(okResult, { sourceLang: 'fr', onOverrideSourceLang: (code) => picks.push(code) });
  document.body.querySelector<HTMLButtonElement>('.src-lang-row__change')!.click();
  document.body.querySelector<HTMLButtonElement>('[data-code="ja"]')!.click();
  expect(picks).toEqual(['ja']);
});
```

(Follow this test file's own existing convention for `okResult`/mounting — reuse whatever `okResult`
fixture the surrounding `switch-provider`/`force-literal` tests in this same file already use, rather
than redefining a new one.)

Run: `cd packages/app && bunx vitest run test/app/inline-bottom-sheet-renderer.test.ts`
Expected: the 3 new cases fail (no `.src-lang-row` appears — `ctx.sourceLang`/`onOverrideSourceLang`
are not yet forwarded).

- [ ] **Step 2: Implement.** In `packages/app/src/app/inline-bottom-sheet-renderer.ts`:

Add the new private field, alongside `onSwitch`/`onForceLiteral`:

```ts
  private onSwitch: ((p: Provider) => void) | undefined;
  private onForceLiteral: (() => void) | undefined;
  // A12: same pattern as onSwitch/onForceLiteral, for the card's one `override-source-lang` listener.
  private onSourceLangOverride: ((code: string) => void) | undefined;
```

Add the listener in `ensureCard()`, right after the existing `force-literal` listener:

```ts
card.addEventListener('force-literal', () => this.onForceLiteral?.());
// One-shot source-language override (A12): the card fires `override-source-lang` when the
// reader picks a language (or Auto-detect); delegate to the handler the workflow installed.
card.addEventListener('override-source-lang', (e) =>
  this.onSourceLangOverride?.((e as CustomEvent<{ code: string }>).detail.code),
);
```

Update `renderResult`:

```ts
  renderResult(r: LookupResult, ctx?: ResultRenderContext): void {
    this.onSwitch = ctx?.onSwitchProvider;
    this.onForceLiteral = ctx?.onForceLiteral;
    this.onSourceLangOverride = ctx?.onOverrideSourceLang;
    this.setState({
      kind: 'result',
      safeHtml: this.sanitize(r.markdown),
      word: r.word,
      target: r.target,
      ...(r.provider !== undefined ? { provider: r.provider } : {}),
      ...(r.fallbackFrom !== undefined ? { fallbackFrom: r.fallbackFrom } : {}),
      ...(r.definedAs !== undefined ? { definedAs: r.definedAs } : {}),
      ...(ctx?.providers !== undefined ? { providers: ctx.providers } : {}),
      ...(ctx?.sourceLang !== undefined ? { sourceLang: ctx.sourceLang } : {}),
      saved: ctx?.saved === true,
      nudge: r.nudge === true,
    });
  }
```

(`setSaved`/`setStatus`/`dismissNudge` already spread `...this.lastState`/`...rest` — `sourceLang`
rides through those re-renders automatically with no further change.)

Run: `cd packages/app && bunx vitest run test/app/inline-bottom-sheet-renderer.test.ts`
Expected: all pass, including the 3 new cases.

- [ ] **Step 3: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck
cd ../.. && bun run lint && bun run format:check
```

```
git add packages/app/src/app/inline-bottom-sheet-renderer.ts packages/app/test/app/inline-bottom-sheet-renderer.test.ts
git commit -m "[A12NonEnglishSource] feat: wire the card's source-language override into the in-page renderer (A12)" \
  -m $'Tribe-Card: a12-non-english-source\nTribe-Task: 7/9'
```

---

### Task 8: e2e — the full detect/display/override flow

**Files:**

- Create: `packages/extension-chrome/e2e/a12-non-english-source.spec.ts`

- [ ] **Step 1: Write the spec.** Create `packages/extension-chrome/e2e/a12-non-english-source.spec.ts`:

```ts
/**
 * A12 — non-English source pages. End-to-end lock, through the real service worker, that:
 *  1. a page-level `<html lang>` reaches the prompt's {source_lang} slot and the card's display;
 *  2. no lang attribute anywhere falls back to the neutral auto-infer phrase, never "English";
 *  3. a nearest-ancestor `lang` override beats the page-level default;
 *  4. the card's manual override re-runs the lookup with a fresh (non-cached) fetch.
 *
 * Gemini is intercepted on the CONTEXT because the real fetch originates in the service worker
 * (same reason as helpers.mockGemini).
 */
import { test, expect } from './fixtures';
import { seedSettings, gotoFixture, selectWord, openTrigger, GEMINI_OK_BODY } from './helpers';

const GEMINI_GLOB = 'https://generativelanguage.googleapis.com/**';

test('a page-level lang attribute reaches {source_lang} and the card display', async ({
  context,
  extensionId,
}) => {
  let sentPrompt = '';
  await context.route(GEMINI_GLOB, async (route) => {
    sentPrompt = (
      JSON.parse(route.request().postData() ?? '{}') as {
        contents: { parts: { text: string }[] }[];
      }
    ).contents[0]!.parts[0]!.text;
    await route.fulfill({ status: 200, contentType: 'application/json', body: GEMINI_OK_BODY });
  });

  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page, { targetLang: 'vi' });
  await gotoFixture(page, 'Le petit chat noir dort sur le tapis.');
  await page.evaluate(() => {
    document.documentElement.lang = 'fr';
  });
  await page.waitForTimeout(1_000);
  await selectWord(page, 't', 'petit');
  await openTrigger(page);
  await expect(page.locator('bottom-sheet lookup-card')).toContainText('financial institution', {
    timeout: 10_000,
  });

  expect(sentPrompt).toContain('learners of fr');
  await expect(page.locator('bottom-sheet lookup-card .src-lang-row')).toContainText(
    'Source: French',
  );
  await page.close();
});

test('no lang attribute anywhere falls back to the auto-infer phrase, never "English"', async ({
  context,
  extensionId,
}) => {
  let sentPrompt = '';
  await context.route(GEMINI_GLOB, async (route) => {
    sentPrompt = (
      JSON.parse(route.request().postData() ?? '{}') as {
        contents: { parts: { text: string }[] }[];
      }
    ).contents[0]!.parts[0]!.text;
    await route.fulfill({ status: 200, contentType: 'application/json', body: GEMINI_OK_BODY });
  });

  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page, { targetLang: 'vi' });
  await gotoFixture(page, 'The bank by the river is steep.');
  await page.waitForTimeout(1_000);
  await selectWord(page, 't', 'bank');
  await openTrigger(page);
  await expect(page.locator('bottom-sheet lookup-card')).toContainText('financial institution', {
    timeout: 10_000,
  });

  expect(sentPrompt).not.toContain('learners of English');
  expect(sentPrompt).toContain('infer the source language');
  await expect(page.locator('bottom-sheet lookup-card .src-lang-row')).toContainText(
    'Source: Auto-detect',
  );
  await page.close();
});

test('a nearest-ancestor lang wins over the page-level default', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page, { targetLang: 'vi' });
  await context.route(GEMINI_GLOB, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: GEMINI_OK_BODY }),
  );
  await gotoFixture(page, 'wrapped text here');
  await page.evaluate(() => {
    document.documentElement.lang = 'en';
    const p = document.getElementById('t')!;
    const wrapper = document.createElement('div');
    wrapper.lang = 'ja';
    p.replaceWith(wrapper);
    wrapper.append(p);
  });
  await page.waitForTimeout(1_000);
  await selectWord(page, 't', 'wrapped');
  await openTrigger(page);
  await expect(page.locator('bottom-sheet lookup-card')).toContainText('financial institution', {
    timeout: 10_000,
  });
  await expect(page.locator('bottom-sheet lookup-card .src-lang-row')).toContainText(
    'Source: Japanese',
  );
  await page.close();
});

test("the card's manual override re-runs the lookup with a fresh (non-cached) fetch", async ({
  context,
  extensionId,
}) => {
  let calls = 0;
  const prompts: string[] = [];
  await context.route(GEMINI_GLOB, async (route) => {
    calls++;
    prompts.push(
      (
        JSON.parse(route.request().postData() ?? '{}') as {
          contents: { parts: { text: string }[] }[];
        }
      ).contents[0]!.parts[0]!.text,
    );
    await route.fulfill({ status: 200, contentType: 'application/json', body: GEMINI_OK_BODY });
  });

  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page, { targetLang: 'vi' });
  await gotoFixture(page, 'The bank by the river is steep.');
  await page.evaluate(() => {
    document.documentElement.lang = 'fr';
  });
  await page.waitForTimeout(1_000);
  await selectWord(page, 't', 'bank');
  await openTrigger(page);
  await expect(page.locator('bottom-sheet lookup-card')).toContainText('financial institution', {
    timeout: 10_000,
  });
  expect(calls).toBe(1);

  await page.locator('bottom-sheet lookup-card .src-lang-row__change').click();
  await page.locator('bottom-sheet lookup-card [data-code="ja"]').click();
  await expect(page.locator('bottom-sheet lookup-card .src-lang-row')).toContainText(
    'Source: Japanese',
    { timeout: 10_000 },
  );

  expect(calls).toBe(2); // the override bypassed the cache — a fresh fetch fired
  expect(prompts[1]).toContain('learners of ja');
  await page.close();
});
```

Run:

```
GEMINI_API_KEY= bun run build:chrome
cd packages/extension-chrome && bunx playwright test a12-non-english-source
```

Expected: all 4 tests pass.

- [ ] **Step 2: Regression-check the shared prompt-builder surface.**

```
cd packages/extension-chrome && bunx playwright test default-template-context advanced-prompt idiom-expansion
```

Expected: all pass unchanged — proves the `{source_lang}` placeholder swap and the
`AUTO_SOURCE_LANG_PHRASE` fallback did not regress the existing card-format/envelope-split, advanced-
override, or A8 idiom pipelines.

- [ ] **Step 3: Commit** — gate, then commit:

```
GEMINI_API_KEY= bun run build:chrome
bun run lint && bun run format:check
```

```
git add packages/extension-chrome/e2e/a12-non-english-source.spec.ts
git commit -m "[A12NonEnglishSource] feat: e2e coverage for source-language detection, display, and override (A12)" \
  -m $'Tribe-Card: a12-non-english-source\nTribe-Task: 8/9'
```

---

### Task 9: Final gates + PR

- [ ] **Step 1: Run every gate.**

```
cd packages/app && bun run typecheck
cd ../extension-chrome && bun run typecheck
cd ../..
bun run test
bun run lint
bun run format:check
GEMINI_API_KEY= bun run build:chrome
cd packages/extension-chrome && bunx playwright test a12-non-english-source default-template-context advanced-prompt idiom-expansion provider-selection provider-fallback
```

Expected: typecheck clean on both packages; the full Vitest suite green (including every new/changed
unit test from Tasks 1-7); lint/format clean; the Chrome build succeeds with the env key cleared; the
new A12 e2e spec plus the regression guards for the shared prompt-builder/provider-picker surface
(which this card's `workflow.ts` changes sit right next to) all pass.

- [ ] **Step 2: Open the PR.**

Branch: `feature/A12NonEnglishSource`. Title: `[A12NonEnglishSource] Non-English source pages`.
Regular merge (no squash — owner ruling 2026-07-16). Jira link per the repo convention. Include a
**"Testing performed"** section per the design spec's §7 policy (no screenshots/video) — list every
suite from Step 1 with its pass count. Mention explicitly in the PR body: _no landing-page, store-
listing, or marketing copy changes_ (per the E3 "build, don't advertise" ruling), so a reviewer does
not go looking for one.
