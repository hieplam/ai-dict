import type { Storage } from '../ports';
import type { HistoryEntry } from './types';

const INDEX_KEY = 'history:index';
const DEFAULT_CAP = 500;

export interface HistoryDeps {
  storage: Storage;
  cap?: number;
}
export interface HistoryPage {
  entries: HistoryEntry[];
  nextCursor?: string;
}

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

export async function historyList(
  deps: HistoryDeps,
  opts: { limit?: number; cursor?: string },
): Promise<HistoryPage> {
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

/**
 * B7: entries with `createdAt >= sinceMs`, newest-first — used to count recent same-word
 * lookups without reading the full (cap-500) history log on every lookup. History is
 * insertion-ordered newest-first (`historyAppend` always prepends the newest id), so
 * `createdAt` only decreases as the index is walked; this stops at the first entry older than
 * `sinceMs` instead of scanning to the end.
 */
export async function historyListSince(
  deps: HistoryDeps,
  sinceMs: number,
): Promise<HistoryEntry[]> {
  const idx = await readIndex(deps.storage);
  const out: HistoryEntry[] = [];
  for (const id of idx) {
    const raw = await deps.storage.getItem(`history:${id}`);
    if (!raw) continue;
    const parsed = JSON.parse(raw) as HistoryEntry;
    if (parsed.createdAt < sinceMs) break;
    out.push(parsed);
  }
  return out;
}

export async function historyGet(deps: HistoryDeps, id: string): Promise<HistoryEntry | null> {
  const raw = await deps.storage.getItem(`history:${id}`);
  return raw ? (JSON.parse(raw) as HistoryEntry) : null;
}

export async function historyDelete(deps: HistoryDeps, id: string): Promise<void> {
  await deps.storage.removeItem(`history:${id}`);
  const idx = (await readIndex(deps.storage)).filter((x) => x !== id);
  await deps.storage.setItem(INDEX_KEY, JSON.stringify(idx));
}

/**
 * B9: import one backup history entry — add it only if its id isn't already present locally
 * (history entries are immutable per-lookup snapshots; there is nothing to "merge" per id, only
 * add-if-missing — see the design spec §3.2). Reuses historyAppend unmodified so the existing
 * cap and newest-first index invariant both keep working exactly as they do for live traffic.
 * Returns whether the entry was newly added (false = skipped, id already present).
 */
export async function historyImportEntry(deps: HistoryDeps, entry: HistoryEntry): Promise<boolean> {
  const existing = await historyGet(deps, entry.id);
  if (existing) return false;
  await historyAppend(deps, entry);
  return true;
}

/**
 * B9: restore the newest-first `history:index` invariant after a backup import may have prepended
 * an older entry ahead of a newer local one (spec §3.2's stated goal: the index ends in the same
 * order production traffic would have produced). Re-sorts the index by each entry's createdAt
 * descending; ties keep their existing relative order (stable sort). No-op on an empty/single index.
 */
export async function historyReindex(deps: HistoryDeps): Promise<void> {
  const idx = await readIndex(deps.storage);
  if (idx.length < 2) return;
  const withCreatedAt: { id: string; createdAt: number }[] = [];
  for (const id of idx) {
    const raw = await deps.storage.getItem(`history:${id}`);
    if (!raw) continue; // skip ids whose stored value is missing
    withCreatedAt.push({ id, createdAt: (JSON.parse(raw) as HistoryEntry).createdAt });
  }
  const sorted = [...withCreatedAt].sort((a, b) => b.createdAt - a.createdAt);
  await deps.storage.setItem(INDEX_KEY, JSON.stringify(sorted.map((e) => e.id)));
}

export async function historyClear(deps: HistoryDeps): Promise<void> {
  for (const k of await deps.storage.keys('history:')) await deps.storage.removeItem(k);
}
