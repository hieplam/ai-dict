# E2E live — testing the real Gemini contract

**Goal (measurable):** the app's most important journey — select word → Define bubble → card →
Gemini → rendered definition — runs against the **real** Gemini API in the e2e suite, and turns
CI red when Gemini's response contract drifts. Proof: the spec fails on a tree with the pre-fix
`\n\n` SSE parser and passes on current `master`.

**Why:** on 2026-08-09 every Gemini lookup in production failed with "Gemini returned unexpected
output." for every user, on every word. Root cause: `gemini-streaming.ts` split the server-sent
events stream on `'\n\n'` while Google delimits frames with `'\r\n\r\n'` (bytes `0d 0a 0d 0a`,
confirmed by hexdumping a live response). 1,054 unit tests and 224 e2e tests were green
throughout, because the unit fixture and all seven e2e mock sites hand-rolled `'\n\n'` framing —
the mocks were written by reading the parser rather than the wire, so they could only ever
confirm the parser agreed with itself. No test in the repo contained any information about the
real wire format. This spec closes that class of gap.

## Concepts

**Contract drift** — a third party changes its response format while our code is unchanged. No
diff to review, no commit to bisect, and every mock-based test stays green because a mock freezes
the _old, now-wrong_ contract. Total failure, not partial: parse breaks → every lookup breaks →
core flow dead → user uninstalls.

**Transport failure** — the third party is momentarily unreachable or refusing: timeout, 5xx,
429 quota. Not our defect, and genuinely intermittent.

The distinction carries the whole design. Contract drift is **deterministic** — the 2026-08-09
bug failed 100/100 lookups and reproduced deterministically on `master` at both the client and
browser layers. So failing hard on contract drift adds **zero** flakiness; all the flakiness risk
lives in transport, which is downgraded to a warning.

## Ratified scope (owner rulings, 2026-08-10)

### 1. No separate CI job

Live specs run inside the existing `e2e-chrome` job, as ordinary Playwright tests. No new
workflow, no new project, no `--grep` filtering.

### 2. Coverage: the primary journey only

One live spec covering the full happy path, exactly as a user performs it: select a word on a
page → Define bubble appears → click it → bottom-sheet card appears → real Gemini call →
definition renders.

Ruled **out of scope** by the owner: OpenAI and Anthropic live specs. Both providers require a
paid API key, which contradicts the product's free criterion and would require CI to carry two
paid keys. Accepted residual risk, recorded deliberately: `openai-lookup-client.ts`
(`choices[0].message.content`) and `anthropic-lookup-client.ts` (`content[type==='text'].text`)
have **no** drift guard. Revisit if either becomes a primary path.

Also out of scope, because mocks give a strictly more deterministic signal and no third party is
involved: HTTP error mapping (401/429/500), cache, cooldown, accessibility, theming, onboarding.

### 3. Assertion ladder

Red (contract drift — blocks the merge, therefore blocks the release):

| #   | Assertion                                                 | Why it is deterministic                               |
| --- | --------------------------------------------------------- | ----------------------------------------------------- |
| 1   | Define bubble visible after selection                     | pure UI, no network                                   |
| 2   | Card visible after clicking the bubble                    | pure UI, no network                                   |
| 3   | `lookup-card h2` equals the selected word                 | headword comes from `req.word`, not model output      |
| 4   | Card contains none of `error-mapper.ts`'s failure strings | this is the assertion that catches the 2026-08-09 bug |
| 5   | Card body longer than ~60 characters                      | separates "rendered content" from "empty card"        |
| 6   | Provider badge reads `Gemini`                             | see below                                             |

Assertion 6 is not cosmetic. `lookup-client-selector.ts` silently falls back to any other
configured provider when the primary fails. Without this assertion, a Gemini contract break on a
machine that also has an OpenAI key would still go green — the fallback would mask exactly the
failure the spec exists to catch.

Warning only (prompt contract — annotation, test still passes):

| #   | Assertion                            | Why not red                                                     |
| --- | ------------------------------------ | --------------------------------------------------------------- |
| 7   | At least one streaming repaint fired | depends on the model still emitting the template's signal lines |
| 8   | Card shows a translation line        | same                                                            |

Assertion 7 is observed through the `data-streaming` attribute `lookup-card` already exposes
(`lookup-card.ts:995`, toggled off the instant a terminal state renders). That attribute is
transient, so observation is **best effort**: not seeing it produces the same warning annotation
as seeing it absent, never a failure. A racy observation must not be able to turn CI red.

