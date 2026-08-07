# C6 — Invalid-key recovery flow

Roadmap card: `docs/ROADMAP.md` §4 Category C, C6 (Impact 3 · Effort S · Score 3.0).
Depends on: — formally (roadmap `Depends on:` field is `—`); the card's own body notes "C2
builds the retest UX it reuses" and the dependency diagram (§5) draws
`C2 -.retest UX reused by.-> C6`. **This spec does not require C2 to ship first**: the "Test
connection" round trip C6 reuses already exists today, pre-dating C2 (see §1) — it is the
settings form's own manual button, not something C2 introduces. If C2 later enriches that
retest surface, C6's auto-run hook (§3.6) rides whatever C2 leaves in place with no further
change, because it triggers the identical `connection.test` wire message C2 will also use.

## 1. Problem (grounded in code)

Today, a rejected API key dead-ends the reader in the worst-guided moment in the product:

- The lookup fails with `LookupError.code === 'INVALID_KEY'`, produced by
  `mapError({ kind: 'http', ... })` in `packages/app/src/domain/error-mapper.ts:70-87` — HTTP
  400/401/403 (or Gemini's `INVALID_ARGUMENT`/`UNAUTHENTICATED`/`PERMISSION_DENIED` status) maps
  to `{ code: 'INVALID_KEY', message: '${vendor} rejected the API key.', retryable: false }`. For
  Gemini this renders literally as **"Google rejected the API key."** — confirmed against the
  existing e2e case table, `packages/extension-chrome/e2e/lookup-errors.spec.ts:20-25`.
- The card renders this in `renderCardState`, `packages/app/src/ui/lookup-card.ts:262-274`: an
  `<h2>Lookup failed</h2>`, the error message, and — because `INVALID_KEY` is treated as "the same
  dead-end as no key" (the code's own comment, line 272-273) — the identical
  `settingsCta('Open Settings')` button the `NO_KEY` setup-invite uses
  (`renderSetupInvite`, lines 216-227, and the shared `settingsCta` factory, lines 195-209).
- `settingsCta` (lines 199-209) is a plain button that dispatches a composed, **payload-free**
  `open-settings` CustomEvent (`{ bubbles: true, composed: true }`, no `detail`) — there is
  nothing on the event today that could distinguish "the reader is fixing a broken key" from "the
  reader is entering settings for any other reason."
- The in-page composition root, `packages/extension-chrome/src/content.ts:141-143`, catches that
  event and relays a payload-free wire message: `chrome.runtime.sendMessage({ type:
'open-options' })`.
- The wire schema, `packages/app/src/wire.ts:133` (inside the `saved.*`/`connection.test` union at
  `WireMessageSchema`), defines `open-options` as `z.object({ type: z.literal('open-options') })`
  — no fields, so no room to carry intent even if content.ts wanted to.
- The router, `packages/app/src/app/router.ts:272-274`, handles it with exactly two steps: `await
deps.openOptions?.()` then ack. `deps.openOptions` is injected in
  `packages/extension-chrome/src/sw.ts:110-112` as `() => chrome.runtime.openOptionsPage()` — a
  **zero-argument** call (verified: `chrome.runtime.openOptionsPage()` takes no URL/hash/mode
  argument per the Chrome extensions API — see §2.1). It cannot carry the reader's intent through
  to the options page by itself.
- `packages/extension-chrome/src/options.ts:210-213` then routes purely on whether a usable key
  exists (`KEY_FROM_ENV || hasKeyFor(s)`) — an `INVALID_KEY` reader always has `hasKey: true` (a
  key was saved, it's just wrong), so they land on `mountSettings(s)` with **no status message, no
  key-field focus, and no memory of why they're there.**
- The settings form itself, `packages/app/src/ui/settings-form.ts`, already has everything C6
  needs to reuse: a `#key` input (line 154), a **pre-existing** "Test connection" button (`#test`,
  line 160) wired via `this.relay('#test', 'test-connection')` (line 309) — this is the exact
  round trip the card summary asks to reuse, and it predates this card entirely — and a reusable
  status line (`setStatus`, lines 493-498, backing `#status`).
- `packages/extension-chrome/src/options.ts:150-156` already fires that button's `connection.test`
  wire message and reports pass/fail into `form.setStatus(...)` — this is the working, but
  entirely manual, mechanism the reader "must find themselves" (the card's own **Today** wording).

**The gap matches the card exactly:** the INVALID*KEY card's CTA and the NO_KEY card's CTA are
\_the same button doing the same payload-free thing* — there is no channel from "which error put
the reader here" to "what state should Settings open in," even though every piece needed to close
that gap (a key field, a test-connection round trip, a status line) already exists.

## 2. Decision: the deep-link mechanism (Lead's pinned call, per the card's "you decide")

**PINNED: a one-shot storage flag, not a URL hash.** `chrome.runtime.openOptionsPage()` stays
exactly as it is today (`sw.ts:112`, unchanged by this plan); a small boolean-ish flag written to
the existing `Storage` port tells `options.ts` to enter fix-key mode the moment it next loads.

### 2.1 Why not a URL hash (`options.html#fix-key`)

Verified against the Chrome extensions API surface this repo already uses:

- `chrome.runtime.openOptionsPage()` — the call `sw.ts:112` makes today — **takes no arguments**.
  There is no way to pass a hash or query string through it. To land on
  `options.html#fix-key` the router would have to stop calling `openOptionsPage()` for this case
  and instead drive `chrome.tabs.*` directly.
- `chrome.tabs.create({ url: chrome.runtime.getURL('options.html#fix-key') })` **would** work with
  **no new manifest permission**: `packages/extension-chrome/src/manifest.json:14` already
  declares `"host_permissions": ["<all_urls>"]`. The `"tabs"` permission exists only to unlock
  reading the _sensitive_ `url`/`pendingUrl`/`title`/`favIconUrl` fields of tabs the extension
  does **not** already have host access to (per the Chrome `chrome.tabs` permissions model);
  `<all_urls>` already grants that for every tab, including the extension's own
  `chrome-extension://` pages, so `tabs.create`/`tabs.query`/`tabs.update` would need nothing
  beyond what `manifest.json` already grants. This satisfies the card's "no new manifest
  permissions" wall (Category C intro, §4) either way — it is not the deciding factor.
- The deciding factor is **`openOptionsPage()`'s built-in tab dedup**, documented Chrome behavior:
  if an options tab is already open, the call **focuses it instead of opening a duplicate**.
  Replacing it with `chrome.tabs.create` for the fix-key path would lose that dedup unless the
  router re-implements it (query existing tabs for `chrome-extension://<id>/options.html*`, then
  `tabs.update` vs. `tabs.create`) — new surface, and specifically new surface on the shared
  `open-options` path that the **already-working, already-tested NO_KEY flow also depends on**.
  A hash mechanism risks that shared path to gain a cosmetic URL; a flag does not touch it at all.

### 2.2 The chosen mechanism

- New domain-owned constant, `packages/app/src/domain/ui-flags.ts` (new file):

  ```ts
  /**
   * C6: one-shot flag consumed by options.ts to enter "fix the rejected key" mode — focus the
   * key field, show likely-causes copy, and auto-run one connection.test after the very next
   * Save. Set by the router's `open-options` handler when the triggering `open-settings` event
   * carried `{ fixKey: true }` (the INVALID_KEY card's CTA only — see lookup-card.ts), or by the
   * side panel's own direct-open path (side-panel.ts, which calls chrome.runtime.openOptionsPage
   * itself rather than routing through the wire — see its existing 'open-settings' listener).
   * A NEW namespace (ref-kv-storage-prefixes already owns cache:/history:/saved:/nudge: for
   * persisted domain data) because this is a transient UI signal, not saved user data — it is
   * written, read once, and deleted within the same options-page load.
   */
  export const FIX_KEY_PENDING_STORAGE_KEY = 'ui:fixKeyPending';
  ```

  Re-exported from `packages/app/src/index.ts` via `export * from './domain/ui-flags';` (added
  next to the existing domain re-exports, `index.ts:9-10`), so both the portable-core router and
  the Chrome-only composition roots import the identical literal — no second hand-typed copy of
  the string anywhere.

- `settingsCta(label, opts?)` (`lookup-card.ts:199-209`) grows an optional second parameter; when
  `opts?.fixKey` is true the dispatched `open-settings` event carries `detail: { fixKey: true }`.
  Every other call site (the `NO_KEY` setup invite, the card's header Settings gear at
  `lookup-card.ts:567-579`, which dispatches its own detail-free `open-settings` via a different
  code path entirely) is untouched and keeps sending no detail — **zero behavior change** for
  every existing caller. Only the `INVALID_KEY` branch (`lookup-card.ts:273`) passes `{ fixKey:
true }`.
- `content.ts`'s `open-settings` listener (lines 141-143) reads `event.detail?.fixKey` and forwards
  it as `{ type: 'open-options', fixKey }` on the wire. `side-panel.ts`'s own `open-settings`
  listener (lines 172-174) does the platform-native equivalent **without** going through the wire,
  exactly as it already skips the wire for the plain case — see §3.5 for why that asymmetry is
  kept rather than unified.
- `wire.ts`'s `open-options` arm grows one optional field: `fixKey: z.boolean().optional()`.
  Additive to a `discriminatedUnion` member — no breaking change, matching the additive-only
  precedent every prior wire change in this codebase follows (B1/B5's own additive arms).
- The router's `open-options` case (`router.ts:272-274`) writes the flag through the existing
  `Storage` port **before** calling `openOptions()`: `if (msg.fixKey) await
deps.kv.setItem(FIX_KEY_PENDING_STORAGE_KEY, '1')`. This keeps the write inside the portable,
  unit-testable core (`router.test.ts`, no Chrome mocking needed) rather than inside `sw.ts`.
- `options.ts` reads the flag the moment it mounts the settings screen (inside `mountSettings`,
  which is exactly where the form the flag configures gets created — see §3.7), clears it
  immediately (one-shot — a later, unrelated Settings visit never re-triggers fix-key mode), and
  calls the new `form.enterFixKeyMode()` (§3.6).

### 2.3 Known, accepted limitation (documented, not a scope-fence break — mirrors B5's own pattern)

If a Settings tab is **already open** when the reader clicks "Fix key in Settings,"
`chrome.runtime.openOptionsPage()`'s own dedup behavior focuses that existing tab **without
reloading it** — so the one-shot flag-check in `mountSettings` (which runs once per page load)
never fires for that already-open tab, and it shows plain, unfocused Settings. This is not a
regression: it is `openOptionsPage()`'s existing, unmodified behavior (`sw.ts:112`), and it is
**no worse than today's baseline** — before this card, clicking "Open Settings" on an INVALID_KEY
card while a Settings tab was already open produced the exact same unfocused result. Solving it
would mean a `chrome.storage.onChanged` listener reacting mid-session inside an already-mounted,
possibly-dirty form — real new complexity for an edge case, and outside the card's "Copy +
deep-link/focus... no new error taxonomy" fence. Accepted for v1.

## 3. The change

### 3.1 Domain — `packages/app/src/domain/ui-flags.ts` (new file)

`FIX_KEY_PENDING_STORAGE_KEY` constant, as specified in §2.2. Pure string literal, no chrome/DOM
access — satisfies `rule-domain-purity` trivially. Re-exported from `index.ts`.

### 3.2 Wire protocol — `packages/app/src/wire.ts`

Extend the existing `open-options` arm (line 133) in place:

```ts
z.object({ type: z.literal('open-options'), fixKey: z.boolean().optional() }),
```

No change to `MessageTypeEnum` — `'open-options'` is already listed (line 151). The
`wire-schema.snapshot.json` regenerates to show the new optional field.

### 3.3 Router — `packages/app/src/app/router.ts`

Extend the existing `open-options` case (lines 272-274):

```ts
case 'open-options':
  if (msg.fixKey) await deps.kv.setItem(FIX_KEY_PENDING_STORAGE_KEY, '1');
  await deps.openOptions?.();
  return { ok: true, type: 'ack' };
```

Import `FIX_KEY_PENDING_STORAGE_KEY` alongside the file's existing `'../index'` imports
(`router.ts:1-24`). No change to `RouterDeps` — `deps.kv` and `deps.openOptions` already exist.

### 3.4 UI — `packages/app/src/ui/lookup-card.ts`

- `settingsCta(label: string, opts?: { fixKey?: boolean }): HTMLButtonElement` (was
  `settingsCta(label: string)`, lines 199-209): dispatch `detail: opts?.fixKey ? { fixKey: true } :
undefined` alongside the existing `bubbles`/`composed` flags.
- `renderSetupInvite()` (line 227): call site unchanged, `settingsCta('Open Settings')` — the
  `NO_KEY` path never sets `fixKey`.
- The `INVALID_KEY` branch (line 273): change
  `return [h, p, settingsCta('Open Settings')];` to
  `return [h, p, settingsCta('Fix key in Settings', { fixKey: true })];` — a distinct label
  because the destination is now materially different (pre-focused, pre-explained), matching the
  card's own Payoff wording ("a 20-second fix loop"). This is copy, explicitly in-scope per the
  card's fence ("Copy + deep-link/focus...").
- No `CardState` field changes, no new markup, no new CSS — the entire UI diff is one button label
  plus one optional CustomEvent detail. Tokens law (`--ad-*`/`--adp-*` only) has no new surface to
  violate.
- **Existing test to update** (not just extend):
  `packages/app/test/ui/lookup-card.test.ts:144-152`, `'a rejected (invalid) key keeps the error
but still offers Open Settings'`, currently asserts `.setup-cta` textContent is exactly `'Open
Settings'`. This assertion changes to `'Fix key in Settings'` (see plan Task 3).

### 3.5 Composition roots

**`packages/extension-chrome/src/content.ts`** (lines 141-143): the `open-settings` listener reads
the event's detail and forwards it on the wire:

```ts
document.addEventListener('open-settings', (e) => {
  const fixKey = (e as CustomEvent<{ fixKey?: boolean } | undefined>).detail?.fixKey === true;
  void chrome.runtime.sendMessage({ type: 'open-options', fixKey });
});
```

**`packages/extension-chrome/src/side-panel.ts`** (lines 170-174): the panel is a trusted extension
page (like `options.ts`, unlike a content script) and already skips the wire, calling
`chrome.runtime.openOptionsPage()` directly. This asymmetry with `content.ts` **already exists** in
the codebase today (its own comment: "The panel is an extension page, so it can open the options
page directly") — C6 mirrors it rather than unifying it, exactly as B5 kept `content.ts` and
`side-panel.ts` as two independent, un-synced composition roots (B5 design spec §3.6):

```ts
view.addEventListener('open-settings', (e) => {
  const fixKey = (e as CustomEvent<{ fixKey?: boolean } | undefined>).detail?.fixKey === true;
  void (async () => {
    if (fixKey) await chrome.storage.local.set({ [FIX_KEY_PENDING_STORAGE_KEY]: '1' });
    await chrome.runtime.openOptionsPage();
  })();
});
```

Writing the literal string `'1'` here (not a raw boolean) matches exactly what the router's
`deps.kv.setItem(FIX_KEY_PENDING_STORAGE_KEY, '1')` path stores (§3.3) — both write paths land the
same representation at the same `chrome.storage.local` key, so `options.ts`'s read side (§3.7)
never has to branch on shape. `FIX_KEY_PENDING_STORAGE_KEY` is imported from `@ai-dict/app`
(already an existing import source in this file).

This is S1-safe: neither composition root reads or writes the API key itself — the flag never
carries key material, only a boolean-shaped UI signal (`api-key-isolation.md`'s "content script
must never read chrome.storage.local settings directly" is not implicated either, since the flag
key is entirely separate from the `settings` object the rule protects, and `content.ts` never
touches storage at all in this design — only `side-panel.ts`, itself a trusted extension page, and
only for this one namespaced flag key).

### 3.6 `SettingsForm` — `packages/app/src/ui/settings-form.ts`

Two new public methods, plus one private field (`_autoRetestArmed = false`):

```ts
/**
 * C6: entered once, right after mount, when options.ts finds the invalid-key deep-link flag
 * pending. Focuses the key field (revealing the env-lock notice via the existing focus listener,
 * lines 267-269, if the field happens to be locked) and shows likely-cause copy on the existing
 * status line. Arms exactly one auto-retest, consumed by the very next Save.
 */
enterFixKeyMode(): void {
  this._autoRetestArmed = true;
  const key = this.q<HTMLInputElement>('#key');
  key.focus();
  if (!this.isKeyLocked()) key.select();
  this.setStatus(
    "Your key was rejected. Common causes: a typo, an expired or revoked key, or a key copied " +
      "for a different provider. Paste the correct key and Save — we'll retest it for you.",
    'error',
  );
}

/** One-shot consume: true exactly once, for the Save immediately following enterFixKeyMode(). */
consumeAutoRetest(): boolean {
  const armed = this._autoRetestArmed;
  this._autoRetestArmed = false;
  return armed;
}
```

No new markup, no new CSS: `enterFixKeyMode` reuses the existing `#key` input and the existing
`#status` element/`setStatus()` method verbatim (`settings-form.ts:493-498`). "Likely causes
listed" (the card's own wording) is satisfied as one sentence on the existing status line, not a
new list element — keeping the diff to behavior + copy, per the fence.

### 3.7 Composition root — `packages/extension-chrome/src/options.ts`

**Mount-time flag check**, inside `mountSettings` (after `wireSettings(form)`, `options.ts:90`):

```ts
void chrome.storage.local.get(FIX_KEY_PENDING_STORAGE_KEY).then((stored) => {
  if (!stored[FIX_KEY_PENDING_STORAGE_KEY]) return;
  void chrome.storage.local.remove(FIX_KEY_PENDING_STORAGE_KEY);
  form.enterFixKeyMode();
});
```

This is a direct `chrome.storage.local` read, same as `load()` (`options.ts:44-48`) already does
for the full `Settings` object — `options.ts` is a trusted extension page, not a content script,
so this does not implicate S1 (`api-key-isolation.md` forbids a _content script_ reading settings
directly; it says nothing about the options page, which already reads the API key itself to
populate the form).

**Auto-retest on save**, inside the existing `save` listener (`wireSettings`, `options.ts:114-133`):

```ts
form.addEventListener('save', (e) => {
  const next = (e as CustomEvent<SettingsFormValue>).detail;
  const shouldRetest = form.consumeAutoRetest();
  const configured: Provider[] = [];
  if (next.apiKey) configured.push('gemini');
  if (next.openaiApiKey) configured.push('openai');
  if (next.anthropicApiKey) configured.push('anthropic');
  void load()
    .then((cur) =>
      chrome.storage.local.set({
        settings: { ...cur, ...next, hasKey: hasKeyFor(next), configuredProviders: configured },
      }),
    )
    .then(
      () => {
        (form as unknown as HTMLElement).setAttribute('data-ad-theme', next.theme);
        if (shouldRetest) {
          form.setStatus('Testing your updated key…');
          void send({ type: 'connection.test' }).then(
            (r) =>
              r.ok
                ? form.setStatus('Connection OK — your key is working')
                : form.setStatus(r.error.message, 'error'),
            () => form.setStatus('Could not reach the service worker', 'error'),
          );
        } else {
          form.setStatus('Settings saved');
        }
      },
      () => form.setStatus('Could not save settings', 'error'),
    );
});
```

`consumeAutoRetest()` is read **before** the persist promise starts (so a second, concurrent save
click during the async gap can never double-consume the same arm-once flag) but the retest itself
fires **after** persistence resolves, inside the same `.then()` chain the "Settings saved" message
already lives in — this makes the ordering deterministic (persist → report) with no risk of a
"Settings saved" and a "Connection OK" message racing each other into `#status`. This is the same
`connection.test` message the pre-existing `#test`/`test-connection` listener
(`options.ts:150-156`) already sends and interprets — no new wire round trip, no new error
handling: `connection.test`'s reply shape (`WireReply`'s `ok:false, type:'connection.test'`
variant) is read identically in both places.

## 4. Decision: the auto-retest is user-triggered (constraint 4 — argued, not assumed)

Category C's standing walls (verbatim from roadmap §3, constraint 4) require: **"every LLM call is
triggered by an explicit user action, and features that spend tokens say so first."** The team's
brief asked this to be argued explicitly rather than assumed, and to fall back to an explicit
pre-focused button if the reading is unsafe. Argument for the safe (auto-run) reading, not the
fallback:

1. **Direct precedent already exists in this exact category.** C2 (Verified activation)'s own
   scope fence states: "Exactly one test call per explicit 'Save & activate' click (constraint 4
   holds: user-triggered...)." C2 establishes, for this very roadmap, that a `connection.test`
   call firing as the **synchronous, same-tick continuation of an explicit Save click** — not a
   background timer, not a hover, not a page-load side effect — satisfies constraint 4. C6's
   "Save settings" → auto-retest is the identical shape: one explicit click, one immediate,
   visibly-announced token-spending call, zero delay, zero re-triggering.
2. **The trigger is stricter than C2's, not looser.** C6's retest is armed by exactly one prior
   event (landing via the INVALID_KEY card's CTA) and consumed by exactly one Save
   (`consumeAutoRetest()`, §3.6) — a normal, unrelated Settings save never spends a token. C2's
   fence permits one call per Save-and-activate click generally; C6 is a strict subset of that
   already-accepted behavior, gated even tighter.
3. **"Say so first" is satisfied by the existing status-line convention.** The moment the retest
   starts, `form.setStatus('Testing your updated key…')` renders before the wire message is even
   sent (§3.7) — identical visibility to the pre-existing manual `#test` button's own
   `'Testing connection…'` message (`options.ts:151`). The reader sees the spend announced, exactly
   as constraint 4 requires, before any network call fires.
4. **The alternative (an explicit, pre-focused "Retest" button) reproduces today's exact failure
   mode.** The card's own **Missing** bullet is precisely "no retest... the user must find 'Test
   connection' themselves." A pre-focused-but-still-manual button still requires the reader to
   notice and click a second control after fixing the key — the card's stated **Payoff**
   ("focused field → paste → auto-retest → back to reading") is only true if the retest is
   automatic. Choosing the fallback would silently cut the card's headline value while claiming to
   satisfy it — the kind of scope-fence erosion the roadmap explicitly says to escalate rather
   than do quietly. There is nothing here that needs escalating: constraint 4 is satisfied by the
   C2 precedent, so the auto-run reading is taken, not escalated.

## 5. Scope fence (from the card, held exactly)

- **Copy + deep-link/focus only** — no new error taxonomy: `INVALID_KEY` is the only code this
  card touches; `error-mapper.ts` is unchanged (no diff to that file appears anywhere in this
  plan).
- **No provider-specific diagnosis beyond the existing error mapper** — the "likely causes" copy
  (§3.6) is generic across providers (typo / expired-revoked / wrong-provider), not a per-provider
  branch; the existing `NAMES`/`vendor` wording in `error-mapper.ts` already handles the
  per-provider _message_ (`"${vendor} rejected the API key."`), which this card does not touch.
- **Reuse of the existing `connection.test`** — no new wire message for the test itself; the one
  new wire field (`open-options.fixKey`) is deep-link plumbing, not a new lookup/test round trip.
- **No new manifest permissions** — verified in §2.1; the chosen mechanism (a storage flag) adds
  none, and the rejected alternative (`tabs.create`) would also have needed none.
- **No product-promise / privacy-surface change** — no new §6 escalation, per the Category C intro.

## 6. Testing strategy

1. **Wire schema test** (`packages/app/test/wire-schema.test.ts`, extending the existing
   `'accepts open-options message'` block at line 135-137): `open-options` with `fixKey: true` and
   with `fixKey` omitted both parse; `fixKey: 'yes'` (wrong type) is rejected. Snapshot
   regenerated (`wire-schema.snapshot.json`).
2. **Router tests** (`packages/app/test/app/router.test.ts`, extending the existing `open-options`
   block at lines 587-599): `open-options` with `fixKey: true` calls `deps.kv.setItem` with
   `FIX_KEY_PENDING_STORAGE_KEY` and `'1'` **before** `openOptions()` resolves (order matters:
   assert via a spy on both, or assert the flag is already in the fake KV by the time
   `openOptions` is invoked); `open-options` with `fixKey: false`/omitted never calls `setItem`;
   the `openOptions`-absent case (existing test, line 595-599) is unaffected either way.
3. **UI component tests** (`packages/app/test/ui/lookup-card.test.ts`): update the existing
   INVALID_KEY test (lines 144-152) for the new label; add a test that clicking the INVALID_KEY
   CTA fires `open-settings` with `detail: { fixKey: true }` (mirrors B5's own
   `toggle-status`-detail test pattern); add a test that the `NO_KEY` CTA's `open-settings` event
   still carries no meaningful `fixKey` (i.e. `detail` is `undefined` or `{fixKey: undefined}` —
   assert falsy) — a regression guard for the "zero behavior change for every other caller" claim
   in §3.4.
4. **`SettingsForm` unit tests** (`packages/app/test/ui/settings-form.test.ts`):
   `enterFixKeyMode()` focuses `#key`, calls `setStatus` with an error-toned message containing
   "rejected"; `consumeAutoRetest()` returns `true` exactly once after `enterFixKeyMode()` and
   `false` on every call before it or after the first consume.
5. **e2e functional test** (new `packages/extension-chrome/e2e/c6-invalid-key-recovery.spec.ts`,
   modeled on `lookup-errors.spec.ts`'s mock-shape and `saved-word.spec.ts`'s
   seed/lookup/storage-dump pattern): the full recovery loop —
   - `mockGemini(context, { status: 400, body: '{"error":{"status":"INVALID_ARGUMENT"}}' })`
     (exact shape already proven in `lookup-errors.spec.ts:22-25`).
   - seed settings with a key, look up a word, assert the card shows "Google rejected the API
     key." and a `.setup-cta` button reading "Fix key in Settings".
   - click it; assert the options tab (`chrome-extension://<id>/options.html`) that
     `chrome.runtime.openOptionsPage()` opens shows the settings screen with `#key` focused and
     `#status` containing "rejected" copy.
   - re-mock Gemini with a 200 (`mockGemini(context, { status: 200 })` — a second call to
     `context.route()` on the same glob takes priority over the first per Playwright's
     most-recently-registered-handler-wins routing, so no explicit unroute is needed), type a new
     key into `#key`, click Save.
   - assert `#status` eventually reads "Connection OK — your key is working" (the auto-retest
     fired with no manual "Test connection" click) and that `chrome.storage.local`'s `settings`
     reflects the new key.
6. **Full build gate**: `bun run build:chrome` for both the unit-covered composition-root
   typechecks and the e2e run must be invoked with `GEMINI_API_KEY` cleared —
   `GEMINI_API_KEY= bun run build:chrome` — per the live 2026-07-16 flake: a key exported in the
   builder's shell (`~/.zshrc`) bakes into the bundle via `esbuild.config.mjs:12-13`
   (`GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? ''`), which flips `KEY_FROM_ENV` true in
   `options.ts:28`, and `KEY_FROM_ENV` unconditionally routes to `mountSettings` regardless of
   `hasKeyFor` (`options.ts:211`) — indistinguishable from this card's own `mountSettings` path,
   so an un-cleared env key would make the e2e spec pass or fail for the wrong reason.

## 7. Testing performed (PR body — owner ruling 2026-07-16)

Per the current evidence convention (`CLAUDE.md`: "do NOT capture screenshots/videos for PRs...
every PR body carries a written 'Testing performed' section instead"), this card ships **no**
before/after media. The PR body's "Testing performed" section lists: unit suites run + pass
counts (wire-schema, router, lookup-card, settings-form), the new e2e spec's scenario name and
result, and the gate commands executed (`bun run lint && bun run format:check`,
`GEMINI_API_KEY= bun run build:chrome`, `bunx playwright test c6-invalid-key-recovery
lookup-errors saved-word`) — the last two names are the regression guards (INVALID_KEY message
wording unaffected; the pre-existing star/save flow unaffected).

## 8. Risk / rollback

- **Risk: low.** Additive-only: one new domain file (a single string constant), one optional wire
  field on an existing message, one router branch gated by that new optional field, one optional
  parameter on an existing UI factory function (every existing call site keeps working unchanged),
  two composition-root listener edits that both fall back to today's exact behavior when
  `fixKey` is absent, two new `SettingsForm` methods that are no-ops unless explicitly called, and
  one new branch in `options.ts`'s existing `save` handler gated by a one-shot flag that is `false`
  on every normal save. Nothing existing is modified in a breaking way.
- **No data migration**: the new storage key (`ui:fixKeyPending`) is transient (written, read,
  deleted within one options-page load) and holds no user data — rollback removes the code path;
  any stray leftover flag value is inert (read-once, never re-checked outside `mountSettings`).
- **Rollback:** revert the single PR (regular merge, non-squash, per the repo's no-squash policy —
  the merge commit has exactly 2 parents, so `git revert -m 1 <merge-sha>` cleanly undoes it).

## 9. Files touched (summary)

| File                                                            | Change                                                     |
| --------------------------------------------------------------- | ---------------------------------------------------------- |
| `packages/app/src/domain/ui-flags.ts`                           | new — `FIX_KEY_PENDING_STORAGE_KEY`                        |
| `packages/app/src/index.ts`                                     | + re-export `ui-flags.ts`                                  |
| `packages/app/src/wire.ts`                                      | `open-options` gains optional `fixKey`                     |
| `packages/app/src/app/router.ts`                                | `open-options` case writes the flag when `fixKey`          |
| `packages/app/src/ui/lookup-card.ts`                            | `settingsCta` gains `opts.fixKey`; INVALID_KEY CTA relabel |
| `packages/app/src/ui/settings-form.ts`                          | + `enterFixKeyMode()`, `consumeAutoRetest()`               |
| `packages/extension-chrome/src/content.ts`                      | `open-settings` listener forwards `fixKey`                 |
| `packages/extension-chrome/src/side-panel.ts`                   | `open-settings` listener sets the flag directly            |
| `packages/extension-chrome/src/options.ts`                      | mount-time flag check; save handler auto-retest            |
| `packages/app/test/wire-schema.test.ts`                         | + tests                                                    |
| `packages/app/test/app/router.test.ts`                          | + tests                                                    |
| `packages/app/test/ui/lookup-card.test.ts`                      | update existing test + new tests                           |
| `packages/app/test/ui/settings-form.test.ts`                    | + tests                                                    |
| `packages/extension-chrome/e2e/c6-invalid-key-recovery.spec.ts` | new — functional e2e (full recovery loop)                  |
| `packages/app/wire-schema.snapshot.json`                        | regenerated                                                |

No change to `packages/app/src/domain/error-mapper.ts`, `packages/app/src/domain/types.ts`, or
`packages/app/src/ports.ts` — confirmed by no diff to those files appearing anywhere above (§5's
"no new error taxonomy" fence held).
