import { LookupTrigger } from './lookup-trigger';
import { LookupCard } from './lookup-card';
import { LookupGloss } from './lookup-gloss';
import { BottomSheet } from './bottom-sheet';
import { HoverRecallPopup } from './hover-recall-popup';
import { SettingsForm } from './settings-form';
import { SidePanelView } from './side-panel-view';
import { WordsPageView } from './words-page-view';
import { OnboardingView } from './onboarding-view';

export function registerContentElements(): void {
  if (!customElements.get('lookup-trigger')) customElements.define('lookup-trigger', LookupTrigger);
  if (!customElements.get('lookup-card')) customElements.define('lookup-card', LookupCard);
  if (!customElements.get('lookup-gloss')) customElements.define('lookup-gloss', LookupGloss);
  if (!customElements.get('bottom-sheet')) customElements.define('bottom-sheet', BottomSheet);
  // B4: registered alongside the other in-page (MAIN-world) elements — same content-elements.ts
  // entry point, no new registration function.
  if (!customElements.get('hover-recall-popup'))
    customElements.define('hover-recall-popup', HoverRecallPopup);
}

export function registerSidePanel(): void {
  if (!customElements.get('side-panel-view'))
    customElements.define('side-panel-view', SidePanelView);
  if (!customElements.get('words-page-view'))
    customElements.define('words-page-view', WordsPageView);
}

export function registerSettingsForm(): void {
  if (!customElements.get('settings-form')) customElements.define('settings-form', SettingsForm);
}

export function registerOnboarding(): void {
  if (!customElements.get('onboarding-view'))
    customElements.define('onboarding-view', OnboardingView);
}
