import type {
  ResultRenderer,
  ResultRenderContext,
  LookupResult,
  LookupError,
  Provider,
  Theme,
  SavedWordStatus,
  AnchorRect,
  RefineKind,
} from '../index';
import { computeCardPlacement } from '../domain/card-placement';
import {
  renderCardState,
  renderGlossState,
  placeFloatingPin,
  type CardState,
  type LookupCard,
  type LookupGloss,
  type SafeHtml,
  type FloatingPin,
} from '../ui/index';
import { sanitizeMarkdown } from './markdown-sanitize';

const MAX_PINNED = 3;

export class InlineBottomSheetRenderer implements ResultRenderer {
  private sheet: HTMLElement | null = null;
  private card: LookupCard | null = null;
  private _theme: Theme = 'sepia';
  // A7: every currently-open <floating-pin>.
  private readonly pinned: Set<FloatingPin> = new Set();
  // A7: named handler so pinCurrent() can selectively remove it when detaching a card.
  private readonly onLiveClose = (): void => this.close();
  // Set on every renderResult from the render context; the card's one `switch-provider`
  // listener (attached in ensureCard) reads whatever the latest result installed.
  private onSwitch: ((p: Provider) => void) | undefined;
  // A8: same pattern for the card's one `force-literal` listener.
  private onForceLiteral: (() => void) | undefined;
  // A3: same pattern as onSwitch/onForceLiteral for the card's one `refine` listener.
  private onRefine: ((k: RefineKind) => void) | undefined;
  // A2: same pattern for the card's one `lookup-back` listener.
  private onBack: (() => void) | undefined;
  // A3: the last render where ctx.refine was undefined (a genuine original result), so
  // restoreOriginal() can revert a refined body without a new lookup. null before any render, or
  // after close(). See the design spec's §2.4(b).
  private originalState: CardState | null = null;
  // B1: the last CardState rendered, so setSaved() can re-emit it with the flag flipped without
  // a full re-lookup. null before any render, or after close().
  private lastState: CardState | null = null;
  // A6: the selection's anchor rect for the currently-open card, captured by renderLoading and
  // reused by every subsequent render of the same card (setState → positionNear) — see the
  // design spec §2.2. null before any render, after close(), or when no anchor was ever known
  // (the NO_KEY short-circuit path, design spec §2.4).
  private lastAnchor: AnchorRect | null = null;
  // A1: throttle floor between two renderPartial repaints — a dropped intermediate frame is
  // always safe (design spec §4.9): the very next partial, or the unthrottled terminal
  // renderResult call, supersedes it a moment later.
  private readonly THROTTLE_MS = 80;
  private lastPartialPaintAt = -Infinity;
  // A5: opt-in compact gloss render mode. Default false — zero behavior change until the reader
  // opts in via settings (spec §2.5).
  private _glossMode = false;
  private glossEl: LookupGloss | null = null;
  // A5: true once the full card is open for THIS on-page session (via expand OR a gloss-ineligible
  // render) — every later render then keeps updating the SAME open card and never regresses into a
  // mini bubble (spec §2.4). Reset only in close(). For every install with glossMode OFF (default),
  // this becomes true on the first render and stays true — zero behavior change for that path.
  private cardOpen = false;
  // A5 (skinner fix): true once the reader outside-press-dismisses the LOADING gloss bubble
  // while a lookup is still in flight. Suppresses that lookup's late terminal renderResult/
  // renderError so it can neither re-mount the bubble nor pop the full modal unsolicited. Only
  // ever set by onOutsidePress, which only fires for a mounted gloss bubble — the non-gloss full
  // card path can never observe this flag, so this fix is fully contained to A5's interaction.
  // Cleared by the next renderLoading (a fresh lookup) and by close().
  private dismissed = false;
  private readonly onOutsidePress = (e: Event): void => {
    if (this.glossEl && !e.composedPath().includes(this.glossEl)) {
      this.dismissed = true;
      this.removeGloss();
    }
  };

  constructor(
    private readonly host: HTMLElement,
    private readonly sanitize: (md: string) => SafeHtml = sanitizeMarkdown,
    private readonly opts: { sidePanel?: boolean } = {},
    private readonly now: () => number = () => Date.now(),
  ) {}

