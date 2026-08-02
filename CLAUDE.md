# Conventions

- Evidence policy (owner ruling 2026-07-16): do NOT capture screenshots/videos for PRs. Every
  PR body carries a written **"Testing performed"** section instead — suites run, test counts,
  e2e scenarios exercised, gates passed. (The pre-2026-07-16 before/after media convention is
  retired; historical `pr-assets/*` branches remain valid for old PRs.)
- Always start work even trivial work with git worktree. Default worktree path is `.claude/worktrees`.
- Run `bun run lint` and `bun run format:check` before committing — the `.githooks/pre-commit` hook and CI also gate this.

# Verification loop (verification-loop campaign, card V5)

What must pass before merge, and what each gate proves — read this before claiming a PR is
ready. Mechanism lives in `.github/workflows/ci.yml`; this section is the policy layer that
tells an LLM (or a person) which command to run and why it exists.

## Gate registry

| Gate                        | Command                                                                                                      | Proves                                                                                                                                                                                                                                       | When        |
| --------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| Hard-rule scanners (6)      | `bun run lint` (runs `bun scripts/hard-rule/run-all.mjs`)                                                    | Named invariants below — the registry is `scripts/hard-rule/`, discovered by filename, never hardcoded                                                                                                                                       | commit + CI |
| — `check-dep-direction.mjs` | (same)                                                                                                       | `rule-domain-purity`: inward-only import direction (domain → ports only; shells never cross)                                                                                                                                                 | commit + CI |
| — `check-core-agnostic.mjs` | (same)                                                                                                       | `rule-domain-purity`: the portable core never references `chrome.*`                                                                                                                                                                          | commit + CI |
| — `check-key-isolation.mjs` | (same)                                                                                                       | `rule-api-key-isolation` (S1): the Gemini/OpenAI/Anthropic key stays in the SW + options page only                                                                                                                                           | commit + CI |
| — `check-msg-gate.mjs`      | (same)                                                                                                       | `rule-gate-runtime-messages` (S3): every `onMessage` listener gates via `classifyInbound(` first                                                                                                                                             | commit + CI |
| — `check-safe-html.mjs`     | (same)                                                                                                       | `rule-sanitize-model-output` (S4): every raw-HTML sink is sanitized or carries an `s4:` review annotation                                                                                                                                    | commit + CI |
| — `check-token-law.mjs`     | (same)                                                                                                       | Paperlight token law: components read only `--ad-*`/`--adp-*`, never a hard-coded hex/oklch value                                                                                                                                            | commit + CI |
| ESLint                      | `bun run lint` (runs `eslint .` after the scanners)                                                          | IDE-parity lint, incl. `@typescript-eslint/only-throw-error` (`rule-typed-errors`' throw form) and `import-x/no-restricted-paths` (dep-direction, IDE-time mirror of the scanner)                                                            | commit + CI |
| Typecheck                   | `bun run typecheck`                                                                                          | `tsc --noEmit` clean across `app`, `extension-chrome`, `extension-safari`                                                                                                                                                                    | CI          |
| Format                      | `bun run format:check`                                                                                       | Prettier formatting matches `.prettierrc`                                                                                                                                                                                                    | commit + CI |
| Unit suite                  | `bun run --filter @ai-dict/app test`                                                                         | `@ai-dict/app` domain/app-layer correctness (703 tests)                                                                                                                                                                                      | CI          |
| Wire-schema contract tests  | `bun run --filter @ai-dict/app test wire-schema`                                                             | The zod wire schema accepts/rejects every message shape, incl. S1 apiKey stripping, **and** the typed-errors wire-flatten contract (`rule-typed-errors`: an error reply survives the `chrome.runtime` JSON round-trip with `message` intact) | CI          |
| Coverage gate               | `bun run --filter '*' test -- --coverage`                                                                    | Per-package coverage floors (own `vitest.config.ts` thresholds): `app` 90%, `extension-chrome` 80%, `extension-safari` 90% — run per package so each package's own gate applies, not a merged global number                                  | CI          |
| Build (Chrome)              | `bun run build:chrome`                                                                                       | The MV3 bundle builds; the hard-rule scanners re-run first, so a violating tree can't produce a bundle                                                                                                                                       | CI          |
| Build (Safari)              | `bun run build:safari`                                                                                       | The Safari `web-ext` bundle builds (Xcode archive is a separate release-time step)                                                                                                                                                           | CI          |
| E2E suite                   | `bun run e2e:chrome` (CI: build with `GA4_MEASUREMENT_ID`/`GA4_API_SECRET` set, then `bunx playwright test`) | Real Chromium flows through `packages/extension-chrome/e2e/` — coverage floor tracked in `docs/testing/e2e-case-inventory.md`                                                                                                                | CI          |
| knip                        | `bunx knip`                                                                                                  | No dead exports / unused dependencies                                                                                                                                                                                                        | CI          |
| gitleaks                    | `gitleaks/gitleaks-action` (GitHub Action)                                                                   | No committed secrets — advisory-shaped scan, blocking on PR and nightly                                                                                                                                                                      | CI          |

Pre-commit (`.githooks/pre-commit`) runs only `format:check` + `lint` (scanners + eslint) —
fast, local, matches the two CI jobs of the same name. Everything else in the table is CI-only.

## Hard/soft boundary

**Hard** = the `scripts/hard-rule/` folder + the named contract tests above — the registry _is_
the folder: `run-all.mjs` discovers every `check-*.mjs` file by filename (no hardcoded list) and
refuses to pass on zero scanners, so an emptied folder fails loud instead of silently going
green. **Soft** = rules with no scanner, enforced by review only — labeled "review-enforced".
At minimum: **"adapters stay thin and decision-free"** (`pure-core.md` — effects belong at the
edge, decisions never do) is ratified soft.

## Merge gate

GitHub branch protection is unavailable here (private repo, free plan — ratified skip). The
substitute is a hard workflow rule: **merge only after `gh pr checks` reports every check
green.** An LLM performing a merge MUST run `gh pr checks` first and read its output — do not
infer green from "CI usually passes" or from a partial job list.

## Flake-triage protocol

A red check may be waved off ONLY after reproducing the _same_ failure on current `master`
HEAD — if master is also red on that check, it's a pre-existing flake, not this PR's bug. The
waiver and its reproduction evidence (command + output) go in the PR body. **Docs-only
waiver:** if the diff touches no source or test file, and a check fails for a reason clearly
unrelated to the change (e.g. e2e timing flake), the PR body may state
`docs-only waiver: <check name> — <reason>` without a master-HEAD repro.

## Deliberate advisory

`dep-audit` (`bun audit --audit-level=high`) is **advisory on PRs, blocking on the nightly
schedule** (`continue-on-error: ${{ github.event_name != 'schedule' }}` in `ci.yml`) — by
ratified design, not neglect: a new high-severity advisory shouldn't block an unrelated PR, but
must page someone within a day.

## Pointers

- `docs/testing/e2e-case-inventory.md` — the e2e coverage floor (≥80%) and the zero-flake wall
  (3 consecutive green full-suite runs) behind the E2E suite gate.
- `docs/superpowers/specs/` (verification-loop campaign) — the "why" behind each gate above.

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

# Public landing page (GitHub Pages)

The project ships a public landing page at **<https://hieplam.github.io/ai-dict/>** that
introduces all features. Facts every session should know:

- **Source lives in THIS repo:** `docs/index.html` (single file, ~1,900 lines), served by GitHub
  Pages from `/docs` on `master` — merging to `master` IS deploying the page.
- **Bilingual (EN/VI) with a language toggle; theme-aware** — it runs the same Paperlight
  `--ad-*`/`--adp-*` tokens as the extension. Section anchors: `#why`, `#compare`, `#guide`,
  `#start` (3-step setup), `#faq` (troubleshooting).
- **The extension's content script runs on it** (it is a normal webpage under `<all_urls>`), so
  the real select → Define → card flow works there. Roadmap Category C leans on this: C3 (guided
  first lookup opens the page's try-it section) and C11 (install-aware `#start` checklist).
- **Rules:** the page must NEVER collect, receive, or render the API key (S1) — key entry stays
  inside extension pages. Keep `#start` in sync whenever onboarding/provider setup changes (C4).
  E2e suites must never fetch the live site — use a local fixture standing in for it.

# Frontend design system — "Paperlight" (source of truth)

The **single source of truth for the frontend design system is the [`design-system/`](design-system/) folder.** Start at [`design-system/README.md`](design-system/README.md) — it is the folder map. Layout:

- `design-system/DESIGN.md` — the **visual design system**: token architecture, Sepia/Dark/High-Contrast color tables, typography, motion, every surface. Start here.
- `design-system/PRODUCT.md` — the **strategic/brand** doc: users, purpose, brand personality, principles, accessibility.
- `design-system/IMPLEMENTATION_GUIDE.md` — the build-ready **"Paperlight"** engineering spec (verbatim hand-off; Prettier-ignored).
- `design-system/AI Dictionary Design System.html` — the **living visual reference**; flip the Sepia/Dark/Contrast toggle to see every surface re-theme.
- `design-system/tokens.css` — the **portable token export** mirroring the shipped code.

**Shipped implementation:** `packages/app/src/ui/styles/tokens.ts` — primitives (`--adp-*`), per-theme semantic blocks (`--ad-*`), and the canonical inline-SVG icon set. **When the docs and the code disagree, the guide + `tokens.ts` win** (fix the doc). In C3 the UI surface is `c3-117 ui-components` governed by `ref-web-components-shadow-dom`.

**Non-negotiable token law:** components read **only** `--ad-*` / `--adp-*` tokens — never hard-code a hex/oklch value, never name a theme, never branch on `prefers-color-scheme` per component (theme switching is centralized via the `data-ad-theme` attribute). No pure `#fff`/`#000`. The earlier **"Candlelit Margin" cozy-Christmas** identity (holly, pine/cranberry, honey-amber glow, festive ribbon) is **retired** — do not reintroduce it into the default themes.

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

# Long-running work — resume protocol

Multi-task efforts (roadmap campaigns etc.) follow the owner's global standard: a live state
file at `.okra/runs/<run-id>/SHAMAN-STATE.md` (single "read this first" entry point, updated at
every transition) plus a committed snapshot under `docs/superpowers/campaign/` at every card
boundary. A new session resumes by reading state FIRST, then verifying every claim against live
GitHub/git reality (`gh pr view`, `git log`, worktrees, CI) before acting — the file is data,
the world is authority.
