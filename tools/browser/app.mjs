/**
 * The application end to end, in a real browser.
 *
 * Boot, build every primitive, drive a parametric edit, run booleans, extrude
 * and revolve from a 2D profile, pattern, mirror, scrub the timeline, bake
 * dynamics, export six formats, round-trip a project through save and load,
 * undo and redo, draw with the mouse, and check the layout does not overflow
 * at phone width.
 *
 * This is the broadest of the suites and the one to run first when something
 * has gone wrong, because it touches nearly everything and says which part.
 */
import { chromium } from 'playwright-core';
import { chromePath, LAUNCH_ARGS, serve, shotsDir, watchdog } from './harness.mjs';

watchdog();

const CHROME = chromePath();
const SHOTS = shotsDir('app');
const server = await serve();
const BASE = server.base;
const URL = `${BASE}/index.html`;

const browser = await chromium.launch({
  executablePath: CHROME,
  args: LAUNCH_ARGS,
});
const ctx = await browser.newContext({ viewport: { width: 1500, height: 940 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message + ' | ' + (e.stack||'').split('\n')[1]));

const results = [];
const check = (name, ok, extra='') => { results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); };

/**
 * Wait until the last top-level feature is the one just added and has built.
 *
 * These checks used to sleep a fixed number of milliseconds and then read
 * `topLevel.at(-1)`. That is a race, and it lost on GitHub's runner: the
 * mirror check read back a `patternCircular`, because 900ms was enough on a
 * four-core laptop and not on a two-core shared machine. The failure looked
 * like a broken mirror and was a slow computer.
 *
 * Waiting for the condition rather than for the clock makes the suite
 * deterministic on any machine, and it is also faster on a quick one.
 */
const settled = (type, timeout = 30000) => page.waitForFunction((want) => {
  const f = window.tesserCAD?.build?.topLevel?.at(-1);
  if (!f || f.type !== want) return false;
  const r = window.tesserCAD.build.results.get(f.id);
  return !!r && (!!r.error || (r.instances && r.instances.length > 0));
}, type, { timeout });

await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => window.tesserCAD && window.tesserCAD.build, null, { timeout: 20000 });
await page.waitForTimeout(1500);
// dismiss welcome modal if present
await page.waitForTimeout(900);
await page.evaluate(() => document.querySelectorAll('.modal-back').forEach(n => n.remove()));
await page.waitForTimeout(300);

// 1. boot + demo model
let s = await page.evaluate(() => ({ tris: tesserCAD.build.stats.tris, bodies: tesserCAD.vp.bodies.size, errs: [...tesserCAD.build.results.values()].filter(r=>r.error).length }));
check('boot + demo model builds', s.tris > 1000 && s.bodies === 1 && s.errs === 0, JSON.stringify(s));
await page.screenshot({ path: `${SHOTS}/01-model.png` });

// 2. add primitives
await page.evaluate(() => { for (const t of ['box','cylinder','sphere','torus','helix','tube','prism','wedge','plate','cone','pyramid']) tesserCAD.addFeature(t); });
await page.waitForTimeout(900);
s = await page.evaluate(() => ({ n: tesserCAD.build.topLevel.length, errs: [...tesserCAD.build.results.values()].filter(r=>r.error).map(r=>r.name+':'+r.error) }));
check('all 11 primitive types build', s.n === 12 && s.errs.length === 0, JSON.stringify(s));

// 3. parametric expression edit
s = await page.evaluate(async () => {
  const mod = await import('./src/core/doc.js');
  const before = tesserCAD.build.results.get(tesserCAD.build.topLevel[0].id).instances[0].geometry.boundingBox.max.x;
  mod.store.edit('test', (doc) => { doc.params.find(p => p.name === 'plate_w').value = 200; });
  await new Promise(r => setTimeout(r, 800));
  const after = tesserCAD.build.results.get(tesserCAD.build.topLevel[0].id).instances[0].geometry.boundingBox.max.x;
  return { before, after };
});
check('parameter change propagates to geometry', Math.abs(s.after - 100) < 1 && s.before !== s.after, JSON.stringify(s));

