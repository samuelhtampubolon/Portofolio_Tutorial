/**
 * Geometry construction: parametric primitives, 2D profile extraction from the
 * drafting workspace, and the extrude / revolve / pattern / mirror operators.
 *
 * World convention is **Z-up**, matching mechanical CAD (SolidWorks, AutoCAD,
 * Inventor) rather than three.js' default Y-up. Primitives built from three.js
 * generators are rotated once at construction so everything downstream —
 * booleans, mass properties, exporters — speaks the same language.
 */
import * as THREE from 'three';

const D2R = Math.PI / 180;
const TOL = 1e-4;

const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v || 0)));
const pos = (v, min = 1e-4) => Math.max(min, v || 0);

/** Convert a Y-up generator result into the Z-up world. */
function zUp(geo) { geo.rotateX(Math.PI / 2); return geo; }

/* ==================================================================
   Primitives
   ================================================================== */

export function buildPrimitive(type, p) {
  switch (type) {
    case 'box':
      return new THREE.BoxGeometry(pos(p.w), pos(p.d), pos(p.h));

    case 'cylinder': {
      const seg = clampInt(p.seg, 3, 256);
      const arc = (p.arc === undefined ? 360 : p.arc);
      if (Math.abs(arc) < 359.999) return buildPie(pos(p.r), pos(p.h), Math.abs(arc) * D2R, seg);
      return zUp(new THREE.CylinderGeometry(pos(p.r), pos(p.r), pos(p.h), seg, 1, false));
    }

    case 'sphere': {
      const seg = clampInt(p.seg, 4, 200);
      return zUp(new THREE.SphereGeometry(pos(p.r), seg, Math.max(3, Math.round(seg / 2))));
    }

    case 'cone': {
      const seg = clampInt(p.seg, 3, 256);
      return zUp(new THREE.CylinderGeometry(Math.max(0, p.r2 || 0), Math.max(0, p.r1 || 0), pos(p.h), seg, 1, false));
    }

    case 'torus': {
      const arc = (p.arc === undefined ? 360 : p.arc);
      const R = pos(p.R), r = pos(p.r);
      // The torus already lies in the world XY plane, so no Z-up fix-up here.
      if (Math.abs(arc) >= 359.999) {
        return new THREE.TorusGeometry(R, r, clampInt(p.tseg, 3, 128), clampInt(p.seg, 3, 256));
      }
      // A partial torus needs real end caps: revolve a circular profile instead.
      const circle = new THREE.Shape();
      circle.absarc(R, 0, r, 0, Math.PI * 2, false);
      const revSeg = Math.max(3, Math.round(clampInt(p.seg, 3, 360) * Math.abs(arc) / 360));
      return buildRevolve([circle], { angle: Math.abs(arc), axis: 'y', seg: revSeg });
    }

    case 'tube': {
      const ro = pos(p.ro), ri = Math.max(0, p.ri || 0), h = pos(p.h);
      if (ri <= TOL) return zUp(new THREE.CylinderGeometry(ro, ro, h, clampInt(p.seg, 3, 256), 1, false));
      if (ri >= ro) throw new Error('Tube inner radius must be smaller than the outer radius');
      return buildAnnulus(ro, ri, h, clampInt(p.seg, 3, 256));
    }

    case 'wedge':
      return buildWedge(pos(p.w), pos(p.d), pos(p.h));

    case 'prism': {
      const n = clampInt(p.sides, 3, 64);
      return zUp(new THREE.CylinderGeometry(pos(p.r), pos(p.r), pos(p.h), n, 1, false));
    }

    case 'pyramid': {
      const n = clampInt(p.sides, 3, 64);
      return zUp(new THREE.CylinderGeometry(0, pos(p.r), pos(p.h), n, 1, false));
    }

    case 'plate':
      return buildPlate(p);

    case 'helix':
      return buildHelix(p);

    default:
      return new THREE.BoxGeometry(10, 10, 10);
  }
}

