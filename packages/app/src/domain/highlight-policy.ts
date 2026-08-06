/**
 * B3: re-encounter highlighting — pure naive-inflection word matcher (spec §D2). Naive matching
 * only (exact word + plural/-ed/-ing) by design — no lemmatizer, no fuzzy matching. Dependency-free
 * (rule-domain-purity): imports nothing outside domain/.
 */

/**
 * Naive inflection variants for a learning word: exact word, plural (+s, +es), -ed, and -ing —
 * where a word ending in 'e' uses the e-dropped -ing form (not the raw '+ing' double-e form) and
 * additionally gets a bare +d past tense. All lowercase.
 *
 * The '+es' rule always fires (even on 'bank' -> 'bankes'), which is a harmless over-generation:
 * it is not a real English word, so it can only ever match text that literally contains that
 * token, which naive real-world text never does.
 */
export function naiveVariants(word: string): string[] {
  const w = word.toLowerCase();
  const endsWithE = w.endsWith('e');
  const ingForm = endsWithE ? `${w.slice(0, -1)}ing` : `${w}ing`;
  const variants = [w, `${w}s`, `${w}es`, `${w}ed`, ingForm];
  if (endsWithE) {
    variants.push(`${w}d`);
  }
  return variants;
}

/**
 * Build a lookup of every naive variant of every learning word to its canonical saved headword
 * (also lowercased, matching the words as saved).
 */
export function buildHighlightMatcher(words: string[]): Map<string, string> {
  const matcher = new Map<string, string>();
  for (const word of words) {
    const headword = word.toLowerCase();
    for (const variant of naiveVariants(headword)) {
      matcher.set(variant, headword);
    }
  }
  return matcher;
}

export interface WordMatch {
  start: number;
  end: number;
  headword: string;
}

/**
 * Scan one text-node string for word-boundary tokens present in the matcher. A trailing
 * possessive ('s or bare ') is stripped before lookup, but the returned span still covers the
 * whole token as it appears in the text (e.g. "bank's" highlights in full).
 */
export function findWordMatches(text: string, matcher: Map<string, string>): WordMatch[] {
  const matches: WordMatch[] = [];
  if (matcher.size === 0 || text.length === 0) {
    return matches;
  }
  for (const m of text.matchAll(/[A-Za-z][A-Za-z'-]*/g)) {
    const token = m[0].toLowerCase().replace(/'s?$/, '');
    const headword = matcher.get(token);
    if (headword) {
      matches.push({ start: m.index, end: m.index + m[0].length, headword });
    }
  }
  return matches;
}
