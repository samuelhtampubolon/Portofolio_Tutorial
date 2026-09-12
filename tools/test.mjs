/**
 * Headless unit tests for the parts of TesserCAD that do not need a DOM:
 * the expression evaluator, the CSG kernel, the geometry builders, the
 * feature-rebuild engine and the DXF codec.
 *
 *   node tools/setup-dev.mjs && node tools/test.mjs
 */
import * as THREE from 'three';
import { evaluate, tryEval, buildScope } from '../src/core/expr.js';
import { booleanGeometries } from '../src/core/csg.js';
import {
  buildPrimitive, buildExtrude, buildRevolve, shapesFromEntities,
  buildLoops, triangleCount,
} from '../src/core/geometry.js';
import { toDXF, fromDXF, toSVG } from '../src/draft/dxf.js';

// Minimal browser shims so core/doc.js can be imported outside a browser.
globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.structuredClone ??= (o) => JSON.parse(JSON.stringify(o));

const { newDocument, makeFeature, migrate, uid } = await import('../src/core/doc.js');
const { rebuild, massProperties, invalidateCache } = await import('../src/core/rebuild.js');

let pass = 0, fail = 0;
const results = [];

function check(name, ok, detail = '') {
  (ok ? pass++ : fail++);
  results.push(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  — ${detail}` : ''}`);
}
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

/* ------------------------------------------------------- expressions */

check('arithmetic precedence', evaluate('2 + 3 * 4') === 14);
check('exponent is right associative', evaluate('2^3^2') === 512);
check('unary minus', evaluate('-3 + 10') === 7);
check('functions', near(evaluate('cos(rad(60))'), 0.5, 1e-12));
check('clamp/lerp helpers', evaluate('clamp(15, 0, 10)') === 10 && evaluate('lerp(0, 10, 0.25)') === 2.5);
check('parameter references chain', (() => {
  const { scope } = buildScope([{ name: 'w', value: 40 }, { name: 'h', value: 'w/2' }, { name: 'a', value: 'w*h' }]);
  return scope.a === 800;
})());
check('unknown name is an error', tryEval('nope + 1').ok === false);
check('division by zero is an error', tryEval('1/0').ok === false);
check('no code execution', tryEval('constructor').ok === false && tryEval('globalThis').ok === false);

/* --------------------------------------------------------- primitives */

const PRIMS = ['box', 'cylinder', 'sphere', 'cone', 'torus', 'tube', 'wedge', 'prism', 'pyramid', 'plate', 'helix'];
for (const type of PRIMS) {
  const p = { w: 60, d: 40, h: 25, r: 20, r1: 25, r2: 5, R: 30, ro: 22, ri: 14, seg: 24, tseg: 12,
    sides: 6, fillet: 6, hole: 4, arc: 360, pitch: 12, turns: 2, steps: 12 };
  let ok = false, detail = '';
  try {
    const g = buildPrimitive(type, p);
    const t = triangleCount(g);
    g.computeBoundingBox();
    ok = t > 0 && Number.isFinite(g.boundingBox.max.x);
    detail = `${t} triangles`;
  } catch (e) { detail = e.message; }
  check(`primitive: ${type}`, ok, detail);
}

check('box volume is exact', (() => {
  const mp = massProperties(buildPrimitive('box', { w: 10, d: 20, h: 30 }));
  return near(mp.volume, 6000, 1e-3);
})());

check('tube volume matches the annulus formula', (() => {
  const g = buildPrimitive('tube', { ro: 20, ri: 10, h: 50, seg: 256 });
  const mp = massProperties(g);
  const want = Math.PI * (400 - 100) * 50;
  return Math.abs(mp.volume - want) / want < 0.01;
})());

check('torus lies in the XY plane', (() => {
  const g = buildPrimitive('torus', { R: 30, r: 5, seg: 32, tseg: 12, arc: 360 });
  g.computeBoundingBox();
  return near(g.boundingBox.max.z, 5, 0.01) && near(g.boundingBox.max.x, 35, 0.01);
})());

check('partial sweeps are closed solids', (() => {
  const cyl = massProperties(buildPrimitive('cylinder', { r: 10, h: 20, seg: 64, arc: 90 }));
  const tor = massProperties(buildPrimitive('torus', { R: 20, r: 4, seg: 64, tseg: 16, arc: 120 }));
  return cyl.closed && tor.closed
    && Math.abs(cyl.volume - Math.PI * 100 * 20 / 4) / (Math.PI * 100 * 20 / 4) < 0.02;
})());

