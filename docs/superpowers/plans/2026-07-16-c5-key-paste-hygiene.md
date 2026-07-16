# C5 Key Paste Hygiene Implementation Plan

> **For agentic workers:** implement task-by-task, TDD (red → green → commit) per task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** pasted API keys are cleaned (trimmed, de-quoted) before they are ever stored, and both
key-collecting surfaces — the onboarding screen's single Gemini field and the settings form's
per-provider field — show a live, non-blocking inline hint when a pasted key's recognized prefix
belongs to a different provider, or looks too short/malformed to be a real key. Nothing is ever
hard-blocked by a hint; the only thing that can still stop a save is the pre-existing empty-key
check. The key itself never appears in a hint's copy (S1).

**Architecture:** entirely in the portable core (`packages/app/src/**`, `c3-1`) — one new
dependency-free domain module (`packages/app/src/domain/key-hygiene.ts`, `rule-domain-purity`),
one barrel-export line, and small, self-contained edits inside the two existing UI web components
that already own their key field's markup/behavior. **No wire message, no router case, no schema
change, no new manifest permission, no port.** Full design rationale:
`docs/superpowers/specs/2026-07-16-c5-key-paste-hygiene-design.md`.

**Tech Stack:** TypeScript, Vitest + happy-dom (unit + UI component tests), Playwright (e2e).

## Global Constraints

- Implementer: dispatch each implementation/fix task to the `hunter` subagent — never a generic
  implementer.
- `key-hygiene.ts` stays dependency-free: only `import type { Provider } from './types';` — no
  `chrome.*`, no DOM, no `ui/`/`app/`/`wire.ts` imports (`rule-domain-purity`,
  `.claude/rules/domain-purity.md`).
- **Hints only, never hard blocks** (roadmap C5 scope fence, held verbatim). No task in this plan
  adds a new branch that can prevent `onboarding-view.ts`'s `submit()` or `settings-form.ts`'s
  `save` dispatch from firing. The existing empty-key check in `submit()` is the only thing that
  still blocks a save, and it is untouched.
- **The key never appears in any log or message (S1).** Every hint string this plan adds
  interpolates only a provider label (`'Gemini'` / `'OpenAI'` / `'Anthropic (Claude)'`) — never the
  raw or normalized key value. Task 1's tests include an explicit regression guard for this.
- **Pure client-side string checks.** No network call, no `chrome.*` call, anywhere in
  `key-hygiene.ts`.
- UI additions read only `--ad-*`/`--adp-*` design tokens (no hard-coded colors) — `#key-hint` is
  styled with `var(--ad-accent)` / `var(--ad-accent-soft)` / `var(--ad-ink)`, matching the existing
  `#key-help`/`.env-notice` rules' own token usage in each file. No transition is added to
  `#key-hint` (it only ever toggles the `hidden` attribute), so no `prefers-reduced-motion` guard
  is needed for it — consistent with `#key-help`/`#status` in both files, which also carry none.
- `bun run lint` and `bun run format:check` clean before every commit.
- Every task must leave `cd packages/app && bun run typecheck` green.
- Commit subject convention for every task in this plan: `feat: key paste hygiene — <task summary> (C5)`.
- **e2e build note (Task 4):** build with `GEMINI_API_KEY` unset. A build-time-baked key flips
  `packages/extension-chrome/src/options.ts:211`'s route straight to the settings screen, skipping
  onboarding entirely, so the flows this plan's e2e spec drives never render otherwise — the same
  live flake already recorded in `docs/superpowers/campaign/2026-07-16-run-the-roadmap.md:36`
  ("Shell `GEMINI_API_KEY` bakes env-key builds that break no-key e2e tests").

---

### Task 1: `key-hygiene.ts` — domain module (normalize / classifyPrefix / hintFor)

**Files:**

- Create: `packages/app/src/domain/key-hygiene.ts`
- Create: `packages/app/test/key-hygiene.test.ts`
- Modify: `packages/app/src/index.ts`

**Interfaces:**

```ts
export type KeyPrefixClass = Provider | 'unknown';
export interface KeyHint {
  tone: 'warning';
  message: string;
}
export function normalize(raw: string): string;
export function classifyPrefix(key: string): KeyPrefixClass;
export function hintFor(targetProvider: Provider, normalizedKey: string): KeyHint | null;
```

