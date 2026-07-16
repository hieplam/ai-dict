# C1 Open Onboarding On Install Implementation Plan

> **For agentic workers:** implement task-by-task, TDD (red → green → commit) per task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a fresh extension install opens `options.html`'s welcome screen (`<onboarding-view>`)
automatically, exactly once, so 100% of new installs see Welcome → key setup instead of only the
lucky few who stumble into it via the no-key card's "Open Settings" button or the side panel. Never
fires on an update, and is skipped entirely when the build baked a Gemini key via the env-key build
path. No new manifest permission.

**Architecture:** one new pure predicate in the portable core (`packages/app/src/domain/onboarding-policy.ts`,
c3-1) — `shouldOpenOnboardingOnInstall(reason, envKeyBaked)` — plus a ~6-line
`chrome.runtime.onInstalled` listener in the Chrome composition root
(`packages/extension-chrome/src/sw.ts`, c3-210) that calls it and, on `true`, reuses the router's
existing `openOptionsPage()` call. No wire message, no router case, no manifest change. Full design
rationale: `docs/superpowers/specs/2026-07-16-c1-open-on-install-design.md`.

**Tech Stack:** TypeScript, Vitest + happy-dom (unit), Playwright (e2e).

## Global Constraints

- Implementer: dispatch each implementation/fix task to the `hunter` subagent — never a generic
  implementer.
- **`packages/app/src/domain/**` stays chrome-free** (`rule-domain-purity`,
`ref-core-dependency-rule`): `shouldOpenOnboardingOnInstall`'s `reason`parameter is typed`string`, never chrome's own `OnInstalledReason`union — no`@types/chrome`import enters`packages/app`.
- **Fires only on `reason === 'install'`, never `'update'`; skipped when the build bakes an env
  key; exactly one tab, once** (roadmap C1 scope fence, held verbatim). These three conditions are
  the entire behavior — do not add a persisted "already onboarded" flag or any other state; Chrome's
  own single-fire `onInstalled` guarantee is the "no re-prompting loop" mechanism.
- **No wire message, no router case, no manifest change.** `chrome.runtime.onInstalled` is a bare
  `chrome.*` listener, styled exactly like the existing `chrome.commands.onCommand` listener
  already in `sw.ts` — it never goes through `classifyInbound`/`buildRouter`.
- **No evidence-video spec.** Per this worktree's `CLAUDE.md` (owner ruling 2026-07-16): PRs carry a
  written **"Testing performed"** section, not screenshots/video. Do not create a
  `c1-evidence.spec.ts`-style file — B5's `b5-evidence.spec.ts` pattern is retired as of today.
- **Local builds must clear `GEMINI_API_KEY`** before any `bun run build:chrome` that feeds
  onboarding e2e (this shell has it exported — confirmed during design; see spec §5.6). Every gate
  below that builds for e2e uses `env -u GEMINI_API_KEY bun run build:chrome`.
- `bun run lint` and `bun run format:check` clean before every commit.
- Every task must leave `cd packages/app && bun run typecheck` (and, from Task 2 on,
  `cd packages/extension-chrome && bun run typecheck`) green.
- Commit subject convention for every task in this plan: `feat: open onboarding on install — <task summary> (C1)`.

---

### Task 1: `shouldOpenOnboardingOnInstall` — domain decision predicate

**Files:**

- Create: `packages/app/src/domain/onboarding-policy.ts`
- Modify: `packages/app/src/index.ts`
- Create: `packages/app/test/onboarding-policy.test.ts`

**Interface:**

```ts
export function shouldOpenOnboardingOnInstall(reason: string, envKeyBaked: boolean): boolean;
```

