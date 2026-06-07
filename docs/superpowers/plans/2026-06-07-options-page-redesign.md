# Options Page Redesign Implementation Plan (post-#24 base)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reskin the shared `settings-form` web component onto the winter-morning theme (ribbon, holly brand, candlelit glow, serif title, token palette, dark mode, device footer) with three grouped control sections, and drop Chrome's hand-injected env-key banner in favor of a themed inline notice — while PRESERVING everything PR #24 added (the `setStatus` method, the `#status` line, and the already-wired export-history feature).

**Architecture:** Visual/structural change to one shared web component (`packages/app/src/ui/settings-form.ts`) plus a small edit to Chrome's composition root (`packages/extension-chrome/src/options.ts`). All shadow-DOM IDs and the public contract are preserved, so existing unit + e2e suites stay green. Theme is inherited by importing tokens and referencing `var(--ad-*)` — never hardcoded OKLCH/hex.

**Tech Stack:** TypeScript, native Web Components (Shadow DOM, `adoptedStyleSheets`), Vitest + axe-core (jsdom), Bun, Playwright (Chrome e2e), agent-browser (visual evidence).

**Spec:** `docs/superpowers/specs/2026-06-07-options-page-redesign-design.md`

---

## Key constraints (read before any task)

- **The live base is post-#24.** `settings-form.ts` already has a `setStatus(text, tone)`
  method and a `<p id="status" role="status" aria-live="polite" hidden>` element with
  `#status`/`#status.error` CSS. Export-history is fully wired in
  `packages/app/src/app/history-export.ts` + both shells.
- **PRESERVE, do not recreate:** keep `setStatus` byte-for-byte; re-home `#status` into the
  themed markup with token-based styling. Do NOT create/modify `history-export.ts`, do NOT
  add export-history listeners, do NOT touch any Safari file.
- **Preserve these shadow-DOM IDs:** `#key`, `#reveal`, `#target`, `#tpl`, `#cache`,
  `#history`, `#save`, `#test`, `#clear-cache`, `#clear-history`, `#export`, `#key-help`,
  `#status`.
- **Preserve behavior:** `save` event + `SettingsFormValue`; `value`; `keyFromEnv` lock +
  focus/blur help swap; `collect()` stored-key echo; relayed action events;
  `setStatus(text, tone)`.
- **Single adopted stylesheet:** all CSS in ONE string (`adoptedStyleSheets.length === 1`).
- **axe stays clean** (default + locked). Keep labels associated, heading order h1→h2.
- **No emoji** — inline `HOLLY_SVG` + local `ICON_SHIELD` SVG + text only.
- `#target` keeps `vi` Vietnamese / `es` Spanish.

Run all commands from the worktree root:
`/Users/home/repos/ai-dict/.claude/worktrees/options-page-redesign`

---

## Task 1: Add failing "themed chrome" unit tests

**Files:**

- Modify: `packages/app/test/ui/settings-form.test.ts` (append a new `describe` block at end of file)

- [ ] **Step 1: Write the failing tests**

Append to the end of `packages/app/test/ui/settings-form.test.ts` (the file already
imports `ENV_KEY_NOTICE` and defines `mountForm`):

