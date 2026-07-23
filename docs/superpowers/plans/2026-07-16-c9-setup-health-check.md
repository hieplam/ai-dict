# C9 Setup Health Check Implementation Plan

> **For agentic workers:** implement task-by-task, TDD (red → green → commit) per task. The
> design spec (same folder, `-design.md`) carries every decision; do not re-open them.

**Goal:** a "Check my setup" section in the options page's Settings screen shows, in one screen:
(1) which of the three providers have a key configured, (2) whether the active provider actually
responds (one explicit, cost-disclosed click, reusing the existing `connection.test` message
unchanged), (3) which keyboard shortcuts are assigned (`chrome.commands.getAll()`, read directly
in the options page) — each row with a one-click fix (jump to the key field) or a deep link +
guaranteed-working copyable-text fallback (open `chrome://extensions/shortcuts`).

**Architecture:** two new pure domain functions (`packages/app/src/domain/setup-health-policy.ts`,
`c3-1`), an extended `SettingsForm` (new section + rows + one relocated button), and a small,
untested-by-design composition-root edit (`packages/extension-chrome/src/options.ts`, verified by
e2e) — exactly matching B5/B7's precedent for composition-root code. **Zero wire schema changes**
— row 2 reuses `connection.test` verbatim; rows 1 and 3 need no wire traffic at all. Full design
rationale: `docs/superpowers/specs/2026-07-16-c9-setup-health-check-design.md`.

**Tech Stack:** TypeScript, Vitest + happy-dom (unit), Playwright (e2e).

**Commit subject convention:** `feat: setup health check — <task summary> (C9)`; trailer
`Tribe-Card: c9-setup-health-check`, `Tribe-Task: n/5`. No Co-Authored-By, no attribution
footer (per `.claude/rules/git-conventions.md`).

## Global Constraints

- Implementer: dispatch each task to the `hunter` subagent — never a generic implementer.
- **Do not touch** `packages/app/src/wire.ts`, `packages/app/src/app/router.ts`, or
  `packages/app/src/domain/types.ts` (beyond importing what already exists) — C9 changes no wire
  message and no router case (design spec §3.0). If any task seems to need a wire change, STOP —
  that means a design assumption broke; do not improvise one.
- **No new manifest permissions.** `chrome.commands.getAll()` and `chrome.tabs.create()` both run
  on what's already declared (`commands` manifest key, no `"tabs"` permission needed). If a task
  seems to need a manifest edit, STOP.
- **Read-only except the relocated connection test.** Rows 1 and 3 must never write to
  `chrome.storage.local` or call an LLM; the connection test remains exactly one call, only on an
  explicit click.
- **S1 — never render a key value or a raw shortcut string tied to secrecy.** Every row emits a
  boolean-derived label only (`Configured`/`Missing`, `Assigned`/`Not assigned`).
- UI additions read only `--ad-*`/`--adp-*` design tokens (no hard-coded colors).
- `bun run lint` and `bun run format:check` clean before every commit.
- Every task must leave `cd packages/app && bun run typecheck` (and, from Task 4 on,
  `cd packages/extension-chrome && bun run typecheck`) green.
- **No evidence-video task.** Per the owner's 2026-07-16 evidence-policy ruling, media capture is
  retired campaign-wide — the PR body carries a written "Testing performed" section instead (see
  the `## PR` section at the end of this plan).

---

### Task 1: `domain/setup-health-policy.ts` — pure row derivation

**Files:**

- Create: `packages/app/src/domain/setup-health-policy.ts`
- Create: `packages/app/test/setup-health-policy.test.ts`
- Modify: `packages/app/src/index.ts`

**Interfaces:**

```ts
export interface KeyStatusRow {
  provider: Provider;
  configured: boolean;
}
export function deriveKeyStatusRows(configured: readonly Provider[]): KeyStatusRow[];

export interface CommandLike {
  name?: string | undefined;
  description?: string | undefined;
  shortcut?: string | undefined;
}
export interface ShortcutStatusRow {
  name: string;
  description: string;
  assigned: boolean;
}
export function deriveShortcutRows(commands: readonly CommandLike[]): ShortcutStatusRow[];
```

