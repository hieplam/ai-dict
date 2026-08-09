# Git conventions

This repo tracks work with [Conventional Commits](https://www.conventionalcommits.org/) — full
stop. There is no Jira (or any other ticket tracker) behind this repo: it is a personal project,
and `release-please` (`.github/workflows/release-please.yml`,
`release-please-config.json`) computes every version bump and `CHANGELOG.md` entry directly from
commit messages on `master`. A commit that doesn't parse as Conventional Commits is invisible to
that pipeline — it won't bump the version and won't appear in the changelog, silently.

This file is the single source of truth for commit/branch/PR shape. Plans, cards, and any
AI-authored work (Claude, Copilot, or otherwise) MUST follow it instead of copying the shape of
an older PR or plan doc.

## Commit messages

```
<type>(<optional-scope>): <description>
```

- `type` — one of `feat`, `fix`, `perf`, `refactor`, `docs`, `style`, `test`, `build`, `ci`,
  `chore`, `revert`. Lowercase, no other value.
- `(<scope>)` — optional, lowercase, e.g. `feat(options-page): ...`. Most commits in this repo
  omit it and put the area in free text instead (see below) — both are valid.
- `description` — imperative, present tense free text. A roadmap card code may be appended in
  parentheses at the end purely for cross-referencing the plan doc, e.g.
  `feat: double-click auto-fires the cooldown-gated lookup (A14)` — this is just descriptive text
  after the colon, not a scope, and does not affect parsing.
- **No `[CardName]` (or any other) bracket prefix before the type.** The type token must be the
  very first thing on the line — `conventional-changelog`'s parser (what `release-please` uses)
  requires it there, so a leading bracket makes the whole commit invisible to the release
  pipeline. This is the exact defect this file was written to close (see PR that introduced it).
- **No `Co-Authored-By` trailer for agent work.**
- Breaking changes: `feat!: ...` or a `BREAKING CHANGE:` footer, per spec — bumps the major
  version.

Good: `feat: add per-site quiet mode` · `fix(sw): retry on 429` · `test: cover NO_KEY fallback (A13)`
Bad: `[A13QuietMode] feat: add per-site quiet mode (A13)` — bracket breaks the parser.

## Branch names

```
<type>/<kebab-case-slug>
```

e.g. `feat/a14-double-click-trigger`, `fix/gemini-sse-framing`, `chore/git-conventions-cleanup`.
Use the same `type` vocabulary as commits. Card codes, if useful, go inside the slug in lowercase
(`a14-...`), not as a separate bracketed prefix. `pr-assets/<slug>` remains the one carve-out, for
throwaway evidence branches per CLAUDE.md's private-repo evidence policy.

## PR titles

Mirror the primary commit type: `feat: double-click trigger (A14)`. Same rules as commit subjects
— type first, no bracket prefix. Since this repo does **regular merges (no squash — standing
owner ruling)**, the PR title itself never reaches `release-please`; every individual commit does,
which is why every commit (not just the PR title) must be conventional.

## PR body

No `## JIRA ticket` section — this repo has no ticket tracker, so the section has nothing to say
and should not exist. Use:

- `## Description`
- `## Design choices` (when relevant)
- `## Testing performed` — required, per the 2026-07-16 owner ruling in `CLAUDE.md`: suites run,
  counts, e2e scenarios, gates passed. No screenshots/video.
- `## Merge checklist`

`.github/pull_request_template.md` carries this shape by default.

## Enforcement

- **Local:** `.githooks/commit-msg` runs `scripts/check-conventional-commit.mjs` on every
  `git commit`, rejecting a non-conforming subject before it's made. Wired via
  `core.hooksPath = .githooks` (same mechanism as the existing `pre-commit` hook).
- **CI:** the `commit-lint` job in `.github/workflows/ci.yml` re-validates every commit in a PR's
  range against `master`, so a hook bypassed locally (`--no-verify`) still fails the merge gate.

## History

Two earlier sweeps (`[JiraLinkSweep]` PR #134, `[JiraSweepFinal]` PR #141, both July 2026) tried
to remove a leaked Prospa-shaped `[TICKET] type: message` convention and a `## JIRA ticket`
section from plan docs, but only reworded the section to `n/a` instead of deleting it, and never
addressed the bracket-prefix commit format at all — so both kept reappearing in new plans and PRs
by imitation. This file plus the hook/CI gate above are the actual fix: a single authoritative
doc plus a mechanical gate, instead of relying on the next plan author to remember.