/** A pie-slice cylinder (partial sweep) built as a capped solid. */
function buildPie(r, h, arcRad, seg) {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.absarc(0, 0, r, 0, arcRad, false);
  shape.lineTo(0, 0);
  const g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, curveSegments: seg, steps: 1 });
  g.translate(0, 0, -h / 2);
  g.computeVertexNormals();
  return g;
}

function buildAnnulus(ro, ri, h, seg) {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, ro, 0, Math.PI * 2, false);
  const hole = new THREE.Path();
  hole.absarc(0, 0, ri, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, curveSegments: seg, steps: 1 });
  g.translate(0, 0, -h / 2);
  g.computeVertexNormals();
  return g;
}

function buildWedge(w, d, h) {
  const x = w / 2, y = d / 2, z = h / 2;
  // Triangular prism: full height at -X, zero height at +X.
  const v = [
    [-x, -y, -z], [x, -y, -z], [x, y, -z], [-x, y, -z],   // base 0..3
    [-x, -y, z], [-x, y, z],                              // top ridge 4,5
  ];
  const faces = [
    [0, 2, 1], [0, 3, 2],          // bottom
    [0, 1, 4], [1, 2, 4], [2, 5, 4], [2, 3, 5],  // slope + side
    [0, 4, 5], [0, 5, 3],          // back face
  ];
  const arr = new Float32Array(faces.length * 9);
  let o = 0;
  for (const f of faces) for (const i of f) { arr[o++] = v[i][0]; arr[o++] = v[i][1]; arr[o++] = v[i][2]; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  g.computeVertexNormals();
  return g;
}

function buildPlate(p) {
  const w = pos(p.w), d = pos(p.d), h = pos(p.h);
  const r = Math.max(0, Math.min(p.fillet || 0, Math.min(w, d) / 2 - TOL));
  const seg = clampInt(p.seg, 1, 48);
  const s = new THREE.Shape();
  const x = w / 2, y = d / 2;
  if (r <= TOL) {
    s.moveTo(-x, -y); s.lineTo(x, -y); s.lineTo(x, y); s.lineTo(-x, y); s.closePath();
  } else {
    s.moveTo(-x + r, -y);
    s.lineTo(x - r, -y); s.absarc(x - r, -y + r, r, -Math.PI / 2, 0, false);
    s.lineTo(x, y - r);  s.absarc(x - r, y - r, r, 0, Math.PI / 2, false);
    s.lineTo(-x + r, y); s.absarc(-x + r, y - r, r, Math.PI / 2, Math.PI, false);
    s.lineTo(-x, -y + r); s.absarc(-x + r, -y + r, r, Math.PI, Math.PI * 1.5, false);
  }
  const hr = Math.max(0, p.hole || 0);
  if (hr > TOL) {
    const hole = new THREE.Path();
    hole.absarc(0, 0, Math.min(hr, Math.min(w, d) / 2 - TOL), 0, Math.PI * 2, true);
    s.holes.push(hole);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false, curveSegments: seg, steps: 1 });
  g.translate(0, 0, -h / 2);
  g.computeVertexNormals();
  return g;
}

function buildHelix(p) {
  const R = pos(p.R), r = pos(p.r);
  const turns = Math.max(0.05, Math.min(200, p.turns || 1));
  const pitch = p.pitch || 0;
  const radial = clampInt(p.seg, 3, 48);
  const per = clampInt(p.steps, 6, 96);
  const steps = Math.max(4, Math.min(20000, Math.round(per * turns)));

  const path = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = t * turns * Math.PI * 2;
    path.push(new THREE.Vector3(R * Math.cos(a), R * Math.sin(a), (t - 0.5) * pitch * turns));
  }
  const curve = new THREE.CatmullRomCurve3(path, false, 'catmullrom', 0);
  const g = new THREE.TubeGeometry(curve, steps, r, radial, false);
  return g;
}

/* ==================================================================
   2D profiles from the drafting workspace
   ================================================================== */

const ARC_SEG = 48;

