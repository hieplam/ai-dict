# A14 Double-Click Trigger Implementation Plan

> **For agentic workers:** implement task-by-task, TDD (red → green → commit) per task. Steps
> use checkbox (`- [ ]`) syntax for tracking. Dispatch each implementation task to the `hunter`
> subagent.

**Goal:** an opt-in setting (`doubleClickLookup`, off by default) that makes double-clicking a
word on the page define it immediately — bypassing the floating Define bubble entirely — while
the ordinary select-then-click-the-button flow keeps working exactly as it does today, and the
bypass never fires inside `input`/`textarea`/`select`/`button`/`[contenteditable]` elements.

**Architecture:** detection lives entirely in `DomSelectionSource` (`packages/app/src/app/
dom-selection-source.ts`) as one boolean check on the existing `mouseup` handler — a real
double-click's second mouseup carries `MouseEvent.detail === 2` (identical across Chromium/
Firefox/WebKit), and the guard is an explicit `Element.closest(...)` check against the target.
No new port, no new wire message, no new manifest permission. The decision of "auto-fire or show
the bubble" moves into `runLookupWorkflow`'s selection callback (`packages/app/src/domain/
workflow.ts`), which reads the new `PublicSettings.doubleClickLookup` field _before_ ever calling
`trigger.show(...)`, so an opted-in reader never sees the bubble flash open and instantly close.
Full design rationale, including the two rejected detection approaches and the guard-list
rationale (why `<a>` is deliberately NOT guarded): `docs/superpowers/specs/
2026-07-17-a14-double-click-trigger-design.md`.

**Tech Stack:** TypeScript, Vitest + happy-dom (unit), Playwright (e2e, Chrome only — Safari gets
the behavior for free through the shared core but has no e2e harness in this repo).

## Global Constraints

- Implementer: dispatch each implementation/fix task to the `hunter` subagent — never a generic
  implementer.
- Start in a fresh git worktree under `.claude/worktrees/` on branch `feature/A14DoubleClickTrigger`.
- Commit subject for every task in this plan: `[A14DoubleClickTrigger] feat: <task summary> (A14)`
  — no `Co-Authored-By` trailer, no attribution footer (repo + global convention).
- `bun run lint` and `bun run format:check` green before every commit; `cd packages/app && bun
run typecheck` green after every task from Task 1 on; `cd packages/extension-chrome && bun run
typecheck` green from Task 5 on (once `Settings`/`SettingsFormValue` gain the field on that
  side); `cd packages/extension-safari && bun run typecheck` green from Task 5 on likewise.
- **No new wire message** — this card only widens an existing optional field on
  `PublicSettingsSchema`; the CONTRACTS "wire.ts arm + router.ts case = ONE task" rule does not
  apply (there is no new arm, and `router.ts`'s `settings.get` case is untouched — verified
  `router.ts:219-220` returns `deps.settings.get()` verbatim).
- **Do not touch** `packages/app/src/app/router.ts`, `packages/extension-chrome/src/sw.ts`,
  `packages/extension-safari/src/sw.ts`, `packages/extension-safari/src/options.ts`,
  `packages/extension-safari/src/content.ts`, `packages/extension-chrome/src/content.ts`, or any
  `manifest.json` — none of them need a change (design spec §6.9–§6.12); if a task in this plan
  seems to need one of these, stop — that means an assumption broke and the plan needs
  re-grounding, not an ad hoc edit.
- **Concurrency (verified 2026-07-23 against this worktree, corrects the design spec's original
  "as of this writing" note):** A15 (trigger-latency-budget) has a spec+plan on disk but has
  **not** landed — no `SELECTION_FIRED_MARK` export exists anywhere in `packages/app/src`, no A15
  branch. Task 2 below implements `dom-selection-source.ts` exactly as the file stands today. If
  A15 lands first (adds `SELECTION_FIRED_MARK` + one `performance.mark(...)` call as the first
  statement inside the same `if (e) { ... }` block this task edits), that addition is purely
  additive — keep it and add this task's `viaDoubleClick` logic immediately after it; nothing in
  this plan depends on or conflicts with it. `packages/app/src/domain/workflow.ts`,
  `packages/app/src/ui/settings-form.ts`, `packages/app/src/domain/types.ts`, and
  `packages/app/src/wire.ts` are also CONTRACTS §5 hot files (shared with A5/A6/A13/A15/B3/B4/A9/
  B6/C9) — re-read the current file before editing if another card's branch merged since this
  plan was written.
- E2e build clears the ambient key: `GEMINI_API_KEY= bun run build:chrome` (never rely on shell
  state).
- E2e must never fetch the live landing page — this card's e2e uses only the existing
  `gotoFixture`/new `gotoEditableFixture` local fixtures.
- PR: title `[A14DoubleClickTrigger] Double-click trigger`; body carries a written **"Testing
  performed"** section (suites, counts, e2e scenarios, gates) — **no screenshots or video**
  (owner ruling 2026-07-16); `## JIRA ticket` section reads `n/a` (this repo is not Jira-tracked —
  see PR #117's own precedent).
- Merge: **regular merge commit only — squash prohibited** (owner ruling 2026-07-16).
- UI reads only `--ad-*`/`--adp-*` tokens; the new "Trigger" section reuses the existing `.check`/
  `.seg-help` classes verbatim — no new CSS, no hard-coded colors.
- S1: no code in this card reads, logs, or exports `apiKey`/`openaiApiKey`/`anthropicApiKey`; the
  new setting is a plain boolean alongside `theme`/`cacheEnabled`.
- Constraint 4 (every LLM call is user-triggered, token-spending features say so first): the
  settings-form copy states "each double-click spends a lookup" directly beside the checkbox
  (Task 4); every lookup this feature triggers remains the direct result of an explicit user
  gesture (the double-click itself).
- `.c3/` is CLI-only; this card changes no architecture (no new component, no new port) so no
  C3 change-unit is needed — verified against the design spec's C3 note (content-script state
  machine `c3-110 lookup-workflow`, `rule-domain-purity`, `rule-typed-errors` — both already
  honored: no `chrome.*`/DOM access enters `domain/`, and no new thrown-value shape is
  introduced).

---

### Task 1: `types.ts` + `wire.ts` — the two new optional fields

**Files:**

- Modify: `packages/app/src/domain/types.ts`
- Modify: `packages/app/src/wire.ts`

**Interfaces produced:**

```ts
export interface SelectionEvent {
  text: string;
  sentence: string;
  anchor: AnchorRect;
  url: string;
  title: string;
  viaDoubleClick?: boolean; // new
}

export interface PublicSettings {
  targetLang: string;
  outputFormat: string;
  promptEnvelope: string;
  hasKey: boolean;
  theme: Theme;
  configuredProviders: Provider[];
  doubleClickLookup?: boolean; // new
}
```

