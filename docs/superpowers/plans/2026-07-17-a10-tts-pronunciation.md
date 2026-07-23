# A10 TTS Pronunciation Implementation Plan

> **For agentic workers:** implement task-by-task, TDD (red → green → commit) per task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the lookup card grows a speaker button next to the headword that speaks the word aloud
(never the definition) via the browser's native `speechSynthesis` API — zero API calls, zero cloud
TTS, off entirely on machines with no matching local voice.

**Architecture:** the entire card lives in the portable UI layer,
`packages/app/src/ui/lookup-card.ts` (`c3-117 ui-components`) — a new `.speak-btn` node rendered as
a top-level light-DOM sibling of the headword `<h2>`, plus one existing-icon-set addition in
`packages/app/src/ui/styles/tokens.ts`, plus one defensive line in
`packages/app/src/app/inline-bottom-sheet-renderer.ts`'s `close()`. **Zero changes** to
`packages/app/src/wire.ts`, `packages/app/src/app/router.ts`, `packages/app/src/ports.ts`, or any
`content.ts`/`sw.ts`/`manifest.json` in either extension package — `speechSynthesis` is a standard
`Window` API needing no `chrome.*` relay, no wire message, and no permission. Both
`InlineBottomSheetRenderer` (in-page card, both browsers) and `side-panel-view.ts` (Chrome side
panel) call the same shared `renderCardState`, so the feature ships to every surface for free. Full
design rationale, including the "no cloud TTS" `localService` filter and the world-boundary reason
e2e cannot assert on voice-driven visibility:
`docs/superpowers/specs/2026-07-17-a10-tts-pronunciation-design.md`.

**Tech Stack:** TypeScript, Vitest + happy-dom (unit), Playwright (e2e).

## Global Constraints

- Implementer: dispatch each implementation/fix task to the `hunter` subagent — never a generic
  implementer.
- **Do not touch `packages/app/src/wire.ts`, `packages/app/src/app/router.ts`,
  `packages/app/src/ports.ts`, `packages/app/src/domain/types.ts`, or any `content.ts`/`sw.ts` in
  either extension package.** The design spec's §2.4 pins that TTS needs no `chrome.*` call and
  therefore no wire message, no router case, no new port, and no composition-root wiring. If a task
  in this plan seems to need any of those, stop — that means the "speechSynthesis is a plain Web
  API, call it directly" assumption broke somewhere, and the plan needs re-grounding, not an ad hoc
  wire/router edit.
- **Every voice lookup filters to `localService === true` first** (design spec §2.2) — this is the
  mechanism that holds the roadmap's "100% local" / "No cloud TTS" fence. Never relax this filter to
  "any voice matching the language" even if it would make a test's voice fixture pass more easily.
- **Speaks the word only** — `new SpeechSynthesisUtterance(word)` takes the bare `word` argument
  only; never `state.safeHtml` or any definition text.
- **No autoplay** — `speechSynthesis.speak()` is called from exactly one place: the button's
  `click` listener. Every other touch point (`renderCardState` on every state transition,
  `InlineBottomSheetRenderer.close()`) only ever calls `.cancel()`, never `.speak()`.
- UI additions read only `--ad-*`/`--adp-*` design tokens (no hard-coded colors); the new
  `.speak-btn` reuses the same box-decoration pattern as `.save-btn`/`.status-btn` in
  `CARD_DOC_CSS`, including the `prefers-reduced-motion` transition neutralizer.
- `bun run lint` and `bun run format:check` clean before every commit.
- Every task must leave `cd packages/app && bun run typecheck` green (this plan touches only
  `packages/app`; no extension-package typecheck is affected).
- The e2e build must clear any ambient `GEMINI_API_KEY` (`GEMINI_API_KEY= bun run build:chrome`) —
  unrelated to this card's own logic, but required so onboarding doesn't silently skip and break the
  fixture flow Task 3's spec depends on (`selectWord`/`openTrigger` need a real lookup to succeed
  first).
