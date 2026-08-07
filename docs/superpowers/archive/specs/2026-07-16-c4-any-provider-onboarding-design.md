# C4 — Any-provider onboarding

Roadmap card: `docs/ROADMAP.md` §4 Category C, C4 (Impact 4 · Effort M · Score 2.0).
Depends on: C2 (verified activation) — **frozen**, per
`docs/superpowers/specs/2026-07-16-c2-verified-activation-design.md` and its companion plan
`docs/superpowers/plans/2026-07-16-c2-verified-activation.md`. C2's plan gives the _exact_ post-C2
shape of `onboarding-view.ts`/`options.ts` (busy state, `#save-anyway`, persist→test→
rollback-or-proceed) — this spec is written against that target shape, not today's pre-C2 code,
wherever the two disagree (flagged explicitly in §3). Touchpoint (not a dependency): C5 (key paste
hygiene), independent — see §3.6.

## 0. Precondition (read before implementing)

**This card cannot ship before C2.** `handleConnectionTest`
(`packages/app/src/app/router.ts:195-211`) only ever tests "whatever key is in storage right now";
C2 is what makes onboarding call `connection.test` at all. If a Warchief picks up this plan before
C2's PR has merged, `onboarding-view.ts` will not yet have `_busy`/`setBusy`/`#save-anyway`, and
`options.ts`'s `mountOnboarding` will not yet persist-then-test. **Stop and escalate re-sequencing
rather than re-deriving C2's mechanism inline here** — re-implementing it inside this card would
fork the one persist→test→rollback code path the roadmap's dependency map
(`docs/ROADMAP.md` §5) explicitly built C2 to own once, for both C3 and C4.

## 1. Problem (grounded in code)

Today's onboarding welcome screen is hard-wired to exactly one provider, even though the rest of
the product already supports three:

- **The manifest already promises all three.** `packages/extension-chrome/src/manifest.json:6`:
  _"Stay-in-page dictionary lookup powered by your own Gemini, OpenAI, or Anthropic API key."_
- **Settings already has full multi-provider plumbing.** `SettingsFormValue`
  (`packages/app/src/ui/settings-form.ts:29-45`) carries `provider`, `apiKey`, `openaiApiKey`,
  `anthropicApiKey`; the form keeps one stash per provider (`_keys`, `settings-form.ts:235`) behind
  a single morphing `#key` row (`syncKeyField()`, `settings-form.ts:456-486`) driven by a
  `<select id="provider">` (`settings-form.ts:146-151`). `hasKeyFor` (`domain/types.ts:183-193`)
  and `configuredProvidersFor` (`domain/types.ts:101-110`) are already provider-aware. The service
  worker already resolves the active provider per lookup —
  `createLookupClientSelector`'s `getProvider: async () => (await readFullSettings()).provider ??