This is a type-only addition with no new runtime behavior to unit-test in isolation — the
existing compile-time drift guard (`wire.ts:206`,
`AssertEqual<z.infer<typeof PublicSettingsSchema>, PublicSettings>`) is the verification: it fails
`tsc` the moment the interface and the zod schema disagree, so both sides are edited together
here. The runtime behavior these fields enable is proven by Task 2 (dom-selection-source, the
producer of `viaDoubleClick`) and Task 3 (workflow.ts, the consumer of `doubleClickLookup`).

- [ ] **Step 1: Add `SelectionEvent.viaDoubleClick?`.** In `packages/app/src/domain/types.ts`,
      replace the `SelectionEvent` interface (currently lines 8-14):

```ts
export interface SelectionEvent {
  text: string;
  sentence: string;
  anchor: AnchorRect;
  url: string;
  title: string;
}
```

with:

```ts
export interface SelectionEvent {
  text: string;
  sentence: string;
  anchor: AnchorRect;
  url: string;
  title: string;
  /** A14: true when this selection came from a native double-click (MouseEvent.detail === 2)
   * on a non-guarded element, rather than a manual drag-select or the touchend path. Absent for
   * every other selection. */
  viaDoubleClick?: boolean;
}
```

- [ ] **Step 2: Add `PublicSettings.doubleClickLookup?`.** In the same file, replace the
      `PublicSettings` interface (currently lines 164-176):

```ts
export interface PublicSettings {
  targetLang: string;
  outputFormat: string;
  /**
   * Full prompt envelope override (advanced, #62). `''` = use the built-in envelope;
   * resolved from a legacy stored `promptTemplate` at read time (see `resolvePromptEnvelope`).
   */
  promptEnvelope: string;
  hasKey: boolean;
  theme: Theme;
  /** Provider names that have an API key configured. Keys themselves are never included. */
  configuredProviders: Provider[];
}
```

with:

```ts
export interface PublicSettings {
  targetLang: string;
  outputFormat: string;
  /**
   * Full prompt envelope override (advanced, #62). `''` = use the built-in envelope;
   * resolved from a legacy stored `promptTemplate` at read time (see `resolvePromptEnvelope`).
   */
  promptEnvelope: string;
  hasKey: boolean;
  theme: Theme;
  /** Provider names that have an API key configured. Keys themselves are never included. */
  configuredProviders: Provider[];
  /** A14: opt-in — double-click a word to define it immediately, bypassing the trigger button.
   * Off (absent/falsy) by default. Read by runLookupWorkflow's selection handler only; nothing
   * on the router/wire path branches on it. */
  doubleClickLookup?: boolean;
}
```

`export interface Settings extends PublicSettings` (`types.ts:210-217`) inherits the new field
automatically — no separate edit needed there.

- [ ] **Step 3: Mirror the field on the wire schema.** In `packages/app/src/wire.ts`, replace
      `PublicSettingsSchema` (currently lines 61-68):

```ts
const PublicSettingsSchema = z.strictObject({
  targetLang: z.string(),
  outputFormat: z.string(),
  promptEnvelope: z.string(),
  hasKey: z.boolean(),
  theme: z.enum(['sepia', 'dark', 'contrast', 'system']),
  configuredProviders: z.array(ProviderEnum),
}); // z.strictObject() rejects extra keys (e.g. apiKey) → enforces [S1]
```

with:

```ts
const PublicSettingsSchema = z.strictObject({
  targetLang: z.string(),
  outputFormat: z.string(),
  promptEnvelope: z.string(),
  hasKey: z.boolean(),
  theme: z.enum(['sepia', 'dark', 'contrast', 'system']),
  configuredProviders: z.array(ProviderEnum),
  doubleClickLookup: z.boolean().optional(),
}); // z.strictObject() rejects extra keys (e.g. apiKey) → enforces [S1]
```

- [ ] **Step 4: Verify the drift guard + full suite compile.** Run:

```
cd packages/app && bun run typecheck && bun run test
```

Expected: `typecheck` clean (the `AssertEqual<z.infer<typeof PublicSettingsSchema>,
PublicSettings>` check at `wire.ts:206` passes because both sides now agree); the full existing
Vitest suite still green (every fixture that omits `doubleClickLookup`/`viaDoubleClick` stays
valid TypeScript — both fields are optional).

- [ ] **Step 5: Commit.**

```
cd packages/app && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

```
git add packages/app/src/domain/types.ts packages/app/src/wire.ts
git commit -m "[A14DoubleClickTrigger] feat: add viaDoubleClick + doubleClickLookup optional fields (A14)" \
  -m $'Tribe-Card: a14-double-click-trigger\nTribe-Task: 1/8'
```

---

### Task 2: `dom-selection-source.ts` — detect the double-click, guard interactive elements

**Files:**

- Modify: `packages/app/src/app/dom-selection-source.ts`
- Modify: `packages/app/test/app/dom-selection-source.test.ts`

**Interfaces produced:**

```ts
// module-private, not exported — internal to dom-selection-source.ts
function isGuardedTarget(target: EventTarget | null): boolean;
```

**Interfaces consumed:** `SelectionEvent.viaDoubleClick?` (Task 1).

- [ ] **Step 1: Write the failing tests.** In `packages/app/test/app/dom-selection-source.test.ts`,
      append a new `describe` block after the existing `describe('DomSelectionSource (event
  wiring)', ...)` block (i.e. right before `describe('defaultReader ...', ...)`):

```ts
describe('DomSelectionSource — A14 double-click detection (viaDoubleClick)', () => {
  const ev: SelectionEvent = {
    text: 'bank',
    sentence: 'the bank.',
    anchor: { x: 1, y: 2, w: 3, h: 4 },
    url: 'u',
    title: 't',
  };

  function fireOn(el: Element, event: Event) {
    const read = vi.fn<() => SelectionEvent | null>(() => ev);
    const src = new DomSelectionSource(document, read);
    const cb = vi.fn();
    src.onSelection(cb);
    el.dispatchEvent(event);
    return cb;
  }

  it('sets viaDoubleClick: true for a detail: 2 mouseup on a plain (unguarded) element', () => {
    document.body.innerHTML = '<p id="plain">text</p>';
    const cb = fireOn(
      document.getElementById('plain')!,
      new MouseEvent('mouseup', { bubbles: true, detail: 2 }),
    );
    expect(cb).toHaveBeenCalledWith({ ...ev, viaDoubleClick: true });
    document.body.innerHTML = '';
  });

  it('does not set the flag for detail: 1 or detail: 3 (exact match, not >= 2)', () => {
    document.body.innerHTML = '<p id="plain">text</p>';
    const el = document.getElementById('plain')!;
    const cb1 = fireOn(el, new MouseEvent('mouseup', { bubbles: true, detail: 1 }));
    expect(cb1).toHaveBeenCalledWith(ev);
    const cb3 = fireOn(el, new MouseEvent('mouseup', { bubbles: true, detail: 3 }));
    expect(cb3).toHaveBeenCalledWith(ev);
    document.body.innerHTML = '';
  });

  it.each(['input', 'textarea', 'select', 'button'])(
    'does not set the flag when target is a guarded <%s>, but the selection still fires',
    (tag) => {
      document.body.innerHTML = `<${tag} id="g"></${tag}>`;
      const cb = fireOn(
        document.getElementById('g')!,
        new MouseEvent('mouseup', { bubbles: true, detail: 2 }),
      );
      expect(cb).toHaveBeenCalledWith(ev); // unflagged, but still called — existing flow intact
      document.body.innerHTML = '';
    },
  );

  it('does not set the flag for an element nested inside a contenteditable="true" ancestor', () => {
    document.body.innerHTML =
      '<div id="edit" contenteditable="true"><span id="inner">x</span></div>';
    const cb = fireOn(
      document.getElementById('inner')!,
      new MouseEvent('mouseup', { bubbles: true, detail: 2 }),
    );
    expect(cb).toHaveBeenCalledWith(ev);
    document.body.innerHTML = '';
  });

  it('sets the flag for an <a> target — anchors are deliberately not guarded', () => {
    document.body.innerHTML = '<a id="link" href="#">word</a>';
    const cb = fireOn(
      document.getElementById('link')!,
      new MouseEvent('mouseup', { bubbles: true, detail: 2 }),
    );
    expect(cb).toHaveBeenCalledWith({ ...ev, viaDoubleClick: true });
    document.body.innerHTML = '';
  });

  it('never sets the flag on a touchend, regardless of any detail-like value', () => {
    document.body.innerHTML = '<p id="plain">text</p>';
    const cb = fireOn(document.getElementById('plain')!, new Event('touchend', { bubbles: true }));
    expect(cb).toHaveBeenCalledWith(ev);
    document.body.innerHTML = '';
  });
});
```

