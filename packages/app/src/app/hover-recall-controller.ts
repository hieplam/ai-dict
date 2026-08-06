/**
 * B4: caret hit-testing over B3's `PageHighlighter.ranges` + the hover-intent show/hide debounce.
 * No UI, no chrome.* — DOM access only (app/ tier, same precedent as page-highlighter.ts). See
 * design spec §2.1/§2.7 for the full rationale (why caret hit-testing, why the fallback path is
 * load-bearing given manifest.json's minimum_chrome_version, why each numeric default was picked).
 */

export interface CaretHit {
  node: Node;
  offset: number;
}

/** Injected so unit tests can control it — happy-dom has neither a real
 * `document.caretPositionFromPoint` nor `caretRangeFromPoint` (no layout engine). Production
 * code uses `defaultCaretAt` (exported for the platform-API-selection unit tests only; callers
 * should not need to invoke it directly). */
export type CaretLocator = (x: number, y: number) => CaretHit | null;

export interface HoverRecallControllerOpts {
  caretAt?: CaretLocator;
  /** Continuous hover over the same range before onMatch fires. Default 200. */
  hoverDelayMs?: number;
  /** Grace period after leaving the match/popup before onLeave fires. Default 250. */
  leaveDelayMs?: number;
}

export interface HoverRecallMatch {
  range: Range;
}

const SKIP_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'TEXTAREA',
  'INPUT',
  'SELECT',
  'BOTTOM-SHEET',
  'LOOKUP-TRIGGER',
  'HOVER-RECALL-POPUP',
]);

/** A small, intentionally duplicated subset of B3's own PageHighlighter skip-list (design spec
 * §2.7) — B3 does not export its predicate, and this card only needs the "don't treat the
 * extension's own UI as hoverable page content" half of it. */
function isSkippable(el: Element): boolean {
  if (SKIP_TAGS.has(el.tagName)) return true;
  if (el.tagName.startsWith('AD-')) return true;
  return (el as HTMLElement).isContentEditable === true;
}

/** Pure: does `hit` fall inside any of `ranges`? B3's PageHighlighter builds every range with a
 * single setStart/setEnd on ONE text node (findWordMatches never spans nodes), so a same-node +
 * offset-within-bounds check is exact — no DOM traversal needed. */
export function findHoverHit(hit: CaretHit | null, ranges: ReadonlyArray<Range>): Range | null {
  if (!hit) return null;
  for (const r of ranges) {
    if (r.startContainer === hit.node && hit.offset >= r.startOffset && hit.offset <= r.endOffset) {
      return r;
    }
  }
  return null;
}

/** The platform caret-lookup, modern API preferred, legacy API as the load-bearing fallback for
 * Chrome 116-124 (manifest.json's minimum_chrome_version predates caretPositionFromPoint, which
 * shipped in Chrome 125 — see design spec §2.1). Exported for the platform-selection unit tests. */
export function defaultCaretAt(x: number, y: number): CaretHit | null {
  const d = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  if (typeof d.caretPositionFromPoint === 'function') {
    const pos = d.caretPositionFromPoint(x, y);
    return pos ? { node: pos.offsetNode, offset: pos.offset } : null;
  }
  if (typeof d.caretRangeFromPoint === 'function') {
    const r = d.caretRangeFromPoint(x, y);
    return r ? { node: r.startContainer, offset: r.startOffset } : null;
  }
  return null; // neither API exists — graceful no-op, mirrors B3's CSS.highlights-undefined precedent
}

export class HoverRecallController {
  private readonly caretAt: CaretLocator;
  private readonly hoverDelayMs: number;
  private readonly leaveDelayMs: number;

  private rafScheduled = false;
  private lastXY: { x: number; y: number } | null = null;
  private candidate: Range | null = null;
  private matched: Range | null = null;
  private showTimer: ReturnType<typeof setTimeout> | null = null;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;

  private getRanges: (() => ReadonlyArray<Range>) | null = null;
  private onMatchCb: ((m: HoverRecallMatch) => void) | null = null;
  private onLeaveCb: (() => void) | null = null;
  private popupEl: Element | undefined;

