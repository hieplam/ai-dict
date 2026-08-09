import { describe, it, expect } from 'vitest';
import {
  registrableDomain,
  quietSiteAdd,
  quietSiteRemove,
  quietSiteList,
  isQuietSite,
} from '../src/domain/quiet-site-policy';
import type { Storage } from '../src';

function memStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => Promise.resolve(m.get(k) ?? null),
    setItem: (k, v) => {
      m.set(k, v);
      return Promise.resolve();
    },
    removeItem: (k) => {
      m.delete(k);
      return Promise.resolve();
    },
    keys: (p) => Promise.resolve([...m.keys()].filter((k) => !p || k.startsWith(p))),
  };
}

describe('quiet-site-policy', () => {
  describe('registrableDomain', () => {
    it('collapses a subdomain to its registrable last-two-labels domain', () => {
      expect(registrableDomain('docs.google.com')).toBe('google.com');
      expect(registrableDomain('www.example.com')).toBe('example.com');
    });

    it('passes through a bare 2-label host and localhost unchanged', () => {
      expect(registrableDomain('example.com')).toBe('example.com');
      expect(registrableDomain('localhost')).toBe('localhost');
    });

    it('passes through an IPv4 literal unchanged', () => {
      expect(registrableDomain('192.168.1.10')).toBe('192.168.1.10');
    });

    it('accepts a full https URL as input, not just a bare hostname', () => {
      expect(registrableDomain('https://docs.google.com/document/1')).toBe('google.com');
    });

    it('is case-insensitive', () => {
      expect(registrableDomain('DOCS.GOOGLE.COM')).toBe('google.com');
    });
  });

  describe('quietSiteAdd / quietSiteRemove / quietSiteList', () => {
    it('adds a new domain and returns the sorted list', async () => {
      const s = memStorage();
      const list = await quietSiteAdd({ storage: s }, 'example.com');
      expect(list).toEqual(['example.com']);
      expect(await quietSiteList({ storage: s })).toEqual(['example.com']);
    });

    it('adding an already-present domain is a no-op (no duplicate)', async () => {
      const s = memStorage();
      await quietSiteAdd({ storage: s }, 'example.com');
      const list = await quietSiteAdd({ storage: s }, 'example.com');
      expect(list).toEqual(['example.com']);
    });

    it('normalizes to the registrable domain before storing (a subdomain matches the bare domain)', async () => {
      const s = memStorage();
      await quietSiteAdd({ storage: s }, 'https://docs.google.com');
      const list = await quietSiteAdd({ storage: s }, 'mail.google.com');
      expect(list).toEqual(['google.com']);
    });

    it('removes a present domain', async () => {
      const s = memStorage();
      await quietSiteAdd({ storage: s }, 'example.com');
      const list = await quietSiteRemove({ storage: s }, 'example.com');
      expect(list).toEqual([]);
    });

    it('removing an absent domain is a no-op', async () => {
      const s = memStorage();
      const list = await quietSiteRemove({ storage: s }, 'example.com');
      expect(list).toEqual([]);
    });

    it('quietSiteList reflects the current state across add/remove, sorted', async () => {
      const s = memStorage();
      await quietSiteAdd({ storage: s }, 'b.com');
      await quietSiteAdd({ storage: s }, 'a.com');
      expect(await quietSiteList({ storage: s })).toEqual(['a.com', 'b.com']);
      await quietSiteRemove({ storage: s }, 'a.com');
      expect(await quietSiteList({ storage: s })).toEqual(['b.com']);
    });
  });

  describe('isQuietSite', () => {
    it('is true when the hostname normalizes to a domain in the list', () => {
      expect(isQuietSite(['example.com'], 'www.example.com')).toBe(true);
    });

    it('is false when it does not', () => {
      expect(isQuietSite(['example.com'], 'other.com')).toBe(false);
    });
  });
});