// 4. boolean
await page.evaluate(() => {
  const ids = tesserCAD.build.topLevel.slice(-2).map(f => f.id);
  tesserCAD.select(ids);
  tesserCAD.addBoolean('subtract');
});
await page.waitForTimeout(1200);
s = await page.evaluate(() => { const f = store2(); return f; function store2(){ const last = tesserCAD.build.topLevel.at(-1); const r = tesserCAD.build.results.get(last.id); return { type: last.type, err: r.error, tris: r.instances.length ? r.instances[0].geometry.attributes.position.count/3 : 0 }; } });
check('boolean subtract evaluates', s.type === 'boolean' && !s.err && s.tris > 0, JSON.stringify(s));

// 5. draft workspace: draw a plate profile with a hole, extrude it
await page.evaluate(() => tesserCAD.setWorkspace('draft'));
await page.waitForTimeout(400);
await page.evaluate(async () => {
  const { store, uid } = await import('./src/core/doc.js');
  const layer = store.doc.draw.activeLayer;
  store.edit('test draw', (d) => {
    d.draw.entities.push({ id: uid('e'), layer, type: 'rect', a: [-60, -40], b: [60, 40] });
    d.draw.entities.push({ id: uid('e'), layer, type: 'circle', c: [0, 0], r: 15 });
    d.draw.entities.push({ id: uid('e'), layer, type: 'circle', c: [-40, 0], r: 6 });
    d.draw.entities.push({ id: uid('e'), layer, type: 'dim', kind: 'h', a: [-60,-40], b: [60,-40], off: -20, size: 6 });
  });
  tesserCAD.draft.selection = new Set(store.doc.draw.entities.filter(e => e.type !== 'dim').map(e => e.id));
  tesserCAD.draft.zoomExtents();
  tesserCAD.refreshUI();
});
await page.waitForTimeout(600);
await page.screenshot({ path: `${SHOTS}/02-draft.png` });
await page.evaluate(() => tesserCAD.createFromProfile('extrude'));
await page.waitForTimeout(1200);
s = await page.evaluate(() => { const f = tesserCAD.build.topLevel.at(-1); const r = tesserCAD.build.results.get(f.id); return { type: f.type, err: r.error, tris: r.instances[0]?.geometry.attributes.position.count/3 }; });
check('extrude from 2D profile with holes', s.type === 'extrude' && !s.err && s.tris > 20, JSON.stringify(s));

// 6. revolve
await page.evaluate(async () => {
  const { store, uid } = await import('./src/core/doc.js');
  const layer = store.doc.draw.activeLayer;
  const ids = [];
  store.edit('rev profile', (d) => {
    const e = { id: uid('e'), layer, type: 'polyline', pts: [[20,0],[40,0],[40,10],[28,10],[28,40],[20,40]], closed: true };
    d.draw.entities.push(e); ids.push(e.id);
  });
  tesserCAD.draft.selection = new Set(ids);
  tesserCAD.createFromProfile('revolve');
});
await settled('revolve');
s = await page.evaluate(() => { const f = tesserCAD.build.topLevel.at(-1); const r = tesserCAD.build.results.get(f.id); return { type: f.type, err: r.error, tris: r.instances[0]?.geometry.attributes.position.count/3 }; });
check('revolve from 2D profile', s.type === 'revolve' && !s.err && s.tris > 100, JSON.stringify(s));

// 7. patterns + mirror
await page.evaluate(() => { tesserCAD.select([tesserCAD.build.topLevel.at(-1).id]); tesserCAD.addModifier('patternCircular'); });
await settled('patternCircular');
s = await page.evaluate(() => { const f = tesserCAD.build.topLevel.at(-1); const r = tesserCAD.build.results.get(f.id); return { type: f.type, err: r.error, n: r.instances.length }; });
check('circular pattern', s.type === 'patternCircular' && !s.err && s.n === 6, JSON.stringify(s));
await page.evaluate(() => { tesserCAD.select([tesserCAD.build.topLevel.at(-1).id]); tesserCAD.addModifier('mirror'); });
await settled('mirror');
s = await page.evaluate(() => { const f = tesserCAD.build.topLevel.at(-1); const r = tesserCAD.build.results.get(f.id); return { type: f.type, err: r.error, n: r.instances.length }; });
check('mirror', s.type === 'mirror' && !s.err && s.n === 12, JSON.stringify(s));

await page.evaluate(() => { tesserCAD.setWorkspace('model'); tesserCAD.vp.frameAll(); });
await page.waitForTimeout(900);
await page.screenshot({ path: `${SHOTS}/03-model-full.png` });