```ts
describe('<settings-form> themed chrome', () => {
  it('renders the ribbon, holly brand, and device footer', () => {
    const el = mountForm();
    const r = el.shadowRoot!;
    expect(r.querySelector('.ribbon')).not.toBeNull();
    expect(r.querySelector('.brand')!.textContent).toContain('AI Dictionary');
    expect(r.querySelector('.holly')).not.toBeNull();
    expect(r.querySelector('footer')!.textContent).toContain('Stays on your device');
  });

  it('groups controls into Connection, Translation, and Privacy & data sections', () => {
    const el = mountForm();
    const heads = [...el.shadowRoot!.querySelectorAll('.sec .sec-h')].map((h) => h.textContent);
    expect(heads).toEqual(['Connection', 'Translation', 'Privacy & data']);
  });

  it('keeps every required control (incl. #status) inside the redesigned markup', () => {
    const el = mountForm();
    const r = el.shadowRoot!;
    for (const sel of [
      '#key',
      '#reveal',
      '#target',
      '#tpl',
      '#cache',
      '#history',
      '#save',
      '#test',
      '#clear-cache',
      '#clear-history',
      '#export',
      '#key-help',
      '#status',
    ]) {
      expect(r.querySelector(sel), `${sel} must still exist`).not.toBeNull();
    }
  });

  it('uses a single adopted stylesheet', () => {
    const el = mountForm();
    expect(el.shadowRoot!.adoptedStyleSheets.length).toBe(1);
  });

  it('keeps the env notice hidden until keyFromEnv is set', () => {
    const el = mountForm();
    const notice = el.shadowRoot!.querySelector<HTMLElement>('#env-notice')!;
    expect(notice.hidden).toBe(true);
    el.keyFromEnv = true;
    expect(notice.hidden).toBe(false);
    expect(notice.textContent).toBe(ENV_KEY_NOTICE);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run test -- settings-form`
