# A2 Recursive Lookup Implementation Plan

> **For agentic workers:** implement task-by-task, TDD (red → green → commit) per task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** selecting a word inside an already-open card's definition, then clicking Define, no
longer destructively replaces the card in place — it pushes a new frame onto a recursive lookup
chain (capped at 3 cards deep) and shows a "Back" button that pops back to the parent's exact
prior result with zero additional network calls. An ordinary selection elsewhere on the page still
behaves exactly as today (replaces the chain wholesale). The side panel mirrors whichever result is
currently shown but never grows its own Back button or its own selection trigger.

**Architecture:** the whole feature lives in the portable core (`packages/app`, `c3-1`) — one new
optional field on the domain type `SelectionEvent` (`domain/types.ts`), one new small,
DOM-aware check inside the existing `DomSelectionSource` adapter (`app/dom-selection-source.ts`),
a closure-local navigation stack inside `runLookupWorkflow` (`domain/workflow.ts`), one new
optional port field (`ports.ts`'s `ResultRenderContext.onBack`), and additive UI (a new `CardState`
field + a Back button + 2 new CSS blocks in `ui/lookup-card.ts`, wired in
`app/inline-bottom-sheet-renderer.ts`). **Zero changes** to `wire.ts`, `router.ts`, `content.ts`,
`side-panel.ts`, or `chrome-side-panel-mirror.ts` — every nested lookup reuses the existing,
unmodified `lookup` wire message, and `content.ts`'s `renderResult` handler already forwards `ctx`
wholesale to both the in-page renderer and the side-panel mirror. Full design rationale, including
the live probe that grounds the problem statement and every rejected alternative:
`docs/superpowers/specs/2026-07-17-a2-recursive-lookup-design.md`.

**Tech Stack:** TypeScript, Vitest + happy-dom (unit), Playwright (e2e).

## Global Constraints

- Implementer: dispatch each implementation/fix task to the `hunter` subagent — never a generic
  implementer.
- Start in a fresh git worktree under `.claude/worktrees/` on branch `feature/A2RecursiveLookup`.
- Commit subject convention for every task in this plan:
  `[A2RecursiveLookup] feat: <imperative summary> (A2)`. No `Co-Authored-By` trailer, no Claude
  attribution footer.
- **Do not touch `packages/app/src/wire.ts`, `packages/app/src/app/router.ts`,
  `packages/extension-chrome/src/content.ts`, `packages/extension-chrome/src/side-panel.ts`, or
  `packages/extension-chrome/src/adapters/chrome-side-panel-mirror.ts`.** The design spec §7.10
  grounds why none of these need to change. If a task in this plan seems to need one of them
  changed, stop — that means an assumption broke and the plan needs re-grounding, not an ad hoc
  edit.
- **The cooldown gate (`COOLDOWN_MS`) is NOT bypassed for recursive in-definition lookups** (design
  spec §3, pinned) — only the pre-existing `onSwitchProvider`/`onForceLiteral` one-shot re-runs
  bypass it. Do not "fix" a recursive lookup being blocked by "Slow down…" inside the 2-second
  window; that is the intended, pinned behavior.
- **`RECURSIVE_LOOKUP_DEPTH_CAP = 3`** counts the whole visible chain including the original
  lookup (design spec §4) — not 3 _additional_ nested levels. At the cap, no "Define" trigger is
  ever shown for a further in-definition selection; there is no new error state, no new copy.
- **Back never calls `client.lookup` again** — it re-renders an already-fetched `LookupResult`
  cached in the in-memory stack. If a task's implementation calls `deps.client.lookup` (or
  `chrome.runtime.sendMessage({type:'lookup', ...})`) from inside an `onBack` handler, that is a
  bug — stop and re-read design spec §5.
- This codebase compiles with `exactOptionalPropertyTypes: true` (`tsconfig.base.json:13`) — every
  new optional field must be _omitted_ when absent, never explicitly assigned `undefined`. Follow
  the existing pattern used throughout this codebase:
  `...(condition ? { field: value } : {})`.
- UI additions read only `--ad-*`/`--adp-*` design tokens (no hard-coded colors); the new
  `.back-btn` mirrors `.save-btn`'s existing token usage exactly.
- `bun run lint` and `bun run format:check` clean before every commit.
- Every task must leave `cd packages/app && bun run typecheck` green; Task 6 additionally needs
  `cd packages/extension-chrome && bun run typecheck` green (it is the first task touching that
  package).
- The e2e build must clear any ambient `GEMINI_API_KEY`: `GEMINI_API_KEY= bun run build:chrome`.
- E2e must never fetch the live landing page (not relevant to this card, but a standing rule).
- PR: title `[A2RecursiveLookup] A2 — Recursive lookup`; body includes a written **"Testing
  performed"** section (suites, counts, e2e scenarios, gates) — **no screenshots or video** (owner
  ruling 2026-07-16). Merge: **regular merge commit only — squash prohibited.**
- S1 (API key isolation): not touched by this card (no wire message, no settings field, no code
  near `apiKey`/`chrome.storage.local` settings) — do not introduce any such path while
  implementing; if a task seems to need one, stop and re-read design spec §8.
- S4 (sanitize model output): every nested/recursive lookup's `LookupResult.markdown` still flows
  through the one existing `sanitizeMarkdown` call site
  (`inline-bottom-sheet-renderer.ts:95`, unchanged) before reaching `.lookup-answer`'s `innerHTML`
  — never render `r.markdown` directly anywhere new.
- No wire message is added by this card, so the "wire.ts arm + router.ts case = one task" rule
  (CONTRACTS §2) does not apply here — recursion reuses the existing `lookup` message end-to-end.
- No C3 architecture change-unit is needed: this card adds fields/functions inside the existing
  `c3-110 lookup-workflow` and `c3-117 ui-components` components, it does not add, remove, or
  restructure a component/ref/rule. `.c3/` stays untouched (CLI-only; nothing here would need it).

---

### Task 1: `SelectionEvent.insideResult` — the domain field + its one DOM-aware computation

**Files:**

- Modify: `packages/app/src/domain/types.ts`
- Modify: `packages/app/src/app/dom-selection-source.ts`
- Modify: `packages/app/test/app/dom-selection-source.test.ts`

**Interfaces:**

```ts
export interface SelectionEvent {
  text: string;
  sentence: string;
  anchor: AnchorRect;
  url: string;
  title: string;
  insideResult?: boolean;
}
```

- [ ] **Step 1: Write the failing tests.** Append to
      `packages/app/test/app/dom-selection-source.test.ts`, inside the existing
      `describe('defaultReader (DOM selection glue via window.getSelection)', ...)` block, just
      before its closing `});` (after the existing `'returns null when selected text is
whitespace-only'` test):

