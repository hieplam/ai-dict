# C10 Deterministic Funnel e2e Implementation Plan

> **For agentic workers:** implement task-by-task, TDD-adapted-for-infra (each task states its
> failing/red check before any guard exists) per task. Steps use checkbox (`- [ ]`) syntax for
> tracking.

**Goal:** the onboarding e2e suite (`packages/extension-chrome/e2e/onboarding.spec.ts`, 3 specs)
passes 100% of the time regardless of whether `GEMINI_API_KEY` is exported in the builder's shell
— today it silently regresses to 0/3 whenever that var leaks into `dist/`. This plan adds (1) an
explicit, env-clearing e2e build script, (2) a fail-fast guard in the e2e harness that inspects the
built artifact and refuses to run against a key-baked `dist/` with a clear, actionable message, and
(3) one new funnel spec that walks fresh profile → onboarding → activation → first successful
lookup as a single journey — the category's proof harness every other Category C card's Definition
of Done will cite. Full design rationale, including the two rejected alternatives:
`docs/superpowers/specs/2026-07-16-c10-deterministic-funnel-e2e-design.md`.

**Tech Stack:** esbuild (build config), Bun scripts (`package.json`), TypeScript, Vitest (unit),
Playwright (e2e).

## Global Constraints

- Implementer: dispatch each implementation/fix task to the `hunter` subagent — never a generic
  implementer.
- **Dev-infra only — no product behavior change.** Do not touch `options.ts`'s or
  `side-panel.ts`'s onboarding/settings routing logic, or any file under `packages/app/src/**`
  (`c3-1`). The env-key build feature (`README.md:320-326,443-446`) stays exactly as documented —
  this plan only makes the _e2e_ build path deterministic; it never removes or gates the feature
  itself.
- **S1 (`rule-api-key-isolation`) held explicitly:** every new file, log line, error message, and
  test assertion in this plan touches only the `geminiKeyFromEnv` **boolean** marker — never the
  key's value. No task in this plan ever needs to read, print, or assert on the actual key string.
- `bun run lint` and `bun run format:check` clean before every commit.
- Every task must leave `cd packages/extension-chrome && bun run typecheck` green.
- No CI workflow file changes — `.github/workflows/ci.yml`'s `e2e-chrome` job never exports
  `GEMINI_API_KEY` today (confirmed: only `GA4_MEASUREMENT_ID`/`GA4_API_SECRET` are set for that
  job) and needs none of this plan's changes to already be deterministic in CI. This plan closes
  the **local-machine** gap only.
- **No evidence-video spec.** Per the current repo convention (`CLAUDE.md`: owner ruling
  2026-07-16 retires screenshot/video PR evidence in favor of a written "Testing performed"
  section), this plan has no `*-evidence.spec.ts` task — unlike the B1/B5-era precedent plans.
- Commit subject convention for every task in this plan: `feat: deterministic funnel e2e — <task summary> (C10)`.

---

### Task 1: build-time marker — `dist/build-meta.json`

**Files:**

- Modify: `packages/extension-chrome/esbuild.config.mjs`

No existing test harness covers `esbuild.config.mjs` (it is a composition-root build script, same
category as `content.ts`/`side-panel.ts` — proven by running the build, not a unit test). The
"failing check" for this task is a manual, reproducible red state, not a vitest run:

- [x] **Step 1: Confirm the red state.** From `packages/extension-chrome/`, run:

```
bun esbuild.config.mjs
test -f dist/build-meta.json && echo "UNEXPECTED: marker already exists" || echo "RED: no marker file (expected)"
```

Expected: `RED: no marker file (expected)` — `dist/build-meta.json` does not exist before this
task's change.

- [x] **Step 2: Implement.** In `packages/extension-chrome/esbuild.config.mjs`:
  1. Add the import at the top of the file, alongside the existing `node:fs/promises` import:

```js
import { mkdir, copyFile, writeFile } from 'node:fs/promises';
```

2. After the four `esbuild.build()` calls, before the existing `copyFile('src/manifest.json', …)`
   block, add:

```js
// C10: a small, boolean-only marker the e2e harness reads to refuse running against a dist/
// built with a leaked GEMINI_API_KEY (see build-guard.ts). Never the key itself — S1.
await writeFile('dist/build-meta.json', JSON.stringify({ geminiKeyFromEnv: HAS_ENV_KEY }));
```

