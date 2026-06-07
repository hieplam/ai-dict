import { LookupTrigger } from './lookup-trigger';
import { LookupCard } from './lookup-card';
import { BottomSheet } from './bottom-sheet';
import { SettingsForm } from './settings-form';
import { SidePanelView } from './side-panel-view';

export function registerContentElements(): void {
  if (!customElements.get('lookup-trigger')) customElements.define('lookup-trigger', LookupTrigger);
  if (!customElements.get('lookup-card')) customElements.define('lookup-card', LookupCard);
  if (!customElements.get('bottom-sheet')) customElements.define('bottom-sheet', BottomSheet);
}

export function registerSidePanel(): void {
  if (!customElements.get('side-panel-view'))
    customElements.define('side-panel-view', SidePanelView);
}

export function registerSettingsForm(): void {
  if (!customElements.get('settings-form')) customElements.define('settings-form', SettingsForm);
}
