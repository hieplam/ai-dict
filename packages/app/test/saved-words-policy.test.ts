import { describe, it, expect } from 'vitest';
import {
  savedWordUpsert,
  savedWordDelete,
  savedWordGet,
  savedWordsList,
  savedWordsClear,
  normalizeWordKey,
} from '../src/domain/saved-words-policy';
import type { Storage, SavedWordInput } from '../src';

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

const input = (word: string, overrides: Partial<SavedWordInput> = {}): SavedWordInput => ({
  word,
  definition: `${word} definition`,
  translation: '',
  sentence: `a sentence with ${word}`,
  url: 'https://example.com/article',
  title: 'Example Article',
  ...overrides,
});

describe('saved-words-policy', () => {
  it('normalizeWordKey trims and lowercases', () => {
    expect(normalizeWordKey('  Bank ')).toBe('bank');
  });

  it('upsert creates a new entry: status learning, savedAt = now(), one sense', async () => {
    const s = memStorage();
    const entry = await savedWordUpsert({ storage: s, now: () => 1000 }, input('Serendipity'));
    expect(entry).toEqual({
      word: 'Serendipity',
      status: 'learning',
      savedAt: 1000,
      senses: [
        {
          definition: 'Serendipity definition',
          translation: '',
          sentence: 'a sentence with Serendipity',
          url: 'https://example.com/article',
          title: 'Example Article',
        },
      ],
    });
    expect(await s.getItem('saved:serendipity')).toBe(JSON.stringify(entry));
  });

  it('upsert on an existing (case-insensitive) word preserves savedAt/status, replaces senses', async () => {
    const s = memStorage();
    await savedWordUpsert({ storage: s, now: () => 1000 }, input('Bank', { definition: 'first' }));
    const second = await savedWordUpsert(
      { storage: s, now: () => 2000 },
      input('bank', { definition: 'second' }),
    );
    expect(second.savedAt).toBe(1000); // preserved from the first save
    expect(second.status).toBe('learning');
    expect(second.senses).toHaveLength(1);
    expect(second.senses[0]!.definition).toBe('second'); // replaced, not accumulated (B14's job)
    expect(second.word).toBe('bank'); // latest casing wins for display
  });

  it('upsert preserves a manually-set status (e.g. known) across a re-save', async () => {
    const s = memStorage();
    await savedWordUpsert({ storage: s, now: () => 1000 }, input('bank'));
    // Simulate a future B5 marking it known directly in storage (no B5 UI exists yet).
    const stored = JSON.parse((await s.getItem('saved:bank'))!) as { status: string };
    stored.status = 'known';
    await s.setItem('saved:bank', JSON.stringify(stored));
    const again = await savedWordUpsert({ storage: s, now: () => 3000 }, input('bank'));
    expect(again.status).toBe('known');
  });

  it('savedWordGet returns the stored entry (case-insensitively), or null on miss', async () => {
    const s = memStorage();
    await savedWordUpsert({ storage: s, now: () => 1000 }, input('bank'));
    expect(await savedWordGet({ storage: s }, 'BANK')).not.toBeNull();
    expect(await savedWordGet({ storage: s }, 'ghost')).toBeNull();
  });

  it('savedWordDelete removes the entry and its index id; idempotent on unknown word', async () => {
    const s = memStorage();
    await savedWordUpsert({ storage: s, now: () => 1000 }, input('bank'));
    await savedWordDelete({ storage: s }, 'BANK');
    expect(await s.getItem('saved:bank')).toBeNull();
    expect(await savedWordsList({ storage: s })).toEqual([]);
    await expect(savedWordDelete({ storage: s }, 'ghost')).resolves.toBeUndefined();
  });

  it('savedWordsList returns every saved entry', async () => {
    const s = memStorage();
    await savedWordUpsert({ storage: s, now: () => 1000 }, input('bank'));
    await savedWordUpsert({ storage: s, now: () => 2000 }, input('river'));
    const list = await savedWordsList({ storage: s });
    expect(list.map((e) => e.word).sort()).toEqual(['bank', 'river']);
  });

  it('savedWordsClear removes all saved:* keys and nothing else (scope fence)', async () => {
    const s = memStorage();
    await savedWordUpsert({ storage: s, now: () => 1000 }, input('bank'));
    await s.setItem('history:x', '{}'); // unrelated keyspace must survive
    await savedWordsClear({ storage: s });
    expect(await savedWordsList({ storage: s })).toEqual([]);
    expect(await s.getItem('history:x')).toBe('{}');
  });
});
