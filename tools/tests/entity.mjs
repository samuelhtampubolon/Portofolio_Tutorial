/**
 * The 2D entity arithmetic, checked against closed-form answers.
 *
 * This file exists because `draft/entity.js` had no direct tests. It was pure
 * arithmetic buried inside an interactive canvas engine, so the only thing
 * exercising it was a browser suite driving the drafting board, which reaches
 * a few entity kinds by accident and the rest not at all. That is how a split
 * of the file left dangling references in code paths nobody ran.
 *
 * Two kinds of check, and the distinction matters:
 *
 *   Reachability. Every export is called on every entity kind, so a missing
 *   binding is a failure here rather than a ReferenceError in front of a user.
 *   This is cheap and catches the whole class of bug above.
 *
 *   Correctness. A transform is checked against the answer worked out by hand,
 *   and against the algebraic identities it must satisfy: rotating by 360°
 *   returns the original, mirroring twice is the identity, scaling a distance
 *   scales it by the same factor. An identity is worth more than a fixed
 *   expected value, because it holds for every input rather than the one that
 *   was typed.
 */
import {
  fmt, translateEntity, rotateEntity, scaleEntity, mirrorEntity,
  entityPoints, entityBBox, distanceToEntity, offsetEntity,
  nearestOnEntity, segIntersect, pointLineSignedDistance, arcFrom3,
  offsetDistanceFor,
} from '../../src/draft/entity.js';

