/**
 * Cross-section properties, and what they say about strength.
 *
 * "Is this strut strong enough?" is the question designers keep having to leave
 * the application to answer, and the usual response — bolt on finite element
 * analysis — is both enormous and, for the shapes most parts actually are,
 * unnecessary. A beam in bending is governed by the second moment of area of
 * its cross-section, and that is not an estimate: it is an exact property of
 * the geometry, computable in closed form from the section outline.
 *
 * So this slices the body at a plane, recovers the true cross-section, and
 * computes what a structures textbook would: area, centroid, the second moments
 * Ixx / Iyy / Ixy, the principal axes and their moments, section moduli and
 * radii of gyration. Given a load it then reports the bending stress and the
 * utilisation against the material's yield.
 *
 * What this is: exact section properties, and a first-order stress from them.
 * What this is not: FEA. It knows nothing about stress concentrations at a
 * corner, about how the load is actually introduced, about buckling, fatigue,
 * or anything three-dimensional. A section check is what an engineer does on
 * paper before deciding whether the part is worth analysing properly, and that
 * is exactly the role it plays here. Every surface that shows a number from
 * this module says so.
 *
 * The maths: for a closed polygon the moments follow from the same Green's
 * theorem contour integral as the shoelace area, one order higher. Holes are
 * handled by winding — an interior loop runs the other way, so its contribution
 * subtracts itself with no special case anywhere in the code.
 */
import * as THREE from 'three';
import { MATERIALS } from '../core/doc.js';
import { STRENGTH } from './brief.js';

const EPS = 1e-7;

/* --------------------------------------------------------------- slicing */

/**
 * Intersect a triangle mesh with a plane and chain the resulting segments into
 * closed loops, in the plane's own 2D coordinates.
 *
 * @param {THREE.BufferGeometry} geometry
 * @param {THREE.Matrix4|null} matrix
 * @param {THREE.Plane} plane
 * @returns {{ loops: number[][][], u: THREE.Vector3, v: THREE.Vector3, origin: THREE.Vector3 }}
 */
export function sliceToLoops(geometry, matrix, plane) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const pos = g.attributes.position;

  // A 2D frame in the plane. Any pair of orthonormal vectors perpendicular to
  // the normal will do; picking the world axis least aligned with the normal
  // keeps the frame stable and avoids a degenerate cross product.
  const n = plane.normal.clone().normalize();
  const seed = Math.abs(n.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const u = new THREE.Vector3().crossVectors(seed, n).normalize();
  const v = new THREE.Vector3().crossVectors(n, u).normalize();
  const origin = n.clone().multiplyScalar(-plane.constant);

  const segs = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    if (matrix) { a.applyMatrix4(matrix); b.applyMatrix4(matrix); c.applyMatrix4(matrix); }

    const da = plane.distanceToPoint(a);
    const db = plane.distanceToPoint(b);
    const dc = plane.distanceToPoint(c);
    // Wholly on one side: no crossing.
    if ((da > EPS && db > EPS && dc > EPS) || (da < -EPS && db < -EPS && dc < -EPS)) continue;

    const hits = [];
    edgeCross(a, da, b, db, hits);
    edgeCross(b, db, c, dc, hits);
    edgeCross(c, dc, a, da, hits);
    if (hits.length < 2) continue;

    // The winding of the triangle decides the direction of its segment, which
    // is what makes interior loops come out reversed and subtract themselves.
    const p0 = to2D(hits[0], origin, u, v);
    const p1 = to2D(hits[1], origin, u, v);
    const face = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    const along = new THREE.Vector3().subVectors(hits[1], hits[0]);
    const dir = new THREE.Vector3().crossVectors(n, face).dot(along);
    if (dir < 0) segs.push([p1, p0]); else segs.push([p0, p1]);
  }

  return { loops: chain(segs), u, v, origin, normal: n };
}

function edgeCross(p, dp, q, dq, out) {
  if ((dp > EPS && dq > EPS) || (dp < -EPS && dq < -EPS)) return;
  if (Math.abs(dp) <= EPS) { out.push(p.clone()); return; }
  if (Math.abs(dq) <= EPS) { out.push(q.clone()); return; }
  const t = dp / (dp - dq);
  out.push(new THREE.Vector3().lerpVectors(p, q, t));
}

const to2D = (p, origin, u, v) => {
  const d = new THREE.Vector3().subVectors(p, origin);
  return [d.dot(u), d.dot(v)];
};

/**
 * Join loose segments end to end into closed loops.
 *
 * Vertices are snapped to a grid before matching. Slicing produces the same
 * point twice with slightly different floating-point noise from either adjacent
 * triangle, and without the snap every loop breaks into hundreds of fragments.
 */
