import {
  runLookupWorkflow,
  InlineBottomSheetRenderer,
  DomSelectionSource,
  MessageRelayLookupClient,
  buildConsentFooter,
  createSaveReplyGuard,
  classifyInbound,
  acceptAny,
  PageHighlighter,
  HoverRecallController,
  buildHighlightMatcher,
  findWordMatches,
  type SettingsStore,
  type SavedWordStatus,
  type SavedWordEntry,
  type WireReply,
} from '@ai-dict/app';
// Custom elements are defined by content-elements.ts (world:MAIN) — see manifest.json.
// Do NOT re-import them here; the page's registry is shared between worlds via the DOM.
import { ChromeFloatingTrigger } from './adapters/chrome-floating-trigger';
import { MessageRelaySettingsStore } from './adapters/message-relay-settings-store';
import { ChromeSidePanelMirror } from './adapters/chrome-side-panel-mirror';
import { ChromeHoverRecallPopup } from './adapters/chrome-hover-recall-popup';
import { isLandingPage, stampInstallMarker, stampReadyMarker } from './adapters/landing-marker';
import type { SidePanelFocus, OpenSidePanelMessage } from './side-panel-messages';
import { isCommandMessage } from './command-messages';

const inline = new InlineBottomSheetRenderer(document.body, undefined, { sidePanel: true });
const mirror = new ChromeSidePanelMirror(chrome.runtime);
const trigger = new ChromeFloatingTrigger();

// Decorate the settings store so every fetch also re-applies the reader's theme to the
// in-page surfaces (bubble + card). The workflow fetches settings on each Define click and
// the relay store drops its cache on storage changes, so a theme saved on the options page
// reaches already-open tabs on their next lookup — plus once at startup for the bubble.
const settings = new MessageRelaySettingsStore(chrome.runtime);

// B3: re-encounter highlighter — paints learning-status saved words on the page (spec §D7).
// `refresh` is safe to call as the very first invocation too (its resets — collected=[],
// walker=null, pendingRoots=[], highlight?.clear() — are no-ops against the class's own initial
// state), so every repaint site below calls it uniformly instead of branching on first-vs-later.
// The initial paint fires exactly ONCE at startup (chained off the one-time settings seed below,
// gated on highlightSavedWords) — it does NOT ride the shared per-fetch `themedSettings.get`
// closure, because that closure runs on every Define lookup (workflow.ts calls
// `deps.settings.get()` per lookup) and re-running `refresh()` there would clear + repaint on
// every single lookup: a visible flicker plus an unrequested `saved.learningWords` round trip
// each time. The toggle-save / toggle-status handlers below are the only other repaint sites —
// they are event-driven (fire once per actual save/status change), not per-lookup.
const highlighter = new PageHighlighter(document);
// B4: hover-recall popup + matcher + controller — see design spec §2.2/§2.5/§2.8/§3.8.
// `hoverMatcher` is a `let`, declared before `refreshHighlights`, so its closure can assign the
// same word list `highlighter.refresh` was just given (no second `saved.learningWords` round
// trip — see the assignment inside refreshHighlights below).
const hoverPopup = new ChromeHoverRecallPopup();
let hoverMatcher = new Map<string, string>();
const hoverGuard = createSaveReplyGuard();
const hoverController = new HoverRecallController(document);
function refreshHighlights(): void {
  void chrome.runtime
    .sendMessage({ type: 'saved.learningWords' })
    .then((raw: unknown) => {
      const reply = raw as WireReply | undefined;
      if (reply?.ok && reply.type === 'savedWords') {
        highlighter.refresh(reply.words);
        hoverMatcher = buildHighlightMatcher(reply.words); // B4: same list, no extra fetch
      }
    })
    .catch(() => undefined); // SW asleep / no reply — skip silently
}

