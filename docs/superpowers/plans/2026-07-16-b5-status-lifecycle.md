# B5 Status Lifecycle Implementation Plan

> **For agentic workers:** implement task-by-task, TDD (red → green → commit) per task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a saved word can be manually flipped between its two statuses — `'learning'` (default on
save) and `'known'` — from a small toggle on the existing save-row surface (the in-page card and
the side panel both render it, since they share `renderSaveRow`/`renderCardState`). The change
persists in the saved entry, the default on save remains `'learning'`, and the flow is covered by
unit tests + e2e + evidence video.

**Architecture:** almost everything lives in the portable core (`packages/app/src/**`, `c3-1`) —
one new domain function, one new wire message (additive to the existing `discriminatedUnion`), one
new router case, one new optional `CardState` field + UI button, one new renderer method — plus two
small, untested-by-design composition-root edits (`content.ts`, `side-panel.ts`, verified by e2e),
exactly matching B7's precedent for composition-root code. **Zero changes** to
`SavedWordEntry`/`SavedWordSense`/`SavedWordStatus` (the ratified E1 schema) — `status` already
exists; this plan only adds a write path to it. Full design rationale:
`docs/superpowers/specs/2026-07-16-b5-status-lifecycle-design.md`.

**Tech Stack:** TypeScript, Zod (wire schema), Vitest + happy-dom (unit), Playwright (e2e).

## Global Constraints

- Implementer: dispatch each implementation/fix task to the `hunter` subagent — never a generic
  implementer.
