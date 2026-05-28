# AI Dictionary — Two-Extension BYOK Design

**Date:** 2026-05-24
**Status:** Approved for planning
**Owner:** Todd Lam

---

## 1. Summary

Two browser extensions that let a reader look up word/phrase meaning **without leaving the page**:

- **Chrome (desktop / PC)** — Manifest V3 extension shipped via the Chrome Web Store.
- **Safari iOS** — Safari Web Extension shipped via the App Store, wrapped by an Xcode iOS app target.

Every lookup invokes Google Gemini directly from the browser using a **Bring Your Own Key (BYOK)** Application Programming Interface (API) key that the user pastes in Settings. There is no backend, no account system, and no billing on our side.

The unchanging product workflow:

```
[1] user selects text
   -> [2] extension shows trigger bubble
   -> [3] user clicks trigger
   -> [4] extension calls Gemini (lookup-action)
   -> [5a] result rendered | [5b] error rendered
```

Each platform implements the workflow through the same hexagonal **ports & adapters** structure: a stable, browser-free core defines the workflow and the port interfaces; platform packages and shared User Interface (UI) packages supply concrete adapter implementations.

---

## 2. Goals & Non-Goals

### Goals
- Stay-in-page dictionary lookup on Chrome desktop + Safari iOS.
- BYOK Gemini key, stored locally, never leaves device except in the Gemini fetch call.
- Result card includes (in default template): International Phonetic Alphabet (IPA), Part of Speech (POS), English-to-English learner-style definition first, English-to-Vietnamese (VN) translation second, one example sentence.
- User-editable raw prompt template with placeholder substitution.
- Local cache + viewable history; both purgeable.
- Sentence-scope context always sent to Gemini for disambiguation.
- Hexagonal core that is testable in pure Node with fake ports.

### Non-Goals (explicitly)
- No native iOS app (only a thin Xcode wrapper around the Safari Web Extension).
- No Chrome-on-iOS build (Apple platform restriction makes it the same engine as Safari iOS).
- No macOS Safari Web Extension submission (macOS is dev/build only; not a ship target).
- No backend service on our side; no proxy, no accounts, no billing.
- No telemetry, no analytics, no crash reports.
- No Text-to-Speech (TTS) audio at MVP (IPA text only).
- No multi-language side-by-side translation; single target language at a time.
- No localization of UI strings at MVP (English-only UI).

---

## 3. Constraints (decisions from brainstorming)

| # | Decision | Rationale |
|---|---|---|
| 1 | Trigger: floating button anchored next to selection | Single UX across platforms; simple and discoverable. |
| 2 | Primary result surface: inline `<bottom-sheet>` on BOTH platforms | Chrome `chrome.sidePanel.open()` requires a user-gesture stack that survives content-script -> Service Worker (SW) round-trips; not reliable. Side panel is a **secondary mirror** on Chrome only. |
| 3 | Result content: IPA + POS + Eng->Eng definition + Eng->VN translation + example sentence | Order matters: Eng->Eng first, Eng->VN second. |
| 4 | Target language: configurable in Settings; default Vietnamese (VN) | Per user preference. |
| 5 | Cache + history list | User pays per Gemini call; cache cuts cost. |
| 6 | Code share: monorepo with shared `core` + `shared-ui`, platform-specific extension packages | Future-proof for new platforms. |
| 7 | UI: Vanilla TypeScript (TS) + Web Components | Tiny bundle for content scripts; Shadow Document Object Model (DOM) isolation. |
| 8 | Key storage: `chrome.storage.local` / `browser.storage.local` (per-device) | Maximum privacy; key never syncs to cloud. |
| 9 | Pronunciation: IPA text only; user can override the entire format via custom prompt template | No TTS at MVP. |
| 10 | Format customization: raw prompt template (with placeholders) | Power-user oriented; default template ships. |
| 11 | Context injection: always send the surrounding sentence as `{context}` | Disambiguates polysemous words. |
| 12 | Gemini model: hardcoded `gemini-2.5-flash` | No model picker at MVP. |
| 13 | Architecture: ports & adapters (hexagonal); core is browser-free | Testability and platform extensibility. |

---

## 4. Architecture Overview

### 4.1 Hex map

```
                  [DRIVER ADAPTERS]               [DOMAIN / hex center]                [DRIVEN ADAPTERS]
              (push events into domain)                   core/                       (called by domain)

  DOM selection events  --> dom-selection-source ----> SelectionSource port
  User clicks bubble    --> chrome-floating-trigger -> TriggerUI port
                            safari-floating-trigger

                                            workflow.runLookupWorkflow(deps)

                                                       LookupClient port    --> GeminiLookupClient (HTTP)
                                                                            --> MessageRelayLookupClient (content -> SW)
                                                       SettingsStore port   --> ChromeStorageStore
                                                                            --> SafariStorageStore
                                                                            --> MessageRelaySettingsStore (content)
                                                       Storage port         --> ChromeKvStore
                                                                            --> SafariKvStore
                                                       ResultRenderer port  <-- InlineBottomSheetRenderer (shared)
                                                                            <-- ChromeSidePanelMirror (secondary)
```

### 4.2 Monorepo layout (pnpm workspaces)

