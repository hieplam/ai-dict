import { describe, it, expect } from 'vitest';
import { computeWeeklyDigest, DIGEST_WINDOW_MS, TOP_SITES_N } from '../src/domain/weekly-digest';
import type { HistoryEntry, SavedWordEntry } from '../src';

const NOW = 1_700_000_000_000; // fixed clock for deterministic window math

function historyEntry(over: Partial<HistoryEntry> & { id: string; word: string }): HistoryEntry {
  return {
    id: over.id,
    word: over.word,
    context: over.context ?? '',
    createdAt: over.createdAt ?? NOW,
    url: over.url,
    title: over.title,
    result: over.result ?? {
      markdown: '',
      word: over.word,
      target: 'vi',
      model: 'gemini-2.5-flash',
      fromCache: false,
      fetchedAt: over.createdAt ?? NOW,
    },
  };
}

function savedEntry(
  over: Partial<SavedWordEntry> & { word: string; savedAt: number },
): SavedWordEntry {
  return {
    word: over.word,
    status: over.status ?? 'learning',
    savedAt: over.savedAt,
    senses: over.senses ?? [{ definition: '', translation: '', sentence: '', url: '', title: '' }],
  };
}

describe('computeWeeklyDigest', () => {
  it('empty history and saved words → an all-zero digest', () => {
    const d = computeWeeklyDigest([], [], NOW);
    expect(d).toEqual({
      windowStart: NOW - DIGEST_WINDOW_MS,
      lookups: 0,
      saves: 0,
      repeatWords: 0,
      topSites: [],
    });
  });

  it('counts only entries inside the rolling 7-day window (inclusive boundary)', () => {
    const windowStart = NOW - DIGEST_WINDOW_MS;
    const history = [
      historyEntry({ id: 'in-1', word: 'bank', createdAt: NOW }),
      historyEntry({ id: 'in-2', word: 'ledger', createdAt: windowStart }), // exactly on the boundary — included
      historyEntry({ id: 'out', word: 'stale', createdAt: windowStart - 1 }), // 1ms outside — excluded
    ];
    const d = computeWeeklyDigest(history, [], NOW);
    expect(d.lookups).toBe(2);
  });

  it('saves are counted by SavedWordEntry.savedAt inside the window, independent of history', () => {
    const windowStart = NOW - DIGEST_WINDOW_MS;
    const saved = [
      savedEntry({ word: 'bank', savedAt: NOW }),
      savedEntry({ word: 'ledger', savedAt: windowStart }),
      savedEntry({ word: 'ancient', savedAt: windowStart - 1 }), // outside — excluded
    ];
    const d = computeWeeklyDigest([], saved, NOW);
    expect(d.saves).toBe(2);
  });

  it('repeatWords counts distinct words with >=2 in-window lookups only', () => {
    const history = [
      historyEntry({ id: '1', word: 'bank', createdAt: NOW }),
      historyEntry({ id: '2', word: 'Bank', createdAt: NOW }), // case-insensitive same word
      historyEntry({ id: '3', word: 'ledger', createdAt: NOW }), // looked up once — not a repeat
    ];
    const d = computeWeeklyDigest(history, [], NOW);
    expect(d.lookups).toBe(3);
    expect(d.repeatWords).toBe(1); // only "bank"
  });

  it('topSites aggregates by hostname with a leading www. stripped, sorted desc by count', () => {
    const history = [
      historyEntry({ id: '1', word: 'a', createdAt: NOW, url: 'https://www.nautil.us/article-1' }),
      historyEntry({ id: '2', word: 'b', createdAt: NOW, url: 'https://nautil.us/article-2' }),
      historyEntry({ id: '3', word: 'c', createdAt: NOW, url: 'https://nautil.us/article-3' }),
      historyEntry({ id: '4', word: 'd', createdAt: NOW, url: 'https://en.wikipedia.org/wiki/X' }),
    ];
    const d = computeWeeklyDigest(history, [], NOW);
    expect(d.topSites).toEqual([
      { domain: 'nautil.us', count: 3 },
      { domain: 'en.wikipedia.org', count: 1 },
    ]);
  });

  it('ties in topSites break alphabetically by domain', () => {
    const history = [
      historyEntry({ id: '1', word: 'a', createdAt: NOW, url: 'https://zzz.example/1' }),
      historyEntry({ id: '2', word: 'b', createdAt: NOW, url: 'https://aaa.example/1' }),
    ];
    const d = computeWeeklyDigest(history, [], NOW);
    expect(d.topSites.map((s) => s.domain)).toEqual(['aaa.example', 'zzz.example']);
  });

  it('caps topSites at TOP_SITES_N', () => {
    expect(TOP_SITES_N).toBe(3);
    const history = ['a', 'b', 'c', 'd'].map((letter, i) =>
      historyEntry({
        id: String(i),
        word: letter,
        createdAt: NOW,
        url: `https://${letter}.example/`,
      }),
    );
    const d = computeWeeklyDigest(history, [], NOW);
    expect(d.topSites).toHaveLength(3);
  });

  it('entries with an empty url are excluded from topSites but still counted in lookups', () => {
    const history = [historyEntry({ id: '1', word: 'a', createdAt: NOW, url: '' })];
    const d = computeWeeklyDigest(history, [], NOW);
    expect(d.lookups).toBe(1);
    expect(d.topSites).toEqual([]);
  });

  it('entries with no url field at all (legacy pre-B10 entries) are excluded from topSites only', () => {
    const legacy: HistoryEntry = {
      id: '1',
      word: 'a',
      context: '',
      createdAt: NOW,
      result: {
        markdown: '',
        word: 'a',
        target: 'vi',
        model: 'gemini-2.5-flash',
        fromCache: false,
        fetchedAt: NOW,
      },
      // url/title intentionally omitted — simulates JSON read from storage pre-B10
    };
    const d = computeWeeklyDigest([legacy], [], NOW);
    expect(d.lookups).toBe(1);
    expect(d.topSites).toEqual([]);
  });

  it('entries with a malformed url are excluded from topSites, not thrown', () => {
    const history = [historyEntry({ id: '1', word: 'a', createdAt: NOW, url: 'not a url' })];
    expect(() => computeWeeklyDigest(history, [], NOW)).not.toThrow();
    expect(computeWeeklyDigest(history, [], NOW).topSites).toEqual([]);
  });

  it('is pure: does not read Date.now() — identical input always produces identical output', () => {
    const history = [historyEntry({ id: '1', word: 'a', createdAt: NOW })];
    const a = computeWeeklyDigest(history, [], NOW);
    const b = computeWeeklyDigest(history, [], NOW);
    expect(a).toEqual(b);
  });
});
