import { describe, it, expect } from 'vitest';
import {
  evaluateNudge,
  nudgeAlreadyShown,
  nudgeMarkShown,
  NUDGE_THRESHOLD,
  NUDGE_WINDOW_MS,
} from '../src/domain/nudge-policy';
import { historyAppend } from '../src/domain/history-policy';
import type { Storage, HistoryEntry } from '../src';

function memStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => Promise.resolve(m.get(k) ?? null),
    setItem: (k, v) => {
      m.set(k, v);
      return Promise.resolve();
    },
    removeItem: (k) => {
      m.delete(k);
      return Promise.resolve();
    },
    keys: (p) => Promise.resolve([...m.keys()].filter((k) => !p || k.startsWith(p))),
  };
}

function historyEntry(id: string, word: string, createdAt: number): HistoryEntry {
  return {
    id,
    word,
    context: '',
    createdAt,
    result: {
      markdown: '',
      word,
      target: 'vi',
      model: 'gemini-2.5-flash',
      fromCache: false,
      fetchedAt: createdAt,
    },
  };
}

describe('nudge-policy', () => {
  it('NUDGE_THRESHOLD is 3 and NUDGE_WINDOW_MS is 30 days', () => {
    expect(NUDGE_THRESHOLD).toBe(3);
    expect(NUDGE_WINDOW_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it('returns false below the threshold', async () => {
    const s = memStorage();
    await historyAppend({ storage: s }, historyEntry('1', 'bank', 1000));
    await historyAppend({ storage: s }, historyEntry('2', 'bank', 2000));
    expect(await evaluateNudge({ storage: s, now: () => 3000 }, 'bank')).toBe(false);
  });

  it('returns true exactly when the within-window count first reaches 3', async () => {
    const s = memStorage();
    await historyAppend({ storage: s }, historyEntry('1', 'bank', 1000));
    await historyAppend({ storage: s }, historyEntry('2', 'bank', 2000));
    await historyAppend({ storage: s }, historyEntry('3', 'bank', 3000));
    expect(await evaluateNudge({ storage: s, now: () => 3000 }, 'bank')).toBe(true);
  });

  it('never fires again for the same word once marked, even as the count keeps growing', async () => {
    const s = memStorage();
    await historyAppend({ storage: s }, historyEntry('1', 'bank', 1000));
    await historyAppend({ storage: s }, historyEntry('2', 'bank', 2000));
    await historyAppend({ storage: s }, historyEntry('3', 'bank', 3000));
    expect(await evaluateNudge({ storage: s, now: () => 3000 }, 'bank')).toBe(true);
    await historyAppend({ storage: s }, historyEntry('4', 'bank', 4000));
    expect(await evaluateNudge({ storage: s, now: () => 4000 }, 'bank')).toBe(false);
  });

  it('excludes entries older than the 30-day window from the count', async () => {
    const s = memStorage();
    const day = 24 * 60 * 60 * 1000;
    await historyAppend({ storage: s }, historyEntry('1', 'bank', 0));
    await historyAppend({ storage: s }, historyEntry('2', 'bank', 31 * day));
    await historyAppend({ storage: s }, historyEntry('3', 'bank', 31 * day + 1000));
    const now = 31 * day + 2000; // entry '1' (t=0) is now 31+ days old — outside the window
    expect(await evaluateNudge({ storage: s, now: () => now }, 'bank')).toBe(false);
  });

  it('word matching is case-insensitive (reuses saved-words-policy normalizeWordKey)', async () => {
    const s = memStorage();
    await historyAppend({ storage: s }, historyEntry('1', 'Bank', 1000));
    await historyAppend({ storage: s }, historyEntry('2', 'bank', 2000));
    await historyAppend({ storage: s }, historyEntry('3', 'BANK', 3000));
    expect(await evaluateNudge({ storage: s, now: () => 3000 }, 'bank')).toBe(true);
  });

  it('does not mix counts across different words', async () => {
    const s = memStorage();
    await historyAppend({ storage: s }, historyEntry('1', 'bank', 1000));
    await historyAppend({ storage: s }, historyEntry('2', 'shore', 2000));
    await historyAppend({ storage: s }, historyEntry('3', 'shore', 3000));
    expect(await evaluateNudge({ storage: s, now: () => 3000 }, 'shore')).toBe(false);
  });

  it('nudgeAlreadyShown / nudgeMarkShown round-trip, case-insensitive', async () => {
    const s = memStorage();
    expect(await nudgeAlreadyShown({ storage: s }, 'Bank')).toBe(false);
    await nudgeMarkShown({ storage: s }, 'Bank');
    expect(await nudgeAlreadyShown({ storage: s }, 'bank')).toBe(true);
  });

  it('evaluateNudge persists the marker under the nudge: prefix, independent of saved:/history:', async () => {
    const s = memStorage();
    await historyAppend({ storage: s }, historyEntry('1', 'bank', 1000));
    await historyAppend({ storage: s }, historyEntry('2', 'bank', 2000));
    await historyAppend({ storage: s }, historyEntry('3', 'bank', 3000));
    await evaluateNudge({ storage: s, now: () => 3000 }, 'bank');
    expect(await s.getItem('nudge:bank')).not.toBeNull();
    expect(await s.getItem('saved:bank')).toBeNull();
  });
});
