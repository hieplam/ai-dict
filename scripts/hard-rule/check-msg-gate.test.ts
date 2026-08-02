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

describe('checkRepo — integration on this repository', () => {
  it('finds zero violations on the current clean tree', () => {
    const violations = checkRepo(new URL('../..', import.meta.url).pathname);
    expect(violations).toEqual([]);
  });
});
