import { runLookupWorkflow } from '@ai-dict/core';            // NOT @ai-dict/core/workflow (no such subpath)
import '@ai-dict/shared-ui/lookup-trigger';
import '@ai-dict/shared-ui/lookup-card';
import '@ai-dict/shared-ui/bottom-sheet';
import { InlineBottomSheetRenderer } from '@ai-dict/adapters-shared';
import { DomSelectionSource } from './adapters/dom-selection-source';
import { SafariFloatingTrigger } from './adapters/safari-floating-trigger';
import { MessageRelayLookupClient } from './adapters/message-relay-lookup-client';
import { MessageRelaySettingsStore } from './adapters/message-relay-settings-store';

runLookupWorkflow({
  selection: new DomSelectionSource(document),
  trigger: new SafariFloatingTrigger(),
  renderer: new InlineBottomSheetRenderer(document.body),  // the only surface on iOS
  client: new MessageRelayLookupClient(browser.runtime),
  settings: new MessageRelaySettingsStore(browser.runtime, (cb) => browser.storage.onChanged.addListener(cb)),
});
