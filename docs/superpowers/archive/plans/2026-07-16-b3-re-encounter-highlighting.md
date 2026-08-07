# B3 Re-encounter Highlighting Implementation Plan

> **For agentic workers:** implement task-by-task, TDD (red → green → commit) per task. The
> design spec (same folder, `-design.md`) carries every decision; do not re-open them.

**Goal:** learning-status saved words get a subtle dotted underline wherever they appear on any
page (exact word-boundary + naive plural/-ed/-ing matching only), known words never highlighted,
added page-load cost ≤ 50 ms on the 100KB fixture, off-switch in settings.

**Commit subject convention:** `feat: re-encounter highlighting — <task summary> (B3)`; trailer
`Tribe-Card: b3-re-encounter-highlighting`, `Tribe-Task: n/6`. No Co-Authored-By, no attribution.

## Global Constraints

- Implementer: one `hunter` subagent per task, brief = the task text verbatim + this section.
- Never touch `SavedWordEntry`/`SavedWordSense`/`SavedWordStatus` (E1) or `ports.ts`.
- `domain/highlight-policy.ts` imports NOTHING outside `domain/` (rule-domain-purity; the dep-
  direction script gates it).
- No color/hex literals anywhere — the injected style uses `BASE_VARS` from
  `ui/styles/tokens.ts` and `var(--ad-accent)` only.
- Gates before every commit: package typecheck(s), `bun run lint`, `bun run format:check`.
- Naive matching only — if a test seems to want smarter matching, that is a plan bug: STOP and
  hand back (E5 is owner-escalation territory).

---

### Task 1: `domain/highlight-policy.ts` — pure matcher

Files: create `packages/app/src/domain/highlight-policy.ts`; create
`packages/app/test/highlight-policy.test.ts`.

Step 1 — failing tests. Cover exactly:

- `naiveVariants('bank')` returns `['bank','banks','bankes','banked','banking']` (order-insensitive
  set equality; document the harmless 'bankes').
- `naiveVariants('smile')` includes `'smiled'` and `'smiling'` (e-drop) — full set
  `['smile','smiles','smilees','smileed','smiled','smiling']`.
- `naiveVariants('Bank')` is all-lowercase.
- `buildHighlightMatcher(['bank','smile'])` maps every variant to its headword
  (`matcher.get('banking') === 'bank'`, `matcher.get('smiled') === 'smile'`).
- `findWordMatches('Banks on the river bank', matcher)` → two spans with correct `[start,end)`
  offsets and `headword: 'bank'`; `'embankment'` yields none (word boundary); `"the bank's rate"`
  matches `bank` (possessive: token regex `/[A-Za-z][A-Za-z'-]*/g` keeps `bank's` as one token —
  assert it does NOT match, and add `bank's` handling ONLY as documented: strip a trailing
  `'s`/`'` from the token before lookup).
- Empty matcher / empty text → `[]`.

Step 2 — implement per the spec §D2 signatures. Variant generator: `[w, w+'s', w+'es', w+'ed',
w+'ing']`, plus when `w` ends with `'e'`: `w.slice(0,-1)+'ing'` and `w+'d'`. Lowercase everything.
`findWordMatches`: iterate `text.matchAll(/[A-Za-z][A-Za-z'-]*/g)`, token → lowercase → strip
trailing `'s`/`'` → `matcher.get(token)`; on hit push `{start: m.index, end: m.index +
m[0].length, headword}` (span covers the WHOLE token as it appears).

Step 3 — gate + commit (`Tribe-Task: 1/6`):
`cd packages/app && bunx vitest run test/highlight-policy.test.ts && bun run typecheck && cd ../.. && bun run lint && bun run format:check`.

---

### Task 2: wire message + router case (ONE task — router.ts's exhaustive `switch(msg.type)` has

no default, so a new wire arm does not typecheck until its router case exists on disk; B5 hit
this exact coupling)

Files: modify `packages/app/src/wire.ts`, `packages/app/test/wire-schema.test.ts`,
`packages/app/wire-schema.snapshot.json` (regenerated via `-u`, never hand-edited),
`packages/app/src/app/router.ts`, `packages/app/test/app/router.test.ts`. Single gate run, single
commit covering all five files.

