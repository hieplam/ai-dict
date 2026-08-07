# Restore-default Prompt Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Restore default" button beside the prompt-template field on the options screen that re-populates it with the shipped `DEFAULT_TEMPLATE`.

**Architecture:** The change is confined to the shared `<settings-form>` web component, which both the Chrome and Safari options pages mount — so the button ships to both shells with no `options.ts` or wire-protocol changes. Restoring is synchronous client-side DOM mutation; it imports `DEFAULT_TEMPLATE` from the dependency-free domain layer (the allowed UI→domain direction). It fills the field only — the user still clicks Save — and guards a customized field behind a `confirm()`.

**Tech Stack:** TypeScript, native Web Components (Shadow DOM), Vitest + jsdom (unit), Playwright (Chrome e2e), bun (tooling).

---

## File Structure

- **Modify** `packages/app/src/ui/settings-form.ts` — add the import, the button markup, the click wiring, and the `restoreDefaultTemplate()` method.
- **Modify** `packages/app/test/ui/settings-form.test.ts` — add a `restore default` describe block and extend the control-presence list.
- **Modify** `packages/extension-chrome/e2e/options-actions.spec.ts` — add one e2e happy-path test.

No other files change. `DEFAULT_TEMPLATE` already exists at `packages/app/src/domain/default-template.ts`.

---

### Task 1: Restore-default button + behavior (in the component)

**Files:**

- Modify: `packages/app/src/ui/settings-form.ts`
- Test: `packages/app/test/ui/settings-form.test.ts`

- [ ] **Step 1: Write the failing unit tests**

In `packages/app/test/ui/settings-form.test.ts`, add this import near the top (after the existing `settings-form` import):

```ts
import { DEFAULT_TEMPLATE } from '../../src/domain/default-template';
```

Then add a new describe block (place it after the main `describe('<settings-form>', ...)` block, before the env-key block):

```ts
describe('<settings-form> restore default prompt', () => {
  it('restores the default after confirm when the field was customized', () => {
    const el = mountForm();
    el.value = {
      apiKey: '',
      targetLang: 'vi',
      promptTemplate: 'my custom prompt',
      cacheEnabled: true,
      saveHistory: true,
    };
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    el.shadowRoot!.querySelector<HTMLButtonElement>('#reset-tpl')!.click();
    const tpl = el.shadowRoot!.querySelector<HTMLTextAreaElement>('#tpl')!;
    expect(tpl.value).toBe(DEFAULT_TEMPLATE);
    expect(confirmSpy).toHaveBeenCalledOnce();
    const status = el.shadowRoot!.querySelector<HTMLElement>('#status')!;
    expect(status.textContent).toBe('Prompt template restored — Save settings to apply.');
    confirmSpy.mockRestore();
  });

  it('leaves the template unchanged when the confirm is cancelled', () => {
    const el = mountForm();
    el.value = {
      apiKey: '',
      targetLang: 'vi',
      promptTemplate: 'my custom prompt',
      cacheEnabled: true,
      saveHistory: true,
    };
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    el.shadowRoot!.querySelector<HTMLButtonElement>('#reset-tpl')!.click();
    const tpl = el.shadowRoot!.querySelector<HTMLTextAreaElement>('#tpl')!;
    expect(tpl.value).toBe('my custom prompt');
    expect(confirmSpy).toHaveBeenCalledOnce();
    confirmSpy.mockRestore();
  });

  it('does not prompt when the template already equals the default', () => {
    const el = mountForm();
    el.value = {
      apiKey: '',
      targetLang: 'vi',
      promptTemplate: DEFAULT_TEMPLATE,
      cacheEnabled: true,
      saveHistory: true,
    };
    const confirmSpy = vi.spyOn(window, 'confirm');
    el.shadowRoot!.querySelector<HTMLButtonElement>('#reset-tpl')!.click();
    expect(confirmSpy).not.toHaveBeenCalled();
    const status = el.shadowRoot!.querySelector<HTMLElement>('#status')!;
    expect(status.textContent).toBe('Prompt template is already the default.');
    confirmSpy.mockRestore();
  });
});
```

Also extend the existing control-presence test. Find the array in
`it('keeps every required control (incl. #status) inside the redesigned markup', ...)`
and add `'#reset-tpl',` after the `'#tpl'` entry.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run test 2>&1 | tail -25`
Expected: FAIL — the three new tests error on `querySelector('#reset-tpl')` returning `null` (`Cannot read properties of null (reading 'click')`), and the control-presence test fails its `#reset-tpl` assertion. All pre-existing tests still pass.

- [ ] **Step 3: Add the import**

In `packages/app/src/ui/settings-form.ts`, add the import directly below the existing `./styles/tokens` import (line ~2):

```ts
import { DEFAULT_TEMPLATE } from '../domain/default-template';
```

- [ ] **Step 4: Add the button markup**

In the same file, in `MARKUP`, find the Translation section's textarea line:

```html
      <label for="tpl">Prompt template</label>
      <textarea id="tpl" rows="6"></textarea>
    </section>
```

Replace it with (adds an `inline-actions` row holding the button; both classes already exist in `CSS`):

```html
      <label for="tpl">Prompt template</label>
      <textarea id="tpl" rows="6"></textarea>
      <div class="inline-actions">
        <button type="button" id="reset-tpl" class="sm">Restore default</button>
      </div>
    </section>
```

- [ ] **Step 5: Wire the click handler in connectedCallback**

In `connectedCallback`, after the four `this.relay(...)` calls (around line 158), add:

