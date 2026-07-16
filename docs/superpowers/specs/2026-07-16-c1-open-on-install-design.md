# C1 — Open onboarding on install

Roadmap card: `docs/ROADMAP.md` §4 Category C, C1 (Impact 5 · Effort S · Score 5.0 · **foundation**).
Depends on: none. Sequencing note (§4 Category C intro): the roadmap lists C10 (funnel e2e proof
harness) ahead of C1, but C10 is not yet implemented in this worktree (no
`docs/superpowers/{specs,plans}/*c10*` file exists) — this plan is self-contained and does not
block on it (§5 documents the one place C10's territory overlaps this card's own gates).

## 1. Problem (grounded in code)

`packages/extension-chrome/src/sw.ts` (read in full, 200 lines) registers exactly three listeners:
`chrome.runtime.onMessage` (line 116), `chrome.commands.onCommand` (line 189), and a
`chrome.sidePanel.setPanelBehavior` startup call (line 199). **There is no
`chrome.runtime.onInstalled` listener anywhere in the file** — confirmed by
`grep -rn "onInstalled" packages/` returning zero hits in the whole repo. Installing the extension
today does nothing at all.

The welcome screen exists and works — `options.ts`'s routing (lines 209–213):

```ts
void load().then((s) => {
  if (KEY_FROM_ENV || hasKeyFor(s)) mountSettings(s);
  else mountOnboarding(s);
});
```

— mounts `<onboarding-view>` (`mountOnboarding`, lines 181–207) whenever no usable key exists. But
this code only ever runs once a human navigates to `options.html`, and today that happens by one of
two accidents only:

1. **The no-key card's "Open Settings" button**, proven by `onboarding.spec.ts`'s existing test
   (`"no-key card shows the setup invite..."`, lines 45–70): select text → the in-page card renders
   `.setup-cta` → click → `content.ts` sends `{ type: 'open-options' }` → the router's
   `deps.openOptions?.()` (`router.ts:273`, wired in `sw.ts:112` as
   `() => chrome.runtime.openOptionsPage()`) opens the tab. This requires the reader to already
   know to select text and find the ~20px Define button first.
2. **The toolbar icon → side panel**, which never shows onboarding at all — `side-panel.ts` mounts
   `<side-panel-view>` unconditionally regardless of key state (confirmed: no `hasKeyFor`/
   `KEY_FROM_ENV` branch exists in `side-panel.ts`, unlike `options.ts`).

Neither path fires on install. A brand-new user who doesn't already know the product's gesture
never sees Welcome at all — the roadmap's own funnel audit (`docs/ROADMAP.md` §4 Category C intro,
2026-07-16) names this as dead-end #1 of seven.

## 2. Decisions (the card says "deliberately minimal" — these are the only calls this plan makes)

### 2.1 Reuse `chrome.runtime.openOptionsPage()`, not `chrome.tabs.create(...)`

`sw.ts:112` already wires `openOptions: () => chrome.runtime.openOptionsPage()` as the router's
`open-options` handler, and `manifest.json:39` declares `"options_page": "options.html"` (the
legacy full-tab key, not `options_ui`) — so `openOptionsPage()` is already proven, by
`onboarding.spec.ts`'s own "no-key card" test, to open `options.html` as **exactly one new
foreground tab**. Reusing the identical call the reader's own "Open Settings" click already makes
means the install path and the manual path land on the byte-identical surface with zero new code
to open a tab — no `chrome.tabs.create` + `chrome.runtime.getURL('options.html')` duplication.

### 2.2 Env-key skip reuses the existing `ENV_API_KEY` const — no new esbuild define

`esbuild.config.mjs` defines `__GEMINI_KEY_FROM_ENV__` for `options.js` (line 69) and
`side-panel.js` (line 78) only — **not** for `sw.js`. `sw.js` instead gets the raw
`__GEMINI_API_KEY__` string (line 31), and `sw.ts:59` already derives
`const ENV_API_KEY = __GEMINI_API_KEY__;`. `Boolean(ENV_API_KEY)` is therefore already the exact
same truth value `esbuild.config.mjs`'s own `HAS_ENV_KEY` (line 13) computes for the other two
bundles — reusing it needs zero new build-time wiring, zero new `build-defines.d.ts` entry, and
stays inside the one file already reading this flag for the identical purpose (choosing the Gemini
key source, `sw.ts:86`).

