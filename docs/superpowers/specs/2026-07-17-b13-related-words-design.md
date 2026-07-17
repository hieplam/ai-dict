# B13 — Related words on save (design)

> Roadmap idea **B13** (`docs/ROADMAP.md` §4, lines 503-513): _Impact 2 · Effort S · Score 2.0_.
> Category B (structuring learned words). Decision authority: **Lead decides** (chip copy);
> **no owner escalation** — "but the schema field goes through the B2 lock" (E1 governance,
> `docs/ROADMAP.md:512-513`). Depends on: **A3** (Follow-up chips) and **B1** (Save word).
>
> **This card extends A3's exported extension points verbatim — it does not redesign them.**
> Every name/type below (`RefineKind`, `REFINE_CHIPS`, `REFINE_INSTRUCTIONS`,
> `ResultRenderContext.onRefine`/`.refine`, `InlineBottomSheetRenderer.restoreOriginal`) is
> consumed exactly as A3 shipped it (`docs/superpowers/specs/2026-07-17-a3-follow-up-chips-design.md`
> §2.8, §3.1, §3.9; `docs/superpowers/plans/2026-07-17-a3-follow-up-chips.md`). B13's own new
> surface is: one more `RefineKind` value (`'related'`), one more `REFINE_CHIPS` entry, one more
> `REFINE_INSTRUCTIONS` key, a new pure parser (`domain/related-line.ts`), a new `LookupResult`
> field (`related?: string[]`), and — the actual "on save" part of the card's name — a new,
> additive `SavedWordSense.related?: string[]` field plus the dedicated write path that persists
> it **only when the word is already saved**.

## 1. Problem (grounded in code)

Today a saved word is an island. `SavedWordEntry`/`SavedWordSense`
(`packages/app/src/domain/types.ts:231-251`, the E1-ratified shape) carry `definition`,
`translation`, `sentence`, `url`, `title` per sense — nothing about how the headword relates to
any other word. `savedWordUpsert` (`packages/app/src/domain/saved-words-policy.ts:41-68`) always
builds a fresh `senses[0]` from exactly those five fields (49-55) and nothing else; there is no
field, no wire message, and no UI affordance anywhere in the codebase that captures a "family" of
words for a saved entry. `docs/ROADMAP.md:505` names the gap precisely: "spectate" isn't
connected to spectator, spectacle, inspect.

A3 (follow-up chips, spec+plan already authored in this same batch, wave 1) built the exact
mechanism this card needs but deliberately stopped one field short of using it for persistence.
Per A3's design spec §2.8 (`2026-07-17-a3-follow-up-chips-design.md:300-323`, quoted because this
card must not re-derive it):

- `RefineKind` (`domain/types.ts`) is `'simpler' | 'examples' | 'etymology' | 'usage'` — "a plain
  string-literal union — B13 widens it to `... | 'related'`."
- `REFINE_CHIPS: RefineChip[]` (`ui/lookup-card.ts`) is a plain ordered array — "B13 appends
  `{ id: 'related', label: '<B13 label>' }`. No chip rendering code needs to change."
- `REFINE_INSTRUCTIONS` (`domain/default-template.ts`) is a `Record<RefineKind, string>` —
  "TypeScript's exhaustiveness checking... means B13's widened `RefineKind` will fail to compile
  until B13 adds a `related:` entry, which is the desired forcing function."
- **"What B13 must NOT do:** persist the refine chip's result onto `SavedWordEntry` by extending
  `LookupResult`/`LookupRequest`... A3's `refine`/`RefineKind` fields are transient, in-flight,
  never-persisted request annotations... B13 reads the _result_ of a `'related'` refine call and
  writes it into `SavedWordEntry` itself; it does not need A3's wire fields to change shape, only
  its enums to widen."

So the mechanism to TRIGGER a "related words" answer (a 5th refine chip, a one-shot re-run of the
same selection, a new prompt instruction) is fully specified by A3 and requires zero redesign
here. What A3's spec explicitly leaves open for B13 (and what this spec pins) is everything about
**turning that answer into structured, persisted data**:

1. **Where does a machine-readable word list come from?** A3's other 3 "add a section" refine
   kinds (`examples`/`etymology`/`usage`) only ever produce free-form markdown prose — there is no
   existing mechanism in this codebase that extracts a `string[]` from a model's markdown answer.
   The closest precedent is B2's `TRANSLATION: "..."` signal line
   (`domain/translation-line.ts:19`, `parseTranslation`) and A8's `DEFINED_AS: "..." | idiom`
   line (`domain/defined-as.ts:22`, `parseDefinedAs`), both parsed out of the raw response text by
   `runHttpLookup` (`packages/app/src/app/http-lookup-client.ts:157-158`) before the markdown ever
   reaches sanitization or the card.
