# C3 Guided First Lookup Implementation Plan

> **For agentic workers:** implement task-by-task, TDD (red → green → commit) per task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** immediately after a **verified** activation (C2), the settings screen shows a "Try it
now" section — a fixed practice sentence with one selectable word. Selecting it pops the real
Define pill; clicking it sends the exact same `lookup` wire message every other surface sends,
renders through the exact same sanitized card, and writes to real cache/history. No fake data, no
new wire message, no new renderer.

**Architecture:** almost everything is _reuse_ — `runLookupWorkflow`, `DomSelectionSource`,
`ChromeFloatingTrigger`, `InlineBottomSheetRenderer`, `MessageRelayLookupClient` all already exist
and are already exported from `@ai-dict/app`. The only new domain-side code is one small, additive
factory function (`createDomReader`) that scopes selection-reading to a container. The only new UI
is a hidden-by-default section on the existing `settings-form` component. The only composition-root
code is one new function in `options.ts` wiring the five reused pieces together — exactly the same
style content.ts already uses for the reading-page flow. Full design rationale:
`docs/superpowers/specs/2026-07-16-c3-guided-first-lookup-design.md`.

**Depends on C2** (`docs/superpowers/specs/2026-07-16-c2-verified-activation-design.md`) —
Task 3 below edits C2's own rewritten `save` listener. Do not start Task 3 until C2 is merged;
Tasks 1 and 2 have no dependency on C2 and can proceed independently.

**Tech Stack:** TypeScript, Vitest + happy-dom (unit), Playwright (e2e).

## Global Constraints

- Implementer: dispatch each implementation/fix task to the `hunter` subagent — never a generic
  implementer.
- **Zero changes to `packages/app/src/wire.ts`, `packages/app/src/app/router.ts`, or
  `packages/app/src/ports.ts`.** This card rides the existing `lookup`/`settings.get` messages
  exactly as they are today (design spec §2.2).
- **`createDomReader()` with no argument must be behavior-identical to the old, unexported
  `defaultReader`** — Task 1's own tests assert this; no existing caller (content.ts, its own
  existing tests) may observe any change.
- **Try-it's Save star and Settings gear are deliberately left unwired** (design spec §4) — do not
  add `toggle-save`/`open-settings` listeners for the try-it composition. This is intentional, not
  an oversight to "complete."
- **Try-it never renders on the `save-anyway` (NETWORK bypass) path** — only the verified-success
  branch of the (C2) `save` listener passes `{ showTryIt: true }`.
- UI additions read only `--ad-*`/`--adp-*` design tokens (no hard-coded colors).
- `bun run lint` and `bun run format:check` clean before every commit.
- Every task must leave `cd packages/app && bun run typecheck` (and, from Task 3 on,
  `cd packages/extension-chrome && bun run typecheck`) green.
- Commit subject convention for every task in this plan: `feat: guided first lookup — <task summary> (C3)`.

---

### Task 1: `createDomReader` — scoped selection reader

**Files:**

- Modify: `packages/app/src/app/dom-selection-source.ts`
- Modify: `packages/app/test/app/dom-selection-source.test.ts`

**Interfaces:**

```ts
export function createDomReader(isInScope?: (node: Node) => boolean): () => SelectionEvent | null;
```

- [ ] **Step 1: Write the failing tests.** Append to
      `packages/app/test/app/dom-selection-source.test.ts`, as a new `describe` block after the
      existing `describe('defaultReader ...)` block's closing `});`:

```ts
describe('createDomReader (C3: scoped selection reading)', () => {
  it('with no predicate behaves exactly like the default (unscoped) reader', () => {
    document.body.innerHTML = '<p id="scope-test">The bank by the river.</p>';
    const p = document.getElementById('scope-test')!;
    const textNode = p.firstChild!;
    const sel = window.getSelection()!;
    const range = document.createRange();
    range.setStart(textNode, 4);
    range.setEnd(textNode, 8);
    sel.removeAllRanges();
    sel.addRange(range);

    const read = createDomReader();
    const event = read();
    expect(event?.text).toBe('bank');

    sel.removeAllRanges();
    document.body.innerHTML = '';
  });

  it('returns null when the selection lies outside the isInScope predicate', () => {
    document.body.innerHTML = '<div id="in-scope">bank</div><div id="out-of-scope">river</div>';
    const inScope = document.getElementById('in-scope')!;
    const outOfScope = document.getElementById('out-of-scope')!;
    const textNode = outOfScope.firstChild!;
    const sel = window.getSelection()!;
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 5);
    sel.removeAllRanges();
    sel.addRange(range);

    const read = createDomReader((n) => inScope.contains(n));
    expect(read()).toBeNull();

    sel.removeAllRanges();
    document.body.innerHTML = '';
  });

  it('returns the SelectionEvent when the selection lies inside the isInScope predicate', () => {
    document.body.innerHTML = '<div id="in-scope-2">bank</div><div id="elsewhere-2">river</div>';
    const inScope = document.getElementById('in-scope-2')!;
    const textNode = inScope.firstChild!;
    const sel = window.getSelection()!;
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 4);
    sel.removeAllRanges();
    sel.addRange(range);

    const read = createDomReader((n) => inScope.contains(n));
    const event = read();
    expect(event?.text).toBe('bank');

    sel.removeAllRanges();
    document.body.innerHTML = '';
  });
});
```

Add `createDomReader` to the existing import at the top of the test file:

```ts
import {
  extractSentence,
  DomSelectionSource,
  createDomReader,
} from '../../src/app/dom-selection-source';
```

Run: `cd packages/app && bunx vitest run test/app/dom-selection-source.test.ts`
Expected: 3 new failures — `createDomReader is not a function` (or a TS error to that effect); all
pre-existing tests in this file still pass unchanged.

- [ ] **Step 2: Implement.** In `packages/app/src/app/dom-selection-source.ts`, replace the
      existing private `defaultReader` function (`dom-selection-source.ts:15-31`) with:

```ts
export function createDomReader(isInScope?: (node: Node) => boolean): () => SelectionEvent | null {
  return () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
    const text = sel.toString().trim();
    if (!text) return null;
    const range = sel.getRangeAt(0);
    // C3: scope selection-reading to a container (e.g. the options page's "Try it now" practice
    // sentence) so a document-wide mouseup listener never fires for unrelated page text.
    // No-op (undefined) preserves the exact old defaultReader behavior for every existing caller.
    if (isInScope && !isInScope(range.commonAncestorContainer)) return null;
    const full = range.startContainer.textContent ?? text;
    const r = range.getBoundingClientRect();
    const anchor: AnchorRect = { x: r.x, y: r.y, w: r.width, h: r.height };
    return {
      text,
      sentence: extractSentence(full, range.startOffset, range.endOffset),
      anchor,
      url: location.href,
      title: document.title,
    };
  };
}

// Default DOM reader: window selection → SelectionEvent, unscoped. Thin + covered by e2e; unit
// tests inject a fake reader (or createDomReader with a predicate) instead.
const defaultReader = createDomReader();
```

Everything else in the file (`extractSentence`, the `DomSelectionSource` class,
`dom-selection-source.ts:33-51`) is untouched — `DomSelectionSource`'s constructor already
defaults `read` to `defaultReader`, which now simply comes from the factory.

Run: `cd packages/app && bunx vitest run test/app/dom-selection-source.test.ts`
Expected: all tests pass (existing + 3 new).

- [ ] **Step 3: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

Commit:

```
git add packages/app/src/app/dom-selection-source.ts packages/app/test/app/dom-selection-source.test.ts
git commit -m "feat: guided first lookup — add createDomReader scoped selection factory (C3)" \
  -m $'Tribe-Card: c3-guided-first-lookup\nTribe-Task: 1/4'
```

---

### Task 2: `SettingsForm` — "Try it now" section

**Files:**

- Modify: `packages/app/src/ui/settings-form.ts`
- Modify: `packages/app/test/ui/settings-form.test.ts`

**Interfaces:**

```ts
set tryIt(show: boolean): void;
containsTryIt(node: Node): boolean;
markTryItSucceeded(): void;
// dispatches a composed 'tryit-dismiss' event (no detail) when #tryit-hide is clicked
```

