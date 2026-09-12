/**
 * Intent round trip, and a deviation map for what comes back.
 *
 * Exporting design intent alongside a mesh is half a promise. The other half
 * is reading it: a file nothing can import is a file nobody trusts. So this
 * inverts `designIntent`, turning the JSON back into a live parametric
 * document, and then checks the inversion by doing it and diffing the result.
 * A round trip either works on your document or it does not, and that is a
 * question the software should answer rather than the documentation.
 *
 * The second half is for the mesh that comes back from someone else: a supplier
 * STL, a scan, a re-export from another package. "Is this my part?" is not
 * answered by a file size. It is answered by a signed distance from every
 * sampled point on their mesh to the nearest surface of yours, which is a
 * deviation map. Where it is flat and near zero, the trip was lossless. Where
 * it spikes, something was tessellated coarsely, a fillet was dropped, a
 * feature moved, or a unit was misread by a factor of 25.4.
 *
 * Distances are exact point-to-triangle, not point-to-vertex, because a coarse
 * mesh has few vertices and they are all in the wrong place. Sign comes from
 * the reference surface normal at the closest point, so outside is positive
 * and a gouge reads negative.
 */
import * as THREE from 'three';
import { CATALOG, MATERIALS, UNITS, makeFeature, newDocument } from '../core/doc.js';

/* --------------------------------------------------------- triangle store */

/** Flatten geometries into one typed array of world-space triangles. */
export function collectTriangles(entries) {
  const tris = [];
  for (const { geometry, matrix } of entries || []) {
    if (!geometry) continue;
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    const pos = g.attributes.position;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (let i = 0; i < pos.count; i += 3) {
      a.fromBufferAttribute(pos, i);
      b.fromBufferAttribute(pos, i + 1);
      c.fromBufferAttribute(pos, i + 2);
      if (matrix) { a.applyMatrix4(matrix); b.applyMatrix4(matrix); c.applyMatrix4(matrix); }
      const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
      const len = n.length();
      if (len < 1e-12) continue;
      tris.push({ a: a.clone(), b: b.clone(), c: c.clone(), n: n.divideScalar(len) });
    }
  }
  return tris;
}

/**
 * Squared distance from a point to a triangle, and the closest point on it.
 * The seven-region solution: vertex, edge or face, decided by the barycentric
 * signs, with no square roots until the caller wants one.
 */
function closestOnTriangle(p, t, out) {
  const ab = new THREE.Vector3().subVectors(t.b, t.a);
  const ac = new THREE.Vector3().subVectors(t.c, t.a);
  const ap = new THREE.Vector3().subVectors(p, t.a);
  const d1 = ab.dot(ap), d2 = ac.dot(ap);
  if (d1 <= 0 && d2 <= 0) { out.copy(t.a); return out.distanceToSquared(p); }

  const bp = new THREE.Vector3().subVectors(p, t.b);
  const d3 = ab.dot(bp), d4 = ac.dot(bp);
  if (d3 >= 0 && d4 <= d3) { out.copy(t.b); return out.distanceToSquared(p); }

  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    out.copy(t.a).addScaledVector(ab, v);
    return out.distanceToSquared(p);
  }

  const cp = new THREE.Vector3().subVectors(p, t.c);
  const d5 = ab.dot(cp), d6 = ac.dot(cp);
  if (d6 >= 0 && d5 <= d6) { out.copy(t.c); return out.distanceToSquared(p); }

  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    out.copy(t.a).addScaledVector(ac, w);
    return out.distanceToSquared(p);
  }

  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    out.copy(t.b).addScaledVector(new THREE.Vector3().subVectors(t.c, t.b), w);
    return out.distanceToSquared(p);
  }

  const denom = 1 / (va + vb + vc);
  const v = vb * denom, w = vc * denom;
  out.copy(t.a).addScaledVector(ab, v).addScaledVector(ac, w);
  return out.distanceToSquared(p);
}

