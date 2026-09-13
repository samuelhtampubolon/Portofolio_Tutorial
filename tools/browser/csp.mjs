/**
 * The Content-Security-Policy, checked in a real browser by attacking it.
 *
 * This is the suite that matters most for the claim the README makes, because
 * a CSP is the one security control here that is *enforced by something other
 * than this project's own code*. Everything else is an assertion about how the
 * application behaves; this is an assertion about what the browser will let it
 * do even if the application is wrong.
 *
 * It also guards a specific failure that has already happened once. The policy
 * pins the inline import map by SHA-256, and the import map is what makes the
 * bare specifier `three` resolve. A stale hash does not degrade anything
 * gracefully: the browser refuses the map, every module fails to resolve, and
 * the application does not start at all. `tools/check-csp.mjs` recomputes the
 * hash in `npm test`, and this confirms the result in the browser that has to
 * accept it.
 *
 * Three attacks are run rather than described: an inline script injected into
 * the DOM, an external script from another origin, and an outbound fetch. Each
 * must fail. The vacuity problem is real here — a page that failed to load
 * would also "block" all three — so the suite first requires the application
 * to have fully booted, and only then attacks it.
 */
import { chromium } from 'playwright-core';
import { chromePath, LAUNCH_ARGS, serve, reporter } from './harness.mjs';

const { check, finish } = reporter();
const server = await serve();
const browser = await chromium.launch({ executablePath: chromePath(), args: LAUNCH_ARGS });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const violations = [];
const errors = [];
page.on('console', (m) => {
  const text = m.text();
  if (/Content Security Policy|Refused to/i.test(text)) violations.push(text.slice(0, 180));
  else if (m.type() === 'error') errors.push(text.slice(0, 160));
});
page.on('pageerror', e => errors.push('pageerror: ' + e.message.slice(0, 160)));

// `load`, not `networkidle`: the attacks below deliberately start requests the
// policy refuses, and a refused request can leave `networkidle` waiting for a
// quiet moment that never arrives.
await page.goto(`${server.base}/index.html`, { waitUntil: 'load' });

let booted = true;
try {
  await page.waitForFunction(() => window.tesserCAD?.build, null, { timeout: 30000 });
} catch { booted = false; }

/* ------------------------------------------- the policy is not in the way */

check('the application boots with the policy applied', booted);

const state = await page.evaluate(async () => ({
  commands: window.tesserCAD?.commands?.length ?? 0,
  tris: window.tesserCAD?.build?.stats?.tris ?? 0,
  pool: (await import('/src/core/csg-pool.js')).pool.report(),
}));
check('the import map resolved, so the pinned hash is current',
  state.commands > 200 && state.tris > 1000, JSON.stringify({ commands: state.commands, tris: state.tris }));
check('workers start under worker-src', state.pool.available === true, state.pool.reason);
check('the policy raised no violation during normal use',
  violations.length === 0, violations.slice(0, 3).join(' | '));
check('and the page logged no errors of its own',
  errors.length === 0, errors.slice(0, 3).join(' | '));

/* ------------------------------------------------ and it does block things */

const inlineBlocked = await page.evaluate(() => new Promise((done) => {
  const s = document.createElement('script');
  s.textContent = 'window.__pwned = 1';
  document.body.appendChild(s);
  setTimeout(() => done(window.__pwned === undefined), 100);
}));
check('an injected inline script does not execute', inlineBlocked);

const externalBlocked = await page.evaluate(() => new Promise((done) => {
  const s = document.createElement('script');
  s.src = 'https://example.com/x.js';
  s.onerror = () => done(true);
  s.onload = () => done(false);
  document.body.appendChild(s);
  setTimeout(() => done(true), 2000);
}));
check('a script from another origin is refused', externalBlocked);

const fetchBlocked = await page.evaluate(
  () => fetch('https://example.com/').then(() => false).catch(() => true));
check('an outbound fetch is refused before a packet leaves', fetchBlocked);

// Proof the three checks above are not passing simply because nothing works:
// the same mechanism, pointed at the application's own origin, must succeed.
const sameOriginWorks = await page.evaluate(
  () => fetch('./index.html').then(r => r.ok).catch(() => false));
check('while a request to the application\'s own origin still succeeds',
  sameOriginWorks);

await browser.close();
process.exit(finish());
