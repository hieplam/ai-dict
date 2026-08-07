# B4 Hover-recall Implementation Plan

> **For agentic workers:** implement task-by-task, TDD (red → green → commit) per task. The
> design spec (same folder, `-design.md`) carries every decision; do not re-open them. **This
> plan assumes B3 (re-encounter highlighting) has already shipped** — `domain/highlight-policy.ts`
> (`naiveVariants`/`buildHighlightMatcher`/`findWordMatches`), `app/page-highlighter.ts`
> (`PageHighlighter`, incl. its `readonly ranges: ReadonlyArray<Range>`), the `saved.learningWords`
> wire message, and B3's `content.ts` wiring (`highlighter`, `refreshHighlights()`) all exist on
> disk by the time Task 1 below runs. If any of them are missing, STOP — B4 cannot proceed out of
> dependency order; report back rather than re-implementing B3.

**Goal:** hovering a B3-highlighted (learning-status, saved) word shows a small local popup with
the reader's own saved meaning — zero `LookupClient.lookup()` calls, zero provider network traffic
— with a "View full entry" link that opens the side panel showing the full saved definition.
Known-status words (never highlighted by B3) and pages with `highlightSavedWords` off (B3's
setting) never show the popup, by construction (nothing is ever hovered because nothing is
highlighted).

**Architecture:** three new modules, layered exactly like the existing Define-trigger stack
(`SelectionSource`/`TriggerUI` core ports + `ChromeFloatingTrigger` adapter + `<lookup-trigger>`
UI element):

- `packages/app/src/app/hover-recall-controller.ts` (portable, DOM-allowed core, `c3-1`) — caret
  hit-testing over `PageHighlighter.ranges` + the show/hide debounce state machine. No UI, no
  `chrome.*`.
- `packages/app/src/ui/hover-recall-popup.ts` (portable Paperlight UI, `c3-1`/`c3-117`) — the
  `<hover-recall-popup>` shadow-DOM element. Dumb view, no DOM-query awareness of anything else.
- `packages/extension-chrome/src/adapters/chrome-hover-recall-popup.ts` (Chrome shell, `c3-2`) —
  owns the singleton popup element's attachment/positioning, mirroring
  `chrome-floating-trigger.ts` 1:1.

Plus one new wire message (`saved.get` → `savedEntry` reply, ONE task per CONTRACTS §2) and
`content.ts` wiring that ties the three together and reuses the existing `open-side-panel`/
`lastFocus` mechanism verbatim for "View full entry." Full design rationale, including why each
alternative hover-detection/headword-resolution/side-panel mechanism was rejected:
`docs/superpowers/specs/2026-07-17-b4-hover-recall-design.md`.

**Tech Stack:** TypeScript, Zod (wire schema), Vitest + happy-dom (unit), Playwright (e2e).

## Global Constraints

- Implementer: dispatch each implementation/fix task to the `hunter` subagent — never a generic
  implementer.
- **Do not touch `packages/app/src/domain/highlight-policy.ts` or
  `packages/app/src/app/page-highlighter.ts`.** The design spec's §2.2 resolves the
  range→headword question by reusing B3's exported pure functions from `content.ts`, not by
  widening `PageHighlighter`'s surface. If a task in this plan seems to need a change to either
  file, stop; that means the reuse assumption broke somewhere and the plan needs re-grounding.
- **`hover-recall-controller.ts` and `hover-recall-popup.ts` render/inject NO HTML** — text only
  (`textContent`), never `innerHTML`, never a raw string cast to `SafeHtml`. The one place this
  card's data reaches a markdown-sanitize call is the EXISTING, unmodified side-panel
  `resultToFocus` → `sanitizeMarkdown` path (design spec §2.5) — no new sanitize call site.
- S1: `saved.get`'s reply carries only `SavedWordEntry` fields (word/status/savedAt/senses) —
  never touch `Settings`/`PublicSettings`/the API key.
- UI additions read only `--ad-*`/`--adp-*` design tokens (no hard-coded colors) —
  `hover-recall-popup.ts` reuses `BASE_VARS`/`THEME_CSS` exactly like every other Paperlight
  surface.
- `bun run lint` and `bun run format:check` clean before every commit.
- Every task must leave `cd packages/app && bun run typecheck` (and, from Task 4 on,
  `cd packages/extension-chrome && bun run typecheck`) green.
- **If the card needed a wire message, its `wire.ts` arm and `router.ts` case are ONE task**
  (exhaustive `switch(msg.type)`, no `default` — Task 1 below).
- Commit subject convention for every task in this plan: `feat: hover-recall — <task summary>
(B4)`; trailer `Tribe-Card: b4-hover-recall`, `Tribe-Task: n/6`. No Co-Authored-By, no
  attribution.

---

### Task 1: `saved.get` wire message + router case

**Files:**

- Modify: `packages/app/src/wire.ts`
- Modify: `packages/app/test/wire-schema.test.ts`
- Regenerate: `packages/app/wire-schema.snapshot.json` (via `-u`, never hand-edited)
- Modify: `packages/app/src/app/router.ts`
- Modify: `packages/app/test/app/router.test.ts`

Single gate run, single commit covering all four source/test files (the snapshot is a byproduct
of running the wire test with `-u`).

**Step 1 — failing tests, both files.**

Append to `packages/app/test/wire-schema.test.ts`, inside the existing
`describe('saved.save / saved.delete wire messages (B1)', ...)` block's closing area — add a new
top-level `describe` right after it (after its closing `});` at line 497):

```ts
describe('saved.get / savedEntry wire messages (B4)', () => {
  it('accepts a valid saved.get message', () => {
    expect(WireMessageSchema.safeParse({ type: 'saved.get', word: 'bank' }).success).toBe(true);
  });

  it('rejects a saved.get message missing word', () => {
    expect(WireMessageSchema.safeParse({ type: 'saved.get' }).success).toBe(false);
  });

  it('accepts a savedEntry reply carrying a real entry', () => {
    const entry = {
      word: 'bank',
      status: 'learning',
      savedAt: 1,
      senses: [{ definition: 'd', translation: 't', sentence: 's', url: 'u', title: 'ti' }],
    };
    expect(WireReplySchema.safeParse({ ok: true, type: 'savedEntry', entry }).success).toBe(true);
  });

  it('accepts a savedEntry reply with entry: null (word not saved)', () => {
    expect(WireReplySchema.safeParse({ ok: true, type: 'savedEntry', entry: null }).success).toBe(
      true,
    );
  });

  it('rejects a savedEntry reply with a non-object, non-null entry', () => {
    expect(WireReplySchema.safeParse({ ok: true, type: 'savedEntry', entry: 'nope' }).success).toBe(
      false,
    );
  });
});
```

Append to `packages/app/test/app/router.test.ts`, inside the `describe('buildRouter', ...)` block,
immediately after the existing `'saved.setStatus is case-insensitive on the word key (B5)'` test
(currently ending at line 579):