/* --------------------------------------------------------------- CSG */

const box = buildPrimitive('box', { w: 20, d: 20, h: 20 });
const sph = buildPrimitive('sphere', { r: 12, seg: 24 });
const I = new THREE.Matrix4();

check('CSG union grows the bounding box', (() => {
  const g = booleanGeometries('union', [{ geometry: box, matrix: I }, { geometry: sph, matrix: I }]);
  g.computeBoundingBox();
  return near(g.boundingBox.max.x, 12, 0.2);
})());

check('CSG subtract keeps the outer shell', (() => {
  const g = booleanGeometries('subtract', [{ geometry: box, matrix: I }, { geometry: sph, matrix: I }]);
  g.computeBoundingBox();
  const mp = massProperties(g);
  return near(g.boundingBox.max.x, 10, 0.01) && mp.volume < 8000 && mp.volume > 1000;
})());

check('CSG intersect is bounded by both operands', (() => {
  const g = booleanGeometries('intersect', [{ geometry: box, matrix: I }, { geometry: sph, matrix: I }]);
  g.computeBoundingBox();
  return g.boundingBox.max.x <= 10.01 && g.boundingBox.max.x > 8;
})());

check('CSG respects operand matrices', (() => {
  const m = new THREE.Matrix4().makeTranslation(100, 0, 0);
  const g = booleanGeometries('union', [{ geometry: box, matrix: I }, { geometry: box, matrix: m }]);
  g.computeBoundingBox();
  return near(g.boundingBox.max.x, 110, 0.01);
})());

check('CSG rejects oversized inputs instead of hanging', (() => {
  const tris = 60000;
  const big = new THREE.BufferGeometry();
  big.setAttribute('position', new THREE.BufferAttribute(new Float32Array(tris * 9), 3));
  try { booleanGeometries('union', [{ geometry: big, matrix: I }, { geometry: big, matrix: I }]); return false; }
  catch (e) { return /budget/i.test(e.message); }
})());

/* ------------------------------------------------- profiles and sweeps */

const plateProfile = [
  { id: 'a', type: 'rect', a: [-30, -20], b: [30, 20] },
  { id: 'b', type: 'circle', c: [0, 0], r: 8 },
];

check('closed profile finds its hole', (() => {
  const shapes = shapesFromEntities(plateProfile);
  return shapes.length === 1 && shapes[0].holes.length === 1;
})());

check('separate lines chain into one loop', (() => {
  const lines = [
    { id: '1', type: 'line', a: [0, 0], b: [40, 0] },
    { id: '2', type: 'line', a: [40, 0], b: [40, 25] },
    { id: '3', type: 'line', a: [40, 25], b: [0, 25] },
    { id: '4', type: 'line', a: [0, 25], b: [0, 0] },
  ];
  return buildLoops(lines).length === 1;
})());

check('extrude volume matches the profile area', (() => {
  const g = buildExtrude(shapesFromEntities(plateProfile, 200), { dist: 10, symmetric: true });
  const mp = massProperties(g);
  const want = (60 * 40 - Math.PI * 64) * 10;
  return Math.abs(mp.volume - want) / want < 0.01 && mp.closed;
})());

check('extruded walls face outwards', (() => {
  const g = buildExtrude(shapesFromEntities([{ id: 'r', type: 'rect', a: [-10, -10], b: [10, 10] }]), { dist: 10 });
  const p = g.attributes.position.array;
  const n = g.attributes.normal.array;
  // find a vertex on the +X wall and check its normal points along +X
  for (let i = 0; i < p.length; i += 3) {
    if (Math.abs(p[i] - 10) < 1e-6 && Math.abs(p[i + 2] - 5) < 6 && Math.abs(p[i + 1]) < 9) {
      if (n[i] < 0.5) return false;
    }
  }
  return true;
})());

check('negative extrude distance stays watertight', (() => {
  const mp = massProperties(buildExtrude(shapesFromEntities(plateProfile, 200), { dist: -10 }));
  const want = (60 * 40 - Math.PI * 64) * 10;
  return mp.closed && Math.abs(mp.volume - want) / want < 0.01;
})());

check('draft angle widens the far face', (() => {
  const g = buildExtrude(shapesFromEntities([plateProfile[0]]), { dist: 20, taper: 10, steps: 6 });
  g.computeBoundingBox();
  return near(g.boundingBox.max.x, 30 + Math.tan(10 * Math.PI / 180) * 20, 0.05);
})());

