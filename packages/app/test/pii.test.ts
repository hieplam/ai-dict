import { describe, it, expect } from 'vitest';
import { redactPII, PII_BLACKLIST } from '../src/domain/pii';

describe('redactPII', () => {
  it('redacts an email address', () => {
    expect(redactPII('Contact john.doe@example.com now')).toBe('Contact [redact] now');
  });
  it('redacts a US phone number', () => {
    expect(redactPII('Call 415-555-2671 today')).toBe('Call [redact] today');
  });
  it('redacts a spaced credit-card number', () => {
    expect(redactPII('Card 4111 1111 1111 1111 saved')).toBe('Card [redact] saved');
  });
  it('redacts an SSN', () => {
    expect(redactPII('SSN 123-45-6789 on file')).toBe('SSN [redact] on file');
  });
  it('redacts an IP address', () => {
    expect(redactPII('from 192.168.0.1 logged')).toBe('from [redact] logged');
  });
  it('redacts multiple, mixed PII types', () => {
    expect(redactPII('mail john@x.com or call 415-555-2671')).toBe(
      'mail [redact] or call [redact]',
    );
  });
  it('leaves clean text untouched', () => {
    expect(redactPII('Bank (geography) - Wikipedia')).toBe('Bank (geography) - Wikipedia');
  });
  it('does not flag a year range as PII', () => {
    expect(redactPII('World War II 1939-1945 - History')).toBe('World War II 1939-1945 - History');
  });
  it('returns an empty string unchanged', () => {
    expect(redactPII('')).toBe('');
  });
});

describe('PII_BLACKLIST', () => {
  it('is a typed table of global rules covering the expected categories', () => {
    const types = PII_BLACKLIST.map((r) => r.type);
    expect(types).toEqual(expect.arrayContaining(['email', 'phone', 'credit-card', 'ssn', 'ip']));
    for (const rule of PII_BLACKLIST) {
      expect(typeof rule.type).toBe('string');
      expect(rule.pattern).toBeInstanceOf(RegExp);
      expect(rule.pattern.global).toBe(true); // global flag required so replace() masks all matches
    }
  });
});
