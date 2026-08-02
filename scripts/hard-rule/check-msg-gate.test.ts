import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { checkFile, checkRepo, WINDOW_LINES } from './check-msg-gate.mjs';

describe('checkFile — classifyInbound must gate every onMessage.addListener( site', () => {
  const file = 'packages/extension-chrome/src/sw.ts';

  it(`accepts a listener with classifyInbound( within the ${WINDOW_LINES}-line window`, () => {
    const src = [
      'chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {',
      '  const decision = classifyInbound(msg, sender.id, chrome.runtime.id);',
      "  if (decision.action === 'ignore') return false;",
      '  return true;',
      '});',
    ].join('\n');
    expect(checkFile(file, src)).toEqual([]);
  });

  it('reports a violation when classifyInbound( never appears near the listener', () => {
    const src = [
      'chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {',
      '  if (msg.type === "lookup") sendResponse({ ok: true });',
      '  return true;',
      '});',
    ].join('\n');
    const violations = checkFile(file, src);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ file, line: 1 });
  });

  it('reports a violation for the hand-rolled sender.id idiom — no alternate idiom accepted', () => {
    // Ratified (spec S3): a hand-rolled guard with no classifyInbound( call must still fail —
    // the scanner is a literal substring/window check, not semantic analysis of guard idioms.
    const src = [
      'chrome.runtime.onMessage.addListener((msg, sender) => {',
      '  if (sender.id !== chrome.runtime.id) return;',
      '  handle(msg);',
      '});',
    ].join('\n');
    const violations = checkFile(file, src);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ file, line: 1 });
  });

  it('attributes multiple listener sites in one file independently, by line number', () => {
    const src = [
      '// site A: compliant',
      'chrome.runtime.onMessage.addListener((msg, sender) => {',
      '  const decision = classifyInbound(msg, sender.id, chrome.runtime.id);',
      '  return true;',
      '});',
      '',
      '// site B: not compliant',
      'chrome.runtime.onMessage.addListener((msg, sender) => {',
      '  if (sender.id !== chrome.runtime.id) return;',
      '  handle(msg);',
      '});',
    ].join('\n');
    const violations = checkFile(file, src);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ file, line: 8 });
  });

  it('does not count a classifyInbound( call that appears BEFORE the addListener line', () => {
    // Off-by-logic guard: the window is measured forward from the addListener line only —
    // an earlier, unrelated call to classifyInbound( elsewhere in the file must not satisfy it.
    const src = [
      'const decision = classifyInbound(earlierMsg, earlierSender.id, chrome.runtime.id);',
      '',
      'chrome.runtime.onMessage.addListener((msg, sender) => {',
      '  handle(msg);',
      '});',
    ].join('\n');
    const violations = checkFile(file, src);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ file, line: 3 });
  });
});

describe('checkFile — the safari cast idiom (as (fn: T) => void)( must still be recognized', () => {
  // packages/extension-safari/src/sw.ts:82 registers via a TypeScript cast:
  //   (browser.runtime.onMessage.addListener as (fn: OnMsgListener) => void)(
  // There is no `(` immediately after `addListener` (there's ` as (fn: ...) => void)(` in
  // between), so a scanner keyed on the literal `onMessage.addListener(` (with trailing paren)
  // never recognizes this as a listener-registration site at all — it silently contributes zero
  // sites rather than being checked. This must be a real, inspected site, not a blind spot.
  const file = 'packages/extension-safari/src/sw.ts';
  const castSrc = [
    'type OnMsgListener = (msg: unknown, sender: { id?: string }, sendResponse: (r: unknown) => void) => boolean;',
    '(browser.runtime.onMessage.addListener as (fn: OnMsgListener) => void)(',
    '  (msg, sender, sendResponse) => {',
    '    const decision = classifyInbound(msg, sender.id, browser.runtime.id);',
    '    if (decision.action === "ignore") return false;',
    '    return true;',
    '  },',
    ');',
  ].join('\n');

  it('recognizes the cast-wrapped registration as a listener site and finds it compliant', () => {
    expect(checkFile(file, castSrc)).toEqual([]);
  });

  it('flags the cast-wrapped registration when classifyInbound( is removed from the callback', () => {
    const mutated = castSrc.replace(
      '    const decision = classifyInbound(msg, sender.id, browser.runtime.id);\n',
      '',
    );
    const violations = checkFile(file, mutated);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ file, line: 2 });
  });
});

describe('checkRepo — integration on this repository', () => {
  it('finds zero violations on the current clean tree', () => {
    const violations = checkRepo(new URL('../..', import.meta.url).pathname);
    expect(violations).toEqual([]);
  });

  it('actually inspects the real safari cast-idiom site (not a silent blind spot)', () => {
    // Prove the scanner sees packages/extension-safari/src/sw.ts's real listener registration
    // (line 82), not just trivially passing because it saw nothing there at all: run checkFile
    // directly on the real file content, then again with its real classifyInbound( call
    // stripped, and confirm the mutated version DOES trigger a violation.
    const repoRoot = new URL('../..', import.meta.url).pathname;
    const safariFile = 'packages/extension-safari/src/sw.ts';
    const realSrc = readFileSync(join(repoRoot, safariFile), 'utf8');

    expect(checkFile(safariFile, realSrc)).toEqual([]);

    const realGateLine = 'const decision = classifyInbound(msg, sender.id, browser.runtime.id);';
    expect(realSrc).toContain(realGateLine);
    const mutatedSrc = realSrc.replace(realGateLine, '// classifyInbound removed for this test');
    const violations = checkFile(safariFile, mutatedSrc);
    expect(violations).toHaveLength(1);
    expect(violations[0].file).toBe(safariFile);
  });
});
