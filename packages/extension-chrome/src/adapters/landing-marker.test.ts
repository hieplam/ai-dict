import { describe, it, expect } from 'vitest';
import {
  LANDING_ORIGIN,
  LANDING_PATH_PREFIX,
  isLandingPage,
  stampInstallMarker,
  stampReadyMarker,
} from './landing-marker';

describe('landing-marker (C11)', () => {
  describe('isLandingPage', () => {
    it('is true for the exact landing origin + path prefix', () => {
      expect(isLandingPage({ origin: LANDING_ORIGIN, pathname: LANDING_PATH_PREFIX })).toBe(true);
    });

    it('is true for a deeper path under the prefix', () => {
      expect(
        isLandingPage({ origin: LANDING_ORIGIN, pathname: `${LANDING_PATH_PREFIX}index.html` }),
      ).toBe(true);
    });

    it('is false for a different origin', () => {
      expect(isLandingPage({ origin: 'https://example.com', pathname: LANDING_PATH_PREFIX })).toBe(
        false,
      );
    });

    it('is false for a different path prefix on the same origin', () => {
      expect(isLandingPage({ origin: LANDING_ORIGIN, pathname: '/other-repo/' })).toBe(false);
    });

    it('is false for a non-HTTPS scheme on the same host', () => {
      expect(
        isLandingPage({ origin: 'http://hieplam.github.io', pathname: LANDING_PATH_PREFIX }),
      ).toBe(false);
    });
  });

  describe('stampInstallMarker', () => {
    it('sets both the installed flag and the exact version string on any root element', () => {
      const root = document.createElement('div');
      stampInstallMarker(root, '1.8.0');
      expect(root.getAttribute('data-ad-dict-installed')).toBe('true');
      expect(root.getAttribute('data-ad-dict-version')).toBe('1.8.0');
    });
  });

  describe('stampReadyMarker', () => {
    it('stamps the string "true" when ready is true', () => {
      const root = document.createElement('div');
      stampReadyMarker(root, true);
      expect(root.getAttribute('data-ad-dict-ready')).toBe('true');
    });

    it('stamps the string "false" when ready is false', () => {
      const root = document.createElement('div');
      stampReadyMarker(root, false);
      expect(root.getAttribute('data-ad-dict-ready')).toBe('false');
    });
  });
});
