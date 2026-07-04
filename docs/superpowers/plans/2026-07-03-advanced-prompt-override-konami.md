# Advanced Prompt Override (#62) + Konami Full-Prompt Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-introduce the power-user full-prompt-envelope override (GitHub issue #62) as an "Advanced" disclosure in settings, and add a hidden "Developer mode" panel on the settings page — unlocked by the Konami code (↑↑↓↓←→←→BA) — that shows the exact assembled prompt sent to the provider in both basic and advanced modes.

**Architecture:** `buildPrompt` gains an optional `envelope` param (defaults to the code-owned `PROMPT_ENVELOPE`); `promptEnvelope` rides the exact same path as `outputFormat` (Settings → PublicSettings → LookupRequest → clients). Legacy stored `promptTemplate` values are resolved to the new envelope by a pure read-time function (no write migration → idempotent by construction). The Konami listener + dev panel live entirely inside the `settings-form` web component.

**Tech Stack:** TypeScript strict, zod v4 wire schemas, Web Components (shadow DOM, `--ad-*` tokens), vitest, Playwright e2e harness.

## Global Constraints

- Worktree: `/Users/home/repos/ai-dict/.claude/worktrees/advanced-prompt-konami` (branch `feat/advanced-prompt-konami`).
- **PRECONDITION:** execute ONLY after PR `feat/anthropic-provider-pool` is squash-merged. First action: `git fetch origin && git reset --hard origin/master` on this branch (it has no unique commits yet besides this plan — re-commit the plan file after the reset if needed), then `bun install`. This plan assumes 3 providers (gemini/openai/anthropic) exist.
- `.c3/` is CLI-only: `c3() { C3X_MODE=agent bash /Users/home/.claude/skills/c3/bin/c3x.sh "$@"; }` run inside the worktree.
- rule-domain-purity: `packages/app/src/domain/*` imports nothing outside domain.
- rule-sanitize-model-output (S4): the dev panel renders prompt text via `textContent` into a `<pre>` — never `innerHTML`.
- rule-api-key-isolation (S1): no keys anywhere near the dev panel or `PublicSettings`.
- rule-gate-runtime-messages (S3): wire schemas stay `z.strictObject`; keep the `AssertEqual` drift guard green.
- UI: tokens only (`--ad-*`/`--adp-*`); respect `prefers-reduced-motion`.
- Commits: conventional, NO Co-Authored-By. Never `--no-verify`.
- Gates before PR: `bun run lint && bun run format:check && bun run typecheck && bun run test && bun run build:chrome && bun run e2e:chrome`.
- Issue #62 scope guard: the "Also worth revisiting" items ({title} user toggle, PII on {context}) are OUT of scope — note them as follow-ups in the PR body.

---

### Task 0: Sync branch, read prior ADR, create ADR, BEFORE evidence

