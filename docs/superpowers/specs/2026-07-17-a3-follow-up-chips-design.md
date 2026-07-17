# A3 — Follow-up chips (design)

> Roadmap idea **A3** (`docs/ROADMAP.md` §4, lines 251-262): _Impact 4 · Effort M · Score 2.0_.
> Category A (seamless reading UX). Decision authority: **Lead decides** (chip copy, result
> transition); **no owner escalation**. Depends on: — (independent). **Feeds: B13** (Related
> words on save, wave 2) — B13 appends a 5th `'related'` chip to this card's exported
> `REFINE_CHIPS` array and `RefineKind` union; every extension point B13 needs is called out
> explicitly below and in "The change".

## 1. Problem (grounded in code)

Today a lookup result is a dead end in one specific way: if the card's answer is pitched wrong
for the reader — too academic, missing an example, no origin story, no usage guidance — there is
no way to ask for a different cut of the _same_ word without re-selecting the text (hoping the
model happens to answer differently) or permanently rewriting the "Card format" prompt in
Settings (`packages/app/src/ui/settings-form.ts`, the `outputFormat` field), which changes every
future lookup, not just this one.

- `renderCardState`'s `'result'` branch (`packages/app/src/ui/lookup-card.ts:276-288`) renders
  exactly: headword (`h2`), the save row, an optional nudge row, an optional idiom label
  (`renderDefinedAsRow`), the sanitized body, and an optional provider meta row. There is no
  row offering any follow-up action on the body itself.
- `LookupRequest` (`packages/app/src/domain/types.ts:16-39`) carries two existing one-shot
  override fields — `provider?: Provider` (32-35, a manual provider pick) and `forceLiteral?:
boolean` (37-38 wait, actually the literal field itself lives at :36-38, "A8: one-shot request to
  define ONLY the literal…") — both re-run the _same_ selection once, without persisting the
  choice. There is no equivalent one-shot field for "answer this differently" (simpler, more
  examples, etymology, usage).
- `runLookupWorkflow`'s `runLookup` (`packages/app/src/domain/workflow.ts:45-121`) already has the
  exact shape needed for a third one-shot override: it closes over the original
  `SelectionEvent e` (word + sentence + url + title) and re-invokes itself
  (`void runLookup(e, p)` at 97 for a provider switch, `void runLookup(e, undefined, true)` at 108
  for force-literal) whenever the card fires a one-shot action, deliberately bypassing the
  `COOLDOWN_MS` spam gate (17) "because it's not spam" (96, 106-107 comments). Nothing today
  reuses this mechanism for "refine the answer."
- The prompt itself has no refine-shaped instruction slot. `PROMPT_ENVELOPE`
  (`packages/app/src/domain/default-template.ts:14-30`) already composes two optional,
  code-owned instruction slots the exact same way — `{idiom_instruction}` (A8, populated by
  `IDIOM_AUTO_INSTRUCTION`/`IDIOM_FORCE_LITERAL_INSTRUCTION`, lines 43-54) and
  `{translation_instruction}` (B2, `TRANSLATION_INSTRUCTION`, lines 64-65) — both substituted by
  `buildPrompt` (`packages/app/src/domain/prompt-template.ts:57-75`) via a direct `.replace()`
  before the generic `renderTemplate` pass. There is no `{refine_instruction}` slot.
- `router.ts`'s cache-read guard (`packages/app/src/app/router.ts:114`) already skips the cache
  **read** for `req.provider !== undefined` and `req.forceLiteral === true`, "because a hit
  would echo back the previous provider's/idiom-aware answer instead of the one requested" (111-113
  comments). A refine request has the identical shape of problem and is not yet covered.

**Payoff, per the roadmap:** "Wrong answer? One tap fixes it — no typing, no settings, no
re-selecting. Original word + sentence re-sent automatically." **Scope fence, per the roadmap:**
"Fixed 4 chips in v1 (not configurable). Refined answer replaces the body; Back restores the
original."

## 2. Design questions (all "Lead decides" items pinned here)

### 2.1 Wire mechanism: extend the existing `lookup` message, no new message type

**Pinned** (CONTRACTS §4 pin, restated and grounded): add one optional field,
`LookupRequest.refine?: 'simpler' | 'examples' | 'etymology' | 'usage'`, to the existing
`lookup` wire arm — the exact same shape of change A8 made for `forceLiteral`
(`wire.ts:37-38`) and B2 made for `translation` (result side). No new `WireMessageSchema`
discriminant arm, so the "wire + router case = ONE task" rule
(`docs/ROADMAP.md` §8 Decision Log, 2026-07-16 B5/B3 entry: exhaustive `switch(msg.type)`, no
`default`) does not trigger — there is no new `case` to add to `router.ts`'s switch
(`router.ts:213-287`). This is itself already-ratified precedent, not a new escalation: the
Decision Log's 2026-07-10 A8 entry rules "optional in-flight request/response fields are ordinary
wire-protocol evolution … not an E1-style irreversible persisted-data-shape escalation," and
applies the same reasoning again to B2's `translation` and B7's `nudge`. `RefineKind` is a fourth
instance of exactly this pattern.

**Rejected: a dedicated `refine` wire message** (e.g. `{ type: 'refine', word, context, kind }`).
Rejected because it would duplicate every field `lookup` already carries (target, outputFormat,
promptEnvelope) for zero behavioral gain — a refine request _is_ a lookup request, just with one
more field, exactly like a provider override or a force-literal request already are.

### 2.2 Prompt mechanism: a fourth code-owned instruction slot, `{refine_instruction}`

**Pinned:** add `REFINE_INSTRUCTIONS: Record<RefineKind, string>` to
`packages/app/src/domain/default-template.ts` (a sibling of `IDIOM_AUTO_INSTRUCTION`/
`TRANSLATION_INSTRUCTION`) and a new `{refine_instruction}` placeholder in `PROMPT_ENVELOPE`,
substituted by `buildPrompt` exactly like `{idiom_instruction}`: a direct `.replace()` with either
the selected instruction or `''` when `req.refine` is unset (mirrors the `forceLiteral` ternary at
`prompt-template.ts:67`). Pinned instruction copy (verbatim — no placeholder text, no
"implementer decides" wording):