- [ ] **Step 1: Write the failing tests.** Create `packages/app/test/setup-health-policy.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { deriveKeyStatusRows, deriveShortcutRows } from '../src/domain/setup-health-policy';

describe('setup-health-policy', () => {
  it('deriveKeyStatusRows returns all three providers, canonical order, correct configured flags', () => {
    const rows = deriveKeyStatusRows(['anthropic', 'gemini']);
    expect(rows).toEqual([
      { provider: 'gemini', configured: true },
      { provider: 'openai', configured: false },
      { provider: 'anthropic', configured: true },
    ]);
  });

  it('deriveKeyStatusRows on an empty list marks every provider unconfigured', () => {
    expect(deriveKeyStatusRows([])).toEqual([
      { provider: 'gemini', configured: false },
      { provider: 'openai', configured: false },
      { provider: 'anthropic', configured: false },
    ]);
  });

  it('deriveShortcutRows maps assigned from a non-empty shortcut string', () => {
    const rows = deriveShortcutRows([
      {
        name: 'define-selection',
        description: 'Define the current text selection',
        shortcut: 'Alt+D',
      },
      { name: 'dismiss-lookup', description: 'Dismiss the lookup card', shortcut: '' },
    ]);
    expect(rows).toEqual([
      {
        name: 'define-selection',
        description: 'Define the current text selection',
        assigned: true,
      },
      { name: 'dismiss-lookup', description: 'Dismiss the lookup card', assigned: false },
    ]);
  });

  it('deriveShortcutRows defaults missing name/description/shortcut defensively', () => {
    expect(deriveShortcutRows([{}])).toEqual([{ name: '', description: '', assigned: false }]);
  });

  it('deriveShortcutRows preserves input order and count', () => {
    const input = [
      { name: 'a', description: '', shortcut: '' },
      { name: 'b', description: '', shortcut: 'Ctrl+B' },
      { name: 'c', description: '', shortcut: '' },
    ];
    expect(deriveShortcutRows(input).map((r) => r.name)).toEqual(['a', 'b', 'c']);
  });
});
```

Run: `cd packages/app && bunx vitest run test/setup-health-policy.test.ts`
Expected: 5 failures — the module doesn't exist yet.

- [ ] **Step 2: Implement.** Create `packages/app/src/domain/setup-health-policy.ts`:

```ts
import { PROVIDERS, type Provider } from './types';

/** C9: one row of the "API keys" check — one per known provider, in PROVIDERS order. */
export interface KeyStatusRow {
  provider: Provider;
  configured: boolean;
}

/**
 * C9: derive the per-provider key-presence rows, in canonical PROVIDERS order, from whatever
 * list of currently-configured providers the caller computed (typically `configuredProvidersFor`
 * run against the settings form's live, possibly-unsaved key state). Pure: no chrome/DOM.
 */
export function deriveKeyStatusRows(configured: readonly Provider[]): KeyStatusRow[] {
  return PROVIDERS.map((provider) => ({ provider, configured: configured.includes(provider) }));
}

/**
 * C9: the minimal structural shape this file needs out of a chrome.commands.Command — declared
 * locally (not imported from any chrome lib) so this file stays chrome-free per
 * rule-domain-purity. The composition root's raw `chrome.commands.getAll()` result satisfies
 * this shape structurally; no cast needed at the call site.
 */
export interface CommandLike {
  name?: string | undefined;
  description?: string | undefined;
  shortcut?: string | undefined;
}

export interface ShortcutStatusRow {
  name: string;
  description: string;
  assigned: boolean;
}

/**
 * C9: derive one row per registered command. `assigned` is true iff Chrome reports a non-empty
 * `shortcut` string. Defensive defaults for all three fields since `Command` declares them
 * optional.
 */
export function deriveShortcutRows(commands: readonly CommandLike[]): ShortcutStatusRow[] {
  return commands.map((c) => ({
    name: c.name ?? '',
    description: c.description ?? '',
    assigned: Boolean(c.shortcut),
  }));
}
```

Add the re-export to `packages/app/src/index.ts`, alongside the other `export * from './domain/...'`
lines:

```ts
export * from './domain/setup-health-policy';
```

Run: `cd packages/app && bunx vitest run test/setup-health-policy.test.ts`
Expected: all 5 tests pass.

- [ ] **Step 3: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

```
git add packages/app/src/domain/setup-health-policy.ts packages/app/src/index.ts packages/app/test/setup-health-policy.test.ts
git commit -m "feat: setup health check — add pure row-derivation functions (C9)" \
  -m $'Tribe-Card: c9-setup-health-check\nTribe-Task: 1/5'
```

