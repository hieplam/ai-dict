# B8 Anki / CSV Export Implementation Plan

> **For agentic workers:** implement task-by-task, TDD (red → green → commit) per task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** every saved word (`saved:*`, B1) becomes exportable from the extension's Settings page
as an Anki-importable TSV file, a spreadsheet-friendly CSV file, or a human-readable Markdown
file — one export button per format, each producing one row/block per **sense** (word/savedAt/
status repeated across a word's rows), with the API key never appearing in any of the three
outputs. No `.apkg`, no scheduling engine.

**Architecture:** a new read-only wire message `saved.list` (payload-free) lets the options page
pull every saved word through the router (`packages/app/src/app/router.ts`) — the same shape as
the existing `history.list`/`history` pair, calling the already-existing `savedWordsList`
(`packages/app/src/domain/saved-words-policy.ts:110-118`, untouched by this card). Three new pure
builder functions (`packages/app/src/app/anki-export.ts`, mirroring the existing
`history-export.ts`) turn that entry array into `{ filename, content }` for each format. A new
"Saved words" section in the shared `packages/app/src/ui/settings-form.ts` (next to the existing
"Export history" button) fires three new events, wired in both `packages/extension-chrome/src/
options.ts` and `packages/extension-safari/src/options.ts` exactly like the existing
`export-history` listener, reusing (and lightly generalizing) the existing `download()` Blob+anchor
helper. Full design rationale, including every rejected alternative:
`docs/superpowers/specs/2026-07-17-b8-anki-csv-export-design.md`.

**Tech Stack:** TypeScript, Zod (wire schemas), Vitest + happy-dom (unit), Playwright (e2e).

## Global Constraints

- Implementer: dispatch each task to the `hunter` subagent — never a generic implementer.
- Start in a fresh git worktree under `.claude/worktrees/` on branch `feature/B8AnkiCsvExport`.
- **Task 1 (wire.ts arm + router.ts case) is ONE task, not two** — the discriminated union's
  exhaustive `switch (msg.type)` in `router.ts` (no `default` arm) means a schema addition and its
  router case cannot type-check independently of each other.
- **Do not touch** `packages/app/src/domain/saved-words-policy.ts` or
  `packages/app/src/domain/types.ts` — `savedWordsList` and the `SavedWordEntry`/`SavedWordSense`
  shapes already do everything this card needs, read-only. If a task seems to need a change there,
  stop — the design spec's §2 resolution broke somewhere.
- **No `.apkg`, no scheduling engine, ever** — every output is a plain-text file this plan builds
  with string concatenation; no Anki library dependency is added to any `package.json`.
- **[S1] the API key never appears in any of the three exported files** — enforced by
  `SavedWordEntry`/`SavedWordSense` having no key-shaped field (design spec §4.4) and asserted
  directly in Task 2's and Task 6's tests, not just assumed from the type system.
- **Column order is fixed** (design spec §3): `word, definition, translation, sentence, url,
title, savedAt, status` — one row/block per **sense**, not per saved word.
- UI additions read only `--ad-*`/`--adp-*` design tokens — the new "Saved words" section reuses
  the existing `.sec`/`.sec-h`/`.inline-actions`/`button.link` classes verbatim; no new CSS rule is
  added anywhere in this plan.
- `bun run lint` and `bun run format:check` clean before every commit.
- Every task must leave `cd packages/app && bun run typecheck` green; from Task 4 onward also
  `cd packages/extension-chrome && bun run typecheck`, and from Task 5 onward also
  `cd packages/extension-safari && bun run typecheck`.
- The e2e build must clear any ambient `GEMINI_API_KEY` (`GEMINI_API_KEY= bun run build:chrome`)
  before Task 6/7's Playwright runs — an ambient key would skip onboarding entirely, unrelated to
  this card's own tests but a known repo-wide flake source (`docs/ROADMAP.md` §4 C10).
- Commit subject convention for every task in this plan (repo convention, CONTRACTS §2):
  `[B8AnkiCsvExport] feat: <task summary> (B8)`.

---

### Task 1: `saved.list` wire message + router case

**Files:**

- Modify: `packages/app/src/wire.ts`
- Modify: `packages/app/src/app/router.ts`
- Modify: `packages/app/test/wire-schema.test.ts`
- Modify: `packages/app/test/app/router.test.ts`

**Interfaces:**

```ts
// New WireMessageSchema arm: { type: 'saved.list' } — no payload.
// New WireReplySchema arm: { ok: true, type: 'saved.list', entries: SavedWordEntry[] }.
```

- [ ] **Step 1: Write the failing tests.**

In `packages/app/test/wire-schema.test.ts`, insert a new `describe` block immediately after the
existing `describe('saved.save / saved.delete wire messages (B1)', ...)` block's closing `});`
(currently line 497), before `describe('errlog wire messages', ...)`:

```ts
describe('saved.list wire message (B8)', () => {
  it('accepts a saved.list message with no payload; rejects one with an extra field', () => {
    expect(WireMessageSchema.safeParse({ type: 'saved.list' }).success).toBe(true);
    expect(WireMessageSchema.safeParse({ type: 'saved.list', limit: 10 }).success).toBe(false);
  });

  it('accepts a saved.list reply with an empty entries array', () => {
    expect(WireReplySchema.safeParse({ ok: true, type: 'saved.list', entries: [] }).success).toBe(
      true,
    );
  });

  it('accepts a saved.list reply carrying the ratified entry shape', () => {
    const entry = {
      word: 'bank',
      status: 'learning',
      savedAt: 1,
      senses: [{ definition: 'd', translation: 't', sentence: 's', url: 'u', title: 'ti' }],
    };
    expect(
      WireReplySchema.safeParse({ ok: true, type: 'saved.list', entries: [entry] }).success,
    ).toBe(true);
  });

  it('rejects a saved.list reply with a malformed entry inside entries (strictObject)', () => {
    const bad = {
      word: 'bank',
      status: 'archived', // not 'learning' | 'known'
      savedAt: 1,
      senses: [],
    };
    expect(
      WireReplySchema.safeParse({ ok: true, type: 'saved.list', entries: [bad] }).success,
    ).toBe(false);
  });

  it('rejects a saved.list reply missing entries', () => {
    expect(WireReplySchema.safeParse({ ok: true, type: 'saved.list' }).success).toBe(false);
  });
});
```

Run: `cd packages/app && bunx vitest run test/wire-schema.test.ts`
Expected: the 5 new tests fail (`saved.list` is not a recognized message/reply type yet).

In `packages/app/test/app/router.test.ts`, insert new tests immediately after the existing
`it('saved.setStatus is case-insensitive on the word key (B5)', ...)` test block (ends at line 578) and before `describe('errlog routing', ...)` (line 652):

```ts
it('saved.list on an empty store replies with an empty entries array (B8)', async () => {
  const route = buildRouter(deps());
  const reply = await route({ type: 'saved.list' });
  expect(reply).toMatchObject({ ok: true, type: 'saved.list', entries: [] });
});

it('saved.list replies every saved word after multiple saved.save calls (B8)', async () => {
  const d = deps();
  const route = buildRouter(d);
  await route({
    type: 'saved.save',
    word: 'bank',
    definition: 'a financial institution',
    translation: '',
    sentence: 'the river bank',
    url: 'https://example.com',
    title: 'Example',
  });
  await route({
    type: 'saved.save',
    word: 'serendipity',
    definition: 'a happy accident',
    translation: '',
    sentence: 'pure serendipity',
    url: 'https://example.com/2',
    title: 'Example 2',
  });
  const reply = await route({ type: 'saved.list' });
  expect(reply).toMatchObject({ ok: true, type: 'saved.list' });
  const entries = (reply as { entries: { word: string }[] }).entries;
  expect(entries.map((e) => e.word).sort()).toEqual(['bank', 'serendipity']);
});
```

Run: `cd packages/app && bunx vitest run test/app/router.test.ts`
Expected: both new tests fail (`saved.list` is not a valid `WireMessage`/switch case yet — a
TypeScript compile error surfaces first, matching the "exhaustive switch, no default" guarantee).

- [ ] **Step 2: Implement.**

If `saved.list` already exists in `wire.ts`/`router.ts` (landed via another card — B6, B10, and
B15 pin the identical shape), verify it matches this exact request/reply shape byte-for-byte and
SKIP creation; a shape mismatch is a STOP-and-report, not a local edit.

In `packages/app/src/wire.ts`, insert the new message arm into `WireMessageSchema`'s array
immediately after the existing `saved.setStatus` arm and before `z.object({ type:
z.literal('cache.clear') })`:

```ts
  z.object({
    type: z.literal('saved.setStatus'),
    word: z.string(),
    status: z.enum(['learning', 'known']),
  }),
  // B8: read every saved word (no pagination — mirrors savedWordsList's "full list" contract,
  // saved-words-policy.ts:108-109). Read-only; the only caller today is the Anki/CSV/Markdown
  // export flow in settings-form.ts.
  z.object({ type: z.literal('saved.list') }),
  z.object({ type: z.literal('cache.clear') }),
```

Add `'saved.list'` to `MessageTypeEnum`'s array (append at the end, right after `'saved.setStatus'`):

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
  'saved.list',
]);
```

Add the new reply arm to `WireReplySchema`'s union, immediately after the existing `'saved'` reply
arm and before the `'errlog'` reply arm:

```ts
  z.object({ ok: z.literal(true), type: z.literal('saved'), entry: SavedWordEntrySchema }),
  // B8: reply type is 'saved.list' (bound to the message's own name), not a second synonym for
  // 'saved' — 'saved' already means "one entry" (saved.save/setStatus replies); see design spec §2.
  z.object({
    ok: z.literal(true),
    type: z.literal('saved.list'),
    entries: z.array(SavedWordEntrySchema),
  }),
  z.object({
    ok: z.literal(true),
    type: z.literal('errlog'),
    consent: z.enum(['unset', 'granted', 'disabled']),
    pending: z.boolean(),
    count: z.number(),
  }),
