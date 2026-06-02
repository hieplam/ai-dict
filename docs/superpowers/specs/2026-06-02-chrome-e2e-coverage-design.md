# Design: Broaden Chrome extension e2e coverage

**Date:** 2026-06-02
**Status:** Approved (design); implementation plan pending
**Scope:** `packages/extension-chrome` end-to-end (Playwright) tests only

## 1. Goal & shape

Turn the two ad-hoc Playwright specs into a maintainable suite that covers the
real lookup flow, its error states, cache/history behavior, settings, the side
panel, and selection UX. Built on a shared fixture, split into two
auto-detected tiers so something always runs locally.

```
e2e/
  fixtures.ts      ← test.extend<{context, extensionId}> + real-Chrome detection
  helpers.ts       ← seedSettings, mockGemini(route), clearStorage, selectWord, openTrigger, cardText
  tier1.*.spec.ts  ← extension-context (options, side-panel, storage) — runs EVERYWHERE
  tier2.*.spec.ts  ← content-script real flow — auto-skips when no real Chrome channel
```

### Context

The product is a Manifest V3 browser extension. The select-word → trigger →
card flow spans a **content script** (isolated world) talking to a **service
worker** via `chrome.runtime.sendMessage`. Playwright's *bundled* Chromium does
not deliver those content-script → SW messages in headless mode, so the real
flow only runs under a full Chromium build on Linux/xvfb (today's CI
`e2e-chrome` job sets `PLAYWRIGHT_RUN_LOOKUP_E2E=1` and runs
`xvfb-run … playwright test`). The existing `lookup.spec.ts` is therefore
`test.skip()`-ped locally. Settings/side-panel/storage assertions, by contrast,
run on extension-context pages where `chrome.*` APIs work in any environment.

This design keeps the working CI path intact and builds breadth on top of it,
while making the extension-context tier runnable locally with no flags.

## 2. Harness (`fixtures.ts`)

- One `test.extend<{ context; extensionId }>` fixture (Playwright's documented
  Chrome-extension pattern), replacing the duplicated `beforeAll` blocks in both
  current spec files.
- `launchPersistentContext('', { channel: detectChannel(), headless: E2E_HEADLESS, args: [--disable-extensions-except=<dist>, --load-extension=<dist>] })`.
- `detectChannel()` returns `'chromium'` when a real Chrome/Chromium channel is
  resolvable, otherwise `undefined` (bundled browser).
- **Tier-2 gating:** tier-2 specs call `test.skip()` when there is no real
  channel **and** `PLAYWRIGHT_RUN_LOOKUP_E2E !== '1'`. This preserves today's CI
  behavior exactly (CI sets the flag) while letting a developer with a real
  Chrome installed run the full flow locally with no flag.
- **Per-test isolation (load-bearing):** `test.beforeEach` clears
  `chrome.storage.local` from an extension page. The persistent context shares
  storage across tests; without a reset, cache/history/settings leak between
  tests and the suite goes flaky. This is the single most important correctness
  element of the harness.

## 3. `helpers.ts` — reusable actions

- `seedSettings(page, overrides)` — write a `settings` object to storage
  (with/without API key, cache on/off, `saveHistory` on/off, `targetLang`).
- `mockGemini(page, { status?, body?, abort? })` — single `page.route` on the
  Gemini host (`https://generativelanguage.googleapis.com/**`) with presets for
  ok / 4xx / 5xx / malformed-body / `route.abort()`.
- `selectWord(page, id, word)` — deterministic Range + `mouseup` dispatch
  (lifted from the current `lookup.spec.ts`).
- `openTrigger(page)` / `cardText(page)` — wait for `lookup-trigger`, click it,
  read `bottom-sheet lookup-card`.

## 4. Tier 1 specs — run everywhere (no real Chrome required)

1. **settings.spec** — persist + reload (exists today), clear (exists today),
   plus: empty/invalid key handling, `targetLang` round-trip, defaults applied
   when storage is empty.
2. **side-panel.spec** — open `side-panel.html`, then send
   `{ to: 'side-panel', state: … }` runtime messages from an extension page and
   assert the `lookup-card` renders: loading, a sanitized result, and each error
   code. Also assert the `isLookupResult` guard rejects a malformed `result`
   payload, and the S3 sender guard ignores a foreign-sender message.

## 5. Tier 2 specs — real content-script flow (CI xvfb / local real Chrome)

3. **lookup.spec** — cache-hit (seeded; exists today), **cache-miss with mocked
   Gemini network response** (exercises the real `GeminiLookupClient` + router),
   multiple consecutive lookups, and a second lookup of the same word served
   from cache (assert the network mock was called exactly once).
4. **lookup-errors.spec** — one test per error mapping, asserting the exact
   mapped card text:

   | Trigger (mock)                          | Card shows                                   |
   | --------------------------------------- | -------------------------------------------- |
   | settings without key                    | `Add your Gemini API key in Settings.`       |
   | `route.abort()` / timeout               | `Network failed. Check connection and retry.`|
   | HTTP 401 / 403 / 400 `INVALID_ARGUMENT` | `Google rejected the API key.`               |
   | HTTP 429                                | `Hit Gemini rate limit.`                     |
   | HTTP ≥ 500                              | `Gemini server error. Retry.`                |
   | malformed JSON body                     | `Gemini returned unexpected output.`         |

5. **cache-history.spec** — cache disabled ⇒ network hit every time; a lookup
   writes a `history:`-prefixed entry (assert via `storage.local.get`);
   `saveHistory: false` ⇒ no history write; `cache:index` is updated on a
   cache-miss write.
6. **selection.spec** — collapsed selection ⇒ no trigger; multi-word phrase ⇒
   trigger appears and produces the correct cache key; dismiss then re-select.

## 6. CI & docs

- The CI `e2e-chrome` job is unchanged (already runs xvfb + the env flag) — it
  picks up the new specs automatically.
- Add an `e2e:chrome:tier1` convenience script for fast local runs of the
  always-on tier.
- Update the README e2e row and add a short `e2e/README.md` explaining the two
  tiers and the real-Chrome requirement for tier 2.

## 7. Out of scope (YAGNI)

- Safari / iOS automation (remains the manual `ios-simulator-checklist.md`).
- Any real network Gemini call (always mocked).
- Visual / screenshot regression testing.

## 8. Open items to verify during implementation

- **[verify]** Tier-1 side-panel test assumes `chrome.runtime.sendMessage` from
  one extension page is delivered to the side-panel page's `onMessage` under
  Playwright headless. This is documented behavior but unverified here; a spike
  will confirm it. Fallback: drive the broadcast via `serviceWorker.evaluate()`.
- **[verify]** Whether a **history UI** exists. Only the `history:` kv storage
  prefix is confirmed. §5 asserts against storage (not a UI) to stay honest; if
  a history page exists, add UI assertions.
- **[verify]** `detectChannel()` resolution of a real Chrome channel across dev
  machines and CI; the `channel:'chromium'` path is additive and must not
  regress the bundled + env-flag path.
