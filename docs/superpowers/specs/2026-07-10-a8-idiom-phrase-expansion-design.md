# A8 — Phrase & idiom expansion (design)

> Roadmap idea **A8** (`docs/ROADMAP.md`): _Impact 4 · Effort S · Score 4.0_.
> Category A (seamless reading UX). Decision authority: **Lead decides** (wording of the
> prompt instruction, label copy); **no owner escalation**.

## Problem

Select just "bucket" inside the sentence "He kicked the bucket last week" and today's prompt
(`PROMPT_ENVELOPE` in `packages/app/src/domain/default-template.ts:14`) asks the model to define
`"{word}"` — the literal, single selected token — with no instruction to notice that the
selection is part of a larger idiom. The model **may** notice the idiom from the sentence
context anyway (nothing stops it), or it may define the literal "bucket" (a pail). Nothing on
the card tells the reader which happened — `buildPrompt` (`packages/app/src/domain/
prompt-template.ts:45`) has no idiom-aware branch, and `LookupResult`
(`packages/app/src/domain/types.ts:34`) carries no field that could say "this is the idiom
reading, not the literal one." Idioms are exactly where a learner needs the most help, and today
the extension gives them a coin flip instead.

## Goal

Guarantee: when the selection is part of an idiom or phrasal verb in its sentence, the card
defines the **whole idiomatic unit** and **labels it as an idiom** — with one tap to force the
literal single-word reading instead. Per the roadmap's measurable payoff: card shows **defined
as "kick the bucket" (idiom): to die**, with one tap to force the literal single word.

## Non-goals (scope fence — from the roadmap card, settled)

- **Prompt instruction + card label + one button. No idiom-detection engine.** We do not write
  our own NLP/heuristic idiom detector — the LLM already holds the sentence and is asked to
  report what it detected. All "detection" is delegated to the model via the prompt; our code
  only asks for and parses a structured signal.
- **No new manifest permission, no new API surface.** This is a prompt-text change + a
  same-request re-run path, reusing the exact wire/lookup machinery that already exists.
- **No change to the target-language logic, caching mechanics beyond the one deliberate
  read-bypass described below, or the Card-format (`outputFormat`) user setting.** The idiom
  instruction lives in the code-owned `PROMPT_ENVELOPE` (never user-editable), exactly like
  today's safety constraints — consistent with why those constraints live there and not in the
  user's Card-format field.

## Design

### Why the core (`packages/app`), not a shell

This is lookup **behavior**, not a platform trigger (contrast with A4, which was purely
Chrome-shell input plumbing). The idiom instruction changes what we ask the model, the parsing
of its answer is pure text processing, and the card that renders the label/button is the shared
`<lookup-card>` web component already used by both Chrome and Safari
(`packages/app/src/ui/lookup-card.ts`, `c3-117 ui-components`). Every change lives in
`packages/app/src/**` (`c3-1`); zero changes to `packages/extension-chrome/**` or
`packages/extension-safari/**` are needed — both shells inherit this for free because both
compose `runLookupWorkflow` + `InlineBottomSheetRenderer` from the core
(confirmed by reading `packages/extension-chrome/src/content.ts:48-74` and
`packages/extension-safari/src/content.ts:14-40`, which wire the identical ports). This follows
`ref-core-dependency-rule` directly: portable behavior lives in the core.

### 1. The structured signal: `DEFINED_AS` line (domain, pure)

Since every lookup call today returns freeform Markdown (`LookupResult.markdown`, produced by
`spec.parseOk(json)` in `packages/app/src/app/http-lookup-client.ts:150`), the model has no
existing channel to hand back structured metadata ("I defined the idiom, here's its exact
phrase"). Rather than restructure the API calls into JSON/function-calling mode (an L-effort
rewrite touching all three provider clients), we ask the model to emit **one machine-parseable
line** as the first thing in its response, then strip and parse it before the rest reaches
`sanitizeMarkdown`.

**Prompt instruction** — two variants added to `packages/app/src/domain/default-template.ts`,
alongside the existing `PROMPT_ENVELOPE`/`DEFAULT_OUTPUT_FORMAT`:

