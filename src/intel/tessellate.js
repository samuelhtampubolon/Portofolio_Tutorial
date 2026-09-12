/**
 * Spending triangles where the surface actually curves.
 *
 * The complaint that runs through every CAD-to-render handoff is the same:
 * exports arrive with thousands of micro-triangles on a perfectly flat face and
 * a visibly faceted cylinder next to it. The cause is that segment counts are
 * set per feature at modelling time, when what matters is the tolerance of the
 * thing being exported — and a face that is flat needs two triangles no matter
 * how finely the model was built.
 *
 * So export gets its own tessellation policy, expressed the way engineers
 * already think about it: chord tolerance. "No point on this mesh is more than
 * 0.05mm from the surface it represents." That single number decides the
 * segment count of every curved feature independently, so a 3mm bolt hole and a
 * 200mm flange each get exactly the segments they need and no more.
 *
 * Two operations, in this order:
 *
 *   Choose segment counts from the tolerance, per feature, before rebuilding.
 *   This is where the real saving is, because it never creates the triangles
 *   in the first place.
 *
 *   Weld and drop degenerates afterwards. Boolean output carries duplicated
 *   vertices at every split and slivers of near-zero area, and both survive
 *   into the file as waste.
 *
 * The tolerance is stated in the exported package, because a mesh without its
 * tolerance is a number without a unit.
 */
import * as THREE from 'three';
import { CATALOG } from '../core/doc.js';

/** Presets in the language of the job rather than of the renderer. */
export const QUALITY = {
  draft: { label: 'Draft', tol: 0.25, note: 'Quick look, small file. Visible faceting on small holes.' },
  standard: { label: 'Standard', tol: 0.05, note: 'What most 3D printing and visualisation wants.' },
  fine: { label: 'Fine', tol: 0.01, note: 'Smooth at close range and for machining setup. Larger files.' },
  source: { label: 'As modelled', tol: null, note: 'Whatever segment counts the features already carry.' },
};

/**
 * Segments needed to hold a chord tolerance on a circle of radius r.
 *
 * The sagitta of a chord subtending angle t on radius r is r(1 - cos(t/2)).
 * Setting that equal to the tolerance and solving gives the angle, and 2π over
 * that angle is the segment count. Everything else here is clamping.
 */
export function segmentsFor(radius, tol, { min = 8, max = 256 } = {}) {
  if (!(radius > 0) || !(tol > 0)) return max;
  if (tol >= radius) return min;
  const theta = 2 * Math.acos(1 - tol / radius);
  return Math.max(min, Math.min(max, Math.ceil((2 * Math.PI) / theta)));
}

/** Which parameter of a feature type is the radius that governs its tessellation. */
const RADIUS_OF = {
  cylinder: (p) => p.r,
  sphere: (p) => p.r,
  cone: (p) => Math.max(p.r1, p.r2),
  torus: (p) => p.R + p.r,
  tube: (p) => p.ro,
  prism: (p) => p.r,
  pyramid: (p) => p.r,
  helix: (p) => p.R,
  plate: (p) => p.fillet,
  revolve: () => null,     // driven by the profile, not by a radius
};

/**
 * Rewrite a document's segment counts for a chord tolerance.
 *
 * Returns a copy: export must not mutate the document the user is editing, and
 * a tolerance chosen for one export must not silently become the model's own.
 *
 * @returns {{ doc: object, changes: object[], before: number, after: number }}
 */
export function retessellate(doc, tol, { scope = null } = {}) {
  const out = structuredClone(doc);
  const changes = [];
  if (!(tol > 0)) return { doc: out, changes, before: 0, after: 0 };

  let before = 0, after = 0;
  for (const f of out.features) {
    const radiusOf = RADIUS_OF[f.type];
    if (!radiusOf) continue;
    if (scope && !scope.has(f.id)) continue;

    // A radius driven by an expression is not a number here, and guessing at it
    // would be worse than leaving the feature alone.
    const r = numeric(radiusOf(f.params));
    if (r == null) continue;

    for (const key of ['seg', 'tseg']) {
      const cur = f.params[key];
      if (typeof cur !== 'number') continue;
      // The tube segment of a torus follows its own, much smaller radius.
      const rr = key === 'tseg' && f.type === 'torus' ? numeric(f.params.r) ?? r : r;
      const want = segmentsFor(rr, tol, { min: minFor(f.type, key) });
      before += cur;
      after += want;
      if (want !== cur) {
        f.params[key] = want;
        changes.push({ name: f.name, type: f.type, key, from: cur, to: want, radius: rr });
      }
    }
  }
  return { doc: out, changes, before, after };
}

