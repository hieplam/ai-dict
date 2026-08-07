# B11 Casual Review Flip Implementation Plan

> **For agentic workers:** implement task-by-task, TDD (red → green → commit) per task. Steps use
> checkbox (`- [ ]`) syntax for tracking. Dispatch each implementation/fix task to the `hunter`
> subagent.

**Goal:** the side panel gains an always-visible "Review" entry point that builds a fresh, shuffled
deck of learning-status words saved within the last 14 days, shows each one's original sentence,
reveals the saved meaning on tap, and lets the reader optionally mark it known (reusing B5's
existing `saved.setStatus` path) or move on — with permanently no scheduling, due dates, or streaks.

**Architecture:** a new pure domain function (`buildReviewDeck`, `c3-1`) filters/shuffles the
already-implemented `savedWordsList` result; a new, fully independent top-level UI element
(`<review-flip-view>`) renders the flip mechanic; the Chrome composition root
(`packages/extension-chrome/src/side-panel.ts`) fetches the deck on demand and swaps the panel's
single top-level child between `<side-panel-view>` and `<review-flip-view>` — the exact same
`replaceChildren` swap pattern `options.ts` already uses for onboarding/settings. Full design
rationale, including why a new top-level element (not a `SidePanelView` mode flag) is required and
how the `saved.list` wire message is shared with the concurrently-authored B10 card:
`docs/superpowers/specs/2026-07-17-b11-casual-review-flip-design.md`.

**Tech Stack:** TypeScript, Vitest + happy-dom (unit), Playwright (e2e).

## Global Constraints

- Implementer: dispatch each implementation/fix task to the `hunter` subagent — never a generic
  implementer.
- Start in a fresh git worktree under `.claude/worktrees/` on branch `feature/B11CasualReviewFlip`.
- **Task 2 (wire + router) starts with a repo-state check, not an assumption.** `saved.list` is
  independently needed by the concurrently-authored B10 (weekly digest) card with the identical
  shape (design spec §2.1/§9). If `saved.list` already exists in `packages/app/src/wire.ts` when
  this task runs (because B10 landed first), **do not** re-add the schema/router case — Task 2's
  Step 1 spells out exactly what to do in that branch. This is a resolved fork, not an open
  question — follow the branch that matches what `grep` actually finds.
- **Permanently no scheduling algorithm, no due dates, no streaks** (roadmap B11's own stated
  anti-goal, "so no future contributor 'improves' it into Anki"). `buildReviewDeck` must never read
  or write any "already reviewed"/"due" marker — if a task in this plan seems to need one, stop; the
  fence has been misread, not found to need an exception.
- **Zero LLM/API calls anywhere in this card.** Every operation is a local KV read (`saved.list`) or
  write (`saved.setStatus`, reused from B5) triggered by an explicit click.
- S1: `saved.list`'s reply carries `SavedWordEntry[]` — the ratified E1 shape, which never carries a
  key field. Nothing in this card touches `Settings`/`apiKey`.
- S4: `senses[0].definition` is stored model output. It MUST be re-sanitized via `sanitizeMarkdown`
  at render time in the composition root (`side-panel.ts`), exactly like the existing
  `resultToFocus` does for a live lookup — `<review-flip-view>` itself never sanitizes, it only ever
  receives already-`SafeHtml`-branded strings.
- UI additions read only `--ad-*`/`--adp-*` design tokens — no hard-coded colors, no new entries in
  the pinned §5.10 icon set (the "Review" entry point is a plain text button, design spec §2.6).
- `bun run lint` and `bun run format:check` clean before every commit.
- Every task must leave `cd packages/app && bun run typecheck` (and, from Task 2 on,
  `cd packages/extension-chrome && bun run typecheck`) green.
- Commit subject convention for every task in this plan:
  `[B11CasualReviewFlip] feat: <imperative summary> (B11)`.

---

### Task 1: `review-deck-policy.ts` — the pure deck-building domain function

**Files:**

- Create: `packages/app/src/domain/review-deck-policy.ts`
- Create: `packages/app/test/review-deck-policy.test.ts`
- Modify: `packages/app/src/index.ts`

**Interfaces:**

```ts
export const REVIEW_WINDOW_DAYS: number;
export interface BuildReviewDeckOptions {
  nowMs: number;
  shuffle?: (entries: SavedWordEntry[]) => SavedWordEntry[];
}
export function buildReviewDeck(
  entries: SavedWordEntry[],
  opts: BuildReviewDeckOptions,
): SavedWordEntry[];
```

- [ ] **Step 1: Write the failing tests.** Create `packages/app/test/review-deck-policy.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildReviewDeck, REVIEW_WINDOW_DAYS } from '../src/domain/review-deck-policy';
import type { SavedWordEntry } from '../src';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = 1_700_000_000_000;

function entry(over: Partial<SavedWordEntry> & { word: string }): SavedWordEntry {
  return {
    word: over.word,
    status: over.status ?? 'learning',
    savedAt: over.savedAt ?? NOW,
    senses: over.senses ?? [
      {
        definition: `${over.word} definition`,
        translation: '',
        sentence: `A sentence with ${over.word} in it.`,
        url: 'https://example.com',
        title: 'Example',
      },
    ],
  };
}

describe('buildReviewDeck', () => {
  it('includes a learning word saved exactly REVIEW_WINDOW_DAYS ago (inclusive boundary)', () => {
    const e = entry({ word: 'bank', savedAt: NOW - REVIEW_WINDOW_DAYS * DAY_MS });
    const deck = buildReviewDeck([e], { nowMs: NOW, shuffle: (a) => a });
    expect(deck).toEqual([e]);
  });

  it('excludes a learning word saved 1ms past the window', () => {
    const e = entry({ word: 'bank', savedAt: NOW - REVIEW_WINDOW_DAYS * DAY_MS - 1 });
    const deck = buildReviewDeck([e], { nowMs: NOW, shuffle: (a) => a });
    expect(deck).toEqual([]);
  });

  it('excludes a known-status word even if saved today', () => {
    const e = entry({ word: 'bank', status: 'known', savedAt: NOW });
    const deck = buildReviewDeck([e], { nowMs: NOW, shuffle: (a) => a });
    expect(deck).toEqual([]);
  });

  it('includes a learning word saved today', () => {
    const e = entry({ word: 'bank', status: 'learning', savedAt: NOW });
    const deck = buildReviewDeck([e], { nowMs: NOW, shuffle: (a) => a });
    expect(deck).toEqual([e]);
  });

  it('uses the injected shuffle function verbatim (deterministic in tests)', () => {
    const a = entry({ word: 'a', savedAt: NOW });
    const b = entry({ word: 'b', savedAt: NOW });
    const deck = buildReviewDeck([a, b], { nowMs: NOW, shuffle: (arr) => [...arr].reverse() });
    expect(deck).toEqual([b, a]);
  });

  it('defaults to a real shuffle when no override is given (still returns every eligible entry)', () => {
    const entries = ['a', 'b', 'c', 'd'].map((w) => entry({ word: w, savedAt: NOW }));
    const deck = buildReviewDeck(entries, { nowMs: NOW });
    expect(deck).toHaveLength(4);
    expect(new Set(deck.map((e) => e.word))).toEqual(new Set(['a', 'b', 'c', 'd']));
  });

  it('empty input → empty deck', () => {
    expect(buildReviewDeck([], { nowMs: NOW })).toEqual([]);
  });

  it('mixes eligible and ineligible entries correctly in one call', () => {
    const eligible = entry({ word: 'eligible', savedAt: NOW });
    const tooOld = entry({ word: 'too-old', savedAt: NOW - (REVIEW_WINDOW_DAYS + 1) * DAY_MS });
    const known = entry({ word: 'known', status: 'known', savedAt: NOW });
    const deck = buildReviewDeck([eligible, tooOld, known], { nowMs: NOW, shuffle: (a) => a });
    expect(deck).toEqual([eligible]);
  });
});
```

