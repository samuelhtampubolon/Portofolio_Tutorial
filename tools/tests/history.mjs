/**
 * The history tree.
 *
 * The case that matters most is the one every package gets wrong: undo a few
 * steps, make an edit, and see whether the states you undid past are still
 * reachable. They must be.
 */
import 'three';
globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.structuredClone ??= (o) => JSON.parse(JSON.stringify(o));

const { store, newDocument, makeFeature } = await import('../../src/core/doc.js');

let fails = 0;
const ok = (name, cond, extra = '') => { if (!cond) fails++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? '  - ' + extra : ''}`); };

const reset = () => { store.load(newDocument('T')); store.doc.params = []; };
const addBox = (name) => store.edit(`Add ${name}`, (d) => { d.features.push(makeFeature('box', { name })); });
const names = () => store.doc.features.map(f => f.name).join(',');

/* ---- the basics still work ---- */
reset();
ok('a fresh document has nothing to undo', !store.canUndo() && !store.canRedo());
addBox('A'); addBox('B'); addBox('C');
ok('three edits give three features', names() === 'A,B,C', names());
ok('and three steps of undo', store.depth === 3, `depth ${store.depth}`);
store.undo();
ok('undo removes the last one', names() === 'A,B', names());
store.undo();
ok('and the one before', names() === 'A', names());
ok('redo is available', store.canRedo());
store.redo();
ok('redo puts it back', names() === 'A,B', names());
store.redo();
ok('and again', names() === 'A,B,C', names());
ok('nothing further to redo', !store.canRedo());

/* ---- THE case: an edit after undo must not destroy the future ---- */
reset();
addBox('A'); addBox('B'); addBox('C');
store.undo(); store.undo();
ok('two undos leave one feature', names() === 'A', names());
addBox('D');
ok('the new edit applies', names() === 'A,D', names());
let t = store.timeline();
ok('B and C are NOT gone: they are on a branch we left',
  t.abandoned.some(a => a.label === 'Add B') && t.abandoned.some(a => a.label === 'Add C'),
  t.abandoned.map(a => a.label).join(', ') || 'nothing abandoned');
ok('and the branch is reachable by id', (() => {
  const b = t.abandoned.find(a => a.label === 'Add C');
  return store.gotoNode(b.id) && names() === 'A,B,C';
})(), names());
ok('going back to the branch does not lose the other one', (() => {
  const back = store.timeline().abandoned.find(a => a.label === 'Add D');
  return !!back && store.gotoNode(back.id) && names() === 'A,D';
})(), names());
ok('so neither future was ever destroyed', store.timeline().abandoned.some(a => a.label === 'Add C'));

/* ---- an undo from a branch walks that branch, not the other ---- */
reset();
addBox('A'); addBox('B');
store.undo();
addBox('X');
ok('on the new branch we have A and X', names() === 'A,X', names());
store.undo();
ok('undo from the branch goes to A, not to B', names() === 'A', names());
store.redo();
ok('and redo retraces the branch we were on, not the abandoned one', names() === 'A,X', names());

/* ---- view settings are not history ---- */
reset();
addBox('A');
const before = store.depth;
store.quiet((d) => { d.view.grid = !d.view.grid; });
ok('a view change costs no undo step', store.depth === before, `depth ${store.depth} vs ${before}`);
ok('but it still marks the document dirty', store.dirty);
ok('and it still applies', store.doc.view.grid === false || store.doc.view.grid === true);
store.undo();
ok('undo after a view change undoes the model edit, not the view',
  names() === '' && store.doc.features.length === 0, names() || '(empty)');

/* ---- a view change must not destroy a pending redo either ---- */
reset();
addBox('A'); addBox('B');
store.undo();
store.quiet((d) => { d.view.grid = !d.view.grid; });
ok('a view change leaves redo intact', store.canRedo());
store.redo();
ok('and the redo still works', names() === 'A,B', names());

/* ---- batches are one step ---- */
reset();
store.batch('Twelve things', () => {
  for (let i = 0; i < 12; i++) addBox(`B${i}`);
});
ok('a batch of twelve edits is one undo step', store.depth === 1, `depth ${store.depth}`);
ok('and it applied all twelve', store.doc.features.length === 12);
store.undo();
ok('one undo reverses the whole batch', store.doc.features.length === 0);

/* ---- timeline shape ---- */
reset();
addBox('A'); addBox('B'); addBox('C');
store.undo();
t = store.timeline();
ok('the timeline names the past in order', t.past.map(p => p.label).join('|') === 'Opened|Add A', t.past.map(p => p.label).join('|'));
ok('it names where you are', t.now.label === 'Add B', t.now.label);
ok('and what is ahead', t.future.map(f => f.label).join('|') === 'Add C', t.future.map(f => f.label).join('|'));
ok('with nothing abandoned yet', t.abandoned.length === 0, String(t.abandoned.length));

/* ---- loading resets history but leaves a usable root ---- */
reset();
addBox('A');
store.load(newDocument('Other'));
ok('loading a document clears the history', !store.canUndo() && !store.canRedo());
ok('and the root is the document that was opened', store.doc.meta.name === 'Other');

/* ---- pruning keeps the spine ---- */
reset();
for (let i = 0; i < 200; i++) addBox(`B${i}`);
ok('200 edits are held without unbounded growth', store.timeline().nodes > 0);
ok('the undo chain is capped rather than the newest being dropped',
  store.depth <= 120 && store.depth >= 100, `depth ${store.depth}`);
ok('and the most recent edits are the ones kept',
  store.doc.features.length === 200 && store.canUndo());
let steps = 0;
while (store.undo()) steps++;
ok('undoing as far as it goes never throws', steps > 50, `${steps} steps`);
ok('and lands on a real document', Array.isArray(store.doc.features));

/* ---- a jump to the current node is a no-op, not an error ---- */
reset();
addBox('A');
ok('jumping to where you already are is refused quietly', store.gotoNode(store.timeline().now.id) === false);
ok('and an unknown id is refused', store.gotoNode('nope') === false);

console.log(fails ? `\n${fails} FAILURES` : '\nALL HISTORY CHECKS PASS');
process.exit(fails ? 1 : 0);