### 2.3 The "should this install open onboarding?" decision is a pure function in `packages/app`

Per `ref-core-dependency-rule` (`.c3/refs/ref-core-dependency-rule.md`): "the core reaches the
outside only through port interfaces... concrete adapters are injected by the composition roots."
`sw.ts` is documented as exactly that composition root in `.c3/c3-2-extension-chrome/c3-210-chrome-service-worker.md`
("Act as the extension's service-worker composition root"). The reason/env-key check itself has no
`chrome.*` dependency, so it belongs in `packages/app/src/domain/` — mirroring the existing
precedent of `hasKeyFor`/`configuredProvidersFor` (`domain/types.ts:101,183`), two similarly small
pure predicates over `Settings`-shaped input that `sw.ts` and `options.ts` both already import and
call directly. A new `domain/onboarding-policy.ts` file (naming mirrors `cache-policy.ts`,
`history-policy.ts`, `saved-words-policy.ts`, `nudge-policy.ts` — one "policy" file per standalone
decision) keeps `sw.ts` down to the one `chrome.runtime.onInstalled` call + the openOptionsPage
side effect, and makes the decision unit-testable with zero `chrome.*` mocking (test-first rule:
"a test you cannot write easily is a signal the code is shaped wrong" — this shape needs none).

### 2.4 `packages/extension-safari` is untouched

The card's own Today/Missing text names `sw.ts` — read literally, that is
`packages/extension-chrome/src/sw.ts`. Verified by reading `packages/extension-safari/src/options.ts`
in full: it never imports `registerOnboarding` and mounts `<settings-form>` unconditionally at
module load (no `hasKeyFor`/key-state branch at all) — there is no onboarding screen in the Safari
shell for an `onInstalled` listener to open. `extension-safari/src/sw.ts` has no `onInstalled`
listener either, and Category C's standing walls (`docs/ROADMAP.md` §4 Category C intro) name only
the Chrome-driven funnel audit. This matches the precedent every shipped B-category card already
set: B5's own "Files touched" table (`docs/superpowers/specs/2026-07-16-b5-status-lifecycle-design.md:258-278`)
never touches `extension-safari` either. No Safari change is in scope here.

## 3. The change

### 3.1 Domain — `packages/app/src/domain/onboarding-policy.ts` (new file)

```ts
/**
 * C1: should a fresh extension install open the onboarding (options.html) welcome screen?
 * True only for a genuine first install ('install' — never 'update', so a version bump on an
 * already-onboarded reader's browser never re-prompts them) AND only when the build did not bake
 * a Gemini key via the env-key build path (an env-key build already counts as "set up" — mirrors
 * options.ts's own KEY_FROM_ENV skip and sw.ts's ENV_API_KEY-wins-over-stored-key resolution).
 * Pure predicate, no chrome.* access: the composition root (sw.ts) owns the actual
 * chrome.runtime.onInstalled listener and the openOptionsPage() call this gates. `reason` is
 * typed as `string`, not chrome's own OnInstalledReason union, so this file stays free of any
 * chrome.* type import (ref-core-dependency-rule) and stays portable to the Safari shell if it
 * ever grows the same onboarding screen.
 */
export function shouldOpenOnboardingOnInstall(reason: string, envKeyBaked: boolean): boolean {
  return reason === 'install' && !envKeyBaked;
}
```

Exported from `packages/app/src/index.ts` alongside the other domain policy modules:

```ts
export * from './domain/saved-words-policy';
export * from './domain/nudge-policy';
export * from './domain/onboarding-policy'; // C1
```

### 3.2 Composition root — `packages/extension-chrome/src/sw.ts`

New listener, added after the existing `chrome.commands.onCommand.addListener` block (line 196)
and before the `chrome.sidePanel?.setPanelBehavior?.(...)` startup call (line 199) — grouped with
the file's other top-level `chrome.*` side-effect registrations:

```ts
// C1: the very first thing a fresh install sees is the welcome screen, instead of the lucky few
// who stumble into it via the no-key card's "Open Settings" button or the side panel. Fires only
// on a genuine 'install' (never 'update') and is skipped when the build baked a Gemini key
// (shouldOpenOnboardingOnInstall's own doc comment). Chrome fires onInstalled exactly once per
// real install, so the reason check alone is the whole "no re-prompting loop" guarantee — no
// extra storage flag needed.
chrome.runtime.onInstalled.addListener((details) => {
  if (shouldOpenOnboardingOnInstall(details.reason, Boolean(ENV_API_KEY))) {
    void Promise.resolve(chrome.runtime.openOptionsPage()).catch(() => undefined);
  }
});
```