```ts
it('saved.get returns the full entry for a saved word (B4)', async () => {
  const d = deps();
  const route = buildRouter(d);
  await route({
    type: 'saved.save',
    word: 'bank',
    definition: 'a financial institution',
    translation: 'ngân hàng',
    sentence: 'the river bank',
    url: 'https://example.com',
    title: 'Example',
  });
  const reply = await route({ type: 'saved.get', word: 'bank' });
  expect(reply).toMatchObject({
    ok: true,
    type: 'savedEntry',
    entry: {
      word: 'bank',
      status: 'learning',
      senses: [{ definition: 'a financial institution', translation: 'ngân hàng' }],
    },
  });
});

it('saved.get on an unsaved word replies entry: null (B4)', async () => {
  const d = deps();
  const route = buildRouter(d);
  const reply = await route({ type: 'saved.get', word: 'ghost' });
  expect(reply).toMatchObject({ ok: true, type: 'savedEntry', entry: null });
});

it('saved.get is case-insensitive on the word key (B4)', async () => {
  const d = deps();
  const route = buildRouter(d);
  await route({
    type: 'saved.save',
    word: 'Bank',
    definition: 'd',
    translation: '',
    sentence: 's',
    url: 'u',
    title: 't',
  });
  const reply = await route({ type: 'saved.get', word: 'BANK' });
  expect(reply).toMatchObject({ ok: true, type: 'savedEntry', entry: { word: 'Bank' } });
});
```

Run: `cd packages/app && bunx vitest run test/wire-schema.test.ts test/app/router.test.ts`
Expected: failures — `'saved.get'` is not a recognized message type; `'savedEntry'` is not a
recognized reply type.

**Step 2 — implement both together.**

In `packages/app/src/wire.ts`, add to `WireMessageSchema`'s array, immediately after the
`saved.learningWords` arm (B3) — if B3's arm is not present on disk yet, insert immediately after
the `saved.setStatus` arm instead (functional position inside a `discriminatedUnion` array does
not matter, only grouping-for-readability does):

```ts
  // B4: fetch one full saved entry by word, for the hover-recall popup. Content scripts never
  // read chrome.storage directly (S1/ref-kv-storage-prefixes) — this is the read counterpart to
  // saved.save's write. Read-only, no queue.
  z.object({ type: z.literal('saved.get'), word: z.string() }),
```

Add to `WireReplySchema`'s array, immediately after the `savedWords` reply arm (B3) — same
insert-after-`saved`-arm fallback if B3 isn't present yet:

```ts
  // B4: a nullable entry (the word may have been unsaved between B3 painting the highlight and
  // the reader hovering it) — deliberately a NEW reply arm rather than widening the existing
  // `saved` arm, which every saved.save/saved.setStatus caller already assumes is non-null.
  z.object({
    ok: z.literal(true),
    type: z.literal('savedEntry'),
    entry: SavedWordEntrySchema.nullable(),
  }),
```

Add `'saved.get'` to `MessageTypeEnum`'s array (any position; needed only so the `ok:false` error
reply's `type` field type-checks for this message).

In `packages/app/src/app/router.ts`, import `savedWordGet` alongside the existing
`savedWordUpsert`/`savedWordDelete`/`savedWordSetStatus` import (line 13-15), and add a new case
immediately after the `saved.setStatus` case (or after B3's `saved.learningWords` case if present
— same grouping note as above):

```ts
      case 'saved.get': {
        const entry = await savedWordGet({ storage: deps.kv }, msg.word);
        return { ok: true, type: 'savedEntry', entry };
      }
```

Run: `cd packages/app && bunx vitest run test/wire-schema.test.ts -u` (regenerates
`wire-schema.snapshot.json` — diff shows only the two new arms), then
`bunx vitest run test/wire-schema.test.ts test/app/router.test.ts`
Expected: all pass, including the new tests above.

**Step 3 — gate + commit:**

```
cd packages/app && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

```
git add packages/app/src/wire.ts packages/app/src/app/router.ts packages/app/test/wire-schema.test.ts packages/app/test/app/router.test.ts packages/app/wire-schema.snapshot.json
git commit -m "feat: hover-recall — saved.get wire message + router case (B4)" \
  -m $'Tribe-Card: b4-hover-recall\nTribe-Task: 1/6'
```

---

### Task 2: `app/hover-recall-controller.ts` — caret hit-test + debounce state machine

**Files:** create `packages/app/src/app/hover-recall-controller.ts`; create
`packages/app/test/app/hover-recall-controller.test.ts`.

**Interfaces (design spec §2.1/§2.7):**

```ts
export interface CaretHit {
  node: Node;
  offset: number;
}
export type CaretLocator = (x: number, y: number) => CaretHit | null;

export interface HoverRecallControllerOpts {
  caretAt?: CaretLocator;
  hoverDelayMs?: number; // default 200
  leaveDelayMs?: number; // default 250
}

export interface HoverRecallMatch {
  range: Range;
}

export function findHoverHit(hit: CaretHit | null, ranges: ReadonlyArray<Range>): Range | null;

export class HoverRecallController {
  constructor(doc: Document, opts?: HoverRecallControllerOpts);
  start(
    getRanges: () => ReadonlyArray<Range>,
    onMatch: (m: HoverRecallMatch) => void,
    onLeave: () => void,
    popupEl?: Element,
  ): void;
  stop(): void;
}
```

**Step 1 — failing tests.** Create `packages/app/test/app/hover-recall-controller.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  findHoverHit,
  HoverRecallController,
  type CaretHit,
} from '../../src/app/hover-recall-controller';

function textRange(text: string, start: number, end: number): { node: Text; range: Range } {
  const node = document.createTextNode(text);
  document.body.appendChild(node);
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  return { node, range };
}

describe('findHoverHit (pure)', () => {
  it('resolves the range whose startContainer matches and offset falls within bounds', () => {
    const { node, range } = textRange('Banks on the river bank', 0, 5);
    const hit: CaretHit = { node, offset: 2 };
    expect(findHoverHit(hit, [range])).toBe(range);
  });

  it('returns null when the offset is outside every range on the matching node', () => {
    const { node, range } = textRange('Banks on the river bank', 0, 5);
    expect(findHoverHit({ node, offset: 10 }, [range])).toBeNull();
  });

  it('returns null when the hit is on a different node entirely', () => {
    const { range } = textRange('Banks on the river bank', 0, 5);
    const other = document.createTextNode('other');
    expect(findHoverHit({ node: other, offset: 0 }, [range])).toBeNull();
  });

  it('returns null for a null hit', () => {
    const { range } = textRange('Banks on the river bank', 0, 5);
    expect(findHoverHit(null, [range])).toBeNull();
  });

  it('resolves the correct range among several on the same node', () => {
    const node = document.createTextNode('Banks on the river bank');
    document.body.appendChild(node);
    const r1 = document.createRange();
    r1.setStart(node, 0);
    r1.setEnd(node, 5); // "Banks"
    const r2 = document.createRange();
    r2.setStart(node, 19);
    r2.setEnd(node, 23); // "bank"
    expect(findHoverHit({ node, offset: 20 }, [r1, r2])).toBe(r2);
  });
});

