# "Open in side panel" Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an icon-only "Open in side panel" button to the lookup card's action cluster (Chrome only) that promotes the current lookup into the docked side panel and dismisses the in-page bottom sheet.

**Architecture:** The shared `lookup-card` (in `packages/app`) renders the button only when a `side-panel` attribute is present and emits a composed `open-side-panel` DOM event — staying platform-agnostic. The Chrome composition root (`InlineBottomSheetRenderer` flag → content script) sets the attribute and relays the event to the service worker, which calls `chrome.sidePanel.open()` within the preserved user gesture, caches the lookup, and broadcasts it so the panel shows the same word. Safari never sets the flag, so the button is absent there.

**Tech Stack:** TypeScript, Web Components (Shadow DOM, constructable stylesheets), Chrome MV3 (`chrome.sidePanel`, `chrome.runtime` messaging), Vitest (jsdom) for unit tests, Playwright (bundled Chromium + unpacked extension) for e2e. Package manager: `bun`.

## Global Constraints

- **Design tokens only.** Components reference only `--ad-*` / `--adp-*` tokens — no hard-coded hex/oklch, no theme branching. Source of truth: `design-system/side-panel-button/` (README + `IMPLEMENTATION_GUIDE.md`).
- **Preserve the authentic prompt.** `design-system/side-panel-button/IMPLEMENTATION_GUIDE.md` (incl. its §9 "Prompt for Claude Code") is verbatim and Prettier-ignored — do not edit, paraphrase, or delete it.
- **Icon conventions (§5.10).** CSP-safe inline SVG, `viewBox 0 0 24 24`, `fill="none"`, `stroke="currentColor"`, round caps/joins, `aria-hidden`; rendered 15px in a 30px action button.
- **One Surface Rule.** One cozy surface visible at a time — promoting to the panel dismisses the in-page sheet.
- **Security rules:** S3 `rule-gate-runtime-messages` — every runtime message handler validates `sender.id === chrome.runtime.id`. S4 `rule-sanitize-model-output` — markdown is re-sanitized at every render boundary. §8.3 `rule-domain-purity` / `ref-core-dependency-rule` — no `chrome.*` in `packages/app`; all `chrome.sidePanel.*` stays in `packages/extension-chrome`.
- **No new tokens, no new features, no telemetry, no accounts.**
- **Button is Chrome-only.** Absent in Safari (no side panel) and absent by default in the shared card.
- **Commit style:** Conventional Commits; **do not** add `Co-authored-by` trailers.
- **Verify before claiming done:** run the exact commands and read their output.

---

## File Structure

| File                                                         | Responsibility                                                        | New?       |
| ------------------------------------------------------------ | --------------------------------------------------------------------- | ---------- |
| `packages/app/src/ui/styles/tokens.ts`                       | add `ICON_SIDE_PANEL` glyph constant                                  | modify     |
| `packages/app/src/ui/lookup-card.ts`                         | gated side-panel action button + `open-side-panel` event              | modify     |
| `packages/app/src/app/inline-bottom-sheet-renderer.ts`       | `{ sidePanel }` opt → stamp `side-panel` attr on card                 | modify     |
| `packages/extension-chrome/src/side-panel-messages.ts`       | pure message/focus types + type guards (no `chrome.*`)                | **create** |
| `packages/extension-chrome/src/side-panel-messages.test.ts`  | unit tests for the guards                                             | **create** |
| `packages/extension-chrome/src/sw.ts`                        | intercept control messages; `sidePanel.open`; cache + broadcast       | modify     |
| `packages/extension-chrome/src/content.ts`                   | enable flag; track last focus; relay `open-side-panel`; dismiss sheet | modify     |
| `packages/extension-chrome/src/side-panel.ts`                | on boot, request cached focus and render it                           | modify     |
| `packages/extension-chrome/e2e/side-panel-open.spec.ts`      | e2e: button gating, sheet dismissal, panel renders the word           | **create** |
| `packages/app/test/ui/lookup-card.test.ts`                   | unit tests for the gated button                                       | modify     |
| `packages/app/test/app/inline-bottom-sheet-renderer.test.ts` | unit test for the flag                                                | modify     |

**Shared message contract (locked here; every task uses these exact names/types):**

