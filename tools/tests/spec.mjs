import * as S from '../../src/intel/spec.js';
import { newDocument, makeFeature } from '../../src/core/doc.js';

let fails = 0;
const ok = (name, cond, extra = '') => { if (!cond) fails++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? '  - ' + extra : ''}`); };

/* ---- a real document round trips ---- */
const doc = newDocument('Bracket');
doc.meta.author = 'Sam'; doc.meta.notes = 'Checked for 400N';
doc.params = [
  { id: 'p1', name: 'plate_w', value: 120, note: 'overall width' },
  { id: 'p2', name: 'thick', value: 8, note: '' },
];
const plate = makeFeature('box', { name: 'Plate', material: 'aluminium' });
plate.params = { w: 'plate_w', d: 80, h: 'thick' };
const boss = makeFeature('cylinder', { name: 'Boss' });
boss.params = { r: 20, h: 25, seg: 48, arc: 360 };
boss.transform.pos = [0, 0, 8];
boss.transform.rot = [0, 0, 30];
const cut = makeFeature('boolean', { name: 'Bore' });
cut.params = { op: 'subtract' };
cut.inputs = [plate.id, boss.id];
cut.suppressed = true;
doc.features = [plate, boss, cut];

const { text, lossy } = S.toSpec(doc);
console.log('\n--- generated spec ---\n' + text + '--- end ---\n');
ok('the spec declares its version', text.startsWith('# TesserCAD spec v1'));
ok('the part name is quoted', text.includes('part "Bracket"'));
ok('parameters carry their note as a comment', /param plate_w = 120\s+# overall width/.test(text));
ok('an expression parameter is written unquoted', /w = plate_w$/m.test(text));
ok('features name their type, name and id',
  new RegExp(`feature box "Plate" #${plate.id}`).test(text));
ok('a non-default material is stated', text.includes('material = aluminium'));
ok('a default material is not', !/material = steel/.test(text));
ok('a zero position is omitted', !new RegExp(`#${plate.id}[\\s\\S]*?pos =`).test(text.split('feature cylinder')[0]));
ok('a real position is written', text.includes('pos = 0, 0, 8'));
ok('and a rotation too', text.includes('rot = 0, 0, 30'));
ok('inputs reference features by id', text.includes(`inputs = #${plate.id}, #${boss.id}`));
ok('a suppressed feature says so', /^\s+suppressed$/m.test(text));
ok('nothing in this document is lossy', lossy.length === 0);

const rt = S.roundTrip(doc);
ok('the document survives a round trip through text', rt.ok, rt.differences.slice(0, 3).join(' | '));
ok('with no parse errors', rt.errors.length === 0, rt.errors.map(e => `${e.line}: ${e.message}`).join('; '));
ok('and no defaults quietly filled in', rt.warnings.length === 0, rt.warnings.slice(0,3).map(w => w.message).join('; '));
ok('ids are preserved, so history and merges still line up',
  rt.back.features.map(f => f.id).join(',') === [plate.id, boss.id, cut.id].join(','));
ok('the expression is stored verbatim, not evaluated',
  rt.back.features[0].params.w === 'plate_w', String(rt.back.features[0].params.w));
ok('the suppressed flag round trips', rt.back.features[2].suppressed === true);
ok('and the inputs list round trips', rt.back.features[2].inputs.join(',') === `${plate.id},${boss.id}`);

/* ---- writing the same document twice gives the same text ---- */
ok('the projection is stable', S.toSpec(doc).text === S.toSpec(rt.back).text);

/* ---- text edits reach the model ---- */
let edited = text.replace('param plate_w = 120', 'param plate_w = 180');
let review = S.reviewSpec(edited, doc);
ok('editing a parameter in the text is understood', review.ok, review.summary);
ok('and it lands in the document', review.doc.params.find(p => p.name === 'plate_w').value === 180);
ok('the diff shows one line changed', review.diff.added === 1 && review.diff.removed === 1,
  `+${review.diff.added} -${review.diff.removed}`);
