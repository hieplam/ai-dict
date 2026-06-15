// Rasterize brand assets with Playwright's bundled Chromium (no SVG-rasterizer dependency,
// and not the installed Google Chrome — per the repo screenshot guardrail). Run locally to
// (re)generate committed PNGs: `cd packages/extension-chrome && bun scripts/generate-brand-assets.mjs`
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, '..');
const repoRoot = resolve(pkgRoot, '../..');
const iconsDir = resolve(pkgRoot, 'src/icons');
const storeDir = resolve(repoRoot, 'docs/store/chrome');
const svg = await readFile(resolve(iconsDir, 'icon.svg'), 'utf8');

const browser = await chromium.launch();
try {
  for (const size of [16, 32, 48, 128]) {
    const page = await browser.newPage({
      viewport: { width: size, height: size },
      deviceScaleFactor: 1,
    });
    await page.setContent(
      `<!doctype html><meta charset="utf8"><style>*{margin:0;padding:0}html,body{width:${size}px;height:${size}px}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
      { waitUntil: 'networkidle' },
    );
    await page.screenshot({
      path: resolve(iconsDir, `icon-${size}.png`),
      omitBackground: true,
      clip: { x: 0, y: 0, width: size, height: size },
    });
    await page.close();
  }

  await mkdir(storeDir, { recursive: true });
  const promo = await browser.newPage({
    viewport: { width: 440, height: 280 },
    deviceScaleFactor: 1,
  });
  await promo.setContent(
    `<!doctype html><meta charset="utf8"><style>
       *{margin:0;padding:0;box-sizing:border-box}
       body{width:440px;height:280px;display:flex;align-items:center;gap:22px;
            padding:0 34px;background:#2f6f4e;color:#fff;font-family:Georgia,'DejaVu Serif',serif}
       .mark{flex:0 0 96px;height:96px;border-radius:22px;background:#26593f;
             display:flex;align-items:center;justify-content:center;font-size:64px;font-weight:700}
       .mark u{text-decoration:none;border-bottom:6px solid #bfe3cf;padding-bottom:2px}
       h1{font-size:34px;line-height:1.1;margin-bottom:10px}
       p{font-size:16px;color:#d8efe1;font-family:-apple-system,Segoe UI,Roboto,sans-serif}
     </style>
     <div class="mark"><u>A</u></div>
     <div><h1>AI Dictionary</h1><p>Look up any word — right where you're reading.</p></div>`,
    { waitUntil: 'networkidle' },
  );
  await promo.screenshot({
    path: resolve(storeDir, 'promo-440x280.png'),
    clip: { x: 0, y: 0, width: 440, height: 280 },
  });
  await promo.close();
} finally {
  await browser.close();
}
console.log('brand assets generated');