---

### Task 2: UI — "Check my setup" section: API-key rows + relocated connection test

**Files:**

- Modify: `packages/app/src/ui/settings-form.ts`
- Modify: `packages/app/test/ui/settings-form.test.ts`

- [ ] **Step 1: Write the failing tests.** Append a new `describe` block to
      `packages/app/test/ui/settings-form.test.ts`, after the closing `});` of the existing
      provider-selection `describe` block:

```ts
describe('<settings-form> setup health check — API keys + connection (C9)', () => {
  it('mounts with all three provider rows Missing and their fix buttons visible', () => {
    const el = mountForm();
    for (const p of ['gemini', 'openai', 'anthropic'] as const) {
      expect(el.shadowRoot!.querySelector(`#key-status-${p}-badge`)!.textContent).toBe('Missing');
      expect(el.shadowRoot!.querySelector<HTMLButtonElement>(`#key-status-${p}-fix`)!.hidden).toBe(
        false,
      );
    }
  });

  it('hydrating with a Gemini key marks that row Configured and hides its fix button', () => {
    const el = mountForm();
    el.value = {
      provider: 'gemini',
      apiKey: 'AIza-test',
      openaiApiKey: '',
      anthropicApiKey: '',
      targetLang: 'vi',
      outputFormat: 'T',
      promptEnvelope: '',
      cacheEnabled: true,
      saveHistory: true,
      theme: 'sepia',
    };
    expect(el.shadowRoot!.querySelector('#key-status-gemini-badge')!.textContent).toBe(
      'Configured',
    );
    expect(el.shadowRoot!.querySelector('#key-status-gemini-badge')!.classList.contains('ok')).toBe(
      true,
    );
    expect(el.shadowRoot!.querySelector<HTMLButtonElement>('#key-status-gemini-fix')!.hidden).toBe(
      true,
    );
    expect(el.shadowRoot!.querySelector('#key-status-openai-badge')!.textContent).toBe('Missing');
  });

  it('typing into #key updates the selected provider row live, before Save', () => {
    const el = mountForm();
    el.shadowRoot!.querySelector<HTMLInputElement>('#key')!.value = 'AIza-live';
    el.shadowRoot!.querySelector<HTMLInputElement>('#key')!.dispatchEvent(
      new Event('input', { bubbles: true }),
    );
    expect(el.shadowRoot!.querySelector('#key-status-gemini-badge')!.textContent).toBe(
      'Configured',
    );
  });

  it('the active-provider label follows the provider switch', () => {
    const el = mountForm();
    expect(el.shadowRoot!.querySelector('#health-active-label')!.textContent).toBe(
      'Gemini responds',
    );
    const select = el.shadowRoot!.querySelector<HTMLSelectElement>('#provider')!;
    select.value = 'openai';
    select.dispatchEvent(new Event('change'));
    expect(el.shadowRoot!.querySelector('#health-active-label')!.textContent).toBe(
      'OpenAI responds',
    );
  });

  it('clicking a fix button switches the provider and focuses #key', () => {
    const el = mountForm(); // mountForm() already appends el to document.body
    el.shadowRoot!.querySelector<HTMLButtonElement>('#key-status-openai-fix')!.click();
    expect(el.shadowRoot!.querySelector<HTMLSelectElement>('#provider')!.value).toBe('openai');
    // :focus matching (not shadowRoot.activeElement) — robust regardless of how happy-dom
    // retargets activeElement across a shadow boundary.
    expect(el.shadowRoot!.querySelector('#key:focus')).not.toBeNull();
  });

  it('an env-locked Gemini key always shows Configured with no fix button', () => {
    const el = mountForm();
    el.keyFromEnv = true;
    expect(el.shadowRoot!.querySelector('#key-status-gemini-badge')!.textContent).toBe(
      'Configured',
    );
    expect(el.shadowRoot!.querySelector<HTMLButtonElement>('#key-status-gemini-fix')!.hidden).toBe(
      true,
    );
  });

  it('the relocated #test button still fires test-connection and still exists', () => {
    const el = mountForm();
    const handler = vi.fn();
    el.addEventListener('test-connection', handler);
    el.shadowRoot!.querySelector<HTMLButtonElement>('#test')!.click();
    expect(handler).toHaveBeenCalledOnce();
  });

  it('has no axe violations with the new section present', async () => {
    const el = mountForm();
    expect(await axeViolations(el)).toEqual([]);
  });
});
```

Run: `cd packages/app && bunx vitest run test/ui/settings-form.test.ts`
Expected: 8 new failures (the `#key-status-*`/`#health-active-label` elements don't exist yet;
`focus()` assertion fails since nothing is focusable there yet).