/** Flatten one draft entity into { pts:[[x,y]…], closed:boolean } or null. */
export function entityToPath(e, quality = ARC_SEG) {
  switch (e.type) {
    case 'line':
      return { pts: [[e.a[0], e.a[1]], [e.b[0], e.b[1]]], closed: false };

    case 'polyline':
      return e.pts.length >= 2 ? { pts: e.pts.map(p => [p[0], p[1]]), closed: !!e.closed } : null;

    case 'rect': {
      const [x1, y1] = e.a, [x2, y2] = e.b;
      return { pts: [[x1, y1], [x2, y1], [x2, y2], [x1, y2]], closed: true };
    }

    case 'circle': {
      const n = Math.max(12, quality);
      const pts = [];
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        pts.push([e.c[0] + e.r * Math.cos(a), e.c[1] + e.r * Math.sin(a)]);
      }
      return { pts, closed: true };
    }

    case 'ellipse': {
      const n = Math.max(12, quality);
      const rot = (e.rot || 0) * D2R, ca = Math.cos(rot), sa = Math.sin(rot);
      const pts = [];
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const x = e.rx * Math.cos(a), y = e.ry * Math.sin(a);
        pts.push([e.c[0] + x * ca - y * sa, e.c[1] + x * sa + y * ca]);
      }
      return { pts, closed: true };
    }

    case 'polygon': {
      const n = Math.max(3, Math.round(e.n || 6));
      const rot = (e.rot || 0) * D2R;
      const pts = [];
      for (let i = 0; i < n; i++) {
        const a = rot + (i / n) * Math.PI * 2;
        pts.push([e.c[0] + e.r * Math.cos(a), e.c[1] + e.r * Math.sin(a)]);
      }
      return { pts, closed: true };
    }

    case 'arc': {
      let a0 = e.a0, a1 = e.a1;
      if (a1 <= a0) a1 += Math.PI * 2;
      const span = a1 - a0;
      const n = Math.max(2, Math.ceil((span / (Math.PI * 2)) * Math.max(12, quality)));
      const pts = [];
      for (let i = 0; i <= n; i++) {
        const a = a0 + span * (i / n);
        pts.push([e.c[0] + e.r * Math.cos(a), e.c[1] + e.r * Math.sin(a)]);
      }
      return { pts, closed: false };
    }

    case 'spline': {
      if (!e.pts || e.pts.length < 2) return null;
      const v = e.pts.map(p => new THREE.Vector2(p[0], p[1]));
      const curve = new THREE.SplineCurve(v);
      const n = Math.max(16, quality * 2);
      const pts = curve.getPoints(n).map(p => [p.x, p.y]);
      if (e.closed) pts.push([e.pts[0][0], e.pts[0][1]]);
      return { pts, closed: !!e.closed };
    }

    default:
      return null;   // points, text and dimensions are not profile geometry
  }
}

const near = (a, b, t = 1e-3) => Math.abs(a[0] - b[0]) <= t && Math.abs(a[1] - b[1]) <= t;

function signedArea(pts) {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

function pointInPoly(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if (((yi > pt[1]) !== (yj > pt[1])) && (pt[0] < (xj - xi) * (pt[1] - yi) / ((yj - yi) || 1e-12) + xi)) inside = !inside;
  }
  return inside;
}

function dedupe(pts, tol = 1e-6) {
  const out = [];
  for (const p of pts) if (!out.length || !near(out[out.length - 1], p, tol)) out.push(p);
  if (out.length > 2 && near(out[0], out[out.length - 1], tol)) out.pop();
  return out;
}

/**
 * Turn a set of draft entities into closed loops.
 *
 * Entities that are already closed become loops directly. Open entities
 * (lines, arcs, open polylines) are chained end-to-end — the way AutoCAD's
 * BOUNDARY or a SolidWorks sketch region works — so a profile drawn as four
 * separate lines still extrudes.
 */
