import { describe, it, expect, vi } from 'vitest';
import { SafariStorageStore } from './safari-storage-store';
import { DEFAULT_TEMPLATE } from '@ai-dict/core';

function fakeArea(seed?: unknown) {
  let stored = seed;
  return {
    get: vi.fn((): Promise<Record<string, unknown>> => Promise.resolve(stored === undefined ? {} : { settings: stored })),
    set: vi.fn((obj: { settings: unknown }): Promise<void> => { stored = obj.settings; return Promise.resolve(); }),
    remove: vi.fn((): Promise<void> => Promise.resolve()),
    _peek: () => stored,
  };
}

describe('SafariStorageStore (SettingsStore; S1 key isolation)', () => {
  it('get() returns PublicSettings only — apiKey is never exposed', async () => {
    const area = fakeArea({ targetLang: 'vi', promptTemplate: 'tpl', apiKey: 'AIza-secret', cacheEnabled: true, saveHistory: true, hasKey: true });
    const pub = await new SafariStorageStore(area).get();
    expect(pub).toEqual({ targetLang: 'vi', promptTemplate: 'tpl', hasKey: true });
    expect('apiKey' in pub).toBe(false);
  });

  it('get() derives hasKey + fills defaults when unset', async () => {
    const empty = await new SafariStorageStore(fakeArea(undefined)).get();
    expect(empty).toEqual({ targetLang: 'vi', promptTemplate: DEFAULT_TEMPLATE, hasKey: false });
  });

  it('set() merges only targetLang/promptTemplate, preserving apiKey + toggles', async () => {
    const area = fakeArea({ targetLang: 'vi', promptTemplate: 'old', apiKey: 'AIza', cacheEnabled: false, saveHistory: true, hasKey: true });
    await new SafariStorageStore(area).set({ promptTemplate: 'new' });
    expect(area._peek()).toMatchObject({ promptTemplate: 'new', apiKey: 'AIza', cacheEnabled: false });
  });
});
