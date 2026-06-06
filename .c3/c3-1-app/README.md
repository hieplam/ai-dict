---
id: c3-1
c3-seal: f29eb39c955acd639817232a29a25b7cfb87da86f512a0cddd37d877d541e70d
title: app
type: container
boundary: service
parent: c3-0
goal: 'The portable core of ai-dict: all lookup logic, the message contract, the persistence policies, and the shared UI — written once and bundled verbatim into both the Chrome and Safari extensions.'
---

## Goal

The portable core of ai-dict: all lookup logic, the message contract, the persistence policies, and the shared UI — written once and bundled verbatim into both the Chrome and Safari extensions.

## Components

| ID | Name | Category | Status | Goal Contribution |
| --- | --- | --- | --- | --- |
| c3-101 | domain-types | Foundation | implemented | The shared vocabulary (LookupRequest/Result/Error, Settings) every layer speaks. |
| c3-102 | ports | Foundation | implemented | The six port interfaces that are the only seam between core and platform. |
| c3-103 | wire-protocol | Foundation | implemented | The zod message schema + drift guard for content-script ↔ SW traffic. |
| c3-110 | lookup-workflow | Feature | implemented | Content-side orchestration: selection → trigger → lookup → render. |
| c3-111 | lookup-router | Feature | implemented | SW-side dispatch, cancellation, and cache/history orchestration. |
| c3-112 | persistence-policies | Feature | implemented | KV-backed LRU cache and paginated history over the Storage port. |
| c3-113 | prompt-builder | Feature | implemented | Renders the Gemini prompt from the user template + selection. |
| c3-114 | gemini-client | Feature | implemented | The Gemini HTTP adapter (LookupClient): fetch, timeout, abort, error-map. |
| c3-115 | content-adapters | Feature | implemented | Content-side port adapters: DOM selection, inline renderer, SW relay. |
| c3-116 | markdown-sanitize | Feature | implemented | The single S4 trust boundary turning Gemini markdown into SafeHtml. |
| c3-117 | ui-components | Feature | implemented | The shared shadow-DOM web components (trigger, card, sheet, settings form). |

## Responsibilities

- Own the entire lookup domain: request/response shapes, the workflow, caching, history, prompting, and error mapping — independent of any browser API.
- Declare the platform seam as port interfaces (`ports.ts`) and provide the shared adapters that are themselves platform-agnostic (Gemini HTTP, DOM selection, message relay, sanitizer).
- Provide the in-page UI as framework-free shadow-DOM custom elements.
- Define and validate the wire protocol crossing the `chrome.runtime` boundary, with a compile-time guard against domain/schema drift.
- Stay dependency-free in `domain/`; carry libraries (`zod`, `marked`, `dompurify`) only at the edge (`wire.ts`, `app/`, `ui/`).

## Complexity Assessment

Moderate. The subtlety is not size (~1,660 LOC) but the **runtime split**: the same package runs in two different JS realms — the content script (DOM, no network) runs `lookup-workflow` + `content-adapters` + `ui-components`; the service worker (network, no DOM) runs `lookup-router` + `gemini-client` + `persistence-policies`. They communicate only through the `wire-protocol`. The cancellation/suppression handshake (router ↔ gemini-client `AbortController`) and the S1/S4 security boundaries are the highest-risk areas. `zod` ships in the browser bundle by deliberate tradeoff (README → Known tradeoffs).