- [ ] **Step 2: Implement.** In `packages/app/src/ui/settings-form.ts`:
  1. Extend the domain import line:

  ```ts
  import { PROVIDERS, configuredProvidersFor, type Provider, type Theme } from '../domain/types';
  ```

  2. Remove the Connection section's `.inline-actions` block (the `#test` button) from inside
     `<section class="sec" aria-labelledby="sec-conn">` — delete these lines:

  ```html
  <div class="inline-actions">
    <button type="button" id="test">Test connection</button>
  </div>
  ```

  3. Insert a new sibling section immediately after Connection's closing `</section>` and before
     the Translation section's opening `<section class="sec" aria-labelledby="sec-trans">`:

  ```html
      </section>
      <section class="sec" aria-labelledby="sec-health">
        <h2 class="sec-h" id="sec-health">Check my setup</h2>
        <p class="health-group-h">API keys</p>
        ${PROVIDERS.map(
          (p) => `<div class="health-row" id="key-status-${p}">
          <span class="health-label">${KEY_LABEL[p]}</span>
          <span class="health-badge" id="key-status-${p}-badge">Missing</span>
          <button type="button" class="link health-fix" id="key-status-${p}-fix" hidden>Add key</button>
        </div>`,
        ).join('')}
        <p class="health-group-h">Connection</p>
        <div class="health-row">
          <span class="health-label" id="health-active-label">Gemini responds</span>
          <button type="button" id="test">Test connection</button>
        </div>
        <p class="health-hint">Sends one real request to your active provider — uses a small
          amount of your own API quota. Runs only when you click it; nothing runs in the
          background.</p>
        <p class="health-group-h">Keyboard shortcuts</p>
        <div id="shortcut-rows"></div>
        <div class="inline-actions">
          <button type="button" id="assign-shortcuts" class="link">Assign shortcuts</button>
        </div>
        <p class="health-hint">Opens <code>chrome://extensions/shortcuts</code> in a new tab. If
          nothing opens, copy this address into a new tab yourself:
          <code class="health-url">chrome://extensions/shortcuts</code></p>
      </section>
  ```

  (The `#shortcut-rows`/`#assign-shortcuts` markup lands here now — Task 3 wires its behavior —
  so this task's markup insertion isn't split awkwardly across two tasks.) 4. Append to the `CSS` template string:

  ```css
  .health-group-h {
    margin: 14px 0 8px;
    font-size: var(--adp-text-sm);
    font-weight: var(--adp-weight-semi);
    color: var(--ad-ink);
  }
  .sec-h + .health-group-h {
    margin-top: 0;
  }
  .health-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 0;
    border-bottom: 1px solid var(--ad-line);
  }
  .health-row:last-child {
    border-bottom: none;
  }
  .health-label {
    flex: 1;
    font-size: var(--adp-text-sm);
    color: var(--ad-ink);
  }
  .health-badge {
    font-size: var(--adp-text-xs);
    font-weight: var(--adp-weight-semi);
    color: var(--ad-error);
  }
  .health-badge.ok {
    color: var(--ad-accent-ink);
  }
  .health-row .health-fix {
    padding: 4px 0;
  }
  .health-hint {
    margin: 8px 0 0;
    font-size: var(--adp-text-xs);
    color: var(--ad-ink-faint);
  }
  .health-url {
    font-family: var(--adp-font-mono);
    background: var(--ad-surface-sunken);
    padding: 2px 6px;
    border-radius: 4px;
    user-select: all;
  }
  ```

  5. Add the render method (near `syncKeyField`):

  ```ts
  /**
   * C9: recompute + repaint the "API keys" rows and the active-provider label. Reads the key
   * currently displayed in `#key` for the SELECTED provider (live, before Save) and the stashed
   * `_keys` for every other provider.
   */
  private renderHealthRows(): void {
    if (!this.shadowRoot) return;
    const keys = { ...this._keys };
    if (!this.isKeyLocked()) keys[this._provider] = this.q<HTMLInputElement>('#key').value;
    const configured = configuredProvidersFor(
      { apiKey: keys.gemini, openaiApiKey: keys.openai, anthropicApiKey: keys.anthropic },
      { envGeminiKey: this._keyFromEnv },
    );
    for (const row of deriveKeyStatusRows(configured)) {
      const badge = this.q<HTMLElement>(`#key-status-${row.provider}-badge`);
      badge.textContent = row.configured ? 'Configured' : 'Missing';
      badge.classList.toggle('ok', row.configured);
      this.q<HTMLButtonElement>(`#key-status-${row.provider}-fix`).hidden = row.configured;
    }
    this.q<HTMLElement>('#health-active-label').textContent =
      `${KEY_LABEL[this._provider].replace(' API key', '')} responds`;
  }

  /** C9: switch the Connection section to `provider` and focus its key field — the "Add key" fix. */
  private jumpToProviderKey(provider: Provider): void {
    this.commitKeyField();
    this._provider = provider;
    this.q<HTMLSelectElement>('#provider').value = provider;
    this.syncKeyField();
    this.renderHealthRows();
    this.q<HTMLInputElement>('#key').focus();
  }
  ```

  Add the `deriveKeyStatusRows` import from the new domain module:

  ```ts
  import { deriveKeyStatusRows } from '../domain/setup-health-policy';
  ```

  6. Wire it up in `connectedCallback`: right after the existing `#key` `blur` listener
     (`settings-form.ts:270-272`), add an `input` listener that repaints rows live:

  ```ts
  key.addEventListener('input', () => this.renderHealthRows());
  ```

  In the `#provider` `change` listener (`settings-form.ts:273-277`), call `this.renderHealthRows()`
  right after `this.syncKeyField()`. Bind the fix-button handlers once, in `connectedCallback`,
  near the other one-time bindings:

  ```ts
  for (const p of PROVIDERS) {
    this.q<HTMLButtonElement>(`#key-status-${p}-fix`).addEventListener('click', () =>
      this.jumpToProviderKey(p),
    );
  }
  ```

  Keep `this.relay('#test', 'test-connection');` exactly as it is (same line, now pointing at the
  relocated button — no code change needed there beyond the markup move).

  At the end of `connectedCallback` (after `this.syncKeyField();` and the `_errorReporting`
  line), add:

  ```ts
  this.renderHealthRows();
  ```

  At the end of the `value` setter (after `this.syncKeyField();` and `this.clearDirty();`), add:

  ```ts
  this.renderHealthRows();
  ```

  Also add, in the `keyFromEnv` setter, after `if (this.shadowRoot) this.syncKeyField();`:

  ```ts
  if (this.shadowRoot) this.renderHealthRows();
  ```

Run: `cd packages/app && bunx vitest run test/ui/settings-form.test.ts`
Expected: all tests pass (existing + 8 new). Existing tests unaffected — `#test` still exists,
`test-connection` still fires, `settings-form.test.ts`'s "keeps every required control" test
(asserting `#test` presence) still passes since the id is unchanged.