- **Do not touch `SavedWordEntry`/`SavedWordSense`/`SavedWordStatus`**
  (`packages/app/src/domain/types.ts:219-251`, E1's ratified schema) or `SavedWordEntrySchema` in
  `wire.ts`. `status: SavedWordStatus` already exists on the ratified shape — this plan adds a
  write path, never a schema change.
- **Exactly 2 states, manual toggle only, no auto-promotion** (roadmap B5 scope fence, held
  verbatim). `savedWordSetStatus` (Task 1) is the only new place status is ever written after the
  initial save.
- **No B6 words-list page.** The toggle lives on the existing `.save-row` surface only
  (`renderSaveRow` in `lookup-card.ts`), reused by both the in-page card and the side panel.
- **Reuse the existing `saved.save` reply — no new round trip for it.** The router's `saved.save`
  reply already returns the full `SavedWordEntry` (including the preserved/defaulted `status`);
  Task 6/7 read that existing reply instead of adding a lookup call.
- UI additions read only `--ad-*`/`--adp-*` design tokens (no hard-coded colors) — the new
  `.status-btn` is styled like the existing `.save-btn`.
- `bun run lint` and `bun run format:check` clean before every commit.
- Every task must leave `cd packages/app && bun run typecheck` (and, from Task 6 on,
  `cd packages/extension-chrome && bun run typecheck`) green.
- Commit subject convention for every task in this plan: `feat: status lifecycle — <task summary> (B5)`.

---

### Task 1: `savedWordSetStatus` — domain write path

**Files:**

- Modify: `packages/app/src/domain/saved-words-policy.ts`
- Modify: `packages/app/test/saved-words-policy.test.ts`

**Interfaces:**

```ts
export async function savedWordSetStatus(
  deps: SavedWordsDeps,
  word: string,
  status: SavedWordStatus,
): Promise<SavedWordEntry | null>;
```

- [x] **Step 1: Write the failing tests.** Append to `packages/app/test/saved-words-policy.test.ts`,
      just before the closing `});` of the `describe('saved-words-policy', ...)` block (after the
      existing `savedWordsClear` test):

```ts
it('savedWordSetStatus flips an existing entry to known, preserving senses/savedAt', async () => {
  const s = memStorage();
  const original = await savedWordUpsert({ storage: s, now: () => 1000 }, input('bank'));
  const updated = await savedWordSetStatus({ storage: s }, 'bank', 'known');
  expect(updated).not.toBeNull();
  expect(updated!.status).toBe('known');
  expect(updated!.savedAt).toBe(original.savedAt);
  expect(updated!.senses).toEqual(original.senses);
  expect(await s.getItem('saved:bank')).toBe(JSON.stringify(updated));
});

it('savedWordSetStatus is case-insensitive on the word key', async () => {
  const s = memStorage();
  await savedWordUpsert({ storage: s, now: () => 1000 }, input('Bank'));
  const updated = await savedWordSetStatus({ storage: s }, 'BANK', 'known');
  expect(updated!.status).toBe('known');
});

it('savedWordSetStatus can flip back from known to learning', async () => {
  const s = memStorage();
  await savedWordUpsert({ storage: s, now: () => 1000 }, input('bank'));
  await savedWordSetStatus({ storage: s }, 'bank', 'known');
  const back = await savedWordSetStatus({ storage: s }, 'bank', 'learning');
  expect(back!.status).toBe('learning');
});

it('savedWordSetStatus on an unsaved word is a no-op returning null (no throw)', async () => {
  const s = memStorage();
  await expect(savedWordSetStatus({ storage: s }, 'ghost', 'known')).resolves.toBeNull();
});
```

Add `savedWordSetStatus` to the existing import list at the top of the file:

```ts
import {
  savedWordUpsert,
  savedWordDelete,
  savedWordGet,
  savedWordsList,
  savedWordsClear,
  savedWordSetStatus,
  normalizeWordKey,
} from '../src/domain/saved-words-policy';
```

Run: `cd packages/app && bunx vitest run test/saved-words-policy.test.ts`
Expected: 4 new failures — `savedWordSetStatus is not a function` (or a TS error to that effect).

- [x] **Step 2: Implement.** In `packages/app/src/domain/saved-words-policy.ts`:
  1. Add `SavedWordStatus` to the existing type import:

  ```ts
  import type { SavedWordEntry, SavedWordSense, SavedWordStatus } from './types';
  ```

  2. Add this export right after `savedWordDelete` (before `savedWordGet`):

```ts
/**
 * B5: manually flip an existing saved word's status between 'learning' (default) and 'known'.
 * Exactly 2 states, no auto-promotion (roadmap B5 scope fence) — this is the only place status
 * ever changes after the initial save/re-save (savedWordUpsert preserves it). No-op (returns
 * null) when the word isn't currently saved — the toggle only ever renders on an already-saved
 * word's own surface, so this guards a race (e.g. deleted between render and click), not the
 * expected path.
 */
export async function savedWordSetStatus(
  deps: SavedWordsDeps,
  word: string,
  status: SavedWordStatus,
): Promise<SavedWordEntry | null> {
  const key = normalizeWordKey(word);
  const raw = await deps.storage.getItem(`saved:${key}`);
  if (!raw) return null;
  const existing = JSON.parse(raw) as SavedWordEntry;
  const entry: SavedWordEntry = { ...existing, status };
  await deps.storage.setItem(`saved:${key}`, JSON.stringify(entry));
  return entry;
}
```

Run: `cd packages/app && bunx vitest run test/saved-words-policy.test.ts`
Expected: all tests pass (existing + 4 new).

- [x] **Step 3: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

Commit:

```
git add packages/app/src/domain/saved-words-policy.ts packages/app/test/saved-words-policy.test.ts
git commit -m "feat: status lifecycle — add savedWordSetStatus domain write path (B5)" \
  -m $'Tribe-Card: b5-status-lifecycle\nTribe-Task: 1/9'
```

---

### Task 2: `saved.setStatus` wire message

**Files:**

- Modify: `packages/app/src/wire.ts`
- Modify: `packages/app/test/wire-schema.test.ts`
- Modify: `packages/app/wire-schema.snapshot.json` (regenerated, not hand-edited)

- [x] **Step 1: Write the failing tests.** Append to `packages/app/test/wire-schema.test.ts`, inside
      the existing `describe('saved.save / saved.delete wire messages (B1)', ...)` block, just
      before its closing `});`:

```ts
it('accepts a valid saved.setStatus message (B5)', () => {
  expect(
    WireMessageSchema.safeParse({ type: 'saved.setStatus', word: 'bank', status: 'known' }).success,
  ).toBe(true);
  expect(
    WireMessageSchema.safeParse({ type: 'saved.setStatus', word: 'bank', status: 'learning' })
      .success,
  ).toBe(true);
});

it('rejects a saved.setStatus message with an invalid status value (B5)', () => {
  expect(
    WireMessageSchema.safeParse({ type: 'saved.setStatus', word: 'bank', status: 'mastered' })
      .success,
  ).toBe(false);
});

it('rejects a saved.setStatus message missing word or status (B5)', () => {
  expect(WireMessageSchema.safeParse({ type: 'saved.setStatus', status: 'known' }).success).toBe(
    false,
  );
  expect(WireMessageSchema.safeParse({ type: 'saved.setStatus', word: 'bank' }).success).toBe(
    false,
  );
});
```

Run: `cd packages/app && bunx vitest run test/wire-schema.test.ts`
Expected: 3 new failures (message type not recognized by the schema) plus the pre-existing
`'JSON-schema snapshot is stable'` test now ALSO failing once Step 2 adds the new arm (the
snapshot won't match until Step 3 regenerates it) — that snapshot failure is expected and handled
in Step 3, not a regression to chase here.

- [x] **Step 2: Implement.** In `packages/app/src/wire.ts`:
  1. Add a new arm to `WireMessageSchema`'s array, right after the existing `saved.delete` arm:

```ts
  z.object({ type: z.literal('saved.delete'), word: z.string() }),
  // B5: manually set an existing saved word's status ('learning' default | 'known' manual).
  // No-op server-side when the word isn't currently saved — see savedWordSetStatus's doc comment.
  z.object({
    type: z.literal('saved.setStatus'),
    word: z.string(),
    status: z.enum(['learning', 'known']),
  }),
```

2. Add `'saved.setStatus'` to `MessageTypeEnum`'s array:

```ts
const MessageTypeEnum = z.enum([
  'lookup',
  'lookup.cancel',
  'settings.get',
  'history.list',
  'history.clear',
  'history.delete',
  'cache.clear',
  'connection.test',
  'open-options',
  'errlog.status',
  'errlog.set-consent',
  'saved.save',
  'saved.delete',
  'saved.setStatus',
]);
```

Run: `cd packages/app && bunx vitest run test/wire-schema.test.ts`
Expected: the 3 new tests pass; the snapshot test fails (`toMatchFileSnapshot` mismatch) — this is
expected, resolved in Step 3.

- [x] **Step 3: Commit** — regenerate the snapshot, then gate and commit:

```
cd packages/app && bunx vitest run test/wire-schema.test.ts -u
```

Expected: snapshot test now passes; `git diff packages/app/wire-schema.snapshot.json` shows only
the new `saved.setStatus` arm added.

```
cd packages/app && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

Commit:

```
git add packages/app/src/wire.ts packages/app/test/wire-schema.test.ts packages/app/wire-schema.snapshot.json
git commit -m "feat: status lifecycle — add saved.setStatus wire message (B5)" \
  -m $'Tribe-Card: b5-status-lifecycle\nTribe-Task: 2/9'
```

---

### Task 3: Router — `saved.setStatus` case

**Files:**

- Modify: `packages/app/src/app/router.ts`
- Modify: `packages/app/test/app/router.test.ts`

- [x] **Step 1: Write the failing tests.** Append to `packages/app/test/app/router.test.ts`, just
      before the closing `});` of the `describe('buildRouter', ...)` block (after the existing
      `'history.clear and cache.clear never touch saved:* ...'` test — find and keep that test's
      own closing, then add these after it):

```ts
it('saved.setStatus flips an existing saved word to known and returns the updated entry (B5)', async () => {
  const d = deps();
  const route = buildRouter(d);
  await route({
    type: 'saved.save',
    word: 'bank',
    definition: 'd',
    translation: '',
    sentence: 's',
    url: 'u',
    title: 't',
  });
  const reply = await route({ type: 'saved.setStatus', word: 'bank', status: 'known' });
  expect(reply).toMatchObject({
    ok: true,
    type: 'saved',
    entry: { word: 'bank', status: 'known' },
  });
});