- [ ] **Step 1: Write the failing tests.** Create `packages/app/test/key-hygiene.test.ts`, modeled
      on `packages/app/test/pii.test.ts`'s exhaustive-table style:

```ts
import { describe, it, expect } from 'vitest';
import { normalize, classifyPrefix, hintFor } from '../src/domain/key-hygiene';

describe('normalize', () => {
  it('trims plain surrounding whitespace', () => {
    expect(normalize('  AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ01234  ')).toBe(
      'AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ01234',
    );
  });
  it('trims a trailing newline from a copy-paste', () => {
    expect(normalize('AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ01234\n')).toBe(
      'AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ01234',
    );
  });
  it('strips one layer of straight double quotes', () => {
    expect(normalize('"AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ01234"')).toBe(
      'AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ01234',
    );
  });
  it('strips one layer of straight single quotes', () => {
    expect(normalize("'AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ01234'")).toBe(
      'AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ01234',
    );
  });
  it('strips one layer of smart double quotes', () => {
    expect(normalize('“AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ01234”')).toBe(
      'AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ01234',
    );
  });
  it('strips one layer of smart single quotes', () => {
    expect(normalize('‘AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ01234’')).toBe(
      'AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ01234',
    );
  });
  it('strips wrapping quotes AND re-trims inner whitespace', () => {
    expect(normalize('  "  AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ01234  "  ')).toBe(
      'AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ01234',
    );
  });
  it('leaves an unquoted key untouched', () => {
    expect(normalize('AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ01234')).toBe(
      'AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ01234',
    );
  });
  it('leaves a key with a non-wrapping internal quote untouched', () => {
    expect(normalize('AIza"mid"key')).toBe('AIza"mid"key');
  });
  it('returns an empty string unchanged', () => {
    expect(normalize('')).toBe('');
  });
});

describe('classifyPrefix', () => {
  it('classifies AIza… as gemini', () => {
    expect(classifyPrefix('AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ01234')).toBe('gemini');
  });
  it('classifies sk-ant-… as anthropic', () => {
    expect(classifyPrefix('sk-ant-api03-abcdefghijklmnopqrstuvwxyz')).toBe('anthropic');
  });
  it('classifies sk-… (no -ant-) as openai', () => {
    expect(classifyPrefix('sk-ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefgh')).toBe('openai');
  });
  it('never misclassifies an anthropic key as openai (ordering regression guard)', () => {
    expect(classifyPrefix('sk-ant-zzzzzzzzzzzzzzzzzzzzzzzz')).not.toBe('openai');
  });
  it('classifies unrecognized text as unknown', () => {
    expect(classifyPrefix('not-a-real-key-at-all')).toBe('unknown');
  });
  it('classifies an empty string as unknown', () => {
    expect(classifyPrefix('')).toBe('unknown');
  });
});

describe('hintFor', () => {
  const GEMINI_KEY = 'AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ01234'; // 39 chars, realistic length
  const OPENAI_KEY = 'sk-ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnop'; // >20 chars
  const ANTHROPIC_KEY = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789'; // >20 chars

  it('returns null for a matching prefix at a plausible length', () => {
    expect(hintFor('gemini', GEMINI_KEY)).toBeNull();
    expect(hintFor('openai', OPENAI_KEY)).toBeNull();
    expect(hintFor('anthropic', ANTHROPIC_KEY)).toBeNull();
  });
  it("returns null for an empty key (that is the caller's own required-field check)", () => {
    expect(hintFor('gemini', '')).toBeNull();
  });

  const MISMATCH_PAIRS: Array<[import('../src/domain/types').Provider, string, string]> = [
    ['openai', GEMINI_KEY, 'Gemini'],
    ['anthropic', GEMINI_KEY, 'Gemini'],
    ['gemini', OPENAI_KEY, 'OpenAI'],
    ['anthropic', OPENAI_KEY, 'OpenAI'],
    ['gemini', ANTHROPIC_KEY, 'Anthropic (Claude)'],
    ['openai', ANTHROPIC_KEY, 'Anthropic (Claude)'],
  ];
  it.each(MISMATCH_PAIRS)(
    'flags a recognized-but-wrong-provider key (target=%s)',
    (target, key, expectLabel) => {
      const hint = hintFor(target, key);
      expect(hint).not.toBeNull();
      expect(hint!.tone).toBe('warning');
      expect(hint!.message).toContain(expectLabel);
      expect(hint!.message).not.toContain(key); // S1: never echo the key itself
    },
  );

  it('flags an unrecognized, implausibly short key as malformed', () => {
    const hint = hintFor('gemini', 'abc123');
    expect(hint).not.toBeNull();
    expect(hint!.message).toMatch(/typical Gemini API key/);
    expect(hint!.message).not.toContain('abc123');
  });
  it('does not flag an unrecognized but plausible-length key', () => {
    expect(hintFor('gemini', 'x'.repeat(30))).toBeNull();
  });
  it('flags a matching prefix that is still implausibly short', () => {
    const hint = hintFor('gemini', 'AIza');
    expect(hint).not.toBeNull();
    expect(hint!.message).toMatch(/typical Gemini API key/);
  });
  it('flags a key containing internal whitespace as malformed regardless of length', () => {
    const hint = hintFor('gemini', 'AIzaSy ABCDEFGHIJKLMNOPQRSTUVWXYZ01234');
    expect(hint).not.toBeNull();
    expect(hint!.message).toMatch(/typical Gemini API key/);
  });
});
```

