import * as M from '../../src/intel/merge.js';

let fails = 0;
const ok = (name, cond, extra = '') => { if (!cond) fails++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? '  - ' + extra : ''}`); };

const feat = (id, name, params = {}, over = {}) => ({
  id, type: 'box', name, visible: true, suppressed: false, inputs: [],
  params: { w: 60, d: 40, h: 25, ...params },
  transform: { pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1] },
  appearance: { color: '#888', opacity: 1, metalness: 0.9, roughness: 0.3, wireframe: false },
  material: 'steel', profile: null, data: null, ...over,
});
const docOf = (features, params = [{ id: 'p1', name: 'width', value: 60, note: '' }]) => ({
  schema: 3, meta: { name: 'Part', units: 'mm', author: '', notes: '' },
  params, features,
  draw: { layers: [{ id: 'l1', name: 'Outline', visible: true }], entities: [], activeLayer: 'l1' },
  sim: { bodies: [], gravity: -9810, dt: 1 / 120 },
  view: { grid: true, shading: 'shaded' },
});

/* ---- the case that makes it worth having ---- */
let base = docOf([feat('a', 'Plate'), feat('b', 'Boss', { w: 20 })]);
let ours = structuredClone(base); ours.features[0].params.w = 80;
let theirs = structuredClone(base); theirs.features[1].params.w = 30;
let r = M.mergeDocuments(base, ours, theirs);
ok('different parameters of different features merge with no conflict', r.clean, r.conflicts.map(c => c.label).join('; '));
ok('and both edits survive', r.merged.features[0].params.w === 80 && r.merged.features[1].params.w === 30,
  `${r.merged.features[0].params.w} / ${r.merged.features[1].params.w}`);

/* ---- different parameters of the SAME feature ---- */
ours = structuredClone(base); ours.features[0].params.w = 80;
theirs = structuredClone(base); theirs.features[0].params.h = 40;
r = M.mergeDocuments(base, ours, theirs);
ok('different parameters of the same feature also merge cleanly', r.clean);
ok('keeping both', r.merged.features[0].params.w === 80 && r.merged.features[0].params.h === 40);

/* ---- the same parameter: must conflict, must not average ---- */
ours = structuredClone(base); ours.features[0].params.w = 80;
theirs = structuredClone(base); theirs.features[0].params.w = 100;
r = M.mergeDocuments(base, ours, theirs);
ok('the same parameter changed twice is a conflict', r.conflicts.length === 1 && r.conflicts[0].kind === 'param');
ok('the conflict names the feature and the parameter', r.conflicts[0].label === 'Plate: w', r.conflicts[0].label);
ok('and carries both candidate values', r.conflicts[0].ours === 80 && r.conflicts[0].theirs === 100);
ok('nothing is averaged', r.merged.features[0].params.w === 80, String(r.merged.features[0].params.w));
ok('the theirs policy takes the other side instead',
  M.mergeDocuments(base, ours, theirs, { policy: 'theirs' }).merged.features[0].params.w === 100);
ok('and the conflict is still reported under either policy',
  M.mergeDocuments(base, ours, theirs, { policy: 'theirs' }).conflicts.length === 1);

/* ---- resolving ---- */
let res = M.resolve(r, { [r.conflicts[0].id]: 'theirs' });
ok('resolving to theirs writes their value', res.merged.features[0].params.w === 100);
ok('and the merge reads clean once answered', res.clean && res.open === 0);
res = M.resolve(r, {});
ok('an unanswered conflict keeps the merge dirty', !res.clean && res.open === 1);

/* ---- identical edits are not conflicts ---- */
ours = structuredClone(base); ours.features[0].params.w = 80;
theirs = structuredClone(base); theirs.features[0].params.w = 80;
ok('the same change made on both branches is not a conflict', M.mergeDocuments(base, ours, theirs).clean);

/* ---- adds ---- */
ours = structuredClone(base); ours.features.push(feat('c', 'Rib'));
theirs = structuredClone(base); theirs.features.push(feat('d', 'Hole', {}, { type: 'cylinder' }));
r = M.mergeDocuments(base, ours, theirs);
ok('features added on both branches all arrive', r.merged.features.length === 4, r.merged.features.map(f => f.name).join(', '));
ok('and the merge is clean', r.clean, r.conflicts.map(c => c.label).join('; '));
ok('the stats say where each came from', r.stats.fromOurs === 1 && r.stats.fromTheirs === 1,
  `ours ${r.stats.fromOurs}, theirs ${r.stats.fromTheirs}`);
ok('our additions keep their position relative to the base',
  r.merged.features.slice(0, 2).map(f => f.id).join('') === 'ab');

/* ---- order is preserved, not sorted ---- */
base = docOf([feat('a', 'A'), feat('b', 'B'), feat('c', 'C')]);
ours = structuredClone(base); ours.features.splice(1, 0, feat('x', 'X'));
theirs = structuredClone(base); theirs.features.push(feat('y', 'Y'));
r = M.mergeDocuments(base, ours, theirs);
ok('an insert in the middle and an append both land in the right place',
  r.merged.features.map(f => f.id).join('') === 'axbcy', r.merged.features.map(f => f.id).join(''));
ok('with no conflict', r.clean);

/* both insert at the same point */
ours = structuredClone(base); ours.features.splice(1, 0, feat('x', 'X'));
theirs = structuredClone(base); theirs.features.splice(1, 0, feat('y', 'Y'));
r = M.mergeDocuments(base, ours, theirs);
ok('two different features inserted at the same point compose, not conflict',
  r.clean, r.conflicts.map(c => c.kind).join(','));
ok('neither feature is lost', r.merged.features.length === 5, r.merged.features.map(f => f.id).join(''));
ok('both stay ahead of the feature they were inserted before',
  r.merged.features.map(f => f.id).join('') === 'axybc', r.merged.features.map(f => f.id).join(''));

/* the same features sequenced differently is the one real order conflict */
let seqBase = docOf([feat('a', 'A'), feat('d', 'D')]);
let seqOurs = structuredClone(seqBase); seqOurs.features.splice(1, 0, feat('x', 'X'), feat('y', 'Y'));
let seqTheirs = structuredClone(seqBase); seqTheirs.features.splice(1, 0, feat('y', 'Y'), feat('x', 'X'));
let sr = M.mergeDocuments(seqBase, seqOurs, seqTheirs);
ok('the same features in a different order is an order conflict',
  sr.conflicts.some(c => c.kind === 'order'), sr.conflicts.map(c => c.kind).join(','));
ok('the conflict says what disagreed',
  /same features in a different order/.test(sr.conflicts.find(c => c.kind === 'order').note));
ok('and ours stands so the tree still rebuilds',
  sr.merged.features.map(f => f.id).join('') === 'axyd', sr.merged.features.map(f => f.id).join(''));
const ro = M.reorder(sr, ['a', 'y', 'x', 'd']);
ok('reorder answers the order question', ro.merged.features.map(f => f.id).join('') === 'ayxd');
ok('and reorder never drops a feature', M.reorder(sr, ['d']).merged.features.length === 4);

/* pure reordering on one side only */
ours = structuredClone(base);
ours.features = [ours.features[2], ours.features[0], ours.features[1]];
theirs = structuredClone(base); theirs.features[0].params.w = 90;
r = M.mergeDocuments(base, ours, theirs);
ok('a reorder on one side and an edit on the other merge cleanly', r.clean, r.conflicts.map(c => c.label).join(';'));
ok('the reorder is kept', r.merged.features.map(f => f.id).join('') === 'cab', r.merged.features.map(f => f.id).join(''));
ok('and so is the edit', r.merged.features.find(f => f.id === 'a').params.w === 90);

/* ---- deletes ---- */
base = docOf([feat('a', 'Plate'), feat('b', 'Boss')]);
ours = structuredClone(base); ours.features = ours.features.filter(f => f.id !== 'b');
theirs = structuredClone(base);
r = M.mergeDocuments(base, ours, theirs);
ok('a delete on one side with no edit on the other just deletes', r.clean && r.merged.features.length === 1);
ok('and is counted', r.stats.deleted === 1);

ours = structuredClone(base); ours.features = ours.features.filter(f => f.id !== 'b');
theirs = structuredClone(base); theirs.features[1].params.w = 99;
r = M.mergeDocuments(base, ours, theirs);
ok('delete against edit is a conflict, not a silent drop',
  r.conflicts.length === 1 && r.conflicts[0].kind === 'delete', r.conflicts.map(c => c.kind).join(','));
ok('the conflict explains itself', /deleted this feature while the other edited/.test(r.conflicts[0].note));
ok('and under the ours policy the delete stands', r.merged.features.length === 1);
ok('under theirs, their edited feature is kept',
  M.mergeDocuments(base, ours, theirs, { policy: 'theirs' }).merged.features.length === 2);

ours = structuredClone(base); ours.features = ours.features.filter(f => f.id !== 'b');
theirs = structuredClone(base); theirs.features = theirs.features.filter(f => f.id !== 'b');
ok('both deleting the same feature agree', M.mergeDocuments(base, ours, theirs).clean);
ok('and it is gone', M.mergeDocuments(base, ours, theirs).merged.features.length === 1);

/* ---- transforms merge per axis ---- */
ours = structuredClone(base); ours.features[0].transform.pos = [10, 0, 0];
theirs = structuredClone(base); theirs.features[0].transform.rot = [0, 0, 45];
r = M.mergeDocuments(base, ours, theirs);
ok('a move and a rotate of the same feature merge cleanly', r.clean);
ok('keeping both', r.merged.features[0].transform.pos[0] === 10 && r.merged.features[0].transform.rot[2] === 45);
ours = structuredClone(base); ours.features[0].transform.pos = [10, 0, 0];
theirs = structuredClone(base); theirs.features[0].transform.pos = [0, 10, 0];
r = M.mergeDocuments(base, ours, theirs);
ok('two different positions conflict rather than blending into a third',
  r.conflicts.length === 1 && String(r.merged.features[0].transform.pos) === '10,0,0');

/* ---- appearance is not design intent ---- */
ours = structuredClone(base); ours.features[0].appearance.color = '#f00';
theirs = structuredClone(base); theirs.features[0].appearance.color = '#0f0';
r = M.mergeDocuments(base, ours, theirs);
ok('a colour clash does not stop a merge', r.clean, r.conflicts.map(c => c.label).join(';'));
ok('and ours is kept', r.merged.features[0].appearance.color === '#f00');

/* ---- parameters at document level ---- */
base = docOf([feat('a', 'Plate')], [{ id: 'p1', name: 'width', value: 60, note: '' }]);
ours = structuredClone(base); ours.params.push({ id: 'p2', name: 'thick', value: 5, note: '' });
theirs = structuredClone(base); theirs.params[0].value = 90;
r = M.mergeDocuments(base, ours, theirs);
ok('a new parameter and an edited one merge cleanly', r.clean && r.merged.params.length === 2);
ok('with the edit applied', r.merged.params.find(p => p.name === 'width').value === 90);
ours = structuredClone(base); ours.params[0].value = 70;
theirs = structuredClone(base); theirs.params[0].value = 90;
r = M.mergeDocuments(base, ours, theirs);
ok('the same parameter edited twice conflicts', r.conflicts.length === 1 && r.conflicts[0].label === 'Parameter width');
ok('and resolving it writes into the parameter list',
  M.resolve(r, { [r.conflicts[0].id]: 'theirs' }).merged.params[0].value === 90);
ours = structuredClone(base); ours.params = [];
theirs = structuredClone(base);
ok('a parameter deleted on one side stays deleted', M.mergeDocuments(base, ours, theirs).merged.params.length === 0);
ours = structuredClone(base); ours.params[0].value = 'width * 2';
theirs = structuredClone(base); theirs.params[0].value = 'width * 2';
ok('an identical expression edit is not a conflict', M.mergeDocuments(base, ours, theirs).clean);

/* ---- expressions are treated as values, not parsed ---- */
base = docOf([feat('a', 'Plate', { w: 'width' })]);
ours = structuredClone(base); ours.features[0].params.w = 'width * 2';
theirs = structuredClone(base); theirs.features[0].params.d = 'width / 2';
r = M.mergeDocuments(base, ours, theirs);
ok('expression parameters merge like any other value', r.clean);
ok('and are stored verbatim', r.merged.features[0].params.w === 'width * 2' && r.merged.features[0].params.d === 'width / 2');

/* ---- drafting and configurations ---- */
base = docOf([feat('a', 'Plate')]);
base.draw.entities = [{ id: 'e1', kind: 'line', a: [0, 0], b: [10, 0], layer: 'l1' }];
ours = structuredClone(base); ours.draw.entities.push({ id: 'e2', kind: 'line', a: [10, 0], b: [10, 10], layer: 'l1' });
theirs = structuredClone(base); theirs.draw.layers.push({ id: 'l2', name: 'Dims', visible: true });
r = M.mergeDocuments(base, ours, theirs);
ok('draft entities and layers merge independently',
  r.clean && r.merged.draw.entities.length === 2 && r.merged.draw.layers.length === 2);
base.configs = { list: [{ id: 'k1', name: 'Default', overrides: {} }], active: 'k1' };
ours = structuredClone(base); ours.configs.list.push({ id: 'k2', name: 'Large', overrides: { width: 200 } });
theirs = structuredClone(base); theirs.configs.list.push({ id: 'k3', name: 'Small', overrides: { width: 30 } });
r = M.mergeDocuments(base, ours, theirs);
ok('configurations added on both branches all survive', r.merged.configs.list.length === 3, r.merged.configs.list.map(c => c.name).join(', '));

/* ---- units and metadata ---- */
ours = structuredClone(base); ours.meta.units = 'in';
theirs = structuredClone(base); theirs.meta.units = 'cm';
r = M.mergeDocuments(base, ours, theirs);
ok('a units clash is reported but explained as display only',
  r.conflicts.some(c => c.path === 'meta.units' && /millimetres/.test(c.note)));
ours = structuredClone(base); ours.meta.notes = 'Checked stress';
theirs = structuredClone(base); theirs.meta.name = 'Bracket';
r = M.mergeDocuments(base, ours, theirs);
ok('independent metadata edits merge', r.clean && r.merged.meta.notes === 'Checked stress' && r.merged.meta.name === 'Bracket');
ok('and the merge stamps a new modified time', r.merged.meta.modified !== base.meta.modified);

/* ---- viewport is never a conflict ---- */
ours = structuredClone(base); ours.view.shading = 'wire';
theirs = structuredClone(base); theirs.view.shading = 'xray';
r = M.mergeDocuments(base, ours, theirs);
ok('the viewport never blocks a merge', r.clean && r.merged.view.shading === 'wire');

/* ---- summary and preview ---- */
ours = structuredClone(base); ours.features[0].params.w = 80;
theirs = structuredClone(base); theirs.features[0].params.w = 100;
r = M.mergeDocuments(base, ours, theirs);
const sum = M.mergeSummary(r);
ok('the summary counts conflicts by kind', sum.byKind.param === 1 && !sum.clean, JSON.stringify(sum.byKind));
ok('and reads as a sentence', /1 conflict to answer/.test(sum.headline), sum.headline);
ok('each conflict renders as one line', /here 80, there 100/.test(sum.lines[0]), sum.lines[0]);
theirs = structuredClone(base); theirs.features.push(feat('z', 'Rib'));
ok('a clean merge says what it brought in',
  /1 feature brought in/.test(M.mergeSummary(M.mergeDocuments(base, ours, theirs)).headline),
  M.mergeSummary(M.mergeDocuments(base, ours, theirs)).headline);
ok('preview does not throw on a missing base', M.previewMerge(null, ours, theirs).ok === false);
ok('and reports why', /base/.test(M.previewMerge(null, ours, theirs).headline));

/* ---- common ancestor ---- */
const oursV = [{ id: 'v5' }, { id: 'v4' }, { id: 'v2' }, { id: 'v1' }];
const theirsV = [{ id: 'v9' }, { id: 'v2' }, { id: 'v1' }];
ok('the newest shared snapshot is the merge base', M.commonAncestor(oursV, theirsV).id === 'v2');
ok('unrelated histories have no base', M.commonAncestor([{ id: 'a' }], [{ id: 'b' }]) === null);
ok('and an empty history is handled', M.commonAncestor(null, null) === null);

/* ---- order merge in isolation ---- */
ok('an unchanged order passes through', M.mergeOrder(['a','b','c'], ['a','b','c'], ['a','b','c']).order.join('') === 'abc');
ok('a deletion on one side is honoured', M.mergeOrder(['a','b','c'], ['a','c'], ['a','b','c']).order.join('') === 'ac');
ok('deletions on both sides compose', M.mergeOrder(['a','b','c'], ['a','c'], ['a','b']).order.join('') === 'a');
ok('but the union still carries the deleted id for the caller to ask about',
  M.mergeOrder(['a','b','c'], ['a','c'], ['a','b','c']).union.join('') === 'abc');
ok('and names what was dropped',
  M.mergeOrder(['a','b','c'], ['a','c'], ['a','b']).dropped.join('') === 'bc');
ok('and the order merge never duplicates an id',
  new Set(M.mergeOrder(['a','b'], ['a','x','b'], ['a','x','b']).order).size === M.mergeOrder(['a','b'], ['a','x','b'], ['a','x','b']).order.length);

/* ---- merging a branch twice is a no-op ---- */
base = docOf([feat('a', 'Plate')]);
ours = structuredClone(base);
theirs = structuredClone(base); theirs.features[0].params.w = 80; theirs.features.push(feat('n', 'Rib'));
const first = M.mergeDocuments(base, ours, theirs).merged;
const secondPass = M.mergeDocuments(base, first, theirs).merged;
ok('merging the same branch twice changes nothing the second time',
  JSON.stringify({ ...secondPass, meta: null }) === JSON.stringify({ ...first, meta: null }));

console.log(fails ? `\n${fails} FAILURES` : '\nALL MERGE CHECKS PASS');
process.exit(fails ? 1 : 0);
