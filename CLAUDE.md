# Conventions

- Always add evidence Before/After when open PR, screenshot for trivial change, video record for flow, behavior changes
- Always start work even trivial work with git worktree. Default worktree path is `.claude/worktrees`.

**This repo is PRIVATE.** When embedding image/video evidence in a PR or issue, the asset URL MUST be a **same-origin `github.com` URL** so the authorized viewer's session cookies authenticate the request:

- ✅ Use `https://github.com/<owner>/<repo>/raw/<branch>/<path>` (or `.../blob/<branch>/<path>?raw=true`).
- ❌ Never use `https://raw.githubusercontent.com/...` — it is a _different origin_, gets no auth cookies, returns **404** for private repos, and renders as a broken image. (GitHub does not Camo-proxy GitHub-owned hosts, so the only thing that makes the image load is the same-origin cookie.)
- Host evidence on a throwaway branch (e.g. `pr-assets/<slug>`) referenced by the `github.com/.../raw/...` URL, keeping binaries out of the merged source branch.

# Screenshotting the Chrome extension

**Guardrail: never drive your installed Google Chrome to capture extension screenshots** — Chrome 136+ silently ignores `--remote-debugging-port` (default profile) and `--load-extension`. Use **agent-browser's bundled Chromium** instead (use the agent-browser skill).

# Architecture (C3)

This repo is documented with **C3** in `.c3/` (a queryable architecture model). Consult it before changing code; `.c3/` is CLI-only — never edit it by hand.

**Shape:** one portable core + two thin browser shells, under a **lean dependency rule** — the kept half of hexagonal (one-way deps, a dependency-free `packages/app/src/domain/`, and communication only through the ports in `packages/app/src/ports.ts`). The full 5-package hexagon was deliberately flattened to 3 as overengineered.

- `c3-1` **app** (`@ai-dict/app`) — domain, ports, wire protocol, shared adapters, UI web components.
- `c3-2` **extension-chrome** / `c3-3` **extension-safari** — MV3 shells; `sw.ts` / `content.ts` are the composition roots that inject platform adapters into the core.

**Use C3 (via `/c3` or the `c3` CLI) for architecture questions, changes, audits, and file context:**

- `c3 lookup <file-or-glob>` → which component + refs + rules own a file (run before editing).
- `c3 list` → topology; `c3 graph <id> --format mermaid` → diagram; `c3 check` → validate docs.
- Refs (the "why"): `ref-core-dependency-rule`, `ref-wire-protocol-validation`, `ref-dependency-injection`, `ref-kv-storage-prefixes`, `ref-web-components-shadow-dom`.
- Rules (enforced): `rule-api-key-isolation` (S1), `rule-sanitize-model-output` (S4), `rule-gate-runtime-messages` (S3), `rule-domain-purity` (§8.3), `rule-typed-errors`.

Operations: query, audit, change, ref, rule, sweep.