- [ ] **Step 3: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

```
git add packages/app/src/ui/settings-form.ts packages/app/test/ui/settings-form.test.ts
git commit -m "feat: setup health check — add API-key rows, relocate connection test (C9)" \
  -m $'Tribe-Card: c9-setup-health-check\nTribe-Task: 2/5'
```

---

### Task 3: UI — keyboard-shortcut rows + Assign-shortcuts relay

**Files:**

- Modify: `packages/app/src/ui/settings-form.ts`
- Modify: `packages/app/test/ui/settings-form.test.ts`

(The `#shortcut-rows`/`#assign-shortcuts` markup already landed in Task 2's section insertion —
this task only adds behavior.)

- [ ] **Step 1: Write the failing tests.** Append next to Task 2's C9 setup-health-check
      `describe` block — actually add a
      **new** sibling block, since this covers a distinct row:

```ts
describe('<settings-form> setup health check — shortcuts (C9)', () => {
  it('renders no shortcut rows until the shortcuts setter is called', () => {
    const el = mountForm();
    expect(el.shadowRoot!.querySelectorAll('#shortcut-rows .health-row').length).toBe(0);
  });

  it('renders one row per entry with the right Assigned/Not-assigned badge', () => {
    const el = mountForm();
    el.shortcuts = [
      {
        name: 'define-selection',
        description: 'Define the current text selection',
        assigned: false,
      },
      { name: 'dismiss-lookup', description: 'Dismiss the lookup card', assigned: true },
    ];
    const rows = el.shadowRoot!.querySelectorAll('#shortcut-rows .health-row');
    expect(rows.length).toBe(2);
    expect(rows[0]!.querySelector('.health-label')!.textContent).toBe(
      'Define the current text selection',
    );
    expect(rows[0]!.querySelector('.health-badge')!.textContent).toBe('Not assigned');
    expect(rows[0]!.querySelector('.health-badge')!.classList.contains('ok')).toBe(false);
    expect(rows[1]!.querySelector('.health-badge')!.textContent).toBe('Assigned');
    expect(rows[1]!.querySelector('.health-badge')!.classList.contains('ok')).toBe(true);
  });

  it('a second shortcuts assignment replaces rows cleanly (no leaked children)', () => {
    const el = mountForm();
    el.shortcuts = [{ name: 'a', description: 'A', assigned: false }];
    el.shortcuts = [{ name: 'b', description: 'B', assigned: true }];
    const rows = el.shadowRoot!.querySelectorAll('#shortcut-rows .health-row');
    expect(rows.length).toBe(1);
    expect(rows[0]!.querySelector('.health-label')!.textContent).toBe('B');
  });

  it('falls back to the raw command name when description is empty', () => {
    const el = mountForm();
    el.shortcuts = [{ name: 'define-selection', description: '', assigned: false }];
    expect(el.shadowRoot!.querySelector('#shortcut-rows .health-label')!.textContent).toBe(
      'define-selection',
    );
  });

  it('clicking Assign shortcuts fires open-shortcuts-page', () => {
    const el = mountForm();
    const handler = vi.fn();
    el.addEventListener('open-shortcuts-page', handler);
    el.shadowRoot!.querySelector<HTMLButtonElement>('#assign-shortcuts')!.click();
    expect(handler).toHaveBeenCalledOnce();
  });

  it('renders the plain chrome://extensions/shortcuts fallback text unconditionally', () => {
    const el = mountForm();
    expect(el.shadowRoot!.querySelector('.health-url')!.textContent).toBe(
      'chrome://extensions/shortcuts',
    );
  });
});
```

