import {
  registerSidePanel,
  sanitizeMarkdown,
  mapError,
  type PanelFocusState,
  type SidePanelView,
  type LookupResult,
  type LookupError,
  type HistoryEntry,
  type WireReply,
} from '@ai-dict/app';
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
  return { kind: 'result', safeHtml: sanitizeMarkdown(r.markdown), word: r.word, target: r.target };
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

// Re-show a past lookup in the focus region when its row is clicked.
view.addEventListener('select', (e) => {
  const { id } = (e as CustomEvent<{ id: string }>).detail;
  const entry = recent.find((x) => x.id === id);
  if (entry) view.focusState = resultToFocus(entry.result);
});

// The no-key setup invite's "Open Settings" button bubbles `open-settings` out of the focus
// region. The panel is an extension page, so it can open the options page directly.
view.addEventListener('open-settings', () => {
  void chrome.runtime.openOptionsPage();
});

// On open, if no key is configured the panel can't look anything up — so instead of the
// "Select a word…" teaching state (which would mislead), show the same setup invite the card
// shows, pointing the reader straight at Settings. A later lookup mirroring in overrides it.
async function showSetupIfNoKey(): Promise<void> {
  // An env-key build (GEMINI_API_KEY baked in) is always usable even with no stored key, so it
  // must never show the setup nag — mirrors how the options page treats the env key as set up.
  if (__GEMINI_KEY_FROM_ENV__) return;
  try {
    const raw: unknown = await chrome.runtime.sendMessage({ type: 'settings.get' });
    const reply = raw as WireReply | undefined;
    if (reply && reply.ok && reply.type === 'settings' && !reply.settings.hasKey) {
      view.focusState = { kind: 'error', error: mapError({ kind: 'no-key' }) };
    }
  } catch {
    // Best-effort probe; the empty teaching state is a fine fallback if it fails.
  }
}

// Live mirror of the in-page lookup (posted by ChromeSidePanelMirror over runtime messaging).
chrome.runtime.onMessage.addListener(
  (msg: { to?: string; state?: string; word?: unknown; payload?: unknown }, sender) => {
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
      // The router just appended this lookup to history; pull it into Recent.
      void refreshRecent();
    } else if (msg.state === 'error') {
      view.focusState = { kind: 'error', error: msg.payload as LookupError };
    }
    // `state === 'close'` (the in-page card was dismissed) is intentionally ignored: the panel
    // is persistent and keeps showing the last lookup.
  },
);

// On open, populate Recent from stored history. The focus region stays on its teaching empty
// state until the first lookup mirrors in or a recent row is clicked — unless no key is set,
// in which case showSetupIfNoKey swaps it for the setup invite.
void refreshRecent();
void showSetupIfNoKey();
