import type { HistoryEntry, SavedWordEntry } from './types';

/** Rolling window, not calendar-week — design spec §2.2. */
export const DIGEST_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Cap on the "top source sites" row — design spec §2.1. */
export const TOP_SITES_N = 3;

export interface DigestSite {
  domain: string;
  count: number;
}

export interface WeeklyDigest {
  windowStart: number;
  lookups: number;
  saves: number;
  repeatWords: number;
  topSites: DigestSite[];
}

/**
 * hostname minus a leading "www." — a deliberately lightweight heuristic, not eTLD+1 parsing.
 * See the design spec §2.6 for why (B15 owns the rigorous registrable-domain rule for its own
 * feature). Returns undefined for an empty/unparseable url — the caller excludes those from the
 * site tally only, never from the lookup count.
 */
function siteOf(url: string): string | undefined {
  if (!url) return undefined;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.startsWith('www.') ? host.slice(4) : host;
  } catch {
    return undefined;
  }
}

/**
 * Pure aggregation over already-fetched history/saved-word rows. No I/O, no Date.now() — the
 * caller injects `nowMs` (same DI seam as SavedWordsDeps.now/RouterDeps.now). Design spec §2.5.
 */
export function computeWeeklyDigest(
  history: HistoryEntry[],
  savedWords: SavedWordEntry[],
  nowMs: number,
): WeeklyDigest {
  const windowStart = nowMs - DIGEST_WINDOW_MS;
  const inWindow = history.filter((e) => e.createdAt >= windowStart && e.createdAt <= nowMs);

  const wordCounts = new Map<string, number>();
  const siteCounts = new Map<string, number>();
  for (const e of inWindow) {
    const wordKey = e.word.trim().toLowerCase();
    wordCounts.set(wordKey, (wordCounts.get(wordKey) ?? 0) + 1);
    const site = e.url ? siteOf(e.url) : undefined;
    if (site) siteCounts.set(site, (siteCounts.get(site) ?? 0) + 1);
  }

  const repeatWords = [...wordCounts.values()].filter((count) => count >= 2).length;

  const topSites = [...siteCounts.entries()]
    .sort(([domainA, countA], [domainB, countB]) =>
      countB !== countA ? countB - countA : domainA.localeCompare(domainB),
    )
    .slice(0, TOP_SITES_N)
    .map(([domain, count]) => ({ domain, count }));

  const saves = savedWords.filter((s) => s.savedAt >= windowStart && s.savedAt <= nowMs).length;

  return { windowStart, lookups: inWindow.length, saves, repeatWords, topSites };
}
