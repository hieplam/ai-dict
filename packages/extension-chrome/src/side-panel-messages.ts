import type { LookupResult, LookupError } from '@ai-dict/app';

/**
 * The current lookup the side panel should focus, mirror-shaped: it matches what
 * ChromeSidePanelMirror already posts to `{ to: 'side-panel', … }`, minus the `to` field.
 */
export type SidePanelFocus =
  | { state: 'loading'; word?: string }
  | { state: 'result'; payload: LookupResult }
  | { state: 'error'; payload: LookupError };

/** content script → service worker. Relayed inside a user gesture so the SW may open the panel. */
export interface OpenSidePanelMessage {
  type: 'open-side-panel';
  focus?: SidePanelFocus;
}

/** side panel page → service worker, on boot, to recover the lookup it may have missed. */
export interface GetSidePanelFocusMessage {
  type: 'side-panel.get-focus';
}

/** service worker → side panel page: the cached focus, or null if there is none. */
export interface SidePanelFocusReply {
  focus: SidePanelFocus | null;
}

function hasType(msg: unknown): msg is { type: unknown } {
  return typeof msg === 'object' && msg !== null && 'type' in msg;
}

export function isOpenSidePanel(msg: unknown): msg is OpenSidePanelMessage {
  return hasType(msg) && msg.type === 'open-side-panel';
}

export function isGetSidePanelFocus(msg: unknown): msg is GetSidePanelFocusMessage {
  return hasType(msg) && msg.type === 'side-panel.get-focus';
}
