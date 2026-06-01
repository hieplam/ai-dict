import { describe, it, expect } from 'vitest';
import type { Settings, PublicSettings } from '@ai-dict/core';

describe('Settings public shape (FIX 1 — contract lock)', () => {
  it('Settings is importable from @ai-dict/core and has the full shape', () => {
    // Constructs a value matching the full Settings interface to lock the shape.
    const s: Settings = {
      targetLang: 'vi',
      promptTemplate: '{word}',
      hasKey: true,
      apiKey: 'AIzaFake',
      cacheEnabled: true,
      saveHistory: false,
    };
    expect(s.targetLang).toBe('vi');
    expect(s.promptTemplate).toBe('{word}');
    expect(s.hasKey).toBe(true);
    expect(s.apiKey).toBe('AIzaFake');
    expect(s.cacheEnabled).toBe(true);
    expect(s.saveHistory).toBe(false);
  });

  it('[type-level] apiKey is NOT a key of PublicSettings', () => {
    // PublicSettings must not expose apiKey — enforced at the type level.
    type HasApiKey = 'apiKey' extends keyof PublicSettings ? true : false;
    const _assert: HasApiKey = false as const;
    void _assert; // value-level assertion: false satisfies HasApiKey only if apiKey is not a key
    expect(true).toBe(true); // runtime marker so the test registers
  });
});
