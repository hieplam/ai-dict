# C7 Finish-Setup Toolbar Badge Implementation Plan

> **For agentic workers:** implement task-by-task, TDD (red → green → commit) per task. The
> design spec (same folder, `-design.md`) carries every decision (D1–D7); do not re-open them.

**Goal:** while no provider has a usable key, the toolbar action carries badge text `'!'` and
tooltip "Finish AI Dictionary setup"; both clear the instant a usable key exists (stored or
env-baked), re-derived on every service-worker start and on every settings change — never held in
memory. Env-key builds never show it. No new permission, no new wire message, no new UI component.

**Commit subject convention:** `feat: finish-setup badge — <task summary> (C7)`; trailer
`Tribe-Card: c7-finish-setup-badge`, `Tribe-Task: n/3`. No Co-Authored-By, no attribution.

## Global Constraints

- Implementer: one `hunter` subagent per task, brief = the task text verbatim + this section.
- `packages/app/src/domain/badge-policy.ts` imports **nothing** — no `chrome.*`, no other
  `domain/` module, no `../ports` (it doesn't need one) — pure input→output (rule-domain-purity;
  mechanically gated by `scripts/check-dep-direction.mjs`).
- `chrome.action.*` calls live **only** in `packages/extension-chrome/src/sw.ts` (the composition
  root) — never in `packages/app/src/**`.
- Do not add `__GEMINI_KEY_FROM_ENV__` to `sw.ts` or its esbuild step — `sw.ts` already has
  `Boolean(ENV_API_KEY)` in scope (`sw.ts:59`) and must reuse it (design spec §1, last paragraph).
- Do not touch `packages/extension-chrome/src/manifest.json`'s `"permissions"` array — the
  existing `manifest.test.ts:5-10` exact-match assertion is the regression guard.
- Gates before every commit: `cd packages/app && bun run typecheck`; from Task 2 on, also
  `cd packages/extension-chrome && bun run typecheck`; then `bun run lint && bun run format:check`
  from repo root.
- The e2e build in Task 3 **must** run with `GEMINI_API_KEY` unset
  (`GEMINI_API_KEY= bun run build:chrome`) — see design spec §4 point 4 (live flake, 2026-07-16
  audit: a real key in the shell env bakes `hasUsableKey = true` unconditionally and the
  fresh-profile assertion fails).

---

### Task 1: `badgeStateFor` — pure domain predicate → state

**Files:**

- Create: `packages/app/src/domain/badge-policy.ts`
- Create: `packages/app/test/badge-policy.test.ts`
- Modify: `packages/app/src/index.ts`

**Interface:**

```ts
export interface BadgeState {
  text: '' | '!';
  title: string;
}
export function badgeStateFor(hasUsableKey: boolean): BadgeState;
```

- [ ] **Step 1: Write the failing tests.** Create `packages/app/test/badge-policy.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { badgeStateFor } from '../src/domain/badge-policy';

describe('badgeStateFor (C7)', () => {
  it('no usable key: shows the setup badge with the finish-setup title', () => {
    expect(badgeStateFor(false)).toEqual({ text: '!', title: 'Finish AI Dictionary setup' });
  });

  it('a usable key: clears the badge and defers the title to the shell default', () => {
    expect(badgeStateFor(true)).toEqual({ text: '', title: '' });
  });
});
```

Run: `cd packages/app && bunx vitest run test/badge-policy.test.ts`
Expected: fails — `badge-policy` module doesn't exist yet.

- [ ] **Step 2: Implement.** Create `packages/app/src/domain/badge-policy.ts`:

```ts
/**
 * C7: toolbar badge state (see docs/superpowers/specs/2026-07-16-c7-finish-setup-badge-design.md
 * D2). Exactly two shapes — a no-key indicator only, never a general notification channel
 * (roadmap C7 scope fence).
 */
export interface BadgeState {
  /** '' clears the badge; '!' is the only non-empty glyph in v1. */
  text: '' | '!';
  /** Tooltip override. '' means "no override" — the shell restores its own default title
   *  (this module has no access to, and must not hardcode, the manifest's default_title). */
  title: string;
}

/**
 * Derive the toolbar badge state from the exact same "usable key" boolean onboarding routing
 * uses (PublicSettings.hasKey — see hasKeyFor/configuredProvidersFor in ./types), so the badge
 * and onboarding routing can never disagree. Pure: no chrome.*, unit-testable without a browser.
 */
export function badgeStateFor(hasUsableKey: boolean): BadgeState {
  return hasUsableKey
    ? { text: '', title: '' }
    : { text: '!', title: 'Finish AI Dictionary setup' };
}
```