Expected: FAIL — the new `themed chrome` tests fail (`.ribbon`/`.brand`/`.sec`/`#env-notice`
not found). All pre-existing tests in the file (including #24's `setStatus` tests) still PASS.

- [ ] **Step 3: Commit the failing tests**

```bash
git add packages/app/test/ui/settings-form.test.ts
git commit -m "test(app): add failing themed-chrome tests for settings form"
```

---

## Task 2: Reskin the settings-form component (preserving #24)

**Files:**

- Modify: `packages/app/src/ui/settings-form.ts` — replace the imports line, the `CSS` and
  `MARKUP` constants, and the `applyKeyLock` method body. **Leave `setStatus`, `collect`,
  `value`, `relay`, `q`, `connectedCallback`, and all `ENV_KEY_*`/`DEFAULT_KEY_HELP` consts
  unchanged.**

- [ ] **Step 1: Replace the import line and add the ICON_SHIELD constant**

Replace line 1 (`import { adoptStyles } from './styles/adopt';`) with:

```ts
import { adoptStyles } from './styles/adopt';
import { LIGHT_VARS, DARK_VARS, HOLLY_SVG } from './styles/tokens';

// Restated locally to keep this component self-contained — the codebase already
// duplicates this small shield across side-panel-view.ts and lookup-card.ts;
// consolidating all three into tokens.ts is a separate, out-of-scope cleanup.
const ICON_SHIELD =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 1.8l5 2v3.4c0 3-2.1 5.2-5 6.2-2.9-1-5-3.2-5-6.2V3.8l5-2z"/></svg>';
```

- [ ] **Step 2: Replace the `CSS` constant**

Replace the whole `CSS` constant with the following. Note the dark `@media` block also
lightens the primary button (token-based `color-mix`) for WCAG AA, and `#status`/`#status.error`
are re-themed with tokens:

```ts
const CSS = `:host{${LIGHT_VARS};display:block;min-height:100vh;box-sizing:border-box;font:15px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--ad-ink);background:var(--ad-glow),var(--ad-surface);color-scheme:light dark}
@media (prefers-color-scheme:dark){:host{${DARK_VARS}}button.primary{background:color-mix(in oklab,var(--ad-pine) 86%,white)}}
*{box-sizing:border-box}
.ribbon{height:4px;background:linear-gradient(90deg,var(--ad-pine),var(--ad-amber) 52%,var(--ad-cranberry))}
header{display:flex;align-items:center;gap:8px;max-width:640px;margin:0 auto;padding:14px 18px 6px}
.brand{display:inline-flex;align-items:center;gap:8px;font-size:13px;font-weight:700;letter-spacing:.01em;color:var(--ad-pine)}
.holly{width:22px;height:22px;flex:none}
.col{max-width:640px;margin:0 auto;padding:2px 18px 26px}
h1.title{font-family:Georgia,"Times New Roman",serif;font-size:1.8rem;line-height:1.15;letter-spacing:-.01em;margin:.1em 0 .55em;color:var(--ad-ink);display:inline-block;padding-bottom:6px;background:linear-gradient(90deg,var(--ad-pine),var(--ad-cranberry)) left bottom/46px 3px no-repeat}
.sec{border:1px solid var(--ad-line);border-radius:13px;padding:15px 16px;margin:0 0 14px;background:var(--ad-surface-soft)}
.sec-h{margin:0 0 2px;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--ad-ink-soft)}
label{display:block;margin:12px 0 5px;font-weight:600;font-size:13px;color:var(--ad-ink)}
label.check{display:flex;align-items:center;gap:9px;margin:9px 0;font-weight:500;font-size:14px}
label.check input{width:16px;height:16px;flex:none;accent-color:var(--ad-pine)}
input,select,textarea{font:inherit;width:100%;box-sizing:border-box;padding:9px 11px;border:1px solid var(--ad-line);border-radius:10px;background:var(--ad-surface);color:var(--ad-ink)}
input:focus,select:focus,textarea:focus{outline:2px solid var(--ad-amber);outline-offset:1px;border-color:transparent}
textarea{resize:vertical;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px}
.keyrow{display:flex;gap:8px;align-items:stretch}
.keyrow input{flex:1}
input.locked{background:var(--ad-surface-soft);color:var(--ad-ink-soft);cursor:help}
#key-help{margin:6px 0 0;font-size:12px;color:var(--ad-ink-soft)}
.env-notice{margin:10px 0 0;padding:9px 12px;border-left:3px solid var(--ad-amber);background:var(--ad-surface);border-radius:0 8px 8px 0;font-size:13px;line-height:1.5;color:var(--ad-ink)}
.inline-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:11px;padding-top:11px;border-top:1px dashed var(--ad-line)}
button{font:inherit;font-weight:600;font-size:13px;padding:9px 15px;border-radius:10px;cursor:pointer;border:1px solid var(--ad-line);background:var(--ad-surface);color:var(--ad-ink)}
button:hover{background:var(--ad-surface-soft)}
button:focus-visible{outline:2px solid var(--ad-amber);outline-offset:2px}
button.sm{padding:6px 11px;font-size:12px}
button.link{border:none;background:none;color:var(--ad-pine);padding:6px 4px;text-decoration:underline;text-underline-offset:2px}
button.link:hover{background:none;text-decoration:none}
.savebar{display:flex;align-items:center;gap:11px;flex-wrap:wrap;margin-top:2px}
button.primary{background:var(--ad-pine);border-color:transparent;color:var(--ad-surface)}
button.primary:hover{background:var(--ad-pine);filter:brightness(1.06)}
.savebar .muted{font-size:12px;color:var(--ad-ink-soft)}
#status{margin:14px 0 0;padding:9px 12px;border-radius:8px;border-left:3px solid var(--ad-pine);background:var(--ad-surface-soft);color:var(--ad-ink);font-size:13px;font-weight:600}
#status.error{border-left-color:var(--ad-err);color:var(--ad-err)}
footer{display:flex;align-items:center;gap:6px;max-width:640px;margin:0 auto;padding:13px 18px 18px;border-top:1px solid var(--ad-line);font-size:11px;color:var(--ad-ink-soft)}
footer svg{width:13px;height:13px;flex:none}
[hidden]{display:none}`;
```

- [ ] **Step 3: Replace the `MARKUP` constant**

Replace the whole `MARKUP` constant with the following. It keeps `#status` (now inside the
column, after the save bar) and adds `#env-notice` in the Connection section:

```ts
const MARKUP = `<div class="ribbon"></div>
<header><span class="brand">${HOLLY_SVG}<span>AI Dictionary</span></span></header>
<form>
  <div class="col">
    <h1 class="title">Settings</h1>
    <section class="sec" aria-labelledby="sec-conn">
      <h2 class="sec-h" id="sec-conn">Connection</h2>
      <label for="key">Gemini API key</label>
      <div class="keyrow">
        <input id="key" type="password" autocomplete="off" aria-describedby="key-help" />
        <button type="button" id="reveal" aria-label="Reveal API key">Show</button>
      </div>
      <p id="key-help">Stored locally on this device only.</p>
      <p id="env-notice" class="env-notice" hidden></p>
      <div class="inline-actions">
        <button type="button" id="test" class="sm">Test connection</button>
      </div>
    </section>
    <section class="sec" aria-labelledby="sec-trans">
      <h2 class="sec-h" id="sec-trans">Translation</h2>
      <label for="target">Target language</label>
      <select id="target"><option value="vi">Vietnamese</option><option value="es">Spanish</option></select>
      <label for="tpl">Prompt template</label>
      <textarea id="tpl" rows="6"></textarea>
    </section>
    <section class="sec" aria-labelledby="sec-priv">
      <h2 class="sec-h" id="sec-priv">Privacy &amp; data</h2>
      <label class="check"><input type="checkbox" id="cache" /> Cache lookups</label>
      <label class="check"><input type="checkbox" id="history" /> Save history</label>
      <div class="inline-actions">
        <button type="button" id="clear-cache" class="sm">Clear cache</button>
        <button type="button" id="clear-history" class="sm">Clear history</button>
        <button type="button" id="export" class="link">Export history</button>
      </div>
    </section>
    <div class="savebar">
      <button type="submit" id="save" class="primary">Save settings</button>
      <span class="muted">Changes apply after saving</span>
    </div>
    <p id="status" role="status" aria-live="polite" hidden></p>
  </div>
</form>
<footer>${ICON_SHIELD}<span>Stays on your device</span></footer>`;
```

- [ ] **Step 4: Update `applyKeyLock` to drive the inline env notice**

Replace the `applyKeyLock` method body with (adds `#env-notice` handling in both branches;
everything else identical):

```ts
  private applyKeyLock(): void {
    const key = this.q<HTMLInputElement>('#key');
    const reveal = this.q<HTMLButtonElement>('#reveal');
    const help = this.q<HTMLElement>('#key-help');
    const envNotice = this.q<HTMLElement>('#env-notice');
    if (this._keyFromEnv) {
      key.readOnly = true;
      key.value = '';
      key.type = 'text';
      key.placeholder = ENV_KEY_PLACEHOLDER;
      key.classList.add('locked');
      key.setAttribute('aria-readonly', 'true');
      reveal.hidden = true;
      help.textContent = ENV_KEY_HINT;
      envNotice.textContent = ENV_KEY_NOTICE;
      envNotice.hidden = false;
    } else {
      key.readOnly = false;
      key.value = this._storedApiKey;
      key.placeholder = '';
      key.classList.remove('locked');
      key.removeAttribute('aria-readonly');
      reveal.hidden = false;
      help.textContent = DEFAULT_KEY_HELP;
      envNotice.hidden = true;
    }
  }
```

