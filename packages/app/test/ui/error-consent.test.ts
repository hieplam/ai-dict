import { describe, it, expect, vi } from 'vitest';
import { buildConsentFooter } from '../../src/ui/error-consent';

describe('buildConsentFooter', () => {
  it('renders Send and Not now buttons and fires the callback with the choice', () => {
    const onChoice = vi.fn();
    const node = buildConsentFooter({ count: 3, onChoice });
    const buttons = node.querySelectorAll('button');
    expect(buttons).toHaveLength(2);
    expect(node.textContent).toContain('3');
    (buttons[0] as HTMLButtonElement).click();
    expect(onChoice).toHaveBeenCalledWith('granted');
    (buttons[1] as HTMLButtonElement).click();
    expect(onChoice).toHaveBeenCalledWith('declined');
  });
});