Add the barrel export. In `packages/app/src/index.ts`, right after line 9
(`export * from './domain/saved-words-policy';`):

```ts
export * from './domain/badge-policy';
```

Run: `cd packages/app && bunx vitest run test/badge-policy.test.ts`
Expected: both tests pass.

- [ ] **Step 3: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

Commit:

```
git add packages/app/src/domain/badge-policy.ts packages/app/src/index.ts packages/app/test/badge-policy.test.ts
git commit -m "feat: finish-setup badge — add badgeStateFor pure predicate (C7)" \
  -m $'Tribe-Card: c7-finish-setup-badge\nTribe-Task: 1/3'
```

---

### Task 2: Wire the service worker (`sw.ts`)

**Files:**

- Modify: `packages/extension-chrome/src/sw.ts`

No dedicated unit test exists for `sw.ts` in this repo — it is the composition root, proven only
by Task 3's e2e (same precedent as B5/B7's own `content.ts`/`side-panel.ts` edits). Still run the
typecheck gate at the end of this task so a regression in existing SW behavior is caught
immediately.

- [ ] **Step 1: Implement.** In `packages/extension-chrome/src/sw.ts`:

1. Add `badgeStateFor` to the existing `@ai-dict/app` import block (top of file, alongside
   `mapError`, `buildRouter`, etc.):

```ts
import {
  mapError,
  DEFAULT_OUTPUT_FORMAT,
  configuredProvidersFor,
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
  badgeStateFor,
} from '@ai-dict/app';
```

2. Hoist the `ChromeStorageStore` instance to a named `const`, right before the existing
   `const router = buildRouter({` (around line 81), and pass the named const instead of
   constructing inline:

```ts
// C7: named so the badge refresh below can share the exact same settings-derived "usable key"
// boolean the router uses — see design spec D1 (no separate predicate is introduced).
const settingsStore = new ChromeStorageStore(chrome.storage.local, Boolean(ENV_API_KEY));

const router = buildRouter({
  client: createLookupClientSelector({
    // ... unchanged ...
  }),
  settings: settingsStore,
  kv: new ChromeKvStore(chrome.storage.local),
  readToggles: async () => {
    const s = await readFullSettings();
    return { cacheEnabled: s.cacheEnabled, saveHistory: s.saveHistory };
  },
  queue: new WriteQueue(),
  openOptions: () => chrome.runtime.openOptionsPage(),
  errlog: reporter,
});
```

(Only the `settings:` line's right-hand side changes, from
`new ChromeStorageStore(chrome.storage.local, Boolean(ENV_API_KEY))` to `settingsStore` — every
other line in that call is untouched.)

3. Add the badge refresh block at the **end** of the file, after the existing
   `chrome.sidePanel?.setPanelBehavior?.(...)` line:

```ts
// C7: finish-setup toolbar badge. MV3 service workers are ephemeral — nothing here is cached in
// memory; every refresh re-reads storage via settingsStore.get() (see design spec D3).
const DEFAULT_ACTION_TITLE = chrome.runtime.getManifest().action?.default_title ?? 'AI Dictionary';
// Sourced from design-system/tokens.css's SEPIA --ad-error: oklch(0.520 0.160 28) (tokens.css:122)
// — chrome.action paints outside any DOM/CSSOM this extension controls, so the token can't be
// read live (design spec D5; flagged for tracker review as an intentional shell-level exception
// to the no-hard-coded-hex rule, which binds ui/ shadow-DOM components, not this composition root).
const BADGE_SETUP_COLOR = '#b33830';

async function refreshSetupBadge(): Promise<void> {
  const { hasKey } = await settingsStore.get();
  const state = badgeStateFor(hasKey);
  await chrome.action.setBadgeText({ text: state.text });
  await chrome.action.setTitle({ title: state.title || DEFAULT_ACTION_TITLE });
  if (state.text) await chrome.action.setBadgeBackgroundColor({ color: BADGE_SETUP_COLOR });
}

void refreshSetupBadge(); // SW-start evaluation — MV3 ephemerality (design spec D3, point 1)
chrome.storage.onChanged.addListener((changes, areaName) => {
  // Re-derive on every settings write (activation, or a key later cleared) — design spec D3,
  // point 2. No cache to invalidate: refreshSetupBadge always re-reads storage fresh.
  if (areaName === 'local' && 'settings' in changes) void refreshSetupBadge();
});
```

Run:

```
cd packages/extension-chrome && bun run typecheck
```

Expected: clean (no type errors).

- [ ] **Step 2: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd ../extension-chrome && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

Commit:

