import { describe, it, expect } from 'vitest';
import manifest from '../src/manifest.json';

describe('manifest.json (S5 CSP + S8 permissions — exact)', () => {
  it('declares only storage + sidePanel; no scripting / externally_connectable (S8)', () => {
    expect(manifest.permissions).toEqual(['storage', 'sidePanel']);
    expect(manifest.host_permissions).toEqual(['<all_urls>']);
    expect(manifest.permissions.includes('scripting')).toBe(false);
    expect('externally_connectable' in manifest).toBe(false);
  });
  it('extension_pages CSP matches §7.3 S5 exactly', () => {
    expect(manifest.content_security_policy.extension_pages).toBe(
      "default-src 'none'; script-src 'self'; object-src 'none'; connect-src https://generativelanguage.googleapis.com https://api.openai.com https://api.anthropic.com https://www.google-analytics.com; img-src 'self' data:; style-src 'self'; base-uri 'none'; frame-ancestors 'none';",
    );
  });
  it('MV3 + statically registered content scripts (no scripting API)', () => {
    expect(manifest.manifest_version).toBe(3);
    const firstScript = manifest.content_scripts[0];
    if (!firstScript) throw new Error('No content scripts defined in manifest');
    expect(firstScript.matches).toEqual(['<all_urls>']);
  });
  it('content_scripts has exactly two entries: MAIN-world elements script + isolated content script (Amendment A)', () => {
    expect(manifest.content_scripts).toHaveLength(2);
    const script0 = manifest.content_scripts[0];
    const script1 = manifest.content_scripts[1];
    if (!script0 || !script1) throw new Error('Expected two content script entries in manifest');
    expect(script0).toMatchObject({ world: 'MAIN', js: ['content-elements.js'] });
    expect(script1).toMatchObject({ js: ['content.js'] });
    expect('world' in script1).toBe(false);
  });
  it('declares icons + action.default_icon (16/32/48/128) for toolbar and store', () => {
    const expected = {
      '16': 'icons/icon-16.png',
      '32': 'icons/icon-32.png',
      '48': 'icons/icon-48.png',
      '128': 'icons/icon-128.png',
    };
    expect(manifest.icons).toEqual(expected);
    expect(manifest.action.default_icon).toEqual(expected);
  });
});
