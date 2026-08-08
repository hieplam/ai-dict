import { describe, it, expect } from 'vitest';
import {
  buildBackupExport,
  parseBackupFile,
  BACKUP_FORMAT,
  BACKUP_VERSION,
} from '../../src/app/backup';
import type { HistoryEntry, SavedWordEntry } from '../../src/domain/types';

const savedWord: SavedWordEntry = {
  word: 'serendipity',
  status: 'learning',
  savedAt: 1700000000000,
  senses: [
    {
      definition: 'a happy accident',
      translation: 'sự tình cờ',
      sentence: 'It was pure serendipity.',
      url: 'https://example.com',
      title: 'Example',
    },
  ],
};

const historyItem: HistoryEntry = {
  id: 'abc-123',
  word: 'bank',
  context: 'a happy accident',
  result: {
    markdown: '# bank',
    word: 'bank',
    target: 'vi',
    model: 'gemini-2.5-flash',
    fromCache: false,
    fetchedAt: 1700000000000,
  },
  createdAt: 1700000000000,
};

const settings = {
  targetLang: 'vi',
  outputFormat: 'Define {word}',
  promptEnvelope: '',
  theme: 'sepia',
  cacheEnabled: true,
  saveHistory: true,
  provider: 'gemini',
};

describe('buildBackupExport', () => {
  it('returns a stable .json filename', () => {
    const { filename } = buildBackupExport([savedWord], [historyItem], settings, () => 1);
    expect(filename).toBe('ai-dict-backup.json');
  });

  it('produces the E2 envelope shape exactly', () => {
    const { json } = buildBackupExport([savedWord], [historyItem], settings, () => 999);
    const parsed = JSON.parse(json) as {
      format: string;
      version: number;
      exportedAt: number;
      data: { savedWords: SavedWordEntry[]; history: HistoryEntry[]; settings: typeof settings };
    };
    expect(parsed.format).toBe(BACKUP_FORMAT);
    expect(parsed.version).toBe(BACKUP_VERSION);
    expect(parsed.exportedAt).toBe(999);
    expect(parsed.data.savedWords).toEqual([savedWord]);
    expect(parsed.data.history).toEqual([historyItem]);
    expect(parsed.data.settings).toEqual(settings);
  });

  it('handles empty savedWords/history — still produces a valid file', () => {
    const { json } = buildBackupExport([], [], settings, () => 1);
    const parsed = JSON.parse(json) as { data: { savedWords: unknown[]; history: unknown[] } };
    expect(parsed.data.savedWords).toEqual([]);
    expect(parsed.data.history).toEqual([]);
  });

  it('never leaks a stray apiKey-shaped field on settings into the export', () => {
    const tainted = { ...settings, apiKey: 'AIza-should-never-appear' } as typeof settings & {
      apiKey: string;
    };
    const { json } = buildBackupExport([], [], tainted, () => 1);
    expect(json).not.toContain('apiKey');
    expect(json).not.toContain('AIza-should-never-appear');
  });
});

describe('parseBackupFile', () => {
  it('round-trips a file built by buildBackupExport', () => {
    const { json } = buildBackupExport([savedWord], [historyItem], settings, () => 1);
    const result = parseBackupFile(json);
    if (!result.ok) throw new Error('expected ok:true');
    expect(result.savedWords).toEqual([savedWord]);
    expect(result.history).toEqual([historyItem]);
    expect(result.settings).toEqual(settings);
  });

  it('rejects non-JSON text', () => {
    expect(parseBackupFile('not json{')).toEqual({
      ok: false,
      error: 'This file is not valid JSON.',
    });
  });

  it('rejects a JSON file with the wrong format', () => {
    expect(parseBackupFile(JSON.stringify({ format: 'something-else', version: 1 }))).toEqual({
      ok: false,
      error: 'This file is not a valid AI Dictionary backup.',
    });
  });

  it('rejects a version newer than this build understands', () => {
    const result = parseBackupFile(JSON.stringify({ format: BACKUP_FORMAT, version: 2 }));
    expect(result).toEqual({
      ok: false,
      error:
        'This backup was made with a newer version of AI Dictionary. Update the extension and try again.',
    });
  });

  it('defaults missing data.savedWords/data.history to empty arrays rather than throwing', () => {
    const result = parseBackupFile(JSON.stringify({ format: BACKUP_FORMAT, version: 1 }));
    if (!result.ok) throw new Error('expected ok:true');
    expect(result.savedWords).toEqual([]);
    expect(result.history).toEqual([]);
    expect(result.settings).toEqual({});
  });
});

describe('parseBackupFile — settings field-type validation (B9 fix)', () => {
  it('round-trips a well-typed settings object across all 7 fields', () => {
    const result = parseBackupFile(
      JSON.stringify({ format: BACKUP_FORMAT, version: 1, data: { settings } }),
    );
    if (!result.ok) throw new Error('expected ok:true');
    expect(result.settings).toEqual(settings);
  });

  it('drops a wrong-typed boolean field (cacheEnabled as string) instead of passing it through', () => {
    // A hand-edited/corrupt file with cacheEnabled as a truthy string ("false") must not survive
    // into the result — the overlay's `!== undefined` guard should keep the stored boolean.
    const tainted = { ...settings, cacheEnabled: 'false' };
    const result = parseBackupFile(
      JSON.stringify({ format: BACKUP_FORMAT, version: 1, data: { settings: tainted } }),
    );
    if (!result.ok) throw new Error('expected ok:true');
    expect(result.settings).not.toHaveProperty('cacheEnabled');
    const expectedRest: Record<string, unknown> = { ...settings };
    delete expectedRest['cacheEnabled'];
    expect(result.settings).toEqual(expectedRest);
  });

  it('drops a wrong-typed string field (theme as number) instead of passing it through', () => {
    const tainted = { ...settings, theme: 42 };
    const result = parseBackupFile(
      JSON.stringify({ format: BACKUP_FORMAT, version: 1, data: { settings: tainted } }),
    );
    if (!result.ok) throw new Error('expected ok:true');
    expect(result.settings).not.toHaveProperty('theme');
    const expectedRest: Record<string, unknown> = { ...settings };
    delete expectedRest['theme'];
    expect(result.settings).toEqual(expectedRest);
  });

  it('drops an unknown extra settings field', () => {
    const result = parseBackupFile(
      JSON.stringify({
        format: BACKUP_FORMAT,
        version: 1,
        data: { settings: { ...settings, extraField: 'nope' } },
      }),
    );
    if (!result.ok) throw new Error('expected ok:true');
    expect(result.settings).toEqual(settings);
    expect(result.settings).not.toHaveProperty('extraField');
  });

  it('a missing settings object still yields {}', () => {
    const result = parseBackupFile(JSON.stringify({ format: BACKUP_FORMAT, version: 1 }));
    if (!result.ok) throw new Error('expected ok:true');
    expect(result.settings).toEqual({});
  });
});
