/**
 * Shop drawings, generated from the model.
 *
 * This is the gap that comes up most often and is met least well. Blender can
 * make the part look beautiful and cannot dimension it. AutoCAD's 3D is widely
 * called second-class. SolidWorks draws properly and costs a seat. And what a
 * shop actually needs to cut metal is none of those things on its own: it is a
 * dimensioned orthographic drawing, with a title block, that says what the part
 * is made of and to what tolerance.
 *
 * So the model produces one. First-angle projection, three views and an
 * isometric, hidden lines removed, dimensioned automatically, with a hole table
 * and a title block, exported as DXF for a CAD system or SVG for anything with
 * a printer.
 *
 * Hidden-line removal is the hard part of any drawing generator, and this one
 * is honest about its method. Exact HLR wants a full edge-face intersection
 * pass and is a project in itself. Instead each projected edge is sampled along
 * its length and each sample is ray-cast back towards the viewer: blocked
 * samples are hidden, clear ones are visible, and consecutive runs are merged
 * back into segments. That is a standard sampling approach. It is exact at the
 * sample points and can round a corner shorter than its sample spacing, so the
 * spacing is stated and tightened where the drawing is dense. A sampled edge is
 * marked as such in the output.
 *
 * What this is not: a fully associative drawing with GD&T frames, section and
 * detail views, and a revision table. Those are a drawing *module*, and what is
 * here is the drawing itself: correct geometry, real dimensions, and a sheet a
 * machinist can work from.
 */
import * as THREE from 'three';
import { MATERIALS, UNITS, APP_NAME, APP_VERSION } from '../core/doc.js';
import { recognise, patchEdges } from './recognise.js';
import { processOf } from './process.js';
import { standards, limits } from './standards.js';

/* ------------------------------------------------------------- view frames */

/**
 * First-angle projection: the view you look at is placed on the far side from
 * the direction you look. Front bottom-left, top above it, right to its right.
 * The symbol in the title block says which convention is in use, because
 * getting that wrong mirrors the part.
 */
export const VIEWS = {
  front: { label: 'FRONT', dir: [0, 1, 0], up: [0, 0, 1], at: [0, 0] },
  top: { label: 'TOP', dir: [0, 0, -1], up: [0, 1, 0], at: [0, 1] },
  right: { label: 'RIGHT', dir: [-1, 0, 0], up: [0, 0, 1], at: [1, 0] },
  iso: { label: 'ISO', dir: [-1, 1, -1], up: [0, 0, 1], at: [1, 1], iso: true },
};

function frameFor(view) {
  const w = new THREE.Vector3(...view.dir).normalize();          // towards the viewer
  const upHint = new THREE.Vector3(...view.up);
  const u = new THREE.Vector3().crossVectors(upHint, w).normalize();
  const v = new THREE.Vector3().crossVectors(w, u).normalize();
  return { u, v, w };
}

/* ------------------------------------------------------------------- edges */

/**
 * Every edge worth drawing: the crease edges of each body, plus the silhouette
 * for this direction. A cylinder has no crease along its length, so without the
 * silhouette a drilled hole would appear as nothing at all.
 */
function edgesFor(bodies, frame, { creaseDeg = 24 } = {}) {
  const out = [];
  for (const b of bodies) {
    const geo = b.geometry.index ? b.geometry.toNonIndexed() : b.geometry;

    // Real model edges, as patch boundaries rather than a dihedral-angle test:
    // see patchEdges for why the angle test invents creases across flat faces.
    for (const e of patchEdges(geo, b.matrix, { smoothAngle: creaseDeg })) {
      out.push({ a: e.a, b: e.b, body: b });
    }

    // Silhouette: an edge whose two faces face opposite ways from here.
    for (const e of silhouette(geo, b.matrix, frame.w)) out.push({ ...e, body: b, silhouette: true });
  }
  return out;
}

function silhouette(geo, matrix, viewDir, tol = 1e-4) {
  const pos = geo.attributes.position;
  const key = (v) => `${Math.round(v.x / tol)},${Math.round(v.y / tol)},${Math.round(v.z / tol)}`;
  const edges = new Map();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();

  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    if (matrix) { a.applyMatrix4(matrix); b.applyMatrix4(matrix); c.applyMatrix4(matrix); }
    const n = new THREE.Vector3()
      .subVectors(b, a)
      .cross(new THREE.Vector3().subVectors(c, a));
    if (n.lengthSq() < 1e-18) continue;
    n.normalize();
    const facing = n.dot(viewDir) > 0;
    const tri = [a.clone(), b.clone(), c.clone()];
    for (let e = 0; e < 3; e++) {
      const p = tri[e], q = tri[(e + 1) % 3];
      const kp = key(p), kq = key(q);
      const k = kp < kq ? `${kp}|${kq}` : `${kq}|${kp}`;
      const rec = edges.get(k);
      if (rec) { rec.facings.push(facing); rec.normals.push(n.clone()); }
      else edges.set(k, { a: p, b: q, facings: [facing], normals: [n.clone()] });
    }
  }

  const out = [];
  for (const e of edges.values()) {
    // A single owner is not a mesh boundary here, it is a T-junction: the
    // neighbouring triangle's vertex landed partway along this edge, so the two
    // never matched. Emitting those was what drew long diagonal streaks across
    // every flat face. Genuine boundaries are handled by patchEdges, which can
    // tell the difference by testing whether the edge is covered in its plane.
    if (e.facings.length < 2) continue;
    if (!(e.facings.some(f => f) && e.facings.some(f => !f))) continue;

    // A silhouette needs the two faces to actually turn. Coplanar neighbours
    // that merely disagree are a winding artefact of the boolean's
    // triangulation, and taking them at face value draws streaks straight
    // across every flat face of the part.
    let turns = false;
    for (let i = 1; i < e.normals.length; i++) {
      if (Math.abs(e.normals[0].dot(e.normals[i])) < COPLANAR) { turns = true; break; }
    }
    if (turns) out.push({ a: e.a, b: e.b });
  }
  return out;
}

