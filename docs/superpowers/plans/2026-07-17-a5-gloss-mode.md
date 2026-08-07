# A5 — Gloss Mode Implementation Plan

> **For agentic workers:** implement task-by-task, TDD (red → green → commit) per task. Steps
> use checkbox (`- [ ]`) syntax for tracking. Every citation below was read directly from this
> worktree; if a line number has drifted, stop and re-read the file rather than guessing.

**Goal:** an opt-in "Compact gloss" setting (default OFF) makes a successful lookup render as a
small floating one-line translation bubble at the selection, instead of the full card; clicking
the bubble expands it into today's exact full card with no re-lookup. When the setting is off,
when the result carries no usable one-line translation, when the render is a loading state with
no anchor, or when the result is an error, the full card renders exactly as it does today — gloss
mode is a pure function of (the reader's setting) × (whether `LookupResult.translation` is a
non-blank string), never a difficulty classifier (roadmap `docs/ROADMAP.md:273-274` scope fence).

**Architecture:** the feature is additive across three layers, no new wire message, no
`router.ts` change:

1. **Core render state machine** — a new `<lookup-gloss>` web component
   (`packages/app/src/ui/lookup-gloss.ts`, c3-117 `ui-components`) plus a `cardOpen` gate and
   gloss lifecycle added to `InlineBottomSheetRenderer`
   (`packages/app/src/app/inline-bottom-sheet-renderer.ts`, c3-1). This is the entire feature —
   `lookup-card.ts`, `bottom-sheet.ts`, and `router.ts` are never touched.
2. **Plumbing** — `ResultRenderContext.anchor?` and `ResultRenderer.renderLoading`'s optional 2nd
   parameter (`packages/app/src/ports.ts`) so the selection's `AnchorRect` (already captured by
   every lookup, c3-110 `lookup-workflow`) reaches the renderer; `PublicSettings.glossMode?:
boolean` (`packages/app/src/domain/types.ts` + `wire.ts`) so the setting round-trips.
3. **Settings UI + composition roots** — a checkbox in `settings-form.ts` (hidden by default,
   shown only where the shell wires gloss rendering) and the two-line diff in Chrome's
   `content.ts`/`options.ts` that reads the setting and forwards the anchor. Safari's shell gets
   only compile-time parity (an optional field flowing through its adapters) — **no gloss
   rendering ships on Safari this card** (design spec §3, mirrors B1/B5/B7/A8's existing
   Chrome-only precedent).

Full design rationale — why `<lookup-gloss>` is a new component and not a `TriggerUI`/
`lookup-card` mode, why `translation` (not a new signal line) is the one-liner source, the
`cardOpen` state-machine reasoning, and why the setting is optional not required — lives in
`docs/superpowers/specs/2026-07-17-a5-gloss-mode-design.md`. Every task below implements exactly
the pins in that spec's §2; no task reopens a choice.

**Tech Stack:** TypeScript, Vitest + happy-dom (unit), Playwright + bundled Chromium (e2e,
Chrome shell only — this card ships no Safari behavior).

## Global Constraints