it('saved.setStatus on an unsaved word replies ack (idempotent no-op) (B5)', async () => {
  const d = deps();
  const route = buildRouter(d);
  const reply = await route({ type: 'saved.setStatus', word: 'ghost', status: 'known' });
  expect(reply).toMatchObject({ ok: true, type: 'ack' });
});

it('saved.setStatus is case-insensitive on the word key (B5)', async () => {
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
  const reply = await route({ type: 'saved.setStatus', word: 'BANK', status: 'known' });
  expect(reply).toMatchObject({ ok: true, type: 'saved', entry: { status: 'known' } });
});
```

Run: `cd packages/app && bunx vitest run test/app/router.test.ts`
Expected: 3 new failures — the router has no `saved.setStatus` case (falls through / TS error).

- [x] **Step 2: Implement.** In `packages/app/src/app/router.ts`:
  1. Add `savedWordSetStatus` to the existing import block:

```ts
import {
  mapError,
  isLookupError,
  cacheGet,
  cachePut,
  cacheClear,
  cacheDelete,
  historyAppend,
  historyList,
  historyClear,
  historyGet,
  historyDelete,
  savedWordUpsert,
  savedWordDelete,
  savedWordSetStatus,
  evaluateNudge,
  type WireMessage,
  type WireReply,
  type LookupError,
  type LookupClient,
  type SettingsStore,
  type Storage,
  type HistoryEntry,
} from '../index';
```

2. Add a new `case` right after the existing `case 'saved.delete':` block:

```ts
      case 'saved.delete':
        await deps.queue.run(() => savedWordDelete({ storage: deps.kv }, msg.word));
        return { ok: true, type: 'ack' };
      case 'saved.setStatus': {
        const entry = await deps.queue.run(() =>
          savedWordSetStatus({ storage: deps.kv }, msg.word, msg.status),
        );
        return entry ? { ok: true, type: 'saved', entry } : { ok: true, type: 'ack' };
      }
```

Run: `cd packages/app && bunx vitest run test/app/router.test.ts`
Expected: all tests pass (existing + 3 new).

- [x] **Step 3: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

Commit:

```
git add packages/app/src/app/router.ts packages/app/test/app/router.test.ts
git commit -m "feat: status lifecycle — wire router case for saved.setStatus (B5)" \
  -m $'Tribe-Card: b5-status-lifecycle\nTribe-Task: 3/9'
```

---

### Task 4: UI — `CardState.status` + `.status-btn` in `renderSaveRow`

**Files:**

- Modify: `packages/app/src/ui/lookup-card.ts`
- Modify: `packages/app/test/ui/lookup-card.test.ts`

- [x] **Step 1: Write the failing tests.** Append to `packages/app/test/ui/lookup-card.test.ts`,
      inside the existing `describe('<lookup-card> save/star affordance (B1)', ...)` block, just
      before its closing `});` (after the existing `'the loading and error states render no save
row ...'` test):