Run:

```
cd packages/app && bunx vitest run test/app/dom-selection-source.test.ts
```

Expected: the 6 new tests **fail** — `isGuardedTarget` doesn't exist yet and nothing ever sets
`viaDoubleClick`, so `cb` is always called with the plain `ev`. The two tests that assert
`viaDoubleClick: true` (the plain-unguarded `detail: 2` test and the `<a>` test) fail because that
key is missing from the actual call. The other four (`detail: 1`/`detail: 3`, the four guarded
elements, and `touchend`) all assert `cb` was called with plain `ev` — which is already true today
with no flag logic at all — so those four pass trivially before Step 2, and stay green after it.

- [ ] **Step 2: Implement.** Replace the entire contents of
      `packages/app/src/app/dom-selection-source.ts` with:

```ts
import type { SelectionSource, SelectionEvent, AnchorRect } from '../index';

const TERMINATORS = ['.', '!', '?'];

// A14: elements where a native double-click means "select text to edit/operate", not "define
// this word" — the opt-in double-click trigger stays silent there. The ordinary select-then-
// click-the-button flow is completely UNCHANGED for these elements (this guard only ever
// suppresses the extra `viaDoubleClick` flag, never the SelectionEvent itself). `a` (anchor) is
// deliberately NOT in this list — see the design spec's "Guard list" section (§3) for why
// excluding links would defeat the feature on link-dense reading pages for no safety benefit (a
// dblclick never navigates; only a single click does).
const GUARDED_SELECTOR =
  'input, textarea, select, button, [contenteditable]:not([contenteditable="false"])';

function isGuardedTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(GUARDED_SELECTOR) !== null;
}

export function extractSentence(full: string, selStart: number, selEnd: number): string {
  const before = full.slice(0, selStart);
  const start = Math.max(...TERMINATORS.map((t) => before.lastIndexOf(t))) + 1;
  const after = full.slice(selEnd);
  const ends = TERMINATORS.map((t) => after.indexOf(t)).filter((i) => i >= 0);
  const end = ends.length ? selEnd + Math.min(...ends) + 1 : full.length;
  return full.slice(start, end).trim();
}

// Default DOM reader: window selection → SelectionEvent. Thin + covered by e2e; unit tests inject a fake.
function defaultReader(): SelectionEvent | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const text = sel.toString().trim();
  if (!text) return null;
  const range = sel.getRangeAt(0);
  const full = range.startContainer.textContent ?? text;
  const r = range.getBoundingClientRect();
  const anchor: AnchorRect = { x: r.x, y: r.y, w: r.width, h: r.height };
  return {
    text,
    sentence: extractSentence(full, range.startOffset, range.endOffset),
    anchor,
    url: location.href,
    title: document.title,
  };
}

type DocEvents = Pick<Document, 'addEventListener' | 'removeEventListener'>;

export class DomSelectionSource implements SelectionSource {
  constructor(
    private readonly doc: DocEvents,
    private readonly read: () => SelectionEvent | null = defaultReader,
  ) {}

  onSelection(cb: (e: SelectionEvent) => void): () => void {
    const handler = (ev: Event): void => {
      const e = this.read();
      if (e) {
        // A14: a native double-click delivers detail === 2 on its second mouseup (UI Events'
        // click-count semantics; identical across Chromium/Firefox/WebKit) — the exact event
        // that also carries the browser's auto-selected word, because a plain first click alone
        // leaves the selection collapsed (this.read() returns null for it, so this branch is
        // never reached on the first click of a double-click — see design spec §2). Triple-click
        // (detail 3, "select the paragraph") deliberately does NOT count. touchend never sets
        // this flag: double-tap is out of scope (design spec §2).
        const viaDoubleClick =
          ev.type === 'mouseup' && (ev as MouseEvent).detail === 2 && !isGuardedTarget(ev.target);
        cb(viaDoubleClick ? { ...e, viaDoubleClick: true } : e);
      }
    };
    for (const t of ['mouseup', 'touchend'] as const) this.doc.addEventListener(t, handler);
    return () => {
      for (const t of ['mouseup', 'touchend'] as const) this.doc.removeEventListener(t, handler);
    };
  }
}
```

Run:

```
cd packages/app && bunx vitest run test/app/dom-selection-source.test.ts
```

Expected: all tests pass (existing 7 + 6 new = 13 blocks — the guarded-element block expands to
4 runtime cases via `it.each`, so `vitest run` reports 16 individual test results).

- [ ] **Step 3: Commit.**

```
cd packages/app && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

```
git add packages/app/src/app/dom-selection-source.ts packages/app/test/app/dom-selection-source.test.ts
git commit -m "[A14DoubleClickTrigger] feat: detect double-click via MouseEvent.detail on mouseup + guard interactive elements (A14)" \
  -m $'Tribe-Card: a14-double-click-trigger\nTribe-Task: 2/8'
