# C4 Any-Provider Onboarding Implementation Plan

> **For agentic workers:** implement task-by-task, TDD (red → green → commit) per task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Precondition — read before Task 1:** this plan is written against the **post-C2** shape of
`onboarding-view.ts`/`options.ts` (busy state, `#save-anyway`, persist→test→rollback-or-proceed),
per `docs/superpowers/plans/2026-07-16-c2-verified-activation.md`. If C2 has not merged yet, **stop
and escalate re-sequencing** rather than re-deriving its persist/test/rollback mechanism inline
here — see the design spec §0.

**Goal:** the onboarding welcome screen offers a 3-way provider picker (Gemini default/free ·
OpenAI · Anthropic/Claude), each with its own get-key link, placeholder, and step copy; activating
persists the pasted key into the **correct** settings field (`apiKey` / `openaiApiKey` /
`anthropicApiKey`) and sets `settings.provider`, so C2's existing `connection.test` verifies
whichever provider was actually chosen.

**Architecture:** the entire card lives in two files — the portable onboarding UI
(`packages/app/src/ui/onboarding-view.ts`, `c3-1`) and the Chrome composition root
(`packages/extension-chrome/src/options.ts`) that already owns onboarding's persistence (and, after
C2, its persist→test→rollback sequencing). **Zero changes** to `packages/app/src/wire.ts`,
`packages/app/src/app/router.ts`, `packages/app/src/domain/types.ts`, or
`packages/app/src/ui/settings-form.ts`. Full design rationale, including why a segmented control was
chosen over reusing settings-form's `<select>`, and the exact C2/C5 composition points:
`docs/superpowers/specs/2026-07-16-c4-any-provider-onboarding-design.md`.

**Tech Stack:** TypeScript, Vitest + happy-dom (unit), Playwright (e2e).

## Global Constraints

- Implementer: dispatch each implementation/fix task to the `hunter` subagent — never a generic
  implementer.
