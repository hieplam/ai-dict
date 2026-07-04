---
id: adr-20260704-advanced-prompt-override-and-viewer
c3-seal: 4a729e6fd0d4d1d4dc7735f8f3aa41dad1d790364dbdf790292bbd600a5f558c
title: advanced-prompt-override-and-viewer
type: adr
goal: |-
    Re-introduce the deferred power-user full-prompt override (issue #62) as an "Advanced"
    disclosure in settings, and add a Konami-gated ("Developer mode") panel in the settings
    form that renders the exact assembled prompt sent to the provider. `buildPrompt` gains an
    optional `envelope` parameter (defaulting to the code-owned `PROMPT_ENVELOPE`); a new
    `promptEnvelope: string` field rides the exact same path as `outputFormat`
    (Settings -> PublicSettings -> LookupRequest -> clients). Legacy stored `promptTemplate`
    values are mapped to the new envelope by a pure read-time function — no write migration.
status: implemented
date: "2026-07-04"
---

## Goal

Re-introduce the deferred power-user full-prompt override (issue #62) as an "Advanced"
disclosure in settings, and add a Konami-gated ("Developer mode") panel in the settings
form that renders the exact assembled prompt sent to the provider. `buildPrompt` gains an
optional `envelope` parameter (defaulting to the code-owned `PROMPT_ENVELOPE`); a new
`promptEnvelope: string` field rides the exact same path as `outputFormat`
(Settings -> PublicSettings -> LookupRequest -> clients). Legacy stored `promptTemplate`
values are mapped to the new envelope by a pure read-time function — no write migration.

## Context

The card-format / prompt-envelope split (`adr-20260615-card-format-prompt-split`) hid raw
prompt editing and left legacy stored `promptTemplate` "currently ignored", explicitly
deferring the advanced override to issue #62. Today `buildPrompt(outputFormat, vars)` always
uses the code-owned `PROMPT_ENVELOPE` and carries a `// TODO(advanced-prompt)` marker. Power
users cannot restore their old full-prompt behavior, and any legacy `promptTemplate` a user
saved (including via the #26 restore-default button, which persisted the then-current default)
is silently dropped. Three distinct historical `DEFAULT_TEMPLATE` strings ever shipped as that
single field. Constraint: the builder, the new legacy resolver, and the envelope live in the
dependency-free domain core (`rule-domain-purity`); the dev panel renders untrusted prompt text
and must never touch `innerHTML` (`rule-sanitize-model-output`); no API key may reach
`PublicSettings` or the panel (`rule-api-key-isolation`).

## Decision

Add an optional third arg to `buildPrompt(outputFormat, vars, envelope?)`: a non-blank
`envelope` replaces `PROMPT_ENVELOPE`; if it omits `{output_format}` it becomes the complete
prompt (restoring legacy behavior verbatim), and the title is still routed through `redactPII`.
`promptEnvelope` mirrors `outputFormat` at every hop; `''` means "use the built-in envelope".
Legacy migration is a pure read-time resolver `resolvePromptEnvelope({promptEnvelope, promptTemplate})`:
an explicit `promptEnvelope` wins; else a legacy `promptTemplate` that differs from every shipped
default (in `LEGACY_DEFAULT_TEMPLATES`) becomes the envelope verbatim; else `''`. Read-time
resolution is idempotent and unit-testable, so no write-once storage migration is needed. The
Konami listener and Developer-mode panel live entirely inside the `settings-form` web component,
reusing the data the `value` getter already owns — no separate dev page.

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-113 | component | buildPrompt gains envelope param; new legacy-templates.ts (resolvePromptEnvelope, LEGACY_DEFAULT_TEMPLATES) | Confirm domain files stay import-free; envelope override still redacts title |
| c3-101 | component | PublicSettings + LookupRequest gain promptEnvelope: string | Confirm field is a plain string; '' = built-in |
| c3-103 | component | wire schemas gain promptEnvelope: z.string(); drift guard stays green | Confirm z.strictObject + AssertEqual guard |
| c3-110 | component | workflow maps settings.promptEnvelope -> request.promptEnvelope | Confirm domain purity; additive mapping |
| c3-111 | component | router connection-test passes promptEnvelope into the client req | Confirm gated-message shape unchanged |
| c3-112 | component | persistence reads resolve legacy promptTemplate at read time | Confirm pure KV policy; no write migration |
| c3-114 | component | all three lookup clients pass req.promptEnvelope into buildPrompt | Confirm no key path touched |
| c3-117 | component | settings-form gains Advanced disclosure + Konami dev panel | Confirm shadow DOM, tokens only, textContent render |
| c3-212 | component | chrome options toFormValue/DEFAULTS carry promptEnvelope | Confirm composition-root default '' |
| c3-312 | component | safari options toFormValue/DEFAULTS carry promptEnvelope | Confirm composition-root default '' |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-core-dependency-rule | New/edited domain files (prompt-template.ts, legacy-templates.ts) must stay import-free | comply |
| ref-wire-protocol-validation | wire.ts settings + request schemas add promptEnvelope; both shells validate against them | comply |
| ref-web-components-shadow-dom | Advanced disclosure + dev panel render in c3-117 shadow DOM | comply |
| ref-dependency-injection | Cited by c3-114/c3-110/c3-111, all edited; the change adds a field to the existing req and does not alter how adapters are injected | N.A - DI wiring unchanged |
| ref-kv-storage-prefixes | Cited by shell storage components; a field is added to the settings object but the kv key/prefix scheme is untouched | N.A - prefix scheme unchanged |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-domain-purity | prompt-template.ts + legacy-templates.ts must keep zero imports / no platform APIs | comply |
| rule-sanitize-model-output | Dev panel renders assembled prompt text; must use textContent into <pre>, never innerHTML | comply |
| rule-api-key-isolation | Cited by c3-114/c3-117, both edited; no key may enter PublicSettings, the envelope path, or the dev panel | comply (no key path touched) |
| rule-gate-runtime-messages | wire schemas stay z.strictObject; the AssertEqual drift guard must stay green after adding the field | comply |
| rule-typed-errors | Cited by c3-114/c3-110; error construction is untouched, only prompt assembly gains a field | N.A - error handling unchanged |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| Builder | prompt-template.ts: buildPrompt(outputFormat, vars, envelope?); remove TODO(advanced-prompt) | edited file + tests |
| Legacy | new legacy-templates.ts: LEGACY_DEFAULT_TEMPLATES (3 historical strings), resolvePromptEnvelope | new file + tests |
| Types/wire | types.ts + wire.ts: promptEnvelope: string on PublicSettings/Settings/LookupRequest + zod | edited files |
| Plumb | workflow.ts, router.ts, three clients, both storage stores, both sw.ts, both options.ts DEFAULTS | edited files |
| UI | settings-form.ts: Advanced <details> textarea + reset; Konami listener + Developer-mode <pre> panel | edited file + UI tests |
| e2e | advanced-prompt.spec.ts: konami unlock, envelope round-trips to provider, envelope persists | playwright run |
| Tests | prompt-template, legacy-templates, wire-schema, three client suites, workflow, router, settings-form UI | vitest run |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| N.A - no C3 CLI/validator/schema/help/template changes; this is code + doc-body updates | c3 write c3-113 to document the envelope override + legacy resolver in the component body | c3 check clean |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| prompt-template.test.ts | Custom envelope replaces default, {output_format} optional, blank falls back, title still redacted | vitest run |
| legacy-templates.test.ts | Explicit envelope wins, custom legacy promoted, shipped default ignored, empty -> '' | vitest run |
| wire-schema.test.ts + AssertEqual guard | PublicSettings/req require promptEnvelope; drift guard stays [true,…] | typecheck + vitest |
| three client suites | Outbound request prompt equals buildPrompt(outputFormat, vars, promptEnvelope) | vitest run |
| settings-form UI suite | Advanced textarea round-trips; Konami unlocks dev panel; input-target keys ignored | vitest run |
| advanced-prompt.spec.ts | E2E konami unlock + custom envelope reaches Gemini body + persists | playwright run |
| check-dep-direction.mjs | Fails if domain gains a forbidden import | bun run build:chrome |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Write-once storage migration of legacy promptTemplate | Read-time pure resolution is idempotent, testable, and needs no migration bookkeeping |
| Separate developer/debug page for the prompt viewer | settings-form already owns the envelope + format data; a new page would duplicate wiring |
| Reuse outputFormat field for the full envelope | Name lies and legacy full prompts would double-wrap the persona/constraints |
| Persist the Konami unlock flag | Dev mode is a session-only reveal; persisting it adds a settings field with no product value |
| Conditional buildPrompt (branch on envelope at each caller) | Task-1 treats '' as default internally, so callers stay uniform and unconditional |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| A shipped default promoted to an override surprises the user | LEGACY_DEFAULT_TEMPLATES holds all 3 historical strings; equal (mod whitespace) -> '' | legacy-templates.test.ts |
| Custom envelope drops the safety constraints | Documented as power-user takeover; title still redacted; sanitizer (c3-116) intact | prompt-template.test.ts + ADR note |
| Konami keys typed in the envelope editor advance the sequence | Ignore events whose target is input/textarea/select; never preventDefault | settings-form UI suite + e2e |
| Dev panel leaks a raw prompt via innerHTML (XSS) | Render via textContent into <pre> only | rule-sanitize-model-output + UI suite |
| Adding a wire field breaks the strict-object drift guard | AssertEqual guard kept green; schema stays z.strictObject | typecheck + wire-schema.test.ts |

## Verification

| Check | Result |
| --- | --- |
| bun run test | pass |
| bun run typecheck | pass |
| bun run lint && bun run format:check | pass |
| bun run build:chrome (clean, no GEMINI_API_KEY) | exit 0 |
| bun run build:safari | exit 0 |
| bun run e2e:chrome | pass |
| c3 check --include-adr | clean |