```

---

### Task 3: `workflow.ts` — auto-fire bypass, no button flash

**Files:**

- Modify: `packages/app/src/domain/workflow.ts`
- Modify: `packages/app/test/workflow.test.ts`

**Interfaces produced:** none new (internal `fire()` closure is not exported).
**Interfaces consumed:** `SelectionEvent.viaDoubleClick?`, `PublicSettings.doubleClickLookup?`
(Task 1); the already-existing `WorkflowDeps`/`SettingsStore`/`TriggerUI` ports are unchanged.

- [ ] **Step 1: Write the failing tests.** In `packages/app/test/workflow.test.ts`, first extend
      `pub()` and `harness()` (currently lines 27-59):

```ts
const pub = (hasKey: boolean, configuredProviders?: Provider[], doubleClickLookup?: boolean) => {
  const fallback: Provider[] = hasKey ? ['gemini'] : [];
  return {
    targetLang: 'vi',
    outputFormat: 'tpl',
    promptEnvelope: 'ENV-MARKER',
    hasKey,
    theme: 'sepia' as const,
    configuredProviders: configuredProviders ?? fallback,
    ...(doubleClickLookup ? { doubleClickLookup: true } : {}),
  };
};

function harness(opts: {
  hasKey?: boolean;
  configuredProviders?: Provider[];
  impl?: FakeLookupClient['lookup'];
  now?: () => number;
  doubleClickLookup?: boolean;
}) {
  const selection = new FakeSelectionSource();
  const trigger = new FakeTriggerUI();
  const renderer = new FakeResultRenderer();
  const client = new FakeLookupClient(opts.impl ?? (() => Promise.resolve(okResult)));
  const settings = new FakeSettingsStore(
    pub(opts.hasKey ?? true, opts.configuredProviders, opts.doubleClickLookup),
  );
  const teardown = runLookupWorkflow({
    selection,
    trigger,
    renderer,
    client,
    settings,
    ...(opts.now ? { now: opts.now } : {}),
  });
  return { selection, trigger, renderer, client, settings, teardown };
}
```

Then append, just before the final closing `});` of `describe('runLookupWorkflow', ...)`:

```ts
describe('A14: double-click bypass', () => {
  const dblSel: SelectionEvent = { ...sel, viaDoubleClick: true };

  it('doubleClickLookup on + a viaDoubleClick selection auto-fires runLookup, trigger never shown', async () => {
    const h = harness({ doubleClickLookup: true });
    h.selection.emit(dblSel);
    await vi.waitFor(() => expect(h.renderer.calls).toContain('result'));
    expect(h.trigger.shown).toBeNull(); // never shown — bypassed entirely
    expect(h.client.lastReq).toMatchObject({ word: 'bank', context: 'river bank' });
  });

  it('setting off (default) + a viaDoubleClick selection only shows the trigger, no auto-fire', async () => {
    const h = harness({}); // doubleClickLookup absent → off
    h.selection.emit(dblSel);
    await vi.waitFor(() => expect(h.trigger.shown).not.toBeNull());
    expect(h.renderer.calls).toEqual([]);
    h.trigger.click();
    await vi.waitFor(() => expect(h.renderer.calls).toContain('result'));
  });

  it('setting on + a plain (non-double-click) selection never auto-fires — only viaDoubleClick bypasses', async () => {
    const h = harness({ doubleClickLookup: true });
    h.selection.emit(sel); // no viaDoubleClick
    expect(h.trigger.shown).not.toBeNull();
    expect(h.renderer.calls).toEqual([]);
  });

  it('the double-click auto-fire path is still cooldown-gated (same RATE_LIMIT as a rapid double-click)', async () => {
    let t = 0;
    const h = harness({ doubleClickLookup: true, now: () => t });
    h.selection.emit(dblSel);
    await vi.waitFor(() => expect(h.renderer.calls).toContain('result'));
    t = COOLDOWN_MS - 1; // still inside the window
    h.selection.emit(dblSel);
    await vi.waitFor(() => expect(h.renderer.lastError?.code).toBe('RATE_LIMIT'));
    expect(h.renderer.lastError?.message).toContain('Slow down');
  });
});
```

Run:

```
cd packages/app && bunx vitest run test/workflow.test.ts
```

Expected: the 4 new tests **fail** — `viaDoubleClick`/`doubleClickLookup` aren't read anywhere
yet, so every double-click selection just shows the trigger like any other selection (the first
and fourth tests fail: no auto-fire ever happens).

- [ ] **Step 2: Implement.** In `packages/app/src/domain/workflow.ts`, replace the `onSelection`
      callback (currently lines 123-139):

```ts
const teardown = deps.selection.onSelection((e) => {
  deps.trigger.show(e.anchor, () => {
    // Cooldown gate, checked BEFORE runLookup. runLookup begins by aborting the in-flight
    // request, so gating here means a too-fast second click neither fires a new request NOR
    // cancels the first one already in flight — first-come-first-served.
    const t = now();
    if (t - lastFireAt < COOLDOWN_MS) {
      deps.trigger.hide();
      deps.renderer.renderError(mapError({ kind: 'cooldown' }));
      return;
    }
    lastFireAt = t;
    void runLookup(e).catch((err) =>
      deps.renderer.renderError(mapError({ kind: 'thrown', error: err })),
    );
  });
});
```

with:

```ts
const teardown = deps.selection.onSelection((e) => {
  // Cooldown gate, checked BEFORE runLookup. runLookup begins by aborting the in-flight
  // request, so gating here means a too-fast second click neither fires a new request NOR
  // cancels the first one already in flight — first-come-first-served. Shared by the trigger
  // button's click AND the A14 double-click auto-fire below — both routes to firing a lookup
  // go through this exact same gate.
  const fire = (): void => {
    const t = now();
    if (t - lastFireAt < COOLDOWN_MS) {
      deps.trigger.hide();
      deps.renderer.renderError(mapError({ kind: 'cooldown' }));
      return;
    }
    lastFireAt = t;
    void runLookup(e).catch((err) =>
      deps.renderer.renderError(mapError({ kind: 'thrown', error: err })),
    );
  };
  // A14: an opt-in double-click bypasses the trigger button entirely. Decide BEFORE ever
  // showing the bubble, so an opted-in reader never sees it flash open and instantly close
  // (design spec §5) — settings.get() resolves first, then either fires immediately (on) or
  // shows the button exactly like any other selection (off, the default). A settings-read
  // failure fails toward the existing behavior: show the button rather than silently doing
  // nothing.
  if (e.viaDoubleClick) {
    void deps.settings.get().then(
      (s) => {
        if (s.doubleClickLookup) fire();
        else deps.trigger.show(e.anchor, fire);
      },
      () => deps.trigger.show(e.anchor, fire),
    );
    return;
  }
  deps.trigger.show(e.anchor, fire);
});
```

Run:

```
cd packages/app && bunx vitest run test/workflow.test.ts
```

Expected: all tests pass (existing suite + 4 new).

- [ ] **Step 3: Commit.**

```
cd packages/app && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

```
git add packages/app/src/domain/workflow.ts packages/app/test/workflow.test.ts
git commit -m "[A14DoubleClickTrigger] feat: double-click auto-fires the cooldown-gated lookup when opted in (A14)" \
  -m $'Tribe-Card: a14-double-click-trigger\nTribe-Task: 3/8'
```

---

### Task 4: `settings-form.ts` — the "Trigger" section + checkbox

**Files:**

- Modify: `packages/app/src/ui/settings-form.ts`
- Modify: `packages/app/test/ui/settings-form.test.ts`

**Interfaces produced:**

