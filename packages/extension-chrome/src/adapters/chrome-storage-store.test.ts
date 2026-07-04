import { describe, it, expect, vi } from 'vitest';
import { ChromeStorageStore } from './chrome-storage-store';
import { DEFAULT_OUTPUT_FORMAT } from '@ai-dict/app';

function fakeArea(seed?: unknown) {
  let stored = seed;
  return {
    get: vi.fn(() => Promise.resolve(stored === undefined ? {} : { settings: stored })),
    set: vi.fn((obj: { settings: unknown }) => {
      stored = obj.settings;
      return Promise.resolve();
    }),
    remove: vi.fn(() => Promise.resolve()),
    _peek: () => stored,
  };
}

describe('ChromeStorageStore (SettingsStore; S1 key isolation)', () => {
  it('get() returns PublicSettings only — apiKey is never exposed', async () => {
    const area = fakeArea({
      targetLang: 'vi',
      outputFormat: 'tpl',
      apiKey: 'AIza-secret',
      cacheEnabled: true,
      saveHistory: true,
      hasKey: true,
    });
    const pub = await new ChromeStorageStore(area).get();
    expect(pub).toEqual({
      targetLang: 'vi',
      outputFormat: 'tpl',
      promptEnvelope: '',
      hasKey: true,
      theme: 'sepia',
      configuredProviders: ['gemini'],
    });
    expect('apiKey' in pub).toBe(false);
  });

  it('envGeminiKey ctor flag makes Gemini configured even with no stored key', async () => {
    // A build baked in GEMINI_API_KEY → Gemini works with nothing entered, so hasKey is true
    // and configuredProviders lists gemini regardless of the empty stored apiKey.
    const pub = await new ChromeStorageStore(fakeArea({ apiKey: '' }), true).get();
    expect(pub.hasKey).toBe(true);
    expect(pub.configuredProviders).toEqual(['gemini']);
  });

  it('get() resolves a legacy custom promptTemplate into the envelope override (read-time)', async () => {
    const area = fakeArea({ apiKey: 'AIza', promptTemplate: 'my old {word} prompt' });
    expect((await new ChromeStorageStore(area).get()).promptEnvelope).toBe('my old {word} prompt');
  });

  it('get() coerces a legacy stored "light" theme to the Paperlight "sepia" default', async () => {
    const area = fakeArea({
      targetLang: 'vi',
      outputFormat: 'tpl',
      apiKey: 'AIza',
      theme: 'light',
    });
    expect((await new ChromeStorageStore(area).get()).theme).toBe('sepia');
  });

  it('get() derives hasKey from a non-empty apiKey + fills defaults when unset', async () => {
    const empty = await new ChromeStorageStore(fakeArea(undefined)).get();
    expect(empty).toEqual({
      targetLang: 'vi',
      outputFormat: DEFAULT_OUTPUT_FORMAT,
      promptEnvelope: '',
      hasKey: false,
      theme: 'sepia',
      configuredProviders: [],
    });
    const noKey = await new ChromeStorageStore(
      fakeArea({ targetLang: 'en', outputFormat: 't', apiKey: '' }),
    ).get();
    expect(noKey.hasKey).toBe(false);
  });

  it('set() merges only targetLang/outputFormat, preserving apiKey + toggles', async () => {
    const area = fakeArea({
      targetLang: 'vi',
      outputFormat: 'old',
      apiKey: 'AIza',
      cacheEnabled: false,
      saveHistory: true,
      hasKey: true,
    });
    await new ChromeStorageStore(area).set({ outputFormat: 'new' });
    expect(area._peek()).toMatchObject({
      outputFormat: 'new',
      apiKey: 'AIza',
      cacheEnabled: false,
    });
  });

  it('set() initialises from defaults() when storage is empty (first-time save path)', async () => {
    const area = fakeArea(undefined); // no stored settings → defaults() branch
    await new ChromeStorageStore(area).set({ targetLang: 'en' });
    expect(area._peek()).toMatchObject({
      targetLang: 'en',
      apiKey: '',
      cacheEnabled: true,
      saveHistory: true,
    });
  });
});