2. **Where does the persisted field live — `senses[].related` or an entry-level field?** The
   roadmap card poses this exact question (`docs/ROADMAP.md:512`: "Lead decides: chip copy" is
   the only _listed_ Lead-decides item, but the dispatch note for this batch is explicit: "result
   persisted onto the saved entry as ADDITIVE E1 field (pin name, e.g. `senses[].related?:
string[]` vs entry-level — pin ONE with rationale)"). `SavedWordEntry` (`types.ts:246-251`) has
   no top-level field for per-encounter data today — every fact about _how_ the word was met lives
   inside `senses[]` (`types.ts:231-237`).
3. **How does persistence actually happen, and how is "only when the word IS saved" enforced?**
   This is the hardest question and the one A3 does not touch. `ResultRenderContext.saved`
   (`packages/app/src/ports.ts:46-47`) is the only place a "saved" flag exists on a rendered
   result, but `runLookupWorkflow`'s `ctx` object (`domain/workflow.ts:88-114`) **never sets it** —
   confirmed by reading the full `ctx` construction: it carries `sentence`/`url`/`title` and,
   conditionally, `providers`/`onSwitchProvider`/`onForceLiteral`, but no `saved` key at all. The
   Chrome composition root's own local mirror of "is this saved," `lastSaved`
   (`packages/extension-chrome/src/content.ts:55`), is reset to `false` on **every**
   `renderResult` call (`content.ts:98`, unconditional — A3's own Task 6 diff adds a _sibling_
   `lastOriginalSavePayload` snapshot right next to this line but does not touch the
   `lastSaved = false` reset itself). This is B1's own documented, accepted design ("Toggle
   semantics" — no is-already-saved round trip on a fresh render), not a bug — but it means
   **content.ts has no reliable way to know, at the moment a `'related'` result renders, whether
   this word is currently saved**. Any correct answer must come from the one place that has real
   ground truth: the KV store itself.

## 2. Design questions (all "Lead decides" items pinned here)

### 2.1 Structured data source: a `RELATED: "..."` signal line, parsed by a new `related-line.ts`

**Pinned:** mirror B2's `TRANSLATION` signal-line pattern exactly. `REFINE_INSTRUCTIONS.related`
(new `default-template.ts` entry, §3.4) asks the model to (a) add a normal, human-readable
"**Related words**" markdown section to the visible answer, exactly like A3's `examples`/
`etymology`/`usage` kinds already do, **and** (b) emit one more machine-parseable line,
`RELATED: "word1, word2, word3"`, positioned immediately after the existing `TRANSLATION` line.
A new pure function, `parseRelated(markdown): { related?: string[]; body: string }`
(`packages/app/src/domain/related-line.ts`, new file), extracts and strips that line — structurally
identical to `parseTranslation` (`translation-line.ts:19-37`): same regex shape
(`/^RELATED:\s*"([^"]+)"[ \t]*$/m`), same "strip the line plus at most one following blank line,
leave everything else untouched" contract, same "absent when the model didn't emit a recognisable
line → `related` undefined, `body` unchanged" back-compat guarantee. The one addition beyond
`parseTranslation`'s contract: the captured string is comma-split, trimmed, empty-filtered, and
capped at 8 entries (§2.1a below) before becoming `related: string[]`.

**Rejected: parse the visible "**Related words**" markdown section directly** (no signal line;
scrape the bullet/comma list under that heading). Rejected for the identical reason
`translation-line.ts`'s own doc comment gives for why `TRANSLATION` needs a decoupled signal line
in the first place: the visible section lives inside the user-customizable Card format
(`outputFormat`, `settings-form.ts`), so its heading text, list style (bullets vs. commas vs.
numbered), and even presence are not reliable across a reader's own prompt customizations. A
signal line the extension itself owns end-to-end, emitted by a code-owned instruction slot
(`{refine_instruction}`, unaffected by `outputFormat`), is reliable regardless of how the visible
Card format is edited — exactly B2's own reasoning, reapplied.

**(a) Why cap at 8?** A concrete, stated bound (not "as many as relevant") gives the model a
target it can hit reliably, keeps the persisted array small and predictable for future consumers
(B6 words-page display, B8 CSV export — neither exists yet, but an unbounded array would force
every future reader of this field to defensively truncate), and matches the rough size of a
typical dictionary's "see also" list. The prompt states the cap explicitly (§3.4); `parseRelated`
also enforces it client-side (`.slice(0, 8)`) as a backstop in case a model ignores the
instruction — the same "ask nicely, then enforce" pattern A8/B2 already use for their own signal
lines (the model is trusted to emit the _line_, but the extension still validates/bounds what it
extracts from it).

### 2.2 Prompt instruction copy (pinned verbatim)

```ts
related: `The reader wants this word's RELATED WORDS — synonyms, antonyms, and word-family members (words sharing the same root), disambiguated for THIS sentence context. In addition to the normal sections, add a new "**Related words**" section listing them, grouped under "Synonyms", "Antonyms", and "Family" sub-headings where each group has at least one entry (omit an empty group entirely). Immediately after the TRANSLATION line, before any other output, also emit exactly this line:
RELATED: "word1, word2, word3"
List at most 8 comma-separated words or short phrases, most relevant to "{word}" in this sentence context first, no explanations on that line.`,
```

Positioned as the `related` key of `REFINE_INSTRUCTIONS` (`default-template.ts`), same file/same
`Record<RefineKind, string>` A3 already introduced — no new prompt-assembly mechanism (§3.4).

### 2.3 Chip copy

**Pinned:** `Related words` — the card's own roadmap title (`docs/ROADMAP.md:503` heading text),
reused verbatim for the same reason A3 reused the roadmap's own chip wording verbatim (its design
spec §2.3): it removes any reason to invent new phrasing and keeps the shipped UI and the roadmap
card in sync by construction. `REFINE_CHIPS` gains a 5th entry, `{ id: 'related', label: 'Related
words' }`, appended last (after `usage`) — order matters only in that it renders last in the
row, which is the natural "one more option" placement A3's own §2.8 anticipates ("B13 appends a
5th `'related'` entry").

**Rejected:** "Synonyms" or "Word family" alone — rejected because the chip's result is broader
than either single word (it also covers antonyms), and the roadmap's own framing ("synonyms,
antonyms, family") is already the agreed scope; a narrower label would undersell what the chip
returns.

### 2.4 Persisted field placement: `SavedWordSense.related?: string[]` (per-sense, not entry-level)

**Pinned:** add `related?: string[]` to `SavedWordSense` (`domain/types.ts:231-237`), not to
`SavedWordEntry` (`types.ts:246-251`). Rationale:

1. **Consistency with the ratified shape's own design.** Every other per-encounter fact
   (`definition`, `translation`, `sentence`, `url`, `title`) already lives inside `senses[]`
   specifically _because_ it is scoped to the context the word was met in — the owner's own E1
   ruling (`docs/ROADMAP.md:944-967`) put these fields inside `senses[]` "so a headword's multiple
   senses (B14) each carry their own context." Related words are exactly this kind of
   context-scoped fact: a 'related' refine tap runs against the _specific_ sentence/sense
   currently displayed (per A3 §2.4(c), the tap re-sends "the original word + sentence"), so its
   answer is disambiguated for that sense, not the headword in the abstract. "bank" (river,
   nautilus-article sense) relates to _shore, embankment, bluff_; "bank" (finance, FT-article
   sense) relates to _institution, lender, vault_ — a single shared entry-level list could not
   hold both without losing the very disambiguation this product's differentiator is built on
   (`docs/ROADMAP.md:74-75`: "it keeps the sentence and returns the one sense in play").