```ts
export const IDIOM_AUTO_INSTRUCTION = `If "{word}" is part of an idiom, fixed expression, or phrasal verb in the sentence context (e.g. "kick the bucket", "give up"), define the WHOLE idiomatic unit — not just the selected word — and begin your response with exactly this line before any other output:
DEFINED_AS: "<the full idiom or phrasal verb, exactly as it appears in the sentence>" | idiom
Otherwise, "{word}" is used with its literal, standalone meaning; begin your response with exactly this line:
DEFINED_AS: "{word}" | literal`;

export const IDIOM_FORCE_LITERAL_INSTRUCTION = `Define ONLY the literal, standalone word "{word}" exactly as selected, even if it is part of a larger idiom or phrasal verb in the sentence context. Do not define the idiom. Begin your response with exactly this line before any other output:
DEFINED_AS: "{word}" | literal`;
```

`PROMPT_ENVELOPE` gains a new `{idiom_instruction}` placeholder (a code-owned slot, exactly like
`{output_format}` — never exposed to the user-editable Card-format field):

```
You are a bilingual dictionary for {target_lang} learners of English.
Word/phrase: "{word}"
Sentence context: "{context}"
Page title: "{title}"

{idiom_instruction}

Output Markdown with these sections, in this exact order:
{output_format}

Constraints:
...
```

**Parsing** — new pure file `packages/app/src/domain/defined-as.ts`:

```ts
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
  const after = markdown.slice(match.index + line.length).replace(/^\s*\n/, '');
  return { definedAs: { term, isIdiom: tag === 'idiom' }, body: (before + after).trim() };
}
```

Graceful degradation is load-bearing: if the model doesn't comply (a non-compliant model, a
custom advanced-envelope override that drops `{idiom_instruction}`, or any other reason),
`parseDefinedAs` returns `{ body: markdown }` unchanged — a strict superset of pre-A8 behavior.
No idiom detection ever _blocks_ a lookup; it only _adds_ a label when present.

### 2. `buildPrompt` gains an optional `forceLiteral` switch

`packages/app/src/domain/prompt-template.ts`:

```ts
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

`{idiom_instruction}` is substituted by a direct `.replace()` (same mechanism as
`{output_format}`, not the generic `renderTemplate` named-variable system) — so it always ships
with the built-in envelope, and a **custom advanced-envelope override** (`#62`) that doesn't
reference `{idiom_instruction}` simply doesn't get it, consistent with how that override already
opts out of other envelope-owned text today (documented in `prompt-template.ts`'s existing
comment). The `{word}` placeholder embedded _inside_ the instruction constants still resolves,
because it's substituted into `composed` before the final `renderTemplate(composed, vars)` pass
runs over the whole string — the same "insert-then-render" order that already lets
`{target_lang}` inside a user's custom Card-format resolve (existing test in
`prompt-template.test.ts`).

Existing 3-arg call sites (`http-lookup-client.ts:81`, `settings-form.ts:396`'s dev-prompt
preview) keep compiling — the new 4th parameter is optional and defaults to the auto-detect
instruction, which is the desired behavior change (the dev-prompt preview should reflect the new
prompt).

### 3. Wire the request/result fields through (domain types + wire schema)

`packages/app/src/domain/types.ts`:

```ts
export interface LookupRequest {
  // …unchanged fields…
  provider?: Provider | undefined;
  /** One-shot: force the literal single-word reading, bypassing idiom detection (A8's "Show
   * literal word" button). Re-runs the SAME selection once; does not persist. */
  forceLiteral?: boolean | undefined;
}

export interface LookupResult {
  // …unchanged fields…
  fallbackFrom?: Provider | undefined;
  /**
   * The unit the model actually defined: its literal selection, or — when the selection is
   * part of an idiom/phrasal verb — the whole idiomatic unit (A8). Stamped by the shared HTTP
   * lookup skeleton from the model's DEFINED_AS line (see defined-as.ts). Absent when the
   * model didn't emit a recognisable line (legacy cached/history entries, non-compliant model,
   * or a custom envelope override that omits the instruction) — never blocks rendering.
   */
  definedAs?: { term: string; isIdiom: boolean } | undefined;
}
```

