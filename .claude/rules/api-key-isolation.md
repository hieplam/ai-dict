---
paths:
  - 'packages/app/src/wire.ts'
  - 'packages/app/src/ports.ts'
  - 'packages/extension-chrome/src/**/*.ts'
  - 'packages/extension-safari/src/**/*.ts'
---

# api-key-isolation

Security invariant **S1** — the Gemini API key stays in trusted contexts only.
Canonical rule: `.c3/rules/rule-api-key-isolation.md` (a deviation needs an ADR).

## NEVER, NON NEGOTIABLE

- Put `apiKey` on any `chrome.runtime` wire message.
- Let a content script read `chrome.storage.local` settings directly.

## Key handling

- The Gemini API key lives only in the service worker + options page.
- `SettingsStore.get()` returns `PublicSettings` (no `apiKey`); `z.strictObject` strips it on the wire.