'gemini'` (`packages/extension-chrome/src/sw.ts:99`) — and every provider client tags its own
  errors (`spec.provider` threaded through `runHttpLookup`,
  `packages/app/src/app/http-lookup-client.ts:78,139,151,155,164`, consumed by `mapError`'s
  per-provider `NAMES` table, `packages/app/src/domain/error-mapper.ts:24-28`).
- **Onboarding never asks.** `OnboardingValue` (`packages/app/src/ui/onboarding-view.ts:9-12`) is
  `{ apiKey, targetLang }` — no `provider` field at all. `GET_KEY_URL` is a single Gemini constant
  (`onboarding-view.ts:6`), the get-key link, placeholder (`"Paste your key (AIza…)"`), and step
  copy (`"Add your Gemini API key"`, `"Free from Google AI Studio…"`) are all literal Gemini text
  in `MARKUP` (`onboarding-view.ts:98-110`). `mountOnboarding`
  (`packages/extension-chrome/src/options.ts:181-207`, pre-C2 shape) always writes the pasted
  string into `settings.apiKey` — there is no path from onboarding into `openaiApiKey` or
  `anthropicApiKey`, and `settings.provider` is never touched (it stays whatever `DEFAULTS.provider`
  = `'gemini'` already was).

An OpenAI or Anthropic subscriber — per the card, "the _most_ motivated cohort" since they already
pay for a provider — hits a screen that visually and functionally assumes Gemini, must abandon
onboarding, discover the full settings page exists, open it, and reconfigure there. The one screen
whose entire job is "get this person to their first successful lookup" actively mis-routes two of
the product's three promised audiences.

## 2. Decision: picker UI, value shape, and where the provider-aware write lives (Lead call)

### 2.1 Picker UI: a segmented control, not a `<select>` (Lead call)

Settings already solves "pick one of three providers" with a `<select id="provider">`
(`settings-form.ts:146-151`) — reusing that literally would be the smallest diff. This spec instead
recommends a **segmented control**, matching the visual pattern the design system already uses for
an identical shape of choice: the Theme picker's `.seg`/`.seg button[aria-pressed]` control
(`settings-form.ts:103-108` CSS, `:193-199` markup, `:440-454` JS — three-to-four mutually exclusive
options, one always pressed, ADR `adr-20260615-paperlight-redesign.md` §6.9 names it explicitly:
_"Appearance (Theme control: `Sepia · Dark · High Contrast · Match system`, a segmented control
whose pressed segment is `accent` fill / `on-accent` text)"_). Rationale:

1. **The onboarding panel is a step-by-step funnel, not a dense settings form.** Its whole visual
   language (`.steps`/`.step`/`.dot` in `onboarding-view.ts:43-51`) is large, scannable blocks — a
   native `<select>` reads as a forms-page control, out of register with that language. A segmented
   control is visually native to the panel (same token surface, same `border-radius`/padding
   rhythm as `.panel`/`.step`).
2. **Three fixed, always-visible options with one free-tier default is exactly what a segmented
   control communicates and a `<select>` hides** — a closed dropdown shows one label; a reader
   evaluating "which of these do I already have a key for?" benefits from seeing all three at
   once, with the free one visually marked, before choosing.
3. **Precedent already exists in this exact codebase** for "3-4 mutually exclusive choices,
   Paperlight tokens, one always pressed" — the Theme control. Reusing its established
   `.seg`/`aria-pressed` shape (rather than inventing a new control type) keeps the token/a11y
   pattern to one canonical implementation across the whole UI.

**Rejected: reusing `<select id="provider">` verbatim.** Smaller diff, but wrong register for a
first-run funnel screen and hides the "Gemini is free" fact behind a closed dropdown until opened.

Both controls select from the same `Provider` enum (`domain/types.ts:92`,
`'gemini' | 'openai' | 'anthropic'`) in the same canonical order (`PROVIDERS`, `domain/types.ts:95`)
— the _semantics_ (what can be selected, in what order, defaulting to Gemini) match settings-form's
provider select exactly; only the _widget_ differs, deliberately, for the reason above.

### 2.2 `OnboardingValue` gains `provider` (Lead call)

```ts
export interface OnboardingValue {
  provider: Provider;
  apiKey: string;
  targetLang: string;
}
```

Additive to the C2 shape (C2 does not touch `OnboardingValue`'s fields, only adds the
`save`/`save-anyway` event pair around it) — every `save`/`save-anyway` event now also carries which
provider the pasted key belongs to.

### 2.3 One canonical provider-label table, shared with C5 (Lead call)

C5's `key-hygiene.ts` design (`docs/superpowers/specs/2026-07-16-c5-key-paste-hygiene-design.md`
§3.1) pins:

```ts
const PROVIDER_LABEL: Record<Provider, string> = {
  gemini: 'Gemini',
  openai: 'OpenAI',
  anthropic: 'Anthropic (Claude)',
};
```

This spec reuses that **exact** table (same keys, same strings) for onboarding's own copy (error
text, `aria-label`s) — not settings-form's own, slightly different, wording (`KEY_LABEL`,
`settings-form.ts:49-53`, which say `"Anthropic (Claude) API key"` too but its `<select>` options
say `"ChatGPT (OpenAI)"`/`"Claude (Anthropic)"`, reversed vendor/product order from C5's table).
Picking C5's table (over inventing a third, or copying settings-form's `<select>` wording) means
whichever of C4/C5 ships first, the copy a user sees naming "which provider" never disagrees
between the picker, the submit-error, and (once C5 lands) the paste-hint. Settings-form's own
`<select>` wording is pre-existing, working, and out of scope to touch.

This card does **not** depend on C5 landing first: if `key-hygiene.ts` does not exist yet,
onboarding simply has no `PROVIDER_LABEL` import to draw from key-hygiene — it defines its own
copy of the same four-line table locally (a small, deliberate duplication favoured over adding a
premature cross-card import edge; see §3.6 for the exact touchpoint once C5 does land).

### 2.4 The provider-aware write stays entirely in `options.ts` (Lead call)

No change to `wire.ts`, `router.ts`, `domain/types.ts`, or `settings-form.ts`. Per C2 §2/§4.3
(frozen), the options page already writes settings directly to `chrome.storage.local` as a trusted
context and then fires the unmodified, zero-payload `connection.test`; `getProvider()`
(`sw.ts:99`) already reads `readFullSettings().provider` fresh on every call. The **only** new fact
`connection.test` needs to test the right provider is: `settings.provider` and the right one of
`apiKey`/`openaiApiKey`/`anthropicApiKey` must already be in storage before the message is sent —
which is exactly the persist-first mechanic C2 already built. This card's entire job in `options.ts`
is making sure the pasted key lands in the **correct** field and `provider` is set alongside it,
inside the persist step C2's `save`/`save-anyway` listeners already perform.

## 3. The change

### 3.0 Composing with C2's pinned shape

C2's plan (`docs/superpowers/plans/2026-07-16-c2-verified-activation.md`, Task 1/Task 2) ships
`onboarding-view.ts`/`options.ts` in the exact shape quoted throughout §3 below. This section calls
out every point where this card's diff and C2's diff touch the same method, so an implementer
picking this plan up post-C2 knows which parts are "C2's, keep as-is" vs. "this card's new
addition":

| Shared touch point                                 | C2 owns                                                               | C4 adds                                                                                                                                |
| -------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `submit()` / `submitAnyway()`                      | `_busy` guard, `setBusy(true)` call, event dispatch                   | reads the committed per-provider stash instead of `#key` directly; error copy and dispatched `detail` become provider-aware            |
| `setBusy(busy)`                                    | disables `#activate`/`#save-anyway`, relabels, hides the escape hatch | also disables the provider segmented buttons while busy (a user must not switch providers mid-verification)                            |
| `value` setter                                     | hydrates `#target`/`#key` from `OnboardingValue`                      | also hydrates `_provider`/`_keys` and re-renders the picker row                                                                        |
| `mountOnboarding`'s `save`/`save-anyway` listeners | persist→test→rollback-or-proceed sequencing, `Save anyway` bypass     | the persisted object's key field and `provider`/`configuredProviders` are chosen by the event's `provider`, not hard-coded to `apiKey` |

