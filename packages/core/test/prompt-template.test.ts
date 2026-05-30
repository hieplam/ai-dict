import { describe, it, expect } from 'vitest';
import { renderTemplate } from '../src/prompt-template';

describe('renderTemplate', () => {
  const vars = { word: 'bank', context: 'river bank', target_lang: 'Vietnamese', source_lang: 'English', url: 'http://x', title: 'T' };

  it('substitutes only placeholders present in the template', () => {
    expect(renderTemplate('Define {word} in {target_lang}', vars)).toBe('Define bank in Vietnamese');
  });
  it('does NOT inject {url}/{title} when the template omits them (data minimization)', () => {
    const out = renderTemplate('{word}|{context}', vars);
    expect(out).toBe('bank|river bank');
    expect(out).not.toContain('http://x');
  });
  it('defaults {source_lang} to English when not supplied', () => {
    expect(renderTemplate('{source_lang}', { word: '', context: '', target_lang: 'vi' })).toBe('English');
  });
  it('leaves unknown placeholders untouched', () => {
    expect(renderTemplate('{nope}', vars)).toBe('{nope}');
  });
});
