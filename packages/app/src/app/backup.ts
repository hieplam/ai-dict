import type { SavedWordEntry, HistoryEntry } from '../domain/types';

export const BACKUP_FORMAT = 'ai-dict-backup';
export const BACKUP_VERSION = 1;

/**
 * B9: the non-secret settings fields worth carrying to another device (design spec §3.1).
 * Deliberately excludes apiKey/openaiApiKey/anthropicApiKey (S1) and the derived hasKey/
 * configuredProviders (recomputed live from whatever key exists on the destination device —
 * never carried across).
 */
export interface BackupSettings {
  targetLang: string;
  outputFormat: string;
  promptEnvelope: string;
  theme: string;
  cacheEnabled: boolean;
  saveHistory: boolean;
  provider: string;
}

export interface BackupEnvelope {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  exportedAt: number;
  data: {
    savedWords: SavedWordEntry[];
    history: HistoryEntry[];
    settings: BackupSettings;
  };
}

/**
 * Build the downloadable backup payload (B9, the E2 envelope verbatim). Every field is
 * reconstructed explicitly rather than spread — mirrors buildHistoryExport's convention
 * (app/history-export.ts) — so a stray secret riding along on any input object can never survive
 * into the exported file (S1 defense-in-depth on top of BackupSettings' own type shape).
 */
export function buildBackupExport(
  savedWords: SavedWordEntry[],
  history: HistoryEntry[],
  settings: BackupSettings,
  now: () => number,
): { filename: string; json: string } {
  const envelope: BackupEnvelope = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: now(),
    data: {
      savedWords: savedWords.map((e) => ({
        word: e.word,
        status: e.status,
        savedAt: e.savedAt,
        senses: e.senses.map((s) => ({
          definition: s.definition,
          translation: s.translation,
          sentence: s.sentence,
          url: s.url,
          title: s.title,
        })),
      })),
      history: history.map((e) => ({
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
      })),
      settings: {
        targetLang: settings.targetLang,
        outputFormat: settings.outputFormat,
        promptEnvelope: settings.promptEnvelope,
        theme: settings.theme,
        cacheEnabled: settings.cacheEnabled,
        saveHistory: settings.saveHistory,
        provider: settings.provider,
      },
    },
  };
  return { filename: 'ai-dict-backup.json', json: JSON.stringify(envelope, null, 2) };
}

const STRING_SETTINGS_FIELDS = [
  'targetLang',
  'outputFormat',
  'promptEnvelope',
  'theme',
  'provider',
] as const;
const BOOLEAN_SETTINGS_FIELDS = ['cacheEnabled', 'saveHistory'] as const;

/**
 * B9 fix: a hand-edited/corrupt backup file can carry a wrong-typed value for a known settings
 * field (e.g. `cacheEnabled: "false"` as a string, which is truthy and would silently invert the
 * stored boolean once it flows through the client-side overlay). Copies through ONLY the 7 known
 * BackupSettings fields whose runtime type matches, dropping any wrong-typed or absent field so
 * the overlay's `!== undefined` guard keeps the current stored value instead.
 */
function parseBackupSettings(raw: unknown): Partial<BackupSettings> {
  if (typeof raw !== 'object' || raw === null) return {};
  const obj = raw as Record<string, unknown>;
  const out: Partial<BackupSettings> = {};
  for (const key of STRING_SETTINGS_FIELDS) {
    const value = obj[key];
    if (typeof value === 'string') out[key] = value;
  }
  for (const key of BOOLEAN_SETTINGS_FIELDS) {
    const value = obj[key];
    if (typeof value === 'boolean') out[key] = value;
  }
  return out;
}

export type ParsedBackupFile =
  | {
      ok: true;
      savedWords: unknown[];
      history: unknown[];
      settings: Partial<BackupSettings>;
    }
  | { ok: false; error: string };

/**
 * Validate a backup file's OUTER envelope (format/version/presence) — the client-side half of
 * the split described in the design spec §3.4. Returns the three `data.*` values UNVALIDATED at
 * the per-entry level (that happens at the wire boundary via the non-strict Import* schemas,
 * design spec §3.5).
 */
export function parseBackupFile(text: string): ParsedBackupFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'This file is not valid JSON.' };
  }
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: 'This file is not a valid AI Dictionary backup.' };
  }
  const obj = raw as Record<string, unknown>;
  if (obj['format'] !== BACKUP_FORMAT) {
    return { ok: false, error: 'This file is not a valid AI Dictionary backup.' };
  }
  if (typeof obj['version'] !== 'number' || obj['version'] > BACKUP_VERSION) {
    return {
      ok: false,
      error:
        'This backup was made with a newer version of AI Dictionary. Update the extension and try again.',
    };
  }
  const data = (obj['data'] as Record<string, unknown> | undefined) ?? {};
  return {
    ok: true,
    savedWords: Array.isArray(data['savedWords']) ? data['savedWords'] : [],
    history: Array.isArray(data['history']) ? data['history'] : [],
    settings: parseBackupSettings(data['settings']),
  };
}
