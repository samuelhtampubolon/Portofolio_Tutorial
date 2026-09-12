/**
 * Geometry on 2D draft entities.
 *
 * Pure functions over the entity records the drafting engine stores: move,
 * rotate, scale, mirror, measure, offset, and the point-to-entity distance the
 * snap and selection code is built on. Nothing here knows about a canvas, a
 * pointer, or the document; give it an entity and a number and it gives back
 * an entity or a number.
 *
 * They were part of draft.js until that file passed the size at which one file
 * stops being one idea. Separating them was worth doing for a reason beyond
 * length: the interactive engine is the hard thing to test, and these are the
 * parts that are pure arithmetic. On their own they can be checked directly,
 * and three other modules that need to measure an entity no longer have to
 * import the whole drafting engine to do it.
 *
 * Two things come from `core`, and both for a reason worth stating. Curved
 * entities are measured by tessellating them, and `entityToPath` is already
 * the one place that knows how each entity kind becomes points, so measuring
 * against a second copy of that knowledge would be how the two quietly
 * disagree. And `uid` is imported rather than reimplemented because it carries
 * a module-level sequence: a private counter here would restart at one and
 * could hand an offset entity an id the document had already issued.
 */
import { uid } from '../core/doc.js';
import { entityToPath } from '../core/geometry.js';

export function fmt(v, p = 3) {
  if (!Number.isFinite(v)) return '–';
  const a = Math.abs(v);
  const s = a >= 1000 ? v.toFixed(1) : a >= 10 ? v.toFixed(2) : v.toFixed(p);
  return s.replace(/\.?0+$/, '') || '0';
}

const TAU = Math.PI * 2;
const D2R = Math.PI / 180;

export function dist(a, b) { return Math.hypot(b[0] - a[0], b[1] - a[1]); }

export function translateEntity(e, dx, dy) {
  const mv = (p) => { p[0] += dx; p[1] += dy; };
  if (e.a) mv(e.a); if (e.b) mv(e.b);
  if (e.c) mv(e.c); if (e.p) mv(e.p);
  if (e.p1) mv(e.p1); if (e.p2) mv(e.p2);
  if (e.pts) for (const p of e.pts) mv(p);
  return e;
}

