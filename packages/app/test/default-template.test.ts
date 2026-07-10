import { describe, it, expect } from 'vitest';
import {
  PROMPT_ENVELOPE,
  DEFAULT_OUTPUT_FORMAT,
  IDIOM_AUTO_INSTRUCTION,
  IDIOM_FORCE_LITERAL_INSTRUCTION,
} from '../src/domain/default-template';

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

describe('PROMPT_ENVELOPE (A8 idiom slot)', () => {
  it('carries the {idiom_instruction} placeholder', () => {
    expect(PROMPT_ENVELOPE).toContain('{idiom_instruction}');
  });
});

describe('IDIOM_AUTO_INSTRUCTION / IDIOM_FORCE_LITERAL_INSTRUCTION', () => {
  it('the auto instruction asks the model to emit a DEFINED_AS line and mentions {word}', () => {
    expect(IDIOM_AUTO_INSTRUCTION).toContain('DEFINED_AS:');
    expect(IDIOM_AUTO_INSTRUCTION).toContain('{word}');
    expect(IDIOM_AUTO_INSTRUCTION).toContain('idiom');
  });
  it('the force-literal instruction asks for the literal reading only and still emits DEFINED_AS', () => {
    expect(IDIOM_FORCE_LITERAL_INSTRUCTION).toContain('DEFINED_AS:');
    expect(IDIOM_FORCE_LITERAL_INSTRUCTION).toContain('{word}');
    expect(IDIOM_FORCE_LITERAL_INSTRUCTION.toLowerCase()).toContain('literal');
  });
});
