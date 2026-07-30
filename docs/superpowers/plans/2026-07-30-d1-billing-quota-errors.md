# D1 — Billing/quota-exhaustion errors (OpenAI & Anthropic) Implementation Plan

> **For agentic workers:** implement task-by-task, TDD (red → green → commit) per task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** valid-but-unfunded OpenAI/Anthropic keys today produce actively wrong errors — Anthropic's
`400` falls through to the literal string "HTTP 400", OpenAI's `429` is misclassified as a
retryable `RATE_LIMIT` — and onboarding discards the (genuinely valid) key on either failure. This
card adds a new `BILLING` `LookupErrorCode`, provider-specific detection in the pure `mapError`
core, the OpenAI client plumbing needed to see the signal, and an onboarding fix that lets the
verified-valid key survive a `BILLING` failure instead of being rolled back. Full design rationale
(every file:line grounded in the real code, both verified real-provider fixtures, and the exact
regex/detection reasoning): `docs/superpowers/specs/2026-07-30-d1-billing-quota-errors-design.md`.

**Card:** `docs/ROADMAP.md` §4 Category D, D1. **Scope fence is pinned — do not reopen.** See the
five 2026-07-30 Decision Log entries for the ratified rulings this plan implements verbatim.

**Architecture:** one new wire-protocol enum value threaded through 3 files, one new detection
branch in the pure `domain/error-mapper.ts` core (evaluated before the existing `INVALID_KEY`/
`RATE_LIMIT` arms), one widened field-forwarding object literal in the impure
`app/openai-lookup-client.ts` edge, and one corrected branch (+ a small closure variable) in the
impure `extension-chrome/src/options.ts` composition root. No new port, no new outside-world
dependency — see design spec §3 (pure core / impure edges).

**Tech Stack:** TypeScript, Vitest (unit — `packages/app/test/**`), Playwright (e2e —
`packages/extension-chrome/e2e/**`, mocked routes only).

## Global Constraints

- **Implementer: dispatch each implementation/fix task to the `hunter` subagent — never a generic
  implementer.**
- **Purity: core logic stays deterministic and side-effect-free; every outside-world dependency
  (database, network, filesystem, clock, random, global state) enters through an abstraction
  injected from the edge — never constructed inside core logic (see `~/.claude/rules/pure-core.md`).**
- Work happens in the existing worktree `/Users/home/repos/ai-dict/.claude/worktrees/d1-billing-quota-errors`
  on branch `feature/d1-billing-quota-errors` — already set up, do not create a new one.
