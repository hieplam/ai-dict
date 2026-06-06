---
id: c3-116
c3-seal: 903665ccf5f5499de249e7d3332ea922bd9530185e8498d316fb8346f2e3693e
title: markdown-sanitize
type: component
category: feature
parent: c3-1
goal: Provide the single authorised trust boundary that converts raw model-output markdown into a `SafeHtml` branded string safe for direct insertion into the DOM.
uses:
    - ref-web-components-shadow-dom
    - rule-sanitize-model-output
---

## Goal

Provide the single authorised trust boundary that converts raw model-output markdown into a `SafeHtml` branded string safe for direct insertion into the DOM.

## Parent Fit

| Field | Value |
| --- | --- |
| Parent container | c3-1 (app) |
| Category | Feature |
| Runtime | both |
| Public surface | sanitizeMarkdown(md: string): SafeHtml |
| Implements spec | Spec S4 ("markdown renderer with raw HTML DISABLED") |
| Depends on | marked (Marked instance with preprocess hook), dompurify (DOMPurify singleton with afterSanitizeAttributes hook) |
| Sole cast site | The only as SafeHtml cast in the codebase; no other file may produce a SafeHtml value |

## Purpose

`sanitizeMarkdown` is the one function allowed to produce a `SafeHtml` value. It applies a two-stage pipeline: first a `preprocess` hook on a local `Marked` instance strips all literal HTML from the markdown source before the lexer runs (regex `STRIP_HTML_REGEX` removes paired tags, self-closing tags, and closing-only tags), so no raw-HTML tokens reach the renderer. Marked then converts the cleaned markdown to HTML. DOMPurify runs a second, authoritative pass enforcing `ALLOWED_TAGS` (p, br, strong, em, b, i, code, pre, ul, ol, li, h1–h4, blockquote, a, span), `ALLOWED_ATTR` (href, target, rel), and `ALLOWED_URI_REGEXP` (`/^https:\/\//i`) — blocking `javascript:`, `data:`, `mailto:`, and relative URLs. An `afterSanitizeAttributes` DOMPurify hook (registered once via the `hooked` guard) forces every surviving anchor to `target="_blank" rel="noopener noreferrer"`. The function does NOT parse markdown structure beyond what `marked` provides, does NOT implement its own XSS filter, and does NOT accept pre-rendered HTML as input.

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | DOMPurify must run in a DOM context (content script or extension page); the afterSanitizeAttributes hook is registered at most once per module lifetime via the hooked boolean flag in packages/app/src/app/markdown-sanitize.ts — ensureHook() | rule-sanitize-model-output |
| Input | A raw markdown string emitted by the Gemini model, which may contain adversarial HTML or javascript: links as prompt-injection payloads; entry point is sanitizeMarkdown in packages/app/src/app/markdown-sanitize.ts | c3-114 |
| Internal state | markedNoHtml — a module-level Marked instance with a preprocess hook scoped to this file; hooked — a boolean that prevents double-registration of the DOMPurify hook; both defined in packages/app/src/app/markdown-sanitize.ts | rule-sanitize-model-output |
| Shared dependency | DOMPurify singleton; its afterSanitizeAttributes hook is global to the instance, so the hooked guard is required to avoid duplicate registrations across test reruns; see packages/app/src/app/markdown-sanitize.ts | c3-1 |
| HTTPS-only invariant | ALLOWED_URI_REGEXP = /^https:\/\//i blocks http://, data:, javascript:, and all relative URLs on anchor href attributes; pinned by packages/app/test/app/markdown-sanitize.test.ts — 'strips plain http:// links' | rule-sanitize-model-output |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Primary path | markedNoHtml.parse(md, { async: false }) strips raw HTML via preprocess, converts markdown to HTML synchronously; DOMPurify then enforces the tag/attribute/URI allowlist and returns a plain string cast as SafeHtml; see packages/app/src/app/markdown-sanitize.ts — export function sanitizeMarkdown | rule-sanitize-model-output |
| Outcome — safe markdown | bold and code round-trip to <strong>bold</strong> and <code>code</code> inside wrapping <p> tags; covered by packages/app/test/app/markdown-sanitize.test.ts — 'renders benign markdown to safe HTML' | c3-117 |
| Alternate path — script injection | <script>alert(1)</script> is stripped by the preprocess regex before Marked tokenises the input; DOMPurify provides defence-in-depth; covered by packages/app/test/app/markdown-sanitize.test.ts — 'strips <script> tags and their payload' | rule-sanitize-model-output |
| Alternate path — prompt injection | A model-emitted click link is blocked by ALLOWED_URI_REGEXP; the href is removed entirely; covered by packages/app/test/app/markdown-sanitize.test.ts — 'drops LLM-emitted prompt-injection' | rule-sanitize-model-output |
| Failure — no DOM context | DOMPurify requires a DOM environment; calling sanitizeMarkdown in a bare Node.js context without a DOM polyfill will throw at DOMPurify.sanitize | N.A - this module is only bundled into content-script and extension-page targets which always have a DOM |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| rule-sanitize-model-output | rule | This function IS the enforcement site; all model markdown must pass through it before any DOM insertion | primary | The source comment on the as SafeHtml cast explicitly names this as "the ONE authorised SafeHtml trust boundary (S4)" |
| ref-web-components-shadow-dom | ref | The SafeHtml type produced here is consumed by c3-117 ui-components (LookupCard, InlineBottomSheetRenderer) which insert it into the DOM | supporting | SafeHtml is defined in packages/app/src/ui/lookup-card.ts and imported here via ../ui/index |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| sanitizeMarkdown(md: string): SafeHtml | IN | Accepts a raw markdown string; returns a SafeHtml branded string guaranteed to contain only the ALLOWED_TAGS / ALLOWED_ATTR set with https-only href values and anchors forced to target="_blank" rel="noopener noreferrer" | The as SafeHtml cast on the DOMPurify return value is the one authorised trust boundary; no other file may perform this cast | packages/app/src/app/markdown-sanitize.ts — export function sanitizeMarkdown |
| ALLOWED_TAGS constant | OUT | Enumerates the 19 permitted HTML element names; any element absent from this list is stripped by DOMPurify | Changing this list widens or narrows the rendering surface for model output | packages/app/src/app/markdown-sanitize.ts — const ALLOWED_TAGS |
| ALLOWED_ATTR constant | OUT | Permits only href, target, rel; all other attributes (including event handlers) are stripped | Prevents inline event-handler injection via allowed elements | packages/app/src/app/markdown-sanitize.ts — const ALLOWED_ATTR |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| XSS via relaxed tag/attribute allowlist | Adding an element or attribute to ALLOWED_TAGS / ALLOWED_ATTR | Security-critical test cases for <script>, onerror, javascript:, data: URIs fail | packages/app/test/app/markdown-sanitize.test.ts |
| http:// links pass through | Weakening or removing ALLOWED_URI_REGEXP | 'strips plain http:// links (https-only invariant, S4)' test fails | bun run --filter @ai-dict/app test packages/app/test/app/markdown-sanitize.test.ts |
| Duplicate DOMPurify hook registration | Removing the hooked guard | Anchors receive double target/rel attributes or hook fires twice per sanitize call | packages/app/test/app/markdown-sanitize.test.ts |
| SafeHtml cast escape | Another file importing DOMPurify and casting its output directly | Brand is structurally equivalent to string; only a dedicated grep can catch a second cast site | bun run --filter @ai-dict/app typecheck |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| Unit test suite | Contract | Tests exercise the full allowlist boundary and all prompt-injection patterns documented in spec S4 | packages/app/test/app/markdown-sanitize.test.ts |
| InlineBottomSheetRenderer default sanitizer | Contract | Tests may substitute a stub cast as SafeHtml; production must use the real function | packages/app/src/app/inline-bottom-sheet-renderer.ts — constructor default param |
| SafeHtml brand type | Contract | The type must remain a branded string (string & { readonly __brand: 'SafeHtml' }) so the cast is type-checked | packages/app/src/ui/lookup-card.ts — export type SafeHtml |