export function buildLoops(entities, quality = ARC_SEG, tol = 1e-3) {
  const loops = [];
  const open = [];

  for (const e of entities) {
    const path = entityToPath(e, quality);
    if (!path || path.pts.length < 2) continue;
    if (path.closed) {
      const pts = dedupe(path.pts);
      if (pts.length >= 3) loops.push(pts);
    } else {
      open.push({ pts: path.pts, used: false });
    }
  }

  // Chain open segments into cycles.
  for (const seed of open) {
    if (seed.used) continue;
    seed.used = true;
    let chain = seed.pts.slice();
    let grew = true;
    while (grew) {
      grew = false;
      const tail = chain[chain.length - 1];
      const head = chain[0];
      if (near(tail, head, tol) && chain.length >= 4) break;
      for (const seg of open) {
        if (seg.used) continue;
        if (near(seg.pts[0], tail, tol)) { chain = chain.concat(seg.pts.slice(1)); seg.used = true; grew = true; break; }
        if (near(seg.pts[seg.pts.length - 1], tail, tol)) { chain = chain.concat(seg.pts.slice(0, -1).reverse()); seg.used = true; grew = true; break; }
        if (near(seg.pts[seg.pts.length - 1], head, tol)) { chain = seg.pts.slice(0, -1).concat(chain); seg.used = true; grew = true; break; }
        if (near(seg.pts[0], head, tol)) { chain = seg.pts.slice(1).reverse().concat(chain); seg.used = true; grew = true; break; }
      }
    }
    if (chain.length >= 4 && near(chain[0], chain[chain.length - 1], tol)) {
      const pts = dedupe(chain, tol);
      if (pts.length >= 3) loops.push(pts);
    }
  }

  return loops.filter(l => Math.abs(signedArea(l)) > 1e-6);
}

/** Nest loops into THREE.Shape objects (outer boundary + holes). */
export function loopsToShapes(loops) {
  const items = loops.map(pts => ({
    pts,
    area: Math.abs(signedArea(pts)),
    depth: 0,
  }));
  // even-odd nesting depth
  for (const a of items) {
    for (const b of items) {
      if (a === b) continue;
      if (b.area > a.area && pointInPoly(a.pts[0], b.pts)) a.depth++;
    }
  }
  const shapes = [];
  const outers = items.filter(i => i.depth % 2 === 0).sort((a, b) => b.area - a.area);
  const holes = items.filter(i => i.depth % 2 === 1);

  for (const o of outers) {
    const pts = signedArea(o.pts) < 0 ? [...o.pts].reverse() : o.pts;   // CCW
    const shape = new THREE.Shape(pts.map(p => new THREE.Vector2(p[0], p[1])));
    shape.userData = { holes: [] };
    o.shape = shape;
    shapes.push(shape);
  }
  for (const h of holes) {
    // attach to the smallest outer loop that contains it
    let best = null;
    for (const o of outers) {
      if (pointInPoly(h.pts[0], o.pts) && (!best || o.area < best.area)) best = o;
    }
    if (!best) continue;
    const pts = signedArea(h.pts) > 0 ? [...h.pts].reverse() : h.pts;   // CW
    best.shape.holes.push(new THREE.Path(pts.map(p => new THREE.Vector2(p[0], p[1]))));
  }
  return shapes;
}

export function shapesFromEntities(entities, quality = ARC_SEG) {
  return loopsToShapes(buildLoops(entities, quality));
}

/* ==================================================================
   Extrude with draft angle and twist
   ================================================================== */

function ringOf(path) {
  const pts = path.getPoints ? path.getPoints(0) : path;
  const out = pts.map(p => [p.x, p.y]);
  if (out.length > 1 && near(out[0], out[out.length - 1], 1e-9)) out.pop();
  return out;
}

