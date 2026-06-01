import type { Storage, HistoryEntry } from './index';

const INDEX_KEY = 'history:index';
const DEFAULT_CAP = 500;

export interface HistoryDeps { storage: Storage; cap?: number; }
export interface HistoryPage { entries: HistoryEntry[]; nextCursor?: string; }

async function readIndex(s: Storage): Promise<string[]> {
  const raw = await s.getItem(INDEX_KEY);
  return raw ? (JSON.parse(raw) as string[]) : [];
}

export async function historyAppend(deps: HistoryDeps, e: HistoryEntry): Promise<void> {
  const cap = deps.cap ?? DEFAULT_CAP;
  await deps.storage.setItem(`history:${e.id}`, JSON.stringify(e));
  const idx = [e.id, ...(await readIndex(deps.storage)).filter((id) => id !== e.id)];
  while (idx.length > cap) {
    const dropped = idx.pop()!;
    await deps.storage.removeItem(`history:${dropped}`);
  }
  await deps.storage.setItem(INDEX_KEY, JSON.stringify(idx));
}

export async function historyList(deps: HistoryDeps, opts: { limit?: number; cursor?: string }): Promise<HistoryPage> {
  const idx = await readIndex(deps.storage); // newest-first
  const start = opts.cursor ? idx.indexOf(opts.cursor) : 0;
  const from = start < 0 ? idx.length : start;
  const limit = opts.limit ?? idx.length;
  const slice = idx.slice(from, from + limit);
  const entries: HistoryEntry[] = [];
  for (const id of slice) {
    const raw = await deps.storage.getItem(`history:${id}`);
    if (raw) entries.push(JSON.parse(raw) as HistoryEntry);
  }
  const nextIndex = from + limit;
  const next = nextIndex < idx.length ? idx[nextIndex] : undefined;
  return next !== undefined ? { entries, nextCursor: next } : { entries };
}

export async function historyClear(deps: HistoryDeps): Promise<void> {
  for (const k of await deps.storage.keys('history:')) await deps.storage.removeItem(k);
}
