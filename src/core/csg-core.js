/**
 * The boolean kernel: constructive solid geometry over BSP trees.
 *
 * ATTRIBUTION. The method is the classic one: Thibault and Naylor, "Set
 * operations on polyhedra using binary space partitioning trees", SIGGRAPH
 * 1987. The specific decomposition used below, and in particular the
 * numerically careful `splitPolygon` that classifies a polygon against a plane
 * and emits the coplanar cases separately, follows Evan Wallace's csg.js
 * (2011), which is MIT licensed. See ATTRIBUTION.md for the notice. The
 * arithmetic here is rewritten over flat typed arrays rather than a per-vertex
 * object graph, and the tree, the operations and the tolerance handling are
 * this project's own, but the shape of the algorithm is his and the credit
 * belongs there rather than in a footnote.
 *
 * This file holds no reference to three.js, which is the reason it exists
 * separately from csg.js in this same directory. A module worker does not
 * receive the page's import map, so a file that says
 * `import * as THREE from 'three'` cannot be loaded in one, while a file whose
 * only imports are relative can. Keeping the maths here and the adapter next
 * door is what lets the same code run on the main thread and in a worker with
 * no second implementation to keep in step.
 *
 * Triangles in, triangles out: `{ position: Float32Array, normal: Float32Array }`
 * with three vertices per triangle and no index. Those arrays are transferable,
 * so handing work to a worker copies nothing.
 */

const EPS = 1e-5;


/* ------------------------------------------------------------------ plane */

function planeFromPoints(a, b, c) {
  const nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
  const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
  const nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const len = Math.hypot(nx, ny, nz);
  if (len < 1e-12) return null;             // degenerate triangle
  const n = [nx / len, ny / len, nz / len];
  return { n, w: n[0] * a[0] + n[1] * a[1] + n[2] * a[2] };
}

/* ---------------------------------------------------------------- polygon */
/** A polygon is { v: [vertex...], plane }. A vertex is [x,y,z, nx,ny,nz]. */

function lerpVert(a, b, t) {
  const out = new Array(6);
  for (let i = 0; i < 6; i++) out[i] = a[i] + (b[i] - a[i]) * t;
  // renormalise the interpolated normal
  const l = Math.hypot(out[3], out[4], out[5]);
  if (l > 1e-9) { out[3] /= l; out[4] /= l; out[5] /= l; }
  return out;
}

function flipPoly(p) {
  p.v.reverse();
  for (const v of p.v) { v[3] = -v[3]; v[4] = -v[4]; v[5] = -v[5]; }
  p.plane = { n: [-p.plane.n[0], -p.plane.n[1], -p.plane.n[2]], w: -p.plane.w };
  return p;
}

const COPLANAR = 0, FRONT = 1, BACK = 2, SPANNING = 3;

/**
 * Split `poly` by `plane`, appending the pieces to the four output lists.
 * This follows csg.js (Evan Wallace, MIT); see the attribution at the top of
 * this file. The care is in the coplanar cases: a polygon lying in the plane
 * has to go to the side its own normal faces, or the tree loses the surface.
 */
function splitPolygon(plane, poly, coFront, coBack, front, back) {
  const { n, w } = plane;
  let type = 0;
  const types = [];
  for (const v of poly.v) {
    const t = n[0] * v[0] + n[1] * v[1] + n[2] * v[2] - w;
    const ty = t < -EPS ? BACK : (t > EPS ? FRONT : COPLANAR);
    type |= ty;
    types.push(ty);
  }

  switch (type) {
    case COPLANAR: {
      const dot = n[0] * poly.plane.n[0] + n[1] * poly.plane.n[1] + n[2] * poly.plane.n[2];
      (dot > 0 ? coFront : coBack).push(poly);
      break;
    }
    case FRONT: front.push(poly); break;
    case BACK: back.push(poly); break;
    default: {
      const f = [], b = [];
      const len = poly.v.length;
      for (let i = 0; i < len; i++) {
        const j = (i + 1) % len;
        const ti = types[i], tj = types[j];
        const vi = poly.v[i], vj = poly.v[j];
        if (ti !== BACK) f.push(vi);
        if (ti !== FRONT) b.push(ti !== BACK ? vi.slice() : vi);
        if ((ti | tj) === SPANNING) {
          const di = w - (n[0] * vi[0] + n[1] * vi[1] + n[2] * vi[2]);
          const dd = (n[0] * (vj[0] - vi[0]) + n[1] * (vj[1] - vi[1]) + n[2] * (vj[2] - vi[2]));
          const t = dd === 0 ? 0 : di / dd;
          const vm = lerpVert(vi, vj, t);
          f.push(vm);
          b.push(vm.slice());
        }
      }
      if (f.length >= 3) front.push({ v: f, plane: poly.plane });
      if (b.length >= 3) back.push({ v: b, plane: poly.plane });
    }
  }
}