Nothing in this card removes or reorders any of C2's control flow — it only widens which field gets
written and which copy is shown at points C2's sequencing already visits.

### 3.1 Provider metadata — `packages/app/src/ui/onboarding-view.ts`

```ts
import type { Provider } from '../domain/types';

// Shared verbatim with C5's key-hygiene.ts PROVIDER_LABEL table (design spec §2.3) — defined
// locally (not imported) so this card has zero dependency on C5 landing first; if C5 lands later,
// the two tables must be kept textually identical (see §3.6).
const PROVIDER_LABEL: Record<Provider, string> = {
  gemini: 'Gemini',
  openai: 'OpenAI',
  anthropic: 'Anthropic (Claude)',
};

interface ProviderInfo {
  /** Short label for the segmented-control button (kept to one word so 3 fit one row). */
  segLabel: string;
  /** Only Gemini shows the "Free" badge — it remains the product's free-tier default (scope fence). */
  free: boolean;
  getKeyUrl: string;
  getKeyLabel: string;
  placeholder: string;
  /** The step's descriptive sub-line, provider-specific. */
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

// Back-compat named export — same value as before (Gemini's URL); existing consumer:
// onboarding-view.test.ts's "points the reader at a free key" test.
export const GET_KEY_URL = PROVIDER_INFO.gemini.getKeyUrl;
```

Get-key URLs are exactly the three the card names: `aistudio.google.com/apikey` ·
`platform.openai.com/api-keys` · `console.anthropic.com/settings/keys`.

### 3.2 Hero copy — one sentence, no product-promise change

`MARKUP`'s lead paragraph (`onboarding-view.ts:81`) changes from Gemini-exclusive wording to:

```
Look up any English word right where you're reading, translated into your language, powered by
your own AI key — free with Google Gemini by default, or bring your OpenAI or Anthropic key.
Nothing leaves your device but the word you choose.
```

Still one sentence naming the free default; still "your own key, nothing leaves your device." The
store listing already names all three providers (`manifest.json:6`) — this is copy catching up to
an existing promise, not a new one (scope fence: "no product-promise change").

