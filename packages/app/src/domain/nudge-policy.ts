import type { Storage } from '../ports';
import { historyListSince } from './history-policy';
import { normalizeWordKey } from './saved-words-policy';

const NUDGE_PREFIX = 'nudge:';

/** How many within-window lookups of the same headword trigger the nudge. */
export const NUDGE_THRESHOLD = 3;
/** The rolling window the count is evaluated over: 30 days. */
export const NUDGE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export interface NudgeDeps {
  storage: Storage;
  /** Wall clock for the 30-day window; injectable so tests control it. Defaults to Date.now
   * (ref-dependency-injection) — mirrors the `now` seam CacheDeps/HistoryDeps/SavedWordsDeps
   * already use. */
  now?: () => number;
}

export async function nudgeAlreadyShown(deps: NudgeDeps, word: string): Promise<boolean> {
  const key = normalizeWordKey(word);
  return (await deps.storage.getItem(`${NUDGE_PREFIX}${key}`)) !== null;
}

export async function nudgeMarkShown(deps: NudgeDeps, word: string): Promise<void> {
  const key = normalizeWordKey(word);
  await deps.storage.setItem(`${NUDGE_PREFIX}${key}`, '1');
}

/**
 * B7: should THIS lookup's reply carry the repeat-offender nudge? True exactly once per word,
 * ever — the moment the word's within-window history count first reaches NUDGE_THRESHOLD, this
 * marks the word as nudged (so every future call for the same word returns false, regardless of
 * whether the reader saves, dismisses, or ignores this one) and returns true for this call only.
 * Callers attach the return value as `LookupResult.nudge` and must never persist it (like
 * `fallbackFrom`, it is a transient annotation on the reply, not part of the cached/historied
 * record).
 */
export async function evaluateNudge(deps: NudgeDeps, word: string): Promise<boolean> {
  if (await nudgeAlreadyShown(deps, word)) return false;
  const key = normalizeWordKey(word);
  const now = deps.now?.() ?? Date.now();
  const recent = await historyListSince({ storage: deps.storage }, now - NUDGE_WINDOW_MS);
  const count = recent.filter((e) => normalizeWordKey(e.word) === key).length;
  if (count < NUDGE_THRESHOLD) return false;
  await nudgeMarkShown(deps, word);
  return true;
}
