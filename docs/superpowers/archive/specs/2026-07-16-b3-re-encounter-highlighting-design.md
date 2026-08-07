# B3 — Re-encounter highlighting (design)

Roadmap card: `docs/ROADMAP.md` §4 B3 (Impact 5 · Effort M · Score 2.5). Depends on: B1 (shipped,
PR #99), B5 (status lifecycle — shipped immediately before this card). Feeds: B4 (hover-recall,
next card) which will reuse this card's highlight targets.

Authored by the Shaman (campaign protocol 2026-07-16: the Shaman answers How; the Warchief
executes).

## 1. Problem

Saved words are write-only today: `savedWordsList`
(`packages/app/src/domain/saved-words-policy.ts:88-96`) can enumerate every saved entry with its
`status` (`'learning' | 'known'`, B5), but nothing ever reads it on a real page. When a saved word
reappears in tomorrow's article, nothing happens — the single most valuable learning moment passes
unmarked.

**Goal (ratified per-card goal, tree v2):** learning-status words get a subtle underline on real
pages via exact word-boundary + naive plural/-ed/-ing matching ONLY; known-status words are never
highlighted; added page-load cost ≤ 50 ms on a 100KB-text e2e fixture (lazy scan); a settings
off-switch works. Beyond-naive matching (lemmatizer/fuzzy) is **E5 — owner escalation, out of
scope**.

## 2. Design decisions (all made; executor does not re-open)

### D1 — CSS Custom Highlight API, zero DOM mutation

Highlights are painted with `CSS.highlights.set('ad-saved-word', new Highlight(...ranges))` +
`::highlight(ad-saved-word)` styling. Rationale: no host-page DOM mutation (a `<mark>`-wrapping
approach mutates live pages and can break React/Vue reconciliation), no layout impact (satisfies
the perf fence structurally), trivially removable (`CSS.highlights.delete`). Guard: if
`CSS.highlights` is undefined (old browser), the whole feature is a silent no-op.

### D2 — Matching is a pure domain policy

`packages/app/src/domain/highlight-policy.ts` (new, dependency-free — rule-domain-purity):

```ts
/** B3: naive inflection variants — exact word + plural/-ed/-ing ONLY (roadmap scope fence;
 * anything smarter is escalation E5). All lowercase. */
export function naiveVariants(word: string): string[];
// 'bank'  -> ['bank','banks','bankes','banked','banking']  (es-variant harmless, documented)
// 'smile' -> ['smile','smiles','smilees','smileed','smiled','smiling'] (e-drop for -ing, +d)

/** Build a lookup of every variant of every learning word -> the canonical saved headword. */
export function buildHighlightMatcher(words: string[]): Map<string, string>;

/** Scan one text-node string; return [start,end) spans whose word-boundary token is in the
 * matcher. Tokenization: /[A-Za-z][A-Za-z'-]*/g, compared lowercase. Pure. */
export function findWordMatches(
  text: string,
  matcher: Map<string, string>,
): Array<{ start: number; end: number; headword: string }>;
```

### D3 — Content scripts never read storage (S1): a new wire message

`saved.learningWords` → reply `{ ok: true, type: 'savedWords', words: string[] }` where `words` =
`savedWordsList(...)` filtered to `status === 'learning'`, headwords only. Minimal payload by
design: B4 (hover-recall) will fetch the full entry on demand later; B3 sends only what painting
needs. Additive wire change, same mechanics as B5's `saved.setStatus` (schema arm +
`MessageTypeEnum` + new reply arm + snapshot regen).

### D4 — Scanner is a core `app/` class (DOM allowed there), injected nothing