- **Do not touch `packages/app/src/wire.ts`, `packages/app/src/app/router.ts`,
  `packages/app/src/domain/types.ts`, or `packages/app/src/ui/settings-form.ts`.** Every fact this
  card needs from those files (`Provider`, `hasKeyFor`, `configuredProvidersFor`,
  `createLookupClientSelector`'s `getProvider`) already exists and is already correct — see design
  spec §1/§2.4. If a task in this plan seems to need a change there, stop; that means an assumption
  broke and the plan needs re-grounding, not an ad hoc edit.
- **One key activates per submission** — `applyProviderKey` (Task 2) must write exactly one of
  `apiKey`/`openaiApiKey`/`anthropicApiKey`, never more than one. Configuring a second provider is
  still exclusively a settings-page action.
- **Gemini stays the default and the only "Free"-badged option** — `_provider` initializes to
  `'gemini'` everywhere it is seeded (the view's class field, `options.ts`'s seeded `value`).
- **No product-promise change** — the hero-copy edit (Task 1) narrates the manifest's existing
  three-provider promise; it does not add a new one.
- S1: the pasted key is written directly to `chrome.storage.local` by the options page (a trusted
  context, unchanged from C2) and never appears on a `chrome.runtime` message, in a log, or in any
  status/error copy — every new string interpolates only a provider _label_, never key material.
- UI additions read only `--ad-*`/`--adp-*` design tokens (no hard-coded colors) — the segmented
  control reuses the exact token vocabulary settings-form's own `.seg` (Theme control) already uses.
- `bun run lint` and `bun run format:check` clean before every commit.
- Every task must leave `cd packages/app && bun run typecheck` (and, from Task 2 on,
  `cd packages/extension-chrome && bun run typecheck`) green.
- The e2e build must clear any ambient `GEMINI_API_KEY` (`GEMINI_API_KEY= bun run build:chrome`) —
  a baked-in env key skips `mountOnboarding` entirely (`options.ts`'s `KEY_FROM_ENV`), silently
  disabling every onboarding e2e in Task 3 (the C10 flake, `docs/ROADMAP.md` §4 C10).
- Commit subject convention for every task in this plan:
  `feat: any-provider onboarding — <task summary> (C4)`.

---

### Task 1: `onboarding-view.ts` — provider picker, per-provider copy, provider-aware submit/value

**Files:**

- Modify: `packages/app/src/ui/onboarding-view.ts`
- Modify: `packages/app/test/ui/onboarding-view.test.ts`

**Interfaces:**

```ts
export interface OnboardingValue {
  provider: Provider;
  apiKey: string;
  targetLang: string;
}
```

- [ ] **Step 1a: Fix three pre-existing tests for the widened `OnboardingValue` shape.** Widening
      `OnboardingValue` to require `provider` breaks three tests already in
      `packages/app/test/ui/onboarding-view.test.ts` that construct/compare the shape without it —
      not new C4 behavior, just a mechanical shape fix so the suite still compiles and the
      unrelated behavior they actually test (trim+dispatch, hydrate, defer-until-connect) keeps
      passing. All three default to `'gemini'` since none of them touches the picker: - `'emits "save" with the trimmed key and chosen language on activate'`: change
      `expect(captured).toEqual({ apiKey: 'AIza-real', targetLang: 'en' });` to
      `expect(captured).toEqual({ provider: 'gemini', apiKey: 'AIza-real', targetLang: 'en' });`. - `'value setter hydrates the language select and key field'`: change
      `el.value = { apiKey: 'AIza-seed', targetLang: 'en' };` to
      `el.value = { provider: 'gemini', apiKey: 'AIza-seed', targetLang: 'en' };`. - `'value set before connect defers hydration until connectedCallback'`: change
      `el.value = { apiKey: '', targetLang: 'en' };` to
      `el.value = { provider: 'gemini', apiKey: '', targetLang: 'en' };`.

Run: `cd packages/app && bunx vitest run test/ui/onboarding-view.test.ts`
Expected (before Step 2's implementation lands): these three now fail to _type-check_ against the
still-old `OnboardingValue` interface declared in source — that is expected; Step 2 widens the
interface to match. If your toolchain runs Vitest without a separate type-check pass, these three
will fail at runtime instead (`captured`/`el.value` still lacks a `provider` field until Step 2), which
is the same signal.

- [ ] **Step 1b: Write the new failing tests.** Append to
      `packages/app/test/ui/onboarding-view.test.ts`, inside the existing top-level
      onboarding-view `describe` block, just before its closing `});` (after whatever C2's own tests left as the
      last test in the file):

```ts
it('defaults to Gemini pressed with a Free badge; OpenAI/Claude unpressed with no badge (C4)', () => {
  const r = mount().shadowRoot!;
  const gemini = r.querySelector<HTMLButtonElement>('#provider button[data-provider="gemini"]')!;
  const openai = r.querySelector<HTMLButtonElement>('#provider button[data-provider="openai"]')!;
  const claude = r.querySelector<HTMLButtonElement>('#provider button[data-provider="anthropic"]')!;
  expect(gemini.getAttribute('aria-pressed')).toBe('true');
  expect(gemini.querySelector('.free-badge')!.textContent).toBe('Free');
  expect(openai.getAttribute('aria-pressed')).toBe('false');
  expect(openai.querySelector('.free-badge')).toBeNull();
  expect(claude.getAttribute('aria-pressed')).toBe('false');
  expect(claude.querySelector('.free-badge')).toBeNull();
});

it('clicking the OpenAI segment retargets the get-key link, placeholder, aria-label, and step copy (C4)', () => {
  const el = mount();
  const r = el.shadowRoot!;
  r.querySelector<HTMLButtonElement>('#provider button[data-provider="openai"]')!.click();
  expect(
    r.querySelector('#provider button[data-provider="openai"]')!.getAttribute('aria-pressed'),
  ).toBe('true');
  expect(
    r.querySelector('#provider button[data-provider="gemini"]')!.getAttribute('aria-pressed'),
  ).toBe('false');
  const link = r.querySelector<HTMLAnchorElement>('#getkey')!;
  expect(link.href).toBe('https://platform.openai.com/api-keys');
  expect(r.querySelector('#getkey-label')!.textContent).toBe('Get an API key');
  const key = r.querySelector<HTMLInputElement>('#key')!;
  expect(key.placeholder).toBe('Paste your key (sk-…)');
  expect(key.getAttribute('aria-label')).toBe('OpenAI API key');
  expect(r.querySelector('#step-sub')!.textContent).toMatch(/OpenAI account/);
});

it("switching providers preserves each provider's own typed key (per-provider stash) (C4)", () => {
  const el = mount();
  const r = el.shadowRoot!;
  const key = r.querySelector<HTMLInputElement>('#key')!;
  key.value = 'AIza-gemini-key';
  key.dispatchEvent(new Event('input'));
  r.querySelector<HTMLButtonElement>('#provider button[data-provider="openai"]')!.click();
  expect(key.value).toBe('');
  key.value = 'sk-openai-key';
  key.dispatchEvent(new Event('input'));
  r.querySelector<HTMLButtonElement>('#provider button[data-provider="gemini"]')!.click();
  expect(key.value).toBe('AIza-gemini-key');
  r.querySelector<HTMLButtonElement>('#provider button[data-provider="openai"]')!.click();
  expect(key.value).toBe('sk-openai-key');
});

it('submit() with OpenAI selected dispatches "save" carrying provider: openai (C4)', () => {
  const el = mount();
  const r = el.shadowRoot!;
  r.querySelector<HTMLButtonElement>('#provider button[data-provider="openai"]')!.click();
  r.querySelector<HTMLInputElement>('#key')!.value = 'sk-real-key-123456789';
  let captured: OnboardingValue | undefined;
  el.addEventListener('save', (e) => {
    captured = (e as CustomEvent<OnboardingValue>).detail;
  });
  r.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  expect(captured).toEqual({
    provider: 'openai',
    apiKey: 'sk-real-key-123456789',
    targetLang: 'vi',
  });
});

it('submit() with an empty key under Claude shows the Claude-flavoured error copy (C4)', () => {
  const el = mount();
  const r = el.shadowRoot!;
  r.querySelector<HTMLButtonElement>('#provider button[data-provider="anthropic"]')!.click();
  r.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  expect(r.querySelector('#status')!.textContent).toBe(
    'Paste your Anthropic (Claude) API key to activate the extension.',
  );
});

it('setBusy(true) disables all three provider segments; setBusy(false) re-enables them (C4)', () => {
  const el = mount();
  const r = el.shadowRoot!;
  el.setBusy(true);
  for (const p of ['gemini', 'openai', 'anthropic']) {
    expect(
      r.querySelector<HTMLButtonElement>(`#provider button[data-provider="${p}"]`)!.disabled,
    ).toBe(true);
  }
  el.setBusy(false);
  for (const p of ['gemini', 'openai', 'anthropic']) {
    expect(
      r.querySelector<HTMLButtonElement>(`#provider button[data-provider="${p}"]`)!.disabled,
    ).toBe(false);
  }
});

