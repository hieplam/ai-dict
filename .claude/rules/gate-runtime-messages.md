---
paths:
  - 'packages/extension-chrome/src/sw.ts'
  - 'packages/extension-safari/src/sw.ts'
---

# gate-runtime-messages

Security invariant **S3** — the service worker acts only on authenticated, schema-valid messages.
Canonical rule: `.c3/rules/rule-gate-runtime-messages.md`.

## NEVER

- Route a message before `classifyInbound` validates it.
- Trust `msg.type` without a schema parse; declare `externally_connectable`.

## Message handling

- Every `chrome.runtime.onMessage` handler gates on `classifyInbound(msg, sender.id, runtimeId)`.
- Act only on an `accept` decision; keep the channel open for async `sendResponse`.
