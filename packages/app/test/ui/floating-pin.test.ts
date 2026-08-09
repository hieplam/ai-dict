import { describe, it, expect, beforeAll } from 'vitest';
import { FloatingPin, placeFloatingPin } from '../../src/ui/floating-pin';
import { registerContentElements } from '../../src/ui/register';

beforeAll(() => {
  registerContentElements();
});

function mountPin(): FloatingPin {
  const el = document.createElement('floating-pin') as FloatingPin;
  document.body.append(el);
  return el;
}

/** Dispatch a synthetic pointerdown whose composedPath includes the given ancestor chain. */
function fireDown(target: HTMLElement, pointerId = 1, extra: Partial<PointerEventInit> = {}): void {
  target.dispatchEvent(
    new PointerEvent('pointerdown', {
      composed: true,
      bubbles: true,
      pointerId,
      clientX: 100,
      clientY: 100,
      ...extra,
    }),
  );
}

function fireMove(host: HTMLElement, pointerId = 1, clientX = 100, clientY = 100): void {
  host.dispatchEvent(
    new PointerEvent('pointermove', { composed: true, bubbles: true, pointerId, clientX, clientY }),
  );
}

function fireUp(host: HTMLElement, pointerId = 1): void {
  host.dispatchEvent(new PointerEvent('pointerup', { composed: true, bubbles: true, pointerId }));
}

describe('<floating-pin> (A7)', () => {
  it('attaches a shadow root with exactly one <slot> and no [role="dialog"] (non-modal)', () => {
    const el = mountPin();
    const root = el.shadowRoot!;
    expect(root.querySelectorAll('slot').length).toBe(1);
    expect(root.querySelector('[role="dialog"]')).toBeNull();
  });

  it('placeFloatingPin() sets style.left/top in pixels', () => {
    const el = mountPin();
    placeFloatingPin(el, { left: 12, top: 34 });
    expect(el.style.left).toBe('12px');
    expect(el.style.top).toBe('34px');
  });

  it('a pointerdown-then-pointermove starting from a .bar-classed child moves the host by the exact pointer delta', () => {
    const el = mountPin();
    placeFloatingPin(el, { left: 100, top: 100 });
    const bar = document.createElement('div');
    bar.className = 'bar';
    el.append(bar);

    fireDown(bar, 1, { clientX: 100, clientY: 100 });
    fireMove(el, 1, 140, 130); // dx=40, dy=30 from the (100,100) down point
    expect(el.style.left).toBe('40px');
    expect(el.style.top).toBe('30px');
  });

  it('a pointerdown starting from a <button> inside .bar does NOT start a drag', () => {
    const el = mountPin();
    placeFloatingPin(el, { left: 50, top: 50 });
    const bar = document.createElement('div');
    bar.className = 'bar';
    const btn = document.createElement('button');
    bar.append(btn);
    el.append(bar);

    fireDown(btn);
    fireMove(el, 1, 999, 999);
    expect(el.style.left).toBe('50px');
    expect(el.style.top).toBe('50px');
  });

  it('a pointerdown on any pinned host re-parents it to the end of its parent children (bring-to-front)', async () => {
    const parent = document.createElement('div');
    document.body.append(parent);
    const a = document.createElement('floating-pin') as FloatingPin;
    const b = document.createElement('floating-pin') as FloatingPin;
    parent.append(a, b);
    expect([...parent.children]).toEqual([a, b]);

    fireDown(a);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect([...parent.children]).toEqual([b, a]);
  });

  it('pointerup ends the drag — a pointermove dispatched afterward no longer moves the host', () => {
    const el = mountPin();
    placeFloatingPin(el, { left: 10, top: 10 });
    const bar = document.createElement('div');
    bar.className = 'bar';
    el.append(bar);

    fireDown(bar, 1, { clientX: 0, clientY: 0 });
    fireMove(el, 1, 50, 50);
    expect(el.style.left).toBe('50px');

    fireUp(el);
    fireMove(el, 1, 999, 999); // dragging is false now — must be ignored
    expect(el.style.left).toBe('50px');
  });

  it('an extreme pointermove is clamped so the host never fully leaves the viewport in either axis', () => {
    const el = mountPin();
    placeFloatingPin(el, { left: 100, top: 100 });
    const bar = document.createElement('div');
    bar.className = 'bar';
    el.append(bar);

    fireDown(bar, 1, { clientX: 0, clientY: 0 });
    fireMove(el, 1, -100000, -100000);
    const left = parseFloat(el.style.left);
    const top = parseFloat(el.style.top);
    expect(left).toBeGreaterThan(-1000); // clamped, not runaway-negative
    expect(top).toBe(0); // top clamps at 0
  });

  it('a mid-drag bring-to-front reparent (disconnected→connected) does not abort the drag', () => {
    // Real Chromium fires disconnectedCallback+connectedCallback when the deferred bring-to-front
    // re-appends the host mid-drag (a DOM move is a remove+insert). happy-dom does not fire these
    // on append(), so invoke them directly to simulate that reparent. The drag must survive: the
    // pointermove/pointerup listeners live on the element and are untouched by the move, so only a
    // stray endDrag() in disconnectedCallback could kill it.
    //
    // Deltas are chosen at/above the drag's own left-axis clamp floor (margin - offsetWidth; happy-
    // dom reports offsetWidth 0, so that floor is 32px) so the assertions isolate the reparent
    // regression instead of tripping the (unrelated, already-covered) edge clamp.
    const el = mountPin();
    placeFloatingPin(el, { left: 0, top: 0 });
    const bar = document.createElement('div');
    bar.className = 'bar';
    el.append(bar);

    fireDown(bar, 1, { clientX: 0, clientY: 0 });
    fireMove(el, 1, 40, 40);
    expect(el.style.left).toBe('40px');

    el.disconnectedCallback(); // ← the mid-drag reparent, simulated
    el.connectedCallback();

    fireMove(el, 1, 100, 100);
    expect(el.style.left).toBe('100px'); // drag survived the reparent
  });
});
