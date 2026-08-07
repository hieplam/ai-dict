# C9 — Setup health check (design)

Roadmap card: `docs/ROADMAP.md` §4 Category C, C9 (Impact 3 · Effort M · Score 1.5).
Depends on: — (independent). Sequenced last in Category C (§4 "Sequencing the lead should
follow"). Standing walls inherited from the Category C intro: no backend/accounts · every LLM
call user-triggered · no new manifest permissions · privacy surface unchanged · S1 key isolation.

## 1. Problem (grounded in code)

Today, diagnosing a broken setup means visiting three unrelated places, none of which the reader
would think to check together:

- **Connection test is buried.** `settings-form.ts`'s Connection section has one generic
  `#test`/`test-connection` button (`packages/app/src/ui/settings-form.ts:159-161`) that fires a
  `connection.test` wire message (`packages/app/src/wire.ts:129`), handled by
  `handleConnectionTest` (`packages/app/src/app/router.ts:195-211`), which runs one real
  `deps.client.lookup(...)` call against whichever provider is currently selected and replies
  `{ ok: true, type: 'ack' }` or `{ ok: false, type: 'connection.test', error }`. Nothing near the
  button explains what it costs or what it's actually testing.
- **Shortcut assignment is invisible.** `manifest.json:19-28` declares three commands
  (`define-selection`, `dismiss-lookup`, `send-to-panel`) with **no `suggested_key`** — every
  fresh install starts with all three unassigned, discoverable only by knowing to type
  `chrome://extensions/shortcuts` into the omnibox. `sw.ts:189` (`chrome.commands.onCommand`)
  proves the `commands` manifest key is already live; nothing in the product ever reads
  `chrome.commands.getAll()` today (confirmed: no call to it anywhere in
  `packages/extension-chrome/src`).
- **Configured-provider state is computed but never surfaced as a checklist.** `options.ts`'s
  `wireSettings`'s `save` handler already derives `configured: Provider[]`
  (`packages/extension-chrome/src/options.ts:116-119`, one push per provider with a non-empty
  key) and persists it as `configuredProviders` alongside `hasKey` — but nothing renders it back
  to the user. The pure derivation already exists as `configuredProvidersFor`
  (`packages/app/src/domain/types.ts:101-110`), accepting an optional `envGeminiKey` flag for the
  build-baked-key case (`options.ts:28`, `KEY_FROM_ENV`) — it is simply never called for display,
  only for the write path.

**The gap is entirely UI + read-only wiring.** Every piece C9 needs already exists (the wire
message, the derivation function, the `commands` manifest key); nothing new needs inventing at
the protocol level — only a place to show it, one small pure "which rows are broken" function,
and two lines of new chrome API surface in the one place (`options.ts`) allowed to call it.

## 2. Decision: where it lives, and the v1 check list (Roadmap's "Lead decides")

**New section in the existing Settings screen, titled "Check my setup", inserted immediately
after the Connection section and before Translation** (`settings-form.ts`'s `MARKUP`, right after
the `</section>` that currently closes Connection at line 162). Rationale:

1. **No new page, no new surface.** `SettingsForm` (`packages/app/src/ui/settings-form.ts`) is the
   one screen every reader already reaches when something is wrong (the no-key card's "Open
   Settings" button, per the Category C intro's funnel description) — adding a section there
   costs nothing architecturally and matches B5/B7's own precedent of extending an existing
   surface over inventing a new one.
2. **Immediately after Connection, not inside it.** Connection is an _editable form section_
   (provider picker, key field); "Check my setup" is a _read-mostly diagnostic_ — keeping them as
   sibling sections (rather than cramming diagnostics into the editable one) keeps the existing
   Connection section's tests and structure untouched and gives the new section its own
   `aria-labelledby` landmark.
3. **The existing `#test`/`test-connection` button relocates into the new section** (it does not
   duplicate) — it becomes the "active provider responds" row's action, verbatim same id and
   event name, so every existing test that clicks `settings-form #test` or asserts the
   `test-connection` custom-event contract (`app/test/ui/settings-form.test.ts:61-80,161-171`,
   `extension-chrome/e2e/options-actions.spec.ts:47-73`) keeps passing unchanged — none of them
   assert _where_ in the DOM the button sits, only that it exists and behaves.

### v1 check list (the Roadmap's "Lead decides: check list v1", resolved here)

Exactly the three rows the card names, in this order — **nothing else** (no rate-limit checks, no
cache-size checks, no history-count checks; those are different cards' territory or no card's at
all):

1. **API keys** — one row per known provider (`gemini`, `openai`, `anthropic`, in `PROVIDERS`
   canonical order), each showing Configured/Missing, sourced from a **live, local** re-run of the
   same `configuredProvidersFor` function `options.ts` already uses to persist
   `configuredProviders` — see §3.2. No wire round trip: the settings form already holds every key
   it needs in memory.
2. **Active provider responds** — the relocated `#test` button plus one line of copy disclosing
   the token cost, wired to the same `connection.test` message, unchanged.
3. **Keyboard shortcuts** — one row per command Chrome reports via `chrome.commands.getAll()`,
   Assigned/Not assigned, plus one "Assign shortcuts" action.

## 3. The change

### 3.0 Wire-protocol self-verification (attestation)

**Zero wire messages added, zero changed.** Row 1 needs no wire traffic at all (computed from the
settings form's own already-in-memory state). Row 2 reuses `connection.test`
(`wire.ts:129`, `WireMessageSchema`) **exactly as it exists today** — same request shape (empty
payload), same reply shape (`{ok:true,type:'ack'}` / `{ok:false,type:'connection.test',error}`),
same router case (`router.ts:270-271`). Row 3 needs no wire traffic either — `chrome.commands` is
a direct browser API available in the options-page context (§3.4 verifies this). Confirmed by
reading `wire.ts` in full; no diff to that file appears anywhere in this plan, and there is
therefore no "wire schema + router" task.

### 3.1 Domain — new file `packages/app/src/domain/setup-health-policy.ts`

Two small, pure, dependency-free functions (rule-domain-purity: no `chrome.*`, no DOM, imports
only from `./types`) — the "which rows are broken" decision logic, kept out of the UI layer so it
is unit-testable without mounting a component:

```ts
import { PROVIDERS, type Provider } from './types';

/** C9: one row of the "API keys" check — one per known provider, in PROVIDERS order. */
export interface KeyStatusRow {
  provider: Provider;
  configured: boolean;
}

/**
 * C9: derive the per-provider key-presence rows, in canonical PROVIDERS order, from whatever
 * list of currently-configured providers the caller computed (typically
 * `configuredProvidersFor` run against the settings form's live, possibly-unsaved key state —
 * see settings-form.ts §3.2). Pure: no chrome/DOM, safe to unit test directly.
 */
export function deriveKeyStatusRows(configured: readonly Provider[]): KeyStatusRow[] {
  return PROVIDERS.map((provider) => ({ provider, configured: configured.includes(provider) }));
}

/**
 * C9: the minimal structural shape this file needs out of a chrome.commands.Command — declared
 * locally (not imported from `chrome-types` or any chrome lib) so this file stays chrome-free.
 * `options.ts`'s raw `chrome.commands.getAll()` result satisfies this shape structurally; no cast
 * needed at the call site beyond TypeScript's structural typing.
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
 * `shortcut` string — `chrome.commands.getAll()` returns `shortcut: ''` (never undefined) for an
 * unassigned command in practice, but `name`/`description`/`shortcut` are still guarded
 * defensively since the `Command` type itself declares all three optional.
 */
export function deriveShortcutRows(commands: readonly CommandLike[]): ShortcutStatusRow[] {
  return commands.map((c) => ({
    name: c.name ?? '',
    description: c.description ?? '',
    assigned: Boolean(c.shortcut),
  }));
}
```

Exported via `packages/app/src/index.ts` (`export * from './domain/setup-health-policy';`), same
pattern as every other domain module.

### 3.2 UI — `packages/app/src/ui/settings-form.ts`: markup

New imports (extend the existing `../domain/types` import line):

```ts
import { PROVIDERS, configuredProvidersFor, type Provider, type Theme } from '../domain/types';
import {
  deriveKeyStatusRows,
  deriveShortcutRows,
  type ShortcutStatusRow,
} from '../domain/setup-health-policy';
```

**Remove** the Connection section's `.inline-actions` block (current lines 159-161, the lone
`#test` button) from the Connection `<section>`. **Insert** a new sibling section right after
Connection's closing `</section>` and before the Translation section:

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
        nothing opens (Chrome does not guarantee extensions may navigate there — see §3.5), copy
        this address into a new tab yourself:
        <code class="health-url">chrome://extensions/shortcuts</code></p>
    </section>
```

The Connection `<section>` itself is otherwise untouched (provider select, key field, reveal
button, key-help, env-notice all stay exactly where they are).

`KEY_LABEL` (already defined, `settings-form.ts:49-53`) is reused verbatim for the row labels —
no new label constant.

Note: `#shortcut-rows` starts **empty** — Row 3's actual `<div>` children are created dynamically
by the `shortcuts` setter (§3.3), never baked into the static `MARKUP` string. This is
deliberate, not an oversight: `Provider`/`PROVIDERS` are native to this package's own domain (safe
to reference in static markup), but the three concrete command names
(`define-selection`/`dismiss-lookup`/`send-to-panel`) are declared in
`packages/extension-chrome/src/manifest.json` and `command-messages.ts` — a **downstream**
package. Per the lean dependency rule (`c3-1 app` must never import from `c3-2
extension-chrome`), `settings-form.ts` cannot know those names at all; it only knows the generic
`{name, description, assigned}` shape `ShortcutStatusRow` describes, fed to it by whichever
composition root (Chrome or, someday, Safari) owns the real command list. This keeps the
component portable exactly the way B1–B5's shared UI already is.

### New CSS (append to `settings-form.ts`'s `CSS` template, token-only)

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

Every rule reads only `--ad-*`/`--adp-*` tokens (token law) — `.health-badge`'s default color is
`--ad-error` (matches `#status.error`'s existing usage of the same token, `settings-form.ts:121`);
`.health-badge.ok` is `--ad-accent-ink` (matches `.status-btn[aria-pressed="true"]`'s existing
usage in `lookup-card.ts:171`). No new token is introduced.

### 3.3 UI — `packages/app/src/ui/settings-form.ts`: behavior

**Row 1 + Row 2 (key rows + active-provider label) share one render method**, called whenever
anything that affects them changes — initial `connectedCallback`, every `#key` input, `#provider`
change, and the `value` setter:

```ts
/**
 * C9: recompute + repaint the "API keys" rows and the active-provider label. Reads the key
 * currently displayed in `#key` for the SELECTED provider (not yet committed to `_keys` — typing
 * updates the row live, before Save) and the stashed `_keys` for every other provider (accurate,
 * since only the selected provider's field is ever visible/editable at once).
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
    this.q<HTMLElement>(`#key-status-${row.provider}-badge`).textContent = row.configured
      ? 'Configured'
      : 'Missing';
    this.q<HTMLElement>(`#key-status-${row.provider}-badge`).classList.toggle('ok', row.configured);
    this.q<HTMLElement>(`#key-status-${row.provider}-fix`).hidden = row.configured;
  }
  this.q<HTMLElement>('#health-active-label').textContent = `${KEY_LABEL[this._provider].replace(' API key', '')} responds`;
}
```

Call sites added: end of `connectedCallback` (after `syncKeyField()`), inside the `#key` input
listener (new — add one; today `#key` has no dedicated listener, only the form-wide
`markDirtyOnEdit`), inside the `#provider` `change` listener (after `syncKeyField()`), and at the
end of the `value` setter (after `syncKeyField()`/`clearDirty()`).

