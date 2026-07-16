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
 * Create or update the saved entry for `input.word`. A brand-new word gets
 * `status: 'learning'` and `savedAt: now()`; an existing entry (same normalized key) PRESERVES
 * its stored `status`/`savedAt` (so a re-save never silently undoes B5's future status work) but
 * REPLACES its single `senses[0]` with the fresh context (last-write-wins — B14's job is turning
 * this into a real multi-sense merge).
 */
export async function savedWordUpsert(
  deps: SavedWordsDeps,
  input: SavedWordInput,
): Promise<SavedWordEntry> {
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
  const entry: SavedWordEntry = {
    word: input.word,
    status: existing?.status ?? 'learning',
    savedAt: existing?.savedAt ?? now(),
    senses: [sense],
  };
  await deps.storage.setItem(`saved:${key}`, JSON.stringify(entry));
  if (!existing) {
    const idx = [key, ...(await readIndex(deps.storage))];
    await deps.storage.setItem(INDEX_KEY, JSON.stringify(idx));
  }
  return entry;
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