/**
 * A uniform grid over the reference triangles.
 *
 * A BVH would be asymptotically better and much harder to be sure of. At the
 * sizes this runs at (tens of thousands of triangles, a few thousand sample
 * points) a grid with an expanding-ring query is fast enough and can be read
 * in one sitting, which matters more for a number the user is going to trust.
 */
export function buildIndex(tris, { cells = null } = {}) {
  const box = new THREE.Box3();
  for (const t of tris) { box.expandByPoint(t.a); box.expandByPoint(t.b); box.expandByPoint(t.c); }
  if (!tris.length) return { tris, empty: true, box };
  const size = box.getSize(new THREE.Vector3());
  const span = Math.max(size.x, size.y, size.z) || 1;
  // Aim for a handful of triangles per cell.
  const n = cells ?? Math.max(4, Math.min(64, Math.round(Math.cbrt(tris.length / 4))));
  const step = span / n;
  const grid = new Map();
  const key = (i, j, k) => `${i},${j},${k}`;
  const cellOf = (v) => [
    Math.floor((v.x - box.min.x) / step),
    Math.floor((v.y - box.min.y) / step),
    Math.floor((v.z - box.min.z) / step),
  ];
  tris.forEach((t, idx) => {
    const lo = cellOf(new THREE.Vector3(Math.min(t.a.x, t.b.x, t.c.x), Math.min(t.a.y, t.b.y, t.c.y), Math.min(t.a.z, t.b.z, t.c.z)));
    const hi = cellOf(new THREE.Vector3(Math.max(t.a.x, t.b.x, t.c.x), Math.max(t.a.y, t.b.y, t.c.y), Math.max(t.a.z, t.b.z, t.c.z)));
    for (let i = lo[0]; i <= hi[0]; i++) {
      for (let j = lo[1]; j <= hi[1]; j++) {
        for (let k = lo[2]; k <= hi[2]; k++) {
          const kk = key(i, j, k);
          let bucket = grid.get(kk);
          if (!bucket) grid.set(kk, bucket = []);
          bucket.push(idx);
        }
      }
    }
  });
  return { tris, grid, box, step, cells: n, empty: false, cellOf, key };
}

/** Signed distance from one point to the indexed surface. */
export function signedDistance(p, index) {
  if (index.empty) return { distance: NaN, signed: NaN };
  const { tris, grid, step, cellOf, key } = index;
  const c = cellOf(p);
  const closest = new THREE.Vector3();
  const scratch = new THREE.Vector3();
  let best = Infinity, bestTri = null;

  // Expand the ring until the nearest hit is closer than the ring itself can
  // hide, so the answer is exact rather than nearly exact.
  const maxRing = Math.max(index.cells, 4) + 2;
  for (let r = 0; r <= maxRing; r++) {
    let touched = false;
    for (let i = c[0] - r; i <= c[0] + r; i++) {
      for (let j = c[1] - r; j <= c[1] + r; j++) {
        for (let k = c[2] - r; k <= c[2] + r; k++) {
          // Only the shell of the ring is new.
          if (r > 0 && Math.abs(i - c[0]) !== r && Math.abs(j - c[1]) !== r && Math.abs(k - c[2]) !== r) continue;
          const bucket = grid.get(key(i, j, k));
          if (!bucket) continue;
          touched = true;
          for (const idx of bucket) {
            const d2 = closestOnTriangle(p, tris[idx], scratch);
            if (d2 < best) { best = d2; closest.copy(scratch); bestTri = tris[idx]; }
          }
        }
      }
    }
    // A hit inside the ring is only provably nearest once the ring's inner
    // wall is further away than the hit.
    if (bestTri && Math.sqrt(best) <= r * step) break;
    if (r > index.cells && !touched && bestTri) break;
  }
  if (!bestTri) {
    // Nothing in range: fall back to a full scan rather than return nothing.
    for (const t of tris) {
      const d2 = closestOnTriangle(p, t, scratch);
      if (d2 < best) { best = d2; closest.copy(scratch); bestTri = t; }
    }
  }
  const d = Math.sqrt(best);
  const away = new THREE.Vector3().subVectors(p, closest);
  const sign = away.dot(bestTri.n) >= 0 ? 1 : -1;
  return { distance: d, signed: d * sign, closest: closest.clone() };
}