**"Add key" fix buttons** — one click handler per provider, bound once in `connectedCallback` via
a loop over `PROVIDERS`:

```ts
for (const p of PROVIDERS) {
  this.q<HTMLButtonElement>(`#key-status-${p}-fix`).addEventListener('click', () =>
    this.jumpToProviderKey(p),
  );
}
```

```ts
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

This mirrors exactly what the existing `#provider` `change` listener already does
(`commitKeyField()` → set `_provider` → `syncKeyField()`) plus a focus call — no new state
machine.

**Row 2** needs no new behavior beyond relocating `this.relay('#test', 'test-connection')` (kept
verbatim) into the new markup's location; `options.ts`'s `test-connection` handler
(`options.ts:150-156`) is untouched.

**Row 3** — a `shortcuts` setter, mirroring the existing `keyFromEnv`/`errorReporting` setter
pattern (plain data in, no event out):

```ts
private _shortcuts: ShortcutStatusRow[] = [];

/** C9: the current keyboard-shortcut assignment state, supplied by the composition root (the
 * only layer allowed to call `chrome.commands.getAll()`). Renders one row per entry; empty until
 * the composition root's first `chrome.commands.getAll()` resolves (near-instant, no I/O). */
set shortcuts(rows: ShortcutStatusRow[]) {
  this._shortcuts = rows;
  if (this.shadowRoot) this.renderShortcutRows();
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

Built with `createElement`/`textContent` (never `innerHTML`) — not an S4 concern (command
descriptions are developer-authored manifest strings, never model output), but keeping every
dynamic-row builder in this file the same shape avoids a one-off pattern.

`this.relay('#assign-shortcuts', 'open-shortcuts-page')` — a new, zero-payload relay event,
exactly like the four existing ones (`this.relay('#test', ...)` etc., `settings-form.ts:309-312`).

If `this._pendingValue` flushes in `connectedCallback`, also call `renderHealthRows()` there (the
`value` setter itself already will, once flushed — see the deferred-value branch at
`connectedCallback`'s tail).

### 3.4 Composition root — `packages/extension-chrome/src/options.ts`

```ts
import { deriveShortcutRows, type ShortcutStatusRow } from '@ai-dict/app';
```

In `mountSettings`, after `wireSettings(form)`:

```ts
void refreshShortcuts(form);
form.addEventListener('open-shortcuts-page', () => {
  void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }).catch(() => undefined);
});
// C9: the reader's most likely path back from chrome://extensions/shortcuts is refocusing this
// tab — re-read on focus so a just-assigned shortcut flips to "Assigned" without a manual reload.
window.addEventListener('focus', () => void refreshShortcuts(form));
```

```ts
async function refreshShortcuts(form: SettingsForm): Promise<void> {
  const commands = await chrome.commands.getAll();
  (form as unknown as { shortcuts: ShortcutStatusRow[] }).shortcuts = deriveShortcutRows(commands);
}
```

`chrome.commands.getAll()` needs no permission beyond the `commands` manifest key already
declared (`manifest.json:19-28`) — it is a direct call from the options-page's own JS context, no
`chrome.runtime.sendMessage` round trip, because **the options page already has a `chrome.*`
namespace of its own** (it is an extension page, not a content script) — the same reason
`chrome.storage.local` is read directly in `load()` (`options.ts:46`) rather than proxied through
the service worker. No new wire message, no new router case (§3.0).

`window.addEventListener('focus', ...)` is added inside `mountSettings`'s scope (only while the
settings screen — not onboarding — is mounted); it is never removed, matching every other
top-level listener this file already registers without a teardown (the options page has no
SPA-style unmount).

### 3.5 Verified constraint: opening `chrome://extensions/shortcuts` from an extension page

