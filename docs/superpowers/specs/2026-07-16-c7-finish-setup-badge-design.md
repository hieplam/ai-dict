# C7 — Finish-setup toolbar badge (design)

Roadmap card: `docs/ROADMAP.md` §4 C7 (Impact 3 · Effort S · Score 3.0). Depends on: — (no other
C-idea). Standing walls inherited from the Category C intro (`docs/ROADMAP.md` §4, "Standing walls
all C-ideas inherit"): no backend/accounts · every LLM call user-triggered · **no new manifest
permissions** · privacy surface unchanged · S1 key isolation.

## 1. Problem (grounded in code)

A keyless install and a configured install render an identical toolbar icon today —
`packages/extension-chrome/src/manifest.json:43-51` declares only `default_title`/`default_icon`
on the `action` key; nothing in `sw.ts` ever calls `chrome.action.setBadgeText`/`setTitle`/
`setBadgeBackgroundColor` (grep confirms zero hits for `badge` anywhere in the repo — this is a
greenfield change, no prior art to preserve). If a new user closes the welcome tab that C1 will
someday open, or never reaches it, the extension goes permanently silent: no toolbar signal, no
retry path, nothing short of the user remembering to right-click → Options.

**What "usable key" already means, precisely, in this codebase:**

- `hasKeyFor(s)` (`packages/app/src/domain/types.ts:183-193`) answers "does the **selected**
  provider have a key?" — `apiKey` for `'gemini'` (the default when `provider` is absent),
  `openaiApiKey` for `'openai'`, `anthropicApiKey` for `'anthropic'`. Fully unit-tested already
  (`packages/app/test/types.test.ts:48-93`).
- `options.ts`'s onboarding router (`packages/extension-chrome/src/options.ts:209-213`) gates on
  `KEY_FROM_ENV || hasKeyFor(s)`, where `KEY_FROM_ENV = __GEMINI_KEY_FROM_ENV__`
  (`options.ts:28`) — a build-time boolean baked by esbuild.
- `ChromeStorageStore.get()` (`packages/extension-chrome/src/adapters/chrome-storage-store.ts:44-
59`) computes `PublicSettings.hasKey` as `hasKeyFor(s ?? {}) || this.envGeminiKey` (line 54) —
  **the identical boolean expression**, just phrased as an OR over a constructor-injected flag
  instead of a module-level `const`. `envGeminiKey` is supplied by `sw.ts:103`,
  `new ChromeStorageStore(chrome.storage.local, Boolean(ENV_API_KEY))`, where
  `ENV_API_KEY = __GEMINI_API_KEY__` (`sw.ts:59`).
- **Both booleans trace back to the same build-time source**, `esbuild.config.mjs:12-13`:
  `const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? ''; const HAS_ENV_KEY =
GEMINI_API_KEY.length > 0;`. `options.js`/`side-panel.js` get `HAS_ENV_KEY` directly as
  `__GEMINI_KEY_FROM_ENV__` (`esbuild.config.mjs:69,78`); `sw.js` gets the raw key string as
  `__GEMINI_API_KEY__` (`esbuild.config.mjs:31`), and `sw.ts` derives the same boolean itself via
  `Boolean(ENV_API_KEY)`. **`sw.ts` does not have `__GEMINI_KEY_FROM_ENV__` defined in its own
  esbuild step** (`esbuild.config.mjs:25-35` only defines `__GEMINI_API_KEY__`,
  `__GA4_MEASUREMENT_ID__`, `__GA4_API_SECRET__`) — referencing that identifier inside `sw.ts`
  would throw at runtime (undefined global), exactly the failure mode
  `esbuild.config.mjs:76-78`'s comment warns about for the side-panel build. This is a load-bearing
  fact for §2/D1 below: the SW-side badge code must derive its env-key boolean from
  `Boolean(ENV_API_KEY)` (already in scope), never from `__GEMINI_KEY_FROM_ENV__`.

No wire message, router case, or UI component is involved — this is a pure service-worker /
domain change, the smallest surface of any C-idea reviewed so far.

## 2. Design decisions (all made; executor does not re-open)

### D1 — The badge predicate is `PublicSettings.hasKey`, not a new function

The card asks for "the exact same predicate `options.ts` uses (`hasKeyFor`/`configuredProviders`)
so badge and onboarding routing can never disagree." That predicate, applied to a settings object
plus an env-key flag, is already computed in exactly one place per bundle:
`ChromeStorageStore.get(): Promise<PublicSettings>` — and `sw.ts` already owns an instance of it
(inlined at `sw.ts:103` as the router's `settings` dependency). **No new domain predicate is
introduced.** `sw.ts` is changed to hoist that instance into a named `const settingsStore` (used
by both the router and the badge refresh), and the badge refresh reads `(await
settingsStore.get()).hasKey`.

This is provably the same boolean `options.ts` computes for onboarding routing: both ultimately
evaluate `hasKeyFor(settings) || <env-key boolean>` over the same persisted `settings` object,
where `<env-key boolean>` is `HAS_ENV_KEY` in both cases (by construction of
`esbuild.config.mjs`, not by coincidence — see §1). Reusing the live `ChromeStorageStore` instance
rather than re-deriving anything means there is only one call site that can ever drift from
`hasKeyFor`'s contract inside the SW.

### D2 — What IS new, and why it's still a pure function: badge **state**, not badge **predicate**

`hasKey: boolean` alone isn't quite the shell's job to translate into three separate `chrome.action`
calls (text, title, color) inline — that would put presentation literals (`'!'`, the copy string)
directly in the composition root with no unit-test seam, contrary to the repo's test-first
standard. `packages/app/src/domain/badge-policy.ts` (new) adds one pure function:

```ts
export interface BadgeState {
  /** '' clears the badge; '!' is the only non-empty glyph in v1 (roadmap C7 scope fence: a
   *  no-key indicator only, never a general notification channel). */
  text: '' | '!';
  /** Tooltip override text. '' means "no override" — the shell restores its own default title
   *  (badge-policy.ts has no access to — and must not hardcode — the manifest's default_title,
   *  see D4). */
  title: string;
}

/**
 * C7: derive the toolbar badge state from the exact same "usable key" boolean onboarding routing
 * uses (PublicSettings.hasKey — see hasKeyFor/configuredProvidersFor, domain/types.ts). Pure:
 * no chrome.*, unit-testable without a browser (rule-domain-purity; the "should badge show?"
 * question is the test-first seam the card's brief calls for).
 */
export function badgeStateFor(hasUsableKey: boolean): BadgeState {
  return hasUsableKey
    ? { text: '', title: '' }
    : { text: '!', title: 'Finish AI Dictionary setup' };
}
```

Exported from `packages/app/src/index.ts` alongside the other `domain/*-policy` modules
(`export * from './domain/badge-policy';`, next to line 9's `saved-words-policy` export).

### D3 — When to evaluate: SW startup (module top-level) AND `chrome.storage.onChanged`

MV3 service workers are ephemeral — `sw.ts` today holds no state that survives a restart except
`lastSidePanelFocus` (`sw.ts:33`), which is itself reset to a fresh in-memory default on every
wake, exactly the pattern the badge must follow: **re-derive from storage on every SW start, never
cache the boolean.** Concretely:

1. **On SW startup** — a `void refreshSetupBadge()` call at module top level. Every module
   evaluation IS a SW start in MV3 (there is no separate "ready" hook to wait for); this matches
   how `sw.ts`'s existing listeners (`chrome.runtime.onMessage`, `chrome.commands.onCommand`) are
   themselves just top-level `addListener` calls, registered fresh every wake.
2. **On `chrome.storage.onChanged`** — because activation (`connection.test` passing → `saved &
activation` persisting the new key via `settings.set` — the exact path C2 will build) happens
   while the SW is _already running_; only re-registering the listener on startup would miss every
   in-session activation. `chrome-storage-store.ts`'s `read()` (lines 39-42) performs no caching —
   every `.get()` call re-reads `chrome.storage.local` fresh — so `refreshSetupBadge` calling
   `settingsStore.get()` is always current; no invalidation flag is needed, only a re-trigger.
   Filter on `areaName === 'local' && 'settings' in changes` (the same two-part guard the wire
   protocol implicitly relies on — `settings` is the one key `SettingsStore` ever touches). This
   also means: if a configured install later loses its key (cleared in settings), the badge
   reappears — a deliberate symmetry, not scope creep (the card's "clear the moment activation
   succeeds" implies the converse holds too; nothing in the scope fence forbids it).

There is repo precedent for exactly this "subscribe to `chrome.storage.onChanged`, re-derive, no
cache" shape: `MessageRelaySettingsStore`
(`packages/extension-chrome/src/adapters/message-relay-settings-store.ts:6-13`) takes an injectable
`subscribe` callback defaulting to `(cb) => chrome.storage.onChanged.addListener(cb)` and
invalidates a cache on fire. C7's badge doesn't need a cache to invalidate (there is nothing to
invalidate — see above) — it just re-runs `refreshSetupBadge` directly — but the "subscribe to
`onChanged`, treat every fire as a full recompute" shape is the same idea already reviewed and
shipped in this codebase.

### D4 — Restoring the default title: read the manifest at runtime, never hardcode a second copy

`badgeStateFor(true).title === ''` (D2) is deliberate: `packages/app/src/domain/` must not know
Chrome's `manifest.json` string (`action.default_title`, `manifest.json:44`) — hardcoding
`'AI Dictionary'` a second time in the portable core would create exactly the kind of duplicated
literal that drifts silently (rename the extension once, and one of the two copies goes stale with
no compiler error). Instead `sw.ts` reads it once, itself, at the composition-root layer where
`chrome.runtime.getManifest()` already lives (`sw.ts:75` already calls
`chrome.runtime.getManifest().version` for GA4 metadata — same API, new field):

```ts
const DEFAULT_ACTION_TITLE = chrome.runtime.getManifest().action?.default_title ?? 'AI Dictionary';
```

`refreshSetupBadge` then sets `chrome.action.setTitle({ title: state.title || DEFAULT_ACTION_TITLE })`.
The `?? 'AI Dictionary'` fallback only fires if `manifest.json` ever drops `action.default_title`
entirely — belt-and-braces, not the primary path.

### D5 — Badge color: a named hex constant in the shell, sourced from `--ad-error`, flagged for tracker review

The non-negotiable token law (`CLAUDE.md` project section, "Frontend design system") is: **UI
components** read only `--ad-*`/`--adp-*` custom properties, never a hard-coded hex. `sw.ts` is not
a UI component — it is a Chrome MV3 service worker with **no DOM and no CSSOM**; there is no
`getComputedStyle`, no stylesheet, nothing that could resolve `var(--ad-error)` even if the string
were typed in, because `chrome.action.setBadgeBackgroundColor({ color })` takes a literal color
value the browser chrome (not a web page) paints — it is Chrome's own toolbar UI, structurally
outside the shadow-DOM component tree the token law governs (`ref-web-components-shadow-dom`,
`c3-117 ui-components`).

Given that, the least-drift option is: **pick the token whose intent matches** ("needs attention" /
error-adjacent — not the brand accent), convert it once, and pin it behind a named constant with a
comment citing the exact token line, so a future palette change in `tokens.css` is at least
discoverable by grep even though it can't be mechanically kept in sync:

```ts
// C7: toolbar badge background. Chrome's action API paints this outside any DOM/CSSOM this
// extension controls, so it cannot read `var(--ad-error)` live — this is a fixed sRGB conversion
// of design-system/tokens.css's SEPIA `--ad-error: oklch(0.520 0.160 28)` (tokens.css:122), the
// closest existing token to "needs attention". NOT a UI-component color (the no-hard-coded-hex
// law binds `ui/` shadow-DOM components — ref-web-components-shadow-dom — not chrome.action calls
// in this composition root); flagged here for the tracker reviewer as an intentional, justified
// exception, not an oversight.
const BADGE_COLOR = '#b33830';
```

Verified by hand (OKLab→linear-sRGB→sRGB, D65, matching the CSS Color 4 conversion the browser
itself uses for `oklch()`): `oklch(0.520 0.160 28)` → `rgb(179, 56, 48)` → `#b33830`. Only the
sepia value is used — `chrome.action`'s badge paints once, globally, with no concept of the
extension's own `data-ad-theme` (there is exactly one browser-chrome color per install, matching
the existing precedent that `icons/icon-*.png` are also single, non-theme-swapped assets
(`manifest.json:7-12,45-50`) — the toolbar chrome already doesn't retheme with the page).

### D6 — Wiring stays entirely in the shell; zero new wire/router surface

Unlike every other C/B card reviewed, C7 touches **no wire message and no router case** — the
badge is derived and painted entirely inside `sw.ts` from state `sw.ts` already owns
(`chrome.storage.local` via `ChromeStorageStore`). This keeps `rule-domain-purity` trivially
satisfied (only the one new pure file in `domain/`) and needs no `S3`/`classifyInbound` gate
(nothing crosses `chrome.runtime.onMessage`).

### D7 — No manifest change

`chrome.action.setBadgeText`/`setTitle`/`setBadgeBackgroundColor` require no permission — the
`action` manifest key already exists (`manifest.json:43-51`) purely to declare `default_title`/
`default_icon`; MV3's `action` surface (unlike MV2's `browserAction`) needs no entry under
`"permissions"` at all. `manifest.test.ts:5-10` already pins `permissions` to exactly
`['storage', 'sidePanel']` — this plan adds no line to that array, and that test's exact-match
assertion is the regression guard that would fail loudly if it ever did.

## 3. Scope fence (from the card, held exactly)

- **Badge is only a no-key indicator in v1** — not a general notification channel. `badgeStateFor`
  has exactly two return shapes; nothing else can set the badge.
- **Env-key builds never show it.** `hasUsableKey` is `hasKeyFor(s) || Boolean(ENV_API_KEY)` — an
  env-baked key makes `hasUsableKey` true unconditionally, so `badgeStateFor` returns the
  clear-badge shape regardless of stored settings (mirrors `options.ts:211`'s
  `KEY_FROM_ENV || hasKeyFor(s)` exactly).
- **No new permission.** See D7.
- **No new wire message / router case / UI surface.** See D6.

## 4. Testing strategy

1. **Domain unit tests** (`packages/app/test/badge-policy.test.ts`, new): `badgeStateFor(false)` →
   `{ text: '!', title: 'Finish AI Dictionary setup' }`; `badgeStateFor(true)` →
   `{ text: '', title: '' }`. Pure, no mocks.
2. **No dedicated `sw.ts` unit test** — there is no existing `sw.test.ts` in the repo (`sw.ts` is
   the composition root; it is proven only by e2e, the same precedent B5/B7 already established for
   `content.ts`/`side-panel.ts` edits). The gate commands (typecheck, lint) still catch a
   regression in `sw.ts`'s existing behavior immediately.
3. **e2e** (new `packages/extension-chrome/e2e/c7-badge.spec.ts`): a fresh profile (the existing
   `fixtures.ts:39-44` `beforeEach` already clears `chrome.storage.local` before every test) shows
   `chrome.action.getBadgeText({})` === `'!'` and `chrome.action.getTitle({})` ===
   `'Finish AI Dictionary setup'`, evaluated in the **service worker's own context**
   (`context.serviceWorkers()[0].evaluate(...)`, the same SW-context-evaluation pattern
   `saved-word.spec.ts`'s `swStorageDump` already uses for `chrome.storage.local.get`). Seeding a
   key via the existing `seedSettings` helper (`helpers.ts:39-59`, default `apiKey: 'AIza-test'`,
   `hasKey: true`) and waiting (`expect.poll`) for the badge to clear to `''` and the title to
   revert to the manifest's `default_title` proves the `onChanged` re-derivation path (D3) end to
   end, not just the SW-startup path.
4. **Build hygiene (live flake, 2026-07-16 audit):** the e2e build **must** run with
   `GEMINI_API_KEY` unset in the shell. If a developer's `~/.zshrc` exports a real key,
   `esbuild.config.mjs:12-13` bakes `HAS_ENV_KEY = true` into `sw.js`, making `hasUsableKey` true
   unconditionally and the fresh-profile badge assertion fails — this is the exact class of flake
   the roadmap's C10 card already names for the onboarding e2e specs; C7's new spec inherits the
   same risk and must run `GEMINI_API_KEY= bun run build:chrome` (empty override) before
   `bunx playwright test c7-badge`, same as any other onboarding-adjacent e2e in this category.

## 5. Files touched (summary)

| File                                             | Change                                                                                          |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `packages/app/src/domain/badge-policy.ts`        | new — `badgeStateFor` pure function                                                             |
| `packages/app/src/index.ts`                      | + `export * from './domain/badge-policy';`                                                      |
| `packages/app/test/badge-policy.test.ts`         | new — unit tests                                                                                |
| `packages/extension-chrome/src/sw.ts`            | hoist `settingsStore`; + `refreshSetupBadge`, startup call, `chrome.storage.onChanged` listener |
| `packages/extension-chrome/e2e/c7-badge.spec.ts` | new — functional e2e                                                                            |

No change to `packages/extension-chrome/src/manifest.json`, `packages/app/src/wire.ts`,
`packages/app/src/app/router.ts`, `packages/app/src/ports.ts`, or any `ui/` component.

## 6. Risk / rollback

- **Risk:** low. Additive-only: one new pure domain file, one hoisted-but-unchanged dependency
  instance in `sw.ts`, one new startup call, one new storage listener. Nothing existing changes
  behavior — the router's `settings` dependency is the same `ChromeStorageStore` instance it
  always was, just no longer constructed inline. The only externally-visible new effect is the
  badge itself.
- **Rollback:** revert the single PR. No stored data shape changes — `PublicSettings.hasKey` is
  read-only from the badge's perspective; nothing is written that didn't already exist.

## 7. Self-review (no TBD, no contradictions)

- Every claim above cites a `file:line` verified by reading the file directly in this session.
- D1–D7 are individually decided; none defers a choice to the implementer.
- The one deliberate deviation from this repo's most recent same-topic exemplars (B5's design/plan
  pair): **no video/screenshot evidence plan.** The current, binding ruling
  (`CLAUDE.md` "Evidence policy (owner ruling 2026-07-16)" and
  `.claude/rules/workflow-conventions.md`) retires media capture for PRs in favor of a written
  "Testing performed" section — B5's design/plan pair (dated the same calendar day) predates that
  ruling being encoded; B3's plan (`docs/superpowers/plans/2026-07-16-b3-re-encounter-
highlighting.md:247-257`) already reflects it. This spec has no evidence section for that reason
  (evidence lives in the plan's PR section, not the design doc, matching both exemplars); the
  companion plan uses B3's "Testing performed" shape, not B5's video-spec shape.
- **Open question for the owner/Warchief, not a TBD:** none. Badge glyph (`'!'`) and copy
  ("Finish AI Dictionary setup") are taken verbatim from the card's own "Missing" line
  (`docs/ROADMAP.md:687-688`), which the card's own "Lead decides" line reserves only the
  glyph/color choice for — both are decided above (D2, D5).