/* ------------------------------------------------------------- the report */

const quantile = (sorted, q) => {
  if (!sorted.length) return NaN;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
};

/**
 * Compare a mesh against the model it should be.
 *
 * Sampling is on triangle centroids and vertices of the incoming mesh, capped,
 * because a 400k-triangle scan does not need 400k distances to answer the
 * question and the user will not wait for them.
 *
 * @param {Array<{geometry: object, matrix: object|null}>} candidate the mesh in question
 * @param {Array<{geometry: object, matrix: object|null}>} reference  the model
 */
export function deviationMap(candidate, reference, { maxSamples = 6000, tolerance = null } = {}) {
  const refTris = collectTriangles(reference);
  const canTris = collectTriangles(candidate);
  if (!refTris.length || !canTris.length) {
    return { ok: false, reason: !refTris.length ? 'The reference model has no geometry.' : 'The incoming mesh has no geometry.' };
  }
  const index = buildIndex(refTris);
  const size = index.box.getSize(new THREE.Vector3());
  const span = Math.max(size.x, size.y, size.z) || 1;
  const tol = tolerance ?? Math.max(0.01, span * 1e-3);

  // A unit mistake is a question about overall size, not about distances, so
  // ask it that way: the ratio of the two bounding boxes. Inferring it from
  // deviation magnitudes gives a different answer for every shape.
  const canBox = new THREE.Box3();
  for (const t of canTris) { canBox.expandByPoint(t.a); canBox.expandByPoint(t.b); canBox.expandByPoint(t.c); }
  const canSize = canBox.getSize(new THREE.Vector3());
  const scale = (Math.max(canSize.x, canSize.y, canSize.z) || 1) / span;
  // Same reasoning for position: whether the mesh is in the wrong place is a
  // question about where its bounding box sits, and answering it that way
  // survives a shape difference that a mean deviation would drown in.
  const shiftVec = canBox.getCenter(new THREE.Vector3()).sub(index.box.getCenter(new THREE.Vector3()));
  const offset = shiftVec.length();

  // Sample centroids first, then vertices, thinning evenly so a big mesh is
  // covered rather than truncated at one end.
  const points = [];
  const stride = Math.max(1, Math.ceil((canTris.length * 4) / maxSamples));
  canTris.forEach((t, i) => {
    if (i % stride) return;
    points.push(new THREE.Vector3((t.a.x + t.b.x + t.c.x) / 3, (t.a.y + t.b.y + t.c.y) / 3, (t.a.z + t.b.z + t.c.z) / 3));
    points.push(t.a, t.b, t.c);
  });

  const signed = new Float64Array(points.length);
  let sum = 0, sumSq = 0, worst = 0, worstPoint = null, outside = 0, positive = 0, negative = 0;
  points.forEach((p, i) => {
    const r = signedDistance(p, index);
    signed[i] = r.signed;
    sum += r.signed;
    sumSq += r.signed * r.signed;
    if (Math.abs(r.signed) > Math.abs(worst)) { worst = r.signed; worstPoint = p; }
    if (Math.abs(r.signed) > tol) {
      outside++;
      if (r.signed > 0) positive++; else negative++;
    }
  });

  const abs = Array.from(signed, Math.abs).sort((a, b) => a - b);
  const n = points.length;
  const rms = Math.sqrt(sumSq / n);

  // A histogram of signed deviation, which is what makes the shape of the
  // error legible: a symmetric spread is tessellation, a one-sided shift is a
  // moved feature, two spikes are a dropped fillet.
  const lo = Math.min(...signed), hi = Math.max(...signed);
  const bins = 21;
  const width = Math.max(1e-9, (hi - lo) / bins);
  const histogram = Array.from({ length: bins }, (_, i) => ({ from: lo + i * width, to: lo + (i + 1) * width, count: 0 }));
  for (const v of signed) histogram[Math.min(bins - 1, Math.max(0, Math.floor((v - lo) / width)))].count++;

  return {
    ok: true,
    samples: n,
    tolerance: tol,
    referenceTriangles: refTris.length,
    candidateTriangles: canTris.length,
    mean: sum / n,
    rms,
    max: Math.abs(worst),
    maxSigned: worst,
    worstPoint: worstPoint ? worstPoint.toArray() : null,
    p50: quantile(abs, 0.5),
    p95: quantile(abs, 0.95),
    p99: quantile(abs, 0.99),
    outside,
    outsideFraction: outside / n,
    histogram,
    signed,
    span,
    scale,
    // Of the samples that miss, how one-sided the miss is. All on one side is
    // a part the wrong size; both sides is a part in the wrong place or the
    // wrong shape.
    sidedness: outside ? Math.max(positive, negative) / outside : 0,
    outward: positive >= negative,
    offset,
    offsetVector: shiftVec.toArray(),
    verdict: deviationVerdict({
      max: Math.abs(worst), rms, mean: sum / n, tol, span, scale, offset,
      offsetVector: shiftVec.toArray(),
      outsideFraction: outside / n,
      sidedness: outside ? Math.max(positive, negative) / outside : 0,
      outward: positive >= negative,
    }),
  };
}