/** Offset a closed ring outwards by `t` using mitred angle bisectors. */
function offsetRing(ring, t, ccw) {
  if (Math.abs(t) < 1e-9) return ring.map(p => [p[0], p[1]]);
  const n = ring.length;
  const out = new Array(n);
  const sgn = ccw ? 1 : -1;
  for (let i = 0; i < n; i++) {
    const prev = ring[(i - 1 + n) % n], cur = ring[i], next = ring[(i + 1) % n];
    let e1x = cur[0] - prev[0], e1y = cur[1] - prev[1];
    let e2x = next[0] - cur[0], e2y = next[1] - cur[1];
    const l1 = Math.hypot(e1x, e1y) || 1, l2 = Math.hypot(e2x, e2y) || 1;
    e1x /= l1; e1y /= l1; e2x /= l2; e2y /= l2;
    // outward normal for CCW winding is (dy, -dx)
    const n1x = e1y * sgn, n1y = -e1x * sgn;
    const n2x = e2y * sgn, n2y = -e2x * sgn;
    let bx = n1x + n2x, by = n1y + n2y;
    const bl = Math.hypot(bx, by);
    if (bl < 1e-9) { out[i] = [cur[0] + n1x * t, cur[1] + n1y * t]; continue; }
    bx /= bl; by /= bl;
    const cosHalf = Math.max(0.2, bx * n1x + by * n1y);   // miter limit ≈ 5×
    const m = t / cosHalf;
    out[i] = [cur[0] + bx * m, cur[1] + by * m];
  }
  return out;
}

function centroidOf(rings) {
  let sx = 0, sy = 0, n = 0;
  for (const r of rings) for (const p of r) { sx += p[0]; sy += p[1]; n++; }
  return n ? [sx / n, sy / n] : [0, 0];
}

/**
 * Extrude shapes along +Z with optional draft angle and twist.
 * Returns geometry centred on Z=0 when `symmetric`, otherwise starting at Z=0.
 */
export function buildExtrude(shapes, opts = {}) {
  const dist = opts.dist || 0;
  if (Math.abs(dist) < 1e-6) throw new Error('Extrude distance must not be zero');
  const steps = Math.max(1, Math.min(400, Math.round(opts.steps || 1)));
  const taperRad = (opts.taper || 0) * D2R;
  const twistRad = (opts.twist || 0) * D2R;
  const needLayers = Math.abs(taperRad) > 1e-6 || Math.abs(twistRad) > 1e-6 ? steps : 1;

  const positions = [];
  const push = (a, b, c) => positions.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);

  for (const shape of shapes) {
    const outer = ringOf(shape.extractPoints(12).shape);
    const holeRings = (shape.holes || []).map(h => ringOf(h.getPoints(12)));
    if (outer.length < 3) continue;

    const outerCCW = signedArea(outer) > 0;
    const rings = [outer, ...holeRings];
    const centre = centroidOf([outer]);

    // triangulate the cap once, in the base ring's parameter space
    const capTris = THREE.ShapeUtils.triangulateShape(
      outer.map(p => new THREE.Vector2(p[0], p[1])),
      holeRings.map(h => h.map(p => new THREE.Vector2(p[0], p[1]))),
    );

    const layerAt = (k) => {
      const t = k / needLayers;
      const z = dist * t;
      const off = Math.tan(taperRad) * Math.abs(z);
      const ang = twistRad * t;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      return rings.map((r, ri) => {
        const ccw = ri === 0 ? outerCCW : !outerCCW;
        const o = offsetRing(r, off, ccw);
        return o.map(p => {
          const dx = p[0] - centre[0], dy = p[1] - centre[1];
          return [centre[0] + dx * ca - dy * sa, centre[1] + dx * sa + dy * ca, z];
        });
      });
    };

    /* Side walls.
       With the outer ring wound CCW and holes CW (what loopsToShapes
       guarantees), one triangle recipe gives outward-facing normals for every
       ring; the sign only has to flip when the outer ring is CW or the
       extrusion runs in -Z. */
    const wallDir = (outerCCW ? 1 : -1) * (dist >= 0 ? 1 : -1);
    let prev = layerAt(0);
    const first = prev;
    for (let k = 1; k <= needLayers; k++) {
      const cur = layerAt(k);
      for (let ri = 0; ri < rings.length; ri++) {
        const a = prev[ri], b = cur[ri];
        const n = a.length;
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n;
          if (wallDir > 0) { push(a[i], b[j], b[i]); push(a[i], a[j], b[j]); }
          else { push(a[i], b[i], b[j]); push(a[i], b[j], a[j]); }
        }
      }
      prev = cur;
    }
    const last = prev;

    /* Caps. `capTris` indexes the concatenated [outer, ...holes] vertex list
       and inherits the outer ring's winding, so it faces +Z when the outer
       ring is CCW. The far layer sits at z = dist. */
    const flat = (layers) => { const f = []; for (const r of layers) for (const p of r) f.push(p); return f; };
    const fNear = flat(first), fFar = flat(last);
    const asIsFacesUp = outerCCW;
    const farWantsUp = dist > 0;
    for (const [i0, i1, i2] of capTris) {
      if (asIsFacesUp === farWantsUp) push(fFar[i0], fFar[i1], fFar[i2]);
      else push(fFar[i0], fFar[i2], fFar[i1]);
      if (asIsFacesUp === farWantsUp) push(fNear[i0], fNear[i2], fNear[i1]);
      else push(fNear[i0], fNear[i1], fNear[i2]);
    }
  }

  if (!positions.length) throw new Error('No closed profile found to extrude');

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  if (opts.symmetric) g.translate(0, 0, -dist / 2);
  g.computeVertexNormals();
  return g;
}

