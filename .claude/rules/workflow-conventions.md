# workflow-conventions

Project workflow conventions — an imperative checklist that complements the narrative `CLAUDE.md`.

## NEVER

- Use `raw.githubusercontent.com` evidence URLs (different origin → 404 on this private repo).
- Drive installed Google Chrome for extension work (Chrome 136+ ignores `--load-extension`).
- Hand-edit `.c3/` (it is CLI-only).
- Treat undesigned `ports.ts` / schema-lock drift as a quiet opt-out — a schema-lock trip whose
  delta is NOT what the card's own spec designs must escalate first, never get waved through
  (ruling R2/UC-3, campaign outstanding-17 — the companion rule to the Always bullet above).
- Prefix a commit subject, branch name, or PR title with a `[CardName]`/ticket-style bracket —
  it breaks release-please's Conventional Commits parser. No `## JIRA ticket` PR section either
  (this repo has no ticket tracker). See `docs/git-conventions.md`.

## Always

- Start even trivial work in a git worktree under `.claude/worktrees`.
- Include a "Testing performed" section in every PR body (owner ruling 2026-07-16 — media
  evidence retired; suites, counts, e2e scenarios, gates).
- Do real-browser work through the project Playwright e2e harness.
- If media is ever explicitly requested again: same-origin `github.com/<owner>/<repo>/raw/...`
  URLs only (raw.githubusercontent.com 404s on this private repo).
- Consult C3 (`/c3` or read `.c3/`) before architecture changes.
- Merge only after `gh pr checks` reports every check green (branch protection is unavailable
  on this private free-plan repo — this is the substitute merge gate; see CLAUDE.md
  "Verification loop").
- Reproduce a red check on current `master` HEAD before waving it off; put the waiver + evidence
  in the PR body (docs-only diffs may use the documented docs-only waiver instead).
- After creating a fresh worktree, run the dependency bootstrap (`bun install`) BEFORE the first
  commit — a fresh worktree has no `node_modules`, so the pre-commit hook's repo-wide typed lint
  reports hundreds of false `no-unsafe-*` errors without it (evidence:
  `docs/superpowers/campaign/2026-aug-08-log.md`, "First diary commit rejected by the pre-commit
  hook", 2026-08-08; ruling UC-1, campaign outstanding-17).
- Before reporting a card or PR as done, finish the cleanup — delete the remote feature branch,
  remove the worktree, and fast-forward local master to `origin/master`. "Merged" is not "done":
  done means the next task starts clean on latest changes (ruling R1/UC-2, campaign
  outstanding-17).
- Grant a schema-lock (`allowsSchemaChange`) opt-out ONLY when the delta is exactly what the
  card's own spec designs, and declare it explicitly in the PR body with the literal phrase
  pattern "schema-lock opt-out: designed in spec section X" (ruling R2/UC-3, campaign
  outstanding-17).
