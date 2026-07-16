import {
  runLookupWorkflow,
  InlineBottomSheetRenderer,
  DomSelectionSource,
  MessageRelayLookupClient,
  buildConsentFooter,
  type SettingsStore,
  type SavedWordStatus,
  type WireReply,
} from '@ai-dict/app';
// Custom elements are defined by content-elements.ts (world:MAIN) — see manifest.json.
// Do NOT re-import them here; the page's registry is shared between worlds via the DOM.
import { ChromeFloatingTrigger } from './adapters/chrome-floating-trigger';
import { MessageRelaySettingsStore } from './adapters/message-relay-settings-store';
import { ChromeSidePanelMirror } from './adapters/chrome-side-panel-mirror';
import type { SidePanelFocus, OpenSidePanelMessage } from './side-panel-messages';
import { isCommandMessage } from './command-messages';

const inline = new InlineBottomSheetRenderer(document.body, undefined, { sidePanel: true });
const mirror = new ChromeSidePanelMirror(chrome.runtime);
const trigger = new ChromeFloatingTrigger();

// Decorate the settings store so every fetch also re-applies the reader's theme to the
// in-page surfaces (bubble + card). The workflow fetches settings on each Define click and
// the relay store drops its cache on storage changes, so a theme saved on the options page
// reaches already-open tabs on their next lookup — plus once at startup for the bubble.
const settings = new MessageRelaySettingsStore(chrome.runtime);
const themedSettings: SettingsStore = {
  get: () =>
    settings.get().then((s) => {
      trigger.theme = s.theme;
      inline.theme = s.theme;
      return s;
    }),
  set: (patch) => settings.set(patch),
};
void themedSettings.get().catch(() => undefined); // seed before the first lookup; light until known

let lastFocus: SidePanelFocus | undefined;

// B1: the save payload for whatever the card currently shows, plus a local optimistic flag.
// Reset on every renderLoading/renderResult — a fresh render always starts unstarred (no
// is-already-saved round trip; see the design spec's "Toggle semantics" section for why).
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
// B5: the current saved word's status, sourced from the saved.save/saved.setStatus reply's
// entry.status (NOT a fresh optimistic default — see the design spec's "Known, accepted
// limitation" section for why an unsaved word starts with no known status). undefined hides the
// status toggle (renderSaveRow's own guard).
let lastStatus: SavedWordStatus | undefined;
// B5 fix: invalidates a stale toggle-save reply that resolves after a later click/render has
// already superseded it (e.g. save -> unsave before the save reply lands) — without this, the
// stale reply's `willSave` closure value is still true and would resurrect a status value on a
// word that is no longer saved. Bumped on every toggle-save click and every fresh render.
let saveToken = 0;

/** Close everything the in-page surfaces are currently showing (card + mirror). Shared by the
 * workflow's normal close path and the A4 dismiss-lookup command. */
function dismissAll(): void {
  lastFocus = undefined;
  inline.close();
  mirror.close();
}

runLookupWorkflow({
  selection: new DomSelectionSource(document),
  trigger,
  renderer: {
    renderLoading(word) {
      lastFocus = word === undefined ? { state: 'loading' } : { state: 'loading', word };
      lastSavePayload = undefined;
      lastSaved = false;
      lastStatus = undefined;
      saveToken++;
      inline.renderLoading(word);
      mirror.renderLoading(word);
    },
    renderResult(r, ctx) {
      lastFocus = { state: 'result', payload: r };
      lastSavePayload = {
        word: r.word,
        definition: r.markdown,
        // B2: real translation from the parsed TRANSLATION signal line, when the model emitted
        // one; '' fallback preserves B1's exact behavior for legacy/non-compliant responses.
        translation: r.translation ?? '',
        sentence: ctx?.sentence ?? '',
        url: ctx?.url ?? '',
        title: ctx?.title ?? '',
      };
      lastSaved = false;
      lastStatus = undefined;
      saveToken++;
      // Forward the picker context to the in-page card only; the side-panel mirror shows the
      // badge/note from `r` but no one-shot picker (it's a persistent surface).
      inline.renderResult(r, ctx);
      mirror.renderResult(r, ctx);
    },
    renderError(e) {
      lastFocus = { state: 'error', payload: e };
      inline.renderError(e);
      mirror.renderError(e);
      void maybeShowConsent();
    },
    close: dismissAll,
  },
  client: new MessageRelayLookupClient(chrome.runtime),
  settings: themedSettings,
});

