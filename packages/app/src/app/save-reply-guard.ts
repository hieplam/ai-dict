/**
 * B5 (F2 audit fix): guards composition-root save/status listeners against a stale async reply
 * resurrecting cleared save/status state. `content.ts` and `side-panel.ts` each track their own
 * save/status closure state independently and fire a `chrome.runtime.sendMessage(...).then(...)`
 * on every toggle-save click; if a later click (or a fresh render) supersedes an earlier one
 * before its reply resolves, the earlier reply must not be allowed to write state anymore.
 *
 * Usage: call `next()` to obtain a token immediately before issuing the async request (and also
 * on every state-invalidating reset, e.g. a fresh renderLoading/renderResult), then check
 * `isCurrent(token)` inside the `.then` callback before applying the reply — if it's no longer
 * current, the reply is stale and must be dropped.
 */
export function createSaveReplyGuard(): { next(): number; isCurrent(token: number): boolean } {
  let generation = 0;
  return {
    next(): number {
      generation += 1;
      return generation;
    },
    isCurrent(token: number): boolean {
      return token === generation;
    },
  };
}