  /**
   * The reader's stored theme preference, stamped as the `data-ad-theme` ATTRIBUTE on both the
   * card and its bottom-sheet host — an attribute (shared DOM) crosses the MAIN/isolated world
   * boundary, a JS property write would not (see setState below). The sheet is stamped too so
   * its --ad-scrim resolves to the same theme. Set by the composition root from settings.
   */
  set theme(t: Theme) {
    this._theme = t;
    this.card?.setAttribute('data-ad-theme', t);
    this.sheet?.setAttribute('data-ad-theme', t);
    // A7: pinned cards are independent, longer-lived subtrees the reader may keep open across
    // a settings change — they must re-theme too, not just the live card.
    for (const pin of this.pinned) {
      pin.setAttribute('data-ad-theme', t);
      pin.querySelector('lookup-card')?.setAttribute('data-ad-theme', t);
    }
  }
  get theme(): Theme {
    return this._theme;
  }

  /** A5: the reader's stored "Compact gloss" setting. Default false. */
  set glossMode(v: boolean) {
    this._glossMode = v;
  }
  get glossMode(): boolean {
    return this._glossMode;
  }

  private ensureCard(): LookupCard {
    if (this.card && this.sheet) return this.card;
    const sheet = document.createElement('bottom-sheet');
    const card = document.createElement('lookup-card') as LookupCard;
    card.setAttribute('data-ad-theme', this._theme);
    // Chrome opts in to the "Open in side panel" affordance; the shared card reads this attribute
    // in connectedCallback (shared DOM, so it crosses the MV3 world boundary and is set before the
    // element upgrades — same mechanism as data-ad-theme above). Safari leaves it off.
    if (this.opts.sidePanel) card.setAttribute('side-panel', '');
    sheet.setAttribute('data-ad-theme', this._theme);
    sheet.append(card);
    sheet.addEventListener('dismiss', () => this.close());
    card.addEventListener('close', this.onLiveClose);
    // One-shot provider picker: the card fires `switch-provider` when the reader picks a
    // provider; delegate to the handler the workflow installed via the render context.
    card.addEventListener('switch-provider', (e) =>
      this.onSwitch?.((e as CustomEvent<{ provider: Provider }>).detail.provider),
    );
    // One-shot idiom-literal override (A8): the card fires `force-literal` when the reader taps
    // "Show literal word"; delegate to the handler the workflow installed via the render context.
    card.addEventListener('force-literal', () => this.onForceLiteral?.());
    // A3: the card fires `refine` when a chip is tapped; delegate to the handler the workflow
    // installed via the render context (mirrors switch-provider/force-literal above).
    // `refine-back` is deliberately NOT listened here — content.ts owns it directly (see the
    // design spec's §2.5 for why).
    card.addEventListener('refine', (e) =>
      this.onRefine?.((e as CustomEvent<{ refine: RefineKind }>).detail.refine),
    );
    // A2: the card fires `lookup-back` when the reader taps "Back"; delegate to the handler the
    // workflow installed via the render context (pops the recursive-lookup chain, no network).
    card.addEventListener('lookup-back', () => this.onBack?.());
    // A7: the card fires `pin` when the reader clicks the pin control; detach it into an
    // independent floating shell.
    card.addEventListener('pin', () => this.pinCurrent());
    this.host.append(sheet); // connection upgrades both elements + builds their shadow roots
    this.sheet = sheet;
    this.card = card;
    return card;
  }

  private setState(state: CardState): void {
    // Write the card's content straight into its LIGHT DOM (projected via the card's <slot>),
    // NOT via the `.state` property. This renderer runs in a Chrome MV3 content-script
    // isolated world; the LookupCard class lives in the page's MAIN world, so a JS property
    // write (`card.state = …`) never reaches it (Chromium 390807) and the card would stay
    // stuck on "Looking up…". Shared-DOM mutations like replaceChildren do cross the boundary.
    this.lastState = state;
    this.ensureCard().replaceChildren(...renderCardState(state));
    // A6: reposition after every content update — the panel's own height changes between the
    // loading and result states, so a position fixed only at renderLoading time could leave a
    // now-taller result card covering the sentence it was clear of while loading (spec §2.2).
    this.positionSheet();
  }

