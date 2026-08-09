import { describe, it, expect } from 'vitest';
import { SOURCE_LANG_CODES, primarySubtag, detectSourceLangCode } from '../src/domain/source-lang';

describe('primarySubtag', () => {
  it('lowercases and strips a regional/script suffix', () => {
    expect(primarySubtag('FR-ca')).toBe('fr');
    expect(primarySubtag('en-US')).toBe('en');
    expect(primarySubtag('zh_Hans')).toBe('zh');
  });
  it('returns the tag unchanged (lowercased) when there is no suffix', () => {
    expect(primarySubtag('ja')).toBe('ja');
  });
});

describe('detectSourceLangCode', () => {
  it('returns undefined for undefined/empty input', () => {
    expect(detectSourceLangCode(undefined)).toBeUndefined();
    expect(detectSourceLangCode('')).toBeUndefined();
  });
  it('returns undefined for an unrecognized tag', () => {
    expect(detectSourceLangCode('xx')).toBeUndefined();
    expect(detectSourceLangCode('klingon')).toBeUndefined();
  });
  it('recognizes every code in SOURCE_LANG_CODES verbatim', () => {
    for (const code of SOURCE_LANG_CODES) {
      expect(detectSourceLangCode(code)).toBe(code);
    }
  });
  it('recognizes a regional variant by its primary subtag', () => {
    expect(detectSourceLangCode('en-US')).toBe('en');
    expect(detectSourceLangCode('FR-CA')).toBe('fr');
  });
  it('includes English as a recognized code (explicit, not a no-op exclusion)', () => {
    expect(SOURCE_LANG_CODES).toContain('en');
    expect(detectSourceLangCode('en')).toBe('en');
  });
});
