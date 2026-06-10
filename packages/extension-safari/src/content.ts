import {
  runLookupWorkflow,
  registerContentElements,
  InlineBottomSheetRenderer,
  DomSelectionSource,
  MessageRelayLookupClient,
  type SettingsStore,
} from '@ai-dict/app';
import { SafariFloatingTrigger } from './adapters/safari-floating-trigger';
import { MessageRelaySettingsStore } from './adapters/message-relay-settings-store';
registerContentElements();

const trigger = new SafariFloatingTrigger();
const renderer = new InlineBottomSheetRenderer(document.body); // the only surface on iOS

// Decorate the settings store so every fetch also re-applies the reader's theme to the
// in-page surfaces (bubble + card). The workflow fetches settings on each Define click and
// the relay store drops its cache on storage changes, so a theme saved on the options page
// reaches already-open tabs on their next lookup — plus once at startup for the bubble.
const settings = new MessageRelaySettingsStore(browser.runtime, (cb) =>
  browser.storage.onChanged.addListener(cb),
);
const themedSettings: SettingsStore = {
  get: () =>
    settings.get().then((s) => {
      trigger.theme = s.theme;
      renderer.theme = s.theme;
      return s;
    }),
  set: (patch) => settings.set(patch),
};
void themedSettings.get().catch(() => undefined); // seed before the first lookup; light until known

runLookupWorkflow({
  selection: new DomSelectionSource(document),
  trigger,
  renderer,
  client: new MessageRelayLookupClient(browser.runtime),
  settings: themedSettings,
});