Run: `cd packages/app && bunx vitest run test/review-deck-policy.test.ts`
Expected: failures — cannot find module `../src/domain/review-deck-policy`.

- [ ] **Step 2: Implement.** Create `packages/app/src/domain/review-deck-policy.ts`:

```ts
import type { SavedWordEntry } from './types';

/** B11: only learning-status words saved within the last REVIEW_WINDOW_DAYS days enter the deck
 * — see the design spec §2.2 for why this reads `savedAt`, not a per-sense timestamp. */
export const REVIEW_WINDOW_DAYS = 14;
const REVIEW_WINDOW_MS = REVIEW_WINDOW_DAYS * 24 * 60 * 60 * 1000;

/** Fisher-Yates. Only ever reached via buildReviewDeck's default parameter (impure —
 * Math.random); tests always supply a deterministic override (design spec §2.3, the same DI
 * pattern SavedWordsDeps.now/RouterDeps.now already use). */
function defaultShuffle(entries: SavedWordEntry[]): SavedWordEntry[] {
  const out = entries.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

export interface BuildReviewDeckOptions {
  /** Wall clock; injectable so tests are deterministic (mirrors SavedWordsDeps.now/RouterDeps.now). */
  nowMs: number;
  /** Deterministic override for tests; defaults to defaultShuffle (real randomness) when omitted. */
  shuffle?: (entries: SavedWordEntry[]) => SavedWordEntry[];
}

/**
 * B11: the casual-review deck = learning-status words saved within the last REVIEW_WINDOW_DAYS
 * days, shuffled. Pure function — no I/O; the only non-determinism (Math.random) is confined to
 * the optional `shuffle` DI seam. PERMANENT fence (roadmap B11): no scheduling algorithm, no due
 * dates, no streaks — this function filters + shuffles, nothing else, every time it runs.
 */
export function buildReviewDeck(
  entries: SavedWordEntry[],
  opts: BuildReviewDeckOptions,
): SavedWordEntry[] {
  const cutoff = opts.nowMs - REVIEW_WINDOW_MS;
  const eligible = entries.filter(
    (e) => e.status === 'learning' && e.savedAt >= cutoff && e.savedAt <= opts.nowMs,
  );
  const shuffle = opts.shuffle ?? defaultShuffle;
  return shuffle(eligible);
}
```

In `packages/app/src/index.ts`, add one new barrel line next to the other domain re-exports (right
after `export * from './domain/saved-words-policy';`):

```ts
export * from './domain/review-deck-policy';
```

Run: `cd packages/app && bunx vitest run test/review-deck-policy.test.ts`
Expected: all 8 tests pass.