```

In `packages/app/src/app/router.ts`, add `savedWordsList` to the existing import block from
`'../index'` (right after `savedWordSetStatus,`):

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
  savedWordsList,
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

Add a new handler function immediately after `handleConnectionTest` (currently ending at line 211)
and before the `return async (msg: WireMessage): Promise<RouterReply> => {` line:

```ts
async function handleSavedList(): Promise<RouterReply> {
  const entries = await savedWordsList({ storage: deps.kv });
  return { ok: true, type: 'saved.list', entries };
}
```

Add the new switch case immediately after the existing `case 'saved.setStatus':` block and before
`case 'cache.clear':`:

```ts
      case 'saved.setStatus': {
        const entry = await deps.queue.run(() =>
          savedWordSetStatus({ storage: deps.kv }, msg.word, msg.status),
        );
        return entry ? { ok: true, type: 'saved', entry } : { ok: true, type: 'ack' };
      }
      case 'saved.list':
        return handleSavedList();
      case 'cache.clear':
        await cacheClear({ storage: deps.kv });
        return { ok: true, type: 'ack' };
```

Run:

```
cd packages/app && bunx vitest run test/wire-schema.test.ts test/app/router.test.ts
```

Expected: all tests pass (5 new wire-schema tests + 2 new router tests + all existing tests
unchanged).

- [ ] **Step 3: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd .. && bun run lint && bun run format:check
```

Commit:

```
git add packages/app/src/wire.ts packages/app/src/app/router.ts packages/app/test/wire-schema.test.ts packages/app/test/app/router.test.ts
git commit -m "[B8AnkiCsvExport] feat: add saved.list wire message + router case (B8)" \
  -m $'Tribe-Card: b8-anki-csv-export\nTribe-Task: 1/7'
```

---

### Task 2: pure export builders — `anki-export.ts`

**Files:**

- Create: `packages/app/src/app/anki-export.ts`
- Modify: `packages/app/src/index.ts`
- Create: `packages/app/test/app/anki-export.test.ts`

**Interfaces:**

```ts
export function buildAnkiTsv(entries: SavedWordEntry[]): { filename: string; content: string };
export function buildAnkiCsv(entries: SavedWordEntry[]): { filename: string; content: string };
export function buildAnkiMarkdown(entries: SavedWordEntry[]): { filename: string; content: string };
```

- [ ] **Step 1: Write the failing tests.** Create `packages/app/test/app/anki-export.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildAnkiTsv, buildAnkiCsv, buildAnkiMarkdown } from '../../src/app/anki-export';
import type { SavedWordEntry } from '../../src/domain/types';

const bank: SavedWordEntry = {
  word: 'bank',
  status: 'learning',
  savedAt: 1700000000000,
  senses: [
    {
      definition: 'a financial institution',
      translation: 'ngân hàng',
      sentence: 'the river bank',
      url: 'https://example.com',
      title: 'Example',
    },
  ],
};

const twoSenses: SavedWordEntry = {
  word: 'bank',
  status: 'known',
  savedAt: 1700000000000,
  senses: [
    {
      definition: 'a financial institution',
      translation: 'ngân hàng',
      sentence: 'the river bank',
      url: 'https://example.com',
      title: 'Example',
    },
    {
      definition: 'the land alongside a river',
      translation: 'bờ sông',
      sentence: 'we sat on the bank',
      url: 'https://example.com/2',
      title: 'Example Two',
    },
  ],
};

describe('buildAnkiTsv', () => {
  it('returns a stable .tsv filename', () => {
    expect(buildAnkiTsv([bank]).filename).toBe('ai-dict-anki.tsv');
  });

  it('emits one tab-separated line per sense, in the pinned column order, no header', () => {
    const { content } = buildAnkiTsv([bank]);
    const lines = content.trimEnd().split('\n');
    expect(lines).toHaveLength(1);
    expect(lines[0]!.split('\t')).toEqual([
      'bank',
      'a financial institution',
      'ngân hàng',
      'the river bank',
      'https://example.com',
      'Example',
      new Date(1700000000000).toISOString(),
      'learning',
    ]);
  });

  it('expands a multi-sense entry into one row per sense, repeating word/savedAt/status', () => {
    const { content } = buildAnkiTsv([twoSenses]);
    const lines = content.trimEnd().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]!.split('\t')[0]).toBe('bank');
    expect(lines[1]!.split('\t')[0]).toBe('bank');
    expect(lines[0]!.split('\t')[1]).toBe('a financial institution');
    expect(lines[1]!.split('\t')[1]).toBe('the land alongside a river');
  });

  it('collapses an embedded tab/newline in a field to a space (no in-field escape in Anki TSV)', () => {
    const dirty: SavedWordEntry = {
      ...bank,
      senses: [{ ...bank.senses[0]!, definition: 'a bank\t— financial\ninstitution' }],
    };
    const { content } = buildAnkiTsv([dirty]);
    const lines = content.trimEnd().split('\n');
    expect(lines).toHaveLength(1); // the embedded newline must NOT split this into two lines
    expect(lines[0]!.split('\t')).toHaveLength(8); // the embedded tab must NOT add a 9th column
    expect(content).toContain('a bank — financial institution');
  });

  it('handles an empty saved-words list', () => {
    expect(buildAnkiTsv([]).content).toBe('');
  });

  it('never leaks an apiKey into the TSV payload', () => {
    const tainted = { ...bank, apiKey: 'AIza-should-never-appear' } as unknown as SavedWordEntry;
    const { content } = buildAnkiTsv([tainted]);
    expect(content).not.toContain('apiKey');
    expect(content).not.toContain('AIza-should-never-appear');
  });
});

describe('buildAnkiCsv', () => {
  it('returns a stable .csv filename', () => {
    expect(buildAnkiCsv([bank]).filename).toBe('ai-dict-anki.csv');
  });

  it('starts with the exact pinned header row, then one comma-separated data row per sense', () => {
    const { content } = buildAnkiCsv([bank]);
    const lines = content.trimEnd().split('\r\n');
    expect(lines[0]).toBe('word,definition,translation,sentence,url,title,savedAt,status');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe(
      `bank,a financial institution,ngân hàng,the river bank,https://example.com,Example,${new Date(
        1700000000000,
      ).toISOString()},learning`,
    );
  });

  it('quotes a field containing a comma, double quote, or newline (RFC 4180) and doubles embedded quotes', () => {
    const dirty: SavedWordEntry = {
      ...bank,
      senses: [{ ...bank.senses[0]!, definition: 'a "bank", or river edge\nsecond line' }],
    };
    const { content } = buildAnkiCsv([dirty]);
    expect(content).toContain('"a ""bank"", or river edge\nsecond line"');
  });

  it('handles an empty saved-words list (header only)', () => {
    const { content } = buildAnkiCsv([]);
    expect(content.trimEnd()).toBe('word,definition,translation,sentence,url,title,savedAt,status');
  });

  it('never leaks an apiKey into the CSV payload', () => {
    const tainted = { ...bank, apiKey: 'AIza-should-never-appear' } as unknown as SavedWordEntry;
    const { content } = buildAnkiCsv([tainted]);
    expect(content).not.toContain('apiKey');
    expect(content).not.toContain('AIza-should-never-appear');
  });
});

describe('buildAnkiMarkdown', () => {
  it('returns a stable .md filename', () => {
    expect(buildAnkiMarkdown([bank]).filename).toBe('ai-dict-anki.md');
  });

  it('renders the word as a heading and the definition verbatim', () => {
    const { content } = buildAnkiMarkdown([bank]);
    expect(content).toContain('## bank');
    expect(content).toContain('a financial institution');
    expect(content).toContain('ngân hàng');
  });

  it('renders one block per sense for a multi-sense entry', () => {
    const { content } = buildAnkiMarkdown([twoSenses]);
    expect(content.match(/## bank/g)).toHaveLength(2);
    expect(content).toContain('the land alongside a river');
  });

  it('handles an empty saved-words list', () => {
    expect(buildAnkiMarkdown([]).content).toBe('');
  });

  it('never leaks an apiKey into the Markdown payload', () => {
    const tainted = { ...bank, apiKey: 'AIza-should-never-appear' } as unknown as SavedWordEntry;
    const { content } = buildAnkiMarkdown([tainted]);
    expect(content).not.toContain('apiKey');
    expect(content).not.toContain('AIza-should-never-appear');
  });
});
```

