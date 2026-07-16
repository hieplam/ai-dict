import { describe, it, expect } from 'vitest';
import { createSaveReplyGuard } from '../../src/app/save-reply-guard';

describe('createSaveReplyGuard (B5 F2)', () => {
  it('a token obtained before any bump is current until the next bump', () => {
    const guard = createSaveReplyGuard();
    const token = guard.next();
    expect(guard.isCurrent(token)).toBe(true);
  });

  it('bumping invalidates a previously-issued token', () => {
    const guard = createSaveReplyGuard();
    const stale = guard.next();
    const fresh = guard.next();
    expect(guard.isCurrent(stale)).toBe(false);
    expect(guard.isCurrent(fresh)).toBe(true);
  });

  it('independent guard instances never interfere with each other', () => {
    const a = createSaveReplyGuard();
    const b = createSaveReplyGuard();
    const tokenA = a.next();
    b.next();
    b.next();
    expect(a.isCurrent(tokenA)).toBe(true);
  });
});