- [ ] **Step 1:** Reset branch onto merged master (see PRECONDITION), `bun install`.
- [ ] **Step 2:** `gh issue view 62` and `c3 read adr-20260615-card-format-prompt-split --full` — the prior ADR's Migration section defines how legacy `promptTemplate` was left ("currently ignored"). Also run `git log --oneline -- packages/app/src/domain/default-template.ts` and `git show <commit-before-split>:packages/app/src/domain/default-template.ts` to capture the OLD full default template string(s) (pre-split `DEFAULT_TEMPLATE`, and the issue-#50 template if distinct) — Task 2 embeds them verbatim.
- [ ] **Step 3: BEFORE evidence** — `bun run build:chrome`; via the e2e harness screenshot the options/settings page to `/tmp/evidence-b/before-settings.png` (temp spec, not committed).
- [ ] **Step 4: ADR** — `c3 schema adr` (read REJECT IF), then `c3 add adr advanced-prompt-override-and-viewer` covering: context (envelope/card-format split deferred the override; issue #62), decision (optional `envelope` param on `buildPrompt`; `promptEnvelope` rides the `outputFormat` path; read-time legacy resolution, no write migration; Konami-gated dev panel in settings-form), alternatives (write-once storage migration rejected: read-time pure resolution is idempotent and testable; separate dev page rejected: settings-form already owns the data), affected entities (c3-101, c3-103, c3-110, c3-111, c3-112, c3-113, c3-114, c3-117, c3-212, c3-312). `c3 set <id> status accepted`; `c3 check` passes.
- [ ] **Step 5: Commit** plan file (if re-added) + `.c3` ADR: `git add -A && git commit -m "docs(adr): accept advanced prompt override + konami viewer work order"`

### Task 1: Domain — `buildPrompt` envelope override

**Files:** Modify `packages/app/src/domain/prompt-template.ts`; Test `packages/app/test/prompt-template.test.ts`

**Interfaces produced:** `buildPrompt(outputFormat: string, vars: TemplateVars, envelope?: string): string` (all later tasks call it this way).

- [ ] **Step 1: Failing tests** — append to `prompt-template.test.ts`:

```ts
describe('buildPrompt with a custom envelope (advanced override)', () => {
  const vars = { word: 'w', context: 'c', target_lang: 'vi' };
  it('uses the custom envelope and still inserts {output_format}', () => {
    const out = buildPrompt('FMT', vars, 'ENV {word} >>{output_format}<<');
    expect(out).toBe('ENV w >>FMT<<');
  });
  it('a custom envelope without {output_format} is the complete prompt (outputFormat unused)', () => {
    const out = buildPrompt('FMT', vars, 'Only {word} in {target_lang}');
    expect(out).toBe('Only w in vi');
    expect(out).not.toContain('FMT');
  });
  it('empty/blank envelope falls back to the default envelope', () => {
    expect(buildPrompt('FMT', vars, '')).toBe(buildPrompt('FMT', vars));
    expect(buildPrompt('FMT', vars, '   ')).toBe(buildPrompt('FMT', vars));
  });
  it('redactPII still masks the title with a custom envelope', () => {
    const out = buildPrompt('F', { ...vars, title: 'mail me a@b.com' }, 'T:{title}');
    expect(out).toBe('T:mail me [redact]');
  });
});
```

(Verify the exact `[redact]` mask token against `packages/app/src/domain/pii.ts` / `pii.test.ts` before finalizing the assertion.)

- [ ] **Step 2:** Run `bun run test packages/app/test/prompt-template.test.ts` → FAIL.
- [ ] **Step 3: Implement** — replace `buildPrompt` (keep `renderTemplate` untouched) and delete the `TODO(advanced-prompt)` block from its doc comment, replacing it with the override semantics:

```ts
export function buildPrompt(outputFormat: string, vars: TemplateVars, envelope?: string): string {
  const env = envelope !== undefined && envelope.trim() !== '' ? envelope : PROMPT_ENVELOPE;
  const composed = env.includes('{output_format}')
    ? env.replace('{output_format}', outputFormat)
    : env;
  return renderTemplate(composed, { ...vars, title: redactPII(vars.title ?? '') });
}
```

- [ ] **Step 4:** Suite PASS. **Step 5: Commit** `git commit -am "feat(domain): buildPrompt accepts a full-envelope override (advanced prompt, #62)"`

### Task 2: Legacy `promptTemplate` resolution (read-time, pure)

**Files:** Create `packages/app/src/domain/legacy-templates.ts`; Modify `packages/app/src/index.ts` (export); Test create `packages/app/test/legacy-templates.test.ts`

**Interfaces produced:** `resolvePromptEnvelope(s: { promptEnvelope?: string; promptTemplate?: string }): string`

**Design (locked):** no write migration. Every settings read resolves the effective envelope: an explicit `promptEnvelope` wins; else a legacy CUSTOM `promptTemplate` (non-empty, differing from every shipped historical default) becomes the envelope verbatim — a legacy template contains no `{output_format}` slot, so per Task 1 it acts as the complete prompt, restoring the power user's exact old behavior; else `''` (= built-in envelope).

- [ ] **Step 1: Failing tests:**

```ts
import { resolvePromptEnvelope, LEGACY_DEFAULT_TEMPLATES } from '../src/domain/legacy-templates';

describe('resolvePromptEnvelope', () => {
  it('explicit promptEnvelope wins over legacy', () => {
    expect(resolvePromptEnvelope({ promptEnvelope: 'E', promptTemplate: 'L' })).toBe('E');
  });
  it('legacy custom template becomes the envelope', () => {
    expect(resolvePromptEnvelope({ promptTemplate: 'my custom {word} prompt' })).toBe(
      'my custom {word} prompt',
    );
  });
  it('legacy value equal to a shipped default is ignored', () => {
    for (const d of LEGACY_DEFAULT_TEMPLATES)
      expect(resolvePromptEnvelope({ promptTemplate: d })).toBe('');
    expect(resolvePromptEnvelope({ promptTemplate: `  ${LEGACY_DEFAULT_TEMPLATES[0]}\n` })).toBe(
      '',
    );
  });
  it('absent/empty inputs resolve to empty (built-in envelope)', () => {
    expect(resolvePromptEnvelope({})).toBe('');
    expect(resolvePromptEnvelope({ promptTemplate: '   ' })).toBe('');
  });
});
```

- [ ] **Step 2:** FAIL. **Step 3: Implement** `legacy-templates.ts` (domain-pure, zero imports):

```ts
/** Every default prompt template EVER shipped while the single-field `promptTemplate`
 *  setting existed. A stored value equal to one of these (modulo surrounding whitespace)
 *  means "the user never customized" — it must NOT be promoted to an envelope override.
 *  Sources: `git show <pre-split-commit>:packages/app/src/domain/default-template.ts`
 *  (paste each historical DEFAULT_TEMPLATE string verbatim below). */
export const LEGACY_DEFAULT_TEMPLATES: readonly string[] = [
  /* paste historical default #1 here (pre-split DEFAULT_TEMPLATE) */
  /* paste historical default #2 here (issue-#50 template) — only if it differs */
];

export function resolvePromptEnvelope(s: {
  promptEnvelope?: string;
  promptTemplate?: string;
}): string {
  if (s.promptEnvelope !== undefined && s.promptEnvelope.trim() !== '') return s.promptEnvelope;
  const legacy = s.promptTemplate?.trim();
  if (legacy === undefined || legacy === '') return '';
  if (LEGACY_DEFAULT_TEMPLATES.some((d) => d.trim() === legacy)) return '';
  return s.promptTemplate as string;
}
```

Fill `LEGACY_DEFAULT_TEMPLATES` with the REAL strings from Task 0 Step 2's `git show` (these are historical constants — copy exactly, including the `{word}`/`{context}` placeholders). Export both names from `packages/app/src/index.ts` if it keeps explicit export lists.

- [ ] **Step 4:** PASS. **Step 5: Commit** `git commit -am "feat(domain): read-time resolution of legacy promptTemplate into the envelope override"`

### Task 3: Plumb `promptEnvelope` end-to-end (types → wire → stores → clients → router)

**Files:**

- Modify: `packages/app/src/domain/types.ts`, `packages/app/src/wire.ts`, `packages/app/src/domain/workflow.ts`, `packages/app/src/app/gemini-lookup-client.ts`, `packages/app/src/app/openai-lookup-client.ts`, `packages/app/src/app/anthropic-lookup-client.ts`, `packages/app/src/app/router.ts` (connection.test), `packages/extension-chrome/src/adapters/chrome-storage-store.ts`, `packages/extension-safari/src/adapters/safari-storage-store.ts`, both `sw.ts` defaults, both `options.ts` DEFAULTS
- Tests: `packages/app/test/wire-schema.test.ts`, the three client suites, `packages/app/test/workflow.test.ts`, `packages/app/test/app/router.test.ts`

**Pattern:** `promptEnvelope` mirrors `outputFormat` at every hop. `''` means "use built-in".

- [ ] **Step 1: Failing tests:**
  - wire: `PublicSettings` parse with `promptEnvelope: ''` succeeds and without it fails (required, like `outputFormat`); lookup `req` accepts `promptEnvelope: 'x'`.
  - each client suite: capture the outbound request body and assert the prompt equals `buildPrompt(req.outputFormat, vars, req.promptEnvelope)` for a req with a custom envelope containing a marker string (e.g. envelope `'CUSTOM {word}'` → body prompt `'CUSTOM bank'`).
  - workflow: the built `req` carries `promptEnvelope` from settings.
  - router: `connection.test` passes `promptEnvelope: s.promptEnvelope` into the client req.
- [ ] **Step 2:** FAIL. **Step 3: Implement:**
  - `types.ts`: `PublicSettings` += `promptEnvelope: string;` (doc: `''` = built-in envelope; resolved from legacy `promptTemplate` at read time); `Settings` inherits it via `extends PublicSettings`; `LookupRequest` += `promptEnvelope: string;`.
  - `wire.ts`: `PublicSettingsSchema` += `promptEnvelope: z.string()`; `LookupRequestSchema` += `promptEnvelope: z.string()`. Drift guard stays `[true,…]`.
  - Storage stores (both): `get()` returns `promptEnvelope: resolvePromptEnvelope(s ?? {})` (import from `@ai-dict/app`); `defaults()` += `promptEnvelope: ''`. NOTE: the stored legacy field is read as `(s as { promptTemplate?: string })` — `Settings` no longer declares it; cast locally with a comment.
  - `workflow.ts`: `req` gains `promptEnvelope: settings.promptEnvelope`.
  - All three clients: `buildPrompt(req.outputFormat, { word: …, context: …, target_lang: …, url: …, title: … }, req.promptEnvelope)` (Task 1 treats `''` as default — no conditional needed).
  - `router.ts` `handleConnectionTest`: add `promptEnvelope: s.promptEnvelope` to the inline req.
  - Both `sw.ts` fallback settings objects and both `options.ts` `DEFAULTS` += `promptEnvelope: ''`.
  - e2e `helpers.ts` `seedSettings` defaults += `promptEnvelope: ''` (and `SettingsOverrides` += `promptEnvelope?: string`).
- [ ] **Step 4:** Full `bun run test` + `bun run typecheck` PASS. **Step 5: Commit** `git commit -am "feat: promptEnvelope rides the outputFormat path end-to-end (#62)"`

### Task 4: Settings UI — Advanced disclosure

**Files:** Modify `packages/app/src/ui/settings-form.ts`, both `options.ts` `toFormValue()`; Test the settings-form UI suite (`packages/app/test/ui/`).

- [ ] **Step 1: Failing tests:** setting `value` with `promptEnvelope: 'MY ENV'` shows the Advanced textarea containing `MY ENV`; with `promptEnvelope: ''` the textarea shows the REAL default envelope text (prefill-from-reality) but `value.promptEnvelope` still reads `''` until the user edits; after editing, `value.promptEnvelope` returns the edited text; the Reset button returns `value.promptEnvelope` to `''` and re-prefills the textarea with the default.
- [ ] **Step 2:** FAIL. **Step 3: Implement** (additive section — do not reorder existing markup):
  - `SettingsFormValue` += `promptEnvelope: string;`.
  - New collapsed `<details class="advanced">` section appended after the card-format block: `<summary>Advanced</summary>`, helper copy (`Full prompt envelope — placeholders: {word} {context} {target_lang} {source_lang} {title} {output_format}. Editing this takes over the built-in safety constraints.`), `<textarea id="envelope" rows="10" spellcheck="false">`, `<button type="button" id="envelope-reset">Reset to default</button>`, status hint reusing `.seg-help` styling class conventions.
  - Track `_envelopeEdited: boolean` — prefill semantics: when incoming `value.promptEnvelope === ''`, set textarea to `PROMPT_ENVELOPE` (import from `../index`) and `_envelopeEdited = false`; on textarea `input`, `_envelopeEdited = true`; getter returns `_envelopeEdited || incoming was non-empty ? textarea.value : ''`. Reset button: textarea ← `PROMPT_ENVELOPE`, `_envelopeEdited = false`, `setStatus('Envelope reset — Save settings to apply.')` (mirror the existing card-format restore wording at ~line 360).
  - Simplification allowed: if the suite's existing card-format restore pattern stores a sentinel instead, mirror THAT pattern — consistency beats novelty.
  - `<details>`/`<summary>` styling: token-based (border `var(--ad-line)`, summary font `var(--adp-text-sm)`, focus ring `var(--ad-accent)`).
  - Both `options.ts` `toFormValue()` += `promptEnvelope: s.promptEnvelope,`.
- [ ] **Step 4:** UI suite + typecheck PASS. **Step 5: Commit** `git commit -am "feat(ui): Advanced disclosure edits the full prompt envelope (#62)"`

### Task 5: Konami code → Developer mode panel

**Files:** Modify `packages/app/src/ui/settings-form.ts`; Test the settings-form UI suite.

**Design (locked):**

- Sequence on `e.code`: `['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','KeyB','KeyA']`.
- `window.addEventListener('keydown', this._onKonamiKey)` in `connectedCallback`; removed in `disconnectedCallback`.
- Ignore events whose `composedPath()[0]` (or `e.target`) is an `<input>`, `<textarea>`, or `<select>` — typing "ba" in the envelope editor must not advance the sequence. No `preventDefault` ever.
- Mismatch resets progress (to 1 if the mismatched key IS the first key, else 0). Unlock state is session-only (`_devUnlocked = true`), never persisted.
- Panel (`<section id="devpanel" hidden>` after the Advanced section): heading `Developer mode`, a mode line `Basic — default envelope` / `Advanced — custom envelope`, and `<pre id="devprompt">` filled via `textContent` with:

```ts
buildPrompt(
  currentOutputFormat,
  {
    word: 'serendipity',
    context: 'Finding that café was pure serendipity.',
    target_lang: currentTargetLang,
    title: 'Reading list — contact john@example.com', // demonstrates PII redaction live
  },
  currentEnvelopeOverride /* '' when basic */,
);
```

where the three `current*` values come from the same fields the `value` getter reads. Re-render the panel on every `input` of the card-format textarea and the envelope textarea (and on unlock).

- Unlock flourish: the panel gets class `unlocked` applying `transition: opacity var(--adp-dur-fast) var(--adp-ease)` from 0→1; wrapped in `@media (prefers-reduced-motion: reduce){ transition: none }`. Set `setStatus('Developer mode unlocked')`.
- `<pre>` styling: `font-family: var(--adp-font-mono, monospace); font-size: var(--adp-text-2xs); background: var(--ad-surface-raised); border: 1px solid var(--ad-line); border-radius: var(--adp-radius-control); padding: 10px; white-space: pre-wrap; overflow-wrap: anywhere;`.

- [ ] **Step 1: Failing tests** (jsdom `KeyboardEvent`s on `window`): (1) full sequence unlocks — `#devpanel` loses `hidden`, `#devprompt` text contains `serendipity` and `[redact]` and the default-envelope constraint line (e.g. `Keep the response under 200 words.`); (2) wrong key mid-sequence resets (sequence with one bad key then the full correct sequence still unlocks); (3) keys typed with an `<input>`/`<textarea>` target do NOT advance (dispatch on the envelope textarea; panel stays hidden); (4) with a custom envelope set, mode line reads `Advanced — custom envelope` and `#devprompt` reflects it; editing the envelope textarea live-updates `#devprompt`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement per the locked design. **Step 4:** Suite PASS. **Step 5: Commit** `git commit -am "feat(ui): Konami-gated Developer mode reveals the exact assembled prompt"`

### Task 6: e2e — Konami unlock, advanced override reaches the provider

**Files:** Create `packages/extension-chrome/e2e/advanced-prompt.spec.ts`; Reference `options-actions.spec.ts` / `settings.spec.ts` for how the options page is opened in the harness (extension id from fixtures).

- [ ] **Step 1: Spec cases:**
  1. _Konami unlocks the dev panel_: open options page (settings mounted — seed a key first via `seedSettings` so onboarding is skipped; note `seedSettings` writes storage from a page context — follow the existing options-page specs' seeding order), `page.keyboard.press` the 10-key sequence (`ArrowUp` ×2, `ArrowDown` ×2, `ArrowLeft`, `ArrowRight`, `ArrowLeft`, `ArrowRight`, `b`, `a` — click the page body first so no input has focus), expect `Developer mode` visible and the prompt `<pre>` to contain `serendipity` and `[redact]`.
  2. _Advanced envelope round-trips to the provider_: seed `{ promptEnvelope: 'CUSTOM ENVELOPE {word}' }` + gemini key; `mockGemini` capturing the request body (extend the mock opts with an optional `onRequest?: (postData: string) => void` callback in `helpers.ts` — additive change); run the canonical lookup; assert the captured Gemini request body contains `CUSTOM ENVELOPE bank` and does NOT contain the built-in constraint line.
  3. _Editing the envelope in settings persists_: open options, expand Advanced (`click('summary')` inside the form's shadow — use the harness's existing shadow-piercing locators), type a marker, Save, `storageDump` shows `settings.promptEnvelope` containing the marker.
- [ ] **Step 2:** `bun run build:chrome && bun run e2e:chrome` → green (full suite).
- [ ] **Step 3: Commit** `git commit -am "test(e2e): konami dev panel + advanced envelope round-trip"`

### Task 7: C3 docs, AFTER evidence, PR (Closes #62)

- [ ] **Step 1: C3** — update via CLI: c3-113 (buildPrompt envelope param + legacy resolution + `legacy-templates.ts` in Bundled/Purpose), c3-101 (promptEnvelope fields), c3-103 (wire additions), c3-110/c3-111 (req/connection.test plumbing), c3-112 (read-time legacy resolution note if persistence-policies documents settings reads), c3-114 (clients pass the envelope), c3-117 (Advanced section + dev panel), c3-212/c3-312 (options mapping). ADR Parent Delta filled; `c3 set <adr-id> status implemented`; `c3 check` → 0 errors.
- [ ] **Step 2: AFTER evidence** to `/tmp/evidence-b/`: `after-advanced-open.png` (disclosure expanded), `after-devpanel.png` (unlocked panel with prompt + `[redact]` visible), plus a short video of the Konami unlock (recordVideo pattern from `media-demos.spec.ts`) saved as `konami-unlock.webm`.
- [ ] **Step 3: Host evidence** on branch `pr-assets/advanced-prompt-konami` (orphan; never on the feature branch); embed via `https://github.com/<owner>/<repo>/raw/pr-assets/advanced-prompt-konami/<file>` (owner/repo via `gh repo view --json nameWithOwner`). NEVER raw.githubusercontent.com.
- [ ] **Step 4: Final gates** — `bun run lint && bun run format:check && bun run typecheck && bun run test && bun run build:chrome && bun run build:safari && bun run e2e:chrome` all green.
- [ ] **Step 5: PR** — push branch; `gh pr create` to master with: summary; the shipped migration decision (read-time resolution, no write migration, shipped-default detection via `LEGACY_DEFAULT_TEMPLATES`); `Closes #62`; out-of-scope note ({title} toggle, {context} PII → follow-ups); Before/After evidence; test plan. Do NOT merge.
