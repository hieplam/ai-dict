# B14 — Sense-aware dedup

Roadmap card: `docs/ROADMAP.md` §4 B14 (Impact 3 · Effort M · Score 1.5). Depends on: B1 (shipped).
Uses the `senses[]` field from B2's ratified E1 schema (already shipped, unchanged by this card).

## 1. Problem (grounded in code)

Today, saving an already-saved headword silently overwrites its single stored sense instead of
building a real multi-sense collection:

- `SavedWordEntry.senses` is already an array (`packages/app/src/domain/types.ts:246-251`), and its
  own doc comment says so explicitly: _"`senses` starts as a single-entry array; growing it into a
  real multi-sense collection is B14's job."_ (`types.ts:243-244`).
- `savedWordUpsert` (`packages/app/src/domain/saved-words-policy.ts:41-68`) already reads any
  existing entry for the normalized word key (`existingRaw`/`existing`, lines 47-48) and preserves
  `status`/`savedAt` from it (lines 58-59) — but line 60 always does
  `senses: [sense]`, i.e. **replaces** the entry's entire sense list with just the incoming one. The
  function's own doc comment names this exactly: _"REPLACES its single `senses[0]` with the fresh
  context (last-write-wins — B14's job is turning this into a real multi-sense merge)."_
  (`saved-words-policy.ts:37-39`).
- The router's `saved.save` handler (`packages/app/src/app/router.ts:242-257`) calls
  `savedWordUpsert` unconditionally and always returns `{ ok: true, type: 'saved', entry }` — there
  is no branch today that can say "wait, are you sure?" before overwriting.
- The behavior is asserted as CORRECT today by an existing unit test, which will need to change as
  part of this card:
  `packages/app/test/saved-words-policy.test.ts:64-76` — _"upsert on an existing (case-insensitive)
  word preserves savedAt/status, replaces senses"_ — its own inline comment reads
  `// replaced, not accumulated (B14's job)` (line 74). The matching router-level assertion is
  `packages/app/test/app/router.test.ts:474-500` — _"a second saved.save for the same word
  (different casing) preserves savedAt, replaces senses."_
- Concretely: select "bank" in a hiking article, save it → `senses: [{sentence: "the trail follows
the bank of the river", ...}]`. Later select "bank" in a finance article, save it again → the
  hiking sense is gone; `senses` now holds only the finance sentence. Nothing on the UI told the
  reader this happened — the star simply reads "Saved" both times.

Word matching is already exactly what the card's scope fence requires and needs no change:
`normalizeWordKey` (`saved-words-policy.ts:25-27`) is `word.trim().toLowerCase()` — case-insensitive,
no stemming — so "Bank"/"bank"/"BANK" collide on one entry while "run"/"running" never do. This is
cited, not modified (§4.7 below).

## 2. Design questions (the card's "Lead decides" list, pinned)

### 2.1 Merge-prompt UX — where it renders, and how

**Pinned: an inline prompt appended to the save row's card, the same on-demand-append pattern the
error-reporting consent footer already uses — not a new `CardState` field.**

The card already has exactly this shape of problem solved once: `buildConsentFooter`
(`packages/app/src/ui/error-consent.ts`) builds a light-DOM node with a question + two buttons
("Send reports" / "Not now"), and the composition root appends it on demand via
`InlineBottomSheetRenderer.appendToCard(node)` (`inline-bottom-sheet-renderer.ts:118-122`) after an
**async signal arrives following a render** — precisely B14's shape: render the result → the reader
clicks Save → an async `saved.save` reply comes back → _then_ decide whether to show a prompt.
`content.ts`'s `maybeShowConsent` (`content.ts:118-136`) is the existing call site for this pattern.

B14 adds a sibling helper, `buildMergePrompt` (new file `packages/app/src/ui/merge-prompt.ts`),
appended the same way immediately below the save row, inside the card, the instant a
`saved.save` reply comes back `type: 'saved.conflict'` (§2.3). Two buttons: **"Add as new sense"**
and **"Not now"** — mirrors `buildConsentFooter`'s exact button pattern and copy register.

**Rejected alternative — a new `CardState.mergePrompt` field threaded through `renderCardState`.**
This would require every `renderResult`/`resultToFocus` call site (`inline-bottom-sheet-renderer.ts`,
`side-panel.ts`) to carry a new transient field end-to-end from the router reply through to the
render layer, and would make `renderCardState` (a _pure_, synchronous function today) responsible
for state that only exists because of an _async_ follow-up message — exactly the coupling
`buildConsentFooter`'s design already avoids. The append-on-demand pattern needs zero `CardState`
surface change and reuses a proven mechanism verbatim.

**Rejected alternative — a native `confirm()` dialog.** Blocks the tab, cannot be tokened/themed,
and every other yes/no decision in this codebase (errlog consent, nudge dismiss) uses an in-card
row — a native dialog would be the one inconsistent surface.

The panel is its own composition root (per B1's design — `side-panel.ts` tracks its own
`lastSavePayload`/`lastSaved` independently of `content.ts`, see `side-panel.ts:38-54`) and has no
`appendToCard` equivalent today (`SidePanelView` renders every state via direct
`replaceChildren` inside its `focusState` setter — `side-panel-view.ts:173-176,190-193` — no node
can be appended without being wiped by the next state write). §4.4 adds one: `appendToFocus`,
mirroring `InlineBottomSheetRenderer.appendToCard`'s exact contract.

### 2.2 Duplicate-sense detection

**Pinned: exact `sentence === sentence && url === url` string equality against every already-stored
sense. A match is a silent no-op — no write, no prompt, reply as if the save simply succeeded.**

This covers the common "I clicked Save twice" / "I re-opened the same passage and saved again"
case, where offering a merge prompt would be pure friction for context that's already stored
verbatim. `sentence`+`url` (not `sentence` alone) is the pair: two identical sentences quoted on two
different pages are two different encounters worth keeping as separate senses (e.g. a proverb quoted
on two different sites) — the roadmap card's "1. riverside (hiking blog) · 2. money business (FT)"
example is itself keyed by source, not by sentence text alone.

**Rejected alternative — fuzzy/normalized comparison** (trim, case-fold, punctuation-strip) before
comparing sentences. Rejected for the same reason the card's own headword-matching fence stays exact
(§4.7): a normalizer risks collapsing two genuinely different quotes (a sentence re-quoted with
different punctuation from a paywalled vs. cached version of the same article, for instance) into a
false "duplicate," silently dropping context the reader explicitly saved twice on purpose. Exact
string equality is the same conservative default the case-insensitive-exact-match fence already
uses one level up (headword), so keeping matching exact end-to-end reads as one policy, not two.

### 2.3 Decline path

**Pinned: decline = no write. Nothing is persisted; the existing entry is untouched.** The roadmap
card is explicit that a separate entry is FORBIDDEN, and the design in §4.1/§4.2 below guarantees
this mechanically: the router **never writes** when it detects a genuine conflict (differing
sentence/url on an already-saved word) unless the caller explicitly re-sends the save with
`confirmNewSense: true`. "Not now" simply removes the prompt UI and does nothing else — there is
no separate wire message for decline, because there is nothing to tell the backend (it already
did zero writes when it replied `saved.conflict`).

### 2.4 Wire changes

**Pinned: extend the existing `saved.save` message with one optional field
(`confirmNewSense?: boolean`); add one new reply variant (`type: 'saved.conflict'`). No new message
type, so this is NOT a case where the "wire arm + router case in one task" rule
(CONTRACTS §2) applies to a _brand-new_ discriminated-union member on the request side — but the
reply-side addition and the `saved.save` handler change are still landed in one task together
because they're two ends of the same round-trip (see the plan's Task 2).**

