/**
 * Shared setup for the browser suites.
 *
 * These suites drive the real application in a real Chromium: they are what
 * catches the things Node cannot see — a layout that overflows at 400px, a
 * Content-Security-Policy that refuses the import map, a worker that never
 * starts, a `ReferenceError` on a code path no headless test reaches.
 *
 * They lived outside the repository for a while, which was a mistake worth
 * naming: two documents cited "nine browser suites" as evidence, and a reader
 * could not run a single one of them. Evidence nobody else can reproduce is
 * not evidence. This module is what made them portable — everything that was
 * specific to one machine is resolved here instead of hardcoded in eleven
 * files.
 *
 * Three things are resolved:
 *
 *   The Chromium binary, which is wherever the local Playwright install put
 *   it, and in CI is somewhere else again.
 *
 *   The server. Each suite serves the repository itself on an OS-assigned
 *   port, so suites can run concurrently and nothing collides with a port
 *   someone happens to be using. It closes when the process exits.
 *
 *   Screenshots, which go to a gitignored directory rather than /tmp, so they
 *   can be looked at after a failure.
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

// `fileURLToPath`, not `.pathname`. On Windows a file URL's pathname is
// `/D:/a/repo/...` — a leading slash before the drive letter — which is not a
// path any filesystem call accepts. Every read against it fails, which is how
// four suites came to fail on the Windows runner while passing everywhere else.
export const ROOT = fileURLToPath(new URL('../..', import.meta.url)).replace(/[\\/]$/, '');

/* ------------------------------------------------------------- Chromium */

/**
 * Where Chromium is, tried in the order most likely to be right.
 *
 * `playwright-core` ships no browser of its own, so its `executablePath()` is
 * a guess about where `playwright install` would have put one and is wrong as
 * often as not. The environment variable wins, then a real directory scan,
 * then the guess, then the system browser.
 */
export function chromePath() {
  const candidates = [];
  if (process.env.CHROME_PATH) candidates.push(process.env.CHROME_PATH);

  const browsersDir = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (browsersDir && existsSync(browsersDir)) {
    for (const entry of readdirSync(browsersDir)) {
      if (!entry.startsWith('chromium')) continue;
      candidates.push(
        join(browsersDir, entry, 'chrome-linux', 'chrome'),
        join(browsersDir, entry, 'chrome-win', 'chrome.exe'),
        join(browsersDir, entry, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
      );
    }
  }
  try { candidates.push(chromium.executablePath()); } catch { /* none installed */ }
  candidates.push(
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  );

  const found = candidates.find(p => p && existsSync(p));
  if (!found) {
    console.error(
      'No Chromium found. Install one with `npx playwright install chromium`,\n' +
      'or point CHROME_PATH at an existing browser.',
    );
    process.exit(2);
  }
  return found;
}

/**
 * Software rendering, because CI has no GPU.
 *
 * `--enable-unsafe-swiftshader` is required rather than optional: without it
 * Chromium refuses the software WebGL fallback outright and every 3D check
 * fails for a reason that has nothing to do with the application.
 */
export const LAUNCH_ARGS = [
  '--no-sandbox',
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--disable-dev-shm-usage',
];

/* --------------------------------------------------------------- server */

const TYPES = new Map(Object.entries({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon',
}));

/**
 * Serve the repository on a free loopback port.
 *
 * Containment is checked here too. This server only ever serves a checkout on
 * a developer's own machine, so it is not a security boundary in the way
 * desktop/protocol.cjs is — but a test harness that would happily read
 * `../../.ssh/id_rsa` is a bad thing to leave lying in a repository, and the
 * check is three lines.
 */
export function serve(root = ROOT) {
  const base = resolve(root);
  const server = createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
    const full = resolve(base, rel);
    if (full !== base && !full.startsWith(base + sep)) { res.writeHead(403); res.end(); return; }
    if (!existsSync(full)) { res.writeHead(404); res.end('Not found'); return; }
    try {
      res.writeHead(200, {
        'Content-Type': TYPES.get(extname(full).toLowerCase()) || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(readFileSync(full));
    } catch { res.writeHead(500); res.end(); }
  });
  return new Promise((ready, fail) => {
    server.on('error', fail);
    server.listen(0, '127.0.0.1', () => {
      const base = `http://127.0.0.1:${server.address().port}`;
      const close = () => { try { server.close(); } catch { /* already closed */ } };
      process.on('exit', close);
      ready({ base, url: `${base}/index.html`, close });
    });
  });
}

/* ------------------------------------------------------------ watchdog */

/**
 * Turn a hang into a failure with a message.
 *
 * What this does *not* guard is worth stating, because it was the first guess
 * and it was wrong: a suite that throws before `browser.close()` does not
 * hang. Node tears the process down on an unhandled top-level rejection even
 * with a Chromium still open — measured, not assumed.
 *
 * What does hang is an await that never settles: a Playwright wait given no
 * timeout, a page event that never fires, a promise nothing resolves. The
 * browser then keeps the event loop alive with nothing left to move it, and
 * with no timeout on the CI job that holds a runner for GitHub's default six
 * hours before anyone learns anything. This turns that into one line and a
 * non-zero exit.
 *
 * `unref` matters: the timer must not itself be a reason the process stays up,
 * or it would add the very delay it exists to prevent.
 */
export function watchdog(seconds = 420) {
  const timer = setTimeout(() => {
    console.log(`\nFAIL the suite did not finish within ${seconds}s and was stopped`);
    console.log('     (an await that never settled: a wait with no timeout, or an event that never fired)');
    process.exit(1);
  }, seconds * 1000);
  timer.unref();
  return timer;
}

/* ----------------------------------------------------------- reporting */

/** Where screenshots go. Gitignored, so a failure can be looked at. */
export function shotsDir(name) {
  const dir = join(ROOT, 'test-artifacts', name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * A suite's result list, printed in the same format every other suite here
 * uses so that one runner can count them all.
 */
export function reporter() {
  const lines = [];
  const check = (name, ok, extra = '') => {
    lines.push(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? '  - ' + extra : ''}`);
  };
  const finish = (errors = []) => {
    console.log(lines.join('\n'));
    const failed = lines.filter(l => l.startsWith('FAIL')).length;
    const unique = [...new Set(errors)];
    if (unique.length) {
      console.log(`\nCONSOLE ERRORS: ${unique.length}`);
      for (const e of unique.slice(0, 15)) console.log('  - ' + e);
    }
    console.log(`\n${lines.length - failed}/${lines.length} checks passed`);
    return failed || unique.length ? 1 : 0;
  };
  return { check, finish, lines };
}
