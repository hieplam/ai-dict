# A4 — Keyboard-only flow (design)

> Roadmap idea **A4** (`docs/ROADMAP.md`): _Impact 4 · Effort S · Score 4.0_.
> Category A (seamless reading UX). Decision authority: **Lead decides** (command names,
> panel behavior); **no owner escalation**.

## Problem

Today the only way to start a lookup is: select text → move the mouse to the ~20px "Define"
bubble (`packages/app/src/ui/lookup-trigger.ts`) → click it. `Escape` already dismisses an
**open card** (`packages/app/src/ui/bottom-sheet.ts:73`, only while focus is inside the sheet —
`connectedCallback` calls `panel.focus()` on open), but there is no keyboard way to:

1. **Start** a lookup ("define what I just selected").
2. Dismiss reliably **from anywhere on the page** (not just while focus happens to be inside
   the sheet — e.g. after tabbing away, or while only the pending trigger bubble is showing,
   which today has no keyboard dismissal at all).
3. Send the current lookup to the docked side panel (today: mouse-click the card's
   `button[data-act="side-panel"]`, wired in `packages/extension-chrome/src/content.ts:104`).

Readers who select by double-click or keyboard lose their reading position hunting a
20px button — each lookup becomes an aim-and-click chore.

## Goal

Select → one key → read → Esc → keep reading, hands never leaving the keyboard, via Chrome's
native `chrome.commands` keyboard-shortcut API (the same mechanism `chrome://extensions/shortcuts`
already manages for every extension).

## Non-goals (scope fence — from the roadmap card, settled)

- **Exactly 3 commands**: define selection / dismiss / send to panel. No more.
- **No default binding.** The manifest declares each command with a `description` only — no
  `suggested_key`. The user assigns keys themselves in `chrome://extensions/shortcuts`, avoiding
  site/browser shortcut collisions (the exact reason the card rules out a default).
