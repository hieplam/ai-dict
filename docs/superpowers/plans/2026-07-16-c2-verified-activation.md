# C2 Verified Activation Implementation Plan

> **For agentic workers:** implement task-by-task, TDD (red → green → commit) per task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "Save & activate" on the onboarding screen runs one real, user-triggered
`connection.test` against the just-pasted key before ever claiming success; a wrong/expired/
throttled/malformed key renders inline with its existing mapped copy and the key is never
persisted; a network-unreachable test (offline/timeout/5xx) shows a distinct "Save anyway" escape
hatch that bypasses verification and persists with a "not verified yet" status instead.

**Architecture:** the entire card lives in two files — the portable onboarding UI
(`packages/app/src/ui/onboarding-view.ts`, `c3-1`) and the Chrome composition root
(`packages/extension-chrome/src/options.ts`) that already owns onboarding's persistence. **Zero
changes** to `packages/app/src/wire.ts` or `packages/app/src/app/router.ts` — the existing,
zero-payload `connection.test` message already tests "whatever key is in storage right now"; this
plan makes `options.ts` put the right key in storage _before_ sending it, using the live-read fact
already true of `sw.ts`'s `getApiKey` (`ENV_API_KEY || (await readFullSettings()).apiKey`, read
fresh on every call — see the design spec §2 for the full grounding). Full design rationale,
including why the two other key-under-test approaches were rejected:
`docs/superpowers/specs/2026-07-16-c2-verified-activation-design.md`.

**Tech Stack:** TypeScript, Vitest + happy-dom (unit), Playwright (e2e).

## Global Constraints

- Implementer: dispatch each implementation/fix task to the `hunter` subagent — never a generic
  implementer.
- **Do not touch `packages/app/src/wire.ts` or `packages/app/src/app/router.ts`.** The design
  spec's §2 resolves the "key-under-test" question in favor of persist-first — no new wire message,
  no new router case. If a task in this plan seems to need a wire/router change, stop; that means
  the persist-first assumption broke somewhere and the plan needs re-grounding, not an ad hoc
  schema edit.
- **Do not touch `packages/app/src/domain/error-mapper.ts` or `packages/app/src/ui/
settings-form.ts`.** The existing `LookupError` taxonomy/copy and the existing "Test connection"
  retest UX are reused verbatim.