/* -------------------------------------------------------------- BSP node */

class Node {
  constructor(polys) {
    this.plane = null;
    this.front = null;
    this.back = null;
    this.polys = [];
    if (polys && polys.length) this.build(polys);
  }

  invert() {
    // iterative to keep deep trees off the JS call stack
    const stack = [this];
    while (stack.length) {
      const n = stack.pop();
      for (const p of n.polys) flipPoly(p);
      if (n.plane) n.plane = { n: [-n.plane.n[0], -n.plane.n[1], -n.plane.n[2]], w: -n.plane.w };
      const f = n.front; n.front = n.back; n.back = f;
      if (n.front) stack.push(n.front);
      if (n.back) stack.push(n.back);
    }
  }

  /** Remove the parts of `polys` that fall inside this solid. */
  clipPolygons(polys) {
    if (!this.plane) return polys.slice();
    let front = [], back = [];
    for (const p of polys) splitPolygon(this.plane, p, front, back, front, back);
    if (this.front) front = this.front.clipPolygons(front);
    back = this.back ? this.back.clipPolygons(back) : [];
    return front.concat(back);
  }

  clipTo(other) {
    const stack = [this];
    while (stack.length) {
      const n = stack.pop();
      n.polys = other.clipPolygons(n.polys);
      if (n.front) stack.push(n.front);
      if (n.back) stack.push(n.back);
    }
  }

  allPolygons() {
    const out = [];
    const stack = [this];
    while (stack.length) {
      const n = stack.pop();
      for (const p of n.polys) out.push(p);
      if (n.front) stack.push(n.front);
      if (n.back) stack.push(n.back);
    }
    return out;
  }

  build(polys) {
    // Iterative build: a recursive one blows the stack on large meshes.
    const work = [[this, polys]];
    while (work.length) {
      const [node, list] = work.pop();
      if (!list.length) continue;
      if (!node.plane) node.plane = list[0].plane;
      const front = [], back = [];
      for (const p of list) splitPolygon(node.plane, p, node.polys, node.polys, front, back);
      if (front.length) { node.front = node.front || new Node(); work.push([node.front, front]); }
      if (back.length) { node.back = node.back || new Node(); work.push([node.back, back]); }
    }
  }
}


/* ------------------------------------------- triangles <-> polygons */

/**
 * Build polygons from flat triangle arrays, optionally transformed.
 *
 * `matrix` is a plain 16-number column-major array, the same layout
 * THREE.Matrix4 uses, so a caller can pass `m.elements` straight through and a
 * worker can receive it without knowing what a Matrix4 is.
 */
export function trianglesToPolygons(position, normal, matrix = null) {
  const polys = [];
  const n = (position.length / 9) | 0;

  // Normals transform by the inverse transpose of the upper 3x3. Computing it
  // here keeps the worker free of any matrix library.
  let nm = null;
  if (matrix) nm = normalMatrix3(matrix);

  for (let t = 0; t < n; t++) {
    const tri = [];
    for (let k = 0; k < 3; k++) {
      const i = t * 9 + k * 3;
      let x = position[i], y = position[i + 1], z = position[i + 2];
      let nx = normal ? normal[i] : 0, ny = normal ? normal[i + 1] : 0, nz = normal ? normal[i + 2] : 0;
      if (matrix) {
        const m = matrix;
        const w = m[3] * x + m[7] * y + m[11] * z + m[15] || 1;
        const tx = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w;
        const ty = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w;
        const tz = (m[2] * x + m[6] * y + m[10] * z + m[14]) / w;
        x = tx; y = ty; z = tz;
        const ax = nm[0] * nx + nm[3] * ny + nm[6] * nz;
        const ay = nm[1] * nx + nm[4] * ny + nm[7] * nz;
        const az = nm[2] * nx + nm[5] * ny + nm[8] * nz;
        const len = Math.hypot(ax, ay, az) || 1;
        nx = ax / len; ny = ay / len; nz = az / len;
      }
      tri.push([x, y, z, nx, ny, nz]);
    }
    const plane = planeFromPoints(tri[0], tri[1], tri[2]);
    if (plane) polys.push({ v: tri, plane });
  }
  return polys;
}

