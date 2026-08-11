# Live-Gemini E2E Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one e2e spec that drives the primary lookup journey against the **real** Gemini API, turning CI red when Gemini's response contract drifts and warning (not failing) when the network merely misbehaves.

**Architecture:** A live spec is an ordinary Playwright test in the existing `e2e-chrome` job — no new workflow, project, or grep filter. It differs from a mocked spec by exactly two calls: `useLiveGemini(page)` replaces `mockGemini(context, …)`, and `expectLiveLookup(page, …)` replaces hand-written assertions. All verdict logic lives in one pure function, `classifyCardText(text)`, so it is unit-testable without a browser. A hard-rule scanner forbids `*.live.spec.ts` files from importing any mock helper, which is what stops a "live" test from silently talking to a mock.

**Tech Stack:** Playwright (`packages/extension-chrome/e2e/`), Vitest (`packages/app/test/`), Bun, Node-flavoured ESM scanners (`scripts/hard-rule/`).

**Spec:** `docs/superpowers/specs/2026-08-10-e2e-live-design.md`

## Global Constraints

- Conventional Commits for every commit subject; no `[CardName]` bracket prefix (`docs/git-conventions.md`). Branch: `feat/e2e-live-gemini`.
- Work in a git worktree under `.claude/worktrees`. Run `bun install` in a fresh worktree before the first commit, or ESLint reports thousands of unresolved-type errors.
- `bun run lint` and `bun run format:check` must pass before each commit (the pre-commit hook enforces both).
- The e2e build must stay key-free: build with `bun run build:chrome:e2e`. `e2e/build-guard.ts` fails every test if `dist` was built with `GEMINI_API_KEY` in the environment. The key reaches the extension only via `useLiveGemini`'s runtime seeding.
- Live specs assert **structure only**, never model-generated wording — the same prompt returned 434 characters with a `TRANSLATION` line on one run and 284 without it on another.
- Exact user-facing strings, copied verbatim from `packages/app/src/domain/error-mapper.ts`:
  - `'Network failed. Check connection and retry.'` (NETWORK — transport)
  - `'Gemini server error. Retry.'` (SERVER — transport)
  - `'Hit Gemini rate limit.'` (RATE_LIMIT — transport)
  - `'Gemini returned unexpected output.'` (PARSE — **contract**)
  - `'Google rejected the API key.'` (INVALID_KEY — **setup**)
  - `'Add your Gemini API key in Settings.'` (NO_KEY — **setup**)
- Provider badge selector is `.prov-badge`; the Gemini label is exactly `'Gemini'` (`lookup-card.ts:103`).

---

## File Structure

| File                                                                      | Responsibility                                                                                                                                                  |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/app/src/domain/live-outcome.ts` (create)                        | Pure `classifyCardText(text) → LiveOutcome`. No DOM, no Playwright. Lives in `domain/` because it is a decision, and `pure-core.md` puts decisions in the core. |
| `packages/app/test/domain/live-outcome.test.ts` (create)                  | One test per classification row.                                                                                                                                |
| `packages/extension-chrome/e2e/helpers-live.ts` (create)                  | The impure edge: `useLiveGemini`, `readLiveOutcome`, `expectLiveLookup`. Reads the card, delegates the verdict to `classifyCardText`.                           |
| `packages/extension-chrome/e2e/lookup-primary-flow.live.spec.ts` (create) | The one live spec.                                                                                                                                              |
| `scripts/hard-rule/check-live-e2e-purity.mjs` (create)                    | Forbids mock imports inside `*.live.spec.ts`.                                                                                                                   |
| `scripts/hard-rule/check-live-e2e-purity.test.mjs` (create)               | Unit tests for the scanner's `checkFile`.                                                                                                                       |
| `.github/workflows/ci.yml` (modify, `e2e-chrome` job)                     | Map `GEMINI_API_KEY` into the Playwright step.                                                                                                                  |
| `CLAUDE.md` (modify, "Browser testing" section)                           | The mock-vs-live rules an assistant reads each session.                                                                                                         |
| `docs/testing/e2e-live.md` (create)                                       | Classification table + assertion ladder, linked from CLAUDE.md.                                                                                                 |
| `docs/testing/e2e-case-inventory.md` (modify)                             | Register the new case per its own bookkeeping rules.                                                                                                            |

---

### Task 1: The pure classifier

**Files:**

- Create: `packages/app/src/domain/live-outcome.ts`
- Test: `packages/app/test/domain/live-outcome.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `type LiveOutcome = { kind: 'ok' } | { kind: 'transport'; detail: string } | { kind: 'setup'; detail: string } | { kind: 'contract'; detail: string }` and `classifyCardText(text: string): LiveOutcome`.