- Implementer: dispatch each task below to the `hunter` subagent — never a generic implementer.
- Start in a fresh git worktree under `.claude/worktrees/A5GlossMode` on branch
  `feature/A5GlossMode` (repo convention: "Always start work even trivial work with git
  worktree" — `CLAUDE.md`).
- Commit subject for every task: `[A5GlossMode] feat: <imperative summary> (A5)`. **No
  Co-Authored-By trailer, no attribution/Claude footer** (global git conventions — non-negotiable).
- `bun run lint` and `bun run format:check` green before every commit.
- Every task must leave `cd packages/app && bun run typecheck` green; from Task 1 on, also
  `cd packages/extension-chrome && bun run typecheck` and
  `cd packages/extension-safari && bun run typecheck`.
- **No new wire message and no `router.ts` change.** `translation` already rides the existing
  `lookup` reply unchanged; `glossMode` rides the existing `settings.get` reply as one new
  optional field. If a task in this plan seems to need a `router.ts` case or a new
  `WireMessageSchema` arm, stop — that means an assumption broke and the plan needs
  re-grounding, not an ad hoc schema edit.
- **Do NOT touch** (design spec §3/§4.10 — already resolved, do not reopen):
  `packages/app/src/ui/lookup-card.ts`, `packages/app/src/ui/bottom-sheet.ts`,
  `packages/app/src/app/router.ts`,
  `packages/extension-chrome/src/adapters/chrome-side-panel-mirror.ts`,
  `packages/extension-safari/src/content.ts`,
  `packages/app/src/domain/prompt-template.ts`, `packages/app/src/domain/default-template.ts`,
  `docs/index.html`, and any `manifest.json`.
- S1: not applicable — this card touches no key handling. S4: the gloss one-liner passes through
  the exact same injected `sanitize` function (`sanitizeMarkdown`) the card body already uses —
  never a second trust boundary, never a raw string cast to `SafeHtml`. Constraint 4: no new LLM
  calls are added by this card.
- UI reads only `--ad-*`/`--adp-*` design tokens (no hard-coded colors); the gloss bubble honors
  `prefers-reduced-motion` (its loading spinner disables its animation, matching every other
  spinner in the codebase).
- The e2e build must clear any ambient `GEMINI_API_KEY`
  (`GEMINI_API_KEY= bun run build:chrome`) before Task 7's e2e run — a baked-in env key skips
  onboarding/changes NO_KEY behavior (`options.ts`'s `KEY_FROM_ENV`), which Task 7's scenario 4
  depends on.
- `.c3/` is CLI-only. This card adds one new component (`<lookup-gloss>`) under the existing
  `c3-117 ui-components` component — no new C3 component is needed, but Task 8 notes the
  change-unit for the orchestrator rather than hand-editing `.c3/`.
- **Concurrency (CONTRACTS §5 / design spec §9):** this plan touches
  `packages/app/src/app/inline-bottom-sheet-renderer.ts` (lookup-card-UI hot-file group: A1, A2,
  A3, A7, A10 also touch it), `packages/extension-chrome/src/content.ts` (content-script/trigger
  group: A6, A13, A14, A15, B3, B4), and `packages/app/src/ui/settings-form.ts` (settings-form
  group: A9, A13, B6, C9). Serialize against any of those cards if they are in flight
  concurrently.
- This repo carries no `.github/PULL_REQUEST_TEMPLATE` and no Jira tracker (confirmed absent —
  `REPO-FACTS.md` §13); Task 8's PR needs no Jira link. Its required body element is the written
  **"Testing performed"** section (owner ruling 2026-07-16 — no screenshots/video for this PR).
  Merge: **regular merge commit only — squash is prohibited.**

---

### Task 1: `glossMode` setting — domain type, wire schema, storage adapters

**Files:**

- Modify: `packages/app/src/domain/types.ts`
- Modify: `packages/app/src/wire.ts`
- Modify: `packages/app/test/wire-schema.test.ts`
- Modify: `packages/extension-chrome/src/adapters/chrome-storage-store.ts`
- Modify: `packages/extension-chrome/src/adapters/chrome-storage-store.test.ts`
- Modify: `packages/extension-safari/src/adapters/safari-storage-store.ts`
- Modify: `packages/extension-safari/src/adapters/safari-storage-store.test.ts`
- Modify: `packages/extension-safari/src/adapters/message-relay-settings-store.ts`

This is ONE task (not split by file) because `wire.ts:201-209`'s compile-time
`AssertEqual<z.infer<typeof PublicSettingsSchema>, PublicSettings>` tuple check couples the zod
schema to the domain type — they cannot typecheck apart, the same "cannot drift apart" reasoning
CONTRACTS §2 already applies to wire+router pairs, extended here to a schema+adapters change
(design spec §4.3). `packages/extension-chrome/src/adapters/message-relay-settings-store.ts`
needs **no change** (passes `reply.settings` through whole, `:19-20`) — confirmed by reading the
file; it is listed here only for completeness, no diff.

**Interfaces:**

```ts
// packages/app/src/domain/types.ts — PublicSettings gains one optional field
export interface PublicSettings {
  targetLang: string;
  outputFormat: string;
  promptEnvelope: string;
  hasKey: boolean;
  theme: Theme;
  configuredProviders: Provider[];
  glossMode?: boolean;
}
```

- [ ] **Step 1: Write the failing tests.**

  In `packages/app/test/wire-schema.test.ts`, add this test immediately after the existing
  `'settings reply includes configuredProviders'` test (currently ending at line 219, right
  before the `'lookup req accepts an optional provider override...'` test):

```ts
it('settings reply accepts an optional glossMode; omitting it still parses (A5)', () => {
  const base = {
    targetLang: 'vi',
    outputFormat: 't',
    promptEnvelope: '',
    hasKey: true,
    theme: 'sepia' as const,
    configuredProviders: [],
  };
  expect(
    WireReplySchema.safeParse({
      ok: true,
      type: 'settings',
      settings: { ...base, glossMode: true },
    }).success,
  ).toBe(true);
  // Every existing fixture in this file omits glossMode entirely — must still parse (back-compat).
  expect(WireReplySchema.safeParse({ ok: true, type: 'settings', settings: base }).success).toBe(
    true,
  );
});
```

In `packages/extension-chrome/src/adapters/chrome-storage-store.test.ts`, update the two
existing exact-shape `toEqual` assertions and add one new test:

- In `'get() returns PublicSettings only — apiKey is never exposed'` (lines 19-38), change the
  `toEqual` block (lines 29-36) to:

```ts
expect(pub).toEqual({
  targetLang: 'vi',
  outputFormat: 'tpl',
  promptEnvelope: '',
  hasKey: true,
  theme: 'sepia',
  configuredProviders: ['gemini'],
  glossMode: false,
});
```

- In `'get() derives hasKey from a non-empty apiKey + fills defaults when unset'` (lines 63-77),
  change the `toEqual` block (lines 65-72) to:

```ts
expect(empty).toEqual({
  targetLang: 'vi',
  outputFormat: DEFAULT_OUTPUT_FORMAT,
  promptEnvelope: '',
  hasKey: false,
  theme: 'sepia',
  configuredProviders: [],
  glossMode: false,
});
```

- Add a new test, right after the `'envGeminiKey ctor flag...'` test (after line 46):

```ts
it('get() round-trips a stored glossMode: true (A5)', async () => {
  const area = fakeArea({
    targetLang: 'vi',
    outputFormat: 'tpl',
    apiKey: 'AIza',
    glossMode: true,
  });
  expect((await new ChromeStorageStore(area).get()).glossMode).toBe(true);
});
```

Mirror the identical three edits in
`packages/extension-safari/src/adapters/safari-storage-store.test.ts`: append `glossMode: false`
to the two `toEqual` blocks at (old) lines 33-40 and 46-53, and add:

```ts
it('get() round-trips a stored glossMode: true (A5)', async () => {
  const area = fakeArea({
    targetLang: 'vi',
    outputFormat: 'tpl',
    apiKey: 'AIza',
    glossMode: true,
  });
  expect((await new SafariStorageStore(area).get()).glossMode).toBe(true);
});
```

placed right after the `'get() returns PublicSettings only...'` test (after line 42).

Run:

```
cd packages/app && bunx vitest run test/wire-schema.test.ts
cd ../extension-chrome && bunx vitest run src/adapters/chrome-storage-store.test.ts
cd ../extension-safari && bunx vitest run src/adapters/safari-storage-store.test.ts
```

Expected: the new wire-schema test fails — `PublicSettingsSchema` is `z.strictObject` and
rejects the unknown `glossMode` key, so the first assertion (`success === true`) is `false`.
Both storage-store suites fail — the updated `toEqual` blocks expect a `glossMode: false` key
the real `get()` does not yet return, and the two new round-trip tests get `undefined` instead
of `true`.

- [ ] **Step 2: Implement.**

  In `packages/app/src/domain/types.ts`, add one field to the `PublicSettings` interface
  (currently lines 164-176), right after `configuredProviders`:

```ts
export interface PublicSettings {
  targetLang: string;
  outputFormat: string;
  promptEnvelope: string;
  hasKey: boolean;
  theme: Theme;
  /** Provider names that have an API key configured. Keys themselves are never included. */
  configuredProviders: Provider[];
  /**
   * A5: opt-in "Compact gloss" render mode — Define shows a one-line translation bubble at the
   * word instead of the full card; absent/false everywhere until the reader checks the box.
   * Declared optional (unlike `theme`) because `PublicSettings`-shaped object literals are
   * constructed at ~10 call sites across both shells' composition roots and 900+ test
   * assertions; every concrete reader normalizes a missing value to `false` explicitly (see
   * chrome-storage-store.ts/safari-storage-store.ts below), the same style `theme` already uses
   * via `normalizeTheme()` despite `theme` itself being required.
   */
  glossMode?: boolean;
}
```

In `packages/app/src/wire.ts`, add one line to `PublicSettingsSchema` (currently lines 61-68),
right after `configuredProviders`:

```ts
const PublicSettingsSchema = z.strictObject({
  targetLang: z.string(),
  outputFormat: z.string(),
  promptEnvelope: z.string(),
  hasKey: z.boolean(),
  theme: z.enum(['sepia', 'dark', 'contrast', 'system']),
  configuredProviders: z.array(ProviderEnum),
  // A5: opt-in compact-gloss render mode; absent on every pre-A5 stored/replayed settings object.
  glossMode: z.boolean().optional(),
}); // z.strictObject() rejects extra keys (e.g. apiKey) → enforces [S1]
```

In `packages/extension-chrome/src/adapters/chrome-storage-store.ts`, add one line to `get()`'s
return object (currently lines 44-60), right after `configuredProviders`:

```ts
  async get(): Promise<PublicSettings> {
    const s = await this.read();
    return {
      targetLang: s?.targetLang ?? DEFAULT_TARGET,
      outputFormat: s?.outputFormat ?? DEFAULT_OUTPUT_FORMAT,
      promptEnvelope: resolvePromptEnvelope(s ?? {}),
      hasKey: hasKeyFor(s ?? {}) || this.envGeminiKey,
      theme: normalizeTheme(s?.theme),
      configuredProviders: configuredProvidersFor(s ?? {}, { envGeminiKey: this.envGeminiKey }),
      // A5: concrete default (even though the TYPE is optional) — mirrors hasKey/theme's own
      // normalization style so every reader gets a real boolean, never undefined.
      glossMode: s?.glossMode ?? false,
    };
  }
```

In `packages/extension-safari/src/adapters/safari-storage-store.ts`, the identical addition to
`get()` (currently lines 39-55):

```ts
  async get(): Promise<PublicSettings> {
    const s = await this.read();
    return {
      targetLang: s?.targetLang ?? DEFAULT_TARGET,
      outputFormat: s?.outputFormat ?? DEFAULT_OUTPUT_FORMAT,
      promptEnvelope: resolvePromptEnvelope(s ?? {}),
      hasKey: hasKeyFor(s ?? {}),
      theme: normalizeTheme(s?.theme),
      configuredProviders: configuredProvidersFor(s ?? {}),
      // A5: compile/consistency parity only — Safari ships no gloss RENDERING this card (see
      // Task 6), but the field must still round-trip correctly through this adapter.
      glossMode: s?.glossMode ?? false,
    };
  }
```

`packages/extension-safari/src/adapters/message-relay-settings-store.ts`: **no edit** — its
`stripped` object at `:22-29` picks fields by name and would need `glossMode:
reply.settings.glossMode` to actually carry the value onward, so add it for correctness parity
with the design spec §4.3 even though no test currently exercises the gap (the existing
`message-relay-settings-store.test.ts` fixtures already omit `theme`/`configuredProviders` and
pass today because Vitest's `toEqual` treats an `undefined`-valued property as equal to an
absent one — confirmed by reading that test file in full):

```ts
const stripped: PublicSettings = {
  targetLang: reply.settings.targetLang,
  outputFormat: reply.settings.outputFormat,
  promptEnvelope: reply.settings.promptEnvelope,
  hasKey: reply.settings.hasKey,
  theme: reply.settings.theme,
  configuredProviders: reply.settings.configuredProviders,
  glossMode: reply.settings.glossMode,
};
```

Run:

```
cd packages/app && bunx vitest run test/wire-schema.test.ts && bun run typecheck
cd ../extension-chrome && bunx vitest run src/adapters/chrome-storage-store.test.ts && bun run typecheck
cd ../extension-safari && bunx vitest run src/adapters/safari-storage-store.test.ts && bun run typecheck
```

Expected: all tests pass (existing + new); all three packages typecheck clean.

- [ ] **Step 3: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd ../extension-chrome && bun run typecheck && cd ../extension-safari && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

Commit:

```
git add packages/app/src/domain/types.ts packages/app/src/wire.ts packages/app/test/wire-schema.test.ts packages/extension-chrome/src/adapters/chrome-storage-store.ts packages/extension-chrome/src/adapters/chrome-storage-store.test.ts packages/extension-safari/src/adapters/safari-storage-store.ts packages/extension-safari/src/adapters/safari-storage-store.test.ts packages/extension-safari/src/adapters/message-relay-settings-store.ts
git commit -m "[A5GlossMode] feat: add optional glossMode field to PublicSettings + wire schema + storage adapters (A5)"
```

---

### Task 2: anchor plumbing — `ports.ts` + `workflow.ts`

**Files:**

- Modify: `packages/app/src/ports.ts`
- Modify: `packages/app/src/domain/workflow.ts`
- Modify: `packages/app/test/fakes/index.ts`
- Modify: `packages/app/test/workflow.test.ts`

**Interfaces:**

```ts
// packages/app/src/ports.ts
export interface ResultRenderContext {
  providers?: Provider[];
  onSwitchProvider?: (p: Provider) => void;
  onForceLiteral?: () => void;
  sentence?: string;
  url?: string;
  title?: string;
  saved?: boolean;
  /** A5: the selection's on-page anchor. */
  anchor?: AnchorRect;
}

export interface ResultRenderer {
  renderLoading(word?: string, anchor?: AnchorRect): void;
  renderResult(r: LookupResult, ctx?: ResultRenderContext): void;
  renderError(e: LookupError): void;
  close(): void;
}
```

- [ ] **Step 1: Write the failing tests.** Append to `packages/app/test/workflow.test.ts`, inside
      the existing `describe('runLookupWorkflow', ...)` block, right after the
      `'ctx always carries sentence/url/title, even with only one provider configured (no
picker)'` test (currently ending at line 119):

```ts
it('A5: renderLoading receives the SAME AnchorRect the selection event carried', async () => {
  const h = harness({});
  h.selection.emit(sel);
  h.trigger.click();
  await vi.waitFor(() => expect(h.renderer.calls).toContain('result'));
  expect(h.renderer.loadingAnchor).toEqual(sel.anchor);
});

it('A5: ctx.anchor carries the SAME AnchorRect, alongside sentence/url/title', async () => {
  const h = harness({});
  h.selection.emit(sel);
  h.trigger.click();
  await vi.waitFor(() => expect(h.renderer.calls).toContain('result'));
  expect(h.renderer.lastCtx?.anchor).toEqual(sel.anchor);
  expect(h.renderer.lastCtx?.sentence).toBe('river bank');
});
```

Run: `cd packages/app && bunx vitest run test/workflow.test.ts`
Expected: both new tests fail with a TypeScript error at `test/fakes/index.ts` (or, if run via
Vitest's transpile-only mode, a runtime failure) — `FakeResultRenderer` has no `loadingAnchor`
field yet and `renderResult`'s `ctx` has no `anchor` key to read.

- [ ] **Step 2: Implement.**

  In `packages/app/src/ports.ts`, add `anchor?: AnchorRect` to `ResultRenderContext` (currently
  lines 26-48), right after `saved?: boolean` — `AnchorRect` is already imported at the top of
  this file (line 2):

```ts
export interface ResultRenderContext {
  providers?: Provider[];
  onSwitchProvider?: (p: Provider) => void;
  onForceLiteral?: () => void;
  sentence?: string;
  url?: string;
  title?: string;
  saved?: boolean;
  /**
   * A5: the selection's on-page anchor, so a gloss-mode renderer can position a compact bubble
   * at the word. Always present alongside sentence/url/title (both come from the same
   * SelectionEvent already in scope at runLookup) — absent only for a renderer predating this
   * field, which simply never enters the gloss branch (see InlineBottomSheetRenderer, Task 4).
   */
  anchor?: AnchorRect;
}
```

Change `ResultRenderer.renderLoading` (currently line 56) to:

```ts
  renderLoading(word?: string, anchor?: AnchorRect): void;
```

In `packages/app/src/domain/workflow.ts`, change the `renderLoading` call site (currently line
64):

```ts
deps.renderer.renderLoading(e.text, e.anchor);
```

and add `anchor: e.anchor` to the `ctx` object literal (currently lines 88-114), alongside the
existing unconditional `sentence`/`url`/`title`:

```ts
const ctx: ResultRenderContext = {
  sentence: e.sentence,
  url: e.url,
  title: e.title,
  anchor: e.anchor,
  ...(showPicker
    ? {
        providers: settings.configuredProviders,
        onSwitchProvider: (p: Provider) => {
          void runLookup(e, p).catch((err) =>
            deps.renderer.renderError(mapError({ kind: 'thrown', error: err })),
          );
        },
      }
    : {}),
  ...(isIdiom
    ? {
        onForceLiteral: () => {
          void runLookup(e, undefined, true).catch((err) =>
            deps.renderer.renderError(mapError({ kind: 'thrown', error: err })),
          );
        },
      }
    : {}),
};
```

In `packages/app/test/fakes/index.ts`, add `AnchorRect` to the type import list (currently
lines 1-14) and a `loadingAnchor` field + updated signature to `FakeResultRenderer` (currently
lines 44-66):

```ts
import type {
  SelectionSource,
  TriggerUI,
  ResultRenderer,
  ResultRenderContext,
  LookupClient,
  SettingsStore,
  Storage,
  SelectionEvent,
  LookupResult,
  LookupError,
  LookupRequest,
  PublicSettings,
  AnchorRect,
} from '../../src';
```

```ts
export class FakeResultRenderer implements ResultRenderer {
  calls: string[] = [];
  lastResult: LookupResult | null = null;
  lastCtx: ResultRenderContext | undefined;
  lastError: LookupError | null = null;
  loadingWord: string | undefined;
  loadingAnchor: AnchorRect | undefined;
  renderLoading(word?: string, anchor?: AnchorRect) {
    this.calls.push('loading');
    this.loadingWord = word;
    this.loadingAnchor = anchor;
  }
  renderResult(r: LookupResult, ctx?: ResultRenderContext) {
    this.calls.push('result');
    this.lastResult = r;
    this.lastCtx = ctx;
  }
  renderError(e: LookupError) {
    this.calls.push('error');
    this.lastError = e;
  }
  close() {
    this.calls.push('close');
  }
}
```

Run: `cd packages/app && bunx vitest run test/workflow.test.ts && bun run typecheck`
Expected: all tests pass (existing + 2 new); typecheck clean. Also confirm the two other
packages still typecheck (the widened `renderLoading` signature is backward-compatible — an
implementation declaring fewer parameters, like `ChromeSidePanelMirror.renderLoading(word?:
string)` or the object literal in `content.ts`, remains structurally assignable to
`ResultRenderer`):

```
cd ../extension-chrome && bun run typecheck
cd ../extension-safari && bun run typecheck
```

- [ ] **Step 3: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd ../extension-chrome && bun run typecheck && cd ../extension-safari && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

Commit:

```
git add packages/app/src/ports.ts packages/app/src/domain/workflow.ts packages/app/test/fakes/index.ts packages/app/test/workflow.test.ts
git commit -m "[A5GlossMode] feat: thread the selection anchor through ResultRenderContext + renderLoading (A5)"
```

---

### Task 3: `<lookup-gloss>` — new UI component

**Files:**

- Create: `packages/app/src/ui/lookup-gloss.ts`
- Create: `packages/app/test/ui/lookup-gloss.test.ts`
- Modify: `packages/app/src/ui/register.ts`
- Modify: `packages/app/src/ui/index.ts`

**Interfaces:**

```ts
export type GlossState =
  | { kind: 'loading'; word?: string }
  | { kind: 'result'; word: string; safeHtml: SafeHtml };

export function renderGlossState(state: GlossState): Node[];
export class LookupGloss extends HTMLElement {}
```

- [ ] **Step 1: Write the failing tests.** Create `packages/app/test/ui/lookup-gloss.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { registerContentElements } from '../../src/ui/register';
import { renderGlossState, type LookupGloss } from '../../src/ui/lookup-gloss';
import type { SafeHtml } from '../../src/ui/index';

beforeAll(() => {
  registerContentElements();
});

function mount(): LookupGloss {
  const el = document.createElement('lookup-gloss') as LookupGloss;
  document.body.append(el);
  return el;
}

describe('renderGlossState (pure)', () => {
  it('loading state returns the headword + a spinner, no gloss-text', () => {
    const nodes = renderGlossState({ kind: 'loading', word: 'bank' });
    const strong = nodes.find((n) => (n as Element).tagName === 'STRONG') as Element;
    expect(strong.textContent).toBe('bank');
    expect(nodes.some((n) => (n as Element).classList?.contains('gloss-spinner'))).toBe(true);
    expect(nodes.some((n) => (n as Element).classList?.contains('gloss-text'))).toBe(false);
  });

  it('loading state with no word yet renders an ellipsis placeholder headword', () => {
    const nodes = renderGlossState({ kind: 'loading' });
    const strong = nodes.find((n) => (n as Element).tagName === 'STRONG') as Element;
    expect(strong.textContent).toBe('…');
  });

  it('result state returns the headword + the safeHtml written verbatim (no re-sanitization)', () => {
    const nodes = renderGlossState({
      kind: 'result',
      word: 'bank',
      safeHtml: '<p>ngân hàng</p>' as SafeHtml,
    });
    const strong = nodes.find((n) => (n as Element).tagName === 'STRONG') as Element;
    expect(strong.textContent).toBe('bank');
    const text = nodes.find((n) => (n as Element).classList?.contains('gloss-text')) as Element;
    expect(text.innerHTML).toBe('<p>ngân hàng</p>');
  });

  it('a hostile safeHtml is written via innerHTML but renders inert (defense-in-depth; the real trust boundary is sanitizeMarkdown, not this component)', () => {
    const nodes = renderGlossState({
      kind: 'result',
      word: 'bank',
      safeHtml: '<img src=x onerror="window.__pwn=1">' as SafeHtml,
    });
    const text = nodes.find((n) => (n as Element).classList?.contains('gloss-text')) as Element;
    document.body.append(...nodes);
    expect((window as unknown as { __pwn?: number }).__pwn).toBeUndefined();
    text.remove();
    nodes.forEach((n) => n.parentNode?.removeChild(n));
  });
});

describe('<lookup-gloss>', () => {
  it('clicking the shadow button dispatches a composed "expand" event audible on document', () => {
    const el = mount();
    let fired = 0;
    document.addEventListener('expand', () => fired++);
    el.shadowRoot!.querySelector('button')!.click();
    expect(fired).toBe(1);
    document.body.removeChild(el);
  });
});
```

Run: `cd packages/app && bunx vitest run test/ui/lookup-gloss.test.ts`
Expected: fails — the module `../../src/ui/lookup-gloss` does not exist yet.

- [ ] **Step 2: Implement.** Create `packages/app/src/ui/lookup-gloss.ts`:

```ts
import { adoptStyles } from './styles/adopt';
import { BASE_VARS, THEME_CSS } from './styles/tokens';
import type { SafeHtml } from './lookup-card';

/**
 * A5: the compact "Compact gloss" bubble — a one-line translation floating at the selection,
 * shown instead of the full card when gloss mode applies (see
 * InlineBottomSheetRenderer, Task 4). Structurally closest to <lookup-trigger>: a shadow root
 * wrapping a single native <button>, styled as a small pill with the same token set. Content is
 * written to the element's LIGHT DOM and projected through a <slot> inside the shadow button —
 * the same cross-world-safe pattern <lookup-card> already uses (a content-script isolated-world
 * caller can write shared-DOM light-DOM nodes but cannot reach a MAIN-world class's JS property
 * setter, Chromium bug 390807) — so callers use replaceChildren(...), never a `.state` setter.
 */
export type GlossState =
  | { kind: 'loading'; word?: string }
  | { kind: 'result'; word: string; safeHtml: SafeHtml };

export function renderGlossState(state: GlossState): Node[] {
  const word = document.createElement('strong');
  word.textContent = state.word ?? '…';
  if (state.kind === 'loading') {
    const spinner = document.createElement('span');
    spinner.className = 'gloss-spinner';
    spinner.setAttribute('aria-hidden', 'true');
    return [word, spinner];
  }
  const text = document.createElement('span');
  text.className = 'gloss-text';
  text.innerHTML = state.safeHtml; // trusted: sanitized upstream by the caller (S4)
  return [word, text];
}

// @keyframes spin is duplicated per shadow root — keyframes are scoped per shadow tree (same
// note as lookup-trigger.ts/lookup-card.ts).
const CSS = `:host{all:initial;${BASE_VARS};z-index:var(--adp-z-overlay);color-scheme:light}
${THEME_CSS}
button{display:inline-flex;align-items:center;gap:6px;max-width:280px;font:var(--adp-weight-semi) var(--adp-text-sm)/1.3 var(--adp-font-sans);color:var(--ad-ink);background:var(--ad-surface);border:1px solid var(--ad-line-strong);padding:7px 13px;border-radius:var(--adp-radius-pill);box-shadow:var(--ad-shadow-trigger);cursor:pointer}
button:hover{background:var(--ad-surface-raised)}
button:focus-visible{outline:2px solid var(--ad-accent);outline-offset:2px}
.gloss-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--ad-ink-soft)}
.gloss-text p{display:inline;margin:0}
@keyframes spin{to{transform:rotate(360deg)}}
.gloss-spinner{display:inline-block;width:12px;height:12px;border:2px solid var(--ad-line);border-top-color:var(--ad-accent);border-radius:50%;animation:spin .77s linear infinite}
@media (prefers-reduced-motion:reduce){.gloss-spinner{animation:none}}`;

export class LookupGloss extends HTMLElement {
  connectedCallback(): void {
    if (this.shadowRoot) return;
    const root = this.attachShadow({ mode: 'open' });
    adoptStyles(root, CSS);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.append(document.createElement('slot'));
    btn.addEventListener('click', () =>
      this.dispatchEvent(new CustomEvent('expand', { bubbles: true, composed: true })),
    );
    root.append(btn);
  }
}
```

In `packages/app/src/ui/register.ts`, add one line to `registerContentElements()` (currently
lines 8-12):

```ts
import { LookupTrigger } from './lookup-trigger';
import { LookupCard } from './lookup-card';
import { BottomSheet } from './bottom-sheet';
import { LookupGloss } from './lookup-gloss';
import { SettingsForm } from './settings-form';
import { SidePanelView } from './side-panel-view';
import { OnboardingView } from './onboarding-view';

export function registerContentElements(): void {
  if (!customElements.get('lookup-trigger')) customElements.define('lookup-trigger', LookupTrigger);
  if (!customElements.get('lookup-card')) customElements.define('lookup-card', LookupCard);
  if (!customElements.get('bottom-sheet')) customElements.define('bottom-sheet', BottomSheet);
  if (!customElements.get('lookup-gloss')) customElements.define('lookup-gloss', LookupGloss);
}
```

In `packages/app/src/ui/index.ts`, add one export line (after `bottom-sheet`, before
`settings-form`):

```ts
export * from './lookup-trigger';
export * from './lookup-card';
export * from './bottom-sheet';
export * from './lookup-gloss';
export * from './settings-form';
export * from './side-panel-view';
export * from './onboarding-view';
export * from './register';
```

Run: `cd packages/app && bunx vitest run test/ui/lookup-gloss.test.ts && bun run typecheck`
Expected: all tests pass; typecheck clean.

- [ ] **Step 3: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

Commit:

```
git add packages/app/src/ui/lookup-gloss.ts packages/app/test/ui/lookup-gloss.test.ts packages/app/src/ui/register.ts packages/app/src/ui/index.ts
git commit -m "[A5GlossMode] feat: add the lookup-gloss compact bubble component (A5)"
```

---

### Task 4: `InlineBottomSheetRenderer` — gloss lifecycle + `cardOpen` state machine

This is the highest-risk task (design spec §7): getting the `cardOpen` gate wrong either
regresses an expanded card back into a bubble mid-interaction, or leaves gloss mode stuck off
after a `close()` that should have reset it. Every failure mode below is covered by a dedicated
test.

**Files:**

- Modify: `packages/app/src/app/inline-bottom-sheet-renderer.ts`
- Modify: `packages/app/test/app/inline-bottom-sheet-renderer.test.ts`

**Interfaces:**

```ts
export class InlineBottomSheetRenderer implements ResultRenderer {
  set glossMode(v: boolean);
  get glossMode(): boolean;
  renderLoading(word?: string, anchor?: AnchorRect): void;
  renderResult(r: LookupResult, ctx?: ResultRenderContext): void;
  renderError(e: LookupError): void;
  close(): void;
  // unchanged: theme, appendToCard, setSaved, setStatus, dismissNudge
}
```

- [ ] **Step 1: Write the failing tests.** In
      `packages/app/test/app/inline-bottom-sheet-renderer.test.ts`, add `AnchorRect` to the type
      import at the top of the file (currently `import type { LookupResult, LookupError } from
'../../src';`):

```ts
import type { LookupResult, LookupError, AnchorRect } from '../../src';
```

Add a `gloss()` helper right after the existing `card()` helper (currently lines 21-23):

```ts
function gloss(host: HTMLElement): HTMLElement | null {
  return host.querySelector('lookup-gloss');
}
```

Add an `anchor` fixture right after the existing `error` fixture (currently line 14):

```ts
const anchor: AnchorRect = { x: 10, y: 20, w: 30, h: 40 };
```

Append a new `describe` block at the very end of the file, after the closing `});` of
`'InlineBottomSheetRenderer — repeat-offender nudge (B7)'` — that block is last today; if A1
or A7 has already appended their own `describe` block(s) after it, append this one after
whatever `describe` block is now last instead (do not insert in the middle of theirs):

```ts
describe('InlineBottomSheetRenderer — gloss mode (A5)', () => {
  it('regression: glossMode default false — renderResult opens the full card even with a translation + anchor', () => {
    const h = host();
    const r = new InlineBottomSheetRenderer(h);
    r.renderResult({ ...result, translation: 'ngân hàng' }, { anchor });
    expect(card(h)).not.toBeNull();
    expect(gloss(h)).toBeNull();
  });

  it('glossMode=true + anchor + translation mounts a compact gloss bubble at the anchor, not the full card', () => {
    const h = host();
    const r = new InlineBottomSheetRenderer(h);
    r.glossMode = true;
    r.renderResult({ ...result, translation: 'ngân hàng' }, { anchor });
    const g = gloss(h);
    expect(g).not.toBeNull();
    expect(g!.style.left).toBe('10px');
    expect(g!.style.top).toBe('60px'); // anchor.y (20) + anchor.h (40)
    expect(h.querySelector('bottom-sheet')).toBeNull();
  });

  it('glossMode=true with no translation on the result falls back to the full card', () => {
    const h = host();
    const r = new InlineBottomSheetRenderer(h);
    r.glossMode = true;
    r.renderResult(result, { anchor }); // result fixture has no translation field
    expect(card(h)).not.toBeNull();
    expect(gloss(h)).toBeNull();
  });

  it('glossMode=true with a BLANK translation also falls back to the full card', () => {
    const h = host();
    const r = new InlineBottomSheetRenderer(h);
    r.glossMode = true;
    r.renderResult({ ...result, translation: '   ' }, { anchor });
    expect(card(h)).not.toBeNull();
    expect(gloss(h)).toBeNull();
  });

  it('glossMode=true + translation present but NO anchor falls back to the full card', () => {
    const h = host();
    const r = new InlineBottomSheetRenderer(h);
    r.glossMode = true;
    r.renderResult({ ...result, translation: 'ngân hàng' }); // ctx omitted entirely
    expect(card(h)).not.toBeNull();
    expect(gloss(h)).toBeNull();
  });

  it('glossMode=true renderLoading(word, anchor) mounts a loading gloss bubble, not the full card', () => {
    const h = host();
    const r = new InlineBottomSheetRenderer(h);
    r.glossMode = true;
    r.renderLoading('bank', anchor);
    const g = gloss(h);
    expect(g).not.toBeNull();
    expect(g!.querySelector('.gloss-spinner')).not.toBeNull();
    expect(h.querySelector('bottom-sheet')).toBeNull();
  });

  it('dispatching "expand" on the gloss bubble swaps to the full card with the SAME already-computed result (no re-sanitize, no re-lookup)', () => {
    const h = host();
    let sanitizeCalls = 0;
    const r = new InlineBottomSheetRenderer(h, (md) => {
      sanitizeCalls++;
      return `SAFE:${md}` as SafeHtml;
    });
    r.glossMode = true;
    r.renderResult({ ...result, translation: 'ngân hàng' }, { anchor });
    expect(gloss(h)).not.toBeNull();
    const callsAfterFirstRender = sanitizeCalls;
    gloss(h)!.dispatchEvent(new CustomEvent('expand', { bubbles: true, composed: true }));
    const c = card(h);
    expect(c).not.toBeNull();
    expect(c.querySelector('h2')!.textContent).toBe('bank');
    expect(c.innerHTML).toContain(`SAFE:${result.markdown}`);
    expect(gloss(h)).toBeNull();
    expect(sanitizeCalls).toBe(callsAfterFirstRender); // reuses lastState — no second sanitize call
  });

  it('post-expand stays expanded: a second renderResult (e.g. a provider-switch re-run) updates the SAME open card — the gloss bubble never reappears', () => {
    const h = host();
    const r = new InlineBottomSheetRenderer(h);
    r.glossMode = true;
    r.renderResult({ ...result, translation: 'ngân hàng' }, { anchor });
    gloss(h)!.dispatchEvent(new CustomEvent('expand', { bubbles: true, composed: true }));
    expect(h.querySelectorAll('bottom-sheet').length).toBe(1);
    r.renderResult({ ...result, translation: 'ngân hàng' }, { anchor });
    expect(gloss(h)).toBeNull();
    expect(h.querySelectorAll('bottom-sheet').length).toBe(1);
  });

  it('errors always render the full card: renderError after a gloss-mode renderLoading removes the loading bubble', () => {
    const h = host();
    const r = new InlineBottomSheetRenderer(h);
    r.glossMode = true;
    r.renderLoading('bank', anchor);
    expect(gloss(h)).not.toBeNull();
    r.renderError(error);
    expect(gloss(h)).toBeNull();
    expect(card(h).querySelector('.err')!.textContent).toBe('Network failed.');
  });

  it('a mousedown outside the gloss bubble dismisses it without opening the full card', () => {
    const h = host();
    const outside = document.createElement('div');
    document.body.append(outside);
    const r = new InlineBottomSheetRenderer(h);
    r.glossMode = true;
    r.renderResult({ ...result, translation: 'ngân hàng' }, { anchor });
    expect(gloss(h)).not.toBeNull();
    outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, composed: true }));
    expect(gloss(h)).toBeNull();
    expect(card(h)).toBeNull();
  });

  it('close() resets cardOpen — a fresh gloss-eligible renderResult after close() mounts a gloss bubble again', () => {
    const h = host();
    const r = new InlineBottomSheetRenderer(h);
    r.glossMode = true;
    r.renderResult({ ...result, translation: 'ngân hàng' }, { anchor });
    gloss(h)!.dispatchEvent(new CustomEvent('expand', { bubbles: true, composed: true }));
    r.close();
    r.renderResult({ ...result, translation: 'ngân hàng' }, { anchor });
    expect(gloss(h)).not.toBeNull();
    expect(h.querySelector('bottom-sheet')).toBeNull();
  });
});
```

Run: `cd packages/app && bunx vitest run test/app/inline-bottom-sheet-renderer.test.ts`
Expected: every test in the new `describe` block fails — `InlineBottomSheetRenderer` has no
`glossMode` setter yet (a TypeScript error) and `renderLoading` doesn't accept a 2nd argument.

- [ ] **Step 2: Implement — TARGETED, ADDITIVE edits only. Never paste a full-file copy.**

  > **⚠ Shared-file warning:** `inline-bottom-sheet-renderer.ts` is also modified by A1
  > (streamed answers) and A7 (pin cards) — see this plan's Global Constraints "Concurrency"
  > note. The hunks below are anchored against the file as it reads on `origin/master` at
  > authoring time (verified line-for-line, `git show HEAD:packages/app/src/app/
inline-bottom-sheet-renderer.ts`). **Before editing, open the file and confirm each anchor
  > snippet below still matches.** If A1 or A7 has already landed and the anchors don't match
  > verbatim, STOP — do not paste a stale full-file version over their work. Re-locate each hunk
  > by its nearby method name/comment (`ensureCard`, `setState`, `renderLoading`, `renderResult`,
  > `renderError`, `close`) in the file as it currently stands, apply the same net change
  > described below, and re-run this task's tests before moving on.

  Apply these hunks, in order, to `packages/app/src/app/inline-bottom-sheet-renderer.ts`:

  **Hunk 1 — imports.** Locate:

```ts
import type {
  ResultRenderer,
  ResultRenderContext,
  LookupResult,
  LookupError,
  Provider,
  Theme,
  SavedWordStatus,
} from '../index';
import { renderCardState, type CardState, type LookupCard, type SafeHtml } from '../ui/index';
import { sanitizeMarkdown } from './markdown-sanitize';
```

Replace with:

```ts
import type {
  ResultRenderer,
  ResultRenderContext,
  LookupResult,
  LookupError,
  Provider,
  Theme,
  SavedWordStatus,
  AnchorRect,
} from '../index';
import {
  renderCardState,
  renderGlossState,
  type CardState,
  type LookupCard,
  type LookupGloss,
  type SafeHtml,
} from '../ui/index';
import { sanitizeMarkdown } from './markdown-sanitize';
```

**Hunk 2 — new private fields.** Locate the `lastState` field declaration, immediately
followed by the constructor:

```ts
  // B1: the last CardState rendered, so setSaved() can re-emit it with the flag flipped without
  // a full re-lookup. null before any render, or after close().
  private lastState: CardState | null = null;

  constructor(
```

Replace with (adds four A5 fields between `lastState` and the constructor — do not touch
anything A1/A7 may already have inserted in this same span; append the A5 fields after it):

```ts
  // B1: the last CardState rendered, so setSaved() can re-emit it with the flag flipped without
  // a full re-lookup. null before any render, or after close().
  private lastState: CardState | null = null;
  // A5: opt-in compact gloss render mode. Default false — zero behavior change until the reader
  // opts in via settings (design spec §2.5).
  private _glossMode = false;
  private glossEl: LookupGloss | null = null;
  // A5: true once the full card is open for THIS on-page session (whether reached by expanding a
  // gloss OR by a gloss-ineligible render) — every later render then keeps updating the SAME
  // open card and never regresses into a mini bubble (design spec §2.4). Reset only in close().
  // For every install that leaves glossMode OFF (the default/majority case), this becomes true
  // on the very first render and stays true forever — zero behavior change for that path.
  private cardOpen = false;
  private readonly onOutsidePress = (e: Event): void => {
    if (this.glossEl && !e.composedPath().includes(this.glossEl)) this.removeGloss();
  };

  constructor(
```

**Hunk 3 — `glossMode` accessor.** Locate the `theme` getter, immediately followed by
`ensureCard()`:

```ts
  get theme(): Theme {
    return this._theme;
  }

  private ensureCard(): LookupCard {
```

Replace with (inserts the new accessor between them — do not touch anything A1/A7 may already
have inserted in this span; add the new accessor immediately before `ensureCard()`):

```ts
  get theme(): Theme {
    return this._theme;
  }

  /** A5: the reader's stored "Compact gloss" setting. Default false. */
  set glossMode(v: boolean) {
    this._glossMode = v;
  }
  get glossMode(): boolean {
    return this._glossMode;
  }

  private ensureCard(): LookupCard {
```

**Hunk 4 — new gloss helpers.** Locate the end of `setState()`, immediately followed by
`renderLoading`:

```ts
    this.lastState = state;
    this.ensureCard().replaceChildren(...renderCardState(state));
  }

  renderLoading(word?: string): void {
    this.setState(word === undefined ? { kind: 'loading' } : { kind: 'loading', word });
  }
```

Replace with (inserts four new private methods between `setState()` and `renderLoading`, and
changes `renderLoading`'s signature/body):

```ts
    this.lastState = state;
    this.ensureCard().replaceChildren(...renderCardState(state));
  }

  /** A5: lazily create the compact gloss bubble, wiring its expand click + outside-press dismiss. */
  private ensureGloss(): LookupGloss {
    if (this.glossEl) return this.glossEl;
    const el = document.createElement('lookup-gloss') as LookupGloss;
    el.setAttribute('data-ad-theme', this._theme);
    el.addEventListener('expand', () => this.expand());
    this.host.append(el);
    document.addEventListener('mousedown', this.onOutsidePress, true);
    document.addEventListener('touchstart', this.onOutsidePress, true);
    this.glossEl = el;
    return el;
  }

  /**
   * A5: position the gloss bubble at the selection anchor. Positioning math copied verbatim from
   * ChromeFloatingTrigger.show() (chrome-floating-trigger.ts:39-41) — the SAME AnchorRect →
   * fixed-position formula, so the bubble lands exactly where the "Define" pill just vacated.
   */
  private positionGloss(anchor: AnchorRect): void {
    const el = this.ensureGloss();
    el.style.position = 'fixed';
    el.style.left = `${anchor.x}px`;
    el.style.top = `${anchor.y + anchor.h}px`;
  }

  /** A5: tear down the gloss bubble and its outside-press listeners, if one is showing. */
  private removeGloss(): void {
    if (!this.glossEl) return;
    document.removeEventListener('mousedown', this.onOutsidePress, true);
    document.removeEventListener('touchstart', this.onOutsidePress, true);
    this.glossEl.remove();
    this.glossEl = null;
  }

  /**
   * A5: reader tapped the gloss bubble — show the ALREADY-COMPUTED state in the full card, no
   * re-lookup, no re-sanitize. Sets cardOpen so no later render for this session regresses back
   * into a bubble (design spec §2.4).
   */
  private expand(): void {
    this.cardOpen = true;
    this.removeGloss();
    if (this.lastState) this.setState(this.lastState);
  }

  renderLoading(word?: string, anchor?: AnchorRect): void {
    if (!this.cardOpen && this._glossMode && anchor) {
      this.lastState = word === undefined ? { kind: 'loading' } : { kind: 'loading', word };
      this.positionGloss(anchor);
      this.glossEl!.replaceChildren(...renderGlossState(this.lastState));
      return;
    }
    this.removeGloss(); // clear a stale bubble from a prior gloss-eligible render, if any
    this.setState(word === undefined ? { kind: 'loading' } : { kind: 'loading', word });
  }
```

**Hunk 5 — `renderResult` gains the gloss gate.** Locate the whole `renderResult` method body
(if A1/A7 has already changed the object literal's fields — e.g. added a streaming flag or
`canPin` — keep every field they added; this hunk only adds the `hasGloss` gate and switches
the inline object literal to a named `state` const so the gloss branch can reuse it):

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

Replace with (the object literal becomes a named `const state`, `this.setState(...)` at the
end is unchanged in effect, and the gloss gate is inserted before it — if other fields exist
here from A1/A7, keep them inside `state` exactly as found):

```ts
  renderResult(r: LookupResult, ctx?: ResultRenderContext): void {
    // `sanitize` already returns `SafeHtml` (the trust boundary lives in sanitizeMarkdown, S4).
    // No cast needed here — the DI param type `(md: string) => SafeHtml` guarantees it.
    this.onSwitch = ctx?.onSwitchProvider;
    this.onForceLiteral = ctx?.onForceLiteral;
    const state: CardState = {
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
    };
    // A5: gloss vs. full card is a pure function of the reader's setting + whether THIS result
    // carries a non-blank one-line translation — never word length/frequency/a classifier.
    const hasGloss = typeof r.translation === 'string' && r.translation.trim() !== '';
    if (!this.cardOpen && this._glossMode && ctx?.anchor && hasGloss) {
      this.lastState = state;
      this.positionGloss(ctx.anchor);
      this.glossEl!.replaceChildren(
        ...renderGlossState({
          kind: 'result',
          word: r.word,
          safeHtml: this.sanitize(r.translation!),
        }),
      );
      return;
    }
    this.removeGloss();
    this.cardOpen = true;
    this.setState(state);
  }
```

**Hunk 6 — `renderError` clears a stale gloss bubble.** Locate:

```ts
  renderError(e: LookupError): void {
    this.setState({ kind: 'error', error: e });
  }
```

Replace with:

```ts
  renderError(e: LookupError): void {
    // A5: errors are never compact (design spec §2.3) — the setup/recovery CTAs never get
    // squeezed into a bubble.
    this.removeGloss();
    this.cardOpen = true;
    this.setState({ kind: 'error', error: e });
  }
```

**Hunk 7 — `close()` resets the gloss state.** Locate:

```ts
  close(): void {
    this.sheet?.remove();
    this.sheet = null;
    this.card = null;
    this.lastState = null;
  }
```

Replace with (if A7 has already added pinned-card teardown lines here, keep them — just add
the two new A5 lines at the top of the method body):

```ts
  close(): void {
    this.removeGloss();
    this.cardOpen = false;
    this.sheet?.remove();
    this.sheet = null;
    this.card = null;
    this.lastState = null;
  }
```

Run:
`cd packages/app && bunx vitest run test/app/inline-bottom-sheet-renderer.test.ts && bun run typecheck`
Expected: all tests pass (existing + 11 new in the A5 `describe` block); typecheck clean.

Also run the full app unit suite to confirm no regression in the other features this file
shares (B1/B5/B7/A8 all touch it): `cd packages/app && bun run test`
Expected: all suites green.

- [ ] **Step 3: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

Commit:

```
git add packages/app/src/app/inline-bottom-sheet-renderer.ts packages/app/test/app/inline-bottom-sheet-renderer.test.ts
git commit -m "[A5GlossMode] feat: gloss-mode lifecycle + cardOpen state machine in InlineBottomSheetRenderer (A5)"
```

---

### Task 5: `settings-form.ts` — "Compact gloss" checkbox

**Files:**

- Modify: `packages/app/src/ui/settings-form.ts`
- Modify: `packages/app/test/ui/settings-form.test.ts`

**Interfaces:**

```ts
export interface SettingsFormValue {
  // ...unchanged fields
  glossMode?: boolean;
}
export class SettingsForm extends HTMLElement {
  set glossModeAvailable(v: boolean);
}
```

- [ ] **Step 1: Write the failing tests.** Append to `packages/app/test/ui/settings-form.test.ts`,
      inside the existing `describe('<settings-form>', ...)` block, right before its closing
      `});`:

```ts
it('glossModeAvailable defaults to false — the Compact gloss row stays hidden (A5)', () => {
  const el = mountForm();
  const row = el.shadowRoot!.querySelector<HTMLElement>('#gloss-mode-row')!;
  expect(row.hidden).toBe(true);
});

it('glossModeAvailable = true un-hides the Compact gloss row (A5)', () => {
  const el = mountForm();
  (el as unknown as { glossModeAvailable: boolean }).glossModeAvailable = true;
  const row = el.shadowRoot!.querySelector<HTMLElement>('#gloss-mode-row')!;
  expect(row.hidden).toBe(false);
});

it('a hidden gloss-mode row never silently resets a previously-true stored glossMode value (A5)', () => {
  const el = mountForm();
  // glossModeAvailable left at its default false — the row stays hidden throughout.
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
    theme: 'sepia',
    glossMode: true,
  };
  let captured: SettingsFormValue | undefined;
  el.addEventListener('save', (e) => {
    captured = (e as CustomEvent<SettingsFormValue>).detail;
  });
  el.shadowRoot!.querySelector('form')!.dispatchEvent(
    new Event('submit', { bubbles: true, cancelable: true }),
  );
  expect(captured?.glossMode).toBe(true);
});

it('toggling the visible Compact gloss checkbox is reflected in the submitted save detail (A5)', () => {
  const el = mountForm();
  (el as unknown as { glossModeAvailable: boolean }).glossModeAvailable = true;
  el.shadowRoot!.querySelector<HTMLInputElement>('#gloss-mode')!.checked = true;
  let captured: SettingsFormValue | undefined;
  el.addEventListener('save', (e) => {
    captured = (e as CustomEvent<SettingsFormValue>).detail;
  });
  el.shadowRoot!.querySelector('form')!.dispatchEvent(
    new Event('submit', { bubbles: true, cancelable: true }),
  );
  expect(captured?.glossMode).toBe(true);
});
```

Run: `cd packages/app && bunx vitest run test/ui/settings-form.test.ts`
Expected: all four new tests fail — `#gloss-mode-row`/`#gloss-mode` don't exist in the DOM yet,
`glossModeAvailable` is not a settable property, and `collect()` never emits `glossMode`.

- [ ] **Step 2: Implement.** In `packages/app/src/ui/settings-form.ts`:
  1. Add `glossMode?: boolean;` to the `SettingsFormValue` interface (currently lines 29-45),
     right after `theme: Theme;`:

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
  theme: Theme;
  /** A5: opt-in compact-gloss render mode. Absent/false until the reader checks the box. */
  glossMode?: boolean;
}
```

2. Add the new row to `MARKUP`'s "Appearance" section, right after the existing Theme control's
   help paragraph (currently line 200) and before the closing `</section>` (currently line 201):

```html
      <p class="seg-help">Changes how the lookup card and side panel look. Saved on this device only.</p>
      <div class="row" id="gloss-mode-row" hidden>
        <label class="check"><input type="checkbox" id="gloss-mode" /> Compact gloss</label>
        <p class="seg-help" id="gloss-mode-help">
          Define shows a one-line translation next to the word — click it to open the full card.
          Falls back to the full card automatically when no one-line translation is available.
        </p>
      </div>
    </section>
```

3. Add the new public accessor, right after the existing `errorReporting` accessor (currently
   lines 422-428):

```ts
  /**
   * A5: shows/hides the "Compact gloss" row. Default false — the checkbox always exists in the
   * DOM and always round-trips through collect()/set value() regardless of visibility (mirrors
   * `keyFromEnv`'s own "present in the DOM, hidden until flagged" shape). Chrome's composition
   * root sets this to true; Safari's never does, so the row stays hidden there (Task 6).
   */
  set glossModeAvailable(v: boolean) {
    this.q<HTMLElement>('#gloss-mode-row').hidden = !v;
  }
```

4. Add one line to `collect()` (currently lines 563-580), right after `theme:
this.getThemePref(),`:

```ts
  private collect(): SettingsFormValue {
    this.commitKeyField();
    return {
      provider: this._provider,
      apiKey: this._keys.gemini,
      openaiApiKey: this._keys.openai,
      anthropicApiKey: this._keys.anthropic,
      targetLang: this.q<HTMLSelectElement>('#target').value,
      outputFormat: this.q<HTMLTextAreaElement>('#tpl').value,
      promptEnvelope: this._envelopeEdited ? this.q<HTMLTextAreaElement>('#envelope').value : '',
      cacheEnabled: this.q<HTMLInputElement>('#cache').checked,
      saveHistory: this.q<HTMLInputElement>('#history').checked,
      theme: this.getThemePref(),
      glossMode: this.q<HTMLInputElement>('#gloss-mode').checked,
    };
  }
```

5. Add one line to `set value()` (currently lines 582-611) — replace its tail (currently lines
   605-611) with:

```ts
    this.q<HTMLInputElement>('#cache').checked = v.cacheEnabled;
    this.q<HTMLInputElement>('#history').checked = v.saveHistory;
    this.setThemePref(v.theme);
    this.q<HTMLInputElement>('#gloss-mode').checked = v.glossMode === true;
    // Render the key row for the (possibly changed) provider + lock state.
    this.syncKeyField();
    this.clearDirty();
  }