Run: `cd packages/app && bunx vitest run test/app/anki-export.test.ts`
Expected: fails — `../../src/app/anki-export` does not exist yet.

- [ ] **Step 2: Implement.** Create `packages/app/src/app/anki-export.ts`:

```ts
import type { SavedWordEntry } from '../domain/types';

/**
 * Build the three downloadable "export saved words" payloads (B8): an Anki-importable TSV, a
 * spreadsheet-friendly CSV, and a human-readable Markdown reference. All three share the same
 * pinned column order and per-sense row expansion — see the design spec §3-4 for the full
 * rationale behind every choice below.
 */
interface AnkiExportRow {
  word: string;
  definition: string;
  translation: string;
  sentence: string;
  url: string;
  title: string;
  /** ISO-8601, converted from SavedWordEntry.savedAt (epoch ms) — raw epoch ms is not
   * human-legible on a flashcard back; ISO-8601 needs no locale/timezone decision. */
  savedAt: string;
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

/**
 * One row per SENSE, not per saved word — word/savedAt/status repeat across a word's rows. Every
 * saved word has senses.length === 1 today (B1 always replaces senses[0] wholesale on re-save),
 * but the shape is already multi-sense-ready for B14; iterating senses here means this export
 * needs zero changes the day B14 ships real multi-sense entries. Reconstructed field-by-field
 * (never spread) so a stray property on either level can never survive into an export — the same
 * [S1] pattern history-export.ts already uses.
 */
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

// Anki's plain-text (TSV) note importer treats a literal tab as a field delimiter and a literal
// newline as a record delimiter, with NO in-field escape mechanism for either — a stray tab/
// newline inside a model-authored definition would silently shift a later column or split one
// note into two. Collapse both to a single space so column alignment can never be corrupted.
function tsvEscape(v: string): string {
  return v.replace(/\t/g, ' ').replace(/\r\n|\r|\n/g, ' ');
}

/**
 * Anki-importable TSV. No header row: Anki's "Import File" note importer maps columns to
 * note-type fields positionally and does not skip a first line unless the user configures it to —
 * a literal header line would import as a bogus first flashcard. Column order is documented in
 * the design spec instead of self-described in the file.
 */
export function buildAnkiTsv(entries: SavedWordEntry[]): { filename: string; content: string } {
  const rows = toRows(entries);
  const lines = rows.map((r) => COLUMNS.map((c) => tsvEscape(r[c])).join('\t'));
  return { filename: 'ai-dict-anki.tsv', content: lines.length ? lines.join('\n') + '\n' : '' };
}

// RFC 4180: quote a field iff it contains a comma, double quote, or CR/LF; double any embedded
// double quote. Unlike TSV, CSV's quoting lets a definition's own commas/newlines survive intact
// instead of being collapsed — CSV targets spreadsheet tooling, where preserving the original
// text matters more than positional column safety.
function csvEscape(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/**
 * Spreadsheet-friendly CSV, WITH a header row (unlike TSV): the CSV audience is general
 * spreadsheet software, where a header aids the reader, and Anki's own CSV import screen offers
 * an explicit "first line contains column names" checkbox, so a header does not silently corrupt
 * an Anki CSV import either.
 */
export function buildAnkiCsv(entries: SavedWordEntry[]): { filename: string; content: string } {
  const rows = toRows(entries);
  const lines = [
    COLUMNS.join(','),
    ...rows.map((r) => COLUMNS.map((c) => csvEscape(r[c])).join(',')),
  ];
  return { filename: 'ai-dict-anki.csv', content: lines.join('\r\n') + '\r\n' };
}

/**
 * Human-readable Markdown reference — NOT for Anki import. No escaping needed: Markdown is not a
 * delimited/tabular format, so an embedded comma/tab/newline cannot corrupt row/column structure.
 * `definition` is embedded verbatim (the model's raw markdown text, exactly as SavedWordSense
 * already stores it) — this file is opened locally by the user in their own editor, so none of
 * S4's DOM-rendering sanitize concerns apply (no export path renders anything back inside the
 * extension's own DOM).
 */
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

In `packages/app/src/index.ts`, add one export line immediately after
`export * from './app/history-export';`:

```ts
export * from './app/history-export';
export * from './app/anki-export';
```

Run:

```
cd packages/app && bunx vitest run test/app/anki-export.test.ts
```

Expected: all 15 new tests pass.

- [ ] **Step 3: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd .. && bun run lint && bun run format:check
```

