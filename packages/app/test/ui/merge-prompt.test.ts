import { describe, it, expect, vi } from 'vitest';
import { buildMergePrompt } from '../../src/ui/merge-prompt';

describe('buildMergePrompt', () => {
  it('renders "Add as new sense" and "Not now" buttons and fires the callback with the choice', () => {
    const onChoice = vi.fn();
    const node = buildMergePrompt({ word: 'bank', senseCount: 1, onChoice });
    const buttons = node.querySelectorAll('button');
    expect(buttons).toHaveLength(2);
    expect(buttons[0]!.textContent).toBe('Add as new sense');
    expect(buttons[1]!.textContent).toBe('Not now');
    (buttons[0] as HTMLButtonElement).click();
    expect(onChoice).toHaveBeenCalledWith(true);
    (buttons[1] as HTMLButtonElement).click();
    expect(onChoice).toHaveBeenCalledWith(false);
  });

  it('uses singular copy for senseCount:1 and plural copy for senseCount > 1', () => {
    const one = buildMergePrompt({ word: 'bank', senseCount: 1, onChoice: () => undefined });
    expect(one.textContent).toContain('a different sentence');
    const two = buildMergePrompt({ word: 'bank', senseCount: 2, onChoice: () => undefined });
    expect(two.textContent).toContain('already has 2 saved senses');
  });

  it('interpolates the word into the prompt copy', () => {
    const node = buildMergePrompt({
      word: 'serendipity',
      senseCount: 1,
      onChoice: () => undefined,
    });
    expect(node.textContent).toContain('serendipity');
  });
});
