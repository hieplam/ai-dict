/**
 * C7: toolbar badge state (see docs/superpowers/specs/2026-07-16-c7-finish-setup-badge-design.md
 * D2). Exactly two shapes — a no-key indicator only, never a general notification channel
 * (roadmap C7 scope fence).
 */
export interface BadgeState {
  /** '' clears the badge; '!' is the only non-empty glyph in v1. */
  text: '' | '!';
  /** Tooltip override. '' means "no override" — the shell restores its own default title
   *  (this module has no access to, and must not hardcode, the manifest's default_title). */
  title: string;
}

/**
 * Derive the toolbar badge state from the exact same "usable key" boolean onboarding routing
 * uses (PublicSettings.hasKey — see hasKeyFor/configuredProvidersFor in ./types), so the badge
 * and onboarding routing can never disagree. Pure: no chrome.*, unit-testable without a browser.
 */
export function badgeStateFor(hasUsableKey: boolean): BadgeState {
  return hasUsableKey
    ? { text: '', title: '' }
    : { text: '!', title: 'Finish AI Dictionary setup' };
}
