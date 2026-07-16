# C6 Invalid-Key Recovery Flow Implementation Plan

> **For agentic workers:** implement task-by-task, TDD (red → green → commit) per task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the INVALID_KEY error card deep-links to the options page in a "fix-key" mode — the key
field pre-focused, likely-causes copy shown, and one `connection.test` auto-run the moment the
reader saves a corrected key — replacing today's identical, undifferentiated "Open Settings"
button the NO_KEY card also uses. No new error taxonomy; the existing `connection.test` round trip
is reused verbatim.

**Architecture:** almost everything is additive. One new domain file (a single storage-key
constant, `c3-1`), one optional field on an existing wire message, one new branch in an existing
router case, one optional parameter on an existing UI factory function (`settingsCta`), two new
`SettingsForm` methods, and edits to three composition-root files
(`content.ts`/`side-panel.ts`/`options.ts`) that are e2e-covered by precedent (no dedicated unit
test exists for composition roots in this repo — see B5's Task 6/7 rationale, reused here
verbatim). Full design rationale, including the pinned deep-link mechanism and the constraint-4
argument for the auto-retest, is in:
`docs/superpowers/specs/2026-07-16-c6-invalid-key-recovery-design.md`.

**Tech Stack:** TypeScript, Zod (wire schema), Vitest + happy-dom (unit), Playwright (e2e).

## Global Constraints

- Implementer: dispatch each implementation/fix task to the `hunter` subagent — never a generic
  implementer.
- **Do not touch** `packages/app/src/domain/error-mapper.ts`, `packages/app/src/domain/types.ts`,
  or `packages/app/src/ports.ts` — this card adds zero new error codes and zero new ports
  (`RouterDeps.kv`/`RouterDeps.openOptions` already exist and are reused as-is).
- **No new manifest permissions** — the chosen mechanism (a storage flag, not a URL hash/
  `chrome.tabs.*`) needs none; do not add `"tabs"` to `manifest.json`.
- **Reuse the existing `connection.test` message — no new wire message for the test itself.** The
  only wire change in this plan is one optional field (`fixKey`) on `open-options`.
- UI additions read only `--ad-*`/`--adp-*` design tokens — this plan adds **no new markup or
  CSS**; every new bit of UI reuses an existing element (`#key`, `#status`/`setStatus()`).
- `bun run lint` and `bun run format:check` clean before every commit.
- Every task must leave `cd packages/app && bun run typecheck` (and, from Task 4 on,
  `cd packages/extension-chrome && bun run typecheck`) green.
- Commit subject convention for every task in this plan: `feat: invalid-key recovery — <task
summary> (C6)`.
- **No PR screenshots/videos** (owner ruling 2026-07-16, `CLAUDE.md`) — the PR body carries a
  written "Testing performed" section instead (suites + counts, e2e scenario, gate commands). See
  design spec §7.
- PR merges via a regular (non-squash) merge commit — no-squash policy.

---

### Task 1: Domain — `FIX_KEY_PENDING_STORAGE_KEY` constant

**Files:**

- Create: `packages/app/src/domain/ui-flags.ts`
- Modify: `packages/app/src/index.ts`

This task has no dedicated unit test: a single exported string literal has no behavior of its own
to fail red — its correctness is proven by the Task 2 router test (which asserts the exact literal
is what gets written to the fake KV) and the Task 7 options.ts wiring (e2e-covered). Writing a
test that only asserts `FIX_KEY_PENDING_STORAGE_KEY === 'ui:fixKeyPending'` would test the literal
against itself, not behavior — skip it, per test-first's own "a test you cannot write meaningfully
is a signal" spirit.

- [ ] **Step 1: Create the file.** `packages/app/src/domain/ui-flags.ts`:

```ts
/**
 * C6: one-shot flag consumed by options.ts to enter "fix the rejected key" mode — focus the key
 * field, show likely-causes copy, and auto-run one connection.test after the very next Save. Set
 * by the router's `open-options` handler when the triggering `open-settings` event carried
 * `{ fixKey: true }` (the INVALID_KEY card's CTA only), or by the side panel's own direct-open
 * path (side-panel.ts calls chrome.runtime.openOptionsPage itself rather than routing through the
 * wire — see its existing 'open-settings' listener).
 *
 * A NEW namespace: ref-kv-storage-prefixes already reserves cache:/history:/saved:/nudge: for
 * persisted domain data. This key is a transient UI signal (written, read once, deleted within
 * the same options-page load) — not saved user data, so it does not extend any of those four.
 */
export const FIX_KEY_PENDING_STORAGE_KEY = 'ui:fixKeyPending';
```

- [ ] **Step 2: Re-export.** In `packages/app/src/index.ts`, add a line next to the existing
      domain re-exports (after `export * from './domain/nudge-policy';`, before
      `export * from './domain/error-mapper';` — i.e. among the other single-concern domain
      files):

```ts
export * from './domain/ui-flags';
```

- [ ] **Step 3: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd .. && bun run lint && bun run format:check
```

Commit:

```
git add packages/app/src/domain/ui-flags.ts packages/app/src/index.ts
git commit -m "feat: invalid-key recovery — add FIX_KEY_PENDING_STORAGE_KEY constant (C6)" \
  -m $'Tribe-Card: c6-invalid-key-recovery\nTribe-Task: 1/8'
```

---

### Task 2: Wire schema `open-options.fixKey` + router arm (combined — the brief's own instruction: wire schema and router change land in one task)

**Files:**

- Modify: `packages/app/src/wire.ts`
- Modify: `packages/app/src/app/router.ts`
- Modify: `packages/app/test/wire-schema.test.ts`
- Modify: `packages/app/test/app/router.test.ts`
- Modify: `packages/app/wire-schema.snapshot.json` (regenerated, not hand-edited)

- [ ] **Step 1: Write the failing tests.**

Append to `packages/app/test/wire-schema.test.ts`, immediately after the existing
`'accepts open-options message'` test (around line 135-137):

```ts
it('accepts an open-options message with fixKey (C6)', () => {
  expect(WireMessageSchema.safeParse({ type: 'open-options', fixKey: true }).success).toBe(true);
  expect(WireMessageSchema.safeParse({ type: 'open-options', fixKey: false }).success).toBe(true);
});

it('rejects an open-options message with a non-boolean fixKey (C6)', () => {
  expect(WireMessageSchema.safeParse({ type: 'open-options', fixKey: 'yes' }).success).toBe(false);
});
```

Append to `packages/app/test/app/router.test.ts`, immediately after the existing
`'open-options without an openOptions port still replies ack (no crash)'` test (around line
595-599):

```ts
it('open-options with fixKey:true writes the pending flag before opening (C6)', async () => {
  const calls: string[] = [];
  const d = deps({
    openOptions: () => {
      calls.push('openOptions');
    },
  });
  const setItemSpy = vi.spyOn(d.kv, 'setItem');
  const route = buildRouter(d);
  const reply = await route({ type: 'open-options', fixKey: true });
  expect(setItemSpy).toHaveBeenCalledWith('ui:fixKeyPending', '1');
  // The flag write must happen before openOptions() is invoked (§2.2 of the design spec).
  expect(calls).toEqual(['openOptions']);
  expect(setItemSpy.mock.invocationCallOrder[0]).toBeLessThan(
    (d.openOptions as ReturnType<typeof vi.fn>).mock.invocationCallOrder?.[0] ?? Infinity,
  );
  expect(reply).toMatchObject({ ok: true, type: 'ack' });
});

it('open-options with fixKey:false never writes the pending flag (C6)', async () => {
  const d = deps();
  const setItemSpy = vi.spyOn(d.kv, 'setItem');
  const route = buildRouter(d);
  await route({ type: 'open-options', fixKey: false });
  expect(setItemSpy).not.toHaveBeenCalled();
});

