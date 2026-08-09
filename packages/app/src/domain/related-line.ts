/**
 * B13 — related words on save. Extracts the model's RELATED signal line (emitted per
 * PROMPT_ENVELOPE's {refine_instruction} slot when LookupRequest.refine === 'related' — see
 * default-template.ts's REFINE_INSTRUCTIONS.related) from the raw response text, and returns the
 * remaining body with that line (plus one immediately following blank line) stripped.
 *
 * Mirrors parseTranslation's contract exactly (domain/translation-line.ts) — a dedicated signal
 * line decoupled from the user-customizable Card format, for the same reason B2 needed one:
 * markdown-section parsing is fragile against arbitrary formatting/headings the reader may have
 * customized, while a fixed-shape line the extension owns end-to-end is reliable regardless.
 *
 * Comma-split, trimmed, empty entries dropped, capped at 8 (matches the prompt's own "at most 8"
 * instruction — a client-side backstop in case a model ignores it, bounding stored data size).
 *
 * Pure text processing — no synonym/antonym knowledge lives here (mirrors A8/B2's "no detection
 * engine" precedent). If the model didn't emit a recognisable RELATED line (a non-refine lookup,
 * legacy cached/history entries, a non-compliant model, or a custom envelope override that omits
 * {refine_instruction}), `related` is undefined and `body` is the ENTIRE input text unchanged.
 *
 * Domain-pure: zero imports (rule-domain-purity).
 */
const RELATED_LINE = /^RELATED:\s*"([^"]+)"[ \t]*$/m;

export function parseRelated(markdown: string): { related?: string[]; body: string } {
  const match = RELATED_LINE.exec(markdown);
  if (!match) return { body: markdown };
  const [line, raw] = match;
  const related = raw!
    .split(',')
    .map((w) => w.trim())
    .filter((w) => w.length > 0)
    .slice(0, 8);
  const before = markdown.slice(0, match.index).trim();
  const after = markdown
    .slice(match.index + line.length)
    .replace(/^\n/, '')
    .replace(/^\n/, '');
  return {
    ...(related.length > 0 ? { related } : {}),
    body: before ? `${before}\n${after}` : after,
  };
}
