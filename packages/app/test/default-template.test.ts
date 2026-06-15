import { describe, it, expect } from 'vitest';
import { PROMPT_ENVELOPE, DEFAULT_OUTPUT_FORMAT } from '../src/domain/default-template';

describe('PROMPT_ENVELOPE', () => {
  it('carries the system placeholders the code injects', () => {
    expect(PROMPT_ENVELOPE).toContain('{word}');
    expect(PROMPT_ENVELOPE).toContain('{context}');
    expect(PROMPT_ENVELOPE).toContain('{title}');
    expect(PROMPT_ENVELOPE).toContain('{target_lang}');
    expect(PROMPT_ENVELOPE).toContain('{output_format}');
  });
  it('owns the safety constraints (so a user cannot delete them)', () => {
    expect(PROMPT_ENVELOPE).toContain('Do not include any HTML');
  });
  it('does NOT reference {url} (data minimization — the page URL is never sent)', () => {
    expect(PROMPT_ENVELOPE).not.toContain('{url}');
  });
});

describe('DEFAULT_OUTPUT_FORMAT', () => {
  it('describes the two ordered card sections', () => {
    expect(DEFAULT_OUTPUT_FORMAT).toContain('Eng -> Eng');
    expect(DEFAULT_OUTPUT_FORMAT).toContain('Eng -> {target_lang}');
  });
  it('holds ONLY the layout — no persona or constraints leaked into the user field', () => {
    expect(DEFAULT_OUTPUT_FORMAT).not.toContain('bilingual dictionary');
    expect(DEFAULT_OUTPUT_FORMAT).not.toContain('Do not include any HTML');
  });
});