describe('HoverRecallController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // happy-dom has no real layout engine; requestAnimationFrame is stubbed to run synchronously
    // so mousemove-driven ticks are deterministic under fake timers (mirrors B3's own
    // idle-callback-fallback test shim precedent).
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback): number => {
      cb(0);
      return 0;
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  function setup(caretAt: CaretLocator, ranges: Range[]) {
    const controller = new HoverRecallController(document, { caretAt });
    const onMatch = vi.fn();
    const onLeave = vi.fn();
    controller.start(() => ranges, onMatch, onLeave);
    return { controller, onMatch, onLeave };
  }

  function move(x = 5, y = 5): void {
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y }));
  }

  it('fires onMatch after 200ms of continuous hover over the same range', () => {
    const { node, range } = textRange('bank', 0, 4);
    const caretAt: CaretLocator = () => ({ node, offset: 1 });
    const { onMatch } = setup(caretAt, [range]);
    move();
    vi.advanceTimersByTime(199);
    expect(onMatch).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onMatch).toHaveBeenCalledWith({ range });
    expect(onMatch).toHaveBeenCalledTimes(1);
  });

  it('resets the show timer when the candidate range changes before it fires', () => {
    const a = textRange('bank', 0, 4);
    const b = textRange('money', 0, 5);
    let current = a.range;
    const caretAt: CaretLocator = () => ({
      node: current === a.range ? a.node : b.node,
      offset: 1,
    });
    const { onMatch } = setup(caretAt, [a.range, b.range]);
    move();
    vi.advanceTimersByTime(150);
    current = b.range;
    move();
    vi.advanceTimersByTime(150);
    expect(onMatch).not.toHaveBeenCalled();
    vi.advanceTimersByTime(50);
    expect(onMatch).toHaveBeenCalledWith({ range: b.range });
  });

  it('fires onLeave 250ms after the pointer leaves the matched range, unless it returns', () => {
    const { node, range } = textRange('bank', 0, 4);
    let onRange = true;
    const caretAt: CaretLocator = () => (onRange ? { node, offset: 1 } : null);
    const { onMatch, onLeave } = setup(caretAt, [range]);
    move();
    vi.advanceTimersByTime(200);
    expect(onMatch).toHaveBeenCalledTimes(1);
    onRange = false;
    move();
    vi.advanceTimersByTime(249);
    expect(onLeave).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it('does not fire onLeave if the pointer returns to the matched range within the grace period', () => {
    const { node, range } = textRange('bank', 0, 4);
    let onRange = true;
    const caretAt: CaretLocator = () => (onRange ? { node, offset: 1 } : null);
    const { onLeave } = setup(caretAt, [range]);
    move();
    vi.advanceTimersByTime(200);
    onRange = false;
    move();
    vi.advanceTimersByTime(100);
    onRange = true;
    move();
    vi.advanceTimersByTime(300);
    expect(onLeave).not.toHaveBeenCalled();
  });

  it('treats hovering the injected popupEl as still-matched (no onLeave)', () => {
    const { node, range } = textRange('bank', 0, 4);
    const popup = document.createElement('div');
    document.body.appendChild(popup);
    let overPopup = false;
    const caretAt: CaretLocator = () => ({ node, offset: 1 });
    const controller = new HoverRecallController(document, {
      caretAt,
      // elementFromPoint is stubbed per-test below via document.elementFromPoint override.
    });
    const onMatch = vi.fn();
    const onLeave = vi.fn();
    (
      document as unknown as { elementFromPoint: (x: number, y: number) => Element | null }
    ).elementFromPoint = () => (overPopup ? popup : document.body);
    controller.start(() => [range], onMatch, onLeave, popup);
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 5, clientY: 5 }));
    vi.advanceTimersByTime(200);
    expect(onMatch).toHaveBeenCalledTimes(1);
    overPopup = true;
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 5, clientY: 5 }));
    vi.advanceTimersByTime(1000);
    expect(onLeave).not.toHaveBeenCalled();
  });

  it('Escape fires onLeave immediately, bypassing the grace period', () => {
    const { node, range } = textRange('bank', 0, 4);
    const caretAt: CaretLocator = () => ({ node, offset: 1 });
    const { onLeave } = setup(caretAt, [range]);
    move();
    vi.advanceTimersByTime(200);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it('an outside mousedown fires onLeave immediately', () => {
    const { node, range } = textRange('bank', 0, 4);
    const caretAt: CaretLocator = () => ({ node, offset: 1 });
    const { onLeave } = setup(caretAt, [range]);
    move();
    vi.advanceTimersByTime(200);
    document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it('never matches while an active (non-collapsed) selection exists', () => {
    const { node, range } = textRange('bank', 0, 4);
    const sel = window.getSelection()!;
    const other = document.createTextNode('selected text');
    document.body.appendChild(other);
    const selRange = document.createRange();
    selRange.setStart(other, 0);
    selRange.setEnd(other, 5);
    sel.removeAllRanges();
    sel.addRange(selRange);
    const caretAt: CaretLocator = () => ({ node, offset: 1 });
    const { onMatch } = setup(caretAt, [range]);
    move();
    vi.advanceTimersByTime(500);
    expect(onMatch).not.toHaveBeenCalled();
    sel.removeAllRanges();
  });

  it('never matches when elementFromPoint resolves an extension host tag', () => {
    const { node, range } = textRange('bank', 0, 4);
    const bottomSheet = document.createElement('bottom-sheet');
    document.body.appendChild(bottomSheet);
    (
      document as unknown as { elementFromPoint: (x: number, y: number) => Element | null }
    ).elementFromPoint = () => bottomSheet;
    const caretAt: CaretLocator = () => ({ node, offset: 1 });
    const { onMatch } = setup(caretAt, [range]);
    move();
    vi.advanceTimersByTime(500);
    expect(onMatch).not.toHaveBeenCalled();
  });

  it('gracefully never matches when caretAt always returns null (no platform caret API)', () => {
    const { range } = textRange('bank', 0, 4);
    const { onMatch } = setup(() => null, [range]);
    move();
    vi.advanceTimersByTime(500);
    expect(onMatch).not.toHaveBeenCalled();
  });

  it('stop() removes listeners — a mousemove after stop() never fires onMatch', () => {
    const { node, range } = textRange('bank', 0, 4);
    const caretAt: CaretLocator = () => ({ node, offset: 1 });
    const { controller, onMatch } = setup(caretAt, [range]);
    controller.stop();
    move();
    vi.advanceTimersByTime(500);
    expect(onMatch).not.toHaveBeenCalled();
  });
});

describe('default caretAt platform-API selection', () => {
  afterEach(() => {
    // @ts-expect-error test-only cleanup of properties this suite stubs
    delete document.caretPositionFromPoint;
    // @ts-expect-error test-only cleanup of properties this suite stubs
    delete document.caretRangeFromPoint;
  });

  it('prefers caretPositionFromPoint when present', async () => {
    const { node } = textRange('bank', 0, 4);
    const posSpy = vi.fn(() => ({ offsetNode: node, offset: 2 }));
    const rangeSpy = vi.fn();
    Object.assign(document, { caretPositionFromPoint: posSpy, caretRangeFromPoint: rangeSpy });
    const { defaultCaretAt } = await import('../../src/app/hover-recall-controller');
    const hit = defaultCaretAt(1, 2);
    expect(posSpy).toHaveBeenCalledWith(1, 2);
    expect(rangeSpy).not.toHaveBeenCalled();
    expect(hit).toEqual({ node, offset: 2 });
  });

  it('falls back to caretRangeFromPoint when caretPositionFromPoint is absent (pre-Chrome-125)', async () => {
    const { node } = textRange('bank', 0, 4);
    const r = document.createRange();
    r.setStart(node, 3);
    const rangeSpy = vi.fn(() => r);
    Object.assign(document, { caretRangeFromPoint: rangeSpy });
    const { defaultCaretAt } = await import('../../src/app/hover-recall-controller');
    const hit = defaultCaretAt(1, 2);
    expect(rangeSpy).toHaveBeenCalledWith(1, 2);
    expect(hit).toEqual({ node, offset: 3 });
  });

  it('returns null when neither platform API exists (graceful no-op)', async () => {
    const { defaultCaretAt } = await import('../../src/app/hover-recall-controller');
    expect(defaultCaretAt(1, 2)).toBeNull();
  });
});
```

Run: `cd packages/app && bunx vitest run test/app/hover-recall-controller.test.ts`
Expected: failures — the module does not exist yet.

**Step 2 — implement.** Create `packages/app/src/app/hover-recall-controller.ts`:

```ts
/**
 * B4: caret hit-testing over B3's `PageHighlighter.ranges` + the hover-intent show/hide debounce.
 * No UI, no chrome.* — DOM access only (app/ tier, same precedent as page-highlighter.ts). See
 * design spec §2.1/§2.7 for the full rationale (why caret hit-testing, why the fallback path is
 * load-bearing given manifest.json's minimum_chrome_version, why each numeric default was picked).
 */

export interface CaretHit {
  node: Node;
  offset: number;
}

/** Injected so unit tests can control it — happy-dom has neither a real
 * `document.caretPositionFromPoint` nor `caretRangeFromPoint` (no layout engine). Production
 * code uses `defaultCaretAt` (exported for the platform-API-selection unit tests only; callers
 * should not need to invoke it directly). */
export type CaretLocator = (x: number, y: number) => CaretHit | null;

export interface HoverRecallControllerOpts {
  caretAt?: CaretLocator;
  /** Continuous hover over the same range before onMatch fires. Default 200. */
  hoverDelayMs?: number;
  /** Grace period after leaving the match/popup before onLeave fires. Default 250. */
  leaveDelayMs?: number;
}

export interface HoverRecallMatch {
  range: Range;
}

const SKIP_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'TEXTAREA',
  'INPUT',
  'SELECT',
  'BOTTOM-SHEET',
  'LOOKUP-TRIGGER',
  'HOVER-RECALL-POPUP',
]);