it('open-options with fixKey omitted never writes the pending flag (C6)', async () => {
  const d = deps();
  const setItemSpy = vi.spyOn(d.kv, 'setItem');
  await buildRouter(d)({ type: 'open-options' });
  expect(setItemSpy).not.toHaveBeenCalled();
});
```

If the local `deps()` test helper's `openOptions` is not already a `vi.fn()`, adjust the first new
test to wrap it (`vi.fn(() => { calls.push('openOptions'); })`) so
`invocationCallOrder` is available — match whatever mocking style the existing
`'open-options → calls the injected openOptions port and replies ack'` test (line 587-593) already
uses for `openOptions`, and keep the two tests' style consistent.

Run: `cd packages/app && bunx vitest run test/wire-schema.test.ts test/app/router.test.ts`
Expected: the 2 new wire-schema tests and 3 new router tests fail (`fixKey` not recognized by the
schema; router never calls `setItem`) plus the wire-schema snapshot test now ALSO failing once
Step 2 adds the new field (expected, resolved in Step 3).

- [ ] **Step 2: Implement.**

In `packages/app/src/wire.ts`, change the existing `open-options` arm (line 133):

```ts
z.object({ type: z.literal('open-options'), fixKey: z.boolean().optional() }),
```

In `packages/app/src/app/router.ts`:

1. Add `FIX_KEY_PENDING_STORAGE_KEY` to the existing `'../index'` import block.
2. Change the existing `open-options` case (lines 272-274):

```ts
case 'open-options':
  if (msg.fixKey) await deps.kv.setItem(FIX_KEY_PENDING_STORAGE_KEY, '1');
  await deps.openOptions?.();
  return { ok: true, type: 'ack' };
```

Run: `cd packages/app && bunx vitest run test/wire-schema.test.ts test/app/router.test.ts`
Expected: the 5 new tests pass; the snapshot test fails (`toMatchFileSnapshot` mismatch) — expected,
resolved in Step 3.

- [ ] **Step 3: Commit** — regenerate the snapshot, then gate and commit:

```
cd packages/app && bunx vitest run test/wire-schema.test.ts -u
```

Expected: snapshot test now passes; `git diff packages/app/wire-schema.snapshot.json` shows only
the new `fixKey` field added to `open-options`.

```
cd packages/app && bun run typecheck && cd .. && bun run lint && bun run format:check
```

Commit:

```
git add packages/app/src/wire.ts packages/app/src/app/router.ts \
  packages/app/test/wire-schema.test.ts packages/app/test/app/router.test.ts \
  packages/app/wire-schema.snapshot.json
git commit -m "feat: invalid-key recovery — add open-options.fixKey wire field + router arm (C6)" \
  -m $'Tribe-Card: c6-invalid-key-recovery\nTribe-Task: 2/8'
```

---

### Task 3: UI — `settingsCta(label, opts)` + INVALID_KEY CTA relabel

**Files:**

- Modify: `packages/app/src/ui/lookup-card.ts`
- Modify: `packages/app/test/ui/lookup-card.test.ts`

- [ ] **Step 1: Write the failing tests.**

First, locate and **update** the existing test at
`packages/app/test/ui/lookup-card.test.ts:144-152`
(`'a rejected (invalid) key keeps the error but still offers Open Settings'`): change its final
assertion from

```ts
expect(el.querySelector<HTMLButtonElement>('.setup-cta')!.textContent).toBe('Open Settings');
```

to

```ts
expect(el.querySelector<HTMLButtonElement>('.setup-cta')!.textContent).toBe('Fix key in Settings');
```

(rename the test itself too, e.g. `'a rejected (invalid) key keeps the error but offers a fix-key
CTA'`).

Then append two new tests near it:

```ts
it('the INVALID_KEY CTA fires open-settings with fixKey:true in its detail (C6)', () => {
  const el = mountCard();
  el.state = {
    kind: 'error',
    error: { code: 'INVALID_KEY', message: 'Google rejected the API key.', retryable: false },
  };
  const handler = vi.fn();
  document.body.addEventListener('open-settings', handler);
  el.querySelector<HTMLButtonElement>('.setup-cta')!.click();
  document.body.removeEventListener('open-settings', handler);
  expect(handler).toHaveBeenCalledTimes(1);
  const event = handler.mock.calls[0]![0] as CustomEvent<{ fixKey?: boolean } | undefined>;
  expect(event.detail?.fixKey).toBe(true);
});

it('the NO_KEY setup-invite CTA still fires open-settings with no fixKey (C6 regression guard)', () => {
  const el = mountCard();
  el.state = {
    kind: 'error',
    error: { code: 'NO_KEY', message: 'Add your key.', retryable: false },
  };
  const handler = vi.fn();
  document.body.addEventListener('open-settings', handler);
  el.querySelector<HTMLButtonElement>('.setup-cta')!.click();
  document.body.removeEventListener('open-settings', handler);
  const event = handler.mock.calls[0]![0] as CustomEvent<{ fixKey?: boolean } | undefined>;
  expect(event.detail?.fixKey).not.toBe(true);
});
```

