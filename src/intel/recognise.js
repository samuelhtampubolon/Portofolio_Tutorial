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
  const { patches } = segmentWithIds(tris, smoothAngleDeg, tol);
  return patches;
}

/**
 * The same flood fill, but also returning which patch each triangle landed in
 * and the edge adjacency it was built from. Drawing generation needs those to
 * find the real edges of the model.
 */
function segmentWithIds(tris, smoothAngleDeg, tol = 1e-4) {
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

  const patchOf = new Int32Array(tris.length).fill(-1);
  const patches = [];
  for (let i = 0; i < tris.length; i++) {
    if (patchOf[i] >= 0) continue;
    const id = patches.length;
    const stack = [i];
    const patch = [];
    patchOf[i] = id;
    while (stack.length) {
      const j = stack.pop();
      patch.push(tris[j]);
      for (let e = 0; e < 3; e++) {
        const p = key(tris[j].v[e]), q = key(tris[j].v[(e + 1) % 3]);
        const k = p < q ? `${p}|${q}` : `${q}|${p}`;
        for (const m of byEdge.get(k) || []) {
          if (patchOf[m] >= 0) continue;
          // A crease ends the patch. This is the whole of the segmentation.
          if (tris[j].n.dot(tris[m].n) < cosLimit) continue;
          patchOf[m] = id;
          stack.push(m);
        }
      }
    }
    patches.push(patch);
  }
  return { patches, patchOf, byEdge, key };
}

/**
 * The real edges of a model: the boundaries between surface patches.
 *
 * A drawing needs the edges a person would draw, and a dihedral-angle test on
 * raw triangles does not give them. The boolean engine triangulates a flat face
 * into many triangles with T-junctions and the occasional sliver, and a sliver's
 * normal is numerically unreliable, so an angle test invents creases in the
 * middle of a flat face. Drawn, those appear as streaks across the part.
 *
 * Patch boundaries have no such problem. A triangle joins its neighbour's patch
 * only across a smooth edge, so an edge between two different patches is a real
 * edge of the model and an edge inside one patch never is, however noisy that
 * individual triangle's normal happens to be.
 */
