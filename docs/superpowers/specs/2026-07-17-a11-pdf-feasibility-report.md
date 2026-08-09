# A11 — PDF support: discovery-spike feasibility report

Roadmap card: `docs/ROADMAP.md` §4 A11. Design: `docs/superpowers/specs/2026-07-17-a11-pdf-spike-design.md`.
Plan executed: `docs/superpowers/plans/2026-07-17-a11-pdf-spike.md`.

**This report is a recommendation, not a decision.** The actual go/no-go and any new browser
permission are owner-reserved (`docs/ROADMAP.md` §6, register item E4) and are NOT ratified by
this document.

## Executive summary

<!-- filled in Task 3 -->

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
`about:blank` and not an aborted-download state) — but the document title stayed empty. Chrome's
native PDF viewer normally sets the document title to the PDF's filename once it renders, so an
empty title is a second, independent signal (alongside `embedCount: 0`) that the built-in
`MimeHandlerView` PDF viewer never actually attached in this run.

**Reading — an unexpected result, reported honestly, not paraphrased away.** Assertion (a),
`contentScriptRan: true`, is solidly confirmed in both attempts: our content scripts DO execute on
a PDF tab's top-level document, exactly as `<all_urls>` promises — this finding is independent of
the PDF-rendering issue below and stands on its own. Assertions (b)/(c) did **not** confirm what
the plan expected: `embedCount: 0` (not `>= 1`) means Chrome's own PDF viewer never rendered an
`<embed>` in this specific harness run at all. This repo's e2e harness always drives Chromium via
`--headless=new` (`packages/extension-chrome/e2e/fixtures.ts:20`, `E2E_HEADLESS` defaults `true`
per `packages/extension-chrome/playwright.config.ts:7`), and the evidence collected here (empty
title, `embedCount: 0`, reproduced twice against independently-regenerated, structurally-valid
`page.pdf()` fixtures) points at Chromium's built-in PDF-viewer `MimeHandlerView` not attaching for
a direct navigation to an `application/pdf` response in this specific headless mode — a limitation
of the harness/environment this probe ran in, not evidence about PDF rendering in the headed
browser real users actually run. Root-causing that headless gap further (e.g. a `HEADED=1` rerun)
is outside this probe's own ≤ 1 hour time box, already spent generating, running, regenerating, and
diagnosing per the plan's Step 4 guidance — it is recorded here as a limitation of Probe 1's own
method in this environment, not resolved by this report.

Because `embedCount` never reached `>= 1` in either attempt, this specific scripted run could
**not** independently corroborate the "PDF content lives inside an isolated `MimeHandlerView` guest
frame, unreachable by content scripts" mechanism end-to-end the way the plan intended — that
specific mechanism remains grounded here in external Chromium architecture documentation only
(Sources below), the same evidentiary standing this report would have without a scripted check for
that one claim. What the probe DID independently and reproducibly confirm: our content scripts run
on a PDF tab's top document (`contentScriptRan: true`, both attempts); `topDocumentText` was empty
in both attempts too, but in this run that emptiness is confounded with "the PDF viewer never
attached at all" rather than cleanly isolating "the viewer attached and rendered the PDF, but its
text is unreachable from the top document" — the distinction the plan's original assertion set was
designed to prove. A follow-up run with a **headed** Chromium (`HEADED=1`, per
`playwright.config.ts:3`) against the same fixture would be needed to close this specific gap if a
future card needs a definitive scripted confirmation of the guest-frame mechanism itself; that
rerun was not performed here, per this probe's time box and per this report's brief (regenerate
once, record both attempts honestly, do not chase further).