Grounding — `saved.save`'s current payload (`wire.ts:111-119`):

```ts
z.object({
  type: z.literal('saved.save'),
  word: z.string(),
  definition: z.string(),
  translation: z.string(),
  sentence: z.string(),
  url: z.string(),
  title: z.string(),
}),
```

and its current reply (`wire.ts:175`): `{ ok: true, type: 'saved', entry: SavedWordEntrySchema }`
via `router.ts:242-257`'s unconditional `savedWordUpsert` call.

Per the A8/B2/B7 precedent recorded in `docs/ROADMAP.md` §8 (2026-07-10 entry) and restated in
CONTRACTS §3 — _"optional in-flight request/response fields are ordinary evolution, not an
escalation"_ — adding `confirmNewSense?: boolean` to the request and a new `ok:true` reply arm is
routine wire evolution, not an E1-class schema change: **the persisted `SavedWordEntry`/
`SavedWordSense` shapes (`types.ts:223-251`) are completely untouched by this card** — B14 only
changes how the _existing_ `senses[]` array grows, never its shape.

**Rejected alternative — a brand-new message type (e.g. `saved.checkConflict`) sent _before_
`saved.save`, so the UI always knows up front whether it's a fresh save or a merge.** Rejected: it
would double the round trips for the overwhelmingly common case (first-ever save of a word, or an
exact-duplicate re-save — §2.2), doesn't fit the "reuse `connection.test`'s existing schema" spirit
CONTRACTS §3's precedent favors, and creates two request types (`saved.checkConflict` +
`saved.save`) that must always be called in lockstep — more surface for the same outcome the
single-message two-attempt flow already gets for free (attempt → conflict signal → explicit
re-attempt with `confirmNewSense: true`).

**Rejected alternative — silently append without ever asking.** Directly violates the roadmap
card's own text: _"offer 'add as a new sense?'"_ — a confirmation step is the feature, not an
implementation detail.

## 3. Toggle semantics recap (grounding for §4)

Per B1's design (`content.ts:42-63`, `side-panel.ts:35-54`): a fresh `renderResult` always seeds
`lastSaved = false` (no is-already-saved round trip) and a fresh save/status reply is guarded by
`createSaveReplyGuard()` (`packages/app/src/app/save-reply-guard.ts`) so a stale async reply can
never resurrect state a later click/render has superseded. B14 reuses both mechanisms unchanged —
the merge-prompt's own follow-up `saved.save` (with `confirmNewSense: true`) gets its own fresh
guard token (§4.5/§4.6), exactly like the original click did.