`packages/app/src/app/page-highlighter.ts` (new): `PageHighlighter` walks text nodes with a
`TreeWalker`, **chunked through `requestIdleCallback`** (fallback `setTimeout(…, 0)` when absent —
happy-dom) with a hard per-chunk budget (default 8 ms measured via `performance.now()`), so the
scan never blocks load or long-tasks the page. Skips: `SCRIPT/STYLE/NOSCRIPT/TEXTAREA/INPUT/SELECT`,
elements with `isContentEditable`, and the extension's own hosts (`BOTTOM-SHEET`, `LOOKUP-TRIGGER`,
any `AD-`-prefixed custom element). Wraps the whole scan in
`performance.mark`/`performance.measure('ad-highlight-scan')` — the e2e perf assertion reads that
measure. Dynamic content: one `MutationObserver` (childList, subtree), debounced 1 s, enqueues only
added subtrees into the same idle-chunk pipeline with a per-page cap (default 50 000 text nodes,
counted across the page's lifetime; beyond it, silently stop — perf fence outranks completeness).

### D5 — Underline styling stays inside the token system

The highlighter injects one `<style data-ad-b3>` element:
`:root{${BASE_VARS}}` + `::highlight(ad-saved-word){text-decoration:underline 2px dotted var(--ad-accent);text-underline-offset:2px}`.
`BASE_VARS` is the existing canonical export from `packages/app/src/ui/styles/tokens.ts:151` — no
color literal appears anywhere in B3 code (token law). Documented v1 limitation: the underline uses
the sepia-accent token on all pages (host pages don't carry `data-ad-theme`); acceptable because a
dotted accent underline reads correctly on both light and dark sites, and per-page theme detection
is out of scope.

### D6 — Off-switch: `highlightSavedWords` setting, default ON

- `Settings` (full, `packages/app/src/domain/types.ts:210-217`) gains `highlightSavedWords:
boolean`; `PublicSettings` (`types.ts:164-176`) gains the same field (content script needs it —
  it only ever sees PublicSettings). Legacy stored settings lack the key → every reader defaults
  `?? true`.
- `PublicSettingsSchema` (`packages/app/src/wire.ts:61-68`) gains `highlightSavedWords:
z.boolean()` (strictObject stays; snapshot regen). This is ordinary additive settings evolution
  (precedent: `configuredProviders`), NOT an E1-locked shape.
- Settings form (`packages/app/src/ui/settings-form.ts`): one checkbox in the same block as the
  existing cache/history toggles, labeled "Highlight saved words on pages", wired exactly like the
  neighboring toggles (locate-and-mirror).
- The SW's PublicSettings assembly (in `packages/extension-chrome/src/sw.ts`, the `settings.get`
  path near `readFullSettings`) maps the field through with `?? true`.

### D7 — Wiring (chrome shell only, per B1/B5 precedent)

`packages/extension-chrome/src/content.ts`: after the existing settings seed, fetch
`saved.learningWords`, construct `PageHighlighter`, `apply(words)` when
`settings.highlightSavedWords !== false`. The existing `toggle-save` / `toggle-status` listeners
(B1/B5) additionally trigger a re-fetch + `refresh(words)` after their reply resolves, so
this-tab saves/status-flips repaint immediately. Cross-tab live refresh: out of scope v1
(documented limitation — next natural page load picks it up). Safari shell: core is shared;
wiring deferred (same as B1/B5).

## 3. Scope fence (held verbatim)

Naive matching only (E5 otherwise) · no measurable page-load impact (idle chunks + budget + cap) ·
off switch in settings · known words never highlighted · A13 quiet-mode interplay N/A (A13 not
shipped; when it ships, its site list will gate the whole content script, including this).

## 4. Testing strategy

1. **Domain unit tests** — `naiveVariants` (incl. e-drop), `buildHighlightMatcher`,
   `findWordMatches` (word-boundary: 'bank' matches "banks," not "embankment"; case-insensitive;
   apostrophe/hyphen tokens).
2. **Wire schema tests** — `saved.learningWords` accepted; `savedWords` reply arm round-trips;
   snapshot regen.
3. **Router tests** — returns only learning-status headwords; empty list when nothing saved.
4. **PageHighlighter unit tests** (happy-dom) — no-CSS.highlights no-op; skip-list honored;
   style element injected once; matcher integration over a small DOM (assert via the ranges the
   class collects before handing to `Highlight`, exposed for tests as a readonly property).
5. **e2e** (`b3-highlight.spec.ts`) — seed `saved:*` entries directly in SW storage (one
   'learning', one 'known'), load the 100KB fixture: `CSS.highlights.has('ad-saved-word')` true,
   learning ranges > 0, known word's text absent from ranges,
   `performance.getEntriesByName('ad-highlight-scan')[0].duration < 50`; second test with
   `highlightSavedWords: false` seeded → no highlight registered; third: naive variants ('banks'
   highlighted for saved 'bank').
6. ~~Evidence video~~ **Retired (owner ruling 2026-07-16 — media evidence policy).** No
   `b3-evidence.spec.ts`; the PR body carries a written "Testing performed" section instead
   (suites, counts, e2e scenarios, gates). The B3 plan already reflects this.

## 5. Files touched

| File                                          | Change                                                |
| --------------------------------------------- | ----------------------------------------------------- |
| `packages/app/src/domain/highlight-policy.ts` | new — pure matcher                                    |
| `packages/app/src/app/page-highlighter.ts`    | new — idle-chunked scanner + Custom Highlight         |
| `packages/app/src/wire.ts`                    | + `saved.learningWords` msg, + `savedWords` reply arm |
| `packages/app/src/app/router.ts`              | + case                                                |
| `packages/app/src/domain/types.ts`            | + `highlightSavedWords` on Settings/PublicSettings    |
| `packages/app/src/ui/settings-form.ts`        | + checkbox toggle                                     |
| `packages/app/src/index.ts`                   | export new modules                                    |
| `packages/extension-chrome/src/sw.ts`         | map field into PublicSettings (`?? true`)             |
| `packages/extension-chrome/src/content.ts`    | fetch words, run highlighter, refresh hooks           |
| tests + snapshot + 2 e2e specs                | per §4                                                |

**Untouched:** `SavedWordEntry`/`SavedWordSense`/`SavedWordStatus` (E1), `ports.ts`,
saved-words-policy (read-only consumer).

## 6. Risk / rollback

Additive only; the scanner is inert when the list is empty, the setting is off, or
`CSS.highlights` is missing. Rollback = revert the PR; no data migration (the new setting key is
ignored by old code).
