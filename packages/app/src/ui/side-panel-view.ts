import type { HistoryEntry } from '../domain/types';
import { adoptStyles } from './styles/adopt';
import { LIGHT_VARS, THEME_DARK_CSS, HOLLY_SVG } from './styles/tokens';
import { renderCardState, ICON_SETTINGS, type CardState } from './lookup-card';

/**
 * What the panel's single "focus" region shows. It mirrors the in-page card's three
 * states, plus an `empty` first-run state unique to this persistent surface: the panel
 * opens before any lookup exists, so it must teach the interface rather than fake a
 * loading spinner (the bug the old side panel shipped — it reused the floating card,
 * which defaults to `{kind:'loading'}`).
 */
export type PanelFocusState = CardState | { kind: 'empty' };

const ICON_SHIELD =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 1.8l5 2v3.4c0 3-2.1 5.2-5 6.2-2.9-1-5-3.2-5-6.2V3.8l5-2z"/></svg>';

// The panel IS the cozy surface (full-height, edge-to-edge, docked), so unlike the floating
// lookup-card it carries NO border-radius and NO drop shadow — re-framing a docked panel as a
// floating card would double the surface and break the One Surface Rule. The candlelit glow and
// warm palette stay; depth comes from the host browser chrome, not a shadow.
//
// Content for the focus region is rendered with the shared `renderCardState` helper, but here the
// nodes live directly in this shadow tree (the panel is a single-world extension page, not a
// cross-world content script), so the card's `::slotted(...)` rules are restated as direct-child
// `.focus ...` selectors. The headword stays the one serif; the recent list is sans (One Serif Rule).
//
// Layout: the host is a column pinned to EXACTLY the panel viewport (`height:100dvh`, not
// `min-height`) so the ribbon/header/footer stay fixed and only `main` scrolls. `main` needs the
// explicit `min-height:0` to override a flex item's default `min-height:auto`, which would
// otherwise refuse to shrink below its content and let a long definition overflow the host (the
// scroll then lands on the whole document) instead of scrolling inside `main`.
const CSS = `:host{${LIGHT_VARS};display:flex;flex-direction:column;height:100dvh;box-sizing:border-box;font:15px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--ad-ink);background:var(--ad-glow),var(--ad-surface);color-scheme:light}
${THEME_DARK_CSS}
*{box-sizing:border-box}
.ribbon{height:4px;flex:none;background:linear-gradient(90deg,var(--ad-pine),var(--ad-amber) 52%,var(--ad-cranberry))}
header{display:flex;align-items:center;gap:8px;padding:13px 18px 11px;flex:none}
.brand{display:inline-flex;align-items:center;gap:8px;font-size:13px;font-weight:700;letter-spacing:.01em;color:var(--ad-pine)}
.settings{display:inline-grid;place-items:center;width:28px;height:28px;margin-left:auto;border:0;background:transparent;color:var(--ad-ink-soft);border-radius:8px;cursor:pointer;font:inherit}
.settings:hover{background:var(--ad-surface-soft);color:var(--ad-ink)}
.settings:focus-visible{outline:2px solid var(--ad-amber);outline-offset:2px}
.settings svg{width:15px;height:15px;pointer-events:none}
.holly{width:22px;height:22px;flex:none}
main{flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:0 18px}
.focus{padding:6px 0 10px}
.focus h2{font-family:Georgia,"Times New Roman",serif;font-size:1.8rem;line-height:1.15;letter-spacing:-.01em;margin:.1em 0 .45em;color:var(--ad-ink);display:inline-block;max-width:100%;overflow-wrap:anywhere;padding-bottom:6px;background:linear-gradient(90deg,var(--ad-pine),var(--ad-cranberry)) left bottom/46px 3px no-repeat}
.focus p{margin:.5em 0}
.focus ul,.focus ol{margin:.5em 0;padding-left:1.3em}
.focus li{margin:.2em 0}
.focus blockquote{margin:.6em 0;padding-left:12px;color:var(--ad-ink-soft);font-style:italic}
.focus code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.92em;background:var(--ad-surface-soft);padding:.1em .35em;border-radius:5px}
.focus a{color:var(--ad-pine);text-underline-offset:2px}
.focus .err{color:var(--ad-err);font-weight:500}
.focus .holly{display:block;width:34px;height:34px;margin:20px auto 2px}
.focus .setup-title{text-align:center;margin:10px 0 0;font-size:17px;font-weight:600;color:var(--ad-ink)}
.focus .setup-text{text-align:center;margin:7px auto 0;max-width:32ch;font-size:14px;line-height:1.55;color:var(--ad-ink-soft)}
.focus .setup-cta{display:block;margin:18px auto 6px;padding:10px 20px;border:0;border-radius:9px;background:var(--ad-cta);color:var(--ad-surface);font:inherit;font-size:14px;font-weight:600;cursor:pointer}
.focus .setup-cta:hover{filter:brightness(1.06)}
.focus .setup-cta:focus-visible{outline:2px solid var(--ad-amber);outline-offset:2px}
.empty{display:flex;flex-direction:column;align-items:center;text-align:center;gap:10px;padding:48px 12px 40px;color:var(--ad-ink-soft)}
.empty .holly{width:40px;height:40px;opacity:.85}
.empty-title{margin:0;font-size:16px;font-weight:600;color:var(--ad-ink)}
.empty-hint{margin:0;max-width:30ch;font-size:13px;line-height:1.55;color:var(--ad-ink-soft)}
.empty-hint b{color:var(--ad-ink);font-weight:600}
.recent{margin-top:6px}
.recent[hidden]{display:none}
.recent-head{margin:0;padding:14px 0 8px;border-top:1px solid var(--ad-line);font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--ad-ink-soft)}
.recent-list{list-style:none;margin:0 0 8px;padding:0;display:flex;flex-direction:column;gap:2px}
.recent-item{display:block;width:100%;text-align:left;border:0;background:transparent;cursor:pointer;font:inherit;color:var(--ad-ink);padding:8px 10px;margin:0 -10px;border-radius:8px}
.recent-item:hover{background:var(--ad-surface-soft)}
.recent-item:focus-visible{outline:2px solid var(--ad-amber);outline-offset:2px}
.recent-word{font-size:14px;font-weight:600;color:var(--ad-ink)}
.recent-context{display:block;margin-top:1px;font-size:12px;line-height:1.4;color:var(--ad-ink-soft);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
footer{display:flex;align-items:center;gap:6px;flex:none;margin:0 18px;padding:11px 0 14px;border-top:1px solid var(--ad-line);font-size:11px;color:var(--ad-ink-soft)}
footer svg{width:13px;height:13px;flex:none}
@keyframes spin{to{transform:rotate(360deg)}}
.focus .loadrow{display:flex;align-items:center;gap:9px;margin:4px 0 9px;color:var(--ad-ink-soft);font-size:14px}
.focus .loadrow::before{content:"";display:block;width:16px;height:16px;flex:none;border:2px solid var(--ad-line);border-top-color:var(--ad-amber);border-radius:50%;animation:spin .7s linear infinite}
@media (prefers-reduced-motion:reduce){.focus .loadrow::before{animation:none}}`;

/** Build the teaching empty-state nodes shown before any lookup exists. */
function renderEmpty(): Node[] {
  const wrap = document.createElement('div');
  wrap.className = 'empty';
  // Holly mark is decorative (aria-hidden inside HOLLY_SVG); the text carries the meaning.
  wrap.innerHTML =
    HOLLY_SVG +
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

    const ribbon = document.createElement('div');
    ribbon.className = 'ribbon';

    const header = document.createElement('header');
    const brand = document.createElement('span');
    brand.className = 'brand';
    brand.innerHTML = `${HOLLY_SVG}<span>AI Dictionary</span>`;
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

    root.append(ribbon, header, main, footer);
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
    li.append(b);
    return li;
  }
}