it('value setter hydrates the picker, key, and language for a non-Gemini provider (C4)', () => {
  const el = mount();
  el.value = { provider: 'anthropic', apiKey: 'sk-ant-seed', targetLang: 'en' };
  const r = el.shadowRoot!;
  expect(
    r.querySelector('#provider button[data-provider="anthropic"]')!.getAttribute('aria-pressed'),
  ).toBe('true');
  expect(r.querySelector<HTMLInputElement>('#key')!.value).toBe('sk-ant-seed');
  expect(r.querySelector<HTMLInputElement>('#key')!.placeholder).toBe('Paste your key (sk-ant-…)');
});

it('value setter defaults to Gemini when provider is absent (back-compat) (C4)', () => {
  const el = mount();
  // Cast: simulates a caller built against the pre-C4 OnboardingValue shape.
  el.value = { apiKey: '', targetLang: 'en' } as OnboardingValue;
  expect(
    el
      .shadowRoot!.querySelector('#provider button[data-provider="gemini"]')!
      .getAttribute('aria-pressed'),
  ).toBe('true');
});

it('has no axe violations with the provider picker rendered (C4)', async () => {
  expect(await axeViolations(mount())).toEqual([]);
});
```

Run: `cd packages/app && bunx vitest run test/ui/onboarding-view.test.ts`
Expected: failures — `#provider` doesn't exist, `.free-badge`/`#getkey-label`/`#step-sub` don't
exist, `OnboardingValue`'s `provider` field doesn't type-check, `setBusy` doesn't yet disable
provider buttons.

- [ ] **Step 2: Implement.** In `packages/app/src/ui/onboarding-view.ts`:
  1. Add the `Provider` import and the two new metadata tables, right after the existing
     `GET_KEY_URL` line (`onboarding-view.ts:6`) — replacing it:

```ts
import type { Provider } from '../domain/types';

// Shared verbatim with C5's key-hygiene.ts PROVIDER_LABEL table (design spec §2.3/§3.6) — defined
// locally so this card has zero dependency on C5 landing first. If C5 lands later and imports this
// same table from key-hygiene.ts instead, keep the two textually identical.
const PROVIDER_LABEL: Record<Provider, string> = {
  gemini: 'Gemini',
  openai: 'OpenAI',
  anthropic: 'Anthropic (Claude)',
};

interface ProviderInfo {
  segLabel: string;
  free: boolean;
  getKeyUrl: string;
  getKeyLabel: string;
  placeholder: string;
  stepSub: string;
}

const PROVIDER_INFO: Record<Provider, ProviderInfo> = {
  gemini: {
    segLabel: 'Gemini',
    free: true,
    getKeyUrl: 'https://aistudio.google.com/apikey',
    getKeyLabel: 'Get a free API key',
    placeholder: 'Paste your key (AIza…)',
    stepSub:
      'Free from Google AI Studio, about a minute to create. Paste it below to activate the extension.',
  },
  openai: {
    segLabel: 'OpenAI',
    free: false,
    getKeyUrl: 'https://platform.openai.com/api-keys',
    getKeyLabel: 'Get an API key',
    placeholder: 'Paste your key (sk-…)',
    stepSub:
      'From your OpenAI account (requires billing set up). Paste it below to activate the extension.',
  },
  anthropic: {
    segLabel: 'Claude',
    free: false,
    getKeyUrl: 'https://console.anthropic.com/settings/keys',
    getKeyLabel: 'Get an API key',
    placeholder: 'Paste your key (sk-ant-…)',
    stepSub:
      'From your Anthropic console (requires billing set up). Paste it below to activate the extension.',
  },
};

// Back-compat named export — same value as before (Gemini's URL). Existing consumer:
// onboarding-view.test.ts's "points the reader at a free key" test.
export const GET_KEY_URL = PROVIDER_INFO.gemini.getKeyUrl;
```

2. `OnboardingValue` (`onboarding-view.ts:9-12`) gains `provider`:

```ts
export interface OnboardingValue {
  provider: Provider;
  apiKey: string;
  targetLang: string;
}
```

3. Hero paragraph (`onboarding-view.ts:81`) — replace the Gemini-exclusive sentence:

```html
<p class="lead">
  Look up any English word right where you're reading, translated into your language, powered by
  your own AI key — free with Google Gemini by default, or bring your OpenAI or Anthropic key.
  Nothing leaves your device but the word you choose.
</p>
```

4. `step-key`'s body (`onboarding-view.ts:98-110`) — replace entirely:

```html
<li class="step todo" id="step-key">
  <span class="dot"></span>
  <div class="step-body">
    <p class="step-title">Add your API key</p>
    <p class="step-sub" id="step-sub">
      Free from Google AI Studio, about a minute to create. Paste it below to activate the
      extension.
    </p>
    <div class="seg" id="provider" role="group" aria-label="Choose your AI provider">
      <button type="button" data-provider="gemini" aria-pressed="true" aria-label="Gemini (Google)">
        Gemini<span class="free-badge">Free</span>
      </button>
      <button type="button" data-provider="openai" aria-pressed="false" aria-label="OpenAI">
        OpenAI
      </button>
      <button
        type="button"
        data-provider="anthropic"
        aria-pressed="false"
        aria-label="Anthropic (Claude)"
      >
        Claude
      </button>
    </div>
    <a
      class="getkey"
      id="getkey"
      href="https://aistudio.google.com/apikey"
      target="_blank"
      rel="noopener noreferrer"
      ><span id="getkey-label">Get a free API key</span>${ICON_EXTERNAL}</a
    >
    <div class="keyrow">
      <input
        id="key"
        type="password"
        autocomplete="off"
        placeholder="Paste your key (AIza…)"
        aria-label="Gemini API key"
        aria-describedby="key-help"
      />
      <button type="button" id="reveal" aria-label="Reveal API key">Show</button>
    </div>
    <p id="key-help">Stored locally on this device only.</p>
  </div>
</li>
```

