export const meta = {
  name: 'chrome-e2e-happy-path',
  description: 'Implement the Chrome e2e happy-path suite from the plan, get it all green, open a PR',
  phases: [
    { title: 'Scaffold', detail: 'fixtures.ts + helpers.ts (ungated), build, smoke-test the fixture' },
    { title: 'Author specs', detail: 'one agent per spec file, transcribe from the plan with gating removed' },
    { title: 'Verify & fix', detail: 'build once, run the full suite headful single-worker, fix until green' },
    { title: 'PR', detail: 'commit logical groups, push branch, open PR (only if all green)' },
  ],
}

const PLAN = 'docs/superpowers/plans/2026-06-04-chrome-e2e-coverage.md'
const PKG = 'packages/extension-chrome'

const SPIKE_FACTS = `
VERIFIED SPIKE FACTS (do NOT re-litigate, do NOT add gating):
- Bundled Chromium HEADFUL (headless:false, no channel) runs the FULL content-script→service-worker
  flow on macOS AND in CI (xvfb). The old lookup.spec skip was stale.
- There is NO Tier gating. Do NOT import or call requireRealChromeFlow. Do NOT add test.skip / env flags.
- mockGemini uses context.route (confirmed to intercept the service worker's Gemini fetch). No SW self.fetch stub.
- Run the suite with: cd ${PKG} && bunx playwright test   (no env vars).
- The fixtures.ts in the plan still defines requireRealChromeFlow — OMIT that export and the beforeEach gating;
  keep the worker-scoped context + extensionId fixtures and the per-test chrome.storage.local.clear reset.
`

phase('Scaffold')
const scaffold = await agent(
  `You are implementing a Playwright e2e test harness for an MV3 Chrome extension. Read the plan at ${PLAN}
(Tasks 1 and 2) and the ADDENDUM at its top.

${SPIKE_FACTS}

Do this, in order, from the repo root:
1. Create ${PKG}/e2e/fixtures.ts EXACTLY as Task 1 specifies BUT with the gating removed: keep the worker-scoped
   'context' and 'extensionId' fixtures, the 'export { expect }', and the test.beforeEach that clears
   chrome.storage.local before each test. DELETE the REAL_CHROME_FLOW const and the requireRealChromeFlow function.
2. Create ${PKG}/e2e/helpers.ts EXACTLY as Task 2 specifies (seedSettings, storageDump, mockGemini(context,...),
   gotoFixture, selectWord, openTrigger, GEMINI_GLOB, GEMINI_OK_BODY, SettingsOverrides, MockGeminiOpts).
3. Build the extension: cd ${PKG} && bun run build  (this is one package — allowed).
4. Write a temporary smoke spec ${PKG}/e2e/_fixture-smoke.spec.ts that opens options.html via the fixture and
   asserts extensionId matches /^[a-p]{32}$/ and that storage is empty after the auto-reset (per Task 1 Step 1,
   minus any gating).
5. Run ONLY that smoke spec headful: cd ${PKG} && bunx playwright test e2e/_fixture-smoke.spec.ts --reporter=line
6. Iterate until it passes. Then DELETE the smoke spec.

Scope: only touch files under ${PKG}/e2e and only build/test the extension-chrome package. Do not run other packages.
Report what you created and the smoke result.`,
  { label: 'scaffold-harness', schema: {
    type: 'object', additionalProperties: false,
    required: ['ok', 'summary'],
    properties: {
      ok: { type: 'boolean', description: 'true if fixtures.ts + helpers.ts exist and the fixture smoke test passed' },
      summary: { type: 'string' },
      smokeOutput: { type: 'string' },
    },
  } },
)

if (!scaffold || !scaffold.ok) {
  log(`Scaffold failed — stopping before authoring specs. ${scaffold?.summary ?? 'no result'}`)
  return { stopped: 'scaffold', scaffold }
}
log(`Scaffold OK: ${scaffold.summary}`)

phase('Author specs')
const SPECS = [
  { file: 'settings.spec.ts', task: 'Task 3' },
  { file: 'theme.spec.ts', task: 'Task 4' },
  { file: 'side-panel.spec.ts', task: 'Task 5' },
  { file: 'lookup.spec.ts', task: 'Tasks 6 AND 7 (cache-hit, cache-miss, repeat-from-cache) in ONE file' },
  { file: 'lookup-errors.spec.ts', task: 'Task 8' },
  { file: 'cache-history.spec.ts', task: 'Task 9' },
  { file: 'selection.spec.ts', task: 'Task 10' },
]