Step 1 — failing tests, both files. Wire (new `describe('saved.learningWords wire message
(B3)')`): accepts `{type:'saved.learningWords'}`; mirror the existing `saved.delete` test's
strictness expectations exactly; `WireReplySchema` accepts `{ok:true, type:'savedWords',
words:['bank']}` and rejects `words: 'bank'` (non-array). Router: after `saved.save` of 'bank'
then 'money', then `saved.setStatus` money→known, `{type:'saved.learningWords'}` replies
`{ok:true, type:'savedWords', words:['bank']}` — EXACTLY, no 'money' (learning only; order is
savedWordsList's newest-first index order after the known word is filtered out); with nothing
saved → `{ok:true, type:'savedWords', words:[]}`.

Step 2 — implement both together: new arm `z.object({ type: z.literal('saved.learningWords') })`
after the B5 `saved.setStatus` arm; `'saved.learningWords'` appended to `MessageTypeEnum`; new
reply arm `z.object({ ok: z.literal(true), type: z.literal('savedWords'), words:
z.array(z.string()) })` after the existing `saved` reply arm. Router: import `savedWordsList`;
add after the B5 `saved.setStatus` case:

```ts
case 'saved.learningWords': {
  const entries = await savedWordsList({ storage: deps.kv });
  return {
    ok: true,
    type: 'savedWords',
    words: entries.filter((e) => e.status === 'learning').map((e) => e.word),
  };
}
```

(read-only — no `deps.queue.run` needed; mirrors how reads elsewhere skip the write queue).

Step 3 — regen snapshot (`bunx vitest run test/wire-schema.test.ts -u`; diff shows only the new
arms), single gate run, ONE commit of all five files (`Tribe-Task: 2/6`).

---

### Task 3: `highlightSavedWords` setting

Files: modify `packages/app/src/domain/types.ts` (Settings + PublicSettings),
`packages/app/src/wire.ts` (PublicSettingsSchema + snapshot), `packages/app/src/ui/settings-form.ts`
(+ its test file), `packages/extension-chrome/src/sw.ts`.

Step 1 — failing tests: wire test — `PublicSettingsSchema` now REQUIRES `highlightSavedWords:
boolean` (strictObject); settings-form test — the form renders a checkbox labeled "Highlight saved
words on pages" wired like the neighboring cache/history toggles (locate the existing toggle tests
and mirror them exactly).

Step 2 — implement:

- `types.ts`: `PublicSettings` gains `/** B3: paint saved learning-status words on pages.
Default true; legacy stored settings lack the key — every reader applies \`?? true\`. \*/
  highlightSavedWords: boolean;` (Settings inherits via extends).
- `wire.ts`: `highlightSavedWords: z.boolean()` in `PublicSettingsSchema`; regen snapshot.
- `settings-form.ts`: locate-and-mirror the cache/history checkbox block; new checkbox bound to
  the same save/dirty machinery (A16's dirty-cue must fire — it is generic over form fields; do
  not special-case).
- `sw.ts`: in the PublicSettings assembly (the `settings.get` reply path near `readFullSettings`),
  add `highlightSavedWords: s.highlightSavedWords ?? true`. Also confirm the settings SAVE path
  (options page writes full Settings) persists the field — it stores the whole settings object, so
  no change expected; verify by reading, note in the report.
- Every other constructor of a `PublicSettings` literal (tests, mocks, safari sw if it compiles
  one) gains the field — let typecheck find them all; fix each with `highlightSavedWords: true`.

Step 3 — gates on BOTH packages + commit (`Tribe-Task: 3/6`).

---

### Task 4: `app/page-highlighter.ts`

Files: create `packages/app/src/app/page-highlighter.ts`; create
`packages/app/test/app/page-highlighter.test.ts`; modify `packages/app/src/index.ts` (export the
class + the domain policy functions alongside the existing domain exports).

Public surface (spec §D4):

```ts
export class PageHighlighter {
  constructor(doc: Document, opts?: { chunkBudgetMs?: number; maxTextNodes?: number });
  /** Build matcher from learning headwords and start the idle-chunked scan + mutation watch. */
  apply(words: string[]): void;
  /** Clear painted ranges + re-apply with a fresh word list (this-tab save/status changes). */
  refresh(words: string[]): void;
  /** Remove highlight registration, style element, observer. Idempotent. */
  clear(): void;
  /** Test seam: ranges collected so far (readonly). */
  readonly ranges: ReadonlyArray<Range>;
}
```

Behavior (all from spec §D1/D4/D5 — no new decisions): no-op when `CSS.highlights` undefined or
`words` empty; inject `<style data-ad-b3>:root{${BASE_VARS}}
::highlight(ad-saved-word){text-decoration:underline 2px dotted var(--ad-accent);text-underline-offset:2px}</style>`
once into `doc.head`; TreeWalker `SHOW_TEXT` with skip list (spec §D4: SCRIPT/STYLE/NOSCRIPT/
TEXTAREA/INPUT/SELECT, `isContentEditable`, tag names `BOTTOM-SHEET`/`LOOKUP-TRIGGER`/prefix
`AD-`); chunk via `requestIdleCallback` (fallback `setTimeout 0`), per-chunk `performance.now()`
budget `chunkBudgetMs` (default 8); `performance.mark('ad-highlight-scan:start')` at first chunk,
`performance.measure('ad-highlight-scan', ...)` when the initial walk completes; per-match
`Range` via `range.setStart/setEnd` on the text node using `findWordMatches` offsets; single
`Highlight` object registered as `'ad-saved-word'`, `CSS.highlights.set` after each chunk;
MutationObserver (childList+subtree, debounce 1000 ms) enqueues added element subtrees, same
pipeline, `maxTextNodes` lifetime cap (default 50_000) silently stops.