/** cos(0.25 degrees): tight enough to keep a 256-facet cylinder's silhouette. */
const COPLANAR = Math.cos((0.25 * Math.PI) / 180);

/* --------------------------------------------------- hidden-line removal */

/**
 * An occluder: every triangle projected into the view plane and binned on a
 * grid, so asking "is anything in front of this point" is a cell lookup rather
 * than a scan of the whole model.
 *
 * A Raycaster was the obvious first choice and the wrong one: three.js tests
 * every triangle of the target for every ray, and a five-hole plate needs tens
 * of thousands of rays, which took half a minute. Projecting once and binning
 * turns the same question into a point-in-triangle test against a handful of
 * candidates, and the answer is identical.
 */
function makeOccluder(bodies, frame, { cells = 96 } = {}) {
  const tris = [];
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  const p = new THREE.Vector3();

  for (const b of bodies) {
    const geo = b.geometry.index ? b.geometry.toNonIndexed() : b.geometry;
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i += 3) {
      const t = [];
      for (let k = 0; k < 3; k++) {
        p.fromBufferAttribute(pos, i + k);
        if (b.matrix) p.applyMatrix4(b.matrix);
        const u = p.dot(frame.u), v = p.dot(frame.v), w = p.dot(frame.w);
        t.push(u, v, w);
        if (u < minU) minU = u; if (u > maxU) maxU = u;
        if (v < minV) minV = v; if (v > maxV) maxV = v;
      }
      // A triangle seen edge-on cannot occlude anything.
      const area2 = (t[3] - t[0]) * (t[7] - t[1]) - (t[6] - t[0]) * (t[4] - t[1]);
      if (Math.abs(area2) < 1e-12) continue;
      tris.push(t);
    }
  }
  if (!tris.length) return { hiddenAt: () => false, empty: true };

  const spanU = Math.max(1e-6, maxU - minU);
  const spanV = Math.max(1e-6, maxV - minV);
  const grid = new Array(cells * cells);
  const cellOf = (u, v) => {
    const cu = Math.min(cells - 1, Math.max(0, Math.floor(((u - minU) / spanU) * cells)));
    const cv = Math.min(cells - 1, Math.max(0, Math.floor(((v - minV) / spanV) * cells)));
    return cv * cells + cu;
  };

  for (let i = 0; i < tris.length; i++) {
    const t = tris[i];
    const u0 = Math.min(t[0], t[3], t[6]), u1 = Math.max(t[0], t[3], t[6]);
    const v0 = Math.min(t[1], t[4], t[7]), v1 = Math.max(t[1], t[4], t[7]);
    const cu0 = Math.floor(((u0 - minU) / spanU) * cells), cu1 = Math.floor(((u1 - minU) / spanU) * cells);
    const cv0 = Math.floor(((v0 - minV) / spanV) * cells), cv1 = Math.floor(((v1 - minV) / spanV) * cells);
    for (let cv = Math.max(0, cv0); cv <= Math.min(cells - 1, cv1); cv++) {
      for (let cu = Math.max(0, cu0); cu <= Math.min(cells - 1, cu1); cu++) {
        const k = cv * cells + cu;
        (grid[k] || (grid[k] = [])).push(i);
      }
    }
  }

  return {
    empty: false,
    /** Is any triangle nearer the viewer than depth `w` at (u, v)? */
    hiddenAt(u, v, w, eps) {
      const bucket = grid[cellOf(u, v)];
      if (!bucket) return false;
      for (const i of bucket) {
        const t = tris[i];
        // Barycentric point-in-triangle in the view plane.
        const d = (t[4] - t[7]) * (t[0] - t[6]) + (t[6] - t[3]) * (t[1] - t[7]);
        if (Math.abs(d) < 1e-12) continue;
        const l1 = ((t[4] - t[7]) * (u - t[6]) + (t[6] - t[3]) * (v - t[7])) / d;
        if (l1 < -1e-9 || l1 > 1 + 1e-9) continue;
        const l2 = ((t[7] - t[1]) * (u - t[6]) + (t[0] - t[6]) * (v - t[7])) / d;
        if (l2 < -1e-9 || l2 > 1 + 1e-9) continue;
        const l3 = 1 - l1 - l2;
        if (l3 < -1e-9 || l3 > 1 + 1e-9) continue;
        const tw = l1 * t[2] + l2 * t[5] + l3 * t[8];
        if (tw > w + eps) return true;
      }
      return false;
    },
  };
}

