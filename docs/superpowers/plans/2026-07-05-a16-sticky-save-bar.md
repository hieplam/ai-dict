# A16 Sticky Save Bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pin the Settings **Save** bar to the bottom of the viewport and show an "Unsaved changes" cue, so edits on a long form are savable from anywhere and never silently lost.

**Architecture:** One web component, `packages/app/src/ui/settings-form.ts`. Make the existing `.savebar` `position: sticky`, add a hidden `#dirty` cue span, and track a private `_dirty` flag toggled by edit listeners (set) and by submit + hydration (clear). Unit-tested in happy-dom; sticky pin verified by Playwright e2e screenshot.

**Tech Stack:** TypeScript, native Web Components + Shadow DOM, adopted stylesheets, `--ad-*`/`--adp-*` design tokens, Vitest + happy-dom, axe a11y, Playwright (chrome e2e).

## Global Constraints

- Components read **only** `--ad-*` / `--adp-*` tokens — no hex/oklch, no theme-name branching, no per-component `prefers-color-scheme` (Standing constraint 5).
- No change to what Save does; no change to the field set (roadmap A16 scope fence).
- Reduced-motion respected (the cue toggles with no motion).
- a11y (axe) gate stays green; file coverage stays ≥90%.
- No wire/domain/permission changes; no C3 topology change.

---

### Task 1: Dirty-state tracking + cue

**Files:**

- Modify: `packages/app/src/ui/settings-form.ts` (MARKUP `.savebar` ~L212; CSS `.savebar` ~L115; `connectedCallback` ~L246; `restoreDefaultTemplate` ~L491; `resetEnvelope` ~L510; `set value` ~L547; add fields + helpers)
- Test: `packages/app/test/ui/settings-form.test.ts` (append a `describe`)

**Interfaces:**

- Produces: private `_dirty: boolean`; private methods `markDirty()`, `clearDirty()`, `refreshDirty()`. New DOM node `#dirty` inside `.savebar`. No public API change.

- [ ] **Step 1: Write the failing tests** — append to `packages/app/test/ui/settings-form.test.ts`:

```ts
describe('<settings-form> sticky save bar + dirty state', () => {
  const val = (over: Partial<SettingsFormValue> = {}): SettingsFormValue => ({
    provider: 'gemini',
    apiKey: '',
    openaiApiKey: '',
    anthropicApiKey: '',
    promptEnvelope: '',
    targetLang: 'vi',
    outputFormat: 'T',
    cacheEnabled: true,
    saveHistory: true,
    theme: 'sepia',
    ...over,
  });
  const dirty = (el: SettingsForm) => el.shadowRoot!.querySelector<HTMLElement>('#dirty')!;
  const hint = (el: SettingsForm) => el.shadowRoot!.querySelector<HTMLElement>('.savebar .muted')!;

  it('starts clean after hydration: cue hidden, resting hint shown', () => {
    const el = mountForm();
    el.value = val();
    expect(dirty(el).hidden).toBe(true);
    expect(hint(el).hidden).toBe(false);
  });

  it('typing in a field marks the form dirty (cue shown, hint hidden)', () => {
    const el = mountForm();
    el.value = val();
    const tpl = el.shadowRoot!.querySelector<HTMLTextAreaElement>('#tpl')!;
    tpl.value = 'edited';
    tpl.dispatchEvent(new Event('input', { bubbles: true }));
    expect(dirty(el).hidden).toBe(false);
    expect(hint(el).hidden).toBe(true);
  });

  it('changing a checkbox marks the form dirty', () => {
    const el = mountForm();
    el.value = val();
    const cache = el.shadowRoot!.querySelector<HTMLInputElement>('#cache')!;
    cache.checked = false;
    cache.dispatchEvent(new Event('change', { bubbles: true }));
    expect(dirty(el).hidden).toBe(false);
  });

  it('saving clears the dirty cue', () => {
    const el = mountForm();
    el.value = val();
    const tpl = el.shadowRoot!.querySelector<HTMLTextAreaElement>('#tpl')!;
    tpl.dispatchEvent(new Event('input', { bubbles: true }));
    expect(dirty(el).hidden).toBe(false);
    el.shadowRoot!.querySelector('form')!.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    expect(dirty(el).hidden).toBe(true);
    expect(hint(el).hidden).toBe(false);
  });

  it('re-hydrating via value resets a dirty form to clean', () => {
    const el = mountForm();
    el.value = val();
    el.shadowRoot!.querySelector('#tpl')!.dispatchEvent(new Event('input', { bubbles: true }));
    expect(dirty(el).hidden).toBe(false);
    el.value = val({ outputFormat: 'fresh' });
    expect(dirty(el).hidden).toBe(true);
  });

  it('Restore default template marks the form dirty', () => {
    const el = mountForm();
    el.value = val({ outputFormat: 'my custom prompt' });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    el.shadowRoot!.querySelector<HTMLButtonElement>('#reset-tpl')!.click();
    expect(dirty(el).hidden).toBe(false);
    confirmSpy.mockRestore();
  });

  it('toggling error-reporting does NOT mark the save form dirty', () => {
    const el = mountForm();
    el.value = val();
    const cb = el.shadowRoot!.querySelector<HTMLInputElement>('#error-reporting')!;
    cb.checked = true;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
    expect(dirty(el).hidden).toBe(true);
  });

  it('pins the save bar with position:sticky using tokens', () => {
    const el = mountForm();
    const css = [...el.shadowRoot!.adoptedStyleSheets[0]!.cssRules]
      .map((r) => r.cssText)
      .join('\n')
      .replace(/\s+/g, '');
    expect(css).toContain('position:sticky');
    expect(css).toContain('.savebar'); // rule present
  });

  it('has no axe violations with the dirty cue shown', async () => {
    const el = mountForm();
    el.value = val();
    el.shadowRoot!.querySelector('#tpl')!.dispatchEvent(new Event('input', { bubbles: true }));
    expect(await axeViolations(el)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests, verify they fail**

Run: `cd packages/app && bunx vitest run test/ui/settings-form.test.ts`
Expected: FAIL — `#dirty` is null (cue not yet added), `markDirty` not wired.

