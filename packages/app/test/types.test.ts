import { describe, it, expect } from 'vitest';
import { hasKeyFor } from '../src';
import type { Settings, PublicSettings } from '../src';

describe('Settings public shape (FIX 1 — contract lock)', () => {
  it('Settings is importable from @ai-dict/app and has the full shape', () => {
    // Constructs a value matching the full Settings interface to lock the shape.
    const s: Settings = {
      targetLang: 'vi',
      promptTemplate: '{word}',
      hasKey: true,
      apiKey: 'AIzaFake',
      cacheEnabled: true,
      saveHistory: false,
      theme: 'light',
      provider: 'gemini',
      openaiApiKey: '',
    };
    expect(s.targetLang).toBe('vi');
    expect(s.promptTemplate).toBe('{word}');
    expect(s.hasKey).toBe(true);
    expect(s.apiKey).toBe('AIzaFake');
    expect(s.cacheEnabled).toBe(true);
    expect(s.saveHistory).toBe(false);
    expect(s.provider).toBe('gemini');
    expect(s.openaiApiKey).toBe('');
  });

  it('[type-level] apiKey is NOT a key of PublicSettings', () => {
    // PublicSettings must not expose apiKey — enforced at the type level.
    type HasApiKey = 'apiKey' extends keyof PublicSettings ? true : false;
    const _assert: HasApiKey = false as const;
    void _assert; // value-level assertion: false satisfies HasApiKey only if apiKey is not a key
    expect(true).toBe(true); // runtime marker so the test registers
  });

  it('[type-level] openaiApiKey is NOT a key of PublicSettings (S1 holds for both secrets)', () => {
    type HasOpenAIKey = 'openaiApiKey' extends keyof PublicSettings ? true : false;
    const _assert: HasOpenAIKey = false as const;
    void _assert;
    expect(true).toBe(true);
  });
});

describe('hasKeyFor — hasKey derives from the selected provider', () => {
  it('gemini selected → only the Gemini key counts', () => {
    expect(hasKeyFor({ provider: 'gemini', apiKey: 'AIza', openaiApiKey: '' })).toBe(true);
    expect(hasKeyFor({ provider: 'gemini', apiKey: '', openaiApiKey: 'sk-x' })).toBe(false);
  });

  it('openai selected → only the OpenAI key counts', () => {
    expect(hasKeyFor({ provider: 'openai', apiKey: 'AIza', openaiApiKey: '' })).toBe(false);
    expect(hasKeyFor({ provider: 'openai', apiKey: '', openaiApiKey: 'sk-x' })).toBe(true);
  });

  it('settings stored before the provider field existed read as Gemini', () => {
    expect(hasKeyFor({ apiKey: 'AIza' })).toBe(true);
    expect(hasKeyFor({})).toBe(false);
  });
});
