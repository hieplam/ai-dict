# E2E Case Inventory — Chrome extension

The denominator for the e2e coverage goal. Every user-facing case the extension can hit, marked
`[covered]` (with the spec that proves it) or `[gap:P1|P2|P3]`. The coverage metric is read
mechanically from this file — never assert it in prose:

```sh
# covered / (covered + gaps) — count table rows only (status cell), not prose
grep -c '| \[covered\]' docs/testing/e2e-case-inventory.md
grep -c '| \[gap:'     docs/testing/e2e-case-inventory.md
grep -c '| \[gap:P1\]' docs/testing/e2e-case-inventory.md
```

**Baseline (2026-07-16): 99 covered / 128 total = 77.3%.** Gaps: 10 P1, 14 P2, 5 P3.

**Frozen target (owner ruling 2026-07-16): coverage ≥ 80%** — reached at 103/128 (80.5%), i.e.
closing at least 4 gaps, P1 first in ranked order. Walls in force: zero flaky tests (3
consecutive green full-suite runs), no weakening (0 disabled functional tests; assertion count
≥ 279), and integrity (the denominator is frozen — removing/demoting a case needs owner
sign-off).

Rules of the file:

- The inventory is **frozen** once the goal's target is set. Adding cases is fine (the world
  grew); **removing or demoting a case requires owner sign-off** — hitting the target by
  shrinking the denominator is a bypass, not a win.
- A case flips to `[covered]` only when a merged spec exercises it end-to-end through the real
  harness (`packages/extension-chrome/e2e/`), not when a unit test approximates it.
- **P1** = core correctness or security paths users will hit. **P2** = real user behaviors whose
  current behavior is _unknown_ — each starts as a probe (observe what actually happens), then
  becomes a test asserting it or a bug fix. **P3** = unit-proven already; e2e adds little.
- Env-gated media/evidence recorder specs (`PLAYWRIGHT_RUN_*`) are asset tooling, not coverage,
  and are excluded from both sides of the metric.

## A. Selection & trigger (in-page)

| Case                                                               | Status                              |
| ------------------------------------------------------------------ | ----------------------------------- |
| Collapsed selection shows no trigger                               | [covered] `selection.spec.ts`       |
| Multi-word phrase selection shows trigger and renders a result     | [covered] `selection.spec.ts`       |
| Dismiss then re-select shows the trigger again                     | [covered] `selection.spec.ts`       |
| Define click works under hostile z-index stacking contexts         | [covered] `define-fix-demo.spec.ts` |
| Selection inside `<textarea>` / `<input>` — behavior unknown       | [gap:P2]                            |
| Selection inside `contenteditable` — behavior unknown              | [gap:P2]                            |
| Selection inside an iframe — behavior unknown                      | [gap:P2]                            |
| CJK / diacritics / non-Latin word round-trips correctly            | [gap:P2]                            |
| Very long (paragraph-length) selection — trigger + prompt behavior | [gap:P2]                            |
| Trigger position after page scroll / window resize                 | [gap:P2]                            |

## B. Lookup core flow

| Case                                                            | Status                                |
| --------------------------------------------------------------- | ------------------------------------- |
| Cache hit renders without a network call                        | [covered] `lookup.spec.ts`            |
| Cache miss calls the provider and renders the result            | [covered] `lookup.spec.ts`            |
| Repeat lookup of the same word served from cache                | [covered] `lookup.spec.ts`            |
| Cooldown: rapid second Define within 2s blocked, no extra call  | [covered] `cooldown.spec.ts`          |
| Context disambiguation: same word, two sentences, two senses    | [covered] `context-bank-demo.spec.ts` |
| New selection while a lookup is in-flight (abort / ordering)    | [gap:P1]                              |
| Dismiss the card while a lookup is pending — no orphaned render | [gap:P1]                              |
| In-page card loading state (before result arrives)              | [gap:P2]                              |

## C. Providers