export function rotateEntity(e, cx, cy, deg) {
  const a = deg * D2R, ca = Math.cos(a), sa = Math.sin(a);
  const rt = (p) => {
    const x = p[0] - cx, y = p[1] - cy;
    p[0] = cx + x * ca - y * sa;
    p[1] = cy + x * sa + y * ca;
  };

  // A rotated rectangle is no longer axis aligned, so it becomes a polyline.
  // This has to happen before anything is rotated, not after. A rect stores
  // one diagonal, and its four corners are only at (x1,y1) (x2,y1) (x2,y2)
  // (x1,y2) while that diagonal is still axis aligned; reading them from a
  // diagonal that has already been turned builds an upright box through two
  // rotated points, which is a different rectangle with different side
  // lengths, and then turns it a second time. Promoting first means the
  // corners are the real ones and the general pass below rotates them once.
  if (e.type === 'rect') {
    const [x1, y1] = e.a, [x2, y2] = e.b;
    e.type = 'polyline';
    e.pts = [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
    e.closed = true;
    delete e.a; delete e.b;
  }

  if (e.a) rt(e.a); if (e.b) rt(e.b);
  if (e.c) rt(e.c); if (e.p) rt(e.p);
  if (e.p1) rt(e.p1); if (e.p2) rt(e.p2);
  if (e.pts) for (const p of e.pts) rt(p);
  if (e.type === 'arc') { e.a0 += a; e.a1 += a; }
  if (e.type === 'ellipse' || e.type === 'polygon' || e.type === 'text') e.rot = (e.rot || 0) + deg;
  return e;
}

export function scaleEntity(e, cx, cy, k) {
  const sc = (p) => { p[0] = cx + (p[0] - cx) * k; p[1] = cy + (p[1] - cy) * k; };
  if (e.a) sc(e.a); if (e.b) sc(e.b);
  if (e.c) sc(e.c); if (e.p) sc(e.p);
  if (e.p1) sc(e.p1); if (e.p2) sc(e.p2);
  if (e.pts) for (const p of e.pts) sc(p);
  if (e.r !== undefined) e.r *= k;
  if (e.rx !== undefined) e.rx *= k;
  if (e.ry !== undefined) e.ry *= k;
  if (e.rad !== undefined) e.rad *= k;
  if (e.size !== undefined) e.size *= k;
  if (e.off !== undefined) e.off *= k;
  return e;
}

export function mirrorEntity(e, axis, at) {
  const mx = (p) => { if (axis === 'x') p[0] = 2 * at - p[0]; else p[1] = 2 * at - p[1]; };
  if (e.a) mx(e.a); if (e.b) mx(e.b);
  if (e.c) mx(e.c); if (e.p) mx(e.p);
  if (e.p1) mx(e.p1); if (e.p2) mx(e.p2);
  if (e.pts) for (const p of e.pts) mx(p);
  if (e.type === 'arc') {
    const a0 = e.a0, a1 = e.a1;
    if (axis === 'x') { e.a0 = Math.PI - a1; e.a1 = Math.PI - a0; }
    else { e.a0 = -a1; e.a1 = -a0; }
  }
  return e;
}

export function entityPoints(e) {
  const path = entityToPath(e, 24);
  if (path) return path.pts;
  if (e.type === 'point') return [e.p];
  if (e.type === 'text') return [e.p];
  if (e.type === 'dim') return [e.a, e.b, e.c, e.p1, e.p2].filter(Boolean);
  return [];
}

export function entityBBox(e) {
  const pts = entityPoints(e);
  if (!pts.length) return null;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const p of pts) { x1 = Math.min(x1, p[0]); y1 = Math.min(y1, p[1]); x2 = Math.max(x2, p[0]); y2 = Math.max(y2, p[1]); }
  return [x1, y1, x2, y2];
}

function distToSeg(p, a, b) {
  const vx = b[0] - a[0], vy = b[1] - a[1];
  const l2 = vx * vx + vy * vy;
  if (l2 < 1e-12) return dist(p, a);
  let t = ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * vx), p[1] - (a[1] + t * vy));
}

export function distanceToEntity(e, p) {
  switch (e.type) {
    case 'line': return distToSeg(p, e.a, e.b);
    case 'point': return dist(p, e.p);
    case 'text': return dist(p, e.p) < (e.size || 6) * 2 ? 0 : dist(p, e.p);
    case 'circle': return Math.abs(dist(p, e.c) - e.r);
    case 'arc': {
      let a = Math.atan2(p[1] - e.c[1], p[0] - e.c[0]);
      let a0 = e.a0, a1 = e.a1;
      if (a1 <= a0) a1 += TAU;
      while (a < a0) a += TAU;
      if (a > a1) {
        return Math.min(
          dist(p, [e.c[0] + e.r * Math.cos(a0), e.c[1] + e.r * Math.sin(a0)]),
          dist(p, [e.c[0] + e.r * Math.cos(a1), e.c[1] + e.r * Math.sin(a1)]),
        );
      }
      return Math.abs(dist(p, e.c) - e.r);
    }
    case 'dim': {
      const anchors = [e.a, e.b, e.c].filter(Boolean);
      if (!anchors.length) return null;
      return Math.min(...anchors.map(q => dist(p, q)));
    }
    default: {
      const path = entityToPath(e, 48);
      if (!path) return null;
      let best = Infinity;
      const n = path.pts.length;
      for (let i = 0; i + 1 < n; i++) best = Math.min(best, distToSeg(p, path.pts[i], path.pts[i + 1]));
      if (path.closed && n > 2) best = Math.min(best, distToSeg(p, path.pts[n - 1], path.pts[0]));
      return best;
    }
  }
}

