import {
  runLookupWorkflow,
  registerContentElements,
  InlineBottomSheetRenderer,
  DomSelectionSource,
  MessageRelayLookupClient,
} from '@ai-dict/app';
import { SafariFloatingTrigger } from './adapters/safari-floating-trigger';
import { MessageRelaySettingsStore } from './adapters/message-relay-settings-store';
registerContentElements();

runLookupWorkflow({
  selection: new DomSelectionSource(document),
  trigger: new SafariFloatingTrigger(),
  renderer: new InlineBottomSheetRenderer(document.body), // the only surface on iOS
  client: new MessageRelayLookupClient(browser.runtime),
  settings: new MessageRelaySettingsStore(browser.runtime, (cb) =>
    browser.storage.onChanged.addListener(cb),
  ),
});