- [ ] **Step 1: Write the failing tests.** Append to `packages/app/test/ui/settings-form.test.ts`
      as a new top-level `describe` block, after the closing `});` of the existing A16
      sticky-save-bar `describe` block (the file's last block). Reuse
      the file's existing `mountForm()` helper (`settings-form.test.ts:15-19`) verbatim — do not
      introduce a second mounting helper; `vi` is already imported at the top of the file:

```ts
describe('<settings-form> try it now (C3)', () => {
  it('the try-it section starts hidden', () => {
    const form = mountForm();
    expect(form.shadowRoot!.getElementById('tryit')!.hidden).toBe(true);
  });

  it('tryIt = true reveals the section; tryIt = false hides it again', () => {
    const form = mountForm();
    form.tryIt = true;
    expect(form.shadowRoot!.getElementById('tryit')!.hidden).toBe(false);
    form.tryIt = false;
    expect(form.shadowRoot!.getElementById('tryit')!.hidden).toBe(true);
  });

  it('setting tryIt = false also re-hides the success confirmation', () => {
    const form = mountForm();
    form.tryIt = true;
    form.markTryItSucceeded();
    expect(form.shadowRoot!.getElementById('tryit-done')!.hidden).toBe(false);
    form.tryIt = false;
    expect(form.shadowRoot!.getElementById('tryit-done')!.hidden).toBe(true);
  });

  it('containsTryIt is true for a node inside the practice sentence, false elsewhere in the form', () => {
    const form = mountForm();
    const sentence = form.shadowRoot!.getElementById('tryit-sentence')!;
    const wordNode = sentence.querySelector('.tryit-word')!.firstChild!;
    expect(form.containsTryIt(wordNode)).toBe(true);

    const elsewhere = form.shadowRoot!.getElementById('tpl')!;
    expect(form.containsTryIt(elsewhere)).toBe(false);
  });

  it('markTryItSucceeded reveals the confirmation line', () => {
    const form = mountForm();
    form.tryIt = true;
    expect(form.shadowRoot!.getElementById('tryit-done')!.hidden).toBe(true);
    form.markTryItSucceeded();
    expect(form.shadowRoot!.getElementById('tryit-done')!.hidden).toBe(false);
  });

  it('clicking Hide dispatches a composed tryit-dismiss event', () => {
    const form = mountForm();
    form.tryIt = true;
    const handler = vi.fn();
    document.body.addEventListener('tryit-dismiss', handler);
    (form.shadowRoot!.getElementById('tryit-hide') as HTMLButtonElement).click();
    document.body.removeEventListener('tryit-dismiss', handler);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
```

Check the file's existing imports/mount helper first (e.g. `mountForm`, or however the file
currently constructs a connected `<settings-form>` for its other tests) and reuse it verbatim —
do not introduce a second mounting helper.

Run: `cd packages/app && bunx vitest run test/ui/settings-form.test.ts`
Expected: 6 new failures (`#tryit` not found / `tryIt`/`containsTryIt`/`markTryItSucceeded` not
functions, or TS errors to that effect); all pre-existing tests in this file still pass.

- [ ] **Step 2: Implement.** In `packages/app/src/ui/settings-form.ts`:
  1. Insert this markup into `MARKUP` (`settings-form.ts:140-221`), right after
     `<h1 class="title">Settings</h1>` and before the Connection `<section>`:

```html
<section class="tryit" id="tryit" hidden aria-labelledby="tryit-h">
  <h2 class="tryit-h" id="tryit-h">Try it now</h2>
  <p class="tryit-lead">See it in action — select the highlighted word below and choose Define.</p>
  <p class="tryit-sentence" id="tryit-sentence">
    Finding that café was pure <mark class="tryit-word">serendipity</mark>.
  </p>
  <p class="tryit-caption">This sends one real lookup using your own key.</p>
  <p class="tryit-done" id="tryit-done" hidden>
    ✓ Nice — that's your key at work. Look up any word this way while you read.
  </p>
  <button type="button" class="link" id="tryit-hide">Hide</button>
</section>
```

2. Add these CSS rules to `CSS` (`settings-form.ts:78-138`), anywhere after the `.col` rule:

```css
.tryit {
  margin: 0 0 16px;
  border: 1px solid var(--ad-accent);
  border-radius: 12px;
  padding: 16px 20px;
  background: var(--ad-accent-soft);
}
.tryit-h {
  margin: 0 0 6px;
  font-size: var(--adp-text-body);
  font-weight: var(--adp-weight-bold);
  color: var(--ad-ink);
}
.tryit-lead {
  margin: 0 0 10px;
  font-size: var(--adp-text-sm);
  line-height: 1.5;
  color: var(--ad-ink-soft);
}
.tryit-sentence {
  margin: 0 0 6px;
  font-size: 15px;
  line-height: 1.6;
  color: var(--ad-ink);
}
.tryit-word {
  background: var(--ad-accent);
  color: var(--ad-on-accent);
  padding: 1px 5px;
  border-radius: 5px;
}
.tryit-caption {
  margin: 0 0 12px;
  font-size: var(--adp-text-xs);
  color: var(--ad-ink-faint);
}
.tryit-done {
  margin: 10px 0 0;
  font-size: var(--adp-text-sm);
  font-weight: var(--adp-weight-semi);
  color: var(--ad-accent-ink);
}
```

3. In `connectedCallback` (`settings-form.ts:250` onward), alongside the existing `this.relay(...)`
   calls (`settings-form.ts:309-312`), add:

```ts
this.relay('#tryit-hide', 'tryit-dismiss');
```

4. Add the three public members to the class body (near `keyFromEnv`/`errorReporting`,
   `settings-form.ts:408-428`):

```ts
/** C3: show/hide the post-activation "Try it now" practice section. Set true exactly once, by
 * the composition root, right after a verified activation succeeds (see options.ts). */
set tryIt(show: boolean) {
  if (!this.shadowRoot) return;
  this.q<HTMLElement>('#tryit').hidden = !show;
  if (!show) this.q<HTMLElement>('#tryit-done').hidden = true;
}

/** C3: whether `node` lies inside the try-it practice sentence — lets the composition root scope
 * a document-wide selection listener to just this sentence without reaching into the shadow DOM
 * itself. */
containsTryIt(node: Node): boolean {
  return this.shadowRoot?.getElementById('tryit-sentence')?.contains(node) ?? false;
}

/** C3: mark the practice lookup as completed at least once — reveals a quiet confirmation line.
 * Idempotent; a second successful lookup doesn't need a second confirmation. */
markTryItSucceeded(): void {
  if (this.shadowRoot) this.q<HTMLElement>('#tryit-done').hidden = false;
}
```

Run: `cd packages/app && bunx vitest run test/ui/settings-form.test.ts`
Expected: all tests pass (existing + 6 new).

- [ ] **Step 3: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

Commit:

```
git add packages/app/src/ui/settings-form.ts packages/app/test/ui/settings-form.test.ts
git commit -m "feat: guided first lookup — add try-it-now section to settings-form (C3)" \
  -m $'Tribe-Card: c3-guided-first-lookup\nTribe-Task: 2/4'
```

---

### Task 3: Composition root — wire the real pipeline in `options.ts`

**Files:**

- Modify: `packages/extension-chrome/src/options.ts`

