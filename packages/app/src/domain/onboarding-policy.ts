/**
 * C1: should a fresh extension install open the onboarding (options.html) welcome screen?
 * True only for a genuine first install ('install' — never 'update', so a version bump on an
 * already-onboarded reader's browser never re-prompts them) AND only when the build did not bake
 * a Gemini key via the env-key build path (an env-key build already counts as "set up" — mirrors
 * options.ts's own KEY_FROM_ENV skip and sw.ts's ENV_API_KEY-wins-over-stored-key resolution).
 * Pure predicate, no chrome.* access: the composition root (sw.ts) owns the actual
 * chrome.runtime.onInstalled listener and the openOptionsPage() call this gates. `reason` is
 * typed as `string`, not chrome's own OnInstalledReason union, so this file stays free of any
 * chrome.* type import (ref-core-dependency-rule) and stays portable to the Safari shell if it
 * ever grows the same onboarding screen.
 */
export function shouldOpenOnboardingOnInstall(reason: string, envKeyBaked: boolean): boolean {
  return reason === 'install' && !envKeyBaked;
}
