import type { HistoryEntry } from '../domain/types';
import { adoptStyles } from './styles/adopt';
import { BASE_VARS, THEME_CSS, BRAND_MARK_SVG, ICON_SHIELD, ICON_TRASH } from './styles/tokens';
import { renderCardState, ICON_SETTINGS, type CardState } from './lookup-card';

/**
 * What the panel's single "focus" region shows. It mirrors the in-page card's three
 * states, plus an `empty` first-run state unique to this persistent surface: the panel
 * opens before any lookup exists, so it must teach the interface rather than fake a
 * loading spinner (the bug the old side panel shipped — it reused the floating card,
 * which defaults to `{kind:'loading'}`).
 */
export type PanelFocusState = CardState | { kind: 'empty' };

// ICON_SHIELD / ICON_TRASH are the canonical §5.10 set imported from tokens.ts (centralized so
// the glyphs can never drift); ICON_SETTINGS is re-exported through lookup-card.

// The panel IS the Paperlight surface (full-height, edge-to-edge, docked), so unlike the floating
// lookup-card it carries NO border-radius and NO drop shadow and NO close button — re-framing a
// docked panel as a floating card would double the surface and break the One Surface Rule. The
// warm glow and palette stay; depth comes from the host browser chrome, not a shadow.
//
// Content for the focus region is rendered with the shared `renderCardState` helper, but here the
// nodes live directly in this shadow tree (the panel is a single-world extension page, not a
// cross-world content script), so the card's `::slotted(...)` rules are restated as direct-child
// `.focus ...` selectors. The headword stays the one serif; the recent list is sans (One Serif Rule).
//
// Layout: the host is a column pinned to EXACTLY the panel viewport (`height:100dvh`, not
// `min-height`) so the accent strip/header/footer stay fixed and only `main` scrolls. `main` needs
// the explicit `min-height:0` to override a flex item's default `min-height:auto`, which would
// otherwise refuse to shrink below its content and let a long definition overflow the host (the
// scroll then lands on the whole document) instead of scrolling inside `main`.
const CSS = `:host{${BASE_VARS};display:flex;flex-direction:column;height:100dvh;box-sizing:border-box;font:var(--adp-text-body)/var(--adp-leading-body) var(--adp-font-sans);color:var(--ad-ink);background:var(--ad-glow),var(--ad-surface);color-scheme:light}
${THEME_CSS}
*{box-sizing:border-box}
::selection{background:var(--ad-selection)}
.accent{height:3px;flex:none;background:linear-gradient(90deg,var(--ad-accent),var(--ad-warm) 92%)}
header{display:flex;align-items:center;gap:8px;padding:13px 18px 11px;flex:none}
.brand{display:inline-flex;align-items:center;gap:8px;font-size:var(--adp-text-sm);font-weight:var(--adp-weight-bold);letter-spacing:var(--adp-tracking-label);color:var(--ad-accent-ink)}
.settings{display:inline-grid;place-items:center;width:var(--adp-action-size);height:var(--adp-action-size);margin-left:auto;border:0;background:transparent;color:var(--ad-ink-faint);border-radius:var(--adp-radius-control);cursor:pointer;font:inherit;transition:background var(--adp-dur-fast) var(--adp-ease),color var(--adp-dur-fast) var(--adp-ease)}
.settings:hover{background:var(--ad-surface-raised);color:var(--ad-ink)}
.settings:focus-visible{outline:2px solid var(--ad-accent);outline-offset:2px}
.settings svg{width:15px;height:15px;pointer-events:none}
.mark{width:22px;height:22px;flex:none}
main{flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:0 18px}
.focus{padding:6px 0 10px}
.focus h2{font-family:var(--adp-font-serif);font-size:1.8rem;line-height:var(--adp-leading-tight);letter-spacing:var(--adp-tracking-head);margin:.1em 0 .45em;color:var(--ad-ink);display:inline-block;max-width:100%;overflow-wrap:anywhere;padding-bottom:6px;background:linear-gradient(90deg,var(--ad-accent),var(--ad-warm)) left bottom/46px 3px no-repeat}
.focus p{margin:.5em 0}
.focus ul,.focus ol{margin:.5em 0;padding-left:1.3em}
.focus li{margin:.2em 0}
.focus blockquote{margin:.6em 0;padding-left:12px;color:var(--ad-ink-soft);font-style:italic}
.focus code{font-family:var(--adp-font-mono);font-size:.92em;background:var(--ad-surface-sunken);padding:.1em .35em;border-radius:5px}
.focus a{color:var(--ad-accent-ink);text-underline-offset:2px}
.focus .err{color:var(--ad-error);font-weight:500}
.focus .mark{display:block;width:34px;height:34px;margin:20px auto 2px}
.focus .setup-title{text-align:center;margin:10px 0 0;font-size:var(--adp-text-lg);font-weight:var(--adp-weight-bold);color:var(--ad-ink)}
.focus .setup-text{text-align:center;margin:7px auto 0;max-width:32ch;font-size:14px;line-height:1.55;color:var(--ad-ink-soft)}
.focus .setup-cta{display:block;margin:18px auto 6px;padding:10px 20px;border:0;border-radius:var(--adp-radius-control);background:var(--ad-accent);color:var(--ad-on-accent);font:inherit;font-size:14px;font-weight:var(--adp-weight-semi);cursor:pointer}
.focus .setup-cta:hover{filter:brightness(1.06)}
.focus .setup-cta:focus-visible{outline:2px solid var(--ad-accent);outline-offset:2px}
.empty{display:flex;flex-direction:column;align-items:center;text-align:center;gap:10px;padding:48px 12px 40px;color:var(--ad-ink-soft)}
.empty .mark{width:40px;height:40px;opacity:.9}
.empty-title{margin:0;font-size:var(--adp-text-lg);font-weight:var(--adp-weight-semi);color:var(--ad-ink)}
.empty-hint{margin:0;max-width:30ch;font-size:var(--adp-text-sm);line-height:1.55;color:var(--ad-ink-soft)}
.empty-hint b{color:var(--ad-ink);font-weight:var(--adp-weight-semi)}
.recent{margin-top:6px}
.recent[hidden]{display:none}
.recent-head{margin:0;padding:14px 0 8px;border-top:1px solid var(--ad-line);font-size:var(--adp-text-2xs);font-weight:var(--adp-weight-bold);letter-spacing:.06em;text-transform:uppercase;color:var(--ad-ink-soft)}
.recent-list{list-style:none;margin:0 0 8px;padding:0;display:flex;flex-direction:column;gap:2px}
.recent-row{display:flex;align-items:center;gap:2px;margin:0 -10px}
.recent-item{display:block;flex:1 1 auto;min-width:0;text-align:left;border:0;background:transparent;cursor:pointer;font:inherit;color:var(--ad-ink);padding:8px 10px;border-radius:var(--adp-radius-control)}
.recent-item:hover{background:var(--ad-surface-raised)}
.recent-item:focus-visible{outline:2px solid var(--ad-accent);outline-offset:2px}
.recent-del{display:inline-grid;place-items:center;width:var(--adp-action-size);height:var(--adp-action-size);flex:none;border:0;background:transparent;color:var(--ad-ink-faint);border-radius:var(--adp-radius-control);cursor:pointer;font:inherit}
.recent-del:hover{background:var(--ad-surface-raised);color:var(--ad-error)}
.recent-del:focus-visible{outline:2px solid var(--ad-accent);outline-offset:2px}
.recent-del svg{width:14px;height:14px;pointer-events:none}
.recent-word{font-size:14px;font-weight:var(--adp-weight-semi);color:var(--ad-ink)}
.recent-context{display:block;margin-top:1px;font-size:var(--adp-text-xs);line-height:1.4;color:var(--ad-ink-soft);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
footer{display:flex;align-items:center;gap:6px;flex:none;margin:0 18px;padding:11px 0 14px;border-top:1px solid var(--ad-line);font-size:var(--adp-text-2xs);color:var(--ad-ink-faint)}
footer svg{width:13px;height:13px;flex:none}
@keyframes spin{to{transform:rotate(360deg)}}
.focus .loadrow{display:flex;align-items:center;gap:9px;margin:4px 0 9px;color:var(--ad-ink-soft);font-size:14px}
.focus .loadrow::before{content:"";display:block;width:15px;height:15px;flex:none;border:2px solid var(--ad-line);border-top-color:var(--ad-accent);border-radius:50%;animation:spin .77s linear infinite}
@media (prefers-reduced-motion:reduce){.focus .loadrow::before{animation:none}}`;

