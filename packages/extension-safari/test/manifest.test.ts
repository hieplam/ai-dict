import { describe, it, expect } from 'vitest';
import manifest from '../src/manifest.json';

describe('manifest.json (S5 CSP + S8 Safari permissions — exact)', () => {
  it('declares only storage; NO sidePanel / scripting / externally_connectable (S8)', () => {
    expect(manifest.permissions).toEqual(['storage']);
    expect(manifest.host_permissions).toEqual(['<all_urls>', 'https://generativelanguage.googleapis.com/*']);
    expect(manifest.permissions.includes('sidePanel')).toBe(false);
    expect(manifest.permissions.includes('scripting')).toBe(false);
    expect('side_panel' in manifest).toBe(false);
    expect('externally_connectable' in manifest).toBe(false);
  });
  it('has browser_specific_settings.safari.strict_min_version (D5)', () => {
    expect(manifest.browser_specific_settings.safari.strict_min_version).toBe('16.4');
  });
  it('extension_pages CSP matches §7.3 S5 exactly', () => {
    expect(manifest.content_security_policy.extension_pages).toBe(
      "default-src 'none'; script-src 'self'; object-src 'none'; connect-src https://generativelanguage.googleapis.com; img-src 'self' data:; style-src 'self'; base-uri 'none'; frame-ancestors 'none';",
    );
  });
  it('MV3 + statically registered content scripts (no scripting API)', () => {
    expect(manifest.manifest_version).toBe(3);
    const firstScript = manifest.content_scripts[0];
    if (!firstScript) throw new Error('No content scripts defined in manifest');
    expect(firstScript.matches).toEqual(['<all_urls>']);
  });
});
