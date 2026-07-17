# B9 Backup & Restore Implementation Plan

> **For agentic workers:** implement task-by-task, TDD (red → green → commit) per task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a "Backup & restore" section in Settings lets a user export everything (saved words,
history, and non-secret settings — never the API key) as one versioned JSON file
(`ai-dict-backup.json`, the E2 envelope verbatim), and import that file on another device or after
a reinstall, choosing **merge** (add/update without deleting) or **replace** (local savedWords/
history are wiped first) for saved words and history; settings always fully re-apply on import
(never the key).

**Architecture:** two new pure modules in the portable core (`domain/backup-policy.ts`'s
`importBackup` orchestrator, `app/backup.ts`'s `buildBackupExport`/`parseBackupFile`), two small
additive domain functions (`savedWordImport`, `historyImportEntry`), two new wire messages
(`saved.list`, `backup.import` — ONE task together per CONTRACTS §2), a new UI section in the
shared `settings-form.ts`, and composition-root wiring in both `extension-chrome/src/options.ts`
and `extension-safari/src/options.ts`. Full design rationale — including the merge/replace
semantics per keyspace, why `backup.import`'s wire schemas are deliberately non-strict, and the
E2 envelope quoted verbatim — is in
`docs/superpowers/specs/2026-07-17-b9-backup-restore-design.md`.

**Tech Stack:** TypeScript, Vitest + happy-dom (unit), Playwright (e2e), Zod (wire schemas).

## Global Constraints

- Implementer: dispatch each implementation/fix task to the `hunter` subagent.
- Start in a fresh git worktree under `.claude/worktrees/` on branch `feature/B9BackupRestore`.
- Commit subject: `[B9BackupRestore] feat: <imperative summary> (B9)` — no Co-Authored-By
  trailer, no attribution footer.
- `bun run lint` + `bun run format:check` green before every commit; `cd packages/app && bun run
typecheck` green after every task touching that package; `cd packages/extension-chrome && bun run
typecheck` (and, from Task 6 on, `cd packages/extension-safari && bun run typecheck`) green after
  every task touching those packages.
- **If a task adds a wire message, the `wire.ts` arm and its `router.ts` case are ONE task** — Task
  4 below does both `saved.list` and `backup.import` together (they're this card's only two
  messages; splitting them would leave the exhaustive `switch` uncompilable mid-task).
- E2e builds clear the ambient key: `GEMINI_API_KEY= bun run build:chrome` (or
  `build:chrome:e2e`) — never rely on shell state.
- E2e must never fetch the live landing page — not applicable to this card (Settings-only,
  no landing-page touchpoint), noted for completeness.
- PR: title `[B9BackupRestore] Backup & restore`; body includes a written **"Testing performed"**
  section (suites, counts, e2e scenarios, gates) — **no screenshots or video** (owner ruling
  2026-07-16). No `.github/PULL_REQUEST_TEMPLATE` file exists in this repo (verified) — don't cite
  template headings as fact.
- Merge: **regular merge commit only — squash prohibited** (owner ruling 2026-07-16).
- UI reads only `--ad-*`/`--adp-*` tokens; no hard-coded colors.
- S1: the API key never appears in the export, never crosses the wire on `backup.import`, and
  survives every import untouched (never present in `BackupSettings`, so there is nothing to
  overlay it with). S4 not applicable (no model output rendered by this card). Constraint 4 not
  applicable (0 LLM calls).
- `.c3/` is CLI-only — this card adds no new architecture component (new files land inside the
  existing `c3-1 app`/`c3-2 extension-chrome`/`c3-3 extension-safari` components), so no C3
  change-unit is needed; the final task notes this explicitly rather than hand-editing `.c3/`.

---

### Task 1: domain additions — `savedWordImport` + `historyImportEntry`

**Files:**

- Modify: `packages/app/src/domain/saved-words-policy.ts`
- Modify: `packages/app/test/saved-words-policy.test.ts`
- Modify: `packages/app/src/domain/history-policy.ts`
- Modify: `packages/app/test/history-policy.test.ts`

**Interfaces:**

```ts
export async function savedWordImport(deps: SavedWordsDeps, entry: SavedWordEntry): Promise<void>;
export async function historyImportEntry(deps: HistoryDeps, entry: HistoryEntry): Promise<boolean>;
```

- [ ] **Step 1: Write the failing tests.** Append to `packages/app/test/saved-words-policy.test.ts`,
      inside the existing `describe('saved-words-policy', ...)` block, just before its closing
      `});` (after the last `savedWordSetStatus` test):

```ts
it('savedWordImport writes an entry verbatim (not now()-derived) and adds it to the index', async () => {
  const s = memStorage();
  const entry = {
    word: 'imported',
    status: 'known' as const,
    savedAt: 555,
    senses: [
      {
        definition: 'from a backup',
        translation: 'nhập khẩu',
        sentence: 'an imported sentence',
        url: 'https://example.com/x',
        title: 'X',
      },
    ],
  };
  await savedWordImport({ storage: s }, entry);
  expect(await s.getItem('saved:imported')).toBe(JSON.stringify(entry));
  const list = await savedWordsList({ storage: s });
  expect(list).toEqual([entry]);
});

it('savedWordImport is idempotent on the index — importing the same word twice adds it once', async () => {
  const s = memStorage();
  const entry = {
    word: 'bank',
    status: 'learning' as const,
    savedAt: 1,
    senses: [{ definition: 'd', translation: '', sentence: 's', url: 'u', title: 't' }],
  };
  await savedWordImport({ storage: s }, entry);
  await savedWordImport({ storage: s }, { ...entry, status: 'known' });
  const list = await savedWordsList({ storage: s });
  expect(list).toHaveLength(1);
  expect(list[0]!.status).toBe('known'); // second import's content wins on the value itself
});

it('savedWordImport coexists with entries written by savedWordUpsert', async () => {
  const s = memStorage();
  await savedWordUpsert({ storage: s, now: () => 1000 }, input('live'));
  await savedWordImport(
    { storage: s },
    {
      word: 'imported',
      status: 'learning',
      savedAt: 2,
      senses: [{ definition: 'd', translation: '', sentence: 's', url: 'u', title: 't' }],
    },
  );
  const list = await savedWordsList({ storage: s });
  expect(list.map((e) => e.word).sort()).toEqual(['imported', 'live']);
});
```

Add `savedWordImport` to the existing import list at the top of the file
(`packages/app/test/saved-words-policy.test.ts:2-10`).

Run: `cd packages/app && bunx vitest run test/saved-words-policy.test.ts`
Expected: failures — `savedWordImport` is not exported/not a function.

- [ ] **Step 2: Implement.** In `packages/app/src/domain/saved-words-policy.ts`, add after
      `savedWordSetStatus` (currently ending at line 98):

```ts
/**
 * B9: write an already-fully-formed entry verbatim (status/savedAt/senses exactly as given) —
 * used only by backup import, which must preserve an imported entry's own history rather than
 * derive a fresh one the way savedWordUpsert does for a live save (savedWordUpsert always
 * recomputes/preserves savedAt from `now()`/the existing record; this function never calls
 * `now()` at all). Adds the key to the index only if not already present, so importing an entry
 * that already exists (post merge-decision) never duplicates the index.
 */
export async function savedWordImport(deps: SavedWordsDeps, entry: SavedWordEntry): Promise<void> {
  const key = normalizeWordKey(entry.word);
  await deps.storage.setItem(`saved:${key}`, JSON.stringify(entry));
  const idx = await readIndex(deps.storage);
  if (!idx.includes(key)) {
    await deps.storage.setItem(INDEX_KEY, JSON.stringify([key, ...idx]));
  }
}
```

Run: `cd packages/app && bunx vitest run test/saved-words-policy.test.ts`
Expected: all tests pass (existing + 3 new).

- [ ] **Step 3: Write the failing history test.** Append to
      `packages/app/test/history-policy.test.ts`, inside the existing `describe('history-policy',
...)` block, just before its closing `});`:

```ts
it('historyImportEntry adds a new id and returns true', async () => {
  const s = memStorage();
  const added = await historyImportEntry({ storage: s }, entry('9'));
  expect(added).toBe(true);
  expect(await historyGet({ storage: s }, '9')).toEqual(entry('9'));
});

it('historyImportEntry skips an existing id and returns false, leaving it unchanged', async () => {
  const s = memStorage();
  await historyAppend({ storage: s }, entry('9'));
  const added = await historyImportEntry({ storage: s }, { ...entry('9'), context: 'different' });
  expect(added).toBe(false);
  expect((await historyGet({ storage: s }, '9'))!.context).toBe(''); // original, unchanged
});

it('historyImportEntry respects the existing cap via historyAppend', async () => {
  const s = memStorage();
  await historyAppend({ storage: s, cap: 1 }, entry('1'));
  await historyImportEntry({ storage: s, cap: 1 }, entry('2'));
  const { entries } = await historyList({ storage: s }, {});
  expect(entries.map((e) => e.id)).toEqual(['2']);
});
```

Add `historyImportEntry` to the existing import list at the top of the file
(`packages/app/test/history-policy.test.ts:2-9`).

Run: `cd packages/app && bunx vitest run test/history-policy.test.ts`
Expected: failures — `historyImportEntry` is not exported/not a function.

- [ ] **Step 4: Implement.** In `packages/app/src/domain/history-policy.ts`, add after
      `historyDelete` (currently ending at line 83):

```ts
/**
 * B9: import one backup history entry — add it only if its id isn't already present locally
 * (history entries are immutable per-lookup snapshots; there is nothing to "merge" per id, only
 * add-if-missing — see the design spec §3.2). Reuses historyAppend unmodified so the existing
 * cap and newest-first index invariant both keep working exactly as they do for live traffic.
 * Returns whether the entry was newly added (false = skipped, id already present).
 */
export async function historyImportEntry(deps: HistoryDeps, entry: HistoryEntry): Promise<boolean> {
  const existing = await historyGet(deps, entry.id);
  if (existing) return false;
  await historyAppend(deps, entry);
  return true;
}
```

Run: `cd packages/app && bunx vitest run test/history-policy.test.ts`
Expected: all tests pass (existing + 3 new).

- [ ] **Step 5: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

```
git add packages/app/src/domain/saved-words-policy.ts packages/app/test/saved-words-policy.test.ts \
  packages/app/src/domain/history-policy.ts packages/app/test/history-policy.test.ts
git commit -m "[B9BackupRestore] feat: add savedWordImport + historyImportEntry domain primitives (B9)"
```

---

### Task 2: `domain/backup-policy.ts` — the merge/replace orchestrator

**Files:**

- Create: `packages/app/src/domain/backup-policy.ts`
- Create: `packages/app/test/backup-policy.test.ts`

**Interfaces:**

```ts
export interface BackupImportDeps {
  storage: Storage;
}
export type BackupImportMode = 'merge' | 'replace';
export interface BackupImportResult {
  savedWordsImported: number;
  historyImported: number;
}
export async function importBackup(
  deps: BackupImportDeps,
  savedWords: SavedWordEntry[],
  history: HistoryEntry[],
  mode: BackupImportMode,
): Promise<BackupImportResult>;
```

- [ ] **Step 1: Write the failing tests.** Create `packages/app/test/backup-policy.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { importBackup } from '../src/domain/backup-policy';
import { savedWordUpsert, savedWordsList } from '../src/domain/saved-words-policy';
import { historyAppend, historyList } from '../src/domain/history-policy';
import type { Storage, SavedWordEntry, HistoryEntry } from '../src';

function memStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => Promise.resolve(m.get(k) ?? null),
    setItem: (k, v) => {
      m.set(k, v);
      return Promise.resolve();
    },
    removeItem: (k) => {
      m.delete(k);
      return Promise.resolve();
    },
    keys: (p) => Promise.resolve([...m.keys()].filter((k) => !p || k.startsWith(p))),
  };
}

const savedEntry = (word: string, savedAt: number, definition = 'd'): SavedWordEntry => ({
  word,
  status: 'learning',
  savedAt,
  senses: [{ definition, translation: '', sentence: 's', url: 'u', title: 't' }],
});

const historyEntry = (id: string, createdAt: number): HistoryEntry => ({
  id,
  word: id,
  context: '',
  createdAt,
  result: {
    markdown: '',
    word: id,
    target: 'vi',
    model: 'gemini-2.5-flash',
    fromCache: false,
    fetchedAt: 0,
  },
});

describe('importBackup — merge mode', () => {
  it('adds a word never seen locally', async () => {
    const s = memStorage();
    const result = await importBackup({ storage: s }, [savedEntry('new-word', 100)], [], 'merge');
    expect(result.savedWordsImported).toBe(1);
    expect((await savedWordsList({ storage: s })).map((e) => e.word)).toEqual(['new-word']);
  });

  it('a strictly-newer imported savedAt replaces the local entry', async () => {
    const s = memStorage();
    await savedWordUpsert(
      { storage: s, now: () => 100 },
      {
        word: 'bank',
        definition: 'old',
        translation: '',
        sentence: 's',
        url: 'u',
        title: 't',
      },
    );
    const result = await importBackup(
      { storage: s },
      [savedEntry('bank', 999, 'newer')],
      [],
      'merge',
    );
    expect(result.savedWordsImported).toBe(1);
    const list = await savedWordsList({ storage: s });
    expect(list.find((e) => e.word === 'bank')!.senses[0]!.definition).toBe('newer');
  });

  it('an older-or-equal imported savedAt is skipped, local entry unchanged', async () => {
    const s = memStorage();
    await savedWordUpsert(
      { storage: s, now: () => 500 },
      {
        word: 'bank',
        definition: 'local',
        translation: '',
        sentence: 's',
        url: 'u',
        title: 't',
      },
    );
    const result = await importBackup(
      { storage: s },
      [savedEntry('bank', 500, 'imported-tie'), savedEntry('bank2', 1, 'older')],
      [],
      'merge',
    );
    // only 'bank2' would count if it were a genuinely new word; here we assert the tie case only.
    const list = await savedWordsList({ storage: s });
    expect(list.find((e) => e.word === 'bank')!.senses[0]!.definition).toBe('local');
    expect(result.savedWordsImported).toBe(1); // bank2 (new word) counted; bank (tie) did not
  });

  it('history: new ids are added, existing ids are skipped, final index is newest-first', async () => {
    const s = memStorage();
    await historyAppend({ storage: s }, historyEntry('1', 1000));
    const result = await importBackup(
      { storage: s },
      [],
      [historyEntry('1', 1000), historyEntry('2', 3000), historyEntry('3', 2000)],
      'merge',
    );
    expect(result.historyImported).toBe(2); // '2' and '3' are new; '1' already existed
    const { entries } = await historyList({ storage: s }, {});
    expect(entries.map((e) => e.id)).toEqual(['2', '3', '1']); // newest (3000) first
  });
});

describe('importBackup — replace mode', () => {
  it('clears pre-existing saved words/history not present in the import', async () => {
    const s = memStorage();
    await savedWordUpsert(
      { storage: s, now: () => 1 },
      {
        word: 'stale',
        definition: 'd',
        translation: '',
        sentence: 's',
        url: 'u',
        title: 't',
      },
    );
    await historyAppend({ storage: s }, historyEntry('old', 1));
    const result = await importBackup(
      { storage: s },
      [savedEntry('fresh', 1)],
      [historyEntry('new', 2)],
      'replace',
    );
    expect(result).toEqual({ savedWordsImported: 1, historyImported: 1 });
    const words = (await savedWordsList({ storage: s })).map((e) => e.word);
    expect(words).toEqual(['fresh']);
    const { entries } = await historyList({ storage: s }, {});
    expect(entries.map((e) => e.id)).toEqual(['new']);
  });
});
```

Run: `cd packages/app && bunx vitest run test/backup-policy.test.ts`
Expected: failures — `../src/domain/backup-policy` does not exist.

- [ ] **Step 2: Implement.** Create `packages/app/src/domain/backup-policy.ts`:

```ts
import type { Storage } from '../ports';
import type { SavedWordEntry, HistoryEntry } from './types';
import { savedWordsClear, savedWordGet, savedWordImport } from './saved-words-policy';
import { historyClear, historyImportEntry } from './history-policy';

export interface BackupImportDeps {
  storage: Storage;
}
export type BackupImportMode = 'merge' | 'replace';
export interface BackupImportResult {
  savedWordsImported: number;
  historyImported: number;
}

/**
 * B9: apply a backup file's savedWords/history into the local `saved:*`/`history:*` keyspaces.
 * `mode: 'replace'` clears both keyspaces first (design spec §3.2) — after that, the per-entry
 * logic below is IDENTICAL for merge and replace, since every local entry has already been
 * cleared out of replace's way. Settings are never touched here — settings import is a
 * client-side, always-replace overlay in the composition root (design spec §3.2/§4.5).
 */
export async function importBackup(
  deps: BackupImportDeps,
  savedWords: SavedWordEntry[],
  history: HistoryEntry[],
  mode: BackupImportMode,
): Promise<BackupImportResult> {
  if (mode === 'replace') {
    await savedWordsClear(deps);
    await historyClear(deps);
  }

  let savedWordsImported = 0;
  for (const entry of savedWords) {
    const existing = await savedWordGet(deps, entry.word);
    // Design spec §3.2: no local entry, or the imported entry's savedAt is strictly newer → it
    // wins. A tie keeps the local entry. In replace mode `existing` is always null (cleared
    // above), so every imported entry is written.
    if (!existing || entry.savedAt > existing.savedAt) {
      await savedWordImport(deps, entry);
      savedWordsImported++;
    }
  }

  // Design spec §3.2: oldest-createdAt-first so historyAppend's newest-first prepend ends up
  // matching the entries' real chronological order once every one has been processed.
  const sorted = [...history].sort((a, b) => a.createdAt - b.createdAt);
  let historyImported = 0;
  for (const entry of sorted) {
    if (await historyImportEntry(deps, entry)) historyImported++;
  }

  return { savedWordsImported, historyImported };
}
```

Run: `cd packages/app && bunx vitest run test/backup-policy.test.ts`
Expected: all 6 tests pass.

- [ ] **Step 3: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

```
git add packages/app/src/domain/backup-policy.ts packages/app/test/backup-policy.test.ts
git commit -m "[B9BackupRestore] feat: add importBackup merge/replace orchestrator (B9)"
```

---

### Task 3: `app/backup.ts` — build/parse the file (pure)

**Files:**

- Create: `packages/app/src/app/backup.ts`
- Create: `packages/app/test/app/backup.test.ts`

**Interfaces:**

```ts
export const BACKUP_FORMAT: 'ai-dict-backup';
export const BACKUP_VERSION: 1;
export interface BackupSettings {
  targetLang: string;
  outputFormat: string;
  promptEnvelope: string;
  theme: string;
  cacheEnabled: boolean;
  saveHistory: boolean;
  provider: string;
}
export interface BackupEnvelope {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  exportedAt: number;
  data: { savedWords: SavedWordEntry[]; history: HistoryEntry[]; settings: BackupSettings };
}
export function buildBackupExport(
  savedWords: SavedWordEntry[],
  history: HistoryEntry[],
  settings: BackupSettings,
  now: () => number,
): { filename: string; json: string };
export type ParsedBackupFile =
  | { ok: true; savedWords: unknown[]; history: unknown[]; settings: Partial<BackupSettings> }
  | { ok: false; error: string };
export function parseBackupFile(text: string): ParsedBackupFile;
```

- [ ] **Step 1: Write the failing tests.** Create `packages/app/test/app/backup.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  buildBackupExport,
  parseBackupFile,
  BACKUP_FORMAT,
  BACKUP_VERSION,
} from '../../src/app/backup';
import type { HistoryEntry, SavedWordEntry } from '../../src/domain/types';

const savedWord: SavedWordEntry = {
  word: 'serendipity',
  status: 'learning',
  savedAt: 1700000000000,
  senses: [
    {
      definition: 'a happy accident',
      translation: 'sự tình cờ',
      sentence: 'It was pure serendipity.',
      url: 'https://example.com',
      title: 'Example',
    },
  ],
};

const historyItem: HistoryEntry = {
  id: 'abc-123',
  word: 'bank',
  context: 'a happy accident',
  result: {
    markdown: '# bank',
    word: 'bank',
    target: 'vi',
    model: 'gemini-2.5-flash',
    fromCache: false,
    fetchedAt: 1700000000000,
  },
  createdAt: 1700000000000,
};

const settings = {
  targetLang: 'vi',
  outputFormat: 'Define {word}',
  promptEnvelope: '',
  theme: 'sepia',
  cacheEnabled: true,
  saveHistory: true,
  provider: 'gemini',
};

describe('buildBackupExport', () => {
  it('returns a stable .json filename', () => {
    const { filename } = buildBackupExport([savedWord], [historyItem], settings, () => 1);
    expect(filename).toBe('ai-dict-backup.json');
  });

  it('produces the E2 envelope shape exactly', () => {
    const { json } = buildBackupExport([savedWord], [historyItem], settings, () => 999);
    const parsed = JSON.parse(json) as {
      format: string;
      version: number;
      exportedAt: number;
      data: { savedWords: SavedWordEntry[]; history: HistoryEntry[]; settings: typeof settings };
    };
    expect(parsed.format).toBe(BACKUP_FORMAT);
    expect(parsed.version).toBe(BACKUP_VERSION);
    expect(parsed.exportedAt).toBe(999);
    expect(parsed.data.savedWords).toEqual([savedWord]);
    expect(parsed.data.history).toEqual([historyItem]);
    expect(parsed.data.settings).toEqual(settings);
  });

  it('handles empty savedWords/history — still produces a valid file', () => {
    const { json } = buildBackupExport([], [], settings, () => 1);
    const parsed = JSON.parse(json) as { data: { savedWords: unknown[]; history: unknown[] } };
    expect(parsed.data.savedWords).toEqual([]);
    expect(parsed.data.history).toEqual([]);
  });

  it('never leaks a stray apiKey-shaped field on settings into the export', () => {
    const tainted = { ...settings, apiKey: 'AIza-should-never-appear' } as typeof settings & {
      apiKey: string;
    };
    const { json } = buildBackupExport([], [], tainted, () => 1);
    expect(json).not.toContain('apiKey');
    expect(json).not.toContain('AIza-should-never-appear');
  });
});

describe('parseBackupFile', () => {
  it('round-trips a file built by buildBackupExport', () => {
    const { json } = buildBackupExport([savedWord], [historyItem], settings, () => 1);
    const result = parseBackupFile(json);
    if (!result.ok) throw new Error('expected ok:true');
    expect(result.savedWords).toEqual([savedWord]);
    expect(result.history).toEqual([historyItem]);
    expect(result.settings).toEqual(settings);
  });

  it('rejects non-JSON text', () => {
    expect(parseBackupFile('not json{')).toEqual({
      ok: false,
      error: 'This file is not valid JSON.',
    });
  });

  it('rejects a JSON file with the wrong format', () => {
    expect(parseBackupFile(JSON.stringify({ format: 'something-else', version: 1 }))).toEqual({
      ok: false,
      error: 'This file is not a valid AI Dictionary backup.',
    });
  });

  it('rejects a version newer than this build understands', () => {
    const result = parseBackupFile(JSON.stringify({ format: BACKUP_FORMAT, version: 2 }));
    expect(result).toEqual({
      ok: false,
      error:
        'This backup was made with a newer version of AI Dictionary. Update the extension and try again.',
    });
  });

  it('defaults missing data.savedWords/data.history to empty arrays rather than throwing', () => {
    const result = parseBackupFile(JSON.stringify({ format: BACKUP_FORMAT, version: 1 }));
    if (!result.ok) throw new Error('expected ok:true');
    expect(result.savedWords).toEqual([]);
    expect(result.history).toEqual([]);
    expect(result.settings).toEqual({});
  });
});
```

Run: `cd packages/app && bunx vitest run test/app/backup.test.ts`
Expected: failures — `../../src/app/backup` does not exist.

- [ ] **Step 2: Implement.** Create `packages/app/src/app/backup.ts`:

```ts
import type { SavedWordEntry, HistoryEntry } from '../domain/types';

export const BACKUP_FORMAT = 'ai-dict-backup';
export const BACKUP_VERSION = 1;

/**
 * B9: the non-secret settings fields worth carrying to another device (design spec §3.1).
 * Deliberately excludes apiKey/openaiApiKey/anthropicApiKey (S1) and the derived hasKey/
 * configuredProviders (recomputed live from whatever key exists on the destination device —
 * never carried across).
 */
export interface BackupSettings {
  targetLang: string;
  outputFormat: string;
  promptEnvelope: string;
  theme: string;
  cacheEnabled: boolean;
  saveHistory: boolean;
  provider: string;
}

export interface BackupEnvelope {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  exportedAt: number;
  data: {
    savedWords: SavedWordEntry[];
    history: HistoryEntry[];
    settings: BackupSettings;
  };
}

/**
 * Build the downloadable backup payload (B9, the E2 envelope verbatim). Every field is
 * reconstructed explicitly rather than spread — mirrors buildHistoryExport's convention
 * (app/history-export.ts) — so a stray secret riding along on any input object can never survive
 * into the exported file (S1 defense-in-depth on top of BackupSettings' own type shape).
 */
export function buildBackupExport(
  savedWords: SavedWordEntry[],
  history: HistoryEntry[],
  settings: BackupSettings,
  now: () => number,
): { filename: string; json: string } {
  const envelope: BackupEnvelope = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: now(),
    data: {
      savedWords: savedWords.map((e) => ({
        word: e.word,
        status: e.status,
        savedAt: e.savedAt,
        senses: e.senses.map((s) => ({
          definition: s.definition,
          translation: s.translation,
          sentence: s.sentence,
          url: s.url,
          title: s.title,
        })),
      })),
      history: history.map((e) => ({
        id: e.id,
        word: e.word,
        context: e.context,
        result: {
          markdown: e.result.markdown,
          word: e.result.word,
          target: e.result.target,
          model: e.result.model,
          fromCache: e.result.fromCache,
          fetchedAt: e.result.fetchedAt,
        },
        createdAt: e.createdAt,
      })),
      settings: {
        targetLang: settings.targetLang,
        outputFormat: settings.outputFormat,
        promptEnvelope: settings.promptEnvelope,
        theme: settings.theme,
        cacheEnabled: settings.cacheEnabled,
        saveHistory: settings.saveHistory,
        provider: settings.provider,
      },
    },
  };
  return { filename: 'ai-dict-backup.json', json: JSON.stringify(envelope, null, 2) };
}

export type ParsedBackupFile =
  | {
      ok: true;
      savedWords: unknown[];
      history: unknown[];
      settings: Partial<BackupSettings>;
    }
  | { ok: false; error: string };

/**
 * Validate a backup file's OUTER envelope (format/version/presence) — the client-side half of
 * the split described in the design spec §3.4. Returns the three `data.*` values UNVALIDATED at
 * the per-entry level (that happens at the wire boundary via the non-strict Import* schemas,
 * design spec §3.5).
 */
export function parseBackupFile(text: string): ParsedBackupFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'This file is not valid JSON.' };
  }
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: 'This file is not a valid AI Dictionary backup.' };
  }
  const obj = raw as Record<string, unknown>;
  if (obj['format'] !== BACKUP_FORMAT) {
    return { ok: false, error: 'This file is not a valid AI Dictionary backup.' };
  }
  if (typeof obj['version'] !== 'number' || obj['version'] > BACKUP_VERSION) {
    return {
      ok: false,
      error:
        'This backup was made with a newer version of AI Dictionary. Update the extension and try again.',
    };
  }
  const data = (obj['data'] as Record<string, unknown> | undefined) ?? {};
  return {
    ok: true,
    savedWords: Array.isArray(data['savedWords']) ? data['savedWords'] : [],
    history: Array.isArray(data['history']) ? data['history'] : [],
    settings: (data['settings'] as Partial<BackupSettings> | undefined) ?? {},
  };
}
```

Run: `cd packages/app && bunx vitest run test/app/backup.test.ts`
Expected: all 9 tests pass.

- [ ] **Step 3: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

```
git add packages/app/src/app/backup.ts packages/app/test/app/backup.test.ts
git commit -m "[B9BackupRestore] feat: add buildBackupExport + parseBackupFile (B9)"
```

---

### Task 4: wire protocol — `saved.list` + `backup.import` (ONE task, per CONTRACTS §2)

**Files:**

- Modify: `packages/app/src/wire.ts`
- Modify: `packages/app/src/app/router.ts`
- Modify: `packages/app/src/index.ts`
- Modify: `packages/app/test/wire-schema.test.ts`
- Modify: `packages/app/test/app/router.test.ts`

**Interfaces:**

```ts
// New WireMessageSchema arms:
{ type: 'saved.list' }
{ type: 'backup.import'; mode: 'merge' | 'replace'; savedWords: SavedWordEntry[]; history: HistoryEntry[] }
// New WireReplySchema variants:
{ ok: true; type: 'saved-list'; entries: SavedWordEntry[] }
{ ok: true; type: 'backup-imported'; savedWordsImported: number; historyImported: number }
```

- [ ] **Step 1: Write the failing wire-schema tests.** Append to
      `packages/app/test/wire-schema.test.ts`, inside the existing `describe('wire-schema', ...)`
      block, just before its closing `});` (this file imports `WireMessageSchema, WireReplySchema,
wireJsonSchema` from `'../src/wire'` at line 2 — no new import needed):

```ts
it('[B9] accepts a payload-free saved.list message', () => {
  expect(WireMessageSchema.safeParse({ type: 'saved.list' }).success).toBe(true);
});

it('[B9] accepts a valid backup.import message with one saved word and one history entry', () => {
  const result = WireMessageSchema.safeParse({
    type: 'backup.import',
    mode: 'merge',
    savedWords: [
      {
        word: 'bank',
        status: 'learning',
        savedAt: 1,
        senses: [{ definition: 'd', translation: '', sentence: 's', url: 'u', title: 't' }],
      },
    ],
    history: [
      {
        id: 'h1',
        word: 'bank',
        context: '',
        createdAt: 1,
        result: {
          markdown: '',
          word: 'bank',
          target: 'vi',
          model: 'gemini-2.5-flash',
          fromCache: false,
          fetchedAt: 1,
        },
      },
    ],
  });
  expect(result.success).toBe(true);
});

it('[B9] rejects an invalid mode value on backup.import', () => {
  const result = WireMessageSchema.safeParse({
    type: 'backup.import',
    mode: 'overwrite', // not 'merge' | 'replace'
    savedWords: [],
    history: [],
  });
  expect(result.success).toBe(false);
});

it('[B9] backup.import ignores an unrecognised field on a saved-word sense (forward compat)', () => {
  const result = WireMessageSchema.safeParse({
    type: 'backup.import',
    mode: 'merge',
    savedWords: [
      {
        word: 'bank',
        status: 'learning',
        savedAt: 1,
        senses: [
          {
            definition: 'd',
            translation: '',
            sentence: 's',
            url: 'u',
            title: 't',
            future: 'a field this version does not know about',
          },
        ],
      },
    ],
    history: [],
  });
  expect(result.success).toBe(true);
  if (!result.success) throw new Error('expected success');
  const msg = result.data as Extract<typeof result.data, { type: 'backup.import' }>;
  expect('future' in msg.savedWords[0]!.senses[0]!).toBe(false); // stripped, not rejected
});

it('[B9] backup.import rejects a saved-word entry missing a required field', () => {
  const result = WireMessageSchema.safeParse({
    type: 'backup.import',
    mode: 'merge',
    savedWords: [
      {
        // 'word' omitted
        status: 'learning',
        savedAt: 1,
        senses: [],
      },
    ],
    history: [],
  });
  expect(result.success).toBe(false);
});

it('[B9] accepts a saved-list reply with an array of entries', () => {
  const result = WireReplySchema.safeParse({
    ok: true,
    type: 'saved-list',
    entries: [
      {
        word: 'bank',
        status: 'learning',
        savedAt: 1,
        senses: [{ definition: 'd', translation: '', sentence: 's', url: 'u', title: 't' }],
      },
    ],
  });
  expect(result.success).toBe(true);
});

it('[B9] accepts a backup-imported reply with counts', () => {
  const result = WireReplySchema.safeParse({
    ok: true,
    type: 'backup-imported',
    savedWordsImported: 2,
    historyImported: 0,
  });
  expect(result.success).toBe(true);
});
```

Run: `cd packages/app && bunx vitest run test/wire-schema.test.ts`
Expected: failures — the two new message types and reply variants don't parse (schemas don't
exist yet).

