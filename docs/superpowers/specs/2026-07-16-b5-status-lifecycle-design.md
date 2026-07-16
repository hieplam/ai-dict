# B5 — Status lifecycle (learning → known manual toggle)

Roadmap card: `docs/ROADMAP.md` §4 B5 (Impact 3 · Effort S · Score 3.0).
Depends on: B1 (shipped, PR #99). Feeds: B3 (re-encounter highlighting, future — "known" words
stop being highlighted).

## 1. Problem (grounded in code)

`SavedWordEntry.status` already exists in the ratified E1 schema
(`packages/app/src/domain/types.ts:223,246-251`) and is set correctly on every save —
`savedWordUpsert` (`packages/app/src/domain/saved-words-policy.ts:41-63`) defaults a new entry to
`status: 'learning'` and **preserves** an existing entry's status across a re-save
(`existing?.status ?? 'learning'`, line 56). B1's own test suite already anticipates B5:

> `packages/app/test/saved-words-policy.test.ts:77-86` — _"upsert preserves a manually-set status
> (e.g. known) across a re-save… Simulate a future B5 marking it known directly in storage (no B5
> UI exists yet)."_

**The gap is entirely UI + a write path.** Nothing today ever writes a status other than the
`'learning'` default:

- No wire message can set status (`packages/app/src/wire.ts:95-134` has `saved.save`/`saved.delete`
  only).
- No domain function updates status in place (`saved-words-policy.ts` has `savedWordUpsert`
  (replaces senses, preserves status) and `savedWordDelete` — no "change status only" primitive).
- No UI affordance exists to trigger it (`packages/app/src/ui/lookup-card.ts`'s `renderSaveRow`,
  lines 312-340, renders only the star/Save button).

Once B1 shipped, a saved list only grows — `savedWordsList` (`saved-words-policy.ts:86-95`) returns
every entry forever, all permanently `'learning'`, with no way to mark one mastered. This matches
the card's **Today**/**Missing** exactly.

## 2. Decision: where the toggle lives (Warchief call, per the card's "you decide")

**On the existing save-row surface** (the `.save-row` rendered by `renderSaveRow` in
`lookup-card.ts`, reused verbatim by both the in-page card and the side panel via
`renderCardState`/`side-panel-view.ts:191`) — **not** a new words-list page. Rationale:

1. **B6 (words page) is out of scope** by the card's explicit instruction. There is no browsable
   saved-words surface today to put a per-row toggle on.
2. **The save-row is the one surface every saved word already passes through** — the moment a
   reader saves a word, that exact card is on screen. Surfacing "mark as known" right there, right
   after saving, is the cheapest, most discoverable place to put a 2-state manual toggle for an
   S-effort card.
3. This mirrors B1's own precedent almost exactly: B1 put the _save_ affordance on the lookup
   result surface, not a new page. B5 puts the _status_ affordance on the same surface, one step
   later in the same flow.

### Known, accepted limitation (documented, not a scope-fence break)

