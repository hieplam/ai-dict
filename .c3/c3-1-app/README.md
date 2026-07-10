---
id: c3-1
c3-seal: 3551c7ec32bd5cd91581035f5d6fbf9998dc3b5f7ed27a09fb6bde94036a64e4
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
| c3-101 | domain-types | Foundation | implemented | The shared vocabulary (LookupRequest/Result/Error, Settings, Provider) every layer speaks. |
| c3-102 | ports | Foundation | implemented | The six port interfaces that are the only seam between core and platform. |
| c3-103 | wire-protocol | Foundation | implemented | The zod message schema + drift guard for content-script ↔ SW traffic. |
| c3-110 | lookup-workflow | Feature | implemented | Content-side orchestration: selection → trigger → lookup → render. |
| c3-111 | lookup-router | Feature | implemented | SW-side dispatch, cancellation, and cache/history/saved-word orchestration. |
| c3-112 | persistence-policies | Feature | implemented | KV-backed LRU cache and paginated history over the Storage port. |
| c3-113 | prompt-builder | Feature | implemented | Renders the provider prompt from the user template + selection. |
| c3-114 | lookup-clients | Feature | implemented | The provider HTTP adapters (LookupClient): Gemini + OpenAI clients and the per-call provider selector — fetch, timeout, abort, error-map. |
| c3-115 | content-adapters | Feature | implemented | Content-side port adapters: DOM selection, inline renderer, SW relay. |
| c3-116 | markdown-sanitize | Feature | implemented | The single S4 trust boundary turning model markdown into SafeHtml. |
| c3-117 | ui-components | Feature | implemented | The shared shadow-DOM web components (trigger, card, sheet, settings form incl. provider picker). |
| c3-118 | saved-words-policy | Feature | implemented | KV-backed CRUD for the permanent, independent saved-word vocabulary (B1), keyed by the owner-ratified SavedWordEntry shape. |

## Responsibilities

- Own the entire lookup domain: request/response shapes, the workflow, caching, history, prompting, and error mapping — independent of any browser API.
- Declare the platform seam as port interfaces (`ports.ts`) and provide the shared adapters that are themselves platform-agnostic (Gemini + OpenAI HTTP clients behind a per-call provider selector, DOM selection, message relay, sanitizer).
- Provide the in-page UI as framework-free shadow-DOM custom elements.
- Define and validate the wire protocol crossing the `chrome.runtime` boundary, with a compile-time guard against domain/schema drift.
- Stay dependency-free in `domain/`; carry libraries (`zod`, `marked`, `dompurify`) only at the edge (`wire.ts`, `app/`, `ui/`).

## Complexity Assessment

Moderate. The subtlety is not size (~1,660 LOC) but the **runtime split**: the same package runs in two different JS realms — the content script (DOM, no network) runs `lookup-workflow` + `content-adapters` + `ui-components`; the service worker (network, no DOM) runs `lookup-router` + `lookup-clients` + `persistence-policies`. They communicate only through the `wire-protocol`. The cancellation/suppression handshake (router ↔ lookup-clients `AbortController`) and the S1/S4 security boundaries are the highest-risk areas. `zod` ships in the browser bundle by deliberate tradeoff (README → Known tradeoffs).