**Precondition:** C2 (`docs/superpowers/plans/` C2's own plan) must already be merged — this task
edits C2's rewritten activation `save` listener. If C2 has not landed when this task starts, STOP
and report back rather than guessing at C2's exact final code; anchor edits on the literal status
string `"You're all set."`, which is stable across the pre-C2 and post-C2 versions.

No dedicated unit test exists for `options.ts` in this repo (a composition root, same precedent as
B5/C2's own composition-root edits) — this task's correctness is proven by Task 4's e2e. Still run
the gate commands below at the end of this task so a regression in existing behavior (onboarding,
settings save, etc.) is caught immediately.

- [ ] **Step 1: Implement.** In `packages/extension-chrome/src/options.ts`:
  1. Add the missing registration call next to the existing two (`options.ts:15-16`):

```ts
registerSettingsForm();
registerOnboarding();
registerContentElements();
```

2. Extend the `@ai-dict/app` import list at the top of the file with:

```ts
registerContentElements,
runLookupWorkflow,
DomSelectionSource,
createDomReader,
InlineBottomSheetRenderer,
MessageRelayLookupClient,
```

and add a new import line:

```ts
import { ChromeFloatingTrigger } from './adapters/chrome-floating-trigger';
```

3. Change `mountSettings`'s signature (`options.ts:84`) to accept a 3rd optional argument, and
   call the new `mountTryIt` at the end of the function body:

```ts
function mountSettings(initial: Settings, status?: string, opts?: { showTryIt?: boolean }): void {
  // ...existing body, unchanged...
  if (status) form.setStatus(status);
  if (opts?.showTryIt) mountTryIt(form);
}
```

4. Add the new composition function, placed after `mountSettings`:

```ts
function mountTryIt(form: SettingsForm): void {
  form.tryIt = true;
  const baseRenderer = new InlineBottomSheetRenderer(document.body);
  let succeeded = false;
  const teardown = runLookupWorkflow({
    selection: new DomSelectionSource(
      document,
      createDomReader((n) => form.containsTryIt(n)),
    ),
    trigger: new ChromeFloatingTrigger(),
    renderer: {
      renderLoading: (w) => baseRenderer.renderLoading(w),
      renderResult: (r, ctx) => {
        baseRenderer.renderResult(r, ctx);
        if (!succeeded) {
          succeeded = true;
          form.markTryItSucceeded();
        }
      },
      renderError: (e) => baseRenderer.renderError(e),
      close: () => baseRenderer.close(),
    },
    client: new MessageRelayLookupClient(chrome.runtime),
    settings: {
      get: () =>
        send({ type: 'settings.get' }).then((r) => {
          if (r.ok && r.type === 'settings') return r.settings;
          throw new Error('try-it: settings.get failed');
        }),
      set: () => Promise.resolve(), // try-it never writes settings
    },
  });
  form.addEventListener('tryit-dismiss', () => {
    teardown();
    form.tryIt = false;
  });
}
```

5. In C2's rewritten `save` listener's verified-success branch, pass `{ showTryIt: true }` and
   add the `configuredProviders` fix to the SAME `chrome.storage.local.set(...)` call that
   persists the pasted key:

```ts
return chrome.storage.local.set({
  settings: {
    ...cur,
    apiKey,
    targetLang,
    hasKey: Boolean(apiKey),
    configuredProviders: apiKey ? ['gemini'] : [],
  },
});
// ...
if (r.ok) {
  void load().then((s) =>
    mountSettings(
      s,
      "You're all set. Highlight any word while reading and choose Define to look it up.",
      { showTryIt: true },
    ),
  );
  return;
}
```

Do **not** add `showTryIt` to the `save-anyway` listener's success path — that path never
verified the key (design spec §3).

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
git commit -m "feat: guided first lookup — wire the real pipeline into options.ts (C3)" \
  -m $'Tribe-Card: c3-guided-first-lookup\nTribe-Task: 3/4'
```

---

### Task 4: e2e functional test

**Files:**

- Create: `packages/extension-chrome/e2e/c3-guided-first-lookup.spec.ts`

- [ ] **Step 1: Write the test.** Model it on `onboarding.spec.ts`'s pattern, extended with
      `mockGemini`/`selectWord`/`openTrigger` from `./helpers` (same helpers `saved-word.spec.ts`
      and B5's e2e already use — no new helper functions needed):

```ts
import { test, expect } from './fixtures';
import { mockGemini, selectWord, openTrigger } from './helpers';

test.describe('C3 guided first lookup', () => {
  test('activating with a verified key shows Try it now; selecting the practice word runs a real lookup', async ({
    context,
    extensionId,
  }) => {
    const gemini = await mockGemini(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.waitForSelector('onboarding-view');
    await page.locator('onboarding-view #key').fill('AIza-activated');
    await page.locator('onboarding-view #activate').click();

    await page.waitForSelector('settings-form');
    const tryit = page.locator('settings-form #tryit');
    await expect(tryit).toBeVisible();
    await expect(page.locator('settings-form .tryit-caption')).toContainText('uses your key');

    // Activation's own connection.test already made one real (mocked) call.
    const beforeTryIt = gemini.count;

    await selectWord(page, 'tryit-sentence', 'serendipity');
    await openTrigger(page);
    await expect(page.locator('bottom-sheet lookup-card')).toContainText('financial institution', {
      timeout: 10_000,
    });
    expect(gemini.count).toBe(beforeTryIt + 1);
    await expect(page.locator('settings-form #tryit-done')).toBeVisible();
  });

  test('selecting text outside the practice sentence never shows the Define trigger', async ({
    context,
    extensionId,
  }) => {
    await mockGemini(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.locator('onboarding-view #key').fill('AIza-activated');
    await page.locator('onboarding-view #activate').click();
    await page.waitForSelector('settings-form');
    await expect(page.locator('settings-form #tryit')).toBeVisible();

    // #tpl-help is settings-form body copy, well outside #tryit-sentence.
    await selectWord(page, 'tpl-help', 'automatically');
    await expect(page.locator('lookup-trigger')).toHaveCount(0);
  });

  test('a rejected key on the practice lookup renders the shared error card with an inert Open Settings button', async ({
    context,
    extensionId,
  }) => {
    // Activation itself must succeed (mocked 200) so try-it renders; the practice lookup's own
    // mock is then swapped to a rejection before the practice click.
    await mockGemini(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.locator('onboarding-view #key').fill('AIza-activated');
    await page.locator('onboarding-view #activate').click();
    await page.waitForSelector('settings-form');

    await mockGemini(context, {
      status: 400,
      body: JSON.stringify({ error: { status: 'INVALID_ARGUMENT' } }),
    });
    await selectWord(page, 'tryit-sentence', 'serendipity');
    await openTrigger(page);
    const card = page.locator('bottom-sheet lookup-card');
    await expect(card).toContainText('Google rejected the API key.', { timeout: 10_000 });
    const settingsCta = card.locator('.setup-cta');
    await expect(settingsCta).toBeVisible();
    await settingsCta.click();
    // Inert: still on the same options tab, no navigation, no thrown error.
    expect(page.url()).toContain('options.html');
  });

  test('dismissing try-it tears down its own selection listener', async ({
    context,
    extensionId,
  }) => {
    await mockGemini(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.locator('onboarding-view #key').fill('AIza-activated');
    await page.locator('onboarding-view #activate').click();
    await page.waitForSelector('settings-form');

    await page.locator('settings-form #tryit-hide').click();
    await expect(page.locator('settings-form #tryit')).toHaveCount(0);

    await selectWord(page, 'tryit-sentence', 'serendipity');
    await expect(page.locator('lookup-trigger')).toHaveCount(0);
  });
});
```

- [ ] **Step 2: Build and run.**

```
GEMINI_API_KEY= bun run build:chrome
cd packages/extension-chrome && bunx playwright test c3-guided-first-lookup
```

Expected: 4 passed.

- [ ] **Step 3: Commit** — gate, then commit:

```
bun run lint && bun run format:check
```

Commit:

```
git add packages/extension-chrome/e2e/c3-guided-first-lookup.spec.ts
git commit -m "feat: guided first lookup — add e2e coverage for the practice lookup (C3)" \
  -m $'Tribe-Card: c3-guided-first-lookup\nTribe-Task: 4/4'
```

---

## Final gate (run once, after Task 4, before opening the PR)

```
cd packages/app && bun run typecheck
cd ../extension-chrome && bun run typecheck
cd ../..
bun run test
bun run lint
bun run format:check
GEMINI_API_KEY= bun run build:chrome
cd packages/extension-chrome && bunx playwright test onboarding c2-verified-activation c3-guided-first-lookup
```

Expected: typecheck clean on both packages; the full Vitest suite green (including the
`dom-selection-source`/`settings-form` additions from Tasks 1-2); lint/format clean; the Chrome
build succeeds with the env key cleared; `onboarding.spec.ts` (regression guard — the pre-C3
onboarding flow must be unaffected), `c2-verified-activation.spec.ts` (regression guard — C2's own
flow must be unaffected by the `configuredProviders` addition), and the new
`c3-guided-first-lookup.spec.ts` suite all pass.

## PR

Follow `.github/PULL_REQUEST_TEMPLATE`, a regular merge commit (never squash — owner ruling
2026-07-16), and a "Testing performed" section per this worktree's `CLAUDE.md` (owner ruling
2026-07-16 — no screenshots/video) listing exactly what the Final gate above ran.