```
ai-dictionary/
├── packages/
│   ├── core/                            # DOMAIN. Pure. Zero IO. Zero browser API.
│   │   ├── src/
│   │   │   ├── workflow.ts              # the unchanging orchestrator
│   │   │   ├── ports.ts                 # port interfaces
│   │   │   ├── prompt-template.ts       # pure placeholder substitution
│   │   │   ├── cache-policy.ts          # pure Least Recently Used (LRU) + key derive over Storage port
│   │   │   ├── history-policy.ts        # pure list ops over Storage port
│   │   │   ├── default-template.ts      # default prompt string
│   │   │   ├── wire-schema.ts           # zod schemas for WireMessage / WireReply
│   │   │   └── types.ts                 # LookupRequest, LookupResult, etc.
│   │   └── test/
│   │       ├── fakes/                   # shared fake port impls
│   │       │   ├── fake-selection-source.ts
│   │       │   ├── fake-trigger-ui.ts
│   │       │   ├── fake-result-renderer.ts
│   │       │   ├── fake-lookup-client.ts
│   │       │   ├── fake-settings-store.ts
│   │       │   └── fake-storage.ts
│   │       ├── fixtures/
│   │       │   └── gemini-responses/    # canned bodies (success, errors, malformed)
│   │       ├── workflow.test.ts
│   │       ├── prompt-template.test.ts
│   │       ├── cache-policy.test.ts
│   │       ├── history-policy.test.ts
│   │       └── wire-schema.test.ts
│   │
│   ├── adapters-shared/                 # Platform-free port implementations.
│   │   ├── src/
│   │   │   ├── gemini-lookup-client.ts  # impl LookupClient via global fetch
│   │   │   └── inline-bottom-sheet-renderer.ts  # impl ResultRenderer using <bottom-sheet> + <lookup-card>
│   │   └── test/
│   │       ├── gemini-lookup-client.test.ts
│   │       └── inline-bottom-sheet-renderer.test.ts
│   │
│   ├── shared-ui/                       # Presentational Web Components only.
│   │   ├── src/
│   │   │   ├── lookup-trigger.ts        # <lookup-trigger>
│   │   │   ├── lookup-card.ts           # <lookup-card payload>
│   │   │   ├── bottom-sheet.ts          # <bottom-sheet>
│   │   │   └── settings-form.ts         # <settings-form>
│   │   └── test/
│   │       ├── lookup-trigger.test.ts
│   │       ├── lookup-card.test.ts
│   │       ├── bottom-sheet.test.ts
│   │       └── settings-form.test.ts
│   │
│   ├── extension-chrome/                # Chrome desktop MV3 extension
│   │   ├── src/
│   │   │   ├── sw.ts                    # SW: composes GeminiLookupClient + ChromeStorageStore + ChromeKvStore + router
│   │   │   ├── content.ts               # composition root for content side
│   │   │   ├── side-panel.html / .ts    # secondary mirror surface
│   │   │   ├── options.html / .ts       # Settings page
│   │   │   ├── adapters/
│   │   │   │   ├── dom-selection-source.ts
│   │   │   │   ├── chrome-floating-trigger.ts
│   │   │   │   ├── chrome-side-panel-mirror.ts
│   │   │   │   ├── chrome-storage-store.ts
│   │   │   │   ├── chrome-kv-store.ts
│   │   │   │   ├── message-relay-lookup-client.ts
│   │   │   │   └── message-relay-settings-store.ts
│   │   │   └── manifest.json
│   │   ├── test/
│   │   │   ├── adapters/*.test.ts       # each adapter w/ injected hand-rolled fakes
│   │   │   └── sw-router.test.ts        # buildRouter(deps) tested via fakes
│   │   └── e2e/                         # Playwright; route()-mocked Gemini
│   │       ├── lookup.spec.ts
│   │       ├── settings.spec.ts
│   │       └── fixtures/pages/
│   │
│   └── extension-safari/                # Safari iOS Web Extension + iOS app wrapper
│       ├── src/
│       │   ├── sw.ts
│       │   ├── content.ts
│       │   ├── options.html / .ts
│       │   ├── adapters/
│       │   │   ├── dom-selection-source.ts
│       │   │   ├── safari-floating-trigger.ts
│       │   │   ├── safari-storage-store.ts
│       │   │   ├── safari-kv-store.ts
│       │   │   ├── message-relay-lookup-client.ts
│       │   │   └── message-relay-settings-store.ts
│       │   └── manifest.json
│       ├── test/
│       │   ├── adapters/*.test.ts
│       │   └── sw-router.test.ts
│       ├── e2e/
│       │   └── ios-simulator-checklist.md
│       └── xcode/                       # Xcode wrapper. iOS app target only (App Store). No macOS target.
│
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── package.json                         # engines + packageManager pinned
└── docs/superpowers/specs/              # this file lives here
```

### 4.3 Runtime layers (same conceptual layers on both platforms)

| Layer | Where it runs | DOM access | Owns in this design |
|---|---|---|---|
| Content script | Inside each web page (isolated JS world) | Yes | Selection detection, trigger bubble injection, inline bottom-sheet host. |
| Service Worker (background) | Hidden, per extension | No | API key access, Gemini fetch, cache, history, message router. |
| Extension pages | New tab / side panel / options popup | Yes (own DOM) | Settings page; Chrome side-panel mirror surface. |

### 4.4 Build

esbuild per platform package. Workspace symlinks resolve `core` + `adapters-shared` + `shared-ui`. Output: `packages/extension-chrome/dist/` and `packages/extension-safari/dist/`, both load directly as unpacked extensions; Safari `dist` is then synced into the Xcode wrapper for iOS App Store packaging.

---

## 5. Components & Responsibilities

### 5.1 `core/`

| File | Responsibility | Depends on | I/O |
|---|---|---|---|
| `workflow.ts` | Orchestrate steps [1]–[5]. Uses ports only. | 5 ports (not `Storage`; that one is SW-side). | None directly. |
| `ports.ts` | Interfaces: `SelectionSource`, `TriggerUI`, `ResultRenderer`, `LookupClient`, `SettingsStore`, `Storage`. | — | — |
| `prompt-template.ts` | Render user template with placeholders. | — | Pure. |
| `cache-policy.ts` | Cache key derive (fast non-crypto hash, FNV-1a 64-bit, of `word+context+target`), LRU eviction (cap 1000) over a `Storage` port. | `Storage` port | None. |
| `history-policy.ts` | Append + list (with `limit`/`cursor` paging) + clear over a `Storage` port. Newest-first; cap 500 First-In-First-Out (FIFO). | `Storage` port | None. |
| `default-template.ts` | The default Gemini prompt string. See Appendix A. | — | — |
| `wire-schema.ts` | zod schemas + JSON-schema snapshot exporter for `WireMessage` / `WireReply`. | zod | — |
| `types.ts` | `LookupRequest`, `LookupResult`, `LookupError`, `Settings`, `PublicSettings`, `SelectionEvent`, `AnchorRect`, `HistoryEntry`. | — | — |

### 5.2 Port interfaces (final)

