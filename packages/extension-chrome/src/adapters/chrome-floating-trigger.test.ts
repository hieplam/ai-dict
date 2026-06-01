import { describe, it, expect, vi } from 'vitest';
import { ChromeFloatingTrigger } from './chrome-floating-trigger';
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

  it('dismisses the trigger when the user presses down outside the bubble', () => {
    const host = document.createElement('div');
    const outside = document.createElement('div');
    document.body.append(host, outside);
    const trigger = new ChromeFloatingTrigger(host);
    trigger.show({ x: 10, y: 20, w: 5, h: 5 }, vi.fn());
    expect(host.querySelector('lookup-trigger')).not.toBeNull();
    outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, composed: true }));
    expect(host.querySelector('lookup-trigger')).toBeNull();
  });

  it('does NOT dismiss when the press lands inside the bubble (so the Define click still fires)', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const trigger = new ChromeFloatingTrigger(host);
    const onClick = vi.fn();
    trigger.show({ x: 10, y: 20, w: 5, h: 5 }, onClick);
    const el = host.querySelector('lookup-trigger')!;
    const btn = el.shadowRoot!.querySelector('button')!;
    btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, composed: true }));
    expect(host.querySelector('lookup-trigger')).not.toBeNull();
    el.dispatchEvent(new CustomEvent('lookup-click', { bubbles: true }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('stops listening for outside presses once hidden (no dismissal leaks across mounts)', () => {
    const host = document.createElement('div');
    const outside = document.createElement('div');
    document.body.append(host, outside);
    const trigger = new ChromeFloatingTrigger(host);
    trigger.show({ x: 0, y: 0, w: 1, h: 1 }, vi.fn());
    trigger.hide();
    // A stray press after hide must not throw or re-trigger any handler.
    expect(() =>
      outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, composed: true })),
    ).not.toThrow();
    // Re-show: the bubble must survive an inside press (listener was cleanly reset).
    trigger.show({ x: 0, y: 0, w: 1, h: 1 }, vi.fn());
    const btn = host.querySelector('lookup-trigger')!.shadowRoot!.querySelector('button')!;
    btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, composed: true }));
    expect(host.querySelector('lookup-trigger')).not.toBeNull();
  });
});
