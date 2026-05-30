import { describe, it, expect, vi } from 'vitest';
import { ChromeFloatingTrigger } from '../src/adapters/chrome-floating-trigger';
import '@ai-dict/shared-ui/lookup-trigger';

describe('ChromeFloatingTrigger (TriggerUI via <lookup-trigger>)', () => {
  it('show() mounts the trigger and fires onClick on lookup-click; hide() removes it', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const trigger = new ChromeFloatingTrigger(host);
    const onClick = vi.fn();
    trigger.show({ x: 10, y: 20, w: 5, h: 5 }, onClick);
    const el = host.querySelector('lookup-trigger')!;
    expect(el).not.toBeNull();
    el.dispatchEvent(new CustomEvent('lookup-click', { bubbles: true }));
    expect(onClick).toHaveBeenCalledTimes(1);
    trigger.hide();
    expect(host.querySelector('lookup-trigger')).toBeNull();
  });

  it('show() twice reuses a single trigger element (re-anchors, no duplicates)', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const trigger = new ChromeFloatingTrigger(host);
    trigger.show({ x: 0, y: 0, w: 1, h: 1 }, () => {});
    trigger.show({ x: 9, y: 9, w: 1, h: 1 }, () => {});
    expect(host.querySelectorAll('lookup-trigger').length).toBe(1);
  });
});