```ts
export interface SettingsFormValue {
  provider: Provider;
  apiKey: string;
  openaiApiKey: string;
  anthropicApiKey: string;
  targetLang: string;
  outputFormat: string;
  promptEnvelope: string;
  cacheEnabled: boolean;
  saveHistory: boolean;
  doubleClickLookup?: boolean; // new
  theme: Theme;
}
```

- [ ] **Step 1: Write the failing tests.** In `packages/app/test/ui/settings-form.test.ts`,
      replace the section-order test (currently):

```ts
it('groups controls into Connection, Translation, Appearance, and Privacy & data sections', () => {
  const el = mountForm();
  const heads = [...el.shadowRoot!.querySelectorAll('.sec .sec-h')].map((h) => h.textContent);
  // 'Developer mode' is a hidden section (revealed only by the Konami code) sitting after Translation.
  expect(heads).toEqual([
    'Connection',
    'Translation',
    'Developer mode',
    'Appearance',
    'Privacy & data',
  ]);
});
```

with:

```ts
it('groups controls into Connection, Translation, Appearance, Trigger, and Privacy & data sections', () => {
  const el = mountForm();
  const heads = [...el.shadowRoot!.querySelectorAll('.sec .sec-h')].map((h) => h.textContent);
  // 'Developer mode' is a hidden section (revealed only by the Konami code) sitting after Translation.
  // A14: 'Trigger' sits between Appearance and Privacy & data (settings-form.ts §6.5 of the design spec).
  expect(heads).toEqual([
    'Connection',
    'Translation',
    'Developer mode',
    'Appearance',
    'Trigger',
    'Privacy & data',
  ]);
});
```

Then, in the "keeps every required control" test, add `'#dblclick-lookup'` to the selector list
(currently between `'#history'` and `'#save'`):

```ts
      '#history',
      '#dblclick-lookup',
      '#save',
```

Then append this new test right after the "keeps every required control" test:

```ts
it('A14: #dblclick-lookup defaults unchecked, round-trips through value/collect, and rides the save event', () => {
  const el = mountForm();
  const checkbox = el.shadowRoot!.querySelector<HTMLInputElement>('#dblclick-lookup')!;
  expect(checkbox.checked).toBe(false); // off by default

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
    doubleClickLookup: true,
    theme: 'sepia',
  };
  expect(checkbox.checked).toBe(true);

  checkbox.checked = false;
  let captured: SettingsFormValue | undefined;
  el.addEventListener('save', (e) => {
    captured = (e as CustomEvent<SettingsFormValue>).detail;
  });
  el.shadowRoot!.querySelector('form')!.dispatchEvent(
    new Event('submit', { bubbles: true, cancelable: true }),
  );
  expect(captured?.doubleClickLookup).toBe(false);
});
```

Run:

```
cd packages/app && bunx vitest run test/ui/settings-form.test.ts
```

