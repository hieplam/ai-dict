import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ANNOTATION_WINDOW_ABOVE, checkFile, checkRepo } from './check-safe-html.mjs';

describe('checkFile — every raw-HTML sink must be annotated or reference the sanctioned sanitize path', () => {
  const file = 'packages/app/src/ui/example-view.ts';

  it('accepts a sink line carrying an `// s4: static-template — <reason>` annotation on the same line', () => {
    const src = [
      'function render(tpl: HTMLElement) {',
      '  tpl.innerHTML = BRAND_MARK_SVG; // s4: static-template — decorative, no model content',
      '}',
    ].join('\n');
    expect(checkFile(file, src)).toEqual([]);
  });

  it('accepts a sink line referencing the sanctioned sanitize path (safeHtml property)', () => {
    // Real site: packages/app/src/ui/lookup-card.ts:286 — `body.innerHTML = state.safeHtml;`
    // The literal text is lowercase-first `safeHtml` (the CardState property), not the
    // capitalized `SafeHtml` branded type name — match must be case-insensitive (or match both
    // spellings) to accept this real, already-compliant site.
    const src = [
      'function render(body: HTMLElement, state: { safeHtml: string }) {',
      '  body.innerHTML = state.safeHtml; // trusted: sanitized upstream by adapters-shared (S4)',
      '}',
    ].join('\n');
    expect(checkFile(file, src)).toEqual([]);
  });

  it('accepts a sink line referencing the sanctioned sanitize path (SafeHtml type / sanitizeMarkdown call)', () => {
    const srcType = [
      'function render(el: HTMLElement, html: SafeHtml) {',
      '  el.innerHTML = html;',
      '}',
    ].join('\n');
    expect(checkFile(file, srcType)).toEqual([]);

    const srcCall = [
      'function render(el: HTMLElement, md: string) {',
      '  el.innerHTML = sanitizeMarkdown(md);',
      '}',
    ].join('\n');
    expect(checkFile(file, srcCall)).toEqual([]);
  });

  it('reports a violation for a bare sink line with neither annotation nor sanctioned reference', () => {
    const src = [
      'function render(el: HTMLElement, userInput: string) {',
      '  el.innerHTML = userInput;',
      '}',
    ].join('\n');
    const violations = checkFile(file, src);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ file, line: 2 });
  });

  it('catches all three sink forms: .innerHTML =, .outerHTML =, insertAdjacentHTML(', () => {
    const src = [
      'function render(a: HTMLElement, b: HTMLElement, c: HTMLElement, x: string) {',
      '  a.innerHTML = x;',
      '  b.outerHTML = x;',
      "  c.insertAdjacentHTML('beforeend', x);",
      '}',
    ].join('\n');
    const violations = checkFile(file, src);
    expect(violations).toHaveLength(3);
    expect(violations.map((v) => v.line)).toEqual([2, 3, 4]);
  });

  it('reports a violation using correct file:line attribution among multiple sites in one file', () => {
    const src = [
      '// site A: compliant',
      'a.innerHTML = ICON_STAR; // s4: static-template — decorative icon',
      '',
      '// site B: not compliant',
      'b.innerHTML = remoteText;',
      '',
      '// site C: compliant via sanctioned path',
      'c.innerHTML = state.safeHtml;',
    ].join('\n');
    const violations = checkFile(file, src);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ file, line: 5 });
  });

  describe('annotation window — same line, or a small window of lines ABOVE the sink', () => {
    // Real site: packages/app/src/ui/side-panel-view.ts — the `// s4: static-template — ...`
    // annotation sits on line 99, the sink assignment `wrap.innerHTML =` starts on line 100 (a
    // multi-line template-literal assignment). Ratified choice for this scanner (documented here
    // and in check-safe-html.mjs): the window looks only BACKWARD (same line or up to
    // ANNOTATION_WINDOW_ABOVE lines above the sink) — never forward — because every real
    // annotation in this repo is either a same-line trailing comment or sits immediately above
    // the assignment it explains; a forward-looking window would risk a later, unrelated
    // annotation appearing to justify an earlier unannotated sink.
    it(`accepts an annotation exactly ${ANNOTATION_WINDOW_ABOVE} line(s) above the sink`, () => {
      const src = [
        '// s4: static-template — brand mark is decorative; text carries the meaning',
        'wrap.innerHTML =',
        "  BRAND_MARK_SVG + '<p>Select a word</p>';",
      ].join('\n');
      expect(checkFile(file, src)).toEqual([]);
    });

    it('rejects an annotation further above than the window allows', () => {
      const lines = ['// s4: static-template — too far away'];
      for (let i = 0; i < ANNOTATION_WINDOW_ABOVE; i++) lines.push('// filler comment line');
      lines.push('el.innerHTML = x;');
      const src = lines.join('\n');
      const violations = checkFile(file, src);
      expect(violations).toHaveLength(1);
      expect(violations[0]).toMatchObject({ file, line: lines.length });
    });

    it('rejects an annotation placed BELOW the sink — the window looks backward only', () => {
      const src = ['el.innerHTML = x;', '// s4: static-template — too late, this is below'].join(
        '\n',
      );
      const violations = checkFile(file, src);
      expect(violations).toHaveLength(1);
      expect(violations[0]).toMatchObject({ file, line: 1 });
    });
  });
});

