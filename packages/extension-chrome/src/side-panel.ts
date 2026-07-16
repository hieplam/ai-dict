import {
  registerSidePanel,
  sanitizeMarkdown,
  mapError,
  createSaveReplyGuard,
  type PanelFocusState,
  type SidePanelView,
  type LookupResult,
  type LookupError,
  type HistoryEntry,
  type WireReply,
  type SavedWordStatus,
} from '@ai-dict/app';
import type {
  GetSidePanelFocusMessage,
  SidePanelFocusReply,
  SidePanelFocus,
} from './side-panel-messages';
registerSidePanel();

// The side panel is a persistent, docked surface — it fills the panel viewport edge-to-edge.
// CSP (`style-src 'self'`) forbids inline <style>/style="", but a constructable stylesheet is
// not inline, so it is the CSP-safe way to drop the default body margin. The panel element
// paints its own candlelit surface and sizes itself to the viewport.
const reset = new CSSStyleSheet();
reset.replaceSync('html,body{margin:0}');
document.adoptedStyleSheets = [...document.adoptedStyleSheets, reset];

const view = document.querySelector('side-panel-view') as SidePanelView;

// Entries currently shown under "Recent", kept in memory so a click can resolve an id back to
// its full stored result without another round-trip to the service worker.
let recent: HistoryEntry[] = [];

// B1: the save payload for whatever the panel's focus region currently shows, plus a local
// optimistic flag. Independent of content.ts's own tracking — the panel is its own composition
// root and may show a result the in-page card never rendered (e.g. a "Recent" click).
let lastSavePayload:
  | {
      word: string;
      definition: string;
      translation: string;
      sentence: string;
      url: string;
      title: string;
    }
  | undefined;
let lastSaved = false;
// B5: mirrors content.ts's own lastStatus tracking — the panel is its own independent
// composition root (see the B1-era comment above trackSaveContext).
let lastStatus: SavedWordStatus | undefined;
// B5 (F2 audit fix): guards against a stale toggle-save reply resolving after a later
// click/render has already superseded it — see save-reply-guard.ts's doc comment.
const saveReplyGuard = createSaveReplyGuard();

function trackSaveContext(
  r: LookupResult,
  extra: {
    sentence?: string | undefined;
    url?: string | undefined;
    title?: string | undefined;
  } = {},
): void {
  lastSavePayload = {
    word: r.word,
    definition: r.markdown,
    // B2: real translation from the parsed TRANSLATION signal line, when the model emitted
    // one; '' fallback preserves B1's exact behavior for legacy/non-compliant responses.
    translation: r.translation ?? '',
    sentence: extra.sentence ?? '',
    url: extra.url ?? '',
    title: extra.title ?? '',
  };
  lastSaved = false;
  lastStatus = undefined;
  saveReplyGuard.next();
}

/** Flip the star on the panel's currently-shown result without a full re-render of everything
 * else; no-op when the focus region isn't a result (mirrors InlineBottomSheetRenderer.setSaved). */
function setSaved(saved: boolean): void {
  if (view.focusState.kind !== 'result') return;
  // B7: any save toggle also clears the nudge banner — the reader has acted on the signal.
  view.focusState = { ...view.focusState, saved, nudge: false };
}

/** B5: flip the status toggle on the panel's currently-shown result — mirrors
 * InlineBottomSheetRenderer.setStatus(); no-op when the focus region isn't a result. */
function setStatus(status: SavedWordStatus): void {
  if (view.focusState.kind !== 'result') return;
  view.focusState = { ...view.focusState, status };
}

/** B7: hide the nudge banner without touching `saved` — mirrors
 * InlineBottomSheetRenderer.dismissNudge(). No wire round-trip: the backend already permanently
 * marked this word as nudged before this focus state was ever set (domain/nudge-policy.ts). */
function dismissNudge(): void {
  if (view.focusState.kind !== 'result') return;
  view.focusState = { ...view.focusState, nudge: false };
}

function isLookupResult(v: unknown): v is LookupResult {
  return (
    v !== null &&
    typeof v === 'object' &&
    typeof (v as Record<string, unknown>).markdown === 'string' &&
    typeof (v as Record<string, unknown>).word === 'string' &&
    typeof (v as Record<string, unknown>).target === 'string'
  );
}