Expected: the section-order test fails (no `'Trigger'` heading yet); the control-list test fails
(`#dblclick-lookup` doesn't exist); the new round-trip test fails (querySelector returns `null`).

- [ ] **Step 2: Implement.** In `packages/app/src/ui/settings-form.ts`:

  (a) Extend `SettingsFormValue` (currently lines 29-45) — add one field after `saveHistory`:

```ts
export interface SettingsFormValue {
  provider: Provider;
  apiKey: string;
  openaiApiKey: string;
  anthropicApiKey: string;
  targetLang: string;
  outputFormat: string;
  // Full prompt envelope override (advanced, #62). '' = use the built-in envelope. The textarea
  // is prefilled with the real built-in envelope for editing, but '' is emitted until the user
  // actually edits it (or a legacy custom envelope was supplied).
  promptEnvelope: string;
  cacheEnabled: boolean;
  saveHistory: boolean;
  /** A14: opt-in double-click-to-define. Optional so existing test fixtures that predate this
   * field stay valid; collect()/the `set value()` setter always supply a concrete boolean. */
  doubleClickLookup?: boolean;
  theme: Theme;
  // NOTE: `hasKey` and `configuredProviders` are intentionally absent — they are
  // derived fields computed on save/read and never emitted by the form's 'save' event.
}
```

(b) Insert a new `<section>` into `MARKUP` right after the Appearance section's closing
`</section>` (currently line 201) and before the Privacy & data section (currently line
202):

```html
<section class="sec" aria-labelledby="sec-trigger">
  <h2 class="sec-h" id="sec-trigger">Trigger</h2>
  <label class="check"><input type="checkbox" id="dblclick-lookup" /> Double-click to define</label>
  <p class="seg-help">
    Off by default. Double-click a word to look it up immediately, skipping the Define button — each
    double-click spends a lookup. Never fires in text fields, form controls, or editable text.
  </p>
</section>
```

(c) Add one line to `collect()` (currently lines 563-580), right after `saveHistory:`:

```ts
      saveHistory: this.q<HTMLInputElement>('#history').checked,
      doubleClickLookup: this.q<HTMLInputElement>('#dblclick-lookup').checked,
      theme: this.getThemePref(),
```

(d) Add one line to `set value(v)` (currently lines 582-611), right after the `#history` line:

```ts
this.q<HTMLInputElement>('#history').checked = v.saveHistory;
this.q<HTMLInputElement>('#dblclick-lookup').checked = v.doubleClickLookup ?? false;
```

No JS event-listener wiring is needed for the checkbox itself: the existing delegated
`dirtyForm.addEventListener('input'/'change', markDirtyOnEdit)` (lines ~302-308) already covers
every control inside `<form>` except `#error-reporting`, so toggling `#dblclick-lookup` already
marks the form dirty for free.

Run:

```
cd packages/app && bunx vitest run test/ui/settings-form.test.ts
```

Expected: all tests pass (existing suite, with the two updated tests, + 1 new).

- [ ] **Step 3: Commit.**

```
cd packages/app && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

```
git add packages/app/src/ui/settings-form.ts packages/app/test/ui/settings-form.test.ts
git commit -m "[A14DoubleClickTrigger] feat: add the Trigger section + double-click checkbox to settings-form (A14)" \
  -m $'Tribe-Card: a14-double-click-trigger\nTribe-Task: 4/8'
```

---

### Task 5: storage-store adapters — Chrome + Safari parity

**Files:**

- Modify: `packages/extension-chrome/src/adapters/chrome-storage-store.ts`
- Modify: `packages/extension-chrome/src/adapters/chrome-storage-store.test.ts`
- Modify: `packages/extension-safari/src/adapters/safari-storage-store.ts`
- Modify: `packages/extension-safari/src/adapters/safari-storage-store.test.ts`

**Interfaces consumed:** `PublicSettings.doubleClickLookup?` (Task 1); `SettingsStore.get()` (an
existing port method in `packages/app/src/ports.ts` — signature unchanged).

- [ ] **Step 1: Write the failing tests.** Append to
      `packages/extension-chrome/src/adapters/chrome-storage-store.test.ts`, inside the existing
      `describe('ChromeStorageStore (SettingsStore; S1 key isolation)', ...)` block:

```ts
it('A14: get() omits doubleClickLookup when unset, and surfaces it when stored true', async () => {
  const off = await new ChromeStorageStore(fakeArea({ apiKey: 'AIza' })).get();
  expect('doubleClickLookup' in off).toBe(false);

  const on = await new ChromeStorageStore(
    fakeArea({ apiKey: 'AIza', doubleClickLookup: true }),
  ).get();
  expect(on.doubleClickLookup).toBe(true);
});
```

Append the equivalent to `packages/extension-safari/src/adapters/safari-storage-store.test.ts`,
inside `describe('SafariStorageStore (SettingsStore; S1 key isolation)', ...)`:

```ts
it('A14: get() omits doubleClickLookup when unset, and surfaces it when stored true', async () => {
  const off = await new SafariStorageStore(fakeArea({ apiKey: 'AIza' })).get();
  expect('doubleClickLookup' in off).toBe(false);

  const on = await new SafariStorageStore(
    fakeArea({ apiKey: 'AIza', doubleClickLookup: true }),
  ).get();
  expect(on.doubleClickLookup).toBe(true);
});
```

Run:

```
cd packages/extension-chrome && bunx vitest run src/adapters/chrome-storage-store.test.ts
cd ../extension-safari && bunx vitest run src/adapters/safari-storage-store.test.ts
```

Expected: both new tests **fail** — `get()` never reads `doubleClickLookup` yet, so
`on.doubleClickLookup` is `undefined`, not `true` (the "omits when unset" half trivially passes
already since the field never appears, but keep it in the same test — it must keep passing after
Step 2 too).

- [ ] **Step 2: Implement.** In `packages/extension-chrome/src/adapters/chrome-storage-store.ts`,
      replace `get()` (currently lines 44-60):

```ts
  async get(): Promise<PublicSettings> {
    const s = await this.read();
    return {
      targetLang: s?.targetLang ?? DEFAULT_TARGET,
      outputFormat: s?.outputFormat ?? DEFAULT_OUTPUT_FORMAT,
      // Read-time legacy resolution: a stored custom `promptTemplate` (pre-#63) becomes the
      // envelope override; a shipped default or absent value → '' (built-in). No write migration.
      // (A legacy stored object still carries `promptTemplate` at runtime even though `Settings`
      // no longer declares it — `resolvePromptEnvelope` reads it structurally.)
      promptEnvelope: resolvePromptEnvelope(s ?? {}),
      hasKey: hasKeyFor(s ?? {}) || this.envGeminiKey,
      // Coerce: settings stored before the theme setting existed have no `theme`, and
      // pre-Paperlight settings hold the legacy 'light' value → both normalise to 'sepia'.
      theme: normalizeTheme(s?.theme),
      configuredProviders: configuredProvidersFor(s ?? {}, { envGeminiKey: this.envGeminiKey }),
    };
  }
```

with:

```ts
  async get(): Promise<PublicSettings> {
    const s = await this.read();
    return {
      targetLang: s?.targetLang ?? DEFAULT_TARGET,
      outputFormat: s?.outputFormat ?? DEFAULT_OUTPUT_FORMAT,
      // Read-time legacy resolution: a stored custom `promptTemplate` (pre-#63) becomes the
      // envelope override; a shipped default or absent value → '' (built-in). No write migration.
      // (A legacy stored object still carries `promptTemplate` at runtime even though `Settings`
      // no longer declares it — `resolvePromptEnvelope` reads it structurally.)
      promptEnvelope: resolvePromptEnvelope(s ?? {}),
      hasKey: hasKeyFor(s ?? {}) || this.envGeminiKey,
      // Coerce: settings stored before the theme setting existed have no `theme`, and
      // pre-Paperlight settings hold the legacy 'light' value → both normalise to 'sepia'.
      theme: normalizeTheme(s?.theme),
      configuredProviders: configuredProvidersFor(s ?? {}, { envGeminiKey: this.envGeminiKey }),
      // A14: never emit an explicit `false` — omit the key entirely when unset so every existing
      // exact `toEqual({...})` assertion in this file's other tests keeps passing unmodified.
      ...(s?.doubleClickLookup ? { doubleClickLookup: true } : {}),
    };
  }
```

In `packages/extension-safari/src/adapters/safari-storage-store.ts`, replace `get()` (currently
lines 39-55):

```ts
  async get(): Promise<PublicSettings> {
    const s = await this.read();
    return {
      targetLang: s?.targetLang ?? DEFAULT_TARGET,
      outputFormat: s?.outputFormat ?? DEFAULT_OUTPUT_FORMAT,
      // Read-time legacy resolution: a stored custom `promptTemplate` (pre-#63) becomes the
      // envelope override; a shipped default or absent value → '' (built-in). No write migration.
      // (A legacy stored object still carries `promptTemplate` at runtime even though `Settings`
      // no longer declares it — `resolvePromptEnvelope` reads it structurally.)
      promptEnvelope: resolvePromptEnvelope(s ?? {}),
      hasKey: hasKeyFor(s ?? {}),
      // Coerce: settings stored before the theme setting existed have no `theme`, and
      // pre-Paperlight settings hold the legacy 'light' value → both normalise to 'sepia'.
      theme: normalizeTheme(s?.theme),
      configuredProviders: configuredProvidersFor(s ?? {}),
    };
  }
```

with:

```ts
  async get(): Promise<PublicSettings> {
    const s = await this.read();
    return {
      targetLang: s?.targetLang ?? DEFAULT_TARGET,
      outputFormat: s?.outputFormat ?? DEFAULT_OUTPUT_FORMAT,
      // Read-time legacy resolution: a stored custom `promptTemplate` (pre-#63) becomes the
      // envelope override; a shipped default or absent value → '' (built-in). No write migration.
      // (A legacy stored object still carries `promptTemplate` at runtime even though `Settings`
      // no longer declares it — `resolvePromptEnvelope` reads it structurally.)
      promptEnvelope: resolvePromptEnvelope(s ?? {}),
      hasKey: hasKeyFor(s ?? {}),
      // Coerce: settings stored before the theme setting existed have no `theme`, and
      // pre-Paperlight settings hold the legacy 'light' value → both normalise to 'sepia'.
      theme: normalizeTheme(s?.theme),
      configuredProviders: configuredProvidersFor(s ?? {}),
      // A14: never emit an explicit `false` — omit the key entirely when unset, platform parity
      // with ChromeStorageStore.get().
      ...(s?.doubleClickLookup ? { doubleClickLookup: true } : {}),
    };
  }
```

Run:

```
cd packages/extension-chrome && bunx vitest run src/adapters/chrome-storage-store.test.ts
cd ../extension-safari && bunx vitest run src/adapters/safari-storage-store.test.ts
```

Expected: all tests pass in both files (existing suites + 1 new each).

- [ ] **Step 3: Commit.**

```
cd packages/extension-chrome && bun run typecheck && cd ../extension-safari && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

```
git add packages/extension-chrome/src/adapters/chrome-storage-store.ts packages/extension-chrome/src/adapters/chrome-storage-store.test.ts packages/extension-safari/src/adapters/safari-storage-store.ts packages/extension-safari/src/adapters/safari-storage-store.test.ts
git commit -m "[A14DoubleClickTrigger] feat: surface doubleClickLookup from storage on both platforms (A14)" \
  -m $'Tribe-Card: a14-double-click-trigger\nTribe-Task: 5/8'
```

---

### Task 6: Chrome `options.ts` — persist the checkbox across a page reload

**Files:**

- Modify: `packages/extension-chrome/src/options.ts`

**Interfaces consumed:** `SettingsFormValue.doubleClickLookup?` (Task 4), `Settings` (extends
`PublicSettings`, Task 1).

No dedicated unit test exists for `options.ts` in this repo — it is a composition root, covered by
e2e only (same precedent as C2's `options.ts` edit and B5's `content.ts`/`side-panel.ts` edits).
This task's correctness is proven by Task 7's e2e; still run the gate below so a regression in
existing behavior (settings save, cache/history clear, etc. — all in the same file) is caught
immediately.

- [ ] **Step 1: Implement.** In `packages/extension-chrome/src/options.ts`, replace `toFormValue`
      (currently lines 67-80):

```ts
function toFormValue(s: Settings): SettingsFormValue {
  return {
    provider: s.provider,
    apiKey: s.apiKey,
    openaiApiKey: s.openaiApiKey,
    anthropicApiKey: s.anthropicApiKey ?? '',
    targetLang: s.targetLang,
    outputFormat: s.outputFormat,
    promptEnvelope: s.promptEnvelope,
    cacheEnabled: s.cacheEnabled,
    saveHistory: s.saveHistory,
    theme: s.theme,
  };
}
```

with:

```ts
function toFormValue(s: Settings): SettingsFormValue {
  return {
    provider: s.provider,
    apiKey: s.apiKey,
    openaiApiKey: s.openaiApiKey,
    anthropicApiKey: s.anthropicApiKey ?? '',
    targetLang: s.targetLang,
    outputFormat: s.outputFormat,
    promptEnvelope: s.promptEnvelope,
    cacheEnabled: s.cacheEnabled,
    saveHistory: s.saveHistory,
    doubleClickLookup: s.doubleClickLookup,
    theme: s.theme,
  };
}
```

`wireSettings`'s `save` listener (currently lines 113-134) needs **no change**: it already does
`{ ...cur, ...next, hasKey: hasKeyFor(next), configuredProviders: configured }`, and `next` (a
`SettingsFormValue`) now includes `doubleClickLookup` from `collect()` (Task 4) — the existing
spread carries it through to `chrome.storage.local.set(...)` automatically, exactly like
`cacheEnabled`/`saveHistory` already do.

`packages/extension-safari/src/options.ts` needs **no change** — it assigns the whole stored
`Settings` object directly as the form's `.value` (line 37:
`(form as unknown as { value: Settings }).value = s;`) rather than rebuilding a narrower literal,
so it already carries `doubleClickLookup` through verbatim once Task 1/Task 4 land; its `save`
listener (line 56) uses the same `{ ...cur, ...next }` spread as Chrome's.

