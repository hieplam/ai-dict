// stub — will be implemented in Task D
import type { ResultRenderer, LookupResult, LookupError } from '@ai-dict/core';

export class InlineBottomSheetRenderer implements ResultRenderer {
  constructor(_host: HTMLElement, _sanitize?: (md: string) => string) {}
  renderLoading(): void { throw new Error('not implemented'); }
  renderResult(_r: LookupResult): void { throw new Error('not implemented'); }
  renderError(_e: LookupError): void { throw new Error('not implemented'); }
  close(): void { throw new Error('not implemented'); }
}