```

No change is needed to the dirty-tracking wiring (`:302-308`) — the new checkbox lives inside
the same `<form>` the delegated `input`/`change` listener already covers.

Run: `cd packages/app && bunx vitest run test/ui/settings-form.test.ts && bun run typecheck`
Expected: all tests pass (existing + 4 new); typecheck clean.

- [ ] **Step 3: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

Commit:

```
git add packages/app/src/ui/settings-form.ts packages/app/test/ui/settings-form.test.ts
git commit -m "[A5GlossMode] feat: add the Compact gloss checkbox to settings-form (A5)"
```

---

### Task 6: Chrome + Safari composition roots

No dedicated unit test exists for `options.ts` in either shell (composition roots, covered by
e2e only — same precedent as B5's `content.ts`/`side-panel.ts` edits and C2's `options.ts` edit).
This task's correctness is proven by Task 7's e2e; still run the full typecheck/lint gate at the
end so a regression elsewhere in these shared files (settings save, cache/history clear, theme,
etc.) is caught immediately.

**Files:**

- Modify: `packages/extension-chrome/src/content.ts`
- Modify: `packages/extension-chrome/src/options.ts`
- Modify: `packages/extension-safari/src/options.ts`

- [ ] **Step 1: Implement.**

  In `packages/extension-chrome/src/content.ts`, the `themedSettings.get()` wrapper (currently
  lines 29-37) gains one more re-applied field, exactly parallel to the existing `theme` line:

```ts
const themedSettings: SettingsStore = {
  get: () =>
    settings.get().then((s) => {
      trigger.theme = s.theme;
      inline.theme = s.theme;
      inline.glossMode = s.glossMode === true;
      return s;
    }),
  set: (patch) => settings.set(patch),
};
```

In the same file, the `renderer` object literal passed to `runLookupWorkflow` (currently lines
76-113) gets its `renderLoading` method updated to forward the new `anchor` argument to `inline`
only (the side-panel mirror never takes gloss mode — design spec §3):

```ts
    renderLoading(word, anchor) {
      lastFocus = word === undefined ? { state: 'loading' } : { state: 'loading', word };
      lastSavePayload = undefined;
      lastSaved = false;
      lastStatus = undefined;
      saveReplyGuard.next();
      inline.renderLoading(word, anchor);
      mirror.renderLoading(word);
    },
