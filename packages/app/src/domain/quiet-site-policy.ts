import type { Storage } from '../ports';

const INDEX_KEY = 'quiet:index';
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

export interface QuietSiteDeps {
  storage: Storage;
}

/**
 * A13: resolve a URL or bare hostname to its registrable domain — the last two dot-separated
 * labels (e.g. `docs.google.com` -> `google.com`), so muting one subdomain silences the whole
 * site. Naive heuristic, no public-suffix list (see the design spec §2.1 for the accepted
 * false-positive-only limitation on multi-label suffixes like `co.uk`). IPv4 literals and
 * single/no-label hosts (`localhost`) are returned unchanged.
 */
export function registrableDomain(input: string): string {
  const trimmed = input.trim().toLowerCase();
  let hostname = trimmed;
  try {
    hostname = new URL(trimmed.includes('://') ? trimmed : `http://${trimmed}`).hostname;
  } catch {
    // Not URL-parseable (e.g. ''); fall back to the raw trimmed input.
  }
  if (IPV4.test(hostname)) return hostname;
  const parts = hostname.split('.').filter(Boolean);
  return parts.length <= 2 ? parts.join('.') : parts.slice(-2).join('.');
}

async function readIndex(s: Storage): Promise<string[]> {
  const raw = await s.getItem(INDEX_KEY);
  return raw ? (JSON.parse(raw) as string[]) : [];
}

/** Idempotent: adding an already-muted domain is a no-op (the card's "Mute this site" action
 * relies on this — it never checks current state first, see design spec §2.3). Returns the
 * full, sorted list after the write. */
export async function quietSiteAdd(deps: QuietSiteDeps, domain: string): Promise<string[]> {
  const d = registrableDomain(domain);
  const idx = await readIndex(deps.storage);
  if (idx.includes(d)) return idx;
  const next = [...idx, d].sort();
  await deps.storage.setItem(INDEX_KEY, JSON.stringify(next));
  return next;
}

/** Idempotent: removing an unmuted domain is a no-op, matching savedWordDelete's contract
 * (saved-words-policy.ts:71). Returns the full list after the write. */
export async function quietSiteRemove(deps: QuietSiteDeps, domain: string): Promise<string[]> {
  const d = registrableDomain(domain);
  const next = (await readIndex(deps.storage)).filter((x) => x !== d);
  await deps.storage.setItem(INDEX_KEY, JSON.stringify(next));
  return next;
}

export async function quietSiteList(deps: QuietSiteDeps): Promise<string[]> {
  return readIndex(deps.storage);
}

/** Pure membership check against an already-fetched list — the primitive a content script (or a
 * future B3 scanner, design spec §2.5) uses locally without a KV round trip per check. */
export function isQuietSite(domains: string[], hostname: string): boolean {
  return domains.includes(registrableDomain(hostname));
}