Run: `cd packages/app && bunx vitest run test/key-hygiene.test.ts`
Expected: every test fails — `Cannot find module '../src/domain/key-hygiene'`.

- [ ] **Step 2: Implement.** Create `packages/app/src/domain/key-hygiene.ts`:

```ts
import type { Provider } from './types';

/** Which known provider's key shape a prefix matches, or 'unknown' if it matches none. */
export type KeyPrefixClass = Provider | 'unknown';

/** A non-blocking hint to show inline next to a key field (roadmap C5 scope fence: hints only). */
export interface KeyHint {
  tone: 'warning';
  message: string;
}

const QUOTE_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['"', '"'],
  ["'", "'"],
  ['“', '”'], // “ ”
  ['‘', '’'], // ‘ ’
];

/**
 * Clean up paste artifacts before a key is stored: trim surrounding whitespace (incl. the
 * trailing newline a copy from a terminal or key-issuing page commonly carries), then strip ONE
 * layer of matching wrapping quotes (straight or "smart" — a paste from a chat app or notes file
 * commonly adds these), re-trimming afterward for `" AIza… "`-shaped input. Only one layer is
 * stripped, so a key that legitimately contains a quote character elsewhere is untouched.
 */
export function normalize(raw: string): string {
  const trimmed = raw.trim();
  for (const [open, close] of QUOTE_PAIRS) {
    if (trimmed.length >= 2 && trimmed.startsWith(open) && trimmed.endsWith(close)) {
      return trimmed.slice(1, -1).trim();
    }
  }
  return trimmed;
}

/**
 * Classify an (already-normalized) key by its known prefix. `sk-ant-` is checked before the
 * shorter `sk-` so an Anthropic key is never misclassified as OpenAI's.
 */
export function classifyPrefix(key: string): KeyPrefixClass {
  if (key.startsWith('AIza')) return 'gemini';
  if (key.startsWith('sk-ant-')) return 'anthropic';
  if (key.startsWith('sk-')) return 'openai';
  return 'unknown';
}

const PROVIDER_LABEL: Record<Provider, string> = {
  gemini: 'Gemini',
  openai: 'OpenAI',
  anthropic: 'Anthropic (Claude)',
};

// A real key from any of the three providers is comfortably longer than this — Gemini's AIza…
// keys, the shortest of the three shapes this product talks to, run ~39 chars. Anything shorter
// reads as a truncated paste or placeholder text, not a real key from any provider.
const MIN_PLAUSIBLE_LENGTH = 20;

function looksMalformed(key: string): boolean {
  return key.length < MIN_PLAUSIBLE_LENGTH || /\s/.test(key);
}

/**
 * Heuristic hint for `normalizedKey` pasted into `targetProvider`'s field. `null` when nothing
 * looks off, including for an empty key (emptiness is the caller's own required-field validation,
 * not this module's concern). A recognized OTHER provider's prefix is reported first (most
 * specific, most actionable); otherwise a generic too-short/has-whitespace check applies
 * regardless of prefix match, since a matching prefix alone doesn't guarantee a well-formed key.
 * Never echoes `normalizedKey` in the message (S1) — only provider labels appear in copy.
 */
export function hintFor(targetProvider: Provider, normalizedKey: string): KeyHint | null {
  if (normalizedKey.length === 0) return null;
  const cls = classifyPrefix(normalizedKey);
  if (cls !== 'unknown' && cls !== targetProvider) {
    return {
      tone: 'warning',
      message: `This looks like a ${PROVIDER_LABEL[cls]} key, not a ${PROVIDER_LABEL[targetProvider]} key.`,
    };
  }
  if (looksMalformed(normalizedKey)) {
    return {
      tone: 'warning',
      message: `This doesn't look like a typical ${PROVIDER_LABEL[targetProvider]} API key.`,
    };
  }
  return null;
}
```

Add the barrel export to `packages/app/src/index.ts`, right after the existing
`export * from './domain/pii';` line:

```ts
export * from './domain/pii';
export * from './domain/key-hygiene';
```

Run: `cd packages/app && bunx vitest run test/key-hygiene.test.ts`
Expected: all tests pass.

- [ ] **Step 3: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd .. && bun run lint && bun run format:check
```

