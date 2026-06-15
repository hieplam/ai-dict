import { describe, it, expect } from 'vitest';
import { renderTemplate, buildPrompt } from '../src/domain/prompt-template';
import { DEFAULT_OUTPUT_FORMAT } from '../src/domain/default-template';

describe('renderTemplate', () => {
  const vars = {
    word: 'bank',
    context: 'river bank',
    target_lang: 'Vietnamese',
    source_lang: 'English',
    url: 'http://x',
    title: 'T',
  };

  it('substitutes only placeholders present in the template', () => {
    expect(renderTemplate('Define {word} in {target_lang}', vars)).toBe(
      'Define bank in Vietnamese',
    );
  });
  it('does NOT inject {url}/{title} when the template omits them (data minimization)', () => {
    const out = renderTemplate('{word}|{context}', vars);
    expect(out).toBe('bank|river bank');
    expect(out).not.toContain('http://x');
  });
  it('defaults {source_lang} to English when not supplied', () => {
    expect(renderTemplate('{source_lang}', { word: '', context: '', target_lang: 'vi' })).toBe(
      'English',
    );
  });
  it('leaves unknown placeholders untouched', () => {
    expect(renderTemplate('{nope}', vars)).toBe('{nope}');
  });
  it('leaves supported placeholder intact when its key is absent from vars (supported-but-absent boundary)', () => {
    // {url} is a supported name but is not present in the vars object.
    // The fallback `value ?? match` must preserve the literal placeholder, not inject undefined/empty.
    const result = renderTemplate('{url}', { word: 'x', context: '', target_lang: 'vi' });
    expect(result).toBe('{url}');
  });
});

describe('buildPrompt', () => {
  const vars = {
    word: 'bank',
    context: 'I sat on the grassy bank of the river.',
    target_lang: 'Vietnamese',
  };

  it('injects the selected word and its sentence context', () => {
    const out = buildPrompt('1. define it', vars);
    expect(out).toContain('bank');
    expect(out).toContain('I sat on the grassy bank of the river.');
  });

  it('wraps the user format inside the code-owned envelope', () => {
    const out = buildPrompt('1. define it', vars);
    expect(out).toContain('1. define it'); // the user's format
    expect(out).toContain('You are a bilingual dictionary'); // the envelope persona
  });

  it('always emits the constraints, even when the format is blank', () => {
    const out = buildPrompt('', vars);
    expect(out).toContain('Do not include any HTML');
  });

  it('resolves {target_lang} written inside the user format (insert-then-render order)', () => {
    const out = buildPrompt('Translate to {target_lang}', vars);
    expect(out).toContain('Translate to Vietnamese');
  });

  it('does not leak the {output_format} slot into the final prompt', () => {
    expect(buildPrompt('1. define it', vars)).not.toContain('{output_format}');
  });

  it('renders the shipped default format end-to-end', () => {
    const out = buildPrompt(DEFAULT_OUTPUT_FORMAT, vars);
    expect(out).toContain('Eng -> Eng');
    expect(out).toContain('Eng -> Vietnamese'); // {target_lang} inside the default resolved
    expect(out).toContain('bank');
  });

  it('redacts PII in the page title before it reaches the prompt', () => {
    const out = buildPrompt(DEFAULT_OUTPUT_FORMAT, {
      ...vars,
      title: 'Invoice for john@acme.com - Gmail',
    });
    expect(out).toContain('Page title: "Invoice for [redact] - Gmail"');
    expect(out).not.toContain('john@acme.com');
  });
});