function chain(segs, tol = 1e-4) {
  const key = (p) => `${Math.round(p[0] / tol)},${Math.round(p[1] / tol)}`;
  const from = new Map();
  for (const s of segs) {
    const k = key(s[0]);
    if (!from.has(k)) from.set(k, []);
    from.get(k).push(s);
  }

  const loops = [];
  const used = new Set();
  for (const seg of segs) {
    if (used.has(seg)) continue;
    const loop = [seg[0]];
    let cur = seg;
    let guard = 0;
    while (cur && !used.has(cur) && guard++ < 100000) {
      used.add(cur);
      loop.push(cur[1]);
      const next = (from.get(key(cur[1])) || []).find(s => !used.has(s));
      if (!next) break;
      cur = next;
      if (key(cur[0]) === key(loop[0])) { /* continue until it closes */ }
      if (loop.length > 2 && key(cur[1]) === key(loop[0])) { used.add(cur); loop.push(cur[1]); break; }
    }
    if (loop.length >= 4) loops.push(loop);
  }
  return loops;
}

/* ---------------------------------------------------- section properties */

/**
 * Second moments of a closed polygon about the origin of its own 2D frame,
 * from the Green's theorem contour integrals. Signed, so a hole subtracts.
 */
function polygonMoments(loop) {
  let a2 = 0, cx = 0, cy = 0, ixx = 0, iyy = 0, ixy = 0;
  for (let i = 0; i < loop.length - 1; i++) {
    const [x0, y0] = loop[i];
    const [x1, y1] = loop[i + 1];
    const cross = x0 * y1 - x1 * y0;
    a2 += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
    ixx += (y0 * y0 + y0 * y1 + y1 * y1) * cross;
    iyy += (x0 * x0 + x0 * x1 + x1 * x1) * cross;
    ixy += (x0 * y1 + 2 * x0 * y0 + 2 * x1 * y1 + x1 * y0) * cross;
  }
  const area = a2 / 2;
  return {
    area,
    cx: a2 === 0 ? 0 : cx / (3 * a2),
    cy: a2 === 0 ? 0 : cy / (3 * a2),
    ixx: ixx / 12,
    iyy: iyy / 12,
    ixy: ixy / 24,
  };
}

/**
 * Full section properties for a body cut at a plane.
 *
 * @param {object} body     { geometry, matrix, feature }
 * @param {THREE.Plane} plane
 * @returns {object|null}   null when the plane misses the body
 */
export function sectionAt(body, plane) {
  const { loops, u, v, origin, normal } = sliceToLoops(body.geometry, body.matrix, plane);
  if (!loops.length) return null;

  let area = 0, sx = 0, sy = 0, ixxO = 0, iyyO = 0, ixyO = 0;
  const parts = [];
  for (const loop of loops) {
    const m = polygonMoments(loop);
    if (Math.abs(m.area) < 1e-9) continue;
    area += m.area;
    sx += m.area * m.cx;
    sy += m.area * m.cy;
    ixxO += m.ixx; iyyO += m.iyy; ixyO += m.ixy;
    parts.push({ area: m.area, loop });
  }
  if (Math.abs(area) < 1e-9) return null;

  // Slicing can hand back the outline in either winding depending on which side
  // of the plane the body's normals face. Flip the whole set so area is
  // positive and holes stay negative relative to it.
  const sign = area < 0 ? -1 : 1;
  area *= sign; sx *= sign; sy *= sign;
  ixxO *= sign; iyyO *= sign; ixyO *= sign;

  const cx = sx / area, cy = sy / area;

  // Parallel-axis shift to the centroid, which is where section moduli mean
  // anything: the moments above are about the frame origin.
  const ixx = ixxO - area * cy * cy;
  const iyy = iyyO - area * cx * cx;
  const ixy = ixyO - area * cx * cy;

  // Principal axes: the rotation that makes the product of inertia vanish.
  const theta = 0.5 * Math.atan2(-2 * ixy, ixx - iyy);
  const avg = (ixx + iyy) / 2;
  const dif = Math.sqrt(((ixx - iyy) / 2) ** 2 + ixy * ixy);
  const i1 = avg + dif;   // strong axis
  const i2 = avg - dif;   // weak axis

  // Extreme fibre distances, measured in the principal frame.
  let c1 = 0, c2 = 0;
  const cos = Math.cos(theta), sin = Math.sin(theta);
  for (const p of parts) {
    for (const [x, y] of p.loop) {
      const dx = x - cx, dy = y - cy;
      c1 = Math.max(c1, Math.abs(-dx * sin + dy * cos));
      c2 = Math.max(c2, Math.abs(dx * cos + dy * sin));
    }
  }

  const holes = parts.filter(p => p.area * sign < 0).length;

  return {
    area,
    holes,
    loops: parts.length,
    centroid2D: [cx, cy],
    centroid: origin.clone().addScaledVector(u, cx).addScaledVector(v, cy),
    ixx, iyy, ixy,
    i1, i2,
    principalAngleDeg: (theta * 180) / Math.PI,
    s1: c1 > 1e-9 ? i1 / c1 : 0,
    s2: c2 > 1e-9 ? i2 / c2 : 0,
    c1, c2,
    r1: Math.sqrt(Math.max(0, i1 / area)),
    r2: Math.sqrt(Math.max(0, i2 / area)),
    frame: { u, v, origin, normal },
    outline: parts.map(p => p.loop),
  };
}