`.catch(() => undefined)` matches this file's own established idiom for fire-and-forget `chrome.*`
calls with no enclosing try/catch (`sw.ts:134`, `sw.ts:199`) — 3 of the file's 4 other bare
`chrome.*` side effects already do this.

Import addition at the top of `sw.ts`, alongside the existing `@ai-dict/app` import list:

```ts
import {
  mapError,
  DEFAULT_OUTPUT_FORMAT,
  configuredProvidersFor,
  shouldOpenOnboardingOnInstall, // C1
  type Settings,
  // ...unchanged
} from '@ai-dict/app';
```

### 3.3 No wire message, no router change, no manifest change

`chrome.runtime.onInstalled` needs no manifest permission (it is part of the base `runtime`
surface every extension already has) — `manifest.json`'s `permissions` array
(`["storage", "sidePanel"]`) is unchanged, and `manifest.test.ts`'s existing
`'declares only storage + sidePanel...'` assertion (line 6) is the regression guard that already
covers this: it stays green with zero edits, proving no permission crept in. This is a pure
`chrome.*` event listener, not a wire message — like `chrome.commands.onCommand`
(`sw.ts:189-196`), it never touches `classifyInbound`/`buildRouter`, so `wire.ts` and `router.ts`
are untouched.

## 4. Scope fence (from the card, held exactly)

- **Fires only on `reason === 'install'`, never `'update'`** — enforced by
  `shouldOpenOnboardingOnInstall`'s first condition, unit-tested directly (§5).
- **Exactly one tab, once — no re-prompting loop** — `openOptionsPage()` opens one tab per call
  (§2.1); Chrome fires `onInstalled` exactly once per real install, so the listener itself never
  runs twice for the same install. No new persisted "already shown" flag is introduced.
- **Skipped entirely when the build bakes an env key** — `shouldOpenOnboardingOnInstall`'s second
  condition, reusing `ENV_API_KEY` (§2.2).
- **No new manifest permission** — confirmed by `manifest.test.ts`'s existing permission assertion
  staying unmodified and green (§3.3).

## 5. Testing strategy

1. **Domain unit tests** (new `packages/app/test/onboarding-policy.test.ts`): the four branch
   combinations of `shouldOpenOnboardingOnInstall` — `('install', false) → true`,
   `('install', true) → false`, `('update', false) → false`, `('update', true) → false` — give
   100% branch coverage of the whole decision with no `chrome.*` mocking.
2. **`sw.ts` composition-root wiring**: no dedicated unit test, matching the established precedent
   for this file (it has zero existing unit tests — `find packages/extension-chrome -iname
"*sw*.test.ts"` returns nothing — and B5's own `content.ts`/`side-panel.ts` composition-root edits
   took the identical "no dedicated unit test; proven by e2e; typecheck is the regression gate"
   path, `docs/superpowers/plans/2026-07-16-b5-status-lifecycle.md` Tasks 6–7). Every task still
   runs `bun run typecheck` on both `packages/app` and `packages/extension-chrome` as its gate.
