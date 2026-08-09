import { describe, it, expect } from 'vitest';
import { buildReviewDeck, REVIEW_WINDOW_DAYS } from '../src/domain/review-deck-policy';
import type { SavedWordEntry } from '../src';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = 1_700_000_000_000;

function entry(over: Partial<SavedWordEntry> & { word: string }): SavedWordEntry {
  return {
    word: over.word,
    status: over.status ?? 'learning',
    savedAt: over.savedAt ?? NOW,
    senses: over.senses ?? [
      {
        definition: `${over.word} definition`,
        translation: '',
        sentence: `A sentence with ${over.word} in it.`,
        url: 'https://example.com',
        title: 'Example',
      },
    ],
  };
}

describe('buildReviewDeck', () => {
  it('includes a learning word saved exactly REVIEW_WINDOW_DAYS ago (inclusive boundary)', () => {
    const e = entry({ word: 'bank', savedAt: NOW - REVIEW_WINDOW_DAYS * DAY_MS });
    const deck = buildReviewDeck([e], { nowMs: NOW, shuffle: (a) => a });
    expect(deck).toEqual([e]);
  });

  it('excludes a learning word saved 1ms past the window', () => {
    const e = entry({ word: 'bank', savedAt: NOW - REVIEW_WINDOW_DAYS * DAY_MS - 1 });
    const deck = buildReviewDeck([e], { nowMs: NOW, shuffle: (a) => a });
    expect(deck).toEqual([]);
  });

  it('excludes a known-status word even if saved today', () => {
    const e = entry({ word: 'bank', status: 'known', savedAt: NOW });
    const deck = buildReviewDeck([e], { nowMs: NOW, shuffle: (a) => a });
    expect(deck).toEqual([]);
  });

  it('includes a learning word saved today', () => {
    const e = entry({ word: 'bank', status: 'learning', savedAt: NOW });
    const deck = buildReviewDeck([e], { nowMs: NOW, shuffle: (a) => a });
    expect(deck).toEqual([e]);
  });

  it('uses the injected shuffle function verbatim (deterministic in tests)', () => {
    const a = entry({ word: 'a', savedAt: NOW });
    const b = entry({ word: 'b', savedAt: NOW });
    const deck = buildReviewDeck([a, b], { nowMs: NOW, shuffle: (arr) => [...arr].reverse() });
    expect(deck).toEqual([b, a]);
  });

  it('defaults to a real shuffle when no override is given (still returns every eligible entry)', () => {
    const entries = ['a', 'b', 'c', 'd'].map((w) => entry({ word: w, savedAt: NOW }));
    const deck = buildReviewDeck(entries, { nowMs: NOW });
    expect(deck).toHaveLength(4);
    expect(new Set(deck.map((e) => e.word))).toEqual(new Set(['a', 'b', 'c', 'd']));
  });

  it('empty input → empty deck', () => {
    expect(buildReviewDeck([], { nowMs: NOW })).toEqual([]);
  });

  it('mixes eligible and ineligible entries correctly in one call', () => {
    const eligible = entry({ word: 'eligible', savedAt: NOW });
    const tooOld = entry({ word: 'too-old', savedAt: NOW - (REVIEW_WINDOW_DAYS + 1) * DAY_MS });
    const known = entry({ word: 'known', status: 'known', savedAt: NOW });
    const deck = buildReviewDeck([eligible, tooOld, known], { nowMs: NOW, shuffle: (a) => a });
    expect(deck).toEqual([eligible]);
  });
});