```ts
it('stamps insideResult: true when the selection starts inside a .lookup-answer element (A2)', () => {
  document.body.innerHTML =
    '<div class="lookup-answer"><p id="ans">A financial institution near a river.</p></div>';
  const p = document.getElementById('ans')!;
  const textNode = p.firstChild!;
  const sel = window.getSelection()!;
  const range = document.createRange();
  range.setStart(textNode, 2); // 'financial'
  range.setEnd(textNode, 12);
  sel.removeAllRanges();
  sel.addRange(range);

  const src = new DomSelectionSource(document);
  const cb = vi.fn();
  const teardown = src.onSelection(cb);
  document.dispatchEvent(new Event('mouseup'));
  expect(cb).toHaveBeenCalledTimes(1);
  const event = cb.mock.calls[0]?.[0] as SelectionEvent;
  expect(event.insideResult).toBe(true);

  sel.removeAllRanges();
  teardown();
  document.body.innerHTML = '';
});

it('omits insideResult entirely for an ordinary page selection (no .lookup-answer ancestor) (A2)', () => {
  document.body.innerHTML = '<p id="plain">The bank by the river.</p>';
  const p = document.getElementById('plain')!;
  const textNode = p.firstChild!;
  const sel = window.getSelection()!;
  const range = document.createRange();
  range.setStart(textNode, 4); // 'bank'
  range.setEnd(textNode, 8);
  sel.removeAllRanges();
  sel.addRange(range);

  const src = new DomSelectionSource(document);
  const cb = vi.fn();
  const teardown = src.onSelection(cb);
  document.dispatchEvent(new Event('mouseup'));
  expect(cb).toHaveBeenCalledTimes(1);
  const event = cb.mock.calls[0]?.[0] as SelectionEvent;
  expect('insideResult' in event).toBe(false); // EOP-safe: key omitted, not set to undefined

  sel.removeAllRanges();
  teardown();
  document.body.innerHTML = '';
});
```

Run: `cd packages/app && bunx vitest run test/app/dom-selection-source.test.ts`
Expected: 2 failures — `event.insideResult` is `undefined` in the first new test (not `true`); the
second new test passes already (nothing sets the key yet) but is added now so it locks the
back-compat contract going forward.

- [ ] **Step 2: Implement.**

In `packages/app/src/domain/types.ts`, replace:

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
  /**
   * A2: true when this selection's start lands inside the currently-rendered lookup result's
   * definition body (`.lookup-answer`, stamped by `renderCardState` in `ui/lookup-card.ts`) — the
   * reader selected a word INSIDE an existing definition, not on the surrounding page.
   * `runLookupWorkflow` uses this to decide whether to push a new frame onto the recursive
   * lookup chain (this flag true) or start a fresh chain (flag absent/false). Computed only by
   * `DomSelectionSource`'s `defaultReader` (the one call site with real DOM access, per
   * rule-domain-purity); every other `SelectionEvent` producer (tests, fakes) simply omits it,
   * which reads as false.
   */
  insideResult?: boolean;
}
```

In `packages/app/src/app/dom-selection-source.ts`, replace the whole `defaultReader` function:

```ts
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
```

with:

```ts
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
  // A2: a selection whose start lands inside the currently-rendered definition body (marked
  // `.lookup-answer` by lookup-card.ts's renderCardState) is an in-definition "recursive lookup"
  // attempt, not an ordinary page selection — runLookupWorkflow uses this to decide whether to
  // extend the lookup chain (push) or start a fresh one (reset). See domain/workflow.ts and the
  // design spec §2/§7.2 for the full rationale.
  const startEl =
    range.startContainer instanceof Element
      ? range.startContainer
      : range.startContainer.parentElement;
  const insideResult = startEl?.closest('.lookup-answer') != null;
  return {
    text,
    sentence: extractSentence(full, range.startOffset, range.endOffset),
    anchor,
    url: location.href,
    title: document.title,
    ...(insideResult ? { insideResult: true } : {}),
  };
}
```

Run: `cd packages/app && bunx vitest run test/app/dom-selection-source.test.ts`
Expected: all tests pass (existing + 2 new).

- [ ] **Step 3: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd .. && cd .. && bun run lint && bun run format:check
```

Commit:

```
git add packages/app/src/domain/types.ts packages/app/src/app/dom-selection-source.ts packages/app/test/app/dom-selection-source.test.ts
git commit -m "[A2RecursiveLookup] feat: stamp SelectionEvent.insideResult for in-definition selections (A2)"
```

---

### Task 2: `ports.ts` + `runLookupWorkflow` — the recursive-lookup stack, depth cap, and Back

**Files:**

- Modify: `packages/app/src/ports.ts`
- Modify: `packages/app/src/domain/workflow.ts`
- Modify: `packages/app/test/workflow.test.ts`

**Interfaces:**

```ts
// ports.ts
export interface ResultRenderContext {
  // ...existing fields...
  onBack?: () => void;
}
// workflow.ts
export const RECURSIVE_LOOKUP_DEPTH_CAP = 3;
```

`ports.ts`'s field is declared FIRST in this task (Step 2, sub-step A below) because
`workflow.test.ts`'s new tests read `h.renderer.lastCtx?.onBack` — that property access only
typechecks once `ResultRenderContext` declares the field; it is not enough for `workflow.ts` to
merely _produce_ `onBack` via a conditional object spread (TypeScript's excess-property check does
not fire on spread-contributed properties, but any code that _reads_ `.onBack` off a value typed
`ResultRenderContext` still needs the interface to declare it).

- [ ] **Step 1: Write the failing tests.** Append to `packages/app/test/workflow.test.ts`, as a
      new `describe` block right after the existing `describe('runLookupWorkflow', ...)` block's
      closing `});` (i.e. as a sibling top-level block, not nested inside it):

