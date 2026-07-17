# B12 — LLM auto-grouping

Roadmap card: `docs/ROADMAP.md` §4 B12 (Impact 3 · Effort M · Score 1.5). Depends on: B1 (shipped —
`saved:*` keyspace, `SavedWordEntry`). Does not depend on B6 (words page) — B6's spec/plan do not
exist yet in this batch and B12's card lists only B1 as a dependency, so this design is
self-contained and does not assume B6's future UI.

## 1. Problem (grounded in code)

Today, once a word is saved (B1), it just sits in the flat `saved:*` keyspace
(`packages/app/src/domain/saved-words-policy.ts:110-118`, `savedWordsList` returns every entry,
newest-saved-first, with **no grouping, no tags, no way to browse by theme**). There is no UI
surface that even lists all saved words yet:

- `packages/app/src/ui/side-panel-view.ts` renders exactly two regions today: the single lookup
  `.focus` (`:107-193`) and `.recent` (`:150-160`, `:195-237`) — a list of **history** entries
  (`HistoryEntry[]`, i.e. past _lookups_), not saved words. `SidePanelView` has no `saved`-shaped
  property at all.
- `packages/extension-chrome/src/side-panel.ts` only ever sends `saved.save` / `saved.delete` /
  `saved.setStatus` (`:186-211`) — one word at a time, from the star/status toggle on whatever
  lookup is currently in focus. It never reads back the full saved-word list.
- The wire protocol (`packages/app/src/wire.ts:95-141`) has no message that returns more than one
  `SavedWordEntry` at a time — there is no `saved.list` and no bulk-read of any kind.
- `SavedWordEntry` (`packages/app/src/domain/types.ts:246-251`) has exactly four fields (`word`,
  `status`, `savedAt`, `senses`) — no field to hold a topic tag.

