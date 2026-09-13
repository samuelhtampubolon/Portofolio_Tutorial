/**
 * Offline ownership, and the dialogs for the last three modules.
 *
 * The only claim worth making about offline use is one the user can check by
 * turning the network off, so that is what this does: it forces the context
 * offline and reloads.
 */
import { chromium } from 'playwright-core';
import { chromePath, LAUNCH_ARGS, serve, shotsDir, watchdog } from './harness.mjs';

watchdog();

const CHROME = chromePath();
const SHOTS = shotsDir('offline');
const server = await serve();
const BASE = server.base;
const browser = await chromium.launch({ executablePath: CHROME,
  args: LAUNCH_ARGS });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 980 } });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

let bad = 0;
const ok = (n, c, x = '') => { if (!c) bad++; console.log(`${c ? 'ok  ' : 'FAIL'} ${n}${x ? '  - ' + x : ''}`); };
const modalText = () => page.evaluate(() => document.querySelector('.modal-body')?.innerText.replace(/\s+/g, ' ') || '');
const close = () => page.evaluate(() => { const b = [...document.querySelectorAll('.modal-foot button')].find(x => /Close|Cancel/.test(x.textContent)); if (b) b.click(); });

await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.tesserCAD?.build, null, { timeout: 25000 });
await page.evaluate(() => document.querySelectorAll('.tour, .learn-card, #tourCard').forEach(n => n.remove()));

/* ---- the offline copy installs itself ---- */

// Wait for the cache to be *populated*, not merely for the worker to be in
// control. Those are two different moments: a service worker takes control as
// soon as it activates and only then works through the file list, so reading
// the cache the instant control arrives finds it empty.
//
// Polled from here with `page.evaluate` rather than with
// `page.waitForFunction`. The predicate has to `await` — it imports a module
// and calls an async `status()` — and an async predicate inside
// waitForFunction did not behave as intended: this suite reported
// `controlled: false` and `0 files` against an application that, measured
// directly under the same conditions, had 65 files cached and a controller
// one second after boot. The product was never broken; the wait was. A plain
// loop leaves no room for that ambiguity.
const cacheReady = async () => {
  const deadline = Date.now() + 45000;
  let last = null;
  while (Date.now() < deadline) {
    last = await page.evaluate(async () => (await import('/src/intel/offline.js')).status());
    if (last.controlled && last.files >= 50 && last.cachedBytes > 500000) return last;
    await page.waitForTimeout(500);
  }
  return last;
};
await cacheReady();
const st = await page.evaluate(async () => (await import('/src/intel/offline.js')).status());
ok('a service worker registers and takes control', st.controlled === true, JSON.stringify({ registered: st.registered, controlled: st.controlled }));
ok('it caches the whole application, not a page of it', st.files >= 50, `${st.files} files`);
ok('and reports how much is on the machine', st.cachedBytes > 500000, `${(st.cachedBytes / 1e6).toFixed(1)} MB`);
ok('the cache is versioned by content', /^tessercad-[0-9a-f]{12}$/.test(st.version || ''), st.version);

/* ---- THE claim: it opens with the network off ---- */
await page.waitForTimeout(1200);
await ctx.setOffline(true);
let offlineResult = null;
try {
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForFunction(() => window.tesserCAD?.build, null, { timeout: 25000 });
  offlineResult = await page.evaluate(() => ({
    bodies: window.tesserCAD.build.stats.bodies,
    tris: window.tesserCAD.build.stats.tris,
    commands: window.tesserCAD.commands.length,
  }));
} catch (e) { offlineResult = { error: e.message.split('\n')[0] }; }
ok('with the network off, the application still loads', !offlineResult.error, offlineResult.error || 'loaded');
ok('and still builds the model', offlineResult.bodies > 0 && offlineResult.tris > 0, JSON.stringify(offlineResult));
ok('with the full command registry, so nothing was left on the server',
  offlineResult.commands > 190, `${offlineResult.commands} commands`);
// Workers must load from the cache too, or booleans would silently fall back.
const offlinePool = await page.evaluate(async () => (await import('/src/core/csg-pool.js')).pool.report());
ok('the boolean workers load from the cache as well', offlinePool.available === true, offlinePool.reason);
await ctx.setOffline(false);

/* ---- the ownership panel states what is kept and what is sent ---- */
await page.evaluate(() => window.tesserCAD.showOwnership());
await page.waitForTimeout(700);
let t = await modalText();
ok('the ownership panel says it is installed', /Installed\./.test(t), t.slice(0, 80));
ok('it lists what the app sends, which is nothing',
  /No account/.test(t) && /No telemetry/.test(t) && /No licence check/.test(t));
ok('it tells the user how to check that themselves', /network panel/.test(t));
ok('and names every thing it keeps locally',
  /the document you have open/.test(t) && /saved versions and branches/.test(t) && /your preferences/.test(t));
ok('it offers to delete all of it', await page.evaluate(() =>
  [...document.querySelectorAll('.modal-foot button')].some(b => /Forget everything/.test(b.textContent))));
await close();