const themedSettings: SettingsStore = {
  get: () =>
    settings.get().then((s) => {
      trigger.theme = s.theme;
      inline.theme = s.theme;
      hoverPopup.theme = s.theme; // B4: same per-fetch theme stamp as the trigger/card
      return s;
    }),
  set: (patch) => settings.set(patch),
};
// seed before the first lookup; light until known — also the ONE-TIME initial highlight paint,
// gated on the setting, reusing this same settings fetch (no second round trip).
const initialSettings = themedSettings.get();
void initialSettings
  .then((s) => {
    if (s.highlightSavedWords !== false) refreshHighlights();
  })
  .catch(() => undefined);

// B4: hover-recall — start the controller once at startup (design spec §2.2). It scans the
// exact ranges the highlighter has already painted (`highlighter.ranges`), so a hover only ever
// resolves to a word this tab already knows is saved/learning — no extra DOM walk of its own.
hoverController.start(
  () => highlighter.ranges,
  (m) => {
    const text = m.range.toString();
    const headword = findWordMatches(text, hoverMatcher)[0]?.headword;
    if (!headword) return;
    const rect = m.range.getBoundingClientRect();
    const token = hoverGuard.next();
    void chrome.runtime
      .sendMessage({ type: 'saved.get', word: headword })
      .then((raw: unknown) => {
        if (!hoverGuard.isCurrent(token)) return; // a later hover already superseded this reply
        const reply = raw as WireReply | undefined;
        if (!reply?.ok || reply.type !== 'savedEntry' || !reply.entry) return;
        const entry: SavedWordEntry = reply.entry;
        const primary = entry.senses[0];
        if (!primary) return;
        const preview =
          primary.translation.trim() ||
          (primary.definition.length > 140
            ? `${primary.definition.slice(0, 140)}…`
            : primary.definition);
        hoverPopup.show(
          { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
          { word: entry.word, preview },
        );
      })
      .catch(() => undefined);
  },
  () => hoverPopup.hide(),
  hoverPopup.element,
);

// C11: install-aware landing page — stamp a minimal, non-sensitive marker (install + version +
// setup-finished) on <html> so docs/index.html's checklist/CTA can adapt. Landing origin only
// (see design spec §2.2); only PublicSettings.hasKey (a boolean, S1-safe — never the key itself)
// crosses into the marker. See design spec §2.4 for why this does not live-update later.
if (isLandingPage(location)) {
  stampInstallMarker(document.documentElement, chrome.runtime.getManifest().version);
  void initialSettings
    .then((s) => stampReadyMarker(document.documentElement, s.hasKey))
    .catch(() => undefined);
}

let lastFocus: SidePanelFocus | undefined;

// B1: the save payload for whatever the card currently shows, plus a local optimistic flag.
// Reset on every renderLoading/renderResult — a fresh render always starts unstarred (no
// is-already-saved round trip; see the design spec's "Toggle semantics" section for why).
let lastSavePayload:
  | {
      word: string;
      definition: string;
      translation: string;
      sentence: string;
      url: string;
      title: string;
    }
  | undefined;
let lastSaved = false;
// B5: the current saved word's status, sourced from the saved.save/saved.setStatus reply's
// entry.status (NOT a fresh optimistic default — see the design spec's "Known, accepted
// limitation" section for why an unsaved word starts with no known status). undefined hides the
// status toggle (renderSaveRow's own guard).
let lastStatus: SavedWordStatus | undefined;
// B5 (F2 audit fix): guards against a stale toggle-save reply resolving after a later
// click/render has already superseded it — see save-reply-guard.ts's doc comment.
const saveReplyGuard = createSaveReplyGuard();

/** Close everything the in-page surfaces are currently showing (card + mirror). Shared by the
 * workflow's normal close path and the A4 dismiss-lookup command. */
function dismissAll(): void {
  lastFocus = undefined;
  inline.close();
  mirror.close();
}

runLookupWorkflow({
  selection: new DomSelectionSource(document),
  trigger,
  renderer: {
    renderLoading(word, anchor) {
      lastFocus = word === undefined ? { state: 'loading' } : { state: 'loading', word };
      lastSavePayload = undefined;
      lastSaved = false;
      lastStatus = undefined;
      saveReplyGuard.next();
      inline.renderLoading(word, anchor);
      mirror.renderLoading(word);
    },
    renderResult(r, ctx) {
      lastFocus = { state: 'result', payload: r };
      lastSavePayload = {
        word: r.word,
        definition: r.markdown,
        // B2: real translation from the parsed TRANSLATION signal line, when the model emitted
        // one; '' fallback preserves B1's exact behavior for legacy/non-compliant responses.
        translation: r.translation ?? '',
        sentence: ctx?.sentence ?? '',
        url: ctx?.url ?? '',
        title: ctx?.title ?? '',
      };
      lastSaved = false;
      lastStatus = undefined;
      saveReplyGuard.next();
      // Forward the picker context to the in-page card only; the side-panel mirror shows the
      // badge/note from `r` but no one-shot picker (it's a persistent surface).
      inline.renderResult(r, ctx);
      mirror.renderResult(r, ctx);
    },
    renderError(e) {
      lastFocus = { state: 'error', payload: e };
      inline.renderError(e);
      mirror.renderError(e);
      void maybeShowConsent();
    },
    close: dismissAll,
  },
  client: new MessageRelayLookupClient(chrome.runtime),
  settings: themedSettings,
});

async function maybeShowConsent(): Promise<void> {
  let status: { consent: string; pending: boolean; count: number } | undefined;
  try {
    const reply: WireReply = await chrome.runtime.sendMessage({ type: 'errlog.status' });
    if (reply?.ok && reply.type === 'errlog') status = reply;
  } catch {
    return; // SW asleep / no reply — skip silently
  }
  if (!status || !status.pending || status.consent !== 'unset') return;

  const footer = buildConsentFooter({
    count: status.count,
    onChoice: (choice) => {
      void chrome.runtime.sendMessage({ type: 'errlog.set-consent', state: choice });
      footer.remove();
    },
  });
  inline.appendToCard(footer);
}

// The card's Settings actions (header gear, no-key/invalid-key "Open Settings" CTA) dispatch a
// composed `open-settings` event that bubbles out of the bottom sheet to the document. A content
// script can't open the options page directly, so we ask the service worker to (it calls
// chrome.runtime.openOptionsPage).
document.addEventListener('open-settings', (e) => {
  // C6: the INVALID_KEY card's CTA carries { fixKey: true }; the NO_KEY CTA and the card's own
  // header Settings gear (lookup-card.ts's separate act==='settings' dispatch) carry no detail —
  // both resolve fixKey to false here, an unchanged `open-options` message from their perspective.
  const fixKey = (e as CustomEvent<{ fixKey?: boolean } | undefined>).detail?.fixKey === true;
  void chrome.runtime.sendMessage({ type: 'open-options', fixKey });
});

// B1: the card's star button bubbles a composed `toggle-save` event (no persistence payload —
// the full save context lives in the closure above, captured from ResultRenderContext at the
// moment the result rendered). Optimistic local toggle: no is-already-saved round trip (see the
// design spec's "Toggle semantics").
document.addEventListener('toggle-save', () => {
  if (!lastSavePayload) return;
  const willSave = !lastSaved;
  lastSaved = willSave;
  inline.setSaved(willSave);
  if (!willSave) lastStatus = undefined;
  const token = saveReplyGuard.next();
  const message = willSave
    ? { type: 'saved.save' as const, ...lastSavePayload }
    : { type: 'saved.delete' as const, word: lastSavePayload.word };
  void chrome.runtime
    .sendMessage(message)
    .then((raw: unknown) => {
      if (!saveReplyGuard.isCurrent(token)) return; // a later click/render already superseded this reply
      const reply = raw as WireReply | undefined;
      if (willSave && reply?.ok && reply.type === 'saved') {
        lastStatus = reply.entry.status;
        inline.setStatus(lastStatus);
      }
      if (reply?.ok) refreshHighlights(); // B3: save/unsave changed the learning-word set
    })
    .catch(() => undefined);
});

// B5: the card's status toggle bubbles a composed `toggle-status` event (no direction carried —
// the flip direction is computed here from the last known status, mirroring toggle-save's own
// design). No-op if the word isn't confirmed-saved yet (lastStatus undefined mirrors
// lastSavePayload's own guard above).
document.addEventListener('toggle-status', () => {
  if (!lastSavePayload || lastStatus === undefined) return;
  const next: SavedWordStatus = lastStatus === 'known' ? 'learning' : 'known';
  lastStatus = next;
  inline.setStatus(next);
  void chrome.runtime
    .sendMessage({ type: 'saved.setStatus', word: lastSavePayload.word, status: next })
    .then((raw: unknown) => {
      const reply = raw as WireReply | undefined;
      if (reply?.ok) refreshHighlights(); // B3: a known<->learning flip changed the match set
    })
    .catch(() => undefined);
});

// B7: the card's nudge banner bubbles a composed `dismiss-nudge` event when its × is tapped.
// No wire message: the router already permanently marked this word as nudged before this reply
// was sent (domain/nudge-policy.ts) — dismissal is purely local, hiding the banner on this card.
document.addEventListener('dismiss-nudge', () => {
  inline.dismissNudge();
});

// The card's "Open in side panel" action (Chrome only) bubbles a composed `open-side-panel`
// event out of the bottom sheet. A content script can't call chrome.sidePanel.open(), so we
// relay it (synchronously, preserving the user gesture) to the service worker, then dismiss the
// in-page sheet so the lookup "moves" to the docked panel — but keep the mirror so the panel
// keeps showing it (do NOT call the renderer's close()).
document.addEventListener('open-side-panel', () => {
  const message: OpenSidePanelMessage =
    lastFocus !== undefined
      ? { type: 'open-side-panel', focus: lastFocus }
      : { type: 'open-side-panel' };
  void chrome.runtime.sendMessage(message).catch(() => undefined);
  inline.close();
});

// B4: the hover-recall popup's "View full entry" action bubbles a composed `view-full-entry`
// event carrying the resolved headword. Re-resolves the entry with a second, cheap `saved.get`
// rather than threading the hover-match closure's entry through — keeps this listener
// independent of the hover-match code path (a click only ever fires after a deliberate
// hover+click, not a hot path). Reuses the EXISTING open-side-panel pipeline verbatim (design
// spec §2.5) by writing the same module-scoped `lastFocus` the live-lookup renderer callbacks
// already write, then dispatching the same composed event that pipeline already listens for.
document.addEventListener('view-full-entry', (e) => {
  const { word } = (e as CustomEvent<{ word: string }>).detail;
  void chrome.runtime
    .sendMessage({ type: 'saved.get', word })
    .then((raw: unknown) => {
      const reply = raw as WireReply | undefined;
      if (!reply?.ok || reply.type !== 'savedEntry' || !reply.entry) return;
      const entry: SavedWordEntry = reply.entry;
      const primary = entry.senses[0];
      if (!primary) return;
      lastFocus = {
        state: 'result',
        payload: {
          markdown: primary.definition,
          word: entry.word,
          target: '', // unused by rendering — see design spec §2.5
          model: 'saved',
          fromCache: true,
          fetchedAt: entry.savedAt,
          ...(primary.translation ? { translation: primary.translation } : {}),
        },
        sentence: primary.sentence,
        url: primary.url,
        title: primary.title,
      };
      document.dispatchEvent(new CustomEvent('open-side-panel'));
    })
    .catch(() => undefined);
});

// A4: keyboard-only flow. The service worker relays a fired chrome.commands shortcut here.
chrome.runtime.onMessage.addListener((msg: unknown, sender) => {
  const decision = classifyInbound(msg, sender.id, chrome.runtime.id, acceptAny); // S3: same-extension only
  if (decision.action !== 'route') return;
  if (!isCommandMessage(decision.msg)) return;
  switch (decision.msg.command) {
    case 'define-selection':
      trigger.activate();
      break;
    case 'dismiss-lookup':
      trigger.hide();
      dismissAll();
      break;
    case 'send-to-panel':
      // Only meaningful with an active lookup on screen; reuses the exact same document event
      // the card's own "Open in side panel" button already dispatches (see above).
      if (lastFocus !== undefined) document.dispatchEvent(new CustomEvent('open-side-panel'));
      break;
  }
});
