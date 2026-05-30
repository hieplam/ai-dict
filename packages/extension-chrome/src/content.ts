import { runLookupWorkflow } from '@ai-dict/core';            // NOT @ai-dict/core/workflow (no such subpath)
import '@ai-dict/shared-ui/lookup-trigger';
import '@ai-dict/shared-ui/lookup-card';
import '@ai-dict/shared-ui/bottom-sheet';
import { InlineBottomSheetRenderer } from '@ai-dict/adapters-shared';
import { DomSelectionSource } from './adapters/dom-selection-source';
import { ChromeFloatingTrigger } from './adapters/chrome-floating-trigger';
import { MessageRelayLookupClient } from './adapters/message-relay-lookup-client';
import { MessageRelaySettingsStore } from './adapters/message-relay-settings-store';
import { ChromeSidePanelMirror } from './adapters/chrome-side-panel-mirror';

const inline = new InlineBottomSheetRenderer(document.body);
const mirror = new ChromeSidePanelMirror(chrome.runtime);

runLookupWorkflow({
  selection: new DomSelectionSource(document),
  trigger: new ChromeFloatingTrigger(),
  renderer: {
    renderLoading() { inline.renderLoading(); mirror.renderLoading(); },
    renderResult(r) { inline.renderResult(r); mirror.renderResult(r); },
    renderError(e) { inline.renderError(e); mirror.renderError(e); },
    close() { inline.close(); mirror.close(); },
  },
  client: new MessageRelayLookupClient(chrome.runtime),
  settings: new MessageRelaySettingsStore(chrome.runtime),
});