Commit:

```
git add packages/app/src/app/anki-export.ts packages/app/src/index.ts packages/app/test/app/anki-export.test.ts
git commit -m "[B8AnkiCsvExport] feat: add buildAnkiTsv/Csv/Markdown pure builders (B8)" \
  -m $'Tribe-Card: b8-anki-csv-export\nTribe-Task: 2/7'
```

---

### Task 3: settings-form.ts — "Saved words" export section

**Files:**

- Modify: `packages/app/src/ui/settings-form.ts`
- Modify: `packages/app/test/ui/settings-form.test.ts`

**Interfaces:**

```
// Three new DOM events dispatched by <settings-form>, no detail payload, composed:true:
// 'export-anki-tsv' | 'export-anki-csv' | 'export-anki-md'
```

- [ ] **Step 1: Write the failing tests.** In `packages/app/test/ui/settings-form.test.ts`, replace
      the existing `'emits the four action events'` test (currently lines 61-83) with a
      seven-event version:

```ts
it('emits the seven action events', () => {
  const el = mountForm();
  const events = [
    'clear-cache',
    'clear-history',
    'test-connection',
    'export-history',
    'export-anki-tsv',
    'export-anki-csv',
    'export-anki-md',
  ] as const;
  const captured = new Map<string, Event>();
  const spies = Object.fromEntries(
    events.map((n) => [
      n,
      vi.fn((e: Event) => {
        captured.set(n, e);
      }),
    ]),
  );
  for (const n of events) el.addEventListener(n, spies[n]!);
  el.shadowRoot!.querySelector<HTMLButtonElement>('#clear-cache')!.click();
  el.shadowRoot!.querySelector<HTMLButtonElement>('#clear-history')!.click();
  el.shadowRoot!.querySelector<HTMLButtonElement>('#test')!.click();
  el.shadowRoot!.querySelector<HTMLButtonElement>('#export')!.click();
  el.shadowRoot!.querySelector<HTMLButtonElement>('#export-anki-tsv')!.click();
  el.shadowRoot!.querySelector<HTMLButtonElement>('#export-anki-csv')!.click();
  el.shadowRoot!.querySelector<HTMLButtonElement>('#export-anki-md')!.click();
  for (const n of events) {
    expect(spies[n]!).toHaveBeenCalledOnce();
    // Assert the frozen cross-bundle event-name contract.
    expect(captured.get(n)!.type).toBe(n);
  }
});
```

