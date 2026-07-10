export type LookupCommand = 'define-selection' | 'dismiss-lookup' | 'send-to-panel';

/** service worker → content script: relay a chrome.commands keyboard shortcut (A4). */
export interface CommandMessage {
  type: 'command';
  command: LookupCommand;
}

const COMMANDS: readonly LookupCommand[] = ['define-selection', 'dismiss-lookup', 'send-to-panel'];

function hasType(msg: unknown): msg is { type: unknown } {
  return typeof msg === 'object' && msg !== null && 'type' in msg;
}

export function isCommandMessage(msg: unknown): msg is CommandMessage {
  return (
    hasType(msg) &&
    msg.type === 'command' &&
    'command' in msg &&
    COMMANDS.includes((msg as { command: unknown }).command as LookupCommand)
  );
}
