# B8 — Anki / CSV export

Roadmap card: `docs/ROADMAP.md` §4 B8 (Impact 4 · Effort S · Score 4.0). Depends on: B1 (save word,
shipped), B2 (rich context capture / translation line, shipped). Feeds: none — this is a leaf
export feature.

## 1. Problem (grounded in code)

Today saved words are locked inside the extension with no way out:

- `SavedWordEntry` (`packages/app/src/domain/types.ts:246-251`) — `{ word, status, savedAt,
senses: SavedWordSense[] }` — and `SavedWordSense` (`types.ts:231-237`) — `{ definition,
translation, sentence, url, title }` — are persisted one-per-normalized-word under
  `saved:<word>` (`packages/app/src/domain/saved-words-policy.ts:41-68`, B1) with a full list
  reader already provided: `savedWordsList(deps): Promise<SavedWordEntry[]>`
  (`saved-words-policy.ts:110-118`, "Full list, no pagination... B1 ships the primitive, not
  pagination — no callers need it yet").
- Nothing calls `savedWordsList` outside its own test today (confirmed by grep — its only callers
  are `packages/app/test/*.test.ts`). There is no wire message that returns every saved word: the
  three `saved.*` arms in `WireMessageSchema` (`packages/app/src/wire.ts:111-127`) are `saved.save`,
  `saved.delete`, `saved.setStatus` — all single-word reads/writes. `buildRouter`'s corresponding
  cases (`packages/app/src/app/router.ts:242-266`) call `savedWordUpsert`/`savedWordDelete`/
  `savedWordSetStatus` — never `savedWordsList`.
- A file-export precedent already exists for a different keyspace: "Export history"
  (`packages/app/src/ui/settings-form.ts:210`, wired at `:312` via
  `this.relay('#export', 'export-history')`) sends `{ type: 'history.list' }`, pipes the reply
  through the pure `buildHistoryExport(entries)` (`packages/app/src/app/history-export.ts:10-32`,
  reconstructs each entry field-by-field so a stray property can never survive into the file — the
  card's own S1 pattern to copy), and downloads the result via a composition-root-local `download()`
  helper: `packages/extension-chrome/src/options.ts:56-64` and, identically,
  `packages/extension-safari/src/options.ts:46-54` — both `URL.createObjectURL(new Blob([content],
{ type: 'application/json' }))` → a synthetic `<a download>` click → `URL.revokeObjectURL`. Both
  composition roots wire the `export-history` event the same way
  (`options.ts:158-176` Chrome, `options.ts:94-112` Safari). This is the extension's only existing
  file-export mechanism (no `.apkg`/Anki-library dependency exists in `package.json` anywhere in the
  repo — confirmed by grep).
- B8's own scope fence rules out reusing `.apkg` entirely ("Anki imports TSV natively"), so this
  card needs (a) a way to read every saved word through the wire, and (b) new pure "build the
  export payload" functions parallel to `buildHistoryExport`, for three formats instead of one.

## 2. Design question 1 — how does the export flow read every saved word?

`savedWordsList` already exists and already returns exactly what's needed
(`saved-words-policy.ts:110-118`), but it is a **domain function that only the service worker's
`RouterDeps.kv` can reach** — nothing crosses `chrome.runtime` for it today. Three options:

**(a) Add a new wire message `saved.list` (payload-free) + router case**, calling
`savedWordsList({ storage: deps.kv })` and replying with the full array — the exact shape of
`history.list`/`history` today, minus pagination (B1's contract is "no callers need pagination
yet", and B8 doesn't either: an Anki deck export is a one-shot "give me everything" action, not a
paginated UI).

**(b) Reuse `history.list`'s wire arm with a keyspace flag.** Rejected: `history.list` is typed to
return `HistoryEntry[]` (`wire.ts:170-173, 100-103`) and is read by `historyList`
(`history-policy.ts:32-57`), a completely different keyspace/cap/shape (`history:*`, cap 500,
`HistoryEntry`) from `saved:*` (uncapped, `SavedWordEntry`). Overloading one wire arm to serve two
unrelated domain readers would mean branching inside `handleHistoryList` on some new flag, and the
reply's `entries` field would need to be a union of two incompatible entry shapes — exactly the
kind of ad hoc schema surgery `rule-typed-errors`/the wire's `strictObject`-everywhere discipline
exists to prevent. A dedicated arm costs one small, obviously-scoped schema addition instead.

**(c) Read `saved:*` keys directly from the options page via `Storage.keys('saved:')`.** Rejected:
the options page has no `Storage` port instance of its own — `ChromeKvStore`
(`extension-chrome/src/adapters/chrome-kv-store.ts:14-32`) is composed only inside `sw.ts`
(`sw.ts:81-114`), exactly like the `LookupClient` C2's spec already documented as SW-only. Reading
storage a second way from the options page would duplicate the same trusted-composition-root
boundary question C2 answered for the HTTP client, for no reason — the whole point of the
`saved:*` keyspace living behind the router is that every reader/writer goes through one place
(`saved-words-policy.ts`), so a save race, a future migration, or a schema tweak only has one call
site to change.

**Pinned: option (a).** Add to `packages/app/src/wire.ts`:

```ts
// B8: read every saved word (no pagination — mirrors savedWordsList's "full list" contract,
// saved-words-policy.ts:108-109). Read-only; the only caller today is the Anki/CSV/Markdown
// export flow in settings-form.ts.
z.object({ type: z.literal('saved.list') }),
```

added to `WireMessageSchema`'s array, and to `MessageTypeEnum` (`wire.ts:143-158`), and a reply arm:

```ts
z.object({
  ok: z.literal(true),
  type: z.literal('saved.list'),
  entries: z.array(SavedWordEntrySchema),
}),
```

**Reply type is `'saved.list'`, not `'saved'`.** The existing `'saved'` reply type
(`wire.ts:175`) already means "one entry, from `saved.save`/`saved.setStatus`"
(`router.ts:256,265`). Binding the new reply's discriminant to the message's own name (rather than
inventing a second synonym like `'saved-list'` or overloading `'saved'` with an optional `entries`
field) keeps the 1:1 message↔reply naming unambiguous and greppable, and cannot collide with the
existing single-entry `'saved'` reply at the type-checker level (`WireReplySchema` is a
`z.union`, discriminated by the literal string). This intentionally departs from
`history.list → 'history'`'s naming (which drops the `.list` suffix) — that shorter name was free
to take there because nothing else already used `'history'`; here `'saved'` was already spoken
for by a different shape, so reusing the message's own literal is the option that adds no new
vocabulary.

`packages/app/src/app/router.ts` gets one new handler and one new switch case (no other case
changes):

```ts
async function handleSavedList(): Promise<RouterReply> {
  const entries = await savedWordsList({ storage: deps.kv });
  return { ok: true, type: 'saved.list', entries };
}
```

— added next to `handleConnectionTest` (`router.ts:195-211`), `savedWordsList` added to the
existing import block from `'../index'` (`router.ts:1-24`, alongside `savedWordUpsert`/
`savedWordDelete`/`savedWordSetStatus`) — and, in the `switch (msg.type)` (`router.ts:213-287`):

```ts
case 'saved.list':
  return handleSavedList();
```

placed directly after the existing `case 'saved.setStatus':` block (`router.ts:261-266`), before
`case 'cache.clear':`. Per this batch's Global Constraint ("wire.ts arm + router.ts case are ONE
task — exhaustive switch, no default"), both edits land in a single implementation task.

## 3. Design question 2 — column order, and one row per saved word or per sense?

The card's "Lead decides: column order/format" is pinned here, verbatim from this batch's shared
dispatch notes (not re-derived): **word, definition, translation, sentence, url, title, savedAt,
status — with per-sense row expansion.**

`SavedWordEntry.senses` is already an array (`types.ts:250`, "starts single-entry; multi-sense
merge is B14's future job") — B1 only ever writes one sense per entry today
(`savedWordUpsert` replaces `senses[0]` wholesale on every re-save, `saved-words-policy.ts:56-61`),
but the shape is already multi-sense-ready. **Pinned: emit one export row per sense, with `word`/
`savedAt`/`status` repeated on every row for that word** (the entry-level fields), rather than one
row per entry with senses concatenated into a single cell. Rationale:

- **Forward-compatible with B14 for free.** The day B14 turns `senses` into a real multi-entry
  array, this card's export logic needs zero changes — it already iterates `senses`. Concatenating
  senses into one cell (the rejected alternative) would need a follow-up patch the moment B14 ships
  multi-sense entries, and would produce a single Anki card that tries to test two unrelated
  meanings at once — exactly the ambiguity the product's "one sense in play" differentiator
  (`docs/ROADMAP.md` §2, "it keeps the sentence and returns the one sense in play") argues against
  reproducing on the flashcard side.
- **One Anki card per sense** is also the more useful pedagogical unit: a learner reviewing
  "bank (financial)" and "bank (river)" as two separate cards, each anchored to its own real
  sentence, is the whole value proposition ("each card carrying its real sentence",
  `docs/ROADMAP.md` §4 B8 "Payoff").

Column order is fixed positionally (not alphabetical, not by struct declaration order) so that
importing into Anki's "Basic" note type via manual field mapping is a single, memorizable
sequence: **front-of-card fields first (word), then the answer content in the order a learner
would read it (definition → translation → sentence), then provenance (url, title), then metadata
last (savedAt, status)** — metadata columns trail so trimming them for a specific note type (e.g.
a 6-field "Basic" template that ignores the last two) never disturbs the content columns' indices.

## 4. Design question 3 — file formats, escaping rules, and the download mechanism

Three pure builder functions, new file `packages/app/src/app/anki-export.ts` (co-located with
`history-export.ts`, same package, same pattern — a pure `(entries) => { filename, content }`
function per format, no I/O):

```ts
import type { SavedWordEntry } from '../domain/types';

interface AnkiExportRow {
  word: string;
  definition: string;
  translation: string;
  sentence: string;
  url: string;
  title: string;
  savedAt: string; // ISO-8601, converted from SavedWordEntry.savedAt (epoch ms) — see rationale below
  status: string;
}

const COLUMNS = [
  'word',
  'definition',
  'translation',
  'sentence',
  'url',
  'title',
  'savedAt',
  'status',
] as const;

/** B8: one row per sense (see design spec §3) — word/savedAt/status repeat across a word's rows. */
function toRows(entries: SavedWordEntry[]): AnkiExportRow[] {
  const rows: AnkiExportRow[] = [];
  for (const e of entries) {
    const savedAt = new Date(e.savedAt).toISOString();
    for (const sense of e.senses) {
      rows.push({
        word: e.word,
        definition: sense.definition,
        translation: sense.translation,
        sentence: sense.sentence,
        url: sense.url,
        title: sense.title,
        savedAt,
        status: e.status,
      });
    }
  }
  return rows;
}
```

**`savedAt` is rendered as a full ISO-8601 timestamp string, not the raw epoch-ms number.** A
flashcard back showing `1700000000000` is meaningless to a learner; `2023-11-14T22:13:20.000Z` is
unambiguous, sorts correctly as plain text, and needs no locale/timezone decision (unlike a
formatted local date, which would silently bake in whichever machine ran the export).

### 4.1 TSV (`buildAnkiTsv`) — the Anki-importable format

```ts
// Anki's plain-text (TSV) note importer treats a literal tab as a field delimiter and a literal
// newline as a record delimiter, with NO in-field escape mechanism for either — a stray tab or
// newline inside a model-authored definition would silently shift every later column or split one
// note into two. Collapse both to a single space so column alignment can never be corrupted.
function tsvEscape(v: string): string {
  return v.replace(/\t/g, ' ').replace(/\r\n|\r|\n/g, ' ');
}

export function buildAnkiTsv(entries: SavedWordEntry[]): { filename: string; content: string } {
  const rows = toRows(entries);
  const lines = rows.map((r) => COLUMNS.map((c) => tsvEscape(r[c])).join('\t'));
  return { filename: 'ai-dict-anki.tsv', content: lines.length ? lines.join('\n') + '\n' : '' };
}
```

**No header row in the TSV.** Anki's "Import File" note importer maps columns to note-type fields
positionally and does not skip a first line unless the user explicitly configures it to — shipping
a literal `word\tdefinition\t…` first line would import as a bogus first flashcard. The column
order is documented here (this spec) instead of self-described in the file.

### 4.2 CSV (`buildAnkiCsv`) — spreadsheet-friendly, with a header row

```ts
// RFC 4180: quote a field iff it contains a comma, double quote, or CR/LF; double any embedded
// double quote. Unlike TSV, CSV's quoting lets a definition's own commas/newlines survive intact
// instead of being collapsed — CSV is the format for spreadsheet tooling, where preserving the
// original text matters more than positional column safety.
function csvEscape(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function buildAnkiCsv(entries: SavedWordEntry[]): { filename: string; content: string } {
  const rows = toRows(entries);
  const lines = [
    COLUMNS.join(','),
    ...rows.map((r) => COLUMNS.map((c) => csvEscape(r[c])).join(',')),
  ];
  return { filename: 'ai-dict-anki.csv', content: lines.join('\r\n') + '\r\n' };
}
```

**CSV DOES get a header row** (unlike TSV): the CSV target audience is general spreadsheet
software (Excel/Sheets), where a header aids the human reader, and Anki's own CSV import screen
(2.1.x+) offers an explicit "The first line contains column names" checkbox — so a header row
does not silently corrupt an Anki CSV import the way it would for TSV's plain-note importer.

### 4.3 Markdown (`buildAnkiMarkdown`) — human-readable reference, not for Anki import

```ts
export function buildAnkiMarkdown(entries: SavedWordEntry[]): {
  filename: string;
  content: string;
} {
  const rows = toRows(entries);
  const blocks = rows.map(
    (r) =>
      `## ${r.word}\n\n` +
      `**Definition:** ${r.definition}\n\n` +
      `**Translation:** ${r.translation}\n\n` +
      `**Sentence:** ${r.sentence}\n\n` +
      `**Source:** [${r.title || r.url}](${r.url})\n\n` +
      `**Saved:** ${r.savedAt} · **Status:** ${r.status}\n`,
  );
  return { filename: 'ai-dict-anki.md', content: blocks.join('\n---\n\n') };
}
```

No escaping is needed here: Markdown is not a delimited/tabular format, so an embedded comma, tab,
or newline in `definition`/`sentence` cannot corrupt row/column structure the way it can for
TSV/CSV. `definition` is the model's raw markdown text (the same string `SavedWordSense.definition`
already stores — B1 persists it verbatim, `saved-words-policy.ts:49-55`); embedding it verbatim in
a **file the user opens locally in their own editor** carries no XSS/rendering-injection risk —
that risk is specific to `sanitizeMarkdown`/S4's DOM-rendering path
(`packages/app/src/app/markdown-sanitize.ts`), which this card never touches (no export path
renders anything back inside the extension's own DOM).

### 4.4 [S1] the API key never appears in any export

By construction: `SavedWordEntry`/`SavedWordSense` (`types.ts:231-251`) have no key-shaped field to
begin with, and `toRows`/the three builders only ever read the eight named columns off that type —
there is no spread, no `...entry`, nothing that could carry a stray property through, mirroring
`buildHistoryExport`'s own field-by-field reconstruction (`history-export.ts:6-8`,
"reconstructed field-by-field rather than spread ... so any stray property ... can never survive").
§6.2 below asserts this directly in tests (rather than trusting the type system alone), exactly as
`history-export.test.ts:39-48` already does for the history export.

### 4.5 Download mechanism — reuse and generalize the existing `download()` helper

`options.ts`'s `download(filename, content)` (Chrome `options.ts:56-64`, Safari `options.ts:46-54`)
hardcodes `type: 'application/json'` in its `Blob` — correct for the JSON history export, wrong for
TSV/CSV/Markdown. **Pinned: add an optional `mime` parameter, defaulting to `'application/json'`**
so the one existing call site (`export-history`'s listener) needs no change:

```ts
function download(filename: string, content: string, mime = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
```

Three new listeners (`export-anki-tsv` / `export-anki-csv` / `export-anki-md`) call `send({ type:
'saved.list' })`, then the matching `buildAnki*` function, then `download(filename, content, mime)`
with `'text/tab-separated-values'` / `'text/csv'` / `'text/markdown'` respectively — full code in
the plan's Task 4/5. This is a pure generalization of an existing helper, not a new mechanism —
the "ground what exists for file export today" instruction in this card's dispatch note resolves
to "the same Blob+anchor download `options.ts` already has for history export", used unchanged.

## 5. Design question 4 — where does the export UI live?

**Pinned: a new "Saved words" section in `packages/app/src/ui/settings-form.ts`**, immediately
after the existing "Privacy & data" section (`settings-form.ts:202-212`, which already hosts
"Export history"), reusing the exact same `.sec`/`.sec-h`/`.inline-actions`/`button.link` token
classes (`settings-form.ts:87-88, 109, 113-114`) — no new CSS rules, no new component.

**Rejected: the side panel.** The side panel is the daily-reading-flow surface (current lookup +
Recent history) and is already a hot file for four other unshipped cards in this batch (A2, B6,
B10, B11 — this batch's CONTRACTS §5 concurrency list). B8 is a one-off bulk action with the exact
same shape as the already-shipped "Export history" (settings-level, infrequent, whole-dataset), so
placing it next to that precedent is both the lower-conflict-risk choice and the more discoverable
one — a reader will look for "export" next to the "Export history" button they've already used.

**Rejected: a new dropdown/select + single "Export" button.** No export or bulk-action control
anywhere in this codebase uses a format-picker pattern; every existing action (`Clear cache`,
`Clear history`, `Export history`, `Test connection`) is one button = one explicit action. The
dispatch note also names the three formats as named deliverables ("TSV + CSV + Markdown") a reader
should be able to reach independently — three buttons keeps every action self-describing and
avoids inventing a new UI idiom to save two button elements.

### 5.1 The change — `packages/app/src/ui/settings-form.ts`

New section in `MARKUP`, directly after the `sec-priv` (Privacy & data) `</section>`
(`settings-form.ts:202-212`) and before the `.savebar` div (`:213`):

```html
<section class="sec" aria-labelledby="sec-saved">
  <h2 class="sec-h" id="sec-saved">Saved words</h2>
  <p id="saved-help">
    Export every saved word as an Anki-importable deck, or as CSV/Markdown for other tools. Your API
    key is never included.
  </p>
  <div class="inline-actions">
    <button type="button" id="export-anki-tsv" class="link">Export Anki deck (TSV)</button>
    <button type="button" id="export-anki-csv" class="link">Export CSV</button>
    <button type="button" id="export-anki-md" class="link">Export Markdown</button>
  </div>
</section>
```

Three new `relay()` calls in `connectedCallback` (`settings-form.ts:309-312`, right after the
existing `this.relay('#export', 'export-history')`):

```ts
this.relay('#export-anki-tsv', 'export-anki-tsv');
this.relay('#export-anki-csv', 'export-anki-csv');
this.relay('#export-anki-md', 'export-anki-md');
```

`relay()` (`settings-form.ts:557-561`) already dispatches a `composed: true` `CustomEvent` with no
detail payload — identical shape to `export-history`; no changes to `relay()` itself.

## 6. Testing strategy

1. **Unit — `packages/app/test/wire-schema.test.ts`**: `saved.list` message accepted (no payload;
   extra fields rejected — `strictObject`); a `saved.list` reply with an empty `entries: []]`
   accepted; a reply missing `entries` or with a malformed sense inside an entry rejected (mirrors
   the existing "rejects an invalid status value inside a saved reply entry" test at
   `wire-schema.test.ts:461-470`).
2. **Unit — `packages/app/test/app/router.test.ts`**: `saved.list` on an empty store replies
   `{ ok: true, type: 'saved.list', entries: [] }`; after two `saved.save` calls for different
   words, `saved.list` replies both entries (order: mirrors `savedWordsList`'s newest-saved-first
   contract, matching the existing `saved-words-policy.test.ts` coverage — no new ordering
   assertion invented here, just exercised through the router).
3. **Unit — new `packages/app/test/app/anki-export.test.ts`** (mirrors
   `history-export.test.ts`'s shape exactly):
   - `buildAnkiTsv`/`buildAnkiCsv`/`buildAnkiMarkdown` each return the pinned filename.
   - Column order and per-sense row expansion: an entry with 2 senses produces 2 TSV lines / 2 CSV
     data rows / 2 markdown blocks, both repeating `word`/`savedAt`/`status`.
   - TSV: a definition containing an embedded tab and newline is collapsed to spaces; the output
     line count still matches the row count (no accidental record split).
   - CSV: a definition containing a comma, a double quote, and a newline round-trips through a
     real CSV parse (`content.split('\r\n')` naively is NOT enough for a quoted multi-line field —
     assert via a small hand-rolled RFC4180 reader or by checking the exact expected quoted
     substring, matching how `wire-schema.test.ts` asserts exact schema shapes rather than
     re-implementing a parser).
   - Markdown: contains the word as an `## ` heading and the definition verbatim.
   - Empty input: each builder returns a valid, non-throwing empty-set output (TSV/CSV: header/
     no-rows only; Markdown: empty string).
   - **[S1]**: none of the three outputs contain the literal substring `apiKey` when a tainted
     entry (an `SavedWordEntry` object with a stray `apiKey` property cast through, exactly like
     `history-export.test.ts:39-48`'s tainted-entry test) is passed in.
4. **Unit — `packages/app/test/ui/settings-form.test.ts`**: extend the existing "emits the four
   action events" test (`settings-form.test.ts:61-83`) to seven events (add `export-anki-tsv`,
   `export-anki-csv`, `export-anki-md`) and the existing "four action events cross shadow boundary"
   test (`:161-190`) to the same seven, asserting `composed: true` on each new event exactly like
   the existing four.
5. **e2e — new `packages/extension-chrome/e2e/anki-export.spec.ts`**, seeding `saved:<word>`
   directly via `page.evaluate` (same technique as `options-actions.spec.ts:74-120`'s history
   seeding, and `saved-word.spec.ts`'s direct `swStorageDump`/seed patterns) rather than driving a
   full lookup+star flow — deterministic and fast:
   - Seed two saved words (one with 2 senses under the same `word` key is unrealistic today since
     B1 always overwrites `senses[0]` — seed two _different_ single-sense words instead, matching
     what production data actually looks like pre-B14) plus `saved:index`. Click
     `#export-anki-tsv` → assert `download.suggestedFilename() === 'ai-dict-anki.tsv'`, file
     content has 2 lines (no header), each with 8 tab-separated columns in the pinned order.
   - Click `#export-anki-csv` → filename `ai-dict-anki.csv`, first line is the exact header
     `word,definition,translation,sentence,url,title,savedAt,status`, 2 data lines.
   - Click `#export-anki-md` → filename `ai-dict-anki.md`, content contains `## ` + each seeded
     word.
   - **[S1]** — assert none of the three downloaded files' contents contain the substring
     `apiKey` (mirrors `options-actions.spec.ts:116`'s existing history-export assertion).
   - Empty-saved-words case: no `saved:*` keys seeded → clicking any of the three buttons shows
     status `'No saved words to export'` and fires no `download` event (assert via a short
     `Promise.race` against a timeout, the same pattern `options-actions.spec.ts:122-131`'s "Export
     with empty history" test already uses for the analogous empty-history case).

## 7. Testing performed (PR evidence — replaces screenshot/video capture)

Per this worktree's `CLAUDE.md` (owner ruling 2026-07-16): **no screenshots or video for this
PR.** The PR body's "Testing performed" section lists the suites run, exact test counts, e2e
scenarios exercised, and gates passed (lint, format check, typecheck ×2 packages, unit, e2e),
matching §6 above. No `pr-assets/*` branch.

## 8. Risk / rollback

- **Risk: low.** Every new code path is additive: a new wire arm + router case (exhaustive switch
  keeps this type-safe — a missing case is a compile error, not a runtime gap), three new pure
  functions with no side effects, three new buttons wired through the existing `relay()`/`download()`
  helpers. No existing wire message, router case, or UI element changes shape — `download()`'s new
  `mime` parameter defaults to the exact value the one existing caller (`export-history`) already
  hardcoded, so that call site's behavior is provably unchanged.
- **No data migration.** `SavedWordEntry`/`saved:*` storage shape is completely unchanged; this
  card only reads it.
- **Rollback:** revert the single PR. No stored data becomes invalid; the `saved.list` wire arm
  simply stops existing again (nothing else will have started depending on it, since this card is
  its only caller).

## 9. Files touched (summary)

| File                                                | Change                                                                      |
| --------------------------------------------------- | --------------------------------------------------------------------------- |
| `packages/app/src/wire.ts`                          | + `saved.list` message arm, `MessageTypeEnum` entry, `saved.list` reply arm |
| `packages/app/src/app/router.ts`                    | + `handleSavedList`, `savedWordsList` import, `case 'saved.list'`           |
| `packages/app/src/app/anki-export.ts`               | **new** — `buildAnkiTsv`/`buildAnkiCsv`/`buildAnkiMarkdown`                 |
| `packages/app/src/index.ts`                         | + `export * from './app/anki-export';`                                      |
| `packages/app/src/ui/settings-form.ts`              | + "Saved words" section (3 buttons), 3 `relay()` calls                      |
| `packages/extension-chrome/src/options.ts`          | `download()` gains an optional `mime` param; + 3 `export-anki-*` listeners  |
| `packages/extension-safari/src/options.ts`          | same as Chrome (mirrors the existing `export-history` wiring)               |
| `packages/app/test/wire-schema.test.ts`             | + `saved.list` message/reply tests                                          |
| `packages/app/test/app/router.test.ts`              | + `saved.list` router tests                                                 |
| `packages/app/test/app/anki-export.test.ts`         | **new** — builder unit tests incl. [S1]                                     |
| `packages/app/test/ui/settings-form.test.ts`        | extend 4-event tests to 7 events                                            |
| `packages/extension-chrome/e2e/anki-export.spec.ts` | **new** — functional e2e (§6.5)                                             |

No change to `packages/app/src/domain/saved-words-policy.ts` (its `savedWordsList` already does
exactly what's needed), `packages/app/src/domain/types.ts` (E1 shape untouched — read-only card),
`packages/app/src/app/markdown-sanitize.ts`, `packages/app/src/app/history-export.ts`, or any
manifest file (no new permission — file download via `<a download>` needs none, same as the
existing history export).

## 10. Scope fence (from the card, held exactly)

- **No `.apkg`.** Every output is a plain-text file (`.tsv`/`.csv`/`.md`); no Anki library
  dependency is added anywhere (`package.json` unchanged in that respect).
- **Column order documented** — §3 above, restated in `anki-export.ts`'s own comments.
- **No scheduling engine, ever** — this card only ever reads and formats already-saved data; it
  adds no due dates, intervals, or review state of any kind (that permanent anti-goal belongs to
  B11, not this card, and this card touches none of B11's future surface).
- **[S1] key never in export** — §4.4, asserted in tests (§6.3, §6.5).
- **Separate surface from B9.** Per this batch's CONTRACTS §4 ("B9 export UI and B8 export UI are
  separate features (backup ≠ Anki deck); do not merge their surfaces"): this card adds its own
  "Saved words" section, distinct from wherever B9 (backup/restore) lands its own export control;
  neither card's plan may fold the other's button/section into itself.

## 11. Concurrency

Per this batch's CONTRACTS §5, listing every file this card touches that another unshipped card in
this batch also touches, so the orchestrator serializes:

- **`packages/app/src/ui/settings-form.ts`** — hot file also touched by A5 (gloss-mode setting),
  A9 (instant-cache-hits — cached badge/setting), A13 (per-site-quiet-mode — mute list UI), B6
  (words page — may add its own settings-form entry point), C9. B8 adds a new, clearly-delimited
  section at the end of the form (after Privacy & data) — low overlap risk, but this card must not
  land in parallel with another PR mid-edit on the same file.
- **`packages/app/src/wire.ts` / `packages/app/src/app/router.ts`** — hot for any card in this
  batch that also adds a wire message (A3's optional `refine` field touches `wire.ts`'s
  `LookupRequestSchema` specifically, not the message list; B12, B6's possible `saved.delete`-
  adjacent additions, B9's backup/restore import message, B14 — all touch the same `switch`/
  discriminated union). B8's new arm is appended at the end of both the message array and the
  switch, minimizing textual overlap, but a merge conflict on the exhaustive switch is still
  likely if two such cards land back-to-back without rebasing.
- **`packages/extension-chrome/src/options.ts` / `packages/extension-safari/src/options.ts`** —
  not listed in CONTRACTS §5's hot-file table, but flagged here explicitly: B9 (backup & restore)
  is very likely to add its own settings-section wiring to these same two composition-root files.
  Sequence B8 and B9 back-to-back (not landed as simultaneous in-flight branches) to avoid a
  `download()`-signature or listener-block merge conflict.