```ts
export const REFINE_INSTRUCTIONS: Record<RefineKind, string> = {
  simpler: `The reader found the previous explanation too difficult. Rewrite the "Eng -> Eng" explanation using SIMPLER, plainer everyday language — short sentences, common words, no jargon — while keeping the meaning accurate for this sentence context.`,
  examples: `The reader wants MORE EXAMPLES. In addition to the normal sections, add a new "**More examples**" section with 2-3 additional short example sentences that use "{word}" naturally in DIFFERENT contexts from the original sentence.`,
  etymology: `The reader wants this word's ETYMOLOGY. In addition to the normal sections, add a new "**Etymology**" section explaining the word's origin, root language, and how its meaning evolved to today's usage.`,
  usage: `The reader wants to know how to USE this word. In addition to the normal sections, add a new "**How to use it**" section covering common collocations, register (formal/informal), and one short natural example sentence using "{word}".`,
};
```

Placed in `PROMPT_ENVELOPE` right before "Output Markdown with these sections…", after
`{idiom_instruction}`/`{translation_instruction}` — the refine instruction is the last thing the
model reads before it starts composing sections, which matters most for `examples`/`etymology`/
`usage` (each explicitly asks for an _added_ section, so it must land after the idiom/translation
setup and immediately before the output-format instruction it's modifying).

**Rejected: overriding `outputFormat` for the one-shot request** (temporarily swap in a
refine-flavored `outputFormat` string instead of adding a new slot). Rejected because
`outputFormat` is the user's own customizable "Card format" field
(`prompt-template.ts`'s own doc comment: "the ONLY user-editable piece"); silently substituting a
different value for one request would either clobber a user's customization for that one call or
require yet another request field to carry the substitute text — strictly more complexity than one
new code-owned slot, and it breaks the precedent that `outputFormat` is always exactly what
Settings shows.

**Rejected: a full prompt rewrite per refine kind** (four entirely separate `PROMPT_ENVELOPE`
variants). Rejected for the same reason A8/B2 rejected it: it would duplicate the persona,
constraints, and every other slot four times over, and any future change to the shared envelope
(e.g. a new safety constraint) would need to be applied in five places instead of one.

**No regression to the non-refine path:** when `req.refine` is unset, `{refine_instruction}`
substitutes to `''`, leaving one extra blank line in the assembled prompt versus pre-A3 — a
whitespace-only difference. No existing `prompt-template.test.ts` assertion checks exact
byte-for-byte prompt equality (confirmed by reading the file: every assertion on the built-in
envelope's output uses `.toContain(...)`, never `.toBe(...)` on the full string); the two `.toBe`
assertions that exist compare `buildPrompt(...)` calls against each other
(`prompt-template.test.ts:103-104`), which stay self-consistent regardless. **A custom advanced
prompt-envelope override (`#62`) that omits `{refine_instruction}` is simply unaffected by a
refine tap** — same opt-out precedent already established for `{idiom_instruction}`/
`{translation_instruction}` (`prompt-template.ts`'s own doc comment, "consistent with how it
already opts out of other envelope-owned text").

### 2.3 Chip copy: the roadmap's own wording, verbatim

**Pinned:** `docs/ROADMAP.md:255` already states the exact product-approved copy — "**Simpler ·
More examples · Etymology · Use it**." Reusing it verbatim removes any reason to invent new
wording, and keeps the roadmap card and the shipped UI in sync by construction.

| `RefineKind` | Chip label      |
| ------------ | --------------- |
| `simpler`    | `Simpler`       |
| `examples`   | `More examples` |
| `etymology`  | `Etymology`     |
| `usage`      | `Use it`        |

**Rejected:** any alternate phrasing (e.g. "Explain simpler", "Show examples") — rejected only
because the roadmap card already settled this exact wording; deviating would need its own
justification that doesn't exist.

### 2.4 Result transition: chips always visible; the active chip is disabled; "Back to original" is a local, zero-token restore

This is the card's other "Lead decides" item (`docs/ROADMAP.md:262`) and the crux of the design.
Three sub-questions, each pinned:

**(a) Do the chips disappear once a refinement is showing, replaced solely by "Back"?**

**Pinned: no — all 4 chips stay visible and tappable even while a refined result is showing**,
with the currently-active chip rendered `aria-pressed="true"` and `disabled` (preventing a wasted
duplicate network call for the same refinement — the exact same disable-the-current-option
pattern `renderMetaRow`'s provider switcher already uses: `packages/app/src/ui/
lookup-card.ts:474-476`, `if (isCurrent) { opt.disabled = true; }`). A "Back to original" pill
appears alongside the chips, but only when a refinement is currently showing.

**Rejected: chips replaced entirely by a single "Back" button while refined.** Rejected because
every chip tap is already, by construction, a one-shot re-run of the _original_ selection (word +
sentence — never the currently-displayed refined body; see 2.4(c)) — so nothing about the
mechanism requires forcing the reader through "Back" before trying a different chip. Hiding the
other three chips would only cost an extra tap for no engineering or correctness benefit.

**(b) How is "Back to original" implemented — a fresh (zero-refine) lookup, or a local restore?**

**Pinned: a local, zero-token restore of the exact original `LookupResult`, not a new lookup.**
"Back restores the original" (roadmap fence, `docs/ROADMAP.md:261`) means the literal answer the
reader already saw, not "whatever the model happens to say now" — a fresh re-run risks a
different (LLM non-deterministic) answer even for the identical prompt, which would silently
violate the fence, and it would also cost a token for content the extension already has in memory.
This mirrors an existing local-restore precedent in the same file: `InlineBottomSheetRenderer.
setSaved`/`setStatus`/`dismissNudge` (`packages/app/src/app/inline-bottom-sheet-renderer.ts:
129-165`) all mutate `this.lastState` and re-render locally, with **zero** wire/network calls, for
exactly this reason class of "flip a flag on what's already showing."

**Rejected: re-run the lookup with `refine` cleared.** Rejected per the above — it can return a
materially different "original," costs a token, and constraint 4 ("No background LLM calls…every
model call is triggered by an explicit user action, and features that spend tokens say so first,"
`docs/ROADMAP.md:87-88`) makes an unnecessary paid re-run something the design should actively
avoid, not casually reach for, when a free local alternative already exists in the codebase.

**Implementation:** `InlineBottomSheetRenderer` gains `private originalState: CardState | null =
null` (alongside the existing `lastState`, `inline-bottom-sheet-renderer.ts:22-24`). Every
`renderResult(r, ctx)` call where `ctx?.refine === undefined` (a genuinely fresh/original lookup —
including provider switches and force-literal re-runs, which never set `refine`) snapshots the
just-built `CardState` into `originalState`; a call where `ctx?.refine !== undefined` leaves
`originalState` untouched. A new public method `restoreOriginal(): void` swaps `lastState` back to
`originalState` via the existing `setState()` path (no-op if `originalState` is `null` — mirrors
the existing null-guard style in `setSaved`/`setStatus`/`dismissNudge`). `close()` resets
`originalState = null` alongside its existing resets (`inline-bottom-sheet-renderer.ts:167-172`).

**(c) Does a refine chip tap resend the currently-displayed (possibly-already-refined) text, or always the original selection?**

**Pinned: always the original selection** — `runLookup`'s `onRefine` closure captures the same
`e: SelectionEvent` every other one-shot override already closes over (word/sentence never
change across a chain of refine taps), and every refine tap resets provider-override and
force-literal to their defaults (`runLookup(e, undefined, undefined, kind)`) rather than composing
with whatever was last picked. This is what the roadmap fence's "Original word + sentence re-sent
automatically" (`docs/ROADMAP.md:259`) actually requires, and it is what makes chip-to-chip
switching (2.4(a)) safe: each tap is an independent one-shot request, never a chain built on the
model's own prior refined answer (which the model never sees again).

**Rejected: composing refine with the last-used provider/forceLiteral choice.** Rejected as
unnecessary combinatorial state — the roadmap card never asks for "simpler, from OpenAI, forced
literal" in one request, and carrying that state forward risks silently surprising the reader with
a provider they didn't pick for this tap.

### 2.5 The save-after-Back correctness hazard (new finding, not in the roadmap card — flagged and closed here)

Tracing `packages/extension-chrome/src/content.ts`'s `renderResult` handler
(lines 86-105) surfaces a real bug risk this design must close, not leave to the implementer:
`lastSavePayload` (the star button's persistence payload — word/definition/sentence/url/title,
`content.ts:45-54`) is **unconditionally overwritten on every `renderResult` call**, including a
refine re-run (`content.ts:88-97`, no gating on what kind of result this is). If a reader taps a
refine chip, then taps "Back to original," and only _then_ taps the star, `lastSavePayload.
definition` would — without a fix — still hold the _refined_ markdown, while the card visually
shows the _original_ body. The star would silently save the wrong text.

**Pinned fix:** `ResultRenderContext` (`packages/app/src/ports.ts:26-48`) gains `refine?:
RefineKind`, set by `runLookup` only when this particular result came from a refine tap (mirrors
how `onForceLiteral`/`providers` are conditionally present today). `content.ts` tracks a second
variable, `lastOriginalSavePayload`, updated in the same place as `lastSavePayload` but **only**
when `ctx?.refine === undefined`. The card's `refine-back` event (2.4(b)/§4.9) is handled
**directly in `content.ts`** (not inside the renderer) with a dedicated listener that (1) calls
`inline.restoreOriginal()`, (2) restores `lastSavePayload = lastOriginalSavePayload`, and (3)
resets `lastSaved = false; lastStatus = undefined; saveReplyGuard.next();` — exactly the same
three-line reset every other fresh `renderResult` already performs
(`content.ts:79-81`/`98-100`), so "Back" behaves, from the star button's point of view, exactly
like landing on a fresh original result, which is what it visually is.

This mirrors the existing split in `content.ts` between two classes of card event: "one-shot
re-run" events (`switch-provider`, `force-literal` — and now `refine`) are handled **inside**
`InlineBottomSheetRenderer.ensureCard()` and delegate to a `ctx`-supplied callback, because they
need nothing beyond a new `deps.client.lookup` call; "local state mutation" events (`toggle-save`,
`toggle-status`, `dismiss-nudge` — and now `refine-back`) are handled **in `content.ts`**, calling
an explicit public renderer method (`setSaved`/`setStatus`/`dismissNudge` — and now
`restoreOriginal`), because they need composition-root-level bookkeeping the renderer alone
doesn't have. `refine-back` follows the second pattern exactly; it never reaches the renderer's
internal `ensureCard()` listeners.

### 2.6 Side panel: excluded from A3 v1, by the same mechanism A8 already established

**Pinned:** refine chips and "Back to original" render **only** in the in-page card
(`InlineBottomSheetRenderer`), never in the side panel (`side-panel-view.ts`/`side-panel.ts`).
This is grounded in two facts already true of the codebase:

1. `content.ts`'s own `dismissAll`/mirror comment (`content.ts:272-274`) already documents that
   the side panel is deliberately **not** kept in sync with every local, non-lookup change to the
   in-page card ("`state === 'close'`… is intentionally ignored: the panel is persistent and keeps
   showing the last lookup"). A local-only "Back to original" (2.4(b), no wire call) is the same
   class of change — extending that exact precedent, not inventing a new one.
2. A8 already established the mechanism for excluding a per-card one-shot control from the panel:
   `side-panel.ts`'s `resultToFocus` (lines 114-128) builds an **explicit new object**, field by
   field, rather than spreading `r`/`ctx` — so a field it never lists is absent by construction,
   with no active exclusion code needed (confirmed: `resultToFocus` does not copy `definedAs`
   today, and the A8 e2e spec asserts the panel shows the idiom text with **zero** `.defined-as`
   rows, `idiom-expansion.spec.ts:158-163`).

Because the always-visible refine chip row (unlike the conditionally-rendered idiom label) would
otherwise render in the side panel too even without any data present, `CardState`'s `'result'`
variant gains an explicit boolean, `refineChips?: boolean`, set to `true` only by
`InlineBottomSheetRenderer.renderResult` (mirrors the existing explicit-boolean convention already
used for `saved`/`nudge`: "always explicit true/false," `inline-bottom-sheet-renderer.ts:102,105`).
`side-panel.ts`'s `resultToFocus`/`applyFocus` never set it, so `renderCardState` never renders the
row there — zero code changes needed in `side-panel.ts` itself (§4.8: "no change to X").

A `refine` tap made from the in-page card still mirrors its resulting text to an open side panel
exactly as any other lookup result does today (`mirror.renderResult(r, ctx)`, unchanged,
`content.ts:104`) — the panel will show the refined body, just without the chip row. A "Back to
original" tap, being local-only with no wire call, is **not** mirrored — a narrow, accepted
inconsistency (the panel keeps showing the last-mirrored refined text) directly covered by fact 1
above. This is a corner case (side panel open + in-page refine tap + in-page Back tap, all in one
session) that the roadmap card never asks this effort to solve, and A8 accepted the identical
class of gap for its own one-shot control.

**Rejected: plumb refine into the side panel too.** Rejected as materially out of scope — unlike
the in-page card, `side-panel.ts` never builds a full `LookupRequest` (only display fields via
`trackSaveContext`); wiring a refine re-run from the panel would mean duplicating request
construction (target/outputFormat/promptEnvelope, currently only known inside
`runLookupWorkflow`) into a second composition root, a materially bigger change than this
Effort-M card's own roadmap fence ("One-tap refinements on **the card**," `docs/ROADMAP.md:255`)
asks for.

### 2.7 Cache bypass

**Pinned:** extend `router.ts`'s existing cache-read guard
(`packages/app/src/app/router.ts:114`) with the same reasoning already applied to `provider`/
`forceLiteral`:

```ts
if (cacheEnabled && req.provider === undefined && req.forceLiteral !== true && req.refine === undefined) {
```

A cache hit on the plain word+context+target key would echo back the _original_ answer instead of
running the requested refinement — the identical failure mode the two existing guards already
prevent, extended by one more clause. The cache **write** after a refine call proceeds unchanged
(same minimal-risk precedent A8 §5 already accepted for `forceLiteral`: a refined answer can
overwrite the cached original for that exact word+context+target until the entry ages out or is
cleared — not a new risk this card introduces).

### 2.8 `RefineKind`/`REFINE_CHIPS` extension points for B13 (explicit, per dispatch note)

B13 (Related words on save, wave 2, `docs/ROADMAP.md:503-513`) appends a 5th `'related'` value to
this card's union and a 5th entry to this card's chip array. Both are designed as append points:

- `RefineKind` (`packages/app/src/domain/types.ts`) is a plain string-literal union — B13 widens
  it to `'simpler' | 'examples' | 'etymology' | 'usage' | 'related'`. The corresponding
  `RefineKindEnum` in `wire.ts` is a `z.enum([...])` array — B13 appends `'related'` to the same
  array. Both are one-line, additive, non-breaking changes (existing values keep parsing).
- `REFINE_CHIPS: RefineChip[]` (`packages/app/src/ui/lookup-card.ts`, exported per CONTRACTS §4)
  is a plain ordered array — B13 appends `{ id: 'related', label: '<B13 label>' }`. No chip
  rendering code needs to change: `renderRefineRow` iterates `REFINE_CHIPS` generically (§4.7),
  so a 5th entry renders automatically in the same row, in array order.
- `REFINE_INSTRUCTIONS` (`packages/app/src/domain/default-template.ts`) is a `Record<RefineKind,
string>` — TypeScript's exhaustiveness checking on a `Record` keyed by a union means B13's
  widened `RefineKind` will fail to compile until B13 adds a `related:` entry, which is the
  desired forcing function (no silently-missing instruction for a new refine kind).
- **What B13 must NOT do:** persist the refine chip's result onto `SavedWordEntry` by extending
  `LookupResult`/`LookupRequest` — B13's own card explicitly scopes persistence to "the entry"
  (i.e., the ratified `SavedWordEntry`/E1 shape) as an **additive** field, not a change to A3's
  request/response shapes. A3's `refine`/`RefineKind` fields are transient, in-flight,
  never-persisted request annotations (exactly like `provider`/`forceLiteral` today) — B13 reads
  the _result_ of a `'related'` refine call and writes it into `SavedWordEntry` itself; it does
  not need A3's wire fields to change shape, only its enums to widen.

## 3. The change (per file)

### 3.1 `packages/app/src/domain/types.ts`

```ts
/** A3: the fixed v1 refine chip kinds. B13 (wave 2) appends 'related' to this union — see the
 * A3 design spec §2.8 for the full extension-point contract. */
export type RefineKind = 'simpler' | 'examples' | 'etymology' | 'usage';
```

`LookupRequest` gains, immediately after the existing `forceLiteral?: boolean | undefined;` field
(current lines 32-38):

```ts
  /**
   * A3: one-shot request to answer with a specific refinement (simpler wording, more examples,
   * etymology, or usage guidance) instead of the default answer. Re-runs the SAME selection
   * once; does not persist. The router skips the cache read for the same reason as `provider`/
   * `forceLiteral` above — a hit would echo back the original (unrefined) answer.
   */
  refine?: RefineKind | undefined;
```

### 3.2 `packages/app/src/wire.ts`

```ts
const RefineKindEnum = z.enum(['simpler', 'examples', 'etymology', 'usage']);
```

`LookupRequestSchema` gains, after `forceLiteral: z.boolean().optional(),`:

```ts
  // A3: one-shot refine request; absent on normal lookups. See domain/types.ts's doc comment.
  refine: RefineKindEnum.optional(),
```

The compile-time `AssertEqual<z.infer<typeof LookupRequestSchema>, LookupRequest>` check
(`wire.ts:204`) forces this to stay byte-for-byte in sync with §3.1's type addition — a mismatch
fails `bun run typecheck`, not just a runtime parse.

### 3.3 `packages/app/src/app/router.ts`

Extend the existing cache-read guard (line 114) to a fourth clause, per §2.7:

```ts
if (cacheEnabled && req.provider === undefined && req.forceLiteral !== true && req.refine === undefined) {
```

No other change to `router.ts` — no new `case` in the exhaustive switch (§2.1).

### 3.4 `packages/app/src/domain/default-template.ts`

Add `REFINE_INSTRUCTIONS` (§2.2's pinned copy, verbatim) as a new export, positioned after
`TRANSLATION_INSTRUCTION`. Add one new placeholder line to `PROMPT_ENVELOPE`, immediately after
the existing `{translation_instruction}` line and before "Output Markdown with these sections…":

```
{idiom_instruction}

{translation_instruction}

{refine_instruction}

Output Markdown with these sections, in this exact order:
{output_format}
```

### 3.5 `packages/app/src/domain/prompt-template.ts`

`buildPrompt` gains a 5th optional parameter, appended last (mirrors how `forceLiteral` was
appended as the 4th in A8):

```ts
export function buildPrompt(
  outputFormat: string,
  vars: TemplateVars,
  envelope?: string,
  forceLiteral?: boolean,
  refine?: RefineKind,
): string {
  const env = envelope !== undefined && envelope.trim() !== '' ? envelope : PROMPT_ENVELOPE;
  let composed = env.includes('{output_format}')
    ? env.replace('{output_format}', outputFormat)
    : env;
  const idiomInstruction = forceLiteral ? IDIOM_FORCE_LITERAL_INSTRUCTION : IDIOM_AUTO_INSTRUCTION;
  composed = composed.includes('{idiom_instruction}')
    ? composed.replace('{idiom_instruction}', idiomInstruction)
    : composed;
  composed = composed.includes('{translation_instruction}')
    ? composed.replace('{translation_instruction}', TRANSLATION_INSTRUCTION)
    : composed;
  composed = composed.includes('{refine_instruction}')
    ? composed.replace('{refine_instruction}', refine ? REFINE_INSTRUCTIONS[refine] : '')
    : composed;
  return renderTemplate(composed, { ...vars, title: redactPII(vars.title ?? '') });
}
```

Import `REFINE_INSTRUCTIONS` and the `RefineKind` type at the top of the file alongside the
existing `default-template`/`domain/types` imports.

### 3.6 `packages/app/src/app/http-lookup-client.ts`

The `buildPrompt` call (lines 83-94) gains a 5th argument:

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
  req.refine,
);
```

No other change to this file — `parseDefinedAs`/`parseTranslation` (lines 157-158) already run
unconditionally on every response and need no refine-awareness; a refined response still carries
(and still gets parsed for) the same `DEFINED_AS`/`TRANSLATION` signal lines.

### 3.7 `packages/app/src/ports.ts`

`ResultRenderContext` gains two fields, positioned after the existing `onForceLiteral?: () =>
void;`:

```ts
  /**
   * A3: re-run the SAME selection once with the given refinement. Always present on a
   * completed result (refine chips are always offered — no gating, unlike the picker/
   * force-literal controls).
   */
  onRefine?: (kind: RefineKind) => void;
  /**
   * A3: set only when THIS result came from a refine re-run (mirrors the shape of
   * `onForceLiteral`'s own gating). Undefined = this is the original, unrefined result. Read by
   * `InlineBottomSheetRenderer` (to decide whether to snapshot `originalState`) and by
   * `content.ts` (to decide whether to snapshot `lastOriginalSavePayload` — see the design
   * spec's §2.5).
   */
  refine?: RefineKind;
```

Import `RefineKind` alongside the file's existing `domain/types` imports.

### 3.8 `packages/app/src/domain/workflow.ts`

`runLookup` gains a 4th parameter, `refine?: RefineKind`, appended last:

```ts
  async function runLookup(
    e: SelectionEvent,
    providerOverride?: Provider,
    forceLiteral?: boolean,
    refine?: RefineKind,
  ): Promise<void> {
```

Set `req.refine` right after the existing `forceLiteral` assignment:

```ts
if (providerOverride) req.provider = providerOverride;
if (forceLiteral) req.forceLiteral = true;
if (refine) req.refine = refine;
```

`ctx` gains an unconditional `onRefine` (it is already an always-built object per the existing B1
comment at `workflow.ts:85-87`, so no new conditional spread is needed — just one more property)
and a conditional `refine` marker:

```ts
const ctx: ResultRenderContext = {
  sentence: e.sentence,
  url: e.url,
  title: e.title,
  onRefine: (kind: RefineKind) => {
    // A3: deliberate one-shot re-run of the SAME original selection; bypasses cooldown —
    // same reasoning as onSwitchProvider/onForceLiteral above. Always resets provider
    // override and forceLiteral to defaults (§2.4(c) of the design spec) rather than
    // composing with whatever was last picked.
    void runLookup(e, undefined, undefined, kind).catch((err) =>
      deps.renderer.renderError(mapError({ kind: 'thrown', error: err })),
    );
  },
  ...(refine !== undefined ? { refine } : {}),
  ...(showPicker
    ? {
        /* unchanged */
      }
    : {}),
  ...(isIdiom
    ? {
        /* unchanged */
      }
    : {}),
};
```

(The `showPicker`/`isIdiom` spreads are the existing code, unmodified — shown here only to mark
where the two new properties are inserted relative to them.)

### 3.9 `packages/app/src/ui/lookup-card.ts`

Export the chip contract (per CONTRACTS §4 pin), positioned near `PROVIDER_LABELS`:

```ts
export interface RefineChip {
  id: RefineKind;
  label: string;
}

/** A3: the fixed v1 refine chip row (roadmap scope fence: "Fixed 4 chips in v1, not
 * configurable"). B13 (wave 2) appends a 5th 'related' entry — see the A3 design spec §2.8. */
export const REFINE_CHIPS: RefineChip[] = [
  { id: 'simpler', label: 'Simpler' },
  { id: 'examples', label: 'More examples' },
  { id: 'etymology', label: 'Etymology' },
  { id: 'usage', label: 'Use it' },
];
```

`CardState`'s `'result'` variant gains two fields, after the existing `nudge?: boolean;`:

```ts
      /** A3: true only for the in-page card — InlineBottomSheetRenderer always sets it; the
       * side panel never does, so the row is absent there by construction (mirrors saved/nudge's
       * explicit-boolean convention; see design spec §2.6). */
      refineChips?: boolean;
      /** A3: which refine (if any) produced this rendered result; undefined = the original.
       * Only meaningful when refineChips is true. */
      refine?: RefineKind;
```

New render function, positioned after `renderDefinedAsRow`:

```ts
/**
 * A3: the fixed 4-chip refine row plus, when a refinement is currently showing, a "Back to
 * original" pill. The active chip (state.refine) is aria-pressed + disabled — no wasted
 * duplicate network call for the same refinement already shown (mirrors renderMetaRow's
 * disable-the-current-provider pattern below).
 */
function renderRefineRow(state: { refine?: RefineKind }): HTMLElement {
  const row = document.createElement('div');
  row.className = 'refine-row';
  row.setAttribute('role', 'group');
  row.setAttribute('aria-label', 'Refine this definition');
  if (state.refine !== undefined) {
    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'refine-back-btn';
    backBtn.textContent = 'Back to original';
    backBtn.setAttribute('aria-label', 'Restore the original definition');
    backBtn.addEventListener('click', () =>
      backBtn.dispatchEvent(new CustomEvent('refine-back', { bubbles: true, composed: true })),
    );
    row.append(backBtn);
  }
  for (const chip of REFINE_CHIPS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'refine-chip';
    btn.textContent = chip.label;
    const isActive = state.refine === chip.id;
    btn.setAttribute('aria-pressed', String(isActive));
    if (isActive) {
      btn.disabled = true;
    } else {
      btn.addEventListener('click', () =>
        btn.dispatchEvent(
          new CustomEvent('refine', {
            detail: { refine: chip.id },
            bubbles: true,
            composed: true,
          }),
        ),
      );
    }
    row.append(btn);
  }
  return row;
}
```

`renderCardState`'s `'result'` branch (current lines 276-288) inserts the row right after the
body, before the meta row:

```ts
const h = document.createElement('h2');
h.textContent = state.word;
const body = document.createElement('div');
body.innerHTML = state.safeHtml;
const nodes: Node[] = [h, renderSaveRow(state)];
if (state.nudge === true) nodes.push(renderNudgeRow(state));
const definedAsRow = state.definedAs ? renderDefinedAsRow(state.definedAs) : null;
if (definedAsRow) nodes.push(definedAsRow);
nodes.push(body);
if (state.refineChips === true) nodes.push(renderRefineRow(state));
const meta = renderMetaRow(state);
if (meta) nodes.push(meta);
return nodes;
```

Import `RefineKind` alongside the file's existing `Provider`/`SavedWordStatus` imports from
`'../index'`.

**CSS.** In the shadow `CSS` template literal, add a `::slotted(.refine-row)` layout rule
alongside the existing `.meta-row`/`.defined-as`/`.save-row` rules (`lookup-card.ts:136-138`):

```css
::slotted(.refine-row) {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin: 10px 0 2px;
}
```

In `CARD_DOC_CSS` (document-scoped descendant rules, `lookup-card.ts:145-180`), add button styling
positioned near the existing `.defined-as__literal-btn`/`.prov-switch` rules — `--ad-*`/`--adp-*`
tokens only, no hardcoded colors (token law):

```css
lookup-card .refine-chip {
  border: 1px solid var(--ad-line);
  background: transparent;
  color: var(--ad-ink-soft);
  border-radius: var(--adp-radius-control);
  padding: 4px 11px;
  font: inherit;
  font-size: var(--adp-text-2xs);
  font-weight: var(--adp-weight-semi);
  cursor: pointer;
  transition:
    background var(--adp-dur-fast) var(--adp-ease),
    color var(--adp-dur-fast) var(--adp-ease),
    border-color var(--adp-dur-fast) var(--adp-ease);
}
lookup-card .refine-chip:hover:not(:disabled) {
  background: var(--ad-surface-raised);
  color: var(--ad-ink);
}
lookup-card .refine-chip:focus-visible {
  outline: 2px solid var(--ad-accent);
  outline-offset: 2px;
}
lookup-card .refine-chip[aria-pressed='true'] {
  border-color: var(--ad-accent);
  color: var(--ad-accent-ink);
  cursor: default;
}
lookup-card .refine-chip:disabled {
  opacity: 0.85;
}
@media (prefers-reduced-motion: reduce) {
  lookup-card .refine-chip {
    transition: none;
  }
}
lookup-card .refine-back-btn {
  border: 1px solid var(--ad-accent);
  background: transparent;
  color: var(--ad-accent-ink);
  border-radius: var(--adp-radius-control);
  padding: 4px 11px;
  font: inherit;
  font-size: var(--adp-text-2xs);
  font-weight: var(--adp-weight-semi);
  cursor: pointer;
}
lookup-card .refine-back-btn:hover {
  background: var(--ad-surface-raised);
}
lookup-card .refine-back-btn:focus-visible {
  outline: 2px solid var(--ad-accent);
  outline-offset: 2px;
}
```

### 3.10 `packages/app/src/app/inline-bottom-sheet-renderer.ts`

Add two private fields (alongside the existing `onSwitch`/`onForceLiteral`/`lastState`,
lines 17-24):

```ts
  // A3: same pattern as onSwitch/onForceLiteral for the card's one `refine` listener.
  private onRefine: ((k: RefineKind) => void) | undefined;
  // A3: the last render where ctx.refine was undefined (a genuine original result), so
  // restoreOriginal() can revert a refined body without a new lookup. null before any render,
  // or after close(). See the design spec's §2.4(b).
  private originalState: CardState | null = null;
```

`ensureCard()` gains one more listener, alongside the existing `switch-provider`/`force-literal`
listeners (lines 62-67):

```ts
// A3: the card fires `refine` when a chip is tapped; delegate to the handler the workflow
// installed via the render context (mirrors switch-provider/force-literal above).
card.addEventListener('refine', (e) =>
  this.onRefine?.((e as CustomEvent<{ refine: RefineKind }>).detail.refine),
);
```

`refine-back` is **deliberately not** listened here — per §2.5, it is handled by `content.ts`
directly calling `restoreOriginal()`, exactly like `dismiss-nudge` is handled by `content.ts`
calling `dismissNudge()` rather than the renderer self-listening.

`renderResult` (lines 88-107) gains the `onRefine` wiring, the `refineChips`/`refine` state
fields, and the `originalState` snapshot:

```ts
  renderResult(r: LookupResult, ctx?: ResultRenderContext): void {
    this.onSwitch = ctx?.onSwitchProvider;
    this.onForceLiteral = ctx?.onForceLiteral;
    this.onRefine = ctx?.onRefine;
    const state: CardState = {
      kind: 'result',
      safeHtml: this.sanitize(r.markdown),
      word: r.word,
      target: r.target,
      ...(r.provider !== undefined ? { provider: r.provider } : {}),
      ...(r.fallbackFrom !== undefined ? { fallbackFrom: r.fallbackFrom } : {}),
      ...(r.definedAs !== undefined ? { definedAs: r.definedAs } : {}),
      ...(ctx?.providers !== undefined ? { providers: ctx.providers } : {}),
      saved: ctx?.saved === true,
      nudge: r.nudge === true,
      refineChips: true,
      ...(ctx?.refine !== undefined ? { refine: ctx.refine } : {}),
    };
    if (ctx?.refine === undefined) this.originalState = state;
    this.setState(state);
  }
```

New public method, positioned after `dismissNudge`:

```ts
  /**
   * A3: restore the last original (non-refined) result without a new lookup — zero tokens, zero
   * wire calls. No-op if no original snapshot exists yet (mirrors the guard style setSaved/
   * setStatus/dismissNudge already use).
   */
  restoreOriginal(): void {
    if (!this.originalState) return;
    this.setState(this.originalState);
  }
```

`close()` (lines 167-172) resets the new field alongside its existing resets:

```ts
  close(): void {
    this.sheet?.remove();
    this.sheet = null;
    this.card = null;
    this.lastState = null;
    this.originalState = null;
  }
```

Import `RefineKind` alongside the file's existing `Provider`/`Theme`/`SavedWordStatus` imports
from `'../index'`.

### 3.11 `packages/extension-chrome/src/content.ts`

Add a second save-payload snapshot variable, alongside the existing `lastSavePayload`/`lastSaved`/
`lastStatus` (lines 45-63):

```ts
// A3: the save payload from the last GENUINELY ORIGINAL (non-refined) result, so a "Back to
// original" tap can restore what Save would persist without re-running a lookup. Distinct from
// lastSavePayload, which tracks whatever is CURRENTLY shown (including a refined body). See the
// design spec's §2.5.
let lastOriginalSavePayload: typeof lastSavePayload;
```

`renderResult` (lines 86-105) snapshots it, gated on `ctx?.refine === undefined`:

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

New document-level listener, positioned alongside the existing `dismiss-nudge` listener
(lines 190-192):

```ts
// A3: the card's "Back to original" pill bubbles a composed `refine-back` event. This is a
// local-only restore (no wire call, no token spend — see the design spec's §2.4(b)): revert the
// visible card AND the save-tracking bookkeeping together, so a Save immediately afterward
// persists the original definition, not whatever refinement was showing a moment ago (§2.5).
document.addEventListener('refine-back', () => {
  inline.restoreOriginal();
  if (lastOriginalSavePayload) lastSavePayload = lastOriginalSavePayload;
  lastSaved = false;
  lastStatus = undefined;
  saveReplyGuard.next();
});
```

## 4. No change to the following (recorded explicitly — an implementer would reflexively check these)

- **`packages/app/src/domain/error-mapper.ts`** — no new error taxonomy or copy; a refine request
  fails exactly like any other lookup, through the existing `LookupErrorCode` table.
- **`packages/app/src/domain/markdown-sanitize.ts`** — S4 is already unconditional: every
  `LookupResult.markdown`, refined or not, passes through the same
  `InlineBottomSheetRenderer.sanitize` call (`inline-bottom-sheet-renderer.ts:95`) before it
  reaches the DOM. Nothing about a refine request changes what gets sanitized or how.
- **`packages/extension-chrome/src/side-panel.ts`** — zero code changes; the exclusion in §2.6 is
  achieved entirely by omission (the file's own explicit-object-construction style already means
  a field it never lists is simply absent).
- **`packages/app/src/ui/side-panel-view.ts`** — reuses `renderCardState`/`CardState` unchanged;
  no new code path, since `refineChips` is never `true` for anything the side panel builds.
- **`packages/app/manifest.json` / any `permissions`/`host_permissions`** — no new API surface,
  no new host.
- **`packages/extension-safari/**`** — by the same reasoning A8 §11 already established: the
Safari shell composes the identical `runLookupWorkflow`+`InlineBottomSheetRenderer`from the
core (confirmed unchanged since A8:`packages/extension-safari/src/content.ts` wires the same
  ports), so it inherits refine chips for free with zero Safari-specific code.
- **`packages/app/src/ui/index.ts` / `packages/app/src/index.ts` barrels** — both already
  `export *` from `lookup-card`/`ui/index` (confirmed: `index.ts:1-2`, `src/index.ts:26`), so
  `RefineKind`, `RefineChip`, and `REFINE_CHIPS` are re-exported automatically; no barrel edits
  needed.
- **`packages/app/src/domain/defined-as.ts` / `translation-line.ts`** — both parse unconditionally
  on every response already (§3.6); no refine-awareness needed.

## 5. Scope fence held (from the roadmap card)

- **"Fixed 4 chips in v1 (not configurable)"** — `REFINE_CHIPS` is a fixed, code-owned array; no
  settings surface, no user-configurable chip list. Held by construction (§3.9).
- **"Refined answer replaces the body"** — `renderCardState` always shows exactly one body (the
  currently-selected `CardState`'s `safeHtml`); a refine tap fully replaces `lastState` via the
  normal `setState` path, same as every other result render. No diff/merge view, no side-by-side.
- **"Back restores the original"** — §2.4(b): a local, exact restore of the original
  `LookupResult`'s rendered `CardState`, not a fresh (possibly-different) re-run.
- **"Original word + sentence re-sent automatically"** — §2.4(c): every refine tap closes over the
  same `SelectionEvent e` every other one-shot override already uses; the reader never re-selects
  or re-types anything.
- **Constraint 4 (no background LLM calls, every model call user-triggered, token-spending
  features say so first)** — every refine call fires only from an explicit chip click; "Back" is
  the deliberate zero-token path (§2.4(b)) precisely so returning to what's already been paid for
  never costs a second token.
- **S1 (API key isolation)** — untouched; no new field carries the key, nothing here changes how
  `getApiKey`/`SettingsStore` work.
- **S4 (sanitize model output, including partial/streamed)** — untouched; refined markdown flows
  through the exact same, single `sanitizeMarkdown` trust boundary as every other result (§4).
- **Design tokens only** — the new `.refine-chip`/`.refine-back-btn` rules read only `--ad-*`/
  `--adp-*` tokens (§3.9's CSS), honor `prefers-reduced-motion`, and introduce zero hardcoded
  colors.
- **Ports architecture** — the one new outward capability (`onRefine`) is added to the existing
  `ResultRenderContext` port (`ports.ts`), not a new ad hoc channel; `domain/` stays
  dependency-free (all new domain-side code — `RefineKind`, `REFINE_INSTRUCTIONS`, `refine` param
  threading — touches only `types.ts`/`default-template.ts`/`prompt-template.ts`/`workflow.ts`,
  all already zero-import domain-pure files, and none of the new code imports `chrome.*`, `fetch`,
  or the DOM).

## 6. Testing strategy

Vitest (unit, happy-dom where DOM is touched) + Playwright (e2e), per repo convention.

### 6.1 Unit tests

- **`packages/app/test/default-template.test.ts`** (append, mirrors the existing `describe('PROMPT_ENVELOPE (A8 idiom slot)')`/`describe('TRANSLATION_INSTRUCTION')` blocks at lines 37-41/62-68):
  `PROMPT_ENVELOPE` contains `{refine_instruction}`; each of the 4 `REFINE_INSTRUCTIONS` entries
  is a non-empty string, and the 3 that reference `"{word}"` (`examples`, `etymology`, `usage`) do.
- **`packages/app/test/prompt-template.test.ts`** (append, mirrors the existing idiom tests around
  lines 113-130): `buildPrompt(fmt, vars)` (no 5th arg) contains none of the 4
  `REFINE_INSTRUCTIONS` strings; `buildPrompt(fmt, vars, undefined, undefined, 'simpler')`
  contains the `simpler` instruction text and none of the other three; each of the 4 refine kinds
  produces its own distinct instruction (loop over `Object.keys(REFINE_INSTRUCTIONS)` asserting
  the built prompt contains that kind's exact string and no other kind's); a custom envelope
  without `{refine_instruction}` is unaffected by a refine value (mirrors
  `prompt-template.test.ts:129`'s existing idiom-slot opt-out assertion).
- **`packages/app/test/wire-schema.test.ts`** (append, mirrors the existing
  `'lookup req accepts an optional forceLiteral flag…'` test at lines 245-267): `LookupRequestSchema`
  accepts each of the 4 valid `refine` values and rejects an unrecognized string
  (`refine: 'nonsense'`); an old-shaped request without `refine` still parses (back-compat, same
  pattern as the existing provider/forceLiteral tests). **Also regenerate the JSON-schema
  snapshot** (`packages/app/wire-schema.snapshot.json`, asserted by the existing `'JSON-schema
snapshot is stable'` test at line 405) — the new field changes the generated schema; run
  `cd packages/app && bunx vitest run wire-schema -u` once to update it and commit the diff in the
  same task as the wire.ts change.
- **`packages/app/test/workflow.test.ts`** (append, mirrors the existing `onSwitchProvider`/
  `onForceLiteral` tests at lines 99-194): `ctx.onRefine` is always a function on a completed
  result, even with 1 provider and no idiom (extends the existing "ctx always carries
  sentence/url/title" test at lines 108-119 with an `onRefine` assertion); calling
  `ctx.onRefine('etymology')` re-runs the SAME selection with `req.refine === 'etymology'` and
  neither `provider` nor `forceLiteral` set, bypassing cooldown (mirrors the `onSwitchProvider`
  test at lines 121-139 exactly, including the "still inside the cooldown window" timing setup);
  the ctx built from _that_ second result carries `refine: 'etymology'` (verifies the marking
  threads through for §2.5/§2.6's downstream consumers).
- **`packages/app/test/app/router.test.ts`** (append, mirrors the existing `forceLiteral`
  cache-bypass test at lines 110-122): `req.refine` set skips the cache read even when an
  identical word/context/target is already cached (same assertions: `result.fromCache === false`,
  `client.lookup` called exactly once).
- **`packages/app/test/ui/lookup-card.test.ts`** (append, mirrors the existing
  `describe('<lookup-card> idiom label + force-literal button (A8)')` block at lines 468-520):
  a `'result'` state with `refineChips: true` renders exactly 4 `.refine-chip` buttons with the
  exact texts `'Simpler'`, `'More examples'`, `'Etymology'`, `'Use it'`, in that order; clicking a
  non-active chip fires a composed `refine` event with `detail.refine` equal to that chip's `id`
  (mirrors the existing `'clicking the button fires a composed force-literal event'` test at
  486-499); a state with `refine: 'etymology'` renders the `Etymology` chip `aria-pressed="true"`
  and `disabled`, the other 3 chips enabled and `aria-pressed="false"`, and a `.refine-back-btn`
  reading `'Back to original'`; clicking `.refine-back-btn` fires a composed `refine-back` event
  with no detail; a state with `refine: undefined` renders **no** `.refine-back-btn`; a state with
  `refineChips` absent/`false` renders **no** `.refine-row` at all (the side-panel-omission case,
  §2.6 — mirrors the existing `'a result with no definedAs renders no .defined-as row'` back-compat
  style at line 514).
- **`packages/app/test/app/inline-bottom-sheet-renderer.test.ts`** (append, mirrors the existing
  force-literal wiring tests at lines 184-210): `renderResult(r)` with no `ctx` (fresh/original)
  renders `refineChips: true` in the card's light DOM (`.refine-row` present with 4 `.refine-chip`
  buttons); wiring `ctx.onRefine` — clicking a `.refine-chip` invokes the supplied callback with
  the correct `RefineKind` (mirrors the `'clicking the card's force-literal button…'` test at
  194-204); a second `renderResult(r2, { refine: 'simpler' })` call does **not** clear the first
  call's `originalState` snapshot — verified indirectly by then calling `restoreOriginal()` and
  asserting the card's light DOM shows the FIRST result's `safeHtml`, not the second's; calling
  `restoreOriginal()` before any render is a no-op (mirrors the existing `'close() before any
render is a no-op'` guard style at line 89); `close()` followed by a fresh `renderResult` +
  `restoreOriginal()` shows that fresh render is now the new "original" (verifies `originalState`
  really was reset to `null` by `close()`, not stale from a prior card).
- **No dedicated `content.ts` unit test** — `content.ts` is a composition root with no existing
  unit-test file (confirmed: `packages/extension-chrome/src/` has no `content.test.ts`,
  matching the precedent already recorded in the C2 plan for `options.ts`: "composition root,
  covered by e2e only"). §3.11's `lastOriginalSavePayload`/`refine-back` logic is proven by the
  e2e save-after-Back scenario below instead.

### 6.2 E2e tests (`packages/extension-chrome/e2e/a3-follow-up-chips.spec.ts`, new — follows `idiom-expansion.spec.ts`'s structure)

Using `mockGemini`'s `onRequest` hook to assert outbound prompt content, matching the established
`idiom-expansion.spec.ts` pattern (`context.route`/`context.unroute` to swap mock bodies between
requests, `swStorageDump`-style storage reads for persistence assertions per `saved-word.spec.ts`):

1. **Chips render on every result**: seed settings, `gotoFixture`, `mockGemini` (default OK body),
   select "bank", open trigger → assert the card shows exactly 4 `.refine-chip` buttons with texts
   `Simpler`/`More examples`/`Etymology`/`Use it`, none `disabled`, none `aria-pressed="true"`, and
   **no** `.refine-back-btn`.
2. **Tapping a chip resends the original word/sentence with the refine instruction, and replaces
   the body**: continuing from test 1, capture the outbound prompt via `onRequest` on a second
   `mockGemini` route (swapped in via `context.unroute` + re-`mockGemini`, mirroring
   `idiom-expansion.spec.ts:94-96`) returning a distinct "simpler" body → click the `Simpler` chip
   → assert the second request's prompt contains `REFINE_INSTRUCTIONS.simpler`'s exact wording
   (a substring) AND still contains the original word `"bank"` and sentence text → assert the card
   body now shows the second mock's text → assert the `Simpler` chip is now `aria-pressed="true"`
   and `disabled` → assert a `.refine-back-btn` reading `Back to original` is now visible.
3. **Back restores the original with zero extra network calls**: continuing from test 2, record
   the mock's `.count` (should be 2) → click `.refine-back-btn` → assert the card body now shows
   the FIRST mock's text again (not the second) → assert `.refine-back-btn` is gone and all 4
   chips are enabled/`aria-pressed="false"` again → assert the mock's `.count` is **still 2** (no
   3rd network call — the zero-token guarantee).
4. **Cache does not intercept a refine tap even for an identical word/sentence/target**: look up
   "bank" once (populating the cache, per `cache-history.spec.ts`'s existing pattern), then tap a
   refine chip for the SAME word/sentence → assert the mock's call count increments to 2 (not
   served from cache) — mirrors the existing provider-override/force-literal cache-bypass e2e
   coverage pattern.
5. **Save after Back persists the ORIGINAL definition, not the refined one**: select "bank", mock
   two distinct Gemini responses (original: `"A financial institution."`; refined: a distinct
   "simpler" body) → tap the `Simpler` chip → tap `Back to original` → click the star (Save) →
   read `chrome.storage.local`'s `saved:bank` entry (per `saved-word.spec.ts:51-59`'s exact
   pattern: `expect.poll` then `JSON.parse(dump['saved:bank'])`) → assert
   `entry.senses[0].definition` contains `"financial institution"` (the ORIGINAL text) and does
   **not** contain the refined body's distinguishing text. This is the direct regression test for
   the §2.5 correctness hazard.
6. **The side panel mirrors a refined result but never shows chips**: open the side panel
   (mirrors `idiom-expansion.spec.ts`'s final test, lines 138-163), perform a lookup in the
   in-page card, tap a refine chip → assert the panel's mirrored text updates to the refined body
   (the mirror DOES receive refine results, §2.6) → assert `side-panel-view .refine-row` has
   count 0 (chips never render there).

## 7. Testing performed (PR evidence — replaces screenshot/video capture)

Per this worktree's `CLAUDE.md` (owner ruling 2026-07-16): **no screenshots or video for this
PR.** The PR body's "Testing performed" section carries the evidence instead — the suites run
(`bun run test`, `bun run typecheck` for both `app` and `extension-chrome`), test counts (existing

- the additions enumerated in §6.1/§6.2), lint/format-check results, and the specific e2e spec
  file(s) exercised (`a3-follow-up-chips`, plus the existing regression guards this card's files
  share — `onboarding`/`cache-history`/`saved-word`/`idiom-expansion`, since `lookup-card.ts` and
  `inline-bottom-sheet-renderer.ts` are shared surfaces). No `pr-assets/*` branch is created.

## 8. Risk / rollback

- **Risk: low-moderate.** The bulk of the change is additive (new optional fields, new exported
  constants, one new render function, one new renderer method) — no existing exported signature's
  _required_ parameters change. The one genuinely new correctness surface is §2.5's
  save-after-Back bookkeeping in `content.ts`; it is directly covered by e2e test 5 (§6.2), which
  asserts the persisted storage entry's actual text, not just UI state.
- **Prompt whitespace, not prompt semantics, is the only thing that changes for every existing
  (non-refine) lookup** — confirmed no test asserts exact full-prompt equality (§2.2).
- **Cache overwrite precedent reused, not introduced** — §2.7's one-line guard extension carries
  the exact same accepted, pre-existing risk A8 already took for `forceLiteral` (a refined answer
  can overwrite the cached original until the entry ages out/clears); rollback is identical in
  shape (delete the one added clause).
- **No data migration.** No change to any persisted shape — `SavedWordEntry`/`HistoryEntry`/cache
  entries are all unchanged; `refine`/`RefineKind` are transient, in-flight-only fields (§2.8),
  never written to storage.
- **Rollback:** revert the single PR. Pre-A3 behavior (no refine chips, no `{refine_instruction}`
  slot, `LookupRequestSchema`/`LookupRequest` without `refine`) returns exactly as it was; no
  stored data becomes invalid, since nothing this card adds is ever persisted.
- **Nothing downstream in the roadmap depends on A3 shipping a particular internal shape beyond
  the two exported extension points (§2.8)** — checked `docs/ROADMAP.md`'s dependency map (§5,
  line 856: `A3[A3 Follow-up chips] --> B13[B13 Related words]`) — B13 is the only dependent, and
  its needs are fully covered by §2.8.

## 9. Files touched (summary)

| File                                                         | Change                                                                                    |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `packages/app/src/domain/types.ts`                           | + `RefineKind` type, `LookupRequest.refine` field                                         |
| `packages/app/src/wire.ts`                                   | + `RefineKindEnum`, `LookupRequestSchema.refine`                                          |
| `packages/app/src/app/router.ts`                             | cache-read guard extended with `req.refine === undefined`                                 |
| `packages/app/src/domain/default-template.ts`                | + `REFINE_INSTRUCTIONS`, `{refine_instruction}` slot in `PROMPT_ENVELOPE`                 |
| `packages/app/src/domain/prompt-template.ts`                 | `buildPrompt` gains 5th param `refine?: RefineKind`                                       |
| `packages/app/src/app/http-lookup-client.ts`                 | `buildPrompt` call passes `req.refine`                                                    |
| `packages/app/src/ports.ts`                                  | `ResultRenderContext` gains `onRefine`, `refine`                                          |
| `packages/app/src/domain/workflow.ts`                        | `runLookup` gains `refine` param; `ctx.onRefine`/`ctx.refine`                             |
| `packages/app/src/ui/lookup-card.ts`                         | + `RefineChip`, `REFINE_CHIPS`, `renderRefineRow`, `CardState.refineChips`/`.refine`, CSS |
| `packages/app/src/app/inline-bottom-sheet-renderer.ts`       | + `onRefine`, `originalState`, `restoreOriginal()`; `renderResult`/`close()` updated      |
| `packages/extension-chrome/src/content.ts`                   | + `lastOriginalSavePayload`, `refine-back` listener; `renderResult` handler updated       |
| `packages/app/test/default-template.test.ts`                 | + tests (§6.1)                                                                            |
| `packages/app/test/prompt-template.test.ts`                  | + tests (§6.1)                                                                            |
| `packages/app/test/wire-schema.test.ts`                      | + tests (§6.1); `wire-schema.snapshot.json` regenerated                                   |
| `packages/app/test/workflow.test.ts`                         | + tests (§6.1)                                                                            |
| `packages/app/test/app/router.test.ts`                       | + test (§6.1)                                                                             |
| `packages/app/test/ui/lookup-card.test.ts`                   | + tests (§6.1)                                                                            |
| `packages/app/test/app/inline-bottom-sheet-renderer.test.ts` | + tests (§6.1)                                                                            |
| `packages/extension-chrome/e2e/a3-follow-up-chips.spec.ts`   | new — functional e2e (§6.2)                                                               |

No change to `packages/app/src/domain/error-mapper.ts`, `markdown-sanitize.ts`, `defined-as.ts`,
`translation-line.ts`, `packages/extension-chrome/src/side-panel.ts`,
`packages/app/src/ui/side-panel-view.ts`, any manifest file, or `packages/extension-safari/**`
(§4).

## 10. Concurrency

Files this card modifies that other **unshipped** roadmap cards also modify, per CONTRACTS §5's
hot-file list plus one addition this spec's own research surfaced:

- **`packages/app/src/ui/lookup-card.ts`** — CONTRACTS' own listed hot file for A1, A2, A5, A7,
  A10 in addition to A3. Any of those landing concurrently needs serialization against this card's
  CSS/`renderCardState`/`CardState` edits.
- **`packages/app/src/domain/types.ts` and `packages/app/src/wire.ts`** — A3 adds
  `LookupRequest.refine`/`RefineKindEnum` to the _same_ `LookupRequestSchema`/`LookupRequest`
  objects A12 (non-english-source) is expected to touch too (per its dispatch note: "Ground the
  hard-coded `{source_lang}`… detection mechanism"), if A12 ends up adding a request field of its
  own. **Not listed in CONTRACTS §5's original hot-file note for these two files** — flagging it
  here as a fact this spec's own research surfaced, per the template's instruction to record what
  it found. B13 (already-acknowledged dependent) also widens the same `RefineKind` union/enum
  later, but B13 is sequenced strictly after A3 ships (§2.8), so it is a follow-on, not a
  concurrency hazard.
- **`packages/app/src/domain/default-template.ts` / `prompt-template.ts`** — CONTRACTS §5 already
  lists these as hot for A12/B12; A3 is a third, previously-unlisted concurrent writer (a new
  `{refine_instruction}` slot alongside A12's/B12's own prompt-builder changes) — flagged here for
  the same reason as the point above.
- **`packages/app/src/app/inline-bottom-sheet-renderer.ts`** and
  **`packages/extension-chrome/src/content.ts`** — not on CONTRACTS §5's explicit hot-file list,
  but touched substantially by this card (§2.5's save-bookkeeping fix); any other unshipped card
  that also edits the `renderResult` handler in `content.ts` or `InlineBottomSheetRenderer`'s
  `renderResult`/`close` (none currently listed as doing so per CONTRACTS §5) should serialize
  against this card too.
