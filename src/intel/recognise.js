/**
 * Reading an imported mesh.
 *
 * A supplier sends an STL. It arrives as eighty thousand triangles with no
 * feature tree, no parameters and no names, and the job is to move one hole
 * five millimetres. Today that means redrawing the part.
 *
 * Full feature recognition — reconstructing the modelling operations that
 * produced a solid — is a research problem, and a shallow version of it would
 * be worse than none. That is still true of *reconstruction*. It is not true of
 * *measurement*, and measurement is most of what the job needs: find the flat
 * faces, find the holes, say exactly where they are and how big, and let a
 * parametric cut be placed on one.
 *
 * The method is surface segmentation, not boundary fitting.
 *
 *   Triangles are grouped into patches by walking across edges whose two faces
 *   meet at a shallow angle. A tessellated cylinder is one patch of 48 facets;
 *   the flat face it is drilled into is a different patch, because the edge
 *   between them turns through ninety degrees.
 *
 *   A patch whose normals all agree is a plane. A patch whose normals all lie
 *   perpendicular to a common direction is a cylinder, and that direction is
 *   its axis — recovered as the smallest eigenvector of the normal covariance,
 *   so a hole drilled at an angle is found as readily as one down Z.
 *
 *   A cylinder is a hole when its facets face inwards, a boss when they face
 *   out. The radius is the mean distance of its vertices from the axis, and how
 *   tightly they cluster around that mean becomes a confidence figure that is
 *   reported rather than hidden.
 *
 * An earlier version of this file fitted circles to boundary loops instead, and
 * a test caught it claiming that the rectangular side facets of a cylinder wall
 * were holes. They were: a rectangle's four corners really are equidistant from
 * its centre. Equidistance alone does not make a circle, which is why the
 * measurement now comes from the surface rather than from its outline.
 *
 * What this still does not do: recover fillets as fillets, infer the sketch
 * that was extruded, or rebuild a feature tree. Those need the research problem
 * solved, and pretending otherwise puts confident wrong numbers in front of
 * someone about to cut metal.
 */
import * as THREE from 'three';

const DEG = Math.PI / 180;

/**
 * Analyse a mesh.
 *
 * @param {THREE.BufferGeometry} geometry
 * @param {THREE.Matrix4|null} matrix
 * @param {object} opts
 */
export function recognise(geometry, matrix = null, {
  smoothAngle = 25,     // degrees; an edge sharper than this ends a patch
  planeSpread = 1.5,    // degrees; a patch this flat is a plane
  minArea = 0.5,        // mm²
  minRoundness = 0.985,
  maxTriangles = 200000,
} = {}) {
  const tris = readTriangles(geometry, matrix);
  if (tris.length > maxTriangles) {
    return {
      faces: [], holes: [], bosses: [], patches: 0, triangles: tris.length, truncated: true,
      reason: `${Math.round(tris.length / 1000)}k triangles is past the ${maxTriangles / 1000}k analysis limit.`,
    };
  }

  const patches = segment(tris, smoothAngle);
  const faces = [];
  const cylinders = [];

  for (const p of patches) {
    const area = p.reduce((s, t) => s + t.area, 0);
    if (area < minArea) continue;
    const spread = normalSpread(p);
    if (spread <= planeSpread * DEG) { faces.push(describePlane(p, area)); continue; }
    const cyl = describeCylinder(p, area);
    if (cyl && cyl.roundness >= minRoundness) cylinders.push(cyl);
  }

  cylinders.sort((a, b) => b.diameter - a.diameter);
  // The boolean engine leaves T-junctions, so one flat face arrives as several
  // patches that are coplanar but not edge-connected. To a user that is still
  // one face, and merging on the plane itself is what makes the count match
  // what they can see.
  const merged = mergeCoplanar(faces).sort((a, b) => b.area - a.area);

  return {
    faces: merged,
    holes: cylinders.filter(c => c.concave),
    bosses: cylinders.filter(c => !c.concave),
    cylinders,
    patches: patches.length,
    triangles: tris.length,
    planarArea: merged.reduce((s, f) => s + f.area, 0),
    truncated: false,
  };
}

/* ------------------------------------------------------------- triangles */

function readTriangles(geometry, matrix) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const pos = g.attributes.position;
  const out = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    if (matrix) { a.applyMatrix4(matrix); b.applyMatrix4(matrix); c.applyMatrix4(matrix); }
    const cross = new THREE.Vector3()
      .subVectors(b, a)
      .cross(new THREE.Vector3().subVectors(c, a));
    const area = cross.length() / 2;
    if (area < 1e-10) continue;
    out.push({ v: [a.clone(), b.clone(), c.clone()], n: cross.divideScalar(area * 2), area });
  }
  return out;
}

/* ---------------------------------------------------------- segmentation */