/** A small, intentionally duplicated subset of B3's own PageHighlighter skip-list (design spec
 * §2.7) — B3 does not export its predicate, and this card only needs the "don't treat the
 * extension's own UI as hoverable page content" half of it. */
function isSkippable(el: Element): boolean {
  if (SKIP_TAGS.has(el.tagName)) return true;
  if (el.tagName.startsWith('AD-')) return true;
  return (el as HTMLElement).isContentEditable === true;
}

/** Pure: does `hit` fall inside any of `ranges`? B3's PageHighlighter builds every range with a
 * single setStart/setEnd on ONE text node (findWordMatches never spans nodes), so a same-node +
 * offset-within-bounds check is exact — no DOM traversal needed. */
export function findHoverHit(hit: CaretHit | null, ranges: ReadonlyArray<Range>): Range | null {
  if (!hit) return null;
  for (const r of ranges) {
    if (r.startContainer === hit.node && hit.offset >= r.startOffset && hit.offset <= r.endOffset) {
      return r;
    }
  }
  return null;
}

/** The platform caret-lookup, modern API preferred, legacy API as the load-bearing fallback for
 * Chrome 116-124 (manifest.json's minimum_chrome_version predates caretPositionFromPoint, which
 * shipped in Chrome 125 — see design spec §2.1). Exported for the platform-selection unit tests. */
export function defaultCaretAt(x: number, y: number): CaretHit | null {
  const d = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  if (typeof d.caretPositionFromPoint === 'function') {
    const pos = d.caretPositionFromPoint(x, y);
    return pos ? { node: pos.offsetNode, offset: pos.offset } : null;
  }
  if (typeof d.caretRangeFromPoint === 'function') {
    const r = d.caretRangeFromPoint(x, y);
    return r ? { node: r.startContainer, offset: r.startOffset } : null;
  }
  return null; // neither API exists — graceful no-op, mirrors B3's CSS.highlights-undefined precedent
}

export class HoverRecallController {
  private readonly caretAt: CaretLocator;
  private readonly hoverDelayMs: number;
  private readonly leaveDelayMs: number;

  private rafScheduled = false;
  private lastXY: { x: number; y: number } | null = null;
  private candidate: Range | null = null;
  private matched: Range | null = null;
  private showTimer: ReturnType<typeof setTimeout> | null = null;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;

  private getRanges: (() => ReadonlyArray<Range>) | null = null;
  private onMatchCb: ((m: HoverRecallMatch) => void) | null = null;
  private onLeaveCb: (() => void) | null = null;
  private popupEl: Element | undefined;

  constructor(
    private readonly doc: Document,
    opts: HoverRecallControllerOpts = {},
  ) {
    this.caretAt = opts.caretAt ?? defaultCaretAt;
    this.hoverDelayMs = opts.hoverDelayMs ?? 200;
    this.leaveDelayMs = opts.leaveDelayMs ?? 250;
  }

  start(
    getRanges: () => ReadonlyArray<Range>,
    onMatch: (m: HoverRecallMatch) => void,
    onLeave: () => void,
    popupEl?: Element,
  ): void {
    this.getRanges = getRanges;
    this.onMatchCb = onMatch;
    this.onLeaveCb = onLeave;
    this.popupEl = popupEl;
    this.doc.addEventListener('mousemove', this.onMouseMove, { passive: true });
    this.doc.addEventListener('scroll', this.onImmediateLeave, true);
    this.doc.addEventListener('keydown', this.onKeydown);
    for (const t of ['mousedown', 'touchstart'] as const) {
      this.doc.addEventListener(t, this.onOutsidePress, true);
    }
  }

  stop(): void {
    this.doc.removeEventListener('mousemove', this.onMouseMove);
    this.doc.removeEventListener('scroll', this.onImmediateLeave, true);
    this.doc.removeEventListener('keydown', this.onKeydown);
    for (const t of ['mousedown', 'touchstart'] as const) {
      this.doc.removeEventListener(t, this.onOutsidePress, true);
    }
    this.clearShowTimer();
    this.clearHideTimer();
    this.candidate = null;
    this.matched = null;
    this.getRanges = null;
    this.onMatchCb = null;
    this.onLeaveCb = null;
  }

  private readonly onMouseMove = (e: MouseEvent): void => {
    this.lastXY = { x: e.clientX, y: e.clientY };
    if (this.rafScheduled) return;
    this.rafScheduled = true;
    requestAnimationFrame(() => {
      this.rafScheduled = false;
      if (this.lastXY) this.tick(this.lastXY.x, this.lastXY.y);
    });
  };

  private readonly onKeydown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') this.forceLeave();
  };

  private readonly onOutsidePress = (e: Event): void => {
    if (this.popupEl && e.composedPath().includes(this.popupEl)) return;
    this.forceLeave();
  };

  private readonly onImmediateLeave = (): void => {
    this.forceLeave();
  };

  private tick(x: number, y: number): void {
    if (!this.getRanges) return;
    const el = this.doc.elementFromPoint(x, y);
    if (this.popupEl && el && (el === this.popupEl || this.popupEl.contains(el))) {
      this.cancelHide();
      return;
    }
    if (this.doc.getSelection()?.isCollapsed === false) return this.scheduleLeave();
    if (!el || isSkippable(el)) return this.scheduleLeave();

    const range = findHoverHit(this.caretAt(x, y), this.getRanges());
    if (!range) return this.scheduleLeave();

    if (this.matched === range) {
      this.cancelHide();
      return;
    }
    if (this.candidate !== range) {
      this.candidate = range;
      this.clearShowTimer();
      this.showTimer = setTimeout(() => {
        if (this.candidate === range) {
          this.matched = range;
          this.cancelHide();
          this.onMatchCb?.({ range });
        }
      }, this.hoverDelayMs);
    }
  }

  private scheduleLeave(): void {
    this.candidate = null;
    this.clearShowTimer();
    if (!this.matched || this.hideTimer) return;
    this.hideTimer = setTimeout(() => {
      this.hideTimer = null;
      this.matched = null;
      this.onLeaveCb?.();
    }, this.leaveDelayMs);
  }

  private forceLeave(): void {
    this.candidate = null;
    this.clearShowTimer();
    this.clearHideTimer();
    if (this.matched) {
      this.matched = null;
      this.onLeaveCb?.();
    }
  }

  private cancelHide(): void {
    this.clearHideTimer();
  }

  private clearShowTimer(): void {
    if (this.showTimer !== null) {
      clearTimeout(this.showTimer);
      this.showTimer = null;
    }
  }

  private clearHideTimer(): void {
    if (this.hideTimer !== null) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
  }
}
```

Run: `cd packages/app && bunx vitest run test/app/hover-recall-controller.test.ts`
Expected: all tests pass.

**Step 3 — gate + commit:**

```
cd packages/app && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