- [x] **Step 1: Write the failing tests.** Create `packages/app/test/onboarding-policy.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { shouldOpenOnboardingOnInstall } from '../src/domain/onboarding-policy';

describe('shouldOpenOnboardingOnInstall (C1)', () => {
  it('opens onboarding on a genuine install with no env key baked', () => {
    expect(shouldOpenOnboardingOnInstall('install', false)).toBe(true);
  });

  it('is skipped on install when the build baked an env key', () => {
    expect(shouldOpenOnboardingOnInstall('install', true)).toBe(false);
  });

  it('never opens on an update, even with no env key baked', () => {
    expect(shouldOpenOnboardingOnInstall('update', false)).toBe(false);
  });

  it('never opens on an update when an env key is also baked', () => {
    expect(shouldOpenOnboardingOnInstall('update', true)).toBe(false);
  });

  it('never opens for any other install reason (chrome_update, shared_module_update)', () => {
    expect(shouldOpenOnboardingOnInstall('chrome_update', false)).toBe(false);
    expect(shouldOpenOnboardingOnInstall('shared_module_update', false)).toBe(false);
  });
});
```

Run: `cd packages/app && bunx vitest run test/onboarding-policy.test.ts`
Expected: fails to resolve — `../src/domain/onboarding-policy` does not exist yet.

- [x] **Step 2: Implement.** Create `packages/app/src/domain/onboarding-policy.ts`:

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

Add the export to `packages/app/src/index.ts`, right after the existing
`export * from './domain/nudge-policy';` line:

```ts
export * from './domain/nudge-policy';
export * from './domain/onboarding-policy'; // C1
```

Run: `cd packages/app && bunx vitest run test/onboarding-policy.test.ts`
Expected: all 6 assertions pass.

- [x] **Step 3: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

Commit:

```
git add packages/app/src/domain/onboarding-policy.ts packages/app/src/index.ts packages/app/test/onboarding-policy.test.ts
git commit -m "feat: open onboarding on install — add shouldOpenOnboardingOnInstall domain predicate (C1)" \
  -m $'Tribe-Card: c1-open-on-install\nTribe-Task: 1/3'
```

---

### Task 2: Wire `sw.ts`'s `chrome.runtime.onInstalled` listener

**Files:**

- Modify: `packages/extension-chrome/src/sw.ts`

No dedicated unit test exists for `sw.ts` in this repo — it is a composition root (`c3-210`),
covered by e2e only, matching the identical precedent `content.ts`/`side-panel.ts` set in B5
(`docs/superpowers/plans/2026-07-16-b5-status-lifecycle.md` Tasks 6–7: "No dedicated unit test
exists for `content.ts`... it is a composition root, covered by e2e only"). This task's correctness
is proven by Task 3's e2e spec; still run the typecheck gate below so a regression in existing
`sw.ts` behavior is caught immediately, and confirm the existing manifest permission regression
guard stays green untouched.

- [ ] **Step 1: Implement.** In `packages/extension-chrome/src/sw.ts`:
  1. Add `shouldOpenOnboardingOnInstall` to the existing `@ai-dict/app` import block (top of the
     file):

```ts
import {
  mapError,
  DEFAULT_OUTPUT_FORMAT,
  configuredProvidersFor,
  shouldOpenOnboardingOnInstall,
  type Settings,
  GeminiLookupClient,
  OpenAILookupClient,
  AnthropicLookupClient,
  createLookupClientSelector,
  buildRouter,
  WriteQueue,
  SUPPRESS,
  classifyInbound,
  ErrorReporter,
} from '@ai-dict/app';
```

2. Add the new listener right after the existing `chrome.commands.onCommand.addListener` block
   (after its closing `});`, currently the last statement before the `chrome.sidePanel` startup
   call at the bottom of the file):

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

// Side panel: open only via toolbar click (§6.5); never the primary surface.
chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => undefined);
```

(Only the new block above the pre-existing `chrome.sidePanel?.setPanelBehavior` line is added —
that line itself is shown only to pin the insertion point, not modified.)

Run:

```
cd packages/extension-chrome && bun run typecheck
```

Expected: clean (no type errors).

- [ ] **Step 2: Regression-check the manifest guard.** Confirm the existing permission test still
      passes untouched (no manifest edit was made in this task):

```
cd packages/extension-chrome && bunx vitest run test/manifest.test.ts
```

Expected: all existing assertions pass, including
`'declares only storage + sidePanel; no scripting / externally_connectable (S8)'` — proving no
permission was added by this change.

- [ ] **Step 3: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd ../extension-chrome && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

Commit:

```
git add packages/extension-chrome/src/sw.ts
git commit -m "feat: open onboarding on install — wire the onInstalled listener in sw.ts (C1)" \
  -m $'Tribe-Card: c1-open-on-install\nTribe-Task: 2/3'
