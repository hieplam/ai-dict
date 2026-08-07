# Design: "Open in side panel" button on the lookup card

**Date:** 2026-06-18
**Status:** Approved (design); pending spec review
**Source handoff:** `design-system/side-panel-button/` — `README.md` (the button
spec), `AI Dictionary Design System.html` (living style guide), and
`IMPLEMENTATION_GUIDE.md` (the authentic, current Paperlight spec).

> **Preserve the authentic prompt.** `IMPLEMENTATION_GUIDE.md` is saved verbatim
> (kept out of Prettier via `.prettierignore`). Its **§9 "Prompt for Claude
> Code"** was authored by Claude Design with full project context — treat it as
> authoritative and **do not edit, paraphrase, or drop it** during
> implementation. This bundle's guide is newer than the stale
> `design-hand-off/IMPLEMENTATION_GUIDE.md` (it adds the fully-themed Settings
> §5.8, the canonical icon set §5.10, and card gutters §5.11).

## Summary

Add an **"Open in side panel"** icon button to the lookup card's top-right action
cluster. Clicking it promotes the current lookup into the persistent Chrome side
panel (the docked surface that already exists) and dismisses the in-page bottom
sheet — the lookup "moves" from the floating sheet to the dock.

The button is a purely additive affordance. Nothing else about the card changes.

## Context: how this codebase is actually built

The design handoff is written for a generic design system that distinguishes a
"desktop floating card" from a "mobile bottom sheet" and says to **omit** the
button from the bottom sheet. This repo does **not** have that split:

- The only in-page surface is `<bottom-sheet>` wrapping `<lookup-card>`, used on
  **every** viewport, in **both** the Chrome and Safari shells
  (`InlineBottomSheetRenderer`, shared in `packages/app`).
- The real distinction here is **which shell has a side panel**:
  - **Chrome** has `chrome.sidePanel` → show the button.
  - **Safari** has no side panel; the bottom sheet is "the only surface"
    (`extension-safari/src/content.ts:14`) → don't show it (it would be a dead
    control).

So the user's request ("add an ability to open the side panel **in the bottom
sheet**") and the handoff ("omit from the mobile bottom sheet") reconcile once
mapped onto this codebase: **add the button to the lookup-card action cluster
(which renders inside the bottom sheet), gated to the Chrome shell only.**

## Goals / Non-goals

**Goals**

- New icon-only action button, first in `.actions` (order: `[⇥ panel] [⚙ Settings] [✕ Close]`).
- Appears on all card states (setup-invite, loading, result, error) — in Chrome only.
- Click opens the Chrome side panel from a user gesture, loads the **current**
  lookup (same word) into it, and dismisses the in-page bottom sheet.
- Token-driven visuals; re-themes for free in Sepia / Dark / High-Contrast.

**Non-goals**

- No change to the side-panel surface itself (it already exists).
- No Safari behavior change (button absent there).
- No new tokens (reuses the existing `.ad-action` / `button[data-act]` pattern).
- No new features, telemetry, or accounts.

## Components & changes

### 1. New icon — `packages/app/src/ui/styles/tokens.ts`

Add `ICON_SIDE_PANEL` next to the canonical set, using the handoff glyph: a
rounded rectangle (the viewport) with a vertical divider offset right (a panel
docked on the right edge). Same conventions as the existing icons — `viewBox
0 0 24 24`, `fill="none"`, `stroke="currentColor"`, round caps/joins,
`aria-hidden` — so it inherits the action button's token color and re-themes
automatically.

```
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <rect x="3.5" y="5" width="17" height="14" rx="2.5"/>
  <line x1="14" y1="5" x2="14" y2="19"/>
</svg>
```

### 2. Lookup card — `packages/app/src/ui/lookup-card.ts` (shared)

- Add the "Open in side panel" button as the **first** child of the `.actions`
  cluster, before Settings. Reuse the existing `actionButton()` factory /
  `button[data-act]` styling (icon-only, 30px hit target). New act value, e.g.
  `data-act="side-panel"`.