- [ ] **Step 2: Implement the wire schema.** In `packages/app/src/wire.ts`:
  1. Add the two non-strict Import\* schemas right after the existing strict
     `SavedWordEntrySchema` (currently ending at line 93):

```ts
// B9: non-strict on purpose (NOT z.strictObject, unlike every other wire schema in this file) —
// CONTRACTS §3/E2 promises "importers ignore unknown future fields." A backup file written by a
// future extension version may carry additive fields this version's code has never heard of; a
// strict schema would reject the ENTIRE entry (and thus the whole array) instead of simply not
// preserving the field it doesn't recognise. See the design spec §3.5 for the full rationale —
// do not "fix" this back to strict.
const ImportSavedWordSenseSchema = z.object({
  definition: z.string(),
  translation: z.string(),
  sentence: z.string(),
  url: z.string(),
  title: z.string(),
});
const ImportSavedWordEntrySchema = z.object({
  word: z.string(),
  status: z.enum(['learning', 'known']),
  savedAt: z.number(),
  senses: z.array(ImportSavedWordSenseSchema),
});
const ImportHistoryEntrySchema = z.object({
  id: z.string(),
  word: z.string(),
  context: z.string(),
  result: z.object({
    markdown: z.string(),
    word: z.string(),
    target: z.string(),
    model: z.string().min(1),
    fromCache: z.boolean(),
    fetchedAt: z.number(),
  }),
  createdAt: z.number(),
});
```