```
git add packages/app/src/app/hover-recall-controller.ts packages/app/test/app/hover-recall-controller.test.ts
git commit -m "feat: hover-recall — caret hit-test + debounce controller (B4)" \
  -m $'Tribe-Card: b4-hover-recall\nTribe-Task: 2/6'
```

---

### Task 3: `ui/hover-recall-popup.ts` — the `<hover-recall-popup>` element

**Files:** create `packages/app/src/ui/hover-recall-popup.ts`; create
`packages/app/test/ui/hover-recall-popup.test.ts`; modify `packages/app/src/ui/register.ts`;
modify `packages/app/src/ui/index.ts`; modify `packages/app/src/index.ts`.

**Interfaces:**

```ts
export interface HoverRecallValue {
  word: string;
  preview: string; // plain text, already composed/truncated by the caller
}

export class HoverRecallPopup extends HTMLElement {
  show(anchor: AnchorRect, value: HoverRecallValue): void;
  hide(): void;
  // dispatches a composed 'view-full-entry' CustomEvent<{ word: string }> when clicked
}
```

**Step 1 — failing tests.** Create `packages/app/test/ui/hover-recall-popup.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { HoverRecallPopup } from '../../src/ui/hover-recall-popup';

if (!customElements.get('hover-recall-popup')) {
  customElements.define('hover-recall-popup', HoverRecallPopup);
}

function mount(): HoverRecallPopup {
  const el = document.createElement('hover-recall-popup') as HoverRecallPopup;
  document.body.appendChild(el);
  return el;
}

describe('<hover-recall-popup>', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('is hidden until show() is called', () => {
    const el = mount();
    expect(el.hidden).toBe(true);
  });

  it('show() sets the headword and preview as plain text and un-hides', () => {
    const el = mount();
    el.show({ x: 10, y: 20, w: 30, h: 12 }, { word: 'bank', preview: 'ngân hàng' });
    expect(el.hidden).toBe(false);
    const root = el.shadowRoot!;
    expect(root.querySelector('.word')!.textContent).toBe('bank');
    expect(root.querySelector('.preview')!.textContent).toBe('ngân hàng');
  });

  it('never injects HTML — a preview containing markup renders as literal text', () => {
    const el = mount();
    el.show({ x: 0, y: 0, w: 0, h: 0 }, { word: 'bank', preview: '<img src=x onerror=alert(1)>' });
    const preview = el.shadowRoot!.querySelector('.preview')!;
    expect(preview.innerHTML).not.toContain('<img');
    expect(preview.textContent).toBe('<img src=x onerror=alert(1)>');
  });

  it('hide() re-hides the element', () => {
    const el = mount();
    el.show({ x: 0, y: 0, w: 0, h: 0 }, { word: 'bank', preview: 'p' });
    el.hide();
    expect(el.hidden).toBe(true);
  });

  it('clicking "View full entry" dispatches a composed view-full-entry event with the word', () => {
    const el = mount();
    el.show({ x: 0, y: 0, w: 0, h: 0 }, { word: 'bank', preview: 'p' });
    let captured: { word: string } | undefined;
    document.addEventListener('view-full-entry', (e) => {
      captured = (e as CustomEvent<{ word: string }>).detail;
    });
    el.shadowRoot!.querySelector<HTMLButtonElement>('.view-link')!.click();
    expect(captured).toEqual({ word: 'bank' });
  });

  it('registers idempotently alongside registerContentElements (double-define is a no-op)', async () => {
    const { registerContentElements } = await import('../../src/ui/register');
    expect(() => {
      registerContentElements();
      registerContentElements();
    }).not.toThrow();
  });
});
```

Run: `cd packages/app && bunx vitest run test/ui/hover-recall-popup.test.ts`
Expected: failures — the module does not exist yet.

**Step 2 — implement.** Create `packages/app/src/ui/hover-recall-popup.ts`:

```ts
import type { AnchorRect } from '../domain/types';
import { adoptStyles } from './styles/adopt';
import { BASE_VARS, THEME_CSS } from './styles/tokens';

export interface HoverRecallValue {
  word: string;
  preview: string;
}

// A small floating card, deliberately simpler than <lookup-card>/<bottom-sheet> — B4's design
// spec §2.4 pins this as plain text only (never innerHTML), so there is no sanitize surface here
// at all. Positioned by the caller (the Chrome adapter, packages/extension-chrome/src/adapters/
// chrome-hover-recall-popup.ts) via inline left/top; this element owns only its own box styling.
const CSS = `:host{all:initial;${BASE_VARS};position:fixed;z-index:var(--adp-z-overlay);color-scheme:light;font:var(--adp-text-sm)/1.4 var(--adp-font-sans)}
${THEME_CSS}
.pop{max-width:260px;padding:10px 12px;border-radius:var(--adp-radius-control);background:var(--ad-surface);border:1px solid var(--ad-line-strong);box-shadow:var(--ad-shadow-card);color:var(--ad-ink)}
.word{display:block;font-family:var(--adp-font-serif);font-weight:var(--adp-weight-bold);font-size:15px;margin-bottom:2px}
.preview{display:block;margin:0 0 8px;color:var(--ad-ink-soft);overflow-wrap:anywhere}
.view-link{display:inline-flex;border:0;background:transparent;color:var(--ad-accent-ink);font:inherit;font-weight:var(--adp-weight-semi);padding:0;cursor:pointer;text-decoration:underline;text-underline-offset:2px}
.view-link:focus-visible{outline:2px solid var(--ad-accent);outline-offset:2px}`;

export class HoverRecallPopup extends HTMLElement {
  private wordEl!: HTMLElement;
  private previewEl!: HTMLElement;
  private currentWord = '';

  connectedCallback(): void {
    this.hidden = true;
    if (this.shadowRoot) return;
    const root = this.attachShadow({ mode: 'open' });
    adoptStyles(root, CSS);
    const pop = document.createElement('div');
    pop.className = 'pop';
    pop.setAttribute('role', 'note');
    this.wordEl = document.createElement('strong');
    this.wordEl.className = 'word';
    this.previewEl = document.createElement('span');
    this.previewEl.className = 'preview';
    const link = document.createElement('button');
    link.type = 'button';
    link.className = 'view-link';
    link.textContent = 'View full entry';
    link.addEventListener('click', () => {
      this.dispatchEvent(
        new CustomEvent('view-full-entry', {
          detail: { word: this.currentWord },
          bubbles: true,
          composed: true,
        }),
      );
    });
    pop.append(this.wordEl, this.previewEl, link);
    root.append(pop);
  }

  show(anchor: AnchorRect, value: HoverRecallValue): void {
    this.currentWord = value.word;
    this.wordEl.textContent = value.word;
    this.previewEl.textContent = value.preview; // textContent only — never innerHTML (no sanitize surface)
    this.hidden = false;
    this.style.left = `${anchor.x}px`;
    this.style.top = `${anchor.y + anchor.h}px`;
    // Clamp to the viewport once the box has real layout (happy-dom returns a zero rect — a
    // harmless no-op there; verified for real in the e2e suite, design spec §5.7).
    const r = this.getBoundingClientRect();
    const vw = globalThis.innerWidth ?? 0;
    const vh = globalThis.innerHeight ?? 0;
    let left = anchor.x;
    let top = anchor.y + anchor.h;
    if (r.width && left + r.width > vw) left = Math.max(0, vw - r.width - 8);
    if (r.height && top + r.height > vh) top = Math.max(0, anchor.y - r.height);
    this.style.left = `${left}px`;
    this.style.top = `${top}px`;
  }

  hide(): void {
    this.hidden = true;
  }
}
```