- [x] **Step 3: Confirm the green state.**

```
bun esbuild.config.mjs
cat dist/build-meta.json
```

Expected: `{"geminiKeyFromEnv":false}` (assuming `GEMINI_API_KEY` is unset in your shell). Then:

```
GEMINI_API_KEY=dummy bun esbuild.config.mjs
cat dist/build-meta.json
```

Expected: `{"geminiKeyFromEnv":true}` — confirming the marker faithfully reflects the env, with the
dummy value itself never appearing in the file.

- [x] **Step 4: Commit** — gate, then commit:

```
cd packages/extension-chrome && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

Commit:

```
git add packages/extension-chrome/esbuild.config.mjs
git commit -m "feat: deterministic funnel e2e — write build-meta.json geminiKeyFromEnv marker (C10)"
```

---

### Task 2: explicit env-clearing e2e build scripts

**Files:**

- Modify: `packages/extension-chrome/package.json`
- Modify: `package.json` (root)

- [x] **Step 1: Confirm the red state.** From the repo root:

```
bun run build:chrome:e2e
```

Expected: `error: Script not found "build:chrome:e2e"` (or bun's equivalent "unknown script"
message) — the script does not exist yet.

- [x] **Step 2: Implement.**
  1. In `packages/extension-chrome/package.json`, add `build:e2e` next to the existing `build`:

```json
{
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "build": "bun ../../scripts/check-dep-direction.mjs && bun esbuild.config.mjs",
    "build:e2e": "GEMINI_API_KEY= bun run build",
    "e2e": "playwright test"
  }
}
```

2. In the root `package.json`, add `build:chrome:e2e` next to the existing `build:chrome`:

```json
{
  "scripts": {
    "build:chrome": "bun run --filter '@ai-dict/extension-chrome' build",
    "build:chrome:e2e": "bun run --filter '@ai-dict/extension-chrome' build:e2e",
    "build:safari": "bun run --filter '@ai-dict/extension-safari' build",
    "e2e:chrome": "bun run --filter '@ai-dict/extension-chrome' e2e"
  }
}
```

- [x] **Step 3: Confirm the green state — the exact repro condition, cleared.**

```
export GEMINI_API_KEY=dummy-local-value
bun run build:chrome:e2e
cat packages/extension-chrome/dist/build-meta.json
```

Expected: `{"geminiKeyFromEnv":false}` **even though `GEMINI_API_KEY` is still exported in the
current shell** (confirm with `echo "$GEMINI_API_KEY"` — it prints `dummy-local-value`, proving the
override was scoped to the build subprocess only, not the shell).

- [x] **Step 4: Commit** — gate, then commit:

```
cd packages/extension-chrome && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

Commit:

```
git add packages/extension-chrome/package.json package.json
git commit -m "feat: deterministic funnel e2e — add build:chrome:e2e env-clearing script (C10)"
```

---

### Task 3: pure guard function — `build-guard.ts`

**Files:**

- Create: `packages/extension-chrome/e2e/build-guard.ts`
- Create: `packages/extension-chrome/test/build-guard.test.ts`

**Interface:**

```ts
export async function assertDeterministicBuild(distDir: string): Promise<void>;
```

- [x] **Step 1: Write the failing tests.** Create
      `packages/extension-chrome/test/build-guard.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { assertDeterministicBuild } from '../e2e/build-guard';

describe('assertDeterministicBuild (C10)', () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });

  async function tempDist(): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), 'c10-build-guard-'));
    dirs.push(dir);
    return dir;
  }

  it('resolves silently when geminiKeyFromEnv is false', async () => {
    const dir = await tempDist();
    await writeFile(path.join(dir, 'build-meta.json'), JSON.stringify({ geminiKeyFromEnv: false }));
    await expect(assertDeterministicBuild(dir)).resolves.toBeUndefined();
  });

  it('throws an actionable error when geminiKeyFromEnv is true, without leaking any key value', async () => {
    const dir = await tempDist();
    await writeFile(path.join(dir, 'build-meta.json'), JSON.stringify({ geminiKeyFromEnv: true }));
    await expect(assertDeterministicBuild(dir)).rejects.toThrow(/GEMINI_API_KEY/);
    await expect(assertDeterministicBuild(dir)).rejects.toThrow(/build:chrome:e2e/);
  });

  it('throws a distinct "missing" error when build-meta.json does not exist', async () => {
    const dir = await tempDist();
    await expect(assertDeterministicBuild(dir)).rejects.toThrow(/is missing/);
  });
});
```