Step 1 — failing tests (happy-dom; `CSS.highlights` shim: define a Map on globalThis.CSS when
absent, plus a minimal `Highlight` stub — put the shim in the test file):
constructor+apply with empty words → no style element, no scan; apply over a small DOM collects
ranges covering 'bank' and 'banks' text but nothing inside `<script>`/`<textarea>`/a
`contenteditable` div/`<bottom-sheet>`; style element injected exactly once across
apply+refresh; `clear()` removes style + empties ranges and is idempotent; refresh with a
now-known word's list drops its ranges; when `CSS.highlights` is truly absent (delete the shim)
everything no-ops. Use fake timers for idle-fallback + debounce.

Step 2 — implement. Step 3 — gates + commit (`Tribe-Task: 4/6`).

---

### Task 5: content.ts wiring

Files: modify `packages/extension-chrome/src/content.ts` (composition root — e2e-covered, per
B1/B5/B7 precedent; typecheck gate only here).

- Import `PageHighlighter` (+ `type SavedWordStatus` already imported by B5).
- After the `themedSettings` seed block: create `const highlighter = new
PageHighlighter(document);` and a `refreshHighlights()` helper: `chrome.runtime.sendMessage({
type: 'saved.learningWords' })` → on `{ok:true, type:'savedWords'}` reply call
  `highlighter.refresh(reply.words)` (first call is `apply` — let the class treat refresh-before-
  apply as apply; if the class distinguishes, call apply the first time — follow the class's
  contract from Task 5 as written). Gate the initial call on the seeded settings:
  `themedSettings.get().then((s) => { if (s.highlightSavedWords !== false) refreshHighlights(); })`
  — reuse the EXISTING seed call at line ~36 (extend its `.then`), do not add a second
  `settings.get()` round trip.
- In the B5 `toggle-save` and `toggle-status` listeners: after the reply resolves successfully,
  call `refreshHighlights()` (both save→learning-appears and known-flip→disappears repaint).
- Settings-change reactivity across tabs/pages: out of scope v1 (spec §D7) — do NOT add storage
  listeners.

Gates on both packages + commit (`Tribe-Task: 5/6`).

---

### Task 6: e2e functional spec

Files: create `packages/extension-chrome/e2e/b3-highlight.spec.ts`; if no ~100KB-text fixture
exists under `packages/extension-chrome/e2e/fixtures/`, add `b3-large.html` (generated static
lorem-ipsum-with-planted-words file, committed; plant ≥3 occurrences of 'bank'/'banks'/'banking',
≥2 of 'money', zero of each inside a `<textarea>` and a `contenteditable` block which must also be
present).

Seeding pattern: get the SW handle (`context.serviceWorkers()[0]`), then `sw.evaluate` a
`chrome.storage.local.set` writing `saved:bank` (status 'learning'), `saved:money` (status
'known'), and `saved:index` `['bank','money']` — entries shaped exactly per the E1 schema (word,
status, savedAt, senses:[{definition,translation,sentence,url,title}]). Then `seedSettings(page)`
as every other spec does.

Tests:

1. Fixture loads → `page.evaluate(() => CSS.highlights.has('ad-saved-word'))` true; range count
   ≥ 3; every range's `toString().toLowerCase()` starts with 'bank' (naive variants included);
   NO range stringifies to 'money'; no range lies inside the textarea/contenteditable;
   `performance.getEntriesByName('ad-highlight-scan')[0].duration` < 50.
2. Seed settings with `highlightSavedWords: false` (extend `seedSettings`' options param — check
   `helpers.ts`; it merges a settings object, so pass the extra key) → reload →
   `CSS.highlights.has('ad-saved-word')` false.
3. Storage-empty run → no highlight registered, no `ad-highlight-scan` measure longer than 50 ms
   either (the no-op path must also be cheap).

Run: `bun run build:chrome && cd packages/extension-chrome && bunx playwright test b3-highlight`.
Gates + commit (`Tribe-Task: 6/6`).

---

## Final gate (after Task 6, before PR)

```
cd packages/app && bun run typecheck
cd ../extension-chrome && bun run typecheck
cd ../.. && bun run test && bun run lint && bun run format:check && bun run build:chrome
cd packages/extension-chrome && bunx playwright test saved-word b5-status-lifecycle b3-highlight
```

(b5 + saved-word suites are the regression guards — B3 reads what they write.)

## PR

Title: `feat: re-encounter highlighting — underline saved learning words on pages (B3)`.
Body: 1–3 sentences; design bullets (≤3): CSS Custom Highlight API — zero DOM mutation; pure
domain matcher, naive variants only (E5 fence); `saved.learningWords` wire read, S1-safe.
Evidence policy (owner ruling 2026-07-16): NO media capture — the PR body carries a
"Testing performed" section instead: unit suites + counts, the e2e scenarios exercised
(highlight present / known-word negative / naive variants / off-switch / perf measure < 50 ms),
and the gates that passed. ALL CI checks green → `gh pr merge --merge
--delete-branch` (regular merge; squash prohibited). Verify merge commit has 2 parents; master CI
green; remove worktree.
