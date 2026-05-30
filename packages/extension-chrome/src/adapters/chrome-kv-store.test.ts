import { describe, it, expect, vi } from 'vitest';
import { ChromeKvStore } from './chrome-kv-store';

function fakeArea(seed: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(seed));
  return {
    get: vi.fn((key: string | null) => {
      if (key === null) return Promise.resolve(Object.fromEntries(store));
      return Promise.resolve(store.has(key) ? { [key]: store.get(key) } : {});
    }),
    set: vi.fn((obj: Record<string, string>) => { for (const [k, v] of Object.entries(obj)) store.set(k, v); return Promise.resolve(); }),
    remove: vi.fn((key: string) => { store.delete(key); return Promise.resolve(); }),
    _store: store,
  };
}

describe('ChromeKvStore (Storage over chrome.storage.local; no adapter prefix)', () => {
  it('round-trips getItem/setItem/removeItem with the exact key', async () => {
    const area = fakeArea();
    const kv = new ChromeKvStore(area);
    await kv.setItem('cache:index', '[]');
    expect(await kv.getItem('cache:index')).toBe('[]');
    expect(area.set).toHaveBeenCalledWith({ 'cache:index': '[]' });
    await kv.removeItem('cache:index');
    expect(await kv.getItem('cache:index')).toBeNull();
  });

  it('keys(prefix) returns FULL keys (so core cacheClear/historyClear can removeItem them)', async () => {
    const kv = new ChromeKvStore(fakeArea({ 'cache:index': '[]', 'cache:ab': '{}', 'history:index': '[]', settings: '{}' }));
    expect((await kv.keys('cache:')).sort()).toEqual(['cache:ab', 'cache:index']);
    expect(await kv.keys('history:')).toEqual(['history:index']);
    expect((await kv.keys()).length).toBe(4);
  });
});
