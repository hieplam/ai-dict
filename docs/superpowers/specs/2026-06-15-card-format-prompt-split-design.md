# Card format: split the user-editable output from the system prompt

Date: 2026-06-15
Status: Approved (Approach A)

## Problem

A definition lookup sends Gemini/OpenAI a single `promptTemplate` string. That
string bundles four concerns the user should never have to think about — the
persona, the `{word}` placeholder, the `{context}` placeholder, and the safety
constraints — with the one concern they actually care about: how the answer card
is laid out. The settings UI exposes the whole thing as one raw textarea, so a
normal user is confronted with placeholder syntax and constraint rules just to
change what the card shows. Worse, a user editing that textarea can silently
delete the "no HTML / disambiguate / keep it short" constraints.

## Decision

Split the single template into two parts:

- **`PROMPT_ENVELOPE`** — a code-owned scaffold living in the domain. It holds the
  persona, `{word}`, `{context}`, the constraints, and exactly one `{output_format}`
  slot.
- **`outputFormat`** — the only user-editable piece. Defaults to the two-section
  bilingual list (`Eng -> Eng`, `Eng -> {target_lang}`).

The final prompt is assembled by a pure domain builder:

```
buildPrompt(outputFormat, vars) =
  renderTemplate(PROMPT_ENVELOPE.replace('{output_format}', outputFormat), vars)
```

The format string is inserted **first**, then placeholders are rendered, so a
`{target_lang}` written inside the user's format still resolves. (A single
`renderTemplate` pass cannot recurse into a replacement value, which is why the
insertion happens before the render, not as a `renderTemplate` variable.)

**Approach chosen: A** — rename the user-facing field `promptTemplate -> outputFormat`
through the request/wire path and have both lookup clients call `buildPrompt`.
Rejected alternatives: (B) keep a dormant `promptTemplate` field alongside
`outputFormat` — leaves a dead wire field that C3/knip flags as drift; (C) reinterpret
the existing `promptTemplate` as the format with no rename — the name would lie and
legacy full prompts would double-wrap the persona.

## Security note

Moving the constraints into `PROMPT_ENVELOPE` means a user can no longer delete the
"do not include any HTML" instruction by editing the prompt. This is
defense-in-depth for `rule-sanitize-model-output`; the markdown sanitizer
(`c3-116`) remains the real guarantee and is untouched.

## Scope of change

- **Domain (`c3-113` prompt-builder):**
  - `default-template.ts` exports `PROMPT_ENVELOPE` and `DEFAULT_OUTPUT_FORMAT`.
  - `prompt-template.ts` gains `buildPrompt(outputFormat, vars)` and treats
    `output_format` as a recognized slot during composition.
- **Request path:**
  - `LookupRequest.promptTemplate -> outputFormat` (`domain/types.ts`).
  - `wire.ts` schemas updated (request + settings).
  - `workflow.ts` maps `settings.outputFormat -> request.outputFormat`.
  - `gemini-lookup-client.ts` and `openai-lookup-client.ts` call `buildPrompt`.
- **Settings / types:**
  - `PublicSettings.promptTemplate -> outputFormat` (`domain/types.ts`).
  - `ports.ts` `set()` patch type updated.
  - Both extension shells default to `DEFAULT_OUTPUT_FORMAT`
    (`options.ts`, `sw.ts`, `*-storage-store.ts`).
- **UI (`c3-117` ui-components):**
  - `settings-form.ts`: relabel "Prompt template" -> **"Card format"** with help
    text explaining word/context/constraints are sent automatically; the textarea
    edits `outputFormat`; "Restore default" restores `DEFAULT_OUTPUT_FORMAT`.
  - `onboarding-view.ts`: same field if present.
  - Raw full-prompt editing is removed from the UI.

## Migration

The app is young, so there is no destructive migration: a legacy stored
`promptTemplate` is simply no longer read, and the default `outputFormat` applies.
This is the deliberately deferred part — see "Deferred work".

## Deferred work (must revisit)

The advanced full-prompt override (power users editing the entire envelope) is
intentionally **not** built in this change. It is hidden, not deleted as a concept.

- GitHub issue #62 tracks re-introduction: _"Re-introduce advanced full-prompt override
  (power users)"_.
- A `// TODO(advanced-prompt): see #62` marker sits next to `buildPrompt` so the
  re-entry point is obvious in code.

## Tests

- **Unit:**
  - `buildPrompt` injects `{word}` + `{context}`, wraps the user format, and always
    emits the constraints even when `outputFormat` is empty.
  - `default-template` exports both `PROMPT_ENVELOPE` and `DEFAULT_OUTPUT_FORMAT`;
    the envelope contains `{word}`, `{context}`, `{output_format}` and the
    no-HTML constraint; it does not contain `{url}`/`{title}`.
- **E2E:**
  - `default-template-context.spec.ts` retargeted — selecting a word still sends the
    word and its surrounding sentence to Gemini.
  - The new "Card format" field round-trips through Save.

## C3 governance

- ADR created before implementation (change op).
- `c3-113` business-flow doc updated to describe envelope + output-format split.
- Compliance: `rule-domain-purity` (default-template + prompt-template stay
  import-free), `rule-sanitize-model-output` (constraints now code-owned, sanitizer
  intact), `ref-core-dependency-rule`.