  constructor(
    private readonly doc: Document,
    opts: HoverRecallControllerOpts = {},
  ) {
    this.caretAt = opts.caretAt ?? defaultCaretAt;
    this.hoverDelayMs = opts.hoverDelayMs ?? 200;
    this.leaveDelayMs = opts.leaveDelayMs ?? 250;
  }

  start(
    getRanges: () => ReadonlyArray<Range>,
    onMatch: (m: HoverRecallMatch) => void,
    onLeave: () => void,
    popupEl?: Element,
  ): void {
    this.getRanges = getRanges;
    this.onMatchCb = onMatch;
    this.onLeaveCb = onLeave;
    this.popupEl = popupEl;
    this.doc.addEventListener('mousemove', this.onMouseMove, { passive: true });
    this.doc.addEventListener('scroll', this.onImmediateLeave, true);
    this.doc.addEventListener('keydown', this.onKeydown);
    for (const t of ['mousedown', 'touchstart'] as const) {
      this.doc.addEventListener(t, this.onOutsidePress, true);
    }
  }

  stop(): void {
    this.doc.removeEventListener('mousemove', this.onMouseMove);
    this.doc.removeEventListener('scroll', this.onImmediateLeave, true);
    this.doc.removeEventListener('keydown', this.onKeydown);
    for (const t of ['mousedown', 'touchstart'] as const) {
      this.doc.removeEventListener(t, this.onOutsidePress, true);
    }
    this.clearShowTimer();
    this.clearHideTimer();
    this.candidate = null;
    this.matched = null;
    this.getRanges = null;
    this.onMatchCb = null;
    this.onLeaveCb = null;
  }

  private readonly onMouseMove = (e: MouseEvent): void => {
    this.lastXY = { x: e.clientX, y: e.clientY };
    if (this.rafScheduled) return;
    this.rafScheduled = true;
    requestAnimationFrame(() => {
      this.rafScheduled = false;
      if (this.lastXY) this.tick(this.lastXY.x, this.lastXY.y);
    });
  };

  private readonly onKeydown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') this.forceLeave();
  };

  private readonly onOutsidePress = (e: Event): void => {
    if (this.popupEl && e.composedPath().includes(this.popupEl)) return;
    this.forceLeave();
  };

  private readonly onImmediateLeave = (): void => {
    this.forceLeave();
  };

  private tick(x: number, y: number): void {
    if (!this.getRanges) return;
    const el = this.doc.elementFromPoint(x, y);
    if (this.popupEl && el && (el === this.popupEl || this.popupEl.contains(el))) {
      this.cancelHide();
      return;
    }
    if (this.doc.getSelection()?.isCollapsed === false) return this.scheduleLeave();
    if (el && isSkippable(el)) return this.scheduleLeave();

    const range = findHoverHit(this.caretAt(x, y), this.getRanges());
    if (!range) return this.scheduleLeave();

    if (this.matched === range) {
      this.cancelHide();
      return;
    }
    if (this.candidate !== range) {
      this.candidate = range;
      this.clearShowTimer();
      this.showTimer = setTimeout(() => {
        if (this.candidate === range) {
          this.matched = range;
          this.cancelHide();
          this.onMatchCb?.({ range });
        }
      }, this.hoverDelayMs);
    }
  }

  private scheduleLeave(): void {
    this.candidate = null;
    this.clearShowTimer();
    if (!this.matched || this.hideTimer) return;
    this.hideTimer = setTimeout(() => {
      this.hideTimer = null;
      this.matched = null;
      this.onLeaveCb?.();
    }, this.leaveDelayMs);
  }

  private forceLeave(): void {
    this.candidate = null;
    this.clearShowTimer();
    this.clearHideTimer();
    if (this.matched) {
      this.matched = null;
      this.onLeaveCb?.();
    }
  }

  private cancelHide(): void {
    this.clearHideTimer();
  }

  private clearShowTimer(): void {
    if (this.showTimer !== null) {
      clearTimeout(this.showTimer);
      this.showTimer = null;
    }
  }

  private clearHideTimer(): void {
    if (this.hideTimer !== null) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
  }
}