```ts
// core/src/ports.ts

export interface AnchorRect { x: number; y: number; w: number; h: number; }

export interface SelectionEvent {
  text: string;        // selected word/phrase
  sentence: string;    // surrounding sentence; trimmed
  anchor: AnchorRect;
  url: string;
  title: string;
}

export interface SelectionSource {
  onSelection(cb: (e: SelectionEvent) => void): () => void;   // returns teardown
}

export interface TriggerUI {
  show(anchor: AnchorRect, onClick: () => void): void;
  hide(): void;
}

export interface ResultRenderer {
  renderLoading(): void;
  renderResult(r: LookupResult): void;
  renderError(e: LookupError): void;
  close(): void;
}

export interface LookupClient {
  lookup(req: LookupRequest, opts?: { signal?: AbortSignal }): Promise<LookupResult>;
}

// Content-side port: NO apiKey leaks here
export interface PublicSettings {
  targetLang: string;
  promptTemplate: string;
  hasKey: boolean;
}

export interface SettingsStore {
  get(): Promise<PublicSettings>;
  // non-secret, user-editable fields only; hasKey is derived, apiKey is never set via this port
  set(patch: Partial<Pick<PublicSettings, 'targetLang' | 'promptTemplate'>>): Promise<void>;
}

// Generic key-value used by cache + history
export interface Storage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  keys(prefix?: string): Promise<string[]>;
}

// SW/Options-page-only full settings (NOT exposed via SettingsStore port)
export interface Settings extends PublicSettings {
  apiKey: string;
  cacheEnabled: boolean;   // default true; SW skips cache read+write when false
  saveHistory: boolean;    // default true; SW skips history append when false
}
```

### 5.3 `shared-ui/` (Web Components)

| Tag | Responsibility | Events emitted |
|---|---|---|
| `<lookup-trigger>` | Anchored button next to selection. Open Shadow DOM (see shadow-mode note below). | `lookup-click` |
| `<lookup-card payload>` | Renders sanitized Markdown result + loading/error states. | `close`, `expand` |
| `<bottom-sheet>` | Slide-up surface with drag-down close + scrim. Focus trap. ESC closes. | `dismiss` |
| `<settings-form>` | API key (masked) + prompt template (textarea) + target language picker + history list + cache controls. | `save`, `clear-cache`, `clear-history`, `test-connection`, `export-history` |

Styles are loaded via Constructable Stylesheets (`adoptedStyleSheets`) — no inline `<style>` blocks — so the strict Content-Security-Policy (CSP) (`style-src 'self'`) can be enforced.

**Shadow-mode note.** All components use **open** Shadow DOM. Closed mode would hide the root from `@testing-library/dom` and `axe-core`, defeating the §8.1 component/a11y tier (those tools cannot reach into a closed root). Open vs. closed does not change isolation from *page script execution* — the page cannot inject into our root in either mode — it only lets the page *read* our `.shadowRoot`. We render no secrets there (the API key never reaches content scripts, S1), so readability is acceptable; the phishing residual risk (Appendix B) is identical for both modes since a hostile page can mint look-alike elements regardless.

### 5.4 `extension-chrome/`

| Component | Owns |
|---|---|
| `manifest.json` | MV3, content scripts, side panel permission, host permissions, strict CSP. |
| `sw.ts` | Composes `GeminiLookupClient` + `ChromeStorageStore` + `ChromeKvStore('cache')` + `ChromeKvStore('history')`. Hosts the message router. Holds a `Map<requestId, AbortController>` for cancellation. Serializes every `cache:index` / `history:index` read-modify-write through one in-SW write queue so concurrent lookups (all tabs share a single SW) can't clobber each other's index update — `chrome.storage` has no transactions. |
| `content.ts` | Composition root for content side. Wires content adapters and calls `runLookupWorkflow(deps)`. |
| `side-panel.html / .ts` | Hosts `<lookup-card>`. Subscribes to SW push messages when the side panel is open. |
| `options.html / .ts` | Hosts `<settings-form>`. Reads/writes the full `Settings` (including `apiKey`) directly via `chrome.storage.local` — bypasses SW (extension context, same security boundary). |
| `adapters/dom-selection-source.ts` | Watches `selectionchange` + `mouseup` + `touchend`. Emits `SelectionEvent` with sentence boundary detection (`.|!|?`). |
| `adapters/chrome-floating-trigger.ts` | impl `TriggerUI` using `<lookup-trigger>`. Anchors via `getBoundingClientRect()`. |
| `adapters/chrome-side-panel-mirror.ts` | Optional secondary observer of `ResultRenderer` events. Posts state to the side-panel page only when it is open. |
| `adapters/chrome-storage-store.ts` | impl `SettingsStore` over `chrome.storage.local`. Instantiated only in SW + options-page contexts. Always returns `PublicSettings` (apiKey is stripped by the implementation). The SW reads `apiKey` directly via `chrome.storage.local.get('settings')` when calling Gemini — bypassing the port, since the port deliberately excludes the secret. The options page does the same when persisting a new key. Content scripts never instantiate this class; they use `MessageRelaySettingsStore` instead. |
| `adapters/chrome-kv-store.ts` | impl `Storage` over `chrome.storage.local` with a key prefix namespace. |
| `adapters/message-relay-lookup-client.ts` | impl `LookupClient` on the content side: serializes the request, posts to SW with a generated `requestId`, awaits the matching reply. |
| `adapters/message-relay-settings-store.ts` | impl `SettingsStore` on the content side: round-trips `settings.get` to SW; the SW handler strips `apiKey`. |

### 5.5 `extension-safari/`

Mirror of the Chrome extension. Differences:

| Component | Difference from Chrome |
|---|---|
| `manifest.json` | No `sidePanel` permission. Safari-specific `browser_specific_settings` keys. |
| `adapters/safari-floating-trigger.ts` | Today: wraps the same shared `<lookup-trigger>`. Future: swap to a Safari-bespoke component without touching `core/`. |
| `adapters/safari-storage-store.ts`, `safari-kv-store.ts` | Use `browser.storage.local`. |
| `xcode/` | **iOS app target only.** App Store wrapper. Loads `packages/extension-safari/dist/`. |
| No side-panel page | iOS Safari has no sidePanel API. The inline `<bottom-sheet>` is the only surface. |

### 5.6 Composition root example