/**
 * What the numbers mean. The thresholds are relative to the part, because
 * 0.1mm is nothing on a chassis rail and a scrapped part on a bearing seat.
 */
export function deviationVerdict({
  max, rms, mean, tol, span, scale = 1, offset = 0, offsetVector = null,
  outsideFraction, sidedness = 0, outward = true,
} = {}) {
  const rel = max / span;
  // Every miss on the same side is a part the wrong size, which wants a
  // different fix from a part in the wrong place, which wants a different fix
  // from a part of the wrong shape. Size and position come from the bounding
  // boxes; only what is left over is a shape difference.
  const oneSided = sidedness > 0.97 && outsideFraction > 0.02;
  const shifted = offset > Math.max(tol, span * 2e-3);

  // The factors that actually turn up: inch/mm either way, cm/mm, m/mm.
  const FACTORS = [
    [25.4, 'inches read as millimetres'],
    [1 / 25.4, 'millimetres read as inches'],
    [10, 'centimetres read as millimetres'],
    [0.1, 'millimetres read as centimetres'],
    [1000, 'metres read as millimetres'],
    [0.001, 'millimetres read as metres'],
  ];
  const unit = FACTORS.find(([f]) => Math.abs(scale / f - 1) < 0.02);
  if (unit && max > tol) {
    return {
      grade: 'units', severity: 'block',
      label: `The mesh is ${scale < 1 ? `1/${(1 / scale).toFixed(4).replace(/0+$/, '')}` : scale.toFixed(4).replace(/\.?0+$/, '')} the size of the model, which is ${unit[1]}, not a deviation. Rescale the import rather than chasing the shape.`,
    };
  }
  if (shifted) {
    const v = offsetVector ? ` (${offsetVector.map(x => x.toFixed(2)).join(', ')})` : '';
    return {
      grade: 'shifted', severity: 'warn',
      label: `The mesh sits ${offset.toFixed(3)}mm away from the model${v}. Register the two together before reading anything else into the shape.`,
    };
  }
  if (oneSided && max > tol) {
    return {
      grade: outward ? 'oversize' : 'undersize', severity: 'warn',
      label: `Every difference is on the ${outward ? 'outside' : 'inside'}, up to ${max.toFixed(3)}mm. The mesh is uniformly ${outward ? 'larger' : 'smaller'} than the model, not misplaced.`,
    };
  }
  if (max <= tol) {
    return { grade: 'match', severity: 'ok', label: `Within ${tol.toFixed(3)}mm everywhere. This is the same part.` };
  }
  if (rel < 0.002 && outsideFraction < 0.05) {
    return { grade: 'tessellation', severity: 'ok', label: `Peak ${max.toFixed(3)}mm on ${(outsideFraction * 100).toFixed(1)}% of samples, spread thinly: consistent with a coarser tessellation of the same shape.` };
  }
  if (rel < 0.02) {
    return { grade: 'detail', severity: 'warn', label: `Peak ${max.toFixed(3)}mm. Something small differs: a fillet, a chamfer or a hole size.` };
  }
  return { grade: 'different', severity: 'block', label: `Peak ${max.toFixed(3)}mm, ${(rel * 100).toFixed(1)}% of the part size. These are different shapes.` };
}