// A stored/looked-up result becomes the focus. Markdown is (re-)sanitized here at the render
// boundary — never trust stored markdown as safe (S4).
function resultToFocus(r: LookupResult): PanelFocusState {
  // Show the provider badge + fallback note in the panel too, but no one-shot picker here
  // (the panel is a persistent surface, not the transient in-page card) — omit `providers`.
  return {
    kind: 'result',
    safeHtml: sanitizeMarkdown(r.markdown),
    word: r.word,
    target: r.target,
    ...(r.provider !== undefined ? { provider: r.provider } : {}),
    ...(r.fallbackFrom !== undefined ? { fallbackFrom: r.fallbackFrom } : {}),
    // B7: nudge is a transient per-reply annotation on LookupResult (never persisted); thread it
    // through so the panel's own focus region shows the same banner the in-page card does.
    ...(r.nudge === true ? { nudge: true } : {}),
  };
}

async function refreshRecent(): Promise<void> {
  try {
    // chrome.runtime.sendMessage is typed `any`; pin it to `unknown` first so the WireReply
    // assertion is a real narrowing the linter accepts (and we still gate on the shape below).
    const raw: unknown = await chrome.runtime.sendMessage({ type: 'history.list', limit: 50 });
    const reply = raw as WireReply | undefined;
    if (reply && reply.ok && reply.type === 'history') {
      recent = reply.entries;
      view.recent = recent;
    }
  } catch {
    // History is a convenience; a failed query just leaves the section as-is.
  }
}

// Re-show a past lookup in the focus region when its row is clicked. HistoryEntry has no
// url/title (that gap is exactly why B2 exists) — sentence comes from the stored context.
view.addEventListener('select', (e) => {
  const { id } = (e as CustomEvent<{ id: string }>).detail;
  const entry = recent.find((x) => x.id === id);
  if (entry) {
    view.focusState = resultToFocus(entry.result);
    trackSaveContext(entry.result, { sentence: entry.context });
  }
});

// A row's delete button removes the stored entry AND its cached definition (the SW derives the
// cache key from the stored record), so re-selecting the word fetches a fresh result with the
// current prompt template. Recent is re-pulled afterwards either way — worst case it's a no-op.
view.addEventListener('delete', (e) => {
  const { id } = (e as CustomEvent<{ id: string }>).detail;
  void (async () => {
    try {
      await chrome.runtime.sendMessage({ type: 'history.delete', id });
    } finally {
      await refreshRecent();
    }
  })();
});

// The no-key setup invite's "Open Settings" button bubbles `open-settings` out of the focus
// region. The panel is an extension page, so it can open the options page directly.
view.addEventListener('open-settings', () => {
  void chrome.runtime.openOptionsPage();
});

// B1: the panel's own save row bubbles the same composed `toggle-save` event the in-page card
// does. The panel is a trusted extension page, so it sends `saved.save`/`saved.delete` directly
// — same style as `history.delete`/`settings.get` above.
view.addEventListener('toggle-save', () => {
  if (!lastSavePayload) return;
  const willSave = !lastSaved;
  lastSaved = willSave;
  setSaved(willSave);
  if (!willSave) lastStatus = undefined;
  const token = saveReplyGuard.next();
  const message = willSave
    ? { type: 'saved.save' as const, ...lastSavePayload }
    : { type: 'saved.delete' as const, word: lastSavePayload.word };
  void chrome.runtime
    .sendMessage(message)
    .then((raw: unknown) => {
      if (!saveReplyGuard.isCurrent(token)) return; // a later click/render already superseded this reply
      const reply = raw as WireReply | undefined;
      if (willSave && reply?.ok && reply.type === 'saved') {
        lastStatus = reply.entry.status;
        setStatus(lastStatus);
      }
    })
    .catch(() => undefined);
});

// B5: mirrors content.ts's own toggle-status listener.
view.addEventListener('toggle-status', () => {
  if (!lastSavePayload || lastStatus === undefined) return;
  const next: SavedWordStatus = lastStatus === 'known' ? 'learning' : 'known';
  lastStatus = next;
  setStatus(next);
  void chrome.runtime
    .sendMessage({ type: 'saved.setStatus', word: lastSavePayload.word, status: next })
    .catch(() => undefined);
});

// B7: the panel's own focus region bubbles the same composed dismiss-nudge event the in-page
// card does. No wire message needed — see dismissNudge()'s doc comment above.
view.addEventListener('dismiss-nudge', () => dismissNudge());