```ts
// extension-chrome/src/content.ts
import { runLookupWorkflow } from '@ai-dict/core/workflow';
import '@ai-dict/shared-ui/lookup-trigger';
import '@ai-dict/shared-ui/lookup-card';
import '@ai-dict/shared-ui/bottom-sheet';
import { DomSelectionSource } from './adapters/dom-selection-source';
import { ChromeFloatingTrigger } from './adapters/chrome-floating-trigger';
import { InlineBottomSheetRenderer } from '@ai-dict/adapters-shared/inline-bottom-sheet-renderer';
import { MessageRelayLookupClient } from './adapters/message-relay-lookup-client';
import { MessageRelaySettingsStore } from './adapters/message-relay-settings-store';
import { ChromeSidePanelMirror } from './adapters/chrome-side-panel-mirror';

const inline = new InlineBottomSheetRenderer(document.body);
const mirror = new ChromeSidePanelMirror(chrome.runtime);
runLookupWorkflow({
  selection: new DomSelectionSource(document),
  trigger:   new ChromeFloatingTrigger(),
  renderer:  {
    renderLoading()        { inline.renderLoading();   mirror.renderLoading(); },
    renderResult(r)        { inline.renderResult(r);   mirror.renderResult(r); },
    renderError(e)         { inline.renderError(e);    mirror.renderError(e);  },
    close()                { inline.close();           mirror.close();         },
  },
  client:    new MessageRelayLookupClient(chrome.runtime),
  settings:  new MessageRelaySettingsStore(chrome.runtime),
});
```

---

## 6. Data Flow & Wire Contracts

### 6.1 Wire types (final)

```ts
export type WireMessage =
  | { type: 'lookup';         req: LookupRequest; requestId: string }
  | { type: 'lookup.cancel';  requestId: string }
  | { type: 'settings.get' }
  // no `settings.set`: key + settings are written by the options page directly to
  // chrome.storage.local (§5.4, §6.6); nothing is set over the wire.
  | { type: 'history.list';   limit?: number; cursor?: string }
  | { type: 'history.clear' }
  | { type: 'cache.clear' }
  | { type: 'connection.test' };

export type WireReply =
  | { ok: true;  type: 'lookup';   result: LookupResult; requestId: string }
  | { ok: true;  type: 'settings'; settings: PublicSettings }   // apiKey stripped over the wire
  | { ok: true;  type: 'history';  entries: HistoryEntry[]; nextCursor?: string }
  | { ok: true;  type: 'ack' }
  | { ok: false; type: WireMessage['type']; error: LookupError; requestId?: string };

export interface LookupRequest {
  word: string;
  context: string;            // surrounding sentence (always sent)
  url: string;                // only forwarded to Gemini if template uses {url}
  title: string;              // only forwarded to Gemini if template uses {title}
  target: string;             // resolved by content from PublicSettings
  promptTemplate: string;     // resolved by content from PublicSettings
}

export interface LookupResult {
  markdown: string;
  word: string;
  target: string;
  model: 'gemini-2.5-flash';
  fromCache: boolean;
  fetchedAt: number;
}

export interface LookupError {
  code: 'NO_KEY' | 'INVALID_KEY' | 'RATE_LIMIT' | 'NETWORK' | 'PARSE' | 'UNKNOWN';
  message: string;            // sanitized: ≤200 chars, key value scrubbed
  retryable: boolean;
  retryAfterSec?: number;     // populated for RATE_LIMIT
}

export interface HistoryEntry {
  id: string;                 // uuid
  word: string;
  context: string;
  result: LookupResult;
  createdAt: number;
}
```

### 6.2 Storage namespaces

| Key | Shape | Cap |
|---|---|---|
| `settings` | `Settings` JSON (includes apiKey) | 1 |
| `cache:<hash>` | `LookupResult` JSON | 1000 LRU |
| `cache:index` | `{ key, atime }[]` JSON | — |
| `history:<id>` | `HistoryEntry` JSON | 500 FIFO |
| `history:index` | `string[]` newest-first JSON | — |

### 6.3 Flow 1 — Lookup happy path (both platforms; inline surface)

```
user            content.ts                              SW                        Gemini
 |  select       |                                        |                          |
 |--text-------->|                                        |                          |
 |               | DomSelectionSource -> SelectionEvent   |                          |
 |               | trigger.show(anchor, onClick)          |                          |
 |  click bubble |                                        |                          |
 |-------------->|                                        |                          |
 |               | trigger.hide()                         |                          |
 |               | settings.get()  ──msg(settings.get)───>|                          |
 |               | <─────────── reply{publicSettings} ────|                          |
 |               | if (!hasKey) renderError(NO_KEY) + abort                          |
 |               | renderer.renderLoading()               |                          |
 |               |   <bottom-sheet> opens, card=loading   |                          |
 |               | client.lookup(req, {signal})           |                          |
 |               |   ──msg{type:lookup,req,requestId}────>|                          |
 |               |                                        | cache.get(hash)          |
 |               |                                        |   miss                   |
 |               |                                        | settings.get(apiKey)     |
 |               |                                        | prompt = renderTpl(...)  |
 |               |                                        | fetch ──── POST ────────>|
 |               |                                        |<──── 200 + body ─────────|
 |               |                                        | parse -> LookupResult    |
 |               |                                        | cache.put + history.push |
 |               | <─── reply{ok,type:lookup,result,id}───|                          |
 |               | renderer.renderResult(result)          |                          |
 |               |   <lookup-card payload=...> renders    |                          |
```

Two SW round-trips on first lookup per tab (settings.get, lookup). `MessageRelaySettingsStore` caches `PublicSettings` in tab memory and invalidates on `chrome.storage.onChanged` -> subsequent lookups make a single round-trip.

The SW honors the `cacheEnabled` / `saveHistory` toggles (§5.2): when `cacheEnabled` is false it skips both `cache.get` and `cache.put`; when `saveHistory` is false it skips the `history.push`.

### 6.4 Flow 1b — Cache hit

```
content -> SW: msg{type:'lookup', req, requestId}
SW: cache.get(hash) HIT -> result.fromCache = true
SW -> content: reply{ok, type:'lookup', result, requestId}    // skip Gemini, skip history append
content: renderResult                                          // same UI path
```
p50 latency target: <50 ms.

