import { describe, it, expect } from 'vitest';
import { buildHistoryExport } from '../../src/app/history-export';
import type { HistoryEntry } from '../../src/domain/types';

const entry: HistoryEntry = {
  id: 'abc-123',
  word: 'serendipity',
  context: 'a happy accident',
  result: {
    markdown: '# serendipity',
    word: 'serendipity',
    target: 'vi',
    model: 'gemini-2.5-flash',
    fromCache: false,
    fetchedAt: 1700000000000,
  },
  createdAt: 1700000000000,
};

describe('buildHistoryExport', () => {
  it('returns a stable .json filename', () => {
    const { filename } = buildHistoryExport([entry]);
    expect(filename).toBe('ai-dict-history.json');
  });

  it('serializes entries as pretty JSON that round-trips', () => {
    const { json } = buildHistoryExport([entry]);
    const parsed = JSON.parse(json) as { entries: HistoryEntry[] };
    expect(parsed.entries).toEqual([entry]);
    // Pretty-printed (indented) so a human can read the file.
    expect(json).toContain('\n  ');
  });

  it('handles an empty history', () => {
    const { json } = buildHistoryExport([]);
    expect(JSON.parse(json)).toEqual({ entries: [] });
  });

  it('never leaks an apiKey into the export payload', () => {
    // Even if a stray key-like field rode along on an entry, it must not survive.
    const tainted = {
      ...entry,
      apiKey: 'AIza-should-never-appear',
    } as unknown as HistoryEntry;
    const { json } = buildHistoryExport([tainted]);
    expect(json).not.toContain('apiKey');
    expect(json).not.toContain('AIza-should-never-appear');
  });
});