Four kinds, not three. `setup` covers an expired or wrong CI key (`'Google rejected the API key.'`): that is neither Google changing its contract nor a flaky network, and silently warning would let live coverage disappear unnoticed. It fails, with a message naming the secret.

- [ ] **Step 1: Write the failing test**

```ts
// packages/app/test/domain/live-outcome.test.ts
import { describe, it, expect } from 'vitest';
import { classifyCardText } from '../../src/domain/live-outcome';

describe('classifyCardText', () => {
  it('classifies a rendered definition as ok', () => {
    expect(classifyCardText('bank\nThe land alongside a river.')).toEqual({ kind: 'ok' });
  });

  it.each([
    ['Network failed. Check connection and retry.'],
    ['Gemini server error. Retry.'],
    ['Hit Gemini rate limit.'],
  ])('classifies %s as transport', (msg) => {
    expect(classifyCardText(`Lookup failed\n${msg}`).kind).toBe('transport');
  });

  it.each([['Google rejected the API key.'], ['Add your Gemini API key in Settings.']])(
    'classifies %s as setup',
    (msg) => {
      expect(classifyCardText(`Lookup failed\n${msg}`).kind).toBe('setup');
    },
  );

  it('classifies the PARSE message as contract drift', () => {
    const out = classifyCardText('Lookup failed\nGemini returned unexpected output.');
    expect(out.kind).toBe('contract');
    expect((out as { detail: string }).detail).toContain('unexpected output');
  });

  it('classifies an empty card as contract drift, not ok', () => {
    // A 200 that parses to nothing is drift, not a network problem.
    expect(classifyCardText('   ').kind).toBe('contract');
  });

  it('prefers the transport verdict when a card somehow shows two messages', () => {
    // Ordering guard: a transport failure must never be reported as drift.
    const out = classifyCardText(
      'Network failed. Check connection and retry.\nGemini returned unexpected output.',
    );
    expect(out.kind).toBe('transport');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --filter @ai-dict/app test live-outcome`
Expected: FAIL — `Failed to resolve import "../../src/domain/live-outcome"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/app/src/domain/live-outcome.ts

/**
 * The verdict for one live-API e2e run, decided from the card's rendered text alone.
 *
 * - `transport` — the provider was momentarily unreachable or refusing (timeout, 5xx, 429).
 *   Not our defect and genuinely intermittent, so callers warn instead of failing.
 * - `setup`     — our credentials are wrong or missing. Deterministic and actionable; failing
 *   loudly is what stops live coverage from silently disappearing behind a dead key.
 * - `contract`  — the provider answered but our parser produced nothing usable. This is the
 *   drift case the live spec exists to catch, and it is deterministic: the 2026-08-09 SSE
 *   framing bug failed 100/100 lookups.
 * - `ok`        — a definition rendered.
 */
export type LiveOutcome =
  | { kind: 'ok' }
  | { kind: 'transport'; detail: string }
  | { kind: 'setup'; detail: string }
  | { kind: 'contract'; detail: string };

// Verbatim from error-mapper.ts. Transport is matched FIRST so a card that somehow carries
// both messages can never be reported as drift — a false drift alarm would burn the signal.
const TRANSPORT = [
  'Network failed. Check connection and retry.',
  'Gemini server error. Retry.',
  'Hit Gemini rate limit.',
];
const SETUP = ['Google rejected the API key.', 'Add your Gemini API key in Settings.'];
const CONTRACT = ['Gemini returned unexpected output.'];

/** Minimum body length that separates a rendered definition from an empty/stub card. */
export const MIN_DEFINITION_CHARS = 60;

export function classifyCardText(text: string): LiveOutcome {
  const hit = (needles: string[]): string | undefined => needles.find((n) => text.includes(n));

  const transport = hit(TRANSPORT);
  if (transport !== undefined) return { kind: 'transport', detail: transport };

  const setup = hit(SETUP);
  if (setup !== undefined) return { kind: 'setup', detail: setup };

  const contract = hit(CONTRACT);
  if (contract !== undefined) return { kind: 'contract', detail: contract };

  if (text.trim().length < MIN_DEFINITION_CHARS)
    return { kind: 'contract', detail: `card rendered only ${text.trim().length} characters` };

  return { kind: 'ok' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run --filter @ai-dict/app test live-outcome`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/domain/live-outcome.ts packages/app/test/domain/live-outcome.test.ts