And replace the existing `'four action events cross shadow boundary (composed: true)'` test
(currently lines 161-190) with a seven-event version:

```ts
it('seven action events cross shadow boundary (composed: true)', () => {
  const el = mountForm();
  const actionMap = [
    ['clear-cache', '#clear-cache'],
    ['clear-history', '#clear-history'],
    ['test-connection', '#test'],
    ['export-history', '#export'],
    ['export-anki-tsv', '#export-anki-tsv'],
    ['export-anki-csv', '#export-anki-csv'],
    ['export-anki-md', '#export-anki-md'],
  ] as const;
  const captured: Map<string, CustomEvent> = new Map();
  const handlers: Map<string, EventListener> = new Map();

  for (const [name] of actionMap) {
    const h: EventListener = (e) => {
      captured.set(name, e as CustomEvent);
    };
    handlers.set(name, h);
    document.body.addEventListener(name, h);
  }

  for (const [, sel] of actionMap) {
    el.shadowRoot!.querySelector<HTMLButtonElement>(sel)!.click();
  }

  for (const [name] of actionMap) {
    document.body.removeEventListener(name, handlers.get(name)!);
    const evt = captured.get(name);
    expect(evt, `${name} must reach document.body`).toBeDefined();
    expect(evt!.composed, `${name} must be composed:true`).toBe(true);
  }
});
```

Run: `cd packages/app && bunx vitest run test/ui/settings-form.test.ts`
Expected: both updated tests fail (`#export-anki-tsv`/`#export-anki-csv`/`#export-anki-md` do not
exist yet — `querySelector` returns `null`, the `!` assertion throws).

- [ ] **Step 2: Implement.** In `packages/app/src/ui/settings-form.ts`, insert a new `<section>`
      into `MARKUP` immediately after the existing `sec-priv` (Privacy & data) section's closing
      `</section>` and before the `<div class="savebar">`:

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

Add three new `relay()` calls in `connectedCallback`, immediately after the existing
`this.relay('#export', 'export-history');` line:

```ts
this.relay('#export', 'export-history');
this.relay('#export-anki-tsv', 'export-anki-tsv');
this.relay('#export-anki-csv', 'export-anki-csv');
this.relay('#export-anki-md', 'export-anki-md');
```

