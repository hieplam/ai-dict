import { describe, it, expect } from 'vitest';
import { isOpenSidePanel, isGetSidePanelFocus } from './side-panel-messages';

describe('side-panel message guards', () => {
  it('isOpenSidePanel accepts a well-formed open message (with and without focus)', () => {
    expect(isOpenSidePanel({ type: 'open-side-panel' })).toBe(true);
    expect(
      isOpenSidePanel({ type: 'open-side-panel', focus: { state: 'loading', word: 'x' } }),
    ).toBe(true);
  });

  it('isOpenSidePanel rejects other shapes', () => {
    expect(isOpenSidePanel({ type: 'lookup' })).toBe(false);
    expect(isOpenSidePanel(null)).toBe(false);
    expect(isOpenSidePanel(undefined)).toBe(false);
    expect(isOpenSidePanel('open-side-panel')).toBe(false);
  });

  it('isGetSidePanelFocus accepts only the boot probe', () => {
    expect(isGetSidePanelFocus({ type: 'side-panel.get-focus' })).toBe(true);
    expect(isGetSidePanelFocus({ type: 'open-side-panel' })).toBe(false);
    expect(isGetSidePanelFocus({})).toBe(false);
  });
});
