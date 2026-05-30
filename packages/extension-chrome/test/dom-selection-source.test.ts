import { describe, it, expect, vi } from 'vitest';
import { extractSentence, DomSelectionSource } from '../src/adapters/dom-selection-source';
import type { SelectionEvent } from '@ai-dict/core';

describe('extractSentence (sentence-boundary detection: . ! ?)', () => {
  const text = 'First one. The bank by the river is steep! Third.';
  it('returns the sentence containing the selection', () => {
    const i = text.indexOf('bank');
    expect(extractSentence(text, i, i + 4)).toBe('The bank by the river is steep!');
  });
  it('falls back to the whole text when no boundary exists', () => {
    expect(extractSentence('no boundary here', 3, 5)).toBe('no boundary here');
  });
});

describe('DomSelectionSource (event wiring)', () => {
  const ev: SelectionEvent = { text: 'bank', sentence: 'the bank.', anchor: { x: 1, y: 2, w: 3, h: 4 }, url: 'u', title: 't' };
  it('invokes the callback on mouseup when the reader yields a selection, and tears down', () => {
    const read = vi.fn<() => SelectionEvent | null>(() => ev);
    const src = new DomSelectionSource(document, read);
    const cb = vi.fn();
    const teardown = src.onSelection(cb);
    document.dispatchEvent(new Event('mouseup'));
    expect(cb).toHaveBeenCalledWith(ev);
    read.mockReturnValueOnce(null);
    document.dispatchEvent(new Event('mouseup'));
    expect(cb).toHaveBeenCalledTimes(1); // null reader → no emit
    teardown();
    document.dispatchEvent(new Event('mouseup'));
    expect(cb).toHaveBeenCalledTimes(1); // removed
  });
});
