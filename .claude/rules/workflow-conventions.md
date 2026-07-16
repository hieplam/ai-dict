# workflow-conventions

Project workflow conventions — an imperative checklist that complements the narrative `CLAUDE.md`.

## NEVER

- Use `raw.githubusercontent.com` evidence URLs (different origin → 404 on this private repo).
- Drive installed Google Chrome for extension work (Chrome 136+ ignores `--load-extension`).
- Hand-edit `.c3/` (it is CLI-only).

## Always

- Start even trivial work in a git worktree under `.claude/worktrees`.
- Include a "Testing performed" section in every PR body (owner ruling 2026-07-16 — media
  evidence retired; suites, counts, e2e scenarios, gates).
- Do real-browser work through the project Playwright e2e harness.
- If media is ever explicitly requested again: same-origin `github.com/<owner>/<repo>/raw/...`
  URLs only (raw.githubusercontent.com 404s on this private repo).
- Consult C3 (`/c3` or read `.c3/`) before architecture changes.