  /**
   * A6: place the sheet's panel as an overlay near the cached selection anchor so it never covers
   * the sentence the reader is looking at (spec §2.5); `lastAnchor === null` falls back to the
   * pre-A6 bottom-center default (§2.4). The pure rect math lives in computeCardPlacement; this
   * edge only measures the live panel and applies the result as inline styles.
   *
   * Why the renderer does the DOM work (not a BottomSheet method): in the Chrome MV3 content
   * script the <bottom-sheet> custom element is defined in the page's MAIN world, while this
   * renderer runs in the ISOLATED world — so a custom-class METHOD call would not cross the world
   * boundary (the same Chromium 390807 limitation setState documents for property writes). Only
   * shared-DOM access crosses, so this reaches the panel through the element's open shadow root
   * and writes native inline styles — exactly how the renderer already crosses the boundary with
   * replaceChildren/setAttribute. This also makes placement work unchanged in Safari's
   * single-world shell, which passes this same renderer directly.
   */
  private positionSheet(): void {
    const panel = this.sheet?.shadowRoot?.querySelector<HTMLElement>('.panel');
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    const { top, left } = computeCardPlacement(
      this.lastAnchor,
      { width: rect.width, height: rect.height },
      { width: window.innerWidth, height: window.innerHeight },
    );
    panel.style.bottom = 'auto';
    panel.style.top = `${top}px`;
    panel.style.left = `${left}px`;
  }

  /** A5: lazily create the compact gloss bubble, wiring its expand click + outside-press dismiss. */
  private ensureGloss(): LookupGloss {
    if (this.glossEl) return this.glossEl;
    const el = document.createElement('lookup-gloss') as LookupGloss;
    el.setAttribute('data-ad-theme', this._theme);
    el.addEventListener('expand', () => this.expand());
    this.host.append(el);
    document.addEventListener('mousedown', this.onOutsidePress, true);
    document.addEventListener('touchstart', this.onOutsidePress, true);
    this.glossEl = el;
    return el;
  }

  /**
   * A5: position the gloss bubble at the selection anchor — the same AnchorRect → fixed-position
   * formula ChromeFloatingTrigger.show() uses for the "Define" pill, so the bubble lands where it
   * just vacated.
   */
  private positionGloss(anchor: AnchorRect): void {
    const el = this.ensureGloss();
    el.setAttribute('data-ad-theme', this._theme);
    el.style.position = 'fixed';
    el.style.left = `${anchor.x}px`;
    el.style.top = `${anchor.y + anchor.h}px`;
  }

  /** A5: tear down the gloss bubble and its outside-press listeners, if one is showing. */
  private removeGloss(): void {
    if (!this.glossEl) return;
    document.removeEventListener('mousedown', this.onOutsidePress, true);
    document.removeEventListener('touchstart', this.onOutsidePress, true);
    this.glossEl.remove();
    this.glossEl = null;
  }

  /**
   * A5: reader tapped the gloss bubble — show the ALREADY-COMPUTED state in the full card, no
   * re-lookup, no re-sanitize. Sets cardOpen so no later render this session regresses into a
   * bubble (spec §2.4).
   */
  private expand(): void {
    this.cardOpen = true;
    this.removeGloss();
    if (this.lastState) this.setState(this.lastState);
  }

  renderLoading(word?: string, anchor?: AnchorRect): void {
    // A5 (skinner fix): a fresh lookup always clears a prior outside-press dismiss.
    this.dismissed = false;
    // A6: cache the selection anchor so every later render of this same open card (setState →
    // positionNear) reuses it; null when no anchor was passed (spec §2.4 fallback).
    this.lastAnchor = anchor ?? null;
    this.lastPartialPaintAt = -Infinity; // A1: a stale timestamp from a prior lookup must never
    // throttle this new lookup's very first partial repaint
    // A superseded lookup's terminal renderResult/renderError can be dropped by the workflow
    // abort guard, leaving data-streaming set on the reused card — clear it here too so the
    // NEXT lookup's loading phase is never silently announced with aria-live="off" (Blocker).
    this.card?.toggleAttribute('data-streaming', false);
    // A5: gloss mode — show a compact loading bubble at the anchor instead of the full modal card
    // (spec §2.3), but only on the first render of a session (cardOpen still false).
    if (!this.cardOpen && this._glossMode && this.lastAnchor) {
      this.lastState = word === undefined ? { kind: 'loading' } : { kind: 'loading', word };
      this.positionGloss(this.lastAnchor);
      this.glossEl!.replaceChildren(
        ...renderGlossState(word === undefined ? { kind: 'loading' } : { kind: 'loading', word }),
      );
      this.glossEl!.setAttribute(
        'aria-label',
        `Define result for "${word ?? '…'}" — tap for full card`,
      );
      return;
    }
    this.removeGloss(); // clear a stale bubble from a prior gloss-eligible render, if any
    this.setState(word === undefined ? { kind: 'loading' } : { kind: 'loading', word });
  }