```ts
it('a saved result with status learning renders a status toggle showing Learning (B5)', () => {
  const el = mountCard();
  el.state = {
    kind: 'result',
    word: 'bank',
    target: 'vi',
    safeHtml: safe('<p>money place</p>'),
    saved: true,
    status: 'learning',
  };
  const btn = el.querySelector<HTMLButtonElement>('.status-btn')!;
  expect(btn).not.toBeNull();
  expect(btn.textContent).toContain('Learning');
  expect(btn.getAttribute('aria-pressed')).toBe('false');
  expect(btn.getAttribute('aria-label')).toBe('Mark bank as known');
});

it('a saved result with status known renders a status toggle showing Known (B5)', () => {
  const el = mountCard();
  el.state = {
    kind: 'result',
    word: 'bank',
    target: 'vi',
    safeHtml: safe('<p>money place</p>'),
    saved: true,
    status: 'known',
  };
  const btn = el.querySelector<HTMLButtonElement>('.status-btn')!;
  expect(btn.textContent).toContain('Known');
  expect(btn.getAttribute('aria-pressed')).toBe('true');
  expect(btn.getAttribute('aria-label')).toBe('Mark bank as learning');
});

it('an unsaved result renders no status toggle, even if status were somehow present (B5)', () => {
  const el = mountCard();
  el.state = {
    kind: 'result',
    word: 'bank',
    target: 'vi',
    safeHtml: safe('<p>money place</p>'),
    saved: false,
    status: 'learning',
  };
  expect(el.querySelector('.status-btn')).toBeNull();
});

it('a saved result with no status renders no status toggle (back-compat) (B5)', () => {
  const el = mountCard();
  el.state = {
    kind: 'result',
    word: 'bank',
    target: 'vi',
    safeHtml: safe('<p>money place</p>'),
    saved: true,
  };
  expect(el.querySelector('.status-btn')).toBeNull();
});

it('clicking the status toggle fires a composed toggle-status event with the word in detail (B5)', () => {
  const el = mountCard();
  el.state = {
    kind: 'result',
    word: 'bank',
    target: 'vi',
    safeHtml: safe('<p>money place</p>'),
    saved: true,
    status: 'learning',
  };
  const handler = vi.fn();
  document.body.addEventListener('toggle-status', handler);
  el.querySelector<HTMLButtonElement>('.status-btn')!.click();
  document.body.removeEventListener('toggle-status', handler);
  expect(handler).toHaveBeenCalledTimes(1);
  const event = handler.mock.calls[0]![0] as CustomEvent<{ word: string }>;
  expect(event.detail).toEqual({ word: 'bank' });
});
```

Run: `cd packages/app && bunx vitest run test/ui/lookup-card.test.ts`
Expected: 5 new failures — `.status-btn` never renders / TS error on `status` not existing on the
state literal.

- [x] **Step 2: Implement.** In `packages/app/src/ui/lookup-card.ts`:
  1. Add `status?: SavedWordStatus` to the `'result'` variant of `CardState` (import
     `SavedWordStatus` from `../domain/types` alongside the existing type-only imports at the top
     of the file — check the current import line and extend it, e.g.
     `import type { LookupError, Provider, SavedWordStatus } from '../index';` — match whatever the
     file currently imports `LookupError`/`Provider` from), right after the existing `saved?:
boolean;` field:

```ts
      /** B1: whether this word is currently starred/saved — drives the save row's fill state. */
      saved?: boolean;
      /** B5: current status of a saved word ('learning' default | 'known' manual) — only
       * meaningful when `saved === true`; absent/undefined hides the status toggle (matches B1's
       * own no-round-trip precedent: a fresh render never knows a persisted status until the star
       * is (re-)tapped and the saved.save reply's entry.status seeds it — see content.ts/side-panel.ts). */
      status?: SavedWordStatus;
```

2. Update `renderSaveRow`'s parameter type and body — replace the whole function:

```ts
function renderSaveRow(state: {
  word: string;
  saved?: boolean;
  status?: SavedWordStatus;
}): HTMLElement {
  const row = document.createElement('div');
  row.className = 'save-row';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'save-btn';
  const isSaved = state.saved === true;
  btn.setAttribute('aria-pressed', String(isSaved));
  btn.setAttribute(
    'aria-label',
    isSaved ? `Remove ${state.word} from saved words` : `Save ${state.word} to your word list`,
  );
  btn.innerHTML = ICON_STAR; // decorative aria-hidden SVG; name comes from aria-label
  const lbl = document.createElement('span');
  lbl.className = 'save-lbl';
  lbl.textContent = isSaved ? 'Saved' : 'Save';
  btn.append(lbl);
  btn.addEventListener('click', () =>
    btn.dispatchEvent(
      new CustomEvent('toggle-save', {
        detail: { word: state.word },
        bubbles: true,
        composed: true,
      }),
    ),
  );
  row.append(btn);
  if (isSaved && state.status !== undefined) {
    row.append(renderStatusBtn(state.word, state.status));
  }
  return row;
}

/**
 * B5: the manual learning/known status toggle — rendered only once a word is saved AND its
 * current status is known (see renderSaveRow's guard). Exactly 2 states, manual only (roadmap B5
 * scope fence): clicking dispatches a composed `toggle-status` event carrying only the word (the
 * composition root computes the flip direction from its own tracked last-known status, mirroring
 * `toggle-save`'s own design) — this function is pure UI, no persistence.
 */
function renderStatusBtn(word: string, status: SavedWordStatus): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'status-btn';
  const isKnown = status === 'known';
  btn.setAttribute('aria-pressed', String(isKnown));
  btn.setAttribute('aria-label', isKnown ? `Mark ${word} as learning` : `Mark ${word} as known`);
  btn.textContent = isKnown ? 'Known' : 'Learning';
  btn.addEventListener('click', () =>
    btn.dispatchEvent(
      new CustomEvent('toggle-status', { detail: { word }, bubbles: true, composed: true }),
    ),
  );
  return btn;
}
```

3. Add the `.status-btn` CSS rules to `CARD_DOC_CSS`, right after the existing
   `@media (prefers-reduced-motion:reduce){lookup-card .save-btn{transition:none}}` line:

```ts
@media (prefers-reduced-motion:reduce){lookup-card .save-btn{transition:none}}
lookup-card .status-btn{display:inline-flex;align-items:center;margin-left:8px;border:1px solid var(--ad-line);background:transparent;color:var(--ad-ink-soft);border-radius:var(--adp-radius-control);padding:5px 12px;font:inherit;font-size:var(--adp-text-xs);font-weight:var(--adp-weight-semi);cursor:pointer;transition:background var(--adp-dur-fast) var(--adp-ease),color var(--adp-dur-fast) var(--adp-ease),border-color var(--adp-dur-fast) var(--adp-ease)}
lookup-card .status-btn:hover{background:var(--ad-surface-raised);color:var(--ad-ink)}
lookup-card .status-btn:focus-visible{outline:2px solid var(--ad-accent);outline-offset:2px}
lookup-card .status-btn[aria-pressed="true"]{border-color:var(--ad-accent);color:var(--ad-accent-ink)}
@media (prefers-reduced-motion:reduce){lookup-card .status-btn{transition:none}}
```

Run: `cd packages/app && bunx vitest run test/ui/lookup-card.test.ts`
Expected: all tests pass (existing + 5 new).

- [x] **Step 3: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

Commit:

```
git add packages/app/src/ui/lookup-card.ts packages/app/test/ui/lookup-card.test.ts
git commit -m "feat: status lifecycle — add status toggle to the save row (B5)" \
  -m $'Tribe-Card: b5-status-lifecycle\nTribe-Task: 4/9'
```

---

### Task 5: `InlineBottomSheetRenderer.setStatus`

**Files:**

- Modify: `packages/app/src/app/inline-bottom-sheet-renderer.ts`
- Modify: `packages/app/test/app/inline-bottom-sheet-renderer.test.ts`

- [x] **Step 1: Write the failing tests.** Append to
      `packages/app/test/app/inline-bottom-sheet-renderer.test.ts`, as a new `describe` block right
      after the existing `describe('InlineBottomSheetRenderer — save state (B1)', ...)` block's
      closing `});`:

```ts
describe('InlineBottomSheetRenderer — status toggle (B5)', () => {
  it('setStatus(known) re-renders the last result with the status toggle showing Known', () => {
    const h = host();
    const r = new InlineBottomSheetRenderer(h);
    r.renderResult(result, { saved: true });
    r.setStatus('known');
    const btn = card(h).querySelector<HTMLButtonElement>('.status-btn')!;
    expect(btn.textContent).toContain('Known');
    expect(btn.getAttribute('aria-pressed')).toBe('true');
  });

  it('setStatus is a no-op when the last state was loading, not a result', () => {
    const h = host();
    const r = new InlineBottomSheetRenderer(h);
    r.renderLoading();
    expect(() => r.setStatus('known')).not.toThrow();
    expect(card(h).querySelector('.status-btn')).toBeNull();
  });

  it('setStatus is a no-op before any render (no card mounted)', () => {
    const h = host();
    const r = new InlineBottomSheetRenderer(h);
    expect(() => r.setStatus('known')).not.toThrow();
    expect(h.querySelector('bottom-sheet')).toBeNull();
  });
});
```

Run: `cd packages/app && bunx vitest run test/app/inline-bottom-sheet-renderer.test.ts`
Expected: 3 new failures — `setStatus is not a function` (or a TS error to that effect).

- [x] **Step 2: Implement.** In `packages/app/src/app/inline-bottom-sheet-renderer.ts`, add this
      method right after the existing `setSaved` method:

```ts
  /**
   * B5: flip the status toggle's local state on the currently-shown result without a full
   * re-lookup. No-op when the last rendered state isn't a result (e.g. loading/error) or no card
   * has been rendered yet — mirrors the guard pattern `setSaved` already uses.
   */
  setStatus(status: SavedWordStatus): void {
    if (this.lastState?.kind !== 'result') return;
    this.setState({ ...this.lastState, status });
  }
```

Add `SavedWordStatus` to the file's existing type-only import (find the import block at the top
that pulls `ResultRenderer`, `ResultRenderContext`, `LookupResult`, etc. from `../index` and add
`SavedWordStatus` to it).

Run: `cd packages/app && bunx vitest run test/app/inline-bottom-sheet-renderer.test.ts`
Expected: all tests pass (existing + 3 new).

- [x] **Step 3: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

Commit:

```
git add packages/app/src/app/inline-bottom-sheet-renderer.ts packages/app/test/app/inline-bottom-sheet-renderer.test.ts
git commit -m "feat: status lifecycle — add InlineBottomSheetRenderer.setStatus (B5)" \
  -m $'Tribe-Card: b5-status-lifecycle\nTribe-Task: 5/9'
```

---

### Task 6: Wire the in-page card composition root (`content.ts`)

**Files:**

- Modify: `packages/extension-chrome/src/content.ts`

No dedicated unit test exists for `content.ts` in this repo — it is a composition root, covered by
e2e only (same precedent as B1's/B7's own `content.ts` edits). This task's correctness is proven by
Task 8's e2e test; still run the TDD gate commands below at the end of this task so a regression in
existing behavior is caught immediately.

- [x] **Step 1: Implement.** In `packages/extension-chrome/src/content.ts`:
  1. Add a `lastStatus` closure var right after the existing `let lastSaved = false;` (around line
     53):

