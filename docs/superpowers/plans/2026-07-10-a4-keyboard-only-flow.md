# A4 Keyboard-Only Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this
> plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 3 `chrome.commands` keyboard shortcuts — `define-selection`, `dismiss-lookup`,
`send-to-panel` — with no default binding, so a reader can start/dismiss/send a lookup without
touching the mouse.

**Architecture:** All changes live in `packages/extension-chrome/**` (Chrome-only shell). The
service worker (`sw.ts`) relays a fired `chrome.commands` shortcut to the active tab's content
script via `chrome.tabs.sendMessage`; the content script (`content.ts`) dispatches it to the
existing trigger/renderer objects. No change to `packages/app` (the portable core) — this is a
new **input path** into behavior the core already has, not new behavior.

**Tech Stack:** TypeScript, Chrome MV3 `chrome.commands`/`chrome.tabs` APIs, Vitest + happy-dom
(unit), Playwright (e2e). Full design rationale, including what cannot be e2e-tested and why:
`docs/superpowers/specs/2026-07-10-a4-keyboard-only-flow-design.md`.

## Global Constraints

- Implementer: dispatch each implementation/fix task to the `hunter` subagent — never a generic
  implementer.
- **Exactly 3 commands, no default binding** (roadmap A4 scope fence) — no `suggested_key` in
  `manifest.json`, ever.
- **No new manifest permission.** Only `tab.id` is read from `chrome.commands.onCommand`'s `tab`
  param; `chrome.tabs.sendMessage` needs no `"tabs"` permission.
- **No change to `packages/app/src/domain/**`** — `rule-domain-purity`/`ref-core-dependency-rule`.
- Every inbound `chrome.runtime` message stays gated on `sender.id === chrome.runtime.id` (S3),
  following the existing `side-panel-messages.ts` precedent (not `classifyInbound`/
  `WireMessageSchema` — this is Chrome-shell-only plumbing, same category as `open-side-panel`).
- `bun run lint` and `bun run format:check` clean before every commit.

---

### Task 1: Command message type + guard

**Files:**

- Create: `packages/extension-chrome/src/command-messages.ts`
- Create: `packages/extension-chrome/src/command-messages.test.ts`

**Interfaces:** Produces `LookupCommand`, `CommandMessage`, `isCommandMessage()` — consumed by
Task 4 (`sw.ts`, `content.ts`).

- [ ] **Step 1: Write the failing test** — `packages/extension-chrome/src/command-messages.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isCommandMessage } from './command-messages';

describe('command message guard (A4)', () => {
  it('accepts all 3 declared commands', () => {
    expect(isCommandMessage({ type: 'command', command: 'define-selection' })).toBe(true);
    expect(isCommandMessage({ type: 'command', command: 'dismiss-lookup' })).toBe(true);
    expect(isCommandMessage({ type: 'command', command: 'send-to-panel' })).toBe(true);
  });

  it('rejects an unknown command name', () => {
    expect(isCommandMessage({ type: 'command', command: 'nuke-everything' })).toBe(false);
  });

  it('rejects other shapes', () => {
    expect(isCommandMessage({ type: 'lookup' })).toBe(false);
    expect(isCommandMessage({ type: 'command' })).toBe(false); // missing command
    expect(isCommandMessage(null)).toBe(false);
    expect(isCommandMessage(undefined)).toBe(false);
    expect(isCommandMessage('command')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `cd packages/extension-chrome && bunx vitest run src/command-messages.test.ts`
Expected: FAIL — cannot find module `./command-messages`.

- [ ] **Step 3: Implement** — `packages/extension-chrome/src/command-messages.ts`:

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

- [ ] **Step 4: Run the test, verify it passes**

Run: `cd packages/extension-chrome && bunx vitest run src/command-messages.test.ts`
Expected: PASS — 3 tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/extension-chrome/src/command-messages.ts packages/extension-chrome/src/command-messages.test.ts
git commit -m "feat(a4): command message type + guard for chrome.commands relay"
```

---

### Task 2: `ChromeFloatingTrigger.activate()` (keyboard define path)

**Files:**

- Modify: `packages/extension-chrome/src/adapters/chrome-floating-trigger.ts`
- Modify: `packages/extension-chrome/src/adapters/chrome-floating-trigger.test.ts`

