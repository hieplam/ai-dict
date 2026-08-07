# C10 — Deterministic funnel e2e

Roadmap card: `docs/ROADMAP.md` §4 Category C, C10 (Impact 3 · Effort S · Score 3.0 · **proof
harness**). Depends on: — (sequenced first per the category's own instruction: "C10 goes first,
it is the proof harness every other C-card's DoD cites"). Feeds: every other Category C card
(C1/C2/C5/C6/C7/C8/C3/C4/C9) — each one's Definition of Done cites this card's funnel spec as the
regression guard that keeps its own dead-end closed.

## 1. Problem (grounded in code)

### 1.1 The leak: one shell variable silently disables onboarding

`packages/extension-chrome/esbuild.config.mjs:12-13` reads the builder's shell directly:

```js
const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? '';
const HAS_ENV_KEY = GEMINI_API_KEY.length > 0;
```

`HAS_ENV_KEY` is baked into two of the four bundles esbuild produces, as the boolean define
`__GEMINI_KEY_FROM_ENV__` (`esbuild.config.mjs:69,78` — `options.js` and `side-panel.js`; the raw
key string itself, `__GEMINI_API_KEY__`, is baked only into `sw.js`, `esbuild.config.mjs:31`).
`options.ts:28` reads that define into a module-level const:

```ts
// When the build baked in GEMINI_API_KEY the SW ignores the stored key and the extension works
// with nothing entered — so it counts as set up and onboarding is skipped entirely.
const KEY_FROM_ENV = __GEMINI_KEY_FROM_ENV__;
```

and the page's one routing decision (`options.ts:210-212`) short-circuits straight past onboarding
whenever that's `true`:

```ts
void load().then((s) => {
  if (KEY_FROM_ENV || hasKeyFor(s)) mountSettings(s);
  else mountOnboarding(s);
});
```

`side-panel.ts:228` makes the same `if (!__GEMINI_KEY_FROM_ENV__ && !reply.settings.hasKey)`
check for its own no-key nag. Both call sites are correct, intentional product behavior — this is
a real, documented, supported feature (`README.md:320-326`, `README.md:443-446`: "Personal build
with a baked-in key… the settings page stops asking for one"). **C10 does not touch this feature.**

### 1.2 Why it breaks the suite, reproducibly

`packages/extension-chrome/e2e/onboarding.spec.ts` has exactly 3 tests, and all 3 assume
`onboarding-view` is what a fresh options-page load shows:

- `onboarding.spec.ts:7` — `'onboarding: activating with a key swaps to the settings screen…'`,
  `await page.waitForSelector('onboarding-view')` (line 13).
- `onboarding.spec.ts:33` — `'onboarding: empty key shows an error…'`, same wait (line 39).
- `onboarding.spec.ts:45` — `'no-key card shows the setup invite…'`, drives `openTrigger` into a
  no-key card whose "Open Settings" button (`options.ts` routing, `card.locator('.setup-cta')`)
  is expected to land back on `onboarding-view` (line 69).

If `GEMINI_API_KEY` is exported in the builder's shell (the common case for anyone who has it in
`~/.zshrc` for day-to-day manual testing, per `README.md:443-446`'s own documented workflow) when
`bun run build:chrome` runs, `KEY_FROM_ENV` bakes `true`, `options.ts:210` always calls
`mountSettings` first, `onboarding-view` never mounts, and all three `waitForSelector('onboarding-view')`
calls time out. **Reproduced and confirmed 2026-07-16:** rebuilding with `GEMINI_API_KEY=` cleared
→ 3 passed; rebuilding with a key exported → 3 failed. No other spec in
`packages/extension-chrome/e2e/` (41 spec files) reads `__GEMINI_KEY_FROM_ENV__` or depends on the
onboarding-vs-settings routing decision, so this is isolated to `onboarding.spec.ts` today — but
it is a structural landmine: any future spec that touches first-run UI inherits the same risk, and
nothing in the harness would tell that developer why.

### 1.3 Why CI is already safe, and the gap is specifically local

`.github/workflows/ci.yml`'s `e2e-chrome` job (lines 159-191) builds with only
`GA4_MEASUREMENT_ID`/`GA4_API_SECRET` set — `GEMINI_API_KEY` is never exported in that job's
environment, so CI's build is deterministic today by accident of what secrets happen to be
configured, not by design. `.github/workflows/release-please.yml` goes one step further and
proves the pattern the codebase already trusts: it has an explicit guard step titled
`"Guard — no API key baked into the release build (rule-api-key-isolation / S1)"` —
`run: test -z "${GEMINI_API_KEY:-}"` — before building the release artifact. **C10 is that same
guard idea, applied to the e2e build boundary instead of the release build boundary**, because the
release guard's blocking failure mode (hard-stop the whole workflow) is wrong for local dev: a
developer with the var exported should get a clear, fixable message, not a `test -z` exit code
with no context.

The gap is entirely a **local-machine** problem: there is no e2e build step at all in the normal
local flow (`packages/extension-chrome/package.json`'s `"e2e": "playwright test"` never rebuilds
`dist/` — `README.md:440` states this explicitly: "There's no bundler watch mode — re-run the
build after changing extension code"). A developer runs `bun run build:chrome` by hand, then
`bun run e2e:chrome` by hand, and whichever shell state was active during the first command
silently decides whether onboarding exists in the bundle the second command tests against.

### 1.4 The second gap: no spec walks the funnel as one journey

Every existing e2e spec tests one surface at a time — `onboarding.spec.ts` tests activation and
the no-key card in isolation; `saved-word.spec.ts`, `lookup.spec.ts`, etc. all `seedSettings()`
a working key directly into storage and skip onboarding entirely (`helpers.ts:39-59`). **No spec
ever exercises install → onboarding → activation → first real lookup as a single continuous
flow.** That is exactly the funnel the roadmap's Category C intro measures ("a fresh-profile e2e
run that walks install → onboarding → verified key → first successful lookup") and exactly the
proof harness every other C-card's Definition of Done is written to cite. Today that harness does
not exist.

## 2. Decision: the guard mechanism (Warchief call, per the card's "Lead decides: build-flag

mechanics")

Four options were weighed, per the card's brief:

| Option                                                                                                       | Verdict                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A.** `build:chrome:e2e` script that clears the var                                                         | **Adopted** — cheap, explicit, matches the release guard's existing pattern of a build-time env override. Alone, insufficient: nothing stops a developer from running the plain `build:chrome` script instead and never noticing.                                                                                                                                                                                                       |
| **B.** A guard _inside_ `esbuild.config.mjs` gated on an `E2E=1` flag                                        | Rejected as the primary mechanism. It would require every e2e-facing invocation to remember to pass `E2E=1` — the exact same "forgot the flag" failure mode as today's `GEMINI_API_KEY`, just renamed. It does not fail loud; a forgotten flag silently reverts to today's behavior.                                                                                                                                                    |
| **C.** A Playwright `globalSetup` that rebuilds deterministically before every run                           | Rejected. `playwright.config.ts` (root) and `e2e/fixtures.ts` currently never invoke a build (confirmed: `"e2e": "playwright test"`, no `globalSetup` entry in either config today) — adding one changes the harness's own performance profile (a full esbuild rebuild before every single `playwright test` invocation, including targeted single-spec debug runs) and duplicates the explicit-script option's job less transparently. |
| **D.** A `fixtures.ts` assertion that fails fast with a clear message when `dist` was built with a baked key | **Adopted**, as the backstop. This is the only option that is correct regardless of _how_ `dist/` got built — it does not trust the developer to remember a script name or a flag; it inspects the artifact that actually ships into the browser.                                                                                                                                                                                       |

**Decision: A + D, combined** (the card's own suggested "prefer fail-fast + explicit script
combo"). Neither alone is sufficient — A is a convenience path that must still be remembered; D is
the correctness backstop that fires regardless of which build command was used, including a stale
`dist/` left over from a previous manual `build:chrome` run. Together: the happy path (run the
explicit e2e-safe script) never leaks the key; the unhappy path (forgot, or stale `dist/`) fails
in one line at test-launch time instead of three confusing, unrelated-looking timeouts.

### 2.1 The pinned guard mechanism

1. **`esbuild.config.mjs` writes a build-metadata marker file**, `dist/build-meta.json`, on every
   build (both the plain `build` script and the new `build:e2e` script), containing exactly one
   field: `{ "geminiKeyFromEnv": <boolean> }` — the same `HAS_ENV_KEY` boolean already computed at
   `esbuild.config.mjs:13`, never the key value itself (S1: `rule-api-key-isolation` — the key
   never appears outside the SW/options-page runtime; a boolean about the key's _presence_ is not
   the key). `dist/` is already gitignored (`.gitignore:2`) — this is an ephemeral build artifact
   alongside `dist/sw.js` etc., not a new tracked file.
2. **A new `build:e2e` script** in `packages/extension-chrome/package.json`, and a new
   `build:chrome:e2e` script at the workspace root mirroring the existing `build:chrome` /
   `--filter` wiring, that explicitly clears `GEMINI_API_KEY` for the build subprocess regardless
   of what the ambient shell exports:

   ```json
   "build:e2e": "GEMINI_API_KEY= bun run build"
   ```

   `VAR=value command` overrides the variable for that command's own process tree in bash/zsh
   (this repo's only supported dev shells — macOS + Ubuntu CI, no Windows path anywhere in
   `package.json`/CI), so every child process `bun run build` spawns (`check-dep-direction.mjs`,
   `esbuild.config.mjs`) inherits the cleared value, not whatever `~/.zshrc` exported into the
   parent shell.

3. **A pure, unit-tested guard function** — `assertDeterministicBuild(distDir: string): void` — new
   file `packages/extension-chrome/e2e/build-guard.ts`. Reads `dist/build-meta.json`; throws a
   single-line, actionable `Error` (never containing any key material — only the boolean and a
   fix instruction) when the file is missing (dist was never built, or was built by a version of
   `esbuild.config.mjs` that predates this marker) or when `geminiKeyFromEnv === true`. This is the
   one new piece of logic with no existing test coverage anywhere in the codebase, so it is the one
   piece of this card that gets a real TDD unit-test cycle (§5).
4. **Wired into `e2e/fixtures.ts`'s `context` fixture**, first statement, before
   `chromium.launchPersistentContext` (`fixtures.ts:16`) — every spec in the suite imports `test`
   from `fixtures.ts` (41 spec files today), so this one call site gates the entire suite, not just
   `onboarding.spec.ts`. This mirrors the existing `test.beforeEach` storage-reset hook
   (`fixtures.ts:41-46`) as the established place for suite-wide, composition-root e2e setup that
   has no dedicated unit test of its own — proven by running the suite (repo precedent: B5's
   `content.ts`/`side-panel.ts` edits, `docs/superpowers/plans/2026-07-16-b5-status-lifecycle.md`
   Tasks 6–7, "no dedicated unit test exists for `content.ts`… covered by e2e only").

### 2.2 Why a JSON marker file, not string-scanning the built bundle

`options.js`/`side-panel.js` are minified (`esbuild.config.mjs:19`, `minify: true`) — esbuild
compiles boolean `define`s to `!0`/`!1` inline at every reference site, indistinguishable from any
other minified boolean literal in the bundle without a fragile, minifier-version-coupled regex. A
small structured JSON file that `esbuild.config.mjs` writes explicitly, naming exactly the fact the
guard needs (`geminiKeyFromEnv`), is trivial to read synchronously from Node/Bun in
`e2e/build-guard.ts` and carries zero coupling to esbuild's minification output shape.

## 3. The change

### 3.1 `packages/extension-chrome/esbuild.config.mjs`

Add, after the four `esbuild.build()` calls and before the existing `copyFile`/`mkdir` block (or
interleaved with it — order among the already-unordered `copyFile` calls doesn't matter):

```js
import { writeFile } from 'node:fs/promises';
// ...
await writeFile('dist/build-meta.json', JSON.stringify({ geminiKeyFromEnv: HAS_ENV_KEY }));
```

No change to any `esbuild.build()` call, no change to what ships inside `sw.js`/`options.js`/
`side-panel.js`/`content.js` — this only adds one new, separate output file next to the existing
five copied assets.

### 3.2 `packages/extension-chrome/package.json`

Add one script, alongside the existing `build`:

```json
"build": "bun ../../scripts/check-dep-direction.mjs && bun esbuild.config.mjs",
"build:e2e": "GEMINI_API_KEY= bun run build",
```

### 3.3 Root `package.json`

Add one script, mirroring the existing `build:chrome` / `e2e:chrome` `--filter` pattern:

```json
"build:chrome": "bun run --filter '@ai-dict/extension-chrome' build",
"build:chrome:e2e": "bun run --filter '@ai-dict/extension-chrome' build:e2e",
"e2e:chrome": "bun run --filter '@ai-dict/extension-chrome' e2e",
```

### 3.4 `packages/extension-chrome/e2e/build-guard.ts` (new)

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

### 3.5 `packages/extension-chrome/e2e/fixtures.ts`

One new line inside the existing `context` fixture, before `chromium.launchPersistentContext`
(`fixtures.ts:16`):

```ts
context: async ({}, use) => {
  await assertDeterministicBuild(dist);
  const context = await chromium.launchPersistentContext('', {
    // ...unchanged
  });
  await use(context);
  await context.close();
},
```

Plus the new import: `import { assertDeterministicBuild } from './build-guard';`. No other line in
`fixtures.ts` changes.

### 3.6 `packages/extension-chrome/e2e/c10-funnel.spec.ts` (new)

The category's proof harness: one continuous journey, fresh profile → onboarding → activation →
first real lookup, modeled on `onboarding.spec.ts`'s activation test (§3.1's DOM ids:
`onboarding-view #key`, `#activate`, `settings-form #status`) chained into `saved-word.spec.ts`'s
`doLookup`-style lookup flow (`gotoFixture` → `selectWord` → `openTrigger` → assert the rendered
card text), with `mockGemini` (`helpers.ts:79-99`) standing in for the real Gemini endpoint (per
the standing constraint that no test hits the real network). Every spec's per-test
`test.beforeEach` (`fixtures.ts:41-46`) already clears `chrome.storage.local`, which **is** the
"fresh profile" — no extra setup needed for that part.

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
    // guaranteed key-free by the fixtures.ts guard, so this assertion is meaningful, not
    // incidental: a regression in the guard would surface here first as a wrong screen, not a
    // silent pass).
    const optionsPage = await context.newPage();
    await optionsPage.goto(`chrome-extension://${extensionId}/options.html`);
    await optionsPage.waitForSelector('onboarding-view');

    // 2. Activation (today's actual behavior — a non-empty key is accepted; C2's future
    // verified-activation change adds a connection.test round-trip inside this same click and
    // does not change this spec, per C10's scope fence: dev-infra only, no product behavior
    // change here).
    await optionsPage.locator('onboarding-view #key').fill('AIza-funnel-test');
    await optionsPage.locator('onboarding-view #activate').click();
    await optionsPage.waitForSelector('settings-form');
    await expect(optionsPage.locator('settings-form #status')).toContainText("You're all set");

    // 3. First successful lookup, on a real content page, using the key just saved by step 2
    // (chrome.storage.local is shared across every extension page/context — no re-seeding).
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

## 4. Scope fence (from the card, held exactly)

- **Dev-infra only — no product behavior change.** `options.ts`'s routing, `side-panel.ts`'s
  routing, and the env-key build feature itself (`README.md:320-326,443-446`) are untouched. The
  env-key build stays exactly as documented, for manual dev use.
- **No new wire message, no new domain/ports change.** Everything touched lives in
  `packages/extension-chrome/` build tooling and `e2e/` — nothing in `packages/app/src/**` (`c3-1`)
  changes.
- **No CI workflow change required.** `.github/workflows/ci.yml`'s `e2e-chrome` job never sets
  `GEMINI_API_KEY` today and needs no edit; the gap this card closes is local-machine
  reproducibility, not CI correctness (§1.3).
- **S1 held explicitly:** the guard reads and reports only the `geminiKeyFromEnv` boolean, never
  the key value, in code, error messages, or (per the card) test output/build logs.
- **No new e2e evidence video.** Per the current, standing repo convention
  (`CLAUDE.md`: "Evidence policy (owner ruling 2026-07-16): do NOT capture screenshots/videos for
  PRs… Every PR body carries a written 'Testing performed' section instead"), this card's PR
  carries a **Testing performed** section (suites run, counts, the exact repro command), not a
  `*-evidence.spec.ts` file — unlike the B5/B1-era exemplars this design otherwise follows, which
  predate that ruling.

## 5. Testing strategy

**Framed as a measured goal** (this category's own convention — see the Category C intro's
"Measured goal for the whole category"): the onboarding e2e suite
(`packages/extension-chrome/e2e/onboarding.spec.ts`, 3 specs) must pass **100% of the time**,
independent of whether `GEMINI_API_KEY` is exported in the builder's shell — collapsing today's
"0/3 passing whenever the var leaks into the build" regression to a structural impossibility, not
a lucky shell state. The paired anti-goal, held every time this metric is read: the fix must never
echo, log, or surface the key's _value_ anywhere — only the `geminiKeyFromEnv` boolean crosses any
boundary (file, error message, or test assertion). Every check below is written to read _that_
boolean, never the key, satisfying S1 by construction rather than by after-the-fact review.

1. **Unit tests for the pure guard** (new `packages/extension-chrome/test/build-guard.test.ts`,
   Vitest): `assertDeterministicBuild` resolves silently when `build-meta.json` has
   `geminiKeyFromEnv: false`; throws a message containing "GEMINI_API_KEY" and
   "build:chrome:e2e" when `geminiKeyFromEnv: true`; throws a distinct "is missing" message when
   the file doesn't exist. Uses a real temp directory (`node:fs/promises` `mkdtemp`) — no
   filesystem mocking, matching this repo's existing preference for real I/O in adapter-level
   tests (e.g. `chrome-storage-store.test.ts`).
2. **Composition-root wiring** (`fixtures.ts`'s one new line) — no dedicated unit test, same
   precedent as B1/B5/B7's `content.ts`/`side-panel.ts` edits: proven by every e2e spec run (if
   the wiring were wrong, every spec would fail immediately, not just the funnel one).
3. **The funnel e2e spec** (`c10-funnel.spec.ts`) is itself the category's regression gate —
   every other Category C card's future Definition of Done cites "the C10 funnel spec stays green"
   as its proof that the dead-end it closes stays closed.
4. **The acceptance test — the exact repro condition, made green:**
   ```
   export GEMINI_API_KEY=dummy-local-value   # simulates a ~/.zshrc export
   bun run build:chrome:e2e                  # must clear it for the build subprocess
   cd packages/extension-chrome && bunx playwright test
   ```
   Expected: full suite green, including `onboarding.spec.ts` (3/3) and the new
   `c10-funnel.spec.ts` (1/1) — with `GEMINI_API_KEY` still exported in the _shell_ throughout.
   This is the literal condition the 2026-07-16 audit reproduced as broken; it is this card's
   Definition of Done.
5. **The backstop, demonstrated once (manual verification, not a suite gate):** with
   `GEMINI_API_KEY` still exported, run the _plain_ `bun run build:chrome` (not the `:e2e` variant)
   and then any e2e spec. Expected: the suite fails immediately with
   `build-guard.ts`'s one-line, actionable error — not three unrelated-looking
   `waitForSelector('onboarding-view')` timeouts. This is the concrete evidence that option D
   (§2.1) is not redundant with option A: it is what changes a confusing failure into a diagnosable
   one when a developer bypasses or forgets the explicit script.

## 6. Evidence plan

No video/screenshot evidence (§4, current repo convention). The PR body's **Testing performed**
section states: the unit test suite for `build-guard.ts` (pass count), the full local e2e run
under the exact repro condition in §5.4 (pass count, with the shell-export command shown verbatim
so a reviewer can reproduce it), and the one-line backstop demonstration from §5.5 (the exact error
text, confirming no key value appears in it).

## 7. Risk / rollback

- **Risk: low.** Additive-only — one new build-artifact file, two new npm scripts, one new
  guarded import in `fixtures.ts`, one new spec file. No existing script's default behavior
  changes (`build:chrome` and `e2e:chrome` are untouched; `build:chrome:e2e` is new and opt-in).
  The only behavior change to an _existing_ code path is `fixtures.ts`'s `context` fixture gaining
  one `await` before it launches Chromium — every existing spec that already passes continues to
  pass, since none of them ships a key-baked `dist/` in CI or in a correctly-run local flow.
- **Rollback:** revert the single PR. `dist/build-meta.json` is gitignored and regenerated on the
  next build regardless; no persisted state, no data migration, no schema touched.

## 8. Files touched (summary)

| File                                                 | Change                                               |
| ---------------------------------------------------- | ---------------------------------------------------- |
| `packages/extension-chrome/esbuild.config.mjs`       | + write `dist/build-meta.json` (boolean marker only) |
| `packages/extension-chrome/package.json`             | + `build:e2e` script                                 |
| `package.json` (root)                                | + `build:chrome:e2e` script                          |
| `packages/extension-chrome/e2e/build-guard.ts`       | new — pure guard function                            |
| `packages/extension-chrome/test/build-guard.test.ts` | new — unit tests                                     |
| `packages/extension-chrome/e2e/fixtures.ts`          | + one guard call in the `context` fixture            |
| `packages/extension-chrome/e2e/c10-funnel.spec.ts`   | new — the category's funnel proof harness            |

No change to `packages/app/src/**`, `packages/extension-chrome/src/**` (options.ts/side-panel.ts/
sw.ts routing is read, never modified), `.github/workflows/*.yml`, or any other existing e2e spec.
