import type { ResultRenderer, LookupResult, LookupError, RuntimeLike } from '@ai-dict/app';

export class ChromeSidePanelMirror implements ResultRenderer {
  constructor(private readonly runtime: RuntimeLike) {}
  private post(msg: Record<string, unknown>): void {
    void Promise.resolve(this.runtime.sendMessage({ to: 'side-panel', ...msg })).catch(
      () => undefined,
    );
  }
  renderLoading(word?: string): void {
    this.post({ state: 'loading', word });
  }
  renderResult(r: LookupResult): void {
    this.post({ state: 'result', payload: r });
  }
  renderError(e: LookupError): void {
    this.post({ state: 'error', payload: e });
  }
  close(): void {
    this.post({ state: 'close' });
  }
}