export function patchEdges(geometry, matrix = null, { smoothAngle = 25 } = {}) {
  const all = readTriangles(geometry, matrix);
  if (!all.length) return [];
  // Slivers first. A triangle of near-zero area has a numerically meaningless
  // normal, and a boolean leaves plenty of them; left in, they invent edges.
  const total = all.reduce((s2, t) => s2 + t.area, 0);
  const tris = all.filter(t => t.area > Math.max(1e-9, total * 1e-8));
  if (!tris.length) return [];
  const cosLimit = Math.cos(smoothAngle * DEG);
  const { byEdge, key } = segmentWithIds(tris, smoothAngle);

  // Is this a closed solid or an open sheet? It decides what a single-owner
  // edge means. On a closed solid every edge has two faces, so one owner is
  // always a T-junction and never a boundary; on an open sheet it may be a real
  // boundary worth drawing. Signed volume against area^1.5 separates the two
  // cleanly: a solid encloses a volume comparable to its size cubed, a sheet
  // encloses essentially none.
  let vol6 = 0, area = 0;
  for (const t of tris) {
    area += t.area;
    vol6 += t.v[0].dot(new THREE.Vector3().crossVectors(t.v[1], t.v[2]));
  }
  const closed = Math.abs(vol6 / 6) > Math.pow(Math.max(1e-9, area), 1.5) * 1e-4;

  // Triangles grouped by the plane they lie in, for the T-junction test below.
  const byPlane = new Map();
  /**
   * A plane key with its sign normalised. Winding is not consistent across a
   * boolean's retriangulation, so the same physical plane appears with both
   * normals; keyed by the signed normal those land in different buckets and a
   * triangle cannot see the neighbour that covers it.
   */
  const planeKey = (t) => {
    let { x, y, z } = t.n;
    if (x < -1e-9 || (Math.abs(x) <= 1e-9 && (y < -1e-9 || (Math.abs(y) <= 1e-9 && z < 0)))) { x = -x; y = -y; z = -z; }
    const off = x * t.v[0].x + y * t.v[0].y + z * t.v[0].z;
    return `${Math.round(x * 400)},${Math.round(y * 400)},${Math.round(z * 400)}|${Math.round(off * 50)}`;
  };
  tris.forEach((t, i) => {
    const k = planeKey(t);
    if (!byPlane.has(k)) byPlane.set(k, []);
    byPlane.get(k).push(i);
  });

  const out = [];
  const emitted = new Set();
  const mid = new THREE.Vector3();

  for (let i = 0; i < tris.length; i++) {
    for (let e = 0; e < 3; e++) {
      const p = tris[i].v[e], q = tris[i].v[(e + 1) % 3];
      const kp = key(p), kq = key(q);
      const k = kp < kq ? `${kp}|${kq}` : `${kq}|${kp}`;
      if (emitted.has(k)) continue;
      const owners = byEdge.get(k) || [];

      let real;
      if (owners.length >= 2) {
        // The direct test: do the faces either side actually turn? Patch
        // membership cannot answer this, because a T-junction breaks edge
        // connectivity and splits one flat face into several patches, making
        // every fragment boundary look like an edge of the model.
        // The absolute value matters. A boolean's retriangulation of a flat
        // face does not keep winding consistent, so two coplanar neighbours can
        // have exactly opposite normals. A signed test reads that as a 180
        // degree crease and draws a diagonal streak across the face; the
        // unsigned test sees them for what they are, coplanar.
        real = owners.some(o => Math.abs(tris[owners[0]].n.dot(tris[o].n)) < cosLimit);
      } else if (closed) {
        // A closed solid has two faces at every edge, so one owner is a
        // T-junction by construction: a neighbour's vertex landed partway along
        // this edge and the two never matched. Drawing these is what put long
        // diagonal streaks across every flat face of the part.
        real = false;
      } else {
        // On an open mesh a single owner may be a real boundary. It is only
        // interior if another coplanar triangle covers the edge's midpoint.
        mid.addVectors(p, q).multiplyScalar(0.5);
        real = !coveredInPlane(mid, tris, byPlane.get(planeKey(tris[i])) || [], i);
      }
      if (!real) continue;
      emitted.add(k);
      out.push({ a: p.clone(), b: q.clone() });
    }
  }
  return out;
}

/** Does any coplanar triangle other than `skip` contain this point? */
function coveredInPlane(point, tris, candidates, skip, tol = 1e-6) {
  for (const j of candidates) {
    if (j === skip) continue;
    const t = tris[j];
    if (pointInTriangle(point, t.v[0], t.v[1], t.v[2], t.n, tol)) return true;
  }
  return false;
}

function pointInTriangle(p, a, b, c, n, tol) {
  // Barycentric, done in the triangle's own plane by dropping the largest
  // component of the normal, which is the standard way to avoid a degenerate
  // projection.
  const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
  let i0 = 0, i1 = 1;
  if (ax >= ay && ax >= az) { i0 = 1; i1 = 2; }
  else if (ay >= az) { i0 = 0; i1 = 2; }
  const g = (v) => [v.getComponent(i0), v.getComponent(i1)];
  const [px, py] = g(p), [axx, ayy] = g(a), [bx, by] = g(b), [cx, cy] = g(c);
  const d = (by - cy) * (axx - cx) + (cx - bx) * (ayy - cy);
  if (Math.abs(d) < 1e-14) return false;
  const l1 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / d;
  const l2 = ((cy - ayy) * (px - cx) + (axx - cx) * (py - cy)) / d;
  const l3 = 1 - l1 - l2;
  return l1 >= -tol && l2 >= -tol && l3 >= -tol;
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