/** Inverse transpose of the upper 3x3, column-major, for normals. */
function normalMatrix3(m) {
  const a = m[0], b = m[1], c = m[2];
  const d = m[4], e = m[5], f = m[6];
  const g = m[8], h = m[9], i = m[10];
  const A = e * i - f * h, B = f * g - d * i, C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (!det) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const id = 1 / det;
  // inverse, then transpose: the transpose is applied by the index order below.
  return [
    A * id, B * id, C * id,
    (c * h - b * i) * id, (a * i - c * g) * id, (b * g - a * h) * id,
    (b * f - c * e) * id, (c * d - a * f) * id, (a * e - b * d) * id,
  ];
}

/** Fan-triangulate polygons back into flat arrays. */
export function polygonsToTriangles(polys) {
  let triCount = 0;
  for (const p of polys) triCount += Math.max(0, p.v.length - 2);
  const position = new Float32Array(triCount * 9);
  const normal = new Float32Array(triCount * 9);
  let o = 0;
  for (const p of polys) {
    const v = p.v;
    for (let i = 2; i < v.length; i++) {
      for (const t of [v[0], v[i - 1], v[i]]) {
        position[o] = t[0]; position[o + 1] = t[1]; position[o + 2] = t[2];
        normal[o] = t[3]; normal[o + 1] = t[4]; normal[o + 2] = t[5];
        o += 3;
      }
    }
  }
  return { position, normal };
}
/* ----------------------------------------------------------- operations */

function opUnion(a, b) {
  const A = new Node(a), B = new Node(b);
  A.clipTo(B); B.clipTo(A);
  B.invert(); B.clipTo(A); B.invert();
  A.build(B.allPolygons());
  return A.allPolygons();
}

function opSubtract(a, b) {
  const A = new Node(a), B = new Node(b);
  A.invert();
  A.clipTo(B); B.clipTo(A);
  B.invert(); B.clipTo(A); B.invert();
  A.build(B.allPolygons());
  A.invert();
  return A.allPolygons();
}

function opIntersect(a, b) {
  const A = new Node(a), B = new Node(b);
  A.invert();
  B.clipTo(A); B.invert();
  A.clipTo(B); B.clipTo(A);
  A.build(B.allPolygons());
  A.invert();
  return A.allPolygons();
}

const OPS = { union: opUnion, subtract: opSubtract, intersect: opIntersect };



/** Soft ceiling: booleans above this get slow enough to feel broken. */
export const TRI_BUDGET = 90000;

export const OPS_AVAILABLE = Object.keys(OPS);

/**
 * Fold a boolean over a list of operands given as flat arrays.
 * This is the function the worker calls, and the one the main thread falls
 * back to when workers are unavailable. Identical maths either way.
 *
 * @param {string} op  union | subtract | intersect
 * @param {Array<{position: Float32Array, normal: Float32Array, matrix: number[]|null}>} operands
 * @returns {{position: Float32Array, normal: Float32Array}}
 */
export function booleanTriangles(op, operands) {
  const fn = OPS[op] || opUnion;
  if (!operands.length) return { position: new Float32Array(0), normal: new Float32Array(0) };

  let total = 0;
  for (const o of operands) total += o.position.length / 9;
  if (total > TRI_BUDGET) {
    throw new Error(`Boolean skipped: ${Math.round(total / 1000)}k triangles exceeds the ${TRI_BUDGET / 1000}k budget. Reduce segment counts on the inputs.`);
  }

  let acc = trianglesToPolygons(operands[0].position, operands[0].normal, operands[0].matrix);
  for (let i = 1; i < operands.length; i++) {
    const next = trianglesToPolygons(operands[i].position, operands[i].normal, operands[i].matrix);
    if (!next.length) continue;
    if (!acc.length && op !== 'union') break;
    acc = acc.length ? fn(acc, next) : next;
  }
  return polygonsToTriangles(acc);
}
