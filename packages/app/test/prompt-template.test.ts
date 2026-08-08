import { describe, it, expect } from 'vitest';
import { renderTemplate, buildPrompt } from '../src/domain/prompt-template';
import { DEFAULT_OUTPUT_FORMAT, REFINE_INSTRUCTIONS } from '../src/domain/default-template';
import type { RefineKind } from '../src/domain/types';

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

describe('buildPrompt with a custom envelope (advanced override)', () => {
  const vars = { word: 'w', context: 'c', target_lang: 'vi' };
  it('uses the custom envelope and still inserts {output_format}', () => {
    const out = buildPrompt('FMT', vars, 'ENV {word} >>{output_format}<<');
    expect(out).toBe('ENV w >>FMT<<');
  });
  it('a custom envelope without {output_format} is the complete prompt (outputFormat unused)', () => {
    const out = buildPrompt('FMT', vars, 'Only {word} in {target_lang}');
    expect(out).toBe('Only w in vi');
    expect(out).not.toContain('FMT');
  });
  it('empty/blank envelope falls back to the default envelope', () => {
    expect(buildPrompt('FMT', vars, '')).toBe(buildPrompt('FMT', vars));
    expect(buildPrompt('FMT', vars, '   ')).toBe(buildPrompt('FMT', vars));
  });
  it('redactPII still masks the title with a custom envelope', () => {
    const out = buildPrompt('F', { ...vars, title: 'mail me a@b.com' }, 'T:{title}');
    expect(out).toBe('T:mail me [redact]');
  });
});

describe('buildPrompt idiom instruction (A8)', () => {
  const vars = { word: 'bucket', context: 'He kicked the bucket.', target_lang: 'Vietnamese' };

  it('default (no forceLiteral) emits the auto-detect idiom instruction', () => {
    const out = buildPrompt('1. define it', vars);
    expect(out).toContain('DEFINED_AS:');
    expect(out).toContain('is part of an idiom');
  });

  it('forceLiteral=true emits the force-literal instruction, not the auto-detect one', () => {
    const out = buildPrompt('1. define it', vars, undefined, true);
    expect(out).toContain('DEFINED_AS:');
    expect(out).toContain('Define ONLY the literal');
    expect(out).not.toContain('is part of an idiom');
  });

  it('does not leak the {idiom_instruction} slot into the final prompt', () => {
    expect(buildPrompt('1. define it', vars)).not.toContain('{idiom_instruction}');
  });

  it('a custom envelope without {idiom_instruction} is unaffected by forceLiteral', () => {
    const withFlag = buildPrompt('FMT', vars, 'ENV {word}', true);
    const without = buildPrompt('FMT', vars, 'ENV {word}', false);
    expect(withFlag).toBe(without);
    expect(withFlag).toBe('ENV bucket');
  });

  it('a custom envelope WITH {idiom_instruction} still resolves the nested {word}', () => {
    const out = buildPrompt('FMT', vars, 'E {idiom_instruction}');
    expect(out).toContain('DEFINED_AS: "bucket" | literal'); // resolved inside the instruction text
  });
});

describe('buildPrompt translation instruction (B2)', () => {
  const vars = { word: 'bank', context: 'river bank', target_lang: 'Vietnamese' };

  it('emits a TRANSLATION instruction alongside DEFINED_AS by default', () => {
    const out = buildPrompt('1. define it', vars);
    expect(out).toContain('TRANSLATION:');
  });

  it('does not leak the {translation_instruction} slot into the final prompt', () => {
    expect(buildPrompt('1. define it', vars)).not.toContain('{translation_instruction}');
  });

  it('a custom envelope without {translation_instruction} is unaffected (opt-out, mirrors the idiom slot)', () => {
    const out = buildPrompt('FMT', vars, 'ENV {word}');
    expect(out).toBe('ENV bank');
    expect(out).not.toContain('TRANSLATION:');
  });

  it('a custom envelope WITH {translation_instruction} resolves the nested {word}/{target_lang}', () => {
    const out = buildPrompt('FMT', vars, 'E {translation_instruction}');
    expect(out).toContain('TRANSLATION:');
    expect(out).toContain('bank');
    expect(out).toContain('Vietnamese');
  });
});

describe('buildPrompt (A3 refine slot)', () => {
  const vars = {
    word: 'bank',
    context: 'I sat on the grassy bank of the river.',
    target_lang: 'Vietnamese',
  };

  it('with no refine argument, the prompt contains none of the REFINE_INSTRUCTIONS texts', () => {
    const out = buildPrompt('FMT', vars);
    for (const text of Object.values(REFINE_INSTRUCTIONS)) {
      expect(out).not.toContain(text.replace(/\{word\}/g, 'bank'));
    }
  });

  it('buildPrompt(..., undefined, undefined, "simpler") includes the simpler instruction and no other', () => {
    const out = buildPrompt('FMT', vars, undefined, undefined, 'simpler');
    expect(out).toContain(REFINE_INSTRUCTIONS.simpler);
    expect(out).not.toContain(REFINE_INSTRUCTIONS.examples.replace(/\{word\}/g, 'bank'));
    expect(out).not.toContain(REFINE_INSTRUCTIONS.etymology);
    expect(out).not.toContain(REFINE_INSTRUCTIONS.usage.replace(/\{word\}/g, 'bank'));
  });

  it('each of the 4 refine kinds produces its own distinct instruction', () => {
    for (const kind of Object.keys(REFINE_INSTRUCTIONS) as RefineKind[]) {
      const out = buildPrompt('FMT', vars, undefined, undefined, kind);
      expect(out).toContain(REFINE_INSTRUCTIONS[kind].replace(/\{word\}/g, 'bank'));
    }
  });

  it('a custom envelope without {refine_instruction} is unaffected by a refine value', () => {
    const envelope = 'ENV {word} >>{output_format}<<';
    expect(buildPrompt('FMT', vars, envelope, undefined, 'simpler')).toBe(
      buildPrompt('FMT', vars, envelope),
    );
  });
});