Run: `cd packages/app && bunx vitest run test/ui/lookup-card.test.ts`
Expected: the updated test fails (still asserts old label until Step 2), the two new tests fail
(`settingsCta` doesn't accept a second parameter / never sets `detail`).

- [ ] **Step 2: Implement.** In `packages/app/src/ui/lookup-card.ts`:

1. Change the `settingsCta` factory (lines 199-209):

```ts
function settingsCta(label: string, opts?: { fixKey?: boolean }): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'setup-cta';
  b.textContent = label;
  b.addEventListener('click', () =>
    b.dispatchEvent(
      new CustomEvent('open-settings', {
        detail: opts?.fixKey ? { fixKey: true } : undefined,
        bubbles: true,
        composed: true,
      }),
    ),
  );
  return b;
}
```

2. `renderSetupInvite()` (line 227) — no change, still `settingsCta('Open Settings')`.
3. The `INVALID_KEY` branch (line 273):

```ts
if (state.error.code === 'INVALID_KEY')
  return [h, p, settingsCta('Fix key in Settings', { fixKey: true })];
```

Run: `cd packages/app && bunx vitest run test/ui/lookup-card.test.ts`
Expected: all tests pass (existing suite + updated + 2 new).

- [ ] **Step 3: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd .. && bun run lint && bun run format:check
```

Commit:

```
git add packages/app/src/ui/lookup-card.ts packages/app/test/ui/lookup-card.test.ts
git commit -m "feat: invalid-key recovery — settingsCta fixKey detail + relabel INVALID_KEY CTA (C6)" \
  -m $'Tribe-Card: c6-invalid-key-recovery\nTribe-Task: 3/8'
```

---

### Task 4: Wire the in-page card composition root (`content.ts`)

**Files:**

- Modify: `packages/extension-chrome/src/content.ts`

No dedicated unit test exists for `content.ts` (composition root, e2e-only — same precedent as
B5's Task 6). Still run the typecheck gate at the end so a regression in existing behavior is
caught immediately.

- [ ] **Step 1: Implement.** In `packages/extension-chrome/src/content.ts`, replace the existing
      `open-settings` listener (lines 141-143):

```ts
document.addEventListener('open-settings', (e) => {
  // C6: the INVALID_KEY card's CTA carries { fixKey: true }; the NO_KEY CTA and the card's own
  // header Settings gear (lookup-card.ts's separate act==='settings' dispatch) carry no detail —
  // both resolve fixKey to false here, an unchanged `open-options` message from their perspective.
  const fixKey = (e as CustomEvent<{ fixKey?: boolean } | undefined>).detail?.fixKey === true;
  void chrome.runtime.sendMessage({ type: 'open-options', fixKey });
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
git add packages/extension-chrome/src/content.ts
git commit -m "feat: invalid-key recovery — forward fixKey from the in-page card's open-settings (C6)" \
  -m $'Tribe-Card: c6-invalid-key-recovery\nTribe-Task: 4/8'
```

---

### Task 5: Wire the side-panel composition root (`side-panel.ts`)

**Files:**

- Modify: `packages/extension-chrome/src/side-panel.ts`

Same rationale as Task 4 — no dedicated unit test; e2e-covered in Task 8.

- [ ] **Step 1: Implement.** In `packages/extension-chrome/src/side-panel.ts`:

1. Add `FIX_KEY_PENDING_STORAGE_KEY` to the file's existing `@ai-dict/app` import.
2. Replace the existing `open-settings` listener (lines 172-174):

```ts
// The no-key/invalid-key CTA's "Open Settings" (or, for INVALID_KEY, "Fix key in Settings")
// button bubbles `open-settings` out of the focus region. The panel is an extension page, so it
// can open the options page directly — mirroring content.ts's wire-relay path, but writing the
// C6 flag straight to storage instead of via the router (same asymmetry this listener already
// had before C6: it always skipped the wire for the plain open-options case).
view.addEventListener('open-settings', (e) => {
  const fixKey = (e as CustomEvent<{ fixKey?: boolean } | undefined>).detail?.fixKey === true;
  void (async () => {
    if (fixKey) await chrome.storage.local.set({ [FIX_KEY_PENDING_STORAGE_KEY]: '1' });
    await chrome.runtime.openOptionsPage();
  })();
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
git add packages/extension-chrome/src/side-panel.ts
git commit -m "feat: invalid-key recovery — set the fix-key flag from the side panel's open-settings (C6)" \
  -m $'Tribe-Card: c6-invalid-key-recovery\nTribe-Task: 5/8'
```

---

### Task 6: `SettingsForm.enterFixKeyMode()` + `consumeAutoRetest()`

**Files:**

- Modify: `packages/app/src/ui/settings-form.ts`
- Modify: `packages/app/test/ui/settings-form.test.ts`

- [ ] **Step 1: Write the failing tests.** Append to `packages/app/test/ui/settings-form.test.ts`,
      as a new `describe` block near the end of the file:

```ts
describe('<settings-form> fix-key mode (C6)', () => {
  it('enterFixKeyMode focuses the key field and shows likely-cause status copy', () => {
    const el = mountForm();
    el.enterFixKeyMode();
    const key = el.shadowRoot!.querySelector<HTMLInputElement>('#key')!;
    expect(el.shadowRoot!.activeElement).toBe(key);
    const status = el.shadowRoot!.querySelector<HTMLElement>('#status')!;
    expect(status.hidden).toBe(false);
    expect(status.textContent).toContain('rejected');
    expect(status.classList.contains('error')).toBe(true);
  });

  it('consumeAutoRetest is false before enterFixKeyMode, true exactly once after', () => {
    const el = mountForm();
    expect(el.consumeAutoRetest()).toBe(false);
    el.enterFixKeyMode();
    expect(el.consumeAutoRetest()).toBe(true);
    expect(el.consumeAutoRetest()).toBe(false);
  });
});
```

Adjust `el.shadowRoot!.activeElement` / focus-assertion style to match whatever pattern the
existing test file already uses elsewhere for focus assertions (e.g. if happy-dom in this repo's
test setup requires `el.focus()` polyfills or a different accessor, mirror the nearest existing
focus-related test rather than introducing a new pattern).

Run: `cd packages/app && bunx vitest run test/ui/settings-form.test.ts`
Expected: 2 new failures — `enterFixKeyMode`/`consumeAutoRetest` are not functions.

- [ ] **Step 2: Implement.** In `packages/app/src/ui/settings-form.ts`:

1. Add a private field near the other `_`-prefixed fields (around line 248):

```ts
// C6: armed by enterFixKeyMode(), consumed by exactly the next Save.
private _autoRetestArmed = false;
```

2. Add the two public methods, e.g. right after `setStatus` (after line 498):

```ts
/**
 * C6: entered once, right after mount, when options.ts finds the invalid-key deep-link flag
 * pending. Focuses the key field (revealing the env-lock notice via the existing focus listener
 * if the field happens to be locked) and shows likely-cause copy on the existing status line.
 * Arms exactly one auto-retest, consumed by the very next Save.
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

Run: `cd packages/app && bunx vitest run test/ui/settings-form.test.ts`
Expected: all tests pass (existing + 2 new).

- [ ] **Step 3: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd .. && bun run lint && bun run format:check
```

Commit:

```
git add packages/app/src/ui/settings-form.ts packages/app/test/ui/settings-form.test.ts
git commit -m "feat: invalid-key recovery — add SettingsForm.enterFixKeyMode/consumeAutoRetest (C6)" \
  -m $'Tribe-Card: c6-invalid-key-recovery\nTribe-Task: 6/8'
```

---

### Task 7: Wire `options.ts` — mount-time flag check + save-handler auto-retest

**Files:**

- Modify: `packages/extension-chrome/src/options.ts`

No dedicated unit test (composition root, e2e-covered in Task 8) — same precedent as Tasks 4/5.

- [ ] **Step 1: Implement.** In `packages/extension-chrome/src/options.ts`:

1. Add `FIX_KEY_PENDING_STORAGE_KEY` to the existing `@ai-dict/app` import block (top of file).
2. Inside `mountSettings`, right after `wireSettings(form)` (currently the line following
   `app.replaceChildren(form); (form as unknown as { value: SettingsFormValue }).value =
toFormValue(initial); wireSettings(form);`), add:

```ts
// C6: consume the one-shot invalid-key deep-link flag, if the reader arrived via the
// INVALID_KEY card's "Fix key in Settings" button (see router.ts's open-options handler) or the
// side panel's equivalent direct-storage path.
void chrome.storage.local.get(FIX_KEY_PENDING_STORAGE_KEY).then((stored) => {
  if (!stored[FIX_KEY_PENDING_STORAGE_KEY]) return;
  void chrome.storage.local.remove(FIX_KEY_PENDING_STORAGE_KEY);
  form.enterFixKeyMode();
});
```

3. Replace the existing `save` listener inside `wireSettings` (lines 114-133) with:

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
        // Re-stamp so the page itself reflects a theme change immediately on save.
        (form as unknown as HTMLElement).setAttribute('data-ad-theme', next.theme);
        if (shouldRetest) {
          // C6: the reader just corrected a rejected key — auto-run the same connection.test
          // round trip the manual "Test connection" button below already uses. See the design
          // spec §4 for why this one, save-triggered call satisfies constraint 4.
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
git add packages/extension-chrome/src/options.ts
git commit -m "feat: invalid-key recovery — options.ts fix-key mount check + auto-retest on save (C6)" \
  -m $'Tribe-Card: c6-invalid-key-recovery\nTribe-Task: 7/8'
```

---

### Task 8: e2e functional test — the full recovery loop

**Files:**

- Create: `packages/extension-chrome/e2e/c6-invalid-key-recovery.spec.ts`

- [ ] **Step 1: Write the test.** Model the mock shape on
      `packages/extension-chrome/e2e/lookup-errors.spec.ts`'s existing `'HTTP 400
INVALID_ARGUMENT'` case (lines 22-25) and the lookup/storage helpers on `saved-word.spec.ts`'s
      pattern (duplicate the small `swStorageDump` helper verbatim, matching B5's own precedent of
      self-contained e2e files):

```ts
import { test, expect } from './fixtures';
import { seedSettings, gotoFixture, selectWord, openTrigger, mockGemini } from './helpers';
import type { BrowserContext, Page } from '@playwright/test';

async function storageDump(context: BrowserContext): Promise<Record<string, unknown>> {
  const [sw] = context.serviceWorkers();
  return sw.evaluate(() => chrome.storage.local.get(null) as Promise<Record<string, unknown>>);
}

async function doLookup(page: Page): Promise<void> {
  await gotoFixture(page);
  await page.waitForTimeout(1_000);
  await selectWord(page, 't', 'bank');
  await openTrigger(page);
}

test.describe('C6 invalid-key recovery', () => {
  test('rejected key → Fix key in Settings → focused + causes → corrected key auto-retests OK', async ({
    context,
    extensionId,
  }) => {
    // 1. The current key is rejected (HTTP 400 INVALID_ARGUMENT — same shape as
    //    lookup-errors.spec.ts's own case).
    await mockGemini(context, {
      status: 400,
      body: JSON.stringify({ error: { status: 'INVALID_ARGUMENT' } }),
    });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page, { apiKey: 'AIza-bad-key' });
    await doLookup(page);

    const card = page.locator('bottom-sheet lookup-card');
    await expect(card).toContainText('Google rejected the API key.', { timeout: 10_000 });
    const cta = card.locator('.setup-cta');
    await expect(cta).toHaveText('Fix key in Settings');

    // 2. Clicking it opens (or focuses) the options tab, in fix-key mode.
    const [optionsPage] = await Promise.all([context.waitForEvent('page'), cta.click()]);
    await optionsPage.waitForSelector('settings-form');
    const form = optionsPage.locator('settings-form');
    await expect(form.locator('#status')).toContainText('rejected', { timeout: 10_000 });
    await expect(form.locator('#key')).toBeFocused();

    // 3. Fixing the key and saving auto-retests — no manual "Test connection" click.
    await mockGemini(context, { status: 200 }); // most-recently-registered route wins (Playwright)
    await form.locator('#key').fill('AIza-good-key');
    await form.locator('#save').click();
    await expect(form.locator('#status')).toContainText('Connection OK', { timeout: 10_000 });

    const dump = await storageDump(context);
    const settings = dump['settings'] as { apiKey: string };
    expect(settings.apiKey).toBe('AIza-good-key');
  });

  test('the NO_KEY setup invite still shows the plain, unfocused Open Settings CTA (regression guard)', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page, { apiKey: '', hasKey: false, configuredProviders: [] });
    await doLookup(page);
    const cta = page.locator('bottom-sheet lookup-card .setup-cta');
    await expect(cta).toHaveText('Open Settings');
  });
});
```

Adjust the options-tab-open assertion (`context.waitForEvent('page')` vs. Playwright already
having a tab open from a prior test in the same worker) and the exact settings-form locator
strategy to match whatever pattern `onboarding.spec.ts`/`options-actions.spec.ts` already use for
asserting into the options page across a tab boundary — reuse their established idiom rather than
inventing a new one.

- [ ] **Step 2: Build (with the env key cleared) and run.**

```
GEMINI_API_KEY= bun run build:chrome
cd packages/extension-chrome && bunx playwright test c6-invalid-key-recovery
```

Expected: 2 passed. Clearing `GEMINI_API_KEY` is required — see design spec §6, item 6: an
inherited env key flips `KEY_FROM_ENV` in `options.ts`, which routes to `mountSettings`
unconditionally and makes this suite pass/fail for the wrong reason (this is the live
2026-07-16 flake referenced by the roadmap's C10 card).

- [ ] **Step 3: Regression run** (confirm nothing existing broke):

```
cd packages/extension-chrome && bunx playwright test lookup-errors saved-word onboarding
```

Expected: all pre-existing specs in these three files still pass — `lookup-errors.spec.ts`'s
INVALID_KEY-message case (message wording untouched by this plan), `saved-word.spec.ts` (the
save/star flow, untouched), `onboarding.spec.ts` (the NO_KEY path, untouched — confirmed by this
task's own second test above).

- [ ] **Step 4: Commit** — gate, then commit:

```
bun run lint && bun run format:check
```

Commit:

```
git add packages/extension-chrome/e2e/c6-invalid-key-recovery.spec.ts
git commit -m "feat: invalid-key recovery — add e2e coverage for the full recovery loop (C6)" \
  -m $'Tribe-Card: c6-invalid-key-recovery\nTribe-Task: 8/8'
```

---

## Final gate (run once, after Task 8, before opening the PR)

```
cd packages/app && bun run typecheck
cd ../extension-chrome && bun run typecheck
cd ../..
bun run test
bun run lint
bun run format:check
GEMINI_API_KEY= bun run build:chrome
cd packages/extension-chrome && bunx playwright test c6-invalid-key-recovery lookup-errors saved-word onboarding options-actions
```

Expected: typecheck clean on both packages; the full Vitest suite green (including the wire
snapshot + router + lookup-card + settings-form additions); lint/format clean; the Chrome build
succeeds with no baked-in Gemini key; the new `c6-invalid-key-recovery.spec.ts` suite passes
alongside the regression guards (`lookup-errors`, `saved-word`, `onboarding`, `options-actions`).

**PR body:** regular (non-squash) merge; no screenshots/video (owner ruling 2026-07-16) — instead
a written "Testing performed" section listing the suites/counts above and the exact gate commands
run, per `CLAUDE.md` and `.claude/rules/workflow-conventions.md`.