ok('but no feature is reported as changed, because none is', review.summary === 'No change', review.summary);

edited = text.replace(`  r = 20`, `  r = 30`);
review = S.reviewSpec(edited, doc);
ok('editing a feature parameter is reported as a change', review.changed.join(',') === 'Boss', review.summary);
ok('and the parameter really changed', review.doc.features[1].params.r === 30);

edited = text + '\nfeature sphere "Ball"\n  r = 12\n';
review = S.reviewSpec(edited, doc);
ok('adding a feature in text adds it to the model', review.added.join(',') === 'Ball', review.summary);
ok('it lands at the end of the tree', review.doc.features.at(-1).name === 'Ball');
ok('and gets a fresh id', !!review.doc.features.at(-1).id);

// Delete the cylinder block only, leaving the boolean that consumes it.
const blocks = text.split('\n\n');
const trimmed = blocks.filter(b => !b.startsWith('feature cylinder')).join('\n\n');
review = S.reviewSpec(trimmed, doc);
ok('deleting a feature another one consumes is caught before it is applied',
  !review.ok && review.errors.some(e => /which no feature defines/.test(e.message)),
  review.errors.map(e => e.message)[0] || 'no error raised');
ok('and nothing is applied on an error', review.summary.includes('nothing applied'));
// Deleting a leaf feature with nothing pointing at it is fine.
const leafless = blocks.filter(b => !b.startsWith('feature boolean')).join('\n\n');
review = S.reviewSpec(leafless, doc);
ok('deleting a feature nothing depends on just removes it',
  review.ok && review.removed.join(',') === 'Bore', review.summary);

/* ---- error reporting with line numbers ---- */
let bad = S.fromSpec('part "X"\nunits mm\nwibble 3\n');
ok('an unknown keyword is an error with a line number',
  bad.errors.length === 1 && bad.errors[0].line === 3, JSON.stringify(bad.errors[0]));
ok('and explains what was expected', /Expected part, units/.test(bad.errors[0].message));
bad = S.fromSpec('part "X"\nfeature nonsuch "Q"\n');
ok('an unknown feature type is an error', bad.errors[0].message.startsWith('Unknown feature type'));
ok('and lists some real ones', /box/.test(bad.errors[0].message));
bad = S.fromSpec('part "X"\n  w = 10\n');
ok('an orphan indented line is caught', /no feature above it/.test(bad.errors[0].message));
bad = S.fromSpec('part "X"\nfeature box "A"\n  nonsense\n');
ok('a malformed feature line is caught', /Expected "key = value"/.test(bad.errors[0].message));
bad = S.fromSpec('part "X"\nparam 2bad = 5\n');
ok('an unusable parameter name is rejected', /not a usable parameter name/.test(bad.errors[0].message));
bad = S.fromSpec('part "X"\nparam a = 1\nparam a = 2\n');
ok('a duplicate parameter is rejected', /defined twice/.test(bad.errors[0].message));
bad = S.fromSpec('part "X"\nparam a\n');
ok('a parameter with no value is rejected', /needs a value/.test(bad.errors[0].message));
bad = S.fromSpec('part "X"\nfeature box "A" #x1\nfeature box "B" #x1\n');
ok('two features cannot share an id', /share the id/.test(bad.errors[0].message));
bad = S.fromSpec('part "X"\nfeature box "A"\n  pos = 1, 2\n');
ok('a two-component position is rejected', /needs three components/.test(bad.errors[0].message));
let expr = S.fromSpec('part "X"\nparam w = 50\nfeature box "A"\n  w = w\n  d = w * 2\n  h = 5\n  pos = w / 2, 0, 0\n');
ok('an expression in a position is accepted', !!expr.doc && expr.errors.length === 0, JSON.stringify(expr.errors));
ok('and stored verbatim', expr.doc.features[0].transform.pos[0] === 'w / 2', String(expr.doc.features[0].transform.pos[0]));
ok('expressions in transforms round trip', S.roundTrip(expr.doc).ok, S.roundTrip(expr.doc).differences.join(' | '));
expr = S.fromSpec('part "X"\nparam width = 50\nfeature box "A"\n  w = widht\n  d = 5\n  h = 5\n');
ok('a mistyped parameter reference is warned about with the bad name',
  expr.warnings.some(x => /widht/.test(x.message)), expr.warnings.map(x => x.message).join('; '));