git commit -m "feat: add pure classifier for live-API e2e outcomes"
```

---

### Task 2: The live helpers

**Files:**

- Create: `packages/extension-chrome/e2e/helpers-live.ts`

**Interfaces:**

- Consumes: `classifyCardText`, `LiveOutcome` (Task 1); `seedSettings` from `./helpers`.
- Produces: `useLiveGemini(page: Page): Promise<void>`, `readLiveOutcome(page: Page): Promise<LiveOutcome>`, `expectLiveLookup(page: Page, opts: { word: string }): Promise<void>`, `LIVE_TIMEOUT_MS`.

No test of its own — it is the impure edge (it drives a browser). Its decision logic is already covered by Task 1, and Task 4 exercises it end to end.

**Spec deviation, deliberate — rung 7 folded into rung 8.** The spec lists "at least one streaming
repaint fired" as a best-effort warning, observed via `data-streaming` (`lookup-card.ts:995`). That
attribute is cleared the instant a terminal state renders, so by assertion time it is always gone;
observing it would need a `MutationObserver` installed before the click. That machinery buys a
signal which fully overlaps rung 8: both detect "the model stopped obeying the prompt template",
and rung 8 is readable from the settled card for free. Rung 7 is therefore not implemented, and
`docs/testing/e2e-live.md` (Task 6) must record this rather than list a rung that no code checks.

- [ ] **Step 1: Write the helper file**

```ts
// packages/extension-chrome/e2e/helpers-live.ts
import { expect, type Page } from '@playwright/test';
import { test } from './fixtures';
import { seedSettings } from './helpers';
import { classifyCardText, type LiveOutcome } from '../../app/src/domain/live-outcome';

/** How long a real Gemini call may take end to end. Generous: gemini-2.5-flash spends thinking
 * tokens before emitting text (a trivial prompt reported thoughtsTokenCount 251), and CI runners
 * are slower than a laptop, where the same flow measured 7.9s. */
export const LIVE_TIMEOUT_MS = 60_000;

/**
 * Point this test at the REAL Gemini API. Seeds the key into chrome.storage exactly the way a
 * user typing it into the options page would, so the key never enters the built bundle
 * (build-guard.ts rejects a dist built with GEMINI_API_KEY set).
 *
 * Skips the test with a warning when no key is configured, so a contributor without one is not
 * blocked. That skip is why ci.yml MUST map the secret into the job — an unmapped secret would
 * silently turn every live test into a skip, and CI would stay green while proving nothing.
 */
export async function useLiveGemini(page: Page): Promise<void> {
  const key = process.env.GEMINI_API_KEY ?? '';
  if (key === '') {
    test.info().annotations.push({
      type: 'warning',
      description: 'GEMINI_API_KEY unset — live coverage did NOT run',
    });
    test.skip(true, 'GEMINI_API_KEY unset');
    return;
  }
  await seedSettings(page, { apiKey: key, hasKey: true, provider: 'gemini' });
}

