import { describe, it, expect } from 'vitest';
import { normalize, classifyPrefix, hintFor } from '../src/domain/key-hygiene';

describe('normalize', () => {
  it('trims plain surrounding whitespace', () => {
    expect(normalize('  AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ01234  ')).toBe(
      'AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ01234',
    );
  });
  it('trims a trailing newline from a copy-paste', () => {
    expect(normalize('AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ01234\n')).toBe(
      'AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ01234',
    );
  });
  it('strips one layer of straight double quotes', () => {
    expect(normalize('"AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ01234"')).toBe(
      'AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ01234',
    );
  });
  it('strips one layer of straight single quotes', () => {
    expect(normalize("'AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ01234'")).toBe(
      'AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ01234',
    );
  });
  it('strips one layer of smart double quotes', () => {
    expect(normalize('“AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ01234”')).toBe(
      'AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ01234',
    );
  });
  it('strips one layer of smart single quotes', () => {
    expect(normalize('‘AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ01234’')).toBe(
      'AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ01234',
    );
  });
  it('strips wrapping quotes AND re-trims inner whitespace', () => {
    expect(normalize('  "  AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ01234  "  ')).toBe(
      'AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ01234',
    );
  });
  it('leaves an unquoted key untouched', () => {
    expect(normalize('AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ01234')).toBe(
      'AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ01234',
    );
  });
  it('leaves a key with a non-wrapping internal quote untouched', () => {
    expect(normalize('AIza"mid"key')).toBe('AIza"mid"key');
  });
  it('returns an empty string unchanged', () => {
    expect(normalize('')).toBe('');
  });
});

describe('classifyPrefix', () => {
  it('classifies AIza… as gemini', () => {
    expect(classifyPrefix('AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ01234')).toBe('gemini');
  });
  it('classifies sk-ant-… as anthropic', () => {
    expect(classifyPrefix('sk-ant-api03-abcdefghijklmnopqrstuvwxyz')).toBe('anthropic');
  });
  it('classifies sk-… (no -ant-) as openai', () => {
    expect(classifyPrefix('sk-ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefgh')).toBe('openai');
  });
  it('never misclassifies an anthropic key as openai (ordering regression guard)', () => {
    expect(classifyPrefix('sk-ant-zzzzzzzzzzzzzzzzzzzzzzzz')).not.toBe('openai');
  });
  it('classifies unrecognized text as unknown', () => {
    expect(classifyPrefix('not-a-real-key-at-all')).toBe('unknown');
  });
  it('classifies an empty string as unknown', () => {
    expect(classifyPrefix('')).toBe('unknown');
  });
});

describe('hintFor', () => {
  const GEMINI_KEY = 'AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ01234'; // 39 chars, realistic length
  const OPENAI_KEY = 'sk-ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnop'; // >20 chars
  const ANTHROPIC_KEY = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789'; // >20 chars

  it('returns null for a matching prefix at a plausible length', () => {
    expect(hintFor('gemini', GEMINI_KEY)).toBeNull();
    expect(hintFor('openai', OPENAI_KEY)).toBeNull();
    expect(hintFor('anthropic', ANTHROPIC_KEY)).toBeNull();
  });
  it("returns null for an empty key (that is the caller's own required-field check)", () => {
    expect(hintFor('gemini', '')).toBeNull();
  });

  const MISMATCH_PAIRS: Array<[import('../src/domain/types').Provider, string, string]> = [
    ['openai', GEMINI_KEY, 'Gemini'],
    ['anthropic', GEMINI_KEY, 'Gemini'],
    ['gemini', OPENAI_KEY, 'OpenAI'],
    ['anthropic', OPENAI_KEY, 'OpenAI'],
    ['gemini', ANTHROPIC_KEY, 'Anthropic (Claude)'],
    ['openai', ANTHROPIC_KEY, 'Anthropic (Claude)'],
  ];
  it.each(MISMATCH_PAIRS)(
    'flags a recognized-but-wrong-provider key (target=%s)',
    (target, key, expectLabel) => {
      const hint = hintFor(target, key);
      expect(hint).not.toBeNull();
      expect(hint!.tone).toBe('warning');
      expect(hint!.message).toContain(expectLabel);
      expect(hint!.message).not.toContain(key); // S1: never echo the key itself
    },
  );

  it('flags an unrecognized, implausibly short key as malformed', () => {
    const hint = hintFor('gemini', 'abc123');
    expect(hint).not.toBeNull();
    expect(hint!.message).toMatch(/typical Gemini API key/);
    expect(hint!.message).not.toContain('abc123');
  });
  it('does not flag an unrecognized but plausible-length key', () => {
    expect(hintFor('gemini', 'x'.repeat(30))).toBeNull();
  });
  it('flags a matching prefix that is still implausibly short', () => {
    const hint = hintFor('gemini', 'AIza');
    expect(hint).not.toBeNull();
    expect(hint!.message).toMatch(/typical Gemini API key/);
  });
  it('flags a key containing internal whitespace as malformed regardless of length', () => {
    const hint = hintFor('gemini', 'AIzaSy ABCDEFGHIJKLMNOPQRSTUVWXYZ01234');
    expect(hint).not.toBeNull();
    expect(hint!.message).toMatch(/typical Gemini API key/);
  });
});