/* ------------------------------------------------------------ the check */

export const LOAD_CASES = {
  cantilever: {
    label: 'Cantilever, load at the tip',
    note: 'Fixed at one end, load at the free end. The worst bending is at the fixed end, which is the section to check.',
    moment: (F, L) => F * L,
  },
  simply: {
    label: 'Simply supported, load at mid-span',
    note: 'Supported at both ends, load in the middle. The worst bending is at mid-span.',
    moment: (F, L) => (F * L) / 4,
  },
  fixedBoth: {
    label: 'Built in at both ends, load at mid-span',
    note: 'Both ends clamped. Stiffer than simply supported, and the worst bending is at the supports.',
    moment: (F, L) => (F * L) / 8,
  },
  axial: {
    label: 'Axial load only',
    note: 'Pure tension or compression along the member. No bending at all.',
    moment: () => 0,
  },
};

/**
 * Bending and axial stress at a section, and the utilisation against yield.
 *
 * @param {object} section   from sectionAt
 * @param {object} load      { case, force, span, material, safety }
 */
export function checkSection(section, { case: kind = 'cantilever', force = 0, span = 100, material = 'aluminium', safety = 2 } = {}) {
  const c = LOAD_CASES[kind] || LOAD_CASES.cantilever;
  const yieldMPa = (STRENGTH[material] || STRENGTH.custom).yield;
  const allow = yieldMPa / Math.max(1, safety);

  const moment = c.moment(force, span);                       // N·mm
  const bending = section.s1 > 1e-9 ? moment / section.s1 : 0; // N/mm² about the strong axis
  const axial = kind === 'axial' && section.area > 0 ? force / section.area : 0;
  const total = Math.abs(bending) + Math.abs(axial);

  // Euler buckling, but only where it is physically meaningful: a member in
  // compression. Reporting a buckling load for a part in tension would be noise.
  const E = YOUNGS[material] ?? 70000;
  const buckling = kind === 'axial' && force < 0
    ? (Math.PI ** 2 * E * section.i2) / (span * span)
    : null;

  return {
    case: c.label,
    note: c.note,
    momentNmm: moment,
    bending, axial, total,
    allow, yieldMPa, safety,
    utilisation: allow > 0 ? total / allow : 0,
    pass: total <= allow,
    bucklingN: buckling,
    material,
    // The one number that turns a stress into a decision.
    verdict: total <= allow
      ? `${((total / allow) * 100).toFixed(0)}% of allowable`
      : `over by ${((total / allow - 1) * 100).toFixed(0)}%`,
  };
}

/** Young's modulus, N/mm². Used only for the buckling estimate. */
const YOUNGS = {
  steel: 200000, stainless: 193000, aluminium: 69000, brass: 100000,
  copper: 117000, titanium: 114000, abs: 2200, pla: 3500, nylon: 2000,
  acrylic: 3200, wood: 9000, concrete: 30000, glass: 70000, rubber: 10,
  custom: 70000,
};

/**
 * Where to cut. The three principal planes through the body's centroid are the
 * sections an engineer would check first, so they are offered by name.
 */
export function standardPlanes(box) {
  const c = box.getCenter(new THREE.Vector3());
  return {
    xy: { label: 'Horizontal (XY)', plane: new THREE.Plane(new THREE.Vector3(0, 0, 1), -c.z) },
    xz: { label: 'Front (XZ)', plane: new THREE.Plane(new THREE.Vector3(0, 1, 0), -c.y) },
    yz: { label: 'Side (YZ)', plane: new THREE.Plane(new THREE.Vector3(1, 0, 0), -c.x) },
  };
}

export { MATERIALS, YOUNGS };
