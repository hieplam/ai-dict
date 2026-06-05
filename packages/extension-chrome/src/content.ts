import { runLookupWorkflow, InlineBottomSheetRenderer, DomSelectionSource, MessageRelayLookupClient } from '@ai-dict/app';
// Custom elements are defined by content-elements.ts (world:MAIN) — see manifest.json.
// Do NOT re-import them here; the page's registry is shared between worlds via the DOM.
import { ChromeFloatingTrigger } from './adapters/chrome-floating-trigger';
import { MessageRelaySettingsStore } from './adapters/message-relay-settings-store';
import { ChromeSidePanelMirror } from './adapters/chrome-side-panel-mirror';

const inline = new InlineBottomSheetRenderer(document.body);
const mirror = new ChromeSidePanelMirror(chrome.runtime);

runLookupWorkflow({
  selection: new DomSelectionSource(document),
  trigger: new ChromeFloatingTrigger(),
  renderer: {
    renderLoading() {
      inline.renderLoading();
      mirror.renderLoading();
    },
    renderResult(r) {
      inline.renderResult(r);
      mirror.renderResult(r);
    },
    renderError(e) {
      inline.renderError(e);
      mirror.renderError(e);
    },
    close() {
      inline.close();
      mirror.close();
    },
  },
  client: new MessageRelayLookupClient(chrome.runtime),
  settings: new MessageRelaySettingsStore(chrome.runtime),
});