B1 established (see `content.ts:40-43` comment) that a **fresh render never round-trips to check
"is this already saved"** — `saved` always starts `false` and only becomes `true` after the reader
taps the star _in this session_. B5 inherits this: the status toggle is visible only once `saved`
is `true` in the current session (i.e., after the star is tapped). A reader who saved "bank" as
"known" last week and looks it up again today will see an unstarred card until they tap the star
again — at which point the **existing `saved.save` reply already carries the true, preserved
status** (see §3.1), so the toggle then shows the _correct_ current status, not a reset default.
Full visibility into "all my known words" without re-looking-up each one is exactly what B6 (out of
scope) will deliver. This is a pre-existing, accepted product tradeoff (B1's "Toggle semantics"),
not something B5 needs or is scoped to fix.

## 3. The change

### 3.0 E1 schema self-verification (attestation)

Per the pattern used successfully on B1/B2/B7 (roadmap §8 Decision Log, 2026-07-10 entries): this
spec was checked field-for-field against the owner-ratified E1 shape
(`docs/ROADMAP.md` §8, 2026-07-10 · B1/B2 entry) before any Hunter task was written.

**Attestation:** B5 makes **zero changes** to `SavedWordEntry`/`SavedWordSense`/`SavedWordStatus`
(`packages/app/src/domain/types.ts:219-251`). `status: SavedWordStatus` (`'learning' | 'known'`)
already exists verbatim per the ratified shape. B5 adds a **write path** to an existing field, not
a new field — no schema change, no additive field, nothing that touches the B2 lock. Confirmed by
reading `types.ts:219-251` directly; no diff to that file appears anywhere in this plan.

### 3.1 Domain — `packages/app/src/domain/saved-words-policy.ts`

Add one function, mirroring the existing null-safety idiom of `savedWordGet`/`savedWordDelete`:

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

Add `SavedWordStatus` to the existing type import at the top of the file.

### 3.2 Wire protocol — `packages/app/src/wire.ts`

New message `saved.setStatus`, reusing the existing `saved` reply shape (already carries a full
`entry`, no schema change needed there):

```ts
z.object({
  type: z.literal('saved.setStatus'),
  word: z.string(),
  status: z.enum(['learning', 'known']),
}),
```

Add to `WireMessageSchema`'s array and to `MessageTypeEnum`'s array (needed for the error-reply
type union).

### 3.3 Router — `packages/app/src/app/router.ts`

```ts
case 'saved.setStatus': {
  const entry = await deps.queue.run(() =>
    savedWordSetStatus({ storage: deps.kv }, msg.word, msg.status),
  );
  return entry ? { ok: true, type: 'saved', entry } : { ok: true, type: 'ack' };
}
```

Import `savedWordSetStatus` alongside the existing `savedWordUpsert`/`savedWordDelete` import.
Goes through `deps.queue.run` for the same write-serialization guarantee every other `saved.*`
mutation gets.

### 3.4 UI — `packages/app/src/ui/lookup-card.ts`

- Extend `CardState`'s `'result'` variant with `status?: SavedWordStatus` (doc comment: "B5:
  current status of a saved word — only meaningful when `saved === true`; absent/undefined hides
  the status toggle").
- `renderSaveRow(state: { word; saved?; status? })`: when `isSaved && state.status !== undefined`,
  append a second button `.status-btn` to the row, after the save button:
  - text: `'Known'` when `status === 'known'`, else `'Learning'`.
  - `aria-pressed`: `String(status === 'known')`.
  - `aria-label`: `` `Mark ${word} as learning` `` when already known, else
    `` `Mark ${word} as known` ``.
  - on click: dispatch a composed `toggle-status` event, `detail: { word }` (bubbles, composed —
    same shape as `toggle-save`; direction is computed by the listener, not carried in the event,
    exactly mirroring `toggle-save`'s own design).
- New CSS rules for `.status-btn`, token-only, mirroring `.save-btn`'s existing rule block
  (`--ad-line`, `--ad-ink-soft`, `--adp-radius-control`, `--ad-accent`, reduced-motion guard) with
  `margin-left` to sit beside the save button inside the existing flex `.save-row`.

### 3.5 `InlineBottomSheetRenderer` — `packages/app/src/app/inline-bottom-sheet-renderer.ts`

Add `setStatus(status: SavedWordStatus): void`, mirroring `setSaved`'s exact no-op guard:

```ts
setStatus(status: SavedWordStatus): void {
  if (this.lastState?.kind !== 'result') return;
  this.setState({ ...this.lastState, status });
}
```

Also clear `status: undefined` inside the existing `setSaved(false)` path (unsaving hides the
toggle via the `isSaved` gate already, but clearing state avoids a stale value if the state object
is inspected directly).

### 3.6 Composition roots — `packages/extension-chrome/src/content.ts` and `side-panel.ts`

Both files get the same, independent treatment (they already track `lastSavePayload`/`lastSaved`
independently per B1's design — the in-page card and the side panel are separate composition
roots that never sync each other's local state).

- New closure var `lastStatus: SavedWordStatus | undefined`, reset to `undefined` everywhere
  `lastSaved`/`lastSavePayload` are already reset (`renderLoading`/`renderResult` in content.ts;
  the panel's `trackSaveContext` in side-panel.ts).
- The existing `toggle-save` listener changes from fire-and-forget
  (`.catch(() => undefined)`) to reading the reply: on a successful save (`willSave === true` and
  the reply is `{ ok: true, type: 'saved', entry }`), set `lastStatus = entry.status` and call
  `inline.setStatus(lastStatus)` / the panel's own `setStatus(lastStatus)`. This is **not a new
  round trip** — the `saved.save` reply already carries `entry.status` today; B5 is the first
  caller to read it. On unsave (`willSave === false`), clear `lastStatus = undefined`.
- New `toggle-status` listener: no-op if `lastSavePayload` or `lastStatus` is `undefined`.
  Otherwise compute `next = lastStatus === 'known' ? 'learning' : 'known'`, optimistically set
  `lastStatus = next` and call `setStatus(next)` (matches `toggle-save`'s optimistic-then-fire
  style exactly), then `chrome.runtime.sendMessage({ type: 'saved.setStatus', word, status: next
})` fire-and-forget (`.catch(() => undefined)`, same as every other save-related message).

No change to `ChromeSidePanelMirror` — it never carried `saved` either (the panel manages its own
save/status state independently, per its own existing doc comment).

## 4. Scope fence (from the card, held exactly)

- **Exactly 2 states** (`'learning' | 'known'`) — no third state, no schema change.
- **Manual toggle only** — the reader must tap the status control. No automatic promotion from
  lookup count, time, or any signal.
- **No B6 words-list page.** The affordance lives on the existing save-row surface only.
- **No B3 highlighting change** — B3 (re-encounter highlighting) is a separate, future card; B5
  only makes the status persist correctly and toggleable. B3 will read `status` later.
- **No new wire round trip beyond what already exists** for save/delete — `saved.setStatus` is one
  new message, symmetric with `saved.save`/`saved.delete`.

## 5. Testing strategy

1. **Domain unit tests** (`packages/app/test/saved-words-policy.test.ts`): `savedWordSetStatus`
   flips an existing entry's status, preserves `senses`/`savedAt`, is case-insensitive (reuses
   `normalizeWordKey`), and returns `null` on an unknown word without throwing.
2. **Wire schema test** (`packages/app/test/wire-schema.test.ts` or equivalent): `saved.setStatus`
   round-trips through `WireMessageSchema`; an invalid `status` value is rejected.
3. **Router tests** (`packages/app/test/app/router.test.ts`): `saved.setStatus` on a saved word
   returns `{ ok: true, type: 'saved', entry }` with the flipped status; on an unsaved/unknown word
   returns `{ ok: true, type: 'ack' }` (idempotent, no throw).
4. **UI component tests** (`packages/app/test/ui/lookup-card.test.ts`): a saved result with
   `status: 'learning'` renders `.status-btn` with the right text/aria-pressed/aria-label; with
   `status: 'known'` the flipped state; an unsaved result (`saved` falsy) renders no `.status-btn`;
   clicking `.status-btn` fires a composed `toggle-status` event carrying `{ word }`.
5. **Renderer tests** (`packages/app/test/app/inline-bottom-sheet-renderer.test.ts`): `setStatus`
   re-renders the last result with the flipped status; no-op guard when the last state isn't a
   result / before any render (mirrors the existing `setSaved` test block exactly).
6. **e2e functional test** (new `packages/extension-chrome/e2e/b5-status-lifecycle.spec.ts`,
   following `saved-word.spec.ts`'s exact pattern — `mockGemini`, `seedSettings`, `doLookup`,
   `swStorageDump`): save a word → the status toggle appears showing "Learning" → click it → the
   button flips to "Known" and `chrome.storage.local`'s `saved:<word>` entry has `status: 'known'`
   → click again → flips back to "Learning" and storage reflects it. A second test covers the side
   panel's own toggle independently (mirrors `saved-word.spec.ts`'s existing "saving from the side
   panel" test).
7. **Evidence video** (new `packages/extension-chrome/e2e/b5-evidence.spec.ts`, modeled byte-for-
   byte on `b1-evidence.spec.ts`): select → Define → tap star (Saved) → tap the status toggle
   (Learning → Known). Recorded BEFORE (master build — no status toggle exists, only the star) and
   AFTER (branch build) into `.webm` files.

## 6. Evidence plan

- **Video**, not a screenshot — this is a behavior/flow change (multi-step interaction), per repo
  convention (`CLAUDE.md`: "video record for flow, behavior changes").
- BEFORE: build `master` (`bun run build:chrome` on a clean `master` checkout or via the evidence
  spec's `distDir` pointed at a master build), record the save flow — no status control exists
  after saving.
- AFTER: build the `feat/b5-status-lifecycle` branch, record select → Define → star → status
  toggle click (Learning → Known).
- Host both `.webm` files on the `pr-assets/b5-status-lifecycle` throwaway branch; embed only
  same-origin `https://github.com/<owner>/<repo>/raw/pr-assets/b5-status-lifecycle/...` URLs in the
  PR body (never `raw.githubusercontent.com`).

## 7. Risk / rollback

- **Risk:** low. Additive-only change — one new domain function, one new wire message (additive to
  a `discriminatedUnion`), one new router case, one new optional `CardState` field, one new UI
  button gated behind an existing conditional (`isSaved`), two new composition-root listeners.
  Nothing existing is modified in a breaking way; every touched function's existing behavior
  (`savedWordUpsert`, `saved.save`, `saved.delete`, `renderSaveRow`, `setSaved`) is covered by the
  existing regression suite, which must stay green.
- **Rollback:** revert the single PR. No data migration involved — `status` already exists on
  every stored entry (B1's default), so rollback leaves storage exactly as valid as it is today.

## 8. Files touched (summary)

| File                                                         | Change                                            |
| ------------------------------------------------------------ | ------------------------------------------------- |
| `packages/app/src/domain/saved-words-policy.ts`              | + `savedWordSetStatus`                            |
| `packages/app/src/wire.ts`                                   | + `saved.setStatus` message                       |
| `packages/app/src/app/router.ts`                             | + `saved.setStatus` case                          |
| `packages/app/src/ui/lookup-card.ts`                         | + `CardState.status`, `.status-btn` render + CSS  |
| `packages/app/src/app/inline-bottom-sheet-renderer.ts`       | + `setStatus`                                     |
| `packages/extension-chrome/src/content.ts`                   | + `lastStatus` tracking, `toggle-status` listener |
| `packages/extension-chrome/src/side-panel.ts`                | + `lastStatus` tracking, `toggle-status` listener |
| `packages/app/test/saved-words-policy.test.ts`               | + tests                                           |
| `packages/app/test/wire-schema.test.ts`                      | + tests                                           |
| `packages/app/test/app/router.test.ts`                       | + tests                                           |
| `packages/app/test/ui/lookup-card.test.ts`                   | + tests                                           |
| `packages/app/test/app/inline-bottom-sheet-renderer.test.ts` | + tests                                           |
| `packages/extension-chrome/e2e/b5-status-lifecycle.spec.ts`  | new — functional e2e                              |
| `packages/extension-chrome/e2e/b5-evidence.spec.ts`          | new — evidence video                              |

No change to `packages/app/src/domain/types.ts`, `packages/app/src/ports.ts`, or
`packages/extension-chrome/src/adapters/chrome-side-panel-mirror.ts`.