- **No new manifest permission.** `chrome.commands.onCommand`'s listener receives the active
  `tab` object directly (Chrome ≥110; this repo's `minimum_chrome_version` is 116), and
  `chrome.tabs.sendMessage(tabId, …)` requires no `"tabs"` permission — only reading tab
  `url`/`title` would. We only ever touch `tab.id`. → no `E6` escalation.
- **Chrome only.** `chrome.commands` is a Chrome MV3 manifest key; Safari Web Extension commands
  are configured a different way (Xcode-side), out of scope for this Effort-S card. Precedent:
  the "Open in side panel" affordance is already Chrome-only (`InlineBottomSheetRenderer`'s
  `sidePanel` opt-in, set only by `packages/extension-chrome/src/content.ts:17`).
- **No change to the lookup workflow itself** (`packages/app/src/domain/workflow.ts`). The
  domain core stays untouched — this is purely a new **input path** into the exact same
  click-equivalent code that already exists, wired entirely in the Chrome shell
  (`packages/extension-chrome/**`), consistent with `ref-core-dependency-rule` (portable
  behavior lives in the core; **this isn't new lookup behavior**, it's a platform-specific
  trigger for behavior the core already has).

## Design

### Why the shell, not the core

`chrome.commands` fires **in the service worker**, not the content script — there is no DOM
`keydown` involved (a real hardware/OS-level shortcut is intercepted by Chrome before any page
JS sees it, which is also why **Playwright cannot simulate it** — see Testing below). The SW
must relay the fired command to the right tab's content script over `chrome.tabs.sendMessage`.
This is a new SW → content-script push, the mirror image of the already-existing
content-script → SW `open-side-panel` relay (`packages/extension-chrome/src/sw.ts:115-142`,
`packages/extension-chrome/src/side-panel-messages.ts`). We follow that exact precedent: a
small, Chrome-only, non-wire-protocol message type with its own type guard, manually gated on
`sender.id === chrome.runtime.id` (S3) — **not** routed through `WireMessageSchema` /
`classifyInbound`, because (like `open-side-panel`) it isn't part of the pure cross-realm lookup
protocol the core owns; it's Chrome-shell-only command plumbing.

### 1. `packages/extension-chrome/src/manifest.json` — declare the 3 commands

```json
"commands": {
  "define-selection": { "description": "Define the current text selection" },
  "dismiss-lookup": { "description": "Dismiss the lookup card" },
  "send-to-panel": { "description": "Send the current lookup to the side panel" }
}
```

No `suggested_key` on any entry (scope fence: no default binding). `manifest.test.ts` gets a new
assertion locking this exact shape — the automated proof that no default binding ever regresses
in.

### 2. `packages/extension-chrome/src/command-messages.ts` (new) — the Chrome-only message type

Mirrors `side-panel-messages.ts`'s pattern (`hasType` guard + a narrow `isXxx` predicate) exactly:

```ts
export type LookupCommand = 'define-selection' | 'dismiss-lookup' | 'send-to-panel';

/** service worker → content script: relay a chrome.commands keyboard shortcut (A4). */
export interface CommandMessage {
  type: 'command';
  command: LookupCommand;
}

const COMMANDS: readonly LookupCommand[] = ['define-selection', 'dismiss-lookup', 'send-to-panel'];

function hasType(msg: unknown): msg is { type: unknown } {
  return typeof msg === 'object' && msg !== null && 'type' in msg;
}

export function isCommandMessage(msg: unknown): msg is CommandMessage {
  return (
    hasType(msg) &&
    msg.type === 'command' &&
    'command' in msg &&
    COMMANDS.includes((msg as { command: unknown }).command as LookupCommand)
  );
}
```

### 3. `packages/extension-chrome/src/sw.ts` — relay `onCommand` to the active tab

```ts
import { type CommandMessage } from './command-messages';
// …
chrome.commands.onCommand.addListener((command, tab) => {
  if (tab.id === undefined) return;
  const message: CommandMessage = {
    type: 'command',
    command: command as CommandMessage['command'],
  };
  void chrome.tabs.sendMessage(tab.id, message).catch(() => undefined); // no listener/tab gone
});
```

The cast is safe by construction: `command` can only ever be one of the 3 names declared in
`manifest.json`'s `commands` key above — Chrome never fires `onCommand` for an undeclared name.
This listener is thin, composition-root wiring (same category as the existing
`chrome.sidePanel.setPanelBehavior` call two lines below it) — per `c3-210`'s own Change Safety
table, this class of wiring is verified by e2e + typecheck, not a direct unit test (see Testing).

### 4. `packages/extension-chrome/src/adapters/chrome-floating-trigger.ts` — `activate()`

The trigger bubble's `show(anchor, onClick)` already stores `onClick` and mounts a real
`<lookup-trigger>` custom element whose shadow `<button>` is what a mouse click fires. Firing the
**same button's real `click()`** (not calling `onClick` directly) preserves 100% of today's click
behavior for free — the spinner swap inside `lookup-trigger.ts`'s own click handler, the
`lookup-click` event, all of it:

```ts
/**
 * Keyboard-shortcut path (A4 define-selection): fire the same click the mouse would, on
 * whatever trigger bubble is currently showing. No-op (returns false) if nothing is selected
 * (no bubble mounted) — matches "define what I just selected": nothing selected, nothing to do.
 */
activate(): boolean {
  const btn = this.el?.shadowRoot?.querySelector('button');
  if (btn instanceof HTMLButtonElement && !btn.disabled) {
    btn.click();
    return true;
  }
  return false;
}
```

### 5. `packages/extension-chrome/src/content.ts` — the command listener

Add a `chrome.runtime.onMessage` listener (content.ts has none today; confirmed safe to add —
`chrome.runtime.sendMessage` broadcasts reach extension **pages** (options/side-panel), never
other content scripts, so this cannot self-trigger or collide with `ChromeSidePanelMirror`'s
`{ to: 'side-panel', … }` broadcast). Refactor the renderer's inline `close()` into a named
`dismissAll()` so the command handler and the normal workflow-close path share one definition:

```ts
function dismissAll(): void {
  lastFocus = undefined;
  inline.close();
  mirror.close();
}
```

(`renderer.close()` in the `runLookupWorkflow({...})` call becomes `close: dismissAll`.)

```ts
chrome.runtime.onMessage.addListener((msg: unknown, sender) => {
  if (sender.id !== chrome.runtime.id) return; // S3: same-extension only
  if (!isCommandMessage(msg)) return;
  switch (msg.command) {
    case 'define-selection':
      trigger.activate();
      break;
    case 'dismiss-lookup':
      trigger.hide();
      dismissAll();
      break;
    case 'send-to-panel':
      // Only meaningful with an active lookup on screen; reuses the exact same document event
      // the card's own "Open in side panel" button already dispatches (content.ts:104).
      if (lastFocus !== undefined) document.dispatchEvent(new CustomEvent('open-side-panel'));
      break;
  }
});
```

`dismiss-lookup` closes **both** the pending trigger bubble (new capability — today's `Escape`
can't reach it) and an open card (`trigger.hide()` + `dismissAll()`), from anywhere on the page,
regardless of DOM focus — a strict superset of today's in-sheet-only `Escape`.

`send-to-panel` deliberately reuses the identical `open-side-panel` document-event path the
mouse-click button already uses, so it inherits that path's existing behavior (dismiss the
inline sheet, cache the focus in the SW, mirror it into an already-open panel) with zero new
logic. Chrome's `chrome.sidePanel.open()` requires a "user gesture" (transient activation); a
`chrome.commands` keypress **is** a trusted user gesture, and activation persists briefly
(several seconds) on the tab — the two extra message hops (SW → content, content → SW) this
relay adds happen in low tens of milliseconds, well inside that window. This is documented here
as an accepted, low risk (Risk/rollback section).

## Testing strategy

Environment: Vitest (unit, happy-dom where DOM is touched) + Playwright (e2e), per repo
convention.

### What CANNOT be e2e-tested, and why

`chrome.commands.onCommand` fires from a genuine OS/browser-level keyboard shortcut, intercepted
by Chrome **before** any page or extension JS sees a `keydown` — there is no DOM event to
synthesize, and Playwright/CDP has no API to simulate a global extension-command keypress. This
is a known, structural limitation, not a testing gap we're choosing to skip. Precedent already
in this repo: `side-panel-open.spec.ts`'s second test faces the analogous "headless Chromium
cannot render/observe the real OS side panel" limitation and tests at the API boundary instead
(stubbing `chrome.sidePanel.open` and asserting it was called) rather than skipping the behavior
entirely.

We apply the same technique: e2e tests get the service worker handle
(`context.serviceWorkers()`) and call `sw.evaluate(() => chrome.tabs.sendMessage(tabId, msg))`
directly — this **is** the literal call our 3-line `onCommand` listener makes, so it exercises
every line of real logic **except** the one line Chrome itself owns and Playwright cannot drive
(`chrome.commands.onCommand.addListener(...)`, which is proven correct by TypeScript compiling
against `@types/chrome`'s `CommandEvent` signature, by `manifest.test.ts` locking the declared
command names it must match, and by code review — the same verification tier `c3-210`'s Change
Safety table already assigns to this class of thin composition-root wiring).

### Unit tests

- `packages/extension-chrome/src/command-messages.test.ts` (new): `isCommandMessage` accepts all
  3 valid shapes, rejects unknown command names / missing fields / non-objects — mirrors
  `side-panel-messages.test.ts` exactly.
- `packages/extension-chrome/src/adapters/chrome-floating-trigger.test.ts` (append): `activate()`
  fires the mounted button's click (assert the `onClick` passed to `show()` is called once, same
  assertion style as the existing `lookup-click` test); `activate()` returns `false` and does not
  throw when nothing is shown.