Run: `cd packages/extension-chrome && bunx vitest run test/build-guard.test.ts`
Expected: all 3 fail — `Cannot find module '../e2e/build-guard'` (the file doesn't exist yet).

- [x] **Step 2: Implement.** Create `packages/extension-chrome/e2e/build-guard.ts`:

```ts
import { readFile } from 'node:fs/promises';
import path from 'node:path';

interface BuildMeta {
  geminiKeyFromEnv: boolean;
}

/**
 * C10: fail fast, with an actionable message, when the built dist/ was produced with
 * GEMINI_API_KEY set in the builder's shell. That build silently disables onboarding
 * (options.ts's KEY_FROM_ENV routing) and makes the onboarding e2e specs fail in a way that
 * looks unrelated to its real cause. Reads only the boolean marker esbuild.config.mjs writes —
 * never the key itself (S1: rule-api-key-isolation).
 */
export async function assertDeterministicBuild(distDir: string): Promise<void> {
  const metaPath = path.join(distDir, 'build-meta.json');
  let meta: BuildMeta;
  try {
    meta = JSON.parse(await readFile(metaPath, 'utf8')) as BuildMeta;
  } catch {
    throw new Error(
      `e2e: ${metaPath} is missing. Build with \`bun run build:chrome:e2e\` (from the repo root) ` +
        'before running the e2e suite.',
    );
  }
  if (meta.geminiKeyFromEnv) {
    throw new Error(
      'e2e: dist/ was built with GEMINI_API_KEY set, which disables onboarding and makes ' +
        'onboarding.spec.ts fail. Rebuild with `bun run build:chrome:e2e` (from the repo root) — ' +
        'it clears the var for you — or `unset GEMINI_API_KEY` and rebuild with `bun run build:chrome`.',
    );
  }
}
```

Run: `cd packages/extension-chrome && bunx vitest run test/build-guard.test.ts`
Expected: all 3 pass.

- [x] **Step 3: Commit** — gate, then commit:

```
cd packages/extension-chrome && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

Commit:

```
git add packages/extension-chrome/e2e/build-guard.ts packages/extension-chrome/test/build-guard.test.ts
git commit -m "feat: deterministic funnel e2e — add assertDeterministicBuild guard + unit tests (C10)"
```

---

### Task 4: wire the guard into the e2e harness

**Files:**

- Modify: `packages/extension-chrome/e2e/fixtures.ts`