ok('but the spec still parses, so the user can fix it in place', !!expr.doc);
expr = S.fromSpec('part "X"\nparam a = b\nparam b = a\n');
ok('a circular parameter is an error naming the parameter',
  expr.errors.some(x => /Parameter "a"/.test(x.message)), expr.errors.map(x => x.message).join('; '));
ok('a material bare word is not mistaken for an expression',
  !S.fromSpec('part "X"\nfeature box "A"\n  w = 5\n  d = 5\n  h = 5\n  material = brass\n').warnings.length);
ok('nor is a boolean op',
  !S.fromSpec('part "X"\nfeature box "A" #a\n  w = 5\n  d = 5\n  h = 5\nfeature boolean "B"\n  op = subtract\n  inputs = #a\n').warnings.length,
  S.fromSpec('part "X"\nfeature box "A" #a\n  w = 5\n  d = 5\n  h = 5\nfeature boolean "B"\n  op = subtract\n  inputs = #a\n').warnings.map(w=>w.message).join(';'));
ok('errors mean no document at all, rather than half of one', bad.doc === null);

/* ---- warnings, not errors ---- */
let warn = S.fromSpec('part "X"\nunits furlongs\nfeature box "A"\n  w = 10\n  d = 10\n  h = 10\n');
ok('an unknown unit warns and keeps mm', warn.doc && warn.doc.meta.units === 'mm' && warn.warnings.some(w => /Unknown unit/.test(w.message)));
warn = S.fromSpec('part "X"\nfeature box "A"\n  w = 10\n  d = 10\n  h = 10\n  material = unobtainium\n');
ok('an unknown material warns and falls back to steel',
  warn.doc.features[0].material === 'steel' && warn.warnings.some(w => /Unknown material/.test(w.message)));
warn = S.fromSpec('part "X"\nfeature box "A"\n  w = 10\n');
ok('an omitted dimension is defaulted but reported', warn.doc && warn.warnings.some(w => /not given, using the default/.test(w.message)),
  warn.warnings.map(w => w.message).join('; '));
ok('and the default is the catalogue value', warn.doc.features[0].params.d === 40);

/* ---- comments and quoting ---- */
let q = S.fromSpec('part "A part, with commas"\nauthor "O\'Brien"\nnotes "Line # one"\n');
ok('a comma inside a quoted name survives', q.doc.meta.name === 'A part, with commas', q.doc.meta.name);
ok('an apostrophe survives', q.doc.meta.author === "O'Brien");
ok('a hash inside a quoted string is not a comment', q.doc.meta.notes === 'Line # one', q.doc.meta.notes);
ok('and quoted strings round trip', S.roundTrip(q.doc).ok, S.roundTrip(q.doc).differences.join('|'));
q = S.fromSpec('part "A"   # the part\nfeature box "B"  # a box\n  w = 5   # five\n  d = 5\n  h = 5\n');
ok('trailing comments are stripped everywhere', q.doc.features[0].params.w === 5 && q.doc.meta.name === 'A');

/* ---- an id reference is not a comment ---- */
q = S.fromSpec('part "A"\nfeature box "B" #b1\n  w = 5\n  d = 5\n  h = 5\nfeature boolean "C" #c1\n  op = subtract\n  inputs = #b1\n');
ok('an id after the feature name is read as an id, not a comment', q.doc && q.doc.features[0].id === 'b1', JSON.stringify(q.errors));
ok('and an id in an inputs list too', q.doc.features[1].inputs.join() === 'b1');