`gemini-streaming.ts:186` unlocks the first repaint once `DEFINED_AS:` and `TRANSLATION:` both
parse, or once 400 raw characters accumulate. The default template emits both lines first
(`default-template.ts:43-45,64-65`), so under default settings a repaint does fire — but whether
the model keeps obeying the template is a property of the model, not of our wire handling, so it
warns rather than blocks.

Transport (annotation, test passes): card shows "Network failed. Check connection and retry.",
"Gemini server error. Retry.", or "Hit Gemini rate limit."; or no card appears before timeout.

### 4. Helper pair, mirroring the mock helpers

A live spec reads like a mocked spec with one substitution, so a reader knows from the first line
which world the test is in:

```ts
await useLiveGemini(page); // instead of: await mockGemini(context, {...})
await selectWord(page, 't', 'bank');
await openTrigger(page);
await expectLiveLookup(page, { word: 'bank', provider: 'Gemini' });
```

New file `e2e/helpers-live.ts`:

- `useLiveGemini(page)` — seeds the real key into `chrome.storage` the way a user types it into
  the options page. Skips the test with a warning annotation when `GEMINI_API_KEY` is absent.
- `readLiveOutcome(page)` — reads the card and classifies: `{kind: 'ok'|'transport'|'contract'}`.
- `expectLiveLookup(page, opts)` — applies the ladder above: annotates and returns on transport,
  throws on contract drift.

This is not duplicated logic. `mockGemini` installs network interception; these seed a key and
classify an outcome. The two only mirror each other _as reading experience_, which is the point.

The classification lives in the assertion helper, not the setup helper, because it depends on
what the card ends up showing — a setup-only helper cannot express it.

### 5. Anti-tautology guard: a hard-rule scanner

The largest risk in this design is a **fake live test**: someone copies a mocked spec, renames it,
forgets to remove `mockGemini`, and the suite gains a test named "live" that talks to a mock.
Green, nothing reaches Google, and the repo is back to the exact tautology that caused the
2026-08-09 outage. Documentation cannot prevent this; a scanner can.

- Naming convention: live specs are named `*.live.spec.ts`. Greppable, visible in any file list,
  and creates no separate job.
- New `scripts/hard-rule/check-live-e2e-purity.mjs`: a file matching `*.live.spec.ts` must not
  import `mockGemini`, `mockGeminiStream`, `mockOpenAI`, `mockAnthropic`, or `sseFrame`, and must
  not call `context.route(`.

`scripts/hard-rule/run-all.mjs` discovers `check-*.mjs` by filename, so the scanner is picked up
with no registry edit, and runs in both the pre-commit hook and CI via `bun run lint`.

### 6. Documentation so future prompts configure this correctly

A section in `CLAUDE.md` under the existing "Browser testing" heading — that file is loaded into
context every session, so an assistant asked "this flow needs e2e live" will find the rules:

- Default is mock: fast, deterministic, covers every error branch.
- Use live only for a flow where failure kills the whole app **and** which depends on a third
  party's contract.
- On such a request: name the file `*.live.spec.ts`; use `useLiveGemini` + `expectLiveLookup`;
  import no mock helper; assert structure only, never generated content; red on contract drift,
  warning on transport failure.
- Do not use live for HTTP error mapping, cache, cooldown, accessibility, theming, onboarding.

The transport/contract table and the eight-point ladder go in `docs/testing/` and are linked from
that section, so the decision does not have to be re-argued.

## Prerequisite outside the repo

`GEMINI_API_KEY` must be added as a GitHub Actions secret. Without it the spec skips with a
warning and the goal "every release is known to work" is not met, because CI never actually calls
Gemini. The e2e build must stay key-free: `packages/extension-chrome/e2e/build-guard.ts` rejects
a `dist` built with `GEMINI_API_KEY` in the environment, so the key reaches the extension only
through `useLiveGemini`'s runtime seeding, never through the bundle.

## Acceptance

1. The live spec passes against the real Gemini API on current `master`.
2. The same spec fails — with a **contract** classification, not transport — when run against a
   tree whose SSE delimiter is reverted to `'\n\n'`. This is the regression proof and must be
   demonstrated, not assumed.
3. Classification is proven by unit tests over `readLiveOutcome`'s card-text input, one per row
   of the transport/contract table — cheaper and more deterministic than staging a real outage,
   and it keeps the decision logic pure per `pure-core.md` (the helper reads the card at the edge;
   the classifying function takes text and returns a verdict).
4. `check-live-e2e-purity.mjs` fails on a `*.live.spec.ts` file that imports `mockGemini`.
5. `bun run lint`, `bun run typecheck`, `bun run format:check`, unit suite, and the full e2e suite
   are green.
6. `docs/testing/e2e-case-inventory.md` updated per its own bookkeeping rules.
7. PR body carries a "Testing performed" section.