2. Add two arms to `WireMessageSchema`'s array (right after the existing `saved.setStatus` arm,
   currently ending at line 127):

```ts
// B9: list every saved word — backup export's only way to read the full `saved:*` keyspace
// (also the future B6 Words-page's list source; shipped here first because B9 needs it first).
z.object({ type: z.literal('saved.list') }),
// B9: import a backup file's saved words + history into the local keyspaces. Settings import
// happens entirely client-side in the options page — never touches the wire — so this message
// never carries a settings payload, and (S1) never a key.
z.object({
  type: z.literal('backup.import'),
  mode: z.enum(['merge', 'replace']),
  savedWords: z.array(ImportSavedWordEntrySchema),
  history: z.array(ImportHistoryEntrySchema),
}),
```

3. Add `'saved.list'` and `'backup.import'` to `MessageTypeEnum`'s array (currently lines
   143-158).

4. Add two variants to `WireReplySchema`'s union (right after the existing `saved` variant,
   currently at line 175):

```ts
z.object({
  ok: z.literal(true),
  type: z.literal('saved-list'),
  entries: z.array(SavedWordEntrySchema),
}),
z.object({
  ok: z.literal(true),
  type: z.literal('backup-imported'),
  savedWordsImported: z.number(),
  historyImported: z.number(),
}),
```

