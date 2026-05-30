import * as esbuild from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';

await mkdir('dist', { recursive: true });
const common = { bundle: true, minify: true, sourcemap: false, target: ['chrome116'], logLevel: 'info' };

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