/**
 * Wait for the card to settle, then classify what it rendered.
 *
 * "Settled" means either a definition long enough to pass the threshold, or one of the known
 * error messages. A still-streaming card is neither, so polling on that condition reads the
 * final text rather than a half-painted chunk — the reason a fixed wait is not used here.
 */
export async function readLiveOutcome(page: Page): Promise<LiveOutcome> {
  const card = page.locator('lookup-card');

  const settledText = async (): Promise<string | null> => {
    if ((await card.count()) === 0) return null;
    const text = await card.innerText();
    // 'ok' means past the length threshold; any error kind carries a matched message. Both are
    // terminal. Only a short, message-free card ("still streaming") keeps us polling — that is
    // the one contract verdict produced by length alone, so it must not settle early.
    const outcome = classifyCardText(text);
    const stillStreaming = outcome.kind === 'contract' && !text.includes('unexpected output');
    return stillStreaming ? null : text;
  };

  try {
    await expect.poll(settledText, { timeout: LIVE_TIMEOUT_MS }).not.toBeNull();
  } catch {
    // Never settled. An absent or still-empty card is a transport symptom, not drift — claiming
    // drift here would raise a false alarm every time Gemini is merely slow.
    return {
      kind: 'transport',
      detail: `card never settled within ${LIVE_TIMEOUT_MS}ms`,
    };
  }

  return classifyCardText(await card.innerText());
}

/**
 * Apply the agreed ladder. Red on contract drift and on setup failure; warning-and-return on
 * transport, so a Google outage cannot redden an unrelated pull request.
 */
export async function expectLiveLookup(page: Page, opts: { word: string }): Promise<void> {
  const outcome = await readLiveOutcome(page);

  if (outcome.kind === 'transport') {
    test.info().annotations.push({
      type: 'warning',
      description: `live Gemini transport failure (not a contract break): ${outcome.detail}`,
    });
    return;
  }
  if (outcome.kind === 'setup') {
    throw new Error(
      `Live Gemini setup failure: ${outcome.detail}. The GEMINI_API_KEY secret is missing, ` +
        'expired, or rejected — fix the secret; do NOT silence this test.',
    );
  }
  if (outcome.kind === 'contract') {
    throw new Error(
      `Gemini CONTRACT DRIFT: ${outcome.detail}. Gemini answered but the client could not ` +
        'parse it — this is the failure mode that broke every lookup on 2026-08-09. ' +
        'Capture the raw response before changing this test.',
    );
  }

  // Red rungs 3 and 6. Rung 5 (body length) is already enforced inside classifyCardText, which
  // returns `contract` below MIN_DEFINITION_CHARS — asserting it again here would be dead code.
  await expect(page.locator('lookup-card h2').first()).toHaveText(opts.word);
  // Rung 6: lookup-client-selector.ts silently falls back to another configured provider, so
  // without this a Gemini break on a machine holding an OpenAI key would still pass green.
  await expect(page.locator('lookup-card .prov-badge')).toHaveText('Gemini');

  // Warning rung 8: whether the model still obeys the prompt template is a property of the
  // model, not of our wire handling, so it annotates and never fails.
  const body = await page.locator('lookup-card').innerText();
  if (!body.includes('TRANSLATION')) {
    test.info().annotations.push({
      type: 'warning',
      description: 'no translation line rendered — model may have stopped obeying the template',
    });
  }
}
```

- [ ] **Step 2: Verify it typechecks and lints**

Run: `bun run typecheck && bun run lint`
Expected: both exit 0.

- [ ] **Step 3: Commit**

```bash
git add packages/extension-chrome/e2e/helpers-live.ts
git commit -m "feat: add live-Gemini e2e helpers mirroring the mock helpers"
```

---

### Task 3: The purity scanner

**Files:**

- Create: `scripts/hard-rule/check-live-e2e-purity.mjs`
- Test: `scripts/hard-rule/check-live-e2e-purity.test.mjs`

**Interfaces:**

- Consumes: `stripComments` from `./strip-comments.mjs`.
- Produces: `RULE_ID`, `checkFile(file, source)`, `checkRepo(repoRoot)` — the same three exports every sibling scanner exposes, so `run-all.mjs` picks it up by filename with no registry edit.

- [ ] **Step 1: Write the failing test**

```js
// scripts/hard-rule/check-live-e2e-purity.test.mjs
import { describe, it, expect } from 'vitest';
import { checkFile } from './check-live-e2e-purity.mjs';

