import { describe, it, expect } from 'vitest';
import { hasKeyFor, normalizeTheme } from '../src';
import type { Settings, PublicSettings, Theme } from '../src';

describe('Settings public shape (FIX 1 — contract lock)', () => {
  it('Settings is importable from @ai-dict/app and has the full shape', () => {
    // Constructs a value matching the full Settings interface to lock the shape.
    const s: Settings = {
      targetLang: 'vi',
      outputFormat: '{word}',
      hasKey: true,
      configuredProviders: ['gemini'],
      apiKey: 'AIzaFake',
      cacheEnabled: true,
      saveHistory: false,
      theme: 'sepia',
      provider: 'gemini',
      openaiApiKey: '',
      anthropicApiKey: '',
    };
    expect(s.targetLang).toBe('vi');
    expect(s.outputFormat).toBe('{word}');
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

describe('normalizeTheme — coerce stored/unknown theme to a valid Paperlight theme', () => {
  it('passes each valid theme through unchanged', () => {
    for (const t of ['sepia', 'dark', 'contrast', 'system'] as const) {
      expect(normalizeTheme(t)).toBe<Theme>(t);
    }
  });

  it("maps the retired pre-Paperlight 'light' value to the 'sepia' default", () => {
    expect(normalizeTheme('light')).toBe<Theme>('sepia');
  });

  it("falls back to 'sepia' for missing or unrecognised values", () => {
    expect(normalizeTheme(undefined)).toBe<Theme>('sepia');
    expect(normalizeTheme(null)).toBe<Theme>('sepia');
    expect(normalizeTheme('midnight')).toBe<Theme>('sepia');
    expect(normalizeTheme(42)).toBe<Theme>('sepia');
  });
});