| Case                                                           | Status                                 |
| -------------------------------------------------------------- | -------------------------------------- |
| Default provider is Gemini; badge names the answering provider | [covered] `provider-fallback.spec.ts`  |
| Switching to ChatGPT persists provider + OpenAI key            | [covered] `provider-selection.spec.ts` |
| OpenAI lookup hits the OpenAI endpoint, not Gemini             | [covered] `provider-selection.spec.ts` |
| Legacy settings (pre-provider field) still look up via Gemini  | [covered] `provider-selection.spec.ts` |
| Any-failure fallback: Gemini 500 → Claude answers, with note   | [covered] `provider-fallback.spec.ts`  |
| One-shot picker switch re-runs the lookup on the new provider  | [covered] `provider-fallback.spec.ts`  |
| Claude/Anthropic as the _primary_ provider, end to end         | [gap:P1]                               |
| Fallback exhaustion: primary AND fallback fail → clean error   | [gap:P1]                               |
| Fallback path when no fallback key is configured               | [gap:P1]                               |

## D. Error paths (in-page card)

| Case                                                                 | Status                            |
| -------------------------------------------------------------------- | --------------------------------- |
| Offline / aborted → "Network failed. Check connection and retry."    | [covered] `lookup-errors.spec.ts` |
| HTTP 401 → "Google rejected the API key."                            | [covered] `lookup-errors.spec.ts` |
| HTTP 400 INVALID_ARGUMENT → key rejection message                    | [covered] `lookup-errors.spec.ts` |
| HTTP 429 → "Hit Gemini rate limit."                                  | [covered] `lookup-errors.spec.ts` |
| HTTP 500 → "Gemini server error. Retry."                             | [covered] `lookup-errors.spec.ts` |
| Malformed body → "Gemini returned unexpected output."                | [covered] `lookup-errors.spec.ts` |
| No-key → setup invite card (not a plain error)                       | [covered] `onboarding.spec.ts`    |
| Timeout (`TimeoutError` in `http-lookup-client.ts`) → mapped message | [gap:P1]                          |
| OpenAI error mapping: 401 (wrong key)                                | [gap:P1]                          |
| OpenAI error mapping: 429 / 500                                      | [gap:P1]                          |

## E. Security — `rule-sanitize-model-output` (S4)

| Case                                                                         | Status   |
| ---------------------------------------------------------------------------- | -------- |
| Hostile model output (`<script>`, `<img onerror>`) renders inert in the card | [gap:P1] |
| Hostile model output renders inert in the side panel mirror                  | [gap:P2] |

## F. Prompt & template

| Case                                                               | Status                                       |
| ------------------------------------------------------------------ | -------------------------------------------- |
| Default card format sends word + sentence + page title             | [covered] `default-template-context.spec.ts` |
| Card format field round-trips through Save                         | [covered] `default-template-context.spec.ts` |
| Target language selectable and persisted                           | [covered] `default-template-context.spec.ts` |
| PII in the page title masked to `[redact]` before the network call | [covered] `default-template-context.spec.ts` |
| Blank card format still yields a valid lookup                      | [covered] `default-template-context.spec.ts` |
| Custom promptEnvelope replaces the built-in envelope               | [covered] `advanced-prompt.spec.ts`          |
| Envelope edit persists to settings on Save                         | [covered] `advanced-prompt.spec.ts`          |
| Konami code unlocks the Developer panel with the assembled prompt  | [covered] `advanced-prompt.spec.ts`          |
| PII masked in the captured _sentence_ (not just the title)         | [gap:P2]                                     |

## G. Idiom expansion

| Case                                                      | Status                              |
| --------------------------------------------------------- | ----------------------------------- |
| Idiom renders defined-as label + Show literal word button | [covered] `idiom-expansion.spec.ts` |
| Outbound prompt carries the idiom-detection instruction   | [covered] `idiom-expansion.spec.ts` |
| Show literal re-runs the lookup with the literal reading  | [covered] `idiom-expansion.spec.ts` |
| Literal-tagged response renders no defined-as row         | [covered] `idiom-expansion.spec.ts` |
| Missing DEFINED_AS line degrades gracefully               | [covered] `idiom-expansion.spec.ts` |
| Side panel mirror hides the Show literal word button      | [covered] `idiom-expansion.spec.ts` |

## H. Cache & history policy