```ts
let lastSaved = false;
// B5: the current saved word's status, sourced from the saved.save/saved.setStatus reply's
// entry.status (NOT a fresh optimistic default — see the design spec's "Known, accepted
// limitation" section for why an unsaved word starts with no known status). undefined hides the
// status toggle (renderSaveRow's own guard).
let lastStatus: SavedWordStatus | undefined;
```

2. Reset `lastStatus = undefined` everywhere `lastSaved = false` is already reset inside
   `renderLoading` and `renderResult` (two call sites, around lines 70 and 86):

```ts
    renderLoading(word) {
      lastFocus = word === undefined ? { state: 'loading' } : { state: 'loading', word };
      lastSavePayload = undefined;
      lastSaved = false;
      lastStatus = undefined;
      inline.renderLoading(word);
      mirror.renderLoading(word);
    },
    renderResult(r, ctx) {
      lastFocus = { state: 'result', payload: r };
      lastSavePayload = {
        word: r.word,
        definition: r.markdown,
        translation: r.translation ?? '',
        sentence: ctx?.sentence ?? '',
        url: ctx?.url ?? '',
        title: ctx?.title ?? '',
      };
      lastSaved = false;
      lastStatus = undefined;
      inline.renderResult(r, ctx);
      mirror.renderResult(r, ctx);
    },
```

3. Replace the existing `toggle-save` listener (around lines 136-145) to read the reply's
   `entry.status`:

```ts
document.addEventListener('toggle-save', () => {
  if (!lastSavePayload) return;
  const willSave = !lastSaved;
  lastSaved = willSave;
  inline.setSaved(willSave);
  if (!willSave) lastStatus = undefined;
  const message = willSave
    ? { type: 'saved.save' as const, ...lastSavePayload }
    : { type: 'saved.delete' as const, word: lastSavePayload.word };
  void chrome.runtime
    .sendMessage(message)
    .then((raw: unknown) => {
      const reply = raw as WireReply | undefined;
      if (willSave && reply?.ok && reply.type === 'saved') {
        lastStatus = reply.entry.status;
        inline.setStatus(lastStatus);
      }
    })
    .catch(() => undefined);
});

// B5: the card's status toggle bubbles a composed `toggle-status` event (no direction carried —
// the flip direction is computed here from the last known status, mirroring toggle-save's own
// design). No-op if the word isn't confirmed-saved yet (lastStatus undefined mirrors
// lastSavePayload's own guard above).
document.addEventListener('toggle-status', () => {
  if (!lastSavePayload || lastStatus === undefined) return;
  const next: SavedWordStatus = lastStatus === 'known' ? 'learning' : 'known';
  lastStatus = next;
  inline.setStatus(next);
  void chrome.runtime
    .sendMessage({ type: 'saved.setStatus', word: lastSavePayload.word, status: next })
    .catch(() => undefined);
});
```

4. Add `SavedWordStatus` to the existing `@ai-dict/app` type-only import at the top of the file
   (find the `import { ..., type WireReply } from '@ai-dict/app';` block and add
   `type SavedWordStatus` alongside `type WireReply`).

Run:

```
cd packages/extension-chrome && bun run typecheck
```

Expected: clean (no type errors).

- [x] **Step 2: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd ../extension-chrome && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

Commit:

```
git add packages/extension-chrome/src/content.ts
git commit -m "feat: status lifecycle — wire the in-page card's status toggle (B5)" \
  -m $'Tribe-Card: b5-status-lifecycle\nTribe-Task: 6/9'
```

---

### Task 7: Wire the side-panel composition root (`side-panel.ts`)

**Files:**

- Modify: `packages/extension-chrome/src/side-panel.ts`

Same rationale as Task 6 — no dedicated unit test for this composition root; proven by Task 8's e2e
side-panel test.

- [ ] **Step 1: Implement.** In `packages/extension-chrome/src/side-panel.ts`:
  1. Add `lastStatus` next to the existing `let lastSaved = false;` (around line 46):

```ts
let lastSaved = false;
// B5: mirrors content.ts's own lastStatus tracking — the panel is its own independent
// composition root (see the B1-era comment above trackSaveContext).
let lastStatus: SavedWordStatus | undefined;
```

2. Reset it inside `trackSaveContext` (around line 66), right after `lastSaved = false;`:

```ts
function trackSaveContext(
  r: LookupResult,
  extra: {
    sentence?: string | undefined;
    url?: string | undefined;
    title?: string | undefined;
  } = {},
): void {
  lastSavePayload = {
    word: r.word,
    definition: r.markdown,
    translation: r.translation ?? '',
    sentence: extra.sentence ?? '',
    url: extra.url ?? '',
    title: extra.title ?? '',
  };
  lastSaved = false;
  lastStatus = undefined;
}
```

3. Add a `setStatus` function right after the existing `setSaved` function (around line 75):

```ts
/** B5: flip the status toggle on the panel's currently-shown result — mirrors
 * InlineBottomSheetRenderer.setStatus(); no-op when the focus region isn't a result. */
function setStatus(status: SavedWordStatus): void {
  if (view.focusState.kind !== 'result') return;
  view.focusState = { ...view.focusState, status };
}
```

4. Replace the existing `toggle-save` listener (around lines 162-171) to read the reply's
   `entry.status`, and add a new `toggle-status` listener right after it:

```ts
view.addEventListener('toggle-save', () => {
  if (!lastSavePayload) return;
  const willSave = !lastSaved;
  lastSaved = willSave;
  setSaved(willSave);
  if (!willSave) lastStatus = undefined;
  const message = willSave
    ? { type: 'saved.save' as const, ...lastSavePayload }
    : { type: 'saved.delete' as const, word: lastSavePayload.word };
  void chrome.runtime
    .sendMessage(message)
    .then((raw: unknown) => {
      const reply = raw as WireReply | undefined;
      if (willSave && reply?.ok && reply.type === 'saved') {
        lastStatus = reply.entry.status;
        setStatus(lastStatus);
      }
    })
    .catch(() => undefined);
});

// B5: mirrors content.ts's own toggle-status listener.
view.addEventListener('toggle-status', () => {
  if (!lastSavePayload || lastStatus === undefined) return;
  const next: SavedWordStatus = lastStatus === 'known' ? 'learning' : 'known';
  lastStatus = next;
  setStatus(next);
  void chrome.runtime
    .sendMessage({ type: 'saved.setStatus', word: lastSavePayload.word, status: next })
    .catch(() => undefined);
});
```

5. Add `SavedWordStatus` to the existing `@ai-dict/app` type-only import at the top of the file.

Run:

```
cd packages/extension-chrome && bun run typecheck
```

Expected: clean (no type errors).

- [ ] **Step 2: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd ../extension-chrome && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

Commit:

```
git add packages/extension-chrome/src/side-panel.ts
git commit -m "feat: status lifecycle — wire the side panel's status toggle (B5)" \
  -m $'Tribe-Card: b5-status-lifecycle\nTribe-Task: 7/9'
```

---

### Task 8: e2e functional test

**Files:**

- Create: `packages/extension-chrome/e2e/b5-status-lifecycle.spec.ts`

- [ ] **Step 1: Write the test.** Model it directly on
      `packages/extension-chrome/e2e/saved-word.spec.ts`'s existing `swStorageDump`/`doLookup`
      helpers (duplicate the two small helper functions verbatim at the top of the new file — the
      existing suite doesn't export them for reuse, matching how `saved-word.spec.ts` itself is
      self-contained):

```ts
import { test, expect } from './fixtures';
import { seedSettings, gotoFixture, selectWord, openTrigger, mockGemini } from './helpers';
import type { BrowserContext } from '@playwright/test';

async function swStorageDump(context: BrowserContext): Promise<Record<string, unknown>> {
  const [sw] = context.serviceWorkers();
  return sw.evaluate(() => chrome.storage.local.get(null) as Promise<Record<string, unknown>>);
}

async function doLookup(page: import('@playwright/test').Page): Promise<void> {
  await gotoFixture(page);
  await page.waitForTimeout(1_000);
  await selectWord(page, 't', 'bank');
  await openTrigger(page);
  await expect(page.locator('bottom-sheet lookup-card')).toContainText('financial institution', {
    timeout: 10_000,
  });
}

test.describe('B5 status lifecycle', () => {
  test('saving a word shows a Learning toggle; clicking it flips storage + UI to Known and back', async ({
    context,
    extensionId,
  }) => {
    await mockGemini(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);
    await doLookup(page);

    const star = page.locator('bottom-sheet lookup-card .save-btn');
    await star.click();
    await expect.poll(async () => (await swStorageDump(context))['saved:bank']).toBeDefined();

    const statusBtn = page.locator('bottom-sheet lookup-card .status-btn');
    await expect(statusBtn).toBeVisible({ timeout: 10_000 });
    await expect(statusBtn).toContainText('Learning');
    await expect(statusBtn).toHaveAttribute('aria-pressed', 'false');

    await statusBtn.click();
    await expect(statusBtn).toContainText('Known');
    await expect(statusBtn).toHaveAttribute('aria-pressed', 'true');
    await expect
      .poll(async () => {
        const dump = await swStorageDump(context);
        const entry = JSON.parse(dump['saved:bank'] as string);
        return entry.status;
      })
      .toBe('known');

    await statusBtn.click();
    await expect(statusBtn).toContainText('Learning');
    await expect
      .poll(async () => {
        const dump = await swStorageDump(context);
        const entry = JSON.parse(dump['saved:bank'] as string);
        return entry.status;
      })
      .toBe('learning');
  });

  test('an unsaved lookup renders no status toggle', async ({ context, extensionId }) => {
    await mockGemini(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);
    await doLookup(page);
    await expect(page.locator('bottom-sheet lookup-card .status-btn')).toHaveCount(0);
  });

  test('the side panel exposes its own independent status toggle', async ({
    context,
    extensionId,
  }) => {
    await mockGemini(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);

    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/side-panel.html`);
    await panel.waitForSelector('side-panel-view');

    await doLookup(page);
    const panelStar = panel.locator('side-panel-view .save-btn');
    await expect(panelStar).toBeVisible({ timeout: 10_000 });
    await panelStar.click();
    await expect.poll(async () => (await swStorageDump(context))['saved:bank']).toBeDefined();

    const panelStatus = panel.locator('side-panel-view .status-btn');
    await expect(panelStatus).toBeVisible({ timeout: 10_000 });
    await panelStatus.click();
    await expect
      .poll(async () => {
        const dump = await swStorageDump(context);
        const entry = JSON.parse(dump['saved:bank'] as string);
        return entry.status;
      })
      .toBe('known');
  });
});
```

- [ ] **Step 2: Build and run.**

```
bun run build:chrome
cd packages/extension-chrome && bunx playwright test b5-status-lifecycle
```

Expected: 3 passed.

- [ ] **Step 3: Commit** — gate, then commit:

```
bun run lint && bun run format:check
```

Commit:

```
git add packages/extension-chrome/e2e/b5-status-lifecycle.spec.ts
git commit -m "feat: status lifecycle — add e2e coverage for the learning/known toggle (B5)" \
  -m $'Tribe-Card: b5-status-lifecycle\nTribe-Task: 8/9'