```

`renderResult`'s existing body (currently line 103, `inline.renderResult(r, ctx);`) needs **no
edit** — it already forwards the whole `ctx` object to `inline.renderResult(r, ctx)` unchanged,
so `ctx.anchor` simply arrives with it once Task 2 has shipped.

In `packages/extension-chrome/src/options.ts`:

- `DEFAULTS` (currently lines 30-43) gains one field, right after `anthropicApiKey: '',`:

```ts
const DEFAULTS: Settings = {
  targetLang: 'vi',
  outputFormat: DEFAULT_OUTPUT_FORMAT,
  promptEnvelope: '',
  hasKey: false,
  configuredProviders: [],
  apiKey: '',
  cacheEnabled: true,
  saveHistory: true,
  theme: 'sepia',
  provider: 'gemini',
  openaiApiKey: '',
  anthropicApiKey: '',
  glossMode: false,
};
```

- `toFormValue()` (currently lines 67-80) gains one field, right after `theme: s.theme,`:

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
    glossMode: s.glossMode === true,
  };
}
```

- `mountSettings()` (currently lines 84-111) sets the visibility gate right before hydrating the
  form's value:

```ts
function mountSettings(initial: Settings, status?: string): void {
  const form = document.createElement('settings-form') as unknown as SettingsForm;
  if (KEY_FROM_ENV) form.keyFromEnv = true;
  form.glossModeAvailable = true;
  (form as unknown as HTMLElement).setAttribute('data-ad-theme', initial.theme);
  app.replaceChildren(form);
  (form as unknown as { value: SettingsFormValue }).value = toFormValue(initial);
  wireSettings(form);
  // ...unchanged below
```