| Case                                                                    | Status                            |
| ----------------------------------------------------------------------- | --------------------------------- |
| `cacheEnabled:false` hits the network on every lookup                   | [covered] `cache-history.spec.ts` |
| `saveHistory:true` writes a history entry                               | [covered] `cache-history.spec.ts` |
| `saveHistory:false` writes no history entry                             | [covered] `cache-history.spec.ts` |
| Cache-miss write updates `cache:index`                                  | [covered] `cache-history.spec.ts` |
| Cache eviction beyond cap (unit: `cache-policy.test.ts`)                | [gap:P3]                          |
| History cap eviction visible in Recent (unit: `history-policy.test.ts`) | [gap:P3]                          |

## I. Saved words & learning status

| Case                                                     | Status                                  |
| -------------------------------------------------------- | --------------------------------------- |
| Star persists a `saved:<word>` entry matching the schema | [covered] `saved-word.spec.ts`          |
| Un-star removes the saved entry                          | [covered] `saved-word.spec.ts`          |
| Save from side panel persists sentence/url/title         | [covered] `saved-word.spec.ts`          |
| `history.clear` leaves saved words untouched             | [covered] `saved-word.spec.ts`          |
| TRANSLATION line persisted on save                       | [covered] `saved-word.spec.ts`          |
| Missing TRANSLATION saves `""` (back-compat)             | [covered] `saved-word.spec.ts`          |
| Learning toggle flips storage + UI to Known and back     | [covered] `b5-status-lifecycle.spec.ts` |
| Unsaved lookup renders no status toggle                  | [covered] `b5-status-lifecycle.spec.ts` |
| Side panel exposes its own independent status toggle     | [covered] `b5-status-lifecycle.spec.ts` |

## J. Repeat-lookup nudge

| Case                                                   | Status                              |
| ------------------------------------------------------ | ----------------------------------- |
| Banner appears only on the 3rd lookup of the same word | [covered] `b7-repeat-nudge.spec.ts` |
| Nudge Save persists via the same path as the star      | [covered] `b7-repeat-nudge.spec.ts` |
| Never re-shows for the same word once shown            | [covered] `b7-repeat-nudge.spec.ts` |
| Different word starts its own fresh count              | [covered] `b7-repeat-nudge.spec.ts` |

## K. Onboarding

| Case                                                   | Status                         |
| ------------------------------------------------------ | ------------------------------ |
| Activating with a key swaps to settings and persists   | [covered] `onboarding.spec.ts` |
| Empty key shows an error, stays on onboarding          | [covered] `onboarding.spec.ts` |
| No-key card setup invite → Open Settings opens options | [covered] `onboarding.spec.ts` |
| Key removed after activation → setup invite returns    | [gap:P2]                       |

## L. Settings / options page

| Case                                                                    | Status                              |
| ----------------------------------------------------------------------- | ----------------------------------- |
| Persists settings to storage and reloads them                           | [covered] `settings.spec.ts`        |
| `chrome.storage.local.clear` empties stored settings                    | [covered] `settings.spec.ts`        |
| First run with empty storage shows onboarding, not the form             | [covered] `settings.spec.ts`        |
| targetLang round-trips through storage                                  | [covered] `settings.spec.ts`        |
| Save shows a confirmation status                                        | [covered] `options-actions.spec.ts` |
| Clear cache shows a confirmation status                                 | [covered] `options-actions.spec.ts` |
| Clear history shows a confirmation status                               | [covered] `options-actions.spec.ts` |
| Test connection reports OK when the key works                           | [covered] `options-actions.spec.ts` |
| Test connection reports an error when the key is missing                | [covered] `options-actions.spec.ts` |
| Export history downloads JSON containing the entries                    | [covered] `options-actions.spec.ts` |
| Export with empty history reports nothing to export                     | [covered] `options-actions.spec.ts` |
| Restore default repopulates the card format after confirm               | [covered] `options-actions.spec.ts` |
| Restore default _cancel_ leaves the form unchanged                      | [gap:P2]                            |
| Test connection for the OpenAI provider                                 | [gap:P1]                            |
| Clear cache actually removes `cache:*` keys (behavior, not just status) | [gap:P2]                            |

## M. Themes

