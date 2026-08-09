import type { SelectionSource, SelectionEvent, AnchorRect } from '../index';

const TERMINATORS = ['.', '!', '?'];

// A15: cheap, permanent instrumentation mark — the earliest synchronous JS observation of "the
// browser told us the selection gesture ended." See docs/superpowers/specs/
// 2026-07-17-a15-trigger-latency-budget-design.md §3.
export const SELECTION_FIRED_MARK = 'ai-dict:selection-fired';

export function extractSentence(full: string, selStart: number, selEnd: number): string {
  const before = full.slice(0, selStart);
  const start = Math.max(...TERMINATORS.map((t) => before.lastIndexOf(t))) + 1;
  const after = full.slice(selEnd);
  const ends = TERMINATORS.map((t) => after.indexOf(t)).filter((i) => i >= 0);
  const end = ends.length ? selEnd + Math.min(...ends) + 1 : full.length;
  return full.slice(start, end).trim();
}

// Default DOM reader: window selection → SelectionEvent. Thin + covered by e2e; unit tests inject a fake.
function defaultReader(): SelectionEvent | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const text = sel.toString().trim();
  if (!text) return null;
  const range = sel.getRangeAt(0);
  const full = range.startContainer.textContent ?? text;
  const r = range.getBoundingClientRect();
  const anchor: AnchorRect = { x: r.x, y: r.y, w: r.width, h: r.height };
  // A2: a selection whose start lands inside the currently-rendered definition body (marked
  // `.lookup-answer` by lookup-card.ts's renderCardState) is an in-definition "recursive lookup"
  // attempt, not an ordinary page selection — runLookupWorkflow uses this to decide whether to
  // extend the lookup chain (push) or start a fresh one (reset). See domain/workflow.ts and the
  // design spec §2/§7.2 for the full rationale.
  const startEl =
    range.startContainer instanceof Element
      ? range.startContainer
      : range.startContainer.parentElement;
  const insideResult = startEl?.closest('.lookup-answer') != null;
  return {
    text,
    sentence: extractSentence(full, range.startOffset, range.endOffset),
    anchor,
    url: location.href,
    title: document.title,
    ...(insideResult ? { insideResult: true } : {}),
  };
}

type DocEvents = Pick<Document, 'addEventListener' | 'removeEventListener'>;

export class DomSelectionSource implements SelectionSource {
  constructor(
    private readonly doc: DocEvents,
    private readonly read: () => SelectionEvent | null = defaultReader,
  ) {}

  onSelection(cb: (e: SelectionEvent) => void): () => void {
    const handler = (): void => {
      const e = this.read();
      if (e) {
        performance.mark(SELECTION_FIRED_MARK);
        cb(e);
      }
    };
    for (const t of ['mouseup', 'touchend'] as const) this.doc.addEventListener(t, handler);
    return () => {
      for (const t of ['mouseup', 'touchend'] as const) this.doc.removeEventListener(t, handler);
    };
  }
}
