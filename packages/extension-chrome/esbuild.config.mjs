import * as esbuild from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Wire-schema shim plugin
//
// @ai-dict/core's barrel (core/src/index.ts) re-exports wire-schema.ts, which
// imports zod and pulls in ~250 KB of schema + locale machinery.  At extension
// runtime the SW only needs a lightweight discriminant check (sender guard
// already ensures same-origin; a Set.has on msg.type is sufficient).
// This plugin intercepts the "./wire-schema" import inside core/src/ and
// replaces it with a minimal stub — zod is never loaded in the browser bundle.
// Unit tests still exercise the real WireMessageSchema (vitest runs against
// source files, not the bundle, so the shim is not applied there).
// ---------------------------------------------------------------------------
const coreSrcDir = resolve(dirname(fileURLToPath(import.meta.url)), '../core/src');

const wireSchemaShim = {
  name: 'wire-schema-shim',
  setup(build) {
    build.onResolve({ filter: /^\.\/wire-schema$/ }, (args) => {
      if (args.resolveDir === coreSrcDir) {
        return { path: 'lite-wire-schema', namespace: 'wire-shim' };
      }
      return null;
    });
    build.onLoad({ filter: /.*/, namespace: 'wire-shim' }, () => ({
      // Lightweight type-discriminant: same behaviour as WireMessageSchema.safeParse()
      // at the boundary (valid type string → route; anything else → reject).
      //
      // SECURITY NOTE: The full Zod WireMessageSchema validates payload shapes (e.g. req fields
      // for 'lookup'); unit tests in inbound.test.ts run against the real Zod schema.
      // This shim adds a structural guard for 'lookup': msg.req must be a non-null object with
      // a string `word` field, so a malformed { type:'lookup' } (no req) cannot reach the router
      // and crash the SW on req.word access. All other message types carry no payload that the
      // router destructures unsafely.
      contents: [
        'const VALID = new Set([',
        "  'lookup','lookup.cancel','settings.get',",
        "  'history.list','history.clear','cache.clear','connection.test'",
        ']);',
        'export const WireMessageSchema = {',
        '  safeParse(m) {',
        '    if (m == null || typeof m !== "object" || !VALID.has(m.type)) return { success: false };',
        '    // Structural guard for lookup: req must be an object with a string word field.',
        '    // Prevents a malformed lookup message from crashing the SW on req.word access.',
        '    if (m.type === "lookup" && (m.req == null || typeof m.req !== "object" || typeof m.req.word !== "string")) return { success: false };',
        '    return { success: true, data: m };',
        '  }',
        '};',
        'export function wireJsonSchema() { return {}; }',
      ].join('\n'),
      loader: 'js',
    }));
  },
};

await mkdir('dist', { recursive: true });
const common = {
  bundle: true,
  minify: true,
  sourcemap: false,
  target: ['chrome116'],
  logLevel: 'info',
  plugins: [wireSchemaShim],
};

await esbuild.build({ ...common, entryPoints: ['src/sw.ts'], outfile: 'dist/sw.js', format: 'esm' });

// content-elements.js: runs in world:"MAIN" (manifest content_scripts.world).
// Registers the shared-ui custom elements in the page's real CustomElementRegistry.
// Chrome MV3 isolated worlds expose a null customElements proxy — the MAIN world script
// is the correct place for customElements.define calls.
await esbuild.build({ ...common, entryPoints: ['src/content-elements.ts'], outfile: 'dist/content-elements.js', format: 'iife' });

// content.js: runs in the isolated world (default). Has full chrome.* API access.
// Its bundled shared-ui imports call customElements.get/define. In the isolated world the
// CustomElementRegistry is null (non-writable, non-configurable). Use esbuild `define` to
// replace all `customElements` references inside the bundle with a safe no-op shim (__ce).
// The real element definitions from content-elements.js are shared via the DOM.
const contentBanner = { js: 'var __ce={get:function(){return true;},define:function(){},whenDefined:function(){return Promise.resolve();}};' };
await esbuild.build({ ...common, entryPoints: ['src/content.ts'], outfile: 'dist/content.js', format: 'iife', banner: contentBanner, define: { customElements: '__ce' } });
await esbuild.build({ ...common, entryPoints: ['src/options.ts'],    outfile: 'dist/options.js',    format: 'esm' });
await esbuild.build({ ...common, entryPoints: ['src/side-panel.ts'], outfile: 'dist/side-panel.js', format: 'esm' });

await copyFile('src/manifest.json',    'dist/manifest.json');
await copyFile('src/options.html',     'dist/options.html');
await copyFile('src/side-panel.html',  'dist/side-panel.html');