check('zero-distance extrude is rejected', (() => {
  try { buildExtrude(shapesFromEntities(plateProfile), { dist: 0 }); return false; }
  catch { return true; }
})());

check('revolve produces a closed solid of the right size', (() => {
  const shapes = shapesFromEntities([{ id: 'r', type: 'rect', a: [10, 0], b: [20, 30] }]);
  const g = buildRevolve(shapes, { angle: 360, axis: 'y', seg: 128 });
  const mp = massProperties(g);
  g.computeBoundingBox();
  const want = Math.PI * (400 - 100) * 30;
  return mp.closed && near(g.boundingBox.max.x, 20, 0.01) && Math.abs(mp.volume - want) / want < 0.02;
})());

check('revolve refuses a profile crossing the axis', (() => {
  try {
    buildRevolve(shapesFromEntities([{ id: 'r', type: 'rect', a: [-10, 0], b: [20, 30] }]), { angle: 360, axis: 'y' });
    return false;
  } catch (e) { return /one side/i.test(e.message); }
})());

/* ---------------------------------------------------- rebuild engine */

function demoDoc() {
  const doc = newDocument('unit');
  doc.params = [{ id: uid('p'), name: 'width', value: 60, note: '' }];
  const a = makeFeature('box', { params: { w: 'width', d: 40, h: 20 } });
  const b = makeFeature('cylinder', { params: { r: 10, h: 60, seg: 48, arc: 360 } });
  const cut = makeFeature('boolean', { params: { op: 'subtract' }, inputs: [a.id, b.id] });
  const pat = makeFeature('patternLinear', { params: { dx: 80, dy: 0, dz: 0, count: 3, dx2: 0, dy2: 0, dz2: 0, count2: 1 }, inputs: [cut.id] });
  doc.features = [a, b, cut, pat];
  return { doc, ids: { a: a.id, b: b.id, cut: cut.id, pat: pat.id } };
}

check('rebuild evaluates the whole tree', (() => {
  invalidateCache();
  const { doc, ids } = demoDoc();
  const r = rebuild(doc);
  return !r.results.get(ids.cut).error
    && r.results.get(ids.pat).instances.length === 3
    && r.topLevel.length === 1
    && r.consumed.size === 3;
})());

check('parameters drive geometry', (() => {
  invalidateCache();
  const { doc, ids } = demoDoc();
  rebuild(doc);
  doc.params[0].value = 120;
  const r = rebuild(doc);
  const g = r.results.get(ids.a).instances[0].geometry;
  g.computeBoundingBox();
  return near(g.boundingBox.max.x, 60, 1e-4);
})());

check('rebuild caches unchanged features', (() => {
  invalidateCache();
  const { doc } = demoDoc();
  const t0 = Date.now(); rebuild(doc); const cold = Date.now() - t0;
  const t1 = Date.now(); rebuild(doc); const warm = Date.now() - t1;
  return warm <= Math.max(3, cold);
})());

check('a failing feature reports instead of throwing', (() => {
  invalidateCache();
  const doc = newDocument('bad');
  doc.features = [makeFeature('tube', { params: { ro: 10, ri: 20, h: 10, seg: 16 } })];
  const r = rebuild(doc);
  return !!r.results.get(doc.features[0].id).error;
})());

check('mass and volume are reported', (() => {
  invalidateCache();
  const doc = newDocument('mass');
  doc.features = [makeFeature('box', { params: { w: 100, d: 100, h: 100 }, material: 'steel' })];
  const r = rebuild(doc);
  return near(r.stats.volume, 1e6, 1) && near(r.stats.mass, 7.85, 0.01);
})());

check('mirror flips and keeps the original', (() => {
  invalidateCache();
  const doc = newDocument('mirror');
  const a = makeFeature('box', { params: { w: 20, d: 20, h: 20 }, pos: [50, 0, 0] });
  const m = makeFeature('mirror', { params: { plane: 'yz', offset: 0, keep: true }, inputs: [a.id] });
  doc.features = [a, m];
  const r = rebuild(doc);
  const res = r.results.get(m.id);
  if (res.error || res.instances.length !== 2) return false;
  const mp = massProperties(res.instances[1].geometry, res.instances[1].matrix);
  return mp.closed && mp.centroid.x < 0 && near(mp.volume, 8000, 1);
})());

