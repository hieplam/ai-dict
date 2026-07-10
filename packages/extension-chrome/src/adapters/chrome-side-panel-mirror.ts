import type {
  ResultRenderer,
  ResultRenderContext,
  LookupResult,
  LookupError,
  RuntimeLike,
} from '@ai-dict/app';

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
  /**
   * B1: also broadcasts sentence/url/title (from ResultRenderContext, when present) so the side
   * panel's own composition root can build a full save payload independently of the in-page
   * card — the panel is a live mirror, not a re-derivation of the in-page DOM.
   */
  renderResult(r: LookupResult, ctx?: ResultRenderContext): void {
    this.post({
      state: 'result',
      payload: r,
      ...(ctx?.sentence !== undefined ? { sentence: ctx.sentence } : {}),
      ...(ctx?.url !== undefined ? { url: ctx.url } : {}),
      ...(ctx?.title !== undefined ? { title: ctx.title } : {}),
    });
  }
  renderError(e: LookupError): void {
    this.post({ state: 'error', payload: e });
  }
  close(): void {
    this.post({ state: 'close' });
  }
}