- [ ] **Step 3: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd .. && cd .. && bun run lint && bun run format:check
```

Commit:

```
git add packages/app/src/domain/review-deck-policy.ts packages/app/test/review-deck-policy.test.ts packages/app/src/index.ts
git commit -m "[B11CasualReviewFlip] feat: add buildReviewDeck domain policy (B11)"
```

---

### Task 2: `wire.ts` + `router.ts` — `saved.list` (repo-state-checked)

**Files:**

- Modify (conditionally): `packages/app/src/wire.ts`
- Modify (conditionally): `packages/app/src/app/router.ts`
- Modify: `packages/app/test/wire-schema.test.ts`
- Modify: `packages/app/test/app/router.test.ts`

- [ ] **Step 0: Check current repo state.**

```
grep -n "'saved.list'" packages/app/src/wire.ts
```

- **If this prints NO match** — `saved.list` does not exist yet. Follow Step 1 below in full
  (add the schema, add the router case), then Step 2 (tests).
- **If this prints a match** — a sibling card (B10) already landed `saved.list` first. Confirm its
  shape matches exactly (request is a bare `{ type: 'saved.list' }`; reply is
  `{ ok: true, type: 'saved.list', entries: SavedWordEntry[] }`) by reading the matched lines. If it
  matches: **skip Step 1 entirely** (do not touch `wire.ts`/`router.ts`) and go straight to Step 2,
  which still adds this card's own regression tests against the already-shipped arm. If the shape
  does NOT match what's quoted above: **stop and report back** — do not adapt or reshape either
  file; this plan's shared-message assumption (design spec §2.1/§9) has broken and needs
  re-grounding by the plan's author, not a silent workaround here.

- [ ] **Step 1: Write the failing tests, then implement (only if Step 0 found no match).**

Failing tests first — append to `packages/app/test/wire-schema.test.ts`, inside the file (a new
`describe` block at the end, after the existing `describe('saved.setStatus wire messages (B5)', ...)`
-equivalent block — place it right before the final closing of the file):

```ts
describe('saved.list wire message (B10/B11)', () => {
  it('accepts a bare saved.list request', () => {
    expect(WireMessageSchema.safeParse({ type: 'saved.list' }).success).toBe(true);
  });

  it('accepts a well-formed saved.list reply with zero entries', () => {
    const parsed = WireReplySchema.safeParse({
      ok: true,
      type: 'saved.list',
      entries: [],
    });
    expect(parsed.success).toBe(true);
  });

  it('accepts a well-formed saved.list reply with entries', () => {
    const parsed = WireReplySchema.safeParse({
      ok: true,
      type: 'saved.list',
      entries: [
        {
          word: 'bank',
          status: 'learning',
          savedAt: 1,
          senses: [
            {
              definition: 'a financial institution',
              translation: '',
              sentence: 'I went to the bank.',
              url: 'https://example.com',
              title: 'Example',
            },
          ],
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects a saved.list reply containing a malformed entry', () => {
    const parsed = WireReplySchema.safeParse({
      ok: true,
      type: 'saved.list',
      entries: [{ word: 'bank' }], // missing status/savedAt/senses
    });
    expect(parsed.success).toBe(false);
  });
});
```

Run: `cd packages/app && bunx vitest run test/wire-schema.test.ts`
Expected: the 4 new tests fail (`saved.list` is not a recognized message type).

Implement — in `packages/app/src/wire.ts`, add a new request arm to `WireMessageSchema`'s array,
placed next to the other `saved.*` arms (right after the `saved.setStatus` arm):

```ts
// B10/B11: list every currently saved word. First specified by whichever of the weekly-digest
// (B10) or casual-review-flip (B11) cards lands first. No payload.
z.object({ type: z.literal('saved.list') }),
```

Add `'saved.list'` to `MessageTypeEnum`'s array. Add a new reply arm to `WireReplySchema`'s union,
placed next to the other `ok: true` arms:

```ts
z.object({
  ok: z.literal(true),
  type: z.literal('saved.list'),
  entries: z.array(SavedWordEntrySchema),
}),
```

Run: `cd packages/app && bunx vitest run test/wire-schema.test.ts`
Expected: all tests pass (existing + 4 new). The JSON-schema snapshot test
(`wire-schema.test.ts`'s `toMatchFileSnapshot` case) will now fail because the exported schema
changed — regenerate it:

```
cd packages/app && bunx vitest run test/wire-schema.test.ts -u
```

Expected: the snapshot file updates and the suite passes clean.

Now the router side — failing test first. Append to `packages/app/test/app/router.test.ts`, inside
the existing `describe('buildRouter', ...)` block (place it right after the existing
`saved.setStatus`-related tests, before that describe block's closing `});`):

```ts
it('saved.list on an empty store replies with an empty array (B10/B11)', async () => {
  const d = deps();
  const route = buildRouter(d);
  const reply = await route({ type: 'saved.list' });
  expect(reply).toEqual({ ok: true, type: 'saved.list', entries: [] });
});

it('saved.list returns every saved word after two saves (B10/B11)', async () => {
  const d = deps();
  const route = buildRouter(d);
  await route({
    type: 'saved.save',
    word: 'bank',
    definition: 'a financial institution',
    translation: '',
    sentence: 'I went to the bank.',
    url: 'https://example.com',
    title: 'Example',
  });
  await route({
    type: 'saved.save',
    word: 'kite',
    definition: 'a light flying toy',
    translation: '',
    sentence: 'The kite soared.',
    url: 'https://example.com',
    title: 'Example',
  });
  const reply = await route({ type: 'saved.list' });
  expect(reply.ok).toBe(true);
  if (reply.ok && reply.type === 'saved.list') {
    expect(reply.entries.map((e) => e.word).sort()).toEqual(['bank', 'kite']);
  }
});
```

Run: `cd packages/app && bunx vitest run test/app/router.test.ts`
Expected: the 2 new tests fail (`'saved.list'` is not a handled case — a TypeScript compile error on
the exhaustive switch, since the schema arm now exists from the wire.ts change above but no case
handles it yet).

Implement — in `packages/app/src/app/router.ts`, add `savedWordsList` to the existing import from
`../index` (alongside `savedWordUpsert`, `savedWordDelete`, `savedWordSetStatus`). Add a new `case`
inside the exhaustive `switch (msg.type)`, next to the other `saved.*` cases:

```ts
case 'saved.list': {
  const entries = await savedWordsList({ storage: deps.kv });
  return { ok: true, type: 'saved.list', entries };
}
```

Run: `cd packages/app && bunx vitest run test/app/router.test.ts`
Expected: all tests pass (existing + 2 new).

- [ ] **Step 2: Write regression-only tests (only if Step 0 found a match — `saved.list` already
      shipped by a sibling card).** Append the exact same 4 tests from Step 1 above to
      `packages/app/test/wire-schema.test.ts` and the exact same 2 tests from Step 1 above to
      `packages/app/test/app/router.test.ts` — **do not** modify `wire.ts` or `router.ts` in this
      branch; they already have the arm. Run:

```
cd packages/app && bunx vitest run test/wire-schema.test.ts test/app/router.test.ts
```

Expected: all tests pass immediately (nothing to implement in this branch — the tests simply prove
this card's own dependency on the already-shipped message is correct).

- [ ] **Step 3: Commit** — gate, then commit. If Step 1 ran (this card added the arm):

```
cd packages/app && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

```
git add packages/app/src/wire.ts packages/app/src/app/router.ts packages/app/test/wire-schema.test.ts packages/app/test/app/router.test.ts packages/app/test/__snapshots__ 2>/dev/null; git add -u
git commit -m "[B11CasualReviewFlip] feat: add saved.list wire message + router case (B11)"
```

If Step 2 ran (the arm already existed):

```
cd packages/app && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

```
git add packages/app/test/wire-schema.test.ts packages/app/test/app/router.test.ts
git commit -m "[B11CasualReviewFlip] test: regression-cover the already-shipped saved.list message (B11)"
```

---

### Task 3: `<review-flip-view>` — the flip-card UI component

**Files:**

- Create: `packages/app/src/ui/review-flip-view.ts`
- Create: `packages/app/test/ui/review-flip-view.test.ts`
- Modify: `packages/app/src/ui/register.ts`
- Modify: `packages/app/src/ui/index.ts`

**Interfaces:**

```ts
export interface ReviewCard {
  word: string;
  sentence: string;
  safeHtml: SafeHtml;
  translation: string;
}
export class ReviewFlipView extends HTMLElement {
  set deck(cards: ReviewCard[]);
  get deck(): ReviewCard[];
}
export function registerReviewFlip(): void; // register.ts
```

- [ ] **Step 1: Write the failing tests.** Create `packages/app/test/ui/review-flip-view.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { axeViolations } from './a11y';
import { ReviewFlipView, type ReviewCard } from '../../src/ui/review-flip-view';
import { registerReviewFlip } from '../../src/ui/register';
import type { SafeHtml } from '../../src/ui/lookup-card';

beforeAll(() => {
  registerReviewFlip();
});

const safe = (html: string) => html as SafeHtml;

function mount(): ReviewFlipView {
  const el = document.createElement('review-flip-view') as ReviewFlipView;
  document.body.append(el);
  return el;
}

function card(word: string): ReviewCard {
  return {
    word,
    sentence: `A sentence with ${word} in it.`,
    safeHtml: safe(`<p>Meaning of ${word}.</p>`),
    translation: `${word} (translated)`,
  };
}

describe('<review-flip-view>', () => {
  it('shows the empty state when the deck is empty', () => {
    const el = mount();
    el.deck = [];
    expect(el.shadowRoot!.textContent).toContain('Nothing to review yet');
  });

  it('shows the first card front (word + sentence) with no meaning/translation visible', () => {
    const el = mount();
    el.deck = [card('bank')];
    const r = el.shadowRoot!;
    expect(r.textContent).toContain('Card 1 of 1');
    expect(r.querySelector('h2')!.textContent).toBe('bank');
    expect(r.textContent).toContain('A sentence with bank in it.');
    expect(r.textContent).not.toContain('Meaning of bank');
    expect(r.querySelector('.meaning')).toBeNull();
  });

  it('reveal shows the sanitized meaning + translation and swaps in Mark known / Next', () => {
    const el = mount();
    el.deck = [card('bank')];
    const r = el.shadowRoot!;
    r.querySelector<HTMLButtonElement>('.primary')!.click(); // "Reveal meaning"
    expect(r.querySelector('.meaning')!.innerHTML).toContain('Meaning of bank.');
    expect(r.textContent).toContain('bank (translated)');
    expect(r.querySelector('[aria-label="Mark bank as known"]')).not.toBeNull();
    expect(r.querySelector('[aria-label="Next card"]')).not.toBeNull();
  });

  it('omits the translation line when translation is empty', () => {
    const el = mount();
    el.deck = [{ ...card('bank'), translation: '' }];
    const r = el.shadowRoot!;
    r.querySelector<HTMLButtonElement>('.primary')!.click();
    expect(r.querySelector('.translation')).toBeNull();
  });

  it('clicking Mark known fires a composed mark-known event and advances', () => {
    const el = mount();
    el.deck = [card('bank')];
    let captured: { word: string } | undefined;
    document.body.addEventListener('mark-known', (e) => {
      captured = (e as CustomEvent<{ word: string }>).detail;
    });
    const r = el.shadowRoot!;
    r.querySelector<HTMLButtonElement>('.primary')!.click(); // reveal
    r.querySelector<HTMLButtonElement>('[aria-label="Mark bank as known"]')!.click();
    expect(captured).toEqual({ word: 'bank' });
    expect(r.textContent).toContain('Nice work');
    expect(r.textContent).toContain('You reviewed 1 word.');
  });

  it('clicking Next advances without emitting mark-known', () => {
    const el = mount();
    el.deck = [card('a'), card('b')];
    let fired = false;
    document.body.addEventListener('mark-known', () => (fired = true));
    const r = el.shadowRoot!;
    r.querySelector<HTMLButtonElement>('.primary')!.click(); // reveal card 1
    r.querySelector<HTMLButtonElement>('[aria-label="Next card"]')!.click();
    expect(fired).toBe(false);
    expect(r.textContent).toContain('Card 2 of 2');
    expect(r.querySelector('h2')!.textContent).toBe('b');
  });

  it('reaching the end of the deck shows the done state with the plural count', () => {
    const el = mount();
    el.deck = [card('a'), card('b')];
    const r = el.shadowRoot!;
    for (let i = 0; i < 2; i++) {
      r.querySelector<HTMLButtonElement>('.primary')!.click(); // reveal
      r.querySelector<HTMLButtonElement>('[aria-label="Next card"]')!.click();
    }
    expect(r.textContent).toContain('You reviewed 2 words.');
  });

  it('the header close button dispatches a composed close event from every state', () => {
    const emptyEl = mount();
    emptyEl.deck = [];
    let emptyClosed = false;
    document.body.addEventListener('close', () => (emptyClosed = true));
    emptyEl.shadowRoot!.querySelector<HTMLButtonElement>('.close')!.click();
    expect(emptyClosed).toBe(true);

    const cardEl = mount();
    cardEl.deck = [card('bank')];
    let cardClosed = false;
    document.body.addEventListener('close', () => (cardClosed = true));
    cardEl.shadowRoot!.querySelector<HTMLButtonElement>('.close')!.click();
    expect(cardClosed).toBe(true);
  });

  it('setting a new deck always restarts at card 1, unrevealed, even mid-session', () => {
    const el = mount();
    el.deck = [card('a'), card('b')];
    el.shadowRoot!.querySelector<HTMLButtonElement>('.primary')!.click(); // reveal card 1
    el.deck = [card('c')];
    const r = el.shadowRoot!;
    expect(r.textContent).toContain('Card 1 of 1');
    expect(r.querySelector('h2')!.textContent).toBe('c');
    expect(r.querySelector('.meaning')).toBeNull();
  });

  it('has no axe violations on the front-of-card state', async () => {
    const el = mount();
    el.deck = [card('bank')];
    expect(await axeViolations(el)).toEqual([]);
  });

  it('has no axe violations on the empty state', async () => {
    const el = mount();
    el.deck = [];
    expect(await axeViolations(el)).toEqual([]);
  });
});
```

Run: `cd packages/app && bunx vitest run test/ui/review-flip-view.test.ts`
Expected: failures — cannot find module `../../src/ui/review-flip-view`.

- [ ] **Step 2: Implement.** Create `packages/app/src/ui/review-flip-view.ts`:

```ts
import { adoptStyles } from './styles/adopt';
import { BASE_VARS, THEME_CSS, BRAND_MARK_SVG, ICON_CLOSE } from './styles/tokens';
import type { SafeHtml } from './lookup-card';

/**
 * B11: one card's worth of pre-fetched, pre-sanitized review content. The composition root
 * (side-panel.ts) builds this array once per review session — `safeHtml` MUST already be the
 * output of sanitizeMarkdown (S4); this component never sanitizes, mirroring how CardState.
 * safeHtml arrives pre-sanitized from side-panel.ts's resultToFocus.
 */
export interface ReviewCard {
  word: string;
  sentence: string;
  safeHtml: SafeHtml;
  translation: string;
}

const CSS = `:host{${BASE_VARS};display:flex;flex-direction:column;height:100dvh;box-sizing:border-box;font:var(--adp-text-body)/var(--adp-leading-body) var(--adp-font-sans);color:var(--ad-ink);background:var(--ad-glow),var(--ad-surface);color-scheme:light}
${THEME_CSS}
*{box-sizing:border-box}
::selection{background:var(--ad-selection)}
.accent{height:3px;flex:none;background:linear-gradient(90deg,var(--ad-accent),var(--ad-warm) 92%)}
header{display:flex;align-items:center;gap:8px;padding:13px 18px 11px;flex:none}
.brand{display:inline-flex;align-items:center;gap:8px;font-size:var(--adp-text-sm);font-weight:var(--adp-weight-bold);letter-spacing:var(--adp-tracking-label);color:var(--ad-accent-ink)}
.mark{width:22px;height:22px;flex:none}
.close{display:inline-grid;place-items:center;width:var(--adp-action-size);height:var(--adp-action-size);margin-left:auto;border:0;background:transparent;color:var(--ad-ink-faint);border-radius:var(--adp-radius-control);cursor:pointer;font:inherit;transition:background var(--adp-dur-fast) var(--adp-ease),color var(--adp-dur-fast) var(--adp-ease)}
.close:hover{background:var(--ad-surface-raised);color:var(--ad-ink)}
.close:focus-visible{outline:2px solid var(--ad-accent);outline-offset:2px}
.close svg{width:14px;height:14px;pointer-events:none}
main{flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:0 18px;display:flex;flex-direction:column}
.progress{margin:2px 0 14px;flex:none;font-size:var(--adp-text-2xs);font-weight:var(--adp-weight-bold);letter-spacing:.06em;text-transform:uppercase;color:var(--ad-ink-soft)}
.card{flex:1 1 auto;display:flex;flex-direction:column;justify-content:center;gap:14px;padding-bottom:24px}
.card h2{font-family:var(--adp-font-serif);font-size:1.7rem;line-height:var(--adp-leading-tight);letter-spacing:var(--adp-tracking-head);margin:0;color:var(--ad-ink)}
.sentence{margin:0;font-size:15px;line-height:1.6;color:var(--ad-ink-soft)}
.meaning{margin:0;font-size:15px;line-height:1.6;color:var(--ad-ink)}
.meaning p{margin:.5em 0}
.translation{margin:0;font-size:14px;line-height:1.5;color:var(--ad-ink-soft);font-style:italic}
.actions{display:flex;gap:8px;margin-top:4px;flex:none}
button.primary{font:inherit;font-weight:var(--adp-weight-semi);font-size:14px;flex:1 1 auto;padding:11px 16px;border-radius:11px;cursor:pointer;border:1px solid transparent;background:var(--ad-accent);color:var(--ad-on-accent)}
button.primary:hover{filter:brightness(1.06)}
button.primary:focus-visible{outline:2px solid var(--ad-accent);outline-offset:2px}
button.secondary{font:inherit;font-weight:var(--adp-weight-semi);font-size:14px;flex:1 1 auto;padding:11px 16px;border-radius:11px;cursor:pointer;border:1px solid var(--ad-line-strong);background:var(--ad-surface);color:var(--ad-ink)}
button.secondary:hover{background:var(--ad-surface-raised)}
button.secondary:focus-visible{outline:2px solid var(--ad-accent);outline-offset:2px}
.empty,.done{flex:1 1 auto;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:10px;padding:40px 12px}
.empty .mark,.done .mark{width:34px;height:34px;opacity:.9}
.empty-title,.done-title{margin:0;font-size:var(--adp-text-lg);font-weight:var(--adp-weight-semi);color:var(--ad-ink)}
.empty-hint,.done-hint{margin:0;max-width:30ch;font-size:var(--adp-text-sm);line-height:1.55;color:var(--ad-ink-soft)}
.empty .secondary,.done .secondary{margin-top:8px;flex:none;padding:10px 20px}
@media (prefers-reduced-motion:reduce){.close{transition:none}}
[hidden]{display:none}`;

export class ReviewFlipView extends HTMLElement {
  private root!: ShadowRoot;
  private mainEl!: HTMLElement;
  private _deck: ReviewCard[] = [];
  private _index = 0;
  private _revealed = false;

  connectedCallback(): void {
    if (this.shadowRoot) {
      this.render();
      return;
    }
    this.root = this.attachShadow({ mode: 'open' });
    adoptStyles(this.root, CSS);

    const accent = document.createElement('div');
    accent.className = 'accent';
    accent.setAttribute('aria-hidden', 'true');

    const header = document.createElement('header');
    const brand = document.createElement('span');
    brand.className = 'brand';
    brand.innerHTML = `${BRAND_MARK_SVG}<span>Review</span>`;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'close';
    close.setAttribute('aria-label', 'Close review and return to the panel');
    close.innerHTML = ICON_CLOSE;
    close.addEventListener('click', () => this.emitClose());
    header.append(brand, close);

    this.mainEl = document.createElement('main');
    this.mainEl.setAttribute('aria-live', 'polite');
    this.mainEl.setAttribute('aria-label', 'Review');

    this.root.append(accent, header, this.mainEl);
    this.render();
  }

  /** The shuffled deck for this review session. Setting it always restarts at card 1,
   * unrevealed — there is no cross-session or mid-session resume position (roadmap B11's
   * permanent "no scheduling, no due dates" fence). */
  set deck(cards: ReviewCard[]) {
    this._deck = cards;
    this._index = 0;
    this._revealed = false;
    if (this.shadowRoot) this.render();
  }
  get deck(): ReviewCard[] {
    return this._deck;
  }

  private emitClose(): void {
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }));
  }

  private emitMarkKnown(word: string): void {
    this.dispatchEvent(
      new CustomEvent('mark-known', { detail: { word }, bubbles: true, composed: true }),
    );
  }

  private advance(): void {
    this._index += 1;
    this._revealed = false;
    this.render();
  }

  private render(): void {
    if (this._deck.length === 0) {
      this.mainEl.replaceChildren(this.renderEmpty());
      return;
    }
    if (this._index >= this._deck.length) {
      this.mainEl.replaceChildren(this.renderDone());
      return;
    }
    const progress = document.createElement('p');
    progress.className = 'progress';
    progress.textContent = `Card ${this._index + 1} of ${this._deck.length}`;
    this.mainEl.replaceChildren(progress, this.renderCard(this._deck[this._index]!));
  }

  private renderCard(card: ReviewCard): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'card';
    const h = document.createElement('h2');
    h.textContent = card.word;
    // Plain text — this is the reader's own captured page sentence (extractSentence), never LLM
    // output, so no sanitizeMarkdown call applies here (design spec §2.8).
    const sentence = document.createElement('p');
    sentence.className = 'sentence';
    sentence.textContent = card.sentence;
    wrap.append(h, sentence);

    const actions = document.createElement('div');
    actions.className = 'actions';

    if (!this._revealed) {
      const reveal = document.createElement('button');
      reveal.type = 'button';
      reveal.className = 'primary';
      reveal.textContent = 'Reveal meaning';
      reveal.addEventListener('click', () => {
        this._revealed = true;
        this.render();
      });
      actions.append(reveal);
      wrap.append(actions);
      return wrap;
    }

    const meaning = document.createElement('div');
    meaning.className = 'meaning';
    meaning.innerHTML = card.safeHtml; // trusted: pre-sanitized by side-panel.ts (S4)
    wrap.append(meaning);
    if (card.translation) {
      const t = document.createElement('p');
      t.className = 'translation';
      t.textContent = card.translation;
      wrap.append(t);
    }

    const markKnown = document.createElement('button');
    markKnown.type = 'button';
    markKnown.className = 'secondary';
    markKnown.textContent = 'Mark known';
    markKnown.setAttribute('aria-label', `Mark ${card.word} as known`);
    markKnown.addEventListener('click', () => {
      this.emitMarkKnown(card.word);
      this.advance();
    });
    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'primary';
    next.textContent = 'Next';
    next.setAttribute('aria-label', 'Next card');
    next.addEventListener('click', () => this.advance());
    actions.append(markKnown, next);
    wrap.append(actions);
    return wrap;
  }

  private renderEmpty(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'empty';
    wrap.innerHTML =
      BRAND_MARK_SVG +
      '<p class="empty-title">Nothing to review yet</p>' +
      '<p class="empty-hint">Words you save show up here for 14 days while you’re still learning them.</p>';
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'secondary';
    back.textContent = 'Back to panel';
    back.addEventListener('click', () => this.emitClose());
    wrap.append(back);
    return wrap;
  }

  private renderDone(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'done';
    const count = this._deck.length;
    wrap.innerHTML =
      BRAND_MARK_SVG +
      '<p class="done-title">Nice work</p>' +
      `<p class="done-hint">You reviewed ${count} word${count === 1 ? '' : 's'}.</p>`;
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'secondary';
    back.textContent = 'Back to panel';
    back.addEventListener('click', () => this.emitClose());
    wrap.append(back);
    return wrap;
  }
}
```

In `packages/app/src/ui/register.ts`, add the import and export:

```ts
import { ReviewFlipView } from './review-flip-view';
```

(alongside the existing element imports at the top), and:

```ts
export function registerReviewFlip(): void {
  if (!customElements.get('review-flip-view'))
    customElements.define('review-flip-view', ReviewFlipView);
}
```

(alongside the existing `registerSidePanel`/`registerSettingsForm`/`registerOnboarding` functions).

In `packages/app/src/ui/index.ts`, add one new barrel line:

```ts
export * from './review-flip-view';
```

Run: `cd packages/app && bunx vitest run test/ui/review-flip-view.test.ts`
Expected: all 11 tests pass.

- [ ] **Step 3: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

```
git add packages/app/src/ui/review-flip-view.ts packages/app/test/ui/review-flip-view.test.ts packages/app/src/ui/register.ts packages/app/src/ui/index.ts
git commit -m "[B11CasualReviewFlip] feat: add the review-flip-view custom element (B11)"
```

---

### Task 4: `side-panel-view.ts` — the "Review" entry point

**Files:**

- Modify: `packages/app/src/ui/side-panel-view.ts`
- Modify: `packages/app/test/ui/side-panel-view.test.ts`

- [ ] **Step 1: Write the failing tests.** Append to `packages/app/test/ui/side-panel-view.test.ts`,
      inside the existing `describe(...)` block, right after the existing header/settings-button
      test (search for the block covering `.settings` or add near the top-level header tests):

```ts
it('the header renders a Review entry point labelled for saved-word review', () => {
  const el = mount();
  const btn = el.shadowRoot!.querySelector<HTMLButtonElement>('.review-btn')!;
  expect(btn).not.toBeNull();
  expect(btn.getAttribute('aria-label')).toBe('Review your saved words');
  expect(btn.textContent).toBe('Review');
});

