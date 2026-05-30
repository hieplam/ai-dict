import type { SelectionSource, SelectionEvent, AnchorRect } from '@ai-dict/core';

const TERMINATORS = ['.', '!', '?'];

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
  return { text, sentence: extractSentence(full, range.startOffset, range.endOffset), anchor, url: location.href, title: document.title };
}

type DocEvents = Pick<Document, 'addEventListener' | 'removeEventListener'>;

export class DomSelectionSource implements SelectionSource {
  constructor(private readonly doc: DocEvents, private readonly read: () => SelectionEvent | null = defaultReader) {}

  onSelection(cb: (e: SelectionEvent) => void): () => void {
    const handler = (): void => { const e = this.read(); if (e) cb(e); };
    for (const t of ['mouseup', 'touchend'] as const) this.doc.addEventListener(t, handler);
    return () => { for (const t of ['mouseup', 'touchend'] as const) this.doc.removeEventListener(t, handler); };
  }
}