- [ ] **Step 2: Verify.**

```
cd packages/extension-chrome && bun run typecheck
```

Expected: clean (no other file in this package references `SettingsFormValue`/`Settings` in a way
that would break from the new optional field).

- [ ] **Step 3: Commit.**

```
bun run lint && bun run format:check
```

```
git add packages/extension-chrome/src/options.ts
git commit -m "[A14DoubleClickTrigger] feat: persist doubleClickLookup through the Chrome options page reload (A14)" \
  -m $'Tribe-Card: a14-double-click-trigger\nTribe-Task: 6/8'
```

---

### Task 7: e2e coverage — new fixture helpers + the functional spec

**Files:**

- Modify: `packages/extension-chrome/e2e/helpers.ts`
- Create: `packages/extension-chrome/e2e/a14-double-click-trigger.spec.ts`

**Interfaces produced:**

```ts
export interface SettingsOverrides {
  // ...existing fields...
  doubleClickLookup?: boolean; // new
}

export async function dblclickWord(page: Page, id: string, word: string): Promise<void>;
export async function gotoEditableFixture(
  page: Page,
  paragraph?: string,
  editableText?: string,
): Promise<void>;
```

- [ ] **Step 1: Add the two new fixture helpers + the settings override field.** In
      `packages/extension-chrome/e2e/helpers.ts`:

  (a) Add one field to `SettingsOverrides` (currently lines 24-36), after `anthropicApiKey`:

```ts
export interface SettingsOverrides {
  targetLang?: string;
  outputFormat?: string;
  promptEnvelope?: string;
  apiKey?: string;
  cacheEnabled?: boolean;
  saveHistory?: boolean;
  hasKey?: boolean;
  theme?: 'sepia' | 'dark' | 'contrast' | 'system';
  provider?: 'gemini' | 'openai' | 'anthropic';
  openaiApiKey?: string;
  anthropicApiKey?: string;
  doubleClickLookup?: boolean;
}
```

(b) Append these two new exports at the end of the file (after `relayCommand`):

```ts
/**
 * A14: like selectWord, but dispatches the synthetic mouseup ON the container element (not
 * document) with detail: 2 — the UI Events click-count value a real double-click's second
 * mouseup carries. Dispatching on the container (not document) means `event.target` is that
 * element, so DomSelectionSource's `isGuardedTarget(ev.target)` check exercises the real guard
 * list against whatever element actually contains the word.
 */
export async function dblclickWord(page: Page, id: string, word: string): Promise<void> {
  await page.evaluate(
    ({ id, word }) => {
      const container = document.getElementById(id)!;
      const textNode = container.firstChild!;
      const text = textNode.textContent ?? '';
      const start = text.indexOf(word);
      const range = document.createRange();
      range.setStart(textNode, start);
      range.setEnd(textNode, start + word.length);
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
      container.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, detail: 2 }));
    },
    { id, word },
  );
}

/**
 * A14: like gotoFixture, but the page also ships a `<div id="edit" contenteditable="true">`
 * region — the guarded-target e2e proves the double-click bypass never fires inside it even
 * with the feature switched on.
 */
export async function gotoEditableFixture(
  page: Page,
  paragraph = 'The bank by the river is steep.',
  editableText = 'Edit this bank statement.',
): Promise<void> {
  await page.route('http://test.fixture/', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: `<html><body><p id="t">${paragraph}</p><div id="edit" contenteditable="true">${editableText}</div></body></html>`,
    }),
  );
  await page.goto('http://test.fixture/');
}
```

- [ ] **Step 2: Write the new functional spec.** Create
      `packages/extension-chrome/e2e/a14-double-click-trigger.spec.ts`:

```ts
import { test, expect } from './fixtures';
import {
  seedSettings,
  gotoFixture,
  gotoEditableFixture,
  dblclickWord,
  openTrigger,
  mockGemini,
} from './helpers';

test.describe('A14 double-click trigger', () => {
  test('off by default: double-clicking a word still shows the trigger bubble, no auto-fire', async ({
    context,
    extensionId,
  }) => {
    const calls = await mockGemini(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page); // doubleClickLookup absent → off
    await gotoFixture(page);
    await page.waitForTimeout(1_000); // let the content workflow initialise

    await dblclickWord(page, 't', 'bank');
    await page.locator('lookup-trigger').waitFor({ state: 'attached', timeout: 5_000 });
    expect(await page.locator('bottom-sheet lookup-card').count()).toBe(0);
    expect(calls.count).toBe(0);

    await openTrigger(page);
    await expect(page.locator('bottom-sheet lookup-card')).toContainText('financial institution', {
      timeout: 10_000,
    });
    expect(calls.count).toBe(1);
  });

  test('opted in: double-clicking a word defines it immediately, bypassing the trigger button', async ({
    context,
    extensionId,
  }) => {
    const calls = await mockGemini(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page, { doubleClickLookup: true });
    await gotoFixture(page);
    await page.waitForTimeout(1_000);

    await dblclickWord(page, 't', 'bank');
    await expect(page.locator('bottom-sheet lookup-card')).toContainText('financial institution', {
      timeout: 10_000,
    });
    expect(calls.count).toBe(1);
  });

  test('opted in but guarded: double-clicking inside a contenteditable region never auto-fires', async ({
    context,
    extensionId,
  }) => {
    const calls = await mockGemini(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page, { doubleClickLookup: true });
    await gotoEditableFixture(page);
    await page.waitForTimeout(1_000);

    await dblclickWord(page, 'edit', 'bank');
    await page.waitForTimeout(500); // give an errant auto-fire a chance to render
    expect(await page.locator('bottom-sheet lookup-card').count()).toBe(0);
    expect(calls.count).toBe(0);
  });
});
```

Run:

```
GEMINI_API_KEY= bun run build:chrome
cd packages/extension-chrome && bunx playwright test a14-double-click-trigger
```

Expected: 3 passed.

- [ ] **Step 3: Commit.**

```
GEMINI_API_KEY= bun run build:chrome
bun run lint && bun run format:check
```

```
git add packages/extension-chrome/e2e/helpers.ts packages/extension-chrome/e2e/a14-double-click-trigger.spec.ts
git commit -m "[A14DoubleClickTrigger] feat: e2e coverage for the double-click bypass + guard list (A14)" \
  -m $'Tribe-Card: a14-double-click-trigger\nTribe-Task: 7/8'
```

---

### Task 8: Final gate + PR

- [ ] **Step 1: Run every gate, once, in order:**

```
cd packages/app && bun run typecheck
cd ../extension-chrome && bun run typecheck
cd ../extension-safari && bun run typecheck
cd ../..
bun run test
bun run lint
bun run format:check
GEMINI_API_KEY= bun run build:chrome
cd packages/extension-chrome && bunx playwright test a14-double-click-trigger onboarding lookup cooldown
```

Expected: typecheck clean on all three packages; the full Vitest suite green (including every
addition from Tasks 1-5); lint/format clean; the Chrome build succeeds with the env key cleared;
`a14-double-click-trigger.spec.ts` (3 new), plus `onboarding`/`lookup`/`cooldown` (regression
guards for the shared files this card touched — `workflow.ts`, `dom-selection-source.ts`) all
pass.

- [ ] **Step 2: Open the PR.**

Title: `[A14DoubleClickTrigger] Double-click trigger`

Body:

```
## Description
Adds an opt-in setting: double-clicking a word defines it immediately, bypassing the Define
button. Off by default; never fires inside input/textarea/select/button/[contenteditable]
elements; the ordinary select-then-click flow is unchanged.

## Design choices
- Detection reuses the existing mouseup handler's MouseEvent.detail === 2 (no new listener, no
  event race) — see the design spec §2 for the two rejected alternatives.
- `<a>` is deliberately NOT in the guard list — a dblclick never navigates, and link-dense pages
  are where this feature pays off most (design spec §3).
- The auto-fire decision happens before the trigger bubble is ever shown, so an opted-in reader
  never sees it flash open and close (design spec §5).

## Testing performed
- `packages/app`: `bun run typecheck` + `bunx vitest run` — full suite green, including 6 new
  `dom-selection-source.test.ts` cases, 4 new `workflow.test.ts` cases, 1 new
  `settings-form.test.ts` case (+2 updated).
- `packages/extension-chrome` / `packages/extension-safari`: `bun run typecheck` green; 1 new
  storage-store test each.
- `bun run lint` / `bun run format:check`: clean.
- e2e (`GEMINI_API_KEY= bun run build:chrome` then `bunx playwright test`): new
  `a14-double-click-trigger.spec.ts` — 3/3 passed (off-by-default, opted-in, opted-in-but-guarded);
  `onboarding`, `lookup`, `cooldown` regression suites — all passed.

## JIRA ticket
* n/a — this repo is not Jira-tracked (see PR #117's own precedent).

## Merge checklist
- [x] Regular merge commit (no squash — owner ruling 2026-07-16)
- [x] Lint + format + typecheck + unit + e2e all green
- [x] No new manifest permission, no new wire message, no C3 change-unit needed
```

- [ ] **Step 3: Merge** — regular merge commit (never squash), once CI is green.

---

## Files touched (cross-reference: design spec §11)

| File                                                                  | Task |
| --------------------------------------------------------------------- | ---- |
| `packages/app/src/domain/types.ts`                                    | 1    |
| `packages/app/src/wire.ts`                                            | 1    |
| `packages/app/src/app/dom-selection-source.ts`                        | 2    |
| `packages/app/test/app/dom-selection-source.test.ts`                  | 2    |
| `packages/app/src/domain/workflow.ts`                                 | 3    |
| `packages/app/test/workflow.test.ts`                                  | 3    |
| `packages/app/src/ui/settings-form.ts`                                | 4    |
| `packages/app/test/ui/settings-form.test.ts`                          | 4    |
| `packages/extension-chrome/src/adapters/chrome-storage-store.ts`      | 5    |
| `packages/extension-chrome/src/adapters/chrome-storage-store.test.ts` | 5    |
| `packages/extension-safari/src/adapters/safari-storage-store.ts`      | 5    |
| `packages/extension-safari/src/adapters/safari-storage-store.test.ts` | 5    |
| `packages/extension-chrome/src/options.ts`                            | 6    |
| `packages/extension-chrome/e2e/helpers.ts`                            | 7    |
| `packages/extension-chrome/e2e/a14-double-click-trigger.spec.ts`      | 7    |

No change to `packages/app/src/app/router.ts`, `packages/extension-chrome/src/sw.ts`,
`packages/extension-safari/src/sw.ts`, `packages/extension-safari/src/options.ts`,
`packages/extension-safari/src/content.ts`, `packages/extension-chrome/src/content.ts`, or any
manifest file — verified in the design spec §6.9–§6.12 and held throughout this plan.