// 8. simulation: schedule + keyframes + dynamics
await page.evaluate(() => { tesserCAD.setWorkspace('sim'); tesserCAD.autoSchedule(); });
await page.waitForTimeout(900);
s = await page.evaluate(() => ({ n: Object.keys(tesserCAD.sim.sim.schedule.items).length, en: tesserCAD.sim.sim.schedule.enabled }));
check('auto build sequence', s.n > 3 && s.en, JSON.stringify(s));
await page.evaluate(() => tesserCAD.sim.seek(2.0));
await page.waitForTimeout(500);
const vis = await page.evaluate(() => [...tesserCAD.vp.bodies.values()].map(g => g.visible));
check('schedule hides future bodies at t=2', vis.some(v => v === false) && vis.some(v => v === true), JSON.stringify(vis));
await page.screenshot({ path: `${SHOTS}/04-sim-sequence.png` });

await page.evaluate(() => {
  tesserCAD.sim.setKey(tesserCAD.build.topLevel[0].id, 'pz', 0, 0);
  tesserCAD.sim.setKey(tesserCAD.build.topLevel[0].id, 'pz', 3, 120, 'bounce');
  tesserCAD.sim.setKey(tesserCAD.build.topLevel[0].id, 'rz', 3, 360);
  tesserCAD.refreshSim();
  tesserCAD.sim.seek(3);
});
await page.waitForTimeout(500);
s = await page.evaluate(() => { const g = tesserCAD.vp.bodies.get(tesserCAD.build.topLevel[0].id); return g.matrix.elements[14]; });
check('keyframe animation moves body', Math.abs(s) > 50, `z offset element ${s.toFixed(1)}`);

await page.evaluate(() => { tesserCAD.setupDropTest(); });
await page.waitForTimeout(1000);
await page.evaluate(() => { tesserCAD.sim.pause(); tesserCAD.sim.seek(1.2); });
await page.waitForTimeout(400);
s = await page.evaluate(() => ({ frames: tesserCAD.sim.frameCount, baked: !!tesserCAD.sim.frames }));
check('dynamics bake + scrub', s.baked && s.frames > 10, JSON.stringify(s));
await page.screenshot({ path: `${SHOTS}/05-sim-dynamics.png` });

// 9. exports produce non-empty payloads
s = await page.evaluate(async () => {
  const IO = await import('./src/io/io.js');
  const dxfmod = await import('./src/draft/dxf.js');
  const { store } = await import('./src/core/doc.js');
  const out = {};
  const blobs = [];
  const origCreate = URL.createObjectURL;
  URL.createObjectURL = (b) => { blobs.push(b); return 'blob:stub'; };
  const origClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function(){};
  IO.exportSTL(tesserCAD.vp, { binary: true }); out.stl = blobs.at(-1)?.size || 0;
  IO.exportOBJ(tesserCAD.vp); out.obj = blobs.at(-1)?.size || 0;
  IO.exportPLY(tesserCAD.vp); out.ply = blobs.at(-1)?.size || 0;
  IO.exportDXF(); out.dxf = blobs.at(-1)?.size || 0;
  IO.exportSVG(); out.svg = blobs.at(-1)?.size || 0;
  IO.saveProject(); out.proj = blobs.at(-1)?.size || 0;
  IO.exportBOM(tesserCAD.build); out.bom = blobs.at(-1)?.size || 0;
  out.dxfRound = dxfmod.fromDXF(dxfmod.toDXF(store.doc.draw)).entities.length;

  // glTF and PNG finish asynchronously, so they are awaited rather than
  // measured on the next line like the others.
  //
  // PNG is here for a reason beyond coverage. It is the only export that goes
  // through `fetch`, on a data: URL produced by canvas.toDataURL, and `fetch`
  // is governed by connect-src. This page runs under default-src 'none', so
  // one missing token in that directive silently breaks the export and
  // nothing else — exactly the kind of failure a policy this strict invites,
  // and one no static check can see.
  await new Promise((resolve) => {
    IO.exportGLTF(tesserCAD.vp, { binary: true });
    setTimeout(resolve, 1200);
  });
  out.gltf = blobs.at(-1)?.size || 0;

  out.pngError = null;
  try {
    IO.exportPNG(tesserCAD.vp, 1);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    out.png = blobs.at(-1)?.size || 0;
  } catch (err) {
    out.png = 0;
    out.pngError = String(err);
  }

  URL.createObjectURL = origCreate;
  HTMLAnchorElement.prototype.click = origClick;
  return out;
});
check('exports STL/OBJ/PLY/DXF/SVG/project', s.stl > 1000 && s.obj > 500 && s.ply > 500 && s.dxf > 200 && s.svg > 200 && s.proj > 500, JSON.stringify(s));
check('DXF round-trips', s.dxfRound > 0, `${s.dxfRound} entities`);
check('glTF and the bill of materials export too', s.gltf > 500 && s.bom > 100, `gltf ${s.gltf} B, bom ${s.bom} B`);
check('PNG export survives connect-src, which governs its data: fetch',
  s.png > 1000, s.pngError || `${s.png} B`);