// On open, one settings probe drives two things: stamp the reader's theme on the panel,
// and — if no key is configured — swap the teaching empty state for the same setup invite
// the card shows, pointing the reader straight at Settings. A later lookup overrides it.
async function initFromSettings(): Promise<void> {
  try {
    const raw: unknown = await chrome.runtime.sendMessage({ type: 'settings.get' });
    const reply = raw as WireReply | undefined;
    if (!reply || !reply.ok || reply.type !== 'settings') return;
    view.setAttribute('data-ad-theme', reply.settings.theme);
    // An env-key build (GEMINI_API_KEY baked in) is always usable even with no stored key, so
    // it must never show the setup nag — mirrors how the options page treats the env key.
    if (!__GEMINI_KEY_FROM_ENV__ && !reply.settings.hasKey) {
      view.focusState = { kind: 'error', error: mapError({ kind: 'no-key' }) };
    }
  } catch {
    // Best-effort probe; light theme + the empty teaching state are a fine fallback.
  }
}

// Live mirror of the in-page lookup (posted by ChromeSidePanelMirror over runtime messaging).
chrome.runtime.onMessage.addListener(
  (
    msg: {
      to?: string;
      state?: string;
      word?: unknown;
      payload?: unknown;
      sentence?: unknown;
      url?: unknown;
      title?: unknown;
    },
    sender,
  ) => {
    // S3: reject anything from outside this extension.
    if (sender.id !== chrome.runtime.id) return;
    if (msg.to !== 'side-panel') return;
    if (msg.state === 'loading') {
      view.focusState =
        typeof msg.word === 'string' ? { kind: 'loading', word: msg.word } : { kind: 'loading' };
    } else if (msg.state === 'result') {
      if (!isLookupResult(msg.payload)) {
        console.warn('[side-panel] invalid result payload');
        return;
      }
      view.focusState = resultToFocus(msg.payload);
      trackSaveContext(msg.payload, {
        sentence: typeof msg.sentence === 'string' ? msg.sentence : undefined,
        url: typeof msg.url === 'string' ? msg.url : undefined,
        title: typeof msg.title === 'string' ? msg.title : undefined,
      });
      // The router just appended this lookup to history; pull it into Recent.
      void refreshRecent();
    } else if (msg.state === 'error') {
      view.focusState = { kind: 'error', error: msg.payload as LookupError };
    }
    // `state === 'close'` (the in-page card was dismissed) is intentionally ignored: the panel
    // is persistent and keeps showing the last lookup.
  },
);

// On boot, recover the lookup the panel may have missed: when the reader clicks "Open in side
// panel", the SW caches that lookup, but a freshly-opened panel might not have its onMessage
// listener registered when the SW broadcasts it (a race), and Recent is empty when saveHistory
// is off. So we pull the cached focus directly. A subsequent live mirror message overrides it.
function applyFocus(focus: SidePanelFocus): void {
  if (focus.state === 'loading') {
    view.focusState =
      focus.word !== undefined ? { kind: 'loading', word: focus.word } : { kind: 'loading' };
  } else if (focus.state === 'result' && isLookupResult(focus.payload)) {
    view.focusState = resultToFocus(focus.payload);
    trackSaveContext(focus.payload, {
      sentence: focus.sentence,
      url: focus.url,
      title: focus.title,
    });
  } else if (focus.state === 'error') {
    // LookupError is display-only text (no HTML); unlike the result branch it needs no isLookupResult guard (S4).
    view.focusState = { kind: 'error', error: focus.payload };
  }
}

async function recoverFocus(): Promise<void> {
  try {
    const message: GetSidePanelFocusMessage = { type: 'side-panel.get-focus' };
    const raw: unknown = await chrome.runtime.sendMessage(message);
    const reply = raw as SidePanelFocusReply | undefined;
    if (reply && reply.focus) applyFocus(reply.focus);
  } catch {
    // Best-effort; the empty teaching state / no-key invite remains a fine fallback.
  }
}

// On open, populate Recent from stored history. The focus region stays on its teaching empty
// state until the first lookup mirrors in or a recent row is clicked — unless no key is set,
// in which case initFromSettings swaps it for the setup invite (and stamps the theme).
void refreshRecent();
void initFromSettings().then(() => recoverFocus());