- `packages/extension-chrome/test/manifest.test.ts` (append): `manifest.commands` deep-equals the
  exact 3-entry shape above, and no entry has a `suggested_key` key — the load-bearing proof of
  "no default binding."

### E2E tests (`packages/extension-chrome/e2e/keyboard-commands.spec.ts`, new)

Using the `sw.evaluate` technique above, seeded settings + a fixture page (existing `helpers.ts`:
`seedSettings`, `gotoFixture`, `selectWord`, `mockGemini`):

1. **define-selection**: select a word (no mouse click on the bubble) → relay
   `{ type: 'command', command: 'define-selection' }` to the tab → assert the card renders the
   looked-up result (same assertion shape as `selection.spec.ts`).
2. **define-selection with nothing selected**: relay the command with no prior selection →
   assert no card/bubble appears and nothing throws.
3. **dismiss-lookup while only the bubble is showing**: select a word, do NOT open the trigger →
   relay `dismiss-lookup` → assert `lookup-trigger` count is 0.
4. **dismiss-lookup while the card is open**: select + open (mouse, via existing `openTrigger`
   helper) → relay `dismiss-lookup` → assert `bottom-sheet` count is 0.
5. **send-to-panel**: select + open, wait for the result → relay `send-to-panel` → assert the
   in-page sheet is dismissed AND a freshly-opened side panel recovers the lookup (mirrors
   `side-panel-open.spec.ts`'s first test, which already proves the reused `open-side-panel`
   path end-to-end).
