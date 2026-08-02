# V2 — the hard-rule scanner folder (verification-loop campaign, card 2)

**Goal (measurable):** `scripts/hard-rule/` exists as THE machine-readable registry of hard
rules: one `.mjs` scanner per rule, a runner that executes all of them, wired as the first step
of `bun run lint`, both extension builds, and the pre-commit hook. Proof: 4 scanners
(dep-direction migrated + 3 new) each with a dep-direction-style lock test, a runner discovery
test, and a deliberately-planted violation of each rule fails `bun run lint` (demonstrated in
tests, not committed).

**Why:** owner audit 2026-08-02: of the repo's documented hard rules only domain purity had
mechanical enforcement (`scripts/check-dep-direction.mjs` + lock test). Owner ruling: "if a hard
rule is just prose, it's a soft rule" — each hard rule gets its own scanner script in a single
folder; `bun run lint` simply runs all scripts in that folder.

## Ratified architecture (owner, 2026-08-02)

- Folder `scripts/hard-rule/`; one scanner per rule; a small runner (`scripts/hard-rule/run-all.mjs`
  or equivalent) enumerates every scanner in the folder, runs each, aggregates failures, exits
  non-zero if any fail. `bun run lint` = runner first, then eslint. Both extension build scripts
  run the runner (replacing their direct `check-dep-direction.mjs` invocation).
- **Exclusions:** ONE shared exclusions file, entries scoped PER RULE (never global — `sw.ts`
  must be excluded from token-law yet remain the primary S3 surface), each entry with a
  mandatory human-readable `reason`. A lock test rejects reason-less entries.
- **Default scope:** whole repo including `docs/index.html`; opt-out only via the exclusions file.
- Every scanner has a lock test (fixture with a violation → scanner fails; clean fixture →
  passes; the rule matrix/patterns pinned) plus one runner test asserting folder discovery picks
  up all scanners.

## The scanners in this card

1. **Migrate `check-dep-direction.mjs`** (and its lock test) into the folder unchanged in
   behavior; update `package.json` lint script, both `esbuild.config.mjs` build invocations, and
   any other reference to its old path.
2. **`check-token-law.mjs`** (new): bans hex color literals (`#rgb`/`#rrggbb`/`#rrggbbaa`),
   `oklch(`, and `prefers-color-scheme` outside `packages/app/src/ui/styles/tokens.ts`.
   Seed exclusion: `packages/extension-chrome/src/sw.ts` badge color (`chrome.action.setBadgeBackgroundColor`
   cannot read CSS custom properties — the badge paints outside any DOM the extension styles).
   Scanner authors must tune patterns against real false positives (e.g. hex-like ids/hashes) —
   scoping the match to style-ish contexts is acceptable; blanket file exclusions are the fallback.
3. **`check-key-isolation.mjs`** (new, S1): line scan banning `.storage.local` outside the files
   the existing ESLint `no-restricted-syntax` selector already allowlists (read
   `eslint.config.mjs` and mirror its exact file scoping — per extension: `sw.ts`, `options.ts`).
   The ESLint selector STAYS in config as IDE-time feedback (ratified: script authoritative,
   eslint editor-duplicate — the dep-direction pattern). Runtime `z.strictObject` layer and the
   release-workflow env guard are untouched.
4. **`check-core-agnostic.mjs`** (new): bans `chrome.` anywhere in `packages/app/src/**`
   (platform reaches the core only through ports injected by the shells' composition roots).
   Implementation MUST start by scanning the current tree: any existing hit is either a real
   leak (fix it in this card if trivial, else report via NEEDS_DIRECTION) or a reasoned exclusion.
   Note: type-only references like `chrome.storage` in comments/types — decide on evidence;
   `typeof chrome` in type positions may warrant a narrower pattern or exclusion with reason.

## Also in this card (ratified follow-on)

- `.githooks/pre-commit` (and keep `.githooks/pre-commit.local` byte-identical if it is meant to
  mirror it — inspect before touching): add `bun run lint` after `format:check` so hard-rule
  violations surface at commit time, not first in CI.

## Out of scope

S3/S4 scanners and the typed-errors contract test (card V3 — they join this folder later).
Do not modify any rule's semantics; this card only mechanizes what is already documented.

## Acceptance

1. `bun run lint` runs the folder runner first; a test-fixture violation of each rule fails it.
2. Both extension builds fail on a dep-direction violation exactly as before the migration.
3. All lock tests + runner discovery test green; full unit suite, typecheck, e2e green.
4. Exclusions file has per-rule scoping and reasons; lock test proves reason-less entries rejected.
5. PR body: "Testing performed" section.