2. **Forward-compatible with B14 for free.** B14 (sense-aware dedup, `docs/ROADMAP.md:564-576`)
   is the future card that turns `senses[]` into a real multi-sense array (today it is always
   exactly one entry, per `savedWordUpsert`'s last-write-wins replacement). A per-sense
   `related` field means B14's future multi-sense merge needs no special-casing for this field —
   it already fits the existing per-sense pattern every other field uses. An entry-level field
   would need its own bespoke merge story the day B14 ships (whose related list wins when two
   senses each fetched their own?) — a problem this card can avoid entirely by not creating it.
3. **Explicitly anticipated by the owner's own E1 ruling.** `docs/ROADMAP.md:962-963`: "future
   **additive** fields (e.g. **B13 related-words**, a per-sense timestamp for B14) stay
   lead-decidable through this same B2 lock" — the owner's own governance note names this exact
   field and frames it as per-sense company to a _per-sense_ B14 timestamp, not as an entry-level
   addition.

**Rejected: `SavedWordEntry.related?: string[]` (entry-level).** Rejected per point 1 above — it
would force one shared word-family across every sense of a polysemous headword, silently wrong
the moment a second sense exists (even though that's not until B14), and contradicts the
established per-encounter-fields-live-in-`senses[]` pattern the owner's own ruling set up. Since
`senses[]` today is always a 1-element array, choosing entry-level would look identical in
practice right now — but it is the wrong shape for what this field conceptually is, and changing
it later (moving a field from entry-level into `senses[]`) is exactly the kind of "restructuring a
ratified field" the E1 governance calls a new escalation (`docs/ROADMAP.md:964`) — better to place
it correctly the first time under the "additive, lead-decidable" allowance than to need a future
escalation to fix a placement mistake.

Because pre-B14 `senses` is always exactly one entry, every write in this card targets
`senses[0]` specifically (§3.6) — not "the last sense" or "every sense" — consistent with how the
'related' refine tap itself is always answering about the single sense currently on screen.

### 2.5 Persistence trigger: a dedicated `saved.setRelated` wire message, whose domain function no-ops when the word isn't saved

**Pinned:** a new wire message, `saved.setRelated { word: string; related: string[] }` →
`{ ok:true, type:'saved', entry }` (word IS currently saved — the entry updates) or
`{ ok:true, type:'ack' }` (word is NOT currently saved — no-op, nothing written), fired
automatically by `content.ts` the instant a `'related'` refine result renders with a non-empty
`related` array (§3.9) — no dedicated "save related words" button, no confirmation dialog. This
is a **structural mirror of `saved.setStatus`**, both the wire arm shape and the domain function:
`savedWordSetStatus` (`saved-words-policy.ts:86-98`) already establishes exactly this contract —
"No-op (returns null) when the word isn't currently saved — the toggle only ever renders on an
already-saved word's own surface, so this guards a race... not the expected path." The new
`savedWordSetRelated` (§3.6) reuses the identical shape: read `saved:<key>`, return `null`
immediately if absent, otherwise patch and write. The router case (§3.7) reuses the identical
reply-shape ternary `saved.setStatus` already uses (`router.ts:261-266`:
`entry ? {ok:true,type:'saved',entry} : {ok:true,type:'ack'}`).

This closes §1's hard question (how does the client know "the word IS saved") **without needing
the client to know it at all**: the existence check and the write happen atomically, server-side,
in the one place that already has ground truth (the KV store), via a function shape already
proven and tested (`savedWordSetStatus`'s own no-op behavior is asserted in
`packages/app/test/saved-words-policy.test.ts:148-151` and reused verbatim in spirit here). This
is exactly the roadmap card's pinned behavior: "Only persists when the word IS saved (pin
behavior when not saved: show but don't persist)" — the card ALWAYS shows the related words
(A3's normal refine-replaces-body mechanism handles the "show" half unconditionally); this
section's mechanism handles the "don't persist [when unsaved]" half.

**Rejected: track `lastSaved` client-side in `content.ts` and gate the wire call on it.**
Rejected because it is provably unreliable, not just inelegant: `lastSaved` is unconditionally
reset to `false` inside the very `renderResult` call that renders the `'related'` result itself
(`content.ts:98`, pre- and post-A3 identical) — by the time a related result arrives, there is no
surviving client-side signal for "was this word saved before this tap" without adding an entirely
new tracking variable whose only job would be to reimplement what the storage layer already knows
for free. (Capturing "was it saved" at click time, before the refine request even fires, was also
considered and rejected: it would require threading a save-state boolean through A3's `onRefine`
closure, which lives in domain-pure `workflow.ts` and has zero awareness of the composition
root's local, platform-specific `lastSaved` variable — reaching across that boundary purely to
answer a question the storage layer already answers is a boundary violation for no benefit.)

**Rejected: a separate check-then-write round trip** (e.g. a new `saved.get` message the client
sends first, then conditionally sends `saved.save`/a related-only write only if the check says
"yes"). Rejected as unnecessary two-hop complexity carrying a real TOCTOU race (the word could be
deleted between the check reply and the second write) — a single atomic function
(`savedWordSetRelated`, reading and writing storage inside one call) removes the race entirely
and is simpler code, not more.

**Rejected: extend the existing `saved.save` message with an optional `related?: string[]`
field**, fired using the already-existing `lastOriginalSavePayload` (A3's own snapshot of the
last non-refined save context) plus the newly-parsed `related` array. Rejected because
`savedWordUpsert` (the function behind `saved.save`) **always upserts** — it has no no-op-if-absent
behavior (unlike `savedWordSetStatus`). Firing it automatically on every `'related'` tap would
silently create a NEW saved entry for a word the reader never chose to save, the moment they tap
a refine chip out of curiosity — a direct violation of "only persists when the word IS saved."
Gating that auto-fire on some other saved-check would just reintroduce the two rejected
alternatives above. A dedicated message whose domain function no-ops server-side on a miss is the
only shape that makes "show but don't persist [when unsaved]" an actual invariant instead of a
best-effort client guess.

### 2.6 Interaction with a normal re-save (star click): related is cleared on a plain re-save, not preserved

**Pinned:** `savedWordUpsert` (used by every ordinary star-click `saved.save`, §1) is **not**
modified to carry forward a previously-persisted `related` array across a re-save. Its existing
behavior — build a fresh `senses[0]` from exactly the five fields in `SavedWordInput`
(`saved-words-policy.ts:49-55`) — is left untouched; since `SavedWordInput` never carries
`related` (content.ts's star-click payload, `lastSavePayload`, has no such field and this card
does not add one), a fresh sense built by a normal re-save simply has no `related` key, and the
previous value (if any) is gone. This is a **deliberate, stated choice**, not an oversight:

1. **Consistency, not a new special case.** `senses[0]` is already wholesale-replaced on every
   re-save (last-write-wins, `saved-words-policy.ts:60` — "replaces its single senses[0]... B14's
   job is turning this into a real multi-sense merge," explicitly an _accepted_ limitation, not a
   bug this card should route around). Special-casing exactly one field (`related`) to survive a
   replacement every other field doesn't survive would be an inconsistent, ad hoc carve-out with
   no product requirement behind it — the roadmap card's scope fence is "Lead decides: chip copy,"
   nothing about a merge/preserve UX for a re-save.
2. **Avoids a real staleness bug.** If a reader re-saves the same headword from a _different_
   sentence/context (e.g. re-selecting "bank" in a finance article after first saving it from a
   river article), a fresh save legitimately replaces `definition`/`translation`/`sentence` with
   the new context — carrying forward the OLD context's `related` words (which per §2.4 are
   sense-disambiguated) would pair a new definition with a stale, mismatched word family. Dropping
   `related` on any re-save is strictly more correct than preserving a value that may no longer
   describe the sense actually being saved.
3. **Zero extra cost to the reader.** If related words are wanted again after a re-save, the
   reader taps the chip again — the same tap they would have made anyway to get related words for
   the FIRST save.

**Rejected: preserve `existing.senses[0].related` across `savedWordUpsert`** (spread it forward
when the caller doesn't supply a new value). Rejected per point 2 — it would silently attach a
context-specific word family to a definition it may no longer match, and per point 1, it
introduces bespoke per-field merge logic this card's scope fence never asked for.

### 2.7 Saving while a `'related'` result is currently displayed (star click mid-refine): unchanged, inherited A3 behavior

**Pinned:** no new guard. A3 already defined exactly what the star button persists while any
refine result is showing: `lastSavePayload.definition` is always "whatever markdown is currently
displayed" (`content.ts`'s `renderResult` handler builds it from `r.markdown` unconditionally,
regardless of `ctx?.refine`), and A3's own §2.5 fix only intervenes for the specific
refine-then-Back-then-Save sequence. Tapping star while the `'related'` body (a synonym/antonym/
family listing) is on screen therefore saves that listing as `senses[0].definition`, exactly like
tapping star while a `'simpler'` or `'etymology'` body is showing saves THAT text — a pre-existing,
already-accepted A3 characteristic this card does not introduce, change, or need to guard against
again. (Whether this is ideal UX for the specific case of 'related' specifically is a product
question the roadmap card's scope fence — "Lead decides: chip copy," nothing about save-button
semantics — does not ask this effort to solve, and CONTRACTS forbids redesigning A3's already-
reviewed mechanism to solve it unasked.)

### 2.8 Cache write after a `'related'` refine call: inherited A3 risk, no new guard

**Pinned:** the cache-read bypass for any `refine`-bearing request is already generic in
`router.ts`'s existing guard (`req.refine === undefined`, A3 §2.7) — widening `RefineKind` to
include `'related'` automatically gets the same cache-read bypass with **zero additional
`router.ts` changes**. The cache **write** after a lookup also proceeds unchanged (A3's own §2.7:
"cache write... proceeds unchanged... a refined answer can overwrite the cached original... not a
new risk this card introduces") — a `'related'` result's markdown (definition + a "Related words"
section) can overwrite the plain-definition cache entry for that exact word+context+target until
it ages out or is cleared. This card inherits that already-accepted risk verbatim rather than
adding a new special-case write guard, for the same reason §2.7 above declines a new save-time
guard: redesigning an already-reviewed A3 mechanism for one more refine kind is out of scope.

### 2.9 Side panel: unchanged, chips (and the persistence auto-fire) stay in-page-card-only

**Pinned:** no `side-panel.ts`/`side-panel-view.ts` changes. The 5th chip renders automatically
only where A3 already renders the refine row — `CardState.refineChips` is set `true` only by
`InlineBottomSheetRenderer.renderResult` (A3 §2.6); `side-panel.ts`'s `resultToFocus`
(`side-panel.ts:114-128`) builds an explicit new object field-by-field and never lists
`refineChips` — the row is absent there by construction, the identical by-omission mechanism A3
already relied on for its own 4 chips, extended for free to the 5th. The `saved.setRelated`
auto-fire (§3.9) lives entirely inside `content.ts`'s `renderResult` handler, which the side panel
does not share (the panel's own focus-state updates, e.g. `side-panel.ts:151,261,286`, never route
through `content.ts`) — so a related tap made through some hypothetical future side-panel refine
UI (out of scope; A3 excluded refine from the panel entirely) could not accidentally double-fire
the persistence call either.

## 3. The change (per file)

### 3.1 `packages/app/src/domain/types.ts`

Widen the `RefineKind` union (currently, post-A3, `'simpler' | 'examples' | 'etymology' |
'usage'` with a doc comment reading "B13 (a later, separate card) appends 'related' to this
union... Do not add 'related' here" — see A3 plan Task 1 Step 2):

```ts
/**
 * A3: the fixed v1 refine chip kinds — one-shot re-runs of a lookup asking for a different cut
 * of the same answer. B13 (wave 2) appended 'related' — the result of that refine, when the
 * word is currently saved, is what B13 persists onto the saved entry's current sense (see
 * domain/saved-words-policy.ts's savedWordSetRelated and this card's design spec §2.4/§2.5).
 */
export type RefineKind = 'simpler' | 'examples' | 'etymology' | 'usage' | 'related';
```

`LookupResult` gains, immediately after the existing `nudge?: boolean | undefined;` field
(current lines 76-85):

```ts
  /**
   * B13: the model's RELATED words for this sense (synonyms/antonyms/family), extracted from
   * the RELATED: "..." signal line emitted per REFINE_INSTRUCTIONS.related (see
   * domain/related-line.ts's parseRelated) — present only on a result from a `'related'` refine
   * call. Transient result metadata, like `translation`; NOT itself the persisted field (that is
   * SavedWordSense.related, written by content.ts via the saved.setRelated wire message).
   */
  related?: string[] | undefined;
```

`SavedWordSense` gains, after the existing `title: string;` field (current lines 231-237):

```ts
export interface SavedWordSense {
  definition: string;
  translation: string;
  sentence: string;
  url: string;
  title: string;
  /**
   * B13: synonyms/antonyms/word-family for this specific sense, captured from a 'related' refine
   * tap and persisted ONLY while this headword is already saved (see savedWordSetRelated). Absent
   * on every entry saved before this card, and on any sense the reader never tapped the chip for
   * — never blocks rendering (per-sense, per design spec §2.4; ADDITIVE under the E1 lock, per
   * docs/ROADMAP.md's Decision Log 2026-07-10 B1/B2 entry which names this exact field).
   */
  related?: string[];
}
```

### 3.2 `packages/app/src/wire.ts`

Widen the existing `RefineKindEnum` (added by A3, positioned near `ProviderEnum`):

```ts
const RefineKindEnum = z.enum(['simpler', 'examples', 'etymology', 'usage', 'related']);
```

`LookupResultSchema` gains, after the existing `nudge: z.boolean().optional(),` line:

```ts
  // B13: parsed RELATED words for this sense; present only on a 'related' refine result.
  related: z.array(z.string()).optional(),
```

`SavedWordSenseSchema` gains, after the existing `title: z.string(),` line:

```ts
  // B13: additive under the E1 lock — see domain/types.ts's SavedWordSense.related doc comment.
  related: z.array(z.string()).optional(),
```

New wire message arm, added to `WireMessageSchema`'s array, positioned immediately after the
existing `saved.setStatus` arm (current lines 123-127):

```ts
  // B13: patch the related-words list onto an ALREADY-saved entry's current sense. No-op
  // server-side (replies ack, writes nothing) when the word isn't currently saved — see
  // domain/saved-words-policy.ts's savedWordSetRelated. Sent automatically by content.ts the
  // instant a 'related' refine result renders; never sent by any explicit UI button.
  z.object({
    type: z.literal('saved.setRelated'),
    word: z.string(),
    related: z.array(z.string()),
  }),
```

`MessageTypeEnum` gains `'saved.setRelated'` (added to the existing array, alongside
`'saved.setStatus'`).

No new `WireReplySchema` variant — `saved.setRelated` reuses the existing `{ ok:true, type:'saved',
entry }` / `{ ok:true, type:'ack' }` shapes `saved.setStatus` already established.

The compile-time `AssertEqual<z.infer<typeof LookupResultSchema>, LookupResult>` and
`AssertEqual<z.infer<typeof SavedWordEntrySchema>, SavedWordEntry>` checks (`wire.ts:201-209`)
force §3.1's and this section's additions to land in lockstep — a mismatch fails `bun run
typecheck`, not just a runtime parse (same guarantee A3/B2/A8 already rely on).

### 3.3 `packages/app/src/domain/default-template.ts`

`REFINE_INSTRUCTIONS` (A3's `Record<RefineKind, string>`) gains a 5th key — this is the change
TypeScript's own exhaustiveness check forces the moment §3.1 widens `RefineKind` (A3 §2.8's
"desired forcing function"):

```ts
  related: `The reader wants this word's RELATED WORDS — synonyms, antonyms, and word-family members (words sharing the same root), disambiguated for THIS sentence context. In addition to the normal sections, add a new "**Related words**" section listing them, grouped under "Synonyms", "Antonyms", and "Family" sub-headings where each group has at least one entry (omit an empty group entirely). Immediately after the TRANSLATION line, before any other output, also emit exactly this line:
RELATED: "word1, word2, word3"
List at most 8 comma-separated words or short phrases, most relevant to "{word}" in this sentence context first, no explanations on that line.`,
```

No change to `PROMPT_ENVELOPE`, `buildPrompt`, or any other A3-introduced prompt-assembly code —
the `{refine_instruction}` slot A3 built already substitutes whichever `REFINE_INSTRUCTIONS[kind]`
matches `req.refine`, generically, for any `RefineKind` value (§2.2 above; A3 spec §2.2/§3.5).

### 3.4 `packages/app/src/domain/related-line.ts` (new file)

```ts
/**
 * B13 — related words on save. Extracts the model's RELATED signal line (emitted per
 * PROMPT_ENVELOPE's {refine_instruction} slot when LookupRequest.refine === 'related' — see
 * default-template.ts's REFINE_INSTRUCTIONS.related) from the raw response text, and returns the
 * remaining body with that line (plus one immediately following blank line) stripped.
 *
 * Mirrors parseTranslation's contract exactly (domain/translation-line.ts) — a dedicated signal
 * line decoupled from the user-customizable Card format, for the same reason B2 needed one:
 * markdown-section parsing is fragile against arbitrary formatting/headings the reader may have
 * customized, while a fixed-shape line the extension owns end-to-end is reliable regardless.
 *
 * Comma-split, trimmed, empty entries dropped, capped at 8 (matches the prompt's own "at most 8"
 * instruction — a client-side backstop in case a model ignores it, bounding stored data size).
 *
 * Pure text processing — no synonym/antonym knowledge lives here (mirrors A8/B2's "no detection
 * engine" precedent). If the model didn't emit a recognisable RELATED line (a non-refine lookup,
 * legacy cached/history entries, a non-compliant model, or a custom envelope override that omits
 * {refine_instruction}), `related` is undefined and `body` is the ENTIRE input text unchanged.
 *
 * Domain-pure: zero imports (rule-domain-purity).
 */
const RELATED_LINE = /^RELATED:\s*"([^"]+)"[ \t]*$/m;

export function parseRelated(markdown: string): { related?: string[]; body: string } {
  const match = RELATED_LINE.exec(markdown);
  if (!match) return { body: markdown };
  const [line, raw] = match;
  const related = raw!
    .split(',')
    .map((w) => w.trim())
    .filter((w) => w.length > 0)
    .slice(0, 8);
  const before = markdown.slice(0, match.index).trim();
  const after = markdown
    .slice(match.index + line.length)
    .replace(/^\n/, '')
    .replace(/^\n/, '');
  return {
    ...(related.length > 0 ? { related } : {}),
    body: before ? `${before}\n${after}` : after,
  };
}
```

Not added to `packages/app/src/index.ts`'s barrel — matching the existing, deliberate precedent
that `translation-line.ts`/`defined-as.ts` are also NOT barrel-exported (confirmed: neither
appears in `index.ts`'s `export *` list); both are consumed only via direct relative import from
`http-lookup-client.ts`, and `related-line.ts` follows the identical pattern (§4).

### 3.5 `packages/app/src/app/http-lookup-client.ts`

Add the import, alongside the existing `parseDefinedAs`/`parseTranslation` imports:

```ts
import { parseRelated } from '../domain/related-line';
```

Extend the existing parse chain and result construction (current lines 157-169):

```ts
const { definedAs, body: afterDefinedAs } = parseDefinedAs(text);
const { translation, body: afterTranslation } = parseTranslation(afterDefinedAs);
const { related, body: parsedBody } = parseRelated(afterTranslation);
return {
  markdown: parsedBody,
  word: req.word,
  target: req.target,
  model: spec.model,
  provider: spec.provider,
  fromCache: false,
  fetchedAt: Date.now(),
  ...(definedAs !== undefined ? { definedAs } : {}),
  ...(translation !== undefined ? { translation } : {}),
  ...(related !== undefined ? { related } : {}),
};
```

No other change to this file — the `buildPrompt` call (already passing `req.refine` as its 5th
argument per A3 §3.6) needs no B13-specific change; `req.refine === 'related'` flows through the
existing generic parameter.

### 3.6 `packages/app/src/domain/saved-words-policy.ts`

New function, positioned immediately after `savedWordSetStatus` (current lines 86-98), mirroring
its exact shape:

```ts
/**
 * B13: patch the related-words list onto an ALREADY-saved word's current (senses[0]) sense.
 * No-op (returns null) when the word isn't currently saved — mirrors savedWordSetStatus's own
 * contract exactly: "only persists when the word IS saved" (roadmap fence) is enforced HERE,
 * atomically, because this is the only place with real ground truth (the composition root's own
 * "is this saved" tracking is reset on every render and cannot answer reliably — see the design
 * spec's §2.5). Targets senses[0] specifically: pre-B14, `senses` is always exactly one entry
 * (savedWordUpsert never produces more), and a 'related' refine tap always answers about the
 * single sense currently on screen.
 */
export async function savedWordSetRelated(
  deps: SavedWordsDeps,
  word: string,
  related: string[],
): Promise<SavedWordEntry | null> {
  const key = normalizeWordKey(word);
  const raw = await deps.storage.getItem(`saved:${key}`);
  if (!raw) return null;
  const existing = JSON.parse(raw) as SavedWordEntry;
  const senses = existing.senses.map((s, i) => (i === 0 ? { ...s, related } : s));
  const entry: SavedWordEntry = { ...existing, senses };
  await deps.storage.setItem(`saved:${key}`, JSON.stringify(entry));
  return entry;
}
```

No change to `savedWordUpsert` — per §2.6, a normal re-save deliberately does not preserve a
previously-set `related` value; the function's existing sense-construction (current lines 49-55)
is left exactly as-is.

### 3.7 `packages/app/src/app/router.ts`

Add `savedWordSetRelated` to the existing import list from `'../index'` (alongside
`savedWordSetStatus`).

New case, positioned immediately after the existing `'saved.setStatus'` case (current lines
261-266), mirroring its exact reply shape:

```ts
      case 'saved.setRelated': {
        const entry = await deps.queue.run(() =>
          savedWordSetRelated({ storage: deps.kv }, msg.word, msg.related),
        );
        return entry ? { ok: true, type: 'saved', entry } : { ok: true, type: 'ack' };
      }
```

Routed through the same `WriteQueue` every other `saved:*` write already uses (serializes
concurrent KV writes for the same word — no new concurrency primitive). No change to the
exhaustive `switch(msg.type)`'s shape otherwise — TypeScript's exhaustiveness check on the
`WireMessage` discriminated union (§3.2's new arm) is what makes omitting this case a compile
error, exactly as the router's existing "no default arm" contract already guarantees
(`docs/ROADMAP.md` §8 Decision Log, 2026-07-16 B5/B3 entry — the reason wire+router land in ONE
task, §5 below).

### 3.8 `packages/app/src/ui/lookup-card.ts`

`REFINE_CHIPS` (A3's exported array) gains a 5th entry, appended last:

```ts
export const REFINE_CHIPS: RefineChip[] = [
  { id: 'simpler', label: 'Simpler' },
  { id: 'examples', label: 'More examples' },
  { id: 'etymology', label: 'Etymology' },
  { id: 'usage', label: 'Use it' },
  { id: 'related', label: 'Related words' },
];
```

No other change to this file — `renderRefineRow` (A3's generic `for (const chip of REFINE_CHIPS)`
loop) renders the 5th chip automatically; no new CSS class, no new event name (the existing
`refine`/`refine-back` composed events already carry `detail.refine` generically for any
`RefineKind`).

**Existing A3 test fix required in the same task (§5 below, spec-coverage note):** A3's own unit
test `'renders exactly 4 refine chips with the pinned copy, in order, none active'`
(`packages/app/test/ui/lookup-card.test.ts`) hardcodes a 4-element expected array — it will fail
the moment `REFINE_CHIPS` has 5 entries. Not a new bug B13 introduces; a direct, expected
consequence of exercising A3's own designed extension point, and this card's plan fixes it in the
same task that adds the 5th chip (Task 3).

### 3.9 `packages/extension-chrome/src/content.ts`

Extend the `renderResult` handler (current lines 86-105, already carrying A3's
`lastOriginalSavePayload` snapshot per that card's Task 6) with one more block, inserted
immediately after the existing `if (ctx?.refine === undefined) lastOriginalSavePayload =
lastSavePayload;` line and before `lastSaved = false;`:

```ts
// B13: a 'related' refine tap auto-persists the parsed related-words list onto the
// ALREADY-saved entry — fire-and-forget; the router's savedWordSetRelated no-ops
// server-side when the word isn't currently saved (design spec §2.5 — "show but don't
// persist"). No client-side is-saved tracking needed or possible here: lastSaved is reset
// below on every render, including this one, so it can never answer "was this saved
// before this tap" reliably (design spec §2.5's rejected alternative).
if (ctx?.refine === 'related' && r.related && r.related.length > 0) {
  void chrome.runtime
    .sendMessage({ type: 'saved.setRelated', word: r.word, related: r.related })
    .catch(() => undefined);
}
```

No other change to `content.ts` — the star-click (`toggle-save`), status-toggle
(`toggle-status`), and refine-back (`refine-back`) listeners A3 already established are
untouched (§2.6/§2.7 above explain why no change is needed there).

## 4. No change to the following (recorded explicitly — an implementer would reflexively check these)

- **`packages/app/src/domain/prompt-template.ts`** — `buildPrompt`'s 5-parameter signature (A3)
  already threads any `RefineKind` value generically; no B13-specific parameter or branch.
- **`packages/app/src/ports.ts`** — `ResultRenderContext.onRefine`/`.refine` (A3) are reused
  verbatim; no new field.
- **`packages/app/src/domain/workflow.ts`** — `runLookup`'s `refine` parameter and `ctx.onRefine`
  closure (A3) are reused verbatim; a `'related'` tap is just one more value of the same
  parameter.
- **`packages/app/src/app/inline-bottom-sheet-renderer.ts`** — `renderResult`/`restoreOriginal`/
  `originalState` (A3) operate generically on any `RefineKind`; no B13-specific branch.
- **`packages/extension-chrome/src/side-panel.ts` / `packages/app/src/ui/side-panel-view.ts`** —
  per §2.9, the chip row and the persistence auto-fire are both absent by construction; zero code
  changes.
- **`packages/app/src/domain/saved-words-policy.ts`'s `savedWordUpsert`** — per §2.6, deliberately
  unmodified; a normal re-save clears `related` rather than preserving it.
- **`packages/app/src/index.ts` barrel** — `related-line.ts` is not barrel-exported, matching the
  existing `translation-line.ts`/`defined-as.ts` precedent (§3.4). `RefineKind`, `related`,
  `REFINE_CHIPS`, `savedWordSetRelated` are all already re-exported via existing `export *`
  statements (`domain/types`, `ui/index`, `domain/saved-words-policy`) — no barrel edit needed for
  any of them either.
- **`packages/app/manifest.json` / any `permissions`/`host_permissions`** — no new API surface, no
  new host (`chrome.runtime.sendMessage` is already used for every other `saved.*` message).
- **`packages/extension-safari/**`** — by the same reasoning A3 §11/A8 §11 already established:
the Safari shell composes the identical `runLookupWorkflow`+`InlineBottomSheetRenderer`+`buildRouter`from the core, so it inherits the 5th chip and the`saved.setRelated`handling for
free with zero Safari-specific code (its own`content.ts`/`sw.ts` wire the same ports —
  confirmed unchanged since A8/A3's own audits of this fact).
- **`packages/app/src/domain/error-mapper.ts` / `markdown-sanitize.ts`** — a `'related'` refine
  request fails exactly like any other lookup (existing `LookupErrorCode` table); its markdown
  passes through the identical, unconditional `sanitizeMarkdown` call before reaching the DOM (S4
  untouched).

## 5. Scope fence held (from the roadmap card)

- **"A 'Related words' chip (part of A3's row) whose result... is persisted onto the saved
  entry"** — §3.8 appends exactly one chip to A3's existing row; §3.6/§3.7/§3.9 implement the
  persistence path. Held by construction.
- **"Only persists when the word IS saved" / dispatch note "pin behavior when not saved: show but
  don't persist"** — §2.5/§3.7: `savedWordSetRelated` no-ops server-side on a miss; the card
  always shows the result (A3's unconditional refine-replaces-body mechanism) regardless of saved
  state.
- **"Persisted onto the entry (extends the B2 schema)" / "the schema field goes through the B2
  lock"** — §2.4/§3.1/§3.2: `SavedWordSense.related?: string[]`, additive, under the E1/B2 lock
  the owner's Decision Log already names this exact field against (`docs/ROADMAP.md:962-963`). No
  restructuring of any already-ratified field.
- **"Lead decides: chip copy"** — §2.3: "Related words," pinned with rationale.
- **A3's own fence, inherited unmodified:** "Fixed [5, after this card] chips... Refined answer
  replaces the body... Back restores the original... Original word + sentence re-sent
  automatically" — all held by construction; B13 adds a 5th value to an already-generic mechanism,
  changing none of A3's own logic (§4).
- **Constraint 4 (no background LLM calls, every model call user-triggered, token-spending
  features say so first)** — the ONLY LLM call this card can cause is the same one-shot refine tap
  A3 already gates behind an explicit chip click; the `saved.setRelated` write itself is a local
  KV write with **zero** tokens and **zero** network calls (payoff per the roadmap: "the family is
  there later with no new API call").
- **S1 (API key isolation)** — untouched; no new field carries the key, no wire message this card
  adds touches key storage.
- **S4 (sanitize model output, including partial/streamed)** — untouched; a `'related'` result's
  markdown flows through the exact same, single `sanitizeMarkdown` trust boundary as any other
  result. The machine-only `RELATED:` line is stripped BEFORE the markdown ever reaches
  sanitization (mirrors `TRANSLATION:`/`DEFINED_AS:`'s own contract) — never rendered, never
  sanitized-and-shown, by construction.
- **Design tokens only** — no new UI beyond one more chip button, which reuses A3's existing
  `.refine-chip` class/CSS wholesale (§3.8 adds zero new CSS).
- **Ports architecture** — the one new outward capability (the `saved.setRelated` wire message) is
  an addition to the existing wire protocol, not a new ad hoc channel; `domain/` stays
  dependency-free (`related-line.ts`, the `saved-words-policy.ts` addition, and every `types.ts`/
  `default-template.ts` edit touch only zero-import domain-pure files; none import `chrome.*`,
  `fetch`, or the DOM).

## 6. Testing strategy

Vitest (unit, happy-dom where DOM is touched) + Playwright (e2e), per repo convention.

### 6.1 Unit tests

- **`packages/app/test/related-line.test.ts`** (new, mirrors `translation-line.test.ts`'s
  structure exactly): extracts a `RELATED` line and strips it (plus one following blank line);
  returns the entire original text unchanged when no `RELATED` line is present; tolerates the line
  appearing after leading whitespace/other stripped lines (real pipeline order: DEFINED_AS then
  TRANSLATION then RELATED); comma-splits and trims (`"a, b ,c"` → `['a', 'b', 'c']`); drops empty
  entries from stray double-commas; caps at 8 even when the model lists more; does not strip
  anything beyond the matched line and one following blank line.
- **`packages/app/test/default-template.test.ts`** (modify one existing A3 test, append one new
  block): update `'has exactly the 4 v1 refine kinds, each a non-empty string'` (in the
  `describe('REFINE_INSTRUCTIONS', ...)` block) to expect the 5 sorted keys `['etymology',
'examples', 'related', 'simpler', 'usage']` — **this existing test WILL fail without this
  update** once `REFINE_INSTRUCTIONS.related` is added (§3.3's forcing function). Append: `related`
  mentions `{word}` (mirrors the existing `examples`/`usage` "mentions {word}" test).
- **`packages/app/test/wire-schema.test.ts`** (append): `LookupResultSchema` accepts an optional
  `related: string[]`; `SavedWordEntrySchema`'s nested sense accepts an optional `related:
string[]`; `LookupRequestSchema` accepts `refine: 'related'` (extends A3's existing loop-based
  test coverage with the 5th value explicitly, since that test hardcodes its 4-value array rather
  than deriving from `REFINE_INSTRUCTIONS`); a new `describe('saved.setRelated wire message
  (B13)', ...)` block mirroring the existing `saved.setStatus` tests: accepts a valid
  `{type:'saved.setRelated', word, related: [...]}`; rejects one missing `word` or `related`;
  rejects `related` containing a non-string. **Regenerate the JSON-schema snapshot**
  (`packages/app/wire-schema.snapshot.json`) via `bunx vitest run wire-schema -u` in the same task
  that lands the schema changes, and again after the new wire arm lands (two separate regen
  points, §7).
- **`packages/app/test/saved-words-policy.test.ts`** (append, mirrors the existing
  `savedWordSetStatus` tests at lines 122-151 exactly): `savedWordSetRelated` on an existing entry
  patches `senses[0].related`, preserves every other field (`status`, `savedAt`, `senses[0]`'s
  other fields) unchanged; is case-insensitive on the word key; **on an unsaved word is a no-op
  returning `null`** (the direct regression test for this card's central invariant, mirroring
  `savedWordSetStatus`'s own no-op test at lines 148-151 exactly); a subsequent plain
  `savedWordUpsert` (simulating a normal re-save) on the SAME word clears `related` (the direct
  regression test for §2.6's pinned "not preserved across re-save" behavior — asserts
  `second.senses[0]!.related` is `undefined` after `savedWordSetRelated` then `savedWordUpsert`).
- **`packages/app/test/app/router.test.ts`** (append, mirrors the existing `saved.setStatus` tests
  at lines 538-579 exactly): `saved.setRelated` on an already-`saved.save`d word returns
  `{ok:true, type:'saved', entry:{senses:[{related:[...]}]}}`; on a never-saved word returns
  `{ok:true, type:'ack'}` (no `saved:*` key created — asserted via `d.kv.getItem`); is
  case-insensitive on the word key.
- **`packages/app/test/app/gemini-lookup-client.test.ts`** (append, mirrors the existing
  `describe('B2 translation extraction via runHttpLookup', ...)` block at lines 398-... exactly, as
  a new `describe('B13 related words extraction via runHttpLookup', ...)`): a
  `DEFINED_AS` + `TRANSLATION` + `RELATED` triple is parsed into `result.related` and all three
  signal lines are stripped from `markdown`; a response with no `RELATED` line leaves `related`
  undefined (back-compat); `req.refine='related'` reaches the prompt as the related instruction
  text (mirrors the existing `req.forceLiteral`/idiom prompt-content assertions).
- **`packages/app/test/ui/lookup-card.test.ts`** (modify one existing A3 test in place, no new
  `describe` block needed — extending A3's existing `describe('<lookup-card> refine chips +
back-to-original (A3)', ...)` coverage is sufficient since the row logic itself is unchanged):
  update `'renders exactly 4 refine chips with the pinned copy, in order, none active'` to expect
  5 chip texts, `['Simpler', 'More examples', 'Etymology', 'Use it', 'Related words']` — **this
  existing test WILL fail without this update** once `REFINE_CHIPS` has 5 entries. No other test
  in that block needs a change (the "active chip"/"back button"/"absent row" tests already loop
  generically over however many chips exist, confirmed by re-reading each — see design spec §5's
  "spec-coverage sweep" note).
- **`packages/app/test/app/inline-bottom-sheet-renderer.test.ts`** (modify one existing A3 test in
  place): update `'renderResult always sets refineChips:true so the card shows the 4-chip row
(A3)'`'s assertion from `.toBe(4)` to `.toBe(5)` (title may stay as-is or be updated to note "5
  after B13" — cosmetic). **This existing test WILL fail without this update.**
- **No dedicated `content.ts` unit test** — same precedent A3's own plan already recorded
  (composition root, e2e-only coverage). §3.9's `saved.setRelated` auto-fire is proven by the e2e
  scenario below.

### 6.2 E2e tests (`packages/extension-chrome/e2e/b13-related-words.spec.ts`, new — follows

`a3-follow-up-chips.spec.ts`'s structure)

1. **Related chip renders as the 5th chip**: seed settings, `gotoFixture`, `mockGemini` (default
   OK body), select "bank", open trigger → assert the card shows 5 `.refine-chip` buttons, the
   5th reading `Related words`, none `aria-pressed="true"`/`disabled`.
2. **Tapping the chip resends the original word/sentence with the related instruction, replaces
   the body, and does NOT persist when the word is not saved**: continuing from test 1, swap in a
   mock response containing `RELATED: "shore, embankment, bluff"` plus a visible "Related words"
   section → click the `Related words` chip → assert the outbound prompt contains the related
   instruction's distinguishing text (`"RELATED WORDS"`) and still contains the original word
   `"bank"`/sentence text (mirrors A3 e2e test 2's assertions) → assert the card body now shows
   the related-words content and the `RELATED:` line itself never appears in the visible card text
   (mirrors `saved-word.spec.ts`'s existing "`TRANSLATION:`/`DEFINED_AS:` never leak" assertions)
   → assert `chrome.storage.local` has **no** `saved:bank` key (the word was never starred — the
   direct regression test for "show but don't persist when unsaved").
3. **Tapping the chip on an already-saved word persists `related` onto the existing entry, with
   zero additional user action**: select "bank", star it (persisting `saved:bank` with no
   `related` field, mirroring `saved-word.spec.ts`'s existing save assertions), then tap the
   `Related words` chip (swap in the same related-bearing mock as test 2) → `expect.poll` the
   service-worker storage dump until `saved:bank`'s parsed entry has
   `senses[0].related` → assert it equals `['shore', 'embankment', 'bluff']` → assert every other
   field on the entry (`definition`, `translation`, `sentence`, `url`, `title`, `status`,
   `savedAt`) is byte-identical to what the star click alone had already persisted (the direct
   regression test for "auto-persist touches only `related`, nothing else").
4. **A subsequent normal re-save clears the previously-persisted `related` array**: continuing
   from test 3, re-tap the (now-showing-related) card's Back-to-original pill, then click the star
   again (now unsaving then... — instead: use a SECOND fresh lookup+save cycle for the same word
   to simulate a genuine re-save, matching `saved-words-policy.test.ts`'s own upsert-replaces-sense
   unit coverage) → assert the entry's `senses[0].related` is now `undefined` (the direct
   regression test for §2.6's pinned "not preserved across re-save" behavior at the e2e layer).
5. **A refine tap always hits the network, even for an already-cached word/sentence/target**
   (mirrors A3 e2e test 4 exactly, run once more for `'related'` specifically, since this is the
   first NEW `RefineKind` value added after A3's own generic cache-guard coverage): look up "bank"
   once (populating the cache), then tap `Related words` for the SAME word/sentence → assert the
   mock's call count increments (not served from cache).

**Required fix to the already-existing `a3-follow-up-chips.spec.ts` in the same task** (a direct
consequence of widening `REFINE_CHIPS`, not a new bug): test 1 ("chips render on every result")
asserts `await expect(chips).toHaveCount(4)` and checks `chips.nth(0..3)` explicitly — this
assertion **will fail** the moment `REFINE_CHIPS` has 5 entries. Update the count to `5` and add a
`chips.nth(4)` assertion for `Related words` (`aria-pressed="false"`, enabled). No other existing
A3 e2e assertion breaks (re-verified: test 3's `for (const i of [0,1,2,3])` loop doesn't assert a
total count, so it does not fail — it simply doesn't additionally check index 4; widening its
range to `[0,1,2,3,4]` in the same touch is a low-cost completeness improvement, not a
required fix).

## 7. Testing performed (PR evidence — replaces screenshot/video capture)

Per this worktree's `CLAUDE.md` (owner ruling 2026-07-16): **no screenshots or video for this
PR.** The PR body's "Testing performed" section carries the evidence instead — the suites run
(`bun run test`, `bun run typecheck` for both `app` and `extension-chrome`), test counts (existing

- this plan's additions, enumerated in §6.1/§6.2), lint/format-check results, and the specific e2e
  spec file(s) exercised (`b13-related-words`, plus the existing regression guards this card's files
  share — `a3-follow-up-chips` (re-run after its own required fix), `saved-word`, `cache-history`).
  No `pr-assets/*` branch is created.

## 8. Risk / rollback

- **Risk: low.** Every domain/wire/prompt change is additive (a new union member, a new optional
  field on two already-optional-field-friendly types, one new `Record` key, one new wire arm with
  its own no-op-safe handler). The one genuinely new correctness surface is §2.5's "only when
  saved" invariant, and it is enforced by an atomic, already-proven function shape
  (`savedWordSetStatus`'s own contract, reused verbatim) rather than new ad hoc logic — directly
  covered by e2e tests 2 and 3 (§6.2), which assert actual persisted storage content, not just UI
  state.
- **Inherited, not introduced, risks (stated explicitly, matching A3's own risk-framing style):**
  the cache-write-can-clobber risk (§2.8) and the save-while-refined-shows-refined-text behavior
  (§2.7) both already exist for A3's 4 original refine kinds; B13 adds a 5th value to the same
  generic mechanisms and inherits, not creates, these characteristics.
- **A genuinely new, but bounded, risk: two pre-existing A3 tests + coupling to `senses[0]`
  specifically.** Widening `REFINE_CHIPS`/`REFINE_INSTRUCTIONS` breaks two already-shipped A3 unit
  tests and one e2e assertion (§6.1/§6.2) — all three are mechanically fixed in this plan's tasks,
  not left for a future PR to discover as a CI failure. `savedWordSetRelated` targets `senses[0]`
  specifically, which is correct today (senses is always length 1) but will need re-examination
  the day B14 ships a real multi-sense array — flagged here so B14's own future spec inherits the
  awareness rather than rediscovering it.
- **No data migration.** Every entry saved before this card simply lacks `senses[0].related`
  (`undefined`, per the optional-field contract) — reads unaffected, no backfill needed, no
  version bump to the E1 shape (this is exactly the "additive fields... stay lead-decidable"
  allowance the owner's own Decision Log grants, `docs/ROADMAP.md:962-963`).
- **Rollback:** revert the single PR. Pre-B13 behavior (4 chips, no `RELATED:` parsing, no
  `saved.setRelated` message, `SavedWordSense` without `related`) returns exactly as it was; no
  stored data becomes invalid — a saved entry that happens to carry `senses[0].related` (persisted
  before the revert) simply has an extra, harmlessly-ignored field once the reading code no longer
  looks for it (the same "strict schema on write, tolerant on read" pattern every other additive
  field in this codebase already relies on — `SavedWordSenseSchema` is `z.strictObject`, but that
  only rejects _unknown_ keys on a message it's actively validating, not on data merely sitting in
  storage that a rolled-back build never re-parses through the schema).

## 9. Files touched (summary)

| File                                                         | Change                                                                                                                                       |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/app/src/domain/types.ts`                           | `RefineKind` widened +`'related'`; `LookupResult.related`; `SavedWordSense.related`                                                          |
| `packages/app/src/wire.ts`                                   | `RefineKindEnum` widened; `LookupResultSchema.related`; `SavedWordSenseSchema.related`; new `saved.setRelated` arm + `MessageTypeEnum` entry |
| `packages/app/src/domain/default-template.ts`                | `REFINE_INSTRUCTIONS.related` (new key, forced by the widened `RefineKind`)                                                                  |
| `packages/app/src/domain/related-line.ts`                    | new file — `parseRelated`                                                                                                                    |
| `packages/app/src/app/http-lookup-client.ts`                 | call `parseRelated`; include `related` in the returned `LookupResult`                                                                        |
| `packages/app/src/domain/saved-words-policy.ts`              | new `savedWordSetRelated` (no-op-if-unsaved, mirrors `savedWordSetStatus`)                                                                   |
| `packages/app/src/app/router.ts`                             | new `saved.setRelated` case                                                                                                                  |
| `packages/app/src/ui/lookup-card.ts`                         | `REFINE_CHIPS` gains a 5th entry                                                                                                             |
| `packages/extension-chrome/src/content.ts`                   | auto-fire `saved.setRelated` when a `'related'` result renders non-empty                                                                     |
| `packages/app/test/related-line.test.ts`                     | new — unit tests (§6.1)                                                                                                                      |
| `packages/app/test/default-template.test.ts`                 | modify 1 existing test + append (§6.1)                                                                                                       |
| `packages/app/test/wire-schema.test.ts`                      | append (§6.1); `wire-schema.snapshot.json` regenerated twice                                                                                 |
| `packages/app/test/saved-words-policy.test.ts`               | append (§6.1)                                                                                                                                |
| `packages/app/test/app/router.test.ts`                       | append (§6.1)                                                                                                                                |
| `packages/app/test/app/gemini-lookup-client.test.ts`         | append (§6.1)                                                                                                                                |
| `packages/app/test/ui/lookup-card.test.ts`                   | modify 1 existing test (§6.1)                                                                                                                |
| `packages/app/test/app/inline-bottom-sheet-renderer.test.ts` | modify 1 existing test (§6.1)                                                                                                                |
| `packages/extension-chrome/e2e/b13-related-words.spec.ts`    | new — functional e2e (§6.2)                                                                                                                  |
| `packages/extension-chrome/e2e/a3-follow-up-chips.spec.ts`   | fix 1 existing assertion (chip count 4→5, §6.2)                                                                                              |

No change to `packages/app/src/domain/prompt-template.ts`, `packages/app/src/ports.ts`,
`packages/app/src/domain/workflow.ts`, `packages/app/src/app/inline-bottom-sheet-renderer.ts`
(logic — only its test file changes), `packages/extension-chrome/src/side-panel.ts`,
`packages/app/src/ui/side-panel-view.ts`, `packages/app/src/index.ts`, any manifest file, or
`packages/extension-safari/**` (§4).

## 10. Concurrency

Files this card modifies that other **unshipped** roadmap cards also modify, per CONTRACTS §5's
hot-file list, A3's own self-flagged additions, and one more this spec's own research surfaced:

- **`packages/app/src/ui/lookup-card.ts`** — CONTRACTS' listed hot file for A1/A2/A3/A5/A7/A10,
  now also B13. Any of those landing concurrently with B13 needs serialization against this
  card's `REFINE_CHIPS` edit (a single-line array append — low collision risk, but still the same
  file).
- **`packages/app/src/domain/types.ts` and `packages/app/src/wire.ts`** — already flagged by A3's
  own Concurrency section as shared with A12 (both touch `LookupRequestSchema`/`LookupRequest`).
  B13 adds a THIRD concurrent writer to these same two files (widening `RefineKind`/
  `RefineKindEnum`, plus the new `LookupResultSchema.related`/`SavedWordSenseSchema.related`/
  `saved.setRelated` arm) — but B13 is sequenced strictly after A3 ships (this card's own
  dependency), so it is a follow-on against A3's landed code, not a concurrency hazard with A3
  itself. It IS a live hazard against A12 (non-english-source) and B12/B14 if any of those are
  in flight on the same two files at the same time as B13 — flag for the orchestrator.
- **`packages/app/src/domain/default-template.ts`** — CONTRACTS §5 already lists this as hot for
  A12/B12; A3 flagged itself as a third writer (the `{refine_instruction}` slot); B13 is a FOURTH
  writer (the `REFINE_INSTRUCTIONS.related` key) — same file, same caution.
- **`packages/app/src/domain/saved-words-policy.ts` and `packages/app/src/app/router.ts`'s
  `saved.*` case block** — **not on CONTRACTS §5's original hot-file list**, but B13 is the second
  card (after B1/B5/B7, already shipped) to touch this area, and this spec's own reading of the
  still-open backlog surfaces two more upcoming writers here: **B14** (sense-aware dedup;
  its dispatch note explicitly says "wire changes if any (ground saved.save's current
  payload/reply)" — i.e. it may touch the very same `saved.save`/router-case block) and **B6**
  (words page; needs a delete-by-id wire path its dispatch note flags as possibly new wire+router
  work in the same block). Flag both for the orchestrator as hazards against this card's
  `saved.setRelated` addition landing in the same file/switch statement.
- **`packages/extension-chrome/src/content.ts`** — already flagged by A3 as touched substantially
  (its own §2.5 fix); B13 adds one more block to the same `renderResult` handler. Any other
  unshipped card that also edits this handler (none currently listed per CONTRACTS §5) should
  serialize against both A3 and B13.
- **`packages/extension-chrome/e2e/a3-follow-up-chips.spec.ts`** — B13's Task 6 must edit this
  already-shipped-by-the-time-B13-runs file (§6.2's required fix). If any OTHER card also touches
  this spec file concurrently with B13, that is a direct file-conflict hazard worth flagging to
  the orchestrator, though none is currently known to.
