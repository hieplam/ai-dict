import type { SettingsStore, PublicSettings, WireReply, RuntimeLike } from '@ai-dict/app';

export class MessageRelaySettingsStore implements SettingsStore {
  private cache: PublicSettings | null = null;

  constructor(
    private readonly runtime: RuntimeLike,
    subscribe: (invalidate: () => void) => void = (cb) => chrome.storage.onChanged.addListener(cb),
  ) {
    subscribe(() => {
      this.cache = null;
    });
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

  // The content side MUST NOT write settings over the wire. Settings are edited on the options page.
  // Param is intentionally ignored — method exists only to satisfy the SettingsStore interface.
  set(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _patch: Partial<Pick<import('@ai-dict/app').PublicSettings, 'targetLang' | 'outputFormat'>>,
  ): Promise<void> {
    return Promise.reject(
      new Error('Settings are edited on the options page, not over the content wire.'),
    );
  }
}
