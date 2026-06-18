# Conventions

- Always add evidence Before/After when open PR, screenshot for trivial change, video record for flow, behavior changes
- Always start work even trivial work with git worktree. Default worktree path is `.claude/worktrees`.
- Run `bun run lint` and `bun run format:check` before committing — the `.githooks/pre-commit` hook and CI also gate this.

**This repo is PRIVATE.** When embedding image/video evidence in a PR or issue, the asset URL MUST be a **same-origin `github.com` URL** so the authorized viewer's session cookies authenticate the request:

- ✅ Use `https://github.com/<owner>/<repo>/raw/<branch>/<path>` (or `.../blob/<branch>/<path>?raw=true`).
- ❌ Never use `https://raw.githubusercontent.com/...` — it is a _different origin_, gets no auth cookies, returns **404** for private repos, and renders as a broken image. (GitHub does not Camo-proxy GitHub-owned hosts, so the only thing that makes the image load is the same-origin cookie.)
- Host evidence on a throwaway branch (e.g. `pr-assets/<slug>`) referenced by the `github.com/.../raw/...` URL, keeping binaries out of the merged source branch.

# Browser testing & extension screenshots — use the Playwright e2e harness

Anything that needs a real browser in this repo — e2e, manual verification, or capturing PR before/after evidence of the extension UI — goes through the **project's Playwright harness, which drives the Playwright-bundled Chromium with the unpacked extension loaded.**

This is the **project-scoped exception to the global "prefer agent-browser for browser work" rule.** A Chrome MV3 extension needs `--load-extension` + a bundled Chromium + `chrome.storage` seeding + service-worker extension-id capture — all of which the e2e harness already encodes — so reach for it first instead of agent-browser when the target is this extension.

- **Run it:** `bun run e2e:chrome`, or `cd packages/extension-chrome && bunx playwright test <spec>`. `HEADED=1` to watch the browser.
- **Build first:** `bun run build:chrome` so `packages/extension-chrome/dist` is current before it's loaded.
- **The harness** lives in `packages/extension-chrome/e2e/`:
  - `fixtures.ts` launches `chromium.launchPersistentContext('', { args: ['--headless=new', '--load-extension=<dist>', ...] })` and derives the extension id from the registered service worker.
  - `helpers.ts` gives you `seedSettings(page, { theme, … })` (writes `chrome.storage.local`), `gotoFixture`, `selectWord`, `openTrigger`, and `mockGemini` / `mockOpenAI`.
- **Screenshots / evidence:** reuse the harness (`page.screenshot` / `locator.screenshot`); seed the theme with `seedSettings`. For before/after, capture BEFORE from a `master` build and AFTER from the branch build, then host the PNGs per the private-repo note above (`pr-assets/<slug>` branch + same-origin `github.com/.../raw/...` URLs).

**Guardrail: never drive your installed Google Chrome** — Chrome 136+ silently ignores `--remote-debugging-port` (default profile) and `--load-extension`. The Playwright-managed Chromium (a bundled/standalone build, not Google Chrome) honors both, which is exactly why the harness uses it.

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