```ts
describe('runLookupWorkflow — recursive lookup (A2)', () => {
  const insideSel = (word: string, sentence: string): SelectionEvent => ({
    text: word,
    sentence,
    anchor: { x: 0, y: 0, w: 1, h: 1 },
    url: 'u',
    title: 't',
    insideResult: true,
  });

  it('a fresh (non-recursive) selection renders with ctx.onBack undefined (root of a chain)', async () => {
    const h = harness({});
    h.selection.emit(sel);
    h.trigger.click();
    await vi.waitFor(() => expect(h.renderer.calls).toContain('result'));
    expect(h.renderer.lastCtx?.onBack).toBeUndefined();
  });

  it('a selection inside the result pushes the chain: ctx.onBack pops to the parent with NO new client.lookup call', async () => {
    let t = 0;
    let calls = 0;
    const results: LookupResult[] = [
      { ...okResult, word: 'bank' },
      { ...okResult, word: 'institution' },
    ];
    const h = harness({ now: () => t, impl: () => Promise.resolve(results[calls++]!) });
    h.selection.emit(sel); // outer: "bank"
    h.trigger.click();
    await vi.waitFor(() => expect(h.renderer.calls.filter((c) => c === 'result').length).toBe(1));
    const parentResult = h.renderer.lastResult;

    t = COOLDOWN_MS; // A2: recursion is still gated by the cooldown (design spec §3)
    h.selection.emit(insideSel('institution', 'A financial institution.'));
    h.trigger.click();
    await vi.waitFor(() => expect(h.renderer.calls.filter((c) => c === 'result').length).toBe(2));
    expect(h.renderer.lastResult?.word).toBe('institution');
    expect(typeof h.renderer.lastCtx?.onBack).toBe('function');
    expect(calls).toBe(2); // exactly 2 real lookups so far

    h.renderer.lastCtx!.onBack!();
    expect(h.renderer.lastResult).toEqual(parentResult); // back to "bank", verbatim
    expect(h.renderer.lastCtx?.onBack).toBeUndefined(); // back at the root — nothing further up
    expect(calls).toBe(2); // Back made ZERO additional client.lookup calls
  });

  it('a recursive push is still subject to the cooldown gate (no bypass, per design spec §3)', async () => {
    let t = 0;
    const h = harness({ now: () => t });
    h.selection.emit(sel);
    h.trigger.click();
    await vi.waitFor(() => expect(h.renderer.calls).toContain('result'));

    t = COOLDOWN_MS - 1; // still inside the window
    h.selection.emit(insideSel('bank', 'sentence'));
    h.trigger.click();
    expect(h.renderer.lastError?.code).toBe('RATE_LIMIT');
    expect(h.renderer.calls.filter((c) => c === 'result').length).toBe(1); // blocked, not fired
  });

  it('depth cap: after RECURSIVE_LOOKUP_DEPTH_CAP chained pushes, a further in-result selection shows NO trigger', async () => {
    let t = 0;
    let calls = 0;
    const h = harness({
      now: () => t,
      impl: () => Promise.resolve({ ...okResult, word: `w${calls++}` }),
    });
    h.selection.emit(sel); // depth 1
    h.trigger.click();
    await vi.waitFor(() => expect(h.renderer.calls.filter((c) => c === 'result').length).toBe(1));

    for (let i = 0; i < RECURSIVE_LOOKUP_DEPTH_CAP - 1; i++) {
      t += COOLDOWN_MS;
      h.selection.emit(insideSel(`w${i}`, 'sentence'));
      expect(h.trigger.shown).not.toBeNull(); // trigger offered below the cap
      h.trigger.click();
      await vi.waitFor(() =>
        expect(h.renderer.calls.filter((c) => c === 'result').length).toBe(i + 2),
      );
    }
    // Now at depth RECURSIVE_LOOKUP_DEPTH_CAP: one more in-result selection offers nothing.
    t += COOLDOWN_MS;
    h.selection.emit(insideSel('deeper', 'sentence'));
    expect(h.trigger.shown).toBeNull();
  });

  it('an ordinary selection after a chain resets it: the next result has ctx.onBack undefined again', async () => {
    let t = 0;
    let calls = 0;
    const h = harness({
      now: () => t,
      impl: () => Promise.resolve({ ...okResult, word: `w${calls++}` }),
    });
    h.selection.emit(sel);
    h.trigger.click();
    await vi.waitFor(() => expect(h.renderer.calls.filter((c) => c === 'result').length).toBe(1));

    t = COOLDOWN_MS;
    h.selection.emit(insideSel('w0', 'sentence'));
    h.trigger.click();
    await vi.waitFor(() => expect(h.renderer.calls.filter((c) => c === 'result').length).toBe(2));
    expect(typeof h.renderer.lastCtx?.onBack).toBe('function'); // depth 2, has a parent

    t = 2 * COOLDOWN_MS; // an ordinary (non-recursive) selection elsewhere
    h.selection.emit(sel);
    h.trigger.click();
    await vi.waitFor(() => expect(h.renderer.calls.filter((c) => c === 'result').length).toBe(3));
    expect(h.renderer.lastCtx?.onBack).toBeUndefined(); // fresh chain, no parent
  });

  it('onSwitchProvider replaces the top frame in place — canGoBack unaffected at the root', async () => {
    let t = 5000;
    const h = harness({ configuredProviders: ['gemini', 'openai'], now: () => t });
    h.selection.emit(sel);
    h.trigger.click();
    await vi.waitFor(() => expect(h.renderer.calls).toContain('result'));
    expect(h.renderer.lastCtx?.onBack).toBeUndefined();
    t = 5001;
    h.renderer.lastCtx!.onSwitchProvider!('openai');
    await vi.waitFor(() => expect(h.renderer.calls.filter((c) => c === 'result').length).toBe(2));
    expect(h.renderer.lastCtx?.onBack).toBeUndefined(); // still the root — a switch is not a push
  });
});
```

Also update this file's top import line — replace:

```ts
import { runLookupWorkflow, COOLDOWN_MS } from '../src/domain/workflow';
```

with:

```ts
import { runLookupWorkflow, COOLDOWN_MS, RECURSIVE_LOOKUP_DEPTH_CAP } from '../src/domain/workflow';
```

Run: `cd packages/app && bunx vitest run test/workflow.test.ts`
Expected: failures — `RECURSIVE_LOOKUP_DEPTH_CAP` doesn't exist yet (import error); once that's
stubbed by Step 2, the new recursive-lookup tests fail (`ctx.onBack` is always `undefined`, depth
cap never triggers).

- [ ] **Step 2: Implement.**

**Step 2A** — in `packages/app/src/ports.ts`, replace the `ResultRenderContext` interface's last
field and closing brace:

```ts
  /** Whether this word is currently starred/saved — drives the star's filled/outline state. */
  saved?: boolean;
}
```

with:

```ts
  /** Whether this word is currently starred/saved — drives the star's filled/outline state. */
  saved?: boolean;
  /**
   * A2: pop the current recursive-lookup frame and re-render its parent (the previous result in
   * the chain) — a pure local re-render, no network call. Present only when a parent frame
   * exists (this result was reached via an in-definition selection); absent at the root of a
   * chain. Installed by `runLookupWorkflow`; consumed by the in-page card only — the side panel
   * mirror never receives it (`side-panel.ts`'s `resultToFocus` takes no `ResultRenderContext`
   * at all, matching how the provider picker and A8's "Show literal word" are also
   * in-page-card-only, never mirrored to the panel).
   */
  onBack?: () => void;
}
```

**Step 2B** — replace the ENTIRE contents of `packages/app/src/domain/workflow.ts` with:

```ts
import type {
  SelectionSource,
  TriggerUI,
  ResultRenderer,
  ResultRenderContext,
  LookupClient,
  SettingsStore,
} from '../ports';
import type { SelectionEvent, LookupRequest, LookupResult, LookupError, Provider } from './types';
import { isLookupError } from './types';
import { mapError } from './error-mapper';

// A human spamming Define fires a burst of sequential lookups that trip the provider's
// per-minute quota (Gemini 429 / RESOURCE_EXHAUSTED). Gate lookups to at most one per this
// window — first-come-first-served: the first fires immediately; a follow-up within the
// window is blocked with a 'slow down' message (see the cooldown gate below).
export const COOLDOWN_MS = 2000;

// A2: the maximum number of cards ever in the recursive-lookup chain at once, counting the
// original lookup (depth 1). Selecting a word inside a definition once the chain is already at
// this depth shows no "Define" trigger at all (see the onSelection gate below) — no wasted paid
// call, no new UI state; the reader just taps Back first. See design spec §4 for why "3" means
// the whole chain, not 3 additional nested levels.
export const RECURSIVE_LOOKUP_DEPTH_CAP = 3;

export interface WorkflowDeps {
  selection: SelectionSource;
  trigger: TriggerUI;
  renderer: ResultRenderer;
  client: LookupClient;
  settings: SettingsStore;
  /**
   * Wall clock for the cooldown gate; injectable so tests advance time deterministically.
   * Defaults to Date.now (a JS builtin — not chrome/fetch/DOM, so the domain stays pure).
   * Composition roots omit it and get the real clock.
   */
  now?: () => number;
}

function toLookupError(err: unknown): LookupError {
  return isLookupError(err) ? err : mapError({ kind: 'thrown', error: err });
}

// A2: one frame of the recursive-lookup chain — the selection that produced it, the fetched
// result, and the provider list known at fetch time (cached so Back can rebuild ctx without
// re-fetching settings). Internal to this module; plain data only (rule-domain-purity).
interface StackFrame {
  event: SelectionEvent;
  result: LookupResult;
  providers: Provider[];
}

export function runLookupWorkflow(deps: WorkflowDeps): () => void {
  let inFlight: AbortController | null = null;
  // Timestamp of the last lookup that actually fired. -Infinity = "never fired", so the
  // first click always passes. Updated ONLY on a real fire (never on a blocked attempt) so
  // continuous spamming cannot extend the lockout past one window.
  let lastFireAt = -Infinity;
  const now = deps.now ?? (() => Date.now());
  // A2: the recursive-lookup chain, oldest first, last = currently displayed. Reset to a single
  // frame by any ordinary (non-recursive) selection; extended (pushed) by an in-definition
  // selection; shrunk by Back; capped at RECURSIVE_LOOKUP_DEPTH_CAP frames. Plain data — no DOM/
  // chrome access here (rule-domain-purity).
  let stack: StackFrame[] = [];

  /**
   * Build the ResultRenderContext for a given stack frame — reused by a fresh render, a
   * provider-switch/force-literal re-run, and Back (which needs to rebuild ctx for the frame it
   * pops back to, with zero new network calls).
   */
  function buildCtx(frame: StackFrame): ResultRenderContext {
    const { event: e, result, providers } = frame;
    const showPicker = providers.length >= 2;
    const isIdiom = result.definedAs?.isIdiom === true;
    const canGoBack = stack.length > 1;
    return {
      sentence: e.sentence,
      url: e.url,
      title: e.title,
      ...(showPicker
        ? {
            providers,
            onSwitchProvider: (p: Provider) => {
              // Deliberate switch bypasses the Define-spam cooldown — it's not spam, and it
              // replaces the current frame in place (same depth), not a new recursion level.
              void runLookup(e, p, undefined, 'replace-top').catch((err) =>
                deps.renderer.renderError(mapError({ kind: 'thrown', error: err })),
              );
            },
          }
        : {}),
      ...(isIdiom
        ? {
            onForceLiteral: () => {
              // Deliberate override bypasses the Define-spam cooldown — same reasoning as
              // onSwitchProvider above; also replaces the current frame in place.
              void runLookup(e, undefined, true, 'replace-top').catch((err) =>
                deps.renderer.renderError(mapError({ kind: 'thrown', error: err })),
              );
            },
          }
        : {}),
      ...(canGoBack
        ? {
            onBack: () => {
              // A2: pop the current frame and re-render its parent — no network call, a pure
              // local re-render of an already-fetched result (design spec §5).
              stack.pop();
              const parent = stack[stack.length - 1];
              if (!parent) return; // unreachable: canGoBack guarantees a parent exists
              deps.renderer.renderResult(parent.result, buildCtx(parent));
            },
          }
        : {}),
    };
  }

  async function runLookup(
    e: SelectionEvent,
    providerOverride?: Provider,
    forceLiteral?: boolean,
    stackOp: 'push' | 'replace-top' | 'reset' = 'reset',
  ): Promise<void> {
    inFlight?.abort();
    const controller = new AbortController();
    inFlight = controller;

    // try/finally ensures hide() fires even if settings.get() rejects (stuck-spinner guard);
    // the abort guard inside finally prevents double-hide when a newer click cancels this run
    const settings = await deps.settings.get().finally(() => {
      if (!controller.signal.aborted) deps.trigger.hide();
    });
    // hide bubble once settings are known — keeps spinner visible during the async gap
    if (settings.configuredProviders.length === 0) {
      deps.renderer.renderError(mapError({ kind: 'no-key' }));
      return;
    }
    deps.renderer.renderLoading(e.text);
    const req: LookupRequest = {
      word: e.text,
      context: e.sentence,
      url: e.url,
      title: e.title,
      target: settings.targetLang,
      outputFormat: settings.outputFormat,
      promptEnvelope: settings.promptEnvelope,
    };
    // A manual pick re-runs THIS selection once against the chosen provider (one-shot).
    if (providerOverride) req.provider = providerOverride;
    // A8: a manual "Show literal word" pick re-runs THIS selection once, forcing the literal
    // single-word reading (one-shot).
    if (forceLiteral) req.forceLiteral = true;
    try {
      const result = await deps.client.lookup(req, { signal: controller.signal });
      // A2: update the chain per the caller's requested operation BEFORE building ctx, so
      // buildCtx's canGoBack check sees the post-update depth.
      const frame: StackFrame = { event: e, result, providers: settings.configuredProviders };
      if (stackOp === 'push') stack.push(frame);
      else if (stackOp === 'replace-top' && stack.length > 0) stack[stack.length - 1] = frame;
      else stack = [frame]; // 'reset', or a defensive fallback for 'replace-top' on an empty stack
      if (!controller.signal.aborted) deps.renderer.renderResult(result, buildCtx(frame));
    } catch (err) {
      if (!controller.signal.aborted) deps.renderer.renderError(toLookupError(err));
    } finally {
      if (inFlight === controller) inFlight = null;
    }
  }

  const teardown = deps.selection.onSelection((e) => {
    // A2 depth cap: an in-definition selection once the chain is already at its cap gets no
    // trigger at all — same silent-no-op precedent as a collapsed selection (DomSelectionSource
    // returns null for those; see design spec §4).
    if (e.insideResult === true && stack.length >= RECURSIVE_LOOKUP_DEPTH_CAP) return;
    deps.trigger.show(e.anchor, () => {
      // Cooldown gate, checked BEFORE runLookup. runLookup begins by aborting the in-flight
      // request, so gating here means a too-fast second click neither fires a new request NOR
      // cancels the first one already in flight — first-come-first-served. A2: this gate is NOT
      // bypassed for recursive in-definition lookups (design spec §3) — only the deliberate
      // provider-switch/force-literal re-runs bypass it.
      const t = now();
      if (t - lastFireAt < COOLDOWN_MS) {
        deps.trigger.hide();
        deps.renderer.renderError(mapError({ kind: 'cooldown' }));
        return;
      }
      lastFireAt = t;
      // A2: a selection inside the current result's definition extends the chain (push); any
      // other selection starts a fresh one (reset) — exactly today's existing "select elsewhere
      // replaces the card" behavior, now made explicit as one of three stack operations.
      const stackOp = e.insideResult === true && stack.length > 0 ? 'push' : 'reset';
      void runLookup(e, undefined, undefined, stackOp).catch((err) =>
        deps.renderer.renderError(mapError({ kind: 'thrown', error: err })),
      );
    });
  });

  return () => {
    inFlight?.abort();
    inFlight = null;
    deps.trigger.hide();
    deps.renderer.close();
    stack = [];
    teardown();
  };
}
```

Run: `cd packages/app && bunx vitest run test/workflow.test.ts`
Expected: all tests pass (every pre-existing test in this file, unmodified in behavior, plus the
new recursive-lookup `describe` block).

- [ ] **Step 3: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd .. && cd .. && bun run lint && bun run format:check
```

Commit:

```
git add packages/app/src/ports.ts packages/app/src/domain/workflow.ts packages/app/test/workflow.test.ts
git commit -m "[A2RecursiveLookup] feat: recursive-lookup stack, depth cap, and Back in runLookupWorkflow (A2)"
```

---

### Task 3: `tokens.ts` + `lookup-card.ts` — the Back button and its CardState field

**Files:**

- Modify: `packages/app/src/ui/styles/tokens.ts`
- Modify: `packages/app/src/ui/lookup-card.ts`
- Modify: `packages/app/test/ui/lookup-card.test.ts`

**Interfaces:**

```ts
// styles/tokens.ts
export const ICON_BACK: string;
// lookup-card.ts
export type CardState =
  | { kind: 'loading'; word?: string }
  | { kind: 'result'; /* ...existing fields... */ canGoBack?: boolean }
  | { kind: 'error'; error: LookupError };