5. Extend the `AssertEqual` drift-guard tuple (currently `wire.ts:202-209`) with two more
   entries (both `true`), importing nothing new — `SavedWordEntry`/`HistoryEntry` are already
   imported at the top of the file:

```ts
  AssertEqual<z.infer<typeof ImportSavedWordEntrySchema>, SavedWordEntry>,
  AssertEqual<z.infer<typeof ImportHistoryEntrySchema>, HistoryEntry>,
```

     and update the `_checks` array literal from 5 `true` entries to 7.

Run: `cd packages/app && bunx vitest run test/wire-schema.test.ts`
Expected: all tests pass (existing + 7 new).

- [ ] **Step 3: Write the failing router tests.** Append to `packages/app/test/app/router.test.ts`,
      inside the `describe('buildRouter', ...)` block:

```ts
it('saved.list returns every saved word', async () => {
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
  const reply = await route({ type: 'saved.list' });
  expect(reply).toMatchObject({ ok: true, type: 'saved-list' });
  if (reply === SUPPRESS || !reply.ok || reply.type !== 'saved-list') throw new Error('unexpected');
  expect(reply.entries.map((e) => e.word)).toEqual(['bank']);
});

it('backup.import merge adds a new saved word and a new history entry', async () => {
  const d = deps();
  const route = buildRouter(d);
  const reply = await route({
    type: 'backup.import',
    mode: 'merge',
    savedWords: [
      {
        word: 'imported',
        status: 'learning',
        savedAt: 1,
        senses: [{ definition: 'd', translation: '', sentence: 's', url: 'u', title: 't' }],
      },
    ],
    history: [
      {
        id: 'h1',
        word: 'imported',
        context: '',
        createdAt: 1,
        result: {
          markdown: '',
          word: 'imported',
          target: 'vi',
          model: 'gemini-2.5-flash',
          fromCache: false,
          fetchedAt: 1,
        },
      },
    ],
  });
  expect(reply).toEqual({
    ok: true,
    type: 'backup-imported',
    savedWordsImported: 1,
    historyImported: 1,
  });
});

it('backup.import replace clears a pre-existing saved word not present in the import', async () => {
  const d = deps();
  const route = buildRouter(d);
  await route({
    type: 'saved.save',
    word: 'stale',
    definition: 'd',
    translation: '',
    sentence: 's',
    url: 'u',
    title: 't',
  });
  await route({ type: 'backup.import', mode: 'replace', savedWords: [], history: [] });
  const reply = await route({ type: 'saved.list' });
  if (reply === SUPPRESS || !reply.ok || reply.type !== 'saved-list') throw new Error('unexpected');
  expect(reply.entries).toEqual([]);
});
```