/**
 * Grow patches across edges that are not creases.
 *
 * Adjacency is by shared edge, keyed on snapped vertex positions: the boolean
 * engine emits every triangle independently, so two faces of one surface share
 * a position rather than an index.
 */
function segment(tris, smoothAngleDeg, tol = 1e-4) {
  const cosLimit = Math.cos(smoothAngleDeg * DEG);
  const key = (v) => `${Math.round(v.x / tol)},${Math.round(v.y / tol)},${Math.round(v.z / tol)}`;

  const byEdge = new Map();
  tris.forEach((t, i) => {
    for (let e = 0; e < 3; e++) {
      const p = key(t.v[e]), q = key(t.v[(e + 1) % 3]);
      const k = p < q ? `${p}|${q}` : `${q}|${p}`;
      if (!byEdge.has(k)) byEdge.set(k, []);
      byEdge.get(k).push(i);
    }
  });

  const seen = new Uint8Array(tris.length);
  const out = [];
  for (let i = 0; i < tris.length; i++) {
    if (seen[i]) continue;
    const stack = [i];
    const patch = [];
    seen[i] = 1;
    while (stack.length) {
      const j = stack.pop();
      patch.push(tris[j]);
      for (let e = 0; e < 3; e++) {
        const p = key(tris[j].v[e]), q = key(tris[j].v[(e + 1) % 3]);
        const k = p < q ? `${p}|${q}` : `${q}|${p}`;
        for (const m of byEdge.get(k) || []) {
          if (seen[m]) continue;
          // A crease ends the patch. This is the whole of the segmentation.
          if (tris[j].n.dot(tris[m].n) < cosLimit) continue;
          seen[m] = 1;
          stack.push(m);
        }
      }
    }
    out.push(patch);
  }
  return out;
}

/** The angular spread of a patch's normals, in radians. */
function normalSpread(patch) {
  const mean = new THREE.Vector3();
  for (const t of patch) mean.addScaledVector(t.n, t.area);
  if (mean.lengthSq() < 1e-12) return Math.PI;
  mean.normalize();
  let max = 0;
  for (const t of patch) max = Math.max(max, Math.acos(clamp(t.n.dot(mean), -1, 1)));
  return max;
}

/* ------------------------------------------------------------- planes */

function describePlane(patch, area) {
  const n = new THREE.Vector3();
  for (const t of patch) n.addScaledVector(t.n, t.area);
  n.normalize();

  const centre = new THREE.Vector3();
  const box = new THREE.Box3();
  for (const t of patch) {
    const mid = t.v[0].clone().add(t.v[1]).add(t.v[2]).divideScalar(3);
    centre.addScaledVector(mid, t.area);
    for (const v of t.v) box.expandByPoint(v);
  }
  centre.divideScalar(area);

  return {
    kind: 'plane',
    normal: n,
    offset: n.dot(patch[0].v[0]),
    area,
    triangles: patch.length,
    centre,
    box,
    axis: dominantAxis(n),
  };
}

/** Fold patches that share a plane into one face. */
function mergeCoplanar(faces, angleTol = 1.5, offsetTol = 0.02) {
  const cosTol = Math.cos(angleTol * DEG);
  const groups = [];
  for (const f of faces) {
    const home = groups.find(g =>
      g.normal.dot(f.normal) >= cosTol && Math.abs(g.offset - f.offset) <= offsetTol);
    if (home) home.members.push(f);
    else groups.push({ normal: f.normal.clone(), offset: f.offset, members: [f] });
  }
  return groups.map((g) => {
    if (g.members.length === 1) return g.members[0];
    const area = g.members.reduce((s, m) => s + m.area, 0);
    const centre = new THREE.Vector3();
    const box = new THREE.Box3();
    for (const m of g.members) {
      centre.addScaledVector(m.centre, m.area);
      box.union(m.box);
    }
    centre.divideScalar(area);
    return {
      kind: 'plane',
      normal: g.normal,
      offset: g.offset,
      area,
      triangles: g.members.reduce((s, m) => s + m.triangles, 0),
      patches: g.members.length,
      centre,
      box,
      axis: dominantAxis(g.normal),
    };
  });
}

/* ---------------------------------------------------------- cylinders */

/**
 * Fit a cylinder to a patch.
 *
 * Every normal of a cylinder is perpendicular to its axis, so the axis is the
 * direction that the normals least occupy: the eigenvector of the smallest
 * eigenvalue of the normal covariance. Inverse power iteration on that matrix
 * finds it in a handful of passes and needs no eigensolver.
 */
