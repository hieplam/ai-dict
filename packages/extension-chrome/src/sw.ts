import {
  mapError,
  DEFAULT_OUTPUT_FORMAT,
  configuredProvidersFor,
  shouldOpenOnboardingOnInstall,
  type Settings,
  GeminiLookupClient,
  OpenAILookupClient,
  AnthropicLookupClient,
  createLookupClientSelector,
  buildRouter,
  WriteQueue,
  SUPPRESS,
  classifyInbound,
  ErrorReporter,
  badgeStateFor,
} from '@ai-dict/app';
import { ChromeKvStore } from './adapters/chrome-kv-store';
import { ChromeStorageStore } from './adapters/chrome-storage-store';
import { Ga4TelemetrySink } from './adapters/ga4-telemetry-sink';
import {
  isOpenSidePanel,
  isGetSidePanelFocus,
  type SidePanelFocus,
  type SidePanelFocusReply,
} from './side-panel-messages';
import { type CommandMessage } from './command-messages';

const DEFAULT_TARGET = 'vi';

// The most recent lookup promoted to the side panel, kept so a freshly-opened panel can recover
// it on boot (its onMessage listener may not be registered when we broadcast, and history is
// empty when saveHistory is off). Not window-scoped — mirrors the existing broadcast model,
// which already fans out to every open side panel.
let lastSidePanelFocus: SidePanelFocus | null = null;

async function readFullSettings(): Promise<Settings> {
  const { settings } = (await chrome.storage.local.get('settings')) as { settings?: Settings };
  return (
    settings ?? {
      targetLang: DEFAULT_TARGET,
      outputFormat: DEFAULT_OUTPUT_FORMAT,
      promptEnvelope: '',
      hasKey: false,
      configuredProviders: [],
      highlightSavedWords: true,
      apiKey: '',
      cacheEnabled: true,
      saveHistory: true,
      theme: 'sepia',
      provider: 'gemini',
      openaiApiKey: '',
      anthropicApiKey: '',
    }
  );
}

// Build-time key (esbuild `define`) wins over the stored settings key. Lets you
// ship a personal build with GEMINI_API_KEY in the env and skip the options
// page entirely; empty string => fall through to whatever the user entered.
// Applies to the Gemini key only — OpenAI keys always come from settings.
const ENV_API_KEY = __GEMINI_API_KEY__;

function browserVersion(): string {
  const m = /Chrome\/[\d.]+/.exec(navigator.userAgent);
  return m ? m[0] : navigator.userAgent.slice(0, 80);
}

const errlogKv = new ChromeKvStore(chrome.storage.local);
const reporter = new ErrorReporter({
  kv: errlogKv,
  sink: new Ga4TelemetrySink(
    { measurementId: __GA4_MEASUREMENT_ID__, apiSecret: __GA4_API_SECRET__ },
    chrome.storage.local,
  ),
  now: () => Date.now(),
  meta: async () => ({
    extVersion: chrome.runtime.getManifest().version,
    browserVersion: browserVersion(),
    provider: (await readFullSettings()).provider ?? 'gemini',
  }),
});

// C7: named so the badge refresh below can share the exact same settings-derived "usable key"
// boolean the router uses — see design spec D1 (no separate predicate is introduced).
const settingsStore = new ChromeStorageStore(chrome.storage.local, Boolean(ENV_API_KEY));

const router = buildRouter({
  client: createLookupClientSelector({
    clients: {
      gemini: new GeminiLookupClient({
        fetch: (u, i) => fetch(u, i),
        getApiKey: async () => ENV_API_KEY || (await readFullSettings()).apiKey,
      }),
      openai: new OpenAILookupClient({
        fetch: (u, i) => fetch(u, i),
        getApiKey: async () => (await readFullSettings()).openaiApiKey ?? '',
      }),
      anthropic: new AnthropicLookupClient({
        fetch: (u, i) => fetch(u, i),
        // S1: key read from storage here in SW only; never sent to the wire or content scripts.
        getApiKey: async () => (await readFullSettings()).anthropicApiKey ?? '',
      }),
    },
    // Settings stored before the provider field existed have no `provider` → Gemini.
    getProvider: async () => (await readFullSettings()).provider ?? 'gemini',
    getConfiguredProviders: async () =>
      configuredProvidersFor(await readFullSettings(), { envGeminiKey: Boolean(ENV_API_KEY) }),
  }),
  settings: settingsStore,
  kv: new ChromeKvStore(chrome.storage.local),
  readToggles: async () => {
    const s = await readFullSettings();
    return { cacheEnabled: s.cacheEnabled, saveHistory: s.saveHistory };
  },
  queue: new WriteQueue(),
  // A content script can't open the options page itself; it sends `open-options` and we do it
  // here. This is the keyless reader's path from the in-page "Open Settings" button to setup.
  openOptions: () => chrome.runtime.openOptionsPage(),
  errlog: reporter,
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Chrome-only side-panel control messages. They are NOT part of the pure wire protocol
  // (classifyInbound would reject them): open-side-panel needs `sender` (windowId) and the
  // relayed user gesture, so chrome.sidePanel.open() stays here in the shell, not the core.
  if (isOpenSidePanel(msg) || isGetSidePanelFocus(msg)) {
    if (sender.id !== chrome.runtime.id) return false; // S3 sender gate
    if (isGetSidePanelFocus(msg)) {
      const reply: SidePanelFocusReply = { focus: lastSidePanelFocus };
      sendResponse(reply);
      return true;
    }
    // open-side-panel: cache first (cheap sync work), then open the panel SYNCHRONOUSLY so the
    // user-gesture token survives, then mirror the lookup to any already-open panel.
    lastSidePanelFocus = msg.focus ?? null;
    const windowId = sender.tab?.windowId;
    if (windowId !== undefined) {
      // Best-effort: open() rejects if there is no gesture or no registered panel; we ignore it
      // (the in-page sheet has already dismissed) — the manual/HEADED check verifies real opening.
      void Promise.resolve(chrome.sidePanel?.open?.({ windowId })).catch(() => undefined);
    }
    if (msg.focus) {
      void Promise.resolve(chrome.runtime.sendMessage({ to: 'side-panel', ...msg.focus })).catch(
        () => undefined,
      );
    }
    sendResponse({ ok: true });
    return true;
  }

  const decision = classifyInbound(msg, sender.id, chrome.runtime.id);
  if (decision.action === 'ignore') return false;
  if (decision.action === 'reject') {
    sendResponse(decision.reply);
    return true;
  }
  router(decision.msg)
    .then((reply) => {
      if (reply !== SUPPRESS) sendResponse(reply);
      if (reply !== SUPPRESS && reply.ok === false) {
        const url = decision.msg.type === 'lookup' ? decision.msg.req.url : undefined;
        const { code, message, retryable, retryAfterSec, httpStatus, vendorStatus, vendorMessage } =
          reply.error;
        void reporter.capture({
          source:
            reply.type === 'lookup' || reply.type === 'connection.test' ? reply.type : 'thrown',
          error: {
            code,
            message,
            ...(retryable !== undefined ? { retryable } : {}),
            ...(retryAfterSec !== undefined ? { retryAfterSec } : {}),
            ...(httpStatus !== undefined ? { httpStatus } : {}),
            ...(vendorStatus !== undefined ? { vendorStatus } : {}),
            ...(vendorMessage !== undefined ? { vendorMessage } : {}),
          },
          ...(url !== undefined ? { url } : {}),
        });
      }
    })
    .catch((e: unknown) => {
      const error = mapError({ kind: 'thrown', error: e });
      sendResponse({ ok: false, type: decision.msg.type, error });
      void reporter.capture({
        source: 'thrown',
        error: { code: error.code, message: error.message },
      });
    });
  return true; // async sendResponse → keep channel open
});