No dedicated unit test for this one-line wiring — same precedent as B1/B5/B7's `content.ts`/
`side-panel.ts` composition-root edits: proven by the full e2e suite run (Task 5's acceptance
check, and this task's own Step 2 below).

- [x] **Step 1: Implement.** In `packages/extension-chrome/e2e/fixtures.ts`:
  1. Add the import, alongside the existing ones at the top of the file:

```ts
import { assertDeterministicBuild } from './build-guard';
```

2. Add one `await` as the first statement inside the existing `context` fixture
   (`fixtures.ts:15-32`), before `chromium.launchPersistentContext`:

```ts
context: async ({}, use) => {
  await assertDeterministicBuild(dist);
  const context = await chromium.launchPersistentContext('', {
    // ...unchanged — channel, headless, args
  });
  await use(context);
  await context.close();
},
```

(`dist` is the already-defined `const dist = path.resolve(...)` at `fixtures.ts:6` — no new
variable needed.)

- [x] **Step 2: Verify the backstop fires (manual — this IS this task's red/green check).**

```
cd packages/extension-chrome
export GEMINI_API_KEY=dummy-local-value
bun run build   # the PLAIN build script, not build:e2e — simulates "forgot to use the e2e script"
bunx playwright test onboarding
```

Expected (red, i.e. the guard doing its job): the run fails immediately with
`assertDeterministicBuild`'s one-line error (mentioning `GEMINI_API_KEY` and
`build:chrome:e2e`) — not three `waitForSelector('onboarding-view')` timeouts.

```
cd ../.. && bun run build:chrome:e2e
cd packages/extension-chrome && bunx playwright test onboarding
```

Expected (green): 3 passed.

- [x] **Step 3: Commit** — gate, then commit:

```
cd packages/extension-chrome && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

Commit:

```
git add packages/extension-chrome/e2e/fixtures.ts
git commit -m "feat: deterministic funnel e2e — wire assertDeterministicBuild into the context fixture (C10)"
```

---

### Task 5: the funnel proof-harness spec

**Files:**

- Create: `packages/extension-chrome/e2e/c10-funnel.spec.ts`

- [ ] **Step 1: Write the spec.** Model the activation half on
      `onboarding.spec.ts`'s first test (`onboarding-view #key`/`#activate`, `settings-form
#status`) and the lookup half on `saved-word.spec.ts`'s `doLookup` pattern
      (`gotoFixture`/`selectWord`/`openTrigger`/assert card text):

```ts
import { test, expect } from './fixtures';
import { gotoFixture, selectWord, openTrigger, mockGemini } from './helpers';

test.describe('C10 deterministic funnel', () => {
  test('fresh profile: onboarding → activation → first successful lookup', async ({
    context,
    extensionId,
  }) => {
    await mockGemini(context);

    // 1. Fresh profile, options page → onboarding (never settings — the e2e build is
    // guaranteed key-free by the fixtures.ts guard from Task 4).
    const optionsPage = await context.newPage();
    await optionsPage.goto(`chrome-extension://${extensionId}/options.html`);
    await optionsPage.waitForSelector('onboarding-view');

    // 2. Activation (today's actual onboarding behavior — a non-empty key is accepted; C2's
    // future verified-activation change adds a connection.test round-trip inside this same
    // click and does not change this spec — C10's scope fence is dev-infra only).
    await optionsPage.locator('onboarding-view #key').fill('AIza-funnel-test');
    await optionsPage.locator('onboarding-view #activate').click();
    await optionsPage.waitForSelector('settings-form');
    await expect(optionsPage.locator('settings-form #status')).toContainText("You're all set");

    // 3. First successful lookup, on a real content page, using the key just saved by step 2
    // (chrome.storage.local is shared across every extension page in this context).
    const readerPage = await context.newPage();
    await gotoFixture(readerPage);
    await readerPage.waitForTimeout(1_000);
    await selectWord(readerPage, 't', 'bank');
    await openTrigger(readerPage);
    await expect(readerPage.locator('bottom-sheet lookup-card')).toContainText(
      'financial institution',
      { timeout: 10_000 },
    );
  });
});
```

- [ ] **Step 2: Build and run.**

```
bun run build:chrome:e2e
cd packages/extension-chrome && bunx playwright test c10-funnel
```

Expected: 1 passed.

- [ ] **Step 3: Commit** — gate, then commit:

```
bun run lint && bun run format:check
```

Commit:

```
git add packages/extension-chrome/e2e/c10-funnel.spec.ts
git commit -m "feat: deterministic funnel e2e — add the fresh-profile funnel proof harness (C10)"
```

---

## Final gate (run once, after Task 5, before opening the PR)

This is the card's Definition of Done, verbatim: the full e2e suite green locally **with a key
exported in the shell** — the exact condition the 2026-07-16 audit reproduced as broken.

```
cd packages/extension-chrome && bun run typecheck
cd ../..
bun run test
bun run lint
bun run format:check

# The acceptance test — the exact repro condition, made green:
export GEMINI_API_KEY=dummy-local-value
bun run build:chrome:e2e
cd packages/extension-chrome && bunx playwright test
```

Expected: typecheck clean; the full Vitest suite green (including the 3 new `build-guard.test.ts`
cases); lint/format clean; the full Playwright suite green (all 41 existing specs, plus
`c10-funnel.spec.ts`) — with `GEMINI_API_KEY` still exported in the shell throughout the final
command. `onboarding.spec.ts` (3/3) and `c10-funnel.spec.ts` (1/1) are the specs this card
directly protects; every other passing spec is the regression guard that nothing else broke.

**PR body's "Testing performed" section** (no video evidence — §4 of the design doc) states: the
`build-guard.test.ts` pass count, the full local e2e pass count under the exported-key condition
above (command shown verbatim so a reviewer can reproduce it), and the one-line backstop
demonstration from Task 4 Step 2 (the exact error text — confirming no key value appears in it).
