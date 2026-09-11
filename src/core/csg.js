/**
 * Constructive Solid Geometry via BSP trees.
 *
 * This is the classic Naylor/Amanatides/Thibault algorithm (the same one
 * behind csg.js), rewritten here on flat typed arrays so it can consume and
 * produce THREE.BufferGeometry directly without a per-vertex object graph for
 * the input. Polygons themselves are small objects — the tree needs them.
 *
 * Everything runs on triangles: a solid is a closed triangle soup. Booleans are
 * exact for well-formed closed meshes and degrade gracefully (rather than
 * crashing) on open or self-intersecting ones.
 */
import * as THREE from 'three';

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
 * Mirrors csg.js splitPolygon, which is the numerically careful version.
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

/* ------------------------------------------------- geometry <-> polygons */

export function geometryToPolygons(geometry, matrix = null) {
  let geo = geometry;
  if (geo.index) geo = geo.toNonIndexed();
  const pos = geo.attributes.position;
  let nrm = geo.attributes.normal;
  if (!nrm) { geo = geo.clone(); geo.computeVertexNormals(); nrm = geo.attributes.normal; }

  const nm = matrix ? new THREE.Matrix3().getNormalMatrix(matrix) : null;
  const vt = new THREE.Vector3();
  const vn = new THREE.Vector3();
  const polys = [];

  for (let i = 0; i < pos.count; i += 3) {
    const tri = [];
    for (let k = 0; k < 3; k++) {
      vt.fromBufferAttribute(pos, i + k);
      vn.fromBufferAttribute(nrm, i + k);
      if (matrix) { vt.applyMatrix4(matrix); vn.applyMatrix3(nm).normalize(); }
      tri.push([vt.x, vt.y, vt.z, vn.x, vn.y, vn.z]);
    }
    const plane = planeFromPoints(tri[0], tri[1], tri[2]);
    if (plane) polys.push({ v: tri, plane });
  }
  return polys;
}

export function polygonsToGeometry(polys) {
  let triCount = 0;
  for (const p of polys) triCount += Math.max(0, p.v.length - 2);
  const positions = new Float32Array(triCount * 9);
  const normals = new Float32Array(triCount * 9);
  let o = 0;
  for (const p of polys) {
    const v = p.v;
    for (let i = 2; i < v.length; i++) {
      const tri = [v[0], v[i - 1], v[i]];
      for (const t of tri) {
        positions[o] = t[0]; positions[o + 1] = t[1]; positions[o + 2] = t[2];
        normals[o] = t[3]; normals[o + 1] = t[4]; normals[o + 2] = t[5];
        o += 3;
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
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

/** Soft ceiling — booleans above this get slow enough to feel broken. */
export const TRI_BUDGET = 90000;

/**
 * Boolean over a list of { geometry, matrix } operands, folded left to right.
 * Returns a world-space BufferGeometry.
 */
export function booleanGeometries(op, operands) {
  const fn = OPS[op] || opUnion;
  if (!operands.length) return new THREE.BufferGeometry();

  let total = 0;
  for (const o of operands) {
    const c = (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
    total += c;
  }
  if (total > TRI_BUDGET) {
    throw new Error(`Boolean skipped: ${Math.round(total / 1000)}k triangles exceeds the ${TRI_BUDGET / 1000}k budget. Reduce segment counts on the inputs.`);
  }

  let acc = geometryToPolygons(operands[0].geometry, operands[0].matrix);
  for (let i = 1; i < operands.length; i++) {
    const next = geometryToPolygons(operands[i].geometry, operands[i].matrix);
    if (!next.length) continue;
    if (!acc.length && op !== 'union') break;
    acc = acc.length ? fn(acc, next) : next;
  }
  return polygonsToGeometry(acc);
}
