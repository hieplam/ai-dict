import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  findHoverHit,
  HoverRecallController,
  type CaretHit,
  type CaretLocator,
} from '../../src/app/hover-recall-controller';

function textRange(text: string, start: number, end: number): { node: Text; range: Range } {
  const node = document.createTextNode(text);
  document.body.appendChild(node);
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  return { node, range };
}

describe('findHoverHit (pure)', () => {
  it('resolves the range whose startContainer matches and offset falls within bounds', () => {
    const { node, range } = textRange('Banks on the river bank', 0, 5);
    const hit: CaretHit = { node, offset: 2 };
    expect(findHoverHit(hit, [range])).toBe(range);
  });

  it('returns null when the offset is outside every range on the matching node', () => {
    const { node, range } = textRange('Banks on the river bank', 0, 5);
    expect(findHoverHit({ node, offset: 10 }, [range])).toBeNull();
  });

  it('returns null when the hit is on a different node entirely', () => {
    const { range } = textRange('Banks on the river bank', 0, 5);
    const other = document.createTextNode('other');
    expect(findHoverHit({ node: other, offset: 0 }, [range])).toBeNull();
  });

  it('returns null for a null hit', () => {
    const { range } = textRange('Banks on the river bank', 0, 5);
    expect(findHoverHit(null, [range])).toBeNull();
  });

  it('resolves the correct range among several on the same node', () => {
    const node = document.createTextNode('Banks on the river bank');
    document.body.appendChild(node);
    const r1 = document.createRange();
    r1.setStart(node, 0);
    r1.setEnd(node, 5); // "Banks"
    const r2 = document.createRange();
    r2.setStart(node, 19);
    r2.setEnd(node, 23); // "bank"
    expect(findHoverHit({ node, offset: 20 }, [r1, r2])).toBe(r2);
  });
});