### 6.5 Flow 1c — Chrome side panel mirror (secondary)

```
SW after producing result:
  if (side panel is open for tab):
    chrome.runtime.sendMessage({ to:'side-panel', state:'result', payload })
  else: skip

side-panel.ts (when open) receives push -> mounts/refreshes <lookup-card>.
```
Side panel is never the primary surface. Opened only by the user clicking the toolbar icon (`sidePanel.setPanelBehavior({openPanelOnActionClick:true})`).

### 6.6 Flow 2 — Settings page (extension-page context)

```
options.ts on mount    -> chrome.storage.local.get('settings')         // direct, no SW hop
                       -> hydrate <settings-form>
options.ts on save     -> chrome.storage.local.set({ settings: {...} })
                       -> onChanged fires -> content-script SettingsStores invalidate cache
options.ts on test     -> sendMessage({type:'connection.test'}) -> SW
                       <- {ok}|{ok:false,error}
```

### 6.7 Flow 3 — First-run (no key) short-circuit

```
content workflow:
  settings.get() -> { ..., hasKey: false }
  trigger.hide()
  renderer.renderError({code:'NO_KEY', message:'Set API key in Settings', retryable:false})
  // workflow does NOT send a lookup message
  card error state -> 'Open Settings' CTA -> chrome.runtime.openOptionsPage()
```

### 6.8 Flow 4 — Cancellation (concurrent lookups)

```
user selects "alpha" -> requestId A; SW starts fetch A.
user selects "beta"  -> content sends msg{lookup.cancel, requestId:A}
                       SW aborts fetch A via Map<requestId,AbortController>.
                       content sends msg{lookup, requestId:B}
                       SW starts fetch B.
                       SW -> content: reply for B only; A reply is suppressed.
```

### 6.9 Flow 5 — Error mapping (Gemini -> LookupError.code)

| Cause | code | retryable |
|---|---|---|
| `settings.apiKey === ''` (caught in workflow short-circuit) | `NO_KEY` | false |
| HTTP 400 with `error.status === 'INVALID_ARGUMENT'` (malformed key) | `INVALID_KEY` | false |
| HTTP 401 OR `error.status === 'UNAUTHENTICATED'` | `INVALID_KEY` | false |
| HTTP 403 OR `error.status === 'PERMISSION_DENIED'` | `INVALID_KEY` | false |
| HTTP 429 OR `error.status === 'RESOURCE_EXHAUSTED'` | `RATE_LIMIT` | true (manual) |
| `fetch` throw / TypeError / abort-without-our-cancel | `NETWORK` | true |
| `AbortController` timeout (>20 s) | `NETWORK` | true |
| HTTP 5xx | `NETWORK` | true |
| HTTP 200 but body un-parsable | `PARSE` | false |
| anything else | `UNKNOWN` | false |

### 6.10 Flow 6 — SW message handler pattern

```ts
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;          // defense-in-depth
  router(msg, sender)
    .then(reply => { if (reply !== SUPPRESS) sendResponse(reply); })  // skip our-cancel
    .catch(e => sendResponse({ ok: false, type: msg.type, error: mapError(e) }));
  return true;                                                  // keep channel open
});
```

`router` is exposed by `buildRouter(deps)` in `sw.ts`. Tests inject fake `LookupClient` + `SettingsStore` + `Storage` to exercise the router pure-functionally.

**Cancellation suppression.** When a `lookup.cancel` aborts an in-flight lookup, that lookup's fetch rejects with an `AbortError`. The router owns the `Map<requestId, AbortController>`, so it also tracks which `requestId`s it deliberately aborted: for an our-cancel abort it swallows the `AbortError` and resolves to the `SUPPRESS` sentinel, and the listener skips `sendResponse` (the canceled request's reply channel is never read — the newer request owns the UI). An abort *not* caused by an our-cancel — e.g. the 20 s timeout (§7.3 S11) — still rejects and maps to `NETWORK` per §6.9. Keeping this bookkeeping inside the router (co-located with the `AbortController` Map) keeps the listener generic and unit-testable.

### 6.11 Cache key derive

```ts
// core/src/cache-policy.ts
// Cache key, not a security boundary -> a fast synchronous non-crypto hash keeps `core`
// pure + browser-free (SubtleCrypto's digest() is async) at ~zero bundle cost.
export function deriveCacheKey(req: { word: string; context: string; target: string }): string {
  const norm = `${req.word.trim().toLowerCase()}|${req.context.trim()}|${req.target}`;
  return fnv1a64Hex(norm);    // 16-char (64-bit) hex; 1000-cap LRU -> collision-safe
}
```

---

## 7. Error Handling, Security & Privacy

### 7.1 Error UX (rendered in `<lookup-card>` error state)

| code | UI message | CTA | Retry button |
|---|---|---|---|
| `NO_KEY` | "Add your Gemini API key in Settings." | Open Settings | n/a |
| `INVALID_KEY` | "Google rejected the API key. Check it in Settings." | Open Settings | n/a |
| `RATE_LIMIT` | "Hit Gemini rate limit. Try again in `{retryAfterSec}` s." | — | shows with countdown |
| `NETWORK` | "Network failed. Check connection and retry." | — | shows |
| `PARSE` | "Gemini returned unexpected output. Try a simpler prompt template." | Open Settings | n/a |
| `UNKNOWN` | "Lookup failed: `{sanitized message}`" | — | shows |

### 7.2 Logging (SW)

- `console.warn({ code, keyConfigured: true|false })` on error.
- **Never** logs: key value, key hash, key prefix, selection text, sentence, Gemini request body, Gemini response body, page URL, page title.

### 7.3 Security

**S1 — Key isolation.** API key lives in SW + options page only. Content-side `SettingsStore` adapter receives `PublicSettings` (no `apiKey`). Wire reply for `settings.get` always strips `apiKey`. The key is written **only** by the options page writing `chrome.storage.local` directly (§5.4, §6.6); it never travels over the wire, so there is no `settings.set` key-accept path to guard. All inbound messages remain gated by the `sender.id` check (S3).

**S2 — Key in transit.** Header `X-Goog-Api-Key`. TLS enforced by browser; `connect-src` whitelists only the Gemini origin.

