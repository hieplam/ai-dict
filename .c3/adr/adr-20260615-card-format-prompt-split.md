---
id: adr-20260615-card-format-prompt-split
c3-seal: c6293fd104c7d44dac8fff50bb66620a7b91aac3e60af3f98c9853bd096ea90c
title: card-format-prompt-split
type: adr
goal: |-
    Split the single user-editable `promptTemplate` into a code-owned `PROMPT_ENVELOPE`
    (persona + `{word}` + `{context}` + `{title}` + constraints + one `{output_format}`
    slot) and a small user-editable `outputFormat` (the card's section layout). A new
    domain builder `buildPrompt(outputFormat, vars)` assembles the final prompt; both
    lookup clients call it instead of rendering the raw template. Wire `{title}`
    (already plumbed but dropped) into the envelope, and pass it through a new
    `redactPII` filter so PII patterns (email/phone/credit-card/ssn/ip) in the page
    title are masked with `[redact]` before leaving the device. Rename the field
    `promptTemplate -> outputFormat` across the request/wire/settings path. The
    advanced full-prompt override is intentionally deferred (hidden), tracked by a
    GitHub issue.
status: accepted
date: "2026-06-15"
---

## Goal

Split the single user-editable `promptTemplate` into a code-owned `PROMPT_ENVELOPE`
(persona + `{word}` + `{context}` + `{title}` + constraints + one `{output_format}`
slot) and a small user-editable `outputFormat` (the card's section layout). A new
domain builder `buildPrompt(outputFormat, vars)` assembles the final prompt; both
lookup clients call it instead of rendering the raw template. Wire `{title}`
(already plumbed but dropped) into the envelope, and pass it through a new
`redactPII` filter so PII patterns (email/phone/credit-card/ssn/ip) in the page
title are masked with `[redact]` before leaving the device. Rename the field
`promptTemplate -> outputFormat` across the request/wire/settings path. The
advanced full-prompt override is intentionally deferred (hidden), tracked by a
GitHub issue.

## Context

Today `settings.promptTemplate` is one string bundling persona, `{word}`,
`{context}`, constraints, and the section layout, edited as one raw textarea
(`c3-117` settings-form). Both lookup clients (`c3-114`) call
`renderTemplate(req.promptTemplate, vars)`. Normal users are forced to read
placeholder syntax and can silently delete the safety constraints. Separately,
`{title}` (the page `document.title`, read in `dom-selection-source.ts`, carried
through `SelectionEvent -> LookupRequest`) reaches `renderTemplate`'s vars but is
never referenced by any template, so it is dropped — the same drop-on-render class
of bug that lost `{context}` before #56. Wiring `{title}` improves
disambiguation but sends page titles, which can contain PII, hence the redaction
requirement. Constraint: `default-template.ts`, `prompt-template.ts`, and the new
`pii.ts` sit in the dependency-free domain core (`rule-domain-purity`). The default
`promptTemplate` value is applied at the two extension composition roots
(`c3-2`/`c3-3`: `options.ts`, `sw.ts`, `*-storage-store.ts`). App is young; no
data migration is performed for legacy stored `promptTemplate`.

## Decision

Keep the constraints and persona in code so they cannot be edited away (strengthens
`rule-sanitize-model-output` as defense-in-depth), and expose only the section
layout to users. `buildPrompt` inserts the `outputFormat` string into the envelope
FIRST, then runs `renderTemplate` over the combined string, so a `{target_lang}`
written inside the user's format still resolves (a single `renderTemplate` pass
cannot recurse into a replacement value). PII redaction runs on the title inside
`buildPrompt` so it is guaranteed regardless of caller. Rename
`promptTemplate -> outputFormat` end-to-end (Approach A) rather than keeping a
dormant field (B, leaves dead wire field flagged by knip/C3) or reusing the old
name (C, name lies and legacy full prompts double-wrap the persona). PII detection
is a typed table (`PII_BLACKLIST: PiiRule[]`) of pragmatic regexes favoring low
false-positives over total recall — the right altitude for a title filter.

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-113 | component | Owns default-template.ts + prompt-template.ts; gains PROMPT_ENVELOPE/DEFAULT_OUTPUT_FORMAT/buildPrompt/pii.ts | Confirm files stay import-free; envelope owns constraints + {title} |
| c3-114 | component | Both lookup clients switch from renderTemplate(req.promptTemplate) to buildPrompt(req.outputFormat) | Confirm prompt assembly centralizes in buildPrompt; no key path touched |
| c3-110 | component | workflow.ts maps settings.outputFormat -> request.outputFormat | Confirm domain stays pure; field rename only |
| c3-117 | component | settings-form.ts (+ onboarding-view.ts) relabel field to "Card format", restore DEFAULT_OUTPUT_FORMAT, edit outputFormat | Confirm shadow-DOM markup + no key path touched |
| c3-2 | container | Chrome shell options.ts/sw.ts/chrome-storage-store.ts default + key rename | Confirm composition-root defaults use DEFAULT_OUTPUT_FORMAT |
| c3-3 | container | Safari shell options.ts/sw.ts/safari-storage-store.ts default + key rename | Confirm composition-root defaults use DEFAULT_OUTPUT_FORMAT |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-core-dependency-rule | New/edited domain files (pii.ts, default-template.ts, prompt-template.ts) must stay portable/import-free | comply |
| ref-wire-protocol-validation | wire.ts request + settings schemas rename promptTemplate -> outputFormat; both shells validate against them | comply |
| ref-web-components-shadow-dom | The Card-format field + help text render in c3-117 shadow DOM | comply |
| ref-dependency-injection | Cited by c3-114/c3-110, both edited; the change swaps the prompt-assembly call only and does not alter how adapters are injected into the core | N.A - DI wiring unchanged |
| ref-kv-storage-prefixes | Cited by the shell storage components (c3-201/c3-301); a field is renamed inside the settings object but the kv key/prefix scheme is untouched | N.A - prefix scheme unchanged |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-domain-purity | pii.ts, default-template.ts, prompt-template.ts must keep zero imports / no platform APIs | comply |
| rule-sanitize-model-output | Moving constraints into code-owned envelope hardens (not weakens) output sanitization; the markdown sanitizer (c3-116) stays the real guarantee and is untouched. PII redaction is INPUT-side and complementary | comply (sanitizer intact; envelope constraints + PII redaction are defense-in-depth) |
| rule-api-key-isolation | Cited by c3-114 and c3-117, both edited; changes touch prompt assembly + the Card-format field only — no API-key read/write/render path is altered | N.A - edit does not touch any key-handling code in c3-114/c3-117 |
| rule-gate-runtime-messages | Cited by the shell sw/router components (c3-210/c3-310); runtime-message gating is unchanged — only the settings field name flowing through existing gated messages changes | N.A - message gating unchanged |
| rule-typed-errors | Cited by c3-114/c3-110; error construction/propagation is untouched, only prompt assembly changes | N.A - error handling unchanged |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| PII filter | New packages/app/src/domain/pii.ts: PiiRule, PII_BLACKLIST, redactPII | new file |
| Template split | default-template.ts -> PROMPT_ENVELOPE (with {title}) + DEFAULT_OUTPUT_FORMAT | edited file |
| Builder | prompt-template.ts -> buildPrompt(outputFormat, vars): redact title, insert {output_format}, render | edited file + // TODO(advanced-prompt) marker |
| Rename | types.ts, wire.ts (2), ports.ts, workflow.ts, router.ts: promptTemplate -> outputFormat | edited files |
| Clients | gemini-lookup-client.ts + openai-lookup-client.ts call buildPrompt(req.outputFormat, vars) | edited files |
| UI | settings-form.ts (+ onboarding-view.ts): "Card format" label, help text, restore DEFAULT_OUTPUT_FORMAT, field outputFormat | edited files |
| Shells | chrome+safari options.ts/sw.ts/*-storage-store.ts: default DEFAULT_OUTPUT_FORMAT, key outputFormat | edited files |
| Tests | unit default-template/prompt-template/pii (new); e2e helpers + default-template-context.spec (A-F) + options-actions.spec matcher | test runs |
| Tracking | GitHub issue "Re-introduce advanced full-prompt override (power users)" referenced by code TODO | issue url |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| N.A - no C3 CLI/validator/schema/help changes; this is a code change + a c3-113 doc-body update | c3 write c3-113 --section "Business Flow" to describe envelope/output-format split | c3 check clean |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| pii.test.ts | Asserts each PII type masked to [redact], clean text untouched, table shape | vitest run |
| prompt-template.test.ts (buildPrompt) | Asserts word/context/title injected, constraints survive empty format, title redacted, insert-then-render order | vitest run |
| default-template.test.ts | Pins envelope placeholders incl {title}, constraints present, {url} absent; format free of persona/constraints | vitest run |
| default-template-context.spec.ts | E2E A-F: word+context+title sent, URL withheld, Card format saves, PII title redacted, blank format safe | playwright run |
| wire.ts zod schemas | Reject a request/settings object missing outputFormat | typecheck + contract tests |
| check-dep-direction.mjs | Fails if domain gains a forbidden import | bun run build:chrome |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Keep one promptTemplate blob, just relabel | Does not hide placeholders/constraints; user can still delete safety rules |
| Approach B: dormant promptTemplate + new outputFormat | Leaves an unused wire field that knip/C3 flag as drift |
| Approach C: reuse promptTemplate as the format | Name lies; legacy full prompts double-wrap the persona/constraints |
| Send {title} raw without redaction | Page titles routinely contain PII (invoices, emails, account names) |
| Build advanced full-prompt override now | User deferred it; tracked by GitHub issue + code TODO instead |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Rename misses a call site -> runtime/typecheck break | Single typed rename across types/wire/ports; compiler catches stragglers | bun run typecheck green |
| PII regex false-positive masks benign title text | Pragmatic patterns; year-range/clean-text guard tests | pii.test.ts P7/P8 |
| PII regex misses an exotic PII format | Documented as low-false-positive title filter, not exhaustive PII scrubber; ADR records posture | ADR + spec note |
| Legacy stored promptTemplate ignored surprises a user | App young; no migration by decision; deferred advanced issue covers revisit | tracking issue |
| Empty outputFormat produces a broken/empty prompt | buildPrompt('') still emits persona/word/context/title/constraints | buildPrompt empty-format test + e2e Test F |

## Verification

| Check | Result |
| --- | --- |
| bun run --filter @ai-dict/app test | pass |
| bun run typecheck | pass |
| bun run build:chrome (clean, no GEMINI_API_KEY) | exit 0 |
| cd packages/extension-chrome && bunx playwright test default-template-context.spec.ts options-actions.spec.ts | pass |
| c3 check | clean |