it('clicking the Review button dispatches a composed open-review event', () => {
  const el = mount();
  let fired = false;
  document.body.addEventListener('open-review', () => (fired = true));
  el.shadowRoot!.querySelector<HTMLButtonElement>('.review-btn')!.click();
  expect(fired).toBe(true);
});

it('has no axe violations with the Review button present (empty state)', async () => {
  const el = mount();
  expect(await axeViolations(el)).toEqual([]);
});
```

Run: `cd packages/app && bunx vitest run test/ui/side-panel-view.test.ts`
Expected: the 2 new functional tests fail (`.review-btn` does not exist); the third
(axe-violations) test passes trivially either way but is included as a permanent regression guard.

- [ ] **Step 2: Implement.** In `packages/app/src/ui/side-panel-view.ts`:

1. Add the new CSS rule immediately after the existing
   `.settings svg{width:15px;height:15px;pointer-events:none}` rule:

```css
.review-btn {
  display: inline-flex;
  align-items: center;
  margin-left: 8px;
  border: 0;
  background: transparent;
  color: var(--ad-ink-soft);
  font: inherit;
  font-size: var(--adp-text-xs);
  font-weight: var(--adp-weight-semi);
  padding: 5px 8px;
  border-radius: var(--adp-radius-control);
  cursor: pointer;
  transition:
    background var(--adp-dur-fast) var(--adp-ease),
    color var(--adp-dur-fast) var(--adp-ease);
}
.review-btn:hover {
  background: var(--ad-surface-raised);
  color: var(--ad-ink);
}
.review-btn:focus-visible {
  outline: 2px solid var(--ad-accent);
  outline-offset: 2px;
}
@media (prefers-reduced-motion: reduce) {
  .review-btn {
    transition: none;
  }
}
```

2. In `connectedCallback`, right before the existing `header.append(brand, settings);` line, add:

```ts
// B11: entry point into the casual-review deck. A plain text button, not part of the pinned
// §5.10 icon set — always visible, including with nothing to review, so the feature is
// discoverable even at zero saved words (design spec §2.6).
const review = document.createElement('button');
review.type = 'button';
review.className = 'review-btn';
review.textContent = 'Review';
review.setAttribute('aria-label', 'Review your saved words');
review.addEventListener('click', () =>
  this.dispatchEvent(new CustomEvent('open-review', { bubbles: true, composed: true })),
);
```

3. Change the existing line from:

```ts
header.append(brand, settings);
```

to:

```ts
header.append(brand, review, settings);
```

Run: `cd packages/app && bunx vitest run test/ui/side-panel-view.test.ts`
Expected: all tests pass (existing + 3 new).

- [ ] **Step 3: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

```
git add packages/app/src/ui/side-panel-view.ts packages/app/test/ui/side-panel-view.test.ts
git commit -m "[B11CasualReviewFlip] feat: add the Review entry point to the side panel header (B11)"
```

---

### Task 5: `side-panel.html` + `side-panel.ts` — wire the review flow together

**Files:**

- Modify: `packages/extension-chrome/src/side-panel.html`
- Modify: `packages/extension-chrome/src/side-panel.ts`

No dedicated unit test exists for `side-panel.ts` in this repo (it is a composition root, covered
by e2e only — same precedent as B5's `content.ts`/`side-panel.ts` edits, and C2's `options.ts`
edit). This task's correctness is proven by Task 6's e2e; still run the typecheck/lint gate below
so a regression in existing behavior (Recent, digest if B10 has landed, save/status toggling) is
caught immediately.

- [ ] **Step 1: Implement.** In `packages/extension-chrome/src/side-panel.html`, wrap the existing
      `<side-panel-view>` in a new `<div id="app">`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>AI Dictionary</title>
  </head>
  <body>
    <div id="app">
      <side-panel-view></side-panel-view>
    </div>
    <script type="module" src="side-panel.js"></script>
  </body>
</html>
```

