import * as THREE from 'three';
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
import * as D from '../../src/intel/deviation.js';
import { buildPrimitive } from '../../src/core/geometry.js';
import { designIntent } from '../../src/intel/release.js';
import { newDocument, makeFeature } from '../../src/core/doc.js';

let fails = 0;
const ok = (name, cond, extra = '') => { if (!cond) fails++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? '  - ' + extra : ''}`); };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

/* ---- point to triangle distance, checked by hand ---- */
const tri = [{ geometry: (() => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0,0,0, 10,0,0, 0,10,0]), 3));
  return g;
})(), matrix: null }];
let idx = D.buildIndex(D.collectTriangles(tri));
const at = (x, y, z) => D.signedDistance(new THREE.Vector3(x, y, z), idx);
ok('a point above the middle of a triangle is its height away', near(at(2, 2, 5).distance, 5, 1e-9), at(2,2,5).distance.toFixed(6));
ok('and the sign follows the surface normal', at(2, 2, 5).signed > 0 && at(2, 2, -5).signed < 0);
ok('a point on the face is at zero', near(at(3, 3, 0).distance, 0, 1e-9));
ok('a point past a vertex measures to the vertex', near(at(-3, -4, 0).distance, 5, 1e-9), at(-3,-4,0).distance.toFixed(6));
ok('a point past an edge measures to the edge', near(at(-4, 5, 0).distance, 4, 1e-9), at(-4,5,0).distance.toFixed(6));
// nearest point on the hypotenuse from (10,10,0): line x+y=10, distance = |20-10|/sqrt2
ok('a point past the hypotenuse measures perpendicular to it',
  near(at(10, 10, 0).distance, 10 / Math.SQRT2, 1e-6), at(10,10,0).distance.toFixed(6));
ok('and a diagonal offset combines both', near(at(2, 2, 3).distance, 3, 1e-9));

/* ---- a box against itself is exactly zero ---- */
const box = (w, d, h) => [{ geometry: buildPrimitive('box', { w, d, h }), matrix: null }];
let map = D.deviationMap(box(60, 40, 20), box(60, 40, 20));
ok('a shape compared with itself deviates by nothing', map.ok && map.max < 1e-6, map.max.toExponential(2));
ok('and the verdict says it is the same part', map.verdict.grade === 'match', map.verdict.label);
ok('the RMS is zero too', map.rms < 1e-6);
ok('nothing falls outside tolerance', map.outside === 0);
ok('the summary reads as a sentence', /same part/.test(D.deviationSummary(map).line), D.deviationSummary(map).line);

/* ---- a grown box deviates by the growth ---- */
map = D.deviationMap(box(61, 40, 20), box(60, 40, 20));
ok('a box 1mm wider deviates by 0.5mm on each face', near(map.max, 0.5, 1e-3), map.max.toFixed(4));
ok('the deviation is outward, so positive', map.maxSigned > 0);
ok('and it is called uniformly oversize, because every miss is outward',
  map.verdict.grade === 'oversize', `${map.verdict.grade}: ${map.verdict.label}`);
ok('a uniformly smaller part is called undersize',
  D.deviationMap(box(59, 40, 20), box(60, 40, 20)).verdict.grade === 'undersize',
  D.deviationMap(box(59, 40, 20), box(60, 40, 20)).verdict.label);
ok('the histogram spans the real range',
  map.histogram[0].from <= map.signed.reduce((a,b)=>Math.min(a,b)) + 1e-9 &&
  map.histogram.at(-1).to >= map.signed.reduce((a,b)=>Math.max(a,b)) - 1e-9);
ok('and the histogram counts every sample',
  map.histogram.reduce((s, b) => s + b.count, 0) === map.samples, `${map.histogram.reduce((s,b)=>s+b.count,0)} vs ${map.samples}`);

/* ---- a moved box reads as moved, not as noise ---- */
const moved = new THREE.Matrix4().makeTranslation(3, 0, 0);
map = D.deviationMap([{ geometry: buildPrimitive('box', { w: 60, d: 40, h: 20 }), matrix: moved }], box(60, 40, 20));
ok('a 3mm shift is detected', map.max > 2.9, map.max.toFixed(3));
ok('and it is called a shift, not a shape difference', map.verdict.grade === 'shifted',
  `${map.verdict.grade}: ${map.verdict.label}`);
ok('the offset is measured, and in the right direction',
  near(map.offset, 3, 1e-6) && near(map.offsetVector[0], 3, 1e-6), map.offsetVector.map(v => v.toFixed(2)).join(', '));
ok('and the advice is to register the two first', /Register the two together/.test(map.verdict.label));
ok('a part in the right place reports no offset',
  D.deviationMap(box(61, 40, 20), box(60, 40, 20)).offset < 1e-9);

/* ---- a unit mistake is called a unit mistake ---- */
map = D.deviationMap(box(60 * 25.4, 40 * 25.4, 20 * 25.4), box(60, 40, 20));
ok('a part 25.4x too big is flagged as a unit mismatch, not a shape difference',
  map.verdict.grade === 'units', `${map.verdict.grade}: ${map.verdict.label}`);
ok('and the advice names inches', /inches read as millimetres/.test(map.verdict.label), map.verdict.label);
ok('the scale factor itself is reported', near(map.scale, 25.4, 0.01), map.scale.toFixed(4));
let shrunk = D.deviationMap(box(60 / 25.4, 40 / 25.4, 20 / 25.4), box(60, 40, 20));
ok('and the mistake is caught the other way round too',
  shrunk.verdict.grade === 'units' && /millimetres read as inches/.test(shrunk.verdict.label), shrunk.verdict.label);
let cm = D.deviationMap(box(600, 400, 200), box(60, 40, 20));
ok('a centimetre mix-up is named as one', /centimetres/.test(cm.verdict.label), cm.verdict.label);
ok('a matching part is never called a unit error',
  D.deviationMap(box(60, 40, 20), box(60, 40, 20)).verdict.grade === 'match');

/* ---- coarse tessellation of the same cylinder ---- */
const fine = [{ geometry: buildPrimitive('cylinder', { r: 20, h: 40, seg: 128, arc: 360 }), matrix: null }];
const coarse = [{ geometry: buildPrimitive('cylinder', { r: 20, h: 40, seg: 16, arc: 360 }), matrix: null }];
map = D.deviationMap(coarse, fine, { tolerance: 0.01 });
// The deepest sampled point is a side triangle's centroid, which sits at
// r*|2u(0) + u(a)|/3 for a facet angle a, measured against a 128-gon that is
// itself one small sagitta inside the true circle.
const a = 2 * Math.PI / 16;
const centroidR = 20 * Math.sqrt((2 + Math.cos(a)) ** 2 + Math.sin(a) ** 2) / 3;
const refSagitta = 20 * (1 - Math.cos(Math.PI / 128));
const expectDeep = (20 - centroidR) - refSagitta;
ok('a coarse cylinder sits one facet depth inside a smooth one, to four decimals',
  near(map.max, expectDeep, 1e-3), `${map.max.toFixed(4)} vs ${expectDeep.toFixed(4)}`);
ok('and the deviation is inward, because a chord cuts the corner', map.maxSigned < 0, map.maxSigned.toFixed(4));
ok('the reference triangle count is reported', map.referenceTriangles > map.candidateTriangles,
  `${map.referenceTriangles} vs ${map.candidateTriangles}`);

/* ---- sampling stays bounded ---- */
const big = [{ geometry: buildPrimitive('sphere', { r: 30, seg: 96 }), matrix: null }];
const t0 = Date.now();
map = D.deviationMap(big, [{ geometry: buildPrimitive('sphere', { r: 30, seg: 48 }), matrix: null }], { maxSamples: 2000 });
const ms = Date.now() - t0;
ok('a large mesh is sampled, not exhaustively measured', map.samples <= 2600, `${map.samples} samples of ${map.candidateTriangles} triangles`);
ok('and it finishes fast enough to run on a click', ms < 4000, `${ms}ms`);
ok('a sphere against a coarser sphere deviates by well under a millimetre', map.max < 0.5, map.max.toFixed(4));

/* ---- colours ---- */
const colors = D.deviationColors(map);
ok('a colour is produced per sample', colors.length === map.samples * 3);
ok('every channel is in range', colors.every(c => c >= 0 && c <= 1));
ok('no colours without a map', D.deviationColors({ ok: false }) === null);

/* ---- degenerate input ---- */
ok('an empty candidate is reported, not crashed on',
  D.deviationMap([], box(10, 10, 10)).reason.includes('incoming mesh'));
ok('and an empty reference too', D.deviationMap(box(10, 10, 10), []).reason.includes('reference model'));
ok('a summary of a failed comparison still returns a line', !D.deviationSummary(null).ok);

/* ---- intent round trip ---- */
const doc = newDocument('Bracket');
doc.meta.author = 'Sam';
doc.params = [
  { id: 'p1', name: 'plate_w', value: 120, note: 'overall width' },
  { id: 'p2', name: 'thick', value: 'plate_w / 15', note: '' },
];
const plate = makeFeature('box', { name: 'Plate', material: 'aluminium' });
plate.params = { w: 'plate_w', d: 80, h: 'thick' };
const boss = makeFeature('cylinder', { name: 'Boss' });
boss.params = { r: 20, h: 25, seg: 48, arc: 360 };
boss.transform.pos = [0, 0, 8];
const cut = makeFeature('boolean', { name: 'Bore' });
cut.params = { op: 'subtract' };
cut.inputs = [plate.id, boss.id];
doc.features = [plate, boss, cut];
const build = {
  scope: { plate_w: 120, thick: 8 },
  results: new Map(doc.features.map(f => [f.id, { error: null, instances: [{}] }])),
  topLevel: [cut],
  stats: {
    volume: 1000, area: 500, mass: 0.0027, tris: 600,
    box: new THREE.Box3(new THREE.Vector3(-60, -40, 0), new THREE.Vector3(60, 40, 8)),
    centroid: new THREE.Vector3(0, 0, 4),
  },
};

const intent = designIntent(doc, build);
const rt = D.intentRoundTrip(intent);
ok('design intent imports back into a document', rt.ok, rt.differences.slice(0, 4).join(' | '));
ok('with no errors', rt.errors.length === 0, rt.errors.join('; '));
ok('the parameters come back as expressions, not as resolved numbers',
  rt.doc.params[1].value === 'plate_w / 15', String(rt.doc.params[1].value));
ok('the features come back in order', rt.doc.features.map(f => f.name).join(',') === 'Plate,Boss,Bore');
ok('the material comes back', rt.doc.features[0].material === 'aluminium');
ok('the transform comes back', rt.doc.features[1].transform.pos.join(',') === '0,0,8', rt.doc.features[1].transform.pos.join(','));
ok('and consumes is resolved from names back to real ids',
  rt.doc.features[2].inputs.length === 2 &&
  rt.doc.features[2].inputs.every(id => rt.doc.features.some(f => f.id === id)),
  rt.doc.features[2].inputs.join(','));
ok('so the imported tree points at the right features',
  rt.doc.features[2].inputs.map(id => rt.doc.features.find(f => f.id === id).name).join(',') === 'Plate,Boss');

/* duplicate names are flagged rather than guessed */
const dupDoc = structuredClone(doc);
dupDoc.features[1].name = 'Plate';
const dup = D.importIntent(designIntent(dupDoc, build));
ok('two features with one name is a note, not a silent pick',
  dup.notes.some(n => /more than one feature has that name/.test(n)), dup.notes.join('; '));
ok('and the document still imports so the user can rename', !!dup.doc);

/* ---- error paths ---- */
let bad = D.importIntent('{not json');
ok('invalid JSON is reported', bad.errors[0].startsWith('Not valid JSON'));
bad = D.importIntent({ format: 'something.else', features: [] });
ok('another format is refused by name', /"something.else"/.test(bad.errors[0]), bad.errors[0]);
bad = D.importIntent({ format: 'tessercad.design-intent' });
ok('a file with no features is refused', /No feature list/.test(bad.errors[0]));
bad = D.importIntent({ format: 'tessercad.design-intent', features: [{ name: 'X', type: 'flange' }] });
ok('an unknown feature type is reported with its name', /unknown type "flange"/.test(bad.errors[0]), bad.errors[0]);
bad = D.importIntent({ format: 'tessercad.design-intent', features: [{ name: 'A', type: 'box', consumes: ['Nope'] }] });
ok('a dangling consumes reference is an error', /does not define/.test(bad.errors[0]), bad.errors[0]);
let fwd = D.importIntent({ format: 'tessercad.design-intent', version: 9, document: { name: 'Future' }, features: [] });
ok('a newer format version imports with a note about what was ignored',
  !!fwd.doc && fwd.notes.some(n => /newer intent format/.test(n)), fwd.notes.join('; '));
let odd = D.importIntent({ format: 'tessercad.design-intent', features: [{ name: 'A', type: 'box', material: 'unobtainium', parameters: { w: 5, d: 5, h: 5 } }] });
ok('an unknown material falls back with a note', odd.doc.features[0].material === 'steel' && odd.notes.some(n => /does not have/.test(n)));
odd = D.importIntent({ format: 'tessercad.design-intent', document: { units: 'furlongs' }, features: [] });
ok('an unknown unit falls back to mm', odd.doc.meta.units === 'mm');
ok('a file with no format field is accepted, since older exports lacked it',
  !!D.importIntent({ features: [] }).doc);

/* ---- the imported document is a real document ---- */
ok('the import produces something the app can actually open',
  rt.doc.schema && rt.doc.view && rt.doc.draw && Array.isArray(rt.doc.features));

console.log(fails ? `\n${fails} FAILURES` : '\nALL DEVIATION CHECKS PASS');
process.exit(fails ? 1 : 0);
