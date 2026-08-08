import type { SavedWordEntry, SavedWordStatus } from '../domain/types';
import {
  filterAndSortSavedWords,
  siteFilterOptions,
  UNKNOWN_SITE,
  DEFAULT_WORDS_FILTER,
  type WordsFilterState,
} from '../domain/words-page-policy';
import { adoptStyles } from './styles/adopt';
import { BASE_VARS, THEME_CSS, ICON_BACK, ICON_TRASH } from './styles/tokens';

const CSS = `:host{${BASE_VARS};display:flex;flex-direction:column;height:100dvh;box-sizing:border-box;font:var(--adp-text-body)/var(--adp-leading-body) var(--adp-font-sans);color:var(--ad-ink);background:var(--ad-glow),var(--ad-surface);color-scheme:light}
${THEME_CSS}
*{box-sizing:border-box}
::selection{background:var(--ad-selection)}
.accent{height:3px;flex:none;background:linear-gradient(90deg,var(--ad-accent),var(--ad-warm) 92%)}
header{display:flex;align-items:center;gap:8px;padding:13px 18px 8px;flex:none}
.back{display:inline-grid;place-items:center;width:var(--adp-action-size);height:var(--adp-action-size);border:0;background:transparent;color:var(--ad-ink-faint);border-radius:var(--adp-radius-control);cursor:pointer;font:inherit;transition:background var(--adp-dur-fast) var(--adp-ease),color var(--adp-dur-fast) var(--adp-ease)}
.back:hover{background:var(--ad-surface-raised);color:var(--ad-ink)}
.back:focus-visible{outline:2px solid var(--ad-accent);outline-offset:2px}
.back svg{width:16px;height:16px;pointer-events:none}
.title{font-size:var(--adp-text-sm);font-weight:var(--adp-weight-bold);letter-spacing:var(--adp-tracking-label);color:var(--ad-accent-ink)}
.count{margin-left:auto;font-size:var(--adp-text-2xs);color:var(--ad-ink-faint)}
.controls{display:flex;flex-wrap:wrap;gap:6px;padding:0 18px 10px;flex:none}
.search{flex:1 1 100%;min-width:0;padding:8px 12px;border:1px solid var(--ad-line);border-radius:var(--adp-radius-control);background:var(--ad-surface-sunken);color:var(--ad-ink);font:inherit;font-size:var(--adp-text-sm)}
.search:focus-visible{outline:2px solid var(--ad-accent);outline-offset:2px}
select{appearance:none;cursor:pointer;flex:1 1 auto;min-width:0;padding:7px 30px 7px 10px;border:1px solid var(--ad-line);border-radius:var(--adp-radius-control);background:var(--ad-surface-sunken);color:var(--ad-ink);font:inherit;font-size:var(--adp-text-xs);background-image:linear-gradient(45deg,transparent 50%,var(--ad-ink-faint) 50%),linear-gradient(135deg,var(--ad-ink-faint) 50%,transparent 50%);background-position:calc(100% - 16px) 50%,calc(100% - 11px) 50%;background-size:5px 5px,5px 5px;background-repeat:no-repeat}
select:focus-visible{outline:2px solid var(--ad-accent);outline-offset:2px}
main{flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:0 18px 14px}
.word-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:2px}
.word-row{display:flex;align-items:center;gap:6px;padding:9px 0;border-top:1px solid var(--ad-line)}
.word-row:first-child{border-top:0}
.word-main{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:1px}
.word-text{font-size:14px;font-weight:var(--adp-weight-semi);color:var(--ad-ink)}
.word-context{font-size:var(--adp-text-xs);line-height:1.4;color:var(--ad-ink-soft);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.status-btn{flex:none;border:1px solid var(--ad-line);background:transparent;color:var(--ad-ink-soft);border-radius:var(--adp-radius-control);padding:5px 10px;font:inherit;font-size:var(--adp-text-2xs);font-weight:var(--adp-weight-semi);cursor:pointer;transition:background var(--adp-dur-fast) var(--adp-ease),color var(--adp-dur-fast) var(--adp-ease),border-color var(--adp-dur-fast) var(--adp-ease)}
.status-btn:hover{background:var(--ad-surface-raised);color:var(--ad-ink)}
.status-btn:focus-visible{outline:2px solid var(--ad-accent);outline-offset:2px}
.status-btn[aria-pressed="true"]{border-color:var(--ad-accent);color:var(--ad-accent-ink)}
.del-btn{flex:none;display:inline-grid;place-items:center;width:var(--adp-action-size);height:var(--adp-action-size);border:0;background:transparent;color:var(--ad-ink-faint);border-radius:var(--adp-radius-control);cursor:pointer;font:inherit}
.del-btn:hover{background:var(--ad-surface-raised);color:var(--ad-error)}
.del-btn:focus-visible{outline:2px solid var(--ad-accent);outline-offset:2px}
.del-btn svg{width:14px;height:14px;pointer-events:none}
.empty-row{padding:40px 6px;text-align:center;color:var(--ad-ink-soft);font-size:var(--adp-text-sm);line-height:1.55}
@media (prefers-reduced-motion:reduce){.back{transition:none}.status-btn{transition:none}}`;

