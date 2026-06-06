import { describe, it, expect, vi } from 'vitest';
import { ChromeSidePanelMirror } from './chrome-side-panel-mirror';

const result = {
  markdown: '#',
  word: 'w',
  target: 'vi',
  model: 'gemini-2.5-flash',
  fromCache: false,
  fetchedAt: 1,
} as const;

describe('ChromeSidePanelMirror', () => {
  it('posts state transitions to the side panel', async () => {
    const sendMessage = vi.fn(() => Promise.resolve({}));
    const m = new ChromeSidePanelMirror({ sendMessage });
    m.renderLoading('resilient');
    m.renderResult(result);
    m.close();
    await Promise.resolve();
    expect(sendMessage).toHaveBeenCalledWith({
      to: 'side-panel',
      state: 'loading',
      word: 'resilient',
    });
    expect(sendMessage).toHaveBeenCalledWith({
      to: 'side-panel',
      state: 'result',
      payload: result,
    });
    expect(sendMessage).toHaveBeenCalledWith({ to: 'side-panel', state: 'close' });
  });

  it('renderError() posts the error state to the side panel', async () => {
    const sendMessage = vi.fn(() => Promise.resolve({}));
    const m = new ChromeSidePanelMirror({ sendMessage });
    const e = { code: 'NETWORK' as const, message: 'fail', retryable: false };
    m.renderError(e);
    await Promise.resolve();
    expect(sendMessage).toHaveBeenCalledWith({ to: 'side-panel', state: 'error', payload: e });
  });

  it('swallows a rejected send (panel closed → no receiver)', async () => {
    const m = new ChromeSidePanelMirror({
      sendMessage: vi.fn(() => Promise.reject(new Error('no receiving end'))),
    });
    expect(() => m.renderLoading()).not.toThrow();
    await Promise.resolve();
  });
});