**Correction to the roadmap card's stated mechanism:** `docs/ROADMAP.md` §4 A11 says "Chrome's PDF
viewer does not run content scripts on PDF content" — imprecise, and Probe 1's `contentScriptRan:
true` result (confirmed in both attempts, not confounded by the headless-rendering gap above)
already falsifies it directly: content scripts DO run on a PDF tab's top-level document. The
stronger, guest-frame-isolation half of the mechanism (design spec §1.1) remains grounded in
external Chromium documentation (Sources below) rather than in this specific scripted run, per the
limitation recorded above. The distinction still matters for evaluating fixes in Probe 2: no
`manifest.json` change (wider `matches`, more permissions) can fix a content-script-execution
problem that Probe 1's `contentScriptRan: true` shows does not exist — per Chromium's own
architecture docs, the actual blocker is a same-origin/site-isolation wall between two different
extensions' processes, which no permission on this extension can cross.

## Probe 2 — build-vs-buy: candidate approaches

| Approach                                                    | Mechanism                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | New permissions needed                                                                                                                                                                                                                                                                                       | Rough engineering cost                                                                                                                                                                                                                                                                                                                                | Preserves Chrome's native PDF UX?                                                                                                                                                                            | Risk                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Custom pdf.js viewer page**                               | Bundle `pdf.js`; intercept navigations to PDF URLs (a `declarativeNetRequest` redirect rule matching PDF responses/extensions) to an extension-hosted viewer page that fetches the raw bytes and renders its own selectable text layer, wired to the existing `DomSelectionSource`/lookup pipeline.                                                                                                                                                                                                         | `declarativeNetRequest` (redirect rule); the Chrome-managed "Allow access to file URLs" toggle for local `file://` PDFs (a manifest `file://` intent plus a user-facing per-extension switch — this repo currently declares neither); a widened CSP (`worker-src`/`wasm-unsafe-eval` for `pdf.js`'s worker). | **High** — this is building and maintaining a full PDF reader (page rendering, zoom, print, keyboard nav, text-layer accessibility) inside the extension, not a small addition; matches the card's own Effort L rating.                                                                                                                               | **No, unless fully rebuilt** — toolbar, print, zoom, page thumbnails, and existing accessibility behavior all have to be reimplemented or the replacement regresses a reading surface users already rely on. | **High** — a blanket redirect makes this extension the single point of failure for ALL of a user's PDF reading; a bug here breaks a core browser capability the user did not ask us to take over.                                                                                                            |
| **Custom pdf.js viewer, opt-in ("Open in AI Dictionary")**  | Same rendering approach, but entry point is an explicit user action (toolbar/context-menu item) that opens the PDF in an extension-hosted tab, leaving Chrome's native viewer as the default.                                                                                                                                                                                                                                                                                                               | Same permission needs as above for the viewer page itself, minus the blanket `declarativeNetRequest` redirect rule (no interception of every PDF navigation).                                                                                                                                                | **High** — still a full `pdf.js` integration; the only savings versus the row above is the interception mechanism, not the viewer itself.                                                                                                                                                                                                             | **Yes for the default path** — native viewer stays default; only PDFs the user explicitly opens in our viewer lose native toolbar parity.                                                                    | **Medium** — opt-in scope limits blast radius (a broken viewer only affects users who explicitly chose it), but the ongoing maintenance surface (keeping a bundled PDF renderer current, accessible, and secure) is identical to the row above.                                                              |
| **DevTools/alternative selection APIs (`chrome.debugger`)** | Attach the Chrome DevTools Protocol to the tab (`chrome.debugger` permission) and use protocol-level APIs to read PDF text/selection state, then synthesize an overlay UI positioned over the native viewer.                                                                                                                                                                                                                                                                                                | `debugger` — shows Chrome's own persistent "`<Extension>` is debugging this browser" warning bar on every tab it attaches to, for as long as the tab is open.                                                                                                                                                | **Medium-high** — the DevTools Protocol surface for PDF text extraction is not a stable, documented public contract for this use case (it exists for Chrome's own inspector/printing tooling); expect ongoing breakage as Chrome ships updates, i.e. a support burden roughly comparable to a bespoke integration despite avoiding a `pdf.js` bundle. | **Yes** — the native viewer itself is untouched; only an overlay is added.                                                                                                                                   | **High** — the persistent debugger warning bar is a visible, unavoidable UX regression on every PDF tab (not just ones a user chooses), and Chrome offers no guarantee this internal surface stays stable release to release; an unsupported combination this deep in the platform can break without notice. |
| **"Not worth it" — no PDF-viewer feature in v1**            | Ship nothing. The lowest-cost mitigation available today, if the underlying need (defining a word while reading a PDF) still matters, is a manual "paste to define" entry point — e.g. a toolbar popup with a text field the user pastes a copied word/sentence into, reusing 100% of the existing lookup pipeline with zero new permissions and zero PDF-specific code. This is explicitly a **different, much smaller card**, not part of A11's scope, and is not being proposed for implementation here. | None.                                                                                                                                                                                                                                                                                                        | **Low** (S-effort, if ever pursued as its own card) for the mitigation; **zero** for doing nothing.                                                                                                                                                                                                                                                   | N/A — native viewer untouched, no overlay attempted.                                                                                                                                                         | **Low.**                                                                                                                                                                                                                                                                                                     |

## Recommendation

<!-- filled in Task 3 -->

## Owner decision needed (E4)

<!-- filled in Task 3 -->

## Sources

- Chromium extensions group, "Can extension (content script) run in the default PDF viewer?" — <https://groups.google.com/a/chromium.org/g/chromium-extensions/c/CNPumQ7X4qs>
- Chromium `components/guest_view` (MimeHandlerView) — <https://chromium.googlesource.com/chromium/src/+/lkgr/components/guest_view/>
- Chromium process-model / site-isolation docs — <https://chromium.googlesource.com/chromium/src/+/main/docs/process_model_and_site_isolation.md>