function minFor(type, key) {
  const cat = CATALOG[type];
  const field = cat?.fields?.find(x => x.key === key);
  return Math.max(3, field?.min ?? 3);
}

const numeric = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/* ------------------------------------------------------------- cleanup */

/**
 * Weld coincident vertices and drop degenerate triangles.
 *
 * Boolean output is non-indexed with a duplicated vertex at every split, and
 * carries slivers whose area rounds to nothing. Both are pure file size, and
 * the slivers additionally break normal calculation in whatever reads the mesh.
 *
 * @returns {{ geometry: THREE.BufferGeometry, stats: object }}
 */
export function cleanMesh(geometry, { weld = 1e-5, minArea = 1e-9 } = {}) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const pos = g.attributes.position;
  const quant = 1 / weld;
  const key = (x, y, z) => `${Math.round(x * quant)},${Math.round(y * quant)},${Math.round(z * quant)}`;

  const map = new Map();
  const verts = [];
  const index = [];
  let dropped = 0;

  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);

    const area = new THREE.Vector3()
      .subVectors(b, a)
      .cross(new THREE.Vector3().subVectors(c, a))
      .length() / 2;
    if (area < minArea) { dropped++; continue; }

    const ids = [];
    for (const v of [a, b, c]) {
      const k = key(v.x, v.y, v.z);
      let id = map.get(k);
      if (id === undefined) {
        id = verts.length / 3;
        map.set(k, id);
        verts.push(v.x, v.y, v.z);
      }
      ids.push(id);
    }
    // Welding can collapse a thin triangle into a line; that is a degenerate
    // too, and it has to go after welding rather than before.
    if (ids[0] === ids[1] || ids[1] === ids[2] || ids[0] === ids[2]) { dropped++; continue; }
    index.push(ids[0], ids[1], ids[2]);
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  out.setIndex(index);
  out.computeVertexNormals();
  out.computeBoundingBox();
  out.computeBoundingSphere();

  return {
    geometry: out,
    stats: {
      trianglesBefore: pos.count / 3,
      trianglesAfter: index.length / 3,
      verticesBefore: pos.count,
      verticesAfter: verts.length / 3,
      dropped,
    },
  };
}

/* -------------------------------------------------------- unit sanity */

/**
 * Was this mesh authored in the units we are about to read it as?
 *
 * Nothing in an STL or an OBJ says. The file is numbers, and the convention is
 * that everyone agrees offline — which is why a metre-scale model arriving as
 * millimetres is the single most common import failure in the industry.
 *
 * There is no way to know for certain, so this does not guess silently. It
 * reports the size the file implies under each plausible interpretation and
 * says which one lands in the range real parts occupy, leaving the choice with
 * the person who knows what they asked the supplier for.
 */
export function unitSanity(sizeMm) {
  const max = Math.max(sizeMm.x, sizeMm.y, sizeMm.z);
  const options = [
    { unit: 'mm', scale: 1 },
    { unit: 'cm', scale: 10 },
    { unit: 'm', scale: 1000 },
    { unit: 'in', scale: 25.4 },
    { unit: 'ft', scale: 304.8 },
  ].map(o => ({ ...o, largest: max * o.scale }));

  // Between a fingernail and a shipping container covers essentially everything
  // a person models. Outside it, the file is far more likely mis-scaled.
  const plausible = options.filter(o => o.largest >= 5 && o.largest <= 6000);
  const asRead = options[0];
  return {
    largestMm: max,
    options,
    plausible,
    suspect: !(asRead.largest >= 5 && asRead.largest <= 6000),
    suggestion: plausible.find(o => o.unit !== 'mm') || null,
  };
}
