import type { Storage } from '../ports';
import type { LookupResult } from './types';

export function fnv1a64Hex(input: string): string {
  const PRIME = 0x100000001b3n;
  const MASK = 0xffffffffffffffffn;
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(input)) {
    hash ^= BigInt(byte);
    hash = (hash * PRIME) & MASK;
  }
  return hash.toString(16).padStart(16, '0');
}

/**
 * A9: the hash already includes `context` (the full sentence the word was selected in, see
 * `workflow.ts`'s `context: e.sentence`), not just the word — so two different senses of the
 * same headword ("bank" river vs. money) never collide, because they never share the same
 * sentence. This was verified against the roadmap's stated concern (docs/ROADMAP.md §4 A9) and
 * intentionally left unchanged; do not add a separate "sense" field without re-reading
 * `docs/superpowers/specs/2026-07-17-a9-instant-cache-hits-design.md` §2.1 first.
 */
export function deriveCacheKey(req: { word: string; context: string; target: string }): string {
  const norm = `${req.word.trim().toLowerCase()}|${req.context.trim()}|${req.target}`;
  return fnv1a64Hex(norm);
}

interface IndexEntry {
  key: string;
  atime: number;
}
export interface CacheDeps {
  storage: Storage;
  cap?: number;
  now?: () => number;
}

const INDEX_KEY = 'cache:index';
const DEFAULT_CAP = 1000;

async function readIndex(s: Storage): Promise<IndexEntry[]> {
  const raw = await s.getItem(INDEX_KEY);
  return raw ? (JSON.parse(raw) as IndexEntry[]) : [];
}
async function writeIndex(s: Storage, idx: IndexEntry[]): Promise<void> {
  await s.setItem(INDEX_KEY, JSON.stringify(idx));
}

export async function cacheGet(
  deps: CacheDeps,
  req: { word: string; context: string; target: string },
): Promise<LookupResult | null> {
  const now = deps.now ?? Date.now;
  const hash = deriveCacheKey(req);
  const raw = await deps.storage.getItem(`cache:${hash}`);
  if (!raw) return null;
  const idx = await readIndex(deps.storage);
  const entry = idx.find((e) => e.key === hash);
  if (entry) {
    entry.atime = now();
    await writeIndex(deps.storage, idx);
  }
  return { ...(JSON.parse(raw) as LookupResult), fromCache: true };
}

export async function cachePut(
  deps: CacheDeps,
  req: { word: string; context: string; target: string },
  result: LookupResult,
): Promise<void> {
  const now = deps.now ?? Date.now;
  const cap = deps.cap ?? DEFAULT_CAP;
  const hash = deriveCacheKey(req);
  await deps.storage.setItem(`cache:${hash}`, JSON.stringify({ ...result, fromCache: false }));
  const idx = (await readIndex(deps.storage)).filter((e) => e.key !== hash);
  idx.push({ key: hash, atime: now() });
  idx.sort((a, b) => a.atime - b.atime);
  while (idx.length > cap) {
    const evicted = idx.shift()!;
    await deps.storage.removeItem(`cache:${evicted.key}`);
  }
  await writeIndex(deps.storage, idx);
}

export async function cacheDelete(
  deps: CacheDeps,
  req: { word: string; context: string; target: string },
): Promise<void> {
  const hash = deriveCacheKey(req);
  await deps.storage.removeItem(`cache:${hash}`);
  const idx = (await readIndex(deps.storage)).filter((e) => e.key !== hash);
  await writeIndex(deps.storage, idx);
}

export async function cacheClear(deps: CacheDeps): Promise<void> {
  for (const k of await deps.storage.keys('cache:')) await deps.storage.removeItem(k);
}
