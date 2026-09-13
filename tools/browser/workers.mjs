/**
 * The worker pool, in a real browser.
 *
 * The Node suite proves the fallback gives the same answer as the fast path.
 * This proves the point of having the fast path at all: that the boolean
 * leaves the main thread, that independent booleans overlap, and that the
 * window keeps responding while a heavy rebuild runs.
 */
import { chromium } from 'playwright-core';
import { chromePath, LAUNCH_ARGS, serve, shotsDir, watchdog } from './harness.mjs';

watchdog();

const CHROME = chromePath();
const SHOTS = shotsDir('workers');
const server = await serve();
const BASE = server.base;
const browser = await chromium.launch({ executablePath: CHROME,
  args: LAUNCH_ARGS });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
page.on('pageerror', e => errs.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
const spawned = [];
page.on('worker', w => spawned.push(w.url()));

let bad = 0;
const ok = (n, c, x = '') => { if (!c) bad++; console.log(`${c ? 'ok  ' : 'FAIL'} ${n}${x ? '  - ' + x : ''}`); };

await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.tesserCAD?.build, null, { timeout: 25000 });
await page.waitForTimeout(800);

/* ---- the pool actually starts ---- */
ok('real worker threads are spawned', spawned.length >= 1, `${spawned.length} workers`);
ok('and they are the boolean worker', spawned.every(u => u.endsWith('csg-worker.js')), spawned[0] || '');
const rep = await page.evaluate(async () => (await import('/src/core/csg-pool.js')).pool.report());
ok('the pool reports itself available', rep.available === true, rep.reason);
ok('it leaves a core for the interface', rep.cores ? rep.size <= Math.max(1, rep.cores - 1) : true,
  `${rep.size} workers for ${rep.cores} cores`);
ok('and it has done real work already, on the demo document', rep.completed >= 1, `${rep.completed} completed`);
ok('with nothing falling back', rep.fellBack === 0 && rep.failed === 0, JSON.stringify({ fellBack: rep.fellBack, failed: rep.failed }));

/* ---- a module worker can resolve its own imports without an import map ---- */
ok('the worker loaded its kernel, or it could not have completed a job', rep.completed >= 1);

/**
 * Four independent heavy booleans, measured with a 5ms timer heartbeat.
 * A heartbeat measures main-thread availability directly; counting animation
 * frames would measure the compositor instead, which under software rendering
 * is slow regardless of what JavaScript is doing.
 */
const measure = (useWorkers) => page.evaluate(async (useWorkers) => {
  const { makeFeature, newDocument } = await import('/src/core/doc.js');
  const { rebuildAsync, invalidateCache } = await import('/src/core/rebuild.js');
  const { pool } = await import('/src/core/csg-pool.js');
  const doc = newDocument('Heavy'); doc.params = [];
  for (let i = 0; i < 4; i++) {
    const a = makeFeature('sphere', { name: `S${i}`, params: { r: 30, seg: 64 } });
    a.transform.pos = [i * 90, 0, 0];
    const c = makeFeature('cylinder', { name: `C${i}`, params: { r: 18, h: 80, seg: 64, arc: 360 } });
    c.transform.pos = [i * 90, 0, 0];
    const k = makeFeature('boolean', { name: `K${i}`, params: { op: 'subtract' } });
    k.inputs = [a.id, c.id];
    doc.features.push(a, c, k);
  }
  if (!useWorkers) { pool.available = false; pool.reason = 'forced off for measurement'; }
  else { pool.available = null; pool.start(); }

  let last = performance.now(), worst = 0, beats = 0;
  const h = setInterval(() => { const n = performance.now(); worst = Math.max(worst, n - last); last = n; beats++; }, 5);
  invalidateCache();
  const t0 = performance.now();
  const build = await rebuildAsync(doc);
  const ms = performance.now() - t0;
  clearInterval(h);
  return {
    ms: Math.round(ms), worstBlockMs: Math.round(worst), beats,
    parallel: build.parallel, bodies: build.stats.bodies, tris: build.stats.tris,
    volume: build.stats.volume,
  };
}, useWorkers);

