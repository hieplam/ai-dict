# workflow-conventions

Project workflow conventions — an imperative checklist that complements the narrative `CLAUDE.md`.

## NEVER

- Use `raw.githubusercontent.com` evidence URLs (different origin → 404 on this private repo).
- Drive installed Google Chrome for extension work (Chrome 136+ ignores `--load-extension`).
- Hand-edit `.c3/` (it is CLI-only).

## Always

- Start even trivial work in a git worktree under `.claude/worktrees`.
- Attach before/after evidence to every PR (screenshot for trivial changes, video for flows/behavior).
- Embed private-repo evidence via same-origin `github.com/<owner>/<repo>/raw/...` URLs.
- Do real-browser work and screenshots through the project Playwright e2e harness.
- Consult C3 (`/c3` or read `.c3/`) before architecture changes.