```

- [ ] **Step 1: Write the failing tests.** Append to `packages/app/test/ui/lookup-card.test.ts`,
      as a new `describe` block right after the closing `});` of the existing
      `describe('<lookup-card> idiom label + force-literal button (A8)', ...)` block:

```ts
describe('<lookup-card> Back button (A2)', () => {
  it('canGoBack: true renders a .back-btn; absent/false renders none', () => {
    const withBack = mountCard();
    withBack.state = {
      kind: 'result',
      word: 'institution',
      target: 'vi',
      safeHtml: safe('<p>x</p>'),
      canGoBack: true,
    };
    expect(withBack.querySelector('.back-btn')).not.toBeNull();

    const withoutBack = mountCard();
    withoutBack.state = {
      kind: 'result',
      word: 'bank',
      target: 'vi',
      safeHtml: safe('<p>x</p>'),
    };
    expect(withoutBack.querySelector('.back-btn')).toBeNull();
  });

  it('clicking .back-btn fires a composed, bubbling lookup-back event', () => {
    const el = mountCard();
    el.state = {
      kind: 'result',
      word: 'institution',
      target: 'vi',
      safeHtml: safe('<p>x</p>'),
      canGoBack: true,
    };
    const handler = vi.fn();
    document.body.addEventListener('lookup-back', handler);
    el.querySelector<HTMLButtonElement>('.back-btn')!.click();
    document.body.removeEventListener('lookup-back', handler);
    expect(handler).toHaveBeenCalledTimes(1);
    const evt = handler.mock.calls[0]![0] as CustomEvent;
    expect(evt.composed).toBe(true);
    expect(evt.bubbles).toBe(true);
  });

  it('the result body carries class "lookup-answer" (the A2 recursion-detection marker)', () => {
    const el = mountCard();
    el.state = {
      kind: 'result',
      word: 'bank',
      target: 'vi',
      safeHtml: safe('<p>A financial institution.</p>'),
    };
    expect(el.querySelector('.lookup-answer')).not.toBeNull();
    expect(el.querySelector('.lookup-answer')!.innerHTML).toContain('A financial institution.');
  });

  it('has no axe violations with the Back button present (result state)', async () => {
    const el = mountCard();
    el.state = {
      kind: 'result',
      word: 'institution',
      target: 'vi',
      safeHtml: safe('<p>x</p>'),
      canGoBack: true,
    };
    expect(await axeViolations(el)).toEqual([]);
  });
});
```

Run: `cd packages/app && bunx vitest run test/ui/lookup-card.test.ts`
Expected: failures — `canGoBack` is not a valid `CardState` field (type error), `.back-btn` and
`.lookup-answer` don't exist yet.

- [ ] **Step 2: Implement.**

`packages/app/src/ports.ts`'s `ResultRenderContext.onBack` field was already added in Task 2 (Step
2A) — nothing further to do there. In `packages/app/src/ui/styles/tokens.ts`, append after the
existing `ICON_STAR` export (the last icon in the file today):

```ts
// Back (pop the recursive-lookup chain to its parent) — card body, A2. A simple chevron-left,
// same stroke/viewBox/aria-hidden conventions as the rest of the §5.10 set.
export const ICON_BACK =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M14.5 5.5L8 12l6.5 6.5"/></svg>';
```

In `packages/app/src/ui/lookup-card.ts`:

1. Replace the icon import block:

```ts
import {
  BASE_VARS,
  THEME_CSS,
  BRAND_MARK_SVG,
  ICON_CLOSE,
  ICON_SHIELD,
  ICON_SETTINGS,
  ICON_SIDE_PANEL,
  ICON_STAR,
} from './styles/tokens';
```

with:

```ts
import {
  BASE_VARS,
  THEME_CSS,
  BRAND_MARK_SVG,
  ICON_CLOSE,
  ICON_SHIELD,
  ICON_SETTINGS,
  ICON_SIDE_PANEL,
  ICON_STAR,
  ICON_BACK,
} from './styles/tokens';
```

2. In the `CardState` union's `'result'` variant, replace:

```ts
      /** B7: whether to show the repeat-offender nudge banner — stamped once, ever, per word by
       * the router the moment its within-30-day history count first crosses the threshold. */
      nudge?: boolean;
    }
```

with:

```ts
      /** B7: whether to show the repeat-offender nudge banner — stamped once, ever, per word by
       * the router the moment its within-30-day history count first crosses the threshold. */
      nudge?: boolean;
      /** A2: true when this result has a parent frame to return to (a Back button renders).
       * Only ever set by the in-page card's own recursive-lookup workflow — the side panel
       * deliberately omits it (see side-panel.ts's resultToFocus), mirroring how A8's
       * onForceLiteral/the one-shot provider picker are also in-page-card-only. */
      canGoBack?: boolean;
    }
```

3. In the main `CSS` template literal, replace:

```
::slotted(.save-row){display:flex;margin:6px 0 10px}
```

with:

```
::slotted(.back-row){display:flex;margin:2px 0 8px}
::slotted(.save-row){display:flex;margin:6px 0 10px}
```

4. In `CARD_DOC_CSS`, replace:

```
lookup-card .save-btn{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--ad-line);background:transparent;color:var(--ad-ink-soft);border-radius:var(--adp-radius-control);padding:5px 12px;font:inherit;font-size:var(--adp-text-xs);font-weight:var(--adp-weight-semi);cursor:pointer;transition:background var(--adp-dur-fast) var(--adp-ease),color var(--adp-dur-fast) var(--adp-ease),border-color var(--adp-dur-fast) var(--adp-ease)}
```

with:

```
lookup-card .back-btn{display:inline-flex;align-items:center;gap:6px;border:0;background:transparent;color:var(--ad-ink-soft);border-radius:var(--adp-radius-control);padding:5px 10px 5px 6px;font:inherit;font-size:var(--adp-text-xs);font-weight:var(--adp-weight-semi);cursor:pointer;transition:background var(--adp-dur-fast) var(--adp-ease),color var(--adp-dur-fast) var(--adp-ease)}
lookup-card .back-btn svg{width:15px;height:15px;pointer-events:none}
lookup-card .back-btn:hover{background:var(--ad-surface-raised);color:var(--ad-ink)}
lookup-card .back-btn:focus-visible{outline:2px solid var(--ad-accent);outline-offset:2px}
@media (prefers-reduced-motion:reduce){lookup-card .back-btn{transition:none}}
lookup-card .save-btn{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--ad-line);background:transparent;color:var(--ad-ink-soft);border-radius:var(--adp-radius-control);padding:5px 12px;font:inherit;font-size:var(--adp-text-xs);font-weight:var(--adp-weight-semi);cursor:pointer;transition:background var(--adp-dur-fast) var(--adp-ease),color var(--adp-dur-fast) var(--adp-ease),border-color var(--adp-dur-fast) var(--adp-ease)}
```

5. Add a new `renderBackRow` function right before `renderDefinedAsRow`'s definition — replace:

```ts
/**
 * A8: the idiom label + "Show literal word" override button, shown only when the model
 * reported the selection as part of an idiom/phrasal verb. A literal result needs no extra
 * label (the headword already says the word), so this returns null for `isIdiom: false` —
 * avoiding noise for the overwhelmingly common non-idiom case.
 */