Run: `cd packages/app && bunx vitest run test/app/router.test.ts`
Expected: failures — `saved.list`/`backup.import` cases don't exist in the router's switch yet.

- [ ] **Step 4: Implement the router cases.** In `packages/app/src/app/router.ts`:
  1. Add `importBackup` to the import block at the top of the file (alongside
     `savedWordUpsert, savedWordDelete, savedWordSetStatus,`):

```ts
  importBackup,
```

     (imported from `'../index'`, same as every other domain function this file already imports —
     the barrel re-exports `domain/backup-policy` after Task 2's barrel line is added; see step 6
     below).

2. Add two cases to the exhaustive `switch (msg.type)` (right after the existing
   `'saved.setStatus'` case, currently ending at line 266):

```ts
      case 'saved.list': {
        const entries = await savedWordsList({ storage: deps.kv });
        return { ok: true, type: 'saved-list', entries };
      }
      case 'backup.import': {
        const result = await deps.queue.run(() =>
          importBackup({ storage: deps.kv }, msg.savedWords, msg.history, msg.mode),
        );
        return {
          ok: true,
          type: 'backup-imported',
          savedWordsImported: result.savedWordsImported,
          historyImported: result.historyImported,
        };
      }
```

     `savedWordsList` is already imported at the top of this file (`router.ts:13`) but never
     called until now.

3. In `packages/app/src/index.ts`, add (anywhere among the existing `export *` lines — placing
   it next to the other `domain/*` lines keeps the barrel organized):

```ts
export * from './domain/backup-policy';
export * from './app/backup';
```

Run: `cd packages/app && bunx vitest run test/app/router.test.ts`
Expected: all tests pass (existing + 3 new).

- [ ] **Step 5: Full-package check.**

```
cd packages/app && bun run typecheck && bunx vitest run
```

Expected: clean typecheck; full `@ai-dict/app` suite green.

- [ ] **Step 6: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

```
git add packages/app/src/wire.ts packages/app/src/app/router.ts packages/app/src/index.ts \
  packages/app/test/wire-schema.test.ts packages/app/test/app/router.test.ts
git commit -m "[B9BackupRestore] feat: add saved.list + backup.import wire message and router cases (B9)"
```

---

### Task 5: `settings-form.ts` — "Backup & restore" section + events

**Files:**

- Modify: `packages/app/src/ui/settings-form.ts`
- Modify: `packages/app/test/ui/settings-form.test.ts`

**Interfaces:**

```ts
export interface BackupImportRequest {
  mode: 'merge' | 'replace';
  file: File;
}
// New DOM events:
// dispatchEvent(new CustomEvent('backup-export', { bubbles: true, composed: true }))
// dispatchEvent(new CustomEvent<BackupImportRequest>('backup-import', { detail, bubbles: true, composed: true }))
```

- [ ] **Step 1: Write the failing tests.** In `packages/app/test/ui/settings-form.test.ts`:
  1. **Update** the existing sections test (currently `settings-form.test.ts:554-565`):

```ts
it('groups controls into Connection, Translation, Appearance, Privacy & data, and Backup & restore sections', () => {
  const el = mountForm();
  const heads = [...el.shadowRoot!.querySelectorAll('.sec .sec-h')].map((h) => h.textContent);
  expect(heads).toEqual([
    'Connection',
    'Translation',
    'Developer mode',
    'Appearance',
    'Privacy & data',
    'Backup & restore',
  ]);
});
```

2. **Update** the existing required-controls test (currently `settings-form.test.ts:567-589`) to
   add 4 selectors to its list: `'#backup-export'`, `'#backup-import-merge'`,
   `'#backup-import-replace'`, `'#backup-file'`.

3. **Add** a new `describe` block, right after the `describe('<settings-form> sticky save bar +
dirty state (A16)')` block:

```ts
describe('<settings-form> backup & restore (B9)', () => {
  it('clicking Export backup dispatches a composed backup-export event', () => {
    const el = mountForm();
    let event: CustomEvent | undefined;
    document.body.addEventListener('backup-export', (e) => {
      event = e as CustomEvent;
    });
    el.shadowRoot!.querySelector<HTMLButtonElement>('#backup-export')!.click();
    expect(event).toBeDefined();
    expect(event!.composed).toBe(true);
  });

  it('clicking Import (merge) opens the file picker with no confirm prompt', () => {
    const el = mountForm();
    const confirmSpy = vi.spyOn(window, 'confirm');
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click');
    el.shadowRoot!.querySelector<HTMLButtonElement>('#backup-import-merge')!.click();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
  });

  it('choosing a file after Import (merge) dispatches backup-import with mode "merge"', () => {
    const el = mountForm();
    el.shadowRoot!.querySelector<HTMLButtonElement>('#backup-import-merge')!.click();
    const input = el.shadowRoot!.querySelector<HTMLInputElement>('#backup-file')!;
    const file = new File(['{}'], 'backup.json', { type: 'application/json' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    let captured: BackupImportRequest | undefined;
    document.body.addEventListener('backup-import', (e) => {
      captured = (e as CustomEvent<BackupImportRequest>).detail;
    });
    input.dispatchEvent(new Event('change'));
    expect(captured?.mode).toBe('merge');
    expect(captured?.file).toBe(file);
  });

  it('clicking Import (replace) prompts confirm(); a false answer never opens the file picker', () => {
    const el = mountForm();
    vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click');
    el.shadowRoot!.querySelector<HTMLButtonElement>('#backup-import-replace')!.click();
    expect(clickSpy).not.toHaveBeenCalled();
  });

  it('clicking Import (replace) with a true confirm answer opens the picker and tags mode "replace"', () => {
    const el = mountForm();
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true);
    el.shadowRoot!.querySelector<HTMLButtonElement>('#backup-import-replace')!.click();
    const input = el.shadowRoot!.querySelector<HTMLInputElement>('#backup-file')!;
    const file = new File(['{}'], 'backup.json', { type: 'application/json' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    let captured: BackupImportRequest | undefined;
    document.body.addEventListener('backup-import', (e) => {
      captured = (e as CustomEvent<BackupImportRequest>).detail;
    });
    input.dispatchEvent(new Event('change'));
    expect(captured?.mode).toBe('replace');
  });

  it('the file input resets after change so choosing the same file twice fires backup-import twice', () => {
    const el = mountForm();
    const file = new File(['{}'], 'backup.json', { type: 'application/json' });
    let count = 0;
    document.body.addEventListener('backup-import', () => count++);
    for (let i = 0; i < 2; i++) {
      el.shadowRoot!.querySelector<HTMLButtonElement>('#backup-import-merge')!.click();
      const input = el.shadowRoot!.querySelector<HTMLInputElement>('#backup-file')!;
      Object.defineProperty(input, 'files', { value: [file], configurable: true });
      input.dispatchEvent(new Event('change'));
    }
    expect(count).toBe(2);
  });
});
```

Add `BackupImportRequest` to the file's existing type-only import from `'../../src/ui/settings-form'`.

Run: `cd packages/app && bunx vitest run test/ui/settings-form.test.ts`
Expected: failures — the new markup/ids/method don't exist yet; the 2 updated tests also fail
(new section not present).

- [ ] **Step 2: Implement.** In `packages/app/src/ui/settings-form.ts`:
  1. Add the exported interface right after `SettingsFormValue` (currently ending at line 45):

```ts
export interface BackupImportRequest {
  mode: 'merge' | 'replace';
  file: File;
}
```

2. Add one CSS rule, next to `#tpl-help`/`#envelope-help` (near line 100/130):

```css
#backup-help {
  margin: 0 0 10px;
  font-size: var(--adp-text-xs);
  color: var(--ad-ink-faint);
}
```

3. Insert the new section into `MARKUP`, between the existing "Privacy & data" `</section>`
   (currently line 212) and the `<div class="savebar">` (currently line 213):

```html
<section class="sec" aria-labelledby="sec-backup">
  <h2 class="sec-h" id="sec-backup">Backup &amp; restore</h2>
  <p id="backup-help">
    Save your saved words, history, and settings as one file — everything except your API key.
    Import merges with what's already on this device, or replaces it entirely.
  </p>
  <div class="inline-actions">
    <button type="button" id="backup-export" class="link">Export backup</button>
    <button type="button" id="backup-import-merge">Import (merge)</button>
    <button type="button" id="backup-import-replace">Import (replace)</button>
  </div>
  <input type="file" id="backup-file" accept="application/json" hidden />
</section>
```

4. Add the private field, next to `_dirty` (currently line 248):

```ts
  // B9: which import mode was requested — set just before the hidden file input is opened, read
  // (and cleared) by its 'change' listener.
  private _backupImportMode: 'merge' | 'replace' | null = null;
```

5. Add the wiring inside `connectedCallback`, right after `this.relay('#export',
'export-history');` (currently line 312):

```ts
this.relay('#backup-export', 'backup-export');
this.q<HTMLButtonElement>('#backup-import-merge').addEventListener('click', () =>
  this.startBackupImport('merge'),
);
this.q<HTMLButtonElement>('#backup-import-replace').addEventListener('click', () =>
  this.startBackupImport('replace'),
);
this.q<HTMLInputElement>('#backup-file').addEventListener('change', () => {
  const input = this.q<HTMLInputElement>('#backup-file');
  const file = input.files?.[0];
  input.value = ''; // reset so re-selecting the same file still fires 'change' next time
  const mode = this._backupImportMode;
  this._backupImportMode = null;
  if (!file || !mode) return;
  this.dispatchEvent(
    new CustomEvent<BackupImportRequest>('backup-import', {
      detail: { mode, file },
      bubbles: true,
      composed: true,
    }),
  );
});
```

6. Add the private method, right after `restoreDefaultTemplate` (currently ending at line 537):

```ts
  /**
   * B9: "Import (replace)" is destructive (wipes existing saved words + history before writing
   * the file's contents) — gate it behind a confirm(), mirroring restoreDefaultTemplate's
   * existing confirm-before-destructive-action pattern. "Import (merge)" needs no confirm — it
   * only adds/updates, never deletes.
   */
  private startBackupImport(mode: 'merge' | 'replace'): void {
    if (mode === 'replace') {
      const ok = window.confirm(
        'Replace ALL saved words and history with this backup file? Anything not in the file ' +
          'will be deleted. This cannot be undone.',
      );
      if (!ok) return;
    }
    this._backupImportMode = mode;
    this.q<HTMLInputElement>('#backup-file').click();
  }
```

Run: `cd packages/app && bunx vitest run test/ui/settings-form.test.ts`
Expected: all tests pass (existing, 2 updated, 6 new).

- [ ] **Step 3: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

```
git add packages/app/src/ui/settings-form.ts packages/app/test/ui/settings-form.test.ts
git commit -m "[B9BackupRestore] feat: add Backup & restore section to settings-form (B9)"
```

---

### Task 6: Chrome composition root — `options.ts` wiring

**Files:**

- Modify: `packages/extension-chrome/src/options.ts`

No dedicated unit test exists for `options.ts` in this repo (a composition root, covered by e2e
only — same precedent as C2's `options.ts` edit and B5's). This task's correctness is proven by
Task 8's e2e; still run the typecheck/lint gate below at the end.

- [ ] **Step 1: Implement.** In `packages/extension-chrome/src/options.ts`:
  1. Extend the top `@ai-dict/app` import block to add:

```ts
  buildBackupExport,
  parseBackupFile,
  type BackupImportRequest,
  type SavedWordEntry,
  type HistoryEntry,
```

2. Add two listeners inside `wireSettings(form)`, right after the existing `export-history`
   listener (currently ending at line 176):

