import * as THREE from 'three';
import { buildPrimitive } from '../../src/core/geometry.js';
import { booleanGeometries } from '../../src/core/csg.js';
import { massProperties } from '../../src/core/rebuild.js';
import { buildSheet, sheetToSVG, sheetToDraw, scaleLabel, SHEETS } from '../../src/intel/drawing.js';
import { toDXF } from '../../src/draft/dxf.js';
globalThis.localStorage = { getItem: () => null, setItem: () => {} };

let bad = 0;
const ok = (n, c, x = '') => { if (!c) bad++; console.log(`${c ? 'ok  ' : 'FAIL'} ${n}${x ? '  - ' + x : ''}`); };

// A plate 120 x 80 x 12 with two M6 holes: known dimensions to check against.
const plate = buildPrimitive('box', { w: 120, d: 80, h: 12 });
const drilled = booleanGeometries('subtract', [
  { geometry: plate, matrix: new THREE.Matrix4() },
  { geometry: buildPrimitive('cylinder', { r: 3.3, h: 40, seg: 48, arc: 360 }), matrix: new THREE.Matrix4().makeTranslation(40, 0, 0) },
  { geometry: buildPrimitive('cylinder', { r: 3.3, h: 40, seg: 48, arc: 360 }), matrix: new THREE.Matrix4().makeTranslation(-40, 0, 0) },
]);
const mp = massProperties(drilled);
const bodies = [{
  geometry: drilled, matrix: null, box: mp.box,
  feature: { name: 'Plate', material: 'aluminium' },
}];
const doc = {
  meta: { name: 'Test plate', units: 'mm', author: 'QA' },
  studio: { process: 'cnc3' },
  configs: { active: 'default', list: [{ id: 'default', name: 'Default' }] },
};
const build = { stats: { mass: 0.3 } };

const t0 = Date.now();
const s = buildSheet(bodies, { doc, build, sheet: 'a3l' });
console.log(`\nbuilt in ${Date.now() - t0}ms: scale ${scaleLabel(s.scale)}, ${s.views.length} views, ${s.holes.length} holes\n`);

ok('four views are laid out', s.views.length === 4, String(s.views.length));
ok('a standard scale is chosen', /^(\d+:1|1:\d+)$/.test(scaleLabel(s.scale)), scaleLabel(s.scale));

const front = s.views.find(v => v.key === 'front');
const top = s.views.find(v => v.key === 'top');
const right = s.views.find(v => v.key === 'right');
const iso = s.views.find(v => v.key === 'iso');

const ext = (v) => v.box ? [v.box.maxX - v.box.minX, v.box.maxY - v.box.minY] : null;
console.log('  front extents', ext(front).map(n => n.toFixed(2)), '(want 120.00, 12.00)');
console.log('  top   extents', ext(top).map(n => n.toFixed(2)), '(want 120.00, 80.00)');
console.log('  right extents', ext(right).map(n => n.toFixed(2)), '(want 80.00, 12.00)');

ok('the front view is 120 wide and 12 tall',
  Math.abs(ext(front)[0] - 120) < 0.01 && Math.abs(ext(front)[1] - 12) < 0.01, JSON.stringify(ext(front)));
ok('the top view is 120 by 80',
  Math.abs(ext(top)[0] - 120) < 0.01 && Math.abs(ext(top)[1] - 80) < 0.01, JSON.stringify(ext(top)));
ok('the right view is 80 by 12',
  Math.abs(ext(right)[0] - 80) < 0.01 && Math.abs(ext(right)[1] - 12) < 0.01, JSON.stringify(ext(right)));

ok('both holes are found', s.holes.length === 2, String(s.holes.length));
ok('the holes appear as circles in the top view, which sees them face-on',
  top.circles.length === 2, String(top.circles.length));
ok('and not in the front view, which sees them edge-on',
  front.circles.length === 0, String(front.circles.length));
ok('the circle diameter is right',
  top.circles.every(c => Math.abs(c.diameter - 6.6) / 6.6 < 0.01), top.circles.map(c => c.diameter.toFixed(3)).join(', '));
ok('the circle centres sit at the drilled positions',
  top.circles.every(c => [40, -40].some(x => Math.abs(c.at[0] - x) < 0.05 || Math.abs(c.at[1] - x) < 0.05)),
  JSON.stringify(top.circles.map(c => c.at.map(n => n.toFixed(1)))));

// Hidden-line removal: a solid plate seen from the front must not show the
// back face edges as visible.
const vis = front.segs.filter(e => e.visible).length;
const hid = front.segs.filter(e => !e.visible).length;
console.log(`  front view: ${vis} visible segments, ${hid} hidden`);
ok('the front view has visible edges', vis > 0, String(vis));
ok('and classifies some as hidden', hid > 0, String(hid));

const noHLR = buildSheet(bodies, { doc, build, hlr: false });
const allVis = noHLR.views.find(v => v.key === 'front').segs.every(e => e.visible);
ok('hidden-line removal can be switched off', allVis);

// Dimensions must carry the real numbers, not the drawn ones.
const dims = front.dims.filter(d => d.kind !== 'dia');
console.log('  front dims', dims.map(d => `${d.kind}=${d.value.toFixed(2)}`).join(', '));
ok('dimensions report model millimetres, not sheet millimetres',
  dims.some(d => Math.abs(d.value - 120) < 0.01) && dims.some(d => Math.abs(d.value - 12) < 0.01),
  JSON.stringify(dims.map(d => d.value)));