export function nearestOnEntity(e, p) {
  const path = entityToPath(e, 32);
  if (!path) return null;
  let best = null, bd = Infinity;
  const pts = path.pts;
  const segs = path.closed ? pts.length : pts.length - 1;
  for (let i = 0; i < segs; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const vx = b[0] - a[0], vy = b[1] - a[1];
    const l2 = vx * vx + vy * vy;
    if (l2 < 1e-12) continue;
    let t = ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / l2;
    t = Math.max(0, Math.min(1, t));
    const q = [a[0] + t * vx, a[1] + t * vy];
    const d = dist(p, q);
    if (d < bd) { bd = d; best = q; }
  }
  return best;
}

export function segIntersect(a, b, c, d) {
  const r = [b[0] - a[0], b[1] - a[1]];
  const s = [d[0] - c[0], d[1] - c[1]];
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-12) return null;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den;
  const u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return [a[0] + t * r[0], a[1] + t * r[1]];
}

export function pointLineSignedDistance(a, b, p) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L = Math.hypot(dx, dy) || 1;
  return ((p[0] - a[0]) * (-dy) + (p[1] - a[1]) * dx) / L;
}

export function arcFrom3(p1, p2, p3) {
  const ax = p1[0], ay = p1[1], bx = p2[0], by = p2[1], cx = p3[0], cy = p3[1];
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-9) return null;
  const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
  const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
  const c = [ux, uy];
  const r = Math.hypot(ax - ux, ay - uy);
  let a0 = Math.atan2(ay - uy, ax - ux);
  let am = Math.atan2(by - uy, bx - ux);
  let a1 = Math.atan2(cy - uy, cx - ux);
  const norm = (x) => { while (x < 0) x += TAU; while (x >= TAU) x -= TAU; return x; };
  a0 = norm(a0); am = norm(am); a1 = norm(a1);
  const ccwSpan = norm(a1 - a0);
  const midSpan = norm(am - a0);
  if (midSpan <= ccwSpan) return { c, r, a0, a1 };
  return { c, r, a0: a1, a1: a0 };
}

export function offsetDistanceFor(e, p) {
  if (e.type === 'circle' || e.type === 'arc') return Math.hypot(p[0] - e.c[0], p[1] - e.c[1]) - e.r;
  if (e.type === 'line') return pointLineSignedDistance(e.a, e.b, p);
  const d = distanceToEntity(e, p);
  return d === null ? 0 : d;
}

export function offsetEntity(e, d) {
  const c = structuredClone(e);
  c.id = uid('e');
  switch (e.type) {
    case 'circle':
    case 'arc':
      c.r = Math.max(1e-4, e.r + d);
      return c;
    case 'line': {
      const dx = e.b[0] - e.a[0], dy = e.b[1] - e.a[1];
      const L = Math.hypot(dx, dy) || 1;
      const nx = -dy / L * d, ny = dx / L * d;
      c.a = [e.a[0] + nx, e.a[1] + ny];
      c.b = [e.b[0] + nx, e.b[1] + ny];
      return c;
    }
    case 'rect': {
      const x1 = Math.min(e.a[0], e.b[0]) - d, x2 = Math.max(e.a[0], e.b[0]) + d;
      const y1 = Math.min(e.a[1], e.b[1]) - d, y2 = Math.max(e.a[1], e.b[1]) + d;
      if (x2 <= x1 || y2 <= y1) return null;
      c.a = [x1, y1]; c.b = [x2, y2];
      return c;
    }
    case 'polygon':
      c.r = Math.max(1e-4, e.r + d);
      return c;
    case 'ellipse':
      c.rx = Math.max(1e-4, e.rx + d); c.ry = Math.max(1e-4, e.ry + d);
      return c;
    default:
      return null;
  }
}