async function maybeShowConsent(): Promise<void> {
  let status: { consent: string; pending: boolean; count: number } | undefined;
  try {
    const reply: WireReply = await chrome.runtime.sendMessage({ type: 'errlog.status' });
    if (reply?.ok && reply.type === 'errlog') status = reply;
  } catch {
    return; // SW asleep / no reply — skip silently
  }
  if (!status || !status.pending || status.consent !== 'unset') return;

  const footer = buildConsentFooter({
    count: status.count,
    onChoice: (choice) => {
      void chrome.runtime.sendMessage({ type: 'errlog.set-consent', state: choice });
      footer.remove();
    },
  });
  inline.appendToCard(footer);
}

// The card's Settings actions (header gear, no-key/invalid-key "Open Settings" CTA) dispatch a
// composed `open-settings` event that bubbles out of the bottom sheet to the document. A content
// script can't open the options page directly, so we ask the service worker to (it calls
// chrome.runtime.openOptionsPage).
document.addEventListener('open-settings', () => {
  void chrome.runtime.sendMessage({ type: 'open-options' });
});

// B1: the card's star button bubbles a composed `toggle-save` event (no persistence payload —
// the full save context lives in the closure above, captured from ResultRenderContext at the
// moment the result rendered). Optimistic local toggle: no is-already-saved round trip (see the
// design spec's "Toggle semantics").
document.addEventListener('toggle-save', () => {
  if (!lastSavePayload) return;
  const willSave = !lastSaved;
  lastSaved = willSave;
  inline.setSaved(willSave);
  if (!willSave) lastStatus = undefined;
  const token = ++saveToken;
  const message = willSave
    ? { type: 'saved.save' as const, ...lastSavePayload }
    : { type: 'saved.delete' as const, word: lastSavePayload.word };
  void chrome.runtime
    .sendMessage(message)
    .then((raw: unknown) => {
      if (token !== saveToken) return; // a later click/render already superseded this reply
      const reply = raw as WireReply | undefined;
      if (willSave && reply?.ok && reply.type === 'saved') {
        lastStatus = reply.entry.status;
        inline.setStatus(lastStatus);
      }
    })
    .catch(() => undefined);
});

// B5: the card's status toggle bubbles a composed `toggle-status` event (no direction carried —
// the flip direction is computed here from the last known status, mirroring toggle-save's own
// design). No-op if the word isn't confirmed-saved yet (lastStatus undefined mirrors
// lastSavePayload's own guard above).
document.addEventListener('toggle-status', () => {
  if (!lastSavePayload || lastStatus === undefined) return;
  const next: SavedWordStatus = lastStatus === 'known' ? 'learning' : 'known';
  lastStatus = next;
  inline.setStatus(next);
  void chrome.runtime
    .sendMessage({ type: 'saved.setStatus', word: lastSavePayload.word, status: next })
    .catch(() => undefined);
});

// B7: the card's nudge banner bubbles a composed `dismiss-nudge` event when its × is tapped.
// No wire message: the router already permanently marked this word as nudged before this reply
// was sent (domain/nudge-policy.ts) — dismissal is purely local, hiding the banner on this card.
document.addEventListener('dismiss-nudge', () => {
  inline.dismissNudge();
});

// The card's "Open in side panel" action (Chrome only) bubbles a composed `open-side-panel`
// event out of the bottom sheet. A content script can't call chrome.sidePanel.open(), so we
// relay it (synchronously, preserving the user gesture) to the service worker, then dismiss the
// in-page sheet so the lookup "moves" to the docked panel — but keep the mirror so the panel
// keeps showing it (do NOT call the renderer's close()).
document.addEventListener('open-side-panel', () => {
  const message: OpenSidePanelMessage =
    lastFocus !== undefined
      ? { type: 'open-side-panel', focus: lastFocus }
      : { type: 'open-side-panel' };
  void chrome.runtime.sendMessage(message).catch(() => undefined);
  inline.close();
});

// A4: keyboard-only flow. The service worker relays a fired chrome.commands shortcut here.
chrome.runtime.onMessage.addListener((msg: unknown, sender) => {
  if (sender.id !== chrome.runtime.id) return; // S3: same-extension only
  if (!isCommandMessage(msg)) return;
  switch (msg.command) {
    case 'define-selection':
      trigger.activate();
      break;
    case 'dismiss-lookup':
      trigger.hide();
      dismissAll();
      break;
    case 'send-to-panel':
      // Only meaningful with an active lookup on screen; reuses the exact same document event
      // the card's own "Open in side panel" button already dispatches (see above).
      if (lastFocus !== undefined) document.dispatchEvent(new CustomEvent('open-side-panel'));
      break;
  }
});
