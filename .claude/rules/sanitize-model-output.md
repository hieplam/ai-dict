---
paths:
  - 'packages/app/src/ui/**/*.ts'
  - 'packages/app/src/app/markdown-sanitize.ts'
---

# sanitize-model-output

Security invariant **S4** — model output is attacker-influenceable and must never reach the DOM raw.
Canonical rule: `.c3/rules/rule-sanitize-model-output.md`.

## NEVER

- Assign model text to `innerHTML`.
- Cast any other string to `SafeHtml`; call `marked.parse` without DOMPurify.

## Rendering

- Model output reaches the DOM only as `SafeHtml` from `sanitizeMarkdown()`.
- Produce `SafeHtml` only via `sanitizeMarkdown` (the single trust boundary).
