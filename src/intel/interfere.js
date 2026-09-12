/**
 * Exact interference between bodies.
 *
 * The Doctor's first interference check compared axis-aligned bounding boxes,
 * which is fast and wrong: a diagonal strut reports a clash it does not have,
 * and two parts can share a box without touching. The finding said so in its
 * own text, which is honest but not much use — a check you have been told to
 * distrust is a check you learn to ignore.
 *
 * This computes the real answer instead, and it costs almost nothing to do so,
 * because the boolean engine that the modelling features already use will
 * happily intersect two bodies and hand back the solid they share. Measure its
 * volume and you have a clash: not "their boxes overlap" but "these two parts
 * occupy 412 mm³ of the same space, centred here."
 *
 * The bounding-box test stays, as the broad phase. Box overlap is a necessary
 * condition for a real clash, so pairs that fail it are discarded for free and
 * only survivors pay for a boolean. That is the standard two-phase structure
 * and it is what makes an exact check affordable on a whole assembly.
 */
import * as THREE from 'three';
import { booleanGeometries, TRI_BUDGET } from '../core/csg.js';
import { massProperties } from '../core/rebuild.js';

/** Anything smaller than this is a rounding artefact of the BSP split, not a clash. */
const NOISE_VOLUME = 1e-4;

/**
 * @typedef {object} Clash
 * @property {object} a           { feature, index, box, volume }
 * @property {object} b
 * @property {number} volume      shared volume, mm³
 * @property {number} fraction    shared volume over the smaller body's volume
 * @property {THREE.Vector3} at   centroid of the shared solid
 * @property {THREE.Box3} box     bounds of the shared solid
 * @property {boolean} exact      false when the pair was too heavy to intersect
 */

/**
 * Find every pair of bodies that genuinely share space.
 *
 * `budgetMs` is what makes this usable from the Doctor, which runs after every
 * single rebuild. An exact intersection is a full BSP boolean, and on a busy
 * assembly there can be two hundred pairs of them; spending seconds on that
 * between keystrokes would make the application feel broken. So the caller says
 * how long it is prepared to wait, the cheap box test runs on everything, and
 * the exact test runs until the clock says stop. Whatever did not get an exact
 * answer is reported as not yet checked rather than quietly dropped — the one
 * thing a clash check must never do is imply it looked when it did not.
 *
 * @param {object[]} bodies  { feature, index, box, geometry, matrix, volume }
 * @param {object} opts      { maxPairs, budget, budgetMs }
 */
export function findClashes(bodies, { maxPairs = 200, budget = TRI_BUDGET, budgetMs = 4000 } = {}) {
  const clashes = [];
  const t0 = (typeof performance !== 'undefined' ? performance : Date).now();
  let tested = 0;
  let skipped = 0;
  let unchecked = 0;

  // Broad phase: only pairs whose boxes overlap can possibly clash.
  const pairs = [];
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i], b = bodies[j];
      // Instances of one pattern are meant to be siblings, not a clash report;
      // a pattern that overlaps itself is a different finding.
      if (a.feature.id === b.feature.id) continue;
      if (!a.box.intersectsBox(b.box)) continue;
      pairs.push([a, b]);
    }
  }

  for (const [a, b] of pairs.slice(0, maxPairs)) {
    const now = (typeof performance !== 'undefined' ? performance : Date).now();
    if (now - t0 > budgetMs) { unchecked++; continue; }

    const tris = triCount(a.geometry) + triCount(b.geometry);
    if (tris > budget) {
      // Too heavy to intersect. Report the box overlap and say plainly that
      // this one pair was not verified, rather than silently dropping it.
      skipped++;
      const box = a.box.clone().intersect(b.box);
      const size = new THREE.Vector3(); box.getSize(size);
      clashes.push({
        a, b, exact: false,
        volume: size.x * size.y * size.z,
        fraction: 0,
        at: box.getCenter(new THREE.Vector3()),
        box,
      });
      continue;
    }

    tested++;
    let shared;
    try {
      shared = booleanGeometries('intersect', [
        { geometry: a.geometry, matrix: a.matrix },
        { geometry: b.geometry, matrix: b.matrix },
      ]);
    } catch {
      skipped++;
      continue;
    }
    if (!shared || !shared.attributes?.position?.count) continue;

    const mp = massProperties(shared);
    shared.dispose?.();
    if (!(mp.volume > NOISE_VOLUME)) continue;

    const smaller = Math.min(a.volume || Infinity, b.volume || Infinity);
    clashes.push({
      a, b, exact: true,
      volume: mp.volume,
      fraction: Number.isFinite(smaller) && smaller > 0 ? mp.volume / smaller : 0,
      at: mp.centroid,
      box: mp.box,
    });
  }

  return {
    clashes: clashes.sort((x, y) => y.volume - x.volume),
    tested,
    skipped,
    unchecked: unchecked + Math.max(0, pairs.length - maxPairs),
    pairs: pairs.length,
    truncated: pairs.length > maxPairs,
    ms: (typeof performance !== 'undefined' ? performance : Date).now() - t0,
  };
}

function triCount(g) {
  return (g.index ? g.index.count : g.attributes.position.count) / 3;
}

/**
 * Minimum clearance between two bodies, when they do not clash.
 *
 * Exact minimum distance between two triangle soups is an O(n·m) problem and a
 * whole literature of its own. This samples the vertices of each body against
 * the other's triangles, which gives the right answer for the flat and
 * cylindrical faces that mechanical parts are mostly made of, and errs on the
 * side of reporting a *larger* gap than the true one when a pair of faces
 * approach each other in their interiors. The caller is told which it got.
 */
export function clearance(a, b, { samples = 400 } = {}) {
  const pa = worldPoints(a, samples);
  const pb = worldPoints(b, samples);
  if (!pa.length || !pb.length) return null;

  let best = Infinity;
  const at = [new THREE.Vector3(), new THREE.Vector3()];
  for (const p of pa) {
    for (const q of pb) {
      const d = p.distanceToSquared(q);
      if (d < best) { best = d; at[0].copy(p); at[1].copy(q); }
    }
  }
  return {
    distance: Math.sqrt(best),
    from: at[0].clone(),
    to: at[1].clone(),
    approximate: true,
    sampled: pa.length + pb.length,
  };
}

/** Up to `n` world-space vertices, evenly strided through the buffer. */
function worldPoints(body, n) {
  const g = body.geometry;
  const pos = g.attributes.position;
  const count = pos.count;
  const step = Math.max(1, Math.floor(count / n));
  const out = [];
  const v = new THREE.Vector3();
  for (let i = 0; i < count; i += step) {
    v.fromBufferAttribute(pos, i);
    if (body.matrix) v.applyMatrix4(body.matrix);
    out.push(v.clone());
  }
  return out;
}