```
git add packages/extension-chrome/src/sw.ts
git commit -m "feat: finish-setup badge — wire chrome.action badge/title in the SW (C7)" \
  -m $'Tribe-Card: c7-finish-setup-badge\nTribe-Task: 2/3'
```

---

### Task 3: e2e functional test

**Files:**

- Create: `packages/extension-chrome/e2e/c7-badge.spec.ts`

- [ ] **Step 1: Write the test.** Model the SW-context evaluation on
      `saved-word.spec.ts`'s existing `swStorageDump` pattern (evaluate inside
      `context.serviceWorkers()[0]`, not the page):

```ts
import { test, expect } from './fixtures';
import { seedSettings } from './helpers';
import type { BrowserContext } from '@playwright/test';

async function swEval<T>(context: BrowserContext, fn: () => T | Promise<T>): Promise<T> {
  const [sw] = context.serviceWorkers();
  if (!sw) throw new Error('no service worker registered');
  return sw.evaluate(fn);
}

test.describe('C7 finish-setup toolbar badge', () => {
  test('a fresh, keyless profile shows the setup badge', async ({ context, extensionId }) => {
    // extensionId fixture forces the SW to be registered before we evaluate inside it.
    void extensionId;
    await expect.poll(async () => swEval(context, () => chrome.action.getBadgeText({}))).toBe('!');
    await expect
      .poll(async () => swEval(context, () => chrome.action.getTitle({})))
      .toBe('Finish AI Dictionary setup');
  });

  test('seeding a usable key clears the badge and restores the default title', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page); // default seed includes apiKey: 'AIza-test', hasKey: true

    await expect.poll(async () => swEval(context, () => chrome.action.getBadgeText({}))).toBe('');
    await expect
      .poll(async () => swEval(context, () => chrome.action.getTitle({})))
      .toBe('AI Dictionary');
  });

  test('clearing the key back out re-shows the setup badge', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);
    await expect.poll(async () => swEval(context, () => chrome.action.getBadgeText({}))).toBe('');

    await seedSettings(page, { apiKey: '', hasKey: false, configuredProviders: [] });
    await expect.poll(async () => swEval(context, () => chrome.action.getBadgeText({}))).toBe('!');
  });
});
```

- [ ] **Step 2: Build with the env key cleared, then run.**

```
GEMINI_API_KEY= bun run build:chrome
cd packages/extension-chrome && bunx playwright test c7-badge
```

Expected: 3 passed. If the first test fails with the badge already clear, check `echo
$GEMINI_API_KEY` in the shell that ran the build — an exported key bakes `hasUsableKey = true`
unconditionally (design spec §4 point 4); rebuild with it unset.

- [ ] **Step 3: Commit** — gate, then commit:

```
bun run lint && bun run format:check
```

Commit:

```
git add packages/extension-chrome/e2e/c7-badge.spec.ts
git commit -m "feat: finish-setup badge — add e2e coverage for the badge lifecycle (C7)" \
  -m $'Tribe-Card: c7-finish-setup-badge\nTribe-Task: 3/3'
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
GEMINI_API_KEY= bun run build:chrome
cd packages/extension-chrome && bunx playwright test saved-word c7-badge
```

Expected: typecheck clean on both packages; the full Vitest suite green (including the 2 new
`badge-policy.test.ts` cases); lint/format clean; the Chrome build succeeds with the env key
cleared; both the pre-existing `saved-word.spec.ts` suite (regression guard — unrelated SW
behavior must be unaffected) and the new `c7-badge.spec.ts` suite (3 tests) pass.

## PR

Title: `[<branch>] feat: finish-setup toolbar badge (C7)`.

Body: 1–3 sentences (what/why) + design bullets (≤3): reuses `PublicSettings.hasKey` verbatim, no
new predicate (D1); badge color is a named constant citing its `tokens.css` source, flagged for
tracker review as a justified shell-level exception (D5); no new permission/wire message/router
case. **Evidence policy (owner ruling 2026-07-16): no screenshot/video capture** — the PR body
carries a **"Testing performed"** section instead:

- Unit: `badge-policy.test.ts` — 2 cases (no-key / usable-key).
- e2e: `c7-badge.spec.ts` — 3 scenarios (fresh profile shows the badge; seeding a key clears
  badge + title; clearing the key back out re-shows the badge), run against a build with
  `GEMINI_API_KEY` explicitly unset.
- Gates passed: `bun run typecheck` (both packages), `bun run test`, `bun run lint`,
  `bun run format:check`, `bun run build:chrome`.

Merge: regular merge (`gh pr merge --merge --delete-branch`) — **squash prohibited** per standing
rule. Verify the merge commit has exactly 2 parents; confirm master CI green; remove the worktree.