## 4. The change

### 4.1 `packages/app/src/domain/saved-words-policy.ts` — sense-aware `savedWordUpsert`

`savedWordUpsert`'s signature and return type change (single production call site: `router.ts`'s
`saved.save` case, §4.2):

```ts
export type SavedWordUpsertResult =
  | { kind: 'saved'; entry: SavedWordEntry }
  | { kind: 'conflict'; senseCount: number };

export async function savedWordUpsert(
  deps: SavedWordsDeps,
  input: SavedWordInput,
  opts: { confirmNewSense?: boolean } = {},
): Promise<SavedWordUpsertResult> {
  const key = normalizeWordKey(input.word);
  const now = deps.now ?? Date.now;
  const existingRaw = await deps.storage.getItem(`saved:${key}`);
  const existing = existingRaw ? (JSON.parse(existingRaw) as SavedWordEntry) : null;
  const sense: SavedWordSense = {
    definition: input.definition,
    translation: input.translation,
    sentence: input.sentence,
    url: input.url,
    title: input.title,
  };

  if (existing) {
    const isDuplicate = existing.senses.some(
      (s) => s.sentence === sense.sentence && s.url === sense.url,
    );
    if (isDuplicate) return { kind: 'saved', entry: existing };

    if (opts.confirmNewSense !== true) {
      return { kind: 'conflict', senseCount: existing.senses.length };
    }

    const entry: SavedWordEntry = {
      ...existing,
      word: input.word, // latest casing wins for display — same rule every prior write already used
      senses: [...existing.senses, sense],
    };
    await deps.storage.setItem(`saved:${key}`, JSON.stringify(entry));
    return { kind: 'saved', entry };
  }

  const entry: SavedWordEntry = {
    word: input.word,
    status: 'learning',
    savedAt: now(),
    senses: [sense],
  };
  await deps.storage.setItem(`saved:${key}`, JSON.stringify(entry));
  const idx = [key, ...(await readIndex(deps.storage))];
  await deps.storage.setItem(INDEX_KEY, JSON.stringify(idx));
  return { kind: 'saved', entry };
}
```

Behavior by case:

| Case                   | Existing entry? | Sentence+url match a stored sense? | `confirmNewSense` | Result                                                                                                              |
| ---------------------- | --------------- | ---------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------- |
| Brand-new word         | no              | —                                  | —                 | `{kind:'saved', entry}` — create, 1 sense, `status:'learning'`                                                      |
| Exact repeat           | yes             | yes                                | —                 | `{kind:'saved', entry}` — **no write**, returns the unchanged existing entry                                        |
| New sense, unconfirmed | yes             | no                                 | absent/false      | `{kind:'conflict', senseCount}` — **no write**                                                                      |
| New sense, confirmed   | yes             | no                                 | `true`            | `{kind:'saved', entry}` — appended, `senses.length` grows by 1, `status`/`savedAt` preserved, `word` casing updated |

`savedWordSetStatus`/`savedWordGet`/`savedWordDelete`/`savedWordsList`/`savedWordsClear` are
unmodified — none of them touch `senses[]` shape or call `savedWordUpsert`.

### 4.2 `packages/app/src/wire.ts` — `confirmNewSense` field + `saved.conflict` reply

Add to `saved.save`'s schema (`wire.ts:111-119`):

```ts
z.object({
  type: z.literal('saved.save'),
  word: z.string(),
  definition: z.string(),
  translation: z.string(),
  sentence: z.string(),
  url: z.string(),
  title: z.string(),
  confirmNewSense: z.boolean().optional(),
}),
```

Add a new `WireReplySchema` arm, right after the existing `saved` arm (`wire.ts:175`):

```ts
z.object({
  ok: z.literal(true),
  type: z.literal('saved.conflict'),
  word: z.string(),
  senseCount: z.number(),
}),
```

`MessageTypeEnum` (`wire.ts:143-158`, used only by the generic `ok:false` error reply arm's `type`
field) is unchanged — `saved.conflict` is never a _request_ type a client sends, only a reply
literal riding on a `saved.save` round trip, so it has no place in that enum. The compile-time drift
guard (`wire.ts:201-209`) is unaffected: it checks `SavedWordEntrySchema` against the domain
`SavedWordEntry` type, and neither changes shape.

### 4.3 `packages/app/src/app/router.ts` — `saved.save` handler branches on conflict

Replace the `saved.save` case (`router.ts:242-257`):

```ts
case 'saved.save': {
  const result = await deps.queue.run(() =>
    savedWordUpsert(
      { storage: deps.kv },
      {
        word: msg.word,
        definition: msg.definition,
        translation: msg.translation,
        sentence: msg.sentence,
        url: msg.url,
        title: msg.title,
      },
      { confirmNewSense: msg.confirmNewSense === true },
    ),
  );
  return result.kind === 'conflict'
    ? { ok: true, type: 'saved.conflict', word: msg.word, senseCount: result.senseCount }
    : { ok: true, type: 'saved', entry: result.entry };
}
```