| Case                                                        | Status                                 |
| ----------------------------------------------------------- | -------------------------------------- |
| Defaults to Sepia even on a dark OS; saving Dark flips live | [covered] `theme-setting.spec.ts`      |
| Saved dark theme reaches the in-page bubble/card attribute  | [covered] `theme-setting.spec.ts`      |
| Stored sepia keeps the in-page card on warm paper           | [covered] `theme-setting.spec.ts`      |
| Theme segment re-themes the settings page live, before Save | [covered] `theme-live-preview.spec.ts` |
| Define button label visible in light + dark schemes         | [covered] `theme.spec.ts`              |
| Result card text visible in light + dark schemes            | [covered] `theme.spec.ts`              |
| High-contrast theme applied to the in-page card             | [gap:P2]                               |
| High-contrast theme in the side panel                       | [gap:P3]                               |

## N. Side panel

| Case                                                            | Status                                         |
| --------------------------------------------------------------- | ---------------------------------------------- |
| Opens on a teaching empty state (key set)                       | [covered] `side-panel.spec.ts`                 |
| No-key setup invite → Open Settings opens options               | [covered] `side-panel.spec.ts`                 |
| Renders a result delivered via runtime message                  | [covered] `side-panel.spec.ts`                 |
| Renders the loading state                                       | [covered] `side-panel.spec.ts`                 |
| Renders an error state                                          | [covered] `side-panel.spec.ts`                 |
| Malformed payload guard keeps prior content                     | [covered] `side-panel.spec.ts`                 |
| Lists history under Recent and revisits a lookup on click       | [covered] `side-panel.spec.ts`                 |
| Bottom-sheet icon opens the side panel (`sidePanel.open`)       | [covered] `side-panel-open.spec.ts`            |
| Panel recovers the word after the sheet is dismissed            | [covered] `side-panel-open.spec.ts`            |
| Deleting a Recent row removes history AND its cached definition | [covered] `side-panel-delete.spec.ts`          |
| Deleting one row leaves other cached words untouched            | [covered] `side-panel-delete.spec.ts`          |
| Deleted word re-fetches fresh on next selection                 | [covered] `side-panel-delete-evidence.spec.ts` |
| Panel opened while a lookup is in-flight (mirror timing)        | [gap:P2]                                       |

## O. Keyboard commands

| Case                                                        | Status                                |
| ----------------------------------------------------------- | ------------------------------------- |
| define-selection opens the card for the current selection   | [covered] `keyboard-commands.spec.ts` |
| define-selection with nothing selected is a safe no-op      | [covered] `keyboard-commands.spec.ts` |
| dismiss-lookup closes the pending trigger bubble            | [covered] `keyboard-commands.spec.ts` |
| dismiss-lookup closes an open card                          | [covered] `keyboard-commands.spec.ts` |
| send-to-panel moves the open card to the side panel         | [covered] `keyboard-commands.spec.ts` |
| send-to-panel with no active lookup does not open the panel | [covered] `keyboard-commands.spec.ts` |

## P. Error reporting & telemetry

| Case                                                             | Status                              |
| ---------------------------------------------------------------- | ----------------------------------- |
| Buffers silently, prompts at 3rd error, grant flushes + persists | [covered] `error-reporting.spec.ts` |
| Decline advances the Fibonacci rung, suppresses re-prompt        | [covered] `error-reporting.spec.ts` |
| Settings toggle reflects consent; off disables reporting         | [covered] `error-reporting.spec.ts` |
| GA4 telemetry payload shape (unit: `ga4-payload.test.ts`)        | [gap:P3]                            |

## Q. Layout & robustness

| Case                                                            | Status                                    |
| --------------------------------------------------------------- | ----------------------------------------- |
| Long content bounded + scrolls in the sheet on a short viewport | [covered] `bottom-sheet-overflow.spec.ts` |
| No-key invite centered under a hostile CSS reset                | [covered] `settings-nav.spec.ts`          |
| Card header Settings gear opens the options page                | [covered] `settings-nav.spec.ts`          |
| Side panel header Settings gear opens the options page          | [covered] `settings-nav.spec.ts`          |
| Narrow-viewport card layout                                     | [gap:P3]                                  |