```ts
form.addEventListener('backup-export', () => {
  void Promise.all([send({ type: 'saved.list' }), send({ type: 'history.list' }), load()]).then(
    ([savedReply, historyReply, settings]) => {
      if (!savedReply.ok || savedReply.type !== 'saved-list') {
        form.setStatus(savedReply.ok ? 'Unexpected reply' : savedReply.error.message, 'error');
        return;
      }
      if (!historyReply.ok || historyReply.type !== 'history') {
        form.setStatus(historyReply.ok ? 'Unexpected reply' : historyReply.error.message, 'error');
        return;
      }
      const { filename, json } = buildBackupExport(
        savedReply.entries,
        historyReply.entries,
        settings,
        () => Date.now(),
      );
      download(filename, json);
      form.setStatus(
        `Exported ${savedReply.entries.length} saved words and ${historyReply.entries.length} history entries`,
      );
    },
    () => form.setStatus('Could not export backup', 'error'),
  );
});

form.addEventListener('backup-import', (e) => {
  const { mode, file } = (e as CustomEvent<BackupImportRequest>).detail;
  void file
    .text()
    .then((text) => {
      const parsed = parseBackupFile(text);
      if (!parsed.ok) {
        form.setStatus(parsed.error, 'error');
        return;
      }
      form.setStatus('Importing…');
      void send({
        type: 'backup.import',
        mode,
        savedWords: parsed.savedWords as SavedWordEntry[],
        history: parsed.history as HistoryEntry[],
      }).then(
        (r) => {
          if (!r.ok || r.type !== 'backup-imported') {
            form.setStatus(r.ok ? 'Unexpected reply' : r.error.message, 'error');
            return;
          }
          const s = parsed.settings;
          void load()
            .then((cur) =>
              chrome.storage.local.set({
                settings: {
                  ...cur,
                  ...(s.targetLang !== undefined ? { targetLang: s.targetLang } : {}),
                  ...(s.outputFormat !== undefined ? { outputFormat: s.outputFormat } : {}),
                  ...(s.promptEnvelope !== undefined ? { promptEnvelope: s.promptEnvelope } : {}),
                  ...(s.theme !== undefined ? { theme: s.theme } : {}),
                  ...(s.cacheEnabled !== undefined ? { cacheEnabled: s.cacheEnabled } : {}),
                  ...(s.saveHistory !== undefined ? { saveHistory: s.saveHistory } : {}),
                  ...(s.provider !== undefined ? { provider: s.provider } : {}),
                },
              }),
            )
            .then(load)
            .then((fresh) =>
              mountSettings(
                fresh,
                `Imported ${r.savedWordsImported} saved words and ${r.historyImported} history entries`,
              ),
            );
        },
        () => form.setStatus('Could not import backup', 'error'),
      );
    })
    .catch(() => form.setStatus('Could not read the selected file', 'error'));
});
```

     `theme` in `chrome.storage.local`'s stored settings object is typed as `Theme`
     (`'sepia'|'dark'|'contrast'|'system'`) while `BackupSettings.theme` is a plain `string`
     (§3.1/§4.4 of the design spec — kept loose so `app/backup.ts` has no dependency on
     `domain/types.ts`'s `Theme` union); cast `s.theme as Theme` in the spread if `tsc` flags it
     (import `type { Theme }` alongside the other new types above).

Run: `cd packages/extension-chrome && bun run typecheck`
Expected: clean (no type errors).

- [ ] **Step 2: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd ../extension-chrome && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

```
git add packages/extension-chrome/src/options.ts
git commit -m "[B9BackupRestore] feat: wire Backup & restore export/import in Chrome options page (B9)"
```

---

### Task 7: Safari composition root — mirror the wiring

**Files:**

- Modify: `packages/extension-safari/src/options.ts`

No e2e harness exists for `extension-safari` (`REPO-FACTS.md` §1: "thinner shell; no e2e/") — this
task is verified by typecheck + lint + a manual read-through confirming the code mirrors Task 6
exactly (same precedent as the already-shipped `export-history` listener, which is likewise
untested beyond typecheck on the Safari side).

- [ ] **Step 1: Implement.** In `packages/extension-safari/src/options.ts`:
  1. Extend the top `@ai-dict/app` import block (currently lines 1-10) to add:

```ts
  buildBackupExport,
  parseBackupFile,
  type BackupImportRequest,
  type SavedWordEntry,
  type HistoryEntry,
  type Theme,
```

2. Add two listeners at the top level (mirroring the existing `form.addEventListener(
'export-history', ...)` block, currently ending at line 112), replacing `chrome.*` with
   `browser.*` and using the file's own `load()`/`send()`/`download()` helpers (already defined
   at lines 29-54):

```ts
form.addEventListener('backup-export', () => {
  void Promise.all([send({ type: 'saved.list' }), send({ type: 'history.list' }), load()]).then(
    ([savedReply, historyReply, settings]) => {
      if (!savedReply.ok || savedReply.type !== 'saved-list') {
        form.setStatus(savedReply.ok ? 'Unexpected reply' : savedReply.error.message, 'error');
        return;
      }
      if (!historyReply.ok || historyReply.type !== 'history') {
        form.setStatus(historyReply.ok ? 'Unexpected reply' : historyReply.error.message, 'error');
        return;
      }
      const { filename, json } = buildBackupExport(
        savedReply.entries,
        historyReply.entries,
        settings,
        () => Date.now(),
      );
      download(filename, json);
      form.setStatus(
        `Exported ${savedReply.entries.length} saved words and ${historyReply.entries.length} history entries`,
      );
    },
    () => form.setStatus('Could not export backup', 'error'),
  );
});

form.addEventListener('backup-import', (e) => {
  const { mode, file } = (e as CustomEvent<BackupImportRequest>).detail;
  void file
    .text()
    .then((text) => {
      const parsed = parseBackupFile(text);
      if (!parsed.ok) {
        form.setStatus(parsed.error, 'error');
        return;
      }
      form.setStatus('Importing…');
      void send({
        type: 'backup.import',
        mode,
        savedWords: parsed.savedWords as SavedWordEntry[],
        history: parsed.history as HistoryEntry[],
      }).then(
        (r) => {
          if (!r.ok || r.type !== 'backup-imported') {
            form.setStatus(r.ok ? 'Unexpected reply' : r.error.message, 'error');
            return;
          }
          const s = parsed.settings;
          void load()
            .then((cur) =>
              browser.storage.local.set({
                settings: {
                  ...cur,
                  ...(s.targetLang !== undefined ? { targetLang: s.targetLang } : {}),
                  ...(s.outputFormat !== undefined ? { outputFormat: s.outputFormat } : {}),
                  ...(s.promptEnvelope !== undefined ? { promptEnvelope: s.promptEnvelope } : {}),
                  ...(s.theme !== undefined ? { theme: s.theme as Theme } : {}),
                  ...(s.cacheEnabled !== undefined ? { cacheEnabled: s.cacheEnabled } : {}),
                  ...(s.saveHistory !== undefined ? { saveHistory: s.saveHistory } : {}),
                  ...(s.provider !== undefined ? { provider: s.provider } : {}),
                },
              }),
            )
            .then(load)
            .then((fresh) => {
              (form as unknown as HTMLElement).setAttribute('data-ad-theme', fresh.theme);
              (form as unknown as { value: Settings }).value = fresh;
              form.setStatus(
                `Imported ${r.savedWordsImported} saved words and ${r.historyImported} history entries`,
              );
            });
        },
        () => form.setStatus('Could not import backup', 'error'),
      );
    })
    .catch(() => form.setStatus('Could not read the selected file', 'error'));
});
```

     (Safari's `options.ts` has no `mountOnboarding`/`mountSettings` split — confirmed by reading
     the file in full: it always mounts one `<settings-form>` — so the success path re-hydrates
     the existing form via its `value` setter instead of remounting, matching this file's own
     `save` listener pattern at lines 56-70.)

Run: `cd packages/extension-safari && bun run typecheck`
Expected: clean (no type errors).

- [ ] **Step 2: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd ../extension-safari && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

```
git add packages/extension-safari/src/options.ts
git commit -m "[B9BackupRestore] feat: mirror Backup & restore wiring into Safari options page (B9)"
```

---

### Task 8: e2e coverage — new `b9-backup-restore.spec.ts`

**Files:**

- Create: `packages/extension-chrome/e2e/b9-backup-restore.spec.ts`

- [ ] **Step 1: Write the spec.** Create `packages/extension-chrome/e2e/b9-backup-restore.spec.ts`:

```ts
import { test, expect } from './fixtures';
import { seedSettings, storageDump } from './helpers';

const status = 'settings-form #status';

function seedOneSavedWord(word: string, savedAt: number) {
  return {
    [`saved:${word}`]: JSON.stringify({
      word,
      status: 'learning',
      savedAt,
      senses: [{ definition: 'd', translation: '', sentence: 's', url: 'u', title: 't' }],
    }),
    'saved:index': JSON.stringify([word]),
  };
}

function seedOneHistoryEntry(id: string, createdAt: number) {
  return {
    [`history:${id}`]: JSON.stringify({
      id,
      word: id,
      context: '',
      createdAt,
      result: {
        markdown: '',
        word: id,
        target: 'vi',
        model: 'gemini-2.5-flash',
        fromCache: false,
        fetchedAt: createdAt,
      },
    }),
    'history:index': JSON.stringify([id]),
  };
}

test('Export backup downloads ai-dict-backup.json matching the E2 envelope, never containing the key', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page, { apiKey: 'AIza-should-never-appear' });
  await page.evaluate((data) => chrome.storage.local.set(data), {
    ...seedOneSavedWord('bank', 1000),
    ...seedOneHistoryEntry('h1', 2000),
  });
  await page.reload();
  await page.waitForSelector('settings-form');

  const downloadPromise = page.waitForEvent('download');
  await page.locator('settings-form #backup-export').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('ai-dict-backup.json');

  const file = await download.path();
  const raw = await import('node:fs').then((fs) => fs.readFileSync(file, 'utf8'));
  const parsed = JSON.parse(raw) as {
    format: string;
    version: number;
    data: { savedWords: { word: string }[]; history: { id: string }[] };
  };
  expect(parsed.format).toBe('ai-dict-backup');
  expect(parsed.version).toBe(1);
  expect(parsed.data.savedWords).toHaveLength(1);
  expect(parsed.data.savedWords[0]!.word).toBe('bank');
  expect(parsed.data.history).toHaveLength(1);
  expect(raw).not.toContain('AIza-should-never-appear');
  expect(raw).not.toContain('"apiKey"');
  await expect(page.locator(status)).toContainText('Exported 1 saved words and 1 history entries');
});

test('Import (merge) adds new entries without deleting existing ones', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page);
  await page.evaluate((data) => chrome.storage.local.set(data), seedOneSavedWord('existing', 1));
  await page.reload();
  await page.waitForSelector('settings-form');

  const backupJson = JSON.stringify({
    format: 'ai-dict-backup',
    version: 1,
    exportedAt: 1,
    data: {
      savedWords: [
        {
          word: 'imported',
          status: 'learning',
          savedAt: 2,
          senses: [{ definition: 'd', translation: '', sentence: 's', url: 'u', title: 't' }],
        },
      ],
      history: [],
      settings: {},
    },
  });

  await page.locator('settings-form #backup-import-merge').click();
  await page
    .locator('settings-form')
    .locator('#backup-file')
    .setInputFiles({
      name: 'backup.json',
      mimeType: 'application/json',
      buffer: Buffer.from(backupJson),
    });

  await expect(page.locator(status)).toContainText('Imported 1 saved words and 0 history entries');
  const dump = await storageDump(page);
  expect(dump['saved:existing']).toBeDefined();
  expect(dump['saved:imported']).toBeDefined();
});

test('Import (replace) wipes pre-existing data not present in the file', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page);
  await page.evaluate((data) => chrome.storage.local.set(data), seedOneSavedWord('stale', 1));
  await page.reload();
  await page.waitForSelector('settings-form');

  const backupJson = JSON.stringify({
    format: 'ai-dict-backup',
    version: 1,
    exportedAt: 1,
    data: {
      savedWords: [
        {
          word: 'fresh',
          status: 'learning',
          savedAt: 2,
          senses: [{ definition: 'd', translation: '', sentence: 's', url: 'u', title: 't' }],
        },
      ],
      history: [],
      settings: {},
    },
  });

  page.once('dialog', (d) => d.accept());
  await page.locator('settings-form #backup-import-replace').click();
  await page
    .locator('settings-form')
    .locator('#backup-file')
    .setInputFiles({
      name: 'backup.json',
      mimeType: 'application/json',
      buffer: Buffer.from(backupJson),
    });

  await expect(page.locator(status)).toContainText('Imported 1 saved words and 0 history entries');
  const dump = await storageDump(page);
  expect(dump['saved:stale']).toBeUndefined();
  expect(dump['saved:fresh']).toBeDefined();
});

test('A newer-version backup file is rejected client-side; storage is untouched', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page);
  await page.reload();
  await page.waitForSelector('settings-form');
  const before = await storageDump(page);

  const futureJson = JSON.stringify({ format: 'ai-dict-backup', version: 2, data: {} });
  await page.locator('settings-form #backup-import-merge').click();
  await page
    .locator('settings-form')
    .locator('#backup-file')
    .setInputFiles({
      name: 'backup.json',
      mimeType: 'application/json',
      buffer: Buffer.from(futureJson),
    });

  await expect(page.locator(status)).toContainText('newer version of AI Dictionary');
  const after = await storageDump(page);
  expect(after).toEqual(before);
});

test('The existing stored key survives an import (S1)', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page, { apiKey: 'AIza-existing' });
  await page.reload();
  await page.waitForSelector('settings-form');

  const backupJson = JSON.stringify({
    format: 'ai-dict-backup',
    version: 1,
    exportedAt: 1,
    data: { savedWords: [], history: [], settings: { targetLang: 'en' } },
  });

  await page.locator('settings-form #backup-import-merge').click();
  await page
    .locator('settings-form')
    .locator('#backup-file')
    .setInputFiles({
      name: 'backup.json',
      mimeType: 'application/json',
      buffer: Buffer.from(backupJson),
    });

  await expect(page.locator(status)).toContainText('Imported 0 saved words and 0 history entries');
  const dump = await storageDump(page);
  const settings = JSON.parse(dump['settings'] as string) as { apiKey: string; targetLang: string };
  expect(settings.apiKey).toBe('AIza-existing');
  expect(settings.targetLang).toBe('en'); // the non-secret field DID apply
});
```

Run:

```
GEMINI_API_KEY= bun run build:chrome
cd packages/extension-chrome && bunx playwright test b9-backup-restore
```

Expected: 5 passed.

- [ ] **Step 2: Commit** — gate, then commit:

```
GEMINI_API_KEY= bun run build:chrome
bun run lint && bun run format:check
```

```
git add packages/extension-chrome/e2e/b9-backup-restore.spec.ts
git commit -m "[B9BackupRestore] feat: e2e coverage for backup export/import/merge/replace (B9)"
```

---

### Task 9: final gates + C3 note + PR

**Files:** none (verification + PR only).

- [ ] **Step 1: Run every gate.**

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
cd packages/extension-chrome && bunx playwright test b9-backup-restore options-actions
```

Expected: typecheck clean on all three packages; the full Vitest suite green (including every new
test file/case from Tasks 1-5); lint/format clean; both builds succeed; `b9-backup-restore.spec.ts`
(5 passed) and `options-actions.spec.ts` (regression guard for the Chrome options page this card's
Task 6 shares a file with) both pass.

- [ ] **Step 2: C3 note.** This card adds new files inside the existing `c3-1 app`, `c3-2
extension-chrome`, and `c3-3 extension-safari` components (no new component, no new ref/
      rule) — per this repo's `.c3/`-is-CLI-only convention, no hand-edit is made; if a future
      session runs `c3 sweep` or `c3 audit` over this diff, the new files
      (`domain/backup-policy.ts`, `app/backup.ts`) should be attributed to `c3-1 app` and the two
      new wire arms to `c3-103 wire-protocol`/`c3-111 lookup-router`'s existing entities — no new
      C3 change-unit is required to open this PR.

- [ ] **Step 3: Open the PR.** Regular merge (no squash — owner ruling 2026-07-16). Title:
      `[B9BackupRestore] Backup & restore`. Body includes:

```
## Description
Adds a "Backup & restore" section to Settings: export saved words + history + non-secret
settings as one versioned JSON file (the E2 envelope), and import it elsewhere with a
merge-or-replace choice for saved words/history (settings always fully re-apply; the API key
is never exported and never touched by import).

## Design choices
- Two new wire messages, saved.list + backup.import, added as one task (exhaustive switch).
- backup.import's inner entry schemas are deliberately non-strict (not this file's usual
  z.strictObject) so a future version's additive fields are ignored, not rejected — see the
  design spec §3.5.
- Settings import always fully replaces the 7 non-secret fields, independent of the
  merge/replace choice, which governs only saved words + history.

## Testing performed
- Unit: `bun run test` — full suite green, including new/updated files:
  saved-words-policy.test.ts, history-policy.test.ts, backup-policy.test.ts (new),
  app/backup.test.ts (new), app/wire-schema.test.ts, app/router.test.ts, ui/settings-form.test.ts.
- e2e: packages/extension-chrome/e2e/b9-backup-restore.spec.ts — 5 scenarios (export shape + S1,
  merge, replace, future-version rejection, key survives import) — all passing, plus the
  options-actions.spec.ts regression guard.
- Gates: typecheck (app, extension-chrome, extension-safari), lint, format:check,
  build:chrome (env-cleared), build:safari — all green.

## JIRA ticket
* https://prospa.atlassian.net/browse/B9BackupRestore
```

      (Jira ticket ID follows the branch-suffix convention — `feature/B9BackupRestore` →
      `B9BackupRestore` — per this worktree's git-conventions rule; substitute the real ticket ID
      if a different one exists in the roadmap-campaign's tracking system.)
