# B2 — Rich context capture (design)

> Roadmap idea **B2** (`docs/ROADMAP.md`): _Impact 4 · Effort S · Score 4.0_ · Category B
> (structuring learned words). **Depends on B1** (shipped, PR #99). Decision authority: entry
> schema escalation **E1 — ALREADY RATIFIED by the owner**, implemented verbatim by B1; this card
> does not redesign it.

## Schema is settled law (do not touch)

`packages/app/src/domain/types.ts` (written by B1):

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

No field is added, renamed, or dropped by this card. `definition`/`sentence`/`url`/`title` are
already populated correctly by B1 (verified below, regression-guarded). The one field B1 left as
`''` — by its own design doc's explicit deferral — is `translation`, because "the model returns
one markdown blob with no separable translation field without B2's dedicated parsing work"
(`docs/superpowers/specs/2026-07-10-b1-save-word-design.md`, "Field sourcing" table). **This
card's entire job is that dedicated work: make `translation` populate with real content.**

## Problem (grounded in code)

- `packages/extension-chrome/src/content.ts:79` and
  `packages/extension-chrome/src/side-panel.ts:59` both hard-code `translation: ''` in the save
  payload they build from a `LookupResult`.
- The model's response is a single markdown blob (`LookupResult.markdown`,
  `packages/app/src/domain/types.ts:41`) whose section layout is `DEFAULT_OUTPUT_FORMAT`
  (`packages/app/src/domain/default-template.ts:30`) — **user-editable** via the "Card format"
  settings field (`packages/app/src/ui/settings-form.ts:518`). Today's default format asks for
  two sections ("Eng -> Eng" and "Eng -> {target_lang}"), but a reader can rename, reorder, or
  delete either section, so there is no structural guarantee that "the second markdown section"
  is the translation, or that it's even present.
- There is, however, a **proven precedent for exactly this class of problem** already shipped for
  A8: `DEFINED_AS_LINE` (`packages/app/src/domain/defined-as.ts`). A8 needed a piece of
  machine-readable metadata (which term the model actually defined, and whether it's an idiom)
  that must survive regardless of how the user has customized their card format. The solution:
  the code-owned `PROMPT_ENVELOPE` (never user-editable) instructs the model to always prefix its
  response with one recognizable signal line (`DEFINED_AS: "<term>" | idiom|literal`), which
  `parseDefinedAs` extracts and strips before the markdown reaches the card, decoupled entirely
  from the user's format. `runHttpLookup` (`packages/app/src/app/http-lookup-client.ts:156`) is
  the ONE shared skeleton behind all three provider clients (Gemini/OpenAI/Anthropic;
  `packages/app/src/app/gemini-lookup-client.ts`, `openai-lookup-client.ts`,
  `anthropic-lookup-client.ts`) that calls it — so fixing extraction once there fixes it for every
  provider.

## Decision: mirror the DEFINED_AS pattern for translation (a How-level choice, in-scope per dispatch)

Add a second code-owned signal line, `TRANSLATION: "<text>"`, requested via a new
`{translation_instruction}` slot in `PROMPT_ENVELOPE` (mirroring the existing
`{idiom_instruction}` slot), parsed and stripped by a new pure function `parseTranslation`
(`packages/app/src/domain/translation-line.ts`, sibling to `defined-as.ts`, same contract shape),
and surfaced as a new **optional** field `LookupResult.translation?: string`.

**Why this and not scraping the visible "Eng -> {target_lang}" section:** parsing a
user-customizable, unstructured markdown document for "the translation section" is exactly the
fragility B1's own spec flagged ("fragile, format-dependent... squarely the kind of dedicated
wiring the dispatch says to defer"). The signal-line approach is decoupled from `outputFormat`
entirely — it survives no matter how the reader has renamed/reordered/deleted their card's visible
sections — and it is the SAME model call (no new network round trip, no new data leaving the
browser beyond one extra instruction paragraph already inside the same prompt request). This is a
"How" implementation choice within the card's own delegation ("Ground yourself... to figure out
how to reliably extract/derive the translation") — not a schema change (nothing is added/renamed
on `SavedWordEntry`/`SavedWordSense`; `LookupResult` already carries provider-specific optional
metadata this way, e.g. `definedAs`) and not a new manifest permission or new outbound data
category.

