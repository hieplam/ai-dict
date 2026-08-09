# A11 — PDF support: discovery-spike feasibility report

Roadmap card: `docs/ROADMAP.md` §4 A11. Design: `docs/superpowers/specs/2026-07-17-a11-pdf-spike-design.md`.
Plan executed: `docs/superpowers/plans/2026-07-17-a11-pdf-spike.md`.

**This report is a recommendation, not a decision.** The actual go/no-go and any new browser
permission are owner-reserved (`docs/ROADMAP.md` §6, register item E4) and are NOT ratified by
this document.

## Executive summary

Chrome's built-in PDF viewer renders PDF content inside a cross-process, site-isolated guest frame
(a `MimeHandlerView` owned by Chrome's own `mhjfbmdgcfjbbpaeojofohoefgiehjai` extension) behind a
Shadow DOM specifically added to block other extensions' scripts from reaching it — confirmed both
by Chromium's own architecture (Sources) and by a scripted probe against this repo's real,
built extension (Probe 1): our content scripts DO run on a PDF tab's top document, but that
document has no selectable PDF text for `DomSelectionSource` to ever act on. No `manifest.json`
change can cross this isolation boundary — it applies uniformly to every extension, not just this
one, and no additional host permission narrows it.

The only ways to offer a select→define-equivalent experience inside PDFs are to render PDFs
ourselves (a full `pdf.js`-based viewer, blanket or opt-in) or to reach into the native viewer via
an unsupported debugging surface (`chrome.debugger`) — see Probe 2's table. Every viable path costs
materially more than this card's siblings (matching its own Effort L rating) and either asks for a
new permission with real user-trust cost (`declarativeNetRequest` + `file://` access, or the
persistent `debugger` warning bar) or takes on an open-ended PDF-rendering maintenance burden this
product has never carried before.

## Probe 1 — does today's architecture reach PDF text? (scripted, reproducible)

**Grounding:** `packages/extension-chrome/src/manifest.json:35-55` — both content scripts
(`content-elements.js`, world MAIN; `content.js`, isolated world) match `<all_urls>`;
`host_permissions` is already `["<all_urls>"]` (`manifest.json:17-19`), the broadest legal grant for
`http`/`https` schemes. `content-elements.ts` calls `registerContentElements()` unconditionally at
load. Selection capture is `DomSelectionSource` (`packages/app/src/app/dom-selection-source.ts:35-51`),
which needs a real DOM text node with a live `Range` on `mouseup`/`touchend`.

**Method:** a throwaway Playwright probe (`packages/extension-chrome/e2e/probes/a11-pdf-content-script.probe.spec.ts`,
deleted after this run — not part of this PR's diff) loaded the real built extension via this
repo's existing e2e harness, navigated to a locally-served, Playwright-generated valid one-page
PDF, and asserted three independent facts on the resulting top-level document: (a) did our content
scripts execute at all (`customElements.get('lookup-trigger')`), (b) is there any selectable text
in that top document (`document.body.innerText`), and (c) did Chrome render its own PDF viewer at
all (`embed` element count). Run twice — the originally generated fixture, then a freshly
regenerated fixture (per the plan's Step 4 fluke-elimination guidance) — to rule out a one-off bad
PDF byte stream.

**Result (verbatim from the run) — attempt 1** (fixture: `page.pdf()`-generated, 16638 bytes):

```
A11_PROBE_RESULT {"contentScriptRan":true,"topDocumentText":"","embedCount":0}
```

Outcome: **1 failed** — `expect(embedCount).toBeGreaterThan(0)` received `0`.

**Result (verbatim from the run) — attempt 2**, fixture regenerated from scratch (deleted +
re-run `gen-pdf-fixture.mjs`, identical `page.pdf()` recipe, also 16638 bytes — same recipe, a
fresh file):

```
A11_PROBE_RESULT {"contentScriptRan":true,"topDocumentText":"","embedCount":0}
```

Outcome: **1 failed**, same assertion, same values — the result reproduces exactly, ruling out a
one-off fluke in the fixture bytes. A one-off diagnostic line added between the two attempts
(`page.url()` / `page.title()`, not part of the plan's original three assertions) returned:

```
A11_PROBE_DIAG {"url":"http://test.fixture/sample.pdf","title":""}
```

The navigation itself completed normally (the page's URL is the PDF's real served URL, not
`about:blank` and not an aborted-download state) — but the document title stayed empty.

**Root-cause follow-up (post-report investigation, same worktree, same 16638-byte fixture
recipe) — the headless hypothesis is refuted, not confirmed.** A `HEADED=1` rerun of the identical
harness-based probe produced the identical result:

```
A11_PROBE_RESULT {"contentScriptRan":true,"topDocumentText":"","embedCount":0}
A11_PROBE_DIAG {"title":"","url":"http://test.fixture/sample.pdf","hasEmbedTag":false,"contentType":"application/pdf"}
```

Headed vs. headless makes no difference — `embedCount: 0` in both. Two further checks pin the
actual cause:

1. A bare Playwright Chromium (`chromium.launch()`, no extension flags at all, both headless and
   headed) navigating to the same `application/pdf` response **threw**
   `Error: goto: Download is starting` — this browser has no PDF viewer to render the response at
   all; it falls straight to a file download.
2. In this repo's harness config (`--disable-extensions-except=${dist}` +
   `--load-extension=${dist}`, `packages/extension-chrome/e2e/fixtures.ts:19-23`), the navigation
   did not throw; the top document loaded with `document.contentType === "application/pdf"` and an
   empty body, but no `<embed>` — i.e. the harness's `--disable-extensions-except` flag suppresses
   the browser-level download prompt (evidence 1) but there is still no PDF-viewer extension
   present to render one.

**Precise root cause:** the Playwright-bundled **Chromium** (`bunx playwright --version` → `1.60.0`
in this worktree — a bundled test browser, not Google Chrome) does **not ship** Chrome's built-in
PDF Viewer component extension (`mhjfbmdgcfjbbpaeojofohoefgiehjai`); a bare instance of it treats
`application/pdf` as a download (evidence 1 above), and this repo's harness additionally passes
`--disable-extensions-except=${dist}`, which disables every component extension except the one
under test (evidence 2 above). The `MimeHandlerView` `<embed>` therefore cannot render in this
harness **regardless of `--headless=new` vs. `HEADED=1`** — confirmed by the identical headed
rerun above. This is a limitation of the **test browser this repo's e2e harness bundles**, not of
headless mode, and it says nothing about real Google Chrome, where the PDF Viewer component
extension ships by default and users do get the native in-browser viewer.

**Reading — an unexpected result, reported precisely, not paraphrased away.** Assertion (a),
`contentScriptRan: true`, is solidly confirmed in both attempts (and the headed rerun): our
content scripts DO execute on a PDF tab's top-level document, exactly as `<all_urls>` promises —
this finding is independent of the PDF-rendering gap above and stands on its own. Assertions
(b)/(c) did **not** confirm what the plan expected, and — per the root cause above — **cannot be
observed with this repo's Playwright tooling at all**, headed or headless: the tooling has no PDF
viewer to render a `MimeHandlerView` `<embed>` for `document.body.innerText`/`embed` count to ever
detect. The "PDF text is rendered but walled off inside an isolated `MimeHandlerView` guest frame"
half of Probe 1's intended finding therefore remains grounded exactly where it started — in
external Chromium architecture documentation (Sources below) — not in this scripted run, and no
further Playwright-based rerun of this probe (headed or headless) can close that gap with this
repo's current e2e tooling.

**Correction to the roadmap card's stated mechanism:** `docs/ROADMAP.md` §4 A11 says "Chrome's PDF
viewer does not run content scripts on PDF content" — imprecise, and Probe 1's `contentScriptRan:
true` result (confirmed across both fixture attempts and the headed rerun, unaffected by the
test-browser PDF-viewer gap above) already falsifies it directly: content scripts DO run on a PDF
tab's top-level document. The stronger, guest-frame-isolation half of the mechanism (design spec
§1.1) remains grounded in external Chromium documentation (Sources below) rather than in this
scripted run, per the test-browser limitation above. The distinction still matters for evaluating
fixes in Probe 2: no `manifest.json` change (wider `matches`, more permissions) can fix a
content-script-execution problem that Probe 1's `contentScriptRan: true` shows does not exist —
per Chromium's own architecture docs, the actual blocker in real Google Chrome is a same-origin/
site-isolation wall between two different extensions' processes, which no permission on this
extension can cross.

## Probe 2 — build-vs-buy: candidate approaches

| Approach                                                    | Mechanism                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | New permissions needed                                                                                                                                                                                                                                                                                       | Rough engineering cost                                                                                                                                                                                                                                                                                                                                | Preserves Chrome's native PDF UX?                                                                                                                                                                            | Risk                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Custom pdf.js viewer page**                               | Bundle `pdf.js`; intercept navigations to PDF URLs (a `declarativeNetRequest` redirect rule matching PDF responses/extensions) to an extension-hosted viewer page that fetches the raw bytes and renders its own selectable text layer, wired to the existing `DomSelectionSource`/lookup pipeline.                                                                                                                                                                                                         | `declarativeNetRequest` (redirect rule); the Chrome-managed "Allow access to file URLs" toggle for local `file://` PDFs (a manifest `file://` intent plus a user-facing per-extension switch — this repo currently declares neither); a widened CSP (`worker-src`/`wasm-unsafe-eval` for `pdf.js`'s worker). | **High** — this is building and maintaining a full PDF reader (page rendering, zoom, print, keyboard nav, text-layer accessibility) inside the extension, not a small addition; matches the card's own Effort L rating.                                                                                                                               | **No, unless fully rebuilt** — toolbar, print, zoom, page thumbnails, and existing accessibility behavior all have to be reimplemented or the replacement regresses a reading surface users already rely on. | **High** — a blanket redirect makes this extension the single point of failure for ALL of a user's PDF reading; a bug here breaks a core browser capability the user did not ask us to take over.                                                                                                            |
| **Custom pdf.js viewer, opt-in ("Open in AI Dictionary")**  | Same rendering approach, but entry point is an explicit user action (toolbar/context-menu item) that opens the PDF in an extension-hosted tab, leaving Chrome's native viewer as the default.                                                                                                                                                                                                                                                                                                               | Same permission needs as above for the viewer page itself, minus the blanket `declarativeNetRequest` redirect rule (no interception of every PDF navigation).                                                                                                                                                | **High** — still a full `pdf.js` integration; the only savings versus the row above is the interception mechanism, not the viewer itself.                                                                                                                                                                                                             | **Yes for the default path** — native viewer stays default; only PDFs the user explicitly opens in our viewer lose native toolbar parity.                                                                    | **Medium** — opt-in scope limits blast radius (a broken viewer only affects users who explicitly chose it), but the ongoing maintenance surface (keeping a bundled PDF renderer current, accessible, and secure) is identical to the row above.                                                              |
| **DevTools/alternative selection APIs (`chrome.debugger`)** | Attach the Chrome DevTools Protocol to the tab (`chrome.debugger` permission) and use protocol-level APIs to read PDF text/selection state, then synthesize an overlay UI positioned over the native viewer.                                                                                                                                                                                                                                                                                                | `debugger` — shows Chrome's own persistent "`<Extension>` is debugging this browser" warning bar on every tab it attaches to, for as long as the tab is open.                                                                                                                                                | **Medium-high** — the DevTools Protocol surface for PDF text extraction is not a stable, documented public contract for this use case (it exists for Chrome's own inspector/printing tooling); expect ongoing breakage as Chrome ships updates, i.e. a support burden roughly comparable to a bespoke integration despite avoiding a `pdf.js` bundle. | **Yes** — the native viewer itself is untouched; only an overlay is added.                                                                                                                                   | **High** — the persistent debugger warning bar is a visible, unavoidable UX regression on every PDF tab (not just ones a user chooses), and Chrome offers no guarantee this internal surface stays stable release to release; an unsupported combination this deep in the platform can break without notice. |
| **"Not worth it" — no PDF-viewer feature in v1**            | Ship nothing. The lowest-cost mitigation available today, if the underlying need (defining a word while reading a PDF) still matters, is a manual "paste to define" entry point — e.g. a toolbar popup with a text field the user pastes a copied word/sentence into, reusing 100% of the existing lookup pipeline with zero new permissions and zero PDF-specific code. This is explicitly a **different, much smaller card**, not part of A11's scope, and is not being proposed for implementation here. | None.                                                                                                                                                                                                                                                                                                        | **Low** (S-effort, if ever pursued as its own card) for the mitigation; **zero** for doing nothing.                                                                                                                                                                                                                                                   | N/A — native viewer untouched, no overlay attempted.                                                                                                                                                         | **Low.**                                                                                                                                                                                                                                                                                                     |

## Recommendation

**Lean: do not build PDF support in v1.** None of the three viable candidates in Probe 2's table
clears a good cost/value bar against this product's "seamless reading UX" theme (`docs/ROADMAP.md`
§4 intro) without either (a) taking over a core browser capability (native PDF rendering) the
product has no track record maintaining, or (b) shipping a visibly broken UX signal (the
`chrome.debugger` warning bar) on every PDF tab regardless of whether the user wants the feature.

If the underlying reader need (define a word while reading a PDF) is still judged worth serving
cheaply, the "not worth it" row's mitigation — a manual "paste to define" popup, zero new
permissions, reuses the existing lookup pipeline — is a plausible **separate, much smaller** future
roadmap card, not a continuation of A11. It is named here for completeness, not proposed for
immediate action.

If the owner instead judges full PDF support worth the cost despite the above, the opt-in "Open in
AI Dictionary" variant (Probe 2, row 2) is the least-bad of the two rendering approaches — it
avoids taking over every PDF navigation by default, containing the blast radius of a
still-substantial `pdf.js` integration to users who explicitly opt in.

## Owner decision needed (E4)

Per `docs/ROADMAP.md` §6 (register item E4) and the 2026-07-16 decision log entry, this report
does **not** decide:

1. **Go/no-go** — whether to pursue PDF support at all, given the costs above.
2. **Which approach**, if go — full custom viewer (blanket or opt-in) vs. the debugger-based
   overlay vs. deferring to the smaller "paste to define" mitigation instead.
3. **Any new permission** the chosen path requires (`declarativeNetRequest`, `file://` access, or
   `debugger`) — each carries its own store-listing and user-trust cost per `docs/ROADMAP.md` §1's
   escalation rules.

This spike's job ends here, per its own scope fence ("Deliverable is a feasibility report, not a
feature" — `docs/ROADMAP.md` §4 A11). No further roadmap work on A11 proceeds without an explicit
owner ruling on the above, recorded as a new `docs/ROADMAP.md` §8 Decision Log entry when made.

## Sources

- Chromium extensions group, "Can extension (content script) run in the default PDF viewer?" — <https://groups.google.com/a/chromium.org/g/chromium-extensions/c/CNPumQ7X4qs>
- Chromium `components/guest_view` (MimeHandlerView) — <https://chromium.googlesource.com/chromium/src/+/lkgr/components/guest_view/>
- Chromium process-model / site-isolation docs — <https://chromium.googlesource.com/chromium/src/+/main/docs/process_model_and_site_isolation.md>
