/**
 * Document hygiene.
 *
 * The far-origin check is arithmetic rather than opinion, so it is checked
 * against the arithmetic: a 32-bit float's step at a given magnitude.
 */
import 'three';
globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.structuredClone ??= (o) => JSON.parse(JSON.stringify(o));

const H = await import('../../src/intel/hygiene.js');
const { store, newDocument, makeFeature } = await import('../../src/core/doc.js');

let fails = 0;
const ok = (name, cond, extra = '') => { if (!cond) fails++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? '  - ' + extra : ''}`); };
const find = (r, id) => r.issues.find(i => i.id === id || i.id.startsWith(id));

/* ---- float32 precision, against the real gaps ---- */
ok('a float32 near 1 mm resolves about 0.12 microns',
  Math.abs(H.precisionAt(1) - 1.1920928955078125e-7) < 1e-12, String(H.precisionAt(1)));
ok('at 10 m the step is about a micron', Math.abs(H.precisionAt(10000) - 0.0009765625) < 1e-9, String(H.precisionAt(10000)));
ok('at 500 km it is 32 mm, which is the whole complaint', H.precisionAt(5e8) === 32, String(H.precisionAt(5e8)));
ok('and the step is the real gap between consecutive floats', (() => {
  // Verify against Float32Array rather than against the formula.
  for (const d of [1000, 65536, 1e6, 1e7]) {
    const a = new Float32Array([d]);
    let up = d;
    // Smallest increment that changes the stored value.
    const step = H.precisionAt(d);
    const b = new Float32Array([d + step]);
    const c = new Float32Array([d + step / 4]);
    if (b[0] === a[0]) return false;        // the step must be representable
    if (c[0] !== a[0] && d > 1000) return false;  // a quarter step must vanish
    void up;
  }
  return true;
})());
ok('the step grows with distance, never shrinks',
  H.precisionAt(1e3) < H.precisionAt(1e5) && H.precisionAt(1e5) < H.precisionAt(1e7));

/* ---- far from origin ---- */
const near = newDocument('Near'); near.params = [];
near.features = [makeFeature('box', { name: 'A', params: { w: 50, d: 50, h: 50 } })];
ok('a model at the origin raises nothing about coordinates', !find(H.inspect(near), 'far-origin'));

const far = newDocument('Far'); far.params = [];
const f1 = makeFeature('box', { name: 'Pad', params: { w: 50, d: 50, h: 50 } });
f1.transform.pos = [412000, 5600000, 0];               // a real-looking grid reference
far.features = [f1];
let r = H.inspect(far);
let issue = find(r, 'far-origin');
ok('survey coordinates are caught', !!issue);
ok('and treated as serious, not a note', issue.severity === 'block', issue.severity);
// 5.6 km out, a float32's step really is half a millimetre, and the report
// must quote that rather than a round number.
ok('the report quotes the true float32 step at that distance',
  /500\.00 µm/.test(issue.detail), issue.detail.slice(0, 190));
ok('and the step it quotes matches the arithmetic',
  Math.abs(H.precisionAt(Math.hypot(412000, 5600000)) - 0.5) < 1e-9,
  String(H.precisionAt(Math.hypot(412000, 5600000))));
ok('and says it is arithmetic rather than a preference', /arithmetic, not a preference/.test(issue.why));

const midway = newDocument('Mid'); midway.params = [];
const f2 = makeFeature('box', { name: 'Pad' });
f2.transform.pos = [20000, 0, 0];
midway.features = [f2];
ok('20 m out is a warning, not a blocker', find(H.inspect(midway), 'far-origin').severity === 'warn');
ok('and it still quotes the step', /µm|mm/.test(find(H.inspect(midway), 'far-origin').detail));

/* ---- the recentre repair ---- */
store.load(structuredClone(far));
find(H.inspect(store.doc), 'far-origin').fix.apply(store);
ok('recentring moves the design to the origin',
  Math.hypot(...store.doc.features[0].transform.pos) < 1, store.doc.features[0].transform.pos.join(','));
ok('and records where it came from, so the site coordinate is not lost',
  /412000/.test(store.doc.meta.notes), store.doc.meta.notes);
ok('it is one undo step', store.depth === 1);
store.undo();
ok('and undo puts the coordinates back', store.doc.features[0].transform.pos[0] === 412000);

/**
 * A boolean's inputs must move too, or the boolean is still computed out at
 * survey coordinates and the precision problem survives the repair. What has
 * to be preserved is the relative position, not the absolute one.
 */
const asm = newDocument('Asm'); asm.params = [];
const base = makeFeature('box', { name: 'Base' });
base.transform.pos = [100000, 0, 0];
const tool = makeFeature('cylinder', { name: 'Tool' });
tool.transform.pos = [100010, 0, 0];
const cut = makeFeature('boolean', { name: 'Cut', params: { op: 'subtract' } });
cut.inputs = [base.id, tool.id];
asm.features = [base, tool, cut];
store.load(asm);
const gap = store.doc.features[1].transform.pos[0] - store.doc.features[0].transform.pos[0];
H.inspect(store.doc).issues.find(i => i.id === 'far-origin').fix.apply(store);
const moved = store.doc.features.map(f => f.transform.pos[0]);
ok('the relative position of a consumed body is preserved exactly',
  moved[1] - moved[0] === gap, `gap ${gap} -> ${moved[1] - moved[0]}`);
ok('and its absolute position comes back to the origin too, so the boolean is computed there',
  moved.every(x => Math.abs(x) < 100), moved.join(','));
ok('which is the whole point: the precision at the new position is usable',
  H.precisionAt(Math.max(...moved.map(Math.abs))) < 1e-5,
  `step ${H.precisionAt(Math.max(...moved.map(Math.abs)))} mm`);

// An expression position is left alone rather than rewritten.
const expr = newDocument('Expr'); expr.params = [];
const ef = makeFeature('box', { name: 'Driven' });
ef.transform.pos = ['offset', 500000, 0];
expr.features = [ef];
store.load(expr);
H.inspect(store.doc).issues.find(i => i.id === 'far-origin').fix.apply(store);
ok('a position written as an expression is not rewritten',
  store.doc.features[0].transform.pos[0] === 'offset', String(store.doc.features[0].transform.pos[0]));
ok('and the note says how many were left alone',
  /expressions/.test(store.doc.meta.notes), store.doc.meta.notes);

/* ---- duplicate payloads ---- */
const dup = newDocument('Dup'); dup.params = [];
const payload = { positions: Array.from({ length: 2700 }, (_, i) => Math.sin(i) * 10) };
const m1 = makeFeature('mesh', { name: 'Scan A' }); m1.data = { positions: [...payload.positions] };
const m2 = makeFeature('mesh', { name: 'Scan B' }); m2.data = { positions: [...payload.positions] };
const m3 = makeFeature('mesh', { name: 'Different' }); m3.data = { positions: payload.positions.map(v => v + 1) };
dup.features = [m1, m2, m3];
r = H.inspect(dup);
const dupIssue = r.issues.find(i => i.id.startsWith('dup-'));
ok('two identical payloads are spotted', !!dupIssue, r.issues.map(i => i.id).join(','));
ok('the finding names both bodies', /Scan A/.test(dupIssue.detail) && /Scan B/.test(dupIssue.detail));
ok('a different payload is not swept in', !/Different/.test(dupIssue.detail));
ok('and it quotes the wasted bytes', /kB of the file/.test(dupIssue.detail), dupIssue.detail.slice(0, 120));
ok('identical payloads hash the same', H.payloadHash(m1.data) === H.payloadHash(m2.data));
ok('and different ones do not', H.payloadHash(m1.data) !== H.payloadHash(m3.data));
ok('an empty payload hashes to nothing rather than colliding',
  H.payloadHash(null) === null && H.payloadHash({ positions: [] }) === null);

store.load(dup);
H.inspect(store.doc).issues.find(i => i.id.startsWith('dup-')).fix.apply(store);
ok('deduplication makes the two share one payload',
  store.doc.features[0].data === store.doc.features[1].data);
ok('and leaves the third alone', store.doc.features[2].data !== store.doc.features[0].data);
ok('while every body keeps its own transform, so nothing moves',
  store.doc.features.every((f, i) => f.transform.pos.join() === dup.features[i].transform.pos.join()));

/* ---- degenerate features ---- */
const bad = newDocument('Bad'); bad.params = [];
const zero = makeFeature('box', { name: 'Flat', params: { w: 50, d: 0, h: 10 } });
const one = makeFeature('patternLinear', { name: 'Pattern', params: { count: 1 } });
one.inputs = [zero.id];
const lonely = makeFeature('boolean', { name: 'Half a cut', params: { op: 'subtract' } });
lonely.inputs = [zero.id];
bad.features = [zero, one, lonely];
r = H.inspect(bad);
ok('a zero dimension is found', !!find(r, 'zero-'), r.issues.map(i => i.id).join(','));
ok('and names which dimension it is', /d is zero/.test(find(r, 'zero-').detail), find(r, 'zero-').detail);
ok('a pattern of one is noted', !!find(r, 'pat1-'));
ok('and only as a note, since it is harmless', find(r, 'pat1-').severity === 'note');
ok('a boolean with one input is flagged', !!find(r, 'bool-'));
ok('an expression parameter is not mistaken for zero', (() => {
  const e = newDocument('E'); e.params = [];
  const f = makeFeature('box', { name: 'Driven', params: { w: 'width', d: 40, h: 10 } });
  e.features = [f];
  return !find(H.inspect(e), 'zero-');
})());

/* ---- weight ---- */
r = H.inspect(dup);
ok('the weight report accounts for the mesh payloads', r.weight.meshBytes > 50000, String(r.weight.meshBytes));
ok('and says what share of the file they are', r.weight.meshShare > 0.9, r.weight.meshShare.toFixed(3));
ok('the heaviest features are listed, largest first',
  r.weight.heaviest.length >= 3 && r.weight.heaviest[0].bytes >= r.weight.heaviest[1].bytes);
ok('a clean document reports itself clean', H.inspect(near).clean);
ok('and the summary says so in one line', /^Clean\./.test(H.summary(H.inspect(near))), H.summary(H.inspect(near)));
ok('a dirty one summarises what is wrong', /worth fixing|serious/.test(H.summary(H.inspect(far))), H.summary(H.inspect(far)));

/* ---- findings are ordered by how much they matter ---- */
const messy = newDocument('Messy'); messy.params = [];
const farBox = makeFeature('box', { name: 'Far' }); farBox.transform.pos = [1e6, 0, 0];
messy.features = [farBox, makeFeature('patternLinear', { name: 'P', params: { count: 1 } })];
r = H.inspect(messy);
ok('the most serious finding comes first', r.issues[0].severity === 'block', r.issues.map(i => i.severity).join(','));

/* ---- degenerate input ---- */
ok('an empty document does not throw', H.inspect(newDocument('Empty')).clean !== undefined);
ok('nor does a document with no features', H.inspect({ features: [], params: [] }).issues.length === 0);
ok('nor one with junk in it', (() => {
  try { H.inspect({ features: [null, { id: 'x' }], params: null }); return true; } catch { return false; }
})());

console.log(fails ? `\n${fails} FAILURES` : '\nALL HYGIENE CHECKS PASS');
process.exit(fails ? 1 : 0);