- **Persist only on pass** (the card's pinned semantics — design spec §3): a failed
  `connection.test` always rolls storage back to the exact pre-onboarding snapshot. The "Save
  anyway" escape hatch is the _only_ way an unverified key gets persisted, and it is scoped to
  `LookupError.code === 'NETWORK'` failures only (offline/timeout/5xx) — never `INVALID_KEY`,
  `RATE_LIMIT`, `PARSE`, or `UNKNOWN`.
- **Exactly one `connection.test` call per explicit "Save & activate" click** (roadmap §3
  constraint 4 — every model call is user-triggered). "Save anyway" makes zero further calls.
- S1: the pasted key is written directly to `chrome.storage.local` by the options page (a trusted
  context — unchanged pattern) and never appears on a `chrome.runtime` message, in a log, or in any
  status text.
- UI additions read only `--ad-*`/`--adp-*` design tokens (no hard-coded colors) — the new
  `#save-anyway` button is styled like the existing `#reveal` button.
- `bun run lint` and `bun run format:check` clean before every commit.
- Every task must leave `cd packages/app && bun run typecheck` (and, from Task 2 on,
  `cd packages/extension-chrome && bun run typecheck`) green.
- The e2e build must clear any ambient `GEMINI_API_KEY` (`GEMINI_API_KEY= bun run build:chrome`) —
  a baked-in env key skips onboarding entirely (`options.ts`'s `KEY_FROM_ENV`), silently disabling
  every onboarding e2e test in Task 3.
- Commit subject convention for every task in this plan: `feat: verified activation — <task summary> (C2)`.

---

### Task 1: `onboarding-view.ts` — busy state + "Save anyway" escape hatch

**Files:**

- Modify: `packages/app/src/ui/onboarding-view.ts`
- Modify: `packages/app/test/ui/onboarding-view.test.ts`

**Interfaces:**

```ts
setBusy(busy: boolean): void;
showSaveAnyway(show: boolean): void;
// New DOM event, same detail shape as the existing 'save':
// dispatchEvent(new CustomEvent<OnboardingValue>('save-anyway', { detail, bubbles: true, composed: true }))
```

- [ ] **Step 1: Write the failing tests.** Append to `packages/app/test/ui/onboarding-view.test.ts`,
      inside the existing `describe('<onboarding-view>', ...)` block, just before its closing
      `});` (after the existing `'setStatus shows, errors, and hides the status line'` test):

```ts
it('setBusy(true) disables both buttons, relabels activate, and hides any prior save-anyway (C2)', () => {
  const el = mount();
  const r = el.shadowRoot!;
  el.showSaveAnyway(true);
  el.setBusy(true);
  const activate = r.querySelector<HTMLButtonElement>('#activate')!;
  const saveAnyway = r.querySelector<HTMLButtonElement>('#save-anyway')!;
  expect(activate.disabled).toBe(true);
  expect(activate.textContent).toBe('Activating…');
  expect(saveAnyway.disabled).toBe(true);
  expect(saveAnyway.hidden).toBe(true);
});

it('setBusy(false) restores the activate button label and enabled state (C2)', () => {
  const el = mount();
  const r = el.shadowRoot!;
  el.setBusy(true);
  el.setBusy(false);
  const activate = r.querySelector<HTMLButtonElement>('#activate')!;
  expect(activate.disabled).toBe(false);
  expect(activate.textContent).toBe('Save & activate');
});

it("showSaveAnyway toggles the escape-hatch button's hidden state (C2)", () => {
  const el = mount();
  const btn = el.shadowRoot!.querySelector<HTMLButtonElement>('#save-anyway')!;
  expect(btn.hidden).toBe(true);
  el.showSaveAnyway(true);
  expect(btn.hidden).toBe(false);
  el.showSaveAnyway(false);
  expect(btn.hidden).toBe(true);
});

it('submit() is a no-op while busy — no second "save" event fires (C2)', () => {
  const el = mount();
  const r = el.shadowRoot!;
  r.querySelector<HTMLInputElement>('#key')!.value = 'AIza-x';
  let count = 0;
  el.addEventListener('save', () => count++);
  r.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  expect(count).toBe(1);
  r.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  expect(count).toBe(1); // setBusy(true) fired on the first submit; the second is swallowed
});

it('clicking "Save anyway" emits a composed save-anyway event with the trimmed key/language (C2)', () => {
  const el = mount();
  const r = el.shadowRoot!;
  r.querySelector<HTMLInputElement>('#key')!.value = '  AIza-real  ';
  r.querySelector<HTMLSelectElement>('#target')!.value = 'en';
  let captured: OnboardingValue | undefined;
  document.body.addEventListener('save-anyway', (e) => {
    captured = (e as CustomEvent<OnboardingValue>).detail;
  });
  r.querySelector<HTMLButtonElement>('#save-anyway')!.click();
  expect(captured).toEqual({ apiKey: 'AIza-real', targetLang: 'en' });
});

it('"Save anyway" blocks on an empty key with the same inline error as Save & activate (C2)', () => {
  const el = mount();
  let fired = false;
  el.addEventListener('save-anyway', () => {
    fired = true;
  });
  el.shadowRoot!.querySelector<HTMLButtonElement>('#save-anyway')!.click();
  expect(fired).toBe(false);
  const status = el.shadowRoot!.querySelector<HTMLElement>('#status')!;
  expect(status.hidden).toBe(false);
  expect(status.classList.contains('error')).toBe(true);
});
```

Run: `cd packages/app && bunx vitest run test/ui/onboarding-view.test.ts`
Expected: failures — `#save-anyway` doesn't exist, `setBusy`/`showSaveAnyway` are not functions.

- [ ] **Step 2: Implement.** In `packages/app/src/ui/onboarding-view.ts`:
  1. Add a `#save-anyway` button to `MARKUP`'s `.actions` div, right after `#activate`
     (`onboarding-view.ts:112-114`):

```html
<div class="actions">
  <button type="submit" id="activate" class="primary">Save &amp; activate</button>
  <button
    type="button"
    id="save-anyway"
    class="secondary"
    hidden
    aria-label="Save your key without testing the connection"
  >
    Save anyway
  </button>
</div>
```

2. Add a `.secondary` button rule to `CSS`, right after `button.primary`'s existing rules
   (`onboarding-view.ts:65-67`), reusing the same token set as `#reveal`:

```css
button.secondary {
  font: inherit;
  font-weight: var(--adp-weight-semi);
  font-size: 14px;
  width: 100%;
  margin-top: 8px;
  padding: 11px 18px;
  border-radius: 11px;
  cursor: pointer;
  border: 1px solid var(--ad-line-strong);
  background: var(--ad-surface);
  color: var(--ad-ink);
}
button.secondary:hover {
  background: var(--ad-surface-raised);
}
button.secondary:focus-visible {
  outline: 2px solid var(--ad-accent);
  outline-offset: 2px;
}
```

3. Add a `_busy` field and the two new methods to the `OnboardingView` class:

```ts
export class OnboardingView extends HTMLElement {
  private root!: ShadowRoot;
  private _pendingValue: OnboardingValue | null = null;
  // C2: guards "exactly one connection.test call per explicit click" — true from the moment
  // either button is pressed until the composition root calls setBusy(false) on a failure (a
  // pass never calls it back; the view is torn down when settings-form replaces it).
  private _busy = false;
```

4. Extend `connectedCallback`'s existing submit listener with the busy guard, and add the new
   `#save-anyway` click listener (both near the existing `form`/`#reveal` listeners,
   `onboarding-view.ts:140-143`):

```ts
this.q<HTMLFormElement>('form').addEventListener('submit', (e) => {
  e.preventDefault();
  this.submit();
});
this.q<HTMLButtonElement>('#save-anyway').addEventListener('click', () => this.submitAnyway());
```

5. Update `submit()` (`onboarding-view.ts:155-169`) and add `submitAnyway()` right after it:

```ts
  /** Validate then emit `save` so the host (options page) can persist + test + advance. */
  private submit(): void {
    if (this._busy) return;
    const apiKey = this.q<HTMLInputElement>('#key').value.trim();
    if (apiKey.length === 0) {
      this.setStatus('Paste your Gemini API key to activate the extension.', 'error');
      this.q<HTMLInputElement>('#key').focus();
      return;
    }
    this.setBusy(true);
    this.dispatchEvent(
      new CustomEvent<OnboardingValue>('save', {
        detail: { apiKey, targetLang: this.q<HTMLSelectElement>('#target').value },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /**
   * C2: the "Save anyway" escape hatch — validated identically to submit(), but emits a
   * distinct event so the host knows to skip connection.test entirely (a deliberate bypass,
   * not a retry) and persist with a "not verified" status instead. Only ever visible after a
   * NETWORK-class connection.test failure (host-controlled via showSaveAnyway).
   */
  private submitAnyway(): void {
    if (this._busy) return;
    const apiKey = this.q<HTMLInputElement>('#key').value.trim();
    if (apiKey.length === 0) {
      this.setStatus('Paste your Gemini API key to activate the extension.', 'error');
      this.q<HTMLInputElement>('#key').focus();
      return;
    }
    this.setBusy(true);
    this.dispatchEvent(
      new CustomEvent<OnboardingValue>('save-anyway', {
        detail: { apiKey, targetLang: this.q<HTMLSelectElement>('#target').value },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /**
   * C2: reflect an in-flight connection.test (or the save-anyway persist) in the UI — disables
   * both buttons (defense-in-depth alongside the _busy guard) and relabels Save & activate.
   * Turning busy ON also hides any stale "Save anyway" from a previous failed attempt.
   */
  setBusy(busy: boolean): void {
    this._busy = busy;
    const activate = this.q<HTMLButtonElement>('#activate');
    activate.disabled = busy;
    activate.textContent = busy ? 'Activating…' : 'Save & activate';
    this.q<HTMLButtonElement>('#save-anyway').disabled = busy;
    if (busy) this.showSaveAnyway(false);
  }

  /** C2: show/hide the escape hatch. The host decides when (NETWORK-class failures only). */
  showSaveAnyway(show: boolean): void {
    this.q<HTMLButtonElement>('#save-anyway').hidden = !show;
  }
```

Run: `cd packages/app && bunx vitest run test/ui/onboarding-view.test.ts`
Expected: all tests pass (existing + 6 new).

- [ ] **Step 3: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

Commit:

```
git add packages/app/src/ui/onboarding-view.ts packages/app/test/ui/onboarding-view.test.ts
git commit -m "feat: verified activation — busy state + save-anyway escape hatch on onboarding-view (C2)" \
  -m $'Tribe-Card: c2-verified-activation\nTribe-Task: 1/3'
```

---

### Task 2: `options.ts` — persist → test → roll-back-or-proceed

**Files:**

- Modify: `packages/extension-chrome/src/options.ts`

No dedicated unit test exists for `options.ts` in this repo — it is a composition root, covered by
e2e only (same precedent as B5's `content.ts`/`side-panel.ts` edits). This task's correctness is
proven by Task 3's e2e; still run the typecheck/lint gate below at the end so a regression in
existing behavior (settings save, cache/history clear, etc. — all in the same file) is caught
immediately.

- [ ] **Step 1: Implement.** In `packages/extension-chrome/src/options.ts`, replace the entire
      `mountOnboarding` function body's `save` listener (currently `options.ts:189-206`) with:

```ts
function mountOnboarding(initial: Settings): void {
  const view = document.createElement('onboarding-view') as unknown as OnboardingView;
  (view as unknown as HTMLElement).setAttribute('data-ad-theme', initial.theme);
  app.replaceChildren(view);
  (view as unknown as { value: OnboardingValue }).value = {
    apiKey: '',
    targetLang: initial.targetLang,
  };

  view.addEventListener('save', (e) => {
    const { apiKey, targetLang } = (e as CustomEvent<OnboardingValue>).detail;
    view.setStatus('Testing your key…');
    let cur: Settings;
    void load()
      .then((c) => {
        cur = c;
        // C2: persist optimistically. connection.test always tests whatever key is CURRENTLY
        // in storage (sw.ts's getApiKey reads chrome.storage.local live, on every call) — this
        // is the only way to make the just-pasted, not-yet-stored key reachable to the
        // existing, unmodified connection.test path. See the design spec §2.
        return chrome.storage.local.set({
          settings: { ...cur, apiKey, targetLang, hasKey: Boolean(apiKey) },
        });
      })
      .then(() => send({ type: 'connection.test' }))
      .then(
        (r) => {
          if (r.ok) {
            void load().then((s) =>
              mountSettings(
                s,
                "You're all set. Highlight any word while reading and choose Define to look it up.",
              ),
            );
            return;
          }
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
        },
        () =>
          void chrome.storage.local.set({ settings: cur }).then(() => {
            view.setBusy(false);
            view.setStatus('Could not reach the extension. Try again.', 'error');
          }),
      );
  });

  // C2: the "Save anyway" escape hatch — a deliberate bypass of verification (NETWORK-class
  // failures only; the view only shows this button after such a failure). Persists directly,
  // no connection.test call, with a status that makes clear the key was NOT verified.
  view.addEventListener('save-anyway', (e) => {
    const { apiKey, targetLang } = (e as CustomEvent<OnboardingValue>).detail;
    void load()
      .then((cur) =>
        chrome.storage.local.set({
          settings: { ...cur, apiKey, targetLang, hasKey: Boolean(apiKey) },
        }),
      )
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
}
```

`send()`, `load()`, and `mountSettings()` are the existing helpers/functions in this file —
unchanged. `OnboardingValue`/`WireReply`/`Settings` are already imported at the top of the file.

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
git commit -m "feat: verified activation — persist/test/rollback orchestration in options.ts (C2)" \
  -m $'Tribe-Card: c2-verified-activation\nTribe-Task: 2/3'
```

---

### Task 3: e2e coverage — update the existing suite + new functional spec

**Files:**

- Modify: `packages/extension-chrome/e2e/onboarding.spec.ts`
- Create: `packages/extension-chrome/e2e/c2-verified-activation.spec.ts`

- [ ] **Step 1: Update the existing test that now needs a provider mock.** In
      `packages/extension-chrome/e2e/onboarding.spec.ts`, the first test ("activating with a key
      swaps to the settings screen and persists it", currently lines 7-31) sends a real activation
      with no route mocked — after Task 2 this now performs a real (mocked) `connection.test`, so
      it will hang/fail without a mock. Update its imports and body:

```ts
import { test, expect } from './fixtures';
import { seedSettings, gotoFixture, selectWord, openTrigger, mockGemini } from './helpers';

test('onboarding: activating with a key swaps to the settings screen and persists it', async ({
  context,
  extensionId,
}) => {
  const calls = await mockGemini(context); // 200 OK by default — the connection.test passes
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await page.waitForSelector('onboarding-view');

  await page.locator('onboarding-view #key').fill('AIza-activated');
  await page.locator('onboarding-view #activate').click();

  await page.waitForSelector('settings-form', { timeout: 10_000 });
  await expect(page.locator('settings-form #status')).toContainText("You're all set");
  expect(calls.count).toBe(1); // C2: exactly one connection.test call for the one click

  const stored = await page.evaluate(async () => {
    const { settings } = (await chrome.storage.local.get('settings')) as {
      settings: { apiKey: string; hasKey: boolean };
    };
    return `${settings.apiKey}|${settings.hasKey}`;
  });
  expect(stored).toBe('AIza-activated|true');
});
```

Leave the other two tests in this file (empty-key, no-key card) unchanged — neither ever reaches
a `connection.test` call (empty key short-circuits in `submit()`; the no-key card test never
types a key).

Run:

```
GEMINI_API_KEY= bun run build:chrome
cd packages/extension-chrome && bunx playwright test onboarding
```

Expected: all 3 tests in `onboarding.spec.ts` pass.

- [ ] **Step 2: Write the new functional spec.** Create
      `packages/extension-chrome/e2e/c2-verified-activation.spec.ts`:

```ts
import { test, expect } from './fixtures';
import { mockGemini } from './helpers';

test.describe('C2 verified activation', () => {
  test('a rejected key stays on onboarding with the mapped copy and storage rolled back', async ({
    context,
    extensionId,
  }) => {
    const calls = await mockGemini(context, {
      status: 400,
      body: JSON.stringify({ error: { status: 'INVALID_ARGUMENT' } }),
    });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.waitForSelector('onboarding-view');

    await page.locator('onboarding-view #key').fill('AIza-bad');
    await page.locator('onboarding-view #activate').click();

    await expect(page.locator('onboarding-view #status')).toContainText(
      'Google rejected the API key.',
      { timeout: 10_000 },
    );
    await expect(page.locator('onboarding-view #status')).toHaveClass(/error/);
    await expect(page.locator('onboarding-view #save-anyway')).toBeHidden();
    expect(await page.locator('settings-form').count()).toBe(0);
    expect(calls.count).toBe(1);

    const stored = await page.evaluate(async () => {
      const { settings } = (await chrome.storage.local.get('settings')) as {
        settings?: { apiKey?: string; hasKey?: boolean };
      };
      return settings?.hasKey ?? false;
    });
    expect(stored).toBe(false);
  });

  test('an unreachable connection shows the NETWORK copy + Save anyway; bypass persists with a warning and makes no extra call', async ({
    context,
    extensionId,
  }) => {
    const calls = await mockGemini(context, { abort: true });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.waitForSelector('onboarding-view');

    await page.locator('onboarding-view #key').fill('AIza-offline');
    await page.locator('onboarding-view #activate').click();

    await expect(page.locator('onboarding-view #status')).toContainText(
      'Network failed. Check connection and retry.',
      { timeout: 10_000 },
    );
    const saveAnyway = page.locator('onboarding-view #save-anyway');
    await expect(saveAnyway).toBeVisible();

    // Rolled back before the bypass.
    let stored = await page.evaluate(async () => {
      const { settings } = (await chrome.storage.local.get('settings')) as {
        settings?: { hasKey?: boolean };
      };
      return settings?.hasKey ?? false;
    });
    expect(stored).toBe(false);

    await saveAnyway.click();
    await page.waitForSelector('settings-form', { timeout: 10_000 });
    await expect(page.locator('settings-form #status')).toContainText('Saved without testing');
    expect(calls.count).toBe(1); // the bypass makes zero further connection.test calls

    stored = await page.evaluate(async () => {
      const { settings } = (await chrome.storage.local.get('settings')) as {
        settings?: { apiKey?: string; hasKey?: boolean };
      };
      return settings?.hasKey ?? false;
    });
    expect(stored).toBe(true);
  });

  test('a double-click on Save & activate still fires exactly one connection.test call', async ({
    context,
    extensionId,
  }) => {
    const calls = await mockGemini(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.waitForSelector('onboarding-view');

    await page.locator('onboarding-view #key').fill('AIza-double');
    const activate = page.locator('onboarding-view #activate');
    await activate.click({ force: true });
    await activate.click({ force: true }); // second click races the first; button disables fast

    await page.waitForSelector('settings-form', { timeout: 10_000 });
    expect(calls.count).toBe(1);
  });
});
```

Run:

```
cd packages/extension-chrome && bunx playwright test c2-verified-activation
```

Expected: 3 passed.

- [ ] **Step 3: Commit** — gate, then commit:

```
GEMINI_API_KEY= bun run build:chrome
bun run lint && bun run format:check
```

Commit:

```
git add packages/extension-chrome/e2e/onboarding.spec.ts packages/extension-chrome/e2e/c2-verified-activation.spec.ts
git commit -m "feat: verified activation — e2e coverage for the connection-test/rollback/save-anyway flow (C2)" \
  -m $'Tribe-Card: c2-verified-activation\nTribe-Task: 3/3'
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
cd packages/extension-chrome && bunx playwright test onboarding c2-verified-activation options-actions
```

Expected: typecheck clean on both packages; the full Vitest suite green (including the 6
`onboarding-view.test.ts` additions); lint/format clean; the Chrome build succeeds with the env key
cleared; `onboarding.spec.ts` (regression guard, now provider-mocked), the new
`c2-verified-activation.spec.ts`, and `options-actions.spec.ts` (regression guard for the rest of
the options page this task's edits share a file with) all pass.

## PR

Regular merge (no squash). `## JIRA ticket` section reads `n/a — this repo is not Jira-tracked`.
Include a **"Testing performed"** section per this worktree's evidence policy (§7 of the design
spec) instead of screenshots/video — list the suites above with pass counts.