```ts
this.q<HTMLButtonElement>('#reset-tpl').addEventListener('click', () =>
  this.restoreDefaultTemplate(),
);
```

- [ ] **Step 6: Add the restoreDefaultTemplate method**

Add this private method to the `SettingsForm` class (place it after `setStatus`, before the private `q` helper):

```ts
  /**
   * Re-populate the prompt-template field with the shipped DEFAULT_TEMPLATE.
   * Fills the field only — the user must still Save (matches the form's
   * "Changes apply after saving" contract). If the field already holds the
   * default there is nothing to lose, so we skip the confirm and just say so;
   * a customized field prompts a confirm() before its contents are replaced.
   */
  private restoreDefaultTemplate(): void {
    const tpl = this.q<HTMLTextAreaElement>('#tpl');
    if (tpl.value === DEFAULT_TEMPLATE) {
      this.setStatus('Prompt template is already the default.');
      return;
    }
    const ok = window.confirm(
      'Replace your prompt template with the default? Your current prompt will be lost.',
    );
    if (!ok) return;
    tpl.value = DEFAULT_TEMPLATE;
    this.setStatus('Prompt template restored — Save settings to apply.');
  }
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `bun run test 2>&1 | tail -25`
Expected: PASS — all tests green, including the three new behavior tests, the extended control-presence test, and the unchanged `has no axe violations` test (the button has discernible text "Restore default").

- [ ] **Step 8: Typecheck and lint**

Run: `bun run typecheck 2>&1 | tail -20 && bun run lint 2>&1 | tail -20`
Expected: both clean, no errors.

- [ ] **Step 9: Commit**

```bash
git add packages/app/src/ui/settings-form.ts packages/app/test/ui/settings-form.test.ts
git commit -m "feat(app): add restore-default button for the prompt template"
```

---

### Task 2: Chrome e2e happy-path

**Files:**

- Modify: `packages/extension-chrome/e2e/options-actions.spec.ts`

- [ ] **Step 1: Write the e2e test**

Append this test to `packages/extension-chrome/e2e/options-actions.spec.ts` (the file already defines `const status = 'settings-form #status';` and `shots`):

```ts
test('Restore default repopulates the prompt template after confirm', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await page.waitForSelector('settings-form');
  const tpl = page.locator('settings-form #tpl');
  await tpl.fill('my custom prompt that differs from the default');
  // A customized field guards the restore behind a confirm() dialog.
  page.once('dialog', (d) => d.accept());
  await page.locator('settings-form #reset-tpl').click();
  // Assert on a stable substring of DEFAULT_TEMPLATE, not the whole multi-line string.
  await expect(tpl).toHaveValue(/bilingual dictionary/);
  await expect(page.locator(status)).toHaveText(
    'Prompt template restored — Save settings to apply.',
  );
  await page.screenshot({ path: path.join(shots, 'restore-default.png') });
});
```

- [ ] **Step 2: Run the Chrome e2e suite**

Run: `bun run e2e:chrome 2>&1 | tail -30`
Expected: PASS — the new test plus all pre-existing options-actions tests are green. (This command builds the extension before running Playwright.)

- [ ] **Step 3: Commit**

```bash
git add packages/extension-chrome/e2e/options-actions.spec.ts
git commit -m "test(extension-chrome): e2e for restore-default prompt button"
```

---

### Task 3: Browser evidence + PR

**Files:** none (produces evidence + opens the PR)

- [ ] **Step 1: Build the Chrome extension for manual capture**

Run: `bun run build:chrome 2>&1 | tail -10`
Expected: a `dist/` build under `packages/extension-chrome`.

- [ ] **Step 2: Capture Before/After evidence with the agent-browser skill**

Load the built extension's `options.html`. Capture:

- **Before:** the Translation section without the button (reference the pre-change screenshot or the prior options-page redesign shot).
- **After:** the Translation section showing the "Restore default" button; the confirm dialog; and the textarea reverted to the default after accepting.

- [ ] **Step 3: Push the branch and open the PR**

Push `worktree-restore-default-prompt`. Host the evidence images on a `pr-assets/restore-default-prompt` branch and embed them with same-origin
`https://github.com/hieplam/ai-dict/raw/pr-assets/restore-default-prompt/<file>` URLs (never `raw.githubusercontent.com` — this repo is private). Open the PR against `master` with the Before/After section.

---

## Self-Review

**Spec coverage:**

- Button beside the prompt textarea → Task 1 Step 4. ✓
- Imports `DEFAULT_TEMPLATE` from domain → Task 1 Step 3. ✓
- Fill-only, Save still required → `restoreDefaultTemplate` never persists (Task 1 Step 6); covered by unit test 1's lack of a `save` event. ✓
- Confirm before replacing a customized field → Task 1 Step 6 + unit tests 1 & 2. ✓
- Skip confirm when already default → Task 1 Step 6 + unit test 3. ✓
- `setStatus`/`textContent` (no innerHTML) → reuses existing `setStatus`. ✓
- Both shells get it → change is in the shared component; e2e proves it in Chrome (Task 2). ✓
- Unit + e2e + axe coverage → Tasks 1 & 2. ✓
- PR evidence → Task 3. ✓

**Placeholder scan:** none — every code and command step is concrete.

**Type consistency:** `restoreDefaultTemplate` (private, no args, void) is referenced only from the Step 5 listener. `#reset-tpl`, `#tpl`, `#status` ids match between markup, handler, and tests. Status strings are byte-identical across implementation, unit tests, and e2e ("Prompt template restored — Save settings to apply." / "Prompt template is already the default.").
