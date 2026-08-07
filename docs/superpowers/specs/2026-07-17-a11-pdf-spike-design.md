# A11 — PDF support (discovery spike) — design

Roadmap card: `docs/ROADMAP.md` §4 A11 (Impact 4 · Effort L · Score 1.3). Depends on: — .
Escalation: **E4 — PDF go/no-go + permissions**, already partially resolved: the owner approved
_running the spike_ (`docs/ROADMAP.md` §8, 2026-07-16 — "Owner approved running the time-boxed
feasibility spike. Deliverable is a written go/no-go report (approaches, costs, permission
needs) — **not** a feature; the post-spike go/no-go and any new permission return to the
owner"). This spec does **not** re-open that ruling; it designs the investigation, not the
product.

**This is not a feature spec.** A11's own scope fence (`docs/ROADMAP.md` §4 A11) reads:
"Deliverable is a feasibility report, **not** a feature." Per
`.okra/runs/spec-all-cards-2026-07-17/CONTRACTS.md` §4: "A11: deliverable is a written
feasibility report (the plan's tasks are time-boxed investigations producing
`docs/superpowers/specs/2026-07-17-a11-pdf-feasibility-report.md`); no product code, docs-only
PR; go/no-go + any permission returns to the owner (E4)." This spec pins **how the investigation
is run** — what gets probed, how, and what the report must contain — so the implementer who
executes `docs/superpowers/plans/2026-07-17-a11-pdf-spike.md` needs zero judgment calls, exactly
as the house bar requires for a code plan, just applied to an investigation plan instead.

## 1. Problem (grounded in code)

Today the extension does nothing inside Chrome's PDF viewer, and there is no PDF-aware code
anywhere in the repo — confirmed by `grep -rni pdf` across the worktree (excluding
`node_modules`/`dist`), which returns zero hits outside `docs/ROADMAP.md`'s own A11 card text and
this batch's planning docs.

The extension's reach today is defined entirely by
`packages/extension-chrome/src/manifest.json:35-55`:

```json
"content_scripts": [
  { "matches": ["<all_urls>"], "js": ["content-elements.js"], "run_at": "document_idle", "world": "MAIN" },
  { "matches": ["<all_urls>"], "js": ["content.js"], "run_at": "document_idle" }
]
```

`host_permissions` is already `["<all_urls>"]` (`manifest.json:17-19`) — the broadest legal grant for
web-origin (`http`/`https`) schemes. `content-elements.ts` (6 lines, MAIN world) calls
`registerContentElements()` **unconditionally at load** — it does not wait for a selection or any
other trigger — so its custom elements (`lookup-trigger`, `lookup-card`, `bottom-sheet`) are
registered in a page's `CustomElementRegistry` the instant the script runs, on every page the
manifest's `matches` pattern covers. Selection capture itself is
`DomSelectionSource` (`packages/app/src/app/dom-selection-source.ts:35-51`), which listens for
`mouseup`/`touchend` on `document` (`dom-selection-source.ts:46`) and, on firing, calls
`window.getSelection()` plus a `Range`-based `extractSentence` (`dom-selection-source.ts:5-12`) —
it needs a real DOM text node with a live `Range` to do anything.

### 1.1 The roadmap card's own claim needs a correction, and Probe 1 (§2) is why

`docs/ROADMAP.md` §4 A11 states the gap as: **"Chrome's PDF viewer does not run content scripts
on PDF content, so the standard approach is a dead end."** This is the right conclusion but an
imprecise mechanism, and getting the mechanism right matters for evaluating the build-vs-buy table
in §3 — a fix that targets the wrong cause (e.g. "widen `matches`") would be a wasted engineering
week. The precise mechanism, confirmed by both external research (see citations below) and this
spec's own scripted probe (§2):

- When Chrome navigates to a URL that serves a PDF, it does **not** hand the tab to a different
  extension's origin. It loads a normal top-level **boilerplate HTML document at the original
  `http(s)` URL** — the address bar still shows the PDF's real URL, and this document IS same-
  origin/matches `<all_urls>` like any other page.
- That boilerplate document renders the actual PDF through a `MimeHandlerView` — an `<embed>`
  element that hosts Chrome's built-in "Chrome PDF Viewer" component extension
  (`mhjfbmdgcfjbbpaeojofohoefgiehjai`) as a **cross-process, site-isolated guest frame**. Per
  Chromium's own architecture docs (see Sources), a **Shadow DOM wraps the outer `<embed>`
  specifically to prevent scripts from reaching the inner frame** via `window.frames` or the
  `Document` interface — this is deliberate isolation, not an oversight, and it applies to every
  extension's content scripts equally, including this one's.
- Consequence: our content scripts (both `content-elements.js` and `content.js`) **do run** on the
  PDF's top-level boilerplate document — `<all_urls>` matches it — but that document has **no
  selectable PDF text** for `DomSelectionSource` to ever see a `mouseup`-with-a-real-`Range` on.
  The actual PDF text lives inside the isolated guest frame, which belongs to a different
  extension's origin and is walled off from ours regardless of how broad `host_permissions` is.
  No `matches` pattern, however broad, and no additional host permission on **this** extension can
  cross that boundary — it is a same-origin/site-isolation wall between two different extensions'
  processes, not a permission gap.

This distinction — "content scripts run, but land on an empty shell" vs. "content scripts never
run at all" — is exactly the kind of imprecision a discovery spike exists to catch before
"weeks of wasted work" (the card's own stated risk) go into fixing the wrong layer.

## 2. Design questions (pinned)

### D1 — Probe 1's methodology: a scripted repro, not desk research alone

**Question:** the dispatch note (`.okra/runs/spec-all-cards-2026-07-17/DISPATCH-NOTES.md` §"A11
pdf-spike") requires probe 1 to "confirm content-script behavior on Chrome's PDF viewer (cite
manifest + a scripted check)" — what exactly does the scripted check assert, and how is it built
without adding permanent product code?

**Pinned:** a **throwaway** Playwright spec, run once against this repo's existing
`extension-chrome` e2e harness (`packages/extension-chrome/e2e/fixtures.ts` — the same
`chromium.launchPersistentContext` + `--load-extension` harness every other e2e spec in this repo
uses, so the probe observes the REAL shipped extension, not a simulation), that:

1. Serves a locally-generated, real, valid one-page PDF over `http://` via Playwright's own
   `context.route` (no external network fetch — keeps the probe hermetic and fast).
2. Navigates the extension-loaded browser to that URL and asserts two independent facts in the
   SAME run: (a) did our content scripts execute on the resulting top-level document at all
   (`customElements.get('lookup-trigger')` — true the instant `content-elements.js` loads,
   regardless of any selection, per §1's reading of `content-elements.ts`), and (b) is there any
   selectable text in that top document for `DomSelectionSource` to ever act on
   (`document.body.innerText` + a check that Chrome rendered its PDF `<embed>` at all, not a
   download prompt).
3. Records the two booleans as the report's Probe 1 evidence — a stronger, falsifiable claim than
   quoting external sources alone.

**Rejected alternative — desk research only (external citations, no repro).** The dispatch note
explicitly asks for a _scripted_ check, not just citations, and for good reason: this repo's own
manifest/content-script wiring is bespoke (two content scripts, two worlds, `run_at:
document_idle`) — an external source describing _generic_ Chrome extension behavior doesn't by
itself prove _this_ extension's specific content scripts behave the same way on a PDF tab. A
probe against the real built dist closes that gap. (External sources are still cited in §1 and the
report, to explain _why_ the probe comes out the way it does — but they don't replace running it.)

**Rejected alternative — assert on real page text selection via `selectWord()`.** This repo's
existing `selectWord()` e2e helper (`packages/extension-chrome/e2e/helpers.ts:198-215`) works by
building a `Range` over a known DOM text node inside a fixture page the test controls. It cannot
be reused verbatim against a PDF tab, because (per §1.1) the point being probed is precisely that
no such reachable text node exists in the top document — the helper would have nothing to select
against. Probe 1 instead asserts the _absence_ of any such node (`document.body.innerText` is
empty) directly, which is the more informative signal here.

### D2 — Fixture generation: a real PDF, not a hand-built one

**Question:** how does the probe get a valid PDF to serve, given a hand-crafted minimal-PDF byte
string (the common "hello world PDF" recipe) is easy to get subtly wrong (broken `xref` byte
offsets are a classic mistake) and an invalid PDF would make Chrome show an error/download page
instead of its PDF viewer — invalidating the whole probe?

**Pinned:** generate the fixture with Playwright's own `page.pdf()` API (Chromium's built-in
"print to PDF"), which always emits a structurally valid PDF — no hand-rolled binary, no xref
math. This runs once, from a plain (non-extension) headless Chromium instance, and writes the
bytes to a scratch file consumed by the probe spec.

**Rejected alternative — hand-crafted minimal PDF bytes.** Rejected per the byte-offset fragility
above: a probe whose finding depends on getting `xref` offsets exactly right, by hand, in a
document nobody will ever re-verify, is exactly the kind of grounding error the house quality bar
(`CONTRACTS.md` §6, "adversarial reviewer will hunt... steps without code") exists to catch —
better to remove the failure mode entirely.

**Rejected alternative — fetch a public sample PDF over the network.** Rejected because it makes
the probe non-hermetic (network-dependent, breaks in CI/offline, and this repo's own convention is
explicit — this worktree's `CLAUDE.md`, "Public landing page (GitHub Pages)" section: "E2e suites
must never fetch the live site — use a local fixture standing in for it."; the same hermeticity
principle applies here even though this is a throwaway probe, not a shipped spec) and because a
self-generated fixture is simpler to reason about than an external file whose internal structure
isn't controlled by us.

### D3 — Probe artifacts stay out of the PR diff

**Question:** the card's scope fence is "docs-only PR, no product code" — how does running a
Playwright spec (which necessarily means _creating_ a `.spec.ts` file and a `.pdf` fixture inside
`packages/extension-chrome/e2e/`) stay compatible with that fence?

**Pinned:** the probe spec and its generated PDF fixture are created under
`packages/extension-chrome/e2e/probes/` (a throwaway subdirectory that does not exist before this
plan runs), executed locally, their console/JSON output captured into the report by hand, and then
**deleted** (`rm -rf packages/extension-chrome/e2e/probes/`) before anything is `git add`ed. The
plan's final gate task (Task 3) asserts `git status --short` shows exactly one new tracked file —
the report — before opening the PR. This is the same "evidence without shipping the harness"
pattern the repo already uses for one-off checks; it differs from a normal e2e spec only in that
it is explicitly never committed, because — unlike every other spec in `e2e/` — there is no
shipped product behavior for it to regression-guard.

**Rejected alternative — commit the probe as a permanent regression spec.** Rejected: a permanent
e2e test that asserts "our content scripts cannot reach PDF text" would have nothing to regress —
there is no feature toggling that behavior, and the assertion would only ever break if Chromium's
own PDF-viewer architecture changed upstream (extremely rare, and not something this repo's CI
should gate on). It would also silently violate the card's explicit "no product code" fence the
moment it landed.

### D4 — The build-vs-buy table's shape

**Question:** the dispatch note asks for "a build-vs-buy table (custom pdf.js viewer page,
DevTools/alternative selection APIs, 'not worth it'), each with cost + permission needs" — what
exactly goes in each row, and on what axes?

**Pinned:** exactly the three candidates the dispatch note names, one row each, scored on five
fixed columns so every row is directly comparable: **Mechanism**, **New permissions needed**,
**Rough engineering cost**, **Preserves Chrome's native PDF UX** (toolbar/print/zoom/a11y — losing
this is a real regression risk, not a footnote), and **Risk**. Desk research (§3 below) supplies
the content; no additional candidate rows are invented, because the dispatch note's enumeration is
already a Shaman-level pin (`.okra/runs/spec-all-cards-2026-07-17/DISPATCH-NOTES.md`) — adding a
fourth candidate would be scope creep on an already-bounded L-effort spike.

**Rejected alternative — free-form pros/cons prose per approach.** Rejected: the dispatch note
itself asks for a _table_, and a table is the right shape here specifically because the point of
the spike is quick, side-by-side comparability for the owner's eventual go/no-go call (E4) — prose
buries that comparison.

### D5 — The report is a recommendation, not a decision

**Question:** the plan's Task 3 says "write the report with a recommendation" — does authoring
that recommendation reopen E4 (go/no-go + permissions), which `docs/ROADMAP.md` §6 reserves for
the owner?

**Pinned:** no. The report states a **reasoned lean** (e.g. "recommend against building a full
replacement PDF viewer in v1; recommend X as a lower-cost alternative if the reading-in-PDFs need
stays high-priority") with its supporting cost/risk evidence, and explicitly labels the actual
go/no-go and any new permission grant as **owner decisions still pending (E4)** — mirroring
exactly how the 2026-07-16 decision log entry frames it ("the post-spike go/no-go and any new
permission return to the owner"). The report recommends; it does not ratify.

**Rejected alternative — the report silently implies a decision by omission (e.g. just listing
options with no lean).** Rejected: a report with no recommendation forces the owner to redo the
cost/benefit synthesis from raw findings, which defeats the point of running a spike at all
("Payoff (of the spike): A written go/no-go" — `docs/ROADMAP.md` §4 A11 — the spike's payoff is
specifically that the analysis work is already done for the owner to ratify or reject).

### D6 — Report file identity and location

**Question:** `CONTRACTS.md` §0 lists this card's spec/plan pair as
`docs/superpowers/specs/2026-07-17-a11-pdf-spike-design.md` +
`docs/superpowers/plans/2026-07-17-a11-pdf-spike.md` (this pair), but §4 separately names
`docs/superpowers/specs/2026-07-17-a11-pdf-feasibility-report.md` as the plan's _output_. Are these
the same file?

**Pinned: no, three distinct files, same directory family.** This spec (`...-a11-pdf-spike-
design.md`) designs the investigation. The plan (`...-a11-pdf-spike.md`) is the task list that,
when _executed_ by a future implementer, produces the third file — `...-a11-pdf-feasibility-
report.md` — which is the actual feasibility report with findings and a recommendation. This spec
and plan exist now (authored in this batch); the feasibility report does not exist yet and is
**not** authored as part of this batch — it is the deliverable of running the plan.

**Rejected alternative — fold the feasibility report into this spec file.** Rejected: `CONTRACTS.md`
§4 explicitly names the report as its own file with its own name; conflating "the design of the
investigation" with "the investigation's findings" would also make it impossible to tell, from the
spec alone, whether the spike had actually been run yet.

## 3. The change

**No product code changes.** This section exists (per the house C2-style format) to record that
explicitly, and to describe what running the plan produces instead of a source diff.

### 3.1 What this spec + plan pair changes today

Nothing in `packages/`. This spec and the accompanying plan are the only files this authoring
task writes.

### 3.2 What executing the plan (a later, separate step) produces

One new file: `docs/superpowers/specs/2026-07-17-a11-pdf-feasibility-report.md`, containing (per
the plan's exact task breakdown):

1. An executive summary and recommendation (§2 D5).
2. Probe 1's findings: the manifest citation (§1) plus the scripted check's two boolean results
   (§2 D1) with the exact assertions and their pass/fail outcome.
3. The build-vs-buy table (§2 D4) with all three rows filled from desk research.
4. An explicit "Owner decision needed (E4)" closing section that does not pre-empt the decision.

Nothing under `packages/extension-chrome/` or `packages/app/` is touched, added, or removed by
executing the plan — the probe artifacts described in §2 D3 are explicitly deleted before any
commit.

### 3.3 No change to `manifest.json`, `esbuild.config.mjs`, or any permission

Recorded explicitly because it's the one thing an implementer might reflexively reach for: this
card's own scope fence forbids "any `file://`/host-permission" decision from being made here — see
§4 below. `packages/extension-chrome/src/manifest.json`'s `permissions`/`host_permissions`
(currently `["storage", "sidePanel"]` / `["<all_urls>"]`, `manifest.json:13-16` /
`manifest.json:17-19`) are read-only
inputs to this investigation, never edited by it.

## 4. Scope fence held

- **"Deliverable is a feasibility report, not a feature"** (`docs/ROADMAP.md` §4 A11) — held: §3.1
  confirms zero product code changes from this authoring step; §3.2 confirms the plan's only
  output is a markdown report.
- **"No product code, docs-only PR"** (`CONTRACTS.md` §4) — held: §2 D3 pins that probe artifacts
  (the throwaway Playwright spec + generated PDF fixture) are deleted before any `git add`; the
  plan's final gate task asserts this mechanically (`git status --short`).
- **"Go/no-go + any permission returns to the owner (E4)"** (`CONTRACTS.md` §4,
  `docs/ROADMAP.md` §6/§8) — held: §2 D5 pins the report as a recommendation, not a ratified
  decision; no permission is requested or granted by this spec, this plan, or the report it
  produces.
- **"Escalate to owner: the go/no-go after the spike, and any file://\host-permission the chosen
  path requires"** (`docs/ROADMAP.md` §4 A11) — held: §3.3 explicitly forbids touching
  `manifest.json`; the build-vs-buy table (§2 D4) surfaces which candidates _would_ need a new
  permission, without requesting one.

## 5. Testing strategy

There is no product code to unit- or e2e-test — the "test" for this card is the investigation
probe itself, and its correctness bar is different from a normal TDD task: instead of red→green
against a spec, each probe has a **definition of done** (an artifact + a recorded finding) that
the plan's tasks spell out exactly (`docs/superpowers/plans/2026-07-17-a11-pdf-spike.md`, per
task):

1. **Probe 1 (scripted check)** — **time box: ≤ 1 hour, including fixture generation.** DoD: the
   throwaway Playwright spec described in §2 D1 runs to completion (no timeout/hang) against a
   real built `dist/` (via the existing `packages/extension-chrome/e2e/fixtures.ts` harness) and
   both assertions resolve to a concrete `true`/`false`, recorded verbatim in the report — not
   paraphrased, not assumed. If the ceiling is exceeded, STOP the probe and record what is known
   so far in the report — an overrun is itself a feasibility datum.
2. **Probe 2 (build-vs-buy survey)** — **time box: ≤ 2 hours.** DoD: all three table rows (§2 D4)
   are filled with a concrete permission list and a cost/risk rating, each backed by a cited
   mechanism (e.g. which MV3 API/permission the "custom pdf.js viewer" row would need, and why).
   If the ceiling is exceeded, STOP the probe and record what is known so far in the report — an
   overrun is itself a feasibility datum.
3. **Probe 3 (write the report)** — **time box: ≤ 1 hour.** DoD: the report file exists at the
   exact path from §2 D6, contains all four sections from §3.2, and the "owner decision needed"
   closing section names E4 explicitly rather than implying an answer. If the ceiling is exceeded,
   STOP and record what is known so far — an overrun is itself a feasibility datum.

## 6. Testing performed policy (PR body)

Per this worktree's `CLAUDE.md` (owner ruling 2026-07-16) and `CONTRACTS.md` §2: no screenshots or
video. The PR's "Testing performed" section instead lists, verbatim: which probe ran, its exact
assertions and outcomes (from §5.1), that the probe artifacts were deleted pre-commit (from §2
D3), and the gates that passed (`bun run lint`, `bun run format:check` — the only two gates
relevant to a docs-only change; there is no product code for `typecheck`/`test`/`build` to cover,
and the plan's final task notes this explicitly rather than running gates that do nothing).

## 7. Risk / rollback

- **Risk: very low.** The entire deliverable is markdown; there is no runtime behavior to
  regress, no data shape, no wire message, no permission change. The only way this card could
  cause harm is if its _report_ were mistaken for a shipped feature or a granted permission — §2
  D5's explicit "owner decision needed (E4)" framing and §4's scope-fence restatement exist
  specifically to prevent that misreading.
- **No data migration, no manifest change, no wire/router change.**
- **Rollback:** revert the single PR. Nothing downstream depends on the report's existence except
  a future owner conversation about E4 — reverting it loses no functionality.

## 8. Files touched (summary)

| File                                                              | Change                                                                                              |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `docs/superpowers/specs/2026-07-17-a11-pdf-spike-design.md`       | New — this spec (written now)                                                                       |
| `docs/superpowers/plans/2026-07-17-a11-pdf-spike.md`              | New — the investigation plan (written now)                                                          |
| `docs/superpowers/specs/2026-07-17-a11-pdf-feasibility-report.md` | New — produced by _executing_ the plan (a later, separate step); not written by this authoring task |
| `packages/extension-chrome/e2e/probes/*` (throwaway)              | Created and run during plan execution, deleted before commit — never lands in a diff                |

No other file is touched at any point in this card's lifecycle.

## 9. Concurrency

Per `CONTRACTS.md` §5, every author lists files this card modifies that other unshipped cards also
modify, so the orchestrator can serialize conflicting work. This card modifies:

- `docs/superpowers/specs/` — adds two new files with names unique to this card (per the slug list
  in `CONTRACTS.md` §0: `a11-pdf-spike` and, on later execution, the separately-named
  `a11-pdf-feasibility-report`). No other card in this batch writes to either filename, so no
  collision is possible regardless of authoring order or parallelism.
- `docs/superpowers/plans/` — adds one new file, `2026-07-17-a11-pdf-spike.md`, unique for the
  same reason.

This card touches **zero** files in `packages/` at any point (see §3), so it shares none of
`CONTRACTS.md` §5's listed hot files (lookup-card UI, content-script/trigger, settings-form, side
panel, prompt-builder, `docs/index.html`, wire+router) with any other in-flight card. No
serialization is required against any other A/B/C card in this batch.

## Sources (external platform behavior cited in §1.1)

- Chromium extensions group, "Can extension (content script) run in the default PDF viewer?" —
  <https://groups.google.com/a/chromium.org/g/chromium-extensions/c/CNPumQ7X4qs> (confirms: the
  PDF tab's top document is a normal page; content scripts run there but not inside the viewer
  itself).
- Chromium `components/guest_view` (MimeHandlerView) source tree —
  <https://chromium.googlesource.com/chromium/src/+/lkgr/components/guest_view/> and the
  MimeHandlerView + OOPIF design doc (cross-process guest frame architecture, Shadow-DOM
  isolation of the outer `<embed>`).
- Chromium process-model/site-isolation docs —
  <https://chromium.googlesource.com/chromium/src/+/main/docs/process_model_and_site_isolation.md>
  (site isolation applied to MimeHandlerView embeds).