let fails = 0;
const ok = (name, cond, extra = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? '  - ' + extra : ''}`);
};
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;
const nearPt = (p, q, tol = 1e-9) => p && near(p[0], q[0], tol) && near(p[1], q[1], tol);

/** One of every entity kind the drafting board can hold. */
const SAMPLES = () => [
  { type: 'line', a: [0, 0], b: [10, 0] },
  { type: 'rect', a: [0, 0], b: [20, 10] },
  { type: 'circle', c: [5, 5], r: 4 },
  { type: 'arc', c: [0, 0], r: 6, a0: 0, a1: Math.PI / 2 },
  { type: 'ellipse', c: [1, 2], rx: 5, ry: 3 },
  { type: 'polygon', c: [0, 0], r: 7, n: 6 },
  { type: 'polyline', pts: [[0, 0], [5, 0], [5, 5]], closed: false },
  { type: 'polyline', pts: [[0, 0], [5, 0], [5, 5]], closed: true },
  { type: 'spline', pts: [[0, 0], [3, 4], [8, 1], [12, 6]] },
  { type: 'text', p: [2, 3], text: 'M6', size: 3 },
  { type: 'dim', a: [0, 0], b: [10, 0], off: 4 },
  { type: 'point', p: [1, 1] },
];

/* ===================================================== 1. reachability */

const EXPORTS = [
  ['translateEntity', e => translateEntity(e, 3, -2)],
  ['rotateEntity', e => rotateEntity(e, 0, 0, 40)],
  ['scaleEntity', e => scaleEntity(e, 0, 0, 2)],
  ['mirrorEntity', e => mirrorEntity(e, 'x', 0)],
  ['entityPoints', e => entityPoints(e)],
  ['entityBBox', e => entityBBox(e)],
  ['distanceToEntity', e => distanceToEntity(e, [3, 3])],
  ['offsetEntity', e => offsetEntity(e, 1.5)],
  ['nearestOnEntity', e => nearestOnEntity(e, [3, 3])],
  ['offsetDistanceFor', e => offsetDistanceFor(e, [3, 3])],
];

const unreachable = [];
for (const [name, call] of EXPORTS) {
  for (const e of SAMPLES()) {
    try { call(e); } catch (err) { unreachable.push(`${name}(${e.type}): ${err.message}`); }
  }
}
ok('every export runs on every entity kind without a free identifier',
  unreachable.length === 0, unreachable.slice(0, 4).join(' | '));
console.log(`     ${EXPORTS.length} exports x ${SAMPLES().length} entity kinds`);

/* ===================================== 2. transforms, against closed form */

ok('translate moves a line by exactly the vector given', (() => {
  const e = translateEntity({ type: 'line', a: [0, 0], b: [10, 0] }, 3, -2);
  return nearPt(e.a, [3, -2]) && nearPt(e.b, [13, -2]);
})());

ok('rotating 90° about the origin sends (10, 0) to (0, 10)', (() => {
  const e = rotateEntity({ type: 'line', a: [0, 0], b: [10, 0] }, 0, 0, 90);
  return nearPt(e.b, [0, 10], 1e-12);
})());

ok('rotation is about the given centre, not the origin', (() => {
  const e = rotateEntity({ type: 'line', a: [5, 0], b: [15, 0] }, 5, 0, 90);
  return nearPt(e.a, [5, 0], 1e-12) && nearPt(e.b, [5, 10], 1e-12);
})());

ok('a full turn is the identity, for every entity kind', (() => {
  for (const e of SAMPLES()) {
    const before = JSON.stringify(e);
    const after = rotateEntity(structuredClone(e), 2, 3, 360);
    // A rectangle is promoted to a polyline by any rotation, by design.
    if (e.type === 'rect') continue;
    const pts = entityPoints(after);
    const was = entityPoints(JSON.parse(before));
    if (pts.length !== was.length) return false;
    for (let i = 0; i < pts.length; i++) if (!nearPt(pts[i], was[i], 1e-9)) return false;
  }
  return true;
})());

ok('a rotated rectangle becomes a closed polyline, because it is no longer axis aligned', (() => {
  const e = rotateEntity({ type: 'rect', a: [0, 0], b: [10, 4] }, 0, 0, 30);
  return e.type === 'polyline' && e.closed === true && e.pts.length === 4 &&
    e.a === undefined && e.b === undefined;
})());

ok('and that polyline still has the rectangle’s side lengths', (() => {
  const e = rotateEntity({ type: 'rect', a: [0, 0], b: [10, 4] }, 0, 0, 30);
  const side = (i, j) => Math.hypot(e.pts[j][0] - e.pts[i][0], e.pts[j][1] - e.pts[i][1]);
  return near(side(0, 1), 10, 1e-9) && near(side(1, 2), 4, 1e-9);
})());

ok('scaling multiplies every radius by the factor', (() => {
  const c = scaleEntity({ type: 'circle', c: [2, 2], r: 4 }, 0, 0, 3);
  const el = scaleEntity({ type: 'ellipse', c: [0, 0], rx: 5, ry: 3 }, 0, 0, 3);
  return near(c.r, 12) && near(el.rx, 15) && near(el.ry, 9);
})());

ok('scaling about a point leaves that point fixed', (() => {
  const e = scaleEntity({ type: 'line', a: [4, 4], b: [8, 4] }, 4, 4, 2.5);
  return nearPt(e.a, [4, 4]) && nearPt(e.b, [14, 4]);
})());

ok('mirroring twice about the same axis is the identity', (() => {
  for (const e of SAMPLES()) {
    for (const axis of ['x', 'y']) {
      const was = entityPoints(e);
      const back = entityPoints(mirrorEntity(mirrorEntity(structuredClone(e), axis, 7), axis, 7));
      if (was.length !== back.length) return false;
      for (let i = 0; i < was.length; i++) if (!nearPt(was[i], back[i], 1e-9)) return false;
    }
  }
  return true;
})());

ok('mirroring an arc reverses its sweep rather than leaving it inside out', (() => {
  const e = mirrorEntity({ type: 'arc', c: [0, 0], r: 5, a0: 0, a1: Math.PI / 2 }, 'x', 0);
  // Reflecting in x sends the angle θ to π − θ, so the sweep runs π/2 → π.
  return near(e.a0, Math.PI / 2, 1e-12) && near(e.a1, Math.PI, 1e-12);
})());

/* ======================================== 3. measurement, against geometry */

ok('a circle’s bounding box is its centre plus and minus the radius', (() => {
  const [x1, y1, x2, y2] = entityBBox({ type: 'circle', c: [5, 5], r: 4 });
  // Tessellated at 24 segments, so the box is inscribed rather than exact; the
  // sagitta bounds the error at r(1 − cos(π/24)).
  const tol = 4 * (1 - Math.cos(Math.PI / 24)) + 1e-9;
  return near(x1, 1, tol) && near(y1, 1, tol) && near(x2, 9, tol) && near(y2, 9, tol);
})());

ok('a rectangle’s bounding box is exact', (() => {
  const b = entityBBox({ type: 'rect', a: [3, 1], b: [-2, 7] });
  return b && near(b[0], -2) && near(b[1], 1) && near(b[2], 3) && near(b[3], 7);
})());

ok('distance to a line is perpendicular within the segment',
  near(distanceToEntity({ type: 'line', a: [0, 0], b: [10, 0] }, [5, 3]), 3));
ok('and is the distance to the nearer end beyond it',
  near(distanceToEntity({ type: 'line', a: [0, 0], b: [10, 0] }, [14, 3]), 5));
ok('distance to a circle is measured from the ring, not the centre',
  near(distanceToEntity({ type: 'circle', c: [0, 0], r: 4 }, [10, 0]), 6));
ok('and a point inside the circle is that far from the ring too',
  near(distanceToEntity({ type: 'circle', c: [0, 0], r: 4 }, [1, 0]), 3));

ok('a point off the end of an arc measures to the nearer endpoint, not the ring', (() => {
  const arc = { type: 'arc', c: [0, 0], r: 5, a0: 0, a1: Math.PI / 2 };
  // Directly below the centre is outside the sweep; the nearer end is (5, 0).
  const d = distanceToEntity(arc, [0, -5]);
  return near(d, Math.hypot(5, 5), 1e-9);
})());
ok('while a point within the sweep measures to the ring',
  near(distanceToEntity({ type: 'arc', c: [0, 0], r: 5, a0: 0, a1: Math.PI / 2 }, [10, 10]),
    Math.hypot(10, 10) - 5, 1e-9));

ok('distance scales with the drawing', (() => {
  const e = { type: 'line', a: [0, 0], b: [10, 0] };
  const before = distanceToEntity(e, [5, 3]);
  const after = distanceToEntity(scaleEntity(structuredClone(e), 0, 0, 4), [20, 12]);
  return near(after, before * 4, 1e-9);
})());

ok('the nearest point on a line is the perpendicular foot',
  nearPt(nearestOnEntity({ type: 'line', a: [0, 0], b: [10, 0] }, [4, 9]), [4, 0], 1e-12));
ok('and is clamped to the segment’s end',
  nearPt(nearestOnEntity({ type: 'line', a: [0, 0], b: [10, 0] }, [40, 9]), [10, 0], 1e-12));

/* ============================================== 4. the drafting helpers */

ok('two crossing segments intersect where they cross',
  nearPt(segIntersect([0, 0], [10, 0], [5, -5], [5, 5]), [5, 0], 1e-12));
ok('segments that would cross only if extended do not intersect',
  segIntersect([0, 0], [4, 0], [5, -5], [5, 5]) === null);
ok('parallel segments do not intersect',
  segIntersect([0, 0], [10, 0], [0, 3], [10, 3]) === null);
ok('collinear segments report no single crossing point',
  segIntersect([0, 0], [10, 0], [2, 0], [8, 0]) === null);

ok('signed distance is positive on one side and negative on the other', (() => {
  const above = pointLineSignedDistance([0, 0], [10, 0], [5, 3]);
  const below = pointLineSignedDistance([0, 0], [10, 0], [5, -3]);
  return near(Math.abs(above), 3) && near(Math.abs(below), 3) && Math.sign(above) !== Math.sign(below);
})());
ok('and is zero on the line', near(pointLineSignedDistance([0, 0], [10, 0], [4, 0]), 0));

ok('three points on a circle recover its centre and radius', (() => {
  const a = arcFrom3([5, 0], [0, 5], [-5, 0]);
  return a && nearPt(a.c, [0, 0], 1e-9) && near(a.r, 5, 1e-9);
})());
ok('the recovered arc passes through the middle point it was given', (() => {
  const p2 = [0, 5];
  const a = arcFrom3([5, 0], p2, [-5, 0]);
  return near(Math.hypot(p2[0] - a.c[0], p2[1] - a.c[1]), a.r, 1e-9);
})());
ok('three collinear points define no arc', arcFrom3([0, 0], [5, 0], [10, 0]) === null);

/* ==================================================== 5. offset */

ok('offsetting a circle outward grows the radius by the distance',
  near(offsetEntity({ type: 'circle', c: [0, 0], r: 5 }, 2).r, 7));
ok('offsetting inward shrinks it, and never past zero',
  offsetEntity({ type: 'circle', c: [0, 0], r: 5 }, -50).r > 0);
ok('an offset line stays parallel at the distance asked for', (() => {
  const e = offsetEntity({ type: 'line', a: [0, 0], b: [10, 0] }, 3);
  return near(Math.abs(pointLineSignedDistance([0, 0], [10, 0], e.a)), 3, 1e-9) &&
    near(Math.abs(pointLineSignedDistance([0, 0], [10, 0], e.b)), 3, 1e-9);
})());
ok('a rectangle offset inward past its own size is refused rather than inverted',
  offsetEntity({ type: 'rect', a: [0, 0], b: [10, 4] }, -20) === null);
ok('an offset copy gets its own id, so it is a new entity', (() => {
  const src = { type: 'circle', id: 'e1', c: [0, 0], r: 5 };
  const out = offsetEntity(src, 1);
  return out.id && out.id !== src.id;
})());
ok('and two offsets in a row get different ids, so nothing collides', (() => {
  const src = { type: 'circle', id: 'e1', c: [0, 0], r: 5 };
  return offsetEntity(src, 1).id !== offsetEntity(src, 2).id;
})());

ok('the offset side is signed, so dragging either way picks a direction', (() => {
  const e = { type: 'line', a: [0, 0], b: [10, 0] };
  return Math.sign(offsetDistanceFor(e, [5, 4])) !== Math.sign(offsetDistanceFor(e, [5, -4]));
})());
ok('and outside a circle reads positive, inside negative',
  offsetDistanceFor({ type: 'circle', c: [0, 0], r: 5 }, [9, 0]) > 0 &&
  offsetDistanceFor({ type: 'circle', c: [0, 0], r: 5 }, [1, 0]) < 0);

/* ==================================================== 6. number formatting */

ok('fmt drops trailing zeros rather than printing 10.000', fmt(10) === '10');
ok('fmt keeps precision where it matters', fmt(0.125) === '0.125');
ok('fmt coarsens large values, which no longer need three decimals', fmt(1234.5678) === '1234.6');
ok('fmt reports a non-finite value as a dash rather than NaN', fmt(NaN) === '–' && fmt(Infinity) === '–');
ok('fmt never returns an empty string', fmt(0) === '0' && fmt(-0) === '0');

console.log(fails ? `\n${fails} FAILURES` : '\nALL ENTITY CHECKS PASS');
process.exit(fails ? 1 : 0);