- Commit subject convention for every task in this plan: `[D1BillingQuotaErrors] feat: <task
summary> (D1)` (fix tasks: `fix:` instead of `feat:`). No `Co-Authored-By` trailer.
- Every task commit carries trailers `Tribe-Card: d1-billing-quota-errors` and
  `Tribe-Task: N/4` (N = this task's number, 4 = total tasks in this plan).
- `bun run format:check` and `bun run lint` must be green before every commit (the
  `.githooks/pre-commit` hook enforces `format:check` already). `bun run typecheck` green after
  every task that touches TypeScript (all four tasks touch TypeScript).
- **Tests are mocked-fetch (or mocked-route, for e2e) only — no test may make a live network
  call.** Use the exact verified response bodies below as fixtures. The 401 contrast fixtures use
  an obviously-fake placeholder key string, never anything derived from a real key. **Never read,
  echo, or reference `/Users/home/repos/ai-dict/.env.local`.**
- **No telemetry/diag field changes** — `httpStatus`/`vendorStatus`/`vendorMessage` already exist
  on `LookupError` and already cross the wire; `BILLING` reuses them as-is.
- **Do not touch `packages/app/src/app/lookup-client-selector.ts`.** Its any-failure fallback is
  deliberate, shipped behavior — out of scope (Decision Log, 2026-07-30).
- **No CTA button, no hardcoded provider billing URL** anywhere in this card — wording only.
- Verified real fixture bodies (safe to commit — no key material):
  - Anthropic 400 (→ `BILLING`):
    `{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."}}`
  - Anthropic 401 (must stay `INVALID_KEY`):
    `{"error":{"type":"authentication_error","message":"API key is invalid."}}`
  - OpenAI 429 quota (→ `BILLING`):
    `{"error":{"message":"You exceeded your current quota, please check your plan and billing details...","type":"insufficient_quota","code":"insufficient_quota"}}`
  - OpenAI 401 (must stay `INVALID_KEY`):
    `{"error":{"code":"invalid_api_key","message":"Incorrect API key provided: sk-fake***.","type":"invalid_request_error"}}`
- PR: title `[D1BillingQuotaErrors] Correct billing/quota-exhaustion errors (OpenAI & Anthropic)`.
  No `.github/PULL_REQUEST_TEMPLATE` exists in this repo — the required body element is a written
  **"Testing performed"** section (suites, counts, e2e scenarios, gates); no screenshots/video
  (owner ruling 2026-07-16).
- Merge: **regular merge commit only — squash prohibited** (owner ruling 2026-07-16).
- **Pre-existing, unrelated repo-wide `format:check` break** (master HEAD `0b92353`'s
  `packages/extension-chrome/src/manifest.json` was never run through Prettier) is already fixed
  by a standalone commit on this branch (`chore: fix pre-existing format-check break in
manifest.json`) so every task's own `format:check`/CI can go green. **Do not touch
  `manifest.json` again in this plan.** Before opening the PR, rebase onto latest `master`; if PR
  #162 ("chore: unred master's format-check gate (round 2)") has landed by then, drop this
  branch's own copy of the fix as redundant (see the "Verification + delivery" section below).

---

### Task 1: Wire protocol — add `BILLING` to `LookupErrorCode`

**Files:**

- Modify: `packages/app/src/domain/types.ts` (`LookupErrorCode` union, ~:112-118)
- Modify: `packages/app/src/wire.ts` (`LookupErrorSchema`'s `code` enum, ~:11)
- Modify: `packages/app/test/wire-schema.test.ts`
- Regenerate: `packages/app/wire-schema.snapshot.json` (via `vitest -u`, not hand-edited)

- [x] **Step 1: Write the failing test.** Add to `packages/app/test/wire-schema.test.ts`,
      immediately after the existing `'accepts a valid error reply (ok:false with RATE_LIMIT
error)'` test (~line 191):

```ts
// D1: BILLING is a new, valid error code on the wire reply.
it('accepts a valid error reply (ok:false with BILLING error)', () => {
  const result = WireReplySchema.safeParse({
    ok: false,
    type: 'lookup',
    error: { code: 'BILLING', message: 'x', retryable: false },
    requestId: 'r1',
  });
  expect(result.success).toBe(true);
});
```

Run: `cd packages/app && bunx vitest run test/wire-schema.test.ts`
Expected (RED): the new test fails — `BILLING` is not yet in `LookupErrorSchema`'s `code` enum, so
`safeParse` returns `success: false`.

- [x] **Step 2: Add `BILLING` to the type union.** In `packages/app/src/domain/types.ts`, change:

```ts
export type LookupErrorCode =
  | 'NO_KEY'
  | 'INVALID_KEY'
  | 'RATE_LIMIT'
  | 'NETWORK'
  | 'PARSE'
  | 'UNKNOWN';
```

to:

```ts
export type LookupErrorCode =
  | 'NO_KEY'
  | 'INVALID_KEY'
  | 'RATE_LIMIT'
  | 'BILLING'
  | 'NETWORK'
  | 'PARSE'
  | 'UNKNOWN';
```

- [x] **Step 3: Add `BILLING` to the wire schema enum.** In `packages/app/src/wire.ts`, change:

```ts
const LookupErrorSchema = z.strictObject({
  code: z.enum(['NO_KEY', 'INVALID_KEY', 'RATE_LIMIT', 'NETWORK', 'PARSE', 'UNKNOWN']),
```

to:

```ts
const LookupErrorSchema = z.strictObject({
  code: z.enum(['NO_KEY', 'INVALID_KEY', 'RATE_LIMIT', 'BILLING', 'NETWORK', 'PARSE', 'UNKNOWN']),
```

- [x] **Step 4: Regenerate the JSON-schema snapshot.** The existing JSON-schema snapshot test uses
      `toMatchFileSnapshot` and will now also fail (RED) because the schema's enum changed.
      Regenerate it (do not hand-edit the `.json` file):

Run: `cd packages/app && bunx vitest run -u`
Expected: `wire-schema.snapshot.json` is rewritten with `BILLING` added to the `code` enum's list;
all tests in this run report PASS (both the new Step-1 test and the now-updated snapshot test).

- [x] **Step 5: Verify green + typecheck.**

Run: `bun run test`
Expected: all suites pass (no regressions elsewhere — `BILLING` is purely additive to a union/enum).

Run: `bun run typecheck`
Expected: no errors.

- [x] **Step 6: Commit**

Run:

```bash
git add packages/app/src/domain/types.ts packages/app/src/wire.ts packages/app/test/wire-schema.test.ts packages/app/wire-schema.snapshot.json
git commit -m "$(cat <<'EOF'
[D1BillingQuotaErrors] feat: add BILLING to the LookupErrorCode wire enum (D1)

Ordinary wire-protocol evolution (an error-code enum on an in-flight reply,
not persisted user data) — see Decision Log 2026-07-30. Nothing downstream
(cache/history/saved words/backup) ever stores a LookupError.

Tribe-Card: d1-billing-quota-errors
Tribe-Task: 1/4
EOF
)"
```

---

### Task 2: Pure core — `BILLING` detection in `mapError`

**Files:**

- Modify: `packages/app/src/domain/error-mapper.ts` (`mapError`'s `http` arm, ~:70-98)
- Modify: `packages/app/test/error-mapper.test.ts`
- Modify: `packages/app/test/app/anthropic-lookup-client.test.ts` (regression proof — no
  production change to `anthropic-lookup-client.ts` itself; it already forwards `error.type` as
  `vendorStatus`)
- Modify: `packages/app/test/ui/lookup-card.test.ts` (regression guard — no production change to
  `lookup-card.ts`; its generic error-state fallthrough already renders no CTA for any code but
  `NO_KEY`/`INVALID_KEY`)

**Depends on Task 1** (uses the `'BILLING'` literal, which must already typecheck).

- [x] **Step 1: Write the failing tests.** Add to `packages/app/test/error-mapper.test.ts`, as a
      new `describe` block after the existing `'mapError — vendor diagnostic fields
(adr-20260618)'` block (end of file):

```ts
describe('mapError — BILLING (D1: billing/quota exhaustion)', () => {
  it('OpenAI insufficient_quota (429 + vendorStatus) → BILLING, not retryable, honest copy', () => {
    const e = mapError({
      kind: 'http',
      status: 429,
      provider: 'openai',
      vendorStatus: 'insufficient_quota',
      vendorMessage: 'You exceeded your current quota, please check your plan and billing details.',
    });
    expect(e).toMatchObject({ code: 'BILLING', retryable: false });
    expect(e.message).toContain('OpenAI');
    expect(e.message.toLowerCase()).toContain('credit');
    expect(e.message).not.toContain('rate limit');
    expect(e.message).not.toBe('Hit OpenAI rate limit.');
  });

  it('Anthropic credit-balance 400 (status + invalid_request_error + message content) → BILLING', () => {
    const e = mapError({
      kind: 'http',
      status: 400,
      provider: 'anthropic',
      vendorStatus: 'invalid_request_error',
      vendorMessage:
        'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.',
    });
    expect(e).toMatchObject({ code: 'BILLING', retryable: false });
    expect(e.message).toContain('Claude');
    expect(e.message).not.toContain('HTTP 400');
  });

  it('an ordinary malformed 400 (no credit/billing wording) stays UNKNOWN, not BILLING', () => {
    const e = mapError({
      kind: 'http',
      status: 400,
      provider: 'anthropic',
      vendorStatus: 'invalid_request_error',
      vendorMessage: 'max_tokens: field required',
    });
    expect(e.code).toBe('UNKNOWN');
  });

  it('BILLING carries the standard http diag fields (httpStatus/vendorStatus/vendorMessage)', () => {
    const e = mapError({
      kind: 'http',
      status: 429,
      provider: 'openai',
      vendorStatus: 'insufficient_quota',
      vendorMessage: 'quota exceeded',
    });
    expect(e).toMatchObject({
      httpStatus: 429,
      vendorStatus: 'insufficient_quota',
      vendorMessage: 'quota exceeded',
    });
  });

  it('a real Anthropic rate_limit_error (429) is unaffected — still RATE_LIMIT, not BILLING', () => {
    const e = mapError({
      kind: 'http',
      status: 429,
      provider: 'anthropic',
      vendorStatus: 'rate_limit_error',
      vendorMessage: 'slow down',
    });
    expect(e.code).toBe('RATE_LIMIT');
  });

  it('genuinely invalid keys stay INVALID_KEY, never BILLING (contrast fixtures)', () => {
    const anthropic401 = mapError({
      kind: 'http',
      status: 401,
      provider: 'anthropic',
      vendorMessage: 'API key is invalid.',
    });
    expect(anthropic401.code).toBe('INVALID_KEY');

    const openai401 = mapError({
      kind: 'http',
      status: 401,
      provider: 'openai',
      vendorStatus: 'invalid_api_key',
    });
    expect(openai401.code).toBe('INVALID_KEY');
  });
});
```

Add to `packages/app/test/app/anthropic-lookup-client.test.ts`, immediately after the existing
`'HTTP 429 → RATE_LIMIT with retryAfterSec + vendorStatus/vendorMessage from body'` test:

```ts
it('D1: HTTP 400 credit-balance body → BILLING end-to-end (no client change needed)', async () => {
  const c = client(() =>
    Promise.resolve(
      res({
        ok: false,
        status: 400,
        body: {
          type: 'error',
          error: {
            type: 'invalid_request_error',
            message:
              'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.',
          },
        },
      }),
    ),
  );
  await expect(c.lookup(req)).rejects.toMatchObject({ code: 'BILLING', retryable: false });
});
```

Add to `packages/app/test/ui/lookup-card.test.ts`, immediately after the existing
`'the INVALID_KEY CTA fires open-settings with fixKey:true in its detail (C6)'` test:

```ts
it('D1: a BILLING error renders the honest message with NO CTA button', () => {
  const el = mountCard();
  el.state = {
    kind: 'error',
    error: {
      code: 'BILLING',
      message:
        'Claude account has no credits or billing set up. Add credits with Anthropic, then try again.',
      retryable: false,
    },
  };
  expect(el.querySelector('.err')!.textContent).toContain('no credits or billing');
  expect(el.querySelector('.setup-cta')).toBeNull();
});
```

Run:

```bash
cd packages/app && bunx vitest run test/error-mapper.test.ts test/app/anthropic-lookup-client.test.ts test/ui/lookup-card.test.ts
```

Expected (RED): the new `describe('mapError — BILLING ...')` tests fail (`mapError` has no
`BILLING` arm yet, so all these inputs currently fall through to `RATE_LIMIT` (429) or `UNKNOWN`
(400)); the anthropic-client test fails the same way; the lookup-card test currently PASSES already
(the generic fallthrough already renders no CTA) — leave it as an explicit regression guard, not a
red-then-green requirement.

- [x] **Step 2: Implement `BILLING` detection in `mapError`.** In
      `packages/app/src/domain/error-mapper.ts`, inside the `case 'http':` block, change the `base`
      IIFE from:

```ts
      const base = ((): LookupError => {
        if (status === 400 && geminiStatus === 'INVALID_ARGUMENT')
          return {
            code: 'INVALID_KEY',
            message: `${vendor} rejected the API key.`,
            retryable: false,
          };
```

to (inserting two new checks first):

```ts
      const base = ((): LookupError => {
        // D1: billing/quota exhaustion, checked FIRST so a dead account is never miscaught
        // by the INVALID_KEY/RATE_LIMIT arms below. Detection is provider-specific:
        if (vendorStatus === 'insufficient_quota') {
          // OpenAI's own error.code is unambiguous on its own — no status check needed.
          return {
            code: 'BILLING',
            message: `${product} account has no credits or billing set up. Add credits with ${vendor}, then try again.`,
            retryable: false,
          };
        }
        if (
          status === 400 &&
          vendorStatus === 'invalid_request_error' &&
          vendorMessage !== undefined &&
          /credit balance|billing/i.test(vendorMessage)
        ) {
          // Anthropic: status + type alone ALSO fire for ordinary malformed requests, so the
          // message content is load-bearing — anchored to the two phrases the verified real
          // message actually contains ("credit balance", "Plans & Billing").
          return {
            code: 'BILLING',
            message: `${product} account has no credits or billing set up. Add credits with ${vendor}, then try again.`,
            retryable: false,
          };
        }
        if (status === 400 && geminiStatus === 'INVALID_ARGUMENT')
          return {
            code: 'INVALID_KEY',
            message: `${vendor} rejected the API key.`,
            retryable: false,
          };
```

(Everything below this point in the IIFE — the 401/403, 429, 5xx, and fallthrough arms — is
unchanged.)

- [x] **Step 3: Verify green + typecheck.**

Run: `bun run test`
Expected: all suites pass, including every new test from Step 1 and every pre-existing test in
`error-mapper.test.ts` / `anthropic-lookup-client.test.ts` / `lookup-card.test.ts` (no regressions
— the two new checks are strictly additive guards ahead of the existing ones).

Run: `bun run typecheck`
Expected: no errors.

- [x] **Step 4: Commit**

Run:

```bash
git add packages/app/src/domain/error-mapper.ts packages/app/test/error-mapper.test.ts packages/app/test/app/anthropic-lookup-client.test.ts packages/app/test/ui/lookup-card.test.ts
git commit -m "$(cat <<'EOF'
[D1BillingQuotaErrors] feat: detect billing/quota exhaustion in mapError (D1)

Provider-specific, evaluated before INVALID_KEY/RATE_LIMIT: OpenAI's
vendorStatus==='insufficient_quota' is unambiguous on its own; Anthropic's
400+invalid_request_error additionally requires the verified "credit
balance"/"billing" message content, since that status+type pair alone also
fires for ordinary malformed requests. retryable:false is the load-bearing
fix for OpenAI (a dead quota can never succeed on retry). Verified end-to-end
through the (unmodified) Anthropic client and confirmed lookup-card renders
no CTA for BILLING by construction (generic error fallthrough).

Tribe-Card: d1-billing-quota-errors
Tribe-Task: 2/4
EOF
)"
```

---

### Task 3: `openai-lookup-client.ts` forwards `error.code` as `vendorStatus`

**Files:**

- Modify: `packages/app/src/app/openai-lookup-client.ts` (`parseErr`, ~:38-41)
- Modify: `packages/app/test/app/openai-lookup-client.test.ts`

**Depends on Task 2** (the mapper must already have the `BILLING` arm for this end-to-end test to
go green).

- [ ] **Step 1: Write the failing tests.** Add to
      `packages/app/test/app/openai-lookup-client.test.ts`, immediately after the existing `'HTTP
429 → RATE_LIMIT with retryAfterSec from header'` test:

```ts
it('D1: HTTP 429 insufficient_quota body → BILLING (client forwards error.code)', async () => {
  const c = client(() =>
    Promise.resolve(
      res({
        ok: false,
        status: 429,
        body: {
          error: {
            message: 'You exceeded your current quota, please check your plan and billing details.',
            type: 'insufficient_quota',
            code: 'insufficient_quota',
          },
        },
      }),
    ),
  );
  await expect(c.lookup(req)).rejects.toMatchObject({ code: 'BILLING', retryable: false });
});

it('D1: HTTP 401 invalid_api_key body stays INVALID_KEY, not BILLING', async () => {
  const c = client(() =>
    Promise.resolve(
      res({
        ok: false,
        status: 401,
        body: {
          error: {
            code: 'invalid_api_key',
            message: 'Incorrect API key provided: sk-fake***.',
            type: 'invalid_request_error',
          },
        },
      }),
    ),
  );
  await expect(c.lookup(req)).rejects.toMatchObject({ code: 'INVALID_KEY' });
});
```

Run: `cd packages/app && bunx vitest run test/app/openai-lookup-client.test.ts`
Expected (RED): the first new test fails — `parseErr` today drops `error.code`, so the mapper never
sees `insufficient_quota` and the existing bare `status === 429` arm returns `RATE_LIMIT` instead.
The second new test currently passes already (401 is unaffected either way) — kept as an explicit
regression guard for the widened `parseErr`.

- [ ] **Step 2: Widen `parseErr` to forward `error.code` as `vendorStatus`.** In
      `packages/app/src/app/openai-lookup-client.ts`, change:

```ts
interface OpenAIErrBody {
  error?: { message?: string; code?: string; type?: string };
}
```

(unchanged — the field already exists on the interface) and change:

```ts
        // OpenAI carries no status vocabulary we map (HTTP status alone drives mapping); its
        // error.message is the diagnostic signal for telemetry.
        parseErr: (json) => {
          const message = (json as OpenAIErrBody).error?.message;
          return message !== undefined ? { vendorMessage: message } : {};
        },
```

to:

```ts
        // D1: error.code is now a mapping signal too (e.g. 'insufficient_quota' → BILLING),
        // forwarded as vendorStatus to match Anthropic's existing pattern (error.type).
        parseErr: (json) => {
          const err = (json as OpenAIErrBody).error;
          return {
            ...(err?.code !== undefined ? { vendorStatus: err.code } : {}),
            ...(err?.message !== undefined ? { vendorMessage: err.message } : {}),
          };
        },
```

- [ ] **Step 3: Verify green + typecheck.**

Run: `bun run test`
Expected: all suites pass, including both new tests and every pre-existing
`openai-lookup-client.test.ts` test (e.g. the existing bare `'HTTP 429 → RATE_LIMIT with
retryAfterSec from header'` test has no `error.code` in its body, so `vendorStatus` stays
`undefined` and that arm is untouched — confirms no regression).

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

Run:

```bash
git add packages/app/src/app/openai-lookup-client.ts packages/app/test/app/openai-lookup-client.test.ts
git commit -m "$(cat <<'EOF'
[D1BillingQuotaErrors] feat: forward OpenAI error.code as vendorStatus (D1)

Matches anthropic-lookup-client.ts's existing pattern (error.type ->
vendorStatus). Without this the mapper's insufficient_quota check can never
fire for OpenAI — the 429 body's error.code was previously dropped entirely.

Tribe-Card: d1-billing-quota-errors
Tribe-Task: 3/4
EOF
)"
```

---

### Task 4: Onboarding — a `BILLING` failure keeps the key instead of rolling it back

**Files:**

- Modify: `packages/extension-chrome/src/options.ts` (`mountOnboarding`, ~:254-349)
- Create: `packages/extension-chrome/e2e/d1-billing-quota-errors.spec.ts`

**Depends on Tasks 1-3** (needs the full `BILLING` code + OpenAI/Anthropic detection already
working so the mocked e2e routes actually classify as `BILLING`).

`options.ts` is a composition root (chrome.storage/DOM edge code) and is explicitly excluded from
unit-test coverage in `packages/extension-chrome/vitest.config.ts` — its only test surface is the
project's Playwright e2e harness, per repo convention. TDD here means: write the e2e spec first
(RED — it fails against today's unconditional-rollback code), then implement the fix (GREEN).

- [ ] **Step 1: Build first so the e2e harness has a current `dist/`.**

Run: `bun run build:chrome`
Expected: build succeeds, `packages/extension-chrome/dist` is refreshed.

- [ ] **Step 2: Write the failing e2e spec.** Create
      `packages/extension-chrome/e2e/d1-billing-quota-errors.spec.ts`:

```ts
import { test, expect } from './fixtures';
import { mockAnthropic, mockOpenAI } from './helpers';

test.describe('D1 billing/quota-exhaustion errors', () => {
  test('an Anthropic BILLING failure keeps the pasted key and offers Save anyway with honest copy', async ({
    context,
    extensionId,
  }) => {
    const calls = await mockAnthropic(context, {
      status: 400,
      body: JSON.stringify({
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message:
            'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.',
        },
      }),
    });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.waitForSelector('onboarding-view');

    await page.locator('onboarding-view button[data-provider="anthropic"]').click();
    await page.locator('onboarding-view #key').fill('sk-ant-fake-key-for-e2e');
    await page.locator('onboarding-view #activate').click();

    await expect(page.locator('onboarding-view #status')).toContainText('no credits or billing', {
      timeout: 10_000,
    });
    await expect(page.locator('onboarding-view #status')).toHaveClass(/error/);
    // The pasted key must already be present — no click required (the corrected acceptance test).
    let stored = await page.evaluate(async () => {
      const { settings } = (await chrome.storage.local.get('settings')) as {
        settings?: { anthropicApiKey?: string };
      };
      return settings?.anthropicApiKey ?? '';
    });
    expect(stored).toBe('sk-ant-fake-key-for-e2e');
    expect(calls.count).toBe(1);

    // "Save anyway" is offered and its confirmation copy is honest (never the NETWORK wording).
    const saveAnyway = page.locator('onboarding-view #save-anyway');
    await expect(saveAnyway).toBeVisible();
    await saveAnyway.click();
    await page.waitForSelector('settings-form', { timeout: 10_000 });
    await expect(page.locator('settings-form #status')).toContainText('add billing');
    await expect(page.locator('settings-form #status')).not.toContainText(
      'connection could not be reached',
    );

    stored = await page.evaluate(async () => {
      const { settings } = (await chrome.storage.local.get('settings')) as {
        settings?: { anthropicApiKey?: string };
      };
      return settings?.anthropicApiKey ?? '';
    });
    expect(stored).toBe('sk-ant-fake-key-for-e2e');
  });

  test('an OpenAI BILLING failure keeps the pasted key too (provider-agnostic fix)', async ({
    context,
    extensionId,
  }) => {
    await mockOpenAI(context, {
      status: 429,
      body: JSON.stringify({
        error: {
          message: 'You exceeded your current quota, please check your plan and billing details.',
          type: 'insufficient_quota',
          code: 'insufficient_quota',
        },
      }),
    });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.waitForSelector('onboarding-view');

    await page.locator('onboarding-view button[data-provider="openai"]').click();
    await page.locator('onboarding-view #key').fill('sk-openai-fake-key-for-e2e');
    await page.locator('onboarding-view #activate').click();

    await expect(page.locator('onboarding-view #status')).toContainText('no credits or billing', {
      timeout: 10_000,
    });
    const stored = await page.evaluate(async () => {
      const { settings } = (await chrome.storage.local.get('settings')) as {
        settings?: { openaiApiKey?: string };
      };
      return settings?.openaiApiKey ?? '';
    });
    expect(stored).toBe('sk-openai-fake-key-for-e2e');
  });

  test('an INVALID_KEY failure still hard-rolls-back (regression guard, unaffected by D1)', async ({
    context,
    extensionId,
  }) => {
    await mockAnthropic(context, {
      status: 401,
      body: JSON.stringify({
        error: { type: 'authentication_error', message: 'API key is invalid.' },
      }),
    });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.waitForSelector('onboarding-view');

    await page.locator('onboarding-view button[data-provider="anthropic"]').click();
    await page.locator('onboarding-view #key').fill('sk-ant-bad');
    await page.locator('onboarding-view #activate').click();

    await expect(page.locator('onboarding-view #status')).toContainText('rejected the API key', {
      timeout: 10_000,
    });
    await expect(page.locator('onboarding-view #save-anyway')).toBeHidden();
    const stored = await page.evaluate(async () => {
      const { settings } = (await chrome.storage.local.get('settings')) as {
        settings?: { anthropicApiKey?: string };
      };
      return settings?.anthropicApiKey ?? '';
    });
    expect(stored).toBe('');
  });
});
```

Run: `cd packages/extension-chrome && bunx playwright test d1-billing-quota-errors.spec.ts`
Expected (RED): the first two tests fail — today's unconditional rollback discards the key on any
non-`NETWORK` failure, so `stored` comes back `''`/`undefined`, not the pasted key. The third test
(INVALID_KEY) already passes today — kept as an explicit regression guard.

- [ ] **Step 3: Implement the onboarding fix.** In `packages/extension-chrome/src/options.ts`,
      inside `mountOnboarding`, add a closure variable right after the `value` assignment:

```ts
(view as unknown as { value: OnboardingValue }).value = {
  provider: initial.provider ?? 'gemini',
  apiKey: '',
  targetLang: initial.targetLang,
};
// D1: tracks which failure reason last opened the "Save anyway" escape hatch, so its
// confirmation copy can be honest about whether the connection was ever reached.
let saveAnywayReason: 'NETWORK' | 'BILLING' | null = null;
```

Then change the `save` listener's failure branch from:

```ts
// C2: persist only on pass — roll back to the exact pre-onboarding snapshot on any
// connection.test failure so a bad/unverified key never lingers silently.
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
```

to:

```ts
// D1: a BILLING failure is itself proof the key is valid (the provider's own
// 400/429 response required a genuine key to reach that check) — unlike every
// other failure, the just-tested key must survive, so the rollback is skipped.
if (r.error.code === 'BILLING') {
  saveAnywayReason = 'BILLING';
  view.setBusy(false);
  view.setStatus(`${r.error.message} Your key was saved.`, 'error');
  view.showSaveAnyway(true);
  return;
}
// C2: persist only on pass — roll back to the exact pre-onboarding snapshot on any
// other connection.test failure so a bad/unverified key never lingers silently.
void chrome.storage.local.set({ settings: cur }).then(() => {
  view.setBusy(false);
  if (r.error.code === 'NETWORK') {
    saveAnywayReason = 'NETWORK';
    view.setStatus(
      `${r.error.message} You can save without testing and verify later in Settings.`,
      'error',
    );
    view.showSaveAnyway(true);
  } else {
    view.setStatus(r.error.message, 'error');
  }
});
```

Then change the `save-anyway` listener from:

```ts
view.addEventListener('save-anyway', (e) => {
  const { provider, apiKey, targetLang } = (e as CustomEvent<OnboardingValue>).detail;
  void load()
    .then((cur) => {
      const next = applyProviderKey(cur, provider, apiKey, targetLang);
      return chrome.storage.local.set({
        settings: {
          ...next,
          hasKey: hasKeyFor(next),
          configuredProviders: configuredProvidersFor(next, { envGeminiKey: KEY_FROM_ENV }),
        },
      });
    })
    .then(load)
    .then(
      (s) =>
        mountSettings(
          s,
          'Saved without testing — the connection could not be reached. Run Test connection ' +
            'in Settings once you’re back online.',
        ),
      () => {
        view.setBusy(false);
        view.setStatus('Could not save your key. Try again.', 'error');
      },
    );
});
```

to:

```ts
view.addEventListener('save-anyway', (e) => {
  const { provider, apiKey, targetLang } = (e as CustomEvent<OnboardingValue>).detail;
  const reason = saveAnywayReason;
  void load()
    .then((cur) => {
      const next = applyProviderKey(cur, provider, apiKey, targetLang);
      return chrome.storage.local.set({
        settings: {
          ...next,
          hasKey: hasKeyFor(next),
          configuredProviders: configuredProvidersFor(next, { envGeminiKey: KEY_FROM_ENV }),
        },
      });
    })
    .then(load)
    .then(
      (s) =>
        mountSettings(
          s,
          reason === 'BILLING'
            ? 'Saved. Your key is valid — add billing with your provider, then run Test ' +
                'connection in Settings.'
            : 'Saved without testing — the connection could not be reached. Run Test connection ' +
                'in Settings once you’re back online.',
        ),
      () => {
        view.setBusy(false);
        view.setStatus('Could not save your key. Try again.', 'error');
      },
    );
});
```

(A genuine `INVALID_KEY`/`NO_KEY`/`PARSE`/`UNKNOWN` failure is unaffected: the rollback still fires
unconditionally and no escape hatch appears.)

- [ ] **Step 4: Rebuild and re-run the e2e spec.**

Run: `bun run build:chrome`
Run: `cd packages/extension-chrome && bunx playwright test d1-billing-quota-errors.spec.ts`
Expected (GREEN): all three tests pass.

- [ ] **Step 5: Verify the full e2e suite + typecheck (no regressions to C2/other onboarding
      specs).**

Run: `bun run e2e:chrome`
Expected: all e2e specs pass, including `c2-verified-activation.spec.ts` unchanged (its NETWORK
path and exact confirmation copy are untouched by this diff).

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

Run:

```bash
git add packages/extension-chrome/src/options.ts packages/extension-chrome/e2e/d1-billing-quota-errors.spec.ts
git commit -m "$(cat <<'EOF'
[D1BillingQuotaErrors] fix: keep the key on a BILLING onboarding failure (D1)

The rollback (chrome.storage.local.set({settings: cur})) was unconditional
for every non-ok connection.test reply; only the NETWORK-only escape-hatch
button sat on top of it. A BILLING failure is itself proof the key works (the
provider's own 400/429 required a valid key to reach that error), so the
rollback is now skipped for BILLING specifically and the same save-anyway
button is reused, with reason-specific confirmation copy (never claims "the
connection could not be reached" when it was). INVALID_KEY and every other
code still hard-rolls-back, unchanged.

Acceptance test (pinned by the card): after a BILLING failure, the pasted key
is already present in chrome.storage.local with no click required — proven by
e2e for both providers, plus a regression guard for INVALID_KEY.

Tribe-Card: d1-billing-quota-errors
Tribe-Task: 4/4
EOF
)"
```

---

## Verification + delivery (not a plan task — Warchief-owned, no Hunter dispatch)

This is a verification/cleanup + delivery pass, not new implementation — it is deliberately NOT a
numbered plan "Task" (no dedicated Hunter task, no single mandatory commit): if a gate below turns
up a real regression, fix it via a fresh Hunter dispatch against the specific task it regressed
(tagged with that task's own `Tribe-Task: N/4` trailer), not as a new task number.

- [ ] Run every gate from a clean state:

```bash
bun run format:check
bun run lint
bun run typecheck
bun run test
bun run build:chrome
bun run e2e:chrome
```

Expected: all green.

- [ ] Rebase onto latest `master` and resolve the pre-existing-fix redundancy:

```bash
git fetch origin master
git rebase origin/master
```

If PR #162 ("chore: unred master's format-check gate (round 2)") has merged into `master` by now,
this branch's own standalone `manifest.json` prettier-fix commit becomes a no-op/duplicate during
the rebase (identical resulting content) — keep it only if the rebase does not naturally drop it;
do not manually re-introduce a diff against an already-fixed file. Re-run the gates above after the
rebase to confirm everything is still green on top of the new `master`.

- [ ] Open the PR (title/body per Global Constraints).
- [ ] Watch CI to green (`gh run watch`).
- [ ] Merge (`gh pr merge --merge`) once green — regular merge, no squash.
- [ ] Updating `docs/ROADMAP.md`'s D1 card status is the Shaman's job, not this plan's — leave the
      card text as delivered; report the shipped outcome back to the Shaman instead of editing the
      roadmap.
