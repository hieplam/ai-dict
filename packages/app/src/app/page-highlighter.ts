/**
 * B3: re-encounter highlighting — idle-chunked page scanner (spec §D4/§D5).
 *
 * Walks the page's text nodes off the main thread's busy path (`requestIdleCallback`, falling
 * back to `setTimeout(fn, 0)` where absent — e.g. happy-dom in tests), matches learning
 * headwords via the pure `domain/highlight-policy` matcher, and paints matches with the CSS
 * Custom Highlight API (`::highlight(ad-saved-word)`) — no mutation of the underlying text
 * nodes. Lives in `app/` (not `domain/`) because it touches the DOM directly
 * (rule-domain-purity: DOM access is allowed in app/, never in domain/).
 */
import { buildHighlightMatcher, findWordMatches } from '../domain/highlight-policy';
import { BASE_VARS } from '../ui/styles/tokens';

const STYLE_ATTR = 'data-ad-b3';
const HIGHLIGHT_NAME = 'ad-saved-word';
const MUTATION_DEBOUNCE_MS = 1000;
const DEFAULT_CHUNK_BUDGET_MS = 8;
const DEFAULT_MAX_TEXT_NODES = 50_000;
const SCAN_MARK = 'ad-highlight-scan:start';
const SCAN_MEASURE = 'ad-highlight-scan';

// Ancestor tag names that must never be scanned (native form/script surfaces + this
// extension's own in-page hosts). `AD-*` custom elements are excluded by prefix, below.
const SKIP_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'TEXTAREA',
  'INPUT',
  'SELECT',
  'BOTTOM-SHEET',
  'LOOKUP-TRIGGER',
]);

function supportsHighlights(): boolean {
  return typeof CSS !== 'undefined' && !!CSS.highlights;
}

// `.isContentEditable` is checked first (spec-correct: reflects inherited editability in real
// browsers), with the `contenteditable` attribute as a fallback so an element carrying the
// attribute is caught even where `.isContentEditable` isn't computed.
function isEditable(el: Element): boolean {
  if ((el as HTMLElement).isContentEditable) return true;
  const attr = el.getAttribute('contenteditable');
  return attr !== null && attr !== 'false';
}

function isSkippedElement(el: Element): boolean {
  if (SKIP_TAGS.has(el.tagName) || el.tagName.startsWith('AD-')) return true;
  return isEditable(el);
}

/**
 * TreeWalker filter, called for every node under whatToShow=SHOW_ALL (not SHOW_TEXT — see
 * below): rejects a skip-listed element's whole subtree, accepts everything else (elements are
 * walked through transparently; only `processTextNode` cares about actual Text nodes).
 *
 * whatToShow is SHOW_ALL rather than the spec's literal SHOW_TEXT because this project's pinned
 * happy-dom test runtime (15.11.7) mis-implements the "type doesn't match whatToShow" implicit
 * FILTER_SKIP as a FILTER_REJECT (TreeWalker.js firstChild()/nextSibling() fall through to
 * sibling search instead of recursing into the mismatched node's children), so a SHOW_TEXT-only
 * walk never finds text nested under any element — it can never leave RED in this repo's test
 * suite. SHOW_ALL sidesteps the type-mismatch path entirely (this filter always returns ACCEPT
 * or REJECT, never relying on an implicit type-based SKIP), which is correct in both this
 * runtime and every real browser, with identical results (only Text nodes are ever turned into
 * Ranges; skip-listed subtrees are still pruned via REJECT, which happy-dom implements
 * correctly).
 */
function treeWalkerFilter(node: Node): number {
  if (node.nodeType === Node.ELEMENT_NODE && isSkippedElement(node as Element)) {
    return NodeFilter.FILTER_REJECT;
  }
  return NodeFilter.FILTER_ACCEPT;
}

export class PageHighlighter {
  private readonly chunkBudgetMs: number;
  private readonly maxTextNodes: number;

  private matcher: Map<string, string> = new Map();
  private styleEl: HTMLStyleElement | null = null;
  private observer: MutationObserver | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private highlight: Highlight | null = null;
  private collected: Range[] = [];

  private walker: TreeWalker | null = null;
  private pendingRoots: Node[] = [];
  private mutationBuffer: Node[] = [];
  private textNodeCount = 0;
  private chunkScheduled = false;
  private initialScanActive = false;
  private scanMarked = false;

  constructor(
    private readonly doc: Document,
    opts?: { chunkBudgetMs?: number; maxTextNodes?: number },
  ) {
    this.chunkBudgetMs = opts?.chunkBudgetMs ?? DEFAULT_CHUNK_BUDGET_MS;
    this.maxTextNodes = opts?.maxTextNodes ?? DEFAULT_MAX_TEXT_NODES;
  }