/* ---- mesh payloads are declared, not transcribed ---- */
const meshDoc = newDocument('Scan');
const mesh = makeFeature('mesh', { name: 'Scanned shell' });
mesh.data = { positions: new Array(900).fill(0).map((_, i) => i * 0.1) };
meshDoc.features = [mesh];
const ms = S.toSpec(meshDoc);
ok('a mesh is summarised, not dumped', /mesh 100 triangles/.test(ms.text) && ms.text.length < 2000, `${ms.text.length} bytes`);
ok("the mesh type's own scale parameter is written unambiguously",
  /param scale = 1/.test(ms.text) && !/^\s+scale = 1$/m.test(ms.text), ms.text.split('\n').find(l => /scale/.test(l)));
ok('and the loss is declared', ms.lossy.length === 1 && ms.lossy[0].what === 'mesh', JSON.stringify(ms.lossy[0]));
const mrt = S.roundTrip(meshDoc);
ok('the payload is reattached from the document on the way back', mrt.ok, mrt.differences.join(' | '));
ok('so the triangles are still there', mrt.back.features[0].data.positions.length === 900);
const noBase = S.fromSpec(ms.text);
ok('parsing without the document gives a valid but empty-mesh feature',
  noBase.doc && noBase.doc.features[0].data === null, JSON.stringify(noBase.errors));

/* ---- diff ---- */
let d = S.specDiff('a\nb\nc', 'a\nB\nc');
ok('a one-line edit diffs as one add and one remove', d.added === 1 && d.removed === 1);
ok('and the unchanged lines are marked same', d.rows.filter(r => r.kind === 'same').length === 2);
ok('identical text diffs to nothing', S.specDiff('a\nb', 'a\nb').empty);
d = S.specDiff('a\nb\nc\nd\ne\nf\ng\nh\ni\nj', 'a\nb\nc\nd\ne\nX\ng\nh\ni\nj');
const hs = S.hunks(d, 1);
ok('hunks collapse a long file to the changed region', hs.length === 1 && hs[0].rows.length === 4,
  `${hs.length} hunks, ${hs[0].rows.length} rows`);
ok('a diff of nothing has no hunks', S.hunks(S.specDiff('a', 'a')).length === 0);
d = S.specDiff('', 'a\nb');
ok('an empty before side is all additions', d.removed <= 1 && d.added === 2, `+${d.added} -${d.removed}`);

/* ---- formatting ---- */
const messy = 'part   "A"\nfeature box    "B"\n      w = 5\n      d = 5\n      h = 5\n';
const tidy = S.format(messy);
ok('formatting normalises whitespace', tidy.includes('  w = 5') && !tidy.includes('      w'), JSON.stringify(tidy.split('\n')[3]));
ok('and formatting is idempotent', S.format(tidy) === tidy);
ok('unparseable text is returned untouched rather than destroyed', S.format('wibble') === 'wibble');

/* ---- the example compiles ---- */
const ex = S.fromSpec(S.EXAMPLE);
ok('the worked example parses', !!ex.doc, ex.errors.map(e => `${e.line}: ${e.message}`).join('; '));
ok('it has the features it advertises', ex.doc.features.length === 2 && ex.doc.features[0].name === 'Plate');
ok('and its expressions reference its parameters', ex.doc.features[1].params.r === 'bolt / 2', String(ex.doc.features[1].params.r));
ok('the example round trips too', S.roundTrip(ex.doc).ok, S.roundTrip(ex.doc).differences.join(' | '));

/* ---- degenerate input ---- */
ok('empty text gives an empty part, not a crash',
  (() => { const r = S.fromSpec(''); return r.doc && r.doc.features.length === 0; })());
ok('null text is handled', !!S.fromSpec(null).doc);
ok('an empty document round trips', S.roundTrip(newDocument('Empty')).ok);
ok('blank lines and comment-only lines are ignored',
  S.fromSpec('\n\n# just a note\n\npart "A"\n\n').doc.meta.name === 'A');

console.log(fails ? `\n${fails} FAILURES` : '\nALL SPEC CHECKS PASS');
process.exit(fails ? 1 : 0);
