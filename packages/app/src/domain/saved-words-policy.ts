import type { Storage } from '../ports';
import type { SavedWordEntry, SavedWordSense, SavedWordStatus } from './types';

const INDEX_KEY = 'saved:index';

export interface SavedWordsDeps {
  storage: Storage;
  /** Wall clock for `savedAt`; injectable so tests control it (ref-dependency-injection). */
  now?: () => number;
}

/** The input a caller supplies to upsert one saved word — everything EXCEPT the policy-owned
 * `status`/`savedAt` fields (defaulted/preserved by savedWordUpsert itself). */
export interface SavedWordInput {
  word: string;
  definition: string;
  translation: string;
  sentence: string;
  url: string;
  title: string;
}

/** `word` is the case-insensitive unique key (B1's ratified schema). Trim + lowercase so
 * "Bank" and "bank" collide on the same storage entry. */
export function normalizeWordKey(word: string): string {
  return word.trim().toLowerCase();
}

async function readIndex(s: Storage): Promise<string[]> {
  const raw = await s.getItem(INDEX_KEY);
  return raw ? (JSON.parse(raw) as string[]) : [];
}

/**
 * B14: the outcome of a savedWordUpsert call. `'saved'` means a write happened (or an
 * exact-duplicate sense made a write unnecessary — either way the caller's payload is now
 * reflected in `entry`). `'conflict'` means the word is already saved under a DIFFERENT
 * sentence/url and NOTHING was written — the caller must re-call with `confirmNewSense: true`
 * to append, or do nothing (decline = no write, roadmap B14 fence).
 */
export type SavedWordUpsertResult =
  | { kind: 'saved'; entry: SavedWordEntry }
  | { kind: 'conflict'; senseCount: number };

/**
 * Create or update the saved entry for `input.word`. A brand-new word gets
 * `status: 'learning'` and `savedAt: now()`. An existing entry (same normalized key):
 *  - an EXACT sentence+url repeat of an already-stored sense is a silent no-op (idempotent,
 *    returns the unchanged entry, no write, no confirmation needed);
 *  - a genuinely different sentence/url needs `opts.confirmNewSense: true` to append — without
 *    it, this returns `{kind:'conflict', senseCount}` and writes nothing (B14: sense-aware
 *    dedup — see the design spec for the full merge-prompt UX this return shape drives).
 */
export async function savedWordUpsert(
  deps: SavedWordsDeps,
  input: SavedWordInput,
  opts: { confirmNewSense?: boolean } = {},
): Promise<SavedWordUpsertResult> {
  const key = normalizeWordKey(input.word);
  const now = deps.now ?? Date.now;
  const existingRaw = await deps.storage.getItem(`saved:${key}`);
  const existing = existingRaw ? (JSON.parse(existingRaw) as SavedWordEntry) : null;
  const sense: SavedWordSense = {
    definition: input.definition,
    translation: input.translation,
    sentence: input.sentence,
    url: input.url,
    title: input.title,
  };

  if (existing) {
    const isDuplicate = existing.senses.some(
      (s) => s.sentence === sense.sentence && s.url === sense.url,
    );
    if (isDuplicate) return { kind: 'saved', entry: existing };

    if (opts.confirmNewSense !== true) {
      return { kind: 'conflict', senseCount: existing.senses.length };
    }

    const entry: SavedWordEntry = {
      ...existing,
      word: input.word, // latest casing wins for display — same rule every prior write already used
      senses: [...existing.senses, sense],
    };
    await deps.storage.setItem(`saved:${key}`, JSON.stringify(entry));
    return { kind: 'saved', entry };
  }

  const entry: SavedWordEntry = {
    word: input.word,
    status: 'learning',
    savedAt: now(),
    senses: [sense],
  };
  await deps.storage.setItem(`saved:${key}`, JSON.stringify(entry));
  const idx = [key, ...(await readIndex(deps.storage))];
  await deps.storage.setItem(INDEX_KEY, JSON.stringify(idx));
  return { kind: 'saved', entry };
}

/** Idempotent: removing an unknown word is a no-op, matching historyDelete's contract. */
export async function savedWordDelete(deps: SavedWordsDeps, word: string): Promise<void> {
  const key = normalizeWordKey(word);
  await deps.storage.removeItem(`saved:${key}`);
  const idx = (await readIndex(deps.storage)).filter((k) => k !== key);
  await deps.storage.setItem(INDEX_KEY, JSON.stringify(idx));
}

