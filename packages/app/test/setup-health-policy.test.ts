import { describe, it, expect } from 'vitest';
import { deriveKeyStatusRows, deriveShortcutRows } from '../src/domain/setup-health-policy';

describe('setup-health-policy', () => {
  it('deriveKeyStatusRows returns all three providers, canonical order, correct configured flags', () => {
    const rows = deriveKeyStatusRows(['anthropic', 'gemini']);
    expect(rows).toEqual([
      { provider: 'gemini', configured: true },
      { provider: 'openai', configured: false },
      { provider: 'anthropic', configured: true },
    ]);
  });

  it('deriveKeyStatusRows on an empty list marks every provider unconfigured', () => {
    expect(deriveKeyStatusRows([])).toEqual([
      { provider: 'gemini', configured: false },
      { provider: 'openai', configured: false },
      { provider: 'anthropic', configured: false },
    ]);
  });

  it('deriveShortcutRows maps assigned from a non-empty shortcut string', () => {
    const rows = deriveShortcutRows([
      {
        name: 'define-selection',
        description: 'Define the current text selection',
        shortcut: 'Alt+D',
      },
      { name: 'dismiss-lookup', description: 'Dismiss the lookup card', shortcut: '' },
    ]);
    expect(rows).toEqual([
      {
        name: 'define-selection',
        description: 'Define the current text selection',
        assigned: true,
      },
      { name: 'dismiss-lookup', description: 'Dismiss the lookup card', assigned: false },
    ]);
  });

  it('deriveShortcutRows defaults missing name/description/shortcut defensively', () => {
    expect(deriveShortcutRows([{}])).toEqual([{ name: '', description: '', assigned: false }]);
  });

  it('deriveShortcutRows preserves input order and count', () => {
    const input = [
      { name: 'a', description: '', shortcut: '' },
      { name: 'b', description: '', shortcut: 'Ctrl+B' },
      { name: 'c', description: '', shortcut: '' },
    ];
    expect(deriveShortcutRows(input).map((r) => r.name)).toEqual(['a', 'b', 'c']);
  });
});
