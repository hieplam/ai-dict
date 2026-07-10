import { describe, it, expect } from 'vitest';
import { isCommandMessage } from './command-messages';

describe('command message guard (A4)', () => {
  it('accepts all 3 declared commands', () => {
    expect(isCommandMessage({ type: 'command', command: 'define-selection' })).toBe(true);
    expect(isCommandMessage({ type: 'command', command: 'dismiss-lookup' })).toBe(true);
    expect(isCommandMessage({ type: 'command', command: 'send-to-panel' })).toBe(true);
  });

  it('rejects an unknown command name', () => {
    expect(isCommandMessage({ type: 'command', command: 'nuke-everything' })).toBe(false);
  });

  it('rejects other shapes', () => {
    expect(isCommandMessage({ type: 'lookup' })).toBe(false);
    expect(isCommandMessage({ type: 'command' })).toBe(false); // missing command
    expect(isCommandMessage(null)).toBe(false);
    expect(isCommandMessage(undefined)).toBe(false);
    expect(isCommandMessage('command')).toBe(false);
  });
});