**Checked, not assumed.** Chrome's official `chrome.commands` reference documents only that "the
user can manually add more shortcuts from the `chrome://extensions/shortcuts` dialog"; it does
**not** document (confirm or deny) that `chrome.tabs.create({url: 'chrome://extensions/shortcuts'})`
is a supported, guaranteed navigation for an extension to trigger. `chrome.tabs.create()` itself
needs no `"tabs"` permission (most `chrome.tabs` methods don't; only reading sensitive tab fields
like `url`/`title` on tabs an extension doesn't own does) — so no manifest change either way — but
whether Chrome actually completes the navigation to that specific privileged URL, versus silently
blocking it, is not a documented contract, and `chrome.tabs.create`'s returned Promise resolves
successfully either way (the extension side cannot distinguish "opened" from "silently blocked").

**Design consequence:** the "Assign shortcuts" button's `chrome.tabs.create` call is best-effort
only. The plain, selectable `chrome://extensions/shortcuts` text (`.health-url`, §3.2) is
therefore rendered **unconditionally**, not as an on-failure fallback — there is no reliable
success signal to gate it on. This satisfies the scope fence's "one-click fix or deep link" with
a guaranteed-working manual path underneath.

## 4. Scope fence (from the card, held exactly)

- **Read-only except the explicit connection test.** Rows 1 and 3 read existing/derived state and
  a direct browser API; nothing they do writes anything or calls an LLM. Row 2 makes exactly one
  real provider call, and only on an explicit click (constraint 4: every LLM call user-triggered)
  — identical behavior to today's `connection.test`, just relabeled and disclosed.
- **Runs only on click — nothing in the background.** `chrome.commands.getAll()` runs on mount and
  on `window focus` (both are the options page being actively looked at, not a background timer);
  no `setInterval`/alarm is added anywhere.
- **No new permissions.** `commands` is already declared (`manifest.json:19-28`);
  `chrome.commands.getAll()` and `chrome.tabs.create()` both need nothing beyond what's already
  granted (§3.4, §3.5).
- **S1 — key never in diagnostics output.** Every row renders a **boolean** (`Configured`/
  `Missing`, `Assigned`/`Not assigned`) derived via `configuredProvidersFor`/`deriveShortcutRows` —
  neither function's return type carries a key string or a `shortcut` value's content beyond
  whether it's non-empty. `KeyStatusRow`/`ShortcutStatusRow` have no field that could hold a
  secret. This never crosses the wire either (§3.0), so `PublicSettingsSchema`'s existing
  `z.strictObject` S1 guarantee (`wire.ts:61-68`) is not even in play — the stronger guarantee is
  that the diagnostic UI itself has no code path capable of reading `apiKey`/`openaiApiKey`/
  `anthropicApiKey` into anything it displays.
- **No B6/other-card scope creep.** No provider "quota remaining" check, no rate-limit check, no
  cache/history diagnostics — exactly the three rows the card names (§2's v1 check list).

## 5. Testing strategy

1. **Domain unit tests** (`packages/app/test/setup-health-policy.test.ts`): `deriveKeyStatusRows`
   returns all three providers in canonical order with correct `configured` booleans for an
   arbitrary subset; empty input → all `false`. `deriveShortcutRows` maps `assigned` from a
   non-empty `shortcut` string, treats `''`/`undefined`/missing fields defensively, preserves
   input order.
2. **UI component tests** (`packages/app/test/ui/settings-form.test.ts`, extended): initial mount
   shows all three key rows `Missing` with fix buttons visible; typing a key into `#key` for the
   selected provider flips that row to `Configured` live (before Save); switching `#provider`
   updates which row reflects the visible field and the active-provider label; clicking a fix
   button switches provider + focuses `#key`; env-locked Gemini always shows `Configured` with no
   fix button; `#test` still fires `test-connection` and still exists (regression guard for the
   relocation); `shortcuts` setter renders one row per entry with the right Assigned/Not-assigned
   badge, and re-renders cleanly on a second call (no leaked children); `open-shortcuts-page`
   fires on the Assign-shortcuts click; axe violations still `[]` with the new section present.
3. **e2e functional test** (new `packages/extension-chrome/e2e/c9-setup-health-check.spec.ts`):
   seeded settings with only a Gemini key present shows Gemini `Configured` and OpenAI/Anthropic
   `Missing` with visible fix buttons; clicking OpenAI's fix button switches the provider select
   and focuses the OpenAI key field; the shortcuts section shows all three commands `Not assigned`
   (manifest declares no `suggested_key` — true out of the box in the bundled Chromium, no mock
   needed, see §3.5's grounding); the relocated `#test` button still reports `Connection OK` via
   `mockGemini`, proving the move didn't regress `connection.test`.
4. **No new evidence-video spec.** Per the owner's 2026-07-16 evidence-policy ruling
   (`CLAUDE.md`; `docs/ROADMAP.md` §8 Decision Log, same date), media capture is retired
   campaign-wide — the PR carries a written "Testing performed" section instead (suites, counts,
   e2e scenarios, gates), not a `.webm`.

## 6. Risk / rollback

- **Risk: low.** Purely additive UI + two new domain functions + a relocated button + one new
  direct-`chrome.*` call in the one file already trusted to hold the API key
  (`rule-api-key-isolation`: "the options page" is one of the two trusted contexts). No wire
  schema touched, no existing message's shape changed, no existing router case touched. The one
  behavior change to _existing_ code is the `#test` button's DOM position, covered by the
  regression assertions in §5.2/§5.3.
- **Rollback:** revert the single PR. No persisted data shape changes (nothing new is written to
  `chrome.storage.local` by this card — `configuredProviders`/`hasKey` are already written by the
  existing `save` handler); rollback leaves storage exactly as valid as it is today.

## 7. Files touched (summary)

| File                                                          | Change                                                             |
| ------------------------------------------------------------- | ------------------------------------------------------------------ |
| `packages/app/src/domain/setup-health-policy.ts`              | new — `deriveKeyStatusRows`, `deriveShortcutRows` + types          |
| `packages/app/src/index.ts`                                   | + re-export the new domain module                                  |
| `packages/app/src/ui/settings-form.ts`                        | + "Check my setup" section, relocate `#test`, new rows/setter      |
| `packages/extension-chrome/src/options.ts`                    | + `chrome.commands.getAll()` wiring, `open-shortcuts-page` handler |
| `packages/app/test/setup-health-policy.test.ts`               | new — domain unit tests                                            |
| `packages/app/test/ui/settings-form.test.ts`                  | + tests for the new section                                        |
| `packages/extension-chrome/e2e/c9-setup-health-check.spec.ts` | new — functional e2e                                               |

No change to `packages/app/src/wire.ts`, `packages/app/src/app/router.ts`,
`packages/app/src/domain/types.ts`, `packages/app/src/ports.ts`, `packages/extension-chrome/src/manifest.json`,
or `packages/extension-chrome/src/side-panel.ts` (Setup health is options-page-only; the side
panel never mounts `settings-form`).

## 8. Self-review

No `TBD`s remain. Every decision in §2–§3.5 is either grounded in a read file:line or explicitly
marked as this spec's own ruling (the Roadmap's "Lead decides"). §3.5 resolves the one genuinely
uncertain external constraint (chrome:// navigation) by designing around the uncertainty (always
render the fallback) rather than assuming success. No contradiction between §3.0's "zero wire
changes" and §5's testing strategy (all three e2e assertions exercise either existing wire
messages or direct browser/DOM state). No contradiction between the "read-only" scope fence and
Row 2 (explicitly named as the one exception, matching the card's own wording verbatim).