In `packages/extension-chrome/src/side-panel.ts`:

1. Extend the existing `@ai-dict/app` import (currently lines 1-13) to add `registerReviewFlip`,
   `buildReviewDeck`, `type ReviewFlipView`, `type ReviewCard`, `type SavedWordEntry`:

```ts
import {
  registerSidePanel,
  registerReviewFlip,
  sanitizeMarkdown,
  mapError,
  createSaveReplyGuard,
  buildReviewDeck,
  type PanelFocusState,
  type SidePanelView,
  type ReviewFlipView,
  type ReviewCard,
  type LookupResult,
  type LookupError,
  type HistoryEntry,
  type SavedWordEntry,
  type WireReply,
  type SavedWordStatus,
} from '@ai-dict/app';
import type {
  GetSidePanelFocusMessage,
  SidePanelFocusReply,
  SidePanelFocus,
} from './side-panel-messages';
registerSidePanel();
registerReviewFlip();
```

2. Replace the existing `const view = document.querySelector('side-panel-view') as SidePanelView;`
   line with two lines:

```ts
const app = document.querySelector('#app') as HTMLElement;
const view = document.querySelector('side-panel-view') as SidePanelView;
```

3. Add new module state right after the existing `const saveReplyGuard = createSaveReplyGuard();`
   line:

```ts
// B11: the panel's currently-applied theme, captured by initFromSettings, re-stamped onto the
// review view the moment it's created — mirrors options.ts stamping data-ad-theme on every
// screen it mounts.
let currentTheme = 'sepia';
// B11: created lazily on the first "Review" click; reused for the rest of the panel session so
// its close/mark-known listeners are registered exactly once.
let reviewView: ReviewFlipView | undefined;
```

4. In `initFromSettings`, right after the existing
   `view.setAttribute('data-ad-theme', reply.settings.theme);` line, add:

```ts
currentTheme = reply.settings.theme;
```

5. Add the following two functions and one listener, placed right after the existing
   `dismiss-nudge` listener block (`view.addEventListener('dismiss-nudge', ...)`) and before the
   `initFromSettings` function definition:

```ts
function ensureReviewView(): ReviewFlipView {
  if (!reviewView) {
    reviewView = document.createElement('review-flip-view') as ReviewFlipView;
    reviewView.addEventListener('close', () => {
      app.replaceChildren(view);
    });
    // B11: reuses the exact saved.setStatus message B5 shipped — no new wire message for this.
    reviewView.addEventListener('mark-known', (e) => {
      const { word } = (e as CustomEvent<{ word: string }>).detail;
      void chrome.runtime
        .sendMessage({ type: 'saved.setStatus', word, status: 'known' })
        .catch(() => undefined);
    });
  }
  return reviewView;
}

// B11: fetch every saved word, build this session's shuffled deck, and swap the panel over to
// the review surface. Best-effort like refreshRecent/recoverFocus: a failed fetch shows the
// review view's own empty state rather than a separate error UI.
async function openReview(): Promise<void> {
  const rv = ensureReviewView();
  rv.setAttribute('data-ad-theme', currentTheme);
  let cards: ReviewCard[] = [];
  try {
    const raw: unknown = await chrome.runtime.sendMessage({ type: 'saved.list' });
    const reply = raw as WireReply | undefined;
    if (reply && reply.ok && reply.type === 'saved.list') {
      const deck = buildReviewDeck(reply.entries as SavedWordEntry[], { nowMs: Date.now() });
      cards = deck.map((e) => ({
        word: e.word,
        sentence: e.senses[0]?.sentence ?? '',
        // S4: senses[0].definition is stored model output — re-sanitize at render time, exactly
        // like resultToFocus does for a live lookup.
        safeHtml: sanitizeMarkdown(e.senses[0]?.definition ?? ''),
        translation: e.senses[0]?.translation ?? '',
      }));
    }
  } catch {
    // cards stays [] — the review view's own empty state covers this.
  }
  rv.deck = cards;
  app.replaceChildren(rv);
}

view.addEventListener('open-review', () => void openReview());
```