```ts
fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Goog-Api-Key': apiKey,
  },
  body: JSON.stringify(geminiBody),
  signal: abortSignal,
});
```

**S3 — Sender check.** SW listener guards `sender.id === chrome.runtime.id`. No `externally_connectable` declared.

**S4 — Cross-Site Scripting (XSS) on Gemini Markdown.** Gemini output is user-influenced (via custom prompt template). Pipeline: a Markdown renderer with raw HTML disabled (`marked`, or `markdown-it` with `html:false`) -> `DOMPurify` with allowlist (no raw HTML, no scripts, no event handlers, no `javascript:` URLs, no `data:` except `image/*`). Anchors auto-attribute `target="_blank" rel="noopener noreferrer"`; only `https:` schemes allowed.

**S5 — Strict CSP** (`manifest.json`, `extension_pages`):
```
default-src 'none';
script-src 'self';
object-src 'none';
connect-src https://generativelanguage.googleapis.com;
img-src 'self' data:;
style-src 'self';
base-uri 'none';
frame-ancestors 'none';
```
Web Component styles loaded via `adoptedStyleSheets` — no inline `<style>` — so `'unsafe-inline'` is not needed.

**S6 — `host_permissions: <all_urls>`.** Required for selection detection on any page. Justified in store listings. On Safari iOS, the user grants per-site or "all websites" through Safari -> Settings -> Extensions; feature degrades gracefully on un-approved sites (no selection events fire).

**S7 — Bundled dependencies only.** No Content Delivery Network (CDN) imports. Build emits hashed local assets.

**S8 — Final permission lists.**

Chrome `manifest.json`:
```json
"permissions": ["storage", "sidePanel"],
"host_permissions": ["<all_urls>", "https://generativelanguage.googleapis.com/*"]
```

Safari iOS `manifest.json`:
```json
"permissions": ["storage"],
"host_permissions": ["<all_urls>", "https://generativelanguage.googleapis.com/*"]
```

The `"scripting"` API permission is **not** declared because content scripts are statically registered in `content_scripts` and we never use `chrome.scripting.executeScript`.

**S9 — Settings hygiene.** API key is rendered in a `type="password"` input with a reveal toggle. "Clear all data" wipes the entire `storage.local` namespace. Settings copy links to https://aistudio.google.com/apikey for key revocation.

**S10 — Update integrity.** Chrome Web Store + iOS App Store both sign and verify updates. Source repo is public; tagged releases.

**S11 — Fetch hardening.** 20 s hard timeout via `AbortController`. Cancellation via `Map<requestId, AbortController>` in SW. `navigator.onLine === false` short-circuits to `NETWORK` error before fetching.

**S12 — Threat model.** See Appendix B.

### 7.4 Privacy

**P1 — Outbound data flows.** Only outbound: lookup payload to Google Gemini. No backend on our side. No telemetry. No analytics. No crash reports. No accounts.