describe('checkRepo — integration on this repository', () => {
  it('finds zero violations across the real production sink sites', () => {
    const violations = checkRepo(new URL('../..', import.meta.url).pathname);
    expect(violations).toEqual([]);
  });

  it('the real tree has exactly 24 raw-HTML sink sites (23 annotated + 1 sanctioned-path)', () => {
    // Cross-check against the count Task 3's audit verified via two independent enumeration
    // methods (see the campaign report) — proves this scanner is inspecting every real sink,
    // not silently seeing fewer sites than exist. A10 (TTS pronunciation) added one new
    // annotated sink — `btn.innerHTML = ICON_SPEAKER;` in lookup-card.ts's renderSpeakButton —
    // raising the count from 15 to 16. B6 (words page) added five more annotated sinks — one
    // `words.innerHTML = ICON_WORDS_LIST;` in side-panel-view.ts's header nav, plus four in the
    // new words-page-view.ts (back icon, two static <select> option lists, delete icon) — raising
    // the count from 16 to 21 and adding words-page-view.ts to the enumerated file list.
    // Reconciliation (A5): this guard had drifted stale against master HEAD, which already sat at
    // 23 (not 21) before A5 touched anything — two annotated static-template icon sinks (e.g. A2's
    // Back button `ICON_BACK`) were added to lookup-card.ts by cards merged after B6 and never
    // reflected here, because this file lives under scripts/ and the root `vitest run` that covers
    // it is not part of any CI gate (CI runs only the per-package `bun run --filter ... test`), so
    // the drift merged green undetected. A5 itself adds exactly one new, sanctioned sink —
    // `text.innerHTML = state.safeHtml;` in the new packages/app/src/ui/lookup-gloss.ts — bringing
    // the true count to 24 and enrolling lookup-gloss.ts in the enumerated file list below.
    const repoRoot = new URL('../..', import.meta.url).pathname;
    const SINK_RE = /\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML\(/g;
    const files = [
      'packages/app/src/ui/lookup-card.ts',
      'packages/app/src/ui/lookup-gloss.ts',
      'packages/app/src/ui/lookup-trigger.ts',
      'packages/app/src/ui/onboarding-view.ts',
      'packages/app/src/ui/settings-form.ts',
      'packages/app/src/ui/side-panel-view.ts',
      'packages/app/src/ui/words-page-view.ts',
    ];
    let total = 0;
    for (const f of files) {
      const src = readFileSync(join(repoRoot, f), 'utf8');
      total += (src.match(SINK_RE) ?? []).length;
    }
    expect(total).toBe(24);
  });

  it('a deliberately-planted unannotated innerHTML violation is caught (proves the RED path works)', () => {
    const file = 'packages/app/src/ui/example-view.ts';
    const src = [
      'function renderRemote(el: HTMLElement, remoteText: string) {',
      '  el.innerHTML = remoteText; // BUG: no annotation, no sanctioned reference',
      '}',
    ].join('\n');
    const violations = checkFile(file, src);
    expect(violations).toEqual([{ file, line: 2 }]);
  });
});