Still runs inside `deps.queue.run(...)` (the existing `WriteQueue`), so two concurrent `saved.save`
calls for the same word (e.g. a rapid double-click, already guarded client-side by
`createSaveReplyGuard`, but the router itself must also stay correct under a hypothetical second
sender) are serialized — the second call's read of `existing` always sees the first call's write,
never a stale snapshot. This was already true before B14 (the queue already wraps
`savedWordUpsert`); B14 doesn't change the concurrency shape, only what the wrapped function decides.

### 4.4 `packages/app/src/ui/side-panel-view.ts` — `appendToFocus`

New public method, mirroring `InlineBottomSheetRenderer.appendToCard` (`inline-bottom-sheet-renderer.ts:118-122`):

```ts
/**
 * B14: append an extra light-DOM node (the sense-merge prompt) into the panel's focus region
 * without a full re-render. Mirrors InlineBottomSheetRenderer.appendToCard's contract exactly —
 * false when the focus region isn't currently showing a result (nothing sensible to append to).
 */
appendToFocus(node: Node): boolean {
  if (this._focus.kind !== 'result') return false;
  this.focusEl.append(node);
  return true;
}
```

Placed directly after the `renderFocus()` private method (`side-panel-view.ts:190-193`), as a public
method on the `SidePanelView` class (same file, no new export needed — the class itself is already
exported).

New CSS (added to `side-panel-view.ts`'s `CSS` template, directly after the existing
`.focus .save-btn[aria-pressed="true"] svg{...}` rule at line 67 and its reduced-motion block at
line 68):

```css
.focus .merge-prompt {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0 0 10px;
  padding: 10px 12px;
  border: 1px solid var(--ad-line-strong);
  border-radius: var(--adp-radius-control);
  background: var(--ad-surface-raised);
}
.focus .merge-prompt-text {
  margin: 0;
  font-size: var(--adp-text-xs);
  color: var(--ad-ink);
}
.focus .merge-prompt-actions {
  display: flex;
  gap: 8px;
}
.focus .merge-prompt-add {
  flex: none;
  border: 1px solid var(--ad-accent);
  background: var(--ad-accent);
  color: var(--ad-on-accent);
  border-radius: var(--adp-radius-control);
  padding: 5px 12px;
  font: inherit;
  font-size: var(--adp-text-xs);
  font-weight: var(--adp-weight-semi);
  cursor: pointer;
}
.focus .merge-prompt-add:hover {
  filter: brightness(1.06);
}
.focus .merge-prompt-add:focus-visible {
  outline: 2px solid var(--ad-accent);
  outline-offset: 2px;
}
.focus .merge-prompt-dismiss {
  flex: none;
  border: 1px solid var(--ad-line);
  background: transparent;
  color: var(--ad-ink-soft);
  border-radius: var(--adp-radius-control);
  padding: 5px 12px;
  font: inherit;
  font-size: var(--adp-text-xs);
  cursor: pointer;
}
.focus .merge-prompt-dismiss:hover {
  background: var(--ad-surface-raised);
  color: var(--ad-ink);
}
.focus .merge-prompt-dismiss:focus-visible {
  outline: 2px solid var(--ad-accent);
  outline-offset: 2px;
}
```

Token-only (`--ad-*`/`--adp-*`), no hard-coded colors, no `prefers-color-scheme` branch — matches
every existing rule in this file.

### 4.5 New file `packages/app/src/ui/merge-prompt.ts` — `buildMergePrompt`

Mirrors `error-consent.ts`'s `buildConsentFooter` shape exactly (same file size, same DOM-building
style, same "light-DOM node projected through the card slot" contract):

```ts
/**
 * B14: the "add as a new sense?" merge prompt, appended on demand to the card/panel when a
 * saved.save reply comes back `type: 'saved.conflict'` (the headword is already saved under a
 * DIFFERENT sentence/url than the one just submitted — see the design spec §2.1/§2.4). Mirrors
 * error-consent.ts's buildConsentFooter: a light-DOM node appended via
 * InlineBottomSheetRenderer.appendToCard / SidePanelView.appendToFocus, never baked into
 * CardState/renderCardState, so the pure card-state renderer stays untouched.
 */
export function buildMergePrompt(opts: {
  word: string;
  senseCount: number;
  onChoice: (add: boolean) => void;
}): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'merge-prompt';

  const text = document.createElement('p');
  text.className = 'merge-prompt-text';
  text.textContent =
    opts.senseCount === 1
      ? `You already saved "${opts.word}" from a different sentence. Add this as a new sense?`
      : `"${opts.word}" already has ${opts.senseCount} saved senses. Add this one too?`;
  wrap.appendChild(text);

  const row = document.createElement('div');
  row.className = 'merge-prompt-actions';

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'merge-prompt-add';
  add.textContent = 'Add as new sense';
  add.addEventListener('click', () => opts.onChoice(true));

  const not = document.createElement('button');
  not.type = 'button';
  not.className = 'merge-prompt-dismiss';
  not.textContent = 'Not now';
  not.addEventListener('click', () => opts.onChoice(false));

  row.append(add, not);
  wrap.appendChild(row);
  return wrap;
}
```