/** Build the teaching empty-state nodes shown before any lookup exists. */
function renderEmpty(): Node[] {
  const wrap = document.createElement('div');
  wrap.className = 'empty';
  // Brand mark is decorative (aria-hidden inside BRAND_MARK_SVG); the text carries the meaning.
  wrap.innerHTML =
    BRAND_MARK_SVG +
    '<p class="empty-title">Select a word on any page</p>' +
    '<p class="empty-hint">Highlight a word while you read and choose <b>Define</b>. Its meaning shows up here, with a translation in your language.</p>';
  return [wrap];
}

export class SidePanelView extends HTMLElement {
  private _focus: PanelFocusState = { kind: 'empty' };
  private _recent: HistoryEntry[] = [];
  private focusEl!: HTMLElement;
  private recentEl!: HTMLElement;
  private recentList!: HTMLUListElement;

  connectedCallback(): void {
    if (this.shadowRoot) {
      this.renderFocus();
      return;
    }
    const root = this.attachShadow({ mode: 'open' });
    adoptStyles(root, CSS);

    const accent = document.createElement('div');
    accent.className = 'accent';
    accent.setAttribute('aria-hidden', 'true');

    const header = document.createElement('header');
    const brand = document.createElement('span');
    brand.className = 'brand';
    brand.innerHTML = `${BRAND_MARK_SVG}<span>AI Dictionary</span>`;
    // Persistent path to the options page; same `open-settings` contract as the lookup card,
    // caught by the panel's composition root (a trusted page, it calls openOptionsPage itself).
    const settings = document.createElement('button');
    settings.type = 'button';
    settings.className = 'settings';
    settings.setAttribute('aria-label', 'Settings');
    settings.innerHTML = ICON_SETTINGS; // decorative aria-hidden SVG; name comes from aria-label
    settings.addEventListener('click', () =>
      this.dispatchEvent(new CustomEvent('open-settings', { bubbles: true, composed: true })),
    );
    header.append(brand, settings);

    const main = document.createElement('main');

    // The current lookup. aria-live="polite" so a loading→result swap announces once.
    this.focusEl = document.createElement('section');
    this.focusEl.className = 'focus';
    this.focusEl.setAttribute('aria-live', 'polite');
    this.focusEl.setAttribute('aria-label', 'Definition');

    // Recent lookups, hidden until history exists so the panel never shows an empty "Recent".
    this.recentEl = document.createElement('section');
    this.recentEl.className = 'recent';
    this.recentEl.setAttribute('aria-label', 'Recent lookups');
    this.recentEl.hidden = true;
    const recentHead = document.createElement('h2');
    recentHead.className = 'recent-head';
    recentHead.textContent = 'Recent';
    this.recentList = document.createElement('ul');
    this.recentList.className = 'recent-list';
    this.recentEl.append(recentHead, this.recentList);

    main.append(this.focusEl, this.recentEl);

    const footer = document.createElement('footer');
    footer.innerHTML = `${ICON_SHIELD}<span>Stays on your device</span>`;

    root.append(accent, header, main, footer);
    this.renderFocus();
    this.renderRecent();
  }

