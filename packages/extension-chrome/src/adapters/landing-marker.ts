/** C11: the landing page (docs/index.html, served at https://hieplam.github.io/ai-dict/) is a
 * normal <all_urls> page content.ts already runs on. These three pure helpers are the entire
 * marker surface: detect that origin, and stamp/read three non-sensitive attributes on <html> so
 * the static page can adapt its checklist/CTA. See design spec §2 for the full rationale. */

export const LANDING_ORIGIN = 'https://hieplam.github.io';
export const LANDING_PATH_PREFIX = '/ai-dict/';

/** True only for the real landing origin+path prefix — never spoofable by page content. */
export function isLandingPage(loc: Pick<Location, 'origin' | 'pathname'>): boolean {
  return loc.origin === LANDING_ORIGIN && loc.pathname.startsWith(LANDING_PATH_PREFIX);
}

/** Stamp "the extension is here" + its version. Called unconditionally once isLandingPage() is
 * true — never carries settings, a key, or any other user data (S1 + the card's own fence). */
export function stampInstallMarker(root: HTMLElement, version: string): void {
  root.setAttribute('data-ad-dict-installed', 'true');
  root.setAttribute('data-ad-dict-version', version);
}

/** Stamp the one additional boolean the fence allows: "has the reader finished setup?" Derived
 * from PublicSettings.hasKey (packages/app/src/domain/types.ts:172) — never the key itself. */
export function stampReadyMarker(root: HTMLElement, ready: boolean): void {
  root.setAttribute('data-ad-dict-ready', String(ready));
}
