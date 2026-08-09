import { describe, it, expect } from 'vitest';
import {
  extractSiteKey,
  computeSiteLookupStats,
  DEFAULT_TOP_SITES,
} from '../src/domain/site-stats-policy';
import type { HistoryEntry, SavedWordEntry } from '../src';

const result = {
  markdown: '',
  word: 'w',
  target: 'vi',
  model: 'gemini-2.5-flash',
  fromCache: false,
  fetchedAt: 0,
};

function historyEntry(id: string, url: string | undefined): HistoryEntry {
  return { id, word: 'w', context: '', url, result, createdAt: Number(id) || 0 };
}

function savedEntry(word: string, urls: string[]): SavedWordEntry {
  return {
    word,
    status: 'learning',
    savedAt: 0,
    senses: urls.map((url) => ({
      definition: 'd',
      translation: '',
      sentence: 's',
      url,
      title: 't',
    })),
  };
}

describe('extractSiteKey', () => {
  it('lowercases the hostname and strips a leading www.', () => {
    expect(extractSiteKey('https://WWW.Example.com/path')).toBe('example.com');
  });
  it('leaves a hostname with no www. prefix unchanged (lowercased)', () => {
    expect(extractSiteKey('https://Reddit.com/r/x')).toBe('reddit.com');
  });
  it('does not strip "www" when it is not the leading label (naive v1 — see design spec §2.2)', () => {
    expect(extractSiteKey('https://mywww.example.com')).toBe('mywww.example.com');
  });
  it('returns null for undefined, empty, and malformed urls', () => {
    expect(extractSiteKey(undefined)).toBeNull();
    expect(extractSiteKey('')).toBeNull();
    expect(extractSiteKey('not a url')).toBeNull();
  });
});

describe('computeSiteLookupStats', () => {
  it('tallies lookups per site, ignoring entries with no resolvable url', () => {
    const history = [
      historyEntry('1', 'https://example.com/a'),
      historyEntry('2', 'https://example.com/b'),
      historyEntry('3', 'https://reddit.com/r/x'),
      historyEntry('4', undefined),
      historyEntry('5', ''),
    ];
    const stats = computeSiteLookupStats(history, []);
    expect(stats).toEqual([
      { site: 'example.com', lookups: 2, saves: 0 },
      { site: 'reddit.com', lookups: 1, saves: 0 },
    ]);
  });

  it('tallies saves per site, counting a multi-sense entry on the SAME site once', () => {
    const saved = [
      savedEntry('bank', ['https://example.com/a', 'https://example.com/b']),
      savedEntry('ledger', ['https://reddit.com/r/x']),
    ];
    const stats = computeSiteLookupStats([], saved);
    expect(stats).toEqual([
      { site: 'example.com', lookups: 0, saves: 1 },
      { site: 'reddit.com', lookups: 0, saves: 1 },
    ]);
  });

  it('a save on a different site than any lookup still contributes its own row', () => {
    const history = [historyEntry('1', 'https://example.com/a')];
    const saved = [savedEntry('bank', ['https://reddit.com/r/x'])];
    const stats = computeSiteLookupStats(history, saved);
    expect(stats).toContainEqual({ site: 'reddit.com', lookups: 0, saves: 1 });
    expect(stats).toContainEqual({ site: 'example.com', lookups: 1, saves: 0 });
  });

  it('sorts by lookups desc, ties broken by saves desc, then alphabetically', () => {
    const history = [
      historyEntry('1', 'https://a.com'),
      historyEntry('2', 'https://b.com'),
      historyEntry('3', 'https://b.com'),
      historyEntry('4', 'https://c.com'),
      historyEntry('5', 'https://c.com'),
    ];
    const saved = [savedEntry('w1', ['https://c.com'])];
    const stats = computeSiteLookupStats(history, saved);
    expect(stats.map((s) => s.site)).toEqual(['c.com', 'b.com', 'a.com']);
  });

  it('respects topN, defaulting to DEFAULT_TOP_SITES', () => {
    const history = Array.from({ length: 6 }, (_, i) =>
      historyEntry(String(i), `https://site${i}.com`),
    );
    expect(computeSiteLookupStats(history, [])).toHaveLength(DEFAULT_TOP_SITES);
    expect(computeSiteLookupStats(history, [], 6)).toHaveLength(6);
  });

  it('returns [] for empty inputs', () => {
    expect(computeSiteLookupStats([], [])).toEqual([]);
  });
});
