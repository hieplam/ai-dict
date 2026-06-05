import { registerContentElements, sanitizeMarkdown, type CardState, type LookupCard, type LookupResult, type LookupError } from '@ai-dict/app';
registerContentElements();

// Structural guard: verify the payload is a valid LookupResult before passing it to
// sanitizeMarkdown. Avoids a TypeError crash or attacker-controlled input when a crafted
// message arrives with the right `to/state` fields but a malformed payload.
function isLookupResult(v: unknown): v is LookupResult {
  return (
    v !== null &&
    typeof v === 'object' &&
    typeof (v as Record<string, unknown>).markdown === 'string' &&
    typeof (v as Record<string, unknown>).word === 'string' &&
    typeof (v as Record<string, unknown>).target === 'string'
  );
}

const card = document.querySelector('lookup-card') as LookupCard;

chrome.runtime.onMessage.addListener(
  (msg: { to?: string; state?: string; payload?: unknown }, sender) => {
    // S3: reject messages from any context outside this extension
    if (sender.id !== chrome.runtime.id) return;
    if (msg.to !== 'side-panel') return;
    const set = (s: CardState): void => {
      card.state = s;
    };
    if (msg.state === 'loading') set({ kind: 'loading' });
    else if (msg.state === 'result') {
      if (!isLookupResult(msg.payload)) {
        console.warn('[side-panel] invalid result payload');
        return;
      }
      const r = msg.payload;
      set({
        kind: 'result',
        safeHtml: sanitizeMarkdown(r.markdown),
        word: r.word,
        target: r.target,
      });
    } else if (msg.state === 'error') set({ kind: 'error', error: msg.payload as LookupError });
  },
);
