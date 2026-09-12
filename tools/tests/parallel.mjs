/**
 * The parallel rebuild.
 *
 * Node has no global Worker, so the pool reports itself unavailable and every
 * boolean falls through to the synchronous kernel. That is exactly the path a
 * browser without workers takes, so this suite proves the important half: the
 * fallback produces the same answer as the direct call, feature for feature.
 * The browser suite proves the other half, that work really leaves the main
 * thread.
 */
import * as THREE from 'three';
globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.structuredClone ??= (o) => JSON.parse(JSON.stringify(o));

const { newDocument, makeFeature } = await import('../../src/core/doc.js');
const { rebuild, rebuildAsync, invalidateCache, massProperties } = await import('../../src/core/rebuild.js');
const { pool, isWorkerUnavailable } = await import('../../src/core/csg-pool.js');
const { booleanGeometries, geometryToTriangles, trianglesToGeometry, operandsToArrays } = await import('../../src/core/csg.js');
const { booleanTriangles } = await import('../../src/core/csg-core.js');
const { buildPrimitive } = await import('../../src/core/geometry.js');

let fails = 0;
const ok = (name, cond, extra = '') => { if (!cond) fails++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? '  - ' + extra : ''}`); };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

/* ---- the kernel split must not change the answer ---- */
const box = buildPrimitive('box', { w: 40, d: 40, h: 40 });
const cyl = buildPrimitive('cylinder', { r: 12, h: 60, seg: 48, arc: 360 });
const cut = booleanGeometries('subtract', [{ geometry: box, matrix: null }, { geometry: cyl, matrix: null }]);
const mp = massProperties(cut);
// 40^3 minus a 24mm bore right through: 64000 - pi*144*40 = 64000 - 18095.6
ok('a bore through a 40mm cube leaves the right volume',
  near(mp.volume, 64000 - Math.PI * 144 * 40, 60), `${mp.volume.toFixed(1)} vs ${(64000 - Math.PI*144*40).toFixed(1)}`);

// The same boolean through the flat-array path must be identical.
const direct = booleanTriangles('subtract', operandsToArrays([{ geometry: box, matrix: null }, { geometry: cyl, matrix: null }]));
const viaGeom = geometryToTriangles(cut);
ok('the flat-array kernel and the geometry wrapper agree exactly',
  direct.position.length === viaGeom.position.length &&
  direct.position.every((v, i) => Math.abs(v - viaGeom.position[i]) < 1e-9),
  `${direct.position.length / 9} vs ${viaGeom.position.length / 9} triangles`);

/* ---- transform handling in the THREE-free path ---- */
const m = new THREE.Matrix4().makeTranslation(5, 0, 0).multiply(new THREE.Matrix4().makeRotationZ(0.7));
const movedA = booleanGeometries('union', [{ geometry: box, matrix: m }, { geometry: cyl, matrix: null }]);
const boxMoved = box.clone().applyMatrix4(m);
const movedB = booleanGeometries('union', [{ geometry: boxMoved, matrix: null }, { geometry: cyl, matrix: null }]);
ok('a matrix applied by the kernel matches one applied to the geometry first',
  near(massProperties(movedA).volume, massProperties(movedB).volume, 1),
  `${massProperties(movedA).volume.toFixed(2)} vs ${massProperties(movedB).volume.toFixed(2)}`);
// normals must come through transformed, not stale
const n0 = geometryToTriangles(movedA).normal;
ok('normals survive the transform as unit vectors', (() => {
  for (let i = 0; i < Math.min(n0.length, 900); i += 3) {
    const len = Math.hypot(n0[i], n0[i + 1], n0[i + 2]);
    if (len > 0.001 && Math.abs(len - 1) > 0.02) return false;
  }
  return true;
})());

/* ---- the pool degrades honestly where there are no workers ---- */
ok('with no Worker global the pool reports itself unavailable', pool.start() === false);
ok('and says why', /Worker support/.test(pool.reason), pool.reason);
let rejected = null;
await pool.run('union', []).catch(e => { rejected = e; });
ok('a job rejects rather than hanging', !!rejected);
ok('and the rejection is recognisable as a fallback signal', isWorkerUnavailable(rejected), rejected.message);
ok('an unrelated error is not mistaken for one', !isWorkerUnavailable(new Error('boom')));
ok('the report says it is unavailable', pool.report().available === false && pool.report().size === 0);

/* ---- async rebuild agrees with sync rebuild, feature for feature ---- */
const doc = newDocument('Parallel');
doc.params = [];
const plate = makeFeature('box', { name: 'Plate', params: { w: 80, d: 60, h: 10 } });
const holeA = makeFeature('cylinder', { name: 'Hole A', params: { r: 4, h: 30, seg: 32, arc: 360 } });
holeA.transform.pos = [-25, 0, 0];
const holeB = makeFeature('cylinder', { name: 'Hole B', params: { r: 4, h: 30, seg: 32, arc: 360 } });
holeB.transform.pos = [25, 0, 0];
const cutA = makeFeature('boolean', { name: 'Cut A', params: { op: 'subtract' } });
cutA.inputs = [plate.id, holeA.id];
const cutB = makeFeature('boolean', { name: 'Cut B', params: { op: 'subtract' } });
cutB.inputs = [cutA.id, holeB.id];
doc.features = [plate, holeA, holeB, cutA, cutB];

invalidateCache();
const sync = rebuild(doc);
invalidateCache();
const async1 = await rebuildAsync(doc);

ok('both rebuilds evaluate every feature', sync.results.size === async1.results.size, `${sync.results.size} vs ${async1.results.size}`);
ok('neither reports an error',
  [...sync.results.values()].every(r => !r.error) && [...async1.results.values()].every(r => !r.error),
  [...async1.results.values()].filter(r => r.error).map(r => r.error).join('; '));
ok('the same features are top level',
  sync.topLevel.map(f => f.id).join() === async1.topLevel.map(f => f.id).join());
ok('and the volume matches to within a rounding error',
  near(sync.stats.volume, async1.stats.volume, 0.5),
  `${sync.stats.volume.toFixed(3)} vs ${async1.stats.volume.toFixed(3)}`);
ok('as does the triangle count', sync.stats.tris === async1.stats.tris, `${sync.stats.tris} vs ${async1.stats.tris}`);
ok('and every body lands in the same place', (() => {
  for (const f of sync.topLevel) {
    const a = sync.results.get(f.id).instances[0], b = async1.results.get(f.id).instances[0];
    if (!a || !b) return false;
    const pa = new THREE.Vector3().setFromMatrixPosition(a.matrix);
    const pb = new THREE.Vector3().setFromMatrixPosition(b.matrix);
    if (pa.distanceTo(pb) > 1e-6) return false;
  }
  return true;
})());

/* ---- dependency levels ---- */
ok('the evaluator finds the real dependency depth', async1.parallel.levels === 3, `${async1.parallel.levels} levels`);
ok('both booleans went through the off-thread path', async1.parallel.offThread === 2, String(async1.parallel.offThread));
ok('and both fell back to this thread, since there are no workers here',
  async1.parallel.onThread === 2, String(async1.parallel.onThread));

// Independent booleans must share a level, which is what allows overlap.
const doc2 = newDocument('Two independent');
doc2.params = [];
const mk = (name, x) => {
  const a = makeFeature('box', { name: `${name} box`, params: { w: 20, d: 20, h: 20 } });
  a.transform.pos = [x, 0, 0];
  const b = makeFeature('sphere', { name: `${name} ball`, params: { r: 12, seg: 24 } });
  b.transform.pos = [x, 0, 0];
  const c = makeFeature('boolean', { name: `${name} cut`, params: { op: 'intersect' } });
  c.inputs = [a.id, b.id];
  return [a, b, c];
};
doc2.features = [...mk('L', -40), ...mk('R', 40)];
invalidateCache();
const two = await rebuildAsync(doc2);
ok('two independent booleans sit at the same depth, so they can overlap',
  two.parallel.levels === 2 && two.parallel.peak === 2,
  `${two.parallel.levels} levels, peak ${two.parallel.peak}`);
ok('and both produce a body', two.topLevel.length === 2 && two.stats.bodies === 2, `${two.stats.bodies} bodies`);

/* ---- the cache still works across an async rebuild ---- */
const again = await rebuildAsync(doc2);
ok('a second rebuild with no change does no boolean work at all',
  again.parallel.offThread === 0, `${again.parallel.offThread} booleans`);
ok('but still reports the same result', again.stats.bodies === 2 && near(again.stats.volume, two.stats.volume, 1e-6));

/* ---- errors survive the trip ---- */
const bad = newDocument('Bad');
bad.params = [];
const lone = makeFeature('box', { name: 'Lonely', params: { w: 10, d: 10, h: 10 } });
const orphan = makeFeature('boolean', { name: 'Orphan', params: { op: 'subtract' } });
orphan.inputs = [lone.id];
bad.features = [lone, orphan];
invalidateCache();
const badRun = await rebuildAsync(bad);
ok('a boolean with too few inputs reports the same error as the sync path',
  /at least two/.test(badRun.results.get(orphan.id).error || ''),
  badRun.results.get(orphan.id).error);

const empty = newDocument('Empty overlap');
empty.params = [];
const farA = makeFeature('box', { name: 'A', params: { w: 10, d: 10, h: 10 } });
const farB = makeFeature('box', { name: 'B', params: { w: 10, d: 10, h: 10 } });
farB.transform.pos = [500, 0, 0];
const nothing = makeFeature('boolean', { name: 'Nothing', params: { op: 'intersect' } });
nothing.inputs = [farA.id, farB.id];
empty.features = [farA, farB, nothing];
invalidateCache();
const emptyRun = await rebuildAsync(empty);
ok('an intersection of bodies that do not touch is reported, not silently empty',
  /empty body/.test(emptyRun.results.get(nothing.id).error || ''),
  emptyRun.results.get(nothing.id).error);

/* ---- suppression and progress ---- */
const sup = structuredClone({ ...doc2, features: doc2.features.map(f => ({ ...f })) });
sup.features[2].suppressed = true;
invalidateCache();
const supRun = await rebuildAsync(sup);
ok('a suppressed boolean is skipped rather than run',
  supRun.results.get(sup.features[2].id).suppressed === true);
let progress = [];
invalidateCache();
await rebuildAsync(doc2, { onProgress: (a, b) => progress.push(`${a}/${b}`) });
ok('progress is reported once per level', progress.length === 2, progress.join(' '));

/* ---- a document with no booleans needs no workers ---- */
const plain = newDocument('Plain');
plain.params = [];
plain.features = [makeFeature('box', { name: 'B', params: { w: 10, d: 10, h: 10 } })];
invalidateCache();
const plainRun = await rebuildAsync(plain);
ok('a document with no booleans starts no worker work', plainRun.parallel.offThread === 0);
ok('and still builds', plainRun.stats.bodies === 1);

console.log(fails ? `\n${fails} FAILURES` : '\nALL PARALLEL CHECKS PASS');
process.exit(fails ? 1 : 0);