3. **e2e functional test** (new `packages/extension-chrome/e2e/c1-open-on-install.spec.ts`): the
   fixture's own `context` (`fixtures.ts:14-38`) launches `chromium.launchPersistentContext('',
{...})` — an **empty user-data-dir**, which Playwright treats as "use a fresh temporary profile,"
   so **every single e2e test in the whole suite is itself a simulated fresh install** and will,
   once this ships, fire `chrome.runtime.onInstalled({ reason: 'install' })`. The new spec asserts
   the resulting behavior directly: after the standard fixture (`context`, `extensionId`,
   `test.beforeEach`'s storage clear) finishes setting up, `context.pages()` contains exactly one
   page whose URL contains `options.html` and which renders `<onboarding-view>` — proving "opens
   exactly one tab, once" end-to-end without the test driving any click itself.
4. **Known, accepted e2e limitation** (documented, not a scope-fence break — mirrors the pattern
   B5's own spec used for its "no round-trip on fresh render" limitation,
   `2026-07-16-b5-status-lifecycle-design.md` §2 "Known, accepted limitation"): the
   `'update'`-never-fires branch and the env-key-skip branch are **not** exercised end-to-end,
   because (a) the harness's per-test fresh-profile model has no way to simulate an `'update'` on
   an already-installed profile inside the standard fixture, and (b) exercising the env-key-skip
   branch e2e would require building a second `dist/` with `GEMINI_API_KEY` set and pointing a
   second fixture at it — extra build machinery this S-effort, "deliberately minimal" card does not
   warrant. Both branches are exhaustively covered by the Task 1 unit test instead (item 1 above).
5. **Existing-suite side effect** (documented, not mitigated): once this ships, every other e2e
   spec's `context` fixture will also auto-open one extra `options.html` tab per test (same root
   cause as item 3). Checked directly — `grep -rn "context.pages()" packages/extension-chrome/e2e`
   returns zero hits, and every `context.waitForEvent('page')` call in the suite
   (`onboarding.spec.ts:64`, `settings-nav.spec.ts:55,69`, `side-panel.spec.ts:73`) fires well after
   the auto-opened tab would already exist, inside the test body after a user-driven click — so it
   waits for the _next_ page event, never the auto-opened one. No existing test's assertions
   change. Left as an accepted resource cost (one extra idle tab per test), not fixed here — a
   fixture-level cleanup, if ever needed, is a follow-up, not a dependency of this card.
6. **Local build footgun — `GEMINI_API_KEY` in the dev shell**: confirmed live in this very
   worktree's shell (`env | grep -i gemini` returns a non-empty value while authoring this plan).
   Per §2.2, any local `bun run build:chrome` run with that variable set bakes an env key and
   **every** onboarding-touching e2e test — this card's new spec and the pre-existing
   `onboarding.spec.ts` alike — fails deterministically, because `shouldOpenOnboardingOnInstall`
   correctly returns `false`. This is not new to this card (`docs/ROADMAP.md` C10's own "Today"
   text names the identical flake, found live 2026-07-16) and CI is unaffected
   (`.github/workflows/ci.yml`'s `e2e-chrome` job never sets `GEMINI_API_KEY`, and
   `release-please.yml:55` asserts it empty). Until C10 lands its permanent build-script fix, every
   task below that builds for e2e does so with the variable explicitly cleared:
   `env -u GEMINI_API_KEY bun run build:chrome`.

## 6. "Testing performed" — PR evidence (2026-07-16 policy)

Per this worktree's `CLAUDE.md` ("Evidence policy (owner ruling 2026-07-16): do NOT capture
screenshots/videos for PRs. Every PR body carries a written **"Testing performed"** section
instead") and `.claude/rules/workflow-conventions.md`'s identical instruction: **this card ships no
evidence-video e2e spec** (unlike B5's now-retired `b5-evidence.spec.ts` pattern, which predates
today's ruling by zero days but is explicitly named as superseded going forward). The PR opened
from this plan's final gate carries a written "Testing performed" section instead — suite names,
test counts, and the e2e scenarios exercised (§5, items 1 and 3), no screenshots or `.webm` files.

## 7. Risk / rollback

- **Risk:** very low. One new pure domain function (additive, new file, new export), one new
  ~6-line listener in a composition root that already registers two other bare `chrome.*`
  listeners in the identical style, zero schema/wire/router/manifest changes. The only
  cross-cutting effect is the documented extra idle tab per e2e test (§5, item 5), which changes
  no existing assertion.
- **Rollback:** revert the single PR. No stored data is written or read by this change —
  `openOptionsPage()` is a UI side effect only — so rollback leaves `chrome.storage.local` exactly
  as valid as it is today.

## 8. Files touched (summary)

| File                                                       | Change                                  |
| ---------------------------------------------------------- | --------------------------------------- |
| `packages/app/src/domain/onboarding-policy.ts`             | new — `shouldOpenOnboardingOnInstall`   |
| `packages/app/src/index.ts`                                | + export of the new domain module       |
| `packages/extension-chrome/src/sw.ts`                      | + `chrome.runtime.onInstalled` listener |
| `packages/app/test/onboarding-policy.test.ts`              | new — 4 branch-coverage unit tests      |
| `packages/extension-chrome/e2e/c1-open-on-install.spec.ts` | new — functional e2e                    |

No change to `packages/app/src/wire.ts`, `packages/app/src/app/router.ts`,
`packages/extension-chrome/src/manifest.json`, `packages/extension-chrome/test/manifest.test.ts`,
or any file under `packages/extension-safari/`.