function renderDefinedAsRow(definedAs: { term: string; isIdiom: boolean }): HTMLElement | null {
```

with:

```ts
/**
 * A2: the Back button — rendered only when `state.canGoBack` is true (a recursive lookup has a
 * parent frame to return to). Dispatches a composed, payload-free `lookup-back` event (mirrors
 * `close`'s parameterless composed-event pattern); the workflow's own `onBack` closure (installed
 * via `ResultRenderContext`, see `domain/workflow.ts`) does the actual pop + re-render — this
 * function is pure UI, no stack awareness.
 */
function renderBackRow(): HTMLElement {
  const row = document.createElement('div');
  row.className = 'back-row';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'back-btn';
  btn.setAttribute('aria-label', 'Back to previous definition');
  btn.innerHTML = `${ICON_BACK}<span>Back</span>`; // decorative aria-hidden SVG; name is aria-label
  btn.addEventListener('click', () =>
    btn.dispatchEvent(new CustomEvent('lookup-back', { bubbles: true, composed: true })),
  );
  row.append(btn);
  return row;
}

/**
 * A8: the idiom label + "Show literal word" override button, shown only when the model
 * reported the selection as part of an idiom/phrasal verb. A literal result needs no extra
 * label (the headword already says the word), so this returns null for `isIdiom: false` —
 * avoiding noise for the overwhelmingly common non-idiom case.
 */
function renderDefinedAsRow(definedAs: { term: string; isIdiom: boolean }): HTMLElement | null {
```

6. In `renderCardState`'s `'result'` branch, replace:

```ts
const h = document.createElement('h2');
h.textContent = state.word;
const body = document.createElement('div');
body.innerHTML = state.safeHtml; // trusted: sanitized upstream by adapters-shared (S4)
const nodes: Node[] = [h, renderSaveRow(state)];
if (state.nudge === true) nodes.push(renderNudgeRow(state));
const definedAsRow = state.definedAs ? renderDefinedAsRow(state.definedAs) : null;
if (definedAsRow) nodes.push(definedAsRow);
nodes.push(body);
const meta = renderMetaRow(state);
if (meta) nodes.push(meta);
return nodes;
```

with:

```ts
const h = document.createElement('h2');
h.textContent = state.word;
const body = document.createElement('div');
// A2: marks the definition body so DomSelectionSource can tell a selection inside it apart
// from an ordinary page selection (see dom-selection-source.ts's defaultReader).
body.className = 'lookup-answer';
body.innerHTML = state.safeHtml; // trusted: sanitized upstream by adapters-shared (S4)
const nodes: Node[] = [];
if (state.canGoBack === true) nodes.push(renderBackRow());
nodes.push(h, renderSaveRow(state));
if (state.nudge === true) nodes.push(renderNudgeRow(state));
const definedAsRow = state.definedAs ? renderDefinedAsRow(state.definedAs) : null;
if (definedAsRow) nodes.push(definedAsRow);
nodes.push(body);
const meta = renderMetaRow(state);
if (meta) nodes.push(meta);
return nodes;
```

Run: `cd packages/app && bunx vitest run test/ui/lookup-card.test.ts`
Expected: all tests pass (existing + 4 new).

- [ ] **Step 3: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd .. && cd .. && bun run lint && bun run format:check
```

Commit:

```
git add packages/app/src/ui/styles/tokens.ts packages/app/src/ui/lookup-card.ts packages/app/test/ui/lookup-card.test.ts
git commit -m "[A2RecursiveLookup] feat: Back button, canGoBack, and the lookup-answer marker in lookup-card (A2)"
```

---

### Task 4: `inline-bottom-sheet-renderer.ts` — wire `onBack` into the in-page card

**Files:**

- Modify: `packages/app/src/app/inline-bottom-sheet-renderer.ts`
- Modify: `packages/app/test/app/inline-bottom-sheet-renderer.test.ts`

**Interfaces:**

```ts
class InlineBottomSheetRenderer {
  // existing members unchanged; new private field:
  private onBack: (() => void) | undefined;
}
```

- [ ] **Step 1: Write the failing tests.** Append to
      `packages/app/test/app/inline-bottom-sheet-renderer.test.ts`, as a new top-level `describe`
      block at the very end of the file — today that means after the closing `});` of
      `describe('InlineBottomSheetRenderer — repeat-offender nudge (B7)', ...)` (the file's last
      block as of this plan), but append after whatever `describe` block is actually last at
      implementation time, since other cards may append their own blocks first:

```ts
describe('InlineBottomSheetRenderer — Back navigation (A2)', () => {
  it('renderResult(r, { onBack }) sets CardState.canGoBack and shows a .back-btn', () => {
    const h = host();
    const r = new InlineBottomSheetRenderer(h);
    r.renderResult(result, { onBack: () => undefined });
    expect(card(h).querySelector('.back-btn')).not.toBeNull();
  });

  it('renderResult(r) without ctx.onBack renders no .back-btn', () => {
    const h = host();
    const r = new InlineBottomSheetRenderer(h);
    r.renderResult(result);
    expect(card(h).querySelector('.back-btn')).toBeNull();
  });

  it("clicking the card's back-btn invokes ctx.onBack", () => {
    const h = host();
    const r = new InlineBottomSheetRenderer(h);
    const calls: number[] = [];
    r.renderResult(result, { onBack: () => calls.push(1) });
    card(h).querySelector<HTMLButtonElement>('.back-btn')!.click();
    expect(calls).toEqual([1]);
  });
});
```

Run: `cd packages/app && bunx vitest run test/app/inline-bottom-sheet-renderer.test.ts`
Expected: 3 failures — `.back-btn` never appears (renderer doesn't forward `ctx.onBack` or set
`canGoBack` yet).

- [ ] **Step 2: Implement.** In `packages/app/src/app/inline-bottom-sheet-renderer.ts`:

1. Replace the class field block:

```ts
  // A8: same pattern for the card's one `force-literal` listener.
  private onForceLiteral: (() => void) | undefined;
```

with:

```ts
  // A8: same pattern for the card's one `force-literal` listener.
  private onForceLiteral: (() => void) | undefined;
  // A2: same pattern for the card's one `lookup-back` listener.
  private onBack: (() => void) | undefined;
```

2. In `ensureCard()`, replace:

```ts
// One-shot idiom-literal override (A8): the card fires `force-literal` when the reader taps
// "Show literal word"; delegate to the handler the workflow installed via the render context.
card.addEventListener('force-literal', () => this.onForceLiteral?.());
```

with:

```ts
// One-shot idiom-literal override (A8): the card fires `force-literal` when the reader taps
// "Show literal word"; delegate to the handler the workflow installed via the render context.
card.addEventListener('force-literal', () => this.onForceLiteral?.());
// A2: the card fires `lookup-back` when the reader taps "Back"; delegate to the handler the
// workflow installed via the render context (pops the recursive-lookup chain, no network).
card.addEventListener('lookup-back', () => this.onBack?.());
```

3. In `renderResult`, replace:

```ts
  renderResult(r: LookupResult, ctx?: ResultRenderContext): void {
    // `sanitize` already returns `SafeHtml` (the trust boundary lives in sanitizeMarkdown, S4).
    // No cast needed here — the DI param type `(md: string) => SafeHtml` guarantees it.
    this.onSwitch = ctx?.onSwitchProvider;
    this.onForceLiteral = ctx?.onForceLiteral;
    this.setState({
      kind: 'result',
      safeHtml: this.sanitize(r.markdown),
      word: r.word,
      target: r.target,
      ...(r.provider !== undefined ? { provider: r.provider } : {}),
      ...(r.fallbackFrom !== undefined ? { fallbackFrom: r.fallbackFrom } : {}),
      ...(r.definedAs !== undefined ? { definedAs: r.definedAs } : {}),
      ...(ctx?.providers !== undefined ? { providers: ctx.providers } : {}),
      saved: ctx?.saved === true,
      // B7: r.nudge is a transient per-reply annotation (never persisted — see router.ts);
      // always explicit true/false, same style as `saved` above.
      nudge: r.nudge === true,
    });
  }
```

with:

```ts
  renderResult(r: LookupResult, ctx?: ResultRenderContext): void {
    // `sanitize` already returns `SafeHtml` (the trust boundary lives in sanitizeMarkdown, S4).
    // No cast needed here — the DI param type `(md: string) => SafeHtml` guarantees it.
    this.onSwitch = ctx?.onSwitchProvider;
    this.onForceLiteral = ctx?.onForceLiteral;
    this.onBack = ctx?.onBack;
    this.setState({
      kind: 'result',
      safeHtml: this.sanitize(r.markdown),
      word: r.word,
      target: r.target,
      ...(r.provider !== undefined ? { provider: r.provider } : {}),
      ...(r.fallbackFrom !== undefined ? { fallbackFrom: r.fallbackFrom } : {}),
      ...(r.definedAs !== undefined ? { definedAs: r.definedAs } : {}),
      ...(ctx?.providers !== undefined ? { providers: ctx.providers } : {}),
      saved: ctx?.saved === true,
      // B7: r.nudge is a transient per-reply annotation (never persisted — see router.ts);
      // always explicit true/false, same style as `saved` above.
      nudge: r.nudge === true,
      // A2: always explicit true/false — present only when the workflow installed onBack.
      canGoBack: ctx?.onBack !== undefined,
    });
  }
```

`setSaved`/`setStatus`/`dismissNudge` need NO change — they already spread `...rest`/
`...this.lastState`, which carries `canGoBack` forward automatically (it is always a concrete
boolean on the previous state object, never `undefined`-assigned).

Run: `cd packages/app && bunx vitest run test/app/inline-bottom-sheet-renderer.test.ts`
Expected: all tests pass (existing + 3 new).

- [ ] **Step 3: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd .. && cd .. && bun run lint && bun run format:check
```

Commit:

```
git add packages/app/src/app/inline-bottom-sheet-renderer.ts packages/app/test/app/inline-bottom-sheet-renderer.test.ts
git commit -m "[A2RecursiveLookup] feat: wire ctx.onBack through InlineBottomSheetRenderer (A2)"
```

---

### Task 5: `side-panel-view.ts` — CSS parity only (defensive, unreachable via side-panel.ts today)

**Files:**

- Modify: `packages/app/src/ui/side-panel-view.ts`
- Modify: `packages/app/test/ui/side-panel-view.test.ts`

No behavior change: `side-panel.ts`'s `resultToFocus` takes no `ResultRenderContext` and therefore
never sets `canGoBack` (design spec §6/§7.10) — this task exists only so that IF a future card
ever wires `canGoBack` into the panel, the button is already styled, matching how every other
`renderCardState`-producible row already has a `.focus`-scoped mirror in this file.

**Interfaces:** none (CSS-only).

**Note on TDD shape for this task:** this is a CSS-only change. `renderCardState` is a **shared**
function — Task 3 already made it emit a `.back-btn` node whenever `canGoBack: true`, regardless
of which surface (card or panel) calls it. So a presence-only test (`querySelector('.back-btn')`
not null) already **passes before this task's CSS is added** — there is no meaningful "red" state
to drive from for a pure styling change in this test environment (happy-dom does not compute real
layout/paint from `adoptedStyleSheets`). Step 1 below adds the test anyway, as a **lock-in
regression test** (documents and pins the contract that the shared node renders in the panel too),
not as a failing-first TDD step; Step 2 adds the CSS its own docstring says exists purely for
visual parity.

- [ ] **Step 1: Add the lock-in test.** Append to `packages/app/test/ui/side-panel-view.test.ts`,
      as a new `describe` block at the end of the file (this file already imports `SafeHtml` and
      defines a `mount()`/`safe()` helper pair at the top — reuse them, do not redefine):

```ts
describe('<side-panel-view> Back button CSS parity (A2)', () => {
  it('renders a .back-btn when focusState.canGoBack is set directly (defensive parity — side-panel.ts itself never sets this field today; see design spec §6/§7.10)', () => {
    const el = mount();
    el.focusState = {
      kind: 'result',
      word: 'institution',
      target: 'vi',
      safeHtml: safe('<p>x</p>'),
      canGoBack: true,
    };
    expect(el.shadowRoot!.querySelector('.back-btn')).not.toBeNull();
  });
});
```

Run: `cd packages/app && bunx vitest run test/ui/side-panel-view.test.ts`
Expected: this test already passes (Task 3's shared `renderCardState` change is sufficient for the
node to exist; see the note above) — confirm it passes now, then proceed to Step 2 for the CSS.

- [ ] **Step 2: Implement.** In `packages/app/src/ui/side-panel-view.ts`, replace:

```
.focus .save-row{display:flex;margin:6px 0 10px}
```

with:

```
.focus .back-row{display:flex;margin:2px 0 8px}
.focus .back-btn{display:inline-flex;align-items:center;gap:6px;border:0;background:transparent;color:var(--ad-ink-soft);border-radius:var(--adp-radius-control);padding:5px 10px 5px 6px;font:inherit;font-size:var(--adp-text-xs);font-weight:var(--adp-weight-semi);cursor:pointer;transition:background var(--adp-dur-fast) var(--adp-ease),color var(--adp-dur-fast) var(--adp-ease)}
.focus .back-btn svg{width:15px;height:15px;pointer-events:none}
.focus .back-btn:hover{background:var(--ad-surface-raised);color:var(--ad-ink)}
.focus .back-btn:focus-visible{outline:2px solid var(--ad-accent);outline-offset:2px}
@media (prefers-reduced-motion:reduce){.focus .back-btn{transition:none}}
.focus .save-row{display:flex;margin:6px 0 10px}
```

Run: `cd packages/app && bunx vitest run test/ui/side-panel-view.test.ts`
Expected: all tests pass (existing + 1 new).

- [ ] **Step 3: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd .. && cd .. && bun run lint && bun run format:check
```

Commit:

```
git add packages/app/src/ui/side-panel-view.ts packages/app/test/ui/side-panel-view.test.ts
git commit -m "[A2RecursiveLookup] feat: mirror the Back-button CSS in side-panel-view for parity (A2)"
```

---

### Task 6: e2e coverage — `selectWordInCard` helper + the recursive-lookup, reset, and panel-parity scenarios

**Files:**

- Modify: `packages/extension-chrome/e2e/helpers.ts`
- Create: `packages/extension-chrome/e2e/a2-recursive-lookup.spec.ts`

This is the first task touching `packages/extension-chrome` — its own typecheck gate is added
from here on.

- [ ] **Step 1: Add the `selectWordInCard` e2e helper.** In
      `packages/extension-chrome/e2e/helpers.ts`, append (after `selectWord`, before
      `openTrigger`):

```ts
/**
 * A2: make a deterministic selection over `word` inside the currently-open lookup-card's
 * definition body (`.lookup-answer`), then dispatch mouseup — drives a recursive in-definition
 * lookup exactly like `selectWord` drives an ordinary page selection.
 */
export async function selectWordInCard(page: Page, word: string): Promise<void> {
  await page.evaluate((word) => {
    const root = document.querySelector('lookup-card .lookup-answer');
    if (!root) throw new Error('no .lookup-answer found — is a result card open?');
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node: Text | null = null;
    let idx = -1;
    while (walker.nextNode()) {
      const n = walker.currentNode as Text;
      const i = (n.textContent ?? '').indexOf(word);
      if (i >= 0) {
        node = n;
        idx = i;
        break;
      }
    }
    if (!node) throw new Error(`"${word}" not found inside .lookup-answer`);
    const range = document.createRange();
    range.setStart(node, idx);
    range.setEnd(node, idx + word.length);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  }, word);
}
```

There is no "red" step for this helper alone (it is exercised by Step 2's spec, which is the
actual test); write it now, then verify it works as part of Step 2.

- [ ] **Step 2: Write `packages/extension-chrome/e2e/a2-recursive-lookup.spec.ts`:**

```ts
import type { BrowserContext } from '@playwright/test';
import { test, expect } from './fixtures';
import {
  seedSettings,
  gotoFixture,
  selectWord,
  selectWordInCard,
  openTrigger,
  GEMINI_GLOB,
} from './helpers';

/** Route Gemini with a different canned definition per requested word, matched on the exact
 * "Word/phrase: "<word>"" line the prompt always contains (default-template.ts's PROMPT_ENVELOPE).
 * Builds a 3-level chain: spelunking -> caves -> chambers -> underground (depth cap). */
async function mockChainedGemini(context: BrowserContext) {
  const calls = { count: 0 };
  await context.route(GEMINI_GLOB, async (route) => {
    calls.count++;
    const body = route.request().postData() ?? '';
    let text: string;
    if (body.includes('Word/phrase: "chambers"')) {
      text = '## chambers\nEnclosed spaces or rooms, often underground.';
    } else if (body.includes('Word/phrase: "caves"')) {
      text = '## caves\nNatural underground chambers, often formed in limestone.';
    } else if (body.includes('Word/phrase: "bank"')) {
      text = '## bank\nA financial institution.';
    } else {
      text = '## spelunking\nThe hobby of exploring caves, popular among adventurers.';
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }),
    });
  });
  return calls;
}

test('selecting a word inside the card recurses; Back walks up the chain with no re-fetch; depth caps at 3', async ({
  context,
  extensionId,
}) => {
  const calls = await mockChainedGemini(context);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page);
  await gotoFixture(page, 'She loved spelunking on weekends.');
  await page.waitForTimeout(1_000);
  const card = page.locator('bottom-sheet lookup-card');

  // Depth 1: outer lookup — no parent yet.
  await selectWord(page, 't', 'spelunking');
  await openTrigger(page);
  await expect(card).toContainText('exploring caves', { timeout: 10_000 });
  await expect(card.locator('.back-btn')).toHaveCount(0);

  // Depth 2: select "caves" inside the definition.
  await page.waitForTimeout(2_100); // clear the shared cooldown (A2: no special bypass, design §3)
  await selectWordInCard(page, 'caves');
  await openTrigger(page);
  await expect(card).toContainText('limestone', { timeout: 10_000 });
  await expect(card.locator('h2')).toHaveText('caves');
  await expect(card.locator('.back-btn')).toHaveCount(1);

  // Depth 3: select "chambers" inside THAT definition.
  await page.waitForTimeout(2_100);
  await selectWordInCard(page, 'chambers');
  await openTrigger(page);
  await expect(card).toContainText('underground', { timeout: 10_000 });
  await expect(card.locator('h2')).toHaveText('chambers');
  await expect(card.locator('.back-btn')).toHaveCount(1);

  // Depth cap: at depth 3, selecting a word inside the definition offers NO trigger.
  await page.waitForTimeout(2_100);
  await selectWordInCard(page, 'underground');
  await page.waitForTimeout(500);
  await expect(page.locator('lookup-trigger')).toHaveCount(0);

  const callsBeforeBack = calls.count;

  // Back walks up the chain: chambers -> caves -> spelunking, no new network calls.
  await card.locator('.back-btn').click();
  await expect(card.locator('h2')).toHaveText('caves', { timeout: 5_000 });
  await card.locator('.back-btn').click();
  await expect(card.locator('h2')).toHaveText('spelunking', { timeout: 5_000 });
  await expect(card.locator('.back-btn')).toHaveCount(0); // back at the root

  expect(calls.count).toBe(callsBeforeBack); // Back never re-fetches
});

test('selecting elsewhere on the page while a nested lookup is open resets the chain', async ({
  context,
  extensionId,
}) => {
  await mockChainedGemini(context);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page);
  await gotoFixture(page, 'She loved spelunking near the bank of the river.');
  await page.waitForTimeout(1_000);
  const card = page.locator('bottom-sheet lookup-card');

  await selectWord(page, 't', 'spelunking');
  await openTrigger(page);
  await expect(card).toContainText('exploring caves', { timeout: 10_000 });

  await page.waitForTimeout(2_100);
  await selectWordInCard(page, 'caves');
  await openTrigger(page);
  await expect(card.locator('h2')).toHaveText('caves', { timeout: 10_000 });
  await expect(card.locator('.back-btn')).toHaveCount(1);

  // A fresh page selection (not inside the card) resets the chain — today's existing behavior,
  // unchanged by A2.
  await page.waitForTimeout(2_100);
  await selectWord(page, 't', 'bank');
  await openTrigger(page);
  await expect(card.locator('h2')).toHaveText('bank', { timeout: 10_000 });
  await expect(card.locator('.back-btn')).toHaveCount(0); // fresh chain, no parent
});

test('the side panel mirrors a recursive result but shows no Back button of its own', async ({
  context,
  extensionId,
}) => {
  await mockChainedGemini(context);
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(options);

  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/side-panel.html`);
  await panel.waitForSelector('side-panel-view');

  const tab = await context.newPage();
  await gotoFixture(tab, 'She loved spelunking on weekends.');
  await tab.waitForTimeout(1_000);

  await selectWord(tab, 't', 'spelunking');
  await openTrigger(tab);
  await expect(panel.locator('side-panel-view')).toContainText('exploring caves', {
    timeout: 10_000,
  });

  await tab.waitForTimeout(2_100);
  await selectWordInCard(tab, 'caves');
  await openTrigger(tab);
  await expect(panel.locator('side-panel-view h2')).toHaveText('caves', { timeout: 10_000 });

  // The in-page card DOES show a Back button (recursive chain, depth 2)...
  await expect(tab.locator('bottom-sheet lookup-card .back-btn')).toHaveCount(1);
  // ...but the panel — a persistent mirror, not the transient in-page card — never does (same
  // precedent as the provider-picker/idiom-override, both also card-only; design spec §6).
  await expect(panel.locator('side-panel-view .back-btn')).toHaveCount(0);
});
```

Run:

```
GEMINI_API_KEY= bun run build:chrome
cd packages/extension-chrome && bunx playwright test a2-recursive-lookup
```

Expected: 3 passed.

- [ ] **Step 3: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd ../extension-chrome && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

Commit:

```
git add packages/extension-chrome/e2e/helpers.ts packages/extension-chrome/e2e/a2-recursive-lookup.spec.ts
git commit -m "[A2RecursiveLookup] feat: e2e coverage for the recursive-lookup chain, reset, and panel parity (A2)"
```

---

## Final gate (run once, after Task 6, before opening the PR)

```
cd packages/app && bun run typecheck
cd ../extension-chrome && bun run typecheck
cd ../..
bun run test
bun run lint
bun run format:check
GEMINI_API_KEY= bun run build:chrome
cd packages/extension-chrome && bunx playwright test a2-recursive-lookup selection lookup provider-fallback side-panel
```

Expected: typecheck clean on both packages; the full Vitest suite green (including every new test
from Tasks 1-5); lint/format clean; the Chrome build succeeds with the env key cleared;
`a2-recursive-lookup.spec.ts` (this card's own suite) plus `selection.spec.ts`/`lookup.spec.ts`
(regression guard for ordinary selection/lookup, unmodified by this card),
`provider-fallback.spec.ts` (regression guard — `onSwitchProvider`'s `replace-top` behavior must
not have broken the existing picker), and `side-panel.spec.ts` (regression guard for the mirror)
all pass.

## PR

Title: `[A2RecursiveLookup] A2 — Recursive lookup`. Regular merge (no squash). `## JIRA ticket`
section reads `n/a — this repo is not Jira-tracked`. Include a **"Testing performed"** section per
this worktree's evidence policy
(§10 of the design spec) instead of screenshots/video — list the suites above with pass counts,
and explicitly call out: unit test counts per file (Tasks 1-5), the 3 e2e scenarios in
`a2-recursive-lookup.spec.ts` with a one-line description of what each proves (chain+Back+depth
cap; reset-on-ordinary-selection; panel mirrors-but-no-Back), and the full gate list.