**Fallback behavior (strict superset of today, never blocks rendering):** exactly like
`definedAs`, when the model doesn't emit a recognisable `TRANSLATION:` line — a legacy/non-
compliant response, or an advanced prompt-envelope override (#62) that omits
`{translation_instruction}` — `LookupResult.translation` is `undefined` and the saved entry falls
back to `''`, identical to B1's current behavior. No regression is possible; the change is purely
additive.

## Design

### 1. Prompt (`packages/app/src/domain/default-template.ts`, `prompt-template.ts`)

- New exported constant `TRANSLATION_INSTRUCTION`, analogous to `IDIOM_AUTO_INSTRUCTION`:
  instructs the model to emit `TRANSLATION: "<a natural, concise {target_lang} translation of
the meaning of "{word}" in this context>"` as the line immediately following `DEFINED_AS`,
  before any other output.
- `PROMPT_ENVELOPE` gains a `{translation_instruction}` slot, inserted directly under
  `{idiom_instruction}`:

  ```
  {idiom_instruction}

  {translation_instruction}

  Output Markdown with these sections, in this exact order:
  {output_format}
  ```

- `buildPrompt` (`prompt-template.ts`) substitutes `{translation_instruction}` the same way it
  already substitutes `{idiom_instruction}` (`composed.includes(...) ? composed.replace(...) :
composed`), so a custom envelope override that omits the placeholder is simply unaffected —
  same opt-out semantics A8 already established.
- The instruction text's own `{word}`/`{target_lang}` placeholders resolve for free in the single
  trailing `renderTemplate` pass (insert-then-render order, already how `IDIOM_AUTO_INSTRUCTION`
  resolves its own `{word}`).

### 2. Parsing (`packages/app/src/domain/translation-line.ts`, NEW file)

Domain-pure (zero imports, `rule-domain-purity`), sibling to `defined-as.ts`:

```ts
export function parseTranslation(markdown: string): { translation?: string; body: string };
```

Same contract as `parseDefinedAs`: regex-matches a `TRANSLATION: "..."` line anywhere in the text,
strips that line plus at most one following blank line, returns the remainder as `body`; absent
match returns the entire input unchanged with `translation: undefined`.

### 3. Wiring into the shared HTTP skeleton (`packages/app/src/app/http-lookup-client.ts`)

`runHttpLookup` already does:

```ts
const { definedAs, body: parsedBody } = parseDefinedAs(text);
```

Chained with the new parser:

```ts
const { definedAs, body: afterDefinedAs } = parseDefinedAs(text);
const { translation, body: parsedBody } = parseTranslation(afterDefinedAs);
return {
  markdown: parsedBody,
  ...
  ...(definedAs !== undefined ? { definedAs } : {}),
  ...(translation !== undefined ? { translation } : {}),
};
```

One change point covers Gemini, OpenAI, and Anthropic (all three clients call `runHttpLookup`).

### 4. Domain types + wire protocol

- `LookupResult` (`packages/app/src/domain/types.ts`) gains one new optional field:
  `translation?: string | undefined` — display-metadata, same category as `definedAs`, `provider`,
  `fallbackFrom`. Not part of the ratified `SavedWordEntry`/`SavedWordSense` shape.
- `LookupResultSchema` (`packages/app/src/wire.ts`) gains `translation: z.string().optional()`,
  matching the type exactly (the existing `AssertEqual` drift guard enforces this at compile
  time).

### 5. Populating the save payload (Chrome composition roots)

- `packages/extension-chrome/src/content.ts:79`: `translation: ''` → `translation: r.translation
?? ''`.
- `packages/extension-chrome/src/side-panel.ts:59` (inside `trackSaveContext`): same change,
  `translation: r.translation ?? ''`.

No other file changes: `workflow.ts` already forwards the full `LookupResult` to
`renderResult(result, ctx)` unchanged (translation rides on `result`, not `ctx` — `ctx` only
carries `sentence`/`url`/`title`, the fields not present on `LookupResult` itself), `router.ts`
already forwards `msg.translation` verbatim into `savedWordUpsert`'s input (no change — the wire
message's `translation` field was already a plain string; only ITS SOURCE VALUE at the call site
changes, not the wire shape), and `chrome-side-panel-mirror.ts` already broadcasts the entire `r`
object as `payload` (translation rides along automatically, no explicit field-by-field allowlist
to update there).

### Non-goals / scope fence (unchanged from the card)

- No schema change to `SavedWordEntry`/`SavedWordSense` — `translation` was already a field; this
  card only fixes its population.
