import { describe, it, expect } from 'vitest';
import { historyAppend, historyList, historyClear } from '../src/domain/history-policy';
import type { Storage, HistoryEntry } from '../src';

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
const entry = (id: string): HistoryEntry => ({
  id,
  word: id,
  context: '',
  createdAt: Number(id),
  result: {
    markdown: '',
    word: id,
    target: 'vi',
    model: 'gemini-2.5-flash',
    fromCache: false,
    fetchedAt: 0,
  },
});

describe('history-policy', () => {
  it('lists newest-first', async () => {
    const s = memStorage();
    await historyAppend({ storage: s }, entry('1'));
    await historyAppend({ storage: s }, entry('2'));
    const { entries } = await historyList({ storage: s }, {});
    expect(entries.map((e) => e.id)).toEqual(['2', '1']);
  });
  it('pages via cursor', async () => {
    const s = memStorage();
    for (const id of ['1', '2', '3']) await historyAppend({ storage: s }, entry(id));
    const page1 = await historyList({ storage: s }, { limit: 2 });
    expect(page1.entries.map((e) => e.id)).toEqual(['3', '2']);
    const page2 = await historyList(
      { storage: s },
      { limit: 2, ...(page1.nextCursor !== undefined ? { cursor: page1.nextCursor } : {}) },
    );
    expect(page2.entries.map((e) => e.id)).toEqual(['1']);
    expect(page2.nextCursor).toBeUndefined();
  });
  it('caps at FIFO limit, dropping oldest', async () => {
    const s = memStorage();
    for (const id of ['1', '2', '3']) await historyAppend({ storage: s, cap: 2 }, entry(id));
    const { entries } = await historyList({ storage: s }, {});
    expect(entries.map((e) => e.id)).toEqual(['3', '2']);
    expect(await s.getItem('history:1')).toBeNull();
  });
  it('stale cursor (evicted id) returns empty page without error', async () => {
    // Append 3 entries with cap=2: id='1' is evicted (oldest beyond cap).
    // historyList with cursor='1' must fall back gracefully → empty entries, no nextCursor.
    const s = memStorage();
    for (const id of ['1', '2', '3']) await historyAppend({ storage: s, cap: 2 }, entry(id));
    const page = await historyList({ storage: s }, { cursor: '1' });
    expect(page.entries).toEqual([]);
    expect(page.nextCursor).toBeUndefined();
  });

  it('stale cursor after clear returns empty page without error', async () => {
    // Append entries, get a nextCursor, clear history, then list with the stale cursor.
    const s = memStorage();
    for (const id of ['1', '2', '3']) await historyAppend({ storage: s }, entry(id));
    const page1 = await historyList({ storage: s }, { limit: 2 });
    expect(page1.nextCursor).toBeDefined();
    const staleCursor = page1.nextCursor!;
    await historyClear({ storage: s });
    const page = await historyList({ storage: s }, { cursor: staleCursor });
    expect(page.entries).toEqual([]);
    expect(page.nextCursor).toBeUndefined();
  });

  it('default cap is 500: appending 501 entries evicts the oldest, index length is exactly 500', async () => {
    // Confirms DEFAULT_CAP = 500 per history-policy.ts
    const s = memStorage();
    const ids = Array.from({ length: 501 }, (_, i) => String(i + 1));
    for (const id of ids) await historyAppend({ storage: s }, entry(id));
    const { entries } = await historyList({ storage: s }, {});
    expect(entries.length).toBe(500);
    // id='1' (the oldest) must have been evicted
    expect(entries.find((e) => e.id === '1')).toBeUndefined();
    // id='501' (the newest) must be present
    expect(entries[0]!.id).toBe('501');
  }, 15000);

  it('clear removes all', async () => {
    const s = memStorage();
    await historyAppend({ storage: s }, entry('1'));
    await historyClear({ storage: s });
    expect((await historyList({ storage: s }, {})).entries).toEqual([]);
  });
});