```

---

### Task 3: e2e functional test

**Files:**

- Create: `packages/extension-chrome/e2e/c1-open-on-install.spec.ts`

- [ ] **Step 1: Write the test.** The shared fixture (`fixtures.ts`) launches a fresh temporary
      Chromium profile per test (`chromium.launchPersistentContext('', {...})`), which is itself a
      simulated first install — so no click or navigation is needed to trigger the behavior; it has
      already happened by the time the test body runs. Create
      `packages/extension-chrome/e2e/c1-open-on-install.spec.ts`:

```ts
import { test, expect } from './fixtures';

// C1: fresh installs open the welcome screen automatically. The `context` fixture itself IS a
// simulated fresh install (chromium.launchPersistentContext('', ...) uses a new temp profile per
// test — see fixtures.ts), so chrome.runtime.onInstalled({ reason: 'install' }) has already fired
// by the time this test body runs; no click/navigation is needed to observe it.
test.describe('C1 open onboarding on install', () => {
  test('a fresh install opens exactly one options.html tab showing the welcome screen', async ({
    context,
  }) => {
    const optionsPages = context.pages().filter((p) => p.url().includes('options.html'));
    expect(optionsPages).toHaveLength(1);

    const [page] = optionsPages;
    await page!.waitForSelector('onboarding-view');
    await expect(page!.locator('onboarding-view #key')).toBeVisible();
  });
});
```

- [ ] **Step 2: Build and run.** Clear `GEMINI_API_KEY` for the build (plan-level constant
      constraint — see Global Constraints):

```
env -u GEMINI_API_KEY bun run build:chrome
cd packages/extension-chrome && bunx playwright test c1-open-on-install
```

Expected: 1 passed.

- [ ] **Step 3: Regression-check the pre-existing onboarding suite** still passes under the same
      cleared-env-key build (proves this change didn't alter the manual "Open Settings" path or the
      activation flow — same build the previous step already produced):

```
cd packages/extension-chrome && bunx playwright test onboarding
```

Expected: all pre-existing `onboarding.spec.ts` tests still pass.

- [ ] **Step 4: Commit** — gate, then commit:

```
bun run lint && bun run format:check
```

Commit:

```
git add packages/extension-chrome/e2e/c1-open-on-install.spec.ts
git commit -m "feat: open onboarding on install — add e2e coverage for the onInstalled flow (C1)" \
  -m $'Tribe-Card: c1-open-on-install\nTribe-Task: 3/3'
```

---

## Final gate (run once, after Task 3, before opening the PR)

```
cd packages/app && bun run typecheck
cd ../extension-chrome && bun run typecheck
cd ../..
bun run test
bun run lint
bun run format:check
env -u GEMINI_API_KEY bun run build:chrome
cd packages/extension-chrome && bunx playwright test onboarding c1-open-on-install
```

Expected: typecheck clean on both packages; the full Vitest suite green (including the 6 new
`onboarding-policy.test.ts` assertions and the untouched `manifest.test.ts`); lint/format clean;
the Chrome build succeeds with `GEMINI_API_KEY` cleared; both the pre-existing `onboarding.spec.ts`
suite (regression guard — the manual "Open Settings"/activation flow must be unaffected) and the
new `c1-open-on-install.spec.ts` suite pass.

**PR body:** per the 2026-07-16 evidence-policy ruling, include a written **"Testing performed"**
section (suite names + counts from the final gate above, e2e scenarios exercised) — no
screenshots, no video.
