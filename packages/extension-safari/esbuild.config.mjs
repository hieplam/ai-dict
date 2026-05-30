import * as esbuild from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';

await mkdir('dist', { recursive: true });
const common = { bundle: true, minify: true, sourcemap: false, target: ['safari16'], logLevel: 'info' };

await esbuild.build({ ...common, entryPoints: ['src/sw.ts'],      outfile: 'dist/sw.js',      format: 'esm' });
await esbuild.build({ ...common, entryPoints: ['src/content.ts'], outfile: 'dist/content.js', format: 'iife' });
await esbuild.build({ ...common, entryPoints: ['src/options.ts'], outfile: 'dist/options.js', format: 'esm' });

await copyFile('src/manifest.json', 'dist/manifest.json');
await copyFile('src/options.html',  'dist/options.html');
