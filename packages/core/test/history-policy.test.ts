import { describe, it, expect } from 'vitest';
import { historyAppend, historyList, historyClear } from '../src/history-policy';
import type { Storage, HistoryEntry } from '../src';

function memStorage(): Storage {
  const m = new Map<string, string>();
  return { getItem: async (k) => m.get(k) ?? null, setItem: async (k, v) => void m.set(k, v), removeItem: async (k) => void m.delete(k), keys: async (p) => [...m.keys()].filter((k) => !p || k.startsWith(p)) };
}
const entry = (id: string): HistoryEntry => ({ id, word: id, context: '', createdAt: Number(id), result: { markdown: '', word: id, target: 'vi', model: 'gemini-2.5-flash', fromCache: false, fetchedAt: 0 } });

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
    const page2 = await historyList({ storage: s }, { limit: 2, ...(page1.nextCursor !== undefined ? { cursor: page1.nextCursor } : {}) });
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
  it('clear removes all', async () => {
    const s = memStorage();
    await historyAppend({ storage: s }, entry('1'));
    await historyClear({ storage: s });
    expect((await historyList({ storage: s }, {})).entries).toEqual([]);
  });
});