const LIVE = 'packages/extension-chrome/e2e/x.live.spec.ts';

describe('check-live-e2e-purity', () => {
  it('flags a mock import inside a live spec', () => {
    const v = checkFile(LIVE, `import { mockGemini } from './helpers';`);
    expect(v).toHaveLength(1);
    expect(v[0].match).toBe('mockGemini');
  });

  it('flags context.route in a live spec', () => {
    expect(checkFile(LIVE, `await context.route('**', r => r.abort());`)).toHaveLength(1);
  });

  it('allows non-mock helpers in a live spec', () => {
    expect(checkFile(LIVE, `import { seedSettings, selectWord } from './helpers';`)).toEqual([]);
  });

  it('ignores the same mock import in an ordinary spec', () => {
    const ordinary = 'packages/extension-chrome/e2e/x.spec.ts';
    expect(checkFile(ordinary, `import { mockGemini } from './helpers';`)).toEqual([]);
  });

  it('does not flag a mock name that only appears in a comment', () => {
    expect(checkFile(LIVE, `// never import mockGemini here\nconst a = 1;`)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run scripts/hard-rule/check-live-e2e-purity.test.mjs`
Expected: FAIL — cannot resolve `./check-live-e2e-purity.mjs`.

- [ ] **Step 3: Write the scanner**

```js
#!/usr/bin/env bun
// Hard gate against a FAKE LIVE TEST: a file named *.live.spec.ts that still talks to a mock.
//
// This is the same defect class as the 2026-08-09 outage. There, every mock hand-rolled '\n\n'
// SSE framing copied from the parser instead of the wire, so the suite could only ever confirm
// the parser agreed with itself. A live spec that quietly kept its mock recreates exactly that
// tautology while LOOKING like real coverage — greener and more misleading than no test at all.
//
// DIFFERENT from the other scanners: they govern packages/**, this one governs e2e specs by
// FILENAME suffix. Comments are stripped first (strip-comments.mjs) so prose naming a mock
// helper as documentation never false-positives.
//
// Usage: bun scripts/hard-rule/check-live-e2e-purity.mjs

import { readdirSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';

import { stripComments } from './strip-comments.mjs';

export const RULE_ID = 'rule-live-e2e-purity';

const SCAN_DIR = 'packages/extension-chrome/e2e';
const IS_LIVE_SPEC = /\.live\.spec\.ts$/;

// Every mock entry point in helpers.ts, plus the raw interception primitive.
const FORBIDDEN = [
  'mockGemini',
  'mockGeminiStream',
  'mockOpenAI',
  'mockAnthropic',
  'sseFrame',
  'context.route(',
];

/** Check one already-read file's source. Non-live specs are always clean by definition. */
export function checkFile(file, source) {
  if (!IS_LIVE_SPEC.test(file)) return [];

  const stripped = stripComments(source);
  const violations = [];
  for (const needle of FORBIDDEN) {
    let idx = stripped.indexOf(needle);
    while (idx !== -1) {
      violations.push({ file, line: stripped.slice(0, idx).split('\n').length, match: needle });
      idx = stripped.indexOf(needle, idx + needle.length);
    }
  }
  return violations;
}

function* walk(absDir) {
  for (const entry of readdirSync(absDir, { withFileTypes: true })) {
    const path = join(absDir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (/\.ts$/.test(entry.name)) yield path;
  }
}

/** Scan the e2e folder under repoRoot and return every live-purity violation. */
export function checkRepo(repoRoot) {
  const violations = [];
  for (const absPath of walk(join(repoRoot, SCAN_DIR))) {
    const file = posix.join(SCAN_DIR, posix.relative(join(repoRoot, SCAN_DIR), absPath));
    violations.push(...checkFile(file, readFileSync(absPath, 'utf8')));
  }
  return violations;
}

function main() {
  const repoRoot = new URL('../..', import.meta.url).pathname;
  const violations = checkRepo(repoRoot);
  if (violations.length === 0) {
    console.log('✓ live-e2e purity OK — no *.live.spec.ts file imports a mock helper');
    return;
  }
  console.error(`✖ live-e2e purity check failed: ${violations.length} violation(s)\n`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  found '${v.match}'`);
  }
  console.error(
    'Build blocked. A *.live.spec.ts file must reach the real provider — importing a mock ' +
      'helper (or calling context.route) makes it a fake live test that proves nothing. ' +
      'Use useLiveGemini/expectLiveLookup from e2e/helpers-live.ts, or rename the file to ' +
      'drop the .live suffix.',
  );
  process.exit(1);
}

if (import.meta.main) main();
```

- [ ] **Step 4: Run the tests and the scanner**

Run: `bunx vitest run scripts/hard-rule/check-live-e2e-purity.test.mjs && bun run lint`
Expected: 5 tests PASS; `bun run lint` now reports **7** hard-rule scanners passing, not 6.

- [ ] **Step 5: Commit**

```bash
git add scripts/hard-rule/check-live-e2e-purity.mjs scripts/hard-rule/check-live-e2e-purity.test.mjs
git commit -m "feat: add hard-rule scanner forbidding mocks in live e2e specs"
```

---

### Task 4: The live spec

**Files:**

- Create: `packages/extension-chrome/e2e/lookup-primary-flow.live.spec.ts`

**Interfaces:**

- Consumes: `useLiveGemini`, `expectLiveLookup`, `LIVE_TIMEOUT_MS` (Task 2); `gotoFixture`, `selectWord`, `openTrigger`, `seedSettings` from `./helpers`.
- Produces: nothing.

- [ ] **Step 1: Write the spec**

```ts
// packages/extension-chrome/e2e/lookup-primary-flow.live.spec.ts
import { test, expect } from './fixtures';
import { gotoFixture, selectWord, openTrigger } from './helpers';
import { useLiveGemini, expectLiveLookup, LIVE_TIMEOUT_MS } from './helpers-live';

/**
 * The app's primary journey, against the REAL Gemini API — no mock anywhere in this file
 * (enforced by scripts/hard-rule/check-live-e2e-purity.mjs).
 *
 * Exists because on 2026-08-09 every lookup in production failed while 1,054 unit tests and 224
 * e2e tests stayed green: every mock hand-rolled '\n\n' SSE framing, while Google sends
 * '\r\n\r\n'. No mocked test can catch that class of failure, by construction.
 */
test.describe('primary lookup flow (live Gemini)', () => {
  test('select → Define → card → real Gemini → rendered definition', async ({
    context,
    extensionId,
  }) => {
    test.setTimeout(LIVE_TIMEOUT_MS + 30_000);

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await useLiveGemini(page);

    await gotoFixture(page, 'She sat on the bank of the river.');
    await selectWord(page, 't', 'bank');

    // Rung 1: the Define bubble appears from the selection alone — pure UI, no network yet.
    await expect(page.locator('lookup-trigger')).toBeAttached({ timeout: 5_000 });
    await openTrigger(page);

    // Rung 2: the card mounts.
    await expect(page.locator('lookup-card')).toBeAttached({ timeout: 10_000 });

    // Rungs 3-8, including the transport/contract verdict.
    await expectLiveLookup(page, { word: 'bank' });
  });
});
```

- [ ] **Step 2: Build key-free, then run the spec against real Gemini**

```bash
bun run build:chrome:e2e
set -a && . ./.env.local && set +a
cd packages/extension-chrome && bunx playwright test lookup-primary-flow.live
```

Expected: PASS. If it fails with `Gemini CONTRACT DRIFT`, stop and capture the raw response — that means the contract changed again; do not weaken the test.

- [ ] **Step 3: Prove the spec actually catches drift (the regression proof)**

Temporarily revert the SSE delimiter, run, then restore:

```bash
# packages/app/src/app/gemini-streaming.ts — change SSE_FRAME_DELIMITER to /\n\n/ temporarily
bun run build:chrome:e2e
cd packages/extension-chrome && bunx playwright test lookup-primary-flow.live
```

Expected: FAIL, with `Gemini CONTRACT DRIFT: Gemini returned unexpected output.` — **not** a transport warning. A transport verdict here means the classifier is wrong; fix it before continuing. Then `git checkout -- packages/app/src/app/gemini-streaming.ts`, rebuild, and confirm PASS again. Record both outputs for the pull-request body.

- [ ] **Step 4: Commit**

```bash
git add packages/extension-chrome/e2e/lookup-primary-flow.live.spec.ts
git commit -m "test: cover the primary lookup flow against the real Gemini API"
```

---

### Task 5: Wire the secret into CI

**Files:**

- Modify: `.github/workflows/ci.yml` (the `e2e-chrome` job's Playwright step)

**Interfaces:**

- Consumes: `useLiveGemini`'s read of `process.env.GEMINI_API_KEY` (Task 2).
- Produces: nothing.

Setting the repository secret is not enough on its own — GitHub Actions exposes a secret only to steps that name it. Without this edit, `useLiveGemini` reads an empty string, skips, and CI stays green while proving nothing.

- [ ] **Step 1: Confirm the secret exists**

Run: `gh secret list`
Expected: a `GEMINI_API_KEY` row. As of 2026-08-10 it was **absent** (only `GA4_API_SECRET`, `GA4_MEASUREMENT_ID`, `SONAR_TOKEN`). If still absent, stop and ask the owner — the rest of this task cannot be verified.

- [ ] **Step 2: Add the env mapping**

In `.github/workflows/ci.yml`, on the `e2e-chrome` job's `bunx playwright test` step:

```yaml
- run: cd packages/extension-chrome && xvfb-run -a bunx playwright test
  env:
    GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
```

- [ ] **Step 3: Prove the key reached the test, not just the job**

Push the branch and read the `e2e-chrome` log. Expected: the live spec **passes**, and the annotation `GEMINI_API_KEY unset — live coverage did NOT run` is **absent**. A skip means the mapping did not take effect — treat a skipped live test in CI as a failure of this task.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: pass GEMINI_API_KEY to the e2e job for live coverage"
```

---

### Task 6: Documentation

**Files:**

- Create: `docs/testing/e2e-live.md`
- Modify: `CLAUDE.md` (append to the "Browser testing & extension screenshots" section)
- Modify: `docs/testing/e2e-case-inventory.md`

**Interfaces:**

- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: Write `docs/testing/e2e-live.md`**

```markdown
# Live e2e — the verdict table

A live spec (`*.live.spec.ts`) reaches the real provider. Its verdict comes from
`classifyCardText` (`packages/app/src/domain/live-outcome.ts`), which reads the rendered card.

| Verdict     | Card shows (verbatim from `error-mapper.ts`)                                                                                  | Consequence                                   |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `transport` | `Network failed. Check connection and retry.` / `Gemini server error. Retry.` / `Hit Gemini rate limit.` / card never settles | warning annotation, test **passes**           |
| `setup`     | `Google rejected the API key.` / `Add your Gemini API key in Settings.`                                                       | **fails** — the CI secret is missing or dead  |
| `contract`  | `Gemini returned unexpected output.` or a card under 60 characters                                                            | **fails** — the provider changed its contract |
| `ok`        | a definition past the length threshold                                                                                        | continue to the assertion rungs               |

Transport is matched first, so a network failure can never be misreported as drift.

## Assertion rungs

Red (blocks the merge, therefore the release):

1. Define bubble visible after selection — pure UI
2. Card visible after clicking the bubble — pure UI
3. `lookup-card h2` equals the selected word — headword comes from `req.word`, not model output
4. Card carries none of the failure strings above — the rung that catches contract drift
5. Card body over 60 characters — enforced inside `classifyCardText`, not re-asserted
6. `.prov-badge` reads `Gemini`

Warning only:

8. Card shows a `TRANSLATION` line — whether the model still obeys the template is a property of
   the model, not of our wire handling.

Rung 7 ("a streaming repaint fired") is deliberately **not implemented**: `data-streaming` is
cleared the moment a terminal state renders, so it cannot be observed after the fact, and its
signal duplicates rung 8.

## Why rung 6 is red, not cosmetic

`lookup-client-selector.ts` silently falls back to any other configured provider when the primary
fails. Without rung 6, a Gemini contract break on a machine that also holds an OpenAI key would
still pass green — the fallback would mask precisely the failure this spec exists to catch.

## Worked example — the 2026-08-09 outage

Every Gemini lookup in production failed with `Gemini returned unexpected output.` because
`gemini-streaming.ts` split the server-sent-events stream on `'\n\n'` while Google delimits frames
with `'\r\n\r\n'` (bytes `0d 0a 0d 0a`, confirmed by hexdump). 1,054 unit tests and 224 e2e tests
were green throughout: every fixture hand-rolled `'\n\n'` framing copied from the parser, so the
suite could only confirm the parser agreed with itself. No mocked test can catch that class of
failure, which is the entire reason live specs exist.
```

- [ ] **Step 2: Append to `CLAUDE.md`**

```markdown
## Two kinds of e2e — mocked (default) and live

**Mocked is the default**: fast, deterministic, and the only way to cover error branches
(401/429/500), cache, cooldown, accessibility, theming, onboarding.

**Live** is for a flow that (a) kills the whole app when it breaks and (b) depends on a third
party's response contract. Today that is exactly one flow: select → Define → card → Gemini.

When asked to make a flow "e2e live":

1. Name the file `*.live.spec.ts`.
2. Use `useLiveGemini` + `expectLiveLookup` from `e2e/helpers-live.ts`. Import **no** mock helper
   and never call `context.route` — `scripts/hard-rule/check-live-e2e-purity.mjs` blocks it,
   because a "live" spec still wired to a mock is worse than no test: it looks like coverage.
3. Assert structure only — never generated wording. The same prompt returned 434 characters with
   a translation line on one run and 284 without it on another.
4. Red on contract drift and on setup failure; warning-only on transport failure.

Details and the full verdict table: `docs/testing/e2e-live.md`.
```

- [ ] **Step 3: Update the case inventory**

The coverage metric is read mechanically by `grep -c '| \[covered\]'`, so the row must match the
existing format exactly. Add to section `## B. Lookup core flow`:

```markdown
| Primary flow against the real Gemini API (contract drift) | [covered] `lookup-primary-flow.live.spec.ts` |
```

Then update the baseline line near the top of that file (currently
`**Baseline (2026-07-16): 99 covered / 128 total = 77.3%.**`) by re-running the three `grep -c`
commands in its header and writing the new counts — do not hand-compute them.

- [ ] **Step 4: Verify gates and commit**

Run: `bun run lint && bun run format:check && bun run typecheck`
Expected: all exit 0; lint reports 7 scanners.

```bash
git add CLAUDE.md docs/testing/e2e-live.md docs/testing/e2e-case-inventory.md
git commit -m "docs: document the mocked-vs-live e2e split and its verdict table"
```

---

## Final verification

- [ ] `bun run lint` — 7 hard-rule scanners + ESLint clean.
- [ ] `bun run format:check`, `bun run typecheck` — clean.
- [ ] `bun run --filter @ai-dict/app test` — full unit suite green, including the 6 new classifier tests.
- [ ] `bunx vitest run scripts/hard-rule/check-live-e2e-purity.test.mjs` — 5 tests green.
- [ ] Full e2e suite green, with the live spec **passing** (not skipped) locally.
- [ ] Regression proof from Task 4 Step 3 recorded: reverted delimiter → `contract` verdict; restored → pass.
- [ ] `gh pr checks` all green before merging (repo merge gate — branch protection is unavailable).
- [ ] Pull-request body carries a "Testing performed" section per `CLAUDE.md`, including the Task 4 Step 3 before/after output.