// A4: relay a fired chrome.commands keyboard shortcut to the active tab's content script.
// tab.id can be undefined for certain tab kinds (devtools, etc.) — skip those defensively.
// The `command` cast is safe: Chrome only fires onCommand for names declared in
// manifest.json's "commands" key (Task 3), which are exactly LookupCommand's 3 values.
chrome.commands.onCommand.addListener((command, tab) => {
  if (tab.id === undefined) return;
  const message: CommandMessage = {
    type: 'command',
    command: command as CommandMessage['command'],
  };
  void chrome.tabs.sendMessage(tab.id, message).catch(() => undefined); // no listener/tab gone
});

// C1: the very first thing a fresh install sees is the welcome screen, instead of the lucky few
// who stumble into it via the no-key card's "Open Settings" button or the side panel. Fires only
// on a genuine 'install' (never 'update') and is skipped when the build baked a Gemini key
// (shouldOpenOnboardingOnInstall's own doc comment). Chrome fires onInstalled exactly once per
// real install, so the reason check alone is the whole "no re-prompting loop" guarantee — no
// extra storage flag needed. Uses chrome.tabs.create (not openOptionsPage) because
// openOptionsPage() at cold install launch resolves without creating a tab (campaign ruling R1);
// chrome.tabs.create needs no manifest permission.
chrome.runtime.onInstalled.addListener((details) => {
  if (shouldOpenOnboardingOnInstall(details.reason, Boolean(ENV_API_KEY))) {
    void Promise.resolve(chrome.tabs.create({ url: chrome.runtime.getURL('options.html') })).catch(
      () => undefined,
    );
  }
});

// Side panel: open only via toolbar click (§6.5); never the primary surface.
chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => undefined);

// C7: finish-setup toolbar badge. MV3 service workers are ephemeral — nothing here is cached in
// memory; every refresh re-reads storage via settingsStore.get() (see design spec D3).
// @types/chrome's `Manifest` union (ManifestV2 | ManifestV3) only carries `action` explicitly on
// ManifestV3 — on the bare union it falls through ManifestBase's `[key: string]: any` index
// signature and infers `any`. Asserting ManifestV3 (this codebase only ships MV3, per manifest.json)
// keeps the read soundly typed as `string | undefined`.
const DEFAULT_ACTION_TITLE =
  (chrome.runtime.getManifest() as chrome.runtime.ManifestV3).action?.default_title ??
  'AI Dictionary';
// Sourced from design-system/tokens.css's SEPIA --ad-error: oklch(0.520 0.160 28) (tokens.css:122)
// — chrome.action paints outside any DOM/CSSOM this extension controls, so the token can't be
// read live (design spec D5; flagged for tracker review as an intentional shell-level exception
// to the no-hard-coded-hex rule, which binds ui/ shadow-DOM components, not this composition root).
const BADGE_SETUP_COLOR = '#b33830';

async function refreshSetupBadge(): Promise<void> {
  const { hasKey } = await settingsStore.get();
  const state = badgeStateFor(hasKey);
  await chrome.action.setBadgeText({ text: state.text });
  await chrome.action.setTitle({ title: state.title || DEFAULT_ACTION_TITLE });
  if (state.text) await chrome.action.setBadgeBackgroundColor({ color: BADGE_SETUP_COLOR });
}

void refreshSetupBadge(); // SW-start evaluation — MV3 ephemerality (design spec D3, point 1)
chrome.storage.onChanged.addListener((changes, areaName) => {
  // Re-derive on every settings write (activation, or a key later cleared) — design spec D3,
  // point 2. No cache to invalidate: refreshSetupBadge always re-reads storage fresh.
  if (areaName === 'local' && 'settings' in changes) void refreshSetupBadge();
});
