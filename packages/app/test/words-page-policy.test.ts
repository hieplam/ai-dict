import { describe, it, expect } from 'vitest';
import {
  filterAndSortSavedWords,
  siteHostnames,
  siteFilterOptions,
  DEFAULT_WORDS_FILTER,
  UNKNOWN_SITE,
  type WordsFilterState,
} from '../src/domain/words-page-policy';
import type { SavedWordEntry, SavedWordSense } from '../src';

function sense(over: Partial<SavedWordSense> = {}): SavedWordSense {
  return {
    definition: 'a definition',
    translation: '',
    sentence: 'a sentence',
    url: 'https://example.com/article',
    title: 'Example',
    ...over,
  };
}

function makeEntry(
  over: Partial<SavedWordEntry> & { word: string; senses?: SavedWordSense[] },
): SavedWordEntry {
  return {
    word: over.word,
    status: over.status ?? 'learning',
    savedAt: over.savedAt ?? 1_700_000_000_000,
    senses: over.senses ?? [sense({ sentence: `a sentence with ${over.word}` })],
  };
}

describe('words-page-policy', () => {
  it('siteHostnames extracts the hostname from every sense url, deduped', () => {
    const e = makeEntry({
      word: 'bank',
      senses: [
        sense({ url: 'https://a.com/x' }),
        sense({ url: 'https://a.com/y' }),
        sense({ url: 'https://b.com/z' }),
      ],
    });
    expect(siteHostnames(e).sort()).toEqual(['a.com', 'b.com']);
  });

  it('siteHostnames ignores an empty or unparseable url', () => {
    const e = makeEntry({ word: 'bank', senses: [sense({ url: '' })] });
    expect(siteHostnames(e)).toEqual([]);
  });

  it('siteFilterOptions returns distinct sorted hostnames, with UNKNOWN_SITE last only if some entry has none', () => {
    const withSite = makeEntry({ word: 'bank', senses: [sense({ url: 'https://z.com' })] });
    const withoutSite = makeEntry({ word: 'cat', senses: [sense({ url: '' })] });
    const other = makeEntry({ word: 'dog', senses: [sense({ url: 'https://a.com' })] });
    expect(siteFilterOptions([withSite, withoutSite, other])).toEqual([
      'a.com',
      'z.com',
      UNKNOWN_SITE,
    ]);
    expect(siteFilterOptions([withSite, other])).toEqual(['a.com', 'z.com']);
    expect(siteFilterOptions([])).toEqual([]);
  });

  it('filterAndSortSavedWords matches the query against word, definition, translation, and sentence (case-insensitive)', () => {
    const bank = makeEntry({
      word: 'Bank',
      senses: [
        sense({
          definition: 'financial institution',
          translation: 'ngân hàng',
          sentence: 'the river bank',
        }),
      ],
    });
    const cat = makeEntry({ word: 'cat' });
    const byTranslation: WordsFilterState = { ...DEFAULT_WORDS_FILTER, query: 'NGÂN' };
    expect(filterAndSortSavedWords([bank, cat], byTranslation)).toEqual([bank]);
    const byWord: WordsFilterState = { ...DEFAULT_WORDS_FILTER, query: 'CAT' };
    expect(filterAndSortSavedWords([bank, cat], byWord)).toEqual([cat]);
    const noMatch: WordsFilterState = { ...DEFAULT_WORDS_FILTER, query: 'zzz-nope' };
    expect(filterAndSortSavedWords([bank, cat], noMatch)).toEqual([]);
  });

  it('filterAndSortSavedWords filters by status', () => {
    const learning = makeEntry({ word: 'a', status: 'learning' });
    const known = makeEntry({ word: 'b', status: 'known' });
    expect(
      filterAndSortSavedWords([learning, known], { ...DEFAULT_WORDS_FILTER, status: 'known' }),
    ).toEqual([known]);
    expect(
      filterAndSortSavedWords([learning, known], { ...DEFAULT_WORDS_FILTER, status: 'all' }),
    ).toHaveLength(2);
  });

  it('filterAndSortSavedWords filters by site, including the UNKNOWN_SITE bucket', () => {
    const withSite = makeEntry({ word: 'a', senses: [sense({ url: 'https://a.com' })] });
    const withoutSite = makeEntry({ word: 'b', senses: [sense({ url: '' })] });
    expect(
      filterAndSortSavedWords([withSite, withoutSite], { ...DEFAULT_WORDS_FILTER, site: 'a.com' }),
    ).toEqual([withSite]);
    expect(
      filterAndSortSavedWords([withSite, withoutSite], {
        ...DEFAULT_WORDS_FILTER,
        site: UNKNOWN_SITE,
      }),
    ).toEqual([withoutSite]);
  });

  it('filterAndSortSavedWords sorts newest-first by default', () => {
    const older = makeEntry({ word: 'a', savedAt: 1 });
    const newer = makeEntry({ word: 'b', savedAt: 2 });
    expect(filterAndSortSavedWords([older, newer], DEFAULT_WORDS_FILTER)).toEqual([newer, older]);
  });

  it('filterAndSortSavedWords sorts oldest-first', () => {
    const older = makeEntry({ word: 'a', savedAt: 1 });
    const newer = makeEntry({ word: 'b', savedAt: 2 });
    expect(
      filterAndSortSavedWords([newer, older], { ...DEFAULT_WORDS_FILTER, sort: 'oldest' }),
    ).toEqual([older, newer]);
  });

  it('filterAndSortSavedWords sorts alphabetically by word', () => {
    const b = makeEntry({ word: 'banana', savedAt: 1 });
    const a = makeEntry({ word: 'apple', savedAt: 2 });
    expect(filterAndSortSavedWords([b, a], { ...DEFAULT_WORDS_FILTER, sort: 'alpha' })).toEqual([
      a,
      b,
    ]);
  });

  it('filterAndSortSavedWords composes query + status + site + sort together', () => {
    const match = makeEntry({
      word: 'bank',
      status: 'learning',
      savedAt: 5,
      senses: [sense({ definition: 'money', url: 'https://x.com' })],
    });
    const wrongStatus = makeEntry({
      word: 'bankroll',
      status: 'known',
      savedAt: 6,
      senses: [sense({ definition: 'money', url: 'https://x.com' })],
    });
    const wrongSite = makeEntry({
      word: 'banking',
      status: 'learning',
      savedAt: 7,
      senses: [sense({ definition: 'money', url: 'https://y.com' })],
    });
    const filter: WordsFilterState = {
      query: 'money',
      status: 'learning',
      site: 'x.com',
      sort: 'newest',
    };
    expect(filterAndSortSavedWords([match, wrongStatus, wrongSite], filter)).toEqual([match]);
  });
});