### 3.3 Markup — the segmented picker + dynamic get-key/placeholder/step-sub

`step-key`'s body (`onboarding-view.ts:98-110`) becomes:

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

Two deliberate markup decisions:

- **Step title drops "Gemini"** ("Add your Gemini API key" → "Add your API key") — the segmented
  control now names the provider; repeating it in the title would be redundant the moment a reader
  picks something else.
- **The get-key link's text sits in its own `<span id="getkey-label">`**, not inlined with
  `${ICON_EXTERNAL}` as one string like today (`onboarding-view.ts:103`) — so switching providers
  can retarget only the label via `textContent`, without re-parsing/losing the icon SVG each time.

### 3.4 CSS — reuse the Theme control's segmented-control rules, token-only

Added right after the existing `.getkey .ext{...}` rule (`onboarding-view.ts:56`), before `.keyrow`:

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

Token-for-token identical vocabulary to settings-form's own `.seg` rules
(`settings-form.ts:103-108`) — `--ad-surface-sunken`, `--ad-line`, `--ad-accent`/`--ad-on-accent`,
`--adp-dur-fast`/`--adp-ease`. No new token is introduced; `.free-badge` composes existing
`--ad-accent-soft`/`--ad-accent-ink` (the same pair `.getkey` already uses for its link color). The
one addition beyond settings-form's rule set is `.seg button:disabled` (settings-form's Theme
segments are never disabled; onboarding's provider segments are, while `_busy`, per §3.0's table).

### 3.5 Class fields, provider-switch handler, and `submit()`/`value` integration

```ts
export class OnboardingView extends HTMLElement {
  private root!: ShadowRoot;
  private _pendingValue: OnboardingValue | null = null;
  private _busy = false; // C2
  private _provider: Provider = 'gemini';
  // Mirrors settings-form's per-provider stash (settings-form.ts:235) so switching the segmented
  // control back and forth never silently discards a key typed for a provider not currently shown.
  private _keys: Record<Provider, string> = { gemini: '', openai: '', anthropic: '' };
```

New listener in `connectedCallback`, alongside the existing `#reveal`/`form` listeners
(`onboarding-view.ts:131-143`):

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

New private methods (placed near `refreshProgress()`):

```ts
/** Stash the visible key into the currently-selected provider's slot, mirroring settings-form's
 * commitKeyField() (settings-form.ts:436-438) — called before switching providers or submitting. */
private commitKeyField(): void {
  this._keys[this._provider] = this.q<HTMLInputElement>('#key').value;
}

/** Re-render the picker row for `_provider`: pressed segment, get-key link, key placeholder/
 * aria-label/step copy, and restore whatever was previously typed for this provider (if anything).
 * Mirrors settings-form's syncKeyField() (settings-form.ts:456-486) for the analogous onboarding
 * surface. */
private syncProviderRow(): void {
  const info = PROVIDER_INFO[this._provider];
  for (const btn of this.root.querySelectorAll<HTMLButtonElement>('#provider button[data-provider]')) {
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

`submit()`/`submitAnyway()` (the C2 shape, `docs/superpowers/plans/2026-07-16-
c2-verified-activation.md` Task 1 Step 2 point 5) each gain a `commitKeyField()` call and read the
committed stash instead of `#key` directly; the error copy and dispatched detail become
provider-aware:

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
```

`submitAnyway()` gets the identical `commitKeyField()`/error-copy/detail treatment, dispatching
`save-anyway` instead of `save` (unchanged from C2 otherwise).

`setBusy(busy)` (C2's method) gains one loop, appended to its existing body:

```ts
for (const btn of this.root.querySelectorAll<HTMLButtonElement>(
  '#provider button[data-provider]',
)) {
  btn.disabled = busy;
}
```

The `value` setter (`onboarding-view.ts:191-199`) becomes provider-aware:

```ts
set value(v: OnboardingValue) {
  if (!this.shadowRoot) {
    this._pendingValue = v;
    return;
  }
  this.q<HTMLSelectElement>('#target').value = v.targetLang;
  this._provider = v.provider ?? 'gemini'; // back-compat: a caller that never set provider defaults Gemini
  this._keys = { gemini: '', openai: '', anthropic: '' };
  this._keys[this._provider] = v.apiKey;
  this.syncProviderRow();
  this.refreshProgress();
}
```

`refreshProgress()` itself needs no change — it reads the **live** `#key` field value regardless of
provider (`onboarding-view.ts:172-181`), which is correct: "is a key present right now" doesn't
depend on which provider it's for.

