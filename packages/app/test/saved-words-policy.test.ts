import { describe, it, expect } from 'vitest';
import {
  savedWordUpsert,
  savedWordDelete,
  savedWordGet,
  savedWordsList,
  savedWordsClear,
  savedWordSetStatus,
  savedWordSetRelated,
  savedWordImport,
  normalizeWordKey,
} from '../src/domain/saved-words-policy';
import type { Storage, SavedWordInput, SavedWordEntry, SavedWordsDeps } from '../src';

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

/** Test helper: call savedWordUpsert and unwrap the 'saved' branch, failing loudly if the call
 * instead returned a B14 conflict — every pre-B14 test path expects an outright write. */
async function upsertOk(
  deps: SavedWordsDeps,
  in_: SavedWordInput,
  opts?: { confirmNewSense?: boolean },
): Promise<SavedWordEntry> {
  const result = await savedWordUpsert(deps, in_, opts);
  if (result.kind !== 'saved') throw new Error(`expected 'saved', got '${result.kind}'`);
  return result.entry;
}

describe('saved-words-policy', () => {
  it('normalizeWordKey trims and lowercases', () => {
    expect(normalizeWordKey('  Bank ')).toBe('bank');
  });

  it('upsert creates a new entry: status learning, savedAt = now(), one sense', async () => {
    const s = memStorage();
    const entry = await upsertOk({ storage: s, now: () => 1000 }, input('Serendipity'));
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

  it('upsert preserves a manually-set status (e.g. known) across an exact-duplicate re-save', async () => {
    const s = memStorage();
    await upsertOk({ storage: s, now: () => 1000 }, input('bank'));
    // Simulate a future B5 marking it known directly in storage (no B5 UI exists yet).
    const stored = JSON.parse((await s.getItem('saved:bank'))!) as { status: string };
    stored.status = 'known';
    await s.setItem('saved:bank', JSON.stringify(stored));
    // Same word, same sentence/url as the first save (input()'s defaults) — an exact-duplicate
    // no-op, not a conflict, so this still returns 'saved' with the preserved status.
    const again = await upsertOk({ storage: s, now: () => 3000 }, input('bank'));
    expect(again.status).toBe('known');
  });

  it('B14: a second upsert for the same word with a DIFFERENT sentence/url returns a conflict and writes nothing', async () => {
    const s = memStorage();
    await upsertOk({ storage: s, now: () => 1000 }, input('Bank', { definition: 'first' }));
    const before = await s.getItem('saved:bank');
    const result = await savedWordUpsert(
      { storage: s, now: () => 2000 },
      input('bank', {
        definition: 'second',
        sentence: 'a different sentence',
        url: 'https://other.example/',
      }),
    );
    expect(result).toEqual({ kind: 'conflict', senseCount: 1 });
    expect(await s.getItem('saved:bank')).toBe(before); // byte-identical — no write happened
  });

  it('B14: confirmNewSense:true appends a new sense, preserving savedAt/status, updating word casing', async () => {
    const s = memStorage();
    await upsertOk({ storage: s, now: () => 1000 }, input('Bank', { definition: 'first def' }));
    const entry = await upsertOk(
      { storage: s, now: () => 2000 },
      input('bank', {
        definition: 'second def',
        sentence: 'a different sentence',
        url: 'https://other.example/',
      }),
      { confirmNewSense: true },
    );
    expect(entry.savedAt).toBe(1000); // preserved from the first save
    expect(entry.status).toBe('learning');
    expect(entry.word).toBe('bank'); // latest casing wins for display
    expect(entry.senses).toHaveLength(2);
    expect(entry.senses[0]!.definition).toBe('first def'); // original sense untouched
    expect(entry.senses[1]!.definition).toBe('second def'); // appended, not replaced
  });

  it('B14: an exact sentence+url repeat is a silent no-op (kind:saved, unchanged entry, no write)', async () => {
    const s = memStorage();
    const first = await upsertOk(
      { storage: s, now: () => 1000 },
      input('bank', { definition: 'first' }),
    );
    const before = await s.getItem('saved:bank');
    const result = await savedWordUpsert(
      { storage: s, now: () => 2000 },
      input('bank', { definition: 'second' }),
    );
    expect(result).toEqual({ kind: 'saved', entry: first });
    expect(await s.getItem('saved:bank')).toBe(before); // byte-identical — no write happened
  });

  it('B14: a THIRD upsert after a decline (no confirmNewSense) still offers the conflict again, never accumulates silently', async () => {
    const s = memStorage();
    await upsertOk({ storage: s, now: () => 1000 }, input('bank'));
    const declined = await savedWordUpsert(
      { storage: s, now: () => 2000 },
      input('bank', { sentence: 'second sentence', url: 'https://second.example/' }),
    );
    expect(declined).toEqual({ kind: 'conflict', senseCount: 1 });
    const declinedAgain = await savedWordUpsert(
      { storage: s, now: () => 3000 },
      input('bank', { sentence: 'second sentence', url: 'https://second.example/' }),
    );
    expect(declinedAgain).toEqual({ kind: 'conflict', senseCount: 1 }); // still 1 — nothing was ever written
  });

  it('savedWordGet returns the stored entry (case-insensitively), or null on miss', async () => {
    const s = memStorage();
    await upsertOk({ storage: s, now: () => 1000 }, input('bank'));
    expect(await savedWordGet({ storage: s }, 'BANK')).not.toBeNull();
    expect(await savedWordGet({ storage: s }, 'ghost')).toBeNull();
  });

  it('savedWordDelete removes the entry and its index id; idempotent on unknown word', async () => {
    const s = memStorage();
    await upsertOk({ storage: s, now: () => 1000 }, input('bank'));
    await savedWordDelete({ storage: s }, 'BANK');
    expect(await s.getItem('saved:bank')).toBeNull();
    expect(await savedWordsList({ storage: s })).toEqual([]);
    await expect(savedWordDelete({ storage: s }, 'ghost')).resolves.toBeUndefined();
  });

  it('savedWordsList returns every saved entry', async () => {
    const s = memStorage();
    await upsertOk({ storage: s, now: () => 1000 }, input('bank'));
    await upsertOk({ storage: s, now: () => 2000 }, input('river'));
    const list = await savedWordsList({ storage: s });
    expect(list.map((e) => e.word).sort()).toEqual(['bank', 'river']);
  });

  it('savedWordsClear removes all saved:* keys and nothing else (scope fence)', async () => {
    const s = memStorage();
    await upsertOk({ storage: s, now: () => 1000 }, input('bank'));
    await s.setItem('history:x', '{}'); // unrelated keyspace must survive
    await savedWordsClear({ storage: s });
    expect(await savedWordsList({ storage: s })).toEqual([]);
    expect(await s.getItem('history:x')).toBe('{}');
  });

  it('savedWordSetStatus flips an existing entry to known, preserving senses/savedAt', async () => {
    const s = memStorage();
    const original = await upsertOk({ storage: s, now: () => 1000 }, input('bank'));
    const updated = await savedWordSetStatus({ storage: s }, 'bank', 'known');
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe('known');
    expect(updated!.savedAt).toBe(original.savedAt);
    expect(updated!.senses).toEqual(original.senses);
    expect(await s.getItem('saved:bank')).toBe(JSON.stringify(updated));
  });

  it('savedWordSetStatus is case-insensitive on the word key', async () => {
    const s = memStorage();
    await upsertOk({ storage: s, now: () => 1000 }, input('Bank'));
    const updated = await savedWordSetStatus({ storage: s }, 'BANK', 'known');
    expect(updated!.status).toBe('known');
  });

  it('savedWordSetStatus can flip back from known to learning', async () => {
    const s = memStorage();
    await upsertOk({ storage: s, now: () => 1000 }, input('bank'));
    await savedWordSetStatus({ storage: s }, 'bank', 'known');
    const back = await savedWordSetStatus({ storage: s }, 'bank', 'learning');
    expect(back!.status).toBe('learning');
  });

  it('savedWordSetStatus on an unsaved word is a no-op returning null (no throw)', async () => {
    const s = memStorage();
    await expect(savedWordSetStatus({ storage: s }, 'ghost', 'known')).resolves.toBeNull();
  });

  it('savedWordSetRelated patches senses[0].related on an existing entry, preserving everything else (B13)', async () => {
    const s = memStorage();
    const original = await upsertOk({ storage: s, now: () => 1000 }, input('bank'));
    const updated = await savedWordSetRelated({ storage: s }, 'bank', [
      'shore',
      'embankment',
      'bluff',
    ]);
    expect(updated).not.toBeNull();
    expect(updated!.senses[0]!.related).toEqual(['shore', 'embankment', 'bluff']);
    expect(updated!.status).toBe(original.status);
    expect(updated!.savedAt).toBe(original.savedAt);
    expect(updated!.senses[0]!.definition).toBe(original.senses[0]!.definition);
    expect(await s.getItem('saved:bank')).toBe(JSON.stringify(updated));
  });

  it('savedWordSetRelated is case-insensitive on the word key (B13)', async () => {
    const s = memStorage();
    await upsertOk({ storage: s, now: () => 1000 }, input('Bank'));
    const updated = await savedWordSetRelated({ storage: s }, 'BANK', ['shore']);
    expect(updated!.senses[0]!.related).toEqual(['shore']);
  });

  it('savedWordSetRelated on an unsaved word is a no-op returning null (no throw) (B13)', async () => {
    const s = memStorage();
    await expect(savedWordSetRelated({ storage: s }, 'ghost', ['x'])).resolves.toBeNull();
    expect(await s.getItem('saved:ghost')).toBeNull();
  });

  it('B14: an exact-duplicate re-save is a true no-op — a previously-persisted related array survives untouched', async () => {
    // Superseded by B14's dedup design: a plain re-save with the SAME sentence/url is now a
    // silent no-op (design spec §2.2 — "reply as if the save simply succeeded", no write at
    // all), so it can no longer clear senses[0].related the way the old always-replace
    // savedWordUpsert used to. Clearing related now only happens if the caller writes a
    // genuinely new sense (B13's own scope — not exercised by this no-op path).
    const s = memStorage();
    await upsertOk({ storage: s, now: () => 1000 }, input('bank'));
    await savedWordSetRelated({ storage: s }, 'bank', ['shore', 'embankment']);
    const before = await s.getItem('saved:bank');
    const resaved = await upsertOk(
      { storage: s, now: () => 2000 },
      input('bank', { definition: 'new context' }), // same sentence/url as the first save
    );
    expect(resaved.senses[0]!.related).toEqual(['shore', 'embankment']);
    expect(await s.getItem('saved:bank')).toBe(before); // byte-identical — no write happened
  });

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
    await upsertOk({ storage: s, now: () => 1000 }, input('live'));
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
});