/* ==================================================================
   Revolve
   ================================================================== */

export function buildRevolve(shapes, opts = {}) {
  const angle = opts.angle === undefined ? 360 : opts.angle;
  const seg = clampInt(opts.seg || 64, 3, 720);
  if (Math.abs(angle) < 1e-6) throw new Error('Revolve angle must not be zero');
  if (!shapes.length) throw new Error('No closed profile found to revolve');

  const axis = opts.axis === 'x' ? 'x' : 'y';
  const positions = [];
  const push = (a, b, c) => positions.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  const full = Math.abs(angle) >= 359.999;
  const span = (full ? 360 : angle) * D2R;

  for (const shape of shapes) {
    const rings = [ringOf(shape.extractPoints(24).shape), ...(shape.holes || []).map(h => ringOf(h.getPoints(24)))];
    for (const ring of rings) {
      if (ring.length < 3) continue;
      // profile coordinates: u = distance from axis, v = along axis
      const prof = ring.map(p => (axis === 'y' ? [p[0], p[1]] : [p[1], p[0]]));
      const minU = Math.min(...prof.map(p => p[0]));
      if (minU < -1e-3) throw new Error('Revolve profile must stay on one side of the axis');
      const ccw = signedArea(prof) > 0;

      const at = (k) => {
        const a = span * (k / seg);
        const ca = Math.cos(a), sa = Math.sin(a);
        return prof.map(([u, v]) => {
          const x = Math.max(0, u) * ca, y = Math.max(0, u) * sa;
          return axis === 'y' ? [x, y, v] : [v, x, y];
        });
      };

      let prev = at(0);
      const first = prev;
      for (let k = 1; k <= seg; k++) {
        const cur = at(k);
        const n = prof.length;
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n;
          if (ccw) { push(prev[i], cur[i], cur[j]); push(prev[i], cur[j], prev[j]); }
          else { push(prev[i], cur[j], cur[i]); push(prev[i], prev[j], cur[j]); }
        }
        prev = cur;
      }

      if (!full) {
        // flat end caps at the sweep start and end
        const tris = THREE.ShapeUtils.triangulateShape(prof.map(p => new THREE.Vector2(p[0], p[1])), []);
        for (const [i0, i1, i2] of tris) {
          push(first[i0], first[i1], first[i2]);
          push(prev[i0], prev[i2], prev[i1]);
        }
      }
    }
  }

  if (!positions.length) throw new Error('Revolve produced no geometry');
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  g.computeVertexNormals();
  return g;
}

/* ==================================================================
   Helpers used by the rebuild engine
   ================================================================== */