**Interfaces:** Produces `ChromeFloatingTrigger.activate(): boolean` — consumed by Task 4
(`content.ts`'s `define-selection` case).

- [ ] **Step 1: Write the failing tests** — append to
      `packages/extension-chrome/src/adapters/chrome-floating-trigger.test.ts` (inside the
      existing `describe('ChromeFloatingTrigger (TriggerUI via <lookup-trigger>)', () => { ... })`
      block, after the last existing `it`):

```ts
it("activate() fires the shown bubble's click, same as a real mouse click", () => {
  const host = document.createElement('div');
  document.body.append(host);
  const trigger = new ChromeFloatingTrigger(host);
  const onClick = vi.fn();
  trigger.show({ x: 10, y: 20, w: 5, h: 5 }, onClick);
  expect(trigger.activate()).toBe(true);
  expect(onClick).toHaveBeenCalledTimes(1);
});

it('activate() is a safe no-op when nothing is shown', () => {
  const host = document.createElement('div');
  document.body.append(host);
  const trigger = new ChromeFloatingTrigger(host);
  expect(() => expect(trigger.activate()).toBe(false)).not.toThrow();
});
```

- [ ] **Step 2: Run the tests, verify they fail**

Run: `cd packages/extension-chrome && bunx vitest run src/adapters/chrome-floating-trigger.test.ts`
Expected: FAIL — `trigger.activate is not a function`.

- [ ] **Step 3: Implement** — in
      `packages/extension-chrome/src/adapters/chrome-floating-trigger.ts`, add the method right
      after `show()` (before `hide()`):

```ts
  /**
   * Keyboard-shortcut path (A4 define-selection): fire the same click the mouse would, on
   * whatever trigger bubble is currently showing. Returns false (no-op) if nothing is
   * selected/shown — matches "define what I just selected": nothing selected, nothing to do.
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

- [ ] **Step 4: Run the tests, verify they pass**

Run: `cd packages/extension-chrome && bunx vitest run src/adapters/chrome-floating-trigger.test.ts`
Expected: PASS — all tests in the file green (existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add packages/extension-chrome/src/adapters/chrome-floating-trigger.ts packages/extension-chrome/src/adapters/chrome-floating-trigger.test.ts
git commit -m "feat(a4): ChromeFloatingTrigger.activate() for the keyboard define path"
```

---

### Task 3: Declare the 3 commands in the manifest (no default binding)

**Files:**

- Modify: `packages/extension-chrome/src/manifest.json`
- Modify: `packages/extension-chrome/test/manifest.test.ts`

**Interfaces:** `manifest.json` gains a top-level `"commands"` key. This is the load-bearing,
automated proof of the scope fence ("no default binding").

- [ ] **Step 1: Write the failing test** — append to
      `packages/extension-chrome/test/manifest.test.ts` (new `it` inside the existing
      `describe('manifest.json (S5 CSP + S8 permissions — exact)', ...)` block):

```ts
it('declares exactly 3 A4 commands with NO default binding (roadmap A4 scope fence)', () => {
  expect(manifest.commands).toEqual({
    'define-selection': { description: 'Define the current text selection' },
    'dismiss-lookup': { description: 'Dismiss the lookup card' },
    'send-to-panel': { description: 'Send the current lookup to the side panel' },
  });
  for (const cmd of Object.values(manifest.commands)) {
    expect('suggested_key' in cmd).toBe(false);
  }
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `cd packages/extension-chrome && bunx vitest run test/manifest.test.ts`
Expected: FAIL — `manifest.commands` is `undefined`.

- [ ] **Step 3: Implement** — in `packages/extension-chrome/src/manifest.json`, insert a new
      `"commands"` key right after the `"background"` block (after its closing `},` on the line
      before `"content_scripts": [`):

```json
  "commands": {
    "define-selection": {
      "description": "Define the current text selection"
    },
    "dismiss-lookup": {
      "description": "Dismiss the lookup card"
    },
    "send-to-panel": {
      "description": "Send the current lookup to the side panel"
    }
  },
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `cd packages/extension-chrome && bunx vitest run test/manifest.test.ts`
Expected: PASS — all `manifest.test.ts` assertions green (existing + new).

- [ ] **Step 5: Commit**

```bash
git add packages/extension-chrome/src/manifest.json packages/extension-chrome/test/manifest.test.ts
git commit -m "feat(a4): declare 3 chrome.commands shortcuts, no default binding"
```

---

### Task 4: Wire the SW → content-script command relay

**Files:**

- Modify: `packages/extension-chrome/src/sw.ts`
- Modify: `packages/extension-chrome/src/content.ts`

**Interfaces:** Consumes `CommandMessage`/`isCommandMessage` (Task 1) and
`ChromeFloatingTrigger.activate()` (Task 2). No new exports — this is composition-root wiring,
the same class of code as the existing `chrome.sidePanel.setPanelBehavior` call in `sw.ts` and
the existing `open-side-panel`/`open-settings` listeners in `content.ts`. Per
`docs/superpowers/specs/2026-07-10-a4-keyboard-only-flow-design.md` ("What CANNOT be
e2e-tested"), this class of wiring has no direct unit test — it is proven by `bun run typecheck`
here and by the e2e tests in Task 5.

- [ ] **Step 1: Wire `sw.ts`** — add the import near the existing `side-panel-messages` import:

```ts
import { type CommandMessage } from './command-messages';
```

Add the listener right before the final `chrome.sidePanel?.setPanelBehavior?.(...)` line:

```ts
// A4: relay a fired chrome.commands keyboard shortcut to the active tab's content script.
// tab.id can be undefined for certain tab kinds (devtools, etc.) — skip those defensively.
// The `command` cast is safe: Chrome only fires onCommand for names declared in
// manifest.json's "commands" key (Task 3), which are exactly LookupCommand's 3 values.
chrome.commands.onCommand.addListener((command, tab) => {
  if (tab.id === undefined) return;
  const message: CommandMessage = {
    type: 'command',
    command: command as CommandMessage['command'],
  };
  void chrome.tabs.sendMessage(tab.id, message).catch(() => undefined); // no listener/tab gone
});
```

- [ ] **Step 2: Wire `content.ts`** — add the import alongside the existing
      `side-panel-messages` import:

```ts
import { isCommandMessage } from './command-messages';
```

Replace the inline `close()` method inside the `runLookupWorkflow({ ... renderer: { ... } })`
call:

```ts
    close() {
      lastFocus = undefined;
      inline.close();
      mirror.close();
    },
```

with a one-line delegate to a new named function:

```ts
    close: dismissAll,
```

Add the `dismissAll` function definition right after the existing
`let lastFocus: SidePanelFocus | undefined;` line (before the `runLookupWorkflow({...})` call):

```ts
let lastFocus: SidePanelFocus | undefined;

/** Close everything the in-page surfaces are currently showing (card + mirror). Shared by the
 * workflow's normal close path and the A4 dismiss-lookup command. */
function dismissAll(): void {
  lastFocus = undefined;
  inline.close();
  mirror.close();
}
```

Finally, add the command listener at the end of the file, after the existing
`document.addEventListener('open-side-panel', ...)` block:

```ts
// A4: keyboard-only flow. The service worker relays a fired chrome.commands shortcut here.
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
      // the card's own "Open in side panel" button already dispatches (see above).
      if (lastFocus !== undefined) document.dispatchEvent(new CustomEvent('open-side-panel'));
      break;
  }
});
```

- [ ] **Step 3: Typecheck**

Run: `cd packages/extension-chrome && bun run typecheck`
Expected: no errors.

- [ ] **Step 4: Run the full extension-chrome unit suite** (regression check — no existing test
      should break from the `close()` refactor)

Run: `cd packages/extension-chrome && bunx vitest run`
Expected: PASS — all existing + Task 1/2/3 tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/extension-chrome/src/sw.ts packages/extension-chrome/src/content.ts
git commit -m "feat(a4): relay chrome.commands shortcuts SW -> content script"
```

---

### Task 5: E2E functional tests + full gate verification

**Files:**

- Modify: `packages/extension-chrome/e2e/helpers.ts`
- Create: `packages/extension-chrome/e2e/keyboard-commands.spec.ts`

**Interfaces:** Adds `getServiceWorker(context)` and `relayCommand(sw, command)` to the shared
e2e helper toolbox (consumed by this task's spec AND by Task 6's evidence spec).

- [ ] **Step 1: Add the shared e2e helpers** — in `packages/extension-chrome/e2e/helpers.ts`,
      widen the top import:

```ts
import type { Page, BrowserContext, Worker } from '@playwright/test';
```

Append at the end of the file:

```ts
/** Resolve the extension's service worker handle, waiting for registration if needed. */
export async function getServiceWorker(context: BrowserContext): Promise<Worker> {
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 10_000 });
  return sw;
}

