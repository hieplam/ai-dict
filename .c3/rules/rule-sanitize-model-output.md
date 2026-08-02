---
id: rule-sanitize-model-output
c3-seal: 3f79a89b3069c38b341f1f99de873aafbb1ecc39c7ec04609b2326309ca270b6
title: sanitize-model-output
type: rule
goal: Enforce that Gemini-generated markdown — which is attacker-influenceable via the selected text and the custom prompt — can never reach the DOM as unsanitized HTML.
---

## Goal

Enforce that Gemini-generated markdown — which is attacker-influenceable via the selected text and the custom prompt — can never reach the DOM as unsanitized HTML.

## Rule

Gemini output reaches the DOM only as `SafeHtml` returned by `sanitizeMarkdown()`; no other code casts a string to `SafeHtml` or assigns model text to `innerHTML`.

## Golden Example

Literal from `packages/app/src/app/markdown-sanitize.ts` — the single trust boundary:

```ts
export function sanitizeMarkdown(md: string): SafeHtml {
  ensureHook();
  // REQUIRED: raw HTML disabled at the source (marked preprocess strips tags)
  const rawHtml = markedNoHtml.parse(md, { async: false });
  // REQUIRED: DOMPurify allowlist — the ONE authorised SafeHtml cast (S4)
  return DOMPurify.sanitize(rawHtml, {
    ALLOWED_TAGS,                   // REQUIRED: no script/style/iframe/event-handlers
    ALLOWED_ATTR,                   // REQUIRED: href/target/rel only
    ALLOWED_URI_REGEXP: HTTPS_ONLY, // REQUIRED: https: links only
  }) as SafeHtml;
}
```

## Not This

| Anti-Pattern | Correct | Why Wrong Here |
| --- | --- | --- |
| el.innerHTML = result.markdown | Render sanitizeMarkdown(result.markdown) into the shadow root | Injects unsanitized model HTML → XSS (spec S4) |
| marked.parse(md) without DOMPurify | Pipe through sanitizeMarkdown | Markdown renderers still emit raw HTML / javascript: URLs |
| someString as SafeHtml elsewhere | Produce SafeHtml only via sanitizeMarkdown | Defeats the single-trust-boundary guarantee |

## Scope

Any code rendering `LookupResult.markdown` (UI cards/sheets, side panel). The `SafeHtml` brand type makes the boundary type-checkable.

## Override

None — security invariant **S4**. New allowed tags/attrs require updating the allowlist *in this file only*, with a threat-model note.

**Enforcement (mechanical — added by `adr-20260803-verification-loop-doc`):**

`scripts/hard-rule/check-safe-html.mjs` flags every raw-HTML sink line (`.innerHTML =`, `.outerHTML =`, `insertAdjacentHTML(`) that carries neither a `// s4: static-template — <reason>` annotation nor a reference to the sanctioned sanitize path (`safeHtml`/`SafeHtml`/`sanitizeMarkdown`). Runs as part of `bun run lint` and before every extension build. Locked by `scripts/hard-rule/check-safe-html.test.ts`. Accepted limit (ratified, spec `2026-08-03-v3-code-touching-gates`): a false annotation is a deliberate diff-visible act — the scanner defends against accidents, not lies.