- No backfill/migration for words already saved by B1 with `translation: ''`. This is a v1
  additive improvement: new saves (and re-saves) get a populated translation; existing saved
  entries keep `''` until the reader re-saves the word, or a future card addresses batch backfill.
  (Recommended default per the dispatch; no owner escalation needed — nothing in the card reserves
  backfill semantics to the owner, and B1 already established the same "populate what's available
  today, '' otherwise" philosophy as its own precedent.)
- No UI change. The translation section a reader already sees in the card (the visible "Eng ->
  {target_lang}" region, when their format includes it) is unaffected — this card does not touch
  `lookup-card.ts` or any rendering path; the new `TRANSLATION:` signal line is stripped from the
  markdown before it ever reaches the renderer, exactly like `DEFINED_AS:` is today.
- No new manifest permission, no new network call — one extra instruction paragraph rides inside
  the SAME prompt request already made for every lookup.
- Safari untouched — `LookupResult.translation` is optional, so `packages/extension-safari/**`
  compiles unchanged (same precedent as every other B1/A8 optional field).
- No change to `saved-words-policy.ts`'s CRUD contract, keyspace, or index — B1's storage layer is
  untouched; only the VALUE fed into `savedWordUpsert`'s `translation` input changes upstream.

## Testing strategy

- **`translation-line.test.ts`** (new, mirrors `defined-as.test.ts` exactly): extracts a
  `TRANSLATION: "..."` line and strips it (plus one following blank line); returns the entire
  original text unchanged with `translation: undefined` when no line is present; tolerates
  leading whitespace before the line; does not strip beyond the matched line + one blank line.
- **`prompt-template.test.ts`** (extend): `buildPrompt` emits `TRANSLATION:` in the default
  (no-override) path; a custom envelope without `{translation_instruction}` is unaffected; a
  custom envelope WITH `{translation_instruction}` resolves the nested `{word}`/`{target_lang}`.
- **`default-template.test.ts`** (extend): `TRANSLATION_INSTRUCTION` is a non-empty string
  containing `TRANSLATION:`; `PROMPT_ENVELOPE` contains the `{translation_instruction}` slot.
- **`gemini-lookup-client.test.ts`** (extend, mirrors the existing "A8 idiom expansion via
  runHttpLookup" describe block): a response containing both `DEFINED_AS:` and `TRANSLATION:`
  lines is parsed into `result.translation` and both lines are stripped from `result.markdown`; a
  response with `DEFINED_AS:` but no `TRANSLATION:` line leaves `translation` undefined
  (back-compat); a response with neither line leaves both undefined and `markdown` unchanged.
- **`wire-schema.test.ts`** (extend, mirrors the existing `definedAs` optional-field test): a
  `LookupResult` wire payload with `translation` parses; an old-shaped result without it still
  parses (back-compat); `z.strictObject` still rejects unknown keys.
- **`router.test.ts`** (extend): `saved.save` with a non-empty `translation` in the wire message
  persists it verbatim into `senses[0].translation` (the router → `savedWordUpsert` path was
  already exercised by B1; this just adds a non-empty-translation case to prove no accidental
  truncation/transform happens in the pass-through).
- **e2e (`packages/extension-chrome/e2e/saved-word.spec.ts`, extend)**: mock Gemini returns a
  `DEFINED_AS` + `TRANSLATION` line; tapping the star persists a `saved:<word>` entry whose
  `senses[0].translation` is the real translated text (not `''`); the visible card text does NOT
  contain the literal `TRANSLATION:` line (proves stripping); a mocked response with no
  `TRANSLATION:` line still saves with `translation: ''` (regression guard — B1's original
  assertion `entry.senses[0].translation).toBe('')` on the DEFAULT mock body must still pass
  unchanged, since that mock never emits an idiom/translation signal line).

## Evidence plan

This is a data-completeness fix, not a new visible interaction — the star/save flow already looks
and behaves exactly as B1 shipped it (no new UI). Per the dispatch's guidance, evidence is a
**before/after screenshot of the actual saved entry's fields** (the e2e-storage-dump pattern),
not a UI screenshot: a new capture-only spec drives the real extension (mocked Gemini,
`bun run build:chrome` first), performs the save flow, reads `chrome.storage.local` via the
service worker (same `swStorageDump` helper `saved-word.spec.ts` already uses), renders the
persisted JSON entry into an on-page `<pre>` overlay, and screenshots it:

- **Before** (`master` build, mock response with no `TRANSLATION:` line — matches what a real
  Gemini call returns today): `senses[0].translation` is `""`.
- **After** (branch build, mock response with a `TRANSLATION:` line — matches what a real Gemini
  call returns once the new instruction ships): `senses[0].translation` is real text, while
  `definition`/`sentence`/`url`/`title` are visibly unchanged in the same dump (regression-safe
  proof, side by side).

Hosted on a throwaway `pr-assets/b2-rich-context-capture` branch, embedded via same-origin
`https://github.com/hieplam/ai-dict/raw/pr-assets/b2-rich-context-capture/<file>` URLs only.

## Risk / rollback

Purely additive: one new optional field on an existing type (`LookupResult.translation`), one new
optional wire-schema field, one new domain file, two small composition-root edits substituting
what value flows into an already-existing wire field. No storage shape changes, no schema
changes, no new keyspace. Rollback is a plain revert — the `saved:*` entries already written keep
whatever `translation` value they have (`''` from B1, or real text from B2); reverting this PR
just stops populating new/re-saved entries with real translations again, with zero data loss or
migration concern either direction.