const dia = top.dims.find(d => d.kind === 'dia');
ok('the largest hole gets a diameter callout', !!dia && /⌀6\.\d+/.test(dia.label), dia?.label);
ok('and it names the standard size', !!dia && /M6/.test(dia.label), dia?.label);

// The title block must say the things a shop needs.
const t = s.title;
console.log('  title:', JSON.stringify({ name: t.name, material: t.material, scale: t.scale, proj: t.projection, tol: t.tolerance }));
ok('the title block names the part, material, scale and units',
  t.name === 'Test plate' && /Alumin/.test(t.material) && t.scale && t.units === 'mm');
ok('it states the projection convention', t.projection === 'FIRST ANGLE');

// The stated symbol and the actual layout must agree, or the reader mirrors
// the part. First angle puts the view from above BELOW the front view.
const vy = (k) => s.views.find(v => v.key === k).origin[1];
const vx = (k) => s.views.find(v => v.key === k).origin[0];
ok('first angle draws the top view below the front view', vy('top') < vy('front'),
  `top at y=${vy('top')}, front at y=${vy('front')} (measured up from the bottom edge)`);
ok('and the right-side view to the left of it', vx('right') < vx('front'),
  `right at x=${vx('right')}, front at x=${vx('front')}`);

const third = buildSheet(bodies, { doc, build, sheet: 'a3l', projection: 'third', hlr: false });
const ty = (k) => third.views.find(v => v.key === k).origin[1];
const tx = (k) => third.views.find(v => v.key === k).origin[0];
ok('third angle draws the top view above the front view', ty('top') > ty('front'),
  `top at y=${ty('top')}, front at y=${ty('front')}`);
ok('and the right-side view to the right of it', tx('right') > tx('front'));
ok('and relabels the title block', third.title.projection === 'THIRD ANGLE', third.title.projection);
ok('the two conventions really are different layouts',
  vx('front') !== tx('front') && vy('front') !== ty('front'));
ok('but the geometry in a view does not change with the convention',
  s.views.find(v => v.key === 'top').segs.length === third.views.find(v => v.key === 'top').segs.length);
ok('and the general tolerance from the process', t.tolerance > 0, String(t.tolerance));

// SVG output
const svg = sheetToSVG(s);
ok('the sheet renders as SVG', svg.startsWith('<svg') && svg.endsWith('</svg>'), `${svg.length} bytes`);
ok('the SVG viewBox is the paper size', svg.includes(`viewBox="0 0 ${SHEETS.a3l.w} ${SHEETS.a3l.h}"`));
ok('hidden lines are dashed in the SVG', svg.includes('stroke-dasharray'));
ok('every view label is on the sheet',
  ['FRONT', 'TOP', 'RIGHT', 'ISO'].every(l => svg.includes(`>${l}<`)));
ok('the SVG has no NaN coordinates', !/NaN/.test(svg), (svg.match(/NaN/g) || []).length + ' occurrences');

// Draft document, and through it DXF
const draw = sheetToDraw(s);
// A clean part should convert to few entities, not many: collinear merging and
// T-junction rejection are what keep the DXF editable rather than a wire nest.
ok('the sheet converts to a drawing document',
  draw.entities.length > 20 && draw.entities.length < 2000 && draw.layers.length === 5,
  `${draw.entities.length} entities`);
ok('visible and hidden go on separate layers',
  draw.entities.some(e => e.layer === 'lv') && draw.entities.some(e => e.layer === 'lh'));
ok('no entity has a NaN coordinate',
  draw.entities.every(e => [e.a, e.b, e.c, e.p].filter(Boolean).every(pt => pt.every(Number.isFinite))));
const dxf = toDXF(draw, { units: 'mm' });
ok('and the drawing writes valid DXF', dxf.includes('AC1009') && dxf.includes('ENTITIES') && !/NaN/.test(dxf),
  `${dxf.length} bytes`);

// Scale choice must actually make the drawing fit the paper.
const big = [{ geometry: buildPrimitive('box', { w: 2000, d: 1200, h: 300 }), matrix: null,
  box: massProperties(buildPrimitive('box', { w: 2000, d: 1200, h: 300 })).box,
  feature: { name: 'Big', material: 'steel' } }];
const bigSheet = buildSheet(big, { doc, build, sheet: 'a3l', hlr: false });
const fits = bigSheet.views.every(v => !v.box ||
  (v.box.maxX - v.box.minX) * bigSheet.scale < SHEETS.a3l.w / 2 &&
  (v.box.maxY - v.box.minY) * bigSheet.scale < SHEETS.a3l.h / 2);
ok('a 2m part is scaled down to fit the sheet', fits && bigSheet.scale < 1, scaleLabel(bigSheet.scale));

const tiny = [{ geometry: buildPrimitive('box', { w: 4, d: 3, h: 2 }), matrix: null,
  box: massProperties(buildPrimitive('box', { w: 4, d: 3, h: 2 })).box,
  feature: { name: 'Tiny', material: 'brass' } }];
const tinySheet = buildSheet(tiny, { doc, build, sheet: 'a3l', hlr: false });
ok('a 4mm part is scaled up', tinySheet.scale > 1, scaleLabel(tinySheet.scale));

console.log(bad === 0 ? '\nALL DRAWING CHECKS PASS' : `\n${bad} FAILURES`);
process.exit(bad ? 1 : 0);