const authored = await parallel(SPECS.map((s) => () =>
  agent(
    `Author ONE Playwright e2e spec file. Read the plan at ${PLAN}, specifically ${s.task}, and the ADDENDUM at the top.

${SPIKE_FACTS}

Write ${PKG}/e2e/${s.file} with the EXACT code from ${s.task}, with these mandatory modifications:
- Remove the 'requireRealChromeFlow' import and any requireRealChromeFlow() call line.
- Import from './fixtures' (test, expect) and './helpers' (whatever the spec uses).
- Use mockGemini(context, ...) for any Gemini faking (NOT page.route, NOT a SW stub).
- For lookup.spec.ts: include cache-hit, cache-miss (asserting the route counter incremented), and
  repeat-from-cache (asserting exactly one network call total). Skip the SPIKE test entirely.

DO NOT run any test or browser (resource safety — the verify phase runs everything once, centrally).
DO NOT build. Only WRITE the file. Report the file path and the number of test() blocks you wrote.`,
    { label: `author:${s.file}`, phase: 'Author specs', schema: {
      type: 'object', additionalProperties: false,
      required: ['file', 'testCount'],
      properties: { file: { type: 'string' }, testCount: { type: 'number' }, notes: { type: 'string' } },
    } },
  ),
))
const wrote = authored.filter(Boolean)
log(`Authored ${wrote.length}/${SPECS.length} spec files (${wrote.reduce((n, w) => n + (w.testCount || 0), 0)} tests).`)

phase('Verify & fix')
const verify = await agent(
  `You own the browser for this phase. Get the entire Chrome extension e2e suite GREEN.

${SPIKE_FACTS}

Steps:
1. cd ${PKG} && bun run build   (rebuild dist so specs load the latest bundle).
2. cd ${PKG} && bunx playwright test --reporter=line   (default single worker, headful).
3. If anything fails: debug methodically and FIX THE TEST FILES under ${PKG}/e2e (selectors, timing/waits,
   payload shapes, imports). Re-run. Repeat until all pass or you hit a genuine blocker.
4. Also run: cd ${PKG} && bun run typecheck   and fix any type errors you introduced in the e2e files.

HARD RULES:
- Do NOT make tests pass by skipping them, adding test.skip, gating, or deleting assertions. Tests must
  genuinely pass headful.
- Do NOT modify product source under ${PKG}/src or other packages. If a test reveals a REAL product bug,
  STOP and report it in the result (do not silently change product code).
- Only build/test the extension-chrome package. Never run the full monorepo test suite.
- The known-uncertain specs are theme.spec.ts and side-panel.spec.ts (not previously run) — pay attention there.
  If page→page side-panel delivery does not work, switch the sender to drive via the service worker
  (context.serviceWorkers()[0].evaluate(() => chrome.runtime.sendMessage(...))) per Task 5 Step 3.

Report the final tally and any fixes.`,
  { label: 'verify-and-fix', schema: {
    type: 'object', additionalProperties: false,
    required: ['allGreen', 'passed', 'failed', 'summary'],
    properties: {
      allGreen: { type: 'boolean' },
      passed: { type: 'number' },
      failed: { type: 'number' },
      skipped: { type: 'number' },
      summary: { type: 'string' },
      fixesApplied: { type: 'array', items: { type: 'string' } },
      productBugs: { type: 'array', items: { type: 'string' }, description: 'real product bugs found, if any — NOT fixed' },
      finalOutput: { type: 'string', description: 'the last ~15 lines of the playwright run' },
    },
  } },
)

if (!verify || !verify.allGreen) {
  log(`Suite is NOT green (passed=${verify?.passed}, failed=${verify?.failed}). Skipping PR.`)
  return { stopped: 'verify', verify, authored: wrote }
}
log(`Suite GREEN: ${verify.passed} passed, ${verify.skipped ?? 0} skipped. Proceeding to PR.`)

phase('PR')
const pr = await agent(
  `All Chrome e2e tests are green (${verify.passed} passed). Commit the work and open a PR.

Context: branch is 'e2e-coverage-expansion', base is 'master'. Already-committed: the design spec (549970b).
Uncommitted now: the plan doc (${PLAN}) and all new e2e files under ${PKG}/e2e (fixtures.ts, helpers.ts, and the
spec files), plus possibly package.json scripts / e2e/README.md / root README if you choose to add Task 11 items.

Do this:
1. Stage and commit in logical groups with conventional-commit messages, e.g.:
   - the plan doc
   - test(e2e): harness (fixtures.ts, helpers.ts)
   - test(e2e): happy-path + main-flow specs (the spec files)
   Each commit message body should end with the Co-Authored-By line for Claude.
2. Optionally implement Task 11 (package.json e2e scripts + ${PKG}/e2e/README.md) if quick; not required.
3. Push the branch: git push -u origin e2e-coverage-expansion
4. Open a PR with gh: base master, head e2e-coverage-expansion. Title:
   "test(e2e): Chrome extension happy-path e2e suite". Body must HONESTLY state:
   - what is covered (settings, theme light/dark, side-panel render, lookup cache-hit/miss/repeat, error states,
     cache/history side-effects, selection) and the total test count (${verify.passed} passing),
   - the key finding: the prior 'real flow only runs in CI' skip was STALE — bundled Chromium headful runs the
     full content-script→service-worker flow locally and in CI, so the suite is ungated,
   - Gemini is always faked via context.route; no real network calls,
   - end the body with the '🤖 Generated with Claude Code' line.
5. Return the PR URL.

Only operate in this repo; do not touch other packages' code.`,
  { label: 'commit-and-pr', schema: {
    type: 'object', additionalProperties: false,
    required: ['ok', 'prUrl', 'summary'],
    properties: {
      ok: { type: 'boolean' },
      prUrl: { type: 'string' },
      commits: { type: 'array', items: { type: 'string' } },
      summary: { type: 'string' },
    },
  } },
)

return { scaffold, authored: wrote, verify, pr }
