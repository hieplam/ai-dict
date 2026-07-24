/**
 * C6: one-shot flag consumed by options.ts to enter "fix the rejected key" mode — focus the key
 * field, show likely-causes copy, and auto-run one connection.test after the very next Save. Set
 * by the router's `open-options` handler when the triggering `open-settings` event carried
 * `{ fixKey: true }` (the INVALID_KEY card's CTA only), or by the side panel's own direct-open
 * path (side-panel.ts calls chrome.runtime.openOptionsPage itself rather than routing through the
 * wire — see its existing 'open-settings' listener).
 *
 * A NEW namespace: ref-kv-storage-prefixes already reserves cache:/history:/saved:/nudge: for
 * persisted domain data. This key is a transient UI signal (written, read once, deleted within
 * the same options-page load) — not saved user data, so it does not extend any of those four.
 */
export const FIX_KEY_PENDING_STORAGE_KEY = 'ui:fixKeyPending';