Run: `cd packages/app && bunx vitest run test/ui/settings-form.test.ts`
Expected: 6 new failures — `shortcuts` setter doesn't exist; `open-shortcuts-page` never fires.

- [ ] **Step 2: Implement.** In `packages/app/src/ui/settings-form.ts`:
  1. Add the import:

  ```ts
  import { type ShortcutStatusRow } from '../domain/setup-health-policy';
  ```

  (merge with the `deriveKeyStatusRows` import added in Task 2 into one import statement from
  `'../domain/setup-health-policy'`.) 2. Add the field and setter (near the `errorReporting` getter/setter):

  ```ts
  private _shortcuts: ShortcutStatusRow[] = [];

  /** C9: the current keyboard-shortcut assignment state, supplied by the composition root (the
   * only layer allowed to call `chrome.commands.getAll()`). Renders one row per entry; empty
   * until the composition root's first `chrome.commands.getAll()` resolves. */
  set shortcuts(rows: ShortcutStatusRow[]) {
    this._shortcuts = rows;
    if (this.shadowRoot) this.renderShortcutRows();
  }
  get shortcuts(): ShortcutStatusRow[] {
    return this._shortcuts;
  }

  private renderShortcutRows(): void {
    const container = this.q<HTMLElement>('#shortcut-rows');
    container.replaceChildren(
      ...this._shortcuts.map((row) => {
        const div = document.createElement('div');
        div.className = 'health-row';
        const label = document.createElement('span');
        label.className = 'health-label';
        label.textContent = row.description || row.name;
        const badge = document.createElement('span');
        badge.className = 'health-badge';
        badge.classList.toggle('ok', row.assigned);
        badge.textContent = row.assigned ? 'Assigned' : 'Not assigned';
        div.append(label, badge);
        return div;
      }),
    );
  }
  ```

  3. In `connectedCallback`, alongside the other `this.relay(...)` calls, add:

  ```ts
  this.relay('#assign-shortcuts', 'open-shortcuts-page');
  ```