### 3.6 Touchpoint with C5 (independent — works with or without it)

If `packages/app/src/domain/key-hygiene.ts` (C5) has already landed when this card is implemented,
one line changes: C5's spec (§3.3 point 4) wires onboarding's hint refresh as
`hintFor('gemini', normalize(...))` — a literal `'gemini'`, correct only because pre-C4 onboarding
has exactly one provider. Post-C4, that call must become `hintFor(this._provider,
normalize(this.q<HTMLInputElement>('#key').value))` so the hint (e.g. "This looks like an OpenAI
key, not a Gemini key.") is evaluated against whichever provider is actually selected, not always
Gemini. Everywhere else, C5's `normalize()`/`hintFor()` calls are additive and compose with this
card unmodified: `submit()`/`submitAnyway()` would call `normalize()` instead of `.trim()` on the
already-committed per-provider value, and `refreshKeyHint()` (if present) simply reads `this.
_provider` for its target instead of a literal. If C5 has **not** landed, none of this applies —
this card adds no `key-hygiene` import and no hint element.

### 3.7 Composition root — `packages/extension-chrome/src/options.ts`

New local helpers (near `toFormValue`, `options.ts:67-80`):

```ts
/** Apply a provider + its pasted key onto `cur`, writing into the ONE field that provider owns
 * (apiKey/openaiApiKey/anthropicApiKey) and leaving the other two untouched — the card's "one key
 * activates" scope fence. `Provider`'s exhaustive 3-arm switch is why no `default` is needed. */
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

`configuredProvidersFor` is already exported from `@ai-dict/app` (`domain/types.ts:101-110`) — add
it to this file's existing `@ai-dict/app` import alongside `hasKeyFor` (`options.ts:6`). (Note:
`wireSettings`'s existing `save` listener, `options.ts:113-134`, hand-rolls this same 3-line
provider-detection inline rather than calling `configuredProvidersFor` — that is pre-existing,
working code and out of scope to touch. This card's _new_ code calls the domain helper directly
rather than adding a third hand-rolled copy of the same logic.)

`mountOnboarding` (C2's shape, `docs/superpowers/plans/2026-07-16-c2-verified-activation.md`
Task 2) changes at exactly three points:

1. **Seed value** — pass the stored `provider` (defaults `'gemini'` same as everywhere else in this
   file) instead of omitting it:

```ts
(view as unknown as { value: OnboardingValue }).value = {
  provider: initial.provider ?? 'gemini',
  apiKey: '',
  targetLang: initial.targetLang,
};
```

2. **`save` listener** — the persist step (C2's `.then((c) => { cur = c; return
chrome.storage.local.set(...) })`) becomes:

```ts
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
```

(destructure `provider` alongside the existing `apiKey`/`targetLang` from the event detail at the
top of the listener: `const { provider, apiKey, targetLang } = (e as
   CustomEvent<OnboardingValue>).detail;`). Everything after this — `send({ type:
   'connection.test' })`, the pass/fail branches, the rollback to `cur` on failure — is unchanged
from C2: rollback restores the **entire** pre-onboarding settings object (all three key fields,
whichever `provider` was active before), exactly as C2 designed it, so a failed OpenAI attempt
can never leave a half-written `provider`/`openaiApiKey` pair behind.

3. **`save-anyway` listener** — the identical `applyProviderKey`/`hasKeyFor`/`configuredProvidersFor`
   substitution, in the same place C2's bypass-persist step does its write.

`KEY_FROM_ENV` is already a module-level const in this file (`options.ts:28`); passing it to
`configuredProvidersFor` is defensive parity with `sw.ts:101`'s own call, even though onboarding
only ever runs when `!KEY_FROM_ENV` (the routing check at the bottom of the file,
`options.ts:210-212`, sends `KEY_FROM_ENV` straight to `mountSettings` and never reaches
`mountOnboarding`).

## 4. Scope fence (from the card, held exactly)

- **One key activates** — `applyProviderKey` writes exactly one of `apiKey`/`openaiApiKey`/
  `anthropicApiKey`, never more than one, per onboarding submission. Configuring a second/third
  provider is still exclusively a settings-page action (`settings-form.ts`, untouched).
- **Gemini remains the default and the "free" path** — `_provider` initializes to `'gemini'`
  (`onboarding-view.ts`'s class field and `options.ts`'s seeded `value`), and only Gemini's
  segmented button carries the `.free-badge`.
- **No product-promise change** — `manifest.json`'s description already names all three providers
  (§1); §3.2's hero-copy edit narrates an existing promise, adds no new one, and no manifest field
  changes.
- **No new wire message, no wire/router change** — §2.4; `wire.ts`/`router.ts` are untouched.
- **No new manifest permission** — nothing here touches `manifest.json` beyond the description
  already in place.
- **Tokens only** — §3.4's CSS reuses only `--ad-*`/`--adp-*` tokens already in use elsewhere in
  this same file or in settings-form's `.seg` rules; no new hex/oklch literal, no per-component
  `prefers-color-scheme` branch.
- **S1 held exactly** — the pasted key is still written directly to `chrome.storage.local` by the
  options page (a trusted context, unchanged from C2); it never appears on a `chrome.runtime`
  message, in a log, or in any status/error copy (every new string in §3 interpolates only
  `PROVIDER_LABEL`/`PROVIDER_INFO` — provider _names_, never key material).

## 5. Testing strategy

1. **Unit — `packages/app/test/ui/onboarding-view.test.ts`** (extends the existing `<onboarding-
view>` describe block):
   - Default render: the Gemini segment is `aria-pressed="true"`, carries the `.free-badge` with
     text `"Free"`; OpenAI/Claude segments are `aria-pressed="false"` and carry no badge.
   - Clicking the OpenAI segment: OpenAI becomes `aria-pressed="true"` (Gemini flips false), the
     get-key link's `href`/label switch to `platform.openai.com/api-keys`/"Get an API key", `#key`'s
     `placeholder` becomes `"Paste your key (sk-…)"` and `aria-label` becomes `"OpenAI API key"`,
     and `#step-sub`'s text changes to the OpenAI copy.
   - Typing a key under Gemini, switching to OpenAI (key field now empty), typing a different key,
     switching back to Gemini restores the first key verbatim (per-provider stash — mirrors
     settings-form's own provider-switch-preserves-key test pattern).
   - `submit()` with OpenAI selected dispatches `save` with `{ provider: 'openai', apiKey, ...}` —
     extends the existing `'emits "save" with the trimmed key and chosen language on activate'`
     test to assert the `provider` field for at least two of the three providers.
   - Submitting with an empty key under Claude shows the error `"Paste your Anthropic (Claude) API
key to activate the extension."` (provider-aware error copy).
   - `setBusy(true)` also disables all three provider buttons (extends C2's own `setBusy` test);
     `setBusy(false)` re-enables them.
   - `value` setter hydration: `{ provider: 'anthropic', apiKey: 'sk-ant-seed', targetLang: 'en' }`
     presses the Claude segment, fills `#key` with `sk-ant-seed`, and sets the Claude placeholder/
     aria-label; a legacy value with no `provider` field defaults to Gemini (back-compat).
   - `axe violations` stay `[]` with the segmented control's added markup (role="group",
     aria-pressed, aria-label on each button).
2. **e2e — update `packages/extension-chrome/e2e/onboarding.spec.ts`**: no change beyond what C2's
   own plan already requires (mocking Gemini on the first test) — that test never touches the
   picker, so it exercises the still-default Gemini path unchanged; add one assertion that
   `settings.provider === 'gemini'` alongside the existing `apiKey`/`hasKey` assertions, to pin the
   default explicitly now that the field exists.
3. **e2e — new `packages/extension-chrome/e2e/c4-any-provider-onboarding.spec.ts`**:
   - **Gemini (default, no picker interaction)**: `mockGemini(context)`, fill `#key`, click
     `#activate` → `settings.provider === 'gemini'`, `settings.apiKey` set, `settings.openaiApiKey`
     / `settings.anthropicApiKey` stay `''`.
   - **OpenAI**: click the OpenAI segment, fill `#key` with an `sk-…`-shaped fixture,
     `mockOpenAI(context)`, click `#activate` → `settings.provider === 'openai'`,
     `settings.openaiApiKey` set, `settings.apiKey === ''`, exactly one OpenAI mock call
     (`calls.count === 1`).
   - **Anthropic**: click the Claude segment, fill `#key` with an `sk-ant-…`-shaped fixture,
     `mockAnthropic(context)`, click `#activate` → `settings.provider === 'anthropic'`,
     `settings.anthropicApiKey` set, exactly one Anthropic mock call.
   - **Switch-preserves-key**: fill `#key` under Gemini, switch to OpenAI, fill a different `#key`,
     switch back to Gemini → `#key`'s value is the original Gemini text (proves the stash survives
     a real DOM round trip, not just the unit-test harness).
   - **Failed test on a non-default provider still rolls back correctly**: click OpenAI, fill a key,
     `mockOpenAI(context, { status: 400, body: ... })` → stays on `onboarding-view`, shows the
     OpenAI-flavoured rejection copy (`error-mapper.ts`'s `NAMES.openai` = `{product: 'OpenAI',
vendor: 'OpenAI'}` → `"OpenAI rejected the API key."`), and `chrome.storage.local`'s
     `settings.provider`/`openaiApiKey`/`hasKey` are all rolled back to their pre-onboarding values
     (proves `applyProviderKey`'s rollback path — C2's existing `chrome.storage.local.set({
settings: cur })` — restores the whole object, not just the touched field).
4. **Global constraint reminder (this repo, not new to this card):** build with `GEMINI_API_KEY`
   cleared (`GEMINI_API_KEY= bun run build:chrome`) — an ambient env key routes straight past
   `mountOnboarding` (`options.ts`'s `KEY_FROM_ENV` check), silently disabling every onboarding e2e
   including all of the above (the C10 flake, `docs/ROADMAP.md` §4 C10).

## 6. Testing performed (PR evidence — replaces screenshot/video capture)

Per this worktree's `CLAUDE.md` (owner ruling 2026-07-16): **no screenshots or video for this PR.**
The PR body's "Testing performed" section carries the suites run, test counts, e2e scenarios
exercised, and gates passed (lint, format check, typecheck both packages, unit, e2e), matching
exactly what §5 enumerates. No `pr-assets/*` branch is created for this card.

## 7. Risk / rollback

- **Risk: low-moderate.** The correctness-sensitive new logic is `applyProviderKey`'s field
  routing (a bug here could write a pasted OpenAI key into `apiKey`, silently corrupting the Gemini
  slot) and the picker's stash/sync pair (a bug could show the wrong provider's copy next to the
  wrong key). Both are directly covered by e2e assertions on `chrome.storage.local`'s exact fields
  (§5.3), not just UI text. Everything else (segmented-control rendering, copy tables) is additive
  and gated behind existing conditionals.
- **No data migration.** `Settings`/`PublicSettings` shapes are unchanged (`domain/types.ts` is not
  touched) — only _which_ existing field onboarding is now allowed to write differs.
- **Rollback:** revert the single PR. Pre-C4 behavior (onboarding always writes `apiKey`, provider
  picker absent) returns exactly as it was; no stored data becomes invalid, since `provider` and
  `openaiApiKey`/`anthropicApiKey` already existed as fields before this card (Settings-form could
  already write them).

## 8. Files touched (summary)

| File                                                               | Change                                                                                                                                                                                                                          |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/app/src/ui/onboarding-view.ts`                           | `OnboardingValue` + `provider`, `PROVIDER_LABEL`/`PROVIDER_INFO` tables, segmented-control markup/CSS, `_provider`/`_keys` fields, `commitKeyField`/`syncProviderRow`, provider-aware `submit`/`submitAnyway`/`setBusy`/`value` |
| `packages/extension-chrome/src/options.ts`                         | `applyProviderKey` helper, `configuredProvidersFor` import, `mountOnboarding`'s seeded value + `save`/`save-anyway` listeners made provider-aware                                                                               |
| `packages/app/test/ui/onboarding-view.test.ts`                     | + tests (§5.1)                                                                                                                                                                                                                  |
| `packages/extension-chrome/e2e/onboarding.spec.ts`                 | + one assertion (`settings.provider === 'gemini'`)                                                                                                                                                                              |
| `packages/extension-chrome/e2e/c4-any-provider-onboarding.spec.ts` | new — functional e2e (§5.3)                                                                                                                                                                                                     |

No change to `packages/app/src/wire.ts`, `packages/app/src/app/router.ts`,
`packages/app/src/domain/types.ts`, `packages/app/src/ui/settings-form.ts`, or any manifest file.