`wireSettings`'s `save` listener (currently lines 113-134) needs **no change** — it already
spreads the full `next` (= `collect()`'s return) onto storage, so `glossMode` flows through
exactly like `cacheEnabled`/`theme` already do.

In `packages/extension-safari/src/options.ts`, `DEFAULTS` (currently lines 14-27) gains
`glossMode: false` — compile/consistency parity only (design spec §3):

```ts
const DEFAULTS: Settings = {
  targetLang: 'vi',
  outputFormat: DEFAULT_OUTPUT_FORMAT,
  promptEnvelope: '',
  hasKey: false,
  configuredProviders: [],
  apiKey: '',
  cacheEnabled: true,
  saveHistory: true,
  theme: 'sepia',
  provider: 'gemini',
  openaiApiKey: '',
  anthropicApiKey: '',
  glossMode: false,
};
```

`form.glossModeAvailable` is **never set** anywhere in this file — the checkbox row stays hidden
on Safari, matching design spec §2.5/§3. No other line in this file changes.

Run:

```
cd packages/extension-chrome && bun run typecheck
cd ../extension-safari && bun run typecheck
```

Expected: both clean (no type errors).

- [ ] **Step 2: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd ../extension-chrome && bun run typecheck && cd ../extension-safari && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

Commit:

```
git add packages/extension-chrome/src/content.ts packages/extension-chrome/src/options.ts packages/extension-safari/src/options.ts
git commit -m "[A5GlossMode] feat: wire glossMode + anchor through the Chrome composition root; Safari compile parity (A5)"
```

---

### Task 7: e2e coverage

**Files:**

- Modify: `packages/extension-chrome/e2e/helpers.ts`
- Create: `packages/extension-chrome/e2e/a5-gloss-mode.spec.ts`

- [ ] **Step 1: Add the translation-bearing mock body + settings override.** In
      `packages/extension-chrome/e2e/helpers.ts`:

  Add a new exported constant right after `GEMINI_OK_BODY` (currently lines 6-8):

```ts
/** A Gemini body carrying a TRANSLATION signal line (B2), for A5 gloss-mode scenarios. */
export const GEMINI_TRANSLATION_BODY = JSON.stringify({
  candidates: [
    {
      content: {
        parts: [{ text: 'TRANSLATION: "ngân hàng"\n\n## bank\nA financial institution.' }],
      },
    },
  ],
});
```

Add `glossMode?: boolean;` to `SettingsOverrides` (currently lines 24-36), right after
`anthropicApiKey?: string;`:

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
  glossMode?: boolean;
}
```

`seedSettings()`'s spread (`...o`) already forwards any override onto the stored object with no
further change needed.

- [ ] **Step 2: Write the new functional spec.** Create
      `packages/extension-chrome/e2e/a5-gloss-mode.spec.ts`:

```ts
import { test, expect } from './fixtures';
import {
  seedSettings,
  mockGemini,
  gotoFixture,
  selectWord,
  openTrigger,
  GEMINI_OK_BODY,
  GEMINI_TRANSLATION_BODY,
} from './helpers';