/**
 * B5: manually flip an existing saved word's status between 'learning' (default) and 'known'.
 * Exactly 2 states, no auto-promotion (roadmap B5 scope fence) — this is the only place status
 * ever changes after the initial save/re-save (savedWordUpsert preserves it). No-op (returns
 * null) when the word isn't currently saved — the toggle only ever renders on an already-saved
 * word's own surface, so this guards a race (e.g. deleted between render and click), not the
 * expected path.
 */
export async function savedWordSetStatus(
  deps: SavedWordsDeps,
  word: string,
  status: SavedWordStatus,
): Promise<SavedWordEntry | null> {
  const key = normalizeWordKey(word);
  const raw = await deps.storage.getItem(`saved:${key}`);
  if (!raw) return null;
  const existing = JSON.parse(raw) as SavedWordEntry;
  const entry: SavedWordEntry = { ...existing, status };
  await deps.storage.setItem(`saved:${key}`, JSON.stringify(entry));
  return entry;
}

/**
 * B13: patch the related-words list onto an ALREADY-saved word's current (senses[0]) sense.
 * No-op (returns null) when the word isn't currently saved — mirrors savedWordSetStatus's own
 * contract exactly: "only persists when the word IS saved" (roadmap fence) is enforced HERE,
 * atomically, because this is the only place with real ground truth (the composition root's own
 * "is this saved" tracking is reset on every render and cannot answer reliably — see the design
 * spec's §2.5). Targets senses[0] specifically: pre-B14, `senses` is always exactly one entry
 * (savedWordUpsert never produces more), and a 'related' refine tap always answers about the
 * single sense currently on screen.
 */
export async function savedWordSetRelated(
  deps: SavedWordsDeps,
  word: string,
  related: string[],
): Promise<SavedWordEntry | null> {
  const key = normalizeWordKey(word);
  const raw = await deps.storage.getItem(`saved:${key}`);
  if (!raw) return null;
  const existing = JSON.parse(raw) as SavedWordEntry;
  const senses = existing.senses.map((s, i) => (i === 0 ? { ...s, related } : s));
  const entry: SavedWordEntry = { ...existing, senses };
  await deps.storage.setItem(`saved:${key}`, JSON.stringify(entry));
  return entry;
}

/**
 * B9: write an already-fully-formed entry verbatim (status/savedAt/senses exactly as given) —
 * used only by backup import, which must preserve an imported entry's own history rather than
 * derive a fresh one the way savedWordUpsert does for a live save (savedWordUpsert always
 * recomputes/preserves savedAt from `now()`/the existing record; this function never calls
 * `now()` at all). Adds the key to the index only if not already present, so importing an entry
 * that already exists (post merge-decision) never duplicates the index.
 */
export async function savedWordImport(deps: SavedWordsDeps, entry: SavedWordEntry): Promise<void> {
  const key = normalizeWordKey(entry.word);
  await deps.storage.setItem(`saved:${key}`, JSON.stringify(entry));
  const idx = await readIndex(deps.storage);
  if (!idx.includes(key)) {
    await deps.storage.setItem(INDEX_KEY, JSON.stringify([key, ...idx]));
  }
}

export async function savedWordGet(
  deps: SavedWordsDeps,
  word: string,
): Promise<SavedWordEntry | null> {
  const raw = await deps.storage.getItem(`saved:${normalizeWordKey(word)}`);
  return raw ? (JSON.parse(raw) as SavedWordEntry) : null;
}

/** Newest-saved-first (mirrors historyList's index order). Full list, no pagination — B6 (Words
 * page) is the future consumer; B1 ships the primitive, not pagination (no callers need it yet). */
export async function savedWordsList(deps: SavedWordsDeps): Promise<SavedWordEntry[]> {
  const idx = await readIndex(deps.storage);
  const out: SavedWordEntry[] = [];
  for (const key of idx) {
    const raw = await deps.storage.getItem(`saved:${key}`);
    if (raw) out.push(JSON.parse(raw) as SavedWordEntry);
  }
  return out;
}

/** Removes every `saved:*` key including the index. Never called by historyClear/cacheClear —
 * saved words are an independent keyspace (roadmap B1 scope fence). */
export async function savedWordsClear(deps: SavedWordsDeps): Promise<void> {
  for (const k of await deps.storage.keys('saved:')) await deps.storage.removeItem(k);
}
