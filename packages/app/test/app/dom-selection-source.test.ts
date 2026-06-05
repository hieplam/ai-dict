import { describe, it, expect, vi } from 'vitest';
import { extractSentence, DomSelectionSource } from '../../src/app/dom-selection-source';
import type { SelectionEvent } from '../../src';

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
  const ev: SelectionEvent = {
    text: 'bank',
    sentence: 'the bank.',
    anchor: { x: 1, y: 2, w: 3, h: 4 },
    url: 'u',
    title: 't',
  };
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

  it('also fires on touchend events', () => {
    const read = vi.fn<() => SelectionEvent | null>(() => ev);
    const src = new DomSelectionSource(document, read);
    const cb = vi.fn();
    const teardown = src.onSelection(cb);
    document.dispatchEvent(new Event('touchend'));
    expect(cb).toHaveBeenCalledWith(ev);
    teardown();
  });
});

describe('defaultReader (DOM selection glue via window.getSelection)', () => {
  // Tests use DomSelectionSource with no injected reader so defaultReader runs.
  it('returns null when there is no selection (collapsed / empty)', () => {
    // happy-dom's getSelection() returns a collapsed empty selection by default
    const src = new DomSelectionSource(document); // no reader → defaultReader
    const cb = vi.fn();
    const teardown = src.onSelection(cb);
    document.dispatchEvent(new Event('mouseup'));
    expect(cb).not.toHaveBeenCalled(); // null → not emitted
    teardown();
  });

  it('returns a SelectionEvent when text is selected', () => {
    // Set up a real DOM selection so defaultReader can read it
    document.body.innerHTML = '<p id="sel-test">The bank by the river.</p>';
    const p = document.getElementById('sel-test')!;
    const textNode = p.firstChild!;
    const sel = window.getSelection()!;
    const range = document.createRange();
    range.setStart(textNode, 4); // 'bank'
    range.setEnd(textNode, 8);
    sel.removeAllRanges();
    sel.addRange(range);

    const src = new DomSelectionSource(document);
    const cb = vi.fn();
    const teardown = src.onSelection(cb);
    document.dispatchEvent(new Event('mouseup'));
    expect(cb).toHaveBeenCalledTimes(1);
    const event = cb.mock.calls[0]?.[0] as SelectionEvent;
    expect(event.text).toBe('bank');
    expect(typeof event.sentence).toBe('string');

    // Cleanup
    sel.removeAllRanges();
    teardown();
    document.body.innerHTML = '';
  });

  it('returns null when selected text is whitespace-only', () => {
    document.body.innerHTML = '<p id="ws-test">   </p>';
    const p = document.getElementById('ws-test')!;
    const textNode = p.firstChild!;
    const sel = window.getSelection()!;
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 3);
    sel.removeAllRanges();
    sel.addRange(range);

    const src = new DomSelectionSource(document);
    const cb = vi.fn();
    const teardown = src.onSelection(cb);
    document.dispatchEvent(new Event('mouseup'));
    expect(cb).not.toHaveBeenCalled();

    sel.removeAllRanges();
    teardown();
    document.body.innerHTML = '';
  });
});