function statusLabel(s: SavedWordStatus): string {
  return s === 'known' ? 'Known' : 'Learning';
}

export class WordsPageView extends HTMLElement {
  private _entries: SavedWordEntry[] = [];
  private _filter: WordsFilterState = { ...DEFAULT_WORDS_FILTER };
  private countEl!: HTMLElement;
  private searchEl!: HTMLInputElement;
  private statusEl!: HTMLSelectElement;
  private siteEl!: HTMLSelectElement;
  private sortEl!: HTMLSelectElement;
  private listEl!: HTMLUListElement;

  connectedCallback(): void {
    if (this.shadowRoot) {
      this.renderList();
      return;
    }
    const root = this.attachShadow({ mode: 'open' });
    adoptStyles(root, CSS);

    const accent = document.createElement('div');
    accent.className = 'accent';
    accent.setAttribute('aria-hidden', 'true');

    const header = document.createElement('header');
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'back';
    back.setAttribute('aria-label', 'Back to lookup');
    back.innerHTML = ICON_BACK; // s4: static-template — decorative aria-hidden SVG; name comes from aria-label
    back.addEventListener('click', () =>
      this.dispatchEvent(new CustomEvent('back', { bubbles: true, composed: true })),
    );
    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = 'My Words';
    this.countEl = document.createElement('span');
    this.countEl.className = 'count';
    header.append(back, title, this.countEl);

    const controls = document.createElement('div');
    controls.className = 'controls';

    this.searchEl = document.createElement('input');
    this.searchEl.type = 'search';
    this.searchEl.className = 'search';
    this.searchEl.placeholder = 'Search your words…';
    this.searchEl.setAttribute('aria-label', 'Search saved words');
    this.searchEl.addEventListener('input', () => {
      this._filter = { ...this._filter, query: this.searchEl.value };
      this.renderList();
    });

    this.statusEl = document.createElement('select');
    this.statusEl.className = 'status-filter';
    this.statusEl.setAttribute('aria-label', 'Filter by status');
    // s4: static-template — fixed set of literal status labels, no model content
    this.statusEl.innerHTML =
      '<option value="all">All statuses</option>' +
      '<option value="learning">Learning</option>' +
      '<option value="known">Known</option>';
    this.statusEl.addEventListener('change', () => {
      this._filter = {
        ...this._filter,
        status: this.statusEl.value as WordsFilterState['status'],
      };
      this.renderList();
    });

    this.siteEl = document.createElement('select');
    this.siteEl.className = 'site-filter';
    this.siteEl.setAttribute('aria-label', 'Filter by site');
    this.siteEl.addEventListener('change', () => {
      this._filter = { ...this._filter, site: this.siteEl.value };
      this.renderList();
    });

    this.sortEl = document.createElement('select');
    this.sortEl.className = 'sort';
    this.sortEl.setAttribute('aria-label', 'Sort');
    // s4: static-template — fixed set of literal sort labels, no model content
    this.sortEl.innerHTML =
      '<option value="newest">Newest first</option>' +
      '<option value="oldest">Oldest first</option>' +
      '<option value="alpha">A–Z</option>';
    this.sortEl.addEventListener('change', () => {
      this._filter = { ...this._filter, sort: this.sortEl.value as WordsFilterState['sort'] };
      this.renderList();
    });

    controls.append(this.searchEl, this.statusEl, this.siteEl, this.sortEl);

    const main = document.createElement('main');
    this.listEl = document.createElement('ul');
    this.listEl.className = 'word-list';
    this.listEl.setAttribute('aria-label', 'Saved words');
    main.append(this.listEl);

    root.append(accent, header, controls, main);
    this.refreshSiteOptions();
    this.renderList();
  }