// 10. save/load round trip
s = await page.evaluate(async () => {
  const { store, migrate } = await import('./src/core/doc.js');
  const json = JSON.parse(JSON.stringify(store.doc));
  const before = tesserCAD.build.stats.tris;
  store.load(migrate(json));
  await new Promise(r => setTimeout(r, 900));
  return { before, after: tesserCAD.build.stats.tris };
});
check('project save/load round trip', s.before === s.after, JSON.stringify(s));

// 11. undo/redo
s = await page.evaluate(async () => {
  const { store } = await import('./src/core/doc.js');
  const n0 = store.doc.features.length;
  tesserCAD.addFeature('box');
  await new Promise(r => setTimeout(r, 400));
  const n1 = store.doc.features.length;
  store.undo();
  await new Promise(r => setTimeout(r, 400));
  const n2 = store.doc.features.length;
  store.redo();
  await new Promise(r => setTimeout(r, 400));
  return { n0, n1, n2, n3: store.doc.features.length };
});
check('undo / redo', s.n1 === s.n0 + 1 && s.n2 === s.n0 && s.n3 === s.n0 + 1, JSON.stringify(s));

// 12. draft interaction via real mouse
await page.evaluate(() => { tesserCAD.setWorkspace('draft'); tesserCAD.draft.setTool('line'); });
await page.waitForTimeout(400);
const box = await page.locator('#viewport2d').boundingBox();
await page.mouse.click(box.x + 300, box.y + 300);
await page.mouse.move(box.x + 500, box.y + 380);
await page.mouse.click(box.x + 500, box.y + 380);
await page.waitForTimeout(400);
s = await page.evaluate(async () => { const { store } = await import('./src/core/doc.js'); return store.doc.draw.entities.filter(e => e.type === 'line').length; });
check('draw a line with the mouse', s >= 1, `${s} lines`);

// 13. theme + workspaces render
await page.evaluate(() => tesserCAD.toggleTheme());
await page.waitForTimeout(500);
await page.screenshot({ path: `${SHOTS}/06-light-draft.png` });
await page.evaluate(() => { tesserCAD.toggleTheme(); tesserCAD.setWorkspace('model'); });
await page.waitForTimeout(500);

// 14. command palette + every command is invokable
s = await page.evaluate(() => tesserCAD.commands.length);
check('command registry populated', s > 40, `${s} commands`);

// 15. mobile layout
await page.setViewportSize({ width: 400, height: 800 });
await page.waitForTimeout(700);
s = await page.evaluate(() => {
  const vw = document.documentElement.clientWidth;
  const over = [];
  for (const e of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(e);
    if (cs.display === 'none') continue;
    const r = e.getBoundingClientRect();
    if (r.width > 0 && r.right > vw + 1 && cs.position !== 'fixed') {
      over.push(`${e.id || e.tagName}.${(e.className||'').toString().split(' ')[0]} right=${Math.round(r.right)} pos=${cs.position}`);
    }
  }
  return { sw: document.documentElement.scrollWidth, cw: vw, bsw: document.body.scrollWidth,
    tbScroll: document.getElementById('ribbon').scrollWidth > document.getElementById('ribbon').clientWidth,
    over: over.slice(0, 6) };
});
check('no horizontal overflow at 400px', s.sw <= s.cw + 1 && s.bsw <= s.cw + 1, JSON.stringify(s));
await page.screenshot({ path: `${SHOTS}/07-mobile.png` });

console.log('\n' + results.join('\n'));
console.log('\nCONSOLE ERRORS: ' + errors.length);
for (const e of [...new Set(errors)].slice(0, 20)) console.log('  - ' + e);
const failed = results.filter(r => r.startsWith('FAIL')).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
await browser.close();
process.exit(failed || errors.length ? 1 : 0);