Run:

```
cd packages/extension-chrome && bun run typecheck
```

Expected: clean (no type errors).

- [ ] **Step 2: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd ../extension-chrome && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

```
git add packages/extension-chrome/src/side-panel.html packages/extension-chrome/src/side-panel.ts
git commit -m "[B11CasualReviewFlip] feat: wire the Review entry point to the deck fetch and panel swap (B11)"
```

---

### Task 6: e2e coverage

**Files:**

- Create: `packages/extension-chrome/e2e/b11-casual-review-flip.spec.ts`

- [ ] **Step 1: Write the e2e spec.** Create
      `packages/extension-chrome/e2e/b11-casual-review-flip.spec.ts`:

```ts
import { test, expect } from './fixtures';
import { seedSettings } from './helpers';
import type { BrowserContext, Page } from '@playwright/test';

/** Build a well-formed stored SavedWordEntry (matches SavedWordEntrySchema). */
function savedEntry(over: {
  word: string;
  status: 'learning' | 'known';
  savedAt: number;
  definition?: string;
  translation?: string;
  sentence?: string;
}) {
  return {
    word: over.word,
    status: over.status,
    savedAt: over.savedAt,
    senses: [
      {
        definition: over.definition ?? `${over.word} means a financial institution.`,
        translation: over.translation ?? `${over.word} (translated)`,
        sentence: over.sentence ?? `I went to the ${over.word} yesterday.`,
        url: 'https://example.com/article',
        title: 'Example Article',
      },
    ],
  };
}

/** Seed saved words into extension storage, matching saved-words-policy.ts's saved:<key>/
 * saved:index shape, from an extension page. */
async function seedSaved(page: Page, entries: ReturnType<typeof savedEntry>[]): Promise<void> {
  await page.evaluate((es) => {
    const items: Record<string, string> = {
      'saved:index': JSON.stringify(es.map((e) => e.word.toLowerCase())),
    };
    for (const e of es) items[`saved:${e.word.toLowerCase()}`] = JSON.stringify(e);
    return chrome.storage.local.set(items);
  }, entries);
}

async function swStorageDump(context: BrowserContext): Promise<Record<string, unknown>> {
  const [sw] = context.serviceWorkers();
  return sw.evaluate(() => chrome.storage.local.get(null) as Promise<Record<string, unknown>>);
}

const DAY_MS = 24 * 60 * 60 * 1000;

test.describe('B11 casual review flip', () => {
  test('review shows only the in-window learning word; reveal, mark known, done', async ({
    context,
    extensionId,
  }) => {
    const seeder = await context.newPage();
    await seeder.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(seeder);
    const now = Date.now();
    await seedSaved(seeder, [
      savedEntry({ word: 'kite', status: 'learning', savedAt: now }), // in window
      savedEntry({ word: 'antique', status: 'learning', savedAt: now - 20 * DAY_MS }), // too old
      savedEntry({ word: 'bank', status: 'known', savedAt: now }), // known — excluded
    ]);

    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/side-panel.html`);
    await panel.waitForSelector('side-panel-view');

    await panel.locator('side-panel-view .review-btn').click();
    await panel.waitForSelector('review-flip-view');

    await expect(panel.locator('review-flip-view')).toContainText('Card 1 of 1', {
      timeout: 5_000,
    });
    await expect(panel.locator('review-flip-view')).toContainText('I went to the kite yesterday.');
    await expect(panel.locator('review-flip-view')).not.toContainText('antique');
    await expect(panel.locator('review-flip-view')).not.toContainText(
      'means a financial institution',
    ); // bank never shown

    await panel.getByRole('button', { name: 'Reveal meaning' }).click();
    await expect(panel.locator('review-flip-view')).toContainText(
      'kite means a financial institution',
    );
    await expect(panel.locator('review-flip-view')).toContainText('kite (translated)');

    await panel.getByRole('button', { name: 'Mark kite as known' }).click();
    await expect(panel.locator('review-flip-view')).toContainText('You reviewed 1 word.', {
      timeout: 5_000,
    });

    await expect
      .poll(async () => {
        const dump = await swStorageDump(context);
        const entry = JSON.parse(dump['saved:kite'] as string);
        return entry.status;
      })
      .toBe('known');

    // Close returns to the normal panel.
    await panel.locator('review-flip-view .close').click();
    await expect(panel.locator('side-panel-view')).toBeVisible();
    await expect(panel.locator('review-flip-view')).toHaveCount(0);
  });

  test('an empty deck shows the empty state with a working Back to panel button', async ({
    context,
    extensionId,
  }) => {
    const seeder = await context.newPage();
    await seeder.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(seeder);
    // No saved:* keys seeded at all — the store is empty.

    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/side-panel.html`);
    await panel.waitForSelector('side-panel-view');

    await panel.locator('side-panel-view .review-btn').click();
    await panel.waitForSelector('review-flip-view');
    await expect(panel.locator('review-flip-view')).toContainText('Nothing to review yet', {
      timeout: 5_000,
    });

    await panel.getByRole('button', { name: 'Back to panel' }).click();
    await expect(panel.locator('side-panel-view')).toBeVisible();
    await expect(panel.locator('review-flip-view')).toHaveCount(0);
  });
});
```

Run:

```
GEMINI_API_KEY= bun run build:chrome
cd packages/extension-chrome && bunx playwright test b11-casual-review-flip
```

Expected: 2 passed.

- [ ] **Step 2: Commit** — gate, then commit:

```
GEMINI_API_KEY= bun run build:chrome
bun run lint && bun run format:check
```

```
git add packages/extension-chrome/e2e/b11-casual-review-flip.spec.ts
git commit -m "[B11CasualReviewFlip] feat: add e2e coverage for the casual review flip (B11)"
```

---

### Task 7: Final gates + PR

- [ ] Run the full gate suite:

```
cd packages/app && bun run typecheck
cd ../extension-chrome && bun run typecheck
cd ../..
bun run test
bun run lint
bun run format:check
GEMINI_API_KEY= bun run build:chrome
cd packages/extension-chrome && bunx playwright test b11-casual-review-flip side-panel saved-word b5-status-lifecycle
```

Expected: typecheck clean on both packages; the full Vitest suite green (including
`review-deck-policy.test.ts`, `review-flip-view.test.ts`, and the `side-panel-view.test.ts`/
`wire-schema.test.ts`/`router.test.ts` additions); lint/format clean; the Chrome build succeeds with
the env key cleared; the new `b11-casual-review-flip.spec.ts`, plus `side-panel.spec.ts` (regression
guard for the `#app` wrapper + swap mechanism this card introduces), `saved-word.spec.ts` and
`b5-status-lifecycle.spec.ts` (regression guards for the `saved.setStatus` path this card reuses)
all pass.

- [ ] **Note the C3 change-unit, don't hand-edit `.c3/`.** This card adds a new component-level UI
      element (`review-flip-view`) and a new domain module (`review-deck-policy`) under the existing
      `c3-1 app` component and a new wire message under `c3-103 wire-protocol` — no new C3
      component boundary is introduced (both new files live inside `c3-1`'s existing directories).
      Record in the PR description that a follow-up `c3 sweep` picks up the new files; do not run
      `.c3/` edits by hand as part of this plan.

- [ ] **Open the PR.** Title: `[B11CasualReviewFlip] Casual review flip`. Body follows the repo's
      PR-body convention (no `.github/PULL_REQUEST_TEMPLATE` file exists in this repo — confirmed;
      the required element is a written **"Testing performed"** section, no screenshots/video per
      the 2026-07-16 evidence-policy ruling):

```
## Description
Adds an always-visible "Review" entry point to the side panel: a fresh, shuffled deck of
learning-status words saved in the last 14 days, front = original sentence, tap to reveal the
saved meaning, optional "Mark known" (reuses B5's saved.setStatus) or "Next". Permanently no
scheduling, due dates, or streaks.

## Design choices
- New `saved.list` wire message — shared primitive also needed by the concurrently-authored B10
  (weekly digest) card; whichever card landed first added it (see the design spec §2.1/§9 for the
  resolution mechanics if this note doesn't match reality by merge time).
- Review is a brand-new top-level `<review-flip-view>` element, swapped in via `#app.
replaceChildren(...)` (mirrors options.ts's onboarding/settings swap) rather than a mode flag on
  `SidePanelView` — see the design spec §2.7 for the `:host`/`[hidden]` cascade pitfall this avoids.

## JIRA ticket
* n/a — this repo is not Jira-tracked (see PR #117's own precedent).

## Testing performed
- Unit: `bun run test` — full Vitest suite green, including new suites
  `review-deck-policy.test.ts` (8 tests) and `review-flip-view.test.ts` (11 tests), plus additions
  to `side-panel-view.test.ts` (3 tests), `wire-schema.test.ts` (4 tests), `router.test.ts`
  (2 tests).
- Typecheck: `packages/app` and `packages/extension-chrome` both clean.
- Lint / format: `bun run lint`, `bun run format:check` clean.
- Build: `GEMINI_API_KEY= bun run build:chrome` succeeds (env key cleared, deterministic).
- e2e: `b11-casual-review-flip.spec.ts` (2 tests: in-window/out-of-window/known filtering +
  reveal/mark-known/done flow; empty-state + Back to panel), plus regression runs of
  `side-panel.spec.ts`, `saved-word.spec.ts`, `b5-status-lifecycle.spec.ts` — all green.

## Merge checklist
- [x] Lint/format/typecheck/unit/e2e gates green (see Testing performed)
- [x] No new manifest permission
- [x] S1/S4 held (see design spec §2.9, §5)
- [x] Regular merge commit — squash prohibited (owner ruling 2026-07-16)
```

Regular merge (no squash, per owner ruling — `docs/ROADMAP.md` §8, 2026-07-16). Wait for CI green,
then merge via a **regular merge commit** (exactly 2 parents).