- Commit subject convention for every task in this plan: `[A10TtsPronunciation] feat: <task summary> (A10)`.
- Branch: `feature/A10TtsPronunciation`, created fresh under `.claude/worktrees/` per this worktree's
  `CLAUDE.md` convention.

---

### Task 1: speak button — icon, render logic, card wiring, styling

**Files:**

- Modify: `packages/app/src/ui/styles/tokens.ts`
- Modify: `packages/app/src/ui/lookup-card.ts`
- Modify: `packages/app/test/ui/lookup-card.test.ts`

**Interfaces:**

```ts
// tokens.ts — new export, same shape as the existing icon set:
export const ICON_SPEAKER: string;

// lookup-card.ts — new module-private functions (not exported; consumed only inside
// renderCardState, matching the existing renderSaveRow/renderNudgeRow precedent):
function pickLocalEnglishVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | undefined;
function renderSpeakButton(word: string): HTMLButtonElement | null;
```

- [ ] **Step 1: Write the failing tests.** Add the following import to
      `packages/app/test/ui/lookup-card.test.ts`'s existing import line (it currently reads
      `import { describe, it, expect, vi, beforeAll } from 'vitest';` — `vi` is already imported, no
      change needed there). Append this new `describe` block **after** the file's existing final
      `describe`/closing content (at the end of the file, top level, as a sibling of `describe('<lookup-card>', ...)`):

