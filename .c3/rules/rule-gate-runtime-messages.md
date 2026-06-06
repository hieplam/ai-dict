---
id: rule-gate-runtime-messages
c3-seal: e1b18ef528a3d4e311b16d7ca21946ab6d7db65bbe0a2430515aa6ed7c17c0da
title: gate-runtime-messages
type: rule
goal: Enforce that the service worker acts only on messages that originate from this extension and conform to the wire schema — closing the door on cross-extension and page-injected traffic.
---

## Goal

Enforce that the service worker acts only on messages that originate from this extension and conform to the wire schema — closing the door on cross-extension and page-injected traffic.

## Rule

Every `chrome.runtime.onMessage` handler gates on `classifyInbound(msg, sender.id, runtimeId)` and acts only when the decision is `accept`.

## Golden Example

Literal from `packages/extension-chrome/src/sw.ts`:

```ts
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // REQUIRED: sender-id + schema gate BEFORE any routing
  const decision = classifyInbound(msg, sender.id, chrome.runtime.id);
  if (decision.action === 'ignore') return false;
  if (decision.action === 'reject') { sendResponse(decision.reply); return true; }
  router(decision.msg)               // only the validated msg reaches the router
    .then((reply) => { if (reply !== SUPPRESS) sendResponse(reply); })
    .catch((e: unknown) => sendResponse({ ok: false, type: decision.msg.type, error: mapError({ kind: 'thrown', error: e }) }));
  return true; // REQUIRED: async sendResponse → keep channel open
});
```

## Not This

| Anti-Pattern | Correct | Why Wrong Here |
| --- | --- | --- |
| router(msg) directly in the listener | Gate via classifyInbound first | Processes unauthenticated / malformed messages (spec S3) |
| Trusting msg.type without a schema parse | Let classifyInbound validate against WireMessageSchema | A page-crafted message could drive the SW |
| Declaring externally_connectable | Omit it; rely on sender.id === runtime.id | Widens the attack surface beyond the extension |

## Scope

The `onMessage` listeners in `packages/extension-chrome/src/sw.ts` and `packages/extension-safari/src/sw.ts`.

## Override

None — security invariant **S3**.