const withW = await measure(true);
const without = await measure(false);
console.log(`   with workers:    ${withW.ms}ms total, worst block ${withW.worstBlockMs}ms, ${withW.beats} heartbeats`);
console.log(`   without workers: ${without.ms}ms total, worst block ${without.worstBlockMs}ms, ${without.beats} heartbeats`);

ok('four booleans all go off-thread', withW.parallel.offThread === 4 && withW.parallel.onThread === 0,
  JSON.stringify(withW.parallel));
ok('and all four run at once, so the cores are actually used', withW.parallel.peak === 4, `peak ${withW.parallel.peak}`);
ok('the main thread is never blocked for more than a few frames',
  withW.worstBlockMs < 200, `${withW.worstBlockMs}ms`);
ok('so the interface keeps running throughout a heavy rebuild',
  withW.beats > 30, `${withW.beats} heartbeats got through`);

ok('with workers forced off, every boolean falls back to this thread',
  without.parallel.onThread === 4, JSON.stringify(without.parallel));
ok('and then the main thread really is blocked, which is what the pool avoids',
  without.worstBlockMs > withW.worstBlockMs * 4,
  `${without.worstBlockMs}ms blocked vs ${withW.worstBlockMs}ms`);
ok('the fallback gets the same geometry, to the last triangle',
  without.tris === withW.tris && Math.abs(without.volume - withW.volume) < 1e-6,
  `${withW.tris} vs ${without.tris} triangles`);
/**
 * Concurrency is asserted; wall-clock speedup is not.
 *
 * This check used to be `withW.ms < without.ms` — four booleans in parallel
 * must finish sooner than four in a row. It passed on a four-core machine and
 * failed on GitHub's two-core runner at 1070ms against 1047ms, which is not a
 * defect in the pool. Four jobs cannot outrun four jobs when there are two
 * cores to run them on, and a shared runner's timing is a property of the
 * machine rather than of this code. An assertion that flips with the hardware
 * teaches people to re-run red, which costs more than the check was worth.
 *
 * What the pool actually promises is asserted instead, and more precisely: the
 * work reached more than one worker and overlapped there, and the main thread
 * stayed responsive while it did — which is the check above this one, and the
 * reason the pool exists at all. Both are properties of the code on any
 * machine.
 */
ok('more than one boolean was in flight at the same time',
  withW.parallel.peak > 1,
  `peak ${withW.parallel.peak} concurrent · ${withW.ms}ms parallel vs ${without.ms}ms sequential`);
ok('and every one of them ran in a worker rather than falling back to this thread',
  withW.parallel.offThread === 4 && withW.parallel.onThread === 0,
  JSON.stringify(withW.parallel));

/* ---- a superseded rebuild does not draw a stale model ---- */
const superseded = await page.evaluate(async () => {
  const { store, makeFeature } = await import('/src/core/doc.js');
  const app = window.tesserCAD;
  store.edit('first', (d) => { d.features.push(makeFeature('box', { name: 'First' })); });
  const a = app.rebuildNow();
  store.edit('second', (d) => { d.features.push(makeFeature('sphere', { name: 'Second' })); });
  const b = app.rebuildNow();
  await Promise.all([a, b]);
  return app.build.results.size === store.doc.features.length &&
    store.doc.features.every(f => app.build.results.has(f.id));
});
ok('a rebuild superseded mid-flight does not overwrite the newer one', superseded);

/* ---- the app still works normally ---- */
const sane = await page.evaluate(() => ({
  bodies: window.tesserCAD.build.stats.bodies,
  tris: window.tesserCAD.build.stats.tris,
  meshes: window.tesserCAD.vp.bodies.size,
}));
ok('the viewport still holds the bodies the build produced', sane.bodies > 0 && sane.meshes > 0, JSON.stringify(sane));

console.log('\nCONSOLE ERRORS:', errs.length);
errs.slice(0, 6).forEach(e => console.log('  ', e));
if (errs.length) bad += errs.length;
console.log(bad ? `\n${bad} FAILURES` : '\nALL WORKER CHECKS PASS');
await browser.close();
process.exit(bad ? 1 : 0);
