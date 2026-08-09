import { adoptStyles } from './styles/adopt';
import { BASE_VARS, THEME_CSS } from './styles/tokens';

// A7: the non-modal counterpart to <bottom-sheet> (bottom-sheet.ts). No scrim, no focus trap, no
// Escape handling — pinned cards must survive Esc, scrolling, and clicking elsewhere on the page
// (the whole point of pinning). Purely a fixed-position, draggable shell around a slotted
// <lookup-card>; the card itself already carries the visible surface (bottom-sheet.ts's own "One
// Surface Rule" comment), so this host stays transparent.
const CSS = `:host{${BASE_VARS};position:fixed;display:block;z-index:var(--adp-z-pinned);width:max-content;max-width:min(var(--adp-card-width),calc(100vw - 16px));touch-action:none}
${THEME_CSS}
::slotted(*){display:block}`;

/**
 * A7: place a `<floating-pin>` (or any element) at a fixed viewport position — a snapshot of the
 * on-page card's own `getBoundingClientRect()` at the moment of pinning, captured by the renderer
 * BEFORE the card moves here, so pinning never visually jumps the card to a new spot.
 *
 * Deliberately a PLAIN FUNCTION, not a `FloatingPin` instance method (see design spec §2.7).
 * `InlineBottomSheetRenderer` runs in a Chrome MV3 content-script ISOLATED world; `FloatingPin`'s
 * class (like `LookupCard`'s) is registered in the page's MAIN world by `content-elements.ts`. A
 * JS method call on a MAIN-world custom element instance never resolves from isolated-world code
 * (Chromium bug 390807 — the same reason `LookupCard`'s `.state` setter can't be used cross-world
 * either; see lookup-card.ts's own connectedCallback comment and
 * inline-bottom-sheet-renderer.ts's setState). This function only ever touches the element
 * through the native, platform-level `style` property (a shared-DOM mutation, exactly like
 * `element.setAttribute(...)`), which DOES cross the boundary — so it is safe to call on a
 * cross-world element reference, unlike an author-defined method would be.
 */
export function placeFloatingPin(el: HTMLElement, rect: { left: number; top: number }): void {
  el.style.left = `${rect.left}px`;
  el.style.top = `${rect.top}px`;
}

export class FloatingPin extends HTMLElement {
  private dragging = false;
  private startPointer = { x: 0, y: 0 };
  private startRect = { left: 0, top: 0 };

  connectedCallback(): void {
    if (!this.shadowRoot) {
      const root = this.attachShadow({ mode: 'open' });
      adoptStyles(root, CSS);
      root.append(document.createElement('slot'));
    }
    this.addEventListener('pointerdown', this.onPointerDown);
  }

  disconnectedCallback(): void {
    this.removeEventListener('pointerdown', this.onPointerDown);
    // Deliberately NOT endDrag() here. The unconditional bring-to-front in onPointerDown
    // (setTimeout → parentElement.append(this)) reparents the host on EVERY pointerdown, including
    // mid-drag; a DOM move is a remove+insert, so it fires this disconnectedCallback (then
    // connectedCallback) in real Chromium even though the host stays in the same parent. Calling
    // endDrag() here would tear down an in-progress drag the instant that deferred reorder fires
    // (confirmed against real Chromium — the card moved only ~12px before the drag died). The
    // pointermove/pointerup/pointercancel listeners live on the element and survive the reparent
    // untouched, so the drag continues seamlessly; the gesture is always ended by onPointerUp/
    // onPointercancel instead. A genuine removal (Close → pin.remove()) needs no endDrag: the
    // detached element and its self-referential listeners are collected together.
  }

  private readonly onPointerDown = (e: PointerEvent): void => {
    const path = e.composedPath();
    const onBar = path.some((n) => n instanceof Element && n.classList.contains('bar'));
    const onButton = path.some((n) => n instanceof Element && n.tagName === 'BUTTON');
    if (!onBar || onButton) {
      // Not a drag (a button press, or a press off the title bar): bring-to-front ONLY. Same-z
      // fixed siblings paint in DOM order, so re-appending as the last child suffices (design
      // spec §2.6) — no per-instance z-index bookkeeping. DEFERRED to a macrotask (setTimeout,
      // not queueMicrotask — the browser's click dispatch is a separate task, not a microtask):
      // moving the host between pointerdown and the matching click suppresses Chromium's
      // synthetic `click` for every button inside it, including Close/Pin (confirmed empirically
      // against real Chromium). The reorder must run strictly AFTER the click has fired.
      setTimeout(() => this.parentElement?.append(this), 0);
      return; // only the card's title bar drags it, never a button inside it
    }
    // Drag start. Bring-to-front SYNCHRONOUSLY, once, BEFORE claiming pointer capture — never on
    // a deferred macrotask for a drag. Re-appending an already-connected node is a remove+insert
    // that RELEASES any pointer capture the moved node holds; deferred to mid-gesture it would
    // silently drop capture, and a fast flick whose first pointermove samples far from the
    // not-yet-moved card would then miss the (un-captured) host entirely — the drag dies with
    // `dragging` stuck true (a later cursor pass becomes a "ghost drag"). Reordering here, once,
    // before setPointerCapture means capture is established on the final reconnected host and
    // held for the whole gesture, so every pointermove/up is delivered regardless of cursor
    // position. A drag on the bar has no button click to swallow, so §2.6's macrotask deferral
    // (which exists only to protect button clicks) does not apply here.
    this.parentElement?.append(this);
    e.preventDefault(); // suppress text-selection/native-drag ghosting while dragging
    this.dragging = true;
    try {
      this.setPointerCapture(e.pointerId);
    } catch {
      // no-op — happy-dom 15.11.7 (this repo's unit-test DOM) does not implement pointer
      // capture at all; dragging still works via the plain pointermove/pointerup listeners
      // added below. Real Chromium (the e2e target) implements this normally.
    }
    const r = this.getBoundingClientRect();
    this.startPointer = { x: e.clientX, y: e.clientY };
    this.startRect = { left: r.left, top: r.top };
    this.addEventListener('pointermove', this.onPointerMove);
    this.addEventListener('pointerup', this.onPointerUp);
    this.addEventListener('pointercancel', this.onPointerUp);
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (!this.dragging) return;
    const dx = e.clientX - this.startPointer.x;
    const dy = e.clientY - this.startPointer.y;
    // Clamp so at least a 32px sliver of the card stays on-screen and grabbable in every
    // direction — never fully draggable off the viewport.
    const margin = 32;
    const left = Math.min(
      Math.max(this.startRect.left + dx, margin - this.offsetWidth),
      window.innerWidth - margin,
    );
    const top = Math.min(Math.max(this.startRect.top + dy, 0), window.innerHeight - margin);
    this.style.left = `${left}px`;
    this.style.top = `${top}px`;
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    try {
      this.releasePointerCapture(e.pointerId);
    } catch {
      // no-op — release throws harmlessly if capture was never established
    }
    this.endDrag();
  };

  private endDrag(): void {
    this.dragging = false;
    this.removeEventListener('pointermove', this.onPointerMove);
    this.removeEventListener('pointerup', this.onPointerUp);
    this.removeEventListener('pointercancel', this.onPointerUp);
  }
}
