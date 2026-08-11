# Live e2e — the verdict table

A live spec (`*.live.spec.ts`) reaches the real provider. Its verdict comes from
`classifyCardText` (`packages/app/src/domain/live-outcome.ts`), which reads the rendered card.
The messages below are not retyped literals — `live-outcome.ts` derives them by calling
`mapError` (`packages/app/src/domain/error-mapper.ts`) directly, so a future wording change to
`error-mapper.ts` updates the classifier automatically instead of silently drifting out of sync.

| Verdict     | Card shows                                                                                                                    | Consequence                                   |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `transport` | `Network failed. Check connection and retry.` / `Gemini server error. Retry.` / `Hit Gemini rate limit.` / card never settles | warning annotation, test **passes**           |
| `setup`     | `Google rejected the API key.` / `Add your Gemini API key in Settings.`                                                       | **fails** — the CI secret is missing or dead  |
| `contract`  | `Gemini returned unexpected output.`, a card under 60 characters, or streaming that never reaches a terminal state            | **fails** — the provider changed its contract |
| `ok`        | a definition past the length threshold, in a terminal (non-streaming) render                                                  | continue to the assertion rungs               |

Transport is matched first, so a network failure can never be misreported as drift.

## Assertion rungs

Red (blocks the merge, therefore the release):

1. Define bubble visible after selection — pure UI
2. Card visible after clicking the bubble — pure UI
3. `lookup-card h2` equals the selected word — headword comes from `req.word`, not model output
4. Card carries none of the failure strings above — the rung that catches contract drift
5. Card body over 60 characters — enforced inside `classifyCardText`, not re-asserted
6. `.prov-badge` reads `Gemini`
7. The card actually reaches a terminal render, not a stuck mid-stream repaint — see below

Rung 8 ("a `TRANSLATION` line rendered") is **not implemented**, on purpose: the live spec drives
the full-card path, where `glossMode` is unset (defaults off, see `helpers.ts`).
`translation-line.ts`'s `parseTranslation` unconditionally strips the raw `TRANSLATION: "..."`
signal line out of the body before it reaches the renderer, and
`inline-bottom-sheet-renderer.ts` only reads the parsed `r.translation` inside the gloss-bubble
branch (guarded by `!cardOpen && glossMode && hasGloss`) — a branch the full-card `'result'`
state this spec exercises never takes. A text search for the literal string `TRANSLATION` on
this code path can therefore never be true regardless of model behavior; asserting it would be a
warning that fires unconditionally on every run, which is worse than no check at all.

## Rung 7: how a stuck stream is told apart from a slow network

`readLiveOutcome` (`packages/extension-chrome/e2e/helpers-live.ts`) cannot settle on text length
alone for the `ok` case. `inline-bottom-sheet-renderer.ts`'s `renderPartial()` repeatedly repaints
`CardState { kind: 'streaming' }` while the model is still talking, and `lookup-card.ts`'s
`renderCardState` only calls `renderMetaRow` — which creates `.prov-badge` — from the terminal
`'result'` branch; the `'streaming'` branch never renders it. A real definition can cross the
60-character threshold well before the stream finishes, so settling on length alone would let
`expectLiveLookup`'s `h2`/`.prov-badge` assertions race the live stream under Playwright's
default ~5s `expect` timeout, not this file's 60s `LIVE_TIMEOUT_MS`.

The fix is the `data-streaming` DOM attribute: it is cleared by the same synchronous call that
produces the terminal DOM (`renderResult`/`renderError` in `inline-bottom-sheet-renderer.ts`), so
its absence is the real "the terminal render ran" signal. `readLiveOutcome` checks it only once
the text is already long enough to matter, and separately tracks whether streaming was ever
observed (`sawStreaming`): if the card starts streaming but the poll still times out with
`data-streaming` stuck `true`, that is reported as `contract` — Gemini answered but rendering
never completed, which is a regression at least as severe as the 2026-08-09 SSE-framing bug and
must not be silently downgraded to a transport warning. Only a card that never even starts
streaming (empty or absent throughout the poll) is reported as `transport`.

## Why rung 6 is red, not cosmetic

`lookup-client-selector.ts` silently falls back to any other configured provider when the primary
fails. Without rung 6, a Gemini contract break on a machine that also holds an OpenAI key would
still pass green — the fallback would mask precisely the failure this spec exists to catch.

## Worked example — the 2026-08-09 outage

Every Gemini lookup in production failed with `Gemini returned unexpected output.` because
`gemini-streaming.ts` split the server-sent-events stream on `'\n\n'` while Google delimits frames
with `'\r\n\r\n'` (bytes `0d 0a 0d 0a`, confirmed by hexdump). 1,054 unit tests and 224 e2e tests
were green throughout: every fixture hand-rolled `'\n\n'` framing copied from the parser, so the
suite could only confirm the parser agreed with itself. No mocked test can catch that class of
failure, which is the entire reason live specs exist.

Regression proof, reproduced on this branch by temporarily reverting the SSE delimiter back to
`/\n\n/` in `gemini-streaming.ts`, rebuilding with `bun run build:chrome:e2e`, and re-running
`lookup-primary-flow.live.spec.ts`: the spec fails with `Gemini CONTRACT DRIFT: Gemini returned
unexpected output.` — a `contract` verdict, not a `transport` warning. Restoring the delimiter and
rebuilding returns the spec to green. See the PR's "Testing performed" section for the verbatim
before/after output.

## What the plan drafted differently from what shipped

Two deliberate deviations from the original plan draft, recorded here so this file never claims
something the code does not do:

- **Rung 7 is implemented**, via the `data-streaming` attribute described above. An earlier draft
  of the helpers considered rung 7 out of scope on the theory that `data-streaming` is always
  cleared by assertion time and so can never be observed — that turned out to be checkable by
  polling the attribute _during_ settlement, before the terminal DOM lands, rather than after.
- **Rung 8 is not a warning — it is entirely unchecked**, for the code-path reason explained
  above, not folded into rung 7 as the draft first proposed.