Exported from the barrel: `packages/app/src/index.ts` gains
`export { buildMergePrompt } from './ui/merge-prompt';` right after the existing
`export { buildConsentFooter } from './ui/error-consent';` line.

### 4.6 `packages/app/src/ui/lookup-card.ts` — CSS only, no logic change

`renderSaveRow`/`renderCardState`/`CardState` are **not modified** (§2.1's pinned rejection). Only
CSS additions, both additive (no existing rule touched):

In the shadow `CSS` template, right after the existing
`::slotted(.nudge-row){...}` line (`lookup-card.ts:139`, the last rule before the closing
backtick), add:

```css
::slotted(.merge-prompt) {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0 0 10px;
  padding: 10px 12px;
  border: 1px solid var(--ad-line-strong);
  border-radius: var(--adp-radius-control);
  background: var(--ad-surface-raised);
}
```

In `CARD_DOC_CSS` (`lookup-card.ts:145-180`), right after the last `.nudge-row__dismiss-btn:focus-visible{...}` rule
(line 180, immediately before the closing backtick), add — same reasoning as the existing comment
at `lookup-card.ts:141-144` (`::slotted()` cannot reach a slotted node's own descendants, so button
chrome for elements _inside_ `.merge-prompt` needs a document-scoped rule, exactly like
`.nudge-row__save-btn`/`.nudge-row__dismiss-btn` already get):

```css
lookup-card .merge-prompt-text {
  margin: 0;
  font-size: var(--adp-text-xs);
  color: var(--ad-ink);
}
lookup-card .merge-prompt-actions {
  display: flex;
  gap: 8px;
}
lookup-card .merge-prompt-add {
  flex: none;
  border: 1px solid var(--ad-accent);
  background: var(--ad-accent);
  color: var(--ad-on-accent);
  border-radius: var(--adp-radius-control);
  padding: 5px 12px;
  font: inherit;
  font-size: var(--adp-text-xs);
  font-weight: var(--adp-weight-semi);
  cursor: pointer;
}
lookup-card .merge-prompt-add:hover {
  filter: brightness(1.06);
}
lookup-card .merge-prompt-add:focus-visible {
  outline: 2px solid var(--ad-accent);
  outline-offset: 2px;
}
lookup-card .merge-prompt-dismiss {
  flex: none;
  border: 1px solid var(--ad-line);
  background: transparent;
  color: var(--ad-ink-soft);
  border-radius: var(--adp-radius-control);
  padding: 5px 12px;
  font: inherit;
  font-size: var(--adp-text-xs);
  cursor: pointer;
}
lookup-card .merge-prompt-dismiss:hover {
  background: var(--ad-surface);
  color: var(--ad-ink);
}
lookup-card .merge-prompt-dismiss:focus-visible {
  outline: 2px solid var(--ad-accent);
  outline-offset: 2px;
}
```

### 4.7 No change to headword matching

`normalizeWordKey` (`saved-words-policy.ts:25-27`) already implements the card's scope fence exactly
("case-insensitive exact headword match only; 'run'/'running' stay separate in v1") —
`word.trim().toLowerCase()` has no stemming/lemmatization, so distinct inflections never collide.
This card cites it and adds no code here.

### 4.8 No change to `packages/app/src/domain/types.ts`

`SavedWordEntry`/`SavedWordSense`/`SavedWordStatus` (`types.ts:223-251`) are byte-for-byte unchanged
— the E1-ratified shape stays exactly what B1/B2/B7 already shipped and verified. B14 only changes
_how many_ elements `senses[]` grows to and _when_ — never the shape of an element or the entry.

### 4.9 `packages/extension-chrome/src/content.ts` — conflict branch in the `toggle-save` listener

Replace the `toggle-save` listener (`content.ts:150-171`):

```ts
document.addEventListener('toggle-save', () => {
  if (!lastSavePayload) return;
  const willSave = !lastSaved;
  lastSaved = willSave;
  inline.setSaved(willSave);
  if (!willSave) lastStatus = undefined;
  const token = saveReplyGuard.next();
  const message = willSave
    ? { type: 'saved.save' as const, ...lastSavePayload }
    : { type: 'saved.delete' as const, word: lastSavePayload.word };
  void chrome.runtime
    .sendMessage(message)
    .then((raw: unknown) => {
      if (!saveReplyGuard.isCurrent(token)) return; // a later click/render already superseded this reply
      const reply = raw as WireReply | undefined;
      if (willSave && reply?.ok && reply.type === 'saved') {
        lastStatus = reply.entry.status;
        inline.setStatus(lastStatus);
      } else if (willSave && reply?.ok && reply.type === 'saved.conflict') {
        // B14: the headword is already saved under a different sentence/url. Nothing was
        // written server-side — revert the optimistic star and ask before appending a new sense.
        lastSaved = false;
        inline.setSaved(false);
        const payload = lastSavePayload;
        const prompt = buildMergePrompt({
          word: reply.word,
          senseCount: reply.senseCount,
          onChoice: (add) => {
            prompt.remove();
            if (!add) return; // decline = no write (B14 fence) — nothing was ever persisted
            lastSaved = true;
            inline.setSaved(true);
            const token2 = saveReplyGuard.next();
            void chrome.runtime
              .sendMessage({ type: 'saved.save' as const, ...payload, confirmNewSense: true })
              .then((raw2: unknown) => {
                if (!saveReplyGuard.isCurrent(token2)) return;
                const reply2 = raw2 as WireReply | undefined;
                if (reply2?.ok && reply2.type === 'saved') {
                  lastStatus = reply2.entry.status;
                  inline.setStatus(lastStatus);
                }
              })
              .catch(() => undefined);
          },
        });
        inline.appendToCard(prompt);
      }
    })
    .catch(() => undefined);
});
```

`payload` is captured from `lastSavePayload` at the moment the conflict reply is applied — by
construction this only runs when `saveReplyGuard.isCurrent(token)` is still true, i.e. no fresh
render/click has superseded this exact save attempt, so `lastSavePayload` is guaranteed to be the
same object the reader was looking at when they clicked Save. A later render always calls
`inline.renderResult`/`renderLoading` → `setState` → `ensureCard().replaceChildren(...)`
(`inline-bottom-sheet-renderer.ts:74-82`), which wipes every light-DOM child of the card, including
any still-appended `.merge-prompt` — so a stale prompt can never remain clickable once a fresh
lookup starts; there is no dangling-node scenario to additionally guard against.

Import addition at the top of `content.ts`: `buildMergePrompt` added to the existing
`@ai-dict/app` import list (`content.ts:1-11`).

### 4.10 `packages/extension-chrome/src/side-panel.ts` — same conflict branch, panel composition root

Replace the `toggle-save` listener (`side-panel.ts:179-200`):

```ts
view.addEventListener('toggle-save', () => {
  if (!lastSavePayload) return;
  const willSave = !lastSaved;
  lastSaved = willSave;
  setSaved(willSave);
  if (!willSave) lastStatus = undefined;
  const token = saveReplyGuard.next();
  const message = willSave
    ? { type: 'saved.save' as const, ...lastSavePayload }
    : { type: 'saved.delete' as const, word: lastSavePayload.word };
  void chrome.runtime
    .sendMessage(message)
    .then((raw: unknown) => {
      if (!saveReplyGuard.isCurrent(token)) return; // a later click/render already superseded this reply
      const reply = raw as WireReply | undefined;
      if (willSave && reply?.ok && reply.type === 'saved') {
        lastStatus = reply.entry.status;
        setStatus(lastStatus);
      } else if (willSave && reply?.ok && reply.type === 'saved.conflict') {
        // B14: mirrors content.ts's own conflict branch — the panel is its own independent
        // composition root (same reasoning as trackSaveContext's B1-era comment above).
        lastSaved = false;
        setSaved(false);
        const payload = lastSavePayload;
        const prompt = buildMergePrompt({
          word: reply.word,
          senseCount: reply.senseCount,
          onChoice: (add) => {
            prompt.remove();
            if (!add) return; // decline = no write (B14 fence)
            lastSaved = true;
            setSaved(true);
            const token2 = saveReplyGuard.next();
            void chrome.runtime
              .sendMessage({ type: 'saved.save' as const, ...payload, confirmNewSense: true })
              .then((raw2: unknown) => {
                if (!saveReplyGuard.isCurrent(token2)) return;
                const reply2 = raw2 as WireReply | undefined;
                if (reply2?.ok && reply2.type === 'saved') {
                  lastStatus = reply2.entry.status;
                  setStatus(lastStatus);
                }
              })
              .catch(() => undefined);
          },
        });
        view.appendToFocus(prompt);
      }
    })
    .catch(() => undefined);
});
```

Import addition: `buildMergePrompt` added to the existing `@ai-dict/app` import list
(`side-panel.ts:1-13`).

### 4.11 No change to `packages/app/src/app/inline-bottom-sheet-renderer.ts`

`appendToCard` (`inline-bottom-sheet-renderer.ts:118-122`) already does exactly what §4.9 needs —
append a light-DOM node into the currently-open card, returning `false` if none is open. Zero lines
change in this file.

### 4.12 No change to `packages/app/src/ports.ts`, `manifest.json`, or `settings-form.ts`

No new port, no new permission, no settings field — B14 is a pure save-flow addition on top of
already-wired surfaces.

## 5. Scope fence (from the card, held exactly)

- **Case-insensitive exact headword match only** — `normalizeWordKey` unchanged (§4.7); "run"/
  "running" never collide.
- **Uses the `senses[]` field from B2's ratified schema** — `SavedWordEntry`/`SavedWordSense`
  completely unmodified (§4.8); this card is additive behavior on an already-ratified array field,
  not a schema change, so it needs no new E1-style escalation (CONTRACTS §3's precedent).
- **A separate entry is FORBIDDEN** — mechanically impossible by construction: the only two things
  `savedWordUpsert` can do to an _existing_ entry are append to `senses[]` (confirmed) or leave it
  untouched (conflict/no-op) — there is no code path that creates a second `saved:<key>` record for
  an already-normalized word.
- **Decline = no write** — §2.3/§4.1's `conflict` branch never calls `storage.setItem`.
- **No background LLM calls** — this card makes zero LLM calls of any kind (constraint 4 is
  vacuously satisfied; nothing here touches `LookupClient`).
- **Tokens only, reduced-motion honored** — `.merge-prompt*` CSS reads only `--ad-*`/`--adp-*`
  (§4.4/§4.6); no new animation is introduced so no new reduced-motion rule is needed (the prompt
  appears/disappears via DOM insert/removal, not a CSS transition).

## 6. Testing strategy

### 6.1 Unit — `packages/app/test/saved-words-policy.test.ts`

Full-file rewrite (every `savedWordUpsert` call site's return shape changes from a bare entry to
`{kind, entry?}` — see the plan's Task 1 for the complete file). New/changed cases:

- Creating a brand-new entry returns `{kind:'saved', entry}` with one sense.
- A second `saved` call for the same (case-insensitively) word with a **different** sentence/url,
  no `confirmNewSense` → returns `{kind:'conflict', senseCount:1}`; storage is byte-identical to
  before the second call (no write happened).
- The same second call **with** `confirmNewSense:true` → returns `{kind:'saved', entry}` with
  `senses.length === 2`, `savedAt`/`status` preserved from the first save, `word` casing updated to
  the second call's casing.
- A second call with the **exact same** sentence+url as an existing sense → returns
  `{kind:'saved', entry}` unchanged (no write, `senses.length` stays 1) — even without
  `confirmNewSense`.
- `savedWordSetStatus`/`savedWordGet`/`savedWordDelete`/`savedWordsList`/`savedWordsClear` tests
  updated only for the `.entry` unwrap where they call `savedWordUpsert` as setup; their own
  assertions are unchanged.

### 6.2 Unit — `packages/app/test/app/router.test.ts`

- `saved.save` on a brand-new word still replies `{ok:true, type:'saved', entry}` (existing test,
  minimal changes).
- A second `saved.save` for the same word, different sentence, no `confirmNewSense` → replies
  `{ok:true, type:'saved.conflict', word, senseCount:1}`; a follow-up `saved.save` with
  `confirmNewSense:true` → replies `{ok:true, type:'saved', entry}` with 2 senses.
- `history.clear`/`cache.clear` still never touch `saved:*` (existing regression test, unchanged).

### 6.3 Unit — `packages/app/test/wire-schema.test.ts`

- `saved.save` with `confirmNewSense: true` parses; `saved.save` without it still parses (field is
  optional, back-compat with every existing message in flight).
- A `{ok:true, type:'saved.conflict', word, senseCount}` reply parses; rejects a `saved.conflict`
  reply missing `senseCount` or with a non-numeric one.
- The JSON-schema snapshot test (`wire-schema.test.ts:405-409`) is regenerated (Task 2's Step 3).

### 6.4 Unit — `packages/app/test/ui/merge-prompt.test.ts` (new)

Mirrors `error-consent.test.ts` exactly: renders two buttons, "Add as new sense" click fires
`onChoice(true)`, "Not now" click fires `onChoice(false)`, copy contains the word and reflects
`senseCount` (singular vs. plural phrasing).

### 6.5 Unit — `packages/app/test/ui/side-panel-view.test.ts`

New test: `appendToFocus` returns `false` on the empty state, `true` once a result is showing, and
the appended node becomes a child of the focus region — mirrors
`inline-bottom-sheet-renderer.test.ts:173-182`'s `appendToCard` test exactly.

### 6.6 e2e — new `packages/extension-chrome/e2e/b14-sense-aware-dedup.spec.ts`

1. Look up "bank" in one fixture sentence, save it (`senses.length === 1`).
2. Navigate to a fixture with a **different** sentence (same fixture URL — `gotoFixture` always
   serves `http://test.fixture/`), look up "bank" again, click Save → assert the star reverts to
   unsaved (`aria-pressed="false"`) and `.merge-prompt` becomes visible with "Add as new sense"/
   "Not now" — and assert storage still shows exactly 1 sense (nothing written yet).
3. Click "Add as new sense" → assert the star returns to `aria-pressed="true"`, the prompt is
   removed, and storage now shows `senses.length === 2`.
4. A companion test: click "Not now" instead → assert the prompt is removed, the star stays
   unsaved, and storage is unchanged at 1 sense (decline = no write).

### 6.7 Testing performed policy

Per this worktree's `CLAUDE.md` (owner ruling 2026-07-16): **no screenshots or video for this PR.**
The PR body's "Testing performed" section carries the evidence instead — suites run, test counts,
e2e scenarios exercised, gates passed (lint, format check, typecheck, unit, e2e) — matching exactly
what §6.1–6.6 enumerate.

## 7. Risk / rollback

- **Risk: low-moderate.** The only behavior-changing logic is `savedWordUpsert`'s new branch
  (§4.1); it has exactly one production caller (`router.ts`'s `saved.save` case), so the blast
  radius is fully enumerated by §6.1/§6.2's tests. A bug here could either (a) silently overwrite a
  sense again (regressing to pre-B14 behavior — caught by the "different sentence → conflict, not a
  write" unit tests) or (b) wrongly flag an exact repeat as a conflict (caught by the
  duplicate-sense unit test).
- **No data migration.** `SavedWordEntry`/`SavedWordSense` are byte-for-byte unchanged (§4.8);
  every existing saved word with a single sense continues to read exactly as it does today. A word
  saved once, ever, is completely unaffected by this card.
- **Rollback:** revert the single PR. `savedWordUpsert` and `saved.save`'s handler return to
  last-write-wins; no stored data becomes invalid (a multi-sense entry created under B14 simply
  keeps its extra senses — nothing about the E1 shape becomes unreadable by pre-B14 code, since
  `senses[]` was already an array before this card).

## 8. Files touched (summary)

| File                                                          | Change                                                                                         |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `packages/app/src/domain/saved-words-policy.ts`               | `savedWordUpsert` sense-aware merge/conflict/duplicate logic, new `SavedWordUpsertResult` type |
| `packages/app/test/saved-words-policy.test.ts`                | Full-file update for the new return shape + new conflict/duplicate/confirm cases               |
| `packages/app/src/wire.ts`                                    | `saved.save` gains `confirmNewSense?`; new `saved.conflict` reply arm                          |
| `packages/app/test/wire-schema.test.ts`                       | New parse/reject tests; snapshot regenerated                                                   |
| `packages/app/wire-schema.snapshot.json`                      | Regenerated (not hand-edited)                                                                  |
| `packages/app/src/app/router.ts`                              | `saved.save` case branches on `savedWordUpsert`'s result kind                                  |
| `packages/app/test/app/router.test.ts`                        | Conflict + confirm round-trip tests replace the old "replaces senses" test                     |
| `packages/app/src/ui/merge-prompt.ts`                         | New — `buildMergePrompt`                                                                       |
| `packages/app/test/ui/merge-prompt.test.ts`                   | New                                                                                            |
| `packages/app/src/ui/side-panel-view.ts`                      | New `appendToFocus` method + `.merge-prompt*` CSS                                              |
| `packages/app/test/ui/side-panel-view.test.ts`                | New `appendToFocus` test                                                                       |
| `packages/app/src/ui/lookup-card.ts`                          | CSS-only additions (`::slotted(.merge-prompt)` + `CARD_DOC_CSS` descendant rules)              |
| `packages/app/src/index.ts`                                   | Export `buildMergePrompt`                                                                      |
| `packages/extension-chrome/src/content.ts`                    | `toggle-save` listener gains the conflict/merge-prompt branch                                  |
| `packages/extension-chrome/src/side-panel.ts`                 | Same, panel composition root                                                                   |
| `packages/extension-chrome/e2e/b14-sense-aware-dedup.spec.ts` | New functional e2e                                                                             |

No change: `packages/app/src/domain/types.ts`, `packages/app/src/ports.ts`,
`packages/app/src/app/inline-bottom-sheet-renderer.ts`, `packages/app/src/ui/settings-form.ts`, any
manifest file.

## 9. Concurrency

Per CONTRACTS §5, files this card modifies that other **unshipped** roadmap cards also modify:

- `packages/app/src/ui/lookup-card.ts` — hot file shared with A1, A2, A3, A5, A7, A10 (the
  lookup-card UI cluster). B14's touch is CSS-only (§4.6), additive, and does not touch
  `renderCardState`/`CardState`/`renderSaveRow` — low collision risk with the others' logic changes,
  but the orchestrator should still serialize concurrent PRs touching this file to avoid CSS-block
  merge conflicts.
- `packages/app/src/wire.ts` / `packages/app/src/app/router.ts` — the "wire+router" hot pairing
  CONTRACTS §5 calls out for any card adding messages/fields. Other unshipped cards that also touch
  these files: A3 (optional `LookupRequest.refine?`), A12 (`source_lang` detection, no wire change
  expected but touches `prompt-builder` which is adjacent), B6/B9/B12 (may add wire messages for
  delete/export/tagging). Serialize with whichever of these lands first to avoid the exhaustive
  `switch(msg.type)` (`router.ts:213-287`) needing a three-way merge.
- `packages/app/src/ui/side-panel-view.ts` and `packages/extension-chrome/src/side-panel.ts` — hot
  files shared with A2, B6, B10, B11 (side-panel cluster). B14 adds one method
  (`appendToFocus`) and one event-listener branch — additive, but still coordinate with whichever of
  those cards lands first.