- [ ] **Step 3: Add the cue to MARKUP** — in the `.savebar` block (~L212) add the `#dirty` span:

```html
<div class="savebar">
  <button type="submit" id="save" class="primary">Save settings</button>
  <span class="muted">Changes apply after saving</span>
  <span id="dirty" class="dirty" hidden>● Unsaved changes</span>
</div>
```

- [ ] **Step 4: Style the sticky bar + cue (tokens only)** — replace the `.savebar` CSS rule (~L115) and add the `.dirty` rule right after:

```css
.savebar {
  position: sticky;
  bottom: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  margin: 16px -22px 0;
  padding: 14px 22px;
  background: var(--ad-surface);
  border-top: 1px solid var(--ad-line);
}
.savebar .dirty {
  font-size: var(--adp-text-xs);
  font-weight: var(--adp-weight-semi);
  color: var(--ad-accent-ink);
}
```

- [ ] **Step 5: Add the flag + helpers** — add the field near the other private fields (~L241) and the helpers near `setStatus` (~L482):

```ts
// A16: the save bar shows an "Unsaved changes" cue while the form holds unsaved edits.
private _dirty = false;
```

```ts
/** Flag the form as holding unsaved edits and reflect it in the sticky save bar. */
private markDirty(): void {
  this._dirty = true;
  this.refreshDirty();
}
/** Clear the unsaved-edits state (on save dispatch, and on hydration = clean baseline). */
private clearDirty(): void {
  this._dirty = false;
  this.refreshDirty();
}
/** Swap the resting hint for the "Unsaved changes" cue (or back) to match `_dirty`. */
private refreshDirty(): void {
  if (!this.shadowRoot) return;
  this.q<HTMLElement>('#dirty').hidden = !this._dirty;
  this.q<HTMLElement>('.savebar .muted').hidden = this._dirty;
}
```

- [ ] **Step 6: Wire set-dirty on edits** — in `connectedCallback`, after the existing `form` submit listener block (~L292), add the edit listeners; and mark dirty on the submit + theme paths:

```ts
// Mark the form dirty on any edit to a save-form control so the sticky bar can cue it.
// #error-reporting is excluded — it persists via its own event and is not part of
// SettingsFormValue, so toggling it is not an unsaved *settings* change.
const markDirtyOnEdit = (e: Event): void => {
  if ((e.target as HTMLElement | null)?.id === 'error-reporting') return;
  this.markDirty();
};
const dirtyForm = this.q<HTMLFormElement>('form');
dirtyForm.addEventListener('input', markDirtyOnEdit);
dirtyForm.addEventListener('change', markDirtyOnEdit);
```

In the submit handler (~L283) add `this.clearDirty();` after the `dispatchEvent(... 'save' ...)`.
In the `#theme` click handler (~L278) add `this.markDirty();` after `this.setThemePref(...)`.

- [ ] **Step 7: Mark dirty on programmatic template/envelope changes**

In `restoreDefaultTemplate()` after `tpl.value = DEFAULT_OUTPUT_FORMAT;` (~L501) add `this.markDirty();`.
In `resetEnvelope()` after `this._envelopeEdited = false;` (~L512) add `this.markDirty();`.

- [ ] **Step 8: Clear dirty on hydration** — at the end of `set value`, after `this.syncKeyField();` (~L574) add `this.clearDirty();`.

- [ ] **Step 9: Run the tests, verify they pass**

Run: `cd packages/app && bunx vitest run test/ui/settings-form.test.ts`
Expected: PASS (all suites, including the new one and the pre-existing ones).

- [ ] **Step 10: Commit**

```bash
git add packages/app/src/ui/settings-form.ts packages/app/test/ui/settings-form.test.ts
git commit -m "feat(settings): sticky save bar with unsaved-changes cue (A16)"
```

---

### Task 2: Verify full gates

- [ ] **Step 1:** `bun run lint` → clean.
- [ ] **Step 2:** `bun run format:check` → clean (run `bun run format` if not).
- [ ] **Step 3:** `bun run typecheck` → clean.
- [ ] **Step 4:** `bun run test` → all green, coverage ≥90% on the file.
- [ ] **Step 5:** Commit any format fixes.

---

### Task 3: Before/after evidence (Playwright)

- [ ] **Step 1:** `bun run build:chrome` on the branch.
- [ ] **Step 2:** Screenshot the options page at narrow width (dirty state, bar pinned) via the e2e harness.
- [ ] **Step 3:** Build `master` and screenshot the same view (non-sticky) for the "before".
- [ ] **Step 4:** Host PNGs on a `pr-assets/a16-sticky-save-bar` branch; embed via same-origin `github.com/<owner>/<repo>/raw/...` URLs.

## Self-Review

- **Spec coverage:** sticky bar (Task 1 Steps 3-4), dirty cue + swap (Steps 3,5), set-dirty on input/change/theme/programmatic (Steps 6-7), clear on submit/hydration (Steps 6,8), tests incl. error-reporting exclusion + a11y + CSS (Step 1), gates (Task 2), evidence (Task 3). No gaps.
- **Placeholder scan:** none — every step has concrete code/commands.
- **Type consistency:** `markDirty`/`clearDirty`/`refreshDirty` and `_dirty` used consistently; `#dirty` / `.savebar .muted` selectors match the markup added in Step 3.