Run:

```
cd packages/app && bunx vitest run test/ui/settings-form.test.ts
```

Expected: all tests pass (including the two updated seven-event tests).

- [ ] **Step 3: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd .. && bun run lint && bun run format:check
```

Commit:

```
git add packages/app/src/ui/settings-form.ts packages/app/test/ui/settings-form.test.ts
git commit -m "[B8AnkiCsvExport] feat: add Saved words export section to settings-form (B8)" \
  -m $'Tribe-Card: b8-anki-csv-export\nTribe-Task: 3/7'
```

---

### Task 4: Chrome composition root — wire the three export buttons

**Files:**

- Modify: `packages/extension-chrome/src/options.ts`

No dedicated unit test exists for `options.ts` in this repo — it is a composition root, covered by
e2e only (same precedent as C2's `options.ts` edits and B5's `content.ts`/`side-panel.ts` edits).
This task's correctness is proven by Task 6's e2e; still run the typecheck/lint gate below so a
regression in existing behavior (settings save, cache/history/history-export, etc. — all in the
same file) is caught immediately.

- [ ] **Step 1: Implement.** In `packages/extension-chrome/src/options.ts`:

1. Add the three new named imports from `@ai-dict/app` to the existing import block (right after
   `buildHistoryExport,`):

```ts
import {
  registerSettingsForm,
  registerOnboarding,
  DEFAULT_OUTPUT_FORMAT,
  buildHistoryExport,
  buildAnkiTsv,
  buildAnkiCsv,
  buildAnkiMarkdown,
  hasKeyFor,
  type Provider,
  type Settings,
  type SettingsForm,
  type SettingsFormValue,
  type OnboardingView,
  type OnboardingValue,
  type WireReply,
} from '@ai-dict/app';
```

2. Generalize `download()` with an optional `mime` parameter, defaulting to the exact value the
   one existing caller already hardcodes (so `export-history`'s behavior is unchanged):

```ts
// Trigger a client-side file download from the options page (the SW has no DOM).
function download(filename: string, content: string, mime = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
```

3. Add a small format-keyed table and a `wireAnkiExport` helper, plus the three listener
   registrations, immediately after the existing `form.addEventListener('export-history', ...)`
   block inside `wireSettings(form)`:

```ts
  form.addEventListener('export-history', () => {
    // history.list with no limit returns every entry (history-policy default).
    void send({ type: 'history.list' }).then(
      (r) => {
        if (!r.ok || r.type !== 'history') {
          form.setStatus(r.ok ? 'Unexpected reply' : r.error.message, 'error');
          return;
        }
        if (r.entries.length === 0) {
          form.setStatus('No history to export');
          return;
        }
        const { filename, json } = buildHistoryExport(r.entries);
        download(filename, json);
        form.setStatus(`Exported ${r.entries.length} entries`);
      },
      () => form.setStatus('Could not export history', 'error'),
    );
  });

  wireAnkiExport(form, 'export-anki-tsv', 'tsv');
  wireAnkiExport(form, 'export-anki-csv', 'csv');
  wireAnkiExport(form, 'export-anki-md', 'md');
}
```

(The closing `}` above is `wireSettings`'s own closing brace — unchanged in position, just shown
for placement clarity.)

4. Add the shared helper as a new top-level function, placed right after `wireSettings`'s
   declaration ends (i.e. immediately below the function whose body Step 3 just extended):

```ts
type AnkiFormat = 'tsv' | 'csv' | 'md';

const ANKI_EXPORTERS: Record<
  AnkiFormat,
  {
    build: (entries: Parameters<typeof buildAnkiTsv>[0]) => { filename: string; content: string };
    mime: string;
    label: string;
  }
> = {
  tsv: { build: buildAnkiTsv, mime: 'text/tab-separated-values', label: 'TSV' },
  csv: { build: buildAnkiCsv, mime: 'text/csv', label: 'CSV' },
  md: { build: buildAnkiMarkdown, mime: 'text/markdown', label: 'Markdown' },
};

// B8: shared wiring for all three "export saved words" buttons — saved.list with no payload
// returns every saved word (saved-words-policy.ts's "full list, no pagination" contract).
function wireAnkiExport(form: SettingsForm, eventName: string, format: AnkiFormat): void {
  form.addEventListener(eventName, () => {
    void send({ type: 'saved.list' }).then(
      (r) => {
        if (!r.ok || r.type !== 'saved.list') {
          form.setStatus(r.ok ? 'Unexpected reply' : r.error.message, 'error');
          return;
        }
        if (r.entries.length === 0) {
          form.setStatus('No saved words to export');
          return;
        }
        const { build, mime, label } = ANKI_EXPORTERS[format];
        const { filename, content } = build(r.entries);
        download(filename, content, mime);
        form.setStatus(`Exported ${r.entries.length} saved words as ${label}`);
      },
      () => form.setStatus('Could not export saved words', 'error'),
    );
  });
}
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

Commit:

```
git add packages/extension-chrome/src/options.ts
git commit -m "[B8AnkiCsvExport] feat: wire the three export buttons in Chrome options.ts (B8)" \
  -m $'Tribe-Card: b8-anki-csv-export\nTribe-Task: 4/7'
```

---

### Task 5: Safari composition root — mirror the same wiring

**Files:**

- Modify: `packages/extension-safari/src/options.ts`

