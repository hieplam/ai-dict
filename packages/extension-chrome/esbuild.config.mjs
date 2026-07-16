import * as esbuild from 'esbuild';
import { mkdir, copyFile, writeFile } from 'node:fs/promises';

await mkdir('dist', { recursive: true });

// Build-time injection of the Gemini API key. If GEMINI_API_KEY is set in the
// shell environment when this script runs, it is baked into the SW bundle and
// the SW will use it instead of asking the user via the options page. The
// options page still works as a fallback for users who build without the env
// var set. Anyone who can read the .crx can extract the key — treat builds
// with this env var as personal/dev artefacts, not for distribution.
const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? '';
const HAS_ENV_KEY = GEMINI_API_KEY.length > 0;
const GA4_MEASUREMENT_ID = process.env.GA4_MEASUREMENT_ID ?? '';
const GA4_API_SECRET = process.env.GA4_API_SECRET ?? '';

// C10: a small, boolean-only marker the e2e harness reads to refuse running against a dist/
// built with a leaked GEMINI_API_KEY (see build-guard.ts). Never the key itself — S1. Written
// BEFORE any esbuild.build() call so that if a later build step throws, the marker written for
// THIS attempt still correctly reflects whether GEMINI_API_KEY was present — it can never lag
// behind the sw.ts build (the first build, and the one that bakes the real key into sw.js).
await writeFile('dist/build-meta.json', JSON.stringify({ geminiKeyFromEnv: HAS_ENV_KEY }));

const common = {
  bundle: true,
  minify: true,
  sourcemap: false,
  target: ['chrome116'],
  logLevel: 'info',
};

await esbuild.build({
  ...common,
  entryPoints: ['src/sw.ts'],
  outfile: 'dist/sw.js',
  format: 'esm',
  define: {
    __GEMINI_API_KEY__: JSON.stringify(GEMINI_API_KEY),
    __GA4_MEASUREMENT_ID__: JSON.stringify(GA4_MEASUREMENT_ID),
    __GA4_API_SECRET__: JSON.stringify(GA4_API_SECRET),
  },
});

// content-elements.js: runs in world:"MAIN" (manifest content_scripts.world).
// Registers the shared-ui custom elements in the page's real CustomElementRegistry.
// Chrome MV3 isolated worlds expose a null customElements proxy — the MAIN world script
// is the correct place for customElements.define calls.
await esbuild.build({
  ...common,
  entryPoints: ['src/content-elements.ts'],
  outfile: 'dist/content-elements.js',
  format: 'iife',
});

// content.js: runs in the isolated world (default). Has full chrome.* API access.
// Its bundled shared-ui imports call customElements.get/define. In the isolated world the
// CustomElementRegistry is null (non-writable, non-configurable). Use esbuild `define` to
// replace all `customElements` references inside the bundle with a safe no-op shim (__ce).
// The real element definitions from content-elements.js are shared via the DOM.
const contentBanner = {
  js: 'var __ce={get:function(){return true;},define:function(){},whenDefined:function(){return Promise.resolve();}};',
};
await esbuild.build({
  ...common,
  entryPoints: ['src/content.ts'],
  outfile: 'dist/content.js',
  format: 'iife',
  banner: contentBanner,
  define: { customElements: '__ce' },
});
await esbuild.build({
  ...common,
  entryPoints: ['src/options.ts'],
  outfile: 'dist/options.js',
  format: 'esm',
  define: { __GEMINI_KEY_FROM_ENV__: JSON.stringify(HAS_ENV_KEY) },
});
await esbuild.build({
  ...common,
  entryPoints: ['src/side-panel.ts'],
  outfile: 'dist/side-panel.js',
  format: 'esm',
  // The side panel skips its no-key setup nag when the key is baked into the build, so it needs
  // this flag defined too (same as options.js); without it the reference throws at runtime.
  define: { __GEMINI_KEY_FROM_ENV__: JSON.stringify(HAS_ENV_KEY) },
});

await copyFile('src/manifest.json', 'dist/manifest.json');
await copyFile('src/options.html', 'dist/options.html');
await copyFile('src/side-panel.html', 'dist/side-panel.html');
await mkdir('dist/icons', { recursive: true });
for (const size of [16, 32, 48, 128]) {
  await copyFile(`src/icons/icon-${size}.png`, `dist/icons/icon-${size}.png`);
}
