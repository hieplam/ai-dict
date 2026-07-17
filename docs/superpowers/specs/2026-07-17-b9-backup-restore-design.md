# B9 — Backup & restore

Roadmap card: `docs/ROADMAP.md` §4 B9 (Impact 3 · Effort S · Score 3.0). Depends on: B1 (shipped —
the `saved:*` keyspace this card exports/imports). Escalation E2 (backup file envelope) is
**resolved** — `docs/ROADMAP.md` §8 Decision Log, 2026-07-16 — quoted verbatim in §1 below; this
spec does not reopen it.

## 1. The E2 envelope (ratified, quoted verbatim — do not restate loosely)

From `CONTRACTS.md` §3 / `docs/ROADMAP.md` §8 Decision Log (2026-07-16, "E2 escalation — backup
file envelope"), the owner ratified:

```
{ format: "ai-dict-backup", version: 1, exportedAt: <timestamp>,
  data: { savedWords: SavedWordEntry[], history: HistoryEntry[],
          settings: <all settings MINUS the API key (S1)> } }
```

"Import offers merge or replace, and importers ignore unknown future fields. Additive fields stay
lead-decidable under this lock; restructuring or removing a ratified field is a new escalation
(same governance as E1)."

Everything below pins the _implementation_ of this ratified shape — field-for-field, the JSON a
user downloads matches the quoted envelope exactly (§4.3).

## 2. Problem (grounded in code)

- All persisted data lives in three independent `chrome.storage.local` keyspaces, each owned by
  its own domain policy module: `saved:*` (`packages/app/src/domain/saved-words-policy.ts`,
  B1), `history:*` (`packages/app/src/domain/history-policy.ts`), and a single `settings` object
  (`packages/extension-chrome/src/adapters/chrome-storage-store.ts:31-65`, `ChromeStorageStore`).
  Per `ref-kv-storage-prefixes` (confirmed `REPO-FACTS.md` §9), nothing today reads across all
  three at once.
- One export mechanism already exists and is the template this card follows exactly:
  **"Export history"** — `packages/app/src/ui/settings-form.ts:210` (`<button id="export"
  class="link">Export history</button>`), relayed as a DOM event at `settings-form.ts:312`
  (`this.relay('#export', 'export-history')`), handled identically in both composition roots —
  `packages/extension-chrome/src/options.ts:158-176` and
  `packages/extension-safari/src/options.ts:94-112` — which call `send({ type: 'history.list'
})`, then `buildHistoryExport(entries)` (`packages/app/src/app/history-export.ts:10-31`, a pure
  function that reconstructs every field explicitly rather than spreading, "so any stray property
  … can never survive into the exported file" — `history-export.ts:6-8`, the house S1 pattern),
  then the local `download(filename, content)` helper already defined in both options.ts files
  (`options.ts:57-64` Chrome, `options.ts:47-54` Safari) that creates a `Blob` + `<a download>` +
  `.click()` + `URL.revokeObjectURL`.
- **No import/restore mechanism exists anywhere.** Confirmed by repo-wide grep: zero matches for
  `backup` (case-insensitive) across `packages/`; zero `<input type="file">` anywhere in
  `packages/app/src/ui` or either extension's `src/`; zero `FileReader` usage in any source file
  (only a minified vendor string inside a generated Playwright HTML report, not app code). This
  card is greenfield for import.
- **No wire message can list all saved words.** `wire.ts`'s arms (`packages/app/src/wire.ts:95-141`)
  cover `saved.save`/`saved.delete`/`saved.setStatus` but nothing returns the full list —
  `savedWordsList` (`packages/app/src/domain/saved-words-policy.ts:110-118`) exists as a domain
  primitive (its doc comment says "B6 (Words page) is the future consumer") but is never routed.
  Export needs exactly this, today, ahead of B6.
- **Settings' non-secret fields live only in the full `Settings` shape**, never in
  `PublicSettings`. `SettingsStore.get()` (`ports.ts:66-69`, implemented by `ChromeStorageStore.get`
  at `chrome-storage-store.ts:44-59`) returns `PublicSettings`
  (`domain/types.ts:164-176`: `targetLang, outputFormat, promptEnvelope, hasKey, theme,
configuredProviders`) — `hasKey`/`configuredProviders` are _derived_ (recomputed from whichever
  key exists locally), never real preferences. `provider`, `cacheEnabled`, `saveHistory` are real
  user preferences but exist only on the full `Settings` interface (`domain/types.ts:210-217`),
  read today only by each options.ts's own `load()` helper
  (`options.ts:45-49` Chrome, direct `browser.storage.local.get('settings')` at Safari
  `options.ts:29-33`) — a trusted-context direct read, never a wire round-trip.

## 3. Design questions (every "Lead decides" item pinned)

### 3.1 What exactly is "settings MINUS the API key" — pin the exported shape

E2 says "all settings MINUS the API key." The literal _all_ settings (`Settings`,
`domain/types.ts:210-217`) is `PublicSettings` (`targetLang, outputFormat, promptEnvelope, hasKey,
theme, configuredProviders`) plus `apiKey, cacheEnabled, saveHistory, provider, openaiApiKey,
anthropicApiKey`.

**Pinned exported subset — exactly 7 fields:** `targetLang, outputFormat, promptEnvelope, theme,
cacheEnabled, saveHistory, provider`.

- **Excluded, and why:** `apiKey`, `openaiApiKey`, `anthropicApiKey` — S1, the literal "MINUS the
  API key" the envelope names (all three provider keys are secrets, not just Gemini's).
  `hasKey`/`configuredProviders` — **not** user preferences; both are derived booleans/arrays
  recomputed live from whichever key(s) actually exist on a given device
  (`configuredProvidersFor`, `domain/types.ts:101-109`; `hasKeyFor`, `:183-193`). Carrying them
  across devices would be actively misleading (e.g. `hasKey: true` imported onto a fresh install
  with no key yet configured) — they are always recomputed fresh by `ChromeStorageStore.get()`
  and never round-trip through a backup file.
- **Rejected alternative — export the full `PublicSettings` object:** would include the two
  derived fields above, reintroducing exactly the "lying state" problem the exclusion avoids, for
  zero benefit (nothing reads them from a backup; the live device always recomputes them anyway).
- **Rejected alternative — export nothing beyond `PublicSettings`'s literal fields (drop
  `cacheEnabled`/`saveHistory`/`provider`):** these are genuine user preferences that exist only
  on the full `Settings` shape; dropping them would silently reset a restored device's cache/
  history toggles and provider choice to their defaults, which is a worse "backup" than the E2
  envelope's own wording ("all settings") implies.

This 7-field shape is named `BackupSettings` in code (§4.3).

### 3.2 Merge semantics per keyspace (DISPATCH-NOTES' three explicit questions)

**Saved words — match by normalized headword; newer `savedAt` wins.** `normalizeWordKey`
(`saved-words-policy.ts:25-27`, trim+lowercase) is the existing case-insensitive key B1 already
uses for storage identity. On a merge-mode conflict (same normalized word both locally and in the
imported file), **the entry with the strictly-greater `savedAt` replaces the other; a tie (equal
`savedAt`) keeps the local entry unchanged.**

- **Why `savedAt`, given it means "time of first save," not "last edited":** it is the only
  timestamp `SavedWordEntry` carries (`domain/types.ts:246-251`) — adding a new
  last-modified field would be an _additive_ E1-lock change this card has no product reason to
  make, and CONTRACTS §1 only asks each card to pin from what already exists. Two devices that
  independently first-saved the same headword at different times most plausibly reflect a
  genuinely different (more complete, differently sourced) `senses[0]` context — `savedAt` is a
  reasonable, defensible ordering proxy for "which capture is more likely to be the one worth
  keeping," consistent with `savedWordUpsert`'s own existing last-write-wins policy for the senses
  field on every live re-save (`saved-words-policy.ts:38`, doc comment: "REPLACES its single
  `senses[0]`… last-write-wins").
- **Rejected — "always prefer local":** makes importing a backup from a device where a word was
  re-saved with better context a silent no-op; defeats the point of restoring.
- **Rejected — "always prefer imported":** an old, stale backup re-imported later would silently
  clobber fresher local edits (e.g. a status flip to `known` that happened after the backup was
  taken — though note status is preserved independently of this rule, see below).
- **Status is carried with whichever entry wins** — the import writes the _entire_ winning entry
  verbatim (word, status, savedAt, senses), never splices status from one side and senses from the
  other. A partial per-field merge was considered and rejected as needless complexity: E1's
  ratified shape has no natural sub-field merge semantics beyond "one whole entry replaces
  another," and every other write path in this codebase (`savedWordUpsert`, `savedWordSetStatus`)
  already treats the entry as one atomic unit.

**History — match by `id`; add-if-missing, never overwrite.** `HistoryEntry.id`
(`domain/types.ts:137`) is a `crypto.randomUUID()` stamped once at creation
(`app/router.ts:142`) — it names one immutable lookup event, not a mutable record. **On a merge
(or replace, see below), an imported entry whose `id` is not already present locally is appended;
an imported entry whose `id` already exists locally is left untouched (skipped, not
overwritten).** There is nothing to "merge" per id — a history entry is a frozen snapshot of one
past lookup; the two copies (if both present) are definitionally identical in content, since `id`
is the same UUID. Import processes entries **oldest-`createdAt`-first**, so that reusing the
existing `historyAppend` (which always prepends to the front of the newest-first index,
`history-policy.ts:24`) leaves the index in exactly the same order production traffic would have
produced. The existing cap-500 (`history-policy.ts:5`, `DEFAULT_CAP`) is enforced automatically
because import reuses `historyAppend` unmodified — an oversized backup file simply evicts its own
oldest entries first, exactly like normal usage.

- **Rejected — id-based "last write wins" like saved words:** history entries have no concept of
  being edited after creation (no `updatedAt`, no controller ever mutates a stored entry once
  written) — a "same id, different content" case can only mean data corruption, not a legitimate
  update; overwriting on match would be solving a problem that cannot occur in the intended flow
  and would mask real corruption instead of it simply becoming a no-op.

**Settings — always fully replace the 7-field `BackupSettings` subset, independent of the
merge/replace mode toggle.** DISPATCH-NOTES' own phrasing, "settings replace-except-key," is
adopted literally: unlike a list (savedWords/history), a settings object has no meaningful
partial-merge semantic — "merge my target language with my imported target language" is not a
sensible operation. **The merge/replace UI choice governs `savedWords`/`history` only.** Every
import, in either mode, overlays the backup's 7 `BackupSettings` fields onto the current full
`Settings` object, leaving `apiKey`/`openaiApiKey`/`anthropicApiKey`/`hasKey`/`configuredProviders`
untouched (§3.1 — these fields are never even present in `BackupSettings`, so there is nothing to
overlay; the spread order in §4.5's code makes this structurally impossible to get backwards, not
just a convention).

### 3.3 Mode UI: two explicit buttons, not a single button + dialog choice

**Pinned:** the settings form gets two buttons — **"Import (merge)"** and **"Import (replace)"**
— sharing one hidden `<input type="file">`. Clicking either stashes the requested mode, then opens
the browser's native file picker; the file's `change` event carries the mode forward.
"Import (replace)" is additionally gated behind a `window.confirm()` (the same
confirm-before-destructive-action pattern `restoreDefaultTemplate` already uses,
`settings-form.ts:524-537`) **before** the file picker even opens, since replace deletes local
data the file might not fully replicate.

- **Rejected — one "Import…" button + a follow-up modal choosing merge/replace:** this repo has no
  modal/dialog UI component (`bottom-sheet.ts` is card-specific, not a generic dialog); building
  one for a single binary choice is disproportionate. Two buttons reuse the exact existing
  button/event-relay pattern (`relay()`, `settings-form.ts:557-561`) with zero new component
  surface.
- **Rejected — abuse `window.confirm()` as the merge-vs-replace picker** (e.g. "OK = merge, Cancel
  = replace"): overloads a binary OK/Cancel dialog to also mean "which of two destructive/
  non-destructive operations," which is confusing and undiscoverable (nothing on the dialog says
  what Cancel does besides "not this"). Two explicitly labelled buttons are self-documenting.

### 3.4 Where format/version validation happens — pin the split between client-side and wire-side

**Pinned split:**

1. **The outer envelope** (`format`, `version`, and coarse presence/shape of `data.*`) is validated
   **client-side**, in a new pure function `parseBackupFile(text: string)` (§4.4) called from the
   options page immediately after the file is read (`File.prototype.text()` — a standard method on
   the browser's File API, no `FileReader` boilerplate needed). This catches "wrong file" / "future
   version" with a friendly, immediate message and **zero wire round-trip** for a bad file — the
   same reasoning C2 used for keeping busy/validation logic close to the DOM API that needs it
   (design spec `2026-07-16-c2-verified-activation-design.md` §2).
2. **The inner per-entry shape** (does each saved-word/history entry look like a real
   `SavedWordEntry`/`HistoryEntry`?) is validated **at the wire boundary**, by new,
   deliberately **non-strict** zod schemas on the `backup.import` message (§4.6) — reusing the
   existing `classifyInbound` gate (`app/inbound.ts:9-24`, S3/S8.5) that every other wire message
   already goes through. A malformed entry (or an entry belonging to a fundamentally different
   shape) causes the whole `backup.import` send to come back `{ ok: false, ... }` with the
   existing generic parse-error copy every other schema violation already produces
   (`inbound.ts:16-21`, `mapError({ kind: 'parse' })` — pre-existing behavior, not new to this
   card; the reply's `type` field being `'lookup'` regardless of the rejected message's real type
   is a pre-existing quirk of `classifyInbound`'s reject path, unrelated to B9).

- **Why not validate everything client-side with the strict wire schemas directly:** the strict
  `SavedWordEntrySchema`/`HistoryEntrySchema` already defined in `wire.ts:78-93`/`70-76` are
  `z.strictObject` — by design they reject _any_ extra key, which is exactly wrong for backup
  import (§3.5) and would also duplicate schema logic in two places (client + wire), risking drift.
  Keeping the outer envelope check (format/version) purely client-side and the inner shape check
  purely at the wire keeps each validation owned by exactly one place.

### 3.5 Why `backup.import`'s inner schemas are non-strict — a deliberate exception to the wire.ts convention

Every existing wire schema in `wire.ts` is `z.strictObject`/`z.object` nested in
`z.discriminatedUnion` (confirmed `REPO-FACTS.md` §4: "every schema is z.strictObject/z.object …
extra/missing fields fail closed"), and `SavedWordEntrySchema`/`HistoryEntrySchema` specifically
are `z.strictObject` (`wire.ts:88-93`, `:70-76`) — rejecting any unrecognised field is exactly
right for the extension's own internal wire traffic within one version.

**Backup import is different: it must satisfy "importers ignore unknown future fields"
(CONTRACTS §3/E2) — a file older code reads may carry fields a newer extension version added
later** (e.g. a hypothetical future B13 `related?: string[]` on `SavedWordSense`, or a B14
per-sense timestamp). If `backup.import`'s wire schema reused the strict
`SavedWordEntrySchema`/`HistoryEntrySchema` verbatim, an entry carrying one of those future fields
would fail zod's strict-object parse **entirely** (the whole array, not just the one extra field)
— which directly breaks the forward-compatibility promise the E2 lock exists to make.

**Pinned:** `backup.import`'s payload is validated by two new, deliberately **non-strict**
`z.object` schemas (`ImportSavedWordEntrySchema`, `ImportHistoryEntrySchema`, §4.6) that require
and type-check exactly the fields _this_ version of the code knows about, and silently drop any
extra keys instead of rejecting the message. This is the one wire message in the codebase that
intentionally diverges from the strict convention, and the reason is written inline in `wire.ts`
next to the schemas so a future reader does not "fix" it back to strict.

- **Rejected — keep them strict and bump `version` whenever a field is added:** the E2 lock
  already promises importers tolerate a _newer_ file on _older_ code without a hard failure
  (forward compatibility, not just same-version validation) — a strict schema cannot deliver that
  no matter how carefully `version` is bumped, since the schema itself would still reject the
  unrecognised field before `version` is even consulted downstream in this version's code.

### 3.6 `saved.list` — a new wire message, needed today (not deferred to B6)

Export needs every saved word; no wire path exists (`§2`). **Pinned:** add `saved.list` (no
payload) → `{ ok: true, type: 'saved-list', entries: SavedWordEntry[] }`, routed to the existing
`savedWordsList` domain function unchanged. Per the Decision Log's routine wire-evolution
reasoning (2026-07-10, A8/B2/B7 entries — "ordinary wire-protocol evolution … not an E1-style
escalation," reaffirmed at CONTRACTS §3 "wire evolution precedent"), this is not an escalation:
it's read-only, contains no new persisted shape, and B6 (Words page) will consume the exact same
message later rather than inventing a second one — this card ships it first because it needs it
first.

### 3.7 UI placement + copy

**Pinned:** a new, fourth Privacy-adjacent section, **"Backup & restore,"** placed directly after
the existing "Privacy & data" section (`settings-form.ts:202-212`) and before the sticky save bar
(`:213`) — a sibling section, not folded into "Privacy & data," because CONTRACTS §4 explicitly
requires B9's export UI and B8's (future) Anki export UI to stay separate surfaces from each other
and, by the same logic, separate from the already-crowded Privacy & data block (cache/history
toggles + history export). Copy:

- Section header: **"Backup & restore"**
- Help paragraph: _"Save your saved words, history, and settings as one file — everything except
  your API key. Import merges with what's already on this device, or replaces it entirely."_
- Buttons: **"Export backup"** (link-styled, matching `#export`'s existing `class="link"`
  treatment) · **"Import (merge)"** · **"Import (replace)"** (both regular bordered buttons, like
  `#clear-cache`/`#clear-history`).
- Confirm dialog text (replace only): _"Replace ALL saved words and history with this backup
  file? Anything not in the file will be deleted. This cannot be undone."_

## 4. The change

### 4.1 `packages/app/src/domain/saved-words-policy.ts` — new `savedWordImport`

Add one export, alongside the existing CRUD primitives (after `savedWordSetStatus`,
`saved-words-policy.ts:98`):

```ts
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
```

No change to any existing exported function in this file.

### 4.2 `packages/app/src/domain/history-policy.ts` — new `historyImportEntry`

Add one export, after `historyDelete` (`history-policy.ts:83`):

```ts
/**
 * B9: import one backup history entry — add it only if its id isn't already present locally
 * (§3.2: history entries are immutable per-lookup snapshots; there is nothing to "merge" per id,
 * only add-if-missing). Reuses historyAppend unmodified so the existing cap (DEFAULT_CAP) and
 * newest-first index invariant both keep working exactly as they do for live traffic. Returns
 * whether the entry was newly added (false = skipped, id already present).
 */
export async function historyImportEntry(deps: HistoryDeps, entry: HistoryEntry): Promise<boolean> {
  const existing = await historyGet(deps, entry.id);
  if (existing) return false;
  await historyAppend(deps, entry);
  return true;
}
```

No change to any existing exported function in this file.

### 4.3 New `packages/app/src/domain/backup-policy.ts` — `importBackup` (the merge/replace orchestrator)

```ts
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
 * `mode: 'replace'` clears both keyspaces first (see §3.2) — after that, the per-entry logic
 * below is IDENTICAL for merge and replace, since every local entry has already been cleared out
 * of replace's way. Settings are never touched here (§3.2: settings import is a client-side,
 * always-replace overlay in the composition root — see the design spec §3.2/§4.5).
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
    // §3.2: no local entry, or the imported entry's savedAt is strictly newer → it wins.
    // A tie keeps the local entry. In replace mode `existing` is always null (cleared above),
    // so every imported entry is written.
    if (!existing || entry.savedAt > existing.savedAt) {
      await savedWordImport(deps, entry);
      savedWordsImported++;
    }
  }

  // §3.2: oldest-createdAt-first so historyAppend's newest-first prepend ends up matching the
  // entries' real chronological order once every one has been processed.
  const sorted = [...history].sort((a, b) => a.createdAt - b.createdAt);
  let historyImported = 0;
  for (const entry of sorted) {
    if (await historyImportEntry(deps, entry)) historyImported++;
  }

  return { savedWordsImported, historyImported };
}
```

### 4.4 New `packages/app/src/app/backup.ts` — file-shape build/parse (pure; mirrors `history-export.ts`'s pattern)

```ts
import type { SavedWordEntry, HistoryEntry } from '../domain/types';

export const BACKUP_FORMAT = 'ai-dict-backup';
export const BACKUP_VERSION = 1;

/**
 * B9: the non-secret settings fields worth carrying to another device (design spec §3.1).
 * Deliberately excludes apiKey/openaiApiKey/anthropicApiKey (S1) and the derived hasKey/
 * configuredProviders (recomputed live from whatever key exists on the destination device —
 * never carried across; see the design spec for why importing them would be actively misleading).
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
 * (history-export.ts:6-8) — so a stray secret riding along on any input object can never survive
 * into the exported file (S1 defense-in-depth on top of BackupSettings' own type shape, which
 * already has no room for one).
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
  // Fixed filename (mirrors buildHistoryExport's fixed 'ai-dict-history.json' — history-export.ts:29)
  // rather than a date-stamped one: simpler, consistent with the one export mechanism that already
  // exists, and avoids a Date-dependent filename inside an otherwise pure/DI-clean function.
  return { filename: 'ai-dict-backup.json', json: JSON.stringify(envelope, null, 2) };
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
 * §3.5) — this function only rules out "not a JSON file," "not one of ours," and "from a future
 * version this build cannot read."
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
    settings: (data['settings'] as Partial<BackupSettings> | undefined) ?? {},
  };
}
```

### 4.5 Composition roots — `packages/extension-chrome/src/options.ts` and `packages/extension-safari/src/options.ts`

Both gain, inside `wireSettings`/the top-level listener block (mirroring where `export-history` is
already wired — Chrome `options.ts:158-176`, Safari `options.ts:94-112`):

- A `backup-export` listener: `Promise.all([send({type:'saved.list'}), send({type:'history.list'}),
load()])`, then `buildBackupExport(savedEntries, historyEntries, settings, () => Date.now())`,
  then the existing local `download()` helper, then a status line
  `Exported {N} saved words and {M} history entries`. **Unlike "Export history," this always
  downloads** (even when both lists are empty) rather than special-casing "nothing to export" —
  a settings-only backup (e.g. taken deliberately before wiping local storage) is still a
  meaningful file; skipping the download would silently discard the one thing that IS present.
- A `backup-import` listener: reads `file.text()`, calls `parseBackupFile`, on failure sets the
  returned `error` as the status; on success sends `{ type: 'backup.import', mode, savedWords,
history }`, and on a successful reply, overlays the returned `settings` patch onto the current
  full `Settings` (§3.2 — unconditional, key fields never touched because `BackupSettings` never
  carries them) and re-mounts the settings screen via the existing `mountSettings(s, status)` path
  (the same remount pattern onboarding's completion already uses) so a changed theme/provider/
  target-language shows immediately.

Chrome's full `mountOnboarding`-adjacent code (illustrative, exact code lives in the plan):

```ts
form.addEventListener('backup-export', () => {
  void Promise.all([send({ type: 'saved.list' }), send({ type: 'history.list' }), load()]).then(
    ([savedReply, historyReply, settings]) => {
      if (!savedReply.ok || savedReply.type !== 'saved-list') {
        form.setStatus(savedReply.ok ? 'Unexpected reply' : savedReply.error.message, 'error');
        return;
      }
      if (!historyReply.ok || historyReply.type !== 'history') {
        form.setStatus(historyReply.ok ? 'Unexpected reply' : historyReply.error.message, 'error');
        return;
      }
      const { filename, json } = buildBackupExport(
        savedReply.entries,
        historyReply.entries,
        settings,
        () => Date.now(),
      );
      download(filename, json);
      form.setStatus(
        `Exported ${savedReply.entries.length} saved words and ${historyReply.entries.length} history entries`,
      );
    },
    () => form.setStatus('Could not export backup', 'error'),
  );
});

form.addEventListener('backup-import', (e) => {
  const { mode, file } = (e as CustomEvent<BackupImportRequest>).detail;
  void file
    .text()
    .then((text) => {
      const parsed = parseBackupFile(text);
      if (!parsed.ok) {
        form.setStatus(parsed.error, 'error');
        return;
      }
      form.setStatus('Importing…');
      void send({
        type: 'backup.import',
        mode,
        savedWords: parsed.savedWords as SavedWordEntry[],
        history: parsed.history as HistoryEntry[],
      }).then(
        (r) => {
          if (!r.ok || r.type !== 'backup-imported') {
            form.setStatus(r.ok ? 'Unexpected reply' : r.error.message, 'error');
            return;
          }
          const s = parsed.settings;
          void load()
            .then((cur) =>
              chrome.storage.local.set({
                settings: {
                  ...cur,
                  ...(s.targetLang !== undefined ? { targetLang: s.targetLang } : {}),
                  ...(s.outputFormat !== undefined ? { outputFormat: s.outputFormat } : {}),
                  ...(s.promptEnvelope !== undefined ? { promptEnvelope: s.promptEnvelope } : {}),
                  ...(s.theme !== undefined ? { theme: s.theme } : {}),
                  ...(s.cacheEnabled !== undefined ? { cacheEnabled: s.cacheEnabled } : {}),
                  ...(s.saveHistory !== undefined ? { saveHistory: s.saveHistory } : {}),
                  ...(s.provider !== undefined ? { provider: s.provider } : {}),
                },
              }),
            )
            .then(load)
            .then((fresh) =>
              mountSettings(
                fresh,
                `Imported ${r.savedWordsImported} saved words and ${r.historyImported} history entries`,
              ),
            );
        },
        () => form.setStatus('Could not import backup', 'error'),
      );
    })
    .catch(() => form.setStatus('Could not read the selected file', 'error'));
});
```

Safari's mirror is byte-identical except `chrome.*` → `browser.*` and no `mountSettings` remount
step is needed there (Safari's options.ts never introduced a two-screen onboarding/settings split
— confirmed by reading `packages/extension-safari/src/options.ts` in full: it is a single always-
settings screen); its version instead re-hydrates the existing form in place via
`(form as unknown as { value: Settings }).value = fresh;` after the settings write.

### 4.6 `packages/app/src/wire.ts` — new schemas (ONE task, per CONTRACTS §2)

Two new arms on `WireMessageSchema` (after the existing `saved.setStatus` arm,
`wire.ts:123-127`):

```ts
// B9: list every saved word — backup export's only way to read the full `saved:*` keyspace
// (also the future B6 Words-page's list source; shipped here first because B9 needs it first —
// design spec §3.6, ordinary wire evolution, not an E1/E2-style escalation).
z.object({ type: z.literal('saved.list') }),
// B9: import a backup file's saved words + history into the local keyspaces. Settings import
// happens entirely client-side in the options page (design spec §3.2/§4.5) — never touches the
// wire — so this message never carries a settings payload, and (S1) never a key.
z.object({
  type: z.literal('backup.import'),
  mode: z.enum(['merge', 'replace']),
  savedWords: z.array(ImportSavedWordEntrySchema),
  history: z.array(ImportHistoryEntrySchema),
}),
```

New, deliberately **non-strict** schemas backing the array fields above (defined near the
existing strict `SavedWordEntrySchema`/`HistoryEntrySchema`, `wire.ts:70-93`, with an inline
comment explaining the divergence per design spec §3.5):

```ts
// B9: non-strict on purpose (NOT z.strictObject, unlike every other wire schema in this file) —
// CONTRACTS §3/E2 promises "importers ignore unknown future fields." A backup file written by a
// future extension version may carry additive fields this version's code has never heard of; a
// strict schema would reject the ENTIRE entry (and thus the whole array) instead of simply not
// preserving the field it doesn't recognise. See the design spec §3.5 for the full rationale —
// do not "fix" this back to strict.
const ImportSavedWordSenseSchema = z.object({
  definition: z.string(),
  translation: z.string(),
  sentence: z.string(),
  url: z.string(),
  title: z.string(),
});
const ImportSavedWordEntrySchema = z.object({
  word: z.string(),
  status: z.enum(['learning', 'known']),
  savedAt: z.number(),
  senses: z.array(ImportSavedWordSenseSchema),
});
const ImportHistoryEntrySchema = z.object({
  id: z.string(),
  word: z.string(),
  context: z.string(),
  result: z.object({
    markdown: z.string(),
    word: z.string(),
    target: z.string(),
    model: z.string().min(1),
    fromCache: z.boolean(),
    fetchedAt: z.number(),
  }),
  createdAt: z.number(),
});
```

`MessageTypeEnum` (`wire.ts:143-158`) gains `'saved.list'` and `'backup.import'` (needed by the
generic `{ ok: false, type: MessageTypeEnum, ... }` reply arm, `wire.ts:183-188`).

`WireReplySchema` (`wire.ts:160-189`) gains two new success variants:

```ts
z.object({
  ok: z.literal(true),
  type: z.literal('saved-list'),
  entries: z.array(SavedWordEntrySchema),
}),
z.object({
  ok: z.literal(true),
  type: z.literal('backup-imported'),
  savedWordsImported: z.number(),
  historyImported: z.number(),
}),
```

The compile-time `AssertEqual` drift guard (`wire.ts:202-209`) gains two more checks (the new
Import\* schemas structurally infer the same TypeScript shape as `SavedWordEntry`/`HistoryEntry`
even though they're non-strict — strictness affects only runtime parsing, never `z.infer`'s
produced type):

```ts
AssertEqual<z.infer<typeof ImportSavedWordEntrySchema>, SavedWordEntry>,
AssertEqual<z.infer<typeof ImportHistoryEntrySchema>, HistoryEntry>,
```

### 4.7 `packages/app/src/app/router.ts` — two new cases (same task as 4.6, per CONTRACTS §2)

```ts
case 'saved.list': {
  const entries = await savedWordsList({ storage: deps.kv });
  return { ok: true, type: 'saved-list', entries };
}
case 'backup.import': {
  const result = await deps.queue.run(() =>
    importBackup({ storage: deps.kv }, msg.savedWords, msg.history, msg.mode),
  );
  return {
    ok: true,
    type: 'backup-imported',
    savedWordsImported: result.savedWordsImported,
    historyImported: result.historyImported,
  };
}
```

Both added to the exhaustive `switch (msg.type)` (`router.ts:213-287`, no `default` — TypeScript's
exhaustiveness check is what keeps this compiling only once every arm has a case, per the B5/B3
plan-authoring rule in `docs/ROADMAP.md` §8 Decision Log, 2026-07-16). `importBackup` is imported
from the new `domain/backup-policy.ts` (§4.3); `savedWordsList` is already imported
(`router.ts:13`, used nowhere yet — this is its first caller). The whole `importBackup` call is
wrapped in `deps.queue.run(...)` (the existing `WriteQueue`, `router.ts:29-39`) so a backup import
can never interleave its writes with a concurrent `saved.save`/`saved.setStatus`/lookup-history-
write — identical reasoning to every other KV-mutating handler in this file.

### 4.8 `packages/app/src/index.ts` — barrel additions

```ts
export * from './domain/backup-policy';
export * from './app/backup';
```

(Everything else already flows through existing `export *` lines — `saved-words-policy`,
`history-policy`, and `router` are already re-exported in full, so `savedWordImport`,
`historyImportEntry`, and the router's use of `importBackup` need no additional barrel entries
beyond the two lines above.)

### 4.9 `packages/app/src/ui/settings-form.ts` — new section + events

New exported interface, alongside `SettingsFormValue` (`settings-form.ts:29-45`):

```ts
export interface BackupImportRequest {
  mode: 'merge' | 'replace';
  file: File;
}
```

New markup section (inserted between the existing "Privacy & data" `</section>`,
`settings-form.ts:212`, and the `.savebar` div, `:213`):

```html
<section class="sec" aria-labelledby="sec-backup">
  <h2 class="sec-h" id="sec-backup">Backup &amp; restore</h2>
  <p id="backup-help">
    Save your saved words, history, and settings as one file — everything except your API key.
    Import merges with what's already on this device, or replaces it entirely.
  </p>
  <div class="inline-actions">
    <button type="button" id="backup-export" class="link">Export backup</button>
    <button type="button" id="backup-import-merge">Import (merge)</button>
    <button type="button" id="backup-import-replace">Import (replace)</button>
  </div>
  <input type="file" id="backup-file" accept="application/json" hidden />
</section>
```

New CSS rule (mirrors `#tpl-help`/`#envelope-help`'s existing pattern, inserted next to them):
`#backup-help{margin:0 0 10px;font-size:var(--adp-text-xs);color:var(--ad-ink-faint)}`.

New private field: `private _backupImportMode: 'merge' | 'replace' | null = null;`.

New wiring in `connectedCallback` (right after the existing `this.relay('#export',
'export-history');`, `settings-form.ts:312`):

```ts
this.relay('#backup-export', 'backup-export');
this.q<HTMLButtonElement>('#backup-import-merge').addEventListener('click', () =>
  this.startBackupImport('merge'),
);
this.q<HTMLButtonElement>('#backup-import-replace').addEventListener('click', () =>
  this.startBackupImport('replace'),
);
this.q<HTMLInputElement>('#backup-file').addEventListener('change', () => {
  const input = this.q<HTMLInputElement>('#backup-file');
  const file = input.files?.[0];
  input.value = ''; // reset so re-selecting the same file still fires 'change' next time
  const mode = this._backupImportMode;
  this._backupImportMode = null;
  if (!file || !mode) return;
  this.dispatchEvent(
    new CustomEvent<BackupImportRequest>('backup-import', {
      detail: { mode, file },
      bubbles: true,
      composed: true,
    }),
  );
});
```

New private method (placed near `restoreDefaultTemplate`, `settings-form.ts:517-537`, the existing
confirm-before-destructive precedent):

```ts
/**
 * B9: "Import (replace)" is destructive (wipes existing saved words + history before writing
 * the file's contents) — gate it behind a confirm(), mirroring restoreDefaultTemplate's existing
 * confirm-before-destructive-action pattern. "Import (merge)" needs no confirm — it only adds/
 * updates, never deletes.
 */
private startBackupImport(mode: 'merge' | 'replace'): void {
  if (mode === 'replace') {
    const ok = window.confirm(
      'Replace ALL saved words and history with this backup file? Anything not in the file ' +
        'will be deleted. This cannot be undone.',
    );
    if (!ok) return;
  }
  this._backupImportMode = mode;
  this.q<HTMLInputElement>('#backup-file').click();
}
```

## 5. Scope fence held (restated from the card, with how the design honors each line)

- **"Export MUST NOT contain the API key (S1)."** `BackupSettings` (§4.3) structurally has no
  `apiKey`/`openaiApiKey`/`anthropicApiKey` field — there is nothing to accidentally spread,
  because `buildBackupExport` reconstructs every field explicitly (§4.4) exactly like
  `buildHistoryExport` already does. Tested directly (§6.1 — a stray key-shaped field on the input
  object must not survive into the JSON, mirroring `history-export.test.ts:39-48`'s existing
  assertion).
- **"Export everything; import offers merge or replace (user picks)."** §4.1-4.7 cover
  savedWords+history+settings on export; the two-button UI (§3.3) is the user's explicit pick for
  savedWords/history (settings always fully apply, §3.2).
- **"The backup file envelope + version field … lock it before shipping" (E2).** §1 quotes the
  ratified shape verbatim; §4.4's `BackupEnvelope`/`buildBackupExport` produce exactly that JSON,
  field-for-field.
- **Depends on B1 — shipped**, `saved-words-policy.ts` unchanged except one additive function
  (§4.1), never touching the ratified `SavedWordEntry`/`SavedWordSense` shapes themselves.

## 6. No change to X (files an implementer would reflexively touch)

- **`packages/app/src/domain/types.ts`** — no change. E1's `SavedWordEntry`/`SavedWordSense`/
  `SavedWordStatus` and `HistoryEntry` are read, never restructured; `BackupSettings`/
  `BackupEnvelope` are new types living in `app/backup.ts` (§4.4), not additions to `types.ts`.
- **`packages/app/src/domain/error-mapper.ts`** — no change. Every error surfaced by this card
  reuses either the existing generic wire-schema-rejection copy (`inbound.ts`, §3.4) or a new,
  purely client-side string returned by `parseBackupFile` (§4.4) — no new `LookupErrorCode`.
- **`packages/app/src/domain/cache-policy.ts`** — no change. Backup/restore never touches the
  cache keyspace; a restored device's cache simply starts cold, which is correct (cached answers
  are a local performance optimization, not user data worth backing up).
- **`packages/app/src/ui/lookup-card.ts` / `bottom-sheet.ts` / `side-panel-view.ts`** — no change.
  This card is a Settings-only surface; it has no on-page or side-panel touchpoint.
- **`packages/extension-chrome/src/adapters/chrome-kv-store.ts` /
  `chrome-storage-store.ts`** — no change. Both adapters are already generic enough (a flat KV
  pass-through, and a `Settings`-shaped read/write) to serve this card without modification; all
  new logic lives in the domain/app layers plus the composition roots' event wiring.
- **`packages/extension-chrome/src/manifest.json`** — no change. No new permission: `<input
type="file">` + `File.prototype.text()` are ordinary DOM APIs already available on an
  extension's own options page under the existing manifest.

## 7. Testing strategy

### 7.1 Unit — new/updated files

- **`packages/app/test/saved-words-policy.test.ts`** (existing file, add cases): `savedWordImport`
  writes an entry verbatim (arbitrary `status`/`savedAt`, not `now()`-derived), adds the key to
  `saved:index` exactly once even if called twice for the same word (idempotent index), and
  coexists with entries written by `savedWordUpsert`.
- **`packages/app/test/history-policy.test.ts`** (existing file, add cases): `historyImportEntry`
  returns `true` and appends when the id is new; returns `false` and leaves storage unchanged when
  the id already exists; respects the existing cap when the id is new and the index is already at
  cap (delegates entirely to `historyAppend`, so this is a thin pass-through assertion).
- **`packages/app/test/backup-policy.test.ts`** (new): `importBackup` in `merge` mode — a newer-
  `savedAt` imported entry replaces the local one; an older-or-equal one is skipped; a
  never-seen-locally word is always added; history entries with new ids are added, existing ids
  are skipped, oldest-first processing produces a correctly newest-first final index (assert via
  `historyList`). `importBackup` in `replace` mode — pre-existing local saved words/history not
  present in the import are gone afterward; the returned counts (`savedWordsImported`,
  `historyImported`) match exactly what was written in each mode.
- **`packages/app/test/app/backup.test.ts`** (new, mirrors `history-export.test.ts`'s structure):
  `buildBackupExport` — fixed filename `'ai-dict-backup.json'`; the JSON parses to
  `{format:'ai-dict-backup', version:1, exportedAt, data:{savedWords, history, settings}}`
  matching the E2 shape exactly; a stray `apiKey`-shaped field tacked onto the input `settings`
  object must not survive into the output JSON (mirrors
  `history-export.test.ts:39-48`'s exact assertion style). `parseBackupFile` — valid envelope
  round-trips into `{ok:true, savedWords, history, settings}`; non-JSON text →
  `{ok:false, error:'This file is not valid JSON.'}`; wrong `format` → the generic "not a valid …
  backup" error; `version` greater than `BACKUP_VERSION` → the "newer version" error; a `data`
  object missing `savedWords`/`history` arrays defaults them to `[]` rather than throwing.
- **`packages/app/test/wire-schema.test.ts`** (existing file, add cases): `saved.list` parses
  with no payload; `backup.import` parses with valid `mode`/`savedWords`/`history`; an entry
  carrying one extra, unrecognised field on `senses[0]` (simulating a hypothetical future
  additive field) still parses successfully and the extra field is absent from the parsed
  result (proves the non-strict/"ignore unknown future fields" behavior, §3.5); an entry missing
  a required field (e.g. no `word`) fails to parse.
- **`packages/app/test/app/router.test.ts`** (existing file, add cases): `saved.list` returns every
  entry written via `savedWordUpsert` beforehand; `backup.import` with `mode:'merge'` delegates to
  `importBackup` and replies `{ok:true, type:'backup-imported', savedWordsImported, historyImported}`
  with the correct counts; `mode:'replace'` clears pre-existing entries not present in the import.
- **`packages/app/test/ui/settings-form.test.ts`** (existing file):
  - **Update** `groups controls into Connection, Translation, Appearance, and Privacy & data
sections` (`settings-form.test.ts:554-565`) to append `'Backup & restore'` to the expected
    `heads` array.
  - **Update** `keeps every required control (incl. #status) inside the redesigned markup`
    (`:567-589`) to add `'#backup-export'`, `'#backup-import-merge'`, `'#backup-import-replace'`,
    `'#backup-file'` to the selector list.
  - **New tests:** clicking `#backup-export` dispatches a composed `backup-export` event with no
    detail; clicking `#backup-import-merge` opens the (mocked) file picker without a confirm
    prompt, and choosing a file dispatches a composed `backup-import` event with
    `{mode:'merge', file}`; clicking `#backup-import-replace` calls `window.confirm` first — a
    mocked `false` return aborts before the file input is touched (assert via a spy on
    `HTMLInputElement.prototype.click` or by asserting no `backup-import` event fires), a mocked
    `true` return proceeds identically to merge but with `mode:'replace'`; selecting the same file
    twice in a row still fires `backup-import` both times (the input's `value` reset, matching
    the reset already exercised implicitly by every native file-input consumer).

### 7.2 e2e — new `packages/extension-chrome/e2e/b9-backup-restore.spec.ts`

Following the established `mockGemini`/`seedSettings`/`storageDump` helpers
(`e2e/helpers.ts`) and the exact download-testing pattern already proven in
`options-actions.spec.ts:74-97` (`page.waitForEvent('download')` + `download.path()` +
`readFileSync`):

1. **Export downloads a JSON file matching the E2 envelope.** Seed one saved word (write directly
   to `chrome.storage.local` as `saved:<word>` + `saved:index`, mirroring the existing history-seed
   pattern at `options-actions.spec.ts:84-97`) and one history entry; click `#backup-export`;
   assert `download.suggestedFilename() === 'ai-dict-backup.json'`; parse the downloaded file and
   assert `format === 'ai-dict-backup'`, `version === 1`, `data.savedWords.length === 1`,
   `data.history.length === 1`, and the file's raw text does **not** contain `'apiKey'` (S1,
   mirrors `history-export.test.ts:39-48`'s equivalent).
2. **Import (merge) adds new entries without deleting existing ones.** Seed one local saved word
   ("existing"); build a backup-shaped JSON with a _different_ word ("imported") plus one history
   entry; set the hidden `#backup-file` input's files via Playwright's
   `locator('settings-form').locator('#backup-file').setInputFiles({name, mimeType, buffer})`
   after clicking `#backup-import-merge`; assert the status line reports the import counts; assert
   via `storageDump` that BOTH "existing" and "imported" saved-word keys are now present.
3. **Import (replace) wipes local data first.** Seed one local saved word ("stale") not present in
   the import file; click `#backup-import-replace`; handle the native confirm dialog via
   `page.once('dialog', (d) => d.accept())` (mirrors `options-actions.spec.ts:144-146`'s existing
   pattern); set the file; assert `storageDump` no longer contains `"stale"`'s key but does contain
   the imported word's key.
4. **A newer-version backup file is rejected with the friendly copy, no wire call made.** Build a
   JSON with `version: 2`; select it via the merge button; assert the status line shows "This
   backup was made with a newer version…" and that `storageDump` is unchanged from before the
   attempt (proves the client-side gate stopped it before any `backup.import` message was sent).
5. **The existing stored key survives an import.** Seed settings with `apiKey: 'AIza-existing'`;
   import a backup file whose `data.settings` carries no key field (as real exports never do);
   assert (via `storageDump`) `settings.apiKey` is still `'AIza-existing'` afterward.

## 8. Testing performed (PR evidence — no media, per this worktree's `CLAUDE.md`)

Per the owner ruling (2026-07-16) already governing this worktree, **no screenshots or video for
this PR.** The PR body's "Testing performed" section lists: unit suite pass counts (including the
new `backup-policy.test.ts`, `app/backup.test.ts`, and the additions to `saved-words-policy.test.ts`
/`history-policy.test.ts`/`wire-schema.test.ts`/`router.test.ts`/`ui/settings-form.test.ts`), the
5 new e2e scenarios in `b9-backup-restore.spec.ts`, and the full gate (`lint`, `format:check`,
`typecheck` both packages, `build:chrome:e2e`). No `pr-assets/*` branch.

## 9. Risk / rollback

- **Risk: low-moderate.** The riskiest new logic is `importBackup`'s per-entry merge decision
  (§4.3) — a bug here could silently drop a word that should have been kept, or overwrite one that
  shouldn't have been. This is directly covered by `backup-policy.test.ts`'s explicit
  newer/older/equal-`savedAt` cases (§7.1) and the e2e merge/replace scenarios (§7.2.2/7.2.3),
  which assert exact storage contents, not just UI text.
- **The non-strict `Import*` wire schemas (§3.5/4.6) are a deliberate, permanent divergence** from
  this file's own strict-schema convention — flagged inline in `wire.ts` so a future contributor
  does not "fix" it back to strict and silently reintroduce the forward-compatibility break this
  design exists to avoid.
- **No data migration.** This card writes no new field onto `SavedWordEntry`/`HistoryEntry`/
  `Settings` — every write path (`savedWordImport`, `historyImportEntry`, the settings overlay)
  produces exactly the same shapes those keyspaces already hold today.
- **Rollback:** revert the single PR. `saved.list`/`backup.import` simply cease to exist again
  (no persisted data depends on them existing); the "Backup & restore" section disappears from
  settings; no stored data becomes invalid, since nothing about the existing `saved:*`/`history:*`
  /`settings` shapes changed.

## 10. Files touched (summary)

| File                                                      | Change                                                                                                                                                       |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/app/src/domain/saved-words-policy.ts`           | + `savedWordImport`                                                                                                                                          |
| `packages/app/src/domain/history-policy.ts`               | + `historyImportEntry`                                                                                                                                       |
| `packages/app/src/domain/backup-policy.ts`                | **new** — `importBackup` + types                                                                                                                             |
| `packages/app/src/app/backup.ts`                          | **new** — `buildBackupExport`, `parseBackupFile`, `BACKUP_FORMAT`/`BACKUP_VERSION`, `BackupSettings`/`BackupEnvelope`/`ParsedBackupFile` types               |
| `packages/app/src/wire.ts`                                | + `saved.list`/`backup.import` arms, non-strict `Import*` schemas, 2 new `WireReplySchema` variants, `MessageTypeEnum` additions, 2 new `AssertEqual` checks |
| `packages/app/src/app/router.ts`                          | + `saved.list`/`backup.import` cases                                                                                                                         |
| `packages/app/src/index.ts`                               | + 2 barrel lines (`domain/backup-policy`, `app/backup`)                                                                                                      |
| `packages/app/src/ui/settings-form.ts`                    | + "Backup & restore" section, `BackupImportRequest` type, `_backupImportMode` field, `startBackupImport`, event wiring                                       |
| `packages/extension-chrome/src/options.ts`                | + `backup-export`/`backup-import` listeners                                                                                                                  |
| `packages/extension-safari/src/options.ts`                | + `backup-export`/`backup-import` listeners (mirrored)                                                                                                       |
| `packages/app/test/saved-words-policy.test.ts`            | + `savedWordImport` cases                                                                                                                                    |
| `packages/app/test/history-policy.test.ts`                | + `historyImportEntry` cases                                                                                                                                 |
| `packages/app/test/backup-policy.test.ts`                 | **new**                                                                                                                                                      |
| `packages/app/test/app/backup.test.ts`                    | **new**                                                                                                                                                      |
| `packages/app/test/wire-schema.test.ts`                   | + new-schema cases                                                                                                                                           |
| `packages/app/test/app/router.test.ts`                    | + new-case tests                                                                                                                                             |
| `packages/app/test/ui/settings-form.test.ts`              | update 2 existing tests + new backup-UI tests                                                                                                                |
| `packages/extension-chrome/e2e/b9-backup-restore.spec.ts` | **new** — 5 scenarios                                                                                                                                        |

No change to `packages/app/src/domain/types.ts`, `error-mapper.ts`, `cache-policy.ts`, any UI file
under `ui/lookup-card.ts`/`bottom-sheet.ts`/`side-panel-view.ts`, either Chrome adapter file, or
any manifest.

## 11. Concurrency

Per CONTRACTS §5, files this card modifies that other unshipped cards in this batch also modify —
the orchestrator should serialize around these:

- **`packages/app/src/ui/settings-form.ts`** — CONTRACTS §5's hot-file list names A5, A9, A13, B6,
  C9 for this file; **B9 itself also modifies it** (a gap in that list worth flagging to the
  orchestrator explicitly, since B9 is not named there). Any of A5/A9/A13/B6/C9 landing
  concurrently with B9 will conflict on this file's markup/CSS/event-wiring.
- **`packages/app/src/wire.ts` / `packages/app/src/app/router.ts`** — CONTRACTS §5: "wire+router
  (any card adding messages)." In this batch, A3 (optional `refine` field), B6 (a likely new
  `saved.delete`-adjacent or list-with-pagination message per its own DISPATCH-NOTES), and B12
  (a new LLM-grouping message) all touch these same two files — B9's `saved.list`/`backup.import`
  arms must land as one atomic pair (CONTRACTS §2's "wire arm + router case = one task" rule) to
  avoid the exhaustive-switch compiling in a broken intermediate state if interleaved with another
  card's own new arm.
- **`packages/app/src/index.ts`** (the barrel) — every card that adds a new top-level module
  touches this file; low collision risk (append-only lines) but still worth sequencing to avoid a
  merge conflict on the same append point.
- **`packages/app/src/domain/saved-words-policy.ts` / `history-policy.ts`** — not flagged as hot
  in CONTRACTS §5, but B6 (Words page) and B14 (sense-aware dedup) both read/extend these same
  modules; low risk since B9's additions are new, isolated exports, not edits to existing
  functions, but the orchestrator should still avoid landing B9 and B14 in the same window without
  a rebase check.
