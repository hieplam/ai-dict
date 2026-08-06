import { describe, it, expect } from 'vitest';
import {
  naiveVariants,
  buildHighlightMatcher,
  findWordMatches,
} from '../src/domain/highlight-policy';

describe('naiveVariants (B3)', () => {
  it('generates the exact/plural/-ed/-ing variant set for a consonant-ending word', () => {
    // 'bankes' is a harmless over-generation from the naive '+es' rule (B3 spec: naive matching
    // only, no dictionary/lemmatizer smarts) — it is never a real English word but matching it
    // never fires because nothing in real text tokenizes to 'bankes'.
    expect(new Set(naiveVariants('bank'))).toEqual(
      new Set(['bank', 'banks', 'bankes', 'banked', 'banking']),
    );
  });

  it('generates the e-drop -ing plus +d variants for an e-ending word', () => {
    expect(new Set(naiveVariants('smile'))).toEqual(
      new Set(['smile', 'smiles', 'smilees', 'smileed', 'smiled', 'smiling']),
    );
  });

  it('lowercases the input word', () => {
    expect(naiveVariants('Bank').every((v) => v === v.toLowerCase())).toBe(true);
    expect(new Set(naiveVariants('Bank'))).toEqual(new Set(naiveVariants('bank')));
  });
});

describe('buildHighlightMatcher (B3)', () => {
  it('maps every variant of every learning word to its canonical headword', () => {
    const matcher = buildHighlightMatcher(['bank', 'smile']);
    expect(matcher.get('banking')).toBe('bank');
    expect(matcher.get('smiled')).toBe('smile');
    expect(matcher.get('bank')).toBe('bank');
    expect(matcher.get('smile')).toBe('smile');
  });
});

describe('findWordMatches (B3)', () => {
  it('finds two word-boundary matches with correct [start,end) spans and headword', () => {
    const matcher = buildHighlightMatcher(['bank']);
    const text = 'Banks on the river bank';
    const matches = findWordMatches(text, matcher);
    expect(matches).toEqual([
      { start: 0, end: 5, headword: 'bank' },
      { start: 19, end: 23, headword: 'bank' },
    ]);
    expect(text.slice(0, 5)).toBe('Banks');
    expect(text.slice(19, 23)).toBe('bank');
  });

  it('does not match a substring inside a larger word (word-boundary only)', () => {
    const matcher = buildHighlightMatcher(['bank']);
    expect(findWordMatches('embankment', matcher)).toEqual([]);
  });

  it('strips a trailing possessive before lookup so "bank\'s" resolves to bank', () => {
    const matcher = buildHighlightMatcher(['bank']);
    const text = "the bank's rate";
    const matches = findWordMatches(text, matcher);
    expect(matches).toEqual([{ start: 4, end: 10, headword: 'bank' }]);
    expect(text.slice(4, 10)).toBe("bank's");
  });

  it('returns [] for an empty matcher', () => {
    expect(findWordMatches('any text here', new Map())).toEqual([]);
  });

  it('returns [] for empty text', () => {
    const matcher = buildHighlightMatcher(['bank']);
    expect(findWordMatches('', matcher)).toEqual([]);
  });
});