Same rationale as Task 4: no dedicated unit test exists for this composition root; it shares the
`<settings-form>` component with Chrome, so the new buttons render there too and must not be a
dead click. No Safari e2e harness exists in this repo (per this batch's REPO-FACTS §14) — this
task's correctness is proven by typecheck + the shared `settings-form.test.ts` (Task 3) covering
the component itself; Safari-specific behavior is limited to this file's plumbing, identical to
Chrome's.

- [ ] **Step 1: Implement.** In `packages/extension-safari/src/options.ts`:

1. Add the three new named imports (right after `buildHistoryExport,`):

```ts
import {
  registerSettingsForm,
  DEFAULT_OUTPUT_FORMAT,
  buildHistoryExport,
  buildAnkiTsv,
  buildAnkiCsv,
  buildAnkiMarkdown,
  hasKeyFor,
  type Settings,
  type SettingsForm,
  type SettingsFormValue,
  type WireReply,
} from '@ai-dict/app';
```

2. Generalize `download()` identically to Task 4:

```ts
// Trigger a client-side file download from the options page (the SW has no DOM).
function download(filename: string, content: string, mime = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
```

3. Add the same `AnkiFormat`/`ANKI_EXPORTERS`/`wireAnkiExport` helper as Task 4 (this file has no
   `wireSettings` wrapper — its listeners are registered at module top level directly on `form`),
   placed after the `download` function:

```ts
type AnkiFormat = 'tsv' | 'csv' | 'md';

const ANKI_EXPORTERS: Record<
  AnkiFormat,
  {
    build: (entries: Parameters<typeof buildAnkiTsv>[0]) => { filename: string; content: string };
    mime: string;
    label: string;
  }
> = {
  tsv: { build: buildAnkiTsv, mime: 'text/tab-separated-values', label: 'TSV' },
  csv: { build: buildAnkiCsv, mime: 'text/csv', label: 'CSV' },
  md: { build: buildAnkiMarkdown, mime: 'text/markdown', label: 'Markdown' },
};

// B8: shared wiring for all three "export saved words" buttons — saved.list with no payload
// returns every saved word (saved-words-policy.ts's "full list, no pagination" contract).
function wireAnkiExport(eventName: string, format: AnkiFormat): void {
  form.addEventListener(eventName, () => {
    void send({ type: 'saved.list' }).then(
      (r) => {
        if (!r.ok || r.type !== 'saved.list') {
          form.setStatus(r.ok ? 'Unexpected reply' : r.error.message, 'error');
          return;
        }
        if (r.entries.length === 0) {
          form.setStatus('No saved words to export');
          return;
        }
        const { build, mime, label } = ANKI_EXPORTERS[format];
        const { filename, content } = build(r.entries);
        download(filename, content, mime);
        form.setStatus(`Exported ${r.entries.length} saved words as ${label}`);
      },
      () => form.setStatus('Could not export saved words', 'error'),
    );
  });
}
```

4. Register the three listeners at the bottom of the file, immediately after the existing
   `form.addEventListener('export-history', ...)` block:

```ts
form.addEventListener('export-history', () => {
  // history.list with no limit returns every entry (history-policy default).
  void send({ type: 'history.list' }).then(
    (r) => {
      if (!r.ok || r.type !== 'history') {
        form.setStatus(r.ok ? 'Unexpected reply' : r.error.message, 'error');
        return;
      }
      if (r.entries.length === 0) {
        form.setStatus('No history to export');
        return;
      }
      const { filename, json } = buildHistoryExport(r.entries);
      download(filename, json);
      form.setStatus(`Exported ${r.entries.length} entries`);
    },
    () => form.setStatus('Could not export history', 'error'),
  );
});

wireAnkiExport('export-anki-tsv', 'tsv');
wireAnkiExport('export-anki-csv', 'csv');
wireAnkiExport('export-anki-md', 'md');
```

Run:

```
cd packages/extension-safari && bun run typecheck
```

Expected: clean (no type errors).

- [ ] **Step 2: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd ../extension-safari && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

Commit:

```
git add packages/extension-safari/src/options.ts
git commit -m "[B8AnkiCsvExport] feat: mirror the export wiring in Safari options.ts (B8)" \
  -m $'Tribe-Card: b8-anki-csv-export\nTribe-Task: 5/7'
```

---

### Task 6: Chrome e2e coverage

**Files:**

- Create: `packages/extension-chrome/e2e/anki-export.spec.ts`

- [ ] **Step 1: Write the new e2e spec.** Create
      `packages/extension-chrome/e2e/anki-export.spec.ts`:

```ts
import { test, expect } from './fixtures';
import { seedSettings } from './helpers';

const status = 'settings-form #status';

async function seedTwoSavedWords(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(() => {
    const bank = {
      word: 'bank',
      status: 'learning',
      savedAt: 1700000000000,
      senses: [
        {
          definition: 'a financial institution',
          translation: 'ngân hàng',
          sentence: 'the river bank',
          url: 'https://example.com',
          title: 'Example',
        },
      ],
    };
    const serendipity = {
      word: 'serendipity',
      status: 'known',
      savedAt: 1700000100000,
      senses: [
        {
          definition: 'a happy accident',
          translation: '',
          sentence: 'pure serendipity',
          url: 'https://example.com/2',
          title: 'Example Two',
        },
      ],
    };
    return chrome.storage.local.set({
      'saved:bank': JSON.stringify(bank),
      'saved:serendipity': JSON.stringify(serendipity),
      'saved:index': JSON.stringify(['serendipity', 'bank']),
    });
  });
}

test('Export Anki deck (TSV) downloads a tab-separated file with no header, in the pinned column order', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page);
  await seedTwoSavedWords(page);
  await page.reload();
  await page.waitForSelector('settings-form');

  const downloadPromise = page.waitForEvent('download');
  await page.locator('settings-form #export-anki-tsv').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('ai-dict-anki.tsv');

  const file = await download.path();
  const fs = await import('node:fs');
  const content = fs.readFileSync(file, 'utf8');
  const lines = content.trimEnd().split('\n');
  expect(lines).toHaveLength(2);
  expect(lines[0]!.split('\t')).toEqual([
    'serendipity',
    'a happy accident',
    '',
    'pure serendipity',
    'https://example.com/2',
    'Example Two',
    new Date(1700000100000).toISOString(),
    'known',
  ]);
  // [S1] the export must never carry the API key.
  expect(content).not.toContain('apiKey');
  await expect(page.locator(status)).toHaveText('Exported 2 saved words as TSV');
});

test('Export CSV downloads a comma-separated file with the pinned header row', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page);
  await seedTwoSavedWords(page);
  await page.reload();
  await page.waitForSelector('settings-form');

  const downloadPromise = page.waitForEvent('download');
  await page.locator('settings-form #export-anki-csv').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('ai-dict-anki.csv');

  const file = await download.path();
  const fs = await import('node:fs');
  const content = fs.readFileSync(file, 'utf8');
  const lines = content.trimEnd().split('\r\n');
  expect(lines[0]).toBe('word,definition,translation,sentence,url,title,savedAt,status');
  expect(lines).toHaveLength(3);
  expect(content).not.toContain('apiKey');
  await expect(page.locator(status)).toHaveText('Exported 2 saved words as CSV');
});

test('Export Markdown downloads a human-readable file with a heading per saved word', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page);
  await seedTwoSavedWords(page);
  await page.reload();
  await page.waitForSelector('settings-form');

  const downloadPromise = page.waitForEvent('download');
  await page.locator('settings-form #export-anki-md').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('ai-dict-anki.md');

  const file = await download.path();
  const fs = await import('node:fs');
  const content = fs.readFileSync(file, 'utf8');
  expect(content).toContain('## bank');
  expect(content).toContain('## serendipity');
  expect(content).not.toContain('apiKey');
  await expect(page.locator(status)).toHaveText('Exported 2 saved words as Markdown');
});

test('Exporting with no saved words reports nothing to export and downloads nothing', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page); // a key, but no saved: entries
  await page.reload();
  await page.waitForSelector('settings-form');

  let downloadFired = false;
  page.on('download', () => {
    downloadFired = true;
  });
  await page.locator('settings-form #export-anki-tsv').click();
  await expect(page.locator(status)).toHaveText('No saved words to export');
  await page.waitForTimeout(300); // give a wrongly-fired download a moment to surface
  expect(downloadFired).toBe(false);
});
```

Run:

```
GEMINI_API_KEY= bun run build:chrome
cd packages/extension-chrome && bunx playwright test anki-export
```

Expected: 4 passed.

- [ ] **Step 2: Commit** — gate, then commit:

```
GEMINI_API_KEY= bun run build:chrome
bun run lint && bun run format:check
```

Commit:

```
git add packages/extension-chrome/e2e/anki-export.spec.ts
git commit -m "[B8AnkiCsvExport] feat: e2e coverage for TSV/CSV/Markdown export + empty state (B8)" \
  -m $'Tribe-Card: b8-anki-csv-export\nTribe-Task: 6/7'
```

---

### Task 7: Final gate + PR

**Files:** none (verification + PR only).

- [ ] **Step 1: Run the full gate.**

```
cd packages/app && bun run typecheck
cd ../extension-chrome && bun run typecheck
cd ../extension-safari && bun run typecheck
cd ../..
bun run test
bun run lint
bun run format:check
GEMINI_API_KEY= bun run build:chrome
bun run build:safari
cd packages/extension-chrome && bunx playwright test anki-export options-actions saved-word
```

Expected: typecheck clean on all three packages; the full Vitest suite green (690 pre-existing +
this card's new unit tests: 5 wire-schema + 2 router + 15 anki-export + updated settings-form
event tests); lint/format clean; both extension builds succeed (Chrome with the env key cleared);
`anki-export.spec.ts` (this card's new suite), `options-actions.spec.ts` (regression guard for the
rest of the options page this task's edits share a file with), and `saved-word.spec.ts`
(regression guard confirming `saved.save`/`saved:*` storage still behaves exactly as B1 shipped
it) all pass.

- [ ] **Step 2: Open the PR.**

Title: `[B8AnkiCsvExport] Anki / CSV / Markdown export for saved words`.

Body must include:

- A 1-3 sentence description (what changed + why — every saved word can now leave the extension as
  an Anki-importable deck, feeding the spaced-repetition ecosystem the roadmap explicitly defers
  to instead of rebuilding).
- The Jira ticket link, ticket id = branch suffix per repo convention:
  `https://prospa.atlassian.net/browse/B8AnkiCsvExport`.
- A **"Testing performed"** section (this worktree's owner ruling 2026-07-16 — no screenshots or
  video) listing exactly what Step 1 ran and its pass counts: full Vitest suite, the 4 new
  `anki-export.spec.ts` e2e scenarios, plus the two regression e2e files re-run alongside them.
- Merge: **regular merge commit only — squash prohibited** (owner ruling 2026-07-16).

No `pr-assets/*` branch is created for this card (no media evidence, per policy).
