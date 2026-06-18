import {
  runLookupWorkflow,
  InlineBottomSheetRenderer,
  DomSelectionSource,
  MessageRelayLookupClient,
  buildConsentFooter,
  type SettingsStore,
  type WireReply,
} from '@ai-dict/app';
// Custom elements are defined by content-elements.ts (world:MAIN) — see manifest.json.
// Do NOT re-import them here; the page's registry is shared between worlds via the DOM.
import { ChromeFloatingTrigger } from './adapters/chrome-floating-trigger';
import { MessageRelaySettingsStore } from './adapters/message-relay-settings-store';
import { ChromeSidePanelMirror } from './adapters/chrome-side-panel-mirror';
import type { SidePanelFocus, OpenSidePanelMessage } from './side-panel-messages';

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

runLookupWorkflow({
  selection: new DomSelectionSource(document),
  trigger,
  renderer: {
    renderLoading(word) {
      lastFocus = word === undefined ? { state: 'loading' } : { state: 'loading', word };
      inline.renderLoading(word);
      mirror.renderLoading(word);
    },
    renderResult(r) {
      lastFocus = { state: 'result', payload: r };
      inline.renderResult(r);
      mirror.renderResult(r);
    },
    renderError(e) {
      lastFocus = { state: 'error', payload: e };
      inline.renderError(e);
      mirror.renderError(e);
      void maybeShowConsent();
    },
    close() {
      lastFocus = undefined;
      inline.close();
      mirror.close();
    },
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
