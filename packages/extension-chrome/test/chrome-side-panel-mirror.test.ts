import { describe, it, expect, vi } from 'vitest';
import { ChromeSidePanelMirror } from '../src/adapters/chrome-side-panel-mirror';

const result = { markdown: '#', word: 'w', target: 'vi', model: 'gemini-2.5-flash', fromCache: false, fetchedAt: 1 } as const;

describe('ChromeSidePanelMirror', () => {
  it('posts state transitions to the side panel', async () => {
    const sendMessage = vi.fn(async () => ({}));
    const m = new ChromeSidePanelMirror({ sendMessage });
    m.renderLoading(); m.renderResult(result); m.close();
    await Promise.resolve();
    expect(sendMessage).toHaveBeenCalledWith({ to: 'side-panel', state: 'loading' });
    expect(sendMessage).toHaveBeenCalledWith({ to: 'side-panel', state: 'result', payload: result });
    expect(sendMessage).toHaveBeenCalledWith({ to: 'side-panel', state: 'close' });
  });

  it('swallows a rejected send (panel closed → no receiver)', async () => {
    const m = new ChromeSidePanelMirror({ sendMessage: vi.fn(async () => { throw new Error('no receiving end'); }) });
    expect(() => m.renderLoading()).not.toThrow();
    await Promise.resolve();
  });
});