- `aria-label="Open in side panel"` + `title="Open in side panel"`. Keyboard
  operable, visible focus ring (inherited from the existing button styles).
- On click it dispatches a composed `open-side-panel` CustomEvent
  (`bubbles: true, composed: true`) — mirroring exactly how `open-settings` and
  `close` already cross the MV3 MAIN/isolated-world boundary and bubble out of
  the bottom sheet to `document`.
- **Gating:** the card renders this button only when a `side-panel` attribute is
  present on the host. It reads the attribute in `connectedCallback` (shared-DOM,
  so it crosses the world boundary and is set before upgrade — same mechanism as
  `data-ad-theme`). No attribute → no button. This keeps the card itself
  platform-agnostic; the _shell_ decides.

### 3. Renderer — `packages/app/src/app/inline-bottom-sheet-renderer.ts` (shared)

- Add an opt-in flag (constructor option `{ sidePanel?: boolean }`, default
  `false`). When set, `ensureCard()` stamps the `side-panel` attribute on the
  `<lookup-card>` **before** appending it (so the MAIN-world class reads it on
  upgrade, exactly like the existing `data-ad-theme` stamping at lines 33-38).
- This is the single composition-root switch: Chrome turns it on, Safari leaves
  it off.

### 4. Chrome shell — `packages/extension-chrome/src/content.ts`

- Construct the renderer with `{ sidePanel: true }`.
- Track the latest rendered lookup state (the `renderer` wrapper object already
  forwards every `renderLoading/renderResult/renderError`; capture the last one
  there).
- Add a `document.addEventListener('open-side-panel', …)` handler (mirrors the
  existing `open-settings` listener). On the event:
  1. **Synchronously** `chrome.runtime.sendMessage({ type: 'open-side-panel',
payload: <current lookup result | undefined> })` — sent inside the gesture
     so the user-gesture token propagates to the service worker for
     `chrome.sidePanel.open()`.
  2. Dismiss the in-page sheet only: `inline.close()`. **Do not** call
     `mirror.close()` — the panel must keep the lookup.

### 5. Chrome service worker — `packages/extension-chrome/src/sw.ts`

- In the existing `chrome.runtime.onMessage` listener, intercept
  `{ type: 'open-side-panel' }` **before** the wire-protocol router
  (`classifyInbound` only knows wire types), validating the sender per S3
  (`sender.id === chrome.runtime.id`).
- Call `chrome.sidePanel.open({ windowId: sender.tab.windowId })`
  **synchronously** (preserves the relayed user gesture). This keeps the
  `chrome.*` call in the shell (platform adapter), never in the core
  (`rule-domain-purity`).
- Cache the payload as `lastSidePanelFocus` and re-broadcast it as a
  `{ to: 'side-panel', state, payload }` message (the same shape
  `ChromeSidePanelMirror` already posts) so an **already-open** panel updates
  immediately.

### 6. Side panel — `packages/extension-chrome/src/side-panel.ts`