  /**
   * A1: an in-progress preview between renderLoading and the terminal renderResult/renderError.
   * `markdown` is ALREADY stripped of DEFINED_AS:/TRANSLATION: signal lines by the producer
   * (gemini-streaming.ts) — sanitized here, same trust boundary as renderResult (S4).
   */
  renderPartial(
    word: string,
    markdown: string,
    definedAs?: { term: string; isIdiom: boolean },
  ): void {
    // A5: in gloss mode the compact bubble is the active surface until the reader expands — never
    // flash the full streaming card open behind it (spec §2.3). The bubble keeps its loading state
    // until the terminal renderResult produces the one-line translation.
    if (!this.cardOpen && this._glossMode && this.lastAnchor) return;
    const t = this.now();
    if (t - this.lastPartialPaintAt < this.THROTTLE_MS) return; // dropped — see THROTTLE_MS's doc
    this.lastPartialPaintAt = t;
    const card = this.ensureCard();
    card.toggleAttribute('data-streaming', true); // shared-DOM attribute write, crosses worlds
    this.setState({
      kind: 'streaming',
      word,
      safeHtml: this.sanitize(markdown),
      ...(definedAs ? { definedAs } : {}),
    });
  }

  renderResult(r: LookupResult, ctx?: ResultRenderContext): void {
    // A5 (skinner fix): a late terminal render for a dismissed lookup shows nothing.
    if (this.dismissed) return;
    // `sanitize` already returns `SafeHtml` (the trust boundary lives in sanitizeMarkdown, S4).
    // No cast needed here — the DI param type `(md: string) => SafeHtml` guarantees it.
    this.onSwitch = ctx?.onSwitchProvider;
    this.onForceLiteral = ctx?.onForceLiteral;
    this.onRefine = ctx?.onRefine;
    this.onBack = ctx?.onBack;
    this.card?.toggleAttribute('data-streaming', false);
    // A1: a terminal renderResult always ends the current streaming session — the throttle clock
    // must not carry over and spuriously drop a NEW session's very first renderPartial repaint
    // (same reasoning as renderLoading's own reset above).
    this.lastPartialPaintAt = -Infinity;
    const state: CardState = {
      kind: 'result',
      safeHtml: this.sanitize(r.markdown),
      word: r.word,
      target: r.target,
      // A9: fromCache is a required boolean on LookupResult (never undefined), so thread it
      // unconditionally — same style as word/target above, not the `? {...} : {}` pattern used
      // for genuinely optional fields like provider/definedAs below.
      fromCache: r.fromCache,
      ...(r.provider !== undefined ? { provider: r.provider } : {}),
      ...(r.fallbackFrom !== undefined ? { fallbackFrom: r.fallbackFrom } : {}),
      ...(r.definedAs !== undefined ? { definedAs: r.definedAs } : {}),
      ...(ctx?.providers !== undefined ? { providers: ctx.providers } : {}),
      saved: ctx?.saved === true,
      // B7: r.nudge is a transient per-reply annotation (never persisted — see router.ts);
      // always explicit true/false, same style as `saved` above.
      nudge: r.nudge === true,
      // A7: computed fresh on every render, so a lookup started while already at the cap
      // renders its pin button disabled from the first paint (design spec §2.4).
      canPin: this.pinned.size < MAX_PINNED,
      // A3: always true for the in-page card — the side panel never sets it (design spec §2.6).
      refineChips: true,
      // A2: always explicit true/false — present only when the workflow installed onBack.
      canGoBack: ctx?.onBack !== undefined,
      ...(ctx?.refine !== undefined ? { refine: ctx.refine } : {}),
    };
    // A3: snapshot only when this is a genuine original (non-refine) result, so restoreOriginal()
    // always has the true original to fall back to, never a previously-refined one.
    if (ctx?.refine === undefined) this.originalState = state;
    // A5: gloss vs full card is a pure function of the reader's setting + whether THIS result
    // carries a non-blank one-line translation (spec §2.2) — never word length/frequency/a
    // classifier. Reuses A6's already-cached lastAnchor (renderLoading always precedes renderResult).
    const hasGloss = typeof r.translation === 'string' && r.translation.trim() !== '';
    if (!this.cardOpen && this._glossMode && this.lastAnchor && hasGloss) {
      this.lastState = state;
      this.positionGloss(this.lastAnchor);
      this.glossEl!.replaceChildren(
        ...renderGlossState({
          kind: 'result',
          word: r.word,
          safeHtml: this.sanitize(r.translation!),
        }),
      );
      this.glossEl!.setAttribute('aria-label', `Define result for "${r.word}" — tap for full card`);
      return;
    }
    this.removeGloss();
    this.cardOpen = true;
    this.setState(state);
  }

