# V3 — code-touching gates: S3, S4, typed-errors (verification-loop campaign, card 3)

**Depends on:** V2 (the `scripts/hard-rule/` folder + runner must exist).

**Goal (measurable):** the two security rules that today rely on convention (S3 gate-runtime-
messages, S4 sanitize-model-output sink side) and the typed-errors wire-flatten invariant each
gain a mechanical gate. Proof: two new scanners in `scripts/hard-rule/` with lock tests, one new
contract test in the wire-schema suite, and the e2e message-flow specs re-run green after the S3
refactor.

## Ratified decisions (owner, 2026-08-02)

### S3 — every runtime-message listener gates via `classifyInbound`

- Refactor the two hand-rolled listener sites — `packages/extension-chrome/src/content.ts`
  (~line 226) and `packages/extension-chrome/src/side-panel.ts` (~line 248), currently
  `if (sender.id !== chrome.runtime.id) return;` — to call `classifyInbound(...)` like `sw.ts`
  does. A thin variant/relaxed signature of `classifyInbound` for non-service-worker contexts is
  acceptable if the current shape doesn't fit; behavior must be preserved (same messages
  accepted/rejected). Check the safari package for equivalent listener sites and treat them the
  same way.
- New scanner `scripts/hard-rule/check-msg-gate.mjs`: every `onMessage.addListener(` occurrence
  must have `classifyInbound(` within the callback's opening lines (pick a small fixed window,
  pin it in the lock test). No alternate idiom is accepted — that is the ratified point.
- **Proof obligation:** this touches security-gating code — the e2e suites covering message flow
  (lookup, keyboard-commands/relay, side-panel) must be re-run and reported green in the PR body.

### S4 — the sink side of sanitize-model-output

- One-time audit of every raw-HTML sink in the repo (`innerHTML =`, `outerHTML =`,
  `insertAdjacentHTML(` — 14 sites at audit time): each either (a) demonstrably renders only
  static/own-template content → annotate the line `// s4: static-template — <reason>`, or
  (b) touches model/remote-derived text → must go through the sanctioned `sanitizeMarkdown()` →
  `SafeHtml` path. If the audit finds a real violation, fixing it is IN scope (that is the rule
  working).
- New scanner `scripts/hard-rule/check-safe-html.mjs`: flags every raw-HTML sink line unless it
  references the sanctioned sanitize path or carries an `// s4:` annotation. Lock test pins both
  accept-paths. (Accepted limit, ratified: a false annotation is a deliberate diff-visible act —
  the scanner defends against accidents, not lies.)

### Typed-errors — the wire-flatten invariant

- New contract test in the existing wire-schema suite (runs in the `test-contract` CI job):
  for every error reply shape the router can produce, round-trip through
  `JSON.stringify`/`JSON.parse` (simulating the `chrome.runtime` wire) and assert `code`,
  `message`, `retryable` survive as enumerable keys. (A raw `Error`'s `message` is
  non-enumerable and would arrive as `{}` — that is the failure this locks out.)
- Ratified framing: the hard-rule registry = the `scripts/hard-rule/` folder PLUS named contract
  tests; this test is the mechanical gate for the flatten half of rule-typed-errors.

## Out of scope

New e2e scenarios (V4), documentation (V5), any change to sanitizer behavior or error taxonomy.

## Acceptance

1. Both scanners in the folder, discovered by the runner, lock tests green.
2. Planted violations (unguarded listener; unannotated innerHTML) fail `bun run lint` — proven
   in lock tests via fixtures.
3. Wire-flatten contract test green; full unit + typecheck + build + e2e green, with message-flow
   e2e explicitly listed in the PR's "Testing performed" section.
4. C3 note: rule entities' enforcement claims change in card V5, not here.
