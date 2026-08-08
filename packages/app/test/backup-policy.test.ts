import { describe, it, expect } from 'vitest';
import { importBackup } from '../src/domain/backup-policy';
import { savedWordUpsert, savedWordsList } from '../src/domain/saved-words-policy';
import { historyAppend, historyList, historyListSince } from '../src/domain/history-policy';
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

  it('reorders history:index newest-first when a local entry is newer than an imported one', async () => {
    // Bug repro: local entry 'X' (createdAt 5000) already exists; the import brings in an older
    // entry '1' (createdAt 1000). historyAppend's unconditional prepend would land '1' ahead of
    // 'X', breaking the newest-first invariant historyListSince relies on.
    const s = memStorage();
    await historyAppend({ storage: s }, historyEntry('X', 5000));
    await importBackup({ storage: s }, [], [historyEntry('1', 1000)], 'merge');
    const { entries } = await historyList({ storage: s }, {});
    expect(entries.map((e) => e.id)).toEqual(['X', '1']);
    expect((await historyListSince({ storage: s }, 4000)).map((e) => e.id)).toEqual(['X']);
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
