import { describe, it, expect } from 'vitest';
import { badgeStateFor } from '../src/domain/badge-policy';

describe('badgeStateFor (C7)', () => {
  it('no usable key: shows the setup badge with the finish-setup title', () => {
    expect(badgeStateFor(false)).toEqual({ text: '!', title: 'Finish AI Dictionary setup' });
  });

  it('a usable key: clears the badge and defers the title to the shell default', () => {
    expect(badgeStateFor(true)).toEqual({ text: '', title: '' });
  });
});