export function transformMatrix(tr) {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(
    new THREE.Euler((tr.rot[0] || 0) * D2R, (tr.rot[1] || 0) * D2R, (tr.rot[2] || 0) * D2R, 'XYZ'),
  );
  const s = tr.scale || [1, 1, 1];
  m.compose(
    new THREE.Vector3(tr.pos[0] || 0, tr.pos[1] || 0, tr.pos[2] || 0),
    q,
    new THREE.Vector3(s[0] || 1, s[1] || 1, s[2] || 1),
  );
  return m;
}

/** Recentre geometry on its bounding-box centre; returns the offset applied. */
export function recentre(geometry) {
  geometry.computeBoundingBox();
  const c = new THREE.Vector3();
  geometry.boundingBox.getCenter(c);
  geometry.translate(-c.x, -c.y, -c.z);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return c;
}

export function triangleCount(geometry) {
  if (!geometry || !geometry.attributes.position) return 0;
  return (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3;
}

/* ==================================================================
   Feature edges
   ================================================================== */

/**
 * Edge overlay for shaded-with-edges display.
 *
 * THREE.EdgesGeometry also emits *boundary* edges — edges belonging to a
 * single triangle. That is correct for open meshes, but a BSP boolean leaves
 * T-junctions all over otherwise flat faces, and those read as scratches
 * across the model. This version keeps only edges shared by exactly two
 * triangles whose normals differ by more than `thresholdDeg`, which is what
 * a CAD edge display actually means.
 */
export function featureEdges(geometry, thresholdDeg = 24) {
  const geo = geometry.index ? geometry.toNonIndexed() : geometry;
  const pos = geo.attributes.position.array;
  const cosLimit = Math.cos(thresholdDeg * D2R);
  const P = 1e4;                                   // 0.1 µm hashing grid
  const key = (i) => `${Math.round(pos[i] * P)},${Math.round(pos[i + 1] * P)},${Math.round(pos[i + 2] * P)}`;

  const edges = new Map();
  const ax = new THREE.Vector3(), bx = new THREE.Vector3(), cx = new THREE.Vector3();
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), nrm = new THREE.Vector3();

  for (let t = 0; t < pos.length; t += 9) {
    ax.set(pos[t], pos[t + 1], pos[t + 2]);
    bx.set(pos[t + 3], pos[t + 4], pos[t + 5]);
    cx.set(pos[t + 6], pos[t + 7], pos[t + 8]);
    e1.subVectors(bx, ax); e2.subVectors(cx, ax);
    nrm.crossVectors(e1, e2);
    if (nrm.lengthSq() < 1e-18) continue;
    nrm.normalize();
    const n = [nrm.x, nrm.y, nrm.z];
    const k = [key(t), key(t + 3), key(t + 6)];
    const v = [[pos[t], pos[t + 1], pos[t + 2]], [pos[t + 3], pos[t + 4], pos[t + 5]], [pos[t + 6], pos[t + 7], pos[t + 8]]];
    for (let i = 0; i < 3; i++) {
      const j = (i + 1) % 3;
      if (k[i] === k[j]) continue;
      const id = k[i] < k[j] ? `${k[i]}|${k[j]}` : `${k[j]}|${k[i]}`;
      const hit = edges.get(id);
      if (!hit) edges.set(id, { a: v[i], b: v[j], normals: [n], count: 1 });
      else { hit.count++; hit.normals.push(n); }
    }
  }

  const out = [];
  for (const e of edges.values()) {
    if (e.count < 2) continue;                        // boundary edge (a T-junction)
    // keep the edge if any pair of adjoining faces actually turns a corner
    let minDot = 1;
    for (let i = 0; i < e.normals.length; i++) {
      for (let j = i + 1; j < e.normals.length; j++) {
        const a = e.normals[i], b = e.normals[j];
        minDot = Math.min(minDot, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]);
      }
    }
    if (minDot >= cosLimit) continue;                 // faces are near-coplanar
    out.push(e.a[0], e.a[1], e.a[2], e.b[0], e.b[1], e.b[2]);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(out), 3));
  return g;
}