`packages/app/src/wire.ts` — the compile-time `AssertEqual` drift guard
(`wire.ts:144-151`) forces the zod schema to match these types exactly:

```ts
const DefinedAsSchema = z.strictObject({ term: z.string(), isIdiom: z.boolean() });

const LookupRequestSchema = z.strictObject({
  // …unchanged…
  provider: ProviderEnum.optional(),
  forceLiteral: z.boolean().optional(),
});

const LookupResultSchema = z.strictObject({
  // …unchanged…
  fallbackFrom: ProviderEnum.optional(),
  definedAs: DefinedAsSchema.optional(),
});
```

### 4. `runHttpLookup` parses the response and stamps `definedAs`

`packages/app/src/app/http-lookup-client.ts` (the one shared skeleton behind all three provider
clients — Gemini/OpenAI/Anthropic all get this for free):

```ts
const prompt = buildPrompt(
  req.outputFormat,
  { word: req.word, context: req.context, target_lang: req.target, url: req.url, title: req.title },
  req.promptEnvelope,
  req.forceLiteral,
);
// … existing fetch/timeout/error handling unchanged …
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

### 5. Cache read bypass for a forced-literal re-run

`packages/app/src/app/router.ts:101` already skips the cache **read** (not the write) when
`req.provider` is set, because a manual provider pick must actually reach that provider — "the
cache key ignores provider, so a hit would echo back the previous provider's answer." The exact
same reasoning applies to `forceLiteral`: a hit would echo back the smart idiom-aware answer
instead of the literal one the reader explicitly asked for. Extend the same guard:

```ts
if (cacheEnabled && req.provider === undefined && req.forceLiteral !== true) {
```

The cache **write** proceeds unchanged (same as the existing provider-override precedent) — a
deliberate, minimal-risk choice consistent with established behavior in this exact function,
not a new risk this card introduces.

### 6. `ResultRenderContext` gains `onForceLiteral`

`packages/app/src/ports.ts`:

```ts
export interface ResultRenderContext {
  providers?: Provider[];
  onSwitchProvider?: (p: Provider) => void;
  /** Re-run the SAME selection once, forcing the literal single-word reading (A8). Present only
   * when the result just rendered is an idiom (`result.definedAs?.isIdiom === true`). */
  onForceLiteral?: () => void;
}
```

### 7. `runLookupWorkflow` builds `onForceLiteral` from the just-received result

`packages/app/src/domain/workflow.ts` — `runLookup` gains a `forceLiteral` parameter (mirrors
`providerOverride`), and the `ctx` built after a result returns now depends on **both** the
provider count and whether this particular result is an idiom (previously it depended only on
provider count):

```ts
async function runLookup(
  e: SelectionEvent,
  providerOverride?: Provider,
  forceLiteral?: boolean,
): Promise<void> {
  // … unchanged through the settings/no-key/loading section …
  const req: LookupRequest = {
    /* … unchanged fields … */
  };
  if (providerOverride) req.provider = providerOverride;
  if (forceLiteral) req.forceLiteral = true;
  try {
    const result = await deps.client.lookup(req, { signal: controller.signal });
    const showPicker = settings.configuredProviders.length >= 2;
    const isIdiom = result.definedAs?.isIdiom === true;
    const ctx: ResultRenderContext | undefined =
      showPicker || isIdiom
        ? {
            ...(showPicker
              ? {
                  providers: settings.configuredProviders,
                  onSwitchProvider: (p: Provider) => {
                    void runLookup(e, p).catch((err) =>
                      deps.renderer.renderError(mapError({ kind: 'thrown', error: err })),
                    );
                  },
                }
              : {}),
            ...(isIdiom
              ? {
                  onForceLiteral: () => {
                    // Deliberate override bypasses the Define-spam cooldown — same reasoning as onSwitchProvider.
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
    /* unchanged */
  }
}
```

This preserves the exact existing test expectation `ctx === undefined` when there's 1 provider
and no idiom (the common case) — `ctx` is now `undefined` only when **neither** condition
applies, a strict generalization of today's gate.

### 8. Card label + button (shared `<lookup-card>` — both shells for free)

`packages/app/src/ui/lookup-card.ts`:

- `CardState`'s `'result'` variant gains `definedAs?: { term: string; isIdiom: boolean }`
  (mirrors `provider?`/`fallbackFrom?`).
- `renderCardState` inserts a new row **between the headword and the body**, only when
  `state.definedAs?.isIdiom === true` (a literal result needs no extra label — the headword
  already says the word; showing "Defined as bucket (literal)" would be redundant noise for the
  overwhelmingly common non-idiom case — **Lead decision**, label copy):

  ```ts
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

  Wired into the `'result'` branch of `renderCardState`, right after the `h2` headword and
  before the sanitized body `div`.

- CSS: a `::slotted(.defined-as)` layout rule beside the existing `::slotted(.meta-row)` rule,
  plus `.defined-as__label`/`.defined-as__literal-btn` descendant rules added to the
  document-scoped `CARD_DOC_CSS` block (the exact same reason `.prov-badge`/`.prov-switch` live
  there — `::slotted()` cannot reach a slotted node's own descendants). The button is styled as
  an exact visual twin of `.prov-switch` (small bordered pill, `--ad-*`/`--adp-*` tokens only, no
  hardcoded colors — token law) for consistency with the card's other secondary action.

- `LookupCard`'s public surface (`connectedCallback`, `state` setter) needs **no changes** —
  `renderCardState` is the single render path already shared by the card and the side panel.

Because `PanelFocusState = CardState | { kind: 'empty' }` in
`packages/app/src/ui/side-panel-view.ts:13` reuses `CardState`/`renderCardState` directly, this
row (label text) is available to the side panel automatically — but see §10 below for why the
button does not actually reach it in practice.

### 9. `InlineBottomSheetRenderer` wires the new event + field

`packages/app/src/app/inline-bottom-sheet-renderer.ts`:

```ts
private onForceLiteral: (() => void) | undefined;
// … in ensureCard():
card.addEventListener('force-literal', () => this.onForceLiteral?.());
// … in renderResult():
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
```

### 10. The side panel deliberately does NOT get the button (by omission, matching existing precedent)

`packages/extension-chrome/src/side-panel.ts`'s `resultToFocus` already, **today**, explicitly
omits `providers` when building `PanelFocusState` from a `LookupResult` — the comment reads "no
one-shot picker here (the panel is a persistent surface, not the transient in-page card)". The
"force literal" button is the same class of transient, one-shot re-run action; the side panel
also lacks the original sentence/context needed to reissue a full `LookupRequest` (it only
mirrors `LookupResult`, never `LookupRequest`). Rather than plumb that extra context through the
mirror (a materially bigger change, out of this Effort-S card), `resultToFocus` simply does
**not** copy `r.definedAs` into the `PanelFocusState` it builds — meaning the label row does not
render there at all (the row is entirely absent, not shown-but-disabled). **This requires no
code change** — `resultToFocus` already builds an explicit new object rather than spreading `r`,
so an unlisted field is dropped by construction. A regression test locks this (see Testing).
`content.ts`'s `mirror.renderResult(r)` call is unaffected — it forwards the full `r` over
`chrome.runtime` messaging as it already does; `side-panel.ts` is where the field gets dropped.

### 11. `packages/extension-safari/**`

No changes. Confirmed by reading `packages/extension-safari/src/content.ts:14-40`: it composes
the identical `runLookupWorkflow` + `InlineBottomSheetRenderer(document.body)` (no side panel —
"the only surface on iOS", per its own comment) from the core, so it inherits the idiom label +
button automatically.

## Testing strategy

Vitest (unit, happy-dom where DOM is touched) + Playwright (e2e), per repo convention.

### Unit tests

- `packages/app/test/defined-as.test.ts` (new): `parseDefinedAs` extracts `{term, isIdiom}` for
  both `idiom` and `literal` tags; strips the line (+ one following blank line) from the
  returned `body`; returns `{ body: markdown }` unchanged when no `DEFINED_AS` line is present
  (graceful degradation); tolerates the line appearing after leading whitespace/blank lines.
- `packages/app/test/default-template.test.ts` (append): `PROMPT_ENVELOPE` contains
  `{idiom_instruction}`; `IDIOM_AUTO_INSTRUCTION`/`IDIOM_FORCE_LITERAL_INSTRUCTION` each mention
  `DEFINED_AS:` and `{word}`.
- `packages/app/test/prompt-template.test.ts` (append): `buildPrompt(fmt, vars)` (no 4th arg)
  includes the auto-detect instruction; `buildPrompt(fmt, vars, undefined, true)` includes the
  force-literal instruction and NOT the auto-detect one; a custom envelope without
  `{idiom_instruction}` is unaffected by the `forceLiteral` flag (still exactly today's output).
- `packages/app/test/app/http-lookup-client.test.ts` or the per-provider client tests (append,
  whichever already covers `runHttpLookup`'s markdown parsing — confirmed via
  `gemini-lookup-client.test.ts`/`openai-lookup-client.test.ts`): a response text starting with
  a `DEFINED_AS: "kick the bucket" | idiom` line yields `result.definedAs = { term: 'kick the
bucket', isIdiom: true }` and `result.markdown` has the line stripped; a response with no such
  line yields `result.definedAs === undefined` and `result.markdown` unchanged (back-compat);
  `req.forceLiteral: true` is threaded into the prompt sent to `deps.fetch` (assert on the
  captured request body).
- `packages/app/test/wire-schema.test.ts` (append): `LookupRequestSchema` accepts
  `forceLiteral: true` and rejects a non-boolean; `LookupResultSchema` accepts a `definedAs`
  object and rejects an unknown key inside it (`strictObject`); an old-shaped result/request
  without either field still parses (back-compat, mirrors the existing provider/fallbackFrom
  test).
- `packages/app/test/workflow.test.ts` (append): a result with `definedAs.isIdiom = true` and
  only 1 configured provider still yields a defined `ctx` carrying `onForceLiteral`; calling it
  re-runs the SAME selection with `req.forceLiteral === true`, bypassing cooldown (same pattern
  as the existing `onSwitchProvider` test); a literal result (or no `definedAs`) with 1 provider
  still yields `ctx === undefined` (existing test must keep passing unmodified — regression
  guard).
- `packages/app/test/ui/lookup-card.test.ts` (append): a result with
  `definedAs: { term: 'kick the bucket', isIdiom: true }` renders `.defined-as__label` with the
  exact text `Defined as "kick the bucket" (idiom)` and a `.defined-as__literal-btn`; clicking
  the button fires a composed `force-literal` event; a result with `isIdiom: false` (or no
  `definedAs`) renders no `.defined-as` row at all.
- `packages/app/test/app/inline-bottom-sheet-renderer.test.ts` (append): `renderResult` with
  `ctx.onForceLiteral` set wires the card's `force-literal` event to it (click → the fake
  callback fires); `r.definedAs` flows into the light DOM (`.defined-as__label` present).
- `packages/extension-chrome/src/side-panel.test.ts` (new, if no existing coverage of
  `resultToFocus`/`applyFocus` — confirmed absent by search) or an append to whichever
  side-panel test module exists: a `LookupResult` carrying `definedAs` produces a
  `PanelFocusState` with **no** `.defined-as` row when rendered via `renderCardState` (regression
  guard locking the deliberate omission in §10).

### E2E tests (`packages/extension-chrome/e2e/idiom-expansion.spec.ts`, new)

Using `mockGemini`'s `onRequest` hook to assert the outbound prompt, and `GEMINI_OK_BODY`-style
fixture responses carrying a `DEFINED_AS` line:

1. **Idiom selection renders the label + button**: seed settings, `gotoFixture` with "He kicked
   the bucket last week.", `mockGemini` returns
   `## kick the bucket\nTo die.` prefixed with `DEFINED_AS: "kick the bucket" | idiom\n\n` →
   select "bucket" → open trigger → assert the card shows `.defined-as__label` text `Defined as
"kick the bucket" (idiom)` and a visible "Show literal word" button.
2. **Prompt carries the idiom instruction**: assert (via `onRequest`) the outbound Gemini request
   body contains `DEFINED_AS:` and `kick the bucket`-style instruction text (i.e., the
   `IDIOM_AUTO_INSTRUCTION` wording), proving the instruction actually reaches the model.
3. **Force-literal button re-runs with the override**: continuing from test 1, click the button →
   `mockGemini`'s second response returns the literal definition (no idiom tag) → assert the
   card updates to the literal definition and the `.defined-as` row disappears (or shows nothing,
   per the literal-hides-row design) → assert `mockGemini`'s call count is 2 and the second
   request's body reflects the force-literal instruction (`onRequest` capturing both calls).
4. **Literal (non-idiom) selection renders no label**: select an ordinary word with a
   `DEFINED_AS: "..." | literal` response → assert no `.defined-as` row renders at all.
5. **Non-compliant response (no DEFINED_AS line) degrades gracefully**: `mockGemini` returns a
   response with no `DEFINED_AS` line at all → assert the card still renders the definition body
   normally, with no `.defined-as` row and no error.

### Evidence (`packages/extension-chrome/e2e/a8-evidence.spec.ts`, new)

A8 shows a new **card label** (largely visual) plus a genuinely new **interactive control** (the
"Show literal word" button that re-runs the lookup and changes the card's content) — per the
Shaman's guidance, a short recorded flow is warranted for the toggle. Follows the exact
`a4-evidence.spec.ts` pattern (`recordVideo`, gated on `PLAYWRIGHT_RUN_EVIDENCE=1`, skipped by
default):

- **Before** (built from `master`): select "bucket" inside "He kicked the bucket last week." →
  the card renders whatever the model happens to return, with **no label, no button** — there is
  nothing in the UI that could show one, because the field doesn't exist yet. This demonstrates
  today's gap: no guarantee, no way to tell which reading you got.
- **After** (built from the branch): same selection → the card shows the idiom label `Defined as
"kick the bucket" (idiom)` and the "Show literal word" button → click it → the card updates to
  show the literal "bucket" definition, label gone. Two mocked Gemini responses (idiom, then
  literal) drive the two states, exactly like `a4-evidence.spec.ts` drives its two command
  relays.

## Risk / rollback

- **Additive only.** One new file (`defined-as.ts`), two new optional fields on existing wire
  types (guarded by the compile-time `AssertEqual` drift check so a mismatch fails
  `bun run typecheck`, not just at runtime), a few new lines across
  `default-template.ts`/`prompt-template.ts`/`http-lookup-client.ts`/`router.ts`/`ports.ts`/
  `workflow.ts`/`lookup-card.ts`/`inline-bottom-sheet-renderer.ts`. No existing exported
  signature's _required_ parameters change (all new parameters are optional, appended last). No
  change to `packages/extension-chrome/**` or `packages/extension-safari/**` at all.
- **Model non-compliance risk** (a provider ignores the `DEFINED_AS:` instruction): handled by
  design — `parseDefinedAs` degrades to "no label," never an error, never a blocked lookup. This
  is the direct consequence of the "no idiom-detection engine" scope fence: correctness of
  _detection_ is fully delegated to the model and cannot be guaranteed by our code, only
  _gracefully absorbed_ when it doesn't happen.
- **Forced-literal cache-write precedent** (§5): a forced-literal answer can overwrite the cached
  "smart" idiom-aware answer for that exact word+context+target, so a subsequent _default_
  lookup of the identical sentence could echo the literal answer until the cache entry ages out
  or is cleared. This mirrors the _already-existing_ identical behavior for provider overrides
  (`req.provider`) in the same function — not a new risk this card introduces, and rollback is
  identical: delete the one guard clause in `router.ts`.
- Rollback = revert the PR's commit range; nothing downstream in the roadmap depends on A8
  (checked `docs/ROADMAP.md`'s dependency map, §5 — A8 has no dependents).