/**
 * Per-sample colours for painting the map in the viewport: blue for material
 * missing, red for material left on, neutral where it matches. Diverging
 * rather than a rainbow, because the question is which side of zero.
 */
export function deviationColors(map, { range = null } = {}) {
  if (!map?.ok) return null;
  const r = range ?? Math.max(map.p95, map.tolerance, 1e-6);
  const out = new Float32Array(map.signed.length * 3);
  map.signed.forEach((v, i) => {
    const t = Math.max(-1, Math.min(1, v / r));
    // 0 -> pale neutral, +1 -> red, -1 -> blue.
    const a = Math.abs(t);
    const c = t >= 0 ? [1, 1 - a * 0.75, 1 - a * 0.85] : [1 - a * 0.85, 1 - a * 0.45, 1];
    out[i * 3] = c[0] * (1 - a * 0.15) ;
    out[i * 3 + 1] = c[1];
    out[i * 3 + 2] = c[2];
  });
  return out;
}

/* --------------------------------------------------- intent, read back in */

/**
 * Rebuild a document from a design-intent file.
 *
 * `designIntent` writes names rather than ids on purpose, so another program
 * can read it. That means the inverse has to resolve `consumes` by name, and
 * say so clearly when two features share a name and the reference is
 * ambiguous, rather than picking one.
 */
export function importIntent(json) {
  const notes = [];
  const errors = [];
  let data = json;
  if (typeof json === 'string') {
    try { data = JSON.parse(json); } catch (e) { return { doc: null, errors: [`Not valid JSON: ${e.message}`], notes }; }
  }
  if (!data || typeof data !== 'object') return { doc: null, errors: ['Not a design-intent file.'], notes };
  if (data.format && data.format !== 'tessercad.design-intent') {
    return { doc: null, errors: [`This is a "${data.format}" file, not a design-intent file.`], notes };
  }
  if (!Array.isArray(data.features)) return { doc: null, errors: ['No feature list in this file.'], notes };

  const doc = newDocument(data.document?.name || 'Imported');
  doc.meta.units = UNITS[data.document?.units] ? data.document.units : 'mm';
  doc.meta.author = data.document?.author || '';
  doc.meta.notes = data.document?.notes || '';
  doc.params = (data.parameters || []).map((p, i) => ({
    id: `pi${i}`,
    name: p.name,
    value: p.expression ?? p.resolved ?? 0,
    note: p.note || '',
  }));

  // Names to ids, with duplicates flagged rather than silently collapsed.
  const counts = new Map();
  for (const f of data.features) counts.set(f.name, (counts.get(f.name) || 0) + 1);
  const idOfName = new Map();
  doc.features = data.features.map((f, i) => {
    const type = CATALOG[f.type] ? f.type : null;
    if (!type) { errors.push(`Feature "${f.name}" has unknown type "${f.type}".`); return null; }
    const made = makeFeature(type, { name: f.name || CATALOG[type].label });
    made.id = `fi${i}`;
    made.params = { ...made.params, ...(f.parameters || {}) };
    // The exporter writes `placement` with spelled-out key names so another
    // program can read it without a schema. Accept the internal spelling too,
    // in case the file came from somewhere that copied the document instead.
    const place = f.placement || f.transform;
    if (place) {
      made.transform = {
        pos: place.position || place.pos || [0, 0, 0],
        rot: place.rotationDegXYZ || place.rotationDegrees || place.rot || [0, 0, 0],
        scale: place.scale || [1, 1, 1],
      };
    }
    made.suppressed = !!f.suppressed;
    if (MATERIALS[f.material]) {
      made.material = f.material;
      const m = MATERIALS[f.material];
      made.appearance = { ...made.appearance, color: m.color, metalness: m.metal, roughness: m.rough };
    } else if (f.material) {
      notes.push(`Feature "${f.name}" names material "${f.material}", which this library does not have. Using steel.`);
    }
    if (!idOfName.has(f.name)) idOfName.set(f.name, made.id);
    return made;
  }).filter(Boolean);

  data.features.forEach((f, i) => {
    const made = doc.features.find(x => x.id === `fi${i}`);
    if (!made) return;
    made.inputs = (f.consumes || []).map(name => {
      if ((counts.get(name) || 0) > 1) {
        notes.push(`"${f.name}" consumes "${name}", and more than one feature has that name. The first was used.`);
      }
      const id = idOfName.get(name);
      if (!id) errors.push(`"${f.name}" consumes "${name}", which this file does not define.`);
      return id;
    }).filter(Boolean);
  });

  if (data.version && data.version > 1) {
    notes.push(`This file was written by a newer intent format (version ${data.version}); anything it added has been ignored.`);
  }
  return { doc: errors.length ? null : doc, errors, notes };
}