Modify `packages/app/src/ui/register.ts` — add the import and extend `registerContentElements()`:

```ts
import { LookupTrigger } from './lookup-trigger';
import { LookupCard } from './lookup-card';
import { BottomSheet } from './bottom-sheet';
import { HoverRecallPopup } from './hover-recall-popup';
import { SettingsForm } from './settings-form';
import { SidePanelView } from './side-panel-view';
import { OnboardingView } from './onboarding-view';

export function registerContentElements(): void {
  if (!customElements.get('lookup-trigger')) customElements.define('lookup-trigger', LookupTrigger);
  if (!customElements.get('lookup-card')) customElements.define('lookup-card', LookupCard);
  if (!customElements.get('bottom-sheet')) customElements.define('bottom-sheet', BottomSheet);
  // B4: registered alongside the other in-page (MAIN-world) elements — same content-elements.ts
  // entry point, no new registration function.
  if (!customElements.get('hover-recall-popup'))
    customElements.define('hover-recall-popup', HoverRecallPopup);
}
```

(`registerSidePanel`/`registerSettingsForm`/`registerOnboarding` are unchanged.)

Modify `packages/app/src/ui/index.ts` — add one export line alongside the existing six:

```ts
export * from './hover-recall-popup';
```

Modify `packages/app/src/index.ts` — add one export line alongside the existing `./app/*` list
(the `export * from './ui/index'` line already re-exports the new UI module transitively; this
adds the controller from Task 2):

```ts
export * from './app/hover-recall-controller';
```

Run: `cd packages/app && bunx vitest run test/ui/hover-recall-popup.test.ts`
Expected: all tests pass.

**Step 3 — gate + commit:**

```
cd packages/app && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

```
git add packages/app/src/ui/hover-recall-popup.ts packages/app/test/ui/hover-recall-popup.test.ts packages/app/src/ui/register.ts packages/app/src/ui/index.ts packages/app/src/index.ts
git commit -m "feat: hover-recall — <hover-recall-popup> Paperlight element (B4)" \
  -m $'Tribe-Card: b4-hover-recall\nTribe-Task: 3/6'
```

---

### Task 4: `adapters/chrome-hover-recall-popup.ts` — singleton lifecycle adapter

**Files:** create `packages/extension-chrome/src/adapters/chrome-hover-recall-popup.ts`; create
`packages/extension-chrome/src/adapters/chrome-hover-recall-popup.test.ts`.

**Interfaces (mirrors `chrome-floating-trigger.ts`'s shape):**

```ts
export class ChromeHoverRecallPopup {
  constructor(host?: HTMLElement);
  readonly element: HTMLElement; // the singleton <hover-recall-popup>, for HoverRecallController's popupEl param
  set theme(t: Theme);
  show(anchor: AnchorRect, value: HoverRecallValue): void;
  hide(): void;
}
```

Unlike `ChromeFloatingTrigger`, the element is created ONCE at construction (not lazily on first
`show()`) and never removed — §2.7 of the design spec: there is no outside-press-listener
lifecycle tied to its creation (that lives inside `HoverRecallController`, Task 2), so lazy
create/destroy would only add churn.

**Step 1 — failing tests.** Create
`packages/extension-chrome/src/adapters/chrome-hover-recall-popup.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { registerContentElements } from '@ai-dict/app';
import { ChromeHoverRecallPopup } from './chrome-hover-recall-popup';

registerContentElements();

describe('ChromeHoverRecallPopup', () => {
  let host: HTMLElement;
  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  it('creates exactly one <hover-recall-popup> element on construction', () => {
    new ChromeHoverRecallPopup(host);
    expect(host.querySelectorAll('hover-recall-popup')).toHaveLength(1);
  });

  it('show() positions the element via the anchor rect', () => {
    const adapter = new ChromeHoverRecallPopup(host);
    const showSpy = vi.spyOn(
      adapter.element as unknown as { show: (a: unknown, v: unknown) => void },
      'show',
    );
    adapter.show({ x: 10, y: 20, w: 5, h: 8 }, { word: 'bank', preview: 'p' });
    expect(showSpy).toHaveBeenCalledWith(
      { x: 10, y: 20, w: 5, h: 8 },
      { word: 'bank', preview: 'p' },
    );
  });

  it('repeated show() calls reuse the same element (no duplicate nodes)', () => {
    const adapter = new ChromeHoverRecallPopup(host);
    adapter.show({ x: 0, y: 0, w: 0, h: 0 }, { word: 'a', preview: 'p' });
    adapter.show({ x: 1, y: 1, w: 0, h: 0 }, { word: 'b', preview: 'p' });
    expect(host.querySelectorAll('hover-recall-popup')).toHaveLength(1);
  });

  it('hide() does not remove the element (persistent singleton, unlike ChromeFloatingTrigger)', () => {
    const adapter = new ChromeHoverRecallPopup(host);
    adapter.show({ x: 0, y: 0, w: 0, h: 0 }, { word: 'a', preview: 'p' });
    adapter.hide();
    expect(host.querySelectorAll('hover-recall-popup')).toHaveLength(1);
  });

  it('theme setter stamps data-ad-theme on the element', () => {
    const adapter = new ChromeHoverRecallPopup(host);
    adapter.theme = 'dark';
    expect(adapter.element.getAttribute('data-ad-theme')).toBe('dark');
  });
});
```

Run: `cd packages/extension-chrome && bunx vitest run src/adapters/chrome-hover-recall-popup.test.ts`
Expected: failure — the module does not exist yet.

**Step 2 — implement.** Create
`packages/extension-chrome/src/adapters/chrome-hover-recall-popup.ts`:

```ts
import { type AnchorRect, type Theme, type HoverRecallValue } from '@ai-dict/app';

// Same 'HoverRecallPopup' custom element the app registers via registerContentElements(); this
// file only needs its instance methods, typed structurally so it needs no class import.
interface HoverRecallPopupEl extends HTMLElement {
  show(anchor: AnchorRect, value: HoverRecallValue): void;
  hide(): void;
}

/** Chrome-shell adapter owning the singleton <hover-recall-popup> element's lifecycle — mirrors
 * chrome-floating-trigger.ts's shape. Unlike that trigger, the element is created ONCE (not
 * lazily) since there is no outside-press-listener lifecycle tied to it (design spec §2.7). */
export class ChromeHoverRecallPopup {
  readonly element: HoverRecallPopupEl;
  private _theme: Theme = 'sepia';

  constructor(host: HTMLElement = document.body) {
    this.element = document.createElement('hover-recall-popup') as HoverRecallPopupEl;
    this.element.setAttribute('data-ad-theme', this._theme);
    host.append(this.element);
  }

  set theme(t: Theme) {
    this._theme = t;
    this.element.setAttribute('data-ad-theme', t);
  }
  get theme(): Theme {
    return this._theme;
  }

  show(anchor: AnchorRect, value: HoverRecallValue): void {
    this.element.show(anchor, value);
  }