**P2 — What goes to Gemini (default template).**
- Word/phrase selected
- Surrounding sentence
- Target language code
- API key (user's own, via header)

Page URL and title go to Gemini **only if** the user's custom prompt template references `{url}` / `{title}`. The default template does not.

**P3 — Local-only storage.** API key, cache, history, settings — all `storage.local`. Never synced. Never uploaded.

**P4 — Plain-language disclosure** (Settings page + store listings):
- Reads text you select on web pages.
- Sends the selection + surrounding sentence to Google Gemini using YOUR API key.
- Stores data locally on this device only.
- Does NOT contact any server other than Google Gemini.

**P5 — User controls.**
- "Save history" toggle (default on).
- "Cache lookups" toggle (default on).
- "Export history" -> JSON download (composed client-side by paging `history.list`; no dedicated wire message).
- "Clear cache" / "Clear history" / "Clear all data" buttons.

**P6 — No telemetry.** No toggle. Stated in store listing.

**P7 — Third-party processor.** Privacy notice names Google Gemini and links to https://ai.google.dev/gemini-api/terms.

**P8 — Children.** Not directed at users under 13. Stated in age rating and store listing.

**P9 — Per-device key recommendation.** Settings copy suggests creating a separate API key per device for easier isolation/revocation.

**P10 — Open-source posture.** Repo public; no secrets in repo; example configuration uses `.env.example` placeholders only.

### 7.5 Accessibility

| Surface | Requirement |
|---|---|
| `<lookup-trigger>` | `role="button"`, `aria-label`, keyboard-activatable (Tab + Enter/Space), visible focus ring. |
| `<bottom-sheet>` | `role="dialog"`, `aria-modal="true"`, `aria-labelledby`. Focus trap. ESC closes. Restores focus on close. |
| `<lookup-card>` | Semantic headings (H2/H3, not H1 inside card). `aria-live="polite"` for loading -> result/error transitions. |
| `<settings-form>` | Labels, `aria-describedby` for errors, password input for key. |
| Color contrast | Web Content Accessibility Guidelines (WCAG) 2.1 AA: ≥4.5:1 text, ≥3:1 UI. |
| Reduced motion | Respect `prefers-reduced-motion` for bottom-sheet slide animation. |

### 7.6 Platform minimums

| Platform | Minimum |
|---|---|
| Chrome desktop | 116+ |
| Safari iOS | 16.4+ |

---

## 8. Testing, CI & Release

### 8.1 Test pyramid

| Tier | Scope | Tool | Where | Speed target |
|---|---|---|---|---|
| Unit (pure) | `core/` workflow, policies, prompt-template, error mapper | vitest (Node) | local + CI | <1 s |
| Unit (adapters) | Each adapter with injected hand-rolled fakes (no `sinon-chrome`) | vitest + jsdom | local + CI | <3 s |
| Component | `shared-ui/` Web Components + a11y | vitest + jsdom + `@testing-library/dom` + `axe-core` | local + CI | <5 s |
| Contract | Wire `WireMessage` / `WireReply` schemas | vitest + zod | local + CI | <1 s |
| Wire schema drift | Regenerate `wire-schema.snapshot.json` and diff | custom `pnpm wire:check` | CI | <1 s |
| End-to-End (E2E) Chrome | Real Chrome unpacked, Gemini intercepted via `page.route()` | Playwright | CI (ubuntu) + local | <60 s |
| Manual (Safari iOS) | iOS Simulator on macOS dev box | `extension-safari/e2e/ios-simulator-checklist.md` | Pre-release | n/a |

No automated E2E for Safari (Apple does not expose WebDriver for iOS Safari Web Extensions). Compensated by elevated adapter coverage + the mandatory iOS Simulator checklist on every release.

### 8.2 Coverage gates (CI-enforced)

| Package | Min line coverage |
|---|---|
| `core/` | 90% |
| `adapters-shared/` | 90% |
| `shared-ui/` | 75% |
| `extension-chrome/` (adapters + sw-router) | 80% |
| `extension-safari/` (adapters + sw-router) | 90% (no E2E safety net) |

### 8.3 Hex testing rule (lint-enforced)

ESLint `no-restricted-paths`:
- `core/src/**` MUST NOT import from `adapters-shared/`, `shared-ui/`, or any `extension-*/`.
- `adapters-shared/**` MUST NOT import from `extension-*/`.
- `shared-ui/src/**` MUST NOT import port impls from `core/`; types only.
- `extension-*/test/**` MUST NOT import sibling `adapters/*`. Tests must inject ports via fakes.

Fakes live in `core/test/fakes/` and are re-exported as `@ai-dict/core/test/fakes` for platform packages.

### 8.4 Adapter testing pattern (constructor injection)

Each adapter accepts its browser-API slice via constructor:

```ts
// extension-chrome/src/adapters/chrome-storage-store.ts
type StorageLocalLike = Pick<chrome.storage.StorageArea, 'get' | 'set' | 'remove'>;
export class ChromeStorageStore implements SettingsStore {
  constructor(private storage: StorageLocalLike) {}
  // ...
}

// Boot wiring (sw.ts):
new ChromeStorageStore(chrome.storage.local);

// Test:
new ChromeStorageStore({ get: vi.fn(...), set: vi.fn(...), remove: vi.fn(...) });
```

No `sinon-chrome` dependency. Hand-rolled fakes per test.

### 8.5 Contract tests + wire schema snapshot

`core/src/wire-schema.ts` defines zod schemas for every `WireMessage` and `WireReply` variant. SW + content + options validate inbound messages at the boundary; malformed -> reject with `LookupError{code:'PARSE'}` and `console.warn({ kind: 'wire-schema-mismatch' })`.

`wire-schema.snapshot.json` is generated by `zod-to-json-schema` and committed. CI runs `pnpm wire:check`: regenerate, diff, fail on drift unless updated in the same PR.

### 8.6 Static analysis & hygiene

| Tool | Run |
|---|---|
| TypeScript (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) | pre-commit + CI |
| ESLint (`@typescript-eslint/recommended-type-checked` + hex layering rules) | pre-commit + CI |
| Prettier | pre-commit (format-on-save) |
| `size-limit` (bundle budgets) | CI |
| `gitleaks` (secret scan) | every PR + nightly |
| `pnpm audit --audit-level=high` | CI (informational on PR, blocking nightly) |
| Renovate | scheduled |
| `knip` (unused exports/files) | PR job |

### 8.7 Bundle size budgets (`size-limit`, gzipped)

`content.js` and `side-panel.js` carry the Markdown render + sanitize path (`<lookup-card>` -> Markdown renderer + `DOMPurify`). `DOMPurify` (~16 KB gz) cannot move to the SW (no DOM there), so it is unavoidable content-side. Budgets below assume a light renderer (`marked` ~5 KB gz, or `snarkdown` ~1 KB gz) + `DOMPurify`; keeping `markdown-it` (~30 KB gz) instead means raising `content.js` / `side-panel.js` to ~70 KB / ~65 KB and forfeiting the "tiny content bundle" goal (Constraint 7).

| Bundle | Budget |
|---|---|
| `extension-chrome/dist/content.js` | 45 KB |
| `extension-chrome/dist/sw.js` | 30 KB |
| `extension-chrome/dist/options.js` | 40 KB |
| `extension-chrome/dist/side-panel.js` | 40 KB |
| `extension-safari/dist/content.js` | 45 KB |
| `extension-safari/dist/sw.js` | 30 KB |
| `extension-safari/dist/options.js` | 40 KB |

### 8.8 Repro / pinning

Root `package.json`:
- `"engines": { "node": ">=20.11.0 <21" }`
- `"packageManager": "pnpm@9.x.y"` (exact minor pinned at MVP)

`pnpm-lock.yaml` committed. CI: `pnpm install --frozen-lockfile`.

### 8.9 CI pipeline (`.github/workflows/ci.yml`)

```
jobs:
  install:           # cached pnpm install
  typecheck:         # tsc --noEmit across workspaces
  lint:              # eslint + prettier --check
  test-unit:         # vitest run --coverage (all packages)
  test-component:    # shared-ui jsdom + axe-core
  test-contract:     # wire-schema tests
  wire-schema-check: # regen snapshot + diff
  e2e-chrome:        # Playwright; route()-mocked Gemini
    runs-on: ubuntu-latest
    needs: [install, lint]
  build-chrome:      # produces dist + zip artifact
  build-safari:      # produces dist (web ext code only) on ubuntu; Xcode build deferred to release flow
  size-check:        # size-limit gate
  coverage-gate:     # per-package gates
  secret-scan:       # gitleaks
  dep-audit:         # pnpm audit
```

Failed Playwright runs upload traces + screenshots via `actions/upload-artifact@v4` (7-day retention).

Branch protection: every required job must pass on `main`.

### 8.10 Release flow

**Versioning.** Fixed-version monorepo. Source of truth: root `package.json` `version`. Script `pnpm release:bump <semver>` updates root + both manifests + Xcode `MARKETING_VERSION` (iOS target only).

**Tag-driven release.** Tag `vX.Y.Z` on `main`. `.github/workflows/release.yml`:

```
on: { push: { tags: ["v*"] } }
jobs:
  build-chrome:
    runs-on: ubuntu-latest
    steps: build dist, zip -> dist-chrome.zip, upload as release asset
  build-safari-ios:
    runs-on: macos-latest          # required for Xcode
    steps: build web-ext dist, sync into Xcode project, xcodebuild archive (iOS target only),
           export .ipa, upload as release asset
  github-release:
    needs: [build-chrome, build-safari-ios]
    steps: create GitHub Release with both artifacts + auto-generated notes from CHANGELOG,
           open follow-up issue "Upload to stores"
```

**Store submission (manual at MVP).**
1. Chrome Web Store: drag-drop `dist-chrome.zip`. Future: automate via `chrome-webstore-upload-cli` once OAuth credentials are provisioned.
2. App Store Connect: upload `.ipa` via Transporter or Xcode Organizer. Enters App Review queue.

**Pre-release checklist (`RELEASE_CHECKLIST.md`).**
- [ ] All CI green on the tagged commit.
- [ ] Manual iOS Simulator pass run end-to-end (see checklist file).
- [ ] Privacy disclosures updated if data flows changed.
- [ ] Manifest permissions match §7.3 S8 exactly.
- [ ] CHANGELOG entry written.
- [ ] Default prompt template reviewed — no inadvertent `{url}` / `{title}` inclusion.
- [ ] Bundle sizes within budget (`pnpm size`).
- [ ] `gitleaks` clean.
- [ ] `wire-schema.snapshot.json` matches generated.
- [ ] Manifest `version` + Xcode `MARKETING_VERSION` match Git tag.
- [ ] Store-listing screenshots + copy current.

**iOS Simulator checklist outline** (`extension-safari/e2e/ios-simulator-checklist.md`):
1. Build the Xcode project.
2. Boot iOS Simulator (iPhone 15, iOS 17+).
3. Install host app.
4. Settings -> Safari -> Extensions -> enable AI Dictionary.
5. Grant "Always Allow on Every Website".
6. Open Safari, navigate to a test article.
7. Open extension Settings -> paste a real Gemini key.
8. Select a word -> verify `<lookup-trigger>` appears.
9. Tap trigger -> verify bottom sheet opens with loading state, then result card.
10. Verify cache hit on second identical selection.
11. Trigger error states: clear key, network off -> verify error UX matches §7.1.
12. Tap "Clear all data" -> verify storage wiped.

**Post-release smoke (~5 min, manual).**
- Clean profile install: Chrome desktop + iPhone.
- Set API key, look up "ephemeral" on a Wikipedia page.
- Verify card content + history entry + cache hit on repeat.
- Open Options page, confirm privacy text and links.

### 8.11 Test fixtures

- `core/test/fixtures/gemini-responses/` — canned bodies: success, INVALID_KEY (400 + 403), RATE_LIMIT (429 with and without `Retry-After`), 5xx, malformed JSON, prompt-injection attempt in `markdown`.
- `extension-chrome/e2e/fixtures/pages/` — minimal Playwright targets: simple paragraph, strict-CSP page, page with frames, page with selection inside `<input>`.

### 8.12 Out of scope at MVP

- Firefox, Edge, Brave, Arc validation.
- Mac Catalyst, macOS Safari Web Extension submission.
- Lighthouse / runtime perf budgets (bundle size budgets only).
- Localization of UI strings.
- Visual regression tests.
- Streaming Gemini responses (non-streaming only at MVP; full response payload is small).
- Selecting and looking up content inside `<input>` / `<textarea>` cross-platform (Chrome supported; iOS Safari best-effort).

---

## 9. Appendices

### Appendix A — Default prompt template

```text
You are a bilingual dictionary for {target_lang} learners of English.
Word/phrase: "{word}"
Sentence context: "{context}"

Output Markdown with sections in this exact order:
1. **IPA**
2. **Part of Speech (POS)**
3. **Eng -> Eng** (learner-style definition in simple English)
4. **Eng -> {target_lang}** (translation)
5. **Example** (one short sentence in English + its {target_lang} translation)

Constraints:
- Disambiguate the sense based on the sentence context.
- Do not include any HTML.
- Do not repeat the user's input verbatim more than once.
- Keep the response under 200 words.
```

Placeholders supported by `prompt-template.ts`: `{word}`, `{context}`, `{target_lang}`, `{source_lang}` (default `English`), `{url}`, `{title}`. The renderer substitutes only placeholders that actually appear in the user template (data minimization).

### Appendix B — Threat model

| Threat | Mitigation |
|---|---|
| Hostile webpage reads API key from DOM or content-script memory | Our content code never reads the key (it uses `MessageRelaySettingsStore`, which only ever receives `PublicSettings`); platform world-isolation keeps the page out of content-script memory; storage isolated to the extension origin (§7.3 S1). |
| Hostile webpage injects fake `<lookup-trigger>` / `<lookup-card>` to phish | Web Components mounted in (open) Shadow DOM with extension-origin URL; the page cannot script-inject into our root. A hostile page can still mint look-alike elements regardless of shadow mode — residual risk, documented (see §5.3 shadow-mode note). |
| Gemini response carries XSS payload (prompt-injection by attacker pasting hostile selection) | Markdown sanitized via a raw-HTML-disabled renderer + `DOMPurify` allowlist (§7.3 S4). |
| Network MITM | TLS enforced by browser; `connect-src` restricts to Gemini origin only. |
| Extension supply-chain (malicious update) | Both stores require signed updates. Source repo public + tagged releases. |
| Local-device compromise reading `storage.local` | Out of scope. Settings provides "Clear all data" + a link to revoke the key in Google AI Studio. |

### Appendix C — Glossary

| Term | Meaning |
|---|---|
| API | Application Programming Interface |
| BYOK | Bring Your Own Key — user supplies their own AI provider key |
| CSP | Content Security Policy |
| DOM | Document Object Model |
| E2E | End-to-End test |
| FIFO | First-In-First-Out |
| IPA | International Phonetic Alphabet |
| LRU | Least Recently Used (cache eviction policy) |
| MV3 | Manifest V3 (Chrome extension format) |
| POS | Part of Speech (grammar) |
| SW | Service Worker — background context in MV3 extensions |
| TLS | Transport Layer Security |
| TS | TypeScript |
| TTS | Text-to-Speech |
| UI | User Interface |
| VN | Vietnamese (ISO `vi`) |
| WCAG | Web Content Accessibility Guidelines |
| XSS | Cross-Site Scripting |
