import type { SettingsStore, PublicSettings, WireReply } from '@ai-dict/core';
import type { RuntimeLike } from './message-relay-lookup-client';

export class MessageRelaySettingsStore implements SettingsStore {
  private cache: PublicSettings | null = null;

  constructor(
    private readonly runtime: RuntimeLike,
    subscribe: (invalidate: () => void) => void = (cb) => chrome.storage.onChanged.addListener(cb),
  ) {
    subscribe(() => { this.cache = null; });
  }

  async get(): Promise<PublicSettings> {
    if (this.cache) return this.cache;
    const reply = (await this.runtime.sendMessage({ type: 'settings.get' })) as WireReply;
    if (reply.ok && reply.type === 'settings') {
      this.cache = reply.settings;
      return reply.settings;
    }
    throw new Error('settings.get failed');
  }

  set(_patch: Partial<Pick<import('@ai-dict/core').PublicSettings, 'targetLang' | 'promptTemplate'>>): Promise<void> {
    return Promise.reject(new Error('Settings are edited on the options page, not over the content wire.'));
  }
}