```ts
// The current lookup state, mirror-shaped (matches what ChromeSidePanelMirror already posts,
// minus the `to` field). Imported by sw.ts, content.ts, side-panel.ts.
export type SidePanelFocus =
  | { state: 'loading'; word?: string }
  | { state: 'result'; payload: LookupResult }
  | { state: 'error'; payload: LookupError };

// content script → service worker (user gesture relay). `focus` is the lookup to show.
export interface OpenSidePanelMessage {
  type: 'open-side-panel';
  focus?: SidePanelFocus;
}

// side panel page → service worker, on boot.
export interface GetSidePanelFocusMessage {
  type: 'side-panel.get-focus';
}

// service worker → side panel page, reply to GetSidePanelFocusMessage.
export interface SidePanelFocusReply {
  focus: SidePanelFocus | null;
}
```

---

## Task 1: Add the `ICON_SIDE_PANEL` glyph

**Files:**

- Modify: `packages/app/src/ui/styles/tokens.ts` (after `ICON_TRASH`, ~line 203)

**Interfaces:**

- Produces: `export const ICON_SIDE_PANEL: string` — inline SVG string, same conventions as `ICON_SETTINGS`/`ICON_CLOSE`.

- [ ] **Step 1: Add the icon constant**

Append after the `ICON_TRASH` definition in `packages/app/src/ui/styles/tokens.ts`:

```ts
// Side panel (open in side panel) — card bar, Chrome only. A rounded rectangle (the browser
// viewport) with a vertical divider offset RIGHT, denoting a panel docked on the right edge.
export const ICON_SIDE_PANEL =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><line x1="14" y1="5" x2="14" y2="19"/></svg>';
```

- [ ] **Step 2: Verify it typechecks and is exported**

Run: `cd packages/app && bunx tsc --noEmit`
Expected: no errors.

Run: `grep -n "ICON_SIDE_PANEL" src/ui/styles/tokens.ts`
Expected: one match (the export).

- [ ] **Step 3: Commit**

```bash
git add packages/app/src/ui/styles/tokens.ts
git commit -m "feat(ui): add ICON_SIDE_PANEL glyph for the open-in-side-panel action"
```

---

## Task 2: Gated "Open in side panel" button on the lookup card

**Files:**

- Modify: `packages/app/src/ui/lookup-card.ts`
- Test: `packages/app/test/ui/lookup-card.test.ts`

**Interfaces:**

- Consumes: `ICON_SIDE_PANEL` (Task 1).
- Produces: the `<lookup-card>` renders a `button[data-act="side-panel"]` as the **first** child of `.actions` **iff** the host has a `side-panel` attribute; the button dispatches a composed, bubbling `open-side-panel` CustomEvent.

- [ ] **Step 1: Write the failing tests**

Add these tests inside the `describe('<lookup-card>', …)` block in `packages/app/test/ui/lookup-card.test.ts`. The existing `mountCard()` helper creates a card with **no** `side-panel` attribute, so add a gated variant:

```ts
function mountCardWithSidePanel(): LookupCard {
  const el = document.createElement('lookup-card') as LookupCard;
  el.setAttribute('side-panel', '');
  document.body.append(el);
  return el;
}

it('omits the side-panel action by default (no side-panel attribute)', () => {
  const el = mountCard();
  expect(el.shadowRoot!.querySelector('[data-act="side-panel"]')).toBeNull();
  const acts = [...el.shadowRoot!.querySelectorAll<HTMLButtonElement>('button[data-act]')];
  expect(acts.map((b) => b.dataset['act'])).toEqual(['settings', 'close']);
});

it('with the side-panel attribute, renders the action FIRST (before Settings and Close)', () => {
  const el = mountCardWithSidePanel();
  const acts = [...el.shadowRoot!.querySelectorAll<HTMLButtonElement>('button[data-act]')];
  expect(acts.map((b) => b.dataset['act'])).toEqual(['side-panel', 'settings', 'close']);
  const btn = acts[0]!;
  expect(btn.getAttribute('aria-label')).toBe('Open in side panel');
  expect(btn.getAttribute('title')).toBe('Open in side panel');
});

it('the side-panel action emits a composed, bubbling "open-side-panel" event', () => {
  const el = mountCardWithSidePanel();
  let evt: CustomEvent | null = null;
  const handler = (e: Event): void => {
    evt = e as CustomEvent;
  };
  document.body.addEventListener('open-side-panel', handler);
  el.shadowRoot!.querySelector<HTMLButtonElement>('[data-act="side-panel"]')!.click();
  document.body.removeEventListener('open-side-panel', handler);
  expect(evt).not.toBeNull();
  // Frozen cross-bundle contract: the Chrome shell listens for exactly this name.
  expect(evt!.type).toBe('open-side-panel');
  expect(evt!.composed).toBe(true);
});

it('has no axe violations with the side-panel action present (result state)', async () => {
  const el = mountCardWithSidePanel();
  el.state = { kind: 'result', word: 'sky', target: 'vi', safeHtml: safe('<p>the sky</p>') };
  expect(await axeViolations(el)).toEqual([]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/app && bunx vitest run test/ui/lookup-card.test.ts`