check('circular pattern places the right number of copies', (() => {
  invalidateCache();
  const doc = newDocument('pat');
  const a = makeFeature('box', { params: { w: 10, d: 10, h: 10 }, pos: [40, 0, 0] });
  const p = makeFeature('patternCircular', { params: { axis: 'z', cx: 0, cy: 0, cz: 0, count: 8, angle: 360, rotate: true }, inputs: [a.id] });
  doc.features = [a, p];
  const r = rebuild(doc);
  return r.results.get(p.id).instances.length === 8;
})());

check('document migration repairs dangling references', (() => {
  const doc = newDocument('m');
  const a = makeFeature('box');
  const b = makeFeature('boolean', { inputs: [a.id, 'ghost-id'] });
  doc.features = [a, b];
  const out = migrate(JSON.parse(JSON.stringify(doc)));
  return out.features[1].inputs.length === 1 && out.schema >= 3;
})());

check('project round-trips through JSON', (() => {
  invalidateCache();
  const { doc } = demoDoc();
  const before = rebuild(doc).stats.tris;
  const after = rebuild(migrate(JSON.parse(JSON.stringify(doc)))).stats.tris;
  return before === after && before > 0;
})());

/* --------------------------------------------------------------- DXF */

const draw = {
  layers: [{ id: 'l1', name: '0', color: '#ff0000', visible: true, locked: false, weight: 1, style: 'solid' }],
  entities: [
    { id: 'e1', layer: 'l1', type: 'line', a: [0, 0], b: [100, 0] },
    { id: 'e2', layer: 'l1', type: 'circle', c: [50, 30], r: 20 },
    { id: 'e3', layer: 'l1', type: 'polyline', pts: [[0, 0], [100, 0], [100, 60], [0, 60]], closed: true },
    { id: 'e4', layer: 'l1', type: 'arc', c: [0, 0], r: 40, a0: 0, a1: 1.5707963 },
    { id: 'e5', layer: 'l1', type: 'text', p: [10, 70], text: 'PLATE', size: 8, rot: 0 },
  ],
};

check('DXF writes an R12 header', toDXF(draw).includes('AC1009'));
check('DXF round-trips line, circle, polyline, arc and text', (() => {
  const back = fromDXF(toDXF(draw));
  const types = back.entities.map(e => e.type);
  const circle = back.entities.find(e => e.type === 'circle');
  return types.includes('line') && types.includes('circle') && types.includes('polyline')
    && types.includes('arc') && types.includes('text')
    && near(circle.r, 20, 1e-6) && near(circle.c[0], 50, 1e-6);
})());
check('DXF reader survives garbage input', (() => {
  try { return fromDXF('not a dxf at all\n\n0\nEOF').entities.length === 0; }
  catch { return false; }
})());
check('SVG export contains the drawing', (() => {
  const svg = toSVG(draw, { units: 'mm' });
  return svg.startsWith('<?xml') && svg.includes('<circle') && svg.includes('<path');
})());

/* ---------------------------------------------------------- templates */

const cmds = await import('../src/ui/commands.js');
cmds.registerFeatureFactory(makeFeature);

for (const t of cmds.TEMPLATES) {
  invalidateCache();
  let ok = false, detail = '';
  try {
    const started = Date.now();
    const r = rebuild(t.build());
    const bad = [...r.results.values()].filter(x => x.error);
    const ms = Date.now() - started;
    ok = bad.length === 0 && (t.id === 'blank' || r.stats.bodies > 0) && ms < 6000;
    detail = bad.length ? bad[0].error : `${r.stats.bodies} bodies, ${r.stats.tris} triangles, ${ms} ms`;
  } catch (e) { detail = e.message; }
  check(`template builds: ${t.id}`, ok, detail);
}

check('every command has a label, icon and group', (() => {
  // buildCommands needs an app object; a stub is enough to enumerate them
  const stub = {
    selection: new Set(), workspace: 'model', draft: { selection: new Set(), tool: 'select', snap: { on: true, grid: true }, ortho: false, polar: false },
    sim: { playing: false }, vp: { measureMode: null }, gizmoMode: null, prefs: {},
  };
  const list = cmds.buildCommands(stub);
  const bad = list.filter(c => !c.id || !c.label || !c.icon || !c.group || typeof c.run !== 'function');
  const dupes = list.length - new Set(list.map(c => c.id)).size;
  return bad.length === 0 && dupes === 0 && list.length > 150;
})());

/* ------------------------------------------------------------ report */

console.log(results.join('\n'));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
