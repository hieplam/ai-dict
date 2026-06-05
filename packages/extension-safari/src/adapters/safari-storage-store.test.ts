import { describe, it, expect, vi } from 'vitest';
import { SafariStorageStore } from './safari-storage-store';
import { DEFAULT_TEMPLATE, buildRouter, WriteQueue } from '@ai-dict/app';
import { fakeStorage } from '@ai-dict/app/test/fakes';

function fakeArea(seed?: unknown) {
  let stored = seed;
  return {
    get: vi.fn(
      (): Promise<Record<string, unknown>> =>
        Promise.resolve(stored === undefined ? {} : { settings: stored }),
    ),
    set: vi.fn((obj: { settings: unknown }): Promise<void> => {
      stored = obj.settings;
      return Promise.resolve();
    }),
    remove: vi.fn((): Promise<void> => Promise.resolve()),
    _peek: () => stored,
  };
}

describe('SafariStorageStore (SettingsStore; S1 key isolation)', () => {
  it('get() returns PublicSettings only — apiKey is never exposed', async () => {
    const area = fakeArea({
      targetLang: 'vi',
      promptTemplate: 'tpl',
      apiKey: 'AIza-secret',
      cacheEnabled: true,
      saveHistory: true,
      hasKey: true,
    });
    const pub = await new SafariStorageStore(area).get();
    expect(pub).toEqual({ targetLang: 'vi', promptTemplate: 'tpl', hasKey: true });
    expect('apiKey' in pub).toBe(false);
  });

  it('get() derives hasKey + fills defaults when unset', async () => {
    const empty = await new SafariStorageStore(fakeArea(undefined)).get();
    expect(empty).toEqual({ targetLang: 'vi', promptTemplate: DEFAULT_TEMPLATE, hasKey: false });
  });

  it('set() merges only targetLang/promptTemplate, preserving apiKey + toggles', async () => {
    const area = fakeArea({
      targetLang: 'vi',
      promptTemplate: 'old',
      apiKey: 'AIza',
      cacheEnabled: false,
      saveHistory: true,
      hasKey: true,
    });
    await new SafariStorageStore(area).set({ promptTemplate: 'new' });
    expect(area._peek()).toMatchObject({
      promptTemplate: 'new',
      apiKey: 'AIza',
      cacheEnabled: false,
    });
  });

  it('set() on empty storage uses defaults() as base — first-run user path', async () => {
    // Simulates a user who opens the options page before ever saving settings.
    // read() returns undefined → defaults() is called → patch is merged on top.
    const area = fakeArea(undefined);
    await new SafariStorageStore(area).set({ promptTemplate: 'custom' });
    expect(area._peek()).toMatchObject({
      apiKey: '',
      cacheEnabled: true,
      saveHistory: true,
      promptTemplate: 'custom',
    });
  });
});

// FIX 4 (D3 / S1 wire proof): Wire a REAL SafariStorageStore (seeded WITH an apiKey) as
// the router's settings dep and assert the settings.get wire reply has NO apiKey field.
// This proves strip happens at the real storage layer and survives the full router path.
// Placed here (src/adapters/) not in test/ to respect the hex zone rule that blocks
// test/ from importing src/adapters/ directly.
describe('SafariStorageStore + buildRouter — S1 wire-layer proof (D3)', () => {
  it('settings.get reply contains NO apiKey even when storage holds one (real store, no fake)', async () => {
    // Seed the fake StorageArea with a full Settings object including apiKey
    let stored: unknown = {
      targetLang: 'en',
      promptTemplate: 'tmpl',
      apiKey: 'AIza-secret',
      cacheEnabled: true,
      saveHistory: true,
      hasKey: true,
    };
    const area = {
      get: vi.fn((): Promise<Record<string, unknown>> => Promise.resolve({ settings: stored })),
      set: vi.fn((items: Record<string, unknown>): Promise<void> => {
        stored = items['settings'];
        return Promise.resolve();
      }),
      remove: vi.fn((): Promise<void> => Promise.resolve()),
    };
    const realSettings = new SafariStorageStore(area);
    const route = buildRouter({
      kv: fakeStorage(),
      client: { lookup: vi.fn() as never },
      settings: realSettings,
      readToggles: vi.fn(() => Promise.resolve({ cacheEnabled: true, saveHistory: true })),
      queue: new WriteQueue(),
    });
    const reply = await route({ type: 'settings.get' });
    expect(reply).toMatchObject({ ok: true, type: 'settings' });
    if (typeof reply !== 'object' || reply === null || !('settings' in reply))
      throw new Error('Expected settings reply');
    const settings = (reply as { settings: Record<string, unknown> }).settings;
    // The wire reply MUST NOT expose apiKey
    expect('apiKey' in settings).toBe(false);
    // The known PublicSettings fields must be present and correct
    expect(settings['targetLang']).toBe('en');
    expect(settings['promptTemplate']).toBe('tmpl');
    expect(settings['hasKey']).toBe(true);
  });
});