Expected: the 4 new tests FAIL (no `[data-act="side-panel"]` element); existing tests still PASS.

- [ ] **Step 3: Implement the gated button**

In `packages/app/src/ui/lookup-card.ts`:

(a) Add `ICON_SIDE_PANEL` to the tokens import:

```ts
import {
  BASE_VARS,
  THEME_CSS,
  BRAND_MARK_SVG,
  ICON_CLOSE,
  ICON_SHIELD,
  ICON_SETTINGS,
  ICON_SIDE_PANEL,
} from './styles/tokens';
```

(b) In `connectedCallback`, where the actions are appended (currently `actions.append(this.actionButton('settings', …), this.actionButton('close', …))`), conditionally prepend the side-panel button so it is first:

```ts
const actions = document.createElement('span');
actions.className = 'actions';
if (this.hasAttribute('side-panel')) {
  actions.append(this.actionButton('side-panel', 'Open in side panel', ICON_SIDE_PANEL));
}
actions.append(
  this.actionButton('settings', 'Settings', ICON_SETTINGS),
  this.actionButton('close', 'Close', ICON_CLOSE),
);
```

(c) Widen the `actionButton` signature and event mapping to handle `side-panel`:

```ts
private actionButton(
  act: 'settings' | 'close' | 'side-panel',
  label: string,
  icon: string,
): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.dataset['act'] = act;
  b.setAttribute('aria-label', label);
  // A native tooltip on the icon-only side-panel control (Settings carries a visible word; the
  // bare panel/close glyphs benefit from a hover title — and the handoff specifies title here).
  if (act === 'side-panel') b.title = label;
  b.innerHTML = icon; // decorative aria-hidden SVG; accessible name comes from aria-label
  // Settings carries a visible "Settings" word so it reads as a control, not a twin of the
  // bare X. aria-label still wins as the accessible name, so this never double-announces.
  if (act === 'settings') {
    const lbl = document.createElement('span');
    lbl.className = 'lbl';
    lbl.textContent = label;
    b.append(lbl);
  }
  // Each action maps to the composed event name the shell already routes:
  //  settings → open-settings (options page); close → close; side-panel → open-side-panel.
  const event =
    act === 'settings' ? 'open-settings' : act === 'side-panel' ? 'open-side-panel' : 'close';
  b.addEventListener('click', () =>
    this.dispatchEvent(new CustomEvent(event, { bubbles: true, composed: true })),
  );
  return b;
}
```

No CSS change is needed — the existing `button[data-act]` rules already style any action button (icon-only, 30px, hover/focus), and the SVG sizing falls back to the icon's own attributes; the `button[data-act="close"] svg{width:14px;height:14px}` rule is specific to close. The side-panel SVG has no width/height attributes, so add one CSS line next to the close rule so it renders at 15px like Settings:

```ts
// in the CSS template string, after the `button[data-act="close"] svg{...}` line:
button[data-act="side-panel"] svg{width:15px;height:15px}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/app && bunx vitest run test/ui/lookup-card.test.ts`
Expected: all tests PASS (the 4 new + all existing, including `['settings','close']` default ordering).

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/ui/lookup-card.ts packages/app/test/ui/lookup-card.test.ts
git commit -m "feat(ui): gated open-in-side-panel action button on the lookup card"
```

---

## Task 3: Renderer flag stamps the `side-panel` attribute

**Files:**

- Modify: `packages/app/src/app/inline-bottom-sheet-renderer.ts`
- Test: `packages/app/test/app/inline-bottom-sheet-renderer.test.ts`

**Interfaces:**

- Consumes: the card's `side-panel` attribute gating (Task 2).
- Produces: `new InlineBottomSheetRenderer(host, sanitize?, { sidePanel?: boolean })` — when `opts.sidePanel` is true, the created `<lookup-card>` carries the `side-panel` attribute.

- [ ] **Step 1: Write the failing tests**

Add to `packages/app/test/app/inline-bottom-sheet-renderer.test.ts` (the `card(host)` helper already returns `bottom-sheet > lookup-card`):

```ts
it('does NOT stamp the side-panel attribute by default', () => {
  const h = host();
  new InlineBottomSheetRenderer(h).renderLoading();
  expect(card(h).hasAttribute('side-panel')).toBe(false);
});