function describeCylinder(patch, area) {
  const M = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const t of patch) {
    const { x, y, z } = t.n;
    const w = t.area;
    M[0] += x * x * w; M[1] += x * y * w; M[2] += x * z * w;
    M[3] += x * y * w; M[4] += y * y * w; M[5] += y * z * w;
    M[6] += x * z * w; M[7] += y * z * w; M[8] += z * z * w;
  }
  const axis = smallestEigenvector(M);
  if (!axis) return null;

  // Project every vertex onto the plane perpendicular to the axis and fit a
  // circle to them by least squares. The plain centroid of the vertices is a
  // tempting shortcut and is wrong by a measurable fraction of a millimetre
  // whenever the tessellation is uneven, which after a boolean it always is.
  const pts = [];
  for (const t of patch) for (const v of t.v) pts.push(v);
  const seed = new THREE.Vector3();
  for (const p of pts) seed.add(p);
  seed.divideScalar(pts.length);

  const e1 = perpendicularTo(axis);
  const e2 = new THREE.Vector3().crossVectors(axis, e1).normalize();
  const tmp = new THREE.Vector3();
  const flat = pts.map((p) => {
    tmp.subVectors(p, seed);
    return [tmp.dot(e1), tmp.dot(e2)];
  });

  const fit = fitCircle2D(flat);
  if (!fit) return null;
  const origin = seed.clone().addScaledVector(e1, fit.cx).addScaledVector(e2, fit.cy);

  const radial = flat.map(([x, y]) => Math.hypot(x - fit.cx, y - fit.cy));
  const mean = radial.reduce((s, r) => s + r, 0) / radial.length;
  if (mean < 1e-6) return null;

  let dev = 0;
  for (const r of radial) dev += (r - mean) ** 2;
  const roundness = Math.max(0, 1 - Math.sqrt(dev / radial.length) / mean);

  const facets = estimateFacets(patch, axis, origin);
  const radius = mean;

  // Inward-facing normals mean material is outside: a hole. Outward means a boss.
  let inward = 0;
  for (const t of patch) {
    tmp.subVectors(t.v[0], origin);
    tmp.addScaledVector(axis, -tmp.dot(axis));
    if (tmp.dot(t.n) < 0) inward++;
  }
  const concave = inward > patch.length / 2;

  // Extent along the axis, and the centre of that extent.
  let lo = Infinity, hi = -Infinity;
  for (const p of pts) {
    const d = tmp.subVectors(p, origin).dot(axis);
    lo = Math.min(lo, d); hi = Math.max(hi, d);
  }
  const centre = origin.clone().addScaledVector(axis, (lo + hi) / 2);

  // A full circle sweeps 2*pi*r*length of surface; anything much less is a
  // partial arc — a fillet or a rounded corner, not a hole.
  const sweep = area / Math.max(1e-9, mean * (hi - lo));
  const full = sweep > 5.4;   // 2*pi is 6.28; allow for tessellation shortfall

  return {
    kind: 'cylinder',
    axis: axis.clone(),
    axisName: dominantAxis(axis),
    centre,
    radius,
    diameter: radius * 2,
    length: hi - lo,
    roundness,
    sweepRadians: sweep,
    full,
    concave,
    area,
    triangles: patch.length,
    facets,
    nominal: concave ? nearestDrill(radius * 2) : null,
  };
}

/** Any unit vector perpendicular to `n`, chosen to avoid a degenerate cross. */
function perpendicularTo(n) {
  const seed = Math.abs(n.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  return new THREE.Vector3().crossVectors(seed, n).normalize();
}

/**
 * Least-squares circle through 2D points (Kasa): minimising the algebraic
 * residual of x^2 + y^2 + Dx + Ey + F turns the fit into one 3x3 solve.
 */
function fitCircle2D(pts) {
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sz = 0, sxz = 0, syz = 0;
  const n = pts.length;
  if (n < 3) return null;
  for (const [x, y] of pts) {
    const z = x * x + y * y;
    sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
    sz += z; sxz += x * z; syz += y * z;
  }
  const A = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]];
  const b = [sxz, syz, sz];
  const sol = solve3(A, b);
  if (!sol) return null;
  const [D, E, F] = sol;
  const cx = D / 2, cy = E / 2;
  const r2 = F + cx * cx + cy * cy;
  if (!(r2 > 0)) return null;
  return { cx, cy, r: Math.sqrt(r2) };
}

/** Gaussian elimination with partial pivoting on a 3x3 system. */
function solve3(A, b) {
  const M = [[...A[0], b[0]], [...A[1], b[1]], [...A[2], b[2]]];
  for (let i = 0; i < 3; i++) {
    let piv = i;
    for (let k = i + 1; k < 3; k++) if (Math.abs(M[k][i]) > Math.abs(M[piv][i])) piv = k;
    if (Math.abs(M[piv][i]) < 1e-12) return null;
    [M[i], M[piv]] = [M[piv], M[i]];
    for (let k = i + 1; k < 3; k++) {
      const f = M[k][i] / M[i][i];
      for (let j = i; j < 4; j++) M[k][j] -= f * M[i][j];
    }
  }
  const x = [0, 0, 0];
  for (let i = 2; i >= 0; i--) {
    let s = M[i][3];
    for (let j = i + 1; j < 3; j++) s -= M[i][j] * x[j];
    x[i] = s / M[i][i];
  }
  return x;
}

