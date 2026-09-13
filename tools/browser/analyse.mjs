/**
 * The analysis layer: exact clash, section properties, configurations,
 * local version control, mesh recognition and export tessellation.
 */
import { chromium } from 'playwright-core';
import { chromePath, LAUNCH_ARGS, serve, shotsDir, watchdog } from './harness.mjs';

watchdog();

const CHROME = chromePath();
const SHOTS = shotsDir('analyse');
const server = await serve();
const BASE = server.base;

const browser = await chromium.launch({
  executablePath: CHROME,
  args: LAUNCH_ARGS,
});
const page = await browser.newPage({ viewport: { width: 1560, height: 950 } });
const errs = [];
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

const R = [];
const check = (n, ok, x = '') => R.push(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '  - ' + x : ''}`);

await page.goto(`${BASE}/index.html`, { waitUntil: 'load' });
await page.waitForFunction(() => window.tesserCAD?.build, null, { timeout: 25000 });
await page.waitForTimeout(1700);
await page.click('.modal-foot .btn.primary').catch(() => {});
await page.waitForTimeout(300);

await page.evaluate(async () => {
  window.M = {
    doc: await import('./src/core/doc.js'),
    geo: await import('./src/core/geometry.js'),
    csg: await import('./src/core/csg.js'),
    interfere: await import('./src/intel/interfere.js'),
    section: await import('./src/intel/section.js'),
    cfg: await import('./src/intel/configs.js'),
    vcs: await import('./src/intel/history.js'),
    rec: await import('./src/intel/recognise.js'),
    tess: await import('./src/intel/tessellate.js'),
  };
  window.__dl = [];
  URL.createObjectURL = (b) => { window.__lastBlob = b; return 'blob:stub'; };
  HTMLAnchorElement.prototype.click = function () { window.__dl.push(this.download); };
  localStorage.removeItem('tessercad.vcs.v1');
});

/* ------------------------------------------------- 1. exact interference */
await page.evaluate(() => {
  const { store, makeFeature } = window.M.doc;
  store.edit('two overlapping cubes', (d) => {
    d.features = [
      makeFeature('box', { name: 'Cube A', params: { w: 40, d: 40, h: 40 } }),
      makeFeature('box', { name: 'Cube B', params: { w: 40, d: 40, h: 40 }, pos: [30, 0, 0] }),
    ];
  });
});
await page.waitForTimeout(1100);

const clash = await page.evaluate(() => {
  const app = window.tesserCAD;
  const r = window.M.interfere.findClashes(app.analysisBodies(), { budgetMs: 5000 });
  const c = r.clashes[0];
  return c ? { volume: c.volume, exact: c.exact, at: [c.at.x, c.at.y, c.at.z], fraction: c.fraction, tested: r.tested } : null;
});
// 40x40x40 cubes offset by 30 along X overlap by 10 x 40 x 40 = 16000 mm3
check('a real overlap is measured, not guessed', clash && clash.exact && Math.abs(clash.volume - 16000) < 5,
  clash ? `${clash.volume.toFixed(1)} mm3 (want 16000)` : 'none');
check('the clash centroid is where the solids actually meet',
  clash && Math.abs(clash.at[0] - 15) < 0.5 && Math.abs(clash.at[1]) < 0.5,
  clash ? clash.at.map(v => v.toFixed(2)).join(', ') : '');
check('it reports the overlap as a fraction of the smaller body',
  clash && Math.abs(clash.fraction - 16000 / 64000) < 0.01, clash ? clash.fraction.toFixed(3) : '');

// Boxes that share a bounding box but not a solid: the case the old proxy got wrong.
const diagonal = await page.evaluate(() => {
  const { store, makeFeature } = window.M.doc;
  store.edit('diagonal pair', (d) => {
    d.features = [
      makeFeature('box', { name: 'Lower left', params: { w: 20, d: 20, h: 20 }, pos: [-11, -11, 0] }),
      makeFeature('box', { name: 'Upper right', params: { w: 20, d: 20, h: 20 }, pos: [11, 11, 0] }),
    ];
  });
  return true;
});
await page.waitForTimeout(1100);
const diag = await page.evaluate(() => {
  const app = window.tesserCAD;
  const bodies = app.analysisBodies();
  const boxesOverlap = bodies[0].box.intersectsBox(bodies[1].box);
  const r = window.M.interfere.findClashes(bodies, { budgetMs: 5000 });
  return { boxesOverlap, clashes: r.clashes.length };
});
check('bodies whose boxes overlap but whose solids do not are cleared',
  !diag.boxesOverlap || diag.clashes === 0, JSON.stringify(diag));

// The Doctor must stay fast: it runs after every rebuild.
const doctorSpeed = await page.evaluate(() => {
  const app = window.tesserCAD;
  const t0 = performance.now();
  app.runDoctor();
  return { ms: performance.now() - t0, issues: app.report.issues.length };
});
check('continuous checking stays under 400ms', doctorSpeed.ms < 400, `${doctorSpeed.ms.toFixed(0)}ms`);

/* ------------------------------------------------ 2. section properties */
const sec = await page.evaluate(() => {
  const THREE = window.M.geo.THREE || null;
  const { store, makeFeature } = window.M.doc;
  store.edit('beam', (d) => {
    d.features = [makeFeature('box', { name: 'Beam', params: { w: 40, d: 10, h: 60 }, material: 'aluminium' })];
  });
  return true;
});
await page.waitForTimeout(1100);
const sectionResult = await page.evaluate(async () => {
  const THREE = await import('three');
  const app = window.tesserCAD;
  const body = app.analysisBodies()[0];
  // cut across the beam: normal along X gives a 10 x 60 section
  const s = window.M.section.sectionAt(body, new THREE.Plane(new THREE.Vector3(1, 0, 0), 0));
  const r = window.M.section.checkSection(s, { case: 'cantilever', force: 500, span: 200, material: 'aluminium', safety: 2 });
  return {
    area: s.area, i1: s.i1, s1: s.s1, loops: s.loops,
    bending: r.bending, allow: r.allow, pass: r.pass, util: r.utilisation,
  };
});
check('the section area is exact', Math.abs(sectionResult.area - 600) < 0.01, sectionResult.area.toFixed(3));
check('the second moment matches bh^3/12', Math.abs(sectionResult.i1 - (10 * 60 ** 3) / 12) < 1,
  `${sectionResult.i1.toFixed(0)} vs ${((10 * 60 ** 3) / 12).toFixed(0)}`);
check('the section modulus matches bh^2/6', Math.abs(sectionResult.s1 - (10 * 60 ** 2) / 6) < 1,
  `${sectionResult.s1.toFixed(0)} vs ${((10 * 60 ** 2) / 6).toFixed(0)}`);
check('the bending stress matches M/S by hand', Math.abs(sectionResult.bending - 100000 / 6000) < 0.01,
  sectionResult.bending.toFixed(4));
check('the allowable comes from yield over the safety factor', Math.abs(sectionResult.allow - 107.5) < 0.01,
  sectionResult.allow.toFixed(2));

// A hollow section: the hole must subtract itself.
const hollow = await page.evaluate(async () => {
  const THREE = await import('three');
  const { buildPrimitive } = window.M.geo;
  const g = buildPrimitive('tube', { ro: 22, ri: 15, h: 60, seg: 96 });
  const s = window.M.section.sectionAt({ geometry: g, matrix: null }, new THREE.Plane(new THREE.Vector3(0, 0, 1), 0));
  return { area: s.area, i1: s.i1, loops: s.loops, holes: s.holes };
});
check('a hollow section finds both loops', hollow.loops === 2 && hollow.holes === 1, JSON.stringify(hollow));
check('its area is pi(ro^2 - ri^2)', Math.abs(hollow.area - Math.PI * (484 - 225)) / (Math.PI * 259) < 0.005,
  hollow.area.toFixed(2));
check('its I is pi(ro^4 - ri^4)/4', Math.abs(hollow.i1 - (Math.PI * (22 ** 4 - 15 ** 4)) / 4) / ((Math.PI * (22 ** 4 - 15 ** 4)) / 4) < 0.01,
  hollow.i1.toFixed(0));

// and the dialog draws it
await page.evaluate(() => { const app = window.tesserCAD; app.select([window.M.doc.store.doc.features[0].id]); app.showSection(); });
await page.waitForTimeout(600);
const drawn = await page.evaluate(() => {
  const svg = document.querySelector('.modal .section-svg');
  const caveat = [...document.querySelectorAll('.modal .banner')].some(b => /not finite element analysis/i.test(b.textContent));
  return { svg: !!svg, paths: svg ? svg.querySelectorAll('path').length : 0, axes: svg ? svg.querySelectorAll('.section-axis').length : 0, caveat };
});
check('the section is drawn to scale with its principal axes', drawn.svg && drawn.paths >= 1 && drawn.axes === 2, JSON.stringify(drawn));
check('the dialog states that this is not FEA', drawn.caveat);
await page.evaluate(() => document.querySelectorAll('.modal-back').forEach(n => n.remove()));

/* --------------------------------------------------- 3. configurations */
const cfg = await page.evaluate(() => {
  const app = window.tesserCAD;
  const { store } = window.M.doc;
  const C = window.M.cfg;
  store.edit('setup', (d) => {
    d.params = [{ id: 'p1', name: 'len', value: 100, note: '' }, { id: 'p2', name: 'wid', value: 40, note: '' }];
    d.features = [window.M.doc.makeFeature('box', { name: 'Bar', params: { w: 'len', d: 'wid', h: 10 } })];
    C.syncBaseline(d);
  });
  const id = (() => { let x; store.edit('add', (d) => { x = C.addConfig(d, 'Long'); }); return x; })();
  app.activateConfiguration(id);
  store.edit('lengthen', (d) => { d.params.find(p => p.name === 'len').value = 250; });
  store.edit('capture', (d) => C.capture(d, C.activeConfig(d)));
  const longOverrides = { ...C.activeConfig(store.doc).overrides };
  app.activateConfiguration('default');
  const backToDefault = store.doc.params.find(p => p.name === 'len').value;
  app.activateConfiguration(id);
  const backToLong = store.doc.params.find(p => p.name === 'len').value;
  return { longOverrides, backToDefault, backToLong, table: C.familyTable(store.doc) };
});
check('a configuration stores only what it overrides',
  Object.keys(cfg.longOverrides).length === 1 && cfg.longOverrides.len === 250, JSON.stringify(cfg.longOverrides));
check('switching back restores the shared value', cfg.backToDefault === 100, String(cfg.backToDefault));
check('switching forward reapplies the variant', cfg.backToLong === 250, String(cfg.backToLong));
check('the family table has a column per overridden parameter',
  cfg.table.columns.length === 1 && cfg.table.columns[0] === 'len', JSON.stringify(cfg.table.columns));
check('the family table has a row per configuration', cfg.table.rows.length === 2, String(cfg.table.rows.length));

await page.waitForTimeout(900);
const cfgGeom = await page.evaluate(() => ({
  bodies: window.tesserCAD.build.stats.bodies,
  size: window.tesserCAD.build.stats.box.max.x - window.tesserCAD.build.stats.box.min.x,
}));
check('the active configuration actually drives the geometry',
  Math.abs(cfgGeom.size - 250) < 0.01, `${cfgGeom.size.toFixed(1)} mm wide`);

const family = await page.evaluate(() => {
  window.__dl = [];
  window.tesserCAD.exportFamily();
  return { file: window.__dl[0], csv: null };
});
check('the family exports as a table', /family\.csv$/.test(family.file || ''), family.file);

/* ------------------------------------------------ 4. local version control */
const vcs = await page.evaluate(() => {
  const V = window.M.vcs;
  const { store } = window.M.doc;
  V.clearAll();
  const first = V.commitVersion('Starting point');
  const before = structuredClone(store.doc);
  store.edit('widen', (d) => {
    d.params.find(p => p.name === 'wid').value = 80;
    d.features.push(window.M.doc.makeFeature('cylinder', { name: 'Boss', params: { r: 8, h: 20, seg: 48, arc: 360 } }));
  });
  const second = V.commitVersion('Wider, with a boss');
  const list = V.versions();
  const d = V.diff(before, store.doc);
  return {
    saved: first.ok && second.ok,
    count: list.length,
    messages: list.map(v => v.message),
    diff: {
      params: d.params,
      added: d.features.filter(f => f.kind === 'added').map(f => f.name),
      line: V.diffLine(d),
    },
  };
});
check('versions are saved locally', vcs.saved && vcs.count === 2, JSON.stringify(vcs.messages));
check('the diff names the parameter that changed, with both values',
  vcs.diff.params.some(p => p.name === 'wid' && String(p.from) === '40' && String(p.to) === '80'),
  JSON.stringify(vcs.diff.params));
check('the diff names the feature that was added', vcs.diff.added.includes('Boss'), JSON.stringify(vcs.diff.added));
check('the diff summarises in one line', /1/.test(vcs.diff.line), vcs.diff.line);

const rename = await page.evaluate(() => {
  const V = window.M.vcs;
  const { store } = window.M.doc;
  const before = structuredClone(store.doc);
  store.edit('rename', (d) => { d.features[0].name = 'Renamed bar'; });
  const d = V.diff(before, store.doc);
  return d.features.map(f => ({ kind: f.kind, name: f.name, changes: f.changes.map(c => c.what) }));
});
check('a rename reads as a rename, not a delete plus an add',
  rename.length === 1 && rename[0].kind === 'changed' && rename[0].changes.includes('name'),
  JSON.stringify(rename));

const branching = await page.evaluate(() => {
  const V = window.M.vcs;
  const name = V.createBranch('experiment');
  V.commitVersion('On the branch');
  const onBranch = V.versions().length;
  V.switchBranch('main');
  const onMain = V.versions().length;
  return { name, onBranch, onMain, branches: V.branches().length };
});
check('a branch starts from where you were', branching.onBranch === 3, String(branching.onBranch));
check('the trunk is untouched by the branch', branching.onMain === 2, String(branching.onMain));
check('branches are listed', branching.branches === 2, String(branching.branches));

const restored = await page.evaluate(() => {
  const V = window.M.vcs;
  const first = V.versions().at(-1);
  V.restore(first.id);
  return { name: window.M.doc.store.doc.features[0].name, params: window.M.doc.store.doc.params.length };
});
await page.waitForTimeout(900);
check('restoring a version brings the document back', restored.name === 'Bar', restored.name);

/* -------------------------------------------------- 5. mesh recognition */
const rec = await page.evaluate(async () => {
  const THREE = await import('three');
  const { buildPrimitive } = window.M.geo;
  const { booleanGeometries } = window.M.csg;
  const plate = buildPrimitive('box', { w: 120, d: 80, h: 10 });
  const positions = [[40, 25], [-40, 25], [40, -25], [-40, -25]];
  const cutters = positions.map(([x, y]) => ({
    geometry: buildPrimitive('cylinder', { r: 3.3, h: 40, seg: 48, arc: 360 }),
    matrix: new THREE.Matrix4().makeTranslation(x, y, 0),
  }));
  const drilled = booleanGeometries('subtract', [{ geometry: plate, matrix: new THREE.Matrix4() }, ...cutters]);
  const r = window.M.rec.recognise(drilled);
  return {
    faces: r.faces.length,
    holes: r.holes.length,
    diameters: r.holes.map(h => h.diameter),
    centres: r.holes.map(h => [h.centre.x, h.centre.y]),
    nominal: r.holes.map(h => h.nominal?.label),
    axes: r.holes.map(h => h.axisName),
    roundness: r.holes.map(h => h.roundness),
  };
});
check('an imported plate yields its six flat faces', rec.faces === 6, String(rec.faces));
check('all four holes are found', rec.holes === 4, String(rec.holes));
check('their diameters are within 0.5% of true',
  rec.diameters.every(d => Math.abs(d - 6.6) / 6.6 < 0.005), rec.diameters.map(d => d.toFixed(3)).join(', '));
check('their centres land on the drilled positions',
  rec.centres.every(([x, y]) => [[40, 25], [-40, 25], [40, -25], [-40, -25]].some(([a, b]) => Math.abs(x - a) < 0.02 && Math.abs(y - b) < 0.02)),
  JSON.stringify(rec.centres.map(c => c.map(v => v.toFixed(2)))));
check('they are matched to a standard drill', rec.nominal.every(n => n === 'M6 clearance'), JSON.stringify(rec.nominal));
check('the axis is recovered from the geometry', rec.axes.every(a => a === 'z'), JSON.stringify(rec.axes));
check('roundness is reported, not hidden', rec.roundness.every(r => r > 0.99), rec.roundness.map(r => r.toFixed(3)).join(', '));

const angled = await page.evaluate(async () => {
  const THREE = await import('three');
  const { buildPrimitive } = window.M.geo;
  const { booleanGeometries } = window.M.csg;
  const cut = booleanGeometries('subtract', [
    { geometry: buildPrimitive('box', { w: 60, d: 60, h: 60 }), matrix: new THREE.Matrix4() },
    { geometry: buildPrimitive('cylinder', { r: 4, h: 200, seg: 64, arc: 360 }), matrix: new THREE.Matrix4().makeRotationX(30 * Math.PI / 180) },
  ]);
  const r = window.M.rec.recognise(cut);
  const h = r.holes[0];
  if (!h) return null;
  const want = new THREE.Vector3(0, -Math.sin(30 * Math.PI / 180), Math.cos(30 * Math.PI / 180));
  return { off: Math.acos(Math.min(1, Math.abs(h.axis.dot(want)))) * 180 / Math.PI, d: h.diameter, named: h.axisName };
});
check('a hole drilled at an angle is found', !!angled);
check('its axis is recovered to within a quarter degree', angled && angled.off < 0.25, angled ? `${angled.off.toFixed(3)} deg` : '');
check('it is not falsely claimed to lie on a world axis', angled && angled.named === null, String(angled && angled.named));

// A rectangular slot is not a hole, and a sphere has no flat faces.
const negatives = await page.evaluate(async () => {
  const THREE = await import('three');
  const { buildPrimitive } = window.M.geo;
  const { booleanGeometries } = window.M.csg;
  const slot = booleanGeometries('subtract', [
    { geometry: buildPrimitive('box', { w: 80, d: 60, h: 10 }), matrix: new THREE.Matrix4() },
    { geometry: buildPrimitive('box', { w: 30, d: 8, h: 40 }), matrix: new THREE.Matrix4() },
  ]);
  return {
    slotHoles: window.M.rec.recognise(slot).holes.length,
    sphereFaces: window.M.rec.recognise(buildPrimitive('sphere', { r: 20, seg: 32 })).faces.length,
    sphereHoles: window.M.rec.recognise(buildPrimitive('sphere', { r: 20, seg: 32 })).holes.length,
  };
});
check('a rectangular slot is not claimed as a hole', negatives.slotHoles === 0, String(negatives.slotHoles));
check('a sphere yields no flat faces', negatives.sphereFaces === 0, String(negatives.sphereFaces));
check('a sphere yields no holes', negatives.sphereHoles === 0, String(negatives.sphereHoles));

// The payoff: a measured hole becomes a parametric cut.
const cut = await page.evaluate(async () => {
  const THREE = await import('three');
  const app = window.tesserCAD;
  const { store, makeFeature } = window.M.doc;
  const { buildPrimitive } = window.M.geo;
  const { booleanGeometries } = window.M.csg;
  const drilled = booleanGeometries('subtract', [
    { geometry: buildPrimitive('box', { w: 100, d: 60, h: 12 }), matrix: new THREE.Matrix4() },
    { geometry: buildPrimitive('cylinder', { r: 4.5, h: 40, seg: 48, arc: 360 }), matrix: new THREE.Matrix4().makeTranslation(20, 10, 0) },
  ]);
  const p = drilled.attributes.position.array;
  store.edit('import', (d) => {
    d.features = [makeFeature('mesh', { name: 'Vendor part', data: { positions: Array.from(p) } })];
  });
  return true;
});
await page.waitForTimeout(1200);
const cutMade = await page.evaluate(() => {
  const app = window.tesserCAD;
  const f = window.M.doc.store.doc.features.find(x => x.type === 'mesh');
  const inst = app.build.results.get(f.id).instances[0];
  const found = window.M.rec.recognise(inst.geometry, inst.matrix);
  const before = window.M.doc.store.doc.features.length;
  app.addCutterFor(found.holes[0], f);
  const after = window.M.doc.store.doc.features;
  const cutter = after.find(x => x.type === 'cylinder');
  return {
    hole: found.holes[0] ? { d: found.holes[0].diameter, c: [found.holes[0].centre.x, found.holes[0].centre.y] } : null,
    added: after.length - before,
    cutterPos: cutter ? cutter.transform.pos : null,
    cutterR: cutter ? cutter.params.r : null,
    boolean: after.some(x => x.type === 'boolean' && x.params.op === 'subtract'),
  };
});
check('a hole in an imported mesh is measured', cutMade.hole && Math.abs(cutMade.hole.d - 9) / 9 < 0.01,
  cutMade.hole ? cutMade.hole.d.toFixed(3) : 'none');
check('it becomes a parametric cut plus a boolean', cutMade.added === 2 && cutMade.boolean, String(cutMade.added));
check('the cut lands on the measured centre',
  cutMade.cutterPos && Math.abs(cutMade.cutterPos[0] - 20) < 0.05 && Math.abs(cutMade.cutterPos[1] - 10) < 0.05,
  JSON.stringify(cutMade.cutterPos));
check('and takes the measured radius', Math.abs(cutMade.cutterR - 4.5) / 4.5 < 0.01, String(cutMade.cutterR));
await page.waitForTimeout(1200);
const cutBuilds = await page.evaluate(() => ({
  bodies: window.tesserCAD.build.stats.bodies,
  errs: [...window.tesserCAD.build.results.values()].filter(r => r.error).length,
}));
check('the cut model rebuilds cleanly', cutBuilds.bodies > 0 && cutBuilds.errs === 0, JSON.stringify(cutBuilds));

/* ------------------------------------------------ 6. export tessellation */
const tess = await page.evaluate(() => {
  const T = window.M.tess;
  const holds = [[3.3, 0.05], [100, 0.05], [20, 0.01]].map(([r, tol]) => {
    const n = T.segmentsFor(r, tol);
    return { r, tol, n, sag: r * (1 - Math.cos(Math.PI / n)), oneLess: r * (1 - Math.cos(Math.PI / (n - 1))) };
  });
  const { store, makeFeature } = window.M.doc;
  store.edit('tess', (d) => {
    d.features = [
      makeFeature('cylinder', { name: 'Big', params: { r: 100, h: 20, seg: 24, arc: 360 } }),
      makeFeature('cylinder', { name: 'Small', params: { r: 1.65, h: 20, seg: 128, arc: 360 } }),
    ];
  });
  const out = T.retessellate(store.doc, 0.05);
  return {
    holds,
    big: out.doc.features.find(f => f.name === 'Big').params.seg,
    small: out.doc.features.find(f => f.name === 'Small').params.seg,
    sourceUntouched: store.doc.features[0].params.seg === 24,
  };
});
check('every segment count holds its chord tolerance', tess.holds.every(h => h.sag <= h.tol + 1e-9),
  tess.holds.map(h => h.sag.toFixed(5)).join(', '));
check('and none is wasteful: one fewer breaks it', tess.holds.every(h => h.oneLess > h.tol));
check('a large radius is refined and a small one coarsened', tess.big > 24 && tess.small < 128,
  `${tess.big} and ${tess.small}`);
check('the document being edited is not changed by an export setting', tess.sourceUntouched);

const clean = await page.evaluate(() => {
  const { buildPrimitive } = window.M.geo;
  const { stats } = window.M.tess.cleanMesh(buildPrimitive('sphere', { r: 20, seg: 48 }));
  return stats;
});
check('welding collapses duplicated vertices', clean.verticesAfter < clean.verticesBefore / 3,
  `${clean.verticesBefore} to ${clean.verticesAfter}`);

const units = await page.evaluate(() => {
  const U = window.M.tess.unitSanity;
  return {
    tiny: U({ x: 0.12, y: 0.08, z: 0.01 }),
    normal: U({ x: 120, y: 80, z: 10 }),
  };
});
check('a metre-scale model read as millimetres is flagged', units.tiny.suspect);
check('and metres is offered as the likely intent', units.tiny.suggestion?.unit === 'm', JSON.stringify(units.tiny.suggestion));
check('a plausible part is not flagged', !units.normal.suspect);

/* -------------------------------------- 7. the release package carries it */
const rel = await page.evaluate(async () => {
  const app = window.tesserCAD;
  const R = await import('./src/intel/release.js');
  window.__dl = [];
  const out = R.releasePackage(app, { force: true });
  return { ok: out.ok, files: out.files };
});
check('release still builds after all of this', rel.ok && rel.files.includes('model.stl'), JSON.stringify(rel.files));

console.log('\n' + R.join('\n'));
console.log('\nCONSOLE ERRORS: ' + errs.length);
for (const e of [...new Set(errs)].slice(0, 10)) console.log('  - ' + e);
const failed = R.filter(r => r.startsWith('FAIL')).length;
console.log(`\n${R.length - failed}/${R.length} checks passed`);
await browser.close();
process.exit(failed || errs.length ? 1 : 0);
