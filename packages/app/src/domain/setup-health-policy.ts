import { PROVIDERS, type Provider } from './types';

/** C9: one row of the "API keys" check — one per known provider, in PROVIDERS order. */
export interface KeyStatusRow {
  provider: Provider;
  configured: boolean;
}

/**
 * C9: derive the per-provider key-presence rows, in canonical PROVIDERS order, from whatever
 * list of currently-configured providers the caller computed (typically `configuredProvidersFor`
 * run against the settings form's live, possibly-unsaved key state). Pure: no chrome/DOM.
 */
export function deriveKeyStatusRows(configured: readonly Provider[]): KeyStatusRow[] {
  return PROVIDERS.map((provider) => ({ provider, configured: configured.includes(provider) }));
}

/**
 * C9: the minimal structural shape this file needs out of a chrome.commands.Command — declared
 * locally (not imported from any chrome lib) so this file stays chrome-free per
 * rule-domain-purity. The composition root's raw `chrome.commands.getAll()` result satisfies
 * this shape structurally; no cast needed at the call site.
 */
export interface CommandLike {
  name?: string | undefined;
  description?: string | undefined;
  shortcut?: string | undefined;
}

export interface ShortcutStatusRow {
  name: string;
  description: string;
  assigned: boolean;
}

/**
 * C9: derive one row per registered command. `assigned` is true iff Chrome reports a non-empty
 * `shortcut` string. Defensive defaults for all three fields since `Command` declares them
 * optional.
 */
export function deriveShortcutRows(commands: readonly CommandLike[]): ShortcutStatusRow[] {
  return commands.map((c) => ({
    name: c.name ?? '',
    description: c.description ?? '',
    assigned: Boolean(c.shortcut),
  }));
}