Run: `cd packages/app && bunx vitest run test/ui/settings-form.test.ts`
Expected: all tests pass (existing + 6 new from this task + 8 from Task 2).

- [ ] **Step 3: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

```
git add packages/app/src/ui/settings-form.ts packages/app/test/ui/settings-form.test.ts
git commit -m "feat: setup health check — add keyboard-shortcut rows (C9)" \
  -m $'Tribe-Card: c9-setup-health-check\nTribe-Task: 3/5'
```

---

### Task 4: Wire the composition root (`options.ts`)

**Files:**

- Modify: `packages/extension-chrome/src/options.ts`

No dedicated unit test exists for `options.ts` in this repo — it is a composition root, covered
by e2e only (same precedent as B1's/B5's/B7's own composition-root edits). This task's
correctness is proven by Task 5's e2e test; still run the typecheck gate at the end so a
regression in existing behavior is caught immediately.

- [ ] **Step 1: Implement.** In `packages/extension-chrome/src/options.ts`:
  1. Add the import, alongside the existing `@ai-dict/app` import block:

  ```ts
  import { deriveShortcutRows, type ShortcutStatusRow } from '@ai-dict/app';
  ```

  2. Add a module-level helper (near `download`/`toFormValue`):

  ```ts
  /** C9: read the current keyboard-shortcut assignment state and push it into the form. Direct
   * chrome.commands.getAll() call — the options page has its own chrome.* namespace, no SW round
   * trip needed (see the design spec §3.4). */
  async function refreshShortcuts(form: SettingsForm): Promise<void> {
    const commands = await chrome.commands.getAll();
    (form as unknown as { shortcuts: ShortcutStatusRow[] }).shortcuts =
      deriveShortcutRows(commands);
  }
  ```

  3. In `mountSettings`, after the existing `wireSettings(form);` call, add:

  ```ts
  void refreshShortcuts(form);
  form.addEventListener('open-shortcuts-page', () => {
    void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }).catch(() => undefined);
  });
  // C9: the reader's most likely path back from chrome://extensions/shortcuts is refocusing this
  // tab — re-read on focus so a just-assigned shortcut flips to "Assigned" without a manual reload.
  window.addEventListener('focus', () => void refreshShortcuts(form));
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

```
git add packages/extension-chrome/src/options.ts
git commit -m "feat: setup health check — wire chrome.commands.getAll into the options page (C9)" \
  -m $'Tribe-Card: c9-setup-health-check\nTribe-Task: 4/5'
```

---

### Task 5: e2e functional test

**Files:**

- Create: `packages/extension-chrome/e2e/c9-setup-health-check.spec.ts`

**IMPORTANT — clear `GEMINI_API_KEY` before building.** `esbuild.config.mjs` bakes the builder's
shell `GEMINI_API_KEY` into the bundle if it's set (`esbuild.config.mjs:12-13`); if the machine
running this task has it exported (the live dev-infra flake noted in `docs/ROADMAP.md` §8's
2026-07-16 Decision Log entry and C10's card), the settings screen renders with Gemini
env-locked, which changes what this spec's key-row assertions would see. Every build command in
this task explicitly unsets it — do not skip this even if C10 has already landed, since this
plan must be correct standalone.

- [ ] **Step 1: Write the test.** Model the fixture/mocking pattern directly on
      `saved-word.spec.ts`/`options-actions.spec.ts`:

```ts
import { test, expect } from './fixtures';
import { seedSettings, mockGemini } from './helpers';

test.describe('C9 setup health check', () => {
  test('API key rows reflect which providers are configured, with working fix buttons', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page, {
      provider: 'gemini',
      apiKey: 'AIza-test',
      openaiApiKey: '',
      anthropicApiKey: '',
      configuredProviders: ['gemini'],
      hasKey: true,
    });
    await page.reload();
    await page.waitForSelector('settings-form');

    // Playwright's CSS locator engine pierces open shadow roots automatically (same convention
    // as every existing spec, e.g. options-actions.spec.ts's `'settings-form #test'`) — no `>>>`
    // needed.
    const geminiBadge = page.locator('settings-form #key-status-gemini-badge');
    const openaiBadge = page.locator('settings-form #key-status-openai-badge');
    await expect(geminiBadge).toHaveText('Configured');
    await expect(openaiBadge).toHaveText('Missing');

    const openaiFix = page.locator('settings-form #key-status-openai-fix');
    await expect(openaiFix).toBeVisible();
    await openaiFix.click();
    await expect(page.locator('settings-form #provider')).toHaveValue('openai');
    await expect(page.locator('settings-form #key')).toBeFocused();
  });

  test('shortcut rows show all three commands unassigned out of the box', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);
    await page.reload();
    await page.waitForSelector('settings-form');

    // manifest.json declares no suggested_key for any of the three commands — a fresh profile in
    // the bundled Chromium reports all three unassigned; no mocking needed (design spec §3.5).
    const rows = page.locator('settings-form #shortcut-rows .health-row');
    await expect(rows).toHaveCount(3);
    for (const row of await rows.all()) {
      await expect(row.locator('.health-badge')).toHaveText('Not assigned');
    }
    await expect(page.locator('settings-form .health-url')).toHaveText(
      'chrome://extensions/shortcuts',
    );
  });

  test('the relocated connection-test row still reports Connection OK', async ({
    context,
    extensionId,
  }) => {
    await mockGemini(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page, { apiKey: 'AIza-test', hasKey: true });
    await page.reload();
    await page.waitForSelector('settings-form');
    await page.locator('settings-form #test').click();
    await expect(page.locator('settings-form #status')).toHaveText('Connection OK');
  });
});
```

- [ ] **Step 2: Build and run** (env cleared, per the note above):

```
env -u GEMINI_API_KEY bun run build:chrome
cd packages/extension-chrome && bunx playwright test c9-setup-health-check
```

Expected: 3 passed.

- [ ] **Step 3: Commit** — gate, then commit:

```
bun run lint && bun run format:check
```

```
git add packages/extension-chrome/e2e/c9-setup-health-check.spec.ts
git commit -m "feat: setup health check — add e2e coverage for the diagnostics section (C9)" \
  -m $'Tribe-Card: c9-setup-health-check\nTribe-Task: 5/5'