/**
 * Split each edge into visible and hidden runs.
 *
 * The depth tolerance is the one tuning constant, and it scales with the model
 * so the same code works on a 4mm part and a 2m one. Without it every edge
 * would be occluded by the very faces it belongs to.
 */
function classify(edges, frame, occ, { samples = 10, sizeHint = 100 } = {}) {
  // Generous enough that a face cannot occlude the rim lying exactly on it,
  // tight enough that a real 1mm step still reads as hidden.
  const eps = Math.max(1e-4, sizeHint * 3e-3);
  const p = new THREE.Vector3();

  const out = [];
  for (const e of edges) {
    const len = e.a.distanceTo(e.b);
    const n = Math.max(3, Math.min(40, Math.ceil(samples * (len / Math.max(1, sizeHint * 0.25)))));
    const flags = [];
    for (let i = 0; i <= n; i++) {
      p.lerpVectors(e.a, e.b, i / n);
      flags.push(!occ.hiddenAt(p.dot(frame.u), p.dot(frame.v), p.dot(frame.w), eps));
    }
    // Merge runs of the same visibility back into segments.
    let start = 0;
    for (let i = 1; i <= flags.length; i++) {
      if (i === flags.length || flags[i] !== flags[start]) {
        const t0 = Math.max(0, (start - 0.5) / n);
        const t1 = Math.min(1, (i - 0.5) / n);
        if (t1 > t0) {
          out.push({
            a: new THREE.Vector3().lerpVectors(e.a, e.b, t0),
            b: new THREE.Vector3().lerpVectors(e.a, e.b, t1),
            visible: flags[start],
            sampled: true,
          });
        }
        start = i;
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------ projection */

const to2 = (p, frame, origin) => {
  const d = new THREE.Vector3().subVectors(p, origin);
  return [d.dot(frame.u), d.dot(frame.v)];
};

/**
 * Build one view: projected, classified segments plus the circles that belong
 * in it, in the view's own 2D millimetres.
 */
export function buildView(bodies, viewKey, { origin, holes = [], hlr = true, sizeHint = 100 }) {
  const view = VIEWS[viewKey];
  const frame = frameFor(view);
  // Merge in 3D before classifying, not after. The boolean engine splits one
  // physical edge into dozens of fragments, and ray-casting each fragment
  // separately is what made an early version of this take a minute and a half
  // on a five-hole plate. Merging first cuts the ray count by two orders of
  // magnitude and changes nothing about the result.
  const raw = mergeCollinear3D(edgesFor(bodies, frame));
  const classified = hlr
    ? classify(raw, frame, makeOccluder(bodies, frame), { sizeHint })
    : raw.map(e => ({ ...e, visible: true, sampled: false }));

  const raw2d = [];
  for (const e of classified) {
    const a = to2(e.a, frame, origin);
    const b = to2(e.b, frame, origin);
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-4) continue;
    raw2d.push({ a, b, visible: e.visible });
  }
  const segs = mergeCollinear(raw2d);

  // A cylinder whose axis points at the viewer draws as a circle; seen edge-on
  // it is already covered by the silhouette.
  const circles = [];
  for (const h of holes) {
    const along = Math.abs(h.axis.dot(frame.w));
    if (along < 0.97) continue;
    circles.push({
      at: to2(h.centre, frame, origin),
      r: h.radius,
      diameter: h.diameter,
      nominal: h.nominal?.label || null,
      bore: !!h.concave,
    });
  }

  // Having drawn a real circle, the 48 straight fragments that traced the same
  // tessellated rim are noise: they draw a visibly faceted circle on top of a
  // smooth one, and they dominate the file size of any round part.
  // An isometric view is conventionally drawn without hidden lines: it is there
  // to show the shape, and dashed lines through a pictorial view only clutter it.
  const shown = view.iso ? segs.filter(s => s.visible) : segs;
  const kept = shown.filter(s => !circles.some(c => onCircle(c, s)));

  const boxFrom = (list, circleList) => {
    let bb = null;
    const add = (x, y) => {
      if (!bb) bb = { minX: x, maxX: x, minY: y, maxY: y };
      else {
        bb.minX = Math.min(bb.minX, x); bb.maxX = Math.max(bb.maxX, x);
        bb.minY = Math.min(bb.minY, y); bb.maxY = Math.max(bb.maxY, y);
      }
    };
    for (const s of list) { add(s.a[0], s.a[1]); add(s.b[0], s.b[1]); }
    for (const c of circleList) { add(c.at[0] - c.r, c.at[1] - c.r); add(c.at[0] + c.r, c.at[1] + c.r); }
    return bb;
  };

  const box = boxFrom(kept, circles);

  return { key: viewKey, label: view.label, iso: !!view.iso, segs: kept, circles, box, at: view.at, frame };
}

/**
 * Collapse collinear, overlapping 3D edges into single edges.
 *
 * Same algorithm as the 2D merge below, one dimension up: key each edge by the
 * infinite line it lies on, then merge the members of that line as intervals
 * along it. The key is the direction with its sign normalised plus the point on
 * the line closest to the origin, both quantised.
 */
function mergeCollinear3D(edges, { dirTol = 0.002, posTol = 0.01, gap = 0.02 } = {}) {
  const lines = new Map();
  const d = new THREE.Vector3();
  const foot = new THREE.Vector3();

  for (const e of edges) {
    d.subVectors(e.b, e.a);
    const len = d.length();
    if (len < 1e-6) continue;
    d.divideScalar(len);
    // A line and its reverse are the same line.
    if (d.x < -1e-9 || (Math.abs(d.x) <= 1e-9 && (d.y < -1e-9 || (Math.abs(d.y) <= 1e-9 && d.z < 0)))) d.negate();
    const t0 = e.a.dot(d);
    foot.copy(e.a).addScaledVector(d, -t0);           // closest point on the line to the origin
    const key = `${q(d.x, dirTol)},${q(d.y, dirTol)},${q(d.z, dirTol)}|${q(foot.x, posTol)},${q(foot.y, posTol)},${q(foot.z, posTol)}`;

    let rec = lines.get(key);
    if (!rec) { rec = { dir: d.clone(), foot: foot.clone(), spans: [], silhouette: false }; lines.set(key, rec); }
    const t1 = e.b.dot(rec.dir);
    const ta = e.a.dot(rec.dir);
    rec.spans.push([Math.min(ta, t1), Math.max(ta, t1)]);
    if (e.silhouette) rec.silhouette = true;
  }

  const out = [];
  for (const rec of lines.values()) {
    rec.spans.sort((x, y) => x[0] - y[0]);
    let cur = rec.spans[0].slice();
    const merged = [];
    for (let i = 1; i < rec.spans.length; i++) {
      const sp = rec.spans[i];
      if (sp[0] <= cur[1] + gap) cur[1] = Math.max(cur[1], sp[1]);
      else { merged.push(cur); cur = sp.slice(); }
    }
    merged.push(cur);
    for (const [t0, t1] of merged) {
      if (t1 - t0 < 1e-4) continue;
      out.push({
        a: rec.foot.clone().addScaledVector(rec.dir, t0),
        b: rec.foot.clone().addScaledVector(rec.dir, t1),
        silhouette: rec.silhouette,
      });
    }
  }
  return out;
}

const q = (v, tol) => Math.round(v / tol);

/** Does this segment merely trace the rim of a circle we have already drawn? */
function onCircle(c, s, tol = 0.12) {
  for (const p of [s.a, s.b]) {
    const d = Math.hypot(p[0] - c.at[0], p[1] - c.at[1]);
    if (Math.abs(d - c.r) > tol) return false;
  }
  // A chord of a 48-gon is short; a long line that happens to touch the rim
  // twice is a real edge and must survive.
  return Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]) < c.r * 0.7;
}

/**
 * Collapse collinear, overlapping segments into single lines.
 *
 * The boolean engine splits a flat face into many triangles, so one physical
 * edge of the part arrives as dozens of fragments and the sampling pass splits
 * them again. Drawn as-is a plate is a thousand overlapping strokes: slow to
 * render, enormous as a file, and visibly heavier where fragments pile up.
 *
 * Each segment is keyed by its infinite line (direction and perpendicular
 * offset, both quantised) and its visibility, then the members of each line are
 * projected onto it and merged as intervals. What comes out is the drawing an
 * engineer would have drawn.
 */
function mergeCollinear(segs, { angleTol = 0.4, offsetTol = 0.02, gap = 0.05 } = {}) {
  const lines = new Map();
  for (const s of segs) {
    let dx = s.b[0] - s.a[0], dy = s.b[1] - s.a[1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    dx /= len; dy /= len;
    // Direction and its reverse are the same line, so normalise the sign.
    if (dx < -1e-9 || (Math.abs(dx) <= 1e-9 && dy < 0)) { dx = -dx; dy = -dy; }
    const angle = Math.atan2(dy, dx);
    const offset = -dy * s.a[0] + dx * s.a[1];        // perpendicular distance from the origin
    const key = `${Math.round(angle / (angleTol * Math.PI / 180))}|${Math.round(offset / offsetTol)}|${s.visible ? 1 : 0}`;
    let rec = lines.get(key);
    if (!rec) { rec = { dx, dy, visible: s.visible, spans: [] }; lines.set(key, rec); }
    const t0 = s.a[0] * dx + s.a[1] * dy;
    const t1 = s.b[0] * dx + s.b[1] * dy;
    rec.spans.push([Math.min(t0, t1), Math.max(t0, t1)]);
    rec.ax = rec.ax ?? s.a[0]; rec.ay = rec.ay ?? s.a[1];
    rec.base = rec.base ?? [s.a[0] - t0 * dx, s.a[1] - t0 * dy];
  }

  const out = [];
  for (const rec of lines.values()) {
    rec.spans.sort((a, b) => a[0] - b[0]);
    let cur = rec.spans[0].slice();
    const merged = [];
    for (let i = 1; i < rec.spans.length; i++) {
      const s = rec.spans[i];
      if (s[0] <= cur[1] + gap) cur[1] = Math.max(cur[1], s[1]);
      else { merged.push(cur); cur = s.slice(); }
    }
    merged.push(cur);
    for (const [t0, t1] of merged) {
      if (t1 - t0 < 1e-4) continue;
      out.push({
        a: [rec.base[0] + rec.dx * t0, rec.base[1] + rec.dy * t0],
        b: [rec.base[0] + rec.dx * t1, rec.base[1] + rec.dy * t1],
        visible: rec.visible,
      });
    }
  }

  // A hidden run underneath a visible one is not drawn: the solid line wins.
  const visible = out.filter(s => s.visible);
  const hidden = out.filter(s => !s.visible).filter(h => !visible.some(v => covers(v, h)));
  return [...visible, ...hidden];
}

function covers(v, h, tol = 0.05) {
  const dx = v.b[0] - v.a[0], dy = v.b[1] - v.a[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return false;
  const ux = dx / len, uy = dy / len;
  for (const p of [h.a, h.b]) {
    const px = p[0] - v.a[0], py = p[1] - v.a[1];
    const perp = Math.abs(-uy * px + ux * py);
    const along = ux * px + uy * py;
    if (perp > tol || along < -tol || along > len + tol) return false;
  }
  return true;
}

/* ------------------------------------------------------------ dimensions */

/**
 * Overall dimensions on each orthographic view, and a diameter callout on the
 * largest circle. Deliberately restrained: a drawing that dimensions
 * everything is a drawing nobody can read, and the hole table carries the rest.
 */
function dimensionsFor(view) {
  if (view.iso || !view.box) return [];
  const b = view.box;
  const out = [
    { kind: 'h', from: [b.minX, b.minY], to: [b.maxX, b.minY], value: b.maxX - b.minX, off: -10 },
    { kind: 'v', from: [b.maxX, b.minY], to: [b.maxX, b.maxY], value: b.maxY - b.minY, off: 10 },
  ];
  const biggest = [...view.circles].sort((x, y) => y.r - x.r)[0];
  if (biggest) {
    out.push({
      kind: 'dia', at: biggest.at, r: biggest.r,
      value: biggest.diameter,
      label: `⌀${biggest.diameter.toFixed(2)}${biggest.nominal ? ` ${biggest.nominal}` : ''}`,
    });
  }
  return out;
}

/* ------------------------------------------------------------- the sheet */

export const SHEETS = {
  a4l: { label: 'A4 landscape', w: 297, h: 210 },
  a3l: { label: 'A3 landscape', w: 420, h: 297 },
  a2l: { label: 'A2 landscape', w: 594, h: 420 },
};

/**
 * Lay out the views on a sheet at a sensible standard scale and return
 * everything needed to draw it, in sheet millimetres.
 *
 * @param {object[]} bodies  { geometry, matrix, feature }
 * @param {object} opts
 */
export function buildSheet(bodies, {
  doc, build, sheet = 'a3l', views = ['front', 'top', 'right', 'iso'], hlr = true, scale = null,
} = {}) {
  const paper = SHEETS[sheet] || SHEETS.a3l;
  const margin = 10;
  const blockH = 34;

  // The model's own bounding box, so every view shares one origin and the
  // projections line up the way a drawing requires.
  const box = new THREE.Box3();
  for (const b of bodies) box.union(b.box || new THREE.Box3().setFromBufferAttribute(b.geometry.attributes.position));
  const origin = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const sizeHint = Math.max(size.x, size.y, size.z) || 100;

  // Holes are found once, in 3D, and then offered to whichever view can see
  // them face-on. Doing it per view would find the same hole three times.
  // Bosses as well as holes: a raised cylindrical pad is a circle on the view
  // that sees it face-on, and leaving it as 64 straight fragments both looks
  // faceted and dominates the file.
  let holes = [];
  try {
    for (const b of bodies) {
      const r = recognise(b.geometry, b.matrix, { maxTriangles: 80000 });
      holes.push(...r.cylinders.filter(c => c.full));
    }
  } catch { holes = []; }

  const built = views.map(k => buildView(bodies, k, { origin, holes, hlr, sizeHint }));

  // Cells: a 2x2 grid of view positions on the sheet.
  const cellW = (paper.w - margin * 2) / 2;
  const cellH = (paper.h - margin * 2 - blockH) / 2;

  // Pick the largest standard scale that fits every view in its cell.
  const worst = built.reduce((m, v) => {
    if (!v.box) return m;
    return Math.max(m, (v.box.maxX - v.box.minX) / (cellW * 0.72), (v.box.maxY - v.box.minY) / (cellH * 0.68));
  }, 0);
  const chosen = scale || standardScale(worst > 0 ? 1 / worst : 1);

  const placed = built.map((v) => {
    const cx = margin + cellW * (v.at[0] + 0.5);
    const cy = margin + blockH + cellH * (v.at[1] + 0.5);
    return {
      ...v,
      origin: [cx, cy],
      dims: dimensionsFor(v),
    };
  });

  return {
    paper, margin, blockH, scale: chosen,
    views: placed,
    holes,
    title: titleBlock(doc, build, bodies, chosen, sheet),
    sampledHLR: hlr,
  };
}

/** Drawing scales an engineer would recognise, never 1:3.47. */
const SCALES = [50, 20, 10, 5, 2, 1, 1 / 2, 1 / 2.5, 1 / 5, 1 / 10, 1 / 20, 1 / 50, 1 / 100];
function standardScale(fit) {
  for (const s of SCALES) if (s <= fit) return s;
  return SCALES[SCALES.length - 1];
}
export const scaleLabel = (s) => (s >= 1 ? `${Math.round(s)}:1` : `1:${Math.round(1 / s)}`);

function titleBlock(doc, build, bodies, scale, sheet) {
  const st = standards();
  const proc = processOf(doc.studio?.process || st.process);
  const lim = limits(proc);
  const mats = [...new Set(bodies.map(b => b.feature?.material).filter(Boolean))];
  const cfg = doc.configs?.list?.find(c => c.id === doc.configs.active);

  return {
    name: doc.meta.name,
    variant: cfg && cfg.id !== 'default' ? cfg.name : null,
    variantId: cfg?.id || 'default',
    author: doc.meta.author || st.author || '',
    material: mats.map(m => MATERIALS[m]?.name || m).join(', ') || '—',
    mass: build?.stats?.mass ?? 0,
    units: doc.meta.units,
    scale: scaleLabel(scale),
    sheet: SHEETS[sheet]?.label || sheet,
    date: new Date().toISOString().slice(0, 10),
    process: proc.label,
    tolerance: lim.tolerance,
    generator: `${APP_NAME} ${APP_VERSION}`,
    // First angle. Stated explicitly because the alternative mirrors the part.
    projection: 'FIRST ANGLE',
  };
}

/* ----------------------------------------------------------------- output */

/** The whole sheet as SVG: what gets shown on screen and sent to a printer. */
export function sheetToSVG(s, { dark = false } = {}) {
  const ink = dark ? '#e8eef7' : '#111';
  const thin = dark ? '#7b8797' : '#555';
  const L = [];
  L.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s.paper.w} ${s.paper.h}" width="100%">`);
  L.push(`<rect x="0" y="0" width="${s.paper.w}" height="${s.paper.h}" fill="${dark ? '#0d1218' : '#fff'}"/>`);
  L.push(`<rect x="${s.margin / 2}" y="${s.margin / 2}" width="${s.paper.w - s.margin}" height="${s.paper.h - s.margin}" fill="none" stroke="${ink}" stroke-width="0.5"/>`);

  // SVG y runs down the page and a drawing's y runs up it.
  const flip = (y) => s.paper.h - y;

  for (const v of s.views) {
    const [ox, oy] = v.origin;
    const X = (x) => ox + x * s.scale;
    const Y = (y) => flip(oy + y * s.scale);

    const solid = v.segs.filter(x => x.visible);
    const hidden = v.segs.filter(x => !x.visible);
    if (hidden.length) {
      L.push(`<g stroke="${thin}" stroke-width="0.18" stroke-dasharray="1.6 1.1" fill="none">`);
      for (const e of hidden) L.push(`<line x1="${f(X(e.a[0]))}" y1="${f(Y(e.a[1]))}" x2="${f(X(e.b[0]))}" y2="${f(Y(e.b[1]))}"/>`);
      L.push('</g>');
    }
    L.push(`<g stroke="${ink}" stroke-width="0.35" stroke-linecap="round" fill="none">`);
    for (const e of solid) L.push(`<line x1="${f(X(e.a[0]))}" y1="${f(Y(e.a[1]))}" x2="${f(X(e.b[0]))}" y2="${f(Y(e.b[1]))}"/>`);
    L.push('</g>');

    // The circles themselves. Drawn as real circles rather than as the 64
    // straight fragments the mesh carries: smoother, smaller, and what a CAD
    // system receiving the DXF expects to find.
    if (v.circles.length) {
      L.push(`<g stroke="${ink}" stroke-width="0.35" fill="none">`);
      for (const c of v.circles) {
        L.push(`<circle cx="${f(X(c.at[0]))}" cy="${f(Y(c.at[1]))}" r="${f(c.r * s.scale)}"/>`);
      }
      L.push('</g>');
    }

    // Centre marks, which is how a drawing says "this is a hole, drill here".
    L.push(`<g stroke="${ink}" stroke-width="0.18" stroke-dasharray="2 1 0.6 1" fill="none">`);
    for (const c of v.circles) {
      const m = (c.r + 1.8) * s.scale;
      L.push(`<line x1="${f(X(c.at[0]) - m / s.scale * s.scale)}" y1="${f(Y(c.at[1]))}" x2="${f(X(c.at[0]) + m)}" y2="${f(Y(c.at[1]))}"/>`);
      L.push(`<line x1="${f(X(c.at[0]))}" y1="${f(Y(c.at[1]) - m)}" x2="${f(X(c.at[0]))}" y2="${f(Y(c.at[1]) + m)}"/>`);
    }
    L.push('</g>');

    for (const d of v.dims) L.push(dimSVG(d, X, Y, s.scale, ink));

    L.push(`<text x="${f(ox)}" y="${f(flip(oy - (v.box ? (v.box.minY * s.scale) : 0) + 16))}" fill="${ink}" font-size="3.2" font-family="system-ui,sans-serif" text-anchor="middle" letter-spacing="0.4">${v.label}${v.iso ? '' : ''}</text>`);
  }

  L.push(titleSVG(s, ink, thin));
  L.push('</svg>');
  return L.join('\n');
}

const f = (v) => Math.round(v * 1000) / 1000;

function dimSVG(d, X, Y, scale, ink) {
  const t = (s) => `font-size="2.8" font-family="system-ui,sans-serif" fill="${ink}"`;
  if (d.kind === 'dia') {
    const x = X(d.at[0]), y = Y(d.at[1]);
    const lead = (d.r + 6) * scale;
    return `<g stroke="${ink}" stroke-width="0.18" fill="none">` +
      `<line x1="${f(x)}" y1="${f(y)}" x2="${f(x + lead)}" y2="${f(y - lead)}"/>` +
      `<line x1="${f(x + lead)}" y1="${f(y - lead)}" x2="${f(x + lead + 9)}" y2="${f(y - lead)}"/>` +
      `</g><text x="${f(x + lead + 1)}" y="${f(y - lead - 1.2)}" ${t()}>${d.label}</text>`;
  }
  const horiz = d.kind === 'h';
  const x1 = X(d.from[0]), y1 = Y(d.from[1]);
  const x2 = X(d.to[0]), y2 = Y(d.to[1]);
  const off = d.off;
  const ax = horiz ? x1 : x1 + off, ay = horiz ? y1 - off : y1;
  const bx = horiz ? x2 : x2 + off, by = horiz ? y2 - off : y2;
  // Extension lines stand off the part and overrun the dimension line, the way
  // they do on a drawing. Running them corner to corner draws a box round the
  // view, which is the giveaway of a generated drawing.
  const gap = 1.2, over = 1.6;
  const dir = Math.sign(off) || 1;
  const e1 = horiz
    ? [[x1, y1 - dir * gap], [ax, ay - dir * over]]
    : [[x1 + dir * gap, y1], [ax + dir * over, ay]];
  const e2 = horiz
    ? [[x2, y2 - dir * gap], [bx, by - dir * over]]
    : [[x2 + dir * gap, y2], [bx + dir * over, by]];
  const mid = [(ax + bx) / 2, (ay + by) / 2];
  const label = d.value.toFixed(d.value < 10 ? 2 : 1);
  const tick = (x, y) => `<line x1="${f(x - (horiz ? 1 : 1))}" y1="${f(y - (horiz ? 1 : 1))}" x2="${f(x + 1)}" y2="${f(y + 1)}"/>`;
  return `<g stroke="${ink}" stroke-width="0.18" fill="none">` +
    `<line x1="${f(e1[0][0])}" y1="${f(e1[0][1])}" x2="${f(e1[1][0])}" y2="${f(e1[1][1])}"/>` +
    `<line x1="${f(e2[0][0])}" y1="${f(e2[0][1])}" x2="${f(e2[1][0])}" y2="${f(e2[1][1])}"/>` +
    `<line x1="${f(ax)}" y1="${f(ay)}" x2="${f(bx)}" y2="${f(by)}"/>` +
    tick(ax, ay) + tick(bx, by) +
    `</g><text x="${f(mid[0])}" y="${f(mid[1] - (horiz ? 1 : 0))}" font-size="2.8" font-family="system-ui,sans-serif" fill="${ink}" text-anchor="middle"${horiz ? '' : ` transform="rotate(-90 ${f(mid[0])} ${f(mid[1])})"`}>${label}</text>`;
}

function titleSVG(s, ink, thin) {
  const t = s.title;
  const x0 = s.margin / 2, y0 = s.paper.h - s.margin / 2 - s.blockH;
  const w = s.paper.w - s.margin, h = s.blockH;
  const cell = (cx, cy, cw, label, value, big = false) =>
    `<line x1="${f(cx)}" y1="${f(cy)}" x2="${f(cx)}" y2="${f(cy + h / 2)}" stroke="${ink}" stroke-width="0.3"/>` +
    `<text x="${f(cx + 2)}" y="${f(cy + 4)}" font-size="2.1" fill="${thin}" font-family="system-ui,sans-serif" letter-spacing="0.3">${label}</text>` +
    `<text x="${f(cx + 2)}" y="${f(cy + 10.5)}" font-size="${big ? 4.6 : 3.1}" fill="${ink}" font-family="system-ui,sans-serif"${big ? ' font-weight="600"' : ''}>${esc(value)}</text>`;

  const cols = [0, 0.36, 0.52, 0.66, 0.80, 1].map(p => x0 + w * p);
  const L = [`<g><rect x="${f(x0)}" y="${f(y0)}" width="${f(w)}" height="${f(h)}" fill="none" stroke="${ink}" stroke-width="0.5"/>`];
  L.push(`<line x1="${f(x0)}" y1="${f(y0 + h / 2)}" x2="${f(x0 + w)}" y2="${f(y0 + h / 2)}" stroke="${ink}" stroke-width="0.3"/>`);

  L.push(cell(cols[0], y0, 0, 'PART', t.name, true));
  L.push(cell(cols[1], y0, 0, 'MATERIAL', t.material));
  L.push(cell(cols[2], y0, 0, 'MASS', `${t.mass.toFixed(3)} kg`));
  L.push(cell(cols[3], y0, 0, 'SCALE', t.scale));
  L.push(cell(cols[4], y0, 0, 'UNITS', t.units));

  const y1 = y0 + h / 2;
  L.push(cell(cols[0], y1, 0, 'VARIANT', t.variant || 'Default'));
  L.push(cell(cols[1], y1, 0, 'PROCESS', t.process));
  L.push(cell(cols[2], y1, 0, 'GENERAL TOL', `±${t.tolerance}`));
  L.push(cell(cols[3], y1, 0, 'PROJECTION', t.projection));
  L.push(cell(cols[4], y1, 0, 'DATE', t.date));

  L.push(`<text x="${f(x0 + w - 2)}" y="${f(y0 - 2)}" font-size="2.1" fill="${thin}" font-family="system-ui,sans-serif" text-anchor="end">${esc(t.generator)}${t.author ? ` · ${esc(t.author)}` : ''}${s.sampledHLR ? ' · hidden lines sampled' : ''}</text>`);
  L.push('</g>');
  return L.join('');
}

const esc = (v) => String(v ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

/**
 * The sheet as a drawing document this application can open in Draft, which is
 * also what makes DXF and SVG export free: both already exist for drawings.
 */
export function sheetToDraw(s) {
  const layers = [
    { id: 'lv', name: 'VISIBLE', color: '#e8eef7', visible: true, locked: false, weight: 2, style: 'solid' },
    { id: 'lh', name: 'HIDDEN', color: '#7b8797', visible: true, locked: false, weight: 1, style: 'dashed' },
    { id: 'lc', name: 'CENTRE', color: '#4da3ff', visible: true, locked: false, weight: 1, style: 'dashed' },
    { id: 'ld', name: 'DIMENSIONS', color: '#ffb454', visible: true, locked: false, weight: 1, style: 'solid' },
    { id: 'lt', name: 'TITLE', color: '#c9d3e0', visible: true, locked: false, weight: 1, style: 'solid' },
  ];
  const entities = [];
  let n = 0;
  const id = () => `d${(n++).toString(36)}`;

  for (const v of s.views) {
    const [ox, oy] = v.origin;
    const X = (x) => ox + x * s.scale;
    const Y = (y) => oy + y * s.scale;
    for (const e of v.segs) {
      entities.push({
        id: id(), type: 'line', layer: e.visible ? 'lv' : 'lh',
        a: [X(e.a[0]), Y(e.a[1])], b: [X(e.b[0]), Y(e.b[1])],
      });
    }
    for (const c of v.circles) {
      entities.push({ id: id(), type: 'circle', layer: 'lv', c: [X(c.at[0]), Y(c.at[1])], r: c.r * s.scale });
      const m = (c.r + 1.8) * s.scale;
      entities.push({ id: id(), type: 'line', layer: 'lc', a: [X(c.at[0]) - m, Y(c.at[1])], b: [X(c.at[0]) + m, Y(c.at[1])] });
      entities.push({ id: id(), type: 'line', layer: 'lc', a: [X(c.at[0]), Y(c.at[1]) - m], b: [X(c.at[0]), Y(c.at[1]) + m] });
    }
    for (const d of v.dims) {
      if (d.kind === 'dia') continue;
      const horiz = d.kind === 'h';
      const a = horiz ? [X(d.from[0]), Y(d.from[1]) + d.off] : [X(d.from[0]) + d.off, Y(d.from[1])];
      const b = horiz ? [X(d.to[0]), Y(d.to[1]) + d.off] : [X(d.to[0]) + d.off, Y(d.to[1])];
      entities.push({ id: id(), type: 'dim', layer: 'ld', kind: horiz ? 'h' : 'v', a, b, off: 0, size: 3.5 });
    }
    entities.push({
      id: id(), type: 'text', layer: 'lt',
      p: [ox, oy + (v.box ? v.box.minY * s.scale : 0) - 14],
      text: v.label, size: 4, rot: 0,
    });
  }

  const t = s.title;
  entities.push({
    id: id(), type: 'text', layer: 'lt', p: [s.margin, s.margin + 4],
    text: `${t.name}  |  ${t.material}  |  ${t.scale}  |  ${t.units}  |  ${t.projection}  |  ${t.date}`,
    size: 4, rot: 0,
  });

  return { layers, entities, activeLayer: 'lv' };
}