  renderError(e: LookupError): void {
    // A5 (skinner fix): a late terminal render for a dismissed lookup shows nothing.
    if (this.dismissed) return;
    // A5: errors are never compact (spec §2.3) — setup/recovery CTAs never get squeezed into a bubble.
    this.removeGloss();
    this.cardOpen = true;
    this.card?.toggleAttribute('data-streaming', false);
    // A1: same reasoning as renderResult's own reset above — a terminal error also ends the
    // current streaming session.
    this.lastPartialPaintAt = -Infinity;
    this.setState({ kind: 'error', error: e });
  }

  /**
   * Append an extra light-DOM node (e.g. the error-reporting consent footer) into the
   * currently-shown card. Returns false if no card is open. Uses append (shared-DOM)
   * so it crosses the MV3 MAIN/isolated-world boundary like the card's other content.
   */
  appendToCard(node: Node): boolean {
    if (!this.card) return false;
    this.card.append(node);
    return true;
  }

  /**
   * B1: flip the star's local optimistic state on the currently-shown result without a full
   * re-lookup. No-op when the last rendered state isn't a result (e.g. loading/error) or no card
   * has been rendered yet — mirrors the guard pattern `appendToCard` already uses.
   */
  setSaved(saved: boolean): void {
    if (this.lastState?.kind !== 'result') return;
    // B7: any save toggle (star OR the nudge banner's own Save button — both dispatch the same
    // toggle-save event) also clears the nudge banner; the reader has acted on the signal.
    // B5: unsaving also clears any stale `status` — the isSaved gate already hides the toggle,
    // but clearing avoids a stale value if the state object is inspected directly (spec §3.5).
    // `exactOptionalPropertyTypes` forbids assigning `status: undefined` directly, so the key is
    // omitted (not set to undefined) when unsaving.
    const { status: _status, ...rest } = this.lastState;
    this.setState({
      ...rest,
      saved,
      nudge: false,
      ...(saved && _status !== undefined ? { status: _status } : {}),
    });
  }

  /**
   * B5: flip the status toggle's local state on the currently-shown result without a full
   * re-lookup. No-op when the last rendered state isn't a result (e.g. loading/error) or no card
   * has been rendered yet — mirrors the guard pattern `setSaved` already uses.
   */
  setStatus(status: SavedWordStatus): void {
    if (this.lastState?.kind !== 'result') return;
    this.setState({ ...this.lastState, status });
  }

  /**
   * B7: hide the nudge banner on the currently-shown result without touching `saved`. The
   * backend already permanently marked this word as nudged before this reply was ever sent
   * (domain/nudge-policy.ts), so dismissal needs no wire round-trip — a pure local re-render,
   * mirroring the guard pattern `setSaved`/`appendToCard` already use.
   */
  dismissNudge(): void {
    if (this.lastState?.kind !== 'result') return;
    this.setState({ ...this.lastState, nudge: false });
  }

