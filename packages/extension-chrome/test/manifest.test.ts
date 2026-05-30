import { describe, it, expect } from 'vitest';
import manifest from '../src/manifest.json';

describe('manifest.json (S5 CSP + S8 permissions — exact)', () => {
  it('declares only storage + sidePanel; no scripting / externally_connectable (S8)', () => {
    expect(manifest.permissions).toEqual(['storage', 'sidePanel']);
    expect(manifest.host_permissions).toEqual(['<all_urls>', 'https://generativelanguage.googleapis.com/*']);
    expect('scripting' in (manifest.permissions as unknown as string[])).toBe(false);
    expect('externally_connectable' in manifest).toBe(false);
  });
  it('extension_pages CSP matches §7.3 S5 exactly', () => {
    expect(manifest.content_security_policy.extension_pages).toBe(
      "default-src 'none'; script-src 'self'; object-src 'none'; connect-src https://generativelanguage.googleapis.com; img-src 'self' data:; style-src 'self'; base-uri 'none'; frame-ancestors 'none';",
    );
  });
  it('MV3 + statically registered content scripts (no scripting API)', () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.content_scripts[0].matches).toEqual(['<all_urls>']);
  });
});