test.describe('A5 gloss mode', () => {
  test('gloss mode ON + a translation-bearing result: Define shows the compact gloss bubble; expanding opens the full card', async ({
    context,
    extensionId,
  }) => {
    await mockGemini(context, { body: GEMINI_TRANSLATION_BODY });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page, { glossMode: true });
    await gotoFixture(page, 'The bank by the river is steep.');
    await page.waitForTimeout(800);
    await selectWord(page, 't', 'bank');
    await openTrigger(page);

    const gloss = page.locator('lookup-gloss');
    await expect(gloss).toBeVisible({ timeout: 10_000 });
    await expect(gloss).toContainText('ngân hàng');
    expect(await page.locator('bottom-sheet').count()).toBe(0);

    await gloss.click();
    const card = page.locator('bottom-sheet lookup-card');
    await expect(card).toContainText('A financial institution.', { timeout: 10_000 });
    expect(await page.locator('lookup-gloss').count()).toBe(0);
  });

  test('gloss mode ON + no translation in the result: Define opens the full card directly, gloss bubble never appears', async ({
    context,
    extensionId,
  }) => {
    await mockGemini(context, { body: GEMINI_OK_BODY }); // no TRANSLATION: line
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page, { glossMode: true });
    await gotoFixture(page, 'The bank by the river is steep.');
    await page.waitForTimeout(800);
    await selectWord(page, 't', 'bank');
    await openTrigger(page);

    const card = page.locator('bottom-sheet lookup-card');
    await expect(card).toContainText('A financial institution.', { timeout: 10_000 });
    expect(await page.locator('lookup-gloss').count()).toBe(0);
  });

  test('gloss mode OFF (default): Define opens the full card directly even though a translation IS available', async ({
    context,
    extensionId,
  }) => {
    await mockGemini(context, { body: GEMINI_TRANSLATION_BODY });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page); // glossMode omitted — defaults to false
    await gotoFixture(page, 'The bank by the river is steep.');
    await page.waitForTimeout(800);
    await selectWord(page, 't', 'bank');
    await openTrigger(page);

    const card = page.locator('bottom-sheet lookup-card');
    await expect(card).toContainText('A financial institution.', { timeout: 10_000 });
    expect(await page.locator('lookup-gloss').count()).toBe(0);
  });

  test('gloss mode ON + NO_KEY: the full setup-invite card shows, never a gloss bubble', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page, { apiKey: '', hasKey: false, glossMode: true });
    await gotoFixture(page, 'The bank by the river is steep.');
    await page.waitForTimeout(800);
    await selectWord(page, 't', 'bank');
    await openTrigger(page);

    const card = page.locator('bottom-sheet lookup-card');
    await expect(card).toContainText('Set up AI Dictionary', { timeout: 10_000 });
    expect(await page.locator('lookup-gloss').count()).toBe(0);
  });

  test('the Compact gloss checkbox is visible on the settings page and persists to storage', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);
    await page.reload();
    await page.waitForSelector('settings-form');

    await expect(page.locator('settings-form #gloss-mode-row')).toBeVisible();
    await page.locator('settings-form #gloss-mode').check();
    await page.locator('settings-form #save').click();
    await expect(page.locator('settings-form #status')).toHaveText('Settings saved');

    const stored = await page.evaluate(async () => {
      const { settings } = (await chrome.storage.local.get('settings')) as {
        settings: { glossMode?: boolean };
      };
      return settings.glossMode;
    });
    expect(stored).toBe(true);
  });
});
```

Run:

```
GEMINI_API_KEY= bun run build:chrome
cd packages/extension-chrome && bunx playwright test a5-gloss-mode
```

Expected: 5 passed.

- [ ] **Step 3: Commit** — gate, then commit:

```
GEMINI_API_KEY= bun run build:chrome
bun run lint && bun run format:check
```

Commit:

```
git add packages/extension-chrome/e2e/helpers.ts packages/extension-chrome/e2e/a5-gloss-mode.spec.ts
git commit -m "[A5GlossMode] feat: e2e coverage for gloss mode on/off, translation-absent fallback, NO_KEY, and settings persistence (A5)"
```

---

### Task 8: Final gates + open the PR

- [ ] **Step 1: Run every gate, in order.**

```
cd packages/app && bun run typecheck
cd ../extension-chrome && bun run typecheck
cd ../extension-safari && bun run typecheck
cd ../..
bun run test
bun run lint
bun run format:check
GEMINI_API_KEY= bun run build:chrome
cd packages/extension-chrome && bunx playwright test a5-gloss-mode idiom-expansion b5-status-lifecycle onboarding settings settings-nav
```

Expected: typecheck clean on all three packages; the full Vitest suite green (690 pre-existing

- this card's new unit tests: 1 wire-schema, 2×1 storage-store round-trip, 2 workflow, 5
  lookup-gloss, 11 inline-bottom-sheet-renderer, 4 settings-form); lint/format clean; the Chrome
  build succeeds with the env key cleared; `a5-gloss-mode.spec.ts` (5 new scenarios) plus the
  regression guards this card's shared files touch —
  `idiom-expansion.spec.ts`/`b5-status-lifecycle.spec.ts` (share `inline-bottom-sheet-renderer.ts`),
  `onboarding.spec.ts`/`settings.spec.ts`/`settings-nav.spec.ts` (share `options.ts`/
  `settings-form.ts`) — all pass.

* [ ] **Step 2: Open the PR.**

  Push the branch and open a PR titled `[A5GlossMode] Gloss mode`, target `master`, **regular
  merge (squash prohibited — owner ruling 2026-07-16)**. Body:

```markdown
## Description

