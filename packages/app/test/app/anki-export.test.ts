import { describe, it, expect } from 'vitest';
import { buildAnkiTsv, buildAnkiCsv, buildAnkiMarkdown } from '../../src/app/anki-export';
import type { SavedWordEntry } from '../../src/domain/types';

const bank: SavedWordEntry = {
  word: 'bank',
  status: 'learning',
  savedAt: 1700000000000,
  senses: [
    {
      definition: 'a financial institution',
      translation: 'ngân hàng',
      sentence: 'the river bank',
      url: 'https://example.com',
      title: 'Example',
    },
  ],
};

const twoSenses: SavedWordEntry = {
  word: 'bank',
  status: 'known',
  savedAt: 1700000000000,
  senses: [
    {
      definition: 'a financial institution',
      translation: 'ngân hàng',
      sentence: 'the river bank',
      url: 'https://example.com',
      title: 'Example',
    },
    {
      definition: 'the land alongside a river',
      translation: 'bờ sông',
      sentence: 'we sat on the bank',
      url: 'https://example.com/2',
      title: 'Example Two',
    },
  ],
};

describe('buildAnkiTsv', () => {
  it('returns a stable .tsv filename', () => {
    expect(buildAnkiTsv([bank]).filename).toBe('ai-dict-anki.tsv');
  });

  it('emits one tab-separated line per sense, in the pinned column order, no header', () => {
    const { content } = buildAnkiTsv([bank]);
    const lines = content.trimEnd().split('\n');
    expect(lines).toHaveLength(1);
    expect(lines[0]!.split('\t')).toEqual([
      'bank',
      'a financial institution',
      'ngân hàng',
      'the river bank',
      'https://example.com',
      'Example',
      new Date(1700000000000).toISOString(),
      'learning',
    ]);
  });

  it('expands a multi-sense entry into one row per sense, repeating word/savedAt/status', () => {
    const { content } = buildAnkiTsv([twoSenses]);
    const lines = content.trimEnd().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]!.split('\t')[0]).toBe('bank');
    expect(lines[1]!.split('\t')[0]).toBe('bank');
    expect(lines[0]!.split('\t')[1]).toBe('a financial institution');
    expect(lines[1]!.split('\t')[1]).toBe('the land alongside a river');
  });

  it('collapses an embedded tab/newline in a field to a space (no in-field escape in Anki TSV)', () => {
    const dirty: SavedWordEntry = {
      ...bank,
      senses: [{ ...bank.senses[0]!, definition: 'a bank\t— financial\ninstitution' }],
    };
    const { content } = buildAnkiTsv([dirty]);
    const lines = content.trimEnd().split('\n');
    expect(lines).toHaveLength(1); // the embedded newline must NOT split this into two lines
    expect(lines[0]!.split('\t')).toHaveLength(8); // the embedded tab must NOT add a 9th column
    expect(content).toContain('a bank — financial institution');
  });

  it('handles an empty saved-words list', () => {
    expect(buildAnkiTsv([]).content).toBe('');
  });

  it('never leaks an apiKey into the TSV payload', () => {
    const tainted = { ...bank, apiKey: 'AIza-should-never-appear' } as unknown as SavedWordEntry;
    const { content } = buildAnkiTsv([tainted]);
    expect(content).not.toContain('apiKey');
    expect(content).not.toContain('AIza-should-never-appear');
  });
});

describe('buildAnkiCsv', () => {
  it('returns a stable .csv filename', () => {
    expect(buildAnkiCsv([bank]).filename).toBe('ai-dict-anki.csv');
  });

  it('starts with the exact pinned header row, then one comma-separated data row per sense', () => {
    const { content } = buildAnkiCsv([bank]);
    const lines = content.trimEnd().split('\r\n');
    expect(lines[0]).toBe('word,definition,translation,sentence,url,title,savedAt,status');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe(
      `bank,a financial institution,ngân hàng,the river bank,https://example.com,Example,${new Date(
        1700000000000,
      ).toISOString()},learning`,
    );
  });

  it('quotes a field containing a comma, double quote, or newline (RFC 4180) and doubles embedded quotes', () => {
    const dirty: SavedWordEntry = {
      ...bank,
      senses: [{ ...bank.senses[0]!, definition: 'a "bank", or river edge\nsecond line' }],
    };
    const { content } = buildAnkiCsv([dirty]);
    expect(content).toContain('"a ""bank"", or river edge\nsecond line"');
  });

  it('handles an empty saved-words list (header only)', () => {
    const { content } = buildAnkiCsv([]);
    expect(content.trimEnd()).toBe('word,definition,translation,sentence,url,title,savedAt,status');
  });

  it('never leaks an apiKey into the CSV payload', () => {
    const tainted = { ...bank, apiKey: 'AIza-should-never-appear' } as unknown as SavedWordEntry;
    const { content } = buildAnkiCsv([tainted]);
    expect(content).not.toContain('apiKey');
    expect(content).not.toContain('AIza-should-never-appear');
  });
});

describe('buildAnkiMarkdown', () => {
  it('returns a stable .md filename', () => {
    expect(buildAnkiMarkdown([bank]).filename).toBe('ai-dict-anki.md');
  });

  it('renders the word as a heading and the definition verbatim', () => {
    const { content } = buildAnkiMarkdown([bank]);
    expect(content).toContain('## bank');
    expect(content).toContain('a financial institution');
    expect(content).toContain('ngân hàng');
  });

  it('renders one block per sense for a multi-sense entry', () => {
    const { content } = buildAnkiMarkdown([twoSenses]);
    expect(content.match(/## bank/g)).toHaveLength(2);
    expect(content).toContain('the land alongside a river');
  });

  it('handles an empty saved-words list', () => {
    expect(buildAnkiMarkdown([]).content).toBe('');
  });

  it('never leaks an apiKey into the Markdown payload', () => {
    const tainted = { ...bank, apiKey: 'AIza-should-never-appear' } as unknown as SavedWordEntry;
    const { content } = buildAnkiMarkdown([tainted]);
    expect(content).not.toContain('apiKey');
    expect(content).not.toContain('AIza-should-never-appear');
  });
});