```

---

## Final gate (run once, after Task 5, before opening the PR)

```
cd packages/app && bun run typecheck
cd ../extension-chrome && bun run typecheck
cd ../..
bun run test
bun run lint
bun run format:check
env -u GEMINI_API_KEY bun run build:chrome
cd packages/extension-chrome && bunx playwright test options-actions saved-word c9-setup-health-check
```

Expected: typecheck clean on both packages; the full Vitest suite green (including the new
`setup-health-policy` + `settings-form` additions); lint/format clean; the Chrome build succeeds
with `GEMINI_API_KEY` unset; `options-actions.spec.ts` (regression guard — `#test`'s relocation
must not break the existing connection-test/save/clear-cache/clear-history/export flows),
`saved-word.spec.ts` (unrelated regression guard, cheap to include), and the new
`c9-setup-health-check.spec.ts` all pass.

## PR

Title: `feat: setup health check — diagnose key/connection/shortcut gaps in one screen (C9)`.

Body: 1–3 sentences on what changed and why (post-onboarding breakage currently re-runs the whole
bad-first-day experience; this closes it in one settings-page section). Design choices (≤3 one-line
bullets): zero wire changes (row 2 reuses `connection.test` verbatim); `chrome.commands.getAll()`
read directly in the options page, no SW round trip; the `chrome://extensions/shortcuts` deep link
is best-effort with an unconditional copyable-text fallback (Chrome doesn't document guaranteed
navigation to that URL — see spec §3.5).

Per the owner's 2026-07-16 evidence-policy ruling, **no screenshots/videos** — the PR body carries
a written **"Testing performed"** section instead: unit suites + counts (`setup-health-policy`,
`settings-form` additions), the e2e scenarios exercised (key rows reflect configured providers +
fix-button focus jump; shortcut rows reflect `chrome.commands.getAll()` unassigned-by-default;
relocated connection test still reports OK via `mockGemini`), and the gates that passed
(typecheck ×2, lint, format, full Vitest suite, Chrome build with `GEMINI_API_KEY` unset,
Playwright regression + new suites).

## JIRA ticket

- n/a (repo is not Jira-tracked)

## Merge

ALL CI checks green → regular merge (`gh pr merge --merge --delete-branch`; **squash prohibited**
per standing owner rule). Verify the merge commit has exactly 2 parents; confirm master CI green;
remove the worktree.