6. **send-to-panel with no active lookup**: relay the command on a fresh page with nothing
   selected → assert no side-panel-open message was sent (spy via `sw.evaluate`, mirroring the
   `chrome.sidePanel.open` spy technique in `side-panel-open.spec.ts`'s second test).

### Evidence (`packages/extension-chrome/e2e/a4-evidence.spec.ts`, new)

A4 is a **flow/behavior** change → video evidence (CLAUDE.md convention), gated the same way as
`a16-evidence.spec.ts` / `media-demos.spec.ts` (`PLAYWRIGHT_RUN_EVIDENCE=1`, skipped by default so
it never runs unintentionally in CI). Records a single before/after pair:

- **Before** (built from `master`): select a word, press a key — nothing happens (no card, no
  bubble change) — demonstrating today's gap ("no keyboard way to start a lookup").
- **After** (built from the branch): select a word → an on-screen caption
  ("⌨ define-selection fired") appears synced with the simulated relay call → the card opens →
  a second caption ("⌨ dismiss-lookup fired") → the card closes. The on-screen caption is the
  same honesty technique this repo already uses for headless demo recording (`media-demos.spec.ts`'s
  synthetic cursor overlay for a pointer headless Chromium doesn't paint) — it visually marks the
  exact moment the simulated command fires, since there's no real key-press to show on screen.

## Risk / rollback

- **Additive only.** New file (`command-messages.ts`), one new manifest key (`commands` — not a
  `permissions` entry, so `manifest.test.ts`'s existing exact-permissions assertion is
  unaffected), a few new lines in `sw.ts` / `content.ts` / `chrome-floating-trigger.ts`. No
  existing exported symbol's signature changes. No wire-schema (`wire.ts`) change — this never
  touches `WireMessageSchema`. No domain (`packages/app/src/domain/**`) change at all.
- **`send-to-panel`'s gesture-window assumption** (see Design §5) is the one behavioral risk
  worth naming: if Chrome ever tightens transient-activation propagation across
  `chrome.tabs.sendMessage` hops, `chrome.sidePanel.open()` could start silently no-op'ing for
  this path specifically (the existing mouse-click path is unaffected — it has one fewer hop).
  Detection: e2e test 5 above (spies `chrome.sidePanel.open`); rollback is deleting the
  `send-to-panel` case block only, downgrading the card to 2 working commands and 1 declared but
  inert one, without touching the other two paths.
- Rollback = revert the PR's one commit range; nothing downstream depends on this (A13 lists
  A4 only as "nice with", not a hard dependency).