  /** The full, unfiltered saved-word collection — set once by the composition root after a
   * saved.list round trip (or optimistically patched after a status/delete action). */
  set entries(list: SavedWordEntry[]) {
    this._entries = list;
    this.refreshSiteOptions();
    if (this.shadowRoot) this.renderList();
  }
  get entries(): SavedWordEntry[] {
    return this._entries;
  }

  private refreshSiteOptions(): void {
    if (!this.siteEl) return;
    const current = this.siteEl.value || 'all';
    const options = siteFilterOptions(this._entries);
    const frag = document.createDocumentFragment();
    const allOpt = document.createElement('option');
    allOpt.value = 'all';
    allOpt.textContent = 'All sites';
    frag.append(allOpt);
    for (const s of options) {
      const opt = document.createElement('option');
      opt.value = s;
      opt.textContent = s === UNKNOWN_SITE ? 'Unknown site' : s;
      frag.append(opt);
    }
    this.siteEl.replaceChildren(frag);
    const stillExists = current === 'all' || options.includes(current);
    this.siteEl.value = stillExists ? current : 'all';
    if (!stillExists) this._filter = { ...this._filter, site: 'all' };
  }

  private renderList(): void {
    const filtered = filterAndSortSavedWords(this._entries, this._filter);
    this.countEl.textContent = `${filtered.length} of ${this._entries.length}`;
    if (this._entries.length === 0) {
      this.listEl.replaceChildren(
        this.emptyRow('No saved words yet — tap the star on a lookup to start your list.'),
      );
      return;
    }
    if (filtered.length === 0) {
      this.listEl.replaceChildren(this.emptyRow('No words match your search and filters.'));
      return;
    }
    this.listEl.replaceChildren(...filtered.map((e) => this.wordRow(e)));
  }

  private emptyRow(text: string): HTMLLIElement {
    const li = document.createElement('li');
    li.className = 'empty-row';
    li.textContent = text;
    return li;
  }

  private wordRow(entry: SavedWordEntry): HTMLLIElement {
    const li = document.createElement('li');
    li.className = 'word-row';

    const main = document.createElement('div');
    main.className = 'word-main';
    const word = document.createElement('span');
    word.className = 'word-text';
    word.textContent = entry.word;
    main.append(word);
    const sentence = entry.senses[0]?.sentence;
    if (sentence) {
      const ctx = document.createElement('span');
      ctx.className = 'word-context';
      ctx.textContent = sentence; // plain text, never innerHTML — S4 is a non-issue by design
      main.append(ctx);
    }

    const isKnown = entry.status === 'known';
    const statusBtn = document.createElement('button');
    statusBtn.type = 'button';
    statusBtn.className = 'status-btn';
    statusBtn.setAttribute('aria-pressed', String(isKnown));
    statusBtn.setAttribute(
      'aria-label',
      isKnown ? `Mark ${entry.word} as learning` : `Mark ${entry.word} as known`,
    );
    statusBtn.textContent = statusLabel(entry.status);
    statusBtn.addEventListener('click', () => {
      const next: SavedWordStatus = isKnown ? 'learning' : 'known';
      this.dispatchEvent(
        new CustomEvent('toggle-status', {
          detail: { word: entry.word, status: next },
          bubbles: true,
          composed: true,
        }),
      );
    });

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'del-btn';
    delBtn.setAttribute('aria-label', `Delete ${entry.word} from your word list`);
    delBtn.innerHTML = ICON_TRASH; // s4: static-template — decorative aria-hidden SVG; name comes from aria-label
    delBtn.addEventListener('click', () =>
      this.dispatchEvent(
        new CustomEvent('delete-word', {
          detail: { word: entry.word },
          bubbles: true,
          composed: true,
        }),
      ),
    );

    li.append(main, statusBtn, delBtn);
    return li;
  }
}