  hide(): void {
    this.element.hide();
  }
}
```

Run: `cd packages/extension-chrome && bunx vitest run src/adapters/chrome-hover-recall-popup.test.ts`
Expected: all tests pass.

**Step 3 — gate + commit:**

```
cd packages/app && bun run typecheck && cd ../extension-chrome && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

```
git add packages/extension-chrome/src/adapters/chrome-hover-recall-popup.ts packages/extension-chrome/src/adapters/chrome-hover-recall-popup.test.ts
git commit -m "feat: hover-recall — ChromeHoverRecallPopup singleton adapter (B4)" \
  -m $'Tribe-Card: b4-hover-recall\nTribe-Task: 4/6'
```

---

### Task 5: `content.ts` wiring

**Files:** modify `packages/extension-chrome/src/content.ts` (composition root — e2e-covered
only, same precedent as B3 Task 5/C2 Task 2; typecheck gate only here, no dedicated unit test for
this file).

- Add to the existing `@ai-dict/app` import list:
  `HoverRecallController, buildHighlightMatcher, findWordMatches, createSaveReplyGuard` (the last
  is likely already imported for the save/status listeners — do not duplicate the specifier if
  so) `type SavedWordEntry, type WireReply` (the latter likely already imported).
- Add a new import: `import { ChromeHoverRecallPopup } from './adapters/chrome-hover-recall-popup';`
- After B3's `const highlighter = new PageHighlighter(document);` line, add:

```ts
const hoverPopup = new ChromeHoverRecallPopup();
let hoverMatcher = new Map<string, string>();
const hoverGuard = createSaveReplyGuard();
const hoverController = new HoverRecallController(document);
```

- Locate B3's `refreshHighlights()` helper and add one line so `hoverMatcher` always reflects the
  same word list the highlighter itself was just refreshed with (no second wire round trip):

```ts
async function refreshHighlights(): Promise<void> {
  const raw: unknown = await chrome.runtime.sendMessage({ type: 'saved.learningWords' });
  const reply = raw as WireReply | undefined;
  if (reply?.ok && reply.type === 'savedWords') {
    highlighter.refresh(reply.words);
    hoverMatcher = buildHighlightMatcher(reply.words); // B4: same list, no extra fetch
  }
}
```

(If B3's actual implementation differs in shape from this sketch, add the `hoverMatcher` line
inside whatever function body ends up holding the `words`/`reply.words` array — the only
requirement is "built from the exact same list `highlighter.refresh`/`.apply` just received.")

- Start the hover controller once, after `themedSettings.get()`'s existing seed call (reuse the
  theme it already resolves for the popup, mirroring `trigger.theme`/`inline.theme`):

```ts
hoverController.start(
  () => highlighter.ranges,
  (m) => {
    const text = m.range.toString();
    const headword = findWordMatches(text, hoverMatcher)[0]?.headword;
    if (!headword) return;
    const rect = m.range.getBoundingClientRect();
    const token = hoverGuard.next();
    void chrome.runtime
      .sendMessage({ type: 'saved.get', word: headword })
      .then((raw: unknown) => {
        if (!hoverGuard.isCurrent(token)) return; // a later hover already superseded this reply
        const reply = raw as WireReply | undefined;
        if (!reply?.ok || reply.type !== 'savedEntry' || !reply.entry) return;
        const entry = reply.entry as SavedWordEntry;
        const primary = entry.senses[0];
        if (!primary) return;
        const preview =
          primary.translation.trim() ||
          (primary.definition.length > 140
            ? `${primary.definition.slice(0, 140)}…`
            : primary.definition);
        hoverPopup.show(
          { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
          { word: entry.word, preview },
        );
      })
      .catch(() => undefined);
  },
  () => hoverPopup.hide(),
  hoverPopup.element,
);
```

- New document listener, alongside the existing `toggle-save`/`toggle-status`/`open-side-panel`
  listeners — resolves the entry AGAIN (a second, cheap `saved.get`, keeping this listener
  independent of the hover-match closure's `entry` — simplest correct option; avoids threading a
  "last shown entry" variable through two independent code paths for a click that only fires after
  a deliberate hover+click, not a hot path):

```ts
document.addEventListener('view-full-entry', (e) => {
  const { word } = (e as CustomEvent<{ word: string }>).detail;
  void chrome.runtime
    .sendMessage({ type: 'saved.get', word })
    .then((raw: unknown) => {
      const reply = raw as WireReply | undefined;
      if (!reply?.ok || reply.type !== 'savedEntry' || !reply.entry) return;
      const entry = reply.entry as SavedWordEntry;
      const primary = entry.senses[0];
      if (!primary) return;
      // B4: reuse the EXISTING open-side-panel pipeline verbatim (design spec §2.5) — lastFocus
      // is the same module-scoped variable the live-lookup renderer callbacks already write.
      lastFocus = {
        state: 'result',
        payload: {
          markdown: primary.definition,
          word: entry.word,
          target: '', // unused by rendering — see design spec §2.5
          model: 'saved',
          fromCache: true,
          fetchedAt: entry.savedAt,
          ...(primary.translation ? { translation: primary.translation } : {}),
        },
        sentence: primary.sentence,
        url: primary.url,
        title: primary.title,
      };
      document.dispatchEvent(new CustomEvent('open-side-panel'));
    })
    .catch(() => undefined);
});
```

- Update `themedSettings.get()`'s existing `.then` (or wherever B3 stamps `trigger.theme`/
  `inline.theme`) to also stamp `hoverPopup.theme = s.theme;` — one extra line, same pattern as
  the existing two.

Run:

```
cd packages/extension-chrome && bun run typecheck
```

Expected: clean (no type errors). No dedicated unit test for `content.ts` — Task 6's e2e spec is
this task's correctness proof (same precedent as B3 Task 5 / C2 Task 2).

**Step 2 — Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd ../extension-chrome && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

```
git add packages/extension-chrome/src/content.ts
git commit -m "feat: hover-recall — content.ts hover controller + popup + view-full-entry wiring (B4)" \
  -m $'Tribe-Card: b4-hover-recall\nTribe-Task: 5/6'
```

---

### Task 6: e2e functional spec

**Files:** create `packages/extension-chrome/e2e/b4-hover-recall.spec.ts`; modify
`packages/extension-chrome/e2e/helpers.ts` (+ `hoverWord` helper).

**Step 1 — add the `hoverWord` e2e helper.** In `packages/extension-chrome/e2e/helpers.ts`, add
alongside `selectWord` (mirrors its exact Range→viewport-rect technique, but drives
`page.mouse.move` instead of a selection):

```ts
/** Move the real mouse to the center of `word`'s first occurrence inside `#${id}`, then nudge it
 * by 1px so a throttled/rAF-gated first tick is never lost. Two calls (not one) so the
 * controller's mousemove handler always sees at least one event after settling on the target
 * coordinates — matches how a real hover gesture arrives as a short burst, not a single point. */
export async function hoverWord(page: Page, id: string, word: string): Promise<void> {
  const point = await page.evaluate(
    ({ id, word }) => {
      const p = document.getElementById(id)!;
      const textNode = p.firstChild!;
      const text = textNode.textContent ?? '';
      const start = text.indexOf(word);
      const range = document.createRange();
      range.setStart(textNode, start);
      range.setEnd(textNode, start + word.length);
      const r = range.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    },
    { id, word },
  );
  await page.mouse.move(point.x, point.y);
  await page.mouse.move(point.x + 1, point.y);
}
```

**Step 2 — write the e2e spec.** Create `packages/extension-chrome/e2e/b4-hover-recall.spec.ts`:

```ts
import { test, expect } from './fixtures';
import { seedSettings, gotoFixture, hoverWord, mockGemini } from './helpers';
import type { BrowserContext, Page } from '@playwright/test';