/** How many distinct facet normals the patch has, i.e. its tessellation. */
function estimateFacets(patch, axis, origin) {
  const seen = new Set();
  const tmp = new THREE.Vector3();
  for (const t of patch) {
    tmp.copy(t.n).addScaledVector(axis, -t.n.dot(axis));
    if (tmp.lengthSq() < 1e-12) continue;
    tmp.normalize();
    seen.add(`${Math.round(tmp.x * 200)},${Math.round(tmp.y * 200)},${Math.round(tmp.z * 200)}`);
  }
  return seen.size;
}

/**
 * The eigenvector of the smallest eigenvalue of a symmetric 3x3 matrix, by
 * power iteration on (trace*I - M), whose largest eigenvector is the one we
 * want. Deterministic, allocation-free and quite sufficient at this size.
 */
function smallestEigenvector(M) {
  const tr = M[0] + M[4] + M[8];
  if (!(tr > 0)) return null;
  const A = [
    tr - M[0], -M[1], -M[2],
    -M[3], tr - M[4], -M[5],
    -M[6], -M[7], tr - M[8],
  ];
  // Three seeds, so a start orthogonal to the answer cannot stall the iteration.
  let best = null, bestLen = -1;
  for (const seed of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) {
    let v = seed.slice();
    for (let i = 0; i < 64; i++) {
      const w = [
        A[0] * v[0] + A[1] * v[1] + A[2] * v[2],
        A[3] * v[0] + A[4] * v[1] + A[5] * v[2],
        A[6] * v[0] + A[7] * v[1] + A[8] * v[2],
      ];
      const len = Math.hypot(w[0], w[1], w[2]);
      if (len < 1e-12) break;
      v = [w[0] / len, w[1] / len, w[2] / len];
    }
    // Rayleigh quotient against the original M: smaller is better.
    const q = quad(M, v);
    if (bestLen < 0 || q < bestLen) { bestLen = q; best = v; }
  }
  return best ? new THREE.Vector3(best[0], best[1], best[2]).normalize() : null;
}

const quad = (M, v) =>
  v[0] * (M[0] * v[0] + M[1] * v[1] + M[2] * v[2]) +
  v[1] * (M[3] * v[0] + M[4] * v[1] + M[5] * v[2]) +
  v[2] * (M[6] * v[0] + M[7] * v[1] + M[8] * v[2]);

/* ------------------------------------------------------------- helpers */

function dominantAxis(n) {
  const ax = [['x', Math.abs(n.x)], ['y', Math.abs(n.y)], ['z', Math.abs(n.z)]].sort((a, b) => b[1] - a[1]);
  return ax[0][1] > 0.98 ? ax[0][0] : null;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** The nearest standard metric clearance hole, when the measurement is close. */
const DRILLS = [
  [3.4, 'M3 clearance'], [4.5, 'M4 clearance'], [5.5, 'M5 clearance'],
  [6.6, 'M6 clearance'], [9.0, 'M8 clearance'], [11.0, 'M10 clearance'],
  [13.5, 'M12 clearance'],
];
function nearestDrill(d) {
  for (const [size, label] of DRILLS) if (Math.abs(d - size) <= 0.25) return { size, label };
  return null;
}

/**
 * A parametric cut positioned on a recognised hole.
 *
 * This is the payoff. The imported mesh stays an opaque mesh, but the hole in it
 * now has a real feature at its measured position and size, which can be moved,
 * resized and driven by a parameter like anything else in the tree.
 */
export function cutterFor(hole, { depth = null, clearance: extra = 0, through = true } = {}) {
  const r = hole.radius + extra;
  const h = depth || (through ? hole.length * 3 + 10 : hole.length);
  // A cylinder is built along Z, so the rotation is whatever takes Z onto the
  // measured axis. Euler angles are what the transform stores.
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), hole.axis.clone().normalize());
  const e = new THREE.Euler().setFromQuaternion(q, 'XYZ');
  return {
    type: 'cylinder',
    name: hole.nominal ? `${hole.nominal.label} hole` : `Hole Ø${(r * 2).toFixed(2)}`,
    params: { r: round3(r), h: round3(h), seg: Math.max(24, hole.facets || 48), arc: 360 },
    pos: [round3(hole.centre.x), round3(hole.centre.y), round3(hole.centre.z)],
    rot: [round3((e.x * 180) / Math.PI), round3((e.y * 180) / Math.PI), round3((e.z * 180) / Math.PI)],
  };
}

const round3 = (v) => Math.round(v * 1000) / 1000;