/* ---- document health ---- */
await page.evaluate(async () => {
  const { store } = await import('/src/core/doc.js');
  // Only numeric coordinates: "+= " on an expression string would concatenate.
  store.edit('move to survey coordinates', (d) => {
    d.features.forEach(f => {
      if (typeof f.transform.pos[0] === 'number') f.transform.pos[0] += 412000;
    });
  });
});
await page.waitForTimeout(700);
await page.evaluate(() => window.tesserCAD.showHygiene());
await page.waitForTimeout(600);
t = await modalText();
ok('survey coordinates are caught as serious', /SERIOUS/.test(t) && /survey coordinates/.test(t), t.slice(0, 110));
// The exact figure depends on how far out the document ended up, so what is
// checked here is that a real float32 step is quoted at all; the Node suite
// checks the arithmetic against Float32Array itself.
const quoted = (t.match(/represented there is ([\d.]+) (µm|mm)/) || []);
ok('the real float32 step is quoted, not a rule of thumb', !!quoted[1], quoted[0] || 'no step quoted');
ok('and it is a power of two, as every float32 step is',
  (() => {
    const mm = Number(quoted[1]) * (quoted[2] === 'µm' ? 1e-3 : 1);
    const l = Math.log2(mm);
    return Math.abs(l - Math.round(l)) < 0.02;
  })(), quoted[0]);
ok('the weight report names where the bytes are', /Where the weight is|WHERE THE WEIGHT IS/i.test(t));
const fixed = await page.evaluate(async () => {
  const { store } = await import('/src/core/doc.js');
  // Leaf features are the ones holding absolute coordinates; a boolean's own
  // transform is an offset on top of its inputs.
  const leaves = () => store.doc.features.filter(f => !f.inputs.length).map(f => f.transform.pos[0]);
  const before = leaves();
  [...document.querySelectorAll('.modal-body button')].find(b => /Move the design to the origin/.test(b.textContent)).click();
  await new Promise(r => setTimeout(r, 900));
  return { before, after: leaves(), notes: store.doc.meta.notes || '',
    body: (() => { const b = window.tesserCAD.build.stats.box; return { x: (b.min.x + b.max.x) / 2 }; })() };
});
ok('the repair moves the numeric coordinates back toward the origin',
  fixed.before.some(x => x > 400000) && !fixed.after.some(x => typeof x === 'number' && x > 400000),
  `${fixed.before.join(',')} -> ${fixed.after.join(',')}`);
ok('and the rendered geometry comes back with it',
  Number.isFinite(fixed.body.x) && Math.abs(fixed.body.x) < 10000,
  `body centre x = ${Number.isFinite(fixed.body.x) ? fixed.body.x.toFixed(1) : fixed.body.x}`);
ok('and records the offset it applied, so the site coordinate is not lost',
  /Design origin offset from the original coordinates/.test(fixed.notes), fixed.notes.slice(0, 110));
await close();
await page.evaluate(async () => { const { store } = await import('/src/core/doc.js'); store.undo(); store.undo(); });
await page.waitForTimeout(600);

/* ---- typed intent ---- */
await page.evaluate(() => window.tesserCAD.showSpeak());
await page.waitForTimeout(400);
const spoke = await page.evaluate(async () => {
  const { store } = await import('/src/core/doc.js');
  const i = document.querySelector('.sp-input');
  i.value = '4 M6 clearance holes 40 apart';
  i.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 400));
  const readback = document.querySelector('.sp-out').innerText.replace(/\s+/g, ' ');
  const before = store.doc.features.length;
  [...document.querySelectorAll('.modal-foot button')].find(x => /Build it/.test(x.textContent)).click();
  await new Promise(r => setTimeout(r, 900));
  const added = store.doc.features.slice(before);
  return { readback, added: added.map(f => ({ type: f.type, name: f.name, r: f.params.r, count: f.params.count })), depth: store.depth,
    params: store.doc.params.filter(p => p.name === 'clear_m6') };
});
ok('the readback states what it understood before building',
  /M6 clearance diameter 6.6 mm/.test(spoke.readback), spoke.readback.slice(0, 100));
ok('building makes a hole and a pattern, both editable',
  spoke.added.length === 2 && spoke.added[1].type === 'patternLinear' && spoke.added[1].count === 4,
  JSON.stringify(spoke.added));
ok('the hole radius is driven by a named parameter, not a bare number',
  typeof spoke.added[0].r === 'string' && /clear_m6/.test(spoke.added[0].r), String(spoke.added[0].r));
ok('and the parameter is declared with the standard value',
  spoke.params.length === 1 && spoke.params[0].value === 6.6, JSON.stringify(spoke.params));
ok('the whole sentence is one undo step', spoke.depth >= 1);

/* ---- fasteners ---- */
await page.evaluate(() => window.tesserCAD.showFasteners());
await page.waitForTimeout(500);
t = await modalText();
ok('the fastener panel gives the proof load', /Proof load 21\.2 kN/.test(t), (t.match(/Proof load [^ ]+ kN/) || [''])[0]);
ok('the torque, with its assumption stated', /30\.6 N·m/.test(t) && /K = 0\.2/.test(t));
ok('both hole sizes', /Clearance hole ⌀9 mm/.test(t) && /Tapping drill ⌀6\.8 mm/.test(t));
ok('and the standards it comes from', /ISO 724/.test(t) && /ISO 273/.test(t) && /ISO 4762/.test(t));
const bolt = await page.evaluate(async () => {
  const { store } = await import('/src/core/doc.js');
  const before = store.doc.features.length;
  [...document.querySelectorAll('.modal-foot button')].find(x => /Add to the model/.test(x.textContent)).click();
  await new Promise(r => setTimeout(r, 900));
  return { added: store.doc.features.length - before, names: store.doc.features.slice(before).map(f => f.name) };
});
ok('adding a bolt makes a real body, not a symbol',
  bolt.added === 3 && /M8×30 8\.8/.test(bolt.names.at(-1)), JSON.stringify(bolt.names));

console.log('\nCONSOLE ERRORS:', errs.length);
errs.slice(0, 6).forEach(e => console.log('  ', e));
if (errs.length) bad += errs.length;
console.log(bad ? `\n${bad} FAILURES` : '\nALL OFFLINE AND DIALOG CHECKS PASS');
await browser.close();
process.exit(bad ? 1 : 0);