/** Seed one saved:<word> entry directly via the service worker, matching the E1 schema exactly
 * (mirrors saved-word.spec.ts's swStorageDump-adjacent seeding style and B3's own e2e seeding
 * pattern). */
async function seedSaved(
  page: Page,
  word: string,
  status: 'learning' | 'known',
  sense: { definition: string; translation: string; sentence: string; url: string; title: string },
): Promise<void> {
  await page.evaluate(
    ({ word, status, sense }) => {
      const key = word.toLowerCase();
      const entry = { word, status, savedAt: 1_700_000_000_000, senses: [sense] };
      return chrome.storage.local.set({
        [`saved:${key}`]: JSON.stringify(entry),
        'saved:index': JSON.stringify([key]),
      });
    },
    { word, status, sense },
  );
}

const BANK_SENSE = {
  definition: 'A financial institution that accepts deposits.',
  translation: 'ngân hàng',
  sentence: 'The bank by the river is steep.',
  url: 'http://test.fixture/',
  title: 'Test fixture',
};

test.describe('B4 hover-recall', () => {
  test('hovering a saved learning-status highlighted word shows the popup with its saved meaning, then hides on leave', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);
    await seedSaved(page, 'bank', 'learning', BANK_SENSE);
    await gotoFixture(page, 'The bank by the river is steep.');
    await page.waitForFunction(
      () => (globalThis as { CSS: typeof CSS }).CSS.highlights?.has('ad-saved-word') === true,
      {
        timeout: 10_000,
      },
    );

    await hoverWord(page, 't', 'bank');
    await expect(page.locator('hover-recall-popup')).toBeVisible({ timeout: 2_000 });
    await expect(page.locator('hover-recall-popup')).toContainText('ngân hàng');

    await page.mouse.move(5, 5); // far away from the highlighted word
    await expect(page.locator('hover-recall-popup')).toBeHidden({ timeout: 2_000 });
  });

  test('"View full entry" makes zero network calls and the side panel recovers the saved definition', async ({
    context,
    extensionId,
  }) => {
    const calls = await mockGemini(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);
    await seedSaved(page, 'bank', 'learning', BANK_SENSE);
    await gotoFixture(page, 'The bank by the river is steep.');
    await page.waitForFunction(
      () => (globalThis as { CSS: typeof CSS }).CSS.highlights?.has('ad-saved-word') === true,
      {
        timeout: 10_000,
      },
    );

    await hoverWord(page, 't', 'bank');
    await expect(page.locator('hover-recall-popup')).toBeVisible({ timeout: 2_000 });
    await page
      .locator('hover-recall-popup')
      .getByRole('button', { name: 'View full entry' })
      .click();

    expect(calls.count).toBe(0); // B4's zero-tokens/zero-network fence, made concrete

    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/side-panel.html`);
    await panel.waitForSelector('side-panel-view');
    await expect(panel.locator('side-panel-view')).toContainText('financial institution', {
      timeout: 5_000,
    });
    await expect(panel.locator('side-panel-view')).toContainText('bank', { timeout: 5_000 });
  });

  test('a known-status saved word is never highlighted, so hovering it never shows the popup', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);
    await seedSaved(page, 'bank', 'known', BANK_SENSE);
    await gotoFixture(page, 'The bank by the river is steep.');
    await page.waitForTimeout(1_000); // let the (empty-for-known-words) scan settle

    await hoverWord(page, 't', 'bank');
    await page.waitForTimeout(500); // past HOVER_DELAY_MS
    await expect(page.locator('hover-recall-popup')).toBeHidden();
  });

  test('with highlightSavedWords off, hovering the (unpainted) word never shows the popup', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page, { highlightSavedWords: false } as Parameters<typeof seedSettings>[1]);
    await seedSaved(page, 'bank', 'learning', BANK_SENSE);
    await gotoFixture(page, 'The bank by the river is steep.');
    await page.waitForTimeout(1_000);

    await hoverWord(page, 't', 'bank');
    await page.waitForTimeout(500);
    await expect(page.locator('hover-recall-popup')).toBeHidden();
  });
});
```

Note: `seedSettings`'s `SettingsOverrides` type (`helpers.ts:24-35`) will already carry
`highlightSavedWords?: boolean` once B3's own plan lands (B3 extends `PublicSettings`, and
`seedSettings` spreads its `overrides` onto the settings object regardless of whether the type
declares the key — B3 Task 6's own e2e note: "extend `seedSettings`' options param — check
`helpers.ts`; it merges a settings object, so pass the extra key"). The `as
Parameters<typeof seedSettings>[1]` cast above is a defensive fallback ONLY if B3's own type
update has not landed in `SettingsOverrides` by the time this task runs; delete the cast if the
field is already typed.

Run:

```
GEMINI_API_KEY= bun run build:chrome:e2e
cd packages/extension-chrome && bunx playwright test b4-hover-recall
```

Expected: 4 passed.

**Step 3 — Commit** — gate, then commit:

```
GEMINI_API_KEY= bun run build:chrome
bun run lint && bun run format:check
```

```
git add packages/extension-chrome/e2e/b4-hover-recall.spec.ts packages/extension-chrome/e2e/helpers.ts
git commit -m "feat: hover-recall — e2e coverage for hover/dismiss/view-full-entry/off-switch (B4)" \
  -m $'Tribe-Card: b4-hover-recall\nTribe-Task: 6/6'
```

---

## Final gate (after Task 6, before opening the PR)

```
cd packages/app && bun run typecheck
cd ../extension-chrome && bun run typecheck
cd ../..
bun run test
bun run lint
bun run format:check
GEMINI_API_KEY= bun run build:chrome
cd packages/extension-chrome && bunx playwright test saved-word b5-status-lifecycle b3-highlight b4-hover-recall side-panel-open
```

(`saved-word`/`b5-status-lifecycle`/`b3-highlight` are regression guards — B4 reads what B1/B5/B3
write; `side-panel-open` is the regression guard for the `open-side-panel`/`lastFocus` pipeline
this card reuses verbatim.)

Expected: typecheck clean on both packages; the full Vitest suite green (including every new test
file from Tasks 1-4); lint/format clean; the Chrome build succeeds with the env key cleared; all
five e2e suites above pass.

## PR

Title: `[HoverRecall] feat: hover-recall — local popup for saved words, zero tokens (B4)`.
Body: 1-3 sentences; design bullets (≤3): caret hit-testing over B3's `PageHighlighter.ranges`
(zero DOM-visible highlight elements to query, per the Custom Highlight API); range→headword
resolved by reusing B3's own `buildHighlightMatcher`/`findWordMatches` from `content.ts`, zero
changes to B3's files; "View full entry" reuses the existing `open-side-panel`/`lastFocus`
pipeline verbatim, zero wire/router change beyond the new `saved.get` read.
Evidence policy (owner ruling 2026-07-16): NO media capture — the PR body carries a
**"Testing performed"** section instead: unit suites + counts, the e2e scenarios exercised (hover
shows the popup with the saved meaning / leave hides it / View full entry makes zero network calls
and the side panel recovers the definition / known-status words never highlighted so never
hovered / `highlightSavedWords: false` never shows the popup), and the gates that passed. ALL CI
checks green → `gh pr merge --merge --delete-branch` (regular merge; squash prohibited). Verify
merge commit has 2 parents; master CI green; remove worktree.