  /** The single focus region: empty teaching state, or a loading / result / error lookup. */
  set focusState(s: PanelFocusState) {
    this._focus = s;
    if (this.shadowRoot) this.renderFocus();
  }
  get focusState(): PanelFocusState {
    return this._focus;
  }

  /** Recent lookups, newest-first. An empty list collapses the whole section. */
  set recent(entries: HistoryEntry[]) {
    this._recent = entries;
    if (this.shadowRoot) this.renderRecent();
  }
  get recent(): HistoryEntry[] {
    return this._recent;
  }

  private renderFocus(): void {
    const nodes = this._focus.kind === 'empty' ? renderEmpty() : renderCardState(this._focus);
    this.focusEl.replaceChildren(...nodes);
  }

  private renderRecent(): void {
    this.recentEl.hidden = this._recent.length === 0;
    this.recentList.replaceChildren(...this._recent.map((e) => this.recentRow(e)));
  }

  private recentRow(e: HistoryEntry): HTMLLIElement {
    const li = document.createElement('li');
    li.className = 'recent-row';
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'recent-item';
    b.setAttribute('aria-label', `Show definition of ${e.word}`);
    const word = document.createElement('span');
    word.className = 'recent-word';
    word.textContent = e.word;
    b.append(word);
    if (e.context) {
      const ctx = document.createElement('span');
      ctx.className = 'recent-context';
      ctx.textContent = e.context;
      b.append(ctx);
    }
    b.addEventListener('click', () =>
      this.dispatchEvent(
        new CustomEvent('select', { detail: { id: e.id }, bubbles: true, composed: true }),
      ),
    );
    // A sibling (a button may not nest a button) that removes the entry AND its cached
    // definition, so the next lookup of this word re-fetches with the current template.
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'recent-del';
    del.setAttribute('aria-label', `Delete ${e.word} from history and cache`);
    del.title = 'Delete — the next lookup fetches a fresh definition';
    del.innerHTML = ICON_TRASH; // decorative aria-hidden SVG; name comes from aria-label
    del.addEventListener('click', () =>
      this.dispatchEvent(
        new CustomEvent('delete', { detail: { id: e.id }, bubbles: true, composed: true }),
      ),
    );
    li.append(b, del);
    return li;
  }
}
