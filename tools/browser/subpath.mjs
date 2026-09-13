/**
 * The application, served from a subdirectory rather than from the root.
 *
 * GitHub Pages serves a project site at `<user>.github.io/<repo>/`, so the base
 * path is the repository name. Renaming the repository moves the whole site,
 * and every other suite here serves from `/`, which is the one arrangement
 * that can never catch a path assumption.
 *
 * The failure this guards against is quiet and total. A service worker
 * registered with an absolute scope of `/` is refused outright by the browser
 * when the page lives at `/TesserCAD/`, so offline install stops working while
 * the page still loads and nothing appears in the console that a user would
 * see. An absolute `/src/...` import fails the same way: the app simply does
 * not start, on the hosted copy only, while every local check stays green.
 *
 * Nothing in this project uses an absolute path today. This is what keeps that
 * true, and it is what makes a rename, a move to a custom domain, or hosting
 * under any prefix a decision rather than a risk.
 */
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromePath, LAUNCH_ARGS, reporter, watchdog } from './harness.mjs';

watchdog();

const { check, finish } = reporter();
const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));

// A prefix that is not the repository name on purpose: what is being proved is
// independence from the prefix, not that one particular prefix happens to work.
const PREFIX = 'some-other-name';

const TYPES = new Map(Object.entries({
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.txt': 'text/plain', '.md': 'text/markdown',
  '.wasm': 'application/wasm',
}));

// Served here rather than through harness.serve() because this suite needs the
// site mounted under a prefix, and a directory request to resolve to its
// index.html. Both are properties of the host, not of the application.
const server = createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (!urlPath.startsWith(`/${PREFIX}/`)) { res.writeHead(404); return res.end('Not found'); }
  const rel = urlPath.slice(PREFIX.length + 2);
  let full = resolve(ROOT, rel || '.');
  if (full !== ROOT && !full.startsWith(ROOT + sep)) { res.writeHead(403); return res.end(); }
  if (existsSync(full) && statSync(full).isDirectory()) full = join(full, 'index.html');
  if (!existsSync(full)) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, {
    'Content-Type': TYPES.get(extname(full).toLowerCase()) || 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  res.end(readFileSync(full));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/${PREFIX}/`;

const browser = await chromium.launch({ executablePath: chromePath(), args: LAUNCH_ARGS });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
page.on('pageerror', e => errs.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

// Anything requested outside the prefix is a path assumption escaping the
// mount, and the server above answers 404 for it. Recorded rather than
// inferred, so a failure names the file.
const escaped = [];
page.on('requestfailed', r => { if (!r.url().includes(`/${PREFIX}/`)) escaped.push(r.url()); });
const spawned = [];
page.on('worker', w => spawned.push(w.url()));

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => window.tesserCAD?.build, null, { timeout: 60000 });

const app = await page.evaluate(() => ({
  baseURI: document.baseURI,
  tris: window.tesserCAD.build?.stats?.tris,
  bodies: window.tesserCAD.build?.stats?.bodies,
  commands: Object.keys(window.tesserCAD.commands || {}).length,
}));

check('the page loads from a subdirectory, not the server root',
  app.baseURI.endsWith(`/${PREFIX}/`), app.baseURI);
check('every module resolved, so no import is anchored to the root',
  app.commands > 100, `${app.commands} commands`);
check('and the demo model builds to the same geometry it does at the root',
  app.tris === 4008 && app.bodies === 1, `${app.bodies} body, ${app.tris} triangles`);

// The worker is registered as './sw.js' with scope './'. Under a prefix that
// has to resolve to the prefix; an absolute '/' scope would be refused.
const sw = await page.evaluate(async () => {
  const off = await import('./src/intel/offline.js');
  await off.install?.();
  const deadline = Date.now() + 45000;
  let last = null;
  while (Date.now() < deadline) {
    last = await off.status();
    if (last.controlled && last.files >= 50) return last;
    await new Promise(r => setTimeout(r, 500));
  }
  return last;
});
const scope = await page.evaluate(async () =>
  (await navigator.serviceWorker.getRegistration('./'))?.scope || '');

check('the service worker registers under the subdirectory, not at the root',
  scope.endsWith(`/${PREFIX}/`), scope || '(no registration)');
check('it takes control there', sw?.controlled === true, JSON.stringify({ controlled: sw?.controlled }));
check('and caches the whole application, so offline use survives the move',
  (sw?.files || 0) >= 50, `${sw?.files} files`);

// The workers are the other thing fetched by URL rather than resolved by an
// import statement, so they are the second place a root-anchored path could
// hide. Measured two ways: what the pool reports, and what the browser
// actually spawned, because the pool reporting a size it never achieved is
// precisely the failure worth catching.
const rep = await page.evaluate(async () =>
  (await import('./src/core/csg-pool.js')).pool.report());
check('the boolean worker pool starts under the prefix',
  rep.size > 0, `${rep.size} workers for ${rep.cores} cores`);
check('and the browser really spawned them from the prefixed URL',
  spawned.length > 0 && spawned.every(u => u.includes(`/${PREFIX}/`)),
  spawned.length ? `${spawned.length}: ${spawned[0]}` : 'none spawned');

check('nothing requested a path outside the subdirectory',
  escaped.length === 0, escaped.slice(0, 5).join(' | '));

await browser.close();
server.close();
process.exit(finish(errs));