Commit:

```
git add packages/app/src/domain/key-hygiene.ts packages/app/test/key-hygiene.test.ts packages/app/src/index.ts
git commit -m "feat: key paste hygiene — add key-hygiene domain module (C5)" \
  -m $'Roadmap-Card: c5-key-paste-hygiene\nPlan-Task: 1/4'
```

---

### Task 2: Onboarding — hint UI + normalize on activate

**Files:**

- Modify: `packages/app/src/ui/onboarding-view.ts`
- Modify: `packages/app/test/ui/onboarding-view.test.ts`

- [ ] **Step 1: Write the failing tests.** Append to `packages/app/test/ui/onboarding-view.test.ts`
      inside the existing `describe('<onboarding-view>', ...)` block, right after the existing
      `'blocks activation with an error when the key is empty (no save emitted)'` test
      (`onboarding-view.test.ts:77-90`):

```ts
it('shows no hint for a realistic, correctly-prefixed key (C5)', () => {
  const el = mount();
  const r = el.shadowRoot!;
  const key = r.querySelector<HTMLInputElement>('#key')!;
  key.value = 'AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ01234';
  key.dispatchEvent(new Event('input'));
  const hint = r.querySelector<HTMLElement>('#key-hint')!;
  expect(hint.hidden).toBe(true);
});

it("shows a mismatch hint when a pasted key looks like a different provider's (C5)", () => {
  const el = mount();
  const r = el.shadowRoot!;
  const key = r.querySelector<HTMLInputElement>('#key')!;
  key.value = 'sk-ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnop';
  key.dispatchEvent(new Event('input'));
  const hint = r.querySelector<HTMLElement>('#key-hint')!;
  expect(hint.hidden).toBe(false);
  expect(hint.textContent).toContain('OpenAI');
  expect(hint.textContent).toContain('Gemini');
});

it('shows a malformed hint for an implausibly short pasted key (C5)', () => {
  const el = mount();
  const r = el.shadowRoot!;
  const key = r.querySelector<HTMLInputElement>('#key')!;
  key.value = 'abc123';
  key.dispatchEvent(new Event('input'));
  const hint = r.querySelector<HTMLElement>('#key-hint')!;
  expect(hint.hidden).toBe(false);
  expect(hint.textContent).toMatch(/typical Gemini API key/);
});

it('hides the hint again once the field is cleared (C5)', () => {
  const el = mount();
  const r = el.shadowRoot!;
  const key = r.querySelector<HTMLInputElement>('#key')!;
  key.value = 'sk-ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnop';
  key.dispatchEvent(new Event('input'));
  key.value = '';
  key.dispatchEvent(new Event('input'));
  expect(r.querySelector<HTMLElement>('#key-hint')!.hidden).toBe(true);
});
```

Extend the existing `'emits "save" with the trimmed key and chosen language on activate'` test
(`onboarding-view.test.ts:62-75`) to cover a quote-wrapped, newline-padded paste — replace its
input line and expectation:

```ts
r.querySelector<HTMLInputElement>('#key')!.value = '  "AIza-real"\n';
// … (unchanged: set #target, wire the save listener, dispatch submit) …
expect(captured).toEqual({ apiKey: 'AIza-real', targetLang: 'en' });
```

Run: `cd packages/app && bunx vitest run test/ui/onboarding-view.test.ts`
Expected: the 4 new tests fail (`#key-hint` does not exist / stays `null`); the extended existing
test fails (`captured.apiKey` still carries the raw quoted/padded string).