  /**
   * A3: restore the last original (non-refined) result without a new lookup — zero tokens, zero
   * wire calls. No-op if no original snapshot exists yet (mirrors the guard style setSaved/
   * setStatus/dismissNudge already use).
   */
  restoreOriginal(): void {
    if (!this.originalState) return;
    this.setState(this.originalState);
  }

  /**
   * A7: detach the current live card from its modal <bottom-sheet> into an independent,
   * non-modal <floating-pin> shell (design spec §2). No-op if there is no live result card, or
   * the cap is already reached (defense-in-depth; the pin control itself is already rendered
   * disabled at the cap, per the `canPin: false` state renderResult just set).
   */
  private pinCurrent(): void {
    if (!this.card || !this.sheet) return;
    if (this.pinned.size >= MAX_PINNED) return;
    if (this.lastState?.kind !== 'result') return; // the pin control only ever renders for 'result'
    const card = this.card;
    const sheet = this.sheet;
    const rect = card.getBoundingClientRect(); // viewport coords — same frame <floating-pin> uses
    // Freeze the content for its detached life: strip everything that reads/writes through this
    // renderer's (or content.ts's) SINGLETON "current lookup" fields — see design spec §2.2.
    // Beyond the save/status/nudge/switch/force-literal controls the spec names, the card has
    // since gained the A3 refine chips (refineChips/refine → the `refine`/`refine-back` events)
    // and the A2 recursive-lookup Back button (canGoBack → `lookup-back`); both route through the
    // same singleton live-lookup state, so they are stripped here too — a pinned card must never
    // fire a re-lookup at whatever word the live slot holds next.
    /* eslint-disable @typescript-eslint/no-unused-vars -- rest-destructure omits these fields */
    const {
      status: _status,
      nudge: _nudge,
      providers: _providers,
      definedAs: _definedAs,
      saved: _saved,
      refineChips: _refineChips,
      refine: _refine,
      canGoBack: _canGoBack,
      ...rest
    } = this.lastState;
    /* eslint-enable @typescript-eslint/no-unused-vars */
    const frozen: CardState = { ...rest, pinned: true };
    card.replaceChildren(...renderCardState(frozen));

    card.removeEventListener('close', this.onLiveClose);
    const pin = document.createElement('floating-pin') as FloatingPin;
    pin.setAttribute('data-ad-theme', this._theme);
    pin.append(card); // moves the existing (already re-rendered) element — no re-creation
    // placeFloatingPin (NOT a `pin.place(...)` method call) — see design spec §2.7 for why: an
    // author-defined method never resolves across the MV3 MAIN/isolated-world boundary.
    placeFloatingPin(pin, { left: rect.left, top: rect.top });
    card.addEventListener('close', () => {
      pin.remove();
      this.pinned.delete(pin);
    });
    this.host.append(pin);
    this.pinned.add(pin);

    sheet.remove(); // the now-empty <bottom-sheet> wrapper (card already moved out)
    this.sheet = null;
    this.card = null;
    this.lastState = null; // forces the NEXT renderLoading/renderResult to build a fresh pair
    // A7 re-grounding: mirror close()'s reset of the live-slot session state so the NEXT lookup
    // is a clean session. renderLoading's gloss gate is `if (!this.cardOpen && ...)`, so leaving
    // cardOpen=true here would suppress the compact gloss (A5) on a gloss-mode reader's very next
    // lookup; originalState (the A3 refine snapshot) described the now-detached card, so a stray
    // restoreOriginal() must not resurrect the pinned word into the live slot.
    this.cardOpen = false;
    this.originalState = null;
  }

  close(): void {
    // A10: never let an utterance outlive the card it came from — dismissing (Esc, scrim click,
    // the × button, the A4 dismiss-lookup command) also stops any speech still playing.
    // renderCardState's own cancel-on-render doesn't cover this path: close() never re-renders.
    globalThis.speechSynthesis?.cancel();
    this.removeGloss();
    this.cardOpen = false;
    this.dismissed = false;
    this.sheet?.remove();
    this.sheet = null;
    this.card = null;
    this.lastState = null;
    this.lastAnchor = null;
    this.originalState = null;
  }
}
