---
id: c3-113
c3-seal: 71de702dc44f58b3086a49ecd713ba0b333eed851148cd8fbe0296108d8fcfc0
title: prompt-builder
type: component
category: feature
parent: c3-1
goal: Substitute named placeholders in a prompt template string and ship the default bilingual-dictionary template used when no custom template is configured.
uses:
    - ref-core-dependency-rule
    - rule-domain-purity
---

## Goal

Substitute named placeholders in a prompt template string and ship the default bilingual-dictionary template used when no custom template is configured.

## Parent Fit

| Field | Value |
| --- | --- |
| Parent container | c3-1 (app) |
| Category | Feature |
| Runtime | service worker |
| Public surface | buildPrompt(outputFormat, vars, envelope?): string, renderTemplate(template, vars): string, TemplateVars (prompt-template); PROMPT_ENVELOPE, DEFAULT_OUTPUT_FORMAT (default-template); resolvePromptEnvelope(s), LEGACY_DEFAULT_TEMPLATES (legacy-templates) |
| Bundled into | packages/app/src/domain/prompt-template.ts, packages/app/src/domain/default-template.ts, and packages/app/src/domain/legacy-templates.ts |
| Depends on | No port or external import — pure string transformation |
| Consumed by | c3-114 (lookup-clients) via the shared http-lookup-client, which calls buildPrompt(req.outputFormat, vars, req.promptEnvelope); the shell settings stores (c3-201/c3-301) call resolvePromptEnvelope at read time |

## Purpose

