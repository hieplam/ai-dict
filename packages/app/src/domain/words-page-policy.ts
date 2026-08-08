import type { SavedWordEntry, SavedWordStatus } from './types';

export type WordsSortOrder = 'newest' | 'oldest' | 'alpha';
export type WordsStatusFilter = 'all' | SavedWordStatus;

export interface WordsFilterState {
  query: string;
  status: WordsStatusFilter;
  site: string; // 'all' | UNKNOWN_SITE | a hostname
  sort: WordsSortOrder;
}

export const DEFAULT_WORDS_FILTER: WordsFilterState = {
  query: '',
  status: 'all',
  site: 'all',
  sort: 'newest',
};

/** The bucket value for entries with no parseable site. Never a real hostname. */
export const UNKNOWN_SITE = 'unknown';

/**
 * Every distinct hostname a saved entry's senses point at, deduped. A future multi-sense entry
 * (B14) still matches every site it was met on, not just the first — today's `savedWordUpsert`
 * always writes exactly one sense, so in practice this returns at most one hostname per entry
 * until B14 ships, but the shape costs nothing extra now.
 */
export function siteHostnames(entry: SavedWordEntry): string[] {
  const out = new Set<string>();
  for (const sense of entry.senses) {
    if (!sense.url) continue;
    try {
      out.add(new URL(sense.url).hostname);
    } catch {
      // Not a parseable absolute URL (empty/legacy/hand-seeded data) — contributes to the
      // UNKNOWN_SITE bucket via siteFilterOptions/matchesSite instead of throwing.
    }
  }
  return [...out];
}

/** Distinct site values for the filter <select>, alphabetical; UNKNOWN_SITE appended last, and
 * only, when at least one entry has no parseable site. */
export function siteFilterOptions(entries: SavedWordEntry[]): string[] {
  const sites = new Set<string>();
  let hasUnknown = false;
  for (const e of entries) {
    const hosts = siteHostnames(e);
    if (hosts.length === 0) hasUnknown = true;
    hosts.forEach((h) => sites.add(h));
  }
  const sorted = [...sites].sort((a, b) => a.localeCompare(b));
  return hasUnknown ? [...sorted, UNKNOWN_SITE] : sorted;
}

function matchesQuery(entry: SavedWordEntry, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return true;
  if (entry.word.toLowerCase().includes(q)) return true;
  return entry.senses.some(
    (s) =>
      s.definition.toLowerCase().includes(q) ||
      s.translation.toLowerCase().includes(q) ||
      s.sentence.toLowerCase().includes(q),
  );
}

function matchesStatus(entry: SavedWordEntry, status: WordsStatusFilter): boolean {
  return status === 'all' || entry.status === status;
}

function matchesSite(entry: SavedWordEntry, site: string): boolean {
  if (site === 'all') return true;
  const hosts = siteHostnames(entry);
  if (site === UNKNOWN_SITE) return hosts.length === 0;
  return hosts.includes(site);
}

/**
 * Pure: filter + sort a saved-word list for the words page (B6). No storage/DOM access — the UI
 * layer (words-page-view.ts) owns rendering only; this function owns the logic, unit-tested
 * directly.
 */
export function filterAndSortSavedWords(
  entries: SavedWordEntry[],
  filter: WordsFilterState,
): SavedWordEntry[] {
  const filtered = entries.filter(
    (e) =>
      matchesQuery(e, filter.query) &&
      matchesStatus(e, filter.status) &&
      matchesSite(e, filter.site),
  );
  const sorted = [...filtered];
  if (filter.sort === 'alpha') {
    sorted.sort((a, b) => a.word.localeCompare(b.word));
  } else if (filter.sort === 'oldest') {
    sorted.sort((a, b) => a.savedAt - b.savedAt);
  } else {
    sorted.sort((a, b) => b.savedAt - a.savedAt); // 'newest' — also the default tie-break
  }
  return sorted;
}
