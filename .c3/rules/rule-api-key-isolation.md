---
id: rule-api-key-isolation
c3-seal: d34cd467c36ed2cee05ea658dbd151f514b239c0d2e2f8e9c882b6398caaa3b2
title: api-key-isolation
type: rule
goal: Enforce, project-wide, that the secret Gemini API key stays in trusted contexts only — it must never be readable by a content script or a host web page, and must never travel over the message wire.
---

## Goal

Enforce, project-wide, that the secret Gemini API key stays in trusted contexts only — it must never be readable by a content script or a host web page, and must never travel over the message wire.

## Rule

The Gemini API key never crosses the `chrome.runtime` wire and never enters a content script; only the service worker and the options page read or hold it.

## Golden Example

The type split and the schema that mechanically strips the key — literal from `packages/app/src/domain/types.ts` and `packages/app/src/wire.ts`:

```ts
// types.ts — REQUIRED: the key lives only on Settings, never PublicSettings
export interface PublicSettings { targetLang: string; promptTemplate: string; hasKey: boolean; }
export interface Settings extends PublicSettings {
  apiKey: string;        // REQUIRED: secret — trusted contexts only
  cacheEnabled: boolean;
  saveHistory: boolean;
}

// wire.ts — REQUIRED: strictObject rejects an accidental apiKey on the wire
const PublicSettingsSchema = z.strictObject({
  targetLang: z.string(),
  promptTemplate: z.string(),
  hasKey: z.boolean(),
}); // z.strictObject() rejects extra keys (e.g. apiKey) → enforces [S1]
```

`SettingsStore.get()` (`ports.ts`) returns `PublicSettings`, so the content-side adapter structurally cannot receive the key.

## Not This

| Anti-Pattern | Correct | Why Wrong Here |
| --- | --- | --- |
| SettingsStore.get() returns full Settings (with apiKey) | Return PublicSettings; key read only in SW/options via chrome.storage.local | Hands the secret to the content script, which is reachable from the page (spec S1, Appendix B) |
| A wire reply includes apiKey | Strip it; z.strictObject rejects it anyway | The wire is JSON across realms — the key would be observable |
| Content script reads chrome.storage.local.get('settings') | Relay through settings.get → PublicSettings | Bypasses the key boundary |

## Scope

`SettingsStore` implementations, `wire.ts` schemas, and the options/SW code that reads `chrome.storage.local`. Applies to both extensions.

## Override

None — this is security invariant **S1** (`docs/superpowers/specs/2026-05-24-ai-dict-design.md` §7.3). A deviation requires a new ADR amending the threat model.