  /** Test seam: ranges collected so far (readonly). */
  get ranges(): ReadonlyArray<Range> {
    return this.collected;
  }

  /** Build matcher from learning headwords and start the idle-chunked scan + mutation watch. */
  apply(words: string[]): void {
    if (!supportsHighlights() || words.length === 0) return;
    this.matcher = buildHighlightMatcher(words);
    this.injectStyle();
    this.startScan();
    this.ensureObserver();
  }

  /** Clear painted ranges + re-apply with a fresh word list (this-tab save/status changes). */
  refresh(words: string[]): void {
    this.collected = [];
    this.walker = null;
    this.pendingRoots = [];
    this.highlight?.clear();
    this.apply(words);
  }

  /** Remove highlight registration, style element, observer. Idempotent. */
  clear(): void {
    if (supportsHighlights()) CSS.highlights.delete(HIGHLIGHT_NAME);
    this.styleEl?.remove();
    this.styleEl = null;
    this.observer?.disconnect();
    this.observer = null;
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.walker = null;
    this.pendingRoots = [];
    this.mutationBuffer = [];
    this.collected = [];
    this.highlight = null;
    this.matcher = new Map();
    this.initialScanActive = false;
  }

  private injectStyle(): void {
    if (this.styleEl) return;
    const style = this.doc.createElement('style');
    style.setAttribute(STYLE_ATTR, '');
    style.textContent =
      `:root{${BASE_VARS}}` +
      `::highlight(${HIGHLIGHT_NAME}){text-decoration:underline 2px dotted var(--ad-accent);text-underline-offset:2px}`;
    this.doc.head.appendChild(style);
    this.styleEl = style;
  }

  private startScan(): void {
    this.highlight = new Highlight();
    CSS.highlights.set(HIGHLIGHT_NAME, this.highlight);
    this.walker = null;
    this.pendingRoots = [this.doc.body];
    this.initialScanActive = true;
    this.scanMarked = false;
    this.scheduleChunk();
  }

  private ensureObserver(): void {
    if (this.observer) return;
    this.observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of Array.from(m.addedNodes)) {
          if (node.nodeType === Node.ELEMENT_NODE) this.mutationBuffer.push(node);
        }
      }
      if (this.mutationBuffer.length === 0) return;
      if (this.debounceTimer !== null) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = null;
        const roots = this.mutationBuffer.splice(0);
        if (roots.length === 0 || this.textNodeCount >= this.maxTextNodes) return;
        this.pendingRoots.push(...roots);
        this.scheduleChunk();
      }, MUTATION_DEBOUNCE_MS);
    });
    this.observer.observe(this.doc.body, { childList: true, subtree: true });
  }

  private scheduleChunk(): void {
    if (this.chunkScheduled || this.textNodeCount >= this.maxTextNodes) return;
    this.chunkScheduled = true;
    const run = (): void => {
      this.chunkScheduled = false;
      this.runChunk();
    };
    if (typeof requestIdleCallback !== 'undefined') {
      requestIdleCallback(run);
    } else {
      setTimeout(run, 0);
    }
  }

  private runChunk(): void {
    if (this.textNodeCount >= this.maxTextNodes) return;
    if (this.initialScanActive && !this.scanMarked) {
      performance.mark(SCAN_MARK);
      this.scanMarked = true;
    }

    const budgetEnd = performance.now() + this.chunkBudgetMs;
    while (performance.now() < budgetEnd) {
      if (!this.walker) {
        const root = this.pendingRoots.shift();
        if (!root) break; // nothing queued right now — wait for more work
        this.walker = this.doc.createTreeWalker(root, NodeFilter.SHOW_ALL, treeWalkerFilter);
      }
      const node = this.walker.nextNode();
      if (!node) {
        this.walker = null;
        continue;
      }
      if (node.nodeType === Node.TEXT_NODE) {
        this.processTextNode(node as Text);
        this.textNodeCount += 1;
        if (this.textNodeCount >= this.maxTextNodes) break; // lifetime perf fence
      }
    }

    if (supportsHighlights() && this.highlight) {
      CSS.highlights.set(HIGHLIGHT_NAME, this.highlight);
    }

    const hasMoreWork = this.walker !== null || this.pendingRoots.length > 0;
    if (hasMoreWork && this.textNodeCount < this.maxTextNodes) {
      this.scheduleChunk();
    } else if (this.initialScanActive) {
      this.initialScanActive = false;
      performance.measure(SCAN_MEASURE, SCAN_MARK);
    }
  }

  private processTextNode(node: Text): void {
    const text = node.textContent ?? '';
    const matches = findWordMatches(text, this.matcher);
    for (const match of matches) {
      const range = this.doc.createRange();
      range.setStart(node, match.start);
      range.setEnd(node, match.end);
      this.collected.push(range);
      this.highlight?.add(range);
    }
  }
}