- [ ] **Step 2: Implement.** In `packages/app/src/ui/onboarding-view.ts`:
  1. Add the import: `import { normalize, hintFor } from '../domain/key-hygiene';`
  2. Insert the hint paragraph into `MARKUP`, right after the existing `#key-help` line:

```html
<p id="key-help">Stored locally on this device only.</p>
<p id="key-hint" aria-live="polite" hidden></p>
```

3. Add one CSS rule to the template literal `CSS`, right after the existing `#key-help{...}`
   rule:

```css
#key-hint {
  margin: 8px 0 0;
  padding: 8px 11px;
  border-radius: 8px;
  border-left: 3px solid var(--ad-accent);
  background: var(--ad-accent-soft);
  color: var(--ad-ink);
  font-size: var(--adp-text-xs);
  font-weight: var(--adp-weight-semi);
}
```

4. Add the new private method, right after `refreshProgress()`:

```ts
/** C5: live, non-blocking hint when a pasted key looks like a different provider's or is
 * implausibly short/malformed — never blocks activation (roadmap C5 scope fence). */
private refreshKeyHint(): void {
  const hint = hintFor('gemini', normalize(this.q<HTMLInputElement>('#key').value));
  const el = this.q<HTMLElement>('#key-hint');
  el.textContent = hint?.message ?? '';
  el.hidden = hint === null;
}
```

5. Extend the existing `input` listener in `connectedCallback`:

```ts
key.addEventListener('input', () => {
  this.refreshProgress();
  this.refreshKeyHint();
});
```

6. Call `this.refreshKeyHint();` right after the existing `this.refreshProgress();` call at the
   end of `connectedCallback`, and again right after the existing `this.refreshProgress();` call
   inside the `value` setter.
7. Update `submit()` to use `normalize()` instead of the bare `.trim()`:

```ts
private submit(): void {
  const apiKey = normalize(this.q<HTMLInputElement>('#key').value);
  if (apiKey.length === 0) {
    this.setStatus('Paste your Gemini API key to activate the extension.', 'error');
    this.q<HTMLInputElement>('#key').focus();
    return;
  }
  this.dispatchEvent(
    new CustomEvent<OnboardingValue>('save', {
      detail: { apiKey, targetLang: this.q<HTMLSelectElement>('#target').value },
      bubbles: true,
      composed: true,
    }),
  );
}
```

Run: `cd packages/app && bunx vitest run test/ui/onboarding-view.test.ts`
Expected: all tests pass (existing + 4 new + the extended save test).

- [ ] **Step 3: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd .. && bun run lint && bun run format:check
```

Commit:

```
git add packages/app/src/ui/onboarding-view.ts packages/app/test/ui/onboarding-view.test.ts
git commit -m "feat: key paste hygiene — hint + normalize the onboarding key field (C5)" \
  -m $'Roadmap-Card: c5-key-paste-hygiene\nPlan-Task: 2/4'
