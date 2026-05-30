import { describe, it, expect, vi } from 'vitest';
import { SafariKvStore } from './safari-kv-store';

function fakeArea(seed: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(seed));
  return {
    get: vi.fn((key?: string | null): Promise<Record<string, unknown>> => {
      if (key === null || key === undefined) return Promise.resolve(Object.fromEntries(store));
      return Promise.resolve(store.has(key) ? { [key]: store.get(key) } : {});
    }),
    set: vi.fn((obj: Record<string, string>): Promise<void> => { for (const [k, v] of Object.entries(obj)) store.set(k, v); return Promise.resolve(); }),
    remove: vi.fn((key: string): Promise<void> => { store.delete(key); return Promise.resolve(); }),
  };
}

describe('SafariKvStore (Storage over browser.storage.local; no adapter prefix)', () => {
  it('round-trips getItem/setItem/removeItem with the exact key', async () => {
    const area = fakeArea();
    const kv = new SafariKvStore(area);
    await kv.setItem('cache:index', '[]');
    expect(await kv.getItem('cache:index')).toBe('[]');
    expect(area.set).toHaveBeenCalledWith({ 'cache:index': '[]' });
    await kv.removeItem('cache:index');
    expect(await kv.getItem('cache:index')).toBeNull();
  });

  it('keys(prefix) returns FULL keys (so core cacheClear/historyClear can removeItem them)', async () => {
    const kv = new SafariKvStore(fakeArea({ 'cache:index': '[]', 'cache:ab': '{}', 'history:index': '[]', settings: '{}' }));
    expect((await kv.keys('cache:')).sort()).toEqual(['cache:ab', 'cache:index']);
    expect(await kv.keys('history:')).toEqual(['history:index']);
    expect((await kv.keys()).length).toBe(4);
  });
});
