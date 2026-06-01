import type { ResultRenderer, LookupResult, LookupError } from '@ai-dict/core';
import type { RuntimeLike } from './message-relay-lookup-client';

export class ChromeSidePanelMirror implements ResultRenderer {
  constructor(private readonly runtime: RuntimeLike) {}
  private post(msg: Record<string, unknown>): void {
    void Promise.resolve(this.runtime.sendMessage({ to: 'side-panel', ...msg })).catch(() => undefined);
  }
  renderLoading(): void { this.post({ state: 'loading' }); }
  renderResult(r: LookupResult): void { this.post({ state: 'result', payload: r }); }
  renderError(e: LookupError): void { this.post({ state: 'error', payload: e }); }
  close(): void { this.post({ state: 'close' }); }
}
