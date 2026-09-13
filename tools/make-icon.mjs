/**
 * Rasterise the application icon from the one SVG that already defines it.
 *
 * The desktop build shipped with Electron's default icon, because
 * electron-builder looks for `desktop/build/icon.png` and there was none. The
 * result is a released application that looks like a generic Electron sample
 * in the taskbar and the Start menu, which is a poor first impression for
 * something whose whole pitch is that it is carefully made.
 *
 * The icon is not redrawn here. assets/favicon.svg is already the mark the web
 * application uses, and having a second, hand-made raster drift away from it is
 * exactly the kind of duplication this repository avoids elsewhere. This
 * renders that file, so the two cannot disagree.
 *
 * 1024×1024 because electron-builder derives every size it needs from one
 * square PNG of at least 256×256, including the Windows .ico, and downscaling
 * is the direction that keeps the edges clean.
 *
 * Chromium does the rasterising because it is already here for the browser
 * suites, and adding an SVG library to a project with one runtime dependency
 * to draw one file would be a poor trade.
 *
 *   node tools/make-icon.mjs
 */
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromePath, LAUNCH_ARGS } from './browser/harness.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SIZE = 1024;

const svg = readFileSync(join(root, 'assets/favicon.svg'), 'utf8');
const out = join(root, 'desktop/build/icon.png');
mkdirSync(dirname(out), { recursive: true });

const browser = await chromium.launch({ executablePath: chromePath(), args: LAUNCH_ARGS });
const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE } });

// The SVG is inlined rather than loaded from a file:// URL so that nothing
// about this depends on the page's own network or file permissions. The margin
// reset matters: a default body margin would offset the mark inside the square
// and leave a transparent strip down two sides of every icon size derived
// from it.
await page.setContent(
  `<style>html,body{margin:0;padding:0}svg{display:block;width:${SIZE}px;height:${SIZE}px}</style>${svg}`,
);
await page.locator('svg').screenshot({ path: out, omitBackground: true });
await browser.close();

console.log(`wrote ${out} at ${SIZE}x${SIZE}`);
