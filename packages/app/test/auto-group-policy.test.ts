import { describe, it, expect } from 'vitest';
import {
  MAX_WORDS_TO_ORGANIZE,
  excerptDefinition,
  selectWordsToOrganize,
  buildOrganizePrompt,
  parseOrganizeResponse,
} from '../src/domain/auto-group-policy';
import type { SavedWordEntry } from '../src/domain/types';

function entry(word: string, definition: string): SavedWordEntry {
  return {
    word,
    status: 'learning',
    savedAt: 1000,
    senses: [{ definition, translation: '', sentence: 's', url: '', title: '' }],
  };
}

describe('auto-group-policy', () => {
  describe('excerptDefinition', () => {
    it('strips common markdown syntax and collapses whitespace', () => {
      expect(excerptDefinition('## bank\n\nA **financial** institution.')).toBe(
        'bank A financial institution.',
      );
    });

    it('caps length with an ellipsis when the plain text exceeds maxChars', () => {
      const long = 'word '.repeat(40).trim(); // 199 chars
      const out = excerptDefinition(long, 20);
      expect(out.length).toBe(21); // 20 chars + '…'
      expect(out.endsWith('…')).toBe(true);
    });

    it('leaves short text untouched (no trailing ellipsis)', () => {
      expect(excerptDefinition('A short one.')).toBe('A short one.');
    });
  });

  describe('selectWordsToOrganize', () => {
    it('returns every entry with skippedCount 0 when under the cap', () => {
      const entries = [entry('a', 'd'), entry('b', 'd')];
      const { selected, skippedCount } = selectWordsToOrganize(entries);
      expect(selected).toEqual(entries);
      expect(skippedCount).toBe(0);
    });

    it(`caps at ${MAX_WORDS_TO_ORGANIZE} and reports the correct skippedCount when over`, () => {
      const entries = Array.from({ length: MAX_WORDS_TO_ORGANIZE + 7 }, (_, i) =>
        entry(`w${i}`, 'd'),
      );
      const { selected, skippedCount } = selectWordsToOrganize(entries);
      expect(selected).toHaveLength(MAX_WORDS_TO_ORGANIZE);
      expect(skippedCount).toBe(7);
      // Newest-first order preserved — the FIRST MAX_WORDS_TO_ORGANIZE entries are selected.
      expect(selected[0]!.word).toBe('w0');
      expect(selected.at(-1)!.word).toBe(`w${MAX_WORDS_TO_ORGANIZE - 1}`);
    });
  });

  describe('buildOrganizePrompt', () => {
    it('embeds every selected word and its excerpted definition, numbered', () => {
      const prompt = buildOrganizePrompt([
        entry('bank', 'A financial institution.'),
        entry('serendipity', 'A fortunate accident.'),
      ]);
      expect(prompt).toContain('1. "bank" — A financial institution.');
      expect(prompt).toContain('2. "serendipity" — A fortunate accident.');
    });

    it('contains no envelope placeholder tokens (must pass through buildPrompt unmodified)', () => {
      const prompt = buildOrganizePrompt([entry('bank', 'A financial institution.')]);
      expect(prompt).not.toContain('{word}');
      expect(prompt).not.toContain('{context}');
      expect(prompt).not.toContain('{output_format}');
      expect(prompt).not.toContain('{idiom_instruction}');
      expect(prompt).not.toContain('{translation_instruction}');
    });

    it('instructs strict JSON output with the exact response shape', () => {
      const prompt = buildOrganizePrompt([entry('bank', 'A financial institution.')]);
      expect(prompt).toContain('Output ONLY strict JSON');
      expect(prompt).toContain('"tag"');
      expect(prompt).toContain('"words"');
    });
  });

  describe('parseOrganizeResponse', () => {
    const words = ['bank', 'equity', 'serendipity'];

    it('accepts a well-formed response', () => {
      const raw = JSON.stringify([
        { tag: 'Finance', words: ['bank', 'equity'] },
        { tag: 'Miscellaneous', words: ['serendipity'] },
      ]);
      expect(parseOrganizeResponse(raw, words)).toEqual([
        { tag: 'Finance', words: ['bank', 'equity'] },
        { tag: 'Miscellaneous', words: ['serendipity'] },
      ]);
    });

    it('strips a ```json fence some models wrap strict JSON in anyway', () => {
      const raw = '```json\n' + JSON.stringify([{ tag: 'Finance', words: ['bank'] }]) + '\n```';
      expect(parseOrganizeResponse(raw, words)).toEqual([{ tag: 'Finance', words: ['bank'] }]);
    });

    it('rejects malformed JSON (returns null, never throws)', () => {
      expect(parseOrganizeResponse('not json at all', words)).toBeNull();
    });

    it('rejects a response whose shape does not match (missing "words")', () => {
      const raw = JSON.stringify([{ tag: 'Finance' }]);
      expect(parseOrganizeResponse(raw, words)).toBeNull();
    });

    it('rejects the WHOLE response when it contains a word outside the valid set', () => {
      const raw = JSON.stringify([{ tag: 'Finance', words: ['bank', 'invented-word'] }]);
      expect(parseOrganizeResponse(raw, words)).toBeNull();
    });

    it('accepts a response that omits some valid words (completeness not enforced)', () => {
      const raw = JSON.stringify([{ tag: 'Finance', words: ['bank'] }]);
      expect(parseOrganizeResponse(raw, words)).toEqual([{ tag: 'Finance', words: ['bank'] }]);
    });

    it("keeps a word's FIRST group placement when the model duplicates it across groups", () => {
      const raw = JSON.stringify([
        { tag: 'Finance', words: ['bank'] },
        { tag: 'Miscellaneous', words: ['bank', 'serendipity'] },
      ]);
      expect(parseOrganizeResponse(raw, words)).toEqual([
        { tag: 'Finance', words: ['bank'] },
        { tag: 'Miscellaneous', words: ['serendipity'] },
      ]);
    });

    it('rejects a non-array top-level response', () => {
      expect(
        parseOrganizeResponse(JSON.stringify({ tag: 'Finance', words: ['bank'] }), words),
      ).toBeNull();
    });
  });
});
