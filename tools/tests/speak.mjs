/**
 * The command grammar.
 *
 * Two things need proving. It reads what an engineer would actually type, to
 * exact numbers rather than approximately. And it refuses what it does not
 * understand instead of guessing, because a co-pilot that quietly builds the
 * wrong part costs more than one that says it did not follow you.
 */
import 'three';
globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.structuredClone ??= (o) => JSON.parse(JSON.stringify(o));

const S = await import('../../src/intel/speak.js');
const { newDocument } = await import('../../src/core/doc.js');
const { buildScope, evaluate } = await import('../../src/core/expr.js');

let fails = 0;
const ok = (name, cond, extra = '') => { if (!cond) fails++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? '  - ' + extra : ''}`); };
const P = (t) => S.interpret(t);
const first = (r) => r.features[0];

/* ---- shapes and dimensions ---- */
let r = P('a 120 by 80 plate 8 thick');
ok('a three-dimension plate reads all three', first(r).type === 'plate' &&
  first(r).params.w === 120 && first(r).params.d === 80 && first(r).params.h === 8,
  JSON.stringify(first(r).params));
ok('"x" between dimensions works as well as "by"', (() => {
  const p = first(P('box 200 x 20 x 10')).params;
  return p.w === 200 && p.d === 20 && p.h === 10;
})(), JSON.stringify(first(P('box 200 x 20 x 10')).params));
ok('and "×" does too', first(P('box 30 × 40 × 50')).params.d === 40);
ok('nothing is reported as ignored for a clean sentence', P('box 200 x 20 x 10').unknown.length === 0,
  P('box 200 x 20 x 10').unknown.join(','));

ok('a diameter is halved into a radius', first(P('cylinder 30 diameter 60 long')).params.r === 15);
ok('a radius is not', first(P('sphere radius 18')).params.r === 18);
ok('a bare number before a round shape is a diameter, not a radius',
  first(P('a 20 rod 100 long')).params.r === 10, String(first(P('a 20 rod 100 long')).params.r));
ok('but a box is never reinterpreted that way', first(P('a 20 box')).params.w === 20);

/* ---- units ---- */
ok('inches convert exactly', first(P('a 2 inch shaft')).params.r === 25.4, String(first(P('a 2 inch shaft')).params.r));
ok('and do not leave floating point noise behind',
  first(P('cylinder 3 inches long')).params.h === 76.2, String(first(P('cylinder 3 inches long')).params.h));
ok('centimetres convert', first(P('a 5 cm ball')).params.r === 25);
ok('metres convert', first(P('a bar 2 m by 100 by 50')).params.w === 2000);
ok('feet convert', first(P('a 1 foot rod')).params.r === 152.4, String(first(P('a 1 foot rod')).params.r));
ok('a bare number is millimetres, since that is what the engine stores',
  first(P('a 40 ball')).params.r === 20);

/* ---- thread callouts are exact standard values ---- */
r = P('an M6 clearance hole');
ok('M6 clearance is 6.6 mm, from the standard', r.plan.thread.dia === 6.6, String(r.plan.thread.dia));
ok('M8 clearance is 9', P('M8 clearance hole').plan.thread.dia === 9);
ok('M10 clearance is 11', P('M10 clearance hole').plan.thread.dia === 11);
ok('a tapped hole uses the tapping drill instead',
  P('an M8 tapped hole').plan.thread.dia === 6.8, String(P('an M8 tapped hole').plan.thread.dia));
ok('M6 tapping drill is 5', P('M6 tapped hole').plan.thread.dia === 5);
ok('a thread size that is not in the standard is not invented',
  P('an M7 clearance hole').plan.thread === undefined || P('an M7 clearance hole').plan.thread === null);

/* ---- the hole diameter arrives as a named parameter, not a bare number ---- */
r = P('4 M6 clearance holes 40 apart');
ok('the hole radius is an expression referencing a parameter',
  typeof first(r).params.r === 'string' && /clear_m6/.test(first(r).params.r), String(first(r).params.r));
ok('and the parameter is declared with the value the standard gives',
  r.params.some(p => p.name === 'clear_m6' && p.value === 6.6), JSON.stringify(r.params));
ok('the parameter carries the standard it came from',
  /ISO 273/.test(r.params.find(p => p.name === 'clear_m6').note));
// Evaluated with the application's own parser, not with Function(): building a
// second evaluator in a test proves nothing about the first, and this project
// does not execute strings as code anywhere.
ok('so the expression actually evaluates against it', (() => {
  const { scope } = buildScope(r.params.map((p, i) => ({ id: `p${i}`, ...p })));
  return Math.abs(evaluate(first(r).params.r, scope) - 3.3) < 1e-9;
})());
ok('and it says why that matters', r.notes.some(n => /changing the bolt size/.test(n)));

/* ---- counts become patterns, not copies ---- */
ok('a count is read from before its noun, across words in between', r.plan.count === 4, String(r.plan.count));
ok('"40 apart" is the spacing, not the count', r.plan.spacing === 40, String(r.plan.spacing));
ok('four holes become one hole plus a pattern, which stays editable',
  r.features.length === 2 && r.features[1].type === 'patternLinear', r.features.map(f => f.type).join('+'));
ok('the pattern carries the count and the spacing',
  r.features[1].params.count === 4 && r.features[1].params.dx === 40, JSON.stringify(r.features[1].params));
ok('and the pattern consumes the hole', r.features[1].inputs[0] === first(r).id);

r = P('6 M8 tapped holes in a circle');
ok('"in a circle" gives a circular pattern instead',
  r.features[1].type === 'patternCircular' && r.features[1].params.count === 6, r.features.map(f => f.type).join('+'));
ok('named numbers work too', P('four M6 holes').plan.count === 4);
ok('a sides count goes to the shape, not to a pattern', (() => {
  const p = P('a prism with 8 sides 30 across');
  return p.features.length === 1 && first(p).params.sides === 8;
})(), JSON.stringify(first(P('a prism with 8 sides 30 across')).params));

/* ---- cuts ---- */
r = P('an M6 hole');
ok('a hole is a cut, not a body', r.plan.kind === 'cut');
ok('with nothing selected it says so rather than failing',
  r.notes.some(n => /Nothing was selected/.test(n)), r.notes.join(' | '));
r = S.interpret('an M6 hole', { target: 'someFeatureId' });
ok('with something selected it emits the subtract for you',
  r.features.at(-1).type === 'boolean' && r.features.at(-1).params.op === 'subtract');
ok('and the boolean consumes the target and the hole',
  r.features.at(-1).inputs[0] === 'someFeatureId' && r.features.at(-1).inputs.length === 2,
  JSON.stringify(r.features.at(-1).inputs));
ok('a hole with no depth is given one, and says so',
  first(r).params.h === 60 && r.notes.some(n => /No depth given/.test(n)));
ok('but a stated depth is used', first(P('an M6 hole 12 deep')).params.h === 12);

/* ---- materials ---- */
ok('a named material is applied', first(P('a steel bar 100 by 20 by 10')).material === 'steel');
ok('and another one', first(P('a 120 by 80 aluminium plate 8 thick')).material === 'aluminium');
ok('an unnamed material leaves the default', first(P('a bar 100 by 20 by 10')).material === 'steel');

/* ---- tubes ---- */
r = P('a tube 40 across with a 3 wall, 50 long');
ok('a wall thickness becomes an inner radius', first(r).params.ro === 20 && first(r).params.ri === 17,
  JSON.stringify(first(r).params));
ok('and the length is separate from the wall', first(r).params.h === 50);

/* ---- refusal ---- */
r = P('please make it nicer');
ok('a sentence with no shape in it is refused', !r.ok);
ok('and the refusal explains that this is a vocabulary, not English',
  /vocabulary rather than English/.test(r.why), r.why);
ok('it lists what it does know', /cylinder/.test(r.why));
ok('a refusal produces no features at all', r.features.length === 0);
ok('empty input is refused without throwing', !P('').ok && !P(null).ok);
ok('gibberish is refused', !P('asdf qwer zxcv').ok);

/* ---- the readback names every fact taken ---- */
r = P('a 120 by 80 aluminium plate 8 thick');
ok('the readback names the shape', r.understood[0] === 'add a rounded plate', r.understood[0]);
ok('it names the dimensions', r.understood.some(u => /120 by 80/.test(u)), r.understood.join(' | '));
ok('it names the thickness', r.understood.some(u => /8 mm thick/.test(u)));
ok('and the material', r.understood.some(u => /Aluminium/.test(u)));

/* ---- unknown words are surfaced, not swallowed ---- */
r = P('a 60 box with chamfered corners and a knurled finish');
ok('words it cannot act on are reported rather than dropped silently',
  r.unknown.includes('chamfered') && r.unknown.includes('knurled'), r.unknown.join(','));
ok('while it still builds the part it did understand', r.ok && first(r).params.w === 60);
ok('common filler words are not reported as unknown',
  !P('please add a 60 box for me').unknown.length, P('please add a 60 box for me').unknown.join(','));

/* ---- parameters are not redeclared over an existing document ---- */
const doc = newDocument('X');
doc.params = [{ id: 'p1', name: 'clear_m6', value: 6.6, note: 'mine' }];
r = S.interpret('2 M6 holes', { doc });
ok('a parameter the document already has is referenced, not redeclared',
  r.params.length === 0 && /clear_m6/.test(String(first(r).params.r)), JSON.stringify(r.params));

/* ---- every published example parses ---- */
const broken = S.EXAMPLES.filter(e => !S.interpret(e).ok);
ok('every worked example parses', broken.length === 0, broken.join(' | '));
const noisy = S.EXAMPLES.filter(e => S.interpret(e).unknown.length);
ok('and none of them leaves a word unaccounted for', noisy.length === 0,
  noisy.map(e => `${e} -> ${S.interpret(e).unknown.join(',')}`).join(' | '));
ok('every example produces at least one real catalogue feature',
  S.EXAMPLES.every(e => S.interpret(e).features.length > 0));

console.log(fails ? `\n${fails} FAILURES` : '\nALL GRAMMAR CHECKS PASS');
process.exit(fails ? 1 : 0);
