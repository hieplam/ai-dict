import type { SavedWordEntry } from '../domain/types';

/**
 * Build the three downloadable "export saved words" payloads (B8): an Anki-importable TSV, a
 * spreadsheet-friendly CSV, and a human-readable Markdown reference. All three share the same
 * pinned column order and per-sense row expansion — see the design spec §3-4 for the full
 * rationale behind every choice below.
 */
interface AnkiExportRow {
  word: string;
  definition: string;
  translation: string;
  sentence: string;
  url: string;
  title: string;
  /** ISO-8601, converted from SavedWordEntry.savedAt (epoch ms) — raw epoch ms is not
   * human-legible on a flashcard back; ISO-8601 needs no locale/timezone decision. */
  savedAt: string;
  status: string;
}

const COLUMNS = [
  'word',
  'definition',
  'translation',
  'sentence',
  'url',
  'title',
  'savedAt',
  'status',
] as const;

/**
 * One row per SENSE, not per saved word — word/savedAt/status repeat across a word's rows. Every
 * saved word has senses.length === 1 today (B1 always replaces senses[0] wholesale on re-save),
 * but the shape is already multi-sense-ready for B14; iterating senses here means this export
 * needs zero changes the day B14 ships real multi-sense entries. Reconstructed field-by-field
 * (never spread) so a stray property on either level can never survive into an export — the same
 * [S1] pattern history-export.ts already uses.
 */
function toRows(entries: SavedWordEntry[]): AnkiExportRow[] {
  const rows: AnkiExportRow[] = [];
  for (const e of entries) {
    const savedAt = new Date(e.savedAt).toISOString();
    for (const sense of e.senses) {
      rows.push({
        word: e.word,
        definition: sense.definition,
        translation: sense.translation,
        sentence: sense.sentence,
        url: sense.url,
        title: sense.title,
        savedAt,
        status: e.status,
      });
    }
  }
  return rows;
}

// Anki's plain-text (TSV) note importer treats a literal tab as a field delimiter and a literal
// newline as a record delimiter, with NO in-field escape mechanism for either — a stray tab/
// newline inside a model-authored definition would silently shift a later column or split one
// note into two. Collapse both to a single space so column alignment can never be corrupted.
function tsvEscape(v: string): string {
  return v.replace(/\t/g, ' ').replace(/\r\n|\r|\n/g, ' ');
}

/**
 * Anki-importable TSV. No header row: Anki's "Import File" note importer maps columns to
 * note-type fields positionally and does not skip a first line unless the user configures it to —
 * a literal header line would import as a bogus first flashcard. Column order is documented in
 * the design spec instead of self-described in the file.
 */
export function buildAnkiTsv(entries: SavedWordEntry[]): { filename: string; content: string } {
  const rows = toRows(entries);
  const lines = rows.map((r) => COLUMNS.map((c) => tsvEscape(r[c])).join('\t'));
  return { filename: 'ai-dict-anki.tsv', content: lines.length ? lines.join('\n') + '\n' : '' };
}

// RFC 4180: quote a field iff it contains a comma, double quote, or CR/LF; double any embedded
// double quote. Unlike TSV, CSV's quoting lets a definition's own commas/newlines survive intact
// instead of being collapsed — CSV targets spreadsheet tooling, where preserving the original
// text matters more than positional column safety.
function csvEscape(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/**
 * Spreadsheet-friendly CSV, WITH a header row (unlike TSV): the CSV audience is general
 * spreadsheet software, where a header aids the reader, and Anki's own CSV import screen offers
 * an explicit "first line contains column names" checkbox, so a header does not silently corrupt
 * an Anki CSV import either.
 */
export function buildAnkiCsv(entries: SavedWordEntry[]): { filename: string; content: string } {
  const rows = toRows(entries);
  const lines = [
    COLUMNS.join(','),
    ...rows.map((r) => COLUMNS.map((c) => csvEscape(r[c])).join(',')),
  ];
  return { filename: 'ai-dict-anki.csv', content: lines.join('\r\n') + '\r\n' };
}

/**
 * Human-readable Markdown reference — NOT for Anki import. No escaping needed: Markdown is not a
 * delimited/tabular format, so an embedded comma/tab/newline cannot corrupt row/column structure.
 * `definition` is embedded verbatim (the model's raw markdown text, exactly as SavedWordSense
 * already stores it) — this file is opened locally by the user in their own editor, so none of
 * S4's DOM-rendering sanitize concerns apply (no export path renders anything back inside the
 * extension's own DOM).
 */
export function buildAnkiMarkdown(entries: SavedWordEntry[]): {
  filename: string;
  content: string;
} {
  const rows = toRows(entries);
  const blocks = rows.map(
    (r) =>
      `## ${r.word}\n\n` +
      `**Definition:** ${r.definition}\n\n` +
      `**Translation:** ${r.translation}\n\n` +
      `**Sentence:** ${r.sentence}\n\n` +
      `**Source:** [${r.title || r.url}](${r.url})\n\n` +
      `**Saved:** ${r.savedAt} · **Status:** ${r.status}\n`,
  );
  return { filename: 'ai-dict-anki.md', content: blocks.join('\n---\n\n') };
}