- [ ] **Step 5: Run the full settings-form suite (new + #24 + existing) to verify all pass**

Run: `bun run test -- settings-form`
Expected: PASS — all tests, including the two `axeViolations(...) === []` checks, the four
#24 `setStatus` tests, and the new `themed chrome` block.

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/ui/settings-form.ts
git commit -m "feat(app): reskin settings form onto the winter-morning theme"
```

---

## Task 3: Drop Chrome's hand-injected env banner

**Files:**

- Modify: `packages/extension-chrome/src/options.ts` (imports + the `__GEMINI_KEY_FROM_ENV__`
  block only — leave all of #24's status/export wiring untouched)

- [ ] **Step 1: Remove the now-unused `ENV_KEY_NOTICE` import**

In the top import block, delete the single line `  ENV_KEY_NOTICE,` (keep
`registerSettingsForm`, `DEFAULT_TEMPLATE`, `buildHistoryExport`, and the type imports
`Settings`, `SettingsForm`, `SettingsFormValue`, `WireReply`).

- [ ] **Step 2: Replace the banner-injection block with just the lock toggle**

Replace this block:

```ts
if (__GEMINI_KEY_FROM_ENV__) {
  form.keyFromEnv = true;
  const notice = document.createElement('p');
  notice.textContent = ENV_KEY_NOTICE;
  notice.style.cssText =
    'margin:8px 12px;padding:8px 12px;border-left:3px solid #1a73e8;background:#e8f0fe;font:14px/1.5 system-ui;color:#202124';
  document.body.insertBefore(notice, document.body.firstChild);
}
```

with:

```ts
// When the extension was built with GEMINI_API_KEY in the env, the SW ignores
// the stored key. Lock the key field; the component renders the themed inline
// notice (ENV_KEY_NOTICE) inside its Connection section, so no separate banner.
if (__GEMINI_KEY_FROM_ENV__) {
  form.keyFromEnv = true;
}
```

Also delete the now-stale comment immediately above the block if it mentions "keep a top
banner for prominence" (it is replaced by the comment above).

- [ ] **Step 3: Typecheck and lint the repo**

Run: `bun run typecheck && bun run lint`
Expected: PASS — no unused-import error for `ENV_KEY_NOTICE`, no type errors, no lint errors.

- [ ] **Step 4: Commit**

```bash
git add packages/extension-chrome/src/options.ts
git commit -m "refactor(extension-chrome): drop hand-injected env banner for themed inline notice"
```

---

## Task 4: Full verification, build, and visual evidence

- [ ] **Step 1: Run the whole unit suite**

Run: `bun run test`
Expected: PASS — all suites green.

- [ ] **Step 2: Typecheck, lint, format-check**

Run: `bun run typecheck && bun run lint && bun run format:check`
Expected: PASS. If `format:check` flags touched files, run `bunx prettier --write` on them and
amend the relevant commit.

- [ ] **Step 3: Build the Chrome extension**

Run: `bun run build:chrome`
Expected: PASS — emits `packages/extension-chrome/dist/` incl. `options.html` + `options.js`.

- [ ] **Step 4: Capture before/after visual evidence (agent-browser)**

Load the built `packages/extension-chrome/dist/options.html` and screenshot in BOTH light and
dark (`prefers-color-scheme`). Capture: before-light (from `origin/master`), after-light,
after-dark, and the `keyFromEnv` inline-notice state. While in-browser, confirm the primary
button text/background contrast is ≥ 4.5:1 in dark mode (the `color-mix` lighten).

- [ ] **Step 5: Run the Chrome e2e regression gate**

Run: `bun run e2e:chrome`
Expected: PASS — `settings.spec.ts` AND `options-actions.spec.ts` (the #24 status/export e2e)
pass against the redesigned page. If Chromium cannot launch locally, note it and rely on CI.

---

## Task 5: Open the PR

- [ ] **Step 1: Push the branch and host evidence**

Push the branch. Host screenshots on a throwaway `pr-assets/<slug>` branch and reference them
with same-origin `https://github.com/<owner>/<repo>/raw/<branch>/<path>` URLs (private-repo
rule — never `raw.githubusercontent.com`).

- [ ] **Step 2: Create the PR**

Open a PR to `master` titled `feat(app): redesign the options page onto the winter-morning
theme`. Body: goal; Before/After light+dark + env-notice screenshots; the preserved-contract
note (incl. #24 `setStatus`/export untouched); pine primary-button AA rationale; Safari
out-of-scope follow-up. Confirm CI green, then squash-merge.

---

## Self-Review (completed during planning)

- **Spec coverage:** theme → T2 S2-3; sections → T2 S3 + T1; inline env-notice → T2 S3-4 + T1;
  banner removal → T3; #24 preservation (`setStatus`/`#status`/export) → T1 `#status` assertion
  - "leave unchanged" instruction in T2 + no Safari/no history-export edits; testing/evidence →
    T4; Safari out-of-scope → noted, no task.
- **Placeholder scan:** none — every code step shows full code; every run step shows command +
  expected result.
- **Identifier consistency:** `#status`, `#env-notice`, `.sec`/`.sec-h`/`.brand`/`.ribbon`/
  `.holly`/`footer`, `ICON_SHIELD`, `ENV_KEY_NOTICE`/`ENV_KEY_HINT`/`ENV_KEY_PLACEHOLDER`/
  `DEFAULT_KEY_HELP` used consistently. Section heading texts match between T1 test and T2 markup.
