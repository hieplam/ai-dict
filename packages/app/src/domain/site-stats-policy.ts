import type { HistoryEntry, SavedWordEntry } from './types';

/**
 * B15: default number of sites shown in the side panel's "Sites" section — enough to spot a
 * clear leader without turning into a scrolling table (roadmap: Impact 2 · Effort S, "glanceable"
 * payoff). See the design spec §2.5 for the rejected "show all" / "user-configurable N" alternatives.
 */
export const DEFAULT_TOP_SITES = 5;

export interface SiteLookupStat {
  /** Naive site key: lowercase hostname, leading "www." stripped. See extractSiteKey's doc
   * comment for why this is not a full registrable-domain (eTLD+1) parse in v1. */
  site: string;
  /** Count of HistoryEntry rows whose url resolves to this site. */
  lookups: number;
  /** Count of SavedWordEntry rows with at least one sense whose url resolves to this site. An
   * entry with senses on two different sites counts once for EACH site (never twice for the
   * same site — see the per-entry Set dedup below), so a future multi-sense save (B14) can't
   * inflate a single site's save count just because one word has several senses on that site. */
  saves: number;
}

/**
 * Naive site-key extraction: lowercase hostname with a leading "www." stripped. NOT a full
 * public-suffix-list registrable-domain parse (e.g. "a.b.co.uk" stays "a.b.co.uk", not
 * "b.co.uk") — a deliberate v1 limitation, the same naive-first posture as B3's word matching
 * (roadmap: "no lemmatizer in v1"). Returns null for an empty/missing/unparsable url — the state
 * every HistoryEntry written before B10 shipped is in (HistoryEntry.url is optional; see
 * the design spec §2.1), and the state a connection-test's `url: ''` is always in.
 */
export function extractSiteKey(url: string | undefined): string | null {
  if (!url) return null;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (!host) return null;
  return host.startsWith('www.') ? host.slice(4) : host;
}

/**
 * B15: per-domain lookup + save tally, computed ENTIRELY from data the extension already stores
 * for other reasons (history entries from every lookup, saved-word senses from every star tap) —
 * no new tracking surface, honoring the roadmap fence ("counts from existing lookup history
 * only — never track pages read or page content"). Pure and side-effect-free so it is
 * unit-testable without a Storage fake; the side panel composition root is the one caller,
 * handing it entries it already fetched over the wire.
 */
export function computeSiteLookupStats(
  history: readonly HistoryEntry[],
  saved: readonly SavedWordEntry[],
  topN: number = DEFAULT_TOP_SITES,
): SiteLookupStat[] {
  const lookups = new Map<string, number>();
  for (const e of history) {
    const site = extractSiteKey(e.url);
    if (site) lookups.set(site, (lookups.get(site) ?? 0) + 1);
  }
  const saves = new Map<string, number>();
  for (const entry of saved) {
    const sites = new Set<string>();
    for (const sense of entry.senses) {
      const site = extractSiteKey(sense.url);
      if (site) sites.add(site);
    }
    for (const site of sites) saves.set(site, (saves.get(site) ?? 0) + 1);
  }
  const allSites = new Set<string>([...lookups.keys(), ...saves.keys()]);
  const stats: SiteLookupStat[] = [...allSites].map((site) => ({
    site,
    lookups: lookups.get(site) ?? 0,
    saves: saves.get(site) ?? 0,
  }));
  stats.sort((a, b) => b.lookups - a.lookups || b.saves - a.saves || a.site.localeCompare(b.site));
  return stats.slice(0, topN);
}
