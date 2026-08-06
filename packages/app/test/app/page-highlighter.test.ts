import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PageHighlighter } from '../../src/app/page-highlighter';

// ── CSS Custom Highlight API shim (spec §D4) ────────────────────────────────
// happy-dom implements neither `CSS.highlights` (a HighlightRegistry, Map-like: set/get/
// delete/has) nor the global `Highlight` class, so real browsers vs. this test env differ
// exactly on the feature this task guards ("no-op when CSS.highlights is undefined"). We shim
// both so the "supported" tests can run, and delete the shim for the "unsupported" test.
class FakeHighlight {
  private readonly items = new Set<Range>();
  constructor(...ranges: Range[]) {
    for (const r of ranges) this.items.add(r);
  }
  add(r: Range): this {
    this.items.add(r);
    return this;
  }
  delete(r: Range): boolean {
    return this.items.delete(r);
  }
  clear(): void {
    this.items.clear();
  }
  get size(): number {
    return this.items.size;
  }
  [Symbol.iterator](): IterableIterator<Range> {
    return this.items[Symbol.iterator]();
  }
}

function installHighlightsShim(): void {
  const g = globalThis as unknown as { CSS?: { highlights?: unknown }; Highlight?: unknown };
  // `CSS` resolves through a getter in this test runtime that manufactures a fresh object on
  // every read (a `CSS.highlights = new Map()` write on the *existing* `g.CSS` reference is
  // otherwise silently lost the next time anything reads `CSS`), so this must UNCONDITIONALLY
  // replace the binding with one stable plain object rather than mutate-in-place.
  g.CSS = { highlights: new Map<string, FakeHighlight>() };
  g.Highlight = FakeHighlight;
}

function removeHighlightsShim(): void {
  const g = globalThis as unknown as { CSS?: { highlights?: unknown }; Highlight?: unknown };
  if (g.CSS) delete g.CSS.highlights;
  delete g.Highlight;
}

function styleEls(): NodeListOf<Element> {
  return document.head.querySelectorAll('[data-ad-b3]');
}

/** Drive the idle-chunked pipeline (setTimeout(fn,0) fallback in this env) to completion. */
async function drive(): Promise<void> {
  await vi.runAllTimersAsync();
}

beforeEach(() => {
  vi.useFakeTimers();
  installHighlightsShim();
  document.body.innerHTML = '';
  document.head.innerHTML = '';
});

afterEach(() => {
  vi.useRealTimers();
  removeHighlightsShim();
  document.body.innerHTML = '';
  document.head.innerHTML = '';
});

describe('PageHighlighter (B3 re-encounter highlighting — idle-chunked scan)', () => {
  it('constructor + apply([]) (empty words): no style injected, no scan, ranges empty', async () => {
    document.body.innerHTML = '<p>bank</p>';
    const highlighter = new PageHighlighter(document);
    highlighter.apply([]);
    await drive();
    expect(styleEls().length).toBe(0);
    expect(highlighter.ranges.length).toBe(0);
  });

  it('apply(["bank"]) highlights "bank"/"banks" plain text but skips script/textarea/contenteditable/bottom-sheet', async () => {
    document.body.innerHTML = `
      <p>The bank tellers count banks daily.</p>
      <script>var bank = 1;</script>
      <textarea>bank</textarea>
      <div contenteditable="true">bank</div>
      <bottom-sheet>bank</bottom-sheet>
    `;
    const highlighter = new PageHighlighter(document);
    highlighter.apply(['bank']);
    await drive();

    expect(highlighter.ranges.length).toBe(2);
    const texts = highlighter.ranges.map((r) => r.toString()).sort();
    expect(texts).toEqual(['bank', 'banks']);
  });

  it('injects the style element exactly once across an apply then a refresh', async () => {
    document.body.innerHTML = '<p>bank</p>';
    const highlighter = new PageHighlighter(document);
    highlighter.apply(['bank']);
    await drive();
    expect(styleEls().length).toBe(1);

    highlighter.refresh(['bank']);
    await drive();
    expect(styleEls().length).toBe(1);
  });

  it('clear() removes the style element + empties ranges, and is idempotent', async () => {
    document.body.innerHTML = '<p>bank</p>';
    const highlighter = new PageHighlighter(document);
    highlighter.apply(['bank']);
    await drive();
    expect(styleEls().length).toBe(1);
    expect(highlighter.ranges.length).toBe(1);

    highlighter.clear();
    expect(styleEls().length).toBe(0);
    expect(highlighter.ranges.length).toBe(0);

    // second clear() is a safe no-op
    expect(() => highlighter.clear()).not.toThrow();
    expect(styleEls().length).toBe(0);
    expect(highlighter.ranges.length).toBe(0);
  });

  it('refresh() with a word list that drops a previously-highlighted word drops its ranges', async () => {
    document.body.innerHTML = '<p>The bank by the river.</p>';
    const highlighter = new PageHighlighter(document);
    highlighter.apply(['bank', 'river']);
    await drive();
    expect(highlighter.ranges.map((r) => r.toString()).sort()).toEqual(['bank', 'river']);

    highlighter.refresh(['bank']);
    await drive();
    expect(highlighter.ranges.map((r) => r.toString())).toEqual(['bank']);
  });

  it('clear() before the mutation-debounce timer fires cancels it safely (no throw, ranges stay empty)', async () => {
    // Real timers only for this test: happy-dom's MutationObserver delivery does not advance
    // under vi's fake-timer clock in this runtime (verified — `vi.advanceTimersByTimeAsync`
    // never delivers the mutation record here), so faking time would make this test a no-op
    // that passes for the wrong reason. `vi.useRealTimers()` overrides the file-level
    // `beforeEach`'s `vi.useFakeTimers()`; the file-level `afterEach` restores real timers
    // regardless, so no other test is affected.
    vi.useRealTimers();
    document.body.innerHTML = '<p>bank</p>';
    const highlighter = new PageHighlighter(document);
    highlighter.apply(['bank']);
    await new Promise((r) => setTimeout(r, 50)); // let the initial idle-chunked scan settle

    // Trigger a mutation and let the MutationObserver callback actually run, which schedules
    // the 1000ms debounce timer (MUTATION_DEBOUNCE_MS) — this is the pending timer under test.
    const extra = document.createElement('p');
    extra.textContent = 'bank';
    document.body.appendChild(extra);
    await new Promise((r) => setTimeout(r, 50));

    expect(() => highlighter.clear()).not.toThrow(); // cancel the pending debounce timer

    // Wait past MUTATION_DEBOUNCE_MS: if clear() had NOT cancelled the timer, it would fire
    // here and add the second "bank" range from `extra`. It must not.
    await new Promise((r) => setTimeout(r, 1200));
    expect(highlighter.ranges.length).toBe(0);
  }, 5000);

  it('no-ops entirely when CSS.highlights is truly absent (no throw, no style, empty ranges)', async () => {
    removeHighlightsShim(); // simulate a browser without the Custom Highlight API
    document.body.innerHTML = '<p>bank</p>';
    const highlighter = new PageHighlighter(document);
    expect(() => highlighter.apply(['bank'])).not.toThrow();
    await drive();
    expect(styleEls().length).toBe(0);
    expect(highlighter.ranges.length).toBe(0);
  });
});