/**
 * Simulate a chrome.commands keyboard shortcut firing (A4). Playwright/CDP cannot synthesize a
 * real OS-level extension shortcut (Chrome intercepts it before any JS sees a keydown), so this
 * calls chrome.tabs.sendMessage directly from the service worker — the literal call the
 * onCommand listener makes — exercising every line downstream of that (Chrome-owned) listener.
 */
export async function relayCommand(
  sw: Worker,
  command: 'define-selection' | 'dismiss-lookup' | 'send-to-panel',
): Promise<void> {
  await sw.evaluate(async (cmd) => {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const tab = tabs[0];
    if (!tab?.id) throw new Error('no active tab found for command relay');
    await chrome.tabs.sendMessage(tab.id, { type: 'command', command: cmd });
  }, command);
}
```

- [ ] **Step 2: Write the e2e spec** — create
      `packages/extension-chrome/e2e/keyboard-commands.spec.ts`:

```ts
import { test, expect } from './fixtures';
import {
  seedSettings,
  mockGemini,
  gotoFixture,
  selectWord,
  openTrigger,
  getServiceWorker,
  relayCommand,
} from './helpers';

test.describe('A4 keyboard-only flow', () => {
  test('define-selection: selecting text then firing the command opens the card', async ({
    context,
    extensionId,
  }) => {
    await mockGemini(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);
    await gotoFixture(page, 'The river bank is steep here.');
    await page.waitForTimeout(1_000);
    await selectWord(page, 't', 'river bank');
    await page.locator('lookup-trigger').waitFor({ state: 'attached', timeout: 5_000 });

    const sw = await getServiceWorker(context);
    await relayCommand(sw, 'define-selection');

    await expect(page.locator('bottom-sheet lookup-card')).toContainText('financial institution', {
      timeout: 10_000,
    });
  });

  test('define-selection with nothing selected is a safe no-op', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);
    await gotoFixture(page);
    await page.waitForTimeout(1_000);

    const sw = await getServiceWorker(context);
    await relayCommand(sw, 'define-selection');
    await page.waitForTimeout(300);

    await expect(page.locator('lookup-trigger')).toHaveCount(0);
    await expect(page.locator('bottom-sheet')).toHaveCount(0);
  });

  test('dismiss-lookup closes the pending trigger bubble (no click yet)', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);
    await gotoFixture(page, 'The river bank is steep here.');
    await page.waitForTimeout(1_000);
    await selectWord(page, 't', 'river bank');
    await page.locator('lookup-trigger').waitFor({ state: 'attached', timeout: 5_000 });

    const sw = await getServiceWorker(context);
    await relayCommand(sw, 'dismiss-lookup');

    await expect(page.locator('lookup-trigger')).toHaveCount(0);
  });

  test('dismiss-lookup closes an open card', async ({ context, extensionId }) => {
    await mockGemini(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);
    await gotoFixture(page, 'The river bank is steep here.');
    await page.waitForTimeout(1_000);
    await selectWord(page, 't', 'river bank');
    await openTrigger(page);
    await expect(page.locator('bottom-sheet lookup-card')).toContainText('financial institution', {
      timeout: 10_000,
    });

    const sw = await getServiceWorker(context);
    await relayCommand(sw, 'dismiss-lookup');

    await expect(page.locator('bottom-sheet')).toHaveCount(0);
  });

  test('send-to-panel moves the open card to the side panel', async ({ context, extensionId }) => {
    await mockGemini(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);
    await gotoFixture(page, 'The river bank is steep here.');
    await page.waitForTimeout(1_000);
    await selectWord(page, 't', 'river bank');
    await openTrigger(page);
    await expect(page.locator('bottom-sheet lookup-card')).toContainText('financial institution', {
      timeout: 10_000,
    });

    const sw = await getServiceWorker(context);
    await relayCommand(sw, 'send-to-panel');

    await expect(page.locator('bottom-sheet')).toHaveCount(0);

    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/side-panel.html`);
    await panel.waitForSelector('side-panel-view');
    await expect(panel.locator('side-panel-view')).toContainText('financial institution', {
      timeout: 5_000,
    });
  });

  test('send-to-panel with no active lookup does not open the panel', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);

    const sw = await getServiceWorker(context);
    await sw.evaluate(() => {
      (globalThis as unknown as { __openCalls: unknown[] }).__openCalls = [];
      chrome.sidePanel.open = ((opts: unknown) => {
        (globalThis as unknown as { __openCalls: unknown[] }).__openCalls.push(opts);
        return Promise.resolve();
      }) as typeof chrome.sidePanel.open;
    });

    await gotoFixture(page);
    await page.waitForTimeout(1_000);
    await relayCommand(sw, 'send-to-panel');
    await page.waitForTimeout(300);

    const calls = await sw.evaluate(
      () => (globalThis as unknown as { __openCalls: unknown[] }).__openCalls,
    );
    expect(calls.length).toBe(0);
  });
});
```

- [ ] **Step 3: Build the extension, then run the new spec**

Run: `bun run build:chrome && cd packages/extension-chrome && bunx playwright test keyboard-commands`
Expected: PASS — all 6 tests green. (First run: `bunx playwright install --with-deps chromium`
if the browser isn't installed yet.)

- [ ] **Step 4: Full gate verification**

Run, in order, from the repo root:

```bash
bun run lint
bun run format:check
bun run typecheck
bun run test
bun run build:chrome
bun run build:safari
```

Expected: every command exits 0. If `format:check` fails, run `bun run format` and re-verify.
`build:safari` must stay green (proof this PR touched no Safari-shared surface incorrectly —
`packages/app` is untouched, so this is a regression check, not new Safari behavior).

- [ ] **Step 5: Commit**

```bash
git add packages/extension-chrome/e2e/helpers.ts packages/extension-chrome/e2e/keyboard-commands.spec.ts
git commit -m "test(a4): e2e coverage for the 3 keyboard commands"
```

---

### Task 6: Before/after evidence recording (video)

**Files:**

- Create: `packages/extension-chrome/e2e/a4-evidence.spec.ts`

**Interfaces:** Consumes `getServiceWorker`/`relayCommand` from Task 5's `helpers.ts`. RUN-gated
like `a16-evidence.spec.ts` — never runs in normal CI.

- [ ] **Step 1: Write the evidence spec** — create
      `packages/extension-chrome/e2e/a4-evidence.spec.ts`:

```ts
/**
 * A4 before/after evidence: a short recorded flow demonstrating the keyboard commands.
 * Not part of the normal suite. (Re)record with:
 *   PLAYWRIGHT_RUN_EVIDENCE=1 SHOT_LABEL=after A4_OUT_DIR=/abs/path \
 *     bunx playwright test a4-evidence
 * Capture BEFORE from a `master` build (no chrome.commands wiring) and AFTER from the branch
 * build, then host the .webm per the private-repo rule (pr-assets branch + same-origin
 * github.com/.../raw URLs).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { test, chromium, type Page } from '@playwright/test';
import { seedSettings, gotoFixture, selectWord, getServiceWorker, relayCommand } from './helpers';
import { E2E_HEADLESS } from '../playwright.config';

const RUN = process.env.PLAYWRIGHT_RUN_EVIDENCE === '1';
const LABEL = process.env.SHOT_LABEL ?? 'after';
const OUT = process.env.A4_OUT_DIR ?? '.';
const here = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(here, '../dist');
const SIZE = { width: 900, height: 560 };

/** On-screen caption so a headless recording can visually mark the instant a simulated
 * chrome.commands relay fires (there is no real key-press to show — same honesty technique as
 * media-demos.spec.ts's synthetic cursor overlay for a pointer headless Chromium doesn't paint). */
async function caption(page: Page, text: string): Promise<void> {
  await page.evaluate((t) => {
    let el = document.getElementById('__a4_caption');
    if (!el) {
      el = document.createElement('div');
      el.id = '__a4_caption';
      Object.assign(el.style, {
        position: 'fixed',
        top: '16px',
        left: '16px',
        zIndex: '2147483647',
        font: '600 15px/1.4 -apple-system, sans-serif',
        background: '#1f2328',
        color: '#fff',
        padding: '8px 14px',
        borderRadius: '8px',
        boxShadow: '0 4px 14px rgba(0,0,0,.3)',
      });
      document.body.appendChild(el);
    }
    el.textContent = t;
  }, text);
}

test.describe('A4 keyboard-only flow — evidence', () => {
  test.skip(!RUN, 'set PLAYWRIGHT_RUN_EVIDENCE=1 to (re)record A4 before/after video');

  test(`keyboard-only define + dismiss (${LABEL})`, async () => {
    const videoDir = path.join(OUT, `a4-${LABEL}-raw`);
    const context = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        ...(E2E_HEADLESS ? ['--headless=new'] : []),
        `--disable-extensions-except=${distDir}`,
        `--load-extension=${distDir}`,
      ],
      viewport: SIZE,
      recordVideo: { dir: videoDir, size: SIZE },
    });
    try {
      await context.route('https://generativelanguage.googleapis.com/**', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            candidates: [{ content: { parts: [{ text: '## bank\nA financial institution.' }] } }],
          }),
        }),
      );

      const sw = await getServiceWorker(context);
      const extensionId = new URL(sw.url()).hostname;

      const page = await context.newPage();
      await page.goto(`chrome-extension://${extensionId}/options.html`);
      await seedSettings(page, { outputFormat: 'Define {word}' });
      await gotoFixture(page, 'The river bank is steep here.');
      await page.waitForTimeout(800);

      await selectWord(page, 't', 'river bank');
      await page.locator('lookup-trigger').waitFor({ state: 'attached', timeout: 5_000 });
      await caption(page, '⌨ define-selection');
      await page.waitForTimeout(500);
      await relayCommand(sw, 'define-selection');
      await page.waitForTimeout(1_800); // hold on the outcome (card on `after`, nothing on `before`)

      await caption(page, '⌨ dismiss-lookup');
      await page.waitForTimeout(500);
      await relayCommand(sw, 'dismiss-lookup');
      await page.waitForTimeout(1_200);

      const video = page.video();
      await page.close();
      await mkdir(OUT, { recursive: true });
      await video?.saveAs(path.join(OUT, `a4-${LABEL}.webm`));
    } finally {
      await context.close().catch(() => {});
    }
  });
});
```

- [ ] **Step 2: Typecheck + lint the new file**

Run: `cd packages/extension-chrome && bun run typecheck && cd /Users/home/repos/ai-dict && bun run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/extension-chrome/e2e/a4-evidence.spec.ts
git commit -m "test(a4): before/after evidence recording spec (gated, not run in CI)"
```

- [ ] **Step 4: Format check**

Run: `bun run format:check`
Expected: clean (run `bun run format` + amend-free follow-up commit if not).

## Self-Review

- **Spec coverage:** command type + guard (Task 1), keyboard-activate on the trigger (Task 2),
  manifest declaration + no-default-binding proof (Task 3), SW relay + content-script dispatch
  for all 3 commands including the `dismissAll` refactor (Task 4), e2e proof of all 6 scenarios
  from the design doc's testing strategy (Task 5), evidence recording spec (Task 6). No gaps
  against the design doc.
- **Placeholder scan:** none — every step has concrete, complete code and an exact command +
  expected result.
- **Type consistency:** `LookupCommand`/`CommandMessage`/`isCommandMessage` (Task 1) are the
  same names used in Task 4's `sw.ts`/`content.ts` wiring; `ChromeFloatingTrigger.activate()`
  (Task 2) is the same method `content.ts`'s `define-selection` case calls (Task 4);
  `getServiceWorker`/`relayCommand` (Task 5) are the same names Task 6 imports.
- **Scope fence:** exactly 3 commands, no `suggested_key` (Task 3's test is the automated lock);
  no `packages/app` changes anywhere in the plan; no new manifest `permissions` entry (`commands`
  is a separate top-level key, confirmed not to break `manifest.test.ts`'s existing exact-match
  permissions assertion).
