# C5 — Key paste hygiene & format hints

Roadmap card: `docs/ROADMAP.md` §4 Category C, C5 (Impact 3 · Effort S · Score 3.0).
Depends on: — (independent; absent from the §5 dependency-map mermaid graph, confirming the
card's own "Depends on: —"). Sequenced after C1/C2 per the category's suggested order (§4 Category
C intro, "C1 → C2 → C5 → …"), but nothing in C5 itself reads C1/C2's output.

## 1. Problem (grounded in code)

The key input in both surfaces that collect a key saves whatever the user pasted, verbatim, with
only a bare `.trim()`:

- **Onboarding** (`packages/app/src/ui/onboarding-view.ts:156`) — `submit()` reads
  `this.q<HTMLInputElement>('#key').value.trim()` and, if non-empty, dispatches it straight into
  the `save` event (`onboarding-view.ts:162-168`). The placeholder `"Paste your key (AIza…)"`
  (`onboarding-view.ts:105`) is the only format guidance anywhere on the screen.
- **Settings** (`packages/app/src/ui/settings-form.ts`) — `commitKeyField()`
  (`settings-form.ts:436-438`) stashes `this.q<HTMLInputElement>('#key').value` into
  `this._keys[this._provider]` with **no trim at all**, on every provider switch
  (`settings-form.ts:273-277`) and again inside `collect()` (`settings-form.ts:563-580`) before
  save. The form has three provider-keyed slots — `_keys.gemini` / `_keys.openai` /
  `_keys.anthropic` (`settings-form.ts:235`) — sharing one visible `#key` input that morphs by
  provider (`syncKeyField()`, `settings-form.ts:456-486`), so a key typed while "Gemini" is
  selected is trusted to be a Gemini-shaped key with nothing checking that assumption.

Neither surface strips a trailing newline (an extremely common copy-paste artifact — Google AI
Studio's key page, most terminals, and many notes apps append one), nor a wrapping pair of quotes
(a paste from a chat app or a `.env`-style notes file — `"AIza…"` or the smart-quote
`"AIza…"` a chat client's autocorrect produces), nor checks that the pasted string's prefix
matches the field it landed in. A wrong-provider paste — an OpenAI `sk-…` key pasted into the
Gemini-only onboarding field, or a Claude `sk-ant-…` key pasted into the Gemini row of the
settings form while "Gemini" is still selected — is accepted with the same silent confidence as a
correct key.

**The failure is invisible and delayed.** `connection.test`'s round trip
(`packages/app/src/app/router.ts:200-209`) or the first real lookup is where any of these bad
pastes actually surfaces, as a generic `INVALID_KEY` (`packages/app/src/domain/error-mapper.ts:73,
84`) — by which point the user has left the one screen that could have told them what went wrong
and has no reason to suspect the _paste itself_, not their account, is the problem. This matches
the card's **Today**/**Missing** exactly.

**Existing precedent for provider-prefix knowledge already lives in the domain layer.**
`packages/app/src/domain/pii.ts:39-43`'s `scrubSecrets()` already recognizes the two shapes this
card needs (`/AIza[0-9A-Za-z_-]+/g` and `/sk-[0-9A-Za-z_-]{8,}/g`), for a different purpose
(masking a leaked key out of an error/log string, S1). C5 needs the same prefix vocabulary for a
new purpose — classifying a _pasted_ key before it's ever saved — so it gets its own small,
purpose-built module rather than overloading `scrubSecrets`'s redaction regexes for classification
(different job: `scrubSecrets` finds and masks a substring anywhere in free text; C5 classifies a
whole, already-isolated key string by its leading prefix).

## 2. Decision: a pure domain module, hint copy, and the prefix table (Lead call, per the card's "you decide")

**New file `packages/app/src/domain/key-hygiene.ts`** — dependency-free per `rule-domain-purity`
(`.claude/rules/domain-purity.md`: "NEVER … Import `ui/`, `app/`, `wire.ts`, or any npm library
into `domain/`"; "Import only from `./` (domain) and `../ports`"). It imports only `Provider` from
the sibling `./types`, exactly like `pii.ts`'s own "zero imports" claim (`pii.ts:8`) is really
"zero _outward_ imports." No port is added to `packages/app/src/ports.ts` — every operation is a
synchronous string function with no platform dependency (no `chrome.*`, no `fetch`, no DOM),
consistent with `pii.ts`'s own shape.

Consumed by **both** UI surfaces directly, matching how `settings-form.ts:5` already imports
domain types by relative path (`import type { Provider, Theme } from '../domain/types';`) — no
new port, no wire change, no router change. This is a pure client-side, presentation-adjacent
concern; nothing about it needs to leave the `ui/` layer or cross the extension's
content-script/service-worker boundary.

### 2.1 Rationale for three exported functions, not one

- **`normalize(raw): string`** — the paste-cleanup half (trim + de-quote). Called at the point a
  key is about to be _stored_ (submit/commit), not on every keystroke, so a key mid-paste is never
  mutated out from under the user while they're still typing/pasting into the field.
- **`classifyPrefix(key): KeyPrefixClass`** — the recognition half, exposed separately from the
  hint so it is independently table-testable (one input → one of four labels, no copy involved)
  and so a future card (e.g. C4 "Any-provider onboarding," §7 ranked summary, unscheduled) can
  reuse the classification without inheriting C5's specific hint wording.
- **`hintFor(targetProvider, normalizedKey): KeyHint | null`** — the copy-producing half, called
  live on every keystroke (via the existing `input` listeners both forms already have —
  `onboarding-view.ts:138`, and a new one added to `settings-form.ts`) so the hint appears the
  moment a mismatch or malformed shape is pasted, not only after Save/Activate is clicked.

### 2.2 The prefix table (Lead call)

| Prefix        | Provider    | Check order                                                                                    |
| ------------- | ----------- | ---------------------------------------------------------------------------------------------- |
| `AIza`        | `gemini`    | checked first (distinct prefix, no clash)                                                      |
| `sk-ant-`     | `anthropic` | checked **before** the shorter `sk-`                                                           |
| `sk-`         | `openai`    | checked last (would otherwise swallow `sk-ant-…` too, since `sk-ant-…` also starts with `sk-`) |
| anything else | `'unknown'` | no recognized shape — never treated as "wrong provider," only feeds the malformed check (§2.3) |

This exactly mirrors and extends `pii.ts:41-42`'s existing two regexes (`AIza…`, `sk-…`), adding
the one missing case those regexes never needed to distinguish: Anthropic's `sk-ant-` also matches
`sk-`'s pattern, so order matters for classification (redaction never cared which vendor a masked
key belonged to; hinting does).

### 2.3 Hint copy and the malformed heuristic (Lead call)

Two mutually exclusive hint reasons, checked in this order — **mismatch first** because it is the
more specific, more actionable diagnosis:

1. **Recognized-but-wrong-provider** — `classifyPrefix(key)` returns a provider that is not
   `targetProvider`: `"This looks like a ${otherLabel} key, not a ${targetLabel} key."`
2. **Malformed** — otherwise, if the key is implausibly short (`< 20` chars) or contains internal
   whitespace (a broken/partial paste `normalize()` didn't fully clean, e.g. a paste that kept an
   embedded newline): `"This doesn't look like a typical ${targetLabel} API key."` The `20`
   floor is deliberately conservative: Gemini's own `AIza…` keys — the shortest of the three
   real shapes this product talks to — run to ~39 characters, so anything under 20 reads as a
   truncated paste or placeholder text for **any** of the three providers, not a real key from any
   of them. This check applies **regardless of whether the prefix matched** — a key that starts
   with the right prefix but is obviously truncated (e.g. `"AIza"` alone) is still malformed.
3. Empty input produces **no hint** — that is the existing required-field validation's job
   (`onboarding-view.ts:157-161`'s own `setStatus('Paste your Gemini API key…', 'error')`), not
   C5's. `hintFor` returning `null` for `''` keeps the two concerns separate.

**S1 compliance, checked against copy, not just code:** every hint string interpolates only a
provider _label_ (`"Gemini"`, `"OpenAI"`, `"Anthropic (Claude)"`) — never `normalizedKey` itself.
No hint message can ever contain a fragment of the pasted key, satisfying
`.claude/rules/api-key-isolation.md`'s S1 even though this module sits outside the
service-worker/options-page boundary that rule's own "NEVER" list names (that list guards the
wire; this module guards the copy it emits, which is the analogous concern for a string that never
crosses a message boundary at all).

### Known, accepted limitation (documented, not a scope-fence break)

Several existing fixtures in this repo's own tests use deliberately short fake keys —
`'AIza-activated'` (14 chars, `onboarding.spec.ts:16`), `'AIza-real'` (9 chars,
`onboarding-view.test.ts:65`), `'AIza-typed'` (10 chars, `onboarding-view.test.ts:46`),
`'AIza-test'` (9 chars, `settings-form.test.ts:48`). After C5 ships, all of these will trigger the
new malformed-length hint (they are all under the 20-char floor). This is **expected and
harmless**: the hint is non-blocking by design (§4 scope fence), none of the existing tests assert
the _absence_ of a hint element (verified by reading each test above — they only assert on the
captured `save`/`submit` event payload or on stored settings), and every one of those flows still
saves and activates successfully today and after this change. New tests this plan adds use
realistic-length fixtures (≥20 chars) for the "no hint" cases specifically so the two concerns
(hint-copy correctness vs. save/activate correctness) stay independently verifiable.

## 3. The change

### 3.1 Domain — `packages/app/src/domain/key-hygiene.ts` (new file)

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
  ['“', '”'], // “ ” — smart double quotes
  ['‘', '’'], // ‘ ’ — smart single quotes
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

### 3.2 Barrel export — `packages/app/src/index.ts`

Add `export * from './domain/key-hygiene';` immediately after the existing
`export * from './domain/pii';` (`index.ts:6`), matching the file-per-line convention every other
domain module already follows in this barrel (`index.ts:1-11`). Not required by this plan's own UI
work (both consumers import the relative domain path directly, exactly as `settings-form.ts:5`
already does for `types.ts`) — added for barrel completeness/consistency with every sibling domain
module, and so a future `@ai-dict/app` consumer (a composition root, or C4) can reach it without
knowing the internal file layout.

### 3.3 Onboarding — `packages/app/src/ui/onboarding-view.ts`

1. Import: `import { normalize, hintFor } from '../domain/key-hygiene';`
2. Markup: insert a new hint paragraph right after the existing help line
   (`onboarding-view.ts:108`):

```html
<p id="key-help">Stored locally on this device only.</p>
<p id="key-hint" aria-live="polite" hidden></p>
```

3. CSS: add one rule right after the existing `#key-help{...}` rule (`onboarding-view.ts:63`),
   token-only per the design-tokens law:

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

No transition is applied to `#key-hint` (visibility is a plain `hidden` attribute toggle, not an
animated reveal), so no `prefers-reduced-motion` override is needed for this rule — consistent
with how `#key-help`/`#status` (which also just toggle `hidden`) carry none either.

4. New private method, called from the existing `key` `input` listener and from the `value`
   setter's hydration path (mirroring exactly how `refreshProgress()` is wired at both call sites —
   `onboarding-view.ts:138`, `onboarding-view.ts:149`, `onboarding-view.ts:198`):

```ts
private refreshKeyHint(): void {
  const hint = hintFor('gemini', normalize(this.q<HTMLInputElement>('#key').value));
  const el = this.q<HTMLElement>('#key-hint');
  el.textContent = hint?.message ?? '';
  el.hidden = hint === null;
}
```

- `key.addEventListener('input', () => { this.refreshProgress(); this.refreshKeyHint(); });`
  (extends the existing listener at `onboarding-view.ts:138`).
- Call `this.refreshKeyHint();` alongside the existing `this.refreshProgress();` at the end of
  `connectedCallback` (`onboarding-view.ts:149`).
- Call `this.refreshKeyHint();` alongside the existing `this.refreshProgress();` inside the `value`
  setter (`onboarding-view.ts:198`), so a hydrated (pre-filled) key is hint-checked too.
- The target provider is the literal `'gemini'` — onboarding has exactly one key field for exactly
  one provider (`OnboardingValue`, `onboarding-view.ts:9-12`, has no `provider` field); no
  parameterization needed here.

5. `submit()` (`onboarding-view.ts:155-169`): replace the bare `.trim()` with `normalize()`:

```ts
private submit(): void {
  const apiKey = normalize(this.q<HTMLInputElement>('#key').value);
  if (apiKey.length === 0) {
    this.setStatus('Paste your Gemini API key to activate the extension.', 'error');
    this.q<HTMLInputElement>('#key').focus();
    return;
  }
  this.dispatchEvent(/* unchanged */);
}
```

The rest of `submit()` — the empty-check, the `setStatus` error copy, the dispatched `save` event
shape — is untouched; only the input string itself is now paste-hygiene-cleaned before either path
runs.

### 3.4 Settings — `packages/app/src/ui/settings-form.ts`

1. Import: `import { normalize, hintFor } from '../domain/key-hygiene';` (alongside the existing
   `import type { Provider, Theme } from '../domain/types';` at `settings-form.ts:5`).
2. Markup: insert a new hint paragraph right after the existing help line
   (`settings-form.ts:157`), before `#env-notice`:

```html
<p id="key-help">Stored locally on this device only.</p>
<p id="key-hint" aria-live="polite" hidden></p>
<p id="env-notice" class="env-notice" hidden></p>
```

3. CSS: add one rule right after the existing `#key-help,#tpl-help{...}` rule
   (`settings-form.ts:100`), token-only:

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

Same no-transition reasoning as §3.3 — a `hidden`-attribute toggle needs no reduced-motion guard.

4. New private method:

```ts
private refreshKeyHint(): void {
  const el = this.q<HTMLElement>('#key-hint');
  if (this.isKeyLocked()) {
    // Env-locked field (build-baked GEMINI_API_KEY): nothing the user typed, nothing to hint about.
    el.hidden = true;
    return;
  }
  const hint = hintFor(this._provider, normalize(this.q<HTMLInputElement>('#key').value));
  el.textContent = hint?.message ?? '';
  el.hidden = hint === null;
}
```

- New listener, added next to the existing key `focus`/`blur` listeners
  (`settings-form.ts:265-272`): `key.addEventListener('input', () => this.refreshKeyHint());`
- Call `this.refreshKeyHint();` as the **last line** of `syncKeyField()`
  (`settings-form.ts:456-486`) — `syncKeyField()` already re-renders the visible key row for
  whichever provider is now selected (including the locked-state branch), so appending the hint
  refresh there means every call site that already re-renders the key row (the provider-change
  listener at `settings-form.ts:273-277`, the `value` setter's hydration at
  `settings-form.ts:609`, and `connectedCallback`'s own explicit `this.syncKeyField();` at
  `settings-form.ts:345`) gets the hint refreshed for free — no new call sites, matching the
  "enforce the lock last" comment already at `settings-form.ts:344` in spirit: the hint, like the
  lock, is a property of "what key row is showing right now."

5. `commitKeyField()` (`settings-form.ts:436-438`) — normalize on stash, the one place a value ever
   moves from the visible input into the per-provider `_keys` stash:

```ts
private commitKeyField(): void {
  if (!this.isKeyLocked()) this._keys[this._provider] = normalize(this.q<HTMLInputElement>('#key').value);
}
```

This single change covers every path that ends in a stored key: a provider switch calls
`commitKeyField()` before `syncKeyField()` (`settings-form.ts:274`), and `collect()` calls
`commitKeyField()` as its first line (`settings-form.ts:566`) before reading `this._keys.*` into
the emitted `SettingsFormValue`. No change is needed inside `collect()` itself — by the time it
runs, every stashed value that could still be dirty has already been normalized by the most recent
`commitKeyField()` call, and values hydrated from storage via the `value` setter
(`settings-form.ts:590-594`) are assumed already-normalized (they were normalized on their own
save, the last time this same code path ran).

## 4. Scope fence (from the card, held exactly)

- **Heuristic hints, never hard blocks.** `hintFor` never prevents `submit()`
  (onboarding) or the `save` dispatch (settings) from firing — its only effect is inline copy. No
  new validation branch is added to either submit path; the existing empty-key check
  (`onboarding-view.ts:157`) is the only thing that can still block a save, and it is unchanged.
- **The key never appears in any log or message (S1).** Every hint string interpolates only a
  provider label (§2.3); `normalizedKey` itself is never placed in a message, a thrown error, or
  any wire payload — this module has no wire/log call sites at all (pure functions, called
  synchronously from the UI layer only).
- **Pure client-side string checks.** `key-hygiene.ts` has zero network calls, zero `chrome.*`
  calls, zero DOM access (rule-domain-purity) — `classifyPrefix`/`normalize`/`hintFor` are ordinary
  synchronous string functions, unit-testable with no fakes/mocks/DOM at all.

## 5. Testing strategy

1. **Domain unit tests** (new `packages/app/test/key-hygiene.test.ts`, modeled on
   `packages/app/test/pii.test.ts`'s exhaustive-table style): a `describe` block per exported
   function.
   - `normalize`: trims plain whitespace; trims a trailing newline; strips one layer of straight
     double quotes; strips one layer of straight single quotes; strips one layer of smart double
     quotes (`“…”`); strips one layer of smart single quotes; strips quotes AND
     re-trims inner whitespace (`'  "  AIza…  "  '`); leaves an unquoted key untouched; leaves a
     key with an internal (non-wrapping) quote untouched; empty string in → empty string out.
   - `classifyPrefix`: `'AIza…'` → `'gemini'`; `'sk-ant-…'` → `'anthropic'`; `'sk-…'` (no `-ant-`)
     → `'openai'`; confirms `'sk-ant-…'` is never misclassified as `'openai'` (the ordering
     regression this table exists to pin); random text → `'unknown'`; empty string → `'unknown'`.
   - `hintFor`: matching prefix + plausible length → `null`; empty key → `null`; wrong-but-known
     prefix (all 6 provider pairs: gemini↔openai, gemini↔anthropic, openai↔anthropic each
     direction) → mismatch message naming both providers by label, never the key; unknown prefix +
     `< 20` chars → malformed message; unknown prefix + `>= 20` chars of plausible-looking noise →
     `null` (an unrecognized-but-plausible-length key, e.g. a hypothetical fourth provider, gets no
     hint — never punished merely for not matching a known prefix); matching prefix but `< 20`
     chars (e.g. `'AIza'` alone) → malformed message (mismatch check doesn't suppress the length
     check when the prefix DOES match); key containing internal whitespace → malformed message
     regardless of length; asserts every returned message's `.message` never contains the raw input
     substring (S1 regression guard, run across the whole mismatch/malformed table).
2. **UI component tests** — `packages/app/test/ui/onboarding-view.test.ts` (extends the existing
   `<onboarding-view>` describe block):
   - Typing a key with leading/trailing whitespace and wrapping quotes shows no `#key-hint` if the
     de-quoted, trimmed result is a plausible same-provider key (realistic ≥20-char `AIza…`
     fixture).
   - Typing an OpenAI-shaped `sk-…` key shows `#key-hint` visible, containing "OpenAI" and "Gemini".
   - Typing a short unrecognized string shows `#key-hint` visible with the malformed copy.
   - Clearing the field back to empty hides `#key-hint` again.
   - Extends the existing `'emits "save" with the trimmed key and chosen language on activate'`
     test (`onboarding-view.test.ts:62-75`) to also cover a quote-wrapped, newline-padded input
     (`'  "AIza…"\n'`) resolving to the fully de-quoted, trimmed value in the dispatched `save`
     event.
3. **UI component tests** — `packages/app/test/ui/settings-form.test.ts` (new `describe` block,
   alongside the existing `<settings-form> provider selection` block):
   - Selecting Gemini and typing an Anthropic-shaped `sk-ant-…` key shows the mismatch hint naming
     both providers.
   - Switching the provider select to Anthropic and back to Gemini re-evaluates the hint against
     whichever key is now stashed for the visible provider (proves the `syncKeyField()`-tail wiring
     from §3.4).
   - `keyFromEnv = true` (Gemini locked) never shows a hint even if the OTHER (OpenAI/Anthropic)
     stashed key would otherwise trigger one — proves the `isKeyLocked()` guard in
     `refreshKeyHint()`.
   - Extends the existing `'emits "save" with the collected form value'` test
     (`settings-form.test.ts:30-59`) with a quote/whitespace-padded key typed into `#key`, asserting
     the emitted `SettingsFormValue.apiKey` is the normalized value.
   - A padded/quoted key typed for one provider, then the provider switched away and back, is
     normalized in the eventually-saved `SettingsFormValue` (proves `commitKeyField()`'s
     normalization survives a switch, not just a same-provider save).
4. **e2e functional test** (new `packages/extension-chrome/e2e/c5-key-hygiene.spec.ts`, modeled on
   `packages/extension-chrome/e2e/onboarding.spec.ts`'s existing first test
   (`onboarding.spec.ts:7-31`), using `storageDump` from `helpers.ts:62-64` rather than reinventing
   an inline `page.evaluate`):
   - Pasting a whitespace-padded, quote-wrapped Gemini-shaped key into the onboarding key field and
     activating stores the fully-cleaned key (`chrome.storage.local`'s `settings.apiKey` equals the
     de-quoted, trimmed string, not the raw padded/quoted paste).
   - Typing an OpenAI-shaped key into the same field shows the visible `#key-hint` mismatch copy
     before any submit — proving the hint is live, not just a submit-time side effect.
   - **Build note carried into the plan's e2e task:** this spec must build with `GEMINI_API_KEY`
     unset — a build-time-baked key flips `options.ts:211`'s route straight to `mountSettings`,
     skipping `mountOnboarding` entirely, so the onboarding screen this spec drives would never
     render (the same live flake the roadmap campaign's own learnings bank already records:
     `docs/superpowers/campaign/2026-07-16-run-the-roadmap.md:36`, "Shell `GEMINI_API_KEY` bakes
     env-key builds that break no-key e2e tests").

## 6. Evidence plan

Per the **current, owner-ruled convention** (`CLAUDE.md`, "Evidence policy (owner ruling
2026-07-16)"): screenshots/videos are retired for PRs opened from this date forward — every PR
body instead carries a written **"Testing performed"** section. (The B-series exemplar this spec's
structure otherwise follows, `2026-07-16-b5-status-lifecycle-design.md` §6, still specifies a
`.webm` capture; that reflects the pre-ruling convention in force at the moment B5 was authored
earlier the same day. C5 is authored after the ruling took effect, so it follows the new
convention — no video-evidence spec is planned.)

The PR's "Testing performed" section will state, in prose, the exact suites/counts/scenarios that
ran (once the plan's tasks land): the `key-hygiene.test.ts` table-test count, the extended
`onboarding-view.test.ts`/`settings-form.test.ts` assertions, and the `c5-key-hygiene.spec.ts` e2e
scenario names — plus confirmation that `bun run lint`, `bun run format:check`, the full `bun run
test` suite, and `bun run typecheck` (both packages) all passed.

## 7. Risk / rollback

- **Risk:** low. Additive-only: one new dependency-free domain file, one new barrel export line,
  one new hidden-by-default paragraph + one CSS rule in each of two existing UI components, one new
  `input` listener wired the same way each component already wires its other `input` listener(s),
  and a `.trim()` → `normalize()` swap plus an unconditional-assignment → `normalize()`-wrapped
  assignment in two existing functions (`submit()`, `commitKeyField()`). No wire message changes,
  no router changes, no schema changes, no new manifest permission. The activation/save success
  path for a well-formed key is unchanged — `normalize()` on an already-clean key is a no-op
  (nothing to trim, no wrapping quotes to strip), so a key with no paste artifacts round-trips
  identically before and after this change.
- **Rollback:** revert the single PR. `key-hygiene.ts` is never imported outside `ui/`, so removing
  it removes nothing else; no stored data shape changes (a key normalized before this change's
  revert stays valid — normalization only ever narrows a string, never invalidates a
  previously-accepted one).

## 8. Files touched (summary)

| File                                                   | Change                                                                              |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `packages/app/src/domain/key-hygiene.ts`               | new — `normalize`, `classifyPrefix`, `hintFor`, `KeyPrefixClass`, `KeyHint`         |
| `packages/app/src/index.ts`                            | + barrel export                                                                     |
| `packages/app/src/ui/onboarding-view.ts`               | + `#key-hint` markup/CSS, `refreshKeyHint()`, `submit()` uses `normalize()`         |
| `packages/app/src/ui/settings-form.ts`                 | + `#key-hint` markup/CSS, `refreshKeyHint()`, `commitKeyField()` uses `normalize()` |
| `packages/app/test/key-hygiene.test.ts`                | new — exhaustive table tests                                                        |
| `packages/app/test/ui/onboarding-view.test.ts`         | + hint + normalize tests                                                            |
| `packages/app/test/ui/settings-form.test.ts`           | + hint + normalize tests                                                            |
| `packages/extension-chrome/e2e/c5-key-hygiene.spec.ts` | new — functional e2e (no evidence-video spec; see §6)                               |

No change to `packages/app/src/domain/types.ts`, `packages/app/src/ports.ts`, `packages/app/src/wire.ts`,
`packages/app/src/app/router.ts`, or either composition root (`content.ts`/`side-panel.ts`/`options.ts`) —
`options.ts`'s own save handlers (`options.ts:189-206`, `options.ts:113-134`) already just persist
whatever `OnboardingValue`/`SettingsFormValue` the components dispatch, and those values now simply
arrive pre-cleaned.
