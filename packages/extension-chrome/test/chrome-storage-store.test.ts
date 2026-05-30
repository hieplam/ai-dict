import { describe, it, expect, vi } from 'vitest';
import { ChromeStorageStore } from '../src/adapters/chrome-storage-store';
import { DEFAULT_TEMPLATE } from '@ai-dict/core';

function fakeArea(seed?: unknown) {
  let stored = seed;
  return {
    get: vi.fn(async () => (stored === undefined ? {} : { settings: stored })),
    set: vi.fn(async (obj: { settings: unknown }) => { stored = obj.settings; }),
    remove: vi.fn(),
    _peek: () => stored,
  };
}

describe('ChromeStorageStore (SettingsStore; S1 key isolation)', () => {
  it('get() returns PublicSettings only — apiKey is never exposed', async () => {
    const area = fakeArea({ targetLang: 'vi', promptTemplate: 'tpl', apiKey: 'AIza-secret', cacheEnabled: true, saveHistory: true, hasKey: true });
    const pub = await new ChromeStorageStore(area).get();
    expect(pub).toEqual({ targetLang: 'vi', promptTemplate: 'tpl', hasKey: true });
    expect('apiKey' in pub).toBe(false);
  });

  it('get() derives hasKey from a non-empty apiKey + fills defaults when unset', async () => {
    const empty = await new ChromeStorageStore(fakeArea(undefined)).get();
    expect(empty).toEqual({ targetLang: 'vi', promptTemplate: DEFAULT_TEMPLATE, hasKey: false });
    const noKey = await new ChromeStorageStore(fakeArea({ targetLang: 'en', promptTemplate: 't', apiKey: '' })).get();
    expect(noKey.hasKey).toBe(false);
  });

  it('set() merges only targetLang/promptTemplate, preserving apiKey + toggles', async () => {
    const area = fakeArea({ targetLang: 'vi', promptTemplate: 'old', apiKey: 'AIza', cacheEnabled: false, saveHistory: true, hasKey: true });
    await new ChromeStorageStore(area).set({ promptTemplate: 'new' });
    expect(area._peek()).toMatchObject({ promptTemplate: 'new', apiKey: 'AIza', cacheEnabled: false });
  });
});
