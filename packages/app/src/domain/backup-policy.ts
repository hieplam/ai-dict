import type { Storage } from '../ports';
import type { SavedWordEntry, HistoryEntry } from './types';
import { savedWordsClear, savedWordGet, savedWordImport } from './saved-words-policy';
import { historyClear, historyImportEntry } from './history-policy';

export interface BackupImportDeps {
  storage: Storage;
}
export type BackupImportMode = 'merge' | 'replace';
export interface BackupImportResult {
  savedWordsImported: number;
  historyImported: number;
}

/**
 * B9: apply a backup file's savedWords/history into the local `saved:*`/`history:*` keyspaces.
 * `mode: 'replace'` clears both keyspaces first (design spec §3.2) — after that, the per-entry
 * logic below is IDENTICAL for merge and replace, since every local entry has already been
 * cleared out of replace's way. Settings are never touched here — settings import is a
 * client-side, always-replace overlay in the composition root (design spec §3.2/§4.5).
 */
export async function importBackup(
  deps: BackupImportDeps,
  savedWords: SavedWordEntry[],
  history: HistoryEntry[],
  mode: BackupImportMode,
): Promise<BackupImportResult> {
  if (mode === 'replace') {
    await savedWordsClear(deps);
    await historyClear(deps);
  }

  let savedWordsImported = 0;
  for (const entry of savedWords) {
    const existing = await savedWordGet(deps, entry.word);
    // Design spec §3.2: no local entry, or the imported entry's savedAt is strictly newer → it
    // wins. A tie keeps the local entry. In replace mode `existing` is always null (cleared
    // above), so every imported entry is written.
    if (!existing || entry.savedAt > existing.savedAt) {
      await savedWordImport(deps, entry);
      savedWordsImported++;
    }
  }

  // Design spec §3.2: oldest-createdAt-first so historyAppend's newest-first prepend ends up
  // matching the entries' real chronological order once every one has been processed.
  const sorted = [...history].sort((a, b) => a.createdAt - b.createdAt);
  let historyImported = 0;
  for (const entry of sorted) {
    if (await historyImportEntry(deps, entry)) historyImported++;
  }

  return { savedWordsImported, historyImported };
}
