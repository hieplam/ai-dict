import { describe, it, expect } from 'vitest';
import { shouldOpenOnboardingOnInstall } from '../src/domain/onboarding-policy';

describe('shouldOpenOnboardingOnInstall (C1)', () => {
  it('opens onboarding on a genuine install with no env key baked', () => {
    expect(shouldOpenOnboardingOnInstall('install', false)).toBe(true);
  });

  it('is skipped on install when the build baked an env key', () => {
    expect(shouldOpenOnboardingOnInstall('install', true)).toBe(false);
  });

  it('never opens on an update, even with no env key baked', () => {
    expect(shouldOpenOnboardingOnInstall('update', false)).toBe(false);
  });

  it('never opens on an update when an env key is also baked', () => {
    expect(shouldOpenOnboardingOnInstall('update', true)).toBe(false);
  });

  it('never opens for any other install reason (chrome_update, shared_module_update)', () => {
    expect(shouldOpenOnboardingOnInstall('chrome_update', false)).toBe(false);
    expect(shouldOpenOnboardingOnInstall('shared_module_update', false)).toBe(false);
  });
});
