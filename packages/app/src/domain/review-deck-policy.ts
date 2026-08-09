import type { SavedWordEntry } from './types';

/** B11: only learning-status words saved within the last REVIEW_WINDOW_DAYS days enter the deck
 * — see the design spec §2.2 for why this reads `savedAt`, not a per-sense timestamp. */
export const REVIEW_WINDOW_DAYS = 14;
const REVIEW_WINDOW_MS = REVIEW_WINDOW_DAYS * 24 * 60 * 60 * 1000;

/** Fisher-Yates. Only ever reached via buildReviewDeck's default parameter (impure —
 * Math.random); tests always supply a deterministic override (design spec §2.3, the same DI
 * pattern SavedWordsDeps.now/RouterDeps.now already use). */
function defaultShuffle(entries: SavedWordEntry[]): SavedWordEntry[] {
  const out = entries.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

export interface BuildReviewDeckOptions {
  /** Wall clock; injectable so tests are deterministic (mirrors SavedWordsDeps.now/RouterDeps.now). */
  nowMs: number;
  /** Deterministic override for tests; defaults to defaultShuffle (real randomness) when omitted. */
  shuffle?: (entries: SavedWordEntry[]) => SavedWordEntry[];
}

/**
 * B11: the casual-review deck = learning-status words saved within the last REVIEW_WINDOW_DAYS
 * days, shuffled. Pure function — no I/O; the only non-determinism (Math.random) is confined to
 * the optional `shuffle` DI seam. PERMANENT fence (roadmap B11): no scheduling algorithm, no due
 * dates, no streaks — this function filters + shuffles, nothing else, every time it runs.
 */
export function buildReviewDeck(
  entries: SavedWordEntry[],
  opts: BuildReviewDeckOptions,
): SavedWordEntry[] {
  const cutoff = opts.nowMs - REVIEW_WINDOW_MS;
  const eligible = entries.filter(
    (e) => e.status === 'learning' && e.savedAt >= cutoff && e.savedAt <= opts.nowMs,
  );
  const shuffle = opts.shuffle ?? defaultShuffle;
  return shuffle(eligible);
}
