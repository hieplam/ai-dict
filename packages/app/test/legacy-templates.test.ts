import { describe, it, expect } from 'vitest';
import { resolvePromptEnvelope, LEGACY_DEFAULT_TEMPLATES } from '../src/domain/legacy-templates';

describe('resolvePromptEnvelope', () => {
  it('explicit promptEnvelope wins over legacy', () => {
    expect(resolvePromptEnvelope({ promptEnvelope: 'E', promptTemplate: 'L' })).toBe('E');
  });
  it('legacy custom template becomes the envelope', () => {
    expect(resolvePromptEnvelope({ promptTemplate: 'my custom {word} prompt' })).toBe(
      'my custom {word} prompt',
    );
  });
  it('legacy value equal to a shipped default is ignored', () => {
    for (const d of LEGACY_DEFAULT_TEMPLATES)
      expect(resolvePromptEnvelope({ promptTemplate: d })).toBe('');
    expect(resolvePromptEnvelope({ promptTemplate: `  ${LEGACY_DEFAULT_TEMPLATES[0]}\n` })).toBe(
      '',
    );
  });
  it('absent/empty inputs resolve to empty (built-in envelope)', () => {
    expect(resolvePromptEnvelope({})).toBe('');
    expect(resolvePromptEnvelope({ promptTemplate: '   ' })).toBe('');
  });
});