```ts
describe('A10 speak button (TTS pronunciation)', () => {
  class FakeSpeechSynthesis extends EventTarget {
    cancel = vi.fn();
    speak = vi.fn();
    private _voices: SpeechSynthesisVoice[];
    constructor(voices: SpeechSynthesisVoice[] = []) {
      super();
      this._voices = voices;
    }
    getVoices(): SpeechSynthesisVoice[] {
      return this._voices;
    }
    setVoices(voices: SpeechSynthesisVoice[]): void {
      this._voices = voices;
      this.dispatchEvent(new Event('voiceschanged'));
    }
  }

  class FakeUtterance {
    voice: SpeechSynthesisVoice | null = null;
    lang = '';
    constructor(public text: string) {}
  }

  const LOCAL_EN_US = {
    lang: 'en-US',
    localService: true,
    default: true,
    name: 'Local US English',
    voiceURI: 'local-en-US',
  } as SpeechSynthesisVoice;

  const REMOTE_EN_GB = {
    lang: 'en-GB',
    localService: false,
    default: false,
    name: 'Remote UK English',
    voiceURI: 'remote-en-GB',
  } as SpeechSynthesisVoice;

  it('omits the speak button entirely when SpeechSynthesis is unsupported (A10)', () => {
    vi.stubGlobal('speechSynthesis', undefined);
    const el = mountCard();
    el.state = { kind: 'result', word: 'bank', target: 'vi', safeHtml: safe('<p>x</p>') };
    expect(el.querySelector('.speak-btn')).toBeNull();
    vi.unstubAllGlobals();
  });

  it('shows the speak button immediately when a local English voice is already installed (A10)', () => {
    vi.stubGlobal('speechSynthesis', new FakeSpeechSynthesis([LOCAL_EN_US]));
    const el = mountCard();
    el.state = { kind: 'result', word: 'bank', target: 'vi', safeHtml: safe('<p>x</p>') };
    expect(el.querySelector<HTMLButtonElement>('.speak-btn')!.hidden).toBe(false);
    vi.unstubAllGlobals();
  });

  it('renders the speak button hidden, then reveals it once voiceschanged reports a local English voice (A10)', () => {
    const synth = new FakeSpeechSynthesis([]);
    vi.stubGlobal('speechSynthesis', synth);
    const el = mountCard();
    el.state = { kind: 'result', word: 'bank', target: 'vi', safeHtml: safe('<p>x</p>') };
    const btn = el.querySelector<HTMLButtonElement>('.speak-btn')!;
    expect(btn.hidden).toBe(true);
    synth.setVoices([LOCAL_EN_US]);
    expect(btn.hidden).toBe(false);
    vi.unstubAllGlobals();
  });

  it('stays hidden when only a remote (non-local) voice is available — never risks a cloud TTS call (A10)', () => {
    const synth = new FakeSpeechSynthesis([REMOTE_EN_GB]);
    vi.stubGlobal('speechSynthesis', synth);
    const el = mountCard();
    el.state = { kind: 'result', word: 'bank', target: 'vi', safeHtml: safe('<p>x</p>') };
    const btn = el.querySelector<HTMLButtonElement>('.speak-btn')!;
    expect(btn.hidden).toBe(true);
    synth.setVoices([REMOTE_EN_GB]); // voiceschanged fires again, still zero local voices
    expect(btn.hidden).toBe(true);
    vi.unstubAllGlobals();
  });

  it('clicking the speak button cancels any in-flight utterance, then speaks the word ONLY with a local English voice (A10)', () => {
    vi.stubGlobal('speechSynthesis', new FakeSpeechSynthesis([LOCAL_EN_US]));
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
    const el = mountCard();
    el.state = {
      kind: 'result',
      word: 'bank',
      target: 'vi',
      safeHtml: safe('<h2>IPA</h2><p>/bæŋk/</p><p>a financial institution</p>'),
    };
    const synth = globalThis.speechSynthesis as unknown as FakeSpeechSynthesis;
    el.querySelector<HTMLButtonElement>('.speak-btn')!.click();
    expect(synth.cancel).toHaveBeenCalledTimes(1);
    expect(synth.speak).toHaveBeenCalledTimes(1);
    const utter = synth.speak.mock.calls[0]![0] as unknown as FakeUtterance;
    expect(utter.text).toBe('bank'); // the word only — never the definition body
    expect(utter.voice).toBe(LOCAL_EN_US);
    expect(utter.lang).toBe('en-US');
    vi.unstubAllGlobals();
  });

  it('a click makes zero speak() calls if no local voice remains at click time (never guesses) (A10)', () => {
    const synth = new FakeSpeechSynthesis([LOCAL_EN_US]);
    vi.stubGlobal('speechSynthesis', synth);
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
    const el = mountCard();
    el.state = { kind: 'result', word: 'bank', target: 'vi', safeHtml: safe('<p>x</p>') };
    synth.setVoices([]); // degrade after render, before the click
    el.querySelector<HTMLButtonElement>('.speak-btn')!.click();
    expect(synth.speak).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('renders no speak button for loading or error states — only alongside a result (A10)', () => {
    vi.stubGlobal('speechSynthesis', new FakeSpeechSynthesis([LOCAL_EN_US]));
    const { nodes: loadingNodes } = loadingCaption();
    expect(
      loadingNodes.some((n) => n instanceof HTMLElement && n.classList.contains('speak-btn')),
    ).toBe(false);
    const errorNodes = renderCardState({
      kind: 'error',
      error: { code: 'NETWORK', message: 'x', retryable: true },
    });
    expect(
      errorNodes.some((n) => n instanceof HTMLElement && n.classList.contains('speak-btn')),
    ).toBe(false);
    vi.unstubAllGlobals();
  });

  it('places the speak button as a top-level sibling immediately after the headword, before the save row (A10)', () => {
    vi.stubGlobal('speechSynthesis', new FakeSpeechSynthesis([LOCAL_EN_US]));
    const el = mountCard();
    el.state = { kind: 'result', word: 'bank', target: 'vi', safeHtml: safe('<p>x</p>') };
    const h2 = el.querySelector('h2')!;
    expect(h2.nextElementSibling?.classList.contains('speak-btn')).toBe(true);
    expect(h2.nextElementSibling?.nextElementSibling?.classList.contains('save-row')).toBe(true);
    vi.unstubAllGlobals();
  });

  it('cancels any in-flight utterance on every renderCardState call — loading, result, and error (A10)', () => {
    const synth = new FakeSpeechSynthesis([LOCAL_EN_US]);
    vi.stubGlobal('speechSynthesis', synth);
    renderCardState({ kind: 'loading' });
    expect(synth.cancel).toHaveBeenCalledTimes(1);
    renderCardState({ kind: 'result', word: 'bank', target: 'vi', safeHtml: safe('<p>x</p>') });
    expect(synth.cancel).toHaveBeenCalledTimes(2);
    renderCardState({ kind: 'error', error: { code: 'NETWORK', message: 'x', retryable: true } });
    expect(synth.cancel).toHaveBeenCalledTimes(3);
    vi.unstubAllGlobals();
  });

  it('labels the speak button with the exact word for screen readers (A10)', () => {
    vi.stubGlobal('speechSynthesis', new FakeSpeechSynthesis([LOCAL_EN_US]));
    const el = mountCard();
    el.state = { kind: 'result', word: 'serendipity', target: 'vi', safeHtml: safe('<p>x</p>') };
    expect(el.querySelector('.speak-btn')!.getAttribute('aria-label')).toBe(
      'Say "serendipity" aloud',
    );
    vi.unstubAllGlobals();
  });
});
```

