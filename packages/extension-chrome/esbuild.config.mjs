import * as esbuild from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';

await mkdir('dist', { recursive: true });
const common = { bundle: true, minify: true, sourcemap: false, target: ['chrome116'], logLevel: 'info' };

await esbuild.build({ ...common, entryPoints: ['src/sw.ts'],         outfile: 'dist/sw.js',         format: 'esm' });
// Content script runs in an isolated world where the bare `customElements` identifier
// may not be in scope (Chrome extension isolated worlds expose DOM APIs only through `window`).
// Inject a shim at the top of the IIFE so shared-ui's customElements.define/get work.
const contentBanner = { js: 'var customElements=window.customElements;' };
await esbuild.build({ ...common, entryPoints: ['src/content.ts'], outfile: 'dist/content.js', format: 'iife', banner: contentBanner });
await esbuild.build({ ...common, entryPoints: ['src/options.ts'],    outfile: 'dist/options.js',    format: 'esm' });
await esbuild.build({ ...common, entryPoints: ['src/side-panel.ts'], outfile: 'dist/side-panel.js', format: 'esm' });

await copyFile('src/manifest.json',    'dist/manifest.json');
await copyFile('src/options.html',     'dist/options.html');
await copyFile('src/side-panel.html',  'dist/side-panel.html');