```

---

### Task 9: Evidence-video e2e spec

**Files:**

- Create: `packages/extension-chrome/e2e/b5-evidence.spec.ts`

This spec is not run by the normal suite (`test.skip(!RUN, ...)`, same gate as `b1-evidence.spec.ts`)
— it exists to (re)record the before/after video during PR delivery (Warchief step 7), not as part
of this task's own gate.

- [ ] **Step 1: Write the spec**, modeled byte-for-byte on
      `packages/extension-chrome/e2e/b1-evidence.spec.ts`:

```ts
/**
 * B5 before/after evidence: a short recorded flow showing select → Define → tap the star
 * ("Saved") → tap the status toggle (Learning → Known). Not part of the normal suite. (Re)record
 * with:
 *   PLAYWRIGHT_RUN_EVIDENCE=1 SHOT_LABEL=after B5_OUT_DIR=/abs/path \
 *     bunx playwright test b5-evidence
 * Capture BEFORE from a `master` build (star exists, no status toggle after saving) and AFTER
 * from the branch build, then host the .webm per the private-repo rule (pr-assets branch +
 * same-origin github.com/.../raw URLs).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { test, chromium } from '@playwright/test';
import { seedSettings, gotoFixture, selectWord, openTrigger, GEMINI_OK_BODY } from './helpers';
import { E2E_HEADLESS } from '../playwright.config';

const RUN = process.env.PLAYWRIGHT_RUN_EVIDENCE === '1';
const LABEL = process.env.SHOT_LABEL ?? 'after';
const OUT = process.env.B5_OUT_DIR ?? '.';
const here = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(here, '../dist');
const SIZE = { width: 900, height: 620 };

test.describe('B5 status lifecycle — evidence', () => {
  test.skip(!RUN, 'set PLAYWRIGHT_RUN_EVIDENCE=1 to (re)record B5 before/after video');

  test(`select → Define → star → status toggle (${LABEL})`, async () => {
    const videoDir = path.join(OUT, `b5-${LABEL}-raw`);
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
        route.fulfill({ status: 200, contentType: 'application/json', body: GEMINI_OK_BODY }),
      );

      const page = await context.newPage();
      const [sw] = context.serviceWorkers();
      const worker = sw ?? (await context.waitForEvent('serviceworker', { timeout: 10_000 }));
      const extensionId = new URL(worker.url()).hostname;

      await page.goto(`chrome-extension://${extensionId}/options.html`);
      await seedSettings(page);
      await gotoFixture(page);
      await page.waitForTimeout(800);

      await selectWord(page, 't', 'bank');
      await openTrigger(page);
      await page.waitForTimeout(1_200); // hold on the rendered definition

      const star = page.locator('bottom-sheet lookup-card .save-btn');
      if (await star.count()) await star.click(); // no-op on `before` (no star exists)
      await page.waitForTimeout(1_200); // hold on the "Saved" confirmation

      const statusBtn = page.locator('bottom-sheet lookup-card .status-btn');
      if (await statusBtn.count()) await statusBtn.click(); // no-op on `before` (no toggle exists)
      await page.waitForTimeout(1_600); // hold on the "Known" state

      const video = page.video();
      await page.close();
      await mkdir(OUT, { recursive: true });
      await video?.saveAs(path.join(OUT, `b5-${LABEL}.webm`));
    } finally {
      await context.close().catch(() => {});
    }
  });
});
```

- [ ] **Step 2: Sanity-check the spec compiles and its skip guard works** (does not require a real
      Gemini key or the `RUN` flag):

```
cd packages/extension-chrome && bunx playwright test b5-evidence --list
```

Expected: lists the one test, no compile errors.

- [ ] **Step 3: Commit** — gate, then commit:

```
bun run lint && bun run format:check
```

Commit:

```
git add packages/extension-chrome/e2e/b5-evidence.spec.ts
git commit -m "feat: status lifecycle — add before/after evidence-video spec (B5)" \
  -m $'Tribe-Card: b5-status-lifecycle\nTribe-Task: 9/9'
```

---

## Final gate (run once, after Task 9, before opening the PR)

```
cd packages/app && bun run typecheck
cd ../extension-chrome && bun run typecheck
cd ../..
bun run test
bun run lint
bun run format:check
bun run build:chrome
cd packages/extension-chrome && bunx playwright test saved-word b5-status-lifecycle
```

Expected: typecheck clean on both packages; the full Vitest suite green (including the 3 wire
snapshot + saved-words-policy + router + lookup-card + inline-bottom-sheet-renderer additions);
lint/format clean; the Chrome build succeeds; both the pre-existing `saved-word.spec.ts` suite
(regression guard — B1's star flow must be unaffected) and the new `b5-status-lifecycle.spec.ts`
suite pass.
