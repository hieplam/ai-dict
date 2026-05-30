import '@ai-dict/shared-ui/lookup-card';
import type { CardState, LookupCard } from '@ai-dict/shared-ui/lookup-card';
import { sanitizeMarkdown } from '@ai-dict/adapters-shared';
import type { LookupResult, LookupError } from '@ai-dict/core';

const card = document.querySelector('lookup-card') as LookupCard;

chrome.runtime.onMessage.addListener((msg: { to?: string; state?: string; payload?: unknown }) => {
  if (msg.to !== 'side-panel') return;
  const set = (s: CardState): void => { card.state = s; };
  if (msg.state === 'loading') set({ kind: 'loading' });
  else if (msg.state === 'result') { const r = msg.payload as LookupResult; set({ kind: 'result', safeHtml: sanitizeMarkdown(r.markdown), word: r.word, target: r.target }); }
  else if (msg.state === 'error') set({ kind: 'error', error: msg.payload as LookupError });
});
