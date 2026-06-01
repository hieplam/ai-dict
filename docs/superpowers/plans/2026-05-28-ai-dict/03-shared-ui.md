---
bundle: '03'
title: shared-ui
status: DONE
locked_by: ''
locked_at: ''
done_at: '2026-05-30T08:19:22Z'
prereqs: ['02']
owns_files:
  - packages/shared-ui/package.json
  - packages/shared-ui/tsconfig.json
  - packages/shared-ui/vitest.config.ts
  - packages/shared-ui/src/lookup-trigger.ts
  - packages/shared-ui/src/lookup-card.ts
  - packages/shared-ui/src/bottom-sheet.ts
  - packages/shared-ui/src/settings-form.ts
  - packages/shared-ui/src/styles/**
  - packages/shared-ui/src/index.ts
  - packages/shared-ui/test/**
---

# Bundle 03 — shared-ui/ (presentational Web Components)

**Purpose:** The four framework-free Web Components rendered in **open** Shadow DOM with Constructable Stylesheets (`adoptedStyleSheets`, no inline `<style>` — CSP `style-src 'self'`). Presentational only: emit events, hold no business logic, import core **types only**. Accessibility (§7.5) is first-class.

## Lock protocol

Verify prereq `02-core.md` is `DONE`. Flip YAML → LOCKED, commit `[03] lock`, rebase, abort on race. Execute.

## Inputs

- Bundle 02 DONE: domain types (`LookupResult`, `LookupError`, `PublicSettings`, `HistoryEntry`) imported **as types**.
- Spec §5.3 (component table + events + shadow-mode note), §7.5 (a11y), §7.3 S5 (CSP / adoptedStyleSheets).

## Outputs (frozen contracts — tags + events)

- `<lookup-trigger>` → emits `lookup-click`; `role="button"`, `aria-label`, keyboard-activatable, focus ring.
- `<lookup-card state>` → emits `close`, `expand`; renders sanitized-Markdown result + loading + error states; semantic headings (H2/H3), `aria-live="polite"`. (Sanitization pipeline itself lives in 04; the card accepts already-safe content via the `state` setter. The input property is named `state` — not `payload` as an earlier draft named it.)
- `<bottom-sheet>` → emits `dismiss`; `role="dialog"`, `aria-modal`, `aria-labelledby`, focus trap, ESC closes, restores focus, respects `prefers-reduced-motion`.
- `<settings-form>` → emits `save`, `clear-cache`, `clear-history`, `test-connection`, `export-history`; password input + reveal for key, target-lang picker, prompt textarea, history list, cache controls; labels + `aria-describedby`.
- All styles via `adoptedStyleSheets`; no inline `<style>` anywhere.

## Definition of Done

- D1: All four components register as custom elements and render in happy-dom (constructable stylesheets supported; jsdom is not used — see spec §8.1 note).
- D2: Each documented event fires with the correct `detail` shape and name (exact names from §5.3).
- D3: Open Shadow DOM used (testable by `@testing-library/dom` reaching `shadowRoot`); no closed roots.
- D4: `axe-core` reports zero violations for each component's rendered states (loading/result/error where applicable).
- D5: `<bottom-sheet>` focus trap + ESC-to-dismiss + focus restore verified; `prefers-reduced-motion` disables slide animation.
- D6: No inline `<style>` — styles attached via `adoptedStyleSheets` (asserted in test/build).
- D7: Imports from core are **type-only** (lint hex rule passes); no port impls imported.
- D8: Coverage ≥ 75% (spec §8.2).

## Implementation steps

> All components: **open** Shadow DOM, styles via `adoptedStyleSheets` (no inline `<style>`), events `bubbles:true, composed:true` so they cross the shadow boundary. Register guarded by `customElements.get(...)` (avoids re-define across test files). Tests run under happy-dom; mount helper: `const el = document.createElement('x') as X; document.body.append(el);`. Run filtered: `pnpm --filter @ai-dict/shared-ui test`.

### Task A — Package setup + style helper

**Files:** Create `packages/shared-ui/package.json`, `tsconfig.json`, `vitest.config.ts`, `src/styles/adopt.ts`, `src/index.ts`, `test/a11y.ts`.

- [ ] **A1: `packages/shared-ui/package.json`**

```json
{
  "name": "@ai-dict/shared-ui",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./lookup-trigger": "./src/lookup-trigger.ts",
    "./lookup-card": "./src/lookup-card.ts",
    "./bottom-sheet": "./src/bottom-sheet.ts",
    "./settings-form": "./src/settings-form.ts"
  },
  "scripts": { "typecheck": "tsc --noEmit", "test": "vitest run" },
  "dependencies": { "@ai-dict/core": "workspace:*" },
  "devDependencies": {
    "happy-dom": "^15.0.0",
    "@testing-library/dom": "^10.0.0",
    "axe-core": "^4.10.0"
  }
}
```

Then `pnpm install`. Note: `@ai-dict/core` is used for **types only** (enforced by the §8.3 ESLint rule from Bundle 01).

- [ ] **A2: `packages/shared-ui/tsconfig.json`** (DOM lib required here — components touch `HTMLElement`, `CSSStyleSheet`, `ShadowRoot`)

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "noEmit": true, "lib": ["ES2022", "DOM", "DOM.Iterable"] },
  "include": ["src", "test"]
}
```

- [ ] **A3: `packages/shared-ui/vitest.config.ts`** (happy-dom + 75% coverage — spec §8.2)

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'shared-ui',
    environment: 'happy-dom',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      thresholds: { lines: 75, functions: 75, branches: 75, statements: 75 },
    },
  },
});
```

- [ ] **A4: `packages/shared-ui/src/styles/adopt.ts`** (the single CSP-safe styling primitive)

```ts
export function adoptStyles(root: ShadowRoot, css: string): void {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  root.adoptedStyleSheets = [sheet];
}
```

- [ ] **A5: `packages/shared-ui/src/index.ts`** (side-effect registers all components)

```ts
export * from './lookup-trigger';
export * from './lookup-card';
export * from './bottom-sheet';
export * from './settings-form';
```

- [ ] **A6: `packages/shared-ui/test/a11y.ts`** (shared axe runner)

Components are tested in isolation, not as a full page — so the axe run must exclude document-structure **best-practice** rules (`region`, `landmark-one-main`, `page-has-heading-one`), which otherwise flag every isolated component. Restricting to WCAG A/AA tags excludes them. `color-contrast` can't be computed in a Node DOM, so axe reports it as _incomplete_, not a violation.

```ts
import axe, { type Result } from 'axe-core';

export async function axeViolations(el: Element): Promise<Result[]> {
  const results = await axe.run(el, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
  });
  return results.violations;
}
```

- [ ] **A7: Typecheck + commit**

Run: `pnpm --filter @ai-dict/shared-ui typecheck` → PASS.

```bash
git add packages/shared-ui/package.json packages/shared-ui/tsconfig.json packages/shared-ui/vitest.config.ts packages/shared-ui/src/styles/adopt.ts packages/shared-ui/src/index.ts packages/shared-ui/test/a11y.ts pnpm-lock.yaml
git commit -m "feat(shared-ui): package setup + adoptedStyleSheets + axe helper"
```

### Task B — `<lookup-trigger>`

**Files:** Create `packages/shared-ui/src/lookup-trigger.ts`, `packages/shared-ui/test/lookup-trigger.test.ts`.

- [ ] **B1: Write the failing test** (also validates happy-dom supports adoptedStyleSheets — fails fast if not)

```ts
import { describe, it, expect, vi } from 'vitest';
import { axeViolations } from './a11y';
import '../src/lookup-trigger';

function mount<T extends HTMLElement>(tag: string): T {
  const el = document.createElement(tag) as T;
  document.body.append(el);
  return el;
}

describe('<lookup-trigger>', () => {
  it('renders an accessible button with adopted styles', () => {
    const el = mount('lookup-trigger');
    const root = el.shadowRoot!;
    expect(root.adoptedStyleSheets.length).toBe(1); // happy-dom constructable-stylesheet smoke check
    const btn = root.querySelector('button')!;
    expect(btn.getAttribute('aria-label')).toBeTruthy();
    expect(btn.getAttribute('role')).toBe('button');
  });

  it('emits a composed "lookup-click" on activation', () => {
    const el = mount('lookup-trigger');
    const spy = vi.fn();
    el.addEventListener('lookup-click', spy);
    el.shadowRoot!.querySelector('button')!.click();
    expect(spy).toHaveBeenCalledOnce();
  });

  it('has no axe violations', async () => {
    const el = mount('lookup-trigger');
    expect(await axeViolations(el)).toEqual([]);
  });
});
```

Run → FAIL (module not found).

- [ ] **B2: Implement** `packages/shared-ui/src/lookup-trigger.ts`

```ts
import { adoptStyles } from './styles/adopt';

const CSS = `:host{all:initial}
button{font:600 13px/1 system-ui;padding:6px 10px;border:1px solid #888;border-radius:6px;background:#fff;cursor:pointer}
button:focus-visible{outline:2px solid #1a73e8;outline-offset:2px}`;

export class LookupTrigger extends HTMLElement {
  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    adoptStyles(root, CSS);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('role', 'button');
    btn.setAttribute('aria-label', 'Look up selected text');
    btn.textContent = 'Define';
    btn.addEventListener('click', () => {
      this.dispatchEvent(new CustomEvent('lookup-click', { bubbles: true, composed: true }));
    });
    root.append(btn);
  }
}

if (!customElements.get('lookup-trigger')) customElements.define('lookup-trigger', LookupTrigger);
```

(A native `<button>` is keyboard-activatable: Enter/Space fire `click`, so the single click handler covers keyboard.) Run → PASS. Commit `feat(shared-ui): <lookup-trigger>`.

### Task C — `<bottom-sheet>`

**Files:** Create `packages/shared-ui/src/bottom-sheet.ts`, `packages/shared-ui/test/bottom-sheet.test.ts`.

- [ ] **C1: Write the failing test**

```ts
import { describe, it, expect, vi } from 'vitest';
import { axeViolations } from './a11y';
import '../src/bottom-sheet';

function mountSheet(): HTMLElement {
  const el = document.createElement('bottom-sheet');
  el.innerHTML = '<button id="a">a</button><button id="b">b</button>';
  document.body.append(el); // connectedCallback wires ARIA + focus
  return el;
}

describe('<bottom-sheet>', () => {
  it('exposes a labelled modal dialog', () => {
    const el = mountSheet();
    const dialog = el.shadowRoot!.querySelector('[role="dialog"]')!;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBeTruthy();
  });

  it('dismisses on Escape and on scrim click', () => {
    const el = mountSheet();
    const spy = vi.fn();
    el.addEventListener('dismiss', spy);
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    el.shadowRoot!.querySelector('.scrim')!.dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('traps Tab focus within its focusables', () => {
    const el = mountSheet();
    const a = el.querySelector<HTMLButtonElement>('#a')!;
    const b = el.querySelector<HTMLButtonElement>('#b')!;
    b.focus();
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(document.activeElement).toBe(a); // wrapped last → first
  });

  it('restores focus to the opener on disconnect', () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const el = mountSheet();
    el.remove();
    expect(document.activeElement).toBe(opener);
  });

  it('marks reduced-motion when the user prefers it', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const el = mountSheet();
    expect(el.hasAttribute('reduced')).toBe(true);
    vi.unstubAllGlobals();
  });

  it('has no axe violations', async () => {
    const el = mountSheet();
    expect(await axeViolations(el)).toEqual([]);
  });
});
```

Run → FAIL.

- [ ] **C2: Implement** `packages/shared-ui/src/bottom-sheet.ts`

```ts
import { adoptStyles } from './styles/adopt';

const CSS = `:host{position:fixed;inset:0;z-index:2147483647}
.scrim{position:absolute;inset:0;background:rgba(0,0,0,.4)}
.panel{position:absolute;left:0;right:0;bottom:0;background:#fff;border-radius:12px 12px 0 0;
  max-height:80vh;overflow:auto;padding:12px;transition:transform .25s ease}
:host([reduced]) .panel{transition:none}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}`;

export class BottomSheet extends HTMLElement {
  private prevFocus: HTMLElement | null = null;
  private panel: HTMLElement | null = null;

  connectedCallback(): void {
    if (this.shadowRoot) return;
    const root = this.attachShadow({ mode: 'open' });
    adoptStyles(root, CSS);
    if (globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
      this.setAttribute('reduced', '');

    const scrim = document.createElement('div');
    scrim.className = 'scrim';
    scrim.addEventListener('click', () => this.dismiss());

    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'sheet-title');
    panel.tabIndex = -1;
    const title = document.createElement('h2');
    title.id = 'sheet-title';
    title.className = 'sr-only';
    title.textContent = 'Dictionary lookup';
    panel.append(title, document.createElement('slot'));

    root.append(scrim, panel);
    this.panel = panel;
    this.addEventListener('keydown', this.onKeydown);
    this.prevFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.focus();
  }

  disconnectedCallback(): void {
    this.removeEventListener('keydown', this.onKeydown);
    this.prevFocus?.focus();
  }

  private onKeydown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      this.dismiss();
      return;
    }
    if (e.key === 'Tab') this.trapFocus(e);
  };

  private focusables(): HTMLElement[] {
    const sel = 'a[href],button,input,textarea,select,[tabindex]:not([tabindex="-1"])';
    return [...this.querySelectorAll<HTMLElement>(sel)].filter(
      (el) => !el.hasAttribute('disabled'),
    );
  }

  private trapFocus(e: KeyboardEvent): void {
    const f = this.focusables();
    if (f.length === 0) {
      e.preventDefault();
      this.panel?.focus();
      return;
    }
    const first = f[0]!;
    const last = f[f.length - 1]!;
    const active = document.activeElement;
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  dismiss(): void {
    this.dispatchEvent(new CustomEvent('dismiss', { bubbles: true, composed: true }));
  }
}

if (!customElements.get('bottom-sheet')) customElements.define('bottom-sheet', BottomSheet);
```

Run → PASS. Commit `feat(shared-ui): <bottom-sheet> (dialog + focus trap + ESC)`.

### Task D — `<lookup-card>`

**Files:** Create `packages/shared-ui/src/lookup-card.ts`, `packages/shared-ui/test/lookup-card.test.ts`.

- [ ] **D1: Write the failing test**

```ts
import { describe, it, expect, vi } from 'vitest';
import { axeViolations } from './a11y';
import { LookupCard } from '../src/lookup-card';
import '../src/lookup-card';

function mountCard(): LookupCard {
  const el = document.createElement('lookup-card') as LookupCard;
  document.body.append(el);
  return el;
}

describe('<lookup-card>', () => {
  it('has an aria-live region and loading state by default', () => {
    const el = mountCard();
    const region = el.shadowRoot!.querySelector('[aria-live="polite"]')!;
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.textContent).toContain('Looking up');
  });

  it('renders a result with a heading and the pre-sanitized body', () => {
    const el = mountCard();
    el.state = { kind: 'result', word: 'bank', target: 'vi', safeHtml: '<p>money place</p>' };
    const root = el.shadowRoot!;
    expect(root.querySelector('h2')!.textContent).toBe('bank');
    expect(root.querySelector('[aria-live]')!.innerHTML).toContain('money place');
  });

  it('renders an error message', () => {
    const el = mountCard();
    el.state = {
      kind: 'error',
      error: { code: 'NETWORK', message: 'Network failed.', retryable: true },
    };
    expect(el.shadowRoot!.querySelector('.err')!.textContent).toBe('Network failed.');
  });

  it('emits "close" and "expand"', () => {
    const el = mountCard();
    const close = vi.fn();
    const expand = vi.fn();
    el.addEventListener('close', close);
    el.addEventListener('expand', expand);
    el.shadowRoot!.querySelector<HTMLButtonElement>('[data-act="close"]')!.click();
    el.shadowRoot!.querySelector<HTMLButtonElement>('[data-act="expand"]')!.click();
    expect(close).toHaveBeenCalledOnce();
    expect(expand).toHaveBeenCalledOnce();
  });

  it('has no axe violations (loading state)', async () => {
    const el = mountCard();
    expect(await axeViolations(el)).toEqual([]);
  });
});
```

Run → FAIL.

- [ ] **D2: Implement** `packages/shared-ui/src/lookup-card.ts`

```ts
import type { LookupError } from '@ai-dict/core';
import { adoptStyles } from './styles/adopt';

export type CardState =
  | { kind: 'loading' }
  | { kind: 'result'; safeHtml: string; word: string; target: string }
  | { kind: 'error'; error: LookupError };

const CSS = `:host{display:block;font:14px/1.5 system-ui;color:#202124}
.bar{display:flex;gap:8px;justify-content:flex-end;padding:8px}
.region{padding:0 12px 12px}
h2{font-size:1.1rem;margin:0 0 8px}
.err{color:#b00020}`;

export class LookupCard extends HTMLElement {
  private region: HTMLElement | null = null;
  private _state: CardState = { kind: 'loading' };

  connectedCallback(): void {
    if (this.shadowRoot) return;
    const root = this.attachShadow({ mode: 'open' });
    adoptStyles(root, CSS);

    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.append(this.actionButton('expand', 'Expand'), this.actionButton('close', 'Close'));

    const region = document.createElement('section');
    region.className = 'region';
    region.setAttribute('aria-live', 'polite');

    root.append(bar, region);
    this.region = region;
    this.render();
  }

  private actionButton(act: 'expand' | 'close', label: string): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset['act'] = act;
    b.setAttribute('aria-label', label);
    b.textContent = label;
    b.addEventListener('click', () =>
      this.dispatchEvent(new CustomEvent(act, { bubbles: true, composed: true })),
    );
    return b;
  }

  set state(s: CardState) {
    this._state = s;
    if (this.region) this.render();
  }
  get state(): CardState {
    return this._state;
  }

  private render(): void {
    const region = this.region;
    if (!region) return;
    region.replaceChildren();
    const s = this._state;
    if (s.kind === 'loading') {
      region.textContent = 'Looking up…';
      return;
    }
    if (s.kind === 'error') {
      const h = document.createElement('h2');
      h.textContent = 'Lookup failed';
      const p = document.createElement('p');
      p.className = 'err';
      p.textContent = s.error.message;
      region.append(h, p);
      return;
    }
    const h = document.createElement('h2');
    h.textContent = s.word;
    const body = document.createElement('div');
    body.innerHTML = s.safeHtml; // trusted: sanitized upstream by adapters-shared (S4)
    region.append(h, body);
  }
}

if (!customElements.get('lookup-card')) customElements.define('lookup-card', LookupCard);
```

Run → PASS. Commit `feat(shared-ui): <lookup-card>`.

### Task E — `<settings-form>`

**Files:** Create `packages/shared-ui/src/settings-form.ts`, `packages/shared-ui/test/settings-form.test.ts`.

- [ ] **E1: Write the failing test**

```ts
import { describe, it, expect, vi } from 'vitest';
import { axeViolations } from './a11y';
import { SettingsForm, type SettingsFormValue } from '../src/settings-form';
import '../src/settings-form';

function mountForm(): SettingsForm {
  const el = document.createElement('settings-form') as SettingsForm;
  document.body.append(el);
  return el;
}

describe('<settings-form>', () => {
  it('masks the API key and toggles reveal', () => {
    const el = mountForm();
    const key = el.shadowRoot!.querySelector<HTMLInputElement>('#key')!;
    expect(key.type).toBe('password');
    el.shadowRoot!.querySelector<HTMLButtonElement>('#reveal')!.click();
    expect(key.type).toBe('text');
  });

  it('emits "save" with the collected form value', () => {
    const el = mountForm();
    el.value = {
      apiKey: '',
      targetLang: 'vi',
      promptTemplate: 'T',
      cacheEnabled: true,
      saveHistory: true,
    };
    const spy = vi.fn();
    el.addEventListener('save', (e) => spy((e as CustomEvent<SettingsFormValue>).detail));
    el.shadowRoot!.querySelector<HTMLInputElement>('#key')!.value = 'AIza-test';
    el.shadowRoot!.querySelector('form')!.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'AIza-test',
        targetLang: 'vi',
        promptTemplate: 'T',
        cacheEnabled: true,
        saveHistory: true,
      }),
    );
  });

  it('emits the four action events', () => {
    const el = mountForm();
    const events = ['clear-cache', 'clear-history', 'test-connection', 'export-history'] as const;
    const spies = Object.fromEntries(events.map((n) => [n, vi.fn()]));
    for (const n of events) el.addEventListener(n, spies[n]!);
    el.shadowRoot!.querySelector<HTMLButtonElement>('#clear-cache')!.click();
    el.shadowRoot!.querySelector<HTMLButtonElement>('#clear-history')!.click();
    el.shadowRoot!.querySelector<HTMLButtonElement>('#test')!.click();
    el.shadowRoot!.querySelector<HTMLButtonElement>('#export')!.click();
    for (const n of events) expect(spies[n]!).toHaveBeenCalledOnce();
  });

  it('has no axe violations', async () => {
    const el = mountForm();
    expect(await axeViolations(el)).toEqual([]);
  });
});
```

Run → FAIL.

- [ ] **E2: Implement** `packages/shared-ui/src/settings-form.ts`

```ts
import { adoptStyles } from './styles/adopt';

export interface SettingsFormValue {
  apiKey: string;
  targetLang: string;
  promptTemplate: string;
  cacheEnabled: boolean;
  saveHistory: boolean;
}

const CSS = `:host{display:block;font:14px/1.5 system-ui;color:#202124}
label{display:block;margin:8px 0 4px;font-weight:600}
.row{margin-bottom:12px}
input,select,textarea{font:inherit;width:100%;box-sizing:border-box}
.actions button{margin-right:8px}`;

const MARKUP = `<form>
  <div class="row">
    <label for="key">Gemini API key</label>
    <input id="key" type="password" autocomplete="off" aria-describedby="key-help" />
    <button type="button" id="reveal" aria-label="Reveal API key">Show</button>
    <p id="key-help">Stored locally on this device only.</p>
  </div>
  <div class="row">
    <label for="target">Target language</label>
    <select id="target"><option value="vi">Vietnamese</option><option value="es">Spanish</option></select>
  </div>
  <div class="row">
    <label for="tpl">Prompt template</label>
    <textarea id="tpl" rows="6"></textarea>
  </div>
  <div class="row">
    <label><input type="checkbox" id="cache" /> Cache lookups</label>
    <label><input type="checkbox" id="history" /> Save history</label>
  </div>
  <div class="row actions">
    <button type="submit" id="save">Save</button>
    <button type="button" id="test">Test connection</button>
    <button type="button" id="clear-cache">Clear cache</button>
    <button type="button" id="clear-history">Clear history</button>
    <button type="button" id="export">Export history</button>
  </div>
</form>`;

export class SettingsForm extends HTMLElement {
  private root!: ShadowRoot;

  connectedCallback(): void {
    if (this.shadowRoot) return;
    this.root = this.attachShadow({ mode: 'open' });
    adoptStyles(this.root, CSS);
    this.root.innerHTML = MARKUP;

    this.q<HTMLButtonElement>('#reveal').addEventListener('click', () => {
      const key = this.q<HTMLInputElement>('#key');
      key.type = key.type === 'password' ? 'text' : 'password';
    });
    this.q<HTMLFormElement>('form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.dispatchEvent(
        new CustomEvent<SettingsFormValue>('save', {
          detail: this.collect(),
          bubbles: true,
          composed: true,
        }),
      );
    });
    this.relay('#test', 'test-connection');
    this.relay('#clear-cache', 'clear-cache');
    this.relay('#clear-history', 'clear-history');
    this.relay('#export', 'export-history');
  }

  private q<T extends Element>(sel: string): T {
    const el = this.root.querySelector<T>(sel);
    if (!el) throw new Error(`settings-form: missing ${sel}`);
    return el;
  }

  private relay(sel: string, event: string): void {
    this.q<HTMLButtonElement>(sel).addEventListener('click', () => {
      this.dispatchEvent(new CustomEvent(event, { bubbles: true, composed: true }));
    });
  }

  private collect(): SettingsFormValue {
    return {
      apiKey: this.q<HTMLInputElement>('#key').value,
      targetLang: this.q<HTMLSelectElement>('#target').value,
      promptTemplate: this.q<HTMLTextAreaElement>('#tpl').value,
      cacheEnabled: this.q<HTMLInputElement>('#cache').checked,
      saveHistory: this.q<HTMLInputElement>('#history').checked,
    };
  }

  set value(v: SettingsFormValue) {
    this.q<HTMLInputElement>('#key').value = v.apiKey;
    this.q<HTMLSelectElement>('#target').value = v.targetLang;
    this.q<HTMLTextAreaElement>('#tpl').value = v.promptTemplate;
    this.q<HTMLInputElement>('#cache').checked = v.cacheEnabled;
    this.q<HTMLInputElement>('#history').checked = v.saveHistory;
  }
}

if (!customElements.get('settings-form')) customElements.define('settings-form', SettingsForm);
```

Note: the `value` setter requires the form connected (shadow built); the options page appends the element before hydrating. Run → PASS. Commit `feat(shared-ui): <settings-form>`.

### Task F — Full-suite gate

- [ ] **F1: Coverage + a11y + typecheck + lint**

Run: `pnpm --filter @ai-dict/shared-ui test --coverage` → all PASS, coverage ≥ 75%, axe violations empty for each component.
Run: `pnpm --filter @ai-dict/shared-ui typecheck` + `pnpm lint` → clean (core imported as **types only**; no inline `<style>`).

```bash
git add packages/shared-ui
git commit -m "test(shared-ui): coverage + a11y gate"
```

## Verify (correctness)

- Run: `pnpm --filter @ai-dict/shared-ui test --coverage` (vitest + happy-dom + @testing-library/dom + axe-core) → pass, ≥ 75%.

## Validate (sanity / no scope drift)

- `pnpm --filter @ai-dict/shared-ui typecheck` + `pnpm lint` clean (type-only core import).
- `git diff --stat` only `packages/shared-ui/**`.
- No business logic (no fetch, no storage, no workflow) inside components.
- No inline `<style>` blocks present.

## Self-audit (run BEFORE sign-off)

- [ ] D1–D8 met with evidence?
- [ ] Tag names + event names match §5.3 / README contracts exactly?
- [ ] Open Shadow DOM (not closed) confirmed?
- [ ] a11y (axe-core) clean across states?
- [ ] adoptedStyleSheets only — CSP-safe?
- [ ] core imported as types only?
- [ ] Only `packages/shared-ui/**` changed?

## Sign-off

Edit YAML: `status: DONE`, `done_at: <UTC>`. Commit. Update README checkbox `03`.