```

---

### Task 3: Settings form — hint UI + normalize per provider

**Files:**

- Modify: `packages/app/src/ui/settings-form.ts`
- Modify: `packages/app/test/ui/settings-form.test.ts`

- [ ] **Step 1: Write the failing tests.** Append a new `describe` block to
      `packages/app/test/ui/settings-form.test.ts`, right after the existing
      `describe('<settings-form> provider selection', ...)` block's closing `});`:

```ts
describe('<settings-form> key paste hygiene (C5)', () => {
  function keyInput(el: SettingsForm): HTMLInputElement {
    return el.shadowRoot!.querySelector<HTMLInputElement>('#key')!;
  }
  function hint(el: SettingsForm): HTMLElement {
    return el.shadowRoot!.querySelector<HTMLElement>('#key-hint')!;
  }
  function fire(el: SettingsForm, value: string): void {
    const k = keyInput(el);
    k.value = value;
    k.dispatchEvent(new Event('input'));
  }

  it('shows no hint for a realistic, correctly-prefixed Gemini key', () => {
    const el = mountForm();
    fire(el, 'AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ01234');
    expect(hint(el).hidden).toBe(true);
  });

  it('shows a mismatch hint when an Anthropic-shaped key is typed while Gemini is selected', () => {
    const el = mountForm();
    fire(el, 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789');
    expect(hint(el).hidden).toBe(false);
    expect(hint(el).textContent).toContain('Anthropic');
    expect(hint(el).textContent).toContain('Gemini');
  });

  it('re-evaluates the hint against the now-visible provider on switch', () => {
    const el = mountForm();
    // Gemini field gets an OpenAI-shaped key — mismatch hint shows.
    fire(el, 'sk-ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnop');
    expect(hint(el).hidden).toBe(false);
    // Switch to OpenAI: the (empty) OpenAI slot has no key yet — hint clears.
    const provider = el.shadowRoot!.querySelector<HTMLSelectElement>('#provider')!;
    provider.value = 'openai';
    provider.dispatchEvent(new Event('change'));
    expect(hint(el).hidden).toBe(true);
    // Switch back to Gemini: the stashed mismatched key re-shows its hint.
    provider.value = 'gemini';
    provider.dispatchEvent(new Event('change'));
    expect(hint(el).hidden).toBe(false);
  });

  it('never shows a hint while the Gemini field is env-locked, even for a bad stashed key', () => {
    const el = mountForm();
    el.keyFromEnv = true;
    fire(el, 'sk-ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnop'); // no-op: field is locked/read-only
    expect(hint(el).hidden).toBe(true);
  });

  it('emits a normalized apiKey when the pasted value has padding/quotes', () => {
    const el = mountForm();
    el.value = {
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
    };
    let captured: SettingsFormValue | undefined;
    el.addEventListener('save', (e) => {
      captured = (e as CustomEvent<SettingsFormValue>).detail;
    });
    keyInput(el).value = '  "AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ01234"  ';
    el.shadowRoot!.querySelector('form')!.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    expect(captured!.apiKey).toBe('AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ01234');
  });

  it('normalizes a stashed key across a provider switch, not just on same-provider save', () => {
    const el = mountForm();
    fire(el, '  AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ01234  ');
    const provider = el.shadowRoot!.querySelector<HTMLSelectElement>('#provider')!;
    provider.value = 'openai'; // triggers commitKeyField() on the Gemini slot before switching
    provider.dispatchEvent(new Event('change'));
    provider.value = 'gemini';
    provider.dispatchEvent(new Event('change'));
    expect(keyInput(el).value).toBe('AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ01234');
  });
});
```

Run: `cd packages/app && bunx vitest run test/ui/settings-form.test.ts`
Expected: the 6 new tests fail — `#key-hint` doesn't exist, and the padded/quoted key round-trips
unnormalized.

- [ ] **Step 2: Implement.** In `packages/app/src/ui/settings-form.ts`:
  1. Add the import: `import { normalize, hintFor } from '../domain/key-hygiene';`
  2. Insert the hint paragraph into `MARKUP`, right after the existing `#key-help` line and before
     `#env-notice`:

```html
<p id="key-help">Stored locally on this device only.</p>
<p id="key-hint" aria-live="polite" hidden></p>
<p id="env-notice" class="env-notice" hidden></p>
```

3. Add one CSS rule to `CSS`, right after the existing `#key-help,#tpl-help{...}` rule:

```css
#key-hint {
  margin: 7px 0 0;
  padding: 8px 12px;
  border-radius: 6px;
  border-left: 3px solid var(--ad-accent);
  background: var(--ad-accent-soft);
  color: var(--ad-ink);
  font-size: var(--adp-text-xs);
  font-weight: var(--adp-weight-semi);
}
```

4. Add the new private method, right after `syncKeyField()`:

```ts
/** C5: live, non-blocking hint when the visible provider's key looks like a different
 * provider's or is implausibly short/malformed — never blocks Save (roadmap C5 scope fence).
 * Suppressed entirely while the field is env-locked (nothing the user typed to hint about). */
private refreshKeyHint(): void {
  const el = this.q<HTMLElement>('#key-hint');
  if (this.isKeyLocked()) {
    el.hidden = true;
    return;
  }
  const hint = hintFor(this._provider, normalize(this.q<HTMLInputElement>('#key').value));
  el.textContent = hint?.message ?? '';
  el.hidden = hint === null;
}
```

5. Add `this.refreshKeyHint();` as the **last line** of `syncKeyField()` — every existing call
   site that re-renders the key row (provider-change listener, `value` setter hydration,
   `connectedCallback`'s own `this.syncKeyField();` call) picks up the hint refresh for free, no
   new call sites needed there.
6. Add a new `input` listener next to the existing key `focus`/`blur` listeners:

```ts
key.addEventListener('input', () => this.refreshKeyHint());
```

7. Update `commitKeyField()` to normalize on stash:

```ts
private commitKeyField(): void {
  if (!this.isKeyLocked()) this._keys[this._provider] = normalize(this.q<HTMLInputElement>('#key').value);
}
```

Run: `cd packages/app && bunx vitest run test/ui/settings-form.test.ts`
Expected: all tests pass (existing + 6 new).

- [ ] **Step 3: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd .. && bun run lint && bun run format:check
```

Commit:

```
git add packages/app/src/ui/settings-form.ts packages/app/test/ui/settings-form.test.ts
git commit -m "feat: key paste hygiene — hint + normalize the settings key field (C5)" \
  -m $'Roadmap-Card: c5-key-paste-hygiene\nPlan-Task: 3/4'
```

---

### Task 4: e2e functional test

**Files:**

- Create: `packages/extension-chrome/e2e/c5-key-hygiene.spec.ts`

- [ ] **Step 1: Write the test.** Model it on `packages/extension-chrome/e2e/onboarding.spec.ts`'s
      existing first test (`onboarding.spec.ts:7-31`), reusing `storageDump` from `helpers.ts`
      rather than an inline `page.evaluate`:

```ts
import { test, expect } from './fixtures';
import { storageDump } from './helpers';

test.describe('C5 key paste hygiene', () => {
  test('a padded, quote-wrapped key pasted in onboarding is stored fully cleaned', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.waitForSelector('onboarding-view');

    await page
      .locator('onboarding-view #key')
      .fill('  "AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ01234"  \n');
    await page.locator('onboarding-view #activate').click();

    await page.waitForSelector('settings-form');
    const dump = await storageDump(page);
    const settings = dump['settings'] as { apiKey: string };
    expect(settings.apiKey).toBe('AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ01234');
  });

  test('an OpenAI-shaped key pasted into the onboarding Gemini field shows a live mismatch hint', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.waitForSelector('onboarding-view');

    await page
      .locator('onboarding-view #key')
      .fill('sk-ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnop');

    const hint = page.locator('onboarding-view #key-hint');
    await expect(hint).toBeVisible();
    await expect(hint).toContainText('OpenAI');
    await expect(hint).toContainText('Gemini');

    // The hint never blocks activation (roadmap C5 scope fence).
    await page.locator('onboarding-view #activate').click();
    await page.waitForSelector('settings-form');
  });
});
```

- [ ] **Step 2: Build and run.** With `GEMINI_API_KEY` unset in the shell (see the Global
      Constraints e2e build note — a baked key skips onboarding entirely):

```
unset GEMINI_API_KEY
bun run build:chrome
cd packages/extension-chrome && bunx playwright test c5-key-hygiene
```

Expected: 2 passed.

- [ ] **Step 3: Commit** — gate, then commit:

```
bun run lint && bun run format:check
```

Commit:

```
git add packages/extension-chrome/e2e/c5-key-hygiene.spec.ts
git commit -m "feat: key paste hygiene — add e2e coverage for paste cleanup + live hint (C5)" \
  -m $'Roadmap-Card: c5-key-paste-hygiene\nPlan-Task: 4/4'
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
unset GEMINI_API_KEY
bun run build:chrome
cd packages/extension-chrome && bunx playwright test onboarding c5-key-hygiene
```

Expected: typecheck clean on both packages; the full Vitest suite green (including the new
`key-hygiene.test.ts` table tests and the extended `onboarding-view.test.ts`/`settings-form.test.ts`
suites); lint/format clean; the Chrome build succeeds with no baked key; both the pre-existing
`onboarding.spec.ts` suite (regression guard — the plain activation flow must be unaffected) and
the new `c5-key-hygiene.spec.ts` suite pass.

**PR checklist (per repo convention):**

- Regular merge only — **no squash merge** (owner ruling, `CLAUDE.md`).
- PR body includes a written **"Testing performed"** section (owner ruling 2026-07-16 — no
  screenshots/video for this PR; see the design spec §6) naming: the `key-hygiene.test.ts` table
  test count, the extended onboarding/settings UI test counts, the `c5-key-hygiene.spec.ts` e2e
  scenario names, and confirmation that lint/format/typecheck/full-suite/build all passed.
- Jira link: `https://prospa.atlassian.net/browse/{{JIRA_TICKET}}` (ticket id = branch name
  suffix, per `.claude/rules/git-conventions.md`).
