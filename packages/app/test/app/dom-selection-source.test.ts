import { describe, it, expect, vi } from 'vitest';
import {
  extractSentence,
  DomSelectionSource,
  SELECTION_FIRED_MARK,
} from '../../src/app/dom-selection-source';
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

  it('marks SELECTION_FIRED_MARK exactly once per real selection, and not on a null read (A15)', () => {
    performance.clearMarks(SELECTION_FIRED_MARK);
    const read = vi.fn<() => SelectionEvent | null>(() => ev);
    const src = new DomSelectionSource(document, read);
    const cb = vi.fn();
    const teardown = src.onSelection(cb);
    document.dispatchEvent(new Event('mouseup'));
    expect(performance.getEntriesByName(SELECTION_FIRED_MARK)).toHaveLength(1);
    read.mockReturnValueOnce(null);
    document.dispatchEvent(new Event('mouseup'));
    expect(performance.getEntriesByName(SELECTION_FIRED_MARK)).toHaveLength(1); // null reader → no new mark
    teardown();
  });
});

describe('DomSelectionSource — A14 double-click detection (viaDoubleClick)', () => {
  const ev: SelectionEvent = {
    text: 'bank',
    sentence: 'the bank.',
    anchor: { x: 1, y: 2, w: 3, h: 4 },
    url: 'u',
    title: 't',
  };

  function fireOn(el: Element, event: Event) {
    const read = vi.fn<() => SelectionEvent | null>(() => ev);
    const src = new DomSelectionSource(document, read);
    const cb = vi.fn();
    src.onSelection(cb);
    el.dispatchEvent(event);
    return cb;
  }

  it('sets viaDoubleClick: true for a detail: 2 mouseup on a plain (unguarded) element', () => {
    document.body.innerHTML = '<p id="plain">text</p>';
    const cb = fireOn(
      document.getElementById('plain')!,
      new MouseEvent('mouseup', { bubbles: true, detail: 2 }),
    );
    expect(cb).toHaveBeenCalledWith({ ...ev, viaDoubleClick: true });
    document.body.innerHTML = '';
  });

  it('does not set the flag for detail: 1 or detail: 3 (exact match, not >= 2)', () => {
    document.body.innerHTML = '<p id="plain">text</p>';
    const el = document.getElementById('plain')!;
    const cb1 = fireOn(el, new MouseEvent('mouseup', { bubbles: true, detail: 1 }));
    expect(cb1).toHaveBeenCalledWith(ev);
    const cb3 = fireOn(el, new MouseEvent('mouseup', { bubbles: true, detail: 3 }));
    expect(cb3).toHaveBeenCalledWith(ev);
    document.body.innerHTML = '';
  });

  it.each(['input', 'textarea', 'select', 'button'])(
    'does not set the flag when target is a guarded <%s>, but the selection still fires',
    (tag) => {
      document.body.innerHTML = `<${tag} id="g"></${tag}>`;
      const cb = fireOn(
        document.getElementById('g')!,
        new MouseEvent('mouseup', { bubbles: true, detail: 2 }),
      );
      expect(cb).toHaveBeenCalledWith(ev); // unflagged, but still called — existing flow intact
      document.body.innerHTML = '';
    },
  );

  it('does not set the flag for an element nested inside a contenteditable="true" ancestor', () => {
    document.body.innerHTML =
      '<div id="edit" contenteditable="true"><span id="inner">x</span></div>';
    const cb = fireOn(
      document.getElementById('inner')!,
      new MouseEvent('mouseup', { bubbles: true, detail: 2 }),
    );
    expect(cb).toHaveBeenCalledWith(ev);
    document.body.innerHTML = '';
  });

  it('sets the flag for an <a> target — anchors are deliberately not guarded', () => {
    document.body.innerHTML = '<a id="link" href="#">word</a>';
    const cb = fireOn(
      document.getElementById('link')!,
      new MouseEvent('mouseup', { bubbles: true, detail: 2 }),
    );
    expect(cb).toHaveBeenCalledWith({ ...ev, viaDoubleClick: true });
    document.body.innerHTML = '';
  });

  it('never sets the flag on a touchend, regardless of any detail-like value', () => {
    document.body.innerHTML = '<p id="plain">text</p>';
    const cb = fireOn(document.getElementById('plain')!, new Event('touchend', { bubbles: true }));
    expect(cb).toHaveBeenCalledWith(ev);
    document.body.innerHTML = '';
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

  it('stamps insideResult: true when the selection starts inside a .lookup-answer element (A2)', () => {
    document.body.innerHTML =
      '<div class="lookup-answer"><p id="ans">A financial institution near a river.</p></div>';
    const p = document.getElementById('ans')!;
    const textNode = p.firstChild!;
    const sel = window.getSelection()!;
    const range = document.createRange();
    range.setStart(textNode, 2); // 'financial'
    range.setEnd(textNode, 12);
    sel.removeAllRanges();
    sel.addRange(range);

    const src = new DomSelectionSource(document);
    const cb = vi.fn();
    const teardown = src.onSelection(cb);
    document.dispatchEvent(new Event('mouseup'));
    expect(cb).toHaveBeenCalledTimes(1);
    const event = cb.mock.calls[0]?.[0] as SelectionEvent;
    expect(event.insideResult).toBe(true);

    sel.removeAllRanges();
    teardown();
    document.body.innerHTML = '';
  });

  it('omits insideResult entirely for an ordinary page selection (no .lookup-answer ancestor) (A2)', () => {
    document.body.innerHTML = '<p id="plain">The bank by the river.</p>';
    const p = document.getElementById('plain')!;
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
    expect('insideResult' in event).toBe(false); // EOP-safe: key omitted, not set to undefined

    sel.removeAllRanges();
    teardown();
    document.body.innerHTML = '';
  });
});
