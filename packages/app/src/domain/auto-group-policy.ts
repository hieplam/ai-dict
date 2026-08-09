/**
 * B12 — LLM auto-grouping. Domain-pure: zero imports outward except `./types`
 * (rule-domain-purity). Owns the entire "cluster my saved words" contract: how much of the
 * saved list is sent per run (the batching cap), how the prompt is assembled (a single
 * self-contained string fed through LookupRequest.promptEnvelope's existing full-override
 * mechanism — see the design spec §2), and how the model's strict-JSON response is validated
 * before a single byte of it is trusted or persisted.
 */
import type { SavedWordEntry } from './types';

/**
 * Batching cap for one "Organize my words" run. NOT an arbitrary round number — lifted directly
 * from this card's own roadmap payoff line ("200 loose words → a dozen meaningful groups").
 * `savedWordsList` already returns newest-saved-first (saved-words-policy.ts's index is a
 * prepend), so capping at the front is "the 200 most recently saved words."
 */
export const MAX_WORDS_TO_ORGANIZE = 200;

/** How much of each definition's plain-text excerpt is fed into the prompt per word. */
const DEFINITION_EXCERPT_CHARS = 100;

/**
 * Strip common markdown syntax and collapse whitespace, then cap length. This text is prompt
 * INPUT only (never rendered to the DOM), so it is not a sanitize-model-output (S4) concern —
 * it exists purely to bound token cost while keeping enough topical signal for clustering.
 */
export function excerptDefinition(markdown: string, maxChars = DEFINITION_EXCERPT_CHARS): string {
  const plain = markdown
    .replace(/[#*_`>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > maxChars ? `${plain.slice(0, maxChars)}…` : plain;
}

/** Cap at MAX_WORDS_TO_ORGANIZE, taking the front of the (already newest-first) list. */
export function selectWordsToOrganize(entries: SavedWordEntry[]): {
  selected: SavedWordEntry[];
  skippedCount: number;
} {
  const selected = entries.slice(0, MAX_WORDS_TO_ORGANIZE);
  return { selected, skippedCount: Math.max(0, entries.length - selected.length) };
}

/**
 * Assemble the full organize prompt. Deliberately embeds every word LITERALLY (never as a
 * `{word}`-style placeholder) and contains none of PROMPT_ENVELOPE's placeholder tokens, so it
 * passes through `buildPrompt`/`renderTemplate` completely unmodified when supplied as
 * `LookupRequest.promptEnvelope` (the advanced full-override mechanism, #62) — see design spec
 * §2/§6.9 for why no change to prompt-template.ts/default-template.ts is needed.
 */
export function buildOrganizePrompt(entries: SavedWordEntry[]): string {
  const lines = entries.map((e, i) => {
    const def = e.senses[0] ? excerptDefinition(e.senses[0].definition) : '';
    return `${i + 1}. "${e.word}" — ${def}`;
  });
  return `You are organizing a language learner's saved vocabulary list into topic groups.

Below is a numbered list of saved words with a short excerpt of their definitions:
${lines.join('\n')}

Group these words into topic tags that would help the learner review by theme (e.g. "Finance",
"Emotions", "Words From Latin Spec-"). Rules:
- Every word listed above must appear in EXACTLY ONE group — do not omit any word, do not invent
  words that are not in the numbered list.
- Choose however many groups (between 2 and 12) best fit the words given — do not force unrelated
  words into the same group just to reduce the count.
- Each tag is a short topic label (2-4 words), Title Case, letters/numbers/spaces/hyphens only —
  no punctuation, no emoji.
- If a word genuinely fits no theme, place it in a group named exactly "Miscellaneous".

Output ONLY strict JSON — no markdown code fences, no commentary, no text before or after —
matching exactly this shape (an array of objects, each with a "tag" string and a "words" array of
strings copied verbatim from the numbered list above):
[{"tag":"Finance","words":["bank","equity"]},{"tag":"Miscellaneous","words":["serendipity"]}]`;
}

export interface TagGroup {
  tag: string;
  words: string[];
}

const MAX_TAG_LEN = 40;

function sanitizeTag(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.replace(/\s+/g, ' ').trim().slice(0, MAX_TAG_LEN);
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Parse + validate the model's organize response. Returns null (never throws) on ANY
 * non-conforming shape — malformed JSON, wrong types, or a word that wasn't sent — so the
 * caller shows one clear error rather than persisting partial/garbage output. Word-identity is
 * enforced (a hallucinated/mistyped word invalidates the WHOLE response); completeness is not
 * (a response that omits a few valid words is still accepted) — see design spec §3 for the
 * rationale split.
 */
export function parseOrganizeResponse(
  raw: string,
  validWords: readonly string[],
): TagGroup[] | null {
  const validSet = new Set(validWords.map((w) => w.toLowerCase()));
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const seen = new Set<string>();
  const groups: TagGroup[] = [];
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) return null;
    const tag = sanitizeTag((item as Record<string, unknown>).tag);
    const wordsRaw = (item as Record<string, unknown>).words;
    if (tag === null || !Array.isArray(wordsRaw)) return null;
    const groupWords: string[] = [];
    for (const w of wordsRaw) {
      if (typeof w !== 'string') return null;
      const key = w.toLowerCase();
      if (!validSet.has(key)) return null; // hallucinated/mistyped word → reject the whole reply
      if (seen.has(key)) continue; // duplicate placement across groups → keep the first
      seen.add(key);
      groupWords.push(w);
    }
    if (groupWords.length > 0) groups.push({ tag, words: groupWords });
  }
  return groups.length > 0 ? groups : null;
}