it('stamps the side-panel attribute on the card when constructed with { sidePanel: true }', () => {
  const h = host();
  new InlineBottomSheetRenderer(h, undefined, { sidePanel: true }).renderLoading();
  expect(card(h).hasAttribute('side-panel')).toBe(true);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/app && bunx vitest run test/app/inline-bottom-sheet-renderer.test.ts`
Expected: the second new test FAILS (attribute absent); everything else PASSES (the first passes trivially but guards the default).

- [ ] **Step 3: Implement the flag**

In `packages/app/src/app/inline-bottom-sheet-renderer.ts`, extend the constructor with a third options param (keeps the existing positional `sanitize` for the one test that passes it), and stamp the attribute in `ensureCard()`:

```ts
constructor(
  private readonly host: HTMLElement,
  private readonly sanitize: (md: string) => SafeHtml = sanitizeMarkdown,
  private readonly opts: { sidePanel?: boolean } = {},
) {}
```

In `ensureCard()`, right after `card.setAttribute('data-ad-theme', this._theme);`:

```ts
// Chrome opts in to the "Open in side panel" affordance; the shared card reads this attribute
// in connectedCallback (shared DOM, so it crosses the MV3 world boundary and is set before the
// element upgrades — same mechanism as data-ad-theme above). Safari leaves it off.
if (this.opts.sidePanel) card.setAttribute('side-panel', '');
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/app && bunx vitest run test/app/inline-bottom-sheet-renderer.test.ts`
Expected: all PASS.

- [ ] **Step 5: Run the whole app package to confirm no regressions**

Run: `cd packages/app && bunx vitest run --no-file-parallelism`
Expected: all PASS. (Use `--no-file-parallelism` to avoid the known axe-concurrency flake when running the full a11y suite together.)

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/app/inline-bottom-sheet-renderer.ts packages/app/test/app/inline-bottom-sheet-renderer.test.ts
git commit -m "feat(app): InlineBottomSheetRenderer { sidePanel } flag stamps the card attribute"
```

---

## Task 4: Side-panel message contract + type guards (pure)

**Files:**

- Create: `packages/extension-chrome/src/side-panel-messages.ts`
- Test: `packages/extension-chrome/src/side-panel-messages.test.ts`

**Interfaces:**

- Consumes: `LookupResult`, `LookupError` from `@ai-dict/app`.
- Produces: the types `SidePanelFocus`, `OpenSidePanelMessage`, `GetSidePanelFocusMessage`, `SidePanelFocusReply`, and guards `isOpenSidePanel(msg): msg is OpenSidePanelMessage`, `isGetSidePanelFocus(msg): msg is GetSidePanelFocusMessage`.

This pure module isolates the Chrome-shell message contract so the wiring tasks (5–7) share one source of truth and the guards are unit-tested without the messaging runtime.

- [ ] **Step 1: Write the failing test**

Create `packages/extension-chrome/src/side-panel-messages.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isOpenSidePanel, isGetSidePanelFocus } from './side-panel-messages';

describe('side-panel message guards', () => {
  it('isOpenSidePanel accepts a well-formed open message (with and without focus)', () => {
    expect(isOpenSidePanel({ type: 'open-side-panel' })).toBe(true);
    expect(
      isOpenSidePanel({ type: 'open-side-panel', focus: { state: 'loading', word: 'x' } }),
    ).toBe(true);
  });

  it('isOpenSidePanel rejects other shapes', () => {
    expect(isOpenSidePanel({ type: 'lookup' })).toBe(false);
    expect(isOpenSidePanel(null)).toBe(false);
    expect(isOpenSidePanel(undefined)).toBe(false);
    expect(isOpenSidePanel('open-side-panel')).toBe(false);
  });

  it('isGetSidePanelFocus accepts only the boot probe', () => {
    expect(isGetSidePanelFocus({ type: 'side-panel.get-focus' })).toBe(true);
    expect(isGetSidePanelFocus({ type: 'open-side-panel' })).toBe(false);
    expect(isGetSidePanelFocus({})).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/extension-chrome && bunx vitest run src/side-panel-messages.test.ts`
Expected: FAIL — `Cannot find module './side-panel-messages'`.

- [ ] **Step 3: Implement the module**

Create `packages/extension-chrome/src/side-panel-messages.ts`:

```ts
import type { LookupResult, LookupError } from '@ai-dict/app';

/**
 * The current lookup the side panel should focus, mirror-shaped: it matches what
 * ChromeSidePanelMirror already posts to `{ to: 'side-panel', … }`, minus the `to` field.
 */
export type SidePanelFocus =
  | { state: 'loading'; word?: string }
  | { state: 'result'; payload: LookupResult }
  | { state: 'error'; payload: LookupError };

/** content script → service worker. Relayed inside a user gesture so the SW may open the panel. */
export interface OpenSidePanelMessage {
  type: 'open-side-panel';
  focus?: SidePanelFocus;
}

/** side panel page → service worker, on boot, to recover the lookup it may have missed. */
export interface GetSidePanelFocusMessage {
  type: 'side-panel.get-focus';
}

/** service worker → side panel page: the cached focus, or null if there is none. */
export interface SidePanelFocusReply {
  focus: SidePanelFocus | null;
}

function hasType(msg: unknown): msg is { type: unknown } {
  return typeof msg === 'object' && msg !== null && 'type' in msg;
}

export function isOpenSidePanel(msg: unknown): msg is OpenSidePanelMessage {
  return hasType(msg) && msg.type === 'open-side-panel';
}

export function isGetSidePanelFocus(msg: unknown): msg is GetSidePanelFocusMessage {
  return hasType(msg) && msg.type === 'side-panel.get-focus';
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/extension-chrome && bunx vitest run src/side-panel-messages.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/extension-chrome/src/side-panel-messages.ts packages/extension-chrome/src/side-panel-messages.test.ts
git commit -m "feat(chrome): side-panel control message contract + type guards"
```

---

## Task 5: Service worker — open the panel, cache + broadcast the focus

**Files:**

- Modify: `packages/extension-chrome/src/sw.ts`

**Interfaces:**

- Consumes: `isOpenSidePanel`, `isGetSidePanelFocus`, `SidePanelFocus`, `SidePanelFocusReply` (Task 4).
- Produces: handling for `open-side-panel` (opens the panel for the sender's window, caches the focus, re-broadcasts it) and `side-panel.get-focus` (replies with the cached focus). In-memory cache `lastSidePanelFocus: SidePanelFocus | null`.

This task has no unit test (sw.ts is the Chrome composition root; the repo has no `sw.test.ts`). Its behavior is gated by the e2e in Task 8. Each step verifies with typecheck.

- [ ] **Step 1: Add the import and the cache**

In `packages/extension-chrome/src/sw.ts`, add to the imports:

```ts
import {
  isOpenSidePanel,
  isGetSidePanelFocus,
  type SidePanelFocus,
  type SidePanelFocusReply,
} from './side-panel-messages';
```

Add a module-level cache near the top (after the imports / `DEFAULT_TARGET`):

```ts
// The most recent lookup promoted to the side panel, kept so a freshly-opened panel can recover
// it on boot (its onMessage listener may not be registered when we broadcast, and history is
// empty when saveHistory is off). Not window-scoped — mirrors the existing broadcast model,
// which already fans out to every open side panel.
let lastSidePanelFocus: SidePanelFocus | null = null;
```

- [ ] **Step 2: Intercept the control messages before the wire router**

In the `chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => { … })` body, insert this block as the **very first** statements, before `const decision = classifyInbound(...)`:

```ts
// Chrome-only side-panel control messages. They are NOT part of the pure wire protocol
// (classifyInbound would reject them): open-side-panel needs `sender` (windowId) and the
// relayed user gesture, so chrome.sidePanel.open() stays here in the shell, not the core.
if (isOpenSidePanel(msg) || isGetSidePanelFocus(msg)) {
  if (sender.id !== chrome.runtime.id) return false; // S3 sender gate
  if (isGetSidePanelFocus(msg)) {
    const reply: SidePanelFocusReply = { focus: lastSidePanelFocus };
    sendResponse(reply);
    return true;
  }
  // open-side-panel: cache first (cheap sync work), then open the panel SYNCHRONOUSLY so the
  // user-gesture token survives, then mirror the lookup to any already-open panel.
  lastSidePanelFocus = msg.focus ?? null;
  const windowId = sender.tab?.windowId;
  if (windowId !== undefined) {
    // Best-effort: open() rejects if there is no gesture or no registered panel; we ignore it
    // (the in-page sheet has already dismissed) — the manual/HEADED check verifies real opening.
    void Promise.resolve(chrome.sidePanel?.open?.({ windowId })).catch(() => undefined);
  }
  if (msg.focus) {
    void Promise.resolve(chrome.runtime.sendMessage({ to: 'side-panel', ...msg.focus })).catch(
      () => undefined,
    );
  }
  sendResponse({ ok: true });
  return true;
}
```

- [ ] **Step 3: Verify it typechecks**

Run: `cd packages/extension-chrome && bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Build the Chrome extension to confirm it bundles**

Run: `bun run build:chrome`
Expected: build succeeds; `packages/extension-chrome/dist` is updated.

- [ ] **Step 5: Commit**

```bash
git add packages/extension-chrome/src/sw.ts
git commit -m "feat(chrome): SW opens the side panel and caches/broadcasts the current lookup"
```

---

## Task 6: Content script — enable the flag, relay the event, dismiss the sheet

**Files:**

- Modify: `packages/extension-chrome/src/content.ts`

**Interfaces:**

- Consumes: `SidePanelFocus`, `OpenSidePanelMessage` (Task 4); the renderer `{ sidePanel }` flag (Task 3); the `open-side-panel` DOM event (Task 2).
- Produces: a `document` listener that relays `open-side-panel` to the SW with the current focus and dismisses the in-page sheet.

- [ ] **Step 1: Enable the flag and track the last focus**

In `packages/extension-chrome/src/content.ts`:

(a) Add the import:

```ts
import type { SidePanelFocus, OpenSidePanelMessage } from './side-panel-messages';
```

(b) Construct the inline renderer with the flag (pass `undefined` for the default sanitizer to reach the third param):

```ts
const inline = new InlineBottomSheetRenderer(document.body, undefined, { sidePanel: true });
```

(c) Track the latest focus inside the existing `renderer` object passed to `runLookupWorkflow`. Add `let lastFocus: SidePanelFocus | undefined;` above the `runLookupWorkflow({ … })` call, and set it in each renderer method:

```ts
let lastFocus: SidePanelFocus | undefined;

runLookupWorkflow({
  selection: new DomSelectionSource(document),
  trigger,
  renderer: {
    renderLoading(word) {
      lastFocus = word === undefined ? { state: 'loading' } : { state: 'loading', word };
      inline.renderLoading(word);
      mirror.renderLoading(word);
    },
    renderResult(r) {
      lastFocus = { state: 'result', payload: r };
      inline.renderResult(r);
      mirror.renderResult(r);
    },
    renderError(e) {
      lastFocus = { state: 'error', payload: e };
      inline.renderError(e);
      mirror.renderError(e);
      void maybeShowConsent();
    },
    close() {
      lastFocus = undefined;
      inline.close();
      mirror.close();
    },
  },
  client: new MessageRelayLookupClient(chrome.runtime),
  settings: themedSettings,
});
```

- [ ] **Step 2: Relay the event and dismiss the sheet**

Add next to the existing `open-settings` listener at the bottom of `content.ts`:

```ts
// The card's "Open in side panel" action (Chrome only) bubbles a composed `open-side-panel`
// event out of the bottom sheet. A content script can't call chrome.sidePanel.open(), so we
// relay it (synchronously, preserving the user gesture) to the service worker, then dismiss the
// in-page sheet so the lookup "moves" to the docked panel — but keep the mirror so the panel
// keeps showing it (do NOT call the renderer's close()).
document.addEventListener('open-side-panel', () => {
  const message: OpenSidePanelMessage = { type: 'open-side-panel', focus: lastFocus };
  void chrome.runtime.sendMessage(message).catch(() => undefined);
  inline.close();
});
```

- [ ] **Step 3: Verify it typechecks and builds**

Run: `cd packages/extension-chrome && bunx tsc --noEmit`
Expected: no errors.

Run: `bun run build:chrome`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add packages/extension-chrome/src/content.ts
git commit -m "feat(chrome): relay open-side-panel to the SW and dismiss the in-page sheet"
```

---

## Task 7: Side panel — recover the current lookup on boot

**Files:**

- Modify: `packages/extension-chrome/src/side-panel.ts`

**Interfaces:**

- Consumes: `GetSidePanelFocusMessage`, `SidePanelFocusReply`, `SidePanelFocus` (Task 4); the SW `side-panel.get-focus` handler (Task 5).
- Produces: on boot, the panel asks the SW for the cached focus and renders it into the focus region when present.

- [ ] **Step 1: Add the import**

In `packages/extension-chrome/src/side-panel.ts`, add:

```ts
import type {
  GetSidePanelFocusMessage,
  SidePanelFocusReply,
  SidePanelFocus,
} from './side-panel-messages';
```

- [ ] **Step 2: Add a focus-recovery probe**

Add this function (reusing the existing `resultToFocus` / `isLookupResult` helpers and the `view` reference):

```ts
// On boot, recover the lookup the panel may have missed: when the reader clicks "Open in side
// panel", the SW caches that lookup, but a freshly-opened panel might not have its onMessage
// listener registered when the SW broadcasts it (a race), and Recent is empty when saveHistory
// is off. So we pull the cached focus directly. A subsequent live mirror message overrides it.
function applyFocus(focus: SidePanelFocus): void {
  if (focus.state === 'loading') {
    view.focusState =
      focus.word !== undefined ? { kind: 'loading', word: focus.word } : { kind: 'loading' };
  } else if (focus.state === 'result' && isLookupResult(focus.payload)) {
    view.focusState = resultToFocus(focus.payload);
  } else if (focus.state === 'error') {
    view.focusState = { kind: 'error', error: focus.payload };
  }
}

async function recoverFocus(): Promise<void> {
  try {
    const message: GetSidePanelFocusMessage = { type: 'side-panel.get-focus' };
    const raw: unknown = await chrome.runtime.sendMessage(message);
    const reply = raw as SidePanelFocusReply | undefined;
    if (reply && reply.focus) applyFocus(reply.focus);
  } catch {
    // Best-effort; the empty teaching state / no-key invite remains a fine fallback.
  }
}
```

- [ ] **Step 3: Call it on boot**

At the bottom of the file, alongside the existing `void refreshRecent(); void initFromSettings();`, add:

```ts
void recoverFocus();
```

This runs after `initFromSettings()` sets the theme/no-key state. Because `recoverFocus` only overrides `focusState` when a cached lookup exists, a normally-opened panel (no promotion) keeps its empty/setup state.

- [ ] **Step 4: Verify it typechecks and builds**

Run: `cd packages/extension-chrome && bunx tsc --noEmit`
Expected: no errors.

Run: `bun run build:chrome`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add packages/extension-chrome/src/side-panel.ts
git commit -m "feat(chrome): side panel recovers the promoted lookup on boot"
```

---

## Task 8: End-to-end test

**Files:**

- Create: `packages/extension-chrome/e2e/side-panel-open.spec.ts`

**Interfaces:**

- Consumes: everything in Tasks 1–7; the harness fixtures/helpers (`test`, `expect`, `extensionId`, `seedSettings`, `mockGemini`, `gotoFixture`, `selectWord`, `openTrigger`).

What's verifiable in headless: the button is gated on in Chrome's in-page card, clicking it dismisses the sheet, and the SW→panel focus recovery shows the same word. The real OS-level side-panel open is verified manually in Task 9 (HEADED + recording), exactly as the repo's existing side-panel specs do (they drive `side-panel.html` as a tab rather than the real panel).

- [ ] **Step 1: Write the spec**

Create `packages/extension-chrome/e2e/side-panel-open.spec.ts`. Mirror the helpers used by `selection.spec.ts` / `lookup.spec.ts` for producing an in-page lookup. (Confirm the exact signatures of `gotoFixture`, `selectWord`, `openTrigger`, `mockGemini` in `e2e/helpers.ts` before writing — adapt the calls below to match.)

```ts
import { test, expect } from './fixtures';
import { seedSettings, mockGemini, gotoFixture, selectWord, openTrigger } from './helpers';

test.describe('open in side panel', () => {
  test('button is present, dismisses the sheet, and the panel recovers the word', async ({
    context,
    page,
    extensionId,
  }) => {
    await seedSettings(page, { theme: 'sepia' });
    await mockGemini(page); // resolves the lookup so the card shows a result
    await gotoFixture(page);
    await selectWord(page, 'target', 'serendipity');
    await openTrigger(page); // clicks Define → the in-page card shows the result

    const card = page.locator('lookup-card');
    const sidePanelBtn = card.locator('button[data-act="side-panel"]');
    await expect(sidePanelBtn).toBeVisible(); // gated ON in Chrome
    await expect(card).toContainText('serendipity');

    await sidePanelBtn.click();

    // The in-page sheet is dismissed (the lookup "moved" to the dock).
    await expect(page.locator('bottom-sheet')).toHaveCount(0);

    // The SW cached the promoted lookup; a freshly-opened panel recovers it on boot.
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/side-panel.html`);
    await panel.waitForSelector('side-panel-view');
    await expect(panel.locator('side-panel-view')).toContainText('serendipity', { timeout: 5_000 });
  });
});
```

> Note: if `mockGemini`/`selectWord`/`openTrigger` have different parameters than shown (e.g. the fixture word id, or `mockGemini` returns a definition string), adjust to match the existing specs verbatim — do not invent helper signatures.

- [ ] **Step 2: Build, then run the spec**

Run: `bun run build:chrome`
Then: `cd packages/extension-chrome && bunx playwright test e2e/side-panel-open.spec.ts`
Expected: PASS (1 test).

If it fails, debug with: `HEADED=1 bunx playwright test e2e/side-panel-open.spec.ts` and read the failure; fix the implementation (not the assertion) per systematic-debugging.

- [ ] **Step 3: Run the full Chrome e2e suite for regressions**

Run: `cd packages/extension-chrome && bunx playwright test`
Expected: all PASS (no existing spec broken by the new action button or SW message handling).

- [ ] **Step 4: Commit**

```bash
git add packages/extension-chrome/e2e/side-panel-open.spec.ts
git commit -m "test(chrome): e2e for open-in-side-panel button and focus recovery"
```

---

## Task 9: Full verification, evidence, and PR

**Files:** none (verification + PR).

- [ ] **Step 1: Lint, format, typecheck, full unit tests**

Run from repo root:

```bash
bun run format:check
bunx tsc --noEmit -p packages/app && bunx tsc --noEmit -p packages/extension-chrome && bunx tsc --noEmit -p packages/extension-safari
cd packages/app && bunx vitest run --no-file-parallelism && cd ../..
cd packages/extension-chrome && bunx vitest run && cd ../..
```

Expected: format clean, no type errors, all unit tests pass. (If `bun run format:check` flags your touched `.ts` files, run `bunx prettier --write` on them and re-commit.)

- [ ] **Step 2: Confirm Safari has NO button (gating)**

Run: `grep -n "sidePanel" packages/extension-safari/src/content.ts`
Expected: no match — Safari constructs `new InlineBottomSheetRenderer(document.body)` with no flag, so the card never gets the `side-panel` attribute and the button is absent. (No Safari code change in this feature.)

- [ ] **Step 3: Capture before/after evidence (HEADED)**

Capture the card header in all three themes via the harness. Build first (`bun run build:chrome`). Use `seedSettings(page, { theme })` for `sepia`, `dark`, `contrast`, produce a lookup, and `page.locator('lookup-card').screenshot()`:

- **Before** = a `master` build (no button). **After** = this branch (button present, first in the cluster).
- Also record a short HEADED screen capture of the real flow: click "Open in side panel" → the docked panel opens showing the same word → the in-page sheet is gone. This is the only check of the real `chrome.sidePanel.open()` path.

Host the PNGs/video on a throwaway `pr-assets/open-side-panel-button` branch and reference them with same-origin `https://github.com/<owner>/<repo>/raw/pr-assets/open-side-panel-button/<path>` URLs (private-repo rule — never `raw.githubusercontent.com`).

- [ ] **Step 4: Push and open the PR**

```bash
git push -u origin worktree-open-side-panel-button
gh pr create --title "feat: open the side panel from the lookup card (Chrome)" --body "<summary + Before/After evidence + test notes>"
```

The PR body MUST embed the Before/After screenshots (all three themes) and the flow recording, and note: Chrome-only (Safari unchanged), reuses existing `.ad-action` styling/tokens (no new tokens), a11y verified (axe + focus ring + aria-label/title). End the body with the Claude Code generated-with line per repo policy.

- [ ] **Step 5: Definition of done**

- [ ] Icon-only button is the **first** child of `.actions` on all desktop card states, Chrome only.
- [ ] Uses existing `button[data-act]` styling; no hard-coded colors; stroke is `currentColor`.
- [ ] `aria-label` + `title` = "Open in side panel"; keyboard-operable; focus ring visible; axe clean.
- [ ] Click opens the docked side panel from a user gesture and loads the current lookup; the in-page sheet dismisses.
- [ ] Verified in Sepia, Dark, and High-Contrast.
- [ ] Absent on Safari.
- [ ] All unit + e2e tests pass; format/typecheck clean.

---

## Self-Review

**Spec coverage:** New icon (Task 1) ✓; gated button + event + placement/a11y (Task 2) ✓; Chrome-only gating via renderer flag (Task 3) + Safari absence (Task 9 step 2) ✓; user-gesture relay + `chrome.sidePanel.open` in the shell (Tasks 5–6) ✓; cache + broadcast + boot recovery incl. saveHistory-off and the listener race (Tasks 5, 7) ✓; dismiss the in-page sheet (Task 6) ✓; testing — unit + e2e + manual evidence (Tasks 2–4, 8, 9) ✓; tokens/One-Surface/S3/domain-purity constraints (Global Constraints, enforced across tasks) ✓; preserve authentic prompt (Global Constraints) ✓.

**Placeholder scan:** None — every code step shows complete code; the only "adapt to match" note (Task 8 helper signatures) is an explicit instruction to read `e2e/helpers.ts` rather than a hidden placeholder.

**Type consistency:** `SidePanelFocus`, `OpenSidePanelMessage`, `GetSidePanelFocusMessage`, `SidePanelFocusReply`, `isOpenSidePanel`, `isGetSidePanelFocus`, `lastSidePanelFocus`, `lastFocus`, the `side-panel` attribute, the `open-side-panel` event name, and `data-act="side-panel"` are used identically across Tasks 2–8.
