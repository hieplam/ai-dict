# C2 — Verified activation

Roadmap card: `docs/ROADMAP.md` §4 C2 (Impact 5 · Effort S · Score 5.0 · **foundation**).
Depends on: — (independent). Feeds: C3 (guided first lookup), C4 (any-provider onboarding) — both
need a _verified_ key to build on; C6 (invalid-key recovery) reuses the retest UX this card builds.

## 1. Problem (grounded in code)

Today "Save & activate" accepts any non-empty string and claims success unconditionally:

- `OnboardingView.submit()` (`packages/app/src/ui/onboarding-view.ts:155-169`) validates only
  `apiKey.length === 0` before dispatching the `save` event — there is no format check and no
  connectivity check.
- `mountOnboarding`'s `save` listener (`packages/extension-chrome/src/options.ts:189-206`)
  persists the key straight to `chrome.storage.local` and, once the write resolves, immediately
  swaps in the settings screen with the status **"You're all set. Highlight any word while
  reading and choose Define to look it up."** (`options.ts:201-203`) — no round-trip to any
  provider ever happens.
- A wire message that _would_ prove the key works already exists and is already routed:
  `WireMessageSchema` has a bare `{ type: 'connection.test' }` arm (`packages/app/src/wire.ts:129`,
  no payload), and `buildRouter`'s `handleConnectionTest` (`packages/app/src/app/router.ts:199-211`)
  runs a real one-word lookup against the active provider and replies `{ ok: true, type: 'ack' }`
  on success or `{ ok: false, type: 'connection.test', error }` (a full `LookupError`, mapped by
  `mapError` — `packages/app/src/domain/error-mapper.ts`) on failure. Today the **only** caller of
  this path is the settings form's "Test connection" button
  (`packages/app/src/ui/settings-form.ts:150-156`, wired to `options.ts`'s `wireSettings`) — the
  onboarding screen never sends it.

The result, confirmed by the 2026-07-16 funnel audit that opened Category C (`docs/ROADMAP.md`
§4 intro): a wrong, expired, or malformed key is accepted at setup time with a cheerful "all set,"
and only fails later as a red "Lookup failed" card mid-reading — the worst possible moment to
learn the setup step didn't actually work.

## 2. The critical design question: what does `connection.test` test during onboarding?

`handleConnectionTest` tests the **currently stored** key — it reads `deps.settings.get()` (which
returns `PublicSettings`, key stripped — S1) purely for `targetLang`/`outputFormat`/`promptEnvelope`
to shape the test lookup, and the actual secret comes from the `LookupClient` the service worker
composed at startup. During onboarding, by definition, the pasted key is **not yet stored** — so
naively sending `connection.test` right after the user types a key would test whatever key (if
any) was already in `chrome.storage.local`, not the one just pasted. Three ways to close that gap:

**(a) Persist first, test, roll back on failure.** Write the pasted key to `chrome.storage.local`
optimistically, send the unchanged `connection.test` message, and undo the write if it fails.

**(b) Extend `connection.test` with an optional key-under-test.** Add a payload field so the
onboarding screen can pass the pasted key without persisting it first.

**(c) Test from the options page directly**, bypassing the service worker and router entirely.

### Why (a) is the only one that needs zero new code paths

The fact that resolves this cleanly is **where the key is actually read, and when**:
`sw.ts`'s Gemini client is composed with
`getApiKey: async () => ENV_API_KEY || (await readFullSettings()).apiKey` (`sw.ts:86`), and
`readFullSettings()` (`sw.ts:35-53`) does a **fresh** `chrome.storage.local.get('settings')` on
every call — there is no cached/closed-over key. `handleConnectionTest` calls
`deps.client.lookup(...)` (`router.ts:201-207`), which calls `getApiKey()` fresh, every time. So:
the moment the options page writes the pasted key to storage and _then_ sends
`{ type: 'connection.test' }`, the service worker's next `getApiKey()` call reads exactly that
key — no wire change, no router change, no new message. The existing, unmodified
`connection.test` path already tests "whatever key is in storage right now"; onboarding just needs
to make sure the right thing is in storage right now before it asks.

### Why (b) is foreclosed without an ADR

`.c3/rules/rule-api-key-isolation.md` (canonical S1) states the rule unconditionally, scoped to
the mechanism, not the caller: _"The Gemini API key never crosses the `chrome.runtime` wire and
never enters a content script."_ Its `Override` section is explicit: **"None — this is security
invariant S1 … A deviation requires a new ADR amending the threat model."** The project-level
mirror, `.claude/rules/api-key-isolation.md`, states the same NEVER as a flat rule ("Put `apiKey`
on any `chrome.runtime` wire message") with no carve-out for which context originates the message.

It is true that the options page is a trusted context — it already writes the raw key straight to
`chrome.storage.local` (`options.ts:193`, `settings-form.ts`'s `collect()`) without going through
the wire at all, and that is the S1-compliant pattern: **hold the key in a trusted context and
write it directly to storage; never put it on a message.** Adding an `apiKey`-bearing field to
`WireMessageSchema` — even one only ever populated by the options page — would still mean _the key
crosses `chrome.runtime`_ for the message's transit (options page → service worker via
`chrome.runtime.sendMessage`), which is precisely the wire the rule names, and the golden example
in the same rule file singles out exactly this shape as the anti-pattern: _"A wire reply includes
apiKey → Strip it; z.strictObject rejects it anyway … The wire is JSON across realms — the key
would be observable."_ A request-side payload field is the same hazard the reply-side example
warns about, just mirrored. Since C2's own scope fence says **"Escalate: none"** and no ADR is
in flight for this card, (b) is not available without first stopping to open one — and option (a)
makes that detour unnecessary, since it achieves the identical test with the existing schema.

### Why (c) duplicates code the router already owns

The actual HTTP call — timeout handling, `AbortController` merging, provider-specific headers,
non-OK-response parsing, and the full `mapError` classification — lives in one shared skeleton,
`runHttpLookup` (`packages/app/src/app/http-lookup-client.ts:71-185`), composed per-provider
(`GeminiLookupClient`, etc.) and wired into the router's `LookupClient` only inside the service
worker (`sw.ts:81-114`). Testing from the options page directly would mean either reimplementing
that skeleton a second time in a different composition root (a second, divergent code path for
the exact same "does this key work" question — the two would drift), or importing the SW-only
adapters into the options page, which breaks the same trusted-context-only boundary S1 protects
(the whole point of keeping the key/HTTP logic behind the service worker's `LookupClient` is that
nothing else needs to touch it). The card's own scope fence — **"Reuses the existing
`connection.test` path — no new wire message unless the key-under-test can't ride it"** — is
satisfied by (a) without qualification: the key rides `connection.test` exactly as-is, because the
key never has to be _on_ the message at all.

**Pinned: option (a).** Persist the pasted key + language optimistically, send the unmodified
`{ type: 'connection.test' }`, and roll storage back to the pre-onboarding snapshot on any
failure. `wire.ts` and `router.ts` are untouched by this card.

## 3. Persist-on-pass vs. persist-with-warning (the card's other lead-decidable choice)

The card recommends _"persist only on pass, with a 'save anyway' escape hatch for offline
setups"_ and leaves the exact semantics to the lead. Pinned:

- **Default path — persist only on pass.** On any `connection.test` failure, the optimistic write
  from §2(a) is rolled back to the exact pre-onboarding settings snapshot (not just `apiKey`
  cleared — the whole object, in case a concurrent edit ever changes something else first).
  Storage is never left holding an unverified key silently; onboarding shows the key back in the
  field (untouched, still visible/editable) with an inline, actionable error.
- **Escape hatch — "Save anyway," scoped to `code === 'NETWORK'` only.** `mapError`'s `'offline'`
  and `'timeout'` kinds, plus 5xx HTTP responses, all resolve to `LookupError.code === 'NETWORK'`
  (`error-mapper.ts:45-51,95-96`) — the one class of failure where the provider **never actually
  answered**, so the test is inconclusive rather than a verified rejection. Only this class shows
  a second, explicit button that bypasses verification and persists the key with a distinct
  "couldn't verify — check later" status (reusing the exact retest UX at `settings-form.ts:150-156`
  that C6 depends on).
- **`INVALID_KEY`, `RATE_LIMIT`, `PARSE`, `UNKNOWN` never get the escape hatch.** In every one of
  these cases the provider **did** answer — with a rejection, a quota signal, or garbage output —
  so "claims success without the provider answering" (the exact failure C2 exists to close) would
  be reintroduced if a quota-exceeded or wrong-key response could be silently waved through. The
  user's only path forward is to fix the key/wait and press "Save & activate" again. This is a
  narrower reading than "quota" implicitly deserving a bypass too, and it is deliberate: a 429
  means the key reached the provider and was recognized (just throttled), which is a materially
  different, more-verified state than "we don't know because we couldn't reach anyone."
- **No new copy is invented.** "Timeout + offline get their own copy" (the card's phrasing) is
  already true of the existing, un-modified `mapError` — `NETWORK` carries "Network failed. Check
  connection and retry.", distinct from `INVALID_KEY`'s "\<Vendor\> rejected the API key.",
  `RATE_LIMIT`'s "Hit \<Product\> rate limit.", etc. (`error-mapper.ts:45-51,70-98`, and the
  existing table of expected copy already asserted in `packages/extension-chrome/e2e/
lookup-errors.spec.ts:17-32`). C2 reuses `reply.error.message` verbatim; it does not add a
  parallel copy table.
- **Exactly one test call per "Save & activate" click** (constraint 4, `docs/ROADMAP.md` §3.4 —
  "every model call is triggered by an explicit user action"): the busy-guard in §4.1 below
  prevents a double-click firing two `connection.test` round trips, and "Save anyway" makes
  **zero** further test calls — it is a deliberate bypass of verification, not a retry.

## 4. The change

No change to `packages/app/src/wire.ts`, `packages/app/src/app/router.ts`, or
`packages/app/src/ui/settings-form.ts` — the entire card lives in the onboarding view + the
options-page composition root that already owns onboarding's persistence.

### 4.1 UI — `packages/app/src/ui/onboarding-view.ts`

- Add a private `_busy: boolean` field (default `false`).
- `submit()` (currently `onboarding-view.ts:155-169`) gains a guard at the top: `if (this._busy)
return;` — this defends the "exactly one test call" fence even if a disabled button somehow
  still received a synthetic click/Enter-key submit.
- New markup: a second, initially-`hidden` button `#save-anyway` (`type="button"`, so it never
  triggers form submit) placed in `.actions` right after `#activate`, e.g. `Save anyway` with
  `aria-label="Save your key without testing the connection"`. Styled with the existing token set
  (bordered/transparent like `#reveal`'s existing rule block at `onboarding-view.ts:60-62` —
  `--ad-line-strong`, `--ad-surface`, `--ad-ink`; no new colors).
- New method `setBusy(busy: boolean): void`: toggles `#activate.disabled`, swaps its text between
  `'Save & activate'` and `'Activating…'`, disables `#save-anyway` too, and — when turning busy
  **on** — hides `#save-anyway` (`showSaveAnyway(false)`) so a stale escape hatch from a previous
  failed attempt never lingers into a fresh in-flight test.
- New method `showSaveAnyway(show: boolean): void`: toggles `#save-anyway`'s `hidden` attribute.
  Purely a view primitive — the composition root decides _when_ to call it (§4.2), the view has no
  opinion on error codes.
- `submit()`'s success path becomes: validate non-empty (unchanged) → `this.setBusy(true)` →
  dispatch `save` (unchanged shape: `{ apiKey, targetLang }`, `bubbles: true, composed: true`).
- New private `submitAnyway()`, mirroring `submit()`'s validation (empty-key guard reuses the same
  error copy/focus), wired to `#save-anyway`'s click: `if (this._busy) return;` → validate → `this.
setBusy(true)` → dispatch a new `save-anyway` event, same `OnboardingValue` detail shape,
  `bubbles: true, composed: true`.
- `OnboardingValue` (the exported interface, `onboarding-view.ts:9-12`) is unchanged — both events
  carry exactly `{ apiKey, targetLang }`.

### 4.2 Composition root — `packages/extension-chrome/src/options.ts`

Replace `mountOnboarding`'s single `save` listener (currently `options.ts:189-206`) with:

```ts
view.addEventListener('save', (e) => {
  const { apiKey, targetLang } = (e as CustomEvent<OnboardingValue>).detail;
  view.setStatus('Testing your key…');
  let cur: Settings;
  void load()
    .then((c) => {
      cur = c;
      // Persist optimistically — connection.test always tests whatever is in storage right
      // now (sw.ts's getApiKey reads live), so this is the ONLY way to make the pasted key
      // (not yet stored) reachable to the existing, unmodified connection.test path.
      return chrome.storage.local.set({
        settings: { ...cur, apiKey, targetLang, hasKey: Boolean(apiKey) },
      });
    })
    .then(() => send({ type: 'connection.test' }))
    .then(
      (r) => {
        if (r.ok) {
          void load().then((s) =>
            mountSettings(
              s,
              "You're all set. Highlight any word while reading and choose Define to look it up.",
            ),
          );
          return;
        }
        // Persist only on pass: roll back to the exact pre-onboarding snapshot on any failure.
        void chrome.storage.local.set({ settings: cur }).then(() => {
          view.setBusy(false);
          if (r.error.code === 'NETWORK') {
            view.setStatus(
              `${r.error.message} You can save without testing and verify later in Settings.`,
              'error',
            );
            view.showSaveAnyway(true);
          } else {
            view.setStatus(r.error.message, 'error');
          }
        });
      },
      () =>
        void chrome.storage.local.set({ settings: cur }).then(() => {
          view.setBusy(false);
          view.setStatus('Could not reach the extension. Try again.', 'error');
        }),
    );
});

view.addEventListener('save-anyway', (e) => {
  const { apiKey, targetLang } = (e as CustomEvent<OnboardingValue>).detail;
  // Deliberate bypass — zero further connection.test calls; the point is to unblock an
  // offline/unreachable setup, not to retry verification.
  void load()
    .then((cur) =>
      chrome.storage.local.set({
        settings: { ...cur, apiKey, targetLang, hasKey: Boolean(apiKey) },
      }),
    )
    .then(load)
    .then(
      (s) =>
        mountSettings(
          s,
          'Saved without testing — the connection could not be reached. Run Test connection in ' +
            'Settings once you’re back online.',
        ),
      () => {
        view.setBusy(false);
        view.setStatus('Could not save your key. Try again.', 'error');
      },
    );
});
```

`send()` (`options.ts:51-54`) and `load()` (`options.ts:45-49`) are the existing helpers, unchanged.
`mountSettings` is the existing function (`options.ts:84-111`), unchanged.

### 4.3 No change to `packages/app/src/wire.ts` / `packages/app/src/app/router.ts`

Recorded explicitly because it is the one thing an implementer reflexively expects to touch: per
§2's resolution, `connection.test`'s zero-payload schema (`wire.ts:129`) and
`handleConnectionTest` (`router.ts:199-211`) already do exactly what onboarding needs once the key
is in storage first. Zero lines change in either file.

### 4.4 No change to `packages/app/src/domain/error-mapper.ts`

Per §3, the existing `LookupError` taxonomy and copy are reused verbatim — this card adds no new
error code and no new copy table.

## 5. Scope fence (from the card, held exactly)

- **Exactly one `connection.test` round trip per explicit "Save & activate" click** — enforced by
  `_busy` guards in both the view (defense-in-depth against a double click/Enter) and implicitly by
  the composition root never re-sending `connection.test` from the `save-anyway` path.
- **No new wire message, no wire/router change** — §2/§4.3.
- **No new error taxonomy or copy** — §3/§4.4; `reply.error.message` is used as-is.
- **Persist only on pass**, with the escape hatch scoped strictly to `NETWORK`-class failures — §3.
- **S1 held exactly**: the key is written directly to `chrome.storage.local` by the options page
  (a trusted context, exactly like every other settings write today) and never appears on a
  `chrome.runtime` message, in a log, or in the rolled-back snapshot's diff (the rollback simply
  restores the prior settings object; nothing about the key is ever logged or exported).
- **No new manifest permission** — nothing here touches `manifest.json`.
- **No UI outside `--ad-*`/`--adp-*` tokens** — the new `#save-anyway` button reuses the same token
  set as `#reveal`.

## 6. Testing strategy

1. **Unit — `packages/app/test/ui/onboarding-view.test.ts`**: `setBusy(true)` disables both
   buttons, relabels `#activate` to "Activating…", and hides `#save-anyway`; `setBusy(false)`
   restores the label/enabled state; `showSaveAnyway(true/false)` toggles `#save-anyway`'s `hidden`;
   a second `submit()` while busy dispatches no second `save` event; clicking `#save-anyway`
   dispatches a composed `save-anyway` event with the trimmed key/language; an empty key blocks
   `submitAnyway()` with the same inline error `submit()` already uses.
2. **e2e — update the existing `packages/extension-chrome/e2e/onboarding.spec.ts`**: the first test
   ("activating with a key swaps to the settings screen and persists it") currently activates with
   no provider mock at all — it must now call `mockGemini(context)` (200, the default
   `GEMINI_OK_BODY`) before creating the page, since activation now performs a real (mocked)
   `connection.test`. Assert the mock's `.count === 1` (exactly one call for the one click).
3. **e2e — new `packages/extension-chrome/e2e/c2-verified-activation.spec.ts`**:
   - A mocked HTTP 400 `INVALID_ARGUMENT` body (`{ error: { status: 'INVALID_ARGUMENT' } }`, the
     same shape already asserted in `lookup-errors.spec.ts:22-25`) → stays on `onboarding-view`,
     shows "Google rejected the API key.", no `#save-anyway`, and `chrome.storage.local`'s
     `settings.hasKey`/`apiKey` are rolled back (still falsy/empty).
   - `mockGemini(context, { abort: true })` (simulates offline) → stays on `onboarding-view`, shows
     the `NETWORK` copy plus the "You can save without testing…" suffix, storage rolled back, and
     `#save-anyway` visible. Clicking it swaps to `settings-form` with the "Saved without
     testing…" status, storage now holds the key (`hasKey: true`), and the Gemini mock's call
     count is still exactly **1** (the bypass makes no further request).
   - A double-click on `#activate` (or two rapid `Enter`-triggered submits) still produces exactly
     one `connection.test`/fetch call — asserts the busy-guard, not just the happy path.
4. **Global constraint reminder (this repo, not new to this card):** the e2e build must run with
   `GEMINI_API_KEY` cleared, e.g. `GEMINI_API_KEY= bun run build:chrome` — a baked-in env key makes
   `options.ts`'s `KEY_FROM_ENV` (`options.ts:28,211`) skip onboarding entirely, which silently
   disables every onboarding e2e including all of the above (the exact flake C10 documents,
   `docs/ROADMAP.md` §4 C10). This plan does not depend on C10 landing first, but the implementer
   must not rely on ambient shell state either way.

## 7. Testing performed (PR evidence — replaces screenshot/video capture)

Per this worktree's `CLAUDE.md` (owner ruling 2026-07-16, superseding the older before/after-media
convention B5's design doc still used): **no screenshots or video for this PR.** The PR body's
"Testing performed" section carries the evidence instead — the suites run, test counts, e2e
scenarios exercised, and gates passed (lint, format check, typecheck, unit, e2e), matching exactly
what §6 above enumerates. No `pr-assets/*` branch is created for this card.

## 8. Risk / rollback

- **Risk: low-moderate.** The only correctness-sensitive new logic is the persist → test →
  roll-back-or-keep sequencing in `options.ts`'s `save` listener; a bug here could either leave a
  bad key persisted (defeats the card) or wrongly roll back a good key (regresses the pre-C2 happy
  path). Both are directly covered by the e2e scenarios in §6.2/§6.3, which assert
  `chrome.storage.local` state explicitly, not just UI text.
  Everything else (view button state, the escape hatch) is additive and gated behind existing
  conditionals (`hidden`, `disabled`).
- **No data migration.** `Settings`/`PublicSettings` shapes are unchanged; nothing about the stored
  object's shape differs from today, only _when_ it gets written.
- **Rollback:** revert the single PR. The pre-C2 behavior (persist-then-declare-success
  unconditionally) returns exactly as it was; no stored data becomes invalid.

## 9. Files touched (summary)

| File                                                           | Change                                                                                                        |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `packages/app/src/ui/onboarding-view.ts`                       | + `_busy`, `setBusy`, `showSaveAnyway`, `#save-anyway` button, `save-anyway` event                            |
| `packages/extension-chrome/src/options.ts`                     | `mountOnboarding`'s `save` listener rewritten (persist→test→rollback-or-proceed) + new `save-anyway` listener |
| `packages/app/test/ui/onboarding-view.test.ts`                 | + tests (§6.1)                                                                                                |
| `packages/extension-chrome/e2e/onboarding.spec.ts`             | existing test updated to mock Gemini                                                                          |
| `packages/extension-chrome/e2e/c2-verified-activation.spec.ts` | new — functional e2e (§6.3)                                                                                   |

No change to `packages/app/src/wire.ts`, `packages/app/src/app/router.ts`,
`packages/app/src/ui/settings-form.ts`, `packages/app/src/domain/error-mapper.ts`, or any manifest
file.
