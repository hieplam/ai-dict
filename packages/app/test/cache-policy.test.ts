import { describe, it, expect } from 'vitest';
import {
  fnv1a64Hex,
  deriveCacheKey,
  cacheGet,
  cachePut,
  cacheClear,
  cacheDelete,
} from '../src/domain/cache-policy';
import type { Storage, LookupResult } from '../src';

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
const result = (word: string): LookupResult => ({
  markdown: '#',
  word,
  target: 'vi',
  model: 'gemini-2.5-flash',
  fromCache: false,
  fetchedAt: 1,
});

describe('cache-policy', () => {
  it('fnv1a64Hex is deterministic 16-char hex', () => {
    expect(fnv1a64Hex('abc')).toMatch(/^[0-9a-f]{16}$/);
    expect(fnv1a64Hex('abc')).toBe(fnv1a64Hex('abc'));
    expect(fnv1a64Hex('abc')).not.toBe(fnv1a64Hex('abd'));
  });
  it('deriveCacheKey normalizes word case + trims (spec §6.11)', () => {
    const a = deriveCacheKey({ word: ' Bank ', context: 'x', target: 'vi' });
    const b = deriveCacheKey({ word: 'bank', context: 'x', target: 'vi' });
    expect(a).toBe(b);
  });
  it('round-trips put → get with fromCache flipped true', async () => {
    const s = memStorage();
    await cachePut({ storage: s }, { word: 'bank', context: 'x', target: 'vi' }, result('bank'));
    const got = await cacheGet({ storage: s }, { word: 'bank', context: 'x', target: 'vi' });
    expect(got?.word).toBe('bank');
    expect(got?.fromCache).toBe(true);
  });
  it('evicts least-recently-used beyond cap', async () => {
    const s = memStorage();
    const deps = {
      storage: s,
      cap: 2,
      now: (() => {
        let t = 0;
        return () => ++t;
      })(),
    };
    await cachePut(deps, { word: 'a', context: '', target: 'vi' }, result('a'));
    await cachePut(deps, { word: 'b', context: '', target: 'vi' }, result('b'));
    await cacheGet(deps, { word: 'a', context: '', target: 'vi' }); // touch a → b is LRU
    await cachePut(deps, { word: 'c', context: '', target: 'vi' }, result('c'));
    expect(await cacheGet(deps, { word: 'b', context: '', target: 'vi' })).toBeNull();
    expect(await cacheGet(deps, { word: 'a', context: '', target: 'vi' })).not.toBeNull();
  });

  it('cacheClear removes all cache entries and the index key', async () => {
    const s = memStorage();
    const deps = { storage: s };
    await cachePut(deps, { word: 'a', context: '', target: 'vi' }, result('a'));
    await cachePut(deps, { word: 'b', context: '', target: 'vi' }, result('b'));
    await cacheClear(deps);
    expect(await cacheGet(deps, { word: 'a', context: '', target: 'vi' })).toBeNull();
    expect(await cacheGet(deps, { word: 'b', context: '', target: 'vi' })).toBeNull();
    // index key must also be gone
    expect(await s.getItem('cache:index')).toBeNull();
  });

  it('cacheDelete removes only the targeted entry (value + index row)', async () => {
    const s = memStorage();
    const deps = { storage: s };
    await cachePut(deps, { word: 'a', context: '', target: 'vi' }, result('a'));
    await cachePut(deps, { word: 'b', context: '', target: 'vi' }, result('b'));
    await cacheDelete(deps, { word: 'a', context: '', target: 'vi' });
    expect(await cacheGet(deps, { word: 'a', context: '', target: 'vi' })).toBeNull();
    expect(await cacheGet(deps, { word: 'b', context: '', target: 'vi' })).not.toBeNull();
    // the index must no longer reference the deleted hash
    const idx = JSON.parse((await s.getItem('cache:index'))!) as { key: string }[];
    expect(idx.map((e) => e.key)).toEqual([
      deriveCacheKey({ word: 'b', context: '', target: 'vi' }),
    ]);
  });

  it('cacheDelete on a missing entry is a no-op', async () => {
    const s = memStorage();
    const deps = { storage: s };
    await cachePut(deps, { word: 'a', context: '', target: 'vi' }, result('a'));
    await expect(
      cacheDelete(deps, { word: 'ghost', context: '', target: 'vi' }),
    ).resolves.toBeUndefined();
    expect(await cacheGet(deps, { word: 'a', context: '', target: 'vi' })).not.toBeNull();
  });

  it('cacheDelete normalizes the key like cacheGet (case/trim)', async () => {
    const s = memStorage();
    const deps = { storage: s };
    await cachePut(deps, { word: 'bank', context: 'x', target: 'vi' }, result('bank'));
    await cacheDelete(deps, { word: ' Bank ', context: 'x', target: 'vi' });
    expect(await cacheGet(deps, { word: 'bank', context: 'x', target: 'vi' })).toBeNull();
  });

  it('evicts at the default cap of 1000 (D4 gate: regression guard on DEFAULT_CAP)', async () => {
    // Uses the default cap — no explicit cap dep — so any change to DEFAULT_CAP is detected.
    const s = memStorage();
    const deps = { storage: s }; // cap defaults to 1000 inside cachePut
    // Insert 1001 items: the first item inserted is the oldest and must be evicted.
    for (let i = 0; i < 1001; i++) {
      await cachePut(deps, { word: String(i), context: '', target: 'vi' }, result(String(i)));
    }
    // Item 0 was inserted first and is the LRU — it must no longer be retrievable.
    expect(await cacheGet(deps, { word: '0', context: '', target: 'vi' })).toBeNull();
    // Item 1000 (the 1001st) must still be present.
    expect(await cacheGet(deps, { word: '1000', context: '', target: 'vi' })).not.toBeNull();
  }, 10000); // allow up to 10 s for 1001 async storage operations
});
