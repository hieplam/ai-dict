import type { HistoryEntry } from '../domain/types';

/**
 * Build the downloadable payload for "Export history".
 *
 * Entries are reconstructed field-by-field rather than spread, so any stray
 * property that rode along on an entry (e.g. an API key) can never survive into
 * the exported file — this is the [S1] api-key-isolation guarantee for export.
 */
export function buildHistoryExport(entries: HistoryEntry[]): {
  filename: string;
  json: string;
} {
  const safe = entries.map((e) => ({
    id: e.id,
    word: e.word,
    context: e.context,
    result: {
      markdown: e.result.markdown,
      word: e.result.word,
      target: e.result.target,
      model: e.result.model,
      fromCache: e.result.fromCache,
      fetchedAt: e.result.fetchedAt,
    },
    createdAt: e.createdAt,
  }));
  return {
    filename: 'ai-dict-history.json',
    json: JSON.stringify({ entries: safe }, null, 2),
  };
}
