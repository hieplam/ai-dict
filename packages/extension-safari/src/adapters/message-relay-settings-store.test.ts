import { describe, it, expect, vi } from 'vitest';
import { MessageRelaySettingsStore } from './message-relay-settings-store';

const pub = { targetLang: 'vi', promptTemplate: 'tpl', hasKey: true };

describe('MessageRelaySettingsStore', () => {
  it('round-trips settings.get once, then serves from tab cache', async () => {
    const sendMessage = vi.fn(() => Promise.resolve({ ok: true, type: 'settings', settings: pub }));
    const store = new MessageRelaySettingsStore({ sendMessage }, () => {});
    expect(await store.get()).toEqual(pub);
    expect(await store.get()).toEqual(pub);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith({ type: 'settings.get' });
  });

  it('invalidates the cache when storage changes (next get re-fetches)', async () => {
    const sendMessage = vi.fn(() => Promise.resolve({ ok: true, type: 'settings', settings: pub }));
    let fire = () => {};
    const store = new MessageRelaySettingsStore({ sendMessage }, (cb) => { fire = cb; });
    await store.get();
    fire();
    await store.get();
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it('set() is rejected — content never writes settings over the wire (options page writes direct)', async () => {
    const store = new MessageRelaySettingsStore({ sendMessage: vi.fn() }, () => {});
    await expect(store.set({ targetLang: 'en' })).rejects.toThrow();
  });

  it('get() throws when the SW replies with an unexpected reply (not ok + not settings)', async () => {
    const sendMessage = vi.fn(() => Promise.resolve({ ok: false, type: 'lookup', error: { code: 'PARSE' } }));
    const store = new MessageRelaySettingsStore({ sendMessage }, () => {});
    await expect(store.get()).rejects.toThrow('settings.get failed');
  });
});