describe('HoverRecallController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // happy-dom has no real layout engine; requestAnimationFrame is stubbed to run synchronously
    // so mousemove-driven ticks are deterministic under fake timers (mirrors B3's own
    // idle-callback-fallback test shim precedent).
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback): number => {
      cb(0);
      return 0;
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  function setup(caretAt: CaretLocator, ranges: Range[]) {
    const controller = new HoverRecallController(document, { caretAt });
    const onMatch = vi.fn();
    const onLeave = vi.fn();
    controller.start(() => ranges, onMatch, onLeave);
    return { controller, onMatch, onLeave };
  }

  function move(x = 5, y = 5): void {
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y }));
  }

  it('fires onMatch after 200ms of continuous hover over the same range', () => {
    const { node, range } = textRange('bank', 0, 4);
    const caretAt: CaretLocator = () => ({ node, offset: 1 });
    const { onMatch } = setup(caretAt, [range]);
    move();
    vi.advanceTimersByTime(199);
    expect(onMatch).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onMatch).toHaveBeenCalledWith({ range });
    expect(onMatch).toHaveBeenCalledTimes(1);
  });

  it('resets the show timer when the candidate range changes before it fires', () => {
    const a = textRange('bank', 0, 4);
    const b = textRange('money', 0, 5);
    let current = a.range;
    const caretAt: CaretLocator = () => ({
      node: current === a.range ? a.node : b.node,
      offset: 1,
    });
    const { onMatch } = setup(caretAt, [a.range, b.range]);
    move();
    vi.advanceTimersByTime(150);
    current = b.range;
    move();
    vi.advanceTimersByTime(150);
    expect(onMatch).not.toHaveBeenCalled();
    vi.advanceTimersByTime(50);
    expect(onMatch).toHaveBeenCalledWith({ range: b.range });
  });

  it('fires onLeave 250ms after the pointer leaves the matched range, unless it returns', () => {
    const { node, range } = textRange('bank', 0, 4);
    let onRange = true;
    const caretAt: CaretLocator = () => (onRange ? { node, offset: 1 } : null);
    const { onMatch, onLeave } = setup(caretAt, [range]);
    move();
    vi.advanceTimersByTime(200);
    expect(onMatch).toHaveBeenCalledTimes(1);
    onRange = false;
    move();
    vi.advanceTimersByTime(249);
    expect(onLeave).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it('does not fire onLeave if the pointer returns to the matched range within the grace period', () => {
    const { node, range } = textRange('bank', 0, 4);
    let onRange = true;
    const caretAt: CaretLocator = () => (onRange ? { node, offset: 1 } : null);
    const { onLeave } = setup(caretAt, [range]);
    move();
    vi.advanceTimersByTime(200);
    onRange = false;
    move();
    vi.advanceTimersByTime(100);
    onRange = true;
    move();
    vi.advanceTimersByTime(300);
    expect(onLeave).not.toHaveBeenCalled();
  });

  it('treats hovering the injected popupEl as still-matched (no onLeave)', () => {
    const { node, range } = textRange('bank', 0, 4);
    const popup = document.createElement('div');
    document.body.appendChild(popup);
    let overPopup = false;
    const caretAt: CaretLocator = () => ({ node, offset: 1 });
    const controller = new HoverRecallController(document, {
      caretAt,
      // elementFromPoint is stubbed per-test below via document.elementFromPoint override.
    });
    const onMatch = vi.fn();
    const onLeave = vi.fn();
    (
      document as unknown as { elementFromPoint: (x: number, y: number) => Element | null }
    ).elementFromPoint = () => (overPopup ? popup : document.body);
    controller.start(() => [range], onMatch, onLeave, popup);
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 5, clientY: 5 }));
    vi.advanceTimersByTime(200);
    expect(onMatch).toHaveBeenCalledTimes(1);
    overPopup = true;
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 5, clientY: 5 }));
    vi.advanceTimersByTime(1000);
    expect(onLeave).not.toHaveBeenCalled();
  });

  it('Escape fires onLeave immediately, bypassing the grace period', () => {
    const { node, range } = textRange('bank', 0, 4);
    const caretAt: CaretLocator = () => ({ node, offset: 1 });
    const { onLeave } = setup(caretAt, [range]);
    move();
    vi.advanceTimersByTime(200);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it('an outside mousedown fires onLeave immediately', () => {
    const { node, range } = textRange('bank', 0, 4);
    const caretAt: CaretLocator = () => ({ node, offset: 1 });
    const { onLeave } = setup(caretAt, [range]);
    move();
    vi.advanceTimersByTime(200);
    document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it('never matches while an active (non-collapsed) selection exists', () => {
    const { node, range } = textRange('bank', 0, 4);
    const sel = window.getSelection()!;
    const other = document.createTextNode('selected text');
    document.body.appendChild(other);
    const selRange = document.createRange();
    selRange.setStart(other, 0);
    selRange.setEnd(other, 5);
    sel.removeAllRanges();
    sel.addRange(selRange);
    const caretAt: CaretLocator = () => ({ node, offset: 1 });
    const { onMatch } = setup(caretAt, [range]);
    move();
    vi.advanceTimersByTime(500);
    expect(onMatch).not.toHaveBeenCalled();
    sel.removeAllRanges();
  });

  it('never matches when elementFromPoint resolves an extension host tag', () => {
    const { node, range } = textRange('bank', 0, 4);
    const bottomSheet = document.createElement('bottom-sheet');
    document.body.appendChild(bottomSheet);
    (
      document as unknown as { elementFromPoint: (x: number, y: number) => Element | null }
    ).elementFromPoint = () => bottomSheet;
    const caretAt: CaretLocator = () => ({ node, offset: 1 });
    const { onMatch } = setup(caretAt, [range]);
    move();
    vi.advanceTimersByTime(500);
    expect(onMatch).not.toHaveBeenCalled();
  });

  it('gracefully never matches when caretAt always returns null (no platform caret API)', () => {
    const { range } = textRange('bank', 0, 4);
    const { onMatch } = setup(() => null, [range]);
    move();
    vi.advanceTimersByTime(500);
    expect(onMatch).not.toHaveBeenCalled();
  });

  it('stop() removes listeners — a mousemove after stop() never fires onMatch', () => {
    const { node, range } = textRange('bank', 0, 4);
    const caretAt: CaretLocator = () => ({ node, offset: 1 });
    const { controller, onMatch } = setup(caretAt, [range]);
    controller.stop();
    move();
    vi.advanceTimersByTime(500);
    expect(onMatch).not.toHaveBeenCalled();
  });
});

describe('default caretAt platform-API selection', () => {
  afterEach(() => {
    // @ts-expect-error test-only cleanup of properties this suite stubs
    delete document.caretPositionFromPoint;
    // @ts-expect-error test-only cleanup of properties this suite stubs
    delete document.caretRangeFromPoint;
  });

  it('prefers caretPositionFromPoint when present', async () => {
    const { node } = textRange('bank', 0, 4);
    const posSpy = vi.fn(() => ({ offsetNode: node, offset: 2 }));
    const rangeSpy = vi.fn();
    Object.assign(document, { caretPositionFromPoint: posSpy, caretRangeFromPoint: rangeSpy });
    const { defaultCaretAt } = await import('../../src/app/hover-recall-controller');
    const hit = defaultCaretAt(1, 2);
    expect(posSpy).toHaveBeenCalledWith(1, 2);
    expect(rangeSpy).not.toHaveBeenCalled();
    expect(hit).toEqual({ node, offset: 2 });
  });

  it('falls back to caretRangeFromPoint when caretPositionFromPoint is absent (pre-Chrome-125)', async () => {
    const { node } = textRange('bank', 0, 4);
    const r = document.createRange();
    r.setStart(node, 3);
    const rangeSpy = vi.fn(() => r);
    Object.assign(document, { caretRangeFromPoint: rangeSpy });
    const { defaultCaretAt } = await import('../../src/app/hover-recall-controller');
    const hit = defaultCaretAt(1, 2);
    expect(rangeSpy).toHaveBeenCalledWith(1, 2);
    expect(hit).toEqual({ node, offset: 3 });
  });

  it('returns null when neither platform API exists (graceful no-op)', async () => {
    const { defaultCaretAt } = await import('../../src/app/hover-recall-controller');
    expect(defaultCaretAt(1, 2)).toBeNull();
  });
});
