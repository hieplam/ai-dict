import { describe, it, expect } from 'vitest';
import { DEFAULT_TEMPLATE } from '../src/domain/default-template';

describe('DEFAULT_TEMPLATE', () => {
  it('references the minimal placeholders and ordered sections', () => {
    expect(DEFAULT_TEMPLATE).toContain('{word}');
    expect(DEFAULT_TEMPLATE).toContain('{context}');
    expect(DEFAULT_TEMPLATE).toContain('{target_lang}');
  });
  it('does NOT reference {url} or {title} (data minimization — spec P2)', () => {
    expect(DEFAULT_TEMPLATE).not.toContain('{url}');
    expect(DEFAULT_TEMPLATE).not.toContain('{title}');
  });
});
