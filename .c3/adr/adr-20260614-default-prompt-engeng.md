---
id: adr-20260614-default-prompt-engeng
c3-seal: b83dec0b763aa1568dfadf6c7ce947197aeb126c421febc02303cb072be099ce
title: default-prompt-engeng
type: adr
goal: Replace the shipped `DEFAULT_TEMPLATE` with a context-driven bilingual template that emits exactly two sections (`Eng -> Eng` full explanation, `Eng -> {target_lang}` full translation) and injects `{word}` + `{context}`, and change the target-language picker's second option from Spanish (`es`) to English (`en`). This authorizes a behavior change to the default prompt sent to the model and to the language options offered in both the settings form and onboarding view.
status: proposed
date: "2026-06-14"
---

## Goal

Replace the shipped `DEFAULT_TEMPLATE` with a context-driven bilingual template that emits exactly two sections (`Eng -> Eng` full explanation, `Eng -> {target_lang}` full translation) and injects `{word}` + `{context}`, and change the target-language picker's second option from Spanish (`es`) to English (`en`). This authorizes a behavior change to the default prompt sent to the model and to the language options offered in both the settings form and onboarding view.

## Context

The current default template (introduced in #53) talks about context but contains no `{context}` placeholder and no real `{word}` lookup target, so the extracted sentence is dropped before the model sees it — verified end-to-end against the live Gemini API (default template returned the financial-bank sense for a river-bank selection). The prompt-builder component `c3-113` owns `default-template.ts`; the language dropdown lives in `c3-117` ui-components (`settings-form.ts`, `onboarding-view.ts`). Constraint: `default-template.ts` must stay import-free (domain purity); dropdown markup renders inside shadow DOM. Several tests pin the old `Sense selection` substring and the `es` option value.

## Decision

Adopt the user-supplied template verbatim in structure, with the Vietnamese parenthetical instructions rewritten in English (the rest of the template is already English; keeping one language avoids mixed-language guidance). Re-inject `{word}` and `{context}` so the disambiguation the workflow already extracts actually reaches the model. Replace the `es`/Spanish option with `en`/English rather than adding a third option, because the request was explicitly to change Spanish to English. Keep `{url}`/`{title}` out of the template (data-minimization, unchanged).

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-113 | component | Owns default-template.ts; the template string is rewritten | Confirm file stays import-free and exports DEFAULT_TEMPLATE |
| c3-117 | component | Owns settings-form.ts + onboarding-view.ts dropdowns; option es→en | Confirm shadow-DOM markup + value plumbing unchanged otherwise |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-core-dependency-rule | default-template.ts sits in the dependency-free domain core | comply |
| ref-web-components-shadow-dom | Dropdown options live in shadow-DOM-rendered components | comply |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-domain-purity | default-template.ts must keep zero imports / no platform APIs | comply |
| rule-sanitize-model-output | The new template changes the model's output shape and adds a "no HTML" instruction; we must confirm the markdown sanitizer (c3-116) still runs and is not weakened by relying on the prompt instruction alone | comply (sanitizer left intact; prompt instruction is defense-in-depth only) |
| rule-api-key-isolation | Cited by c3-117, which this ADR edits; the changed lines are only the target-language <option> markup — no API-key read/write/render path is touched | N.A - edit does not touch any key-handling code in c3-117 |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| Default template | Rewrite packages/app/src/domain/default-template.ts to the new 2-section bilingual format with {word}/{context}/{target_lang} | new file content |
| Settings dropdown | packages/app/src/ui/settings-form.ts option es/Spanish → en/English | edited line 107 |
| Onboarding dropdown | packages/app/src/ui/onboarding-view.ts option es/Spanish → en/English | edited line 95 |
| Unit test (template) | packages/app/test/default-template.test.ts substring Sense selection → bilingual dictionary | edited assertion |
| Unit tests (lang) | onboarding-view.test.ts + settings-form.test.ts es → en | edited assertions |
| E2E snapshot | packages/extension-chrome/e2e/options-actions.spec.ts /Sense selection/ → /bilingual dictionary/ | edited matcher |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| N.A - no C3 CLI/validator/schema/help changes; this is a code-only behavior change | N.A | N.A |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| default-template.test.ts | Pins required placeholders + a stable substring, forbids {url}/{title} | vitest run |
| options-actions.spec.ts | Asserts Restore-default repopulates the new template | playwright run |
| check-dep-direction.mjs (build/lint) | Fails if domain gains a forbidden import | bun run build:chrome |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Keep the #53 sense-aware template | It drops {context}; user explicitly supplied a replacement |
| Add English as a third option, keep Spanish | User explicitly asked to change Spanish to English, not append |
| Keep Vietnamese parenthetical instructions | User explicitly asked to convert all Vietnamese instructions to English |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Tests pinned to old substring/es value fail | Update all pinned assertions in the same change | bun run test green |
| Existing users with stored targetLang: 'es' have no matching option | Stored value persists until they re-save; only the picker label set changes — acceptable, no data migration needed | manual note; dropdown falls back to first option visually |

## Verification

| Check | Result |
| --- | --- |
| bun run --filter @ai-dict/app test | pass |
| bun run typecheck | pass |
| bun run build:chrome | exit 0 |
| cd packages/extension-chrome && bunx playwright test options-actions.spec.ts | pass |