Run: `cd packages/app && bunx vitest run test/ui/lookup-card.test.ts`
Expected: failures — `.speak-btn` never appears (the function doesn't exist yet), so every
assertion that looks for it fails or times out on a `null` query result.

- [ ] **Step 2: Implement.**
  1. In `packages/app/src/ui/styles/tokens.ts`, add the new icon right after `ICON_STAR`
     (currently the file's last export, ending `.../></svg>';`):

```ts
// Speaker (say the word aloud) — card headword row, A10. A speaker cone + two sound-wave arcs,
// stroked with currentColor like every other icon in this set.
export const ICON_SPEAKER =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M4 9.5h3.2L11 6v12l-3.8-3.5H4z"/><path d="M15.2 9.2a4 4 0 0 1 0 5.6"/><path d="M17.7 6.8a7.6 7.6 0 0 1 0 10.4"/></svg>';
```

2. In `packages/app/src/ui/lookup-card.ts`, update the `tokens` import block (currently):

```ts
import {
  BASE_VARS,
  THEME_CSS,
  BRAND_MARK_SVG,
  ICON_CLOSE,
  ICON_SHIELD,
  ICON_SETTINGS,
  ICON_SIDE_PANEL,
  ICON_STAR,
} from './styles/tokens';
```

     to:

```ts
import {
  BASE_VARS,
  THEME_CSS,
  BRAND_MARK_SVG,
  ICON_CLOSE,
  ICON_SHIELD,
  ICON_SETTINGS,
  ICON_SIDE_PANEL,
  ICON_STAR,
  ICON_SPEAKER,
} from './styles/tokens';
```

3. Add the new `::slotted(.speak-btn)` layout rule to the shadow `CSS` template string, right
   after the existing `::slotted(.save-row){display:flex;margin:6px 0 10px}` line:

```
::slotted(.speak-btn){display:inline-flex;vertical-align:middle;margin:0 0 .35em 8px}
```

4. Add the box-decoration block to `CARD_DOC_CSS`, right after the existing `.status-btn`
   block's `@media (prefers-reduced-motion:reduce){lookup-card .status-btn{transition:none}}`
   line (before `lookup-card .nudge-row__text{...}`):

```
lookup-card .speak-btn{display:inline-grid;place-items:center;width:26px;height:26px;border:0;background:transparent;color:var(--ad-ink-faint);border-radius:var(--adp-radius-control);cursor:pointer;transition:background var(--adp-dur-fast) var(--adp-ease),color var(--adp-dur-fast) var(--adp-ease)}
lookup-card .speak-btn svg{width:16px;height:16px;pointer-events:none}
lookup-card .speak-btn:hover{background:var(--ad-surface-raised);color:var(--ad-ink)}
lookup-card .speak-btn:focus-visible{outline:2px solid var(--ad-accent);outline-offset:2px}
@media (prefers-reduced-motion:reduce){lookup-card .speak-btn{transition:none}}
```

5. Add the two new module-private functions right after `renderDefinedAsRow` (i.e. immediately
   before the existing `renderSaveRow` function):

```ts
/**
 * A10: pick the voice to speak `word` with. Filters to `localService === true` first — the
 * mechanism that holds the roadmap's "100% local" / "No cloud TTS" fence (design spec §2.2):
 * some browsers' bundled voices synthesize speech by calling out to a remote server, and a
 * voice like that must never be silently chosen just because its language tag matches. Prefers
 * an exact 'en-US' match, falling back to any other local English-tagged voice. Returns
 * undefined if no local English voice exists at all — callers treat that identically to "no
 * voices installed."
 */
function pickLocalEnglishVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | undefined {
  const local = voices.filter((v) => v.localService && v.lang.toLowerCase().startsWith('en'));
  return local.find((v) => v.lang === 'en-US') ?? local[0];
}

/**
 * A10: the pronunciation control — a top-level light-DOM SIBLING of the headword `<h2>` (not a
 * wrapper — mirrors renderSaveRow's own documented reason just above: ::slotted() only matches
 * TOP-LEVEL assigned nodes, so wrapping h2 would silently drop its underline-swatch styling,
 * `::slotted(h2)` at the top of this file's CSS). The caller (renderCardState) places this node
 * immediately after `<h2>` so it flows onto the same visual line (both are inline-level slotted
 * nodes) — as close to "next to the pronunciation info" as the card's DOM model supports; see
 * the design spec §2.1 for why parsing into the sanitized markdown body was rejected instead.
 *
 * Returns null (button omitted, not disabled) when SpeechSynthesis doesn't exist at all — a
 * control that can never work has no reason to occupy space. When it exists, the button renders
 * `hidden` until at least one local English voice is confirmed installed (checked synchronously,
 * then once more on a one-shot `voiceschanged` — browsers commonly return an empty voice list on
 * the very first call and populate it asynchronously). The same voice check runs AGAIN at click
 * time, since the list can change between render and click.
 */
function renderSpeakButton(word: string): HTMLButtonElement | null {
  const synth = globalThis.speechSynthesis;
  if (!synth) return null;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'speak-btn';
  btn.hidden = true;
  btn.setAttribute('aria-label', `Say "${word}" aloud`);
  btn.innerHTML = ICON_SPEAKER; // decorative aria-hidden SVG; name comes from aria-label
  const reveal = (): void => {
    if (pickLocalEnglishVoice(synth.getVoices()) !== undefined) btn.hidden = false;
  };
  reveal();
  if (btn.hidden) synth.addEventListener('voiceschanged', reveal, { once: true });
  btn.addEventListener('click', () => {
    const voice = pickLocalEnglishVoice(synth.getVoices());
    if (!voice) return; // degraded further between render and click — do nothing, never guess
    synth.cancel(); // at most one utterance in flight — a rapid re-click restarts, never queues
    const utter = new SpeechSynthesisUtterance(word); // word only (A10 fence) — never the body
    utter.voice = voice;
    utter.lang = voice.lang;
    synth.speak(utter);
  });
  return btn;
}
```

6. Update `renderCardState`. Currently:

```ts
export function renderCardState(state: CardState): Node[] {
  if (state.kind === 'loading') {
```

     becomes:

```ts
export function renderCardState(state: CardState): Node[] {
  // A10: at most one utterance in flight, tied to whatever is currently shown — every state
  // transition (loading, result, error) interrupts any speech left over from the prior word.
  globalThis.speechSynthesis?.cancel();
  if (state.kind === 'loading') {
```

     And the `'result'` branch — currently:

```ts
const h = document.createElement('h2');
h.textContent = state.word;
const body = document.createElement('div');
body.innerHTML = state.safeHtml; // trusted: sanitized upstream by adapters-shared (S4)
const nodes: Node[] = [h, renderSaveRow(state)];
if (state.nudge === true) nodes.push(renderNudgeRow(state));
```

     becomes:

```ts
const h = document.createElement('h2');
h.textContent = state.word;
const body = document.createElement('div');
body.innerHTML = state.safeHtml; // trusted: sanitized upstream by adapters-shared (S4)
const nodes: Node[] = [h];
const speakBtn = renderSpeakButton(state.word);
if (speakBtn) nodes.push(speakBtn);
nodes.push(renderSaveRow(state));
if (state.nudge === true) nodes.push(renderNudgeRow(state));
```

     The rest of the `'result'` branch (`definedAsRow`, `body`, `meta`) is unchanged.

Run: `cd packages/app && bunx vitest run test/ui/lookup-card.test.ts`
Expected: all tests pass (existing + 10 new in the `A10 speak button` block).

- [ ] **Step 3: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

Commit:

```
git add packages/app/src/ui/styles/tokens.ts packages/app/src/ui/lookup-card.ts packages/app/test/ui/lookup-card.test.ts
git commit -m "[A10TtsPronunciation] feat: speak button — icon + render logic + card wiring (A10)" \
  -m $'Tribe-Card: a10-tts-pronunciation\nTribe-Task: 1/3'
```

---

### Task 2: stop in-flight speech when the card closes

**Files:**

- Modify: `packages/app/src/app/inline-bottom-sheet-renderer.ts`
- Modify: `packages/app/test/app/inline-bottom-sheet-renderer.test.ts`

**Interfaces:** none new — `close(): void` already exists on `InlineBottomSheetRenderer`; this task
only adds a line to its body.

- [ ] **Step 1: Write the failing tests.** In
      `packages/app/test/app/inline-bottom-sheet-renderer.test.ts`, change the import line from:

```ts
import { describe, it, expect, afterEach } from 'vitest';
```

      to:

```ts
import { describe, it, expect, afterEach, vi } from 'vitest';
```

      Then add these two tests inside the existing `describe('InlineBottomSheetRenderer', ...)`
      block, right after the existing `'close removes the sheet from the host'` test:

```ts
it('close() cancels any in-flight speech synthesis utterance (A10)', () => {
  const cancel = vi.fn();
  vi.stubGlobal('speechSynthesis', { cancel, getVoices: () => [] });
  const h = host();
  const r = new InlineBottomSheetRenderer(h);
  r.renderResult(result);
  cancel.mockClear(); // renderResult's own renderCardState call already invoked cancel once
  r.close();
  expect(cancel).toHaveBeenCalledTimes(1);
  vi.unstubAllGlobals();
});

it('close() is safe when SpeechSynthesis is unsupported (A10)', () => {
  vi.stubGlobal('speechSynthesis', undefined);
  const h = host();
  const r = new InlineBottomSheetRenderer(h);
  r.renderLoading();
  expect(() => r.close()).not.toThrow();
  vi.unstubAllGlobals();
});
```

Run: `cd packages/app && bunx vitest run test/app/inline-bottom-sheet-renderer.test.ts`
Expected: failures — `cancel` is never called by `close()` yet (`toHaveBeenCalledTimes(1)` sees 0).

- [ ] **Step 2: Implement.** In `packages/app/src/app/inline-bottom-sheet-renderer.ts`, the `close`
      method currently reads:

```ts
  close(): void {
    this.sheet?.remove();
    this.sheet = null;
    this.card = null;
    this.lastState = null;
  }
```

      becomes:

```ts
  close(): void {
    // A10: never let an utterance outlive the card it came from — dismissing (Esc, scrim click,
    // the × button, the A4 dismiss-lookup command) also stops any speech still playing.
    // renderCardState's own cancel-on-render doesn't cover this path: close() never re-renders.
    globalThis.speechSynthesis?.cancel();
    this.sheet?.remove();
    this.sheet = null;
    this.card = null;
    this.lastState = null;
  }
```

Run: `cd packages/app && bunx vitest run test/app/inline-bottom-sheet-renderer.test.ts`
Expected: all tests pass (existing + 2 new).

- [ ] **Step 3: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

Commit:

```
git add packages/app/src/app/inline-bottom-sheet-renderer.ts packages/app/test/app/inline-bottom-sheet-renderer.test.ts
git commit -m "[A10TtsPronunciation] feat: cancel in-flight speech on card close (A10)" \
  -m $'Tribe-Card: a10-tts-pronunciation\nTribe-Task: 2/3'
```

---

### Task 3: e2e smoke coverage

**Files:**

- Create: `packages/extension-chrome/e2e/a10-tts-pronunciation.spec.ts`

- [ ] **Step 1: Write the new e2e spec.** Create
      `packages/extension-chrome/e2e/a10-tts-pronunciation.spec.ts`:

```ts
import { test, expect } from './fixtures';
import { seedSettings, gotoFixture, selectWord, openTrigger, mockGemini } from './helpers';

test.describe('A10 TTS pronunciation', () => {
  test('a lookup result renders a labeled speak button; a forced click never breaks the card', async ({
    context,
    extensionId,
  }) => {
    await mockGemini(context);
    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);
    await gotoFixture(page);
    await page.waitForTimeout(1_000);
    await selectWord(page, 't', 'bank');
    await openTrigger(page);
    await expect(page.locator('bottom-sheet lookup-card')).toContainText('financial institution', {
      timeout: 10_000,
    });

    // speechSynthesis itself is always defined in Chromium (headless included), so the button
    // node always exists — only its `hidden` state depends on this machine's installed TTS
    // voices, which this suite does not control and must not assert on (design spec §6.1).
    const speakBtn = page.locator('bottom-sheet lookup-card .speak-btn');
    await expect(speakBtn).toHaveCount(1);
    await expect(speakBtn).toHaveAttribute('aria-label', 'Say "bank" aloud');

    // force: true bypasses Playwright's visibility wait — the click must be harmless whether or
    // not this machine has a usable local voice (renderSpeakButton's click handler re-checks
    // voice availability itself and no-ops if none remain, design spec §2.3 step 5).
    await speakBtn.click({ force: true });
    await page.waitForTimeout(200);
    expect(pageErrors).toEqual([]);
  });
});
```

Run:

```
GEMINI_API_KEY= bun run build:chrome
cd packages/extension-chrome && bunx playwright test a10-tts-pronunciation
```

Expected: 1 passed.

- [ ] **Step 2: Commit** — gate, then commit:

```
GEMINI_API_KEY= bun run build:chrome
bun run lint && bun run format:check
```

Commit:

```
git add packages/extension-chrome/e2e/a10-tts-pronunciation.spec.ts
git commit -m "[A10TtsPronunciation] feat: e2e smoke coverage for the speak button (A10)" \
  -m $'Tribe-Card: a10-tts-pronunciation\nTribe-Task: 3/3'
```

---

## Final gate (run once, after Task 3, before opening the PR)

```
cd packages/app && bun run typecheck
cd ../extension-chrome && bun run typecheck
cd ../safari && bun run typecheck 2>/dev/null || cd ../extension-safari && bun run typecheck
cd ../..
bun run test
bun run lint
bun run format:check
GEMINI_API_KEY= bun run build:chrome
cd packages/extension-chrome && bunx playwright test a10-tts-pronunciation saved-word idiom-expansion
```

Expected: typecheck clean on `app`, `extension-chrome`, and `extension-safari` (this plan touches no
Safari source, but the package must still typecheck clean since `tokens.ts`/`lookup-card.ts` are
part of the shared `@ai-dict/app` core it depends on); the full Vitest suite green (including the 10
`lookup-card.test.ts` additions and 2 `inline-bottom-sheet-renderer.test.ts` additions); lint/format
clean; the Chrome build succeeds with the env key cleared; the new
`a10-tts-pronunciation.spec.ts`, plus `saved-word.spec.ts` and `idiom-expansion.spec.ts`
(regression guards for the two other features that render inside the same card body this task
touches — the save row and the defined-as row) all pass.

## PR

Regular merge (no squash). `## JIRA ticket` section reads `n/a — this repo is not Jira-tracked`.
Include a **"Testing performed"** section per this worktree's evidence policy (design spec §7)
instead of screenshots/video — list the suites above with pass counts.