Adds an opt-in "Compact gloss" setting: a successful lookup renders as a one-line translation
bubble floating at the word instead of the full card; clicking it expands into today's exact
full card with no re-lookup. Off by default — zero behavior change until a reader opts in.
Reuses the existing `LookupResult.translation` field (B2) as the one-liner source; no new
prompt slot, no new wire message, no difficulty classifier (roadmap `docs/ROADMAP.md:264-275`
scope fence).

## Design choices

- New `<lookup-gloss>` component (not a `lookup-card`/`TriggerUI` mode) — keeps the ports
  architecture's one-port-one-job boundary intact (design spec §2.1).
- Errors and loading states with no anchor always render the full card — gloss mode never
  hides a setup/recovery CTA.
- Safari gets compile-time field parity only; no gloss rendering ships there this card.

## JIRA ticket

N/A — this repo has no Jira tracker (confirmed absent).

## Testing performed

- Unit: `bun run test` — full suite green (pre-existing 690 + this card's new: 1 wire-schema
  test, 2 storage-store round-trip tests, 2 workflow anchor-plumbing tests, 5 lookup-gloss
  tests, 11 inline-bottom-sheet-renderer gloss-mode tests, 4 settings-form tests).
- Typecheck: `packages/app`, `packages/extension-chrome`, `packages/extension-safari` — all clean.
- Lint + format: `bun run lint && bun run format:check` — clean.
- Build: `GEMINI_API_KEY= bun run build:chrome` — succeeds with the env key cleared.
- e2e (Playwright, bundled Chromium): `a5-gloss-mode.spec.ts` — 5 scenarios: gloss bubble shown
  - expand-to-full-card; translation-absent fallback to full card; glossMode-off fallback to
    full card despite an available translation; NO_KEY always shows the full setup-invite card;
    settings-page checkbox visibility + persistence. Regression guards
    `idiom-expansion.spec.ts`, `b5-status-lifecycle.spec.ts`, `onboarding.spec.ts`,
    `settings.spec.ts`, `settings-nav.spec.ts` — all green (files this card's diff shares).
```

- [ ] **Step 3: after merge**, note the change-unit for the next C3 sweep — one new component
      (`<lookup-gloss>`) under the existing `c3-117 ui-components` component — rather than
      hand-editing `.c3/` (it is CLI-only).
