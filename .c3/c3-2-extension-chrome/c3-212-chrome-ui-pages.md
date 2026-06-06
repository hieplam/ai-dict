---
id: c3-212
c3-seal: 5691ecbf525c655307d280f7a343b9de917d700f82245391ec915ea3ac31fe6f
title: chrome-ui-pages
type: component
category: feature
parent: c3-2
goal: Provide the options page for persisting user settings and the side-panel page for displaying lookup results inside the Chrome extension UI.
uses:
    - ref-wire-protocol-validation
    - rule-api-key-isolation
---

## Goal

Provide the options page for persisting user settings and the side-panel page for displaying lookup results inside the Chrome extension UI.

## Parent Fit

| Field | Value |
| --- | --- |
| Parent container | c3-2 (extension-chrome) |
| Category | Feature |
| Runtime | extension page |
| Public surface | N.A - options.ts and side-panel.ts are entry points; they export no symbols |
| Bundled into | options.js (loaded by options.html), side-panel.js (loaded by side-panel.html) |
| Hosts UI components | <settings-form> (c3-117) on the options page; <lookup-card> (c3-117) on the side panel |
| Depends on | registerSettingsForm, registerContentElements, sanitizeMarkdown, DEFAULT_TEMPLATE, ENV_KEY_NOTICE from @ai-dict/app; chrome.storage.local, chrome.runtime.sendMessage, chrome.runtime.onMessage |

## Purpose