5. CSS — add right after the existing `.getkey .ext{...}` rule (`onboarding-view.ts:56`), before
   `.keyrow{...}`:

```css
.seg {
  display: inline-flex;
  flex-wrap: wrap;
  background: var(--ad-surface-sunken);
  border: 1px solid var(--ad-line);
  border-radius: 10px;
  padding: 3px;
  gap: 2px;
  margin-top: 10px;
}
.seg button {
  appearance: none;
  border: 0;
  cursor: pointer;
  font: inherit;
  font-size: var(--adp-text-sm);
  font-weight: var(--adp-weight-semi);
  color: var(--ad-ink-soft);
  background: transparent;
  padding: 7px 14px;
  border-radius: 8px;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transition:
    background var(--adp-dur-fast) var(--adp-ease),
    color var(--adp-dur-fast) var(--adp-ease);
}
.seg button[aria-pressed='true'] {
  background: var(--ad-accent);
  color: var(--ad-on-accent);
}
.seg button:focus-visible {
  outline: 2px solid var(--ad-accent);
  outline-offset: 2px;
}
.seg button:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}
.seg .free-badge {
  padding: 1px 7px;
  border-radius: 999px;
  font-size: var(--adp-text-2xs);
  font-weight: var(--adp-weight-bold);
  background: var(--ad-accent-soft);
  color: var(--ad-accent-ink);
}
.seg button[aria-pressed='true'] .free-badge {
  background: var(--ad-on-accent);
  color: var(--ad-accent-ink);
}
@media (prefers-reduced-motion: reduce) {
  .seg button {
    transition: none;
  }
}
```

6. Class fields — add `_provider`/`_keys` next to the existing `_busy` field:

```ts
private _provider: Provider = 'gemini';
// Mirrors settings-form's per-provider stash (settings-form.ts:235): switching the segmented
// control back and forth never silently discards a key typed for a provider not currently shown.
private _keys: Record<Provider, string> = { gemini: '', openai: '', anthropic: '' };
```

7. New listener in `connectedCallback`, alongside the existing `#reveal`/`form` listeners:

```ts
this.q<HTMLElement>('#provider').addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-provider]');
  if (!btn || this._busy) return;
  this.commitKeyField();
  this._provider = btn.dataset['provider'] as Provider;
  this.syncProviderRow();
  this.refreshProgress();
});
```

8. New private methods, placed near `refreshProgress()`:

```ts
/** Stash the visible key into the currently-selected provider's slot, mirroring settings-form's
 * commitKeyField() (settings-form.ts:436-438) — called before switching providers or submitting. */
private commitKeyField(): void {
  this._keys[this._provider] = this.q<HTMLInputElement>('#key').value;
}

/** Re-render the picker row for `_provider`: pressed segment, get-key link, key placeholder/
 * aria-label/step copy, and restore whatever was previously typed for this provider (if anything).
 * Mirrors settings-form's syncKeyField() (settings-form.ts:456-486). */
private syncProviderRow(): void {
  const info = PROVIDER_INFO[this._provider];
  for (const btn of this.root.querySelectorAll<HTMLButtonElement>(
    '#provider button[data-provider]',
  )) {
    btn.setAttribute('aria-pressed', String(btn.dataset['provider'] === this._provider));
  }
  this.q<HTMLElement>('#step-sub').textContent = info.stepSub;
  const link = this.q<HTMLAnchorElement>('#getkey');
  link.href = info.getKeyUrl;
  this.q<HTMLElement>('#getkey-label').textContent = info.getKeyLabel;
  const key = this.q<HTMLInputElement>('#key');
  key.placeholder = info.placeholder;
  key.setAttribute('aria-label', `${PROVIDER_LABEL[this._provider]} API key`);
  key.value = this._keys[this._provider];
}
```

9. `submit()`/`submitAnyway()` (the C2 shape) — update both to commit the field first, read the
   stash, and carry `provider` in the dispatched detail:

```ts
private submit(): void {
  if (this._busy) return;
  this.commitKeyField();
  const apiKey = this._keys[this._provider].trim();
  if (apiKey.length === 0) {
    this.setStatus(
      `Paste your ${PROVIDER_LABEL[this._provider]} API key to activate the extension.`,
      'error',
    );
    this.q<HTMLInputElement>('#key').focus();
    return;
  }
  this.setBusy(true);
  this.dispatchEvent(
    new CustomEvent<OnboardingValue>('save', {
      detail: {
        provider: this._provider,
        apiKey,
        targetLang: this.q<HTMLSelectElement>('#target').value,
      },
      bubbles: true,
      composed: true,
    }),
  );
}

private submitAnyway(): void {
  if (this._busy) return;
  this.commitKeyField();
  const apiKey = this._keys[this._provider].trim();
  if (apiKey.length === 0) {
    this.setStatus(
      `Paste your ${PROVIDER_LABEL[this._provider]} API key to activate the extension.`,
      'error',
    );
    this.q<HTMLInputElement>('#key').focus();
    return;
  }
  this.setBusy(true);
  this.dispatchEvent(
    new CustomEvent<OnboardingValue>('save-anyway', {
      detail: {
        provider: this._provider,
        apiKey,
        targetLang: this.q<HTMLSelectElement>('#target').value,
      },
      bubbles: true,
      composed: true,
    }),
  );
}
```

10. `setBusy(busy)` (C2's method) — append one loop to its existing body:

```ts
for (const btn of this.root.querySelectorAll<HTMLButtonElement>(
  '#provider button[data-provider]',
)) {
  btn.disabled = busy;
}
```

11. `value` setter — replace with the provider-aware version:

```ts
set value(v: OnboardingValue) {
  if (!this.shadowRoot) {
    this._pendingValue = v;
    return;
  }
  this.q<HTMLSelectElement>('#target').value = v.targetLang;
  this._provider = v.provider ?? 'gemini';
  this._keys = { gemini: '', openai: '', anthropic: '' };
  this._keys[this._provider] = v.apiKey;
  this.syncProviderRow();
  this.refreshProgress();
}
```

12. In `connectedCallback`, right before the existing `this.refreshProgress();` call
    (`onboarding-view.ts:149`), add `this.syncProviderRow();` so a fresh, no-`value`-set mount
    renders the Gemini row's dynamic bits (get-key href/label already match the markup's literal
    defaults, but this keeps the two paths — mount vs. hydrate — going through the same renderer).

Run: `cd packages/app && bunx vitest run test/ui/onboarding-view.test.ts`
Expected: all tests pass (existing + 9 new).

- [ ] **Step 3: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

Commit:

```
git add packages/app/src/ui/onboarding-view.ts packages/app/test/ui/onboarding-view.test.ts
git commit -m "feat: any-provider onboarding — segmented provider picker + provider-aware submit/value (C4)" \
  -m $'Tribe-Card: c4-any-provider-onboarding\nTribe-Task: 1/3'
```

---

### Task 2: `options.ts` — provider-aware persist in `mountOnboarding`

**Files:**

- Modify: `packages/extension-chrome/src/options.ts`