Owns prompt construction. `renderTemplate` replaces only the supported placeholders (`{word}`, `{context}`, `{target_lang}`, `{source_lang}`, `{url}`, `{title}`) in a caller-supplied string, leaving unknown placeholders untouched and defaulting `{source_lang}` to `"English"` when absent. `buildPrompt(outputFormat, vars, envelope?)` assembles the final prompt: a non-blank `envelope` replaces the code-owned `PROMPT_ENVELOPE` (advanced override, #62) and — when it omits `{output_format}` — becomes the complete prompt, restoring a legacy full-prompt user's exact behaviour; the title is routed through `redactPII` either way. `legacy-templates.ts` provides `resolvePromptEnvelope`, a pure read-time resolver that promotes a stored custom `promptTemplate` (differing from every shipped default in `LEGACY_DEFAULT_TEMPLATES`) into the envelope override, so no write migration is needed. `DEFAULT_OUTPUT_FORMAT` is the shipped card layout. This component does NOT validate the template schema, does NOT call any API, and does NOT render any UI.

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | Caller supplies a non-empty template string and a TemplateVars object with at minimum word, context, and target_lang (see packages/app/src/domain/prompt-template.ts) | rule-domain-purity |
| Supported placeholder set | SUPPORTED constant (tuple in packages/app/src/domain/prompt-template.ts): word, context, target_lang, source_lang, url, title — compile-time enumerated | ref-core-dependency-rule |
| Source-lang default | When vars.source_lang is absent, the resolved map (in packages/app/src/domain/prompt-template.ts) substitutes "English" before pattern replacement | c3-1 |
| Unknown placeholder rule | Any {name} not in SUPPORTED is returned verbatim — regex match is preserved (verified in packages/app/test/prompt-template.test.ts) | rule-domain-purity |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Primary outcome | buildPrompt(outputFormat, vars) returns a fully-assembled prompt string ready to send to the AI provider; renderTemplate remains the lower-level substitution primitive (verified in packages/app/test/prompt-template.test.ts) | c3-114 |
| Two-part assembly | The prompt is split into a code-owned PROMPT_ENVELOPE (persona + {word}/{context}/{title} + safety constraints + one {output_format} slot) and a user-editable outputFormat (the card's section layout). buildPrompt inserts outputFormat into the envelope FIRST, then runs renderTemplate over the combined string so a {target_lang} written inside the user's format still resolves (verified in packages/app/test/prompt-template.test.ts) | rule-domain-purity |
| Constraints are non-deletable | Because the constraints live in the envelope (not the user field), an empty outputFormat still emits them — a user cannot strip the safety rules (verified in packages/app/test/prompt-template.test.ts) | rule-sanitize-model-output |
| PII redaction (input side) | buildPrompt passes vars.title through redactPII (packages/app/src/domain/pii.ts) before composing it in, so email/phone/credit-card/ssn/ip patterns in the page title are masked to [redact] before leaving the device (verified in packages/app/test/pii.test.ts and prompt-template.test.ts) | rule-sanitize-model-output |
| Happy path | renderTemplate regex-replaces all {supported_key} occurrences with the corresponding vars value; caller-absent keys preserve the literal placeholder (verified in packages/app/test/prompt-template.test.ts) | rule-domain-purity |
| Data-minimisation path | The envelope references {title} (PII-redacted) but NOT {url}; the page URL is never injected (verified in packages/app/test/default-template.test.ts) | ref-core-dependency-rule |
| Default format structure | DEFAULT_OUTPUT_FORMAT is the shipped card layout: two ordered Markdown sections (Eng -> Eng full explanation, Eng -> {target_lang} full translation), holding only layout — no persona or constraints (verified in packages/app/test/default-template.test.ts) | c3-114 |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| rule-domain-purity | rule | Both files have zero imports; no ports, no platform APIs, no external packages | high | Verified: prompt-template.ts and default-template.ts have no import statements |
| ref-core-dependency-rule | ref | These files sit in packages/app/src/domain/ and import nothing outside that boundary | high | Consistent with the lean dependency rule: inward-only, dependency-free core |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| TemplateVars | IN | Interface: required word, context, target_lang; caller-supplied source_lang, url, title (all defaulted or nullable) | Domain/provider clients | packages/app/src/domain/prompt-template.ts — export interface TemplateVars |
| buildPrompt(outputFormat, vars, envelope?) | OUT | Pure function: assembles the final prompt. A blank/absent envelope uses PROMPT_ENVELOPE; a non-blank envelope replaces it and (when it omits {output_format}) is the complete prompt. Title always routed through redactPII | c3-114 lookup-clients | packages/app/src/domain/prompt-template.ts — export function buildPrompt |
| renderTemplate(template, vars) | OUT | Pure function: returns the template with supported placeholders substituted; unknown placeholders untouched; no side effects | c3-114 lookup-clients | packages/app/src/domain/prompt-template.ts — export function renderTemplate |
| PROMPT_ENVELOPE / DEFAULT_OUTPUT_FORMAT | OUT | Code-owned envelope (persona + {word}/{context}/{title} + constraints + one {output_format} slot) and the shipped card layout; envelope omits {url} by spec | c3-114, settings store defaults | packages/app/src/domain/default-template.ts |
| resolvePromptEnvelope(s) / LEGACY_DEFAULT_TEMPLATES | OUT | Pure read-time resolver: explicit promptEnvelope wins; else a stored custom promptTemplate (differing from every shipped default) becomes the envelope; else '' (built-in). No write migration | c3-201/c3-301 storage stores | packages/app/src/domain/legacy-templates.ts — export function resolvePromptEnvelope |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| {url} or {title} added to DEFAULT_TEMPLATE | Editing default-template.ts to include page-metadata placeholders | Test does NOT reference {url} or {title} fails | bun run --filter @ai-dict/app test packages/app/test/default-template.test.ts |
| Unknown-placeholder leakage | Changing the SUPPORTED tuple or the regex fallback | Test leaves unknown placeholders untouched fails | packages/app/test/prompt-template.test.ts |
| source_lang default removed | Removing the ?? 'English' fallback in renderTemplate | Test defaults {source_lang} to English when not supplied fails | bun run --filter @ai-dict/app test packages/app/test/prompt-template.test.ts |
| TemplateVars interface drift | Adding or removing required fields | TypeScript compile error in c3-114 lookup-clients call sites | bun run --filter @ai-dict/app typecheck |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| Prompt-template unit tests | Contract | Tests use inline string templates; no real Gemini calls | packages/app/test/prompt-template.test.ts |
| Default-template unit tests | Contract | Only structural assertions (contains / not contains) | packages/app/test/default-template.test.ts |
| Gemini client prompt construction | Contract | Gemini client maps LookupRequest fields to TemplateVars before calling renderTemplate | c3-114 |