So today, 200 saved words (the card's own payoff example) is one undifferentiated, unbrowsable
pile. Filing them into folders by hand "never happens" (roadmap wording) — this card adds the one
AI-assisted shortcut: **one explicit button, one model call, tags come back editable.**

## 2. Design question 1 — how does the model see "all my saved words," and where does that round trip live?

`LookupClient.lookup()` (`packages/app/src/ports.ts:62-64`) is the only port that talks to a
provider, and every existing caller of it builds a `LookupRequest` shaped around **one** headword

- sentence (`word`, `context`, `target`, `outputFormat`, `promptEnvelope` —
  `packages/app/src/domain/types.ts:16-39`). Three ways to get "cluster my whole saved list" through
  that same narrow port:

**(a) Add a brand-new port method** (e.g. `LookupClient.organize(entries): Promise<TagGroup[]>`)
with its own HTTP plumbing.

**(b) Reuse `LookupClient.lookup()` via the existing full-prompt-envelope override**
(`LookupRequest.promptEnvelope`, advanced override #62 — `packages/app/src/domain/
prompt-template.ts:57-75`), packing the entire organize instruction + word list into that one
string field, and routing the call through a **new, cache/history-bypassing** wire message/router
handler that mirrors `handleConnectionTest`'s existing pattern.

**(c) Build the organize prompt client-side (in `side-panel.ts`) and send it as a normal `lookup`
wire message** with `word` set to some sentinel and `context` holding the word list.

### Why (b) is pinned

`buildPrompt` (`prompt-template.ts:57-75`) already has an unconditional escape hatch: when
`envelope` is non-blank, it **replaces** `PROMPT_ENVELOPE` outright (`:63`), and every
placeholder substitution after that (`{output_format}`, `{idiom_instruction}`,
`{translation_instruction}`, and `renderTemplate`'s own `{word}`/`{context}`/… table,
`prompt-template.ts:18,25-29`) is conditional on the placeholder literally appearing in the
string (`.includes(...)` guards at `:64,68,71`). An organize prompt that embeds the words
literally (not as `{word}`) and contains none of those four placeholder tokens passes through
`buildPrompt`/`renderTemplate` completely unchanged — **the entire mechanism this card needs
already exists, engineered for exactly this "advanced full-prompt override" purpose.** This means
(a) is unnecessary — it would duplicate `runHttpLookup`'s shared skeleton (`packages/app/src/app/
http-lookup-client.ts:71-185`: key/online guards, timeout+abort merging, per-provider
headers/parsing, `mapError` classification) a second time for no new capability. It also means
**no change to `domain/prompt-template.ts` or `domain/default-template.ts`** — despite this
worktree's `CONTRACTS.md` §5 predicting "prompt-builder" as a B12 hot file, grounding the actual
mechanism shows the existing override already covers it; noted here so the discrepancy is visible
rather than silently assumed away.

(c) is rejected because the plain `lookup` wire handler (`router.ts:97-172`) unconditionally
reads/writes the cache and, when `saveHistory` is on, **appends a `HistoryEntry`**
(`:137-144`) and evaluates the B7 repeat-nudge counter for whatever string ends up in `req.word`
(`:150-158`). Routing the organize call through it would silently pollute "Recent" with a fake
lookup and could mis-fire the nudge policy for an unrelated word. `handleConnectionTest`
(`router.ts:195-211`) already proves the right pattern for a **non-persisting, direct** model
call: it builds a `LookupRequest` itself and calls `deps.client.lookup(...)` **directly**, bypassing
`handleLookup` entirely. This card adds a new handler, `handleOrganize`, following that exact
precedent — new wire message `saved.organize`, own router case, zero cache/history/nudge writes
from the call itself (tag persistence is its own explicit step, §4.3).

## 3. Design question 2 — the response contract, validation, and what "reject non-conforming" means

The model returns free text; per the roadmap card, the response must be **strict JSON**, and per
the S4 spirit (`.c3/rules/rule-sanitize-model-output.md` — scoped to "model text reaching the DOM
as HTML") this text is exactly as attacker/model-influenceable as `LookupResult.markdown`, so it is
parsed defensively — **never trusted, never `eval`'d, never written to storage un-validated.**

**Pinned response shape** (a JSON array, no markdown fence, no prose):

```json
[
  { "tag": "Finance", "words": ["bank", "equity"] },
  { "tag": "Miscellaneous", "words": ["serendipity"] }
]
```

**Pinned validation rules** (`domain/auto-group-policy.ts`'s `parseOrganizeResponse`, §4.2):

- Strip one optional ` ```json ` / ` ``` ` fence (many models wrap "strict JSON" in one
  anyway); then `JSON.parse`. A parse failure → `null` (caller treats as a hard failure, no tags
  written — see §4.3).
- Must be an `Array`; each item must be a plain object with a non-empty string `tag` (trimmed,
  whitespace-collapsed, capped at 40 chars) and an array `words` of strings. Any item failing this
  shape → `null` for the **whole response** (a shape violation means the model didn't follow
  instructions at all — no partial trust).
- **Word-identity IS enforced, completeness is NOT.** Every word the model places in a group must
  be one of the words that were actually sent (case-insensitive match against the request's word
  list) — a word that doesn't match is treated as a hallucination/typo and invalidates the whole
  response (`null`). But the model is **not** required to place every sent word into a group — a
  response that groups 198 of 200 sent words is still accepted; the 2 omitted words are simply left
  untouched (§4.3), not treated as an error. Rationale: identity is a correctness/safety
  property (never persist a word the model invented) worth a hard reject; completeness is a
  quality property (an otherwise-good clustering shouldn't be thrown away over one dropped word).
- A word appearing in more than one group (model error) keeps its **first** placement and is
  silently dropped from later groups — not a reject, since this is recoverable without discarding
  the rest of the response.
- Tags render via `.textContent` only, never `innerHTML` (§4.4) — no HTML-injection vector exists
  regardless of tag content, but the trim/length-cap above is still applied as basic hygiene on
  what is ultimately untrusted model output.

## 4. Design question 3 — the additive schema field, persistence semantics, and the batching cap

**Pinned field name: `SavedWordEntry.tags?: string[]`** (entry-level, not per-sense — a word's
topic doesn't vary by which sentence it was encountered in). This is an **additive** field under
the E1 lock: `docs/ROADMAP.md` §8 Decision Log's B1/B2 entry ratifies that "future additive fields
… stay lead-decidable through this same … lock — restructuring or removing a ratified field is a
new escalation." Adding an optional array is additive; no escalation needed.

**Pinned persistence semantics:**

- One `saved.organize` click = **exactly one model call**, however many saved words exist —
  batched into a single prompt, not one call per word or per chunk (constraint 4: "every model
  call is user-triggered"; batching also means the token cost is bounded and predictable).
- **Cap: 200 words per run**, taking the 200 **most recently saved** (the existing
  `savedWordsList` order is already newest-saved-first prepend —
  `saved-words-policy.ts:110-118` reading the `saved:index` array built by `savedWordUpsert`'s
  `[key, ...existingIndex]`, `:63` — so `.slice(0, 200)` is exactly "the 200 newest," no new sort
  needed). **200 is not an arbitrary round number** — it is lifted directly from this card's own
  roadmap payoff line: "200 loose words → a dozen meaningful groups in one tap." Older words beyond
  the cap are simply left out of this run (their existing `tags`, if any, are untouched); the reply
  reports `skippedCount` so the UI can say so.
- **Only words the model actually placed into a group get `tags` written** — `[tag]`, replacing
  any prior tags for that word (last-organize-wins, mirroring `savedWordUpsert`'s own
  last-write-wins precedent for `senses[0]`, `saved-words-policy.ts:52-61`). Words the model
  omitted (whether outside the 200-cap or dropped from an otherwise-valid response, §3) are **never
  touched** — Organize only ever adds/updates grouping for words it actually returned an opinion
  on; it never silently wipes a word's existing tag just because a later run didn't mention it.
- **Definitions are excerpted, not sent whole**, when building the prompt: `SavedWordSense
.definition` is the model's full markdown card body (up to ~200 words per the envelope's own "under
  200 words" constraint, `default-template.ts:30`) — sending 200 of those verbatim would blow the
  prompt budget for no clustering benefit. `excerptDefinition` (§4.2) strips common markdown
  syntax, collapses whitespace, and caps at 100 characters — plenty of topical signal, bounded
  cost. This transform is prompt-input-only; the stored `definition` is never modified.
- **Tag-edit (rename/remove) makes zero model calls.** Both are plain KV writes via the new
  `saved.setTags` message (§4.2), reusing the _existing_ per-word tag array — never re-invokes
  the LLM. This is the only path that mutates `tags` outside of an Organize run.

## 5. Design question 4 — where does the button/results UI live?

There is no saved-words list page yet (that's B6, unauthored in this batch, not a B12 dependency).
The side panel (`packages/app/src/ui/side-panel-view.ts`) is the one persistent, trusted extension
surface that already owns saved-word-adjacent interactions today (the star/status toggles bubble
through `side-panel.ts`, `:176-211`) and already has a precedent for a titled list section
(`.recent`, `:150-160`). **Pinned: a new "Saved words" section in the side panel**, below
`.recent`, always visible (unlike `.recent`, which hides when empty — Organize is a stable CTA
entry point, not a dynamic list that should disappear). `CONTRACTS.md` §5's hot-file prediction
list omits B12 from its "side panel (A2 B6 B10 B11)" line; this spec adds `side-panel-view.ts` +
`side-panel.ts` to this card's actual footprint (§9 Concurrency) since the grounded design does
touch them.

Rejected alternative: putting the button in `settings-form.ts` alongside `clear-cache`/
`clear-history`/`export-history`. Rejected because those are configuration/data-management
actions, while Organize produces _content_ (tag groups) that needs its own display area — cramming
a growable group list into the settings page's linear form doesn't fit its layout, and the side
panel is already the "your words" surface (it's where the star/status controls live today).

**No upfront saved-word count.** Showing "You have N saved words" before the first Organize click
would need a new `saved.list`/`saved.count` wire message this card doesn't otherwise require. Pinned
instead: the idle state shows the button with static copy naming the 200-word cap directly (so the
expectation is set without a query); if there are zero saved words, `handleOrganize` detects it
server-side (§4.3) and skips the model call entirely, replying `organizedCount: 0` — the UI's empty
copy is driven by that reply, not a separate count.

**Token-cost warning (constraint 4).** Pinned: a native `window.confirm()` before the wire call —
this worktree already has the precedent (`packages/app/src/ui/settings-form.ts:530-532`,
`restoreDefaultTemplate`'s "Replace your card format with the default?" gate, unit-tested via
`vi.spyOn(window, 'confirm')` in `settings-form.test.ts`). Rejected alternative: a bespoke inline
"are you sure" card component — strictly more code (a new state + two extra buttons + CSS) for a
binary yes/no gate that `window.confirm` already answers in one line, with an existing test
precedent to copy. Exact copy (verbatim, §4.3): `"Organize your saved words with AI? This sends up
to 200 of your most recently saved words to your AI provider and uses your API quota."`

## 6. The change

### 6.1 `packages/app/src/domain/types.ts`

Add one optional field to the ratified E1 shape (`:246-251`), with a doc comment recording the
lock precedent:

```ts
/**
 * B1's ratified entry shape (escalation E1, owner-approved before this card was dispatched).
 * `word` is the case-insensitive unique key (enforced by saved-words-policy's
 * normalizeWordKey — B14 is the future richer merge-on-collision UX, not the uniqueness itself).
 * `senses` starts as a single-entry array; growing it into a real multi-sense collection is
 * B14's job.
 */
export interface SavedWordEntry {
  word: string;
  status: SavedWordStatus;
  savedAt: number;
  senses: SavedWordSense[];
  /**
   * B12: topic tag(s) assigned by "Organize my words," entry-level (not per-sense — a word's
   * topic doesn't vary by which sentence it was met in). ADDITIVE field under the E1 lock
   * (docs/ROADMAP.md §8 Decision Log, B1/B2 entry: "future additive fields … stay
   * lead-decidable … restructuring or removing a ratified field is a new escalation"). Absent
   * or `[]` means "never organized" / "not currently in any group." v1 writes at most one tag
   * per word per Organize run (`[tag]`); the array shape leaves room for a future multi-tag
   * UX without another schema escalation.
   */
  tags?: string[];
}
```

### 6.2 `packages/app/src/wire.ts`

- `SavedWordEntrySchema` (`:88-93`) gains `tags: z.array(z.string()).optional()` — keeps the
  `AssertEqual<z.infer<typeof SavedWordEntrySchema>, SavedWordEntry>` check (`:208`) satisfied
  since both sides gain the same optional field.
- Two new `WireMessageSchema` arms (after the existing `saved.setStatus` arm, `:124-127`):
  `saved.organize` (payload-free — the router reads the full saved list itself) and
  `saved.setTags` (`{ word: string; tags: z.array(z.string()) }`).
- `MessageTypeEnum` (`:143-158`) gains `'saved.organize'` and `'saved.setTags'` (needed so a
  failed `saved.organize`/`saved.setTags` can reply `{ ok:false, type: <that type>, error }`).
- One new `WireReplySchema` arm (after the existing `'saved'` arm, `:175`):
  `{ ok: true, type: 'organized', groups: { tag: string; words: string[] }[], organizedCount:
number, skippedCount: number }`. `saved.setTags` reuses the **existing** `'saved'` reply shape
  (its `entry` now naturally carries `tags`) — no new reply arm needed for it, mirroring how
  `saved.setStatus` reuses `'saved'` today (`:261-264` in router.ts).

### 6.3 `packages/app/src/domain/saved-words-policy.ts`

New function, placed after `savedWordSetStatus` (`:86-98`), mirroring its exact shape:

```ts
/**
 * B12: overwrite an existing saved word's tag(s) — used both by "Organize my words" (one call
 * per grouped word, immediately after a successful cluster) and by the tag-edit UI (rename via
 * a full-array replace, remove via filtering the removed tag out before calling this). No-op
 * (returns null) when the word isn't currently saved, mirroring savedWordSetStatus's contract.
 */
export async function savedWordSetTags(
  deps: SavedWordsDeps,
  word: string,
  tags: string[],
): Promise<SavedWordEntry | null> {
  const key = normalizeWordKey(word);
  const raw = await deps.storage.getItem(`saved:${key}`);
  if (!raw) return null;
  const existing = JSON.parse(raw) as SavedWordEntry;
  const entry: SavedWordEntry = { ...existing, tags };
  await deps.storage.setItem(`saved:${key}`, JSON.stringify(entry));
  return entry;
}
```

### 6.4 New file: `packages/app/src/domain/auto-group-policy.ts`

Domain-pure (zero imports outward except `./types`, `rule-domain-purity`). Full contents specified
in the plan (Task 2) — summary: `MAX_WORDS_TO_ORGANIZE = 200`, `excerptDefinition`,
`selectWordsToOrganize`, `buildOrganizePrompt` (full prompt text below), `TagGroup`,
`parseOrganizeResponse` (§3's rules).

**Full organize prompt text** (assembled by `buildOrganizePrompt`, one `{word}`-free string with no
envelope placeholders — §2):

```
You are organizing a language learner's saved vocabulary list into topic groups.

Below is a numbered list of saved words with a short excerpt of their definitions:
1. "bank" — A financial institution that accepts deposits and channels them into lending.
2. "equity" — Ownership interest in a company, represented by shares of stock.
3. "serendipity" — A fortunate accident; finding something valuable without looking for it.

Group these words into topic tags that would help the learner review by theme (e.g. "Finance",
"Emotions", "Words From Latin Spec-"). Rules:
- Every word listed above must appear in EXACTLY ONE group — do not omit any word, do not invent
  words that are not in the numbered list.
- Choose however many groups (between 2 and 12) best fit the words given — do not force unrelated
  words into the same group just to reduce the count.
- Each tag is a short topic label (2-4 words), Title Case, letters/numbers/spaces/hyphens only —
  no punctuation, no emoji.
- If a word genuinely fits no theme, place it in a group named exactly "Miscellaneous".

Output ONLY strict JSON — no markdown code fences, no commentary, no text before or after —
matching exactly this shape (an array of objects, each with a "tag" string and a "words" array of
strings copied verbatim from the numbered list above):
[{"tag":"Finance","words":["bank","equity"]},{"tag":"Miscellaneous","words":["serendipity"]}]
```

(The numbered list above is illustrative; `buildOrganizePrompt` generates it from the actual
selected entries, one line per word: `{i+1}. "{word}" — {excerptDefinition(senses[0].definition)}`.)

### 6.5 `packages/app/src/app/router.ts`

New handler, placed after `handleConnectionTest` (`:195-211`), following its exact
"call `deps.client.lookup` directly, no cache/history" precedent:

```ts
async function handleOrganize(): Promise<RouterReply> {
  const all = await savedWordsList({ storage: deps.kv });
  if (all.length === 0) {
    return { ok: true, type: 'organized', groups: [], organizedCount: 0, skippedCount: 0 };
  }
  const { selected, skippedCount } = selectWordsToOrganize(all);
  try {
    const s = await deps.settings.get();
    const result = await deps.client.lookup({
      word: 'organize',
      context: '',
      url: '',
      title: '',
      target: s.targetLang,
      outputFormat: '',
      promptEnvelope: buildOrganizePrompt(selected),
    });
    const groups = parseOrganizeResponse(
      result.markdown,
      selected.map((e) => e.word),
    );
    if (!groups) {
      return { ok: false, type: 'saved.organize', error: mapError({ kind: 'parse' }) };
    }
    const tagByWord = new Map<string, string>();
    for (const g of groups) for (const w of g.words) tagByWord.set(w.toLowerCase(), g.tag);
    await deps.queue.run(async () => {
      for (const entry of selected) {
        const tag = tagByWord.get(entry.word.toLowerCase());
        if (tag !== undefined) await savedWordSetTags({ storage: deps.kv }, entry.word, [tag]);
      }
    });
    return { ok: true, type: 'organized', groups, organizedCount: selected.length, skippedCount };
  } catch (err) {
    return { ok: false, type: 'saved.organize', error: toLookupError(err) };
  }
}
```

New switch cases (after the existing `'saved.setStatus'` case, `:261-264`):

```ts
case 'saved.organize':
  return handleOrganize();
case 'saved.setTags': {
  const entry = await deps.queue.run(() =>
    savedWordSetTags({ storage: deps.kv }, msg.word, msg.tags),
  );
  return entry ? { ok: true, type: 'saved', entry } : { ok: true, type: 'ack' };
}
```

Both new cases are added in the **same task** as their `wire.ts` arms (plan discipline — the
exhaustive `switch(msg.type)` with no `default` at `router.ts:213+` means a new arm without a
matching case is a compile error, and vice versa: `msg.word`/`msg.tags` on the `saved.setTags`
branch only type-checks once the wire arm exists).

### 6.6 `packages/app/src/index.ts`

Add `export * from './domain/auto-group-policy';` (barrel export, alongside the existing
`export * from './domain/saved-words-policy';` line) — no other line changes.

### 6.7 `packages/app/src/ui/side-panel-view.ts`

- New exported type, reusing the domain's `TagGroup` shape (imported, not re-declared — the UI
  file already imports domain types today, e.g. `HistoryEntry` at `:1`):

```ts
import type { TagGroup } from '../domain/auto-group-policy';

export type OrganizeState =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'result'; groups: TagGroup[]; organizedCount: number; skippedCount: number }
  | { kind: 'error'; message: string };
```

- New `_organize: OrganizeState` field (default `{ kind: 'idle' }`), a `set/get organize` accessor
  pair (mirroring `set/get recent`, `:182-188`), and a new `.organize` `<section>` appended to
  `main` after `.recent` (`:162`), with its own render function `renderOrganize()` (mirrors
  `renderRecent`, `:195-198`) called from both `connectedCallback` and the `organize` setter.
- New composed events dispatched from this section: `organize-click` (no detail), `rename-tag`
  (`{ tag: string; newTag: string }`), `remove-tag` (`{ tag: string }`) — same
  `bubbles: true, composed: true` convention as every other event in this file (`:138,219,232`).
- Rename UI: each group's tag renders as an `<input class="tag-input">` (not a plain `<span>`),
  committing on `change`/blur — if the new value is non-empty and different, dispatch
  `rename-tag`; if empty, revert the input to the old value (removal has its own explicit button,
  never an accidental empty-string rename). Each group also gets a `.tag-del` icon button
  (reusing the existing `ICON_TRASH` import, `:3`) dispatching `remove-tag`.
- Full CSS/markup given in the plan (Task 4).

### 6.8 `packages/extension-chrome/src/side-panel.ts`

New listeners, added after the existing `toggle-status` listener (`:202-211`):

```ts
view.addEventListener('organize-click', () => {
  const ok = window.confirm(
    'Organize your saved words with AI? This sends up to 200 of your most recently saved ' +
      'words to your AI provider and uses your API quota.',
  );
  if (!ok) return;
  view.organize = { kind: 'busy' };
  void chrome.runtime
    .sendMessage({ type: 'saved.organize' })
    .then((raw: unknown) => {
      const reply = raw as WireReply | undefined;
      if (reply?.ok && reply.type === 'organized') {
        view.organize = {
          kind: 'result',
          groups: reply.groups,
          organizedCount: reply.organizedCount,
          skippedCount: reply.skippedCount,
        };
      } else {
        const message =
          reply && !reply.ok ? reply.error.message : 'Could not reach the extension. Try again.';
        view.organize = { kind: 'error', message };
      }
    })
    .catch(() => {
      view.organize = { kind: 'error', message: 'Could not reach the extension. Try again.' };
    });
});

view.addEventListener('rename-tag', (e) => {
  const { tag, newTag } = (e as CustomEvent<{ tag: string; newTag: string }>).detail;
  if (view.organize.kind !== 'result') return;
  const groups = view.organize.groups.map((g) => (g.tag === tag ? { ...g, tag: newTag } : g));
  const words = groups.find((g) => g.tag === newTag)?.words ?? [];
  view.organize = { ...view.organize, groups };
  for (const word of words) {
    void chrome.runtime
      .sendMessage({ type: 'saved.setTags', word, tags: [newTag] })
      .catch(() => undefined);
  }
});

view.addEventListener('remove-tag', (e) => {
  const { tag } = (e as CustomEvent<{ tag: string }>).detail;
  if (view.organize.kind !== 'result') return;
  const removed = view.organize.groups.find((g) => g.tag === tag);
  const groups = view.organize.groups.filter((g) => g.tag !== tag);
  view.organize = { ...view.organize, groups };
  for (const word of removed?.words ?? []) {
    void chrome.runtime
      .sendMessage({ type: 'saved.setTags', word, tags: [] })
      .catch(() => undefined);
  }
});
```

No dedicated unit test exists for `side-panel.ts` today (a composition root, e2e-covered only —
same precedent C2's spec records for `options.ts`); this task's correctness is proven by the e2e
scenarios in §7.

### 6.9 No change to `packages/app/src/domain/prompt-template.ts` / `default-template.ts`

Recorded explicitly per §2's resolution — the existing full-envelope-override mechanism already
does everything this card needs. Zero lines change in either file.

### 6.10 No change to `packages/app/src/domain/defined-as.ts` / `translation-line.ts`

The organize response text never contains a `DEFINED_AS:`/`TRANSLATION:` line, so both parsers'
existing "no match → body unchanged, signal undefined" contract (already true of every
non-compliant response, both files' own doc comments) passes the JSON straight through untouched.
Confirmed by reading both regexes (`defined-as.ts:22`, `translation-line.ts:18`) — neither can
match a JSON array literal.

### 6.11 No change to `packages/extension-safari/*`

The Safari shell has no side-panel-equivalent surface (`c3-312` is `safari-options-page` only —
no persistent panel component exists there today). The two new wire messages are routed by the
shared, portable `buildRouter` (`packages/app/src/app/router.ts`), so Safari's service worker
would technically accept them if sent, but this card adds no Safari UI to send them — matching the
existing precedent that side-panel-only cards (e.g. B4, B6) don't get a Safari port. No file under
`packages/extension-safari/` changes.

### 6.12 No change to `packages/app/src/app/http-lookup-client.ts`

`runHttpLookup` already does everything `handleOrganize` needs (key/online guard, `buildPrompt`
with the override, timeout+abort, `mapError` classification) with zero modification — it is
provider-agnostic, so Organize automatically works with whichever of Gemini/OpenAI/Anthropic the
reader has configured, including the existing fallback pool, for free.

## 7. Testing strategy

1. **Unit — `packages/app/test/auto-group-policy.test.ts`** (new, flat under `test/` — matches
   this package's existing convention of one file per domain module, e.g.
   `test/saved-words-policy.test.ts`, not a `test/domain/` subfolder): `excerptDefinition`
   strips markdown syntax and caps length with an ellipsis; `selectWordsToOrganize` caps at 200 and
   reports the correct `skippedCount` for lists both under and over the cap; `buildOrganizePrompt`
   embeds every selected word + its excerpt and contains no `{word}`/`{output_format}`/
   `{idiom_instruction}`/`{translation_instruction}` placeholder tokens; `parseOrganizeResponse`:
   accepts a well-formed response, strips a ` ```json ` fence, rejects malformed JSON,
   rejects a response containing a word outside the valid set, accepts a response missing some
   valid words (partial coverage), and de-duplicates a word appearing in two groups (keeps the
   first).
2. **Unit — `packages/app/test/saved-words-policy.test.ts`** (extend): `savedWordSetTags` writes
   the tags array onto an existing entry and returns it; no-op (`null`) on an unknown word;
   `savedWordUpsert`/`savedWordSetStatus` are unaffected by the new optional field (regression).
3. **Unit — `packages/app/test/app/router.test.ts`** (extend): `saved.organize` with zero saved
   words replies `organized`/`organizedCount: 0` and makes **zero** `client.lookup` calls;
   `saved.organize` with saved words calls `client.lookup` exactly once with a `promptEnvelope`
   containing every word, persists tags via `saved:*` storage keys, and replies with the parsed
   groups; a malformed model response replies `{ ok:false, type:'saved.organize', error:{code:
'PARSE'} }` and writes **no** tags; `saved.setTags` updates an existing entry and no-ops
   (`ack`) on an unknown word.
4. **Unit — `packages/app/test/ui/side-panel-view.test.ts`** (extend): the `organize` section
   renders the idle CTA by default; `organize = {kind:'busy'}` shows a busy row and no button;
   `organize = {kind:'result', groups:[...]}` renders one row per group with its words, and
   clicking the CTA (idle state) dispatches a composed `organize-click`; editing a tag's input and
   blurring dispatches `rename-tag` with `{tag, newTag}`; clicking a group's trash button dispatches
   `remove-tag`; an empty rename reverts the input instead of dispatching.
5. **e2e — new `packages/extension-chrome/e2e/b12-llm-auto-grouping.spec.ts`**:
   - Seed 3 `saved:*` entries + `saved:index` directly via `chrome.storage.local.set` (mirrors
     `saved-word.spec.ts`'s direct-storage assertions), mock Gemini's response body with a
     conforming organize JSON array, register `page.on('dialog', (d) => d.accept())` (Playwright
     auto-dismisses `confirm()` otherwise), click "Organize my words," and assert: exactly one
     Gemini call, the panel renders the returned groups, and `chrome.storage.local`'s
     `saved:<word>` entries now carry the expected `tags`.
   - Rejecting the confirm (`d.dismiss()`) makes **zero** Gemini calls and leaves the panel in its
     idle state.
   - A malformed Gemini response body (plain prose, no JSON) surfaces an error state in the panel
     and writes no `tags` to any `saved:*` entry.
   - Renaming a tag updates the panel's displayed label and every affected word's stored `tags`,
     with **no** additional Gemini call (`calls.count` unchanged since the Organize click).
   - Zero saved words: clicking "Organize my words" (with the confirm accepted) shows the
     empty-list copy and makes **zero** Gemini calls.

## 8. Testing performed (PR evidence — no media)

Per this worktree's `CLAUDE.md` (owner ruling 2026-07-16): **no screenshots or video for this PR.**
The PR body's "Testing performed" section carries the suites run, test counts, e2e scenarios
exercised, and gates passed (lint, format check, typecheck, unit, e2e) — matching §7 above exactly.

## 9. Risk / rollback

- **Risk: low-moderate.** The correctness-sensitive new logic is `parseOrganizeResponse`'s
  validation (a bug here could either persist a hallucinated word's tag onto the wrong entry, or
  wrongly reject a valid response) and `handleOrganize`'s persistence loop (only tag words the
  model actually returned). Both are directly unit-tested (§7.1, §7.3) with adversarial cases
  (malformed JSON, invented words, duplicate placement).
- **No data migration.** `SavedWordEntry.tags` is optional; every entry saved before this card
  ships simply lacks the field, which every reader already treats as "no tags" (`undefined` /
  falsy checks, never a required field).
- **Token spend is bounded and explicit.** Exactly one model call per confirmed click, capped at
  200 words; no background/scheduled calls anywhere in this design (constraint 4 held throughout).
- **Rollback:** revert the single PR. `SavedWordEntry.tags` values written by this feature remain
  in storage as harmless unused data (no reader outside this feature's own code ever looks at
  `tags`), so a revert is a clean no-op on existing saved words.

## 10. Files touched (summary)

| File                                                          | Change                                                                                                                                    |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/app/src/domain/types.ts`                            | `SavedWordEntry` + optional `tags?: string[]`                                                                                             |
| `packages/app/src/wire.ts`                                    | `SavedWordEntrySchema` + `tags`; 2 new `WireMessageSchema` arms; `MessageTypeEnum` + 2 entries; 1 new `WireReplySchema` arm (`organized`) |
| `packages/app/src/domain/saved-words-policy.ts`               | + `savedWordSetTags`                                                                                                                      |
| `packages/app/src/domain/auto-group-policy.ts`                | new — prompt builder + response parser + batching cap                                                                                     |
| `packages/app/src/index.ts`                                   | + barrel export line                                                                                                                      |
| `packages/app/src/app/router.ts`                              | + `handleOrganize`; 2 new switch cases                                                                                                    |
| `packages/app/src/ui/side-panel-view.ts`                      | + `OrganizeState` (reusing domain `TagGroup`), `organize` property, `.organize` section, 3 new events                                     |
| `packages/extension-chrome/src/side-panel.ts`                 | + `organize-click`/`rename-tag`/`remove-tag` listeners                                                                                    |
| `packages/app/test/auto-group-policy.test.ts`                 | new                                                                                                                                       |
| `packages/app/test/saved-words-policy.test.ts`                | + `savedWordSetTags` tests                                                                                                                |
| `packages/app/test/app/router.test.ts`                        | + `saved.organize`/`saved.setTags` tests                                                                                                  |
| `packages/app/test/ui/side-panel-view.test.ts`                | + organize section tests                                                                                                                  |
| `packages/extension-chrome/e2e/b12-llm-auto-grouping.spec.ts` | new                                                                                                                                       |
| `packages/app/wire-schema.snapshot.json`                      | regenerated (`vitest -u`) — both wire.ts-touching tasks change `wireJsonSchema()`'s output                                                |

No change to `packages/app/src/domain/prompt-template.ts`, `default-template.ts`,
`defined-as.ts`, `translation-line.ts`, `packages/app/src/app/http-lookup-client.ts`, or any
manifest file.

## 11. Concurrency

Files this card modifies that other unshipped cards in this batch also touch, so the orchestrator
should serialize:

- `packages/app/src/wire.ts` / `packages/app/src/app/router.ts` — any card adding a wire message
  (per `CONTRACTS.md` §5's own blanket rule).
- `packages/app/src/domain/types.ts` — every card touching `SavedWordEntry` additively (B13
  related-words, B14 sense-aware dedup both plan additive fields on the same interface per the E1
  lock).
- `packages/app/src/ui/side-panel-view.ts` and `packages/extension-chrome/src/side-panel.ts` — **not
  listed under B12** in `CONTRACTS.md` §5's "side panel (A2 B6 B10 B11)" line, but this design does
  touch both files (§6.7/§6.8); flagging so the orchestrator adds B12 to that line rather than
  missing a real conflict with A2/B6/B10/B11.
- `packages/app/src/index.ts` — a shared barrel file; any two cards adding an export in the same
  window conflict trivially (textual merge only, low risk, still worth serializing).

No conflict with `docs/index.html`, `settings-form.ts`, or the manifest — this card touches none
of them.