No dedicated unit test exists for `options.ts` in this repo — it is a composition root, covered by
e2e only (same precedent as C2's own Task 2). This task's correctness is proven by Task 3's e2e;
still run the typecheck/lint gate below at the end so a regression in existing behavior (settings
save, cache/history clear, etc. — all in the same file) is caught immediately.

- [ ] **Step 1: Implement.** In `packages/extension-chrome/src/options.ts`:
  1. Add `configuredProvidersFor` to the existing `@ai-dict/app` import (`options.ts:1-14`),
     alongside `hasKeyFor`:

```ts
import {
  registerSettingsForm,
  registerOnboarding,
  DEFAULT_OUTPUT_FORMAT,
  buildHistoryExport,
  hasKeyFor,
  configuredProvidersFor,
  type Provider,
  type Settings,
  type SettingsForm,
  type SettingsFormValue,
  type OnboardingView,
  type OnboardingValue,
  type WireReply,
} from '@ai-dict/app';
```

2. New helper, placed near `toFormValue` (`options.ts:67-80`):

```ts
/** Apply a provider + its pasted key onto `cur`, writing into the ONE field that provider owns
 * (apiKey/openaiApiKey/anthropicApiKey) and leaving the other two untouched — the card's "one key
 * activates" scope fence. Provider's exhaustive 3-arm switch is why no `default` is needed. */
function applyProviderKey(
  cur: Settings,
  provider: Provider,
  apiKey: string,
  targetLang: string,
): Settings {
  const base = { ...cur, provider, targetLang };
  switch (provider) {
    case 'gemini':
      return { ...base, apiKey };
    case 'openai':
      return { ...base, openaiApiKey: apiKey };
    case 'anthropic':
      return { ...base, anthropicApiKey: apiKey };
  }
}
```

3. `mountOnboarding` (the C2 shape) — three changes:

   a. Seed value:

```ts
(view as unknown as { value: OnboardingValue }).value = {
  provider: initial.provider ?? 'gemini',
  apiKey: '',
  targetLang: initial.targetLang,
};
```

     b. `save` listener — destructure `provider` and use `applyProviderKey` in the persist step:

```ts
view.addEventListener('save', (e) => {
  const { provider, apiKey, targetLang } = (e as CustomEvent<OnboardingValue>).detail;
  view.setStatus('Testing your key…');
  let cur: Settings;
  void load()
    .then((c) => {
      cur = c;
      const next = applyProviderKey(c, provider, apiKey, targetLang);
      return chrome.storage.local.set({
        settings: {
          ...next,
          hasKey: hasKeyFor(next),
          configuredProviders: configuredProvidersFor(next, { envGeminiKey: KEY_FROM_ENV }),
        },
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
```

     c. `save-anyway` listener — same `applyProviderKey` substitution in its persist step:

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

`send()`, `load()`, `mountSettings()` are the existing helpers/functions in this file —
unchanged. Nothing in `wireSettings` (the settings-form save path, `options.ts:113-134`) is
touched.

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
git commit -m "feat: any-provider onboarding — provider-aware persist in mountOnboarding (C4)" \
  -m $'Tribe-Card: c4-any-provider-onboarding\nTribe-Task: 2/3'
```

---

### Task 3: e2e coverage — pin the Gemini default + new multi-provider functional spec

**Files:**

- Modify: `packages/extension-chrome/e2e/onboarding.spec.ts`
- Create: `packages/extension-chrome/e2e/c4-any-provider-onboarding.spec.ts`

- [ ] **Step 1: Pin the default in the existing suite.** In
      `packages/extension-chrome/e2e/onboarding.spec.ts`, extend the first test's final assertion
      (the one C2's own plan already updated to mock Gemini and assert `apiKey`/`hasKey`) to also
      read `settings.provider`:

```ts
const stored = await page.evaluate(async () => {
  const { settings } = (await chrome.storage.local.get('settings')) as {
    settings: { apiKey: string; hasKey: boolean; provider: string };
  };
  return `${settings.apiKey}|${settings.hasKey}|${settings.provider}`;
});
expect(stored).toBe('AIza-activated|true|gemini');
```

Run:

```
GEMINI_API_KEY= bun run build:chrome
cd packages/extension-chrome && bunx playwright test onboarding
```

Expected: all tests in `onboarding.spec.ts` still pass, now also asserting the default provider.

- [ ] **Step 2: Write the new functional spec.** Create
      `packages/extension-chrome/e2e/c4-any-provider-onboarding.spec.ts`:

```ts
import { test, expect } from './fixtures';
import { mockGemini, mockOpenAI, mockAnthropic } from './helpers';

async function storedSettings(
  page: import('@playwright/test').Page,
): Promise<Record<string, unknown>> {
  const { settings } = (await page.evaluate(() => chrome.storage.local.get('settings'))) as {
    settings: Record<string, unknown>;
  };
  return settings;
}

test.describe('C4 any-provider onboarding', () => {
  test('activating with the default Gemini segment writes only the Gemini key field', async ({
    context,
    extensionId,
  }) => {
    const calls = await mockGemini(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.waitForSelector('onboarding-view');

    await page.locator('onboarding-view #key').fill('AIza-gemini-real');
    await page.locator('onboarding-view #activate').click();
    await page.waitForSelector('settings-form', { timeout: 10_000 });

    const s = await storedSettings(page);
    expect(s['provider']).toBe('gemini');
    expect(s['apiKey']).toBe('AIza-gemini-real');
    expect(s['openaiApiKey']).toBe('');
    expect(s['anthropicApiKey']).toBe('');
    expect(calls.count).toBe(1);
  });

  test('switching to OpenAI and activating writes only the OpenAI key field', async ({
    context,
    extensionId,
  }) => {
    const calls = await mockOpenAI(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.waitForSelector('onboarding-view');

    await page.locator('onboarding-view #provider button[data-provider="openai"]').click();
    await page.locator('onboarding-view #key').fill('sk-openai-real-1234567890');
    await page.locator('onboarding-view #activate').click();
    await page.waitForSelector('settings-form', { timeout: 10_000 });

    const s = await storedSettings(page);
    expect(s['provider']).toBe('openai');
    expect(s['openaiApiKey']).toBe('sk-openai-real-1234567890');
    expect(s['apiKey']).toBe('');
    expect(calls.count).toBe(1);
  });

  test('switching to Anthropic and activating writes only the Anthropic key field', async ({
    context,
    extensionId,
  }) => {
    const calls = await mockAnthropic(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.waitForSelector('onboarding-view');

    await page.locator('onboarding-view #provider button[data-provider="anthropic"]').click();
    await page.locator('onboarding-view #key').fill('sk-ant-real-1234567890');
    await page.locator('onboarding-view #activate').click();
    await page.waitForSelector('settings-form', { timeout: 10_000 });

    const s = await storedSettings(page);
    expect(s['provider']).toBe('anthropic');
    expect(s['anthropicApiKey']).toBe('sk-ant-real-1234567890');
    expect(s['apiKey']).toBe('');
    expect(calls.count).toBe(1);
  });

  test("switching providers preserves each one's own typed key across a real DOM round trip", async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.waitForSelector('onboarding-view');

    await page.locator('onboarding-view #key').fill('AIza-stash-me');
    await page.locator('onboarding-view #provider button[data-provider="openai"]').click();
    await expect(page.locator('onboarding-view #key')).toHaveValue('');
    await page.locator('onboarding-view #key').fill('sk-stash-me');
    await page.locator('onboarding-view #provider button[data-provider="gemini"]').click();
    await expect(page.locator('onboarding-view #key')).toHaveValue('AIza-stash-me');
  });

  test('a rejected OpenAI key stays on onboarding and rolls back provider + key + hasKey', async ({
    context,
    extensionId,
  }) => {
    const calls = await mockOpenAI(context, {
      status: 401,
      body: JSON.stringify({ error: { message: 'invalid api key' } }),
    });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.waitForSelector('onboarding-view');

    await page.locator('onboarding-view #provider button[data-provider="openai"]').click();
    await page.locator('onboarding-view #key').fill('sk-openai-bad-1234567890');
    await page.locator('onboarding-view #activate').click();

    await expect(page.locator('onboarding-view #status')).toContainText(
      'OpenAI rejected the API key.',
      { timeout: 10_000 },
    );
    expect(await page.locator('settings-form').count()).toBe(0);
    expect(calls.count).toBe(1);

    const s = await storedSettings(page);
    expect(s['hasKey']).toBe(false);
    expect(s['openaiApiKey']).toBe('');
  });
});
```

Run:

```
GEMINI_API_KEY= bun run build:chrome
cd packages/extension-chrome && bunx playwright test c4-any-provider-onboarding
```

Expected: 5 passed.

- [ ] **Step 3: Commit** — gate, then commit:

```
GEMINI_API_KEY= bun run build:chrome
bun run lint && bun run format:check
```

Commit:

```
git add packages/extension-chrome/e2e/onboarding.spec.ts packages/extension-chrome/e2e/c4-any-provider-onboarding.spec.ts
git commit -m "feat: any-provider onboarding — e2e coverage for the 3-provider activation flow (C4)" \
  -m $'Tribe-Card: c4-any-provider-onboarding\nTribe-Task: 3/3'
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
cd packages/extension-chrome && bunx playwright test onboarding c4-any-provider-onboarding c2-verified-activation
```

Expected: typecheck clean on both packages; the full Vitest suite green (including the 9
`onboarding-view.test.ts` additions); lint/format clean; the Chrome build succeeds with the env key
cleared; `onboarding.spec.ts` (regression guard, now also pinning the Gemini default), the new
`c4-any-provider-onboarding.spec.ts`, and `c2-verified-activation.spec.ts` (regression guard for the
persist→test→rollback machinery this card extends) all pass.

## PR

Regular merge (no squash). Jira link per the repo convention. Include a **"Testing performed"**
section per this worktree's evidence policy (§6 of the design spec) instead of screenshots/video —
list the suites above with pass counts.