The **options page** (`options.ts` + `options.html`) hosts the `<settings-form>` custom element and is the only trusted context that writes the full `Settings` object — including `apiKey` — directly to `chrome.storage.local` without going through the wire protocol. The `save` event listener merges the form's `SettingsFormValue` with the persisted `Settings` and recomputes `hasKey`. Action events (`clear-cache`, `clear-history`, `test-connection`) are forwarded to the SW via `chrome.runtime.sendMessage`. When the extension was built with `GEMINI_KEY_FROM_ENV`, the form's `keyFromEnv` property is set and a notice banner is inserted. The **side panel** (`side-panel.ts` + `side-panel.html`) hosts `<lookup-card>` and listens for messages forwarded by `ChromeSidePanelMirror` (`c3-201`). It validates the `to: 'side-panel'` field and the `sender.id` before accepting any message, then maps state transitions (`loading` / `result` / `error`) onto the card's `state` property; for `result` payloads it runs `isLookupResult` structural validation followed by `sanitizeMarkdown`. This component does NOT implement any lookup logic, does NOT own settings persistence for read operations (those go through the SW or adapters), and does NOT render inline cards inside the page DOM.

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition — options | <settings-form> custom element must be registered; registerSettingsForm() is called at module top in packages/extension-chrome/src/options.ts line 9 | c3-117 |
| Precondition — side panel | <lookup-card> custom element must be registered; registerContentElements() is called at module top in packages/extension-chrome/src/side-panel.ts line 9 | c3-117 |
| Input — options | SettingsFormValue from the save custom event detail; includes apiKey, targetLang, promptTemplate, cacheEnabled, saveHistory; handled in packages/extension-chrome/src/options.ts lines 53-57 | rule-api-key-isolation |
| Input — side panel | Runtime messages with shape { to: 'side-panel', state, payload } sent by ChromeSidePanelMirror (c3-201) | ref-wire-protocol-validation |
| Build-time input | GEMINI_KEY_FROM_ENV boolean define gates the keyFromEnv banner logic in packages/extension-chrome/src/options.ts line 16 | rule-api-key-isolation |
| Shared storage | chrome.storage.local accessed directly in options.ts (trusted extension page); no relay adapter is involved | rule-api-key-isolation |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome — options | User saves API key and preferences; full Settings written atomically to chrome.storage.local; hasKey derived from Boolean(apiKey) | rule-api-key-isolation |
| Primary path — options | load() reads current Settings → maps to SettingsFormValue → sets form.value; user edits and submits → save event fires → load() re-reads base → merged object written via chrome.storage.local.set; see packages/extension-chrome/src/options.ts lines 33-57 | rule-api-key-isolation |
| Alternate path — env key | GEMINI_KEY_FROM_ENV true → form.keyFromEnv = true + banner inserted; key field locked; stored key ignored at lookup time because SW prefers env key; see packages/extension-chrome/src/options.ts lines 16-23 | rule-api-key-isolation |
| Outcome — side panel | <lookup-card> reflects the latest lookup state (loading spinner, rendered markdown, or error message) in sync with the inline card | c3-117 |
| Primary path — side panel | chrome.runtime.onMessage receives message → sender and to fields validated → card.state updated with { kind, ... }; see packages/extension-chrome/src/side-panel.ts lines 26-48 | ref-wire-protocol-validation |
| Failure — side panel receives malformed result | isLookupResult guard returns false → console.warn logged; card state not updated; no crash; see packages/extension-chrome/src/side-panel.ts lines 36-40 | ref-wire-protocol-validation |
| Failure — options action forwarding | clear-cache, clear-history, test-connection events fire chrome.runtime.sendMessage; errors suppressed via void; see packages/extension-chrome/src/options.ts lines 59-67 | c3-210 |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| rule-api-key-isolation | rule | Options page is the one trusted context allowed to write apiKey directly to storage; no wire relay is involved | Mandatory | side-panel.ts never reads or writes the key; options.ts does not expose it to other contexts |
| c3-117 | example | <settings-form> and <lookup-card> are the UI components hosted by these pages; page scripts drive them via DOM properties and custom events | Informational | Both are registered via registerSettingsForm() / registerContentElements() from @ai-dict/app |
| ref-wire-protocol-validation | ref | Side panel validates sender.id, msg.to, and payload shape before acting on any message | Mandatory | isLookupResult structural guard in packages/extension-chrome/src/side-panel.ts lines 14-22; sender-id check line 29 |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| chrome.storage.local.set({ settings: ... }) in options.ts | OUT | Writes full Settings (including apiKey) directly; merges with current persisted state; sets hasKey = Boolean(apiKey) | Chrome storage boundary (trusted extension page only) | packages/extension-chrome/src/options.ts |
| form (SettingsForm) save event | IN | Carries SettingsFormValue detail; triggers the merge-and-write flow | packages/app SettingsForm custom element | packages/extension-chrome/src/options.ts |
| chrome.runtime.sendMessage for action events | OUT | Forwards { type: 'cache.clear' }, { type: 'history.clear' }, { type: 'connection.test' } to SW | Chrome runtime messaging boundary | packages/extension-chrome/src/options.ts |
| chrome.runtime.onMessage listener in side-panel.ts | IN | Accepts messages with to: 'side-panel' from same extension only; maps state onto card.state | Chrome runtime messaging boundary | packages/extension-chrome/src/side-panel.ts |
| card.state (CardState) | OUT | Set to { kind: 'loading' }, { kind: 'result', safeHtml, word, target }, or { kind: 'error', error } | packages/app LookupCard custom element | packages/extension-chrome/src/side-panel.ts |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| apiKey written over the wire instead of direct storage | Refactoring options page to use a relay adapter | rule-api-key-isolation violated; key exposed in message channel | bun run --filter @ai-dict/extension-chrome typecheck |
| Side panel accepts messages from foreign extensions | Removing sender.id !== chrome.runtime.id check in side-panel.ts | Crafted messages could inject malicious card state | bun run --filter @ai-dict/extension-chrome e2e |
| Malformed result payload passed to sanitizeMarkdown | Removing or weakening isLookupResult guard in side-panel.ts | TypeError crash or XSS risk if markdown is not a string | packages/extension-chrome/test/manifest.test.ts |
| <settings-form> or <lookup-card> not registered | Removing registerSettingsForm() or registerContentElements() call at module top | Custom element is null; querySelector returns null; runtime crash | bun run --filter @ai-dict/extension-chrome test |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| options.js bundle | Business Flow | Build variant may embed GEMINI_KEY_FROM_ENV = true | packages/extension-chrome/src/options.html |
| side-panel.js bundle | Business Flow | N.A - no alternate entry for the side panel page | packages/extension-chrome/src/side-panel.html |
| options.html | Contract | Must include the <settings-form> element or the form query returns null | packages/extension-chrome/src/options.html |
| side-panel.html | Contract | Must include <lookup-card> or the card query returns null | packages/extension-chrome/src/side-panel.html |