- On boot, request the cached current lookup from the SW
  (`{ type: 'side-panel.get-focus' }` → reply with `lastSidePanelFocus`) and, if
  present, render it into the focus region. This covers the **freshly-opened**
  panel (whose `onMessage` listener may not be registered yet when the SW
  re-broadcasts — a listener-registration race) and the **`saveHistory: off`**
  case (where Recent is empty and can't carry the word).
- The existing live `to: 'side-panel'` mirror path is unchanged.

## Data flow

```
[lookup-card button click]
        │  composed CustomEvent 'open-side-panel' (bubbles out of <bottom-sheet>)
        ▼
[content.ts] document listener
        │  (1) chrome.runtime.sendMessage({type:'open-side-panel', payload}) — sync, in gesture
        │  (2) inline.close()  (dismiss in-page sheet; mirror stays)
        ▼
[sw.ts] onMessage (sender validated, S3)
        │  chrome.sidePanel.open({windowId}) — sync, gesture preserved
        │  cache lastSidePanelFocus = payload
        │  broadcast {to:'side-panel', state:'result', payload}  ──► already-open panel renders
        ▼
[side-panel.ts]
   freshly opened → on boot asks {type:'side-panel.get-focus'} → renders lastSidePanelFocus
   already open   → received the broadcast above → renders it
```

## Error / edge handling

- **Side panel already open:** `open()` is idempotent; the broadcast updates it
  to the current word.
- **`chrome.sidePanel.open()` rejects** (e.g. gesture lost): caught and ignored;
  the in-page sheet has already been dismissed, matching existing best-effort
  messaging. (Acceptable; the reader can re-select. If we find the gesture is
  unreliable across the relay during implementation, fall back to dismissing the
  sheet only **after** `open()` resolves.)
- **No current lookup** (button somehow clicked with no result, e.g. setup-invite
  state): the panel still opens and shows its own empty/setup state — no payload
  to deliver. This matches the handoff (button present on all states).
- **Safari:** button never rendered; no code path reached.

## Testing strategy

**Unit (vitest, `packages/app`)**

- `lookup-card`: renders the side-panel button **only** when the `side-panel`
  attribute is present; button absent by default; the button is the **first**
  child of `.actions`.
- `lookup-card`: clicking the button dispatches a composed, bubbling
  `open-side-panel` event.
- `lookup-card`: a11y — no axe violations with the button present (all states).
- `inline-bottom-sheet-renderer`: stamps the `side-panel` attribute on the card
  iff constructed with `{ sidePanel: true }`.

**E2e (Playwright harness, `packages/extension-chrome/e2e`)**

- New spec: do a lookup → click "Open in side panel" → assert the Chrome side
  panel is open and shows the **same word** → assert the in-page bottom sheet is
  dismissed.
- Assert the button is **present** in the Chrome in-page card (gated on).
- (Safari gating is covered by the unit test for the default-off renderer; no
  Safari e2e harness exists.)

**Manual / evidence**

- Before/after screenshots of the card header in **Sepia, Dark, High-Contrast**
  (via `seedSettings`), hosted on a `pr-assets/` branch with same-origin
  `github.com/.../raw/...` URLs (private-repo rule).
- A short screen recording of the open-panel + dismiss-sheet flow.

## Files touched

| File                                                   | Change                                                                                |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `packages/app/src/ui/styles/tokens.ts`                 | add `ICON_SIDE_PANEL`                                                                 |
| `packages/app/src/ui/lookup-card.ts`                   | gated side-panel action button + `open-side-panel` event                              |
| `packages/app/src/app/inline-bottom-sheet-renderer.ts` | `{ sidePanel }` flag → stamp `side-panel` attr                                        |
| `packages/extension-chrome/src/content.ts`             | enable flag; relay `open-side-panel`; dismiss sheet                                   |
| `packages/extension-chrome/src/sw.ts`                  | intercept `open-side-panel`; `sidePanel.open`; cache + broadcast                      |
| `packages/extension-chrome/src/side-panel.ts`          | boot-time `get-focus` to render the current lookup                                    |
| `design-system/side-panel-button/`                     | saved handoff reference (HTML + README + IMPLEMENTATION_GUIDE w/ authentic §9 prompt) |
| tests                                                  | unit specs + new e2e spec as above                                                    |

## Architecture notes (C3)

- The shared `lookup-card` and `InlineBottomSheetRenderer` (c3-1 **app**) stay
  platform-agnostic — they emit/relay a DOM event and read an attribute; they
  never touch `chrome.*`.
- All `chrome.sidePanel.*` usage stays in the Chrome shell (c3-2), preserving
  `ref-core-dependency-rule` and `rule-domain-purity`.
- The new SW message is sender-gated per `rule-gate-runtime-messages` (S3).
