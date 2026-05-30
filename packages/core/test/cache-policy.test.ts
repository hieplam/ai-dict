import { describe, it, expect } from 'vitest';
import { fnv1a64Hex, deriveCacheKey, cacheGet, cachePut } from '../src/cache-policy';
import type { Storage, LookupResult } from '../src';

function memStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => Promise.resolve(m.get(k) ?? null),
    setItem: (k, v) => { m.set(k, v); return Promise.resolve(); },
    removeItem: (k) => { m.delete(k); return Promise.resolve(); },
    keys: (p) => Promise.resolve([...m.keys()].filter((k) => !p || k.startsWith(p))),
  };
}
const result = (word: string): LookupResult => ({ markdown: '#', word, target: 'vi', model: 'gemini-2.5-flash', fromCache: false, fetchedAt: 1 });

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
    const deps = { storage: s, cap: 2, now: (() => { let t = 0; return () => ++t; })() };
    await cachePut(deps, { word: 'a', context: '', target: 'vi' }, result('a'));
    await cachePut(deps, { word: 'b', context: '', target: 'vi' }, result('b'));
    await cacheGet(deps, { word: 'a', context: '', target: 'vi' }); // touch a → b is LRU
    await cachePut(deps, { word: 'c', context: '', target: 'vi' }, result('c'));
    expect(await cacheGet(deps, { word: 'b', context: '', target: 'vi' })).toBeNull();
    expect(await cacheGet(deps, { word: 'a', context: '', target: 'vi' })).not.toBeNull();
  });
});