/**
 * Export intent, read it straight back, and report what survived.
 *
 * This is the check that keeps the interoperability claim honest. Anything the
 * format cannot carry shows up here as a difference, on the user's own
 * document, in one click.
 */
export function intentRoundTrip(intent) {
  const { doc, errors, notes } = importIntent(intent);
  if (!doc) return { ok: false, errors, notes, differences: ['The intent file did not import.'] };

  const differences = [];
  const src = intent;
  if ((src.document?.name || '') !== doc.meta.name) differences.push('Document name changed.');
  if ((src.parameters || []).length !== doc.params.length) differences.push('Parameter count changed.');
  (src.parameters || []).forEach((p, i) => {
    const q = doc.params[i];
    if (!q) { differences.push(`Parameter ${p.name} was lost.`); return; }
    if (q.name !== p.name) differences.push(`Parameter ${i}: ${p.name} became ${q.name}.`);
    if (String(q.value) !== String(p.expression ?? p.resolved)) differences.push(`Parameter ${p.name}: ${p.expression} became ${q.value}.`);
  });
  (src.features || []).forEach((f, i) => {
    const g = doc.features[i];
    if (!g) { differences.push(`Feature ${f.name} was lost.`); return; }
    if (g.name !== f.name) differences.push(`Feature ${i}: ${f.name} became ${g.name}.`);
    if (g.type !== f.type) differences.push(`${f.name}: type ${f.type} became ${g.type}.`);
    for (const [k, v] of Object.entries(f.parameters || {})) {
      if (String(g.params[k]) !== String(v)) differences.push(`${f.name}.${k}: ${v} became ${g.params[k]}.`);
    }
    const consumes = (f.consumes || []).length;
    if (consumes !== (g.inputs || []).length) differences.push(`${f.name}: ${consumes} inputs became ${(g.inputs || []).length}.`);
  });

  return { ok: differences.length === 0, doc, errors, notes, differences };
}

/** One line for a report or the release package. */
export function deviationSummary(map) {
  if (!map?.ok) return { ok: false, line: map?.reason || 'No comparison.' };
  return {
    ok: true,
    line: `${map.samples} points sampled: peak ${map.max.toFixed(3)}mm, RMS ${map.rms.toFixed(3)}mm, 95% within ${map.p95.toFixed(3)}mm. ${map.verdict.label}`,
    severity: map.verdict.severity,
    grade: map.verdict.grade,
  };
}
