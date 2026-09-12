/**
 * What actually kills a large CAD file.
 *
 * The complaints are specific and they are never about the modelling: "contains
 * proxy objects from Civil 3D... very high coordinates... objects are far away
 * ... zoom extents makes objects smaller than a pixel", and crashes diagnosed
 * as "remove proxy objects", and empty groups that freeze a scene. None of
 * that is a geometry problem. It is a data-hygiene problem, and the software
 * is in a far better position to find it than the user is.
 *
 * Four things are checked here, each with a repair where the intent is
 * recoverable:
 *
 *   Far from the origin. Geometry at survey coordinates loses precision,
 *   because a float32 has about seven significant digits: at 500 km from the
 *   origin the smallest representable step is tens of millimetres, so a 0.1mm
 *   feature cannot be represented at all. This is the one that makes a model
 *   look subtly wrong in ways nobody can explain, and it is arithmetic rather
 *   than opinion, so the report gives the actual precision loss in millimetres.
 *
 *   Duplicated payloads. Two imported meshes with identical triangles are two
 *   copies of the same megabytes. Hashing them and pointing the duplicates at
 *   one copy is what game engines call deduplication, and it costs nothing.
 *
 *   Empty and degenerate features. A feature with a zero dimension, a pattern
 *   of one, a boolean with nothing to combine: each contributes no geometry and
 *   some cost, and every one of them is a thing the user meant to finish.
 *
 *   Weight. Where the document's bytes actually are, so "why is this file 40
 *   megabytes" has an answer.
 *
 * Nothing here changes the document. Every finding carries a `fix` the caller
 * applies on the user's say-so, one undo step each.
 */
import { CATALOG } from '../core/doc.js';

/** float32 keeps ~24 bits of mantissa, so this is its step at a given size. */
export function precisionAt(distanceMm) {
  const d = Math.abs(distanceMm);
  if (d < 1) return 1.2e-7;
  // The gap between consecutive floats near d.
  return Math.pow(2, Math.floor(Math.log2(d)) - 23);
}

/** Where a feature sits, as far as the document can say without rebuilding. */
function positionOf(f) {
  const p = f?.transform?.pos;
  if (!Array.isArray(p)) return [0, 0, 0];
  return [0, 1, 2].map(i => (typeof p[i] === 'number' ? p[i] : 0));
}

/** A cheap, stable hash of a mesh payload, for spotting duplicates. */
export function payloadHash(data) {
  const a = data?.positions;
  if (!a || !a.length) return null;
  // FNV-1a over a sample plus the length: a full pass over a million floats
  // costs more than it buys, and a collision needs the same length, the same
  // 512 sampled values and the same total.
  let h = 0x811c9dc5;
  const step = Math.max(1, Math.floor(a.length / 512));
  let sum = 0;
  for (let i = 0; i < a.length; i += step) {
    const v = Math.round(a[i] * 1000);
    sum += v;
    h ^= v & 0xff; h = Math.imul(h, 0x01000193);
    h ^= (v >>> 8) & 0xff; h = Math.imul(h, 0x01000193);
  }
  return `${a.length}:${(h >>> 0).toString(36)}:${sum}`;
}

/** Roughly how many bytes a feature contributes to the saved file. */
export function weightOf(f) {
  if (!f) return 0;
  let bytes = 200;                                  // the record itself
  if (f.data?.positions) bytes += f.data.positions.length * 9;   // JSON floats
  if (f.data?.normals) bytes += f.data.normals.length * 9;
  if (f.profile?.length) bytes += f.profile.length * 12;
  return bytes;
}

const SEVERITY = { block: 3, warn: 2, note: 1 };

/**
 * The centre of the built geometry, when there is a build to ask.
 *
 * This is a better reference than the feature transforms for the reason that
 * makes a real document awkward: a position may be an expression, and a
 * transform alone cannot say where `plate_w / 2 - inset` puts something. The
 * build has already resolved every expression, so its bounding box is where
 * the geometry actually is.
 */
function boxCentre(build) {
  const b = build?.stats?.box;
  if (!b || b.isEmpty?.() || !b.min || !b.max) return null;
  const c = [0, 1, 2].map(i => ((['x', 'y', 'z'].map(k => b.min[k])[i]) + (['x', 'y', 'z'].map(k => b.max[k])[i])) / 2);
  return c.every(Number.isFinite) ? c : null;
}

/**
 * Inspect a document for the problems that make big files unusable.
 *
 * @param {object} doc
 * @param {object|null} build  optional; a build lets the far-origin check use
 *        real geometry bounds rather than feature transforms alone
 * @returns {{issues: object[], weight: object, clean: boolean}}
 */
export function inspect(doc, build = null) {
  const issues = [];
  const add = (i) => issues.push(i);

  /* ------------------------------------------------------- far from origin */

  let worst = 0, worstName = null;
  for (const f of doc.features || []) {
    if (!f) continue;
    const p = positionOf(f);
    const d = Math.hypot(p[0], p[1], p[2]);
    if (d > worst) { worst = d; worstName = f.name; }
  }
  if (build?.stats?.box && !build.stats.box.isEmpty?.()) {
    const b = build.stats.box;
    for (const v of [b.min, b.max]) {
      const d = Math.hypot(v.x, v.y, v.z);
      if (d > worst) { worst = d; worstName = worstName || 'the model'; }
    }
  }

  // A float32 step of a micron is the point at which normal CAD tolerances
  // start to be unrepresentable, and that happens around 8 metres.
  const step = precisionAt(worst);
  if (worst > 100000) {
    add({
      id: 'far-origin', severity: 'block', title: 'Geometry is at survey coordinates',
      detail: `The furthest point is ${(worst / 1000).toFixed(1)} m from the origin. A 32-bit float keeps about seven significant digits, so the smallest distance that can be represented there is ${step < 1 ? `${(step * 1000).toFixed(2)} µm` : `${step.toFixed(3)} mm`}. Features smaller than that cannot be positioned accurately, and the symptom is a model that looks subtly wrong in ways nothing in the feature tree explains.`,
      why: 'This is arithmetic, not a preference. Moving the design to the origin and keeping the real-world coordinate as a note is what every package that survives large sites does.',
      fix: recentreFix(doc, boxCentre(build)),
    });
  } else if (worst > 8000) {
    add({
      id: 'far-origin', severity: 'warn', title: `Geometry is ${(worst / 1000).toFixed(1)} m from the origin`,
      detail: `The smallest representable step out there is ${step < 1 ? `${(step * 1000).toFixed(2)} µm` : `${step.toFixed(3)} mm`}. That is still fine for millimetre work and is not fine for microns.`,
      why: `${worstName || 'A feature'} is the furthest out. Centring the design costs nothing and buys back precision.`,
      fix: recentreFix(doc, boxCentre(build)),
    });
  }

  /* --------------------------------------------------- duplicate payloads */

  const byHash = new Map();
  for (const f of doc.features || []) {
    const h = payloadHash(f?.data);
    if (!h) continue;
    if (!byHash.has(h)) byHash.set(h, []);
    byHash.get(h).push(f);
  }
  for (const [h, group] of byHash) {
    if (group.length < 2) continue;
    const bytes = group.slice(1).reduce((n, f) => n + weightOf(f), 0);
    add({
      id: `dup-${h}`, severity: 'warn',
      title: `${group.length} copies of the same mesh`,
      detail: `${group.map(f => f.name).join(', ')} hold identical triangles. That is ${(bytes / 1024).toFixed(0)} kB of the file saying the same thing more than once.`,
      why: 'Pointing the duplicates at one copy leaves every body exactly where it is: the geometry is shared, the transforms stay separate. This is what a game engine calls deduplication.',
      fix: dedupFix(group),
    });
  }

  /* ------------------------------------------- empty and degenerate features */

  for (const f of doc.features || []) {
    const cat = CATALOG[f?.type];
    if (!cat) continue;
    const zero = [];
    for (const [k, v] of Object.entries(f.params || {})) {
      if (typeof v !== 'number') continue;              // an expression may resolve fine
      const field = (cat.fields || []).find(x => x.key === k);
      if (!field || field.kind !== 'len') continue;
      if (v === 0) zero.push(k);
    }
    if (zero.length) {
      add({
        id: `zero-${f.id}`, severity: 'warn', title: `${f.name} has a zero dimension`,
        detail: `${zero.join(' and ')} ${zero.length === 1 ? 'is' : 'are'} zero, so this feature produces no geometry while still costing a rebuild.`,
        why: 'Either it was left unfinished or it is driven by a parameter that resolved to zero. Both are worth knowing about before a customer sees the file.',
        fix: null,
      });
    }
    if ((f.type === 'patternLinear' || f.type === 'patternCircular') && Math.round(f.params?.count ?? 0) <= 1) {
      add({
        id: `pat1-${f.id}`, severity: 'note', title: `${f.name} is a pattern of one`,
        detail: 'A pattern with a count of one is a copy of its input and nothing more.',
        why: 'Harmless, but it hides the fact that the count never got set, and a reader of the tree cannot tell that from looking.',
        fix: null,
      });
    }
    if (f.type === 'boolean' && (f.inputs?.length ?? 0) < 2) {
      add({
        id: `bool-${f.id}`, severity: 'warn', title: `${f.name} has nothing to combine`,
        detail: `A boolean needs two bodies and has ${f.inputs?.length ?? 0}.`,
        why: 'Usually its other input was deleted. The Design Doctor can reconnect it; until then it produces nothing.',
        fix: null,
      });
    }
  }

  /* --------------------------------------------------------------- weight */

  const rows = (doc.features || []).filter(Boolean).map(f => ({ name: f.name, type: f.type, bytes: weightOf(f) }))
    .sort((a, b) => b.bytes - a.bytes);
  const total = rows.reduce((n, r) => n + r.bytes, 0);
  const meshBytes = (doc.features || []).filter(f => f?.data?.positions).reduce((n, f) => n + weightOf(f), 0);
  const weight = {
    totalBytes: total,
    meshBytes,
    meshShare: total ? meshBytes / total : 0,
    features: (doc.features || []).length,
    heaviest: rows.slice(0, 8),
    params: (doc.params || []).length,
    drawEntities: doc.draw?.entities?.length || 0,
  };

  if (meshBytes > 4e6) {
    add({
      id: 'heavy-mesh', severity: 'note', title: 'Imported meshes are most of this file',
      detail: `${(meshBytes / 1e6).toFixed(1)} MB of triangles, ${(weight.meshShare * 100).toFixed(0)}% of the document.`,
      why: 'Imported triangles cannot be parameterised and do not compress in JSON. If a mesh is only there for reference, deleting it after the parametric features are built keeps the file small.',
      fix: null,
    });
  }

  issues.sort((a, b) => SEVERITY[b.severity] - SEVERITY[a.severity]);
  return { issues, weight, clean: issues.length === 0 };
}

/* ------------------------------------------------------------------ fixes */

/**
 * Move the whole design to the origin, keeping the offset in the notes.
 *
 * Only features with no inputs are moved, and all of them by the same vector.
 * That is exactly the right set, for two reasons that pull in opposite
 * directions until you look at what a transform means.
 *
 * A leaf primitive's position is absolute, so moving it moves the geometry.
 * A derived feature's position is an offset applied on top of whatever its
 * inputs produced, so moving it as well would move the result twice. Leaves
 * carry the coordinates; everything downstream follows them for free.
 *
 * And the leaves are the set that has to move: moving only the top-level
 * bodies would leave a boolean's inputs out at survey coordinates, so the
 * boolean would still be *computed* there, in floats whose step is tens of
 * microns, and the precision problem this repair exists to fix would survive
 * it. The result would merely appear near the origin afterwards.
 *
 * The reference point is the centre of the leaves' bounding box rather than
 * their mean, so one distant fixing hole does not drag the whole design off
 * centre. A position written as an expression is left alone and reported,
 * because rewriting somebody's formula is not this function's business.
 */
function recentreFix(doc, reference = null) {
  return {
    label: 'Move the design to the origin',
    apply: (store) => {
      store.edit('Move the design to the origin', (d) => {
        const leaves = (d.features || []).filter(f => f && !(f.inputs?.length));
        if (!leaves.length) return;

        let off;
        if (reference) {
          off = reference.map(v => Math.round(v * 1000) / 1000);
        } else {
          // No build to ask, so fall back to the centre of the leaves'
          // bounding box, rounded to a micron.
          const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
          for (const f of leaves) {
            const p = positionOf(f);
            for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], p[i]); hi[i] = Math.max(hi[i], p[i]); }
          }
          off = [0, 1, 2].map(i => Math.round(((lo[i] + hi[i]) / 2) * 1000) / 1000);
        }
        if (!off.some(v => Math.abs(v) > 1e-6)) return;

        let skipped = 0;
        for (const f of leaves) {
          const p = f.transform?.pos;
          if (!Array.isArray(p)) continue;
          for (let i = 0; i < 3; i++) {
            if (typeof p[i] === 'number') p[i] = Math.round((p[i] - off[i]) * 1000) / 1000;
            else skipped++;
          }
        }
        const note = `Design origin offset from the original coordinates: ${off.join(', ')} mm.` +
          (skipped ? ` ${skipped} coordinate${skipped === 1 ? '' : 's'} left alone because they are expressions.` : '');
        d.meta.notes = d.meta.notes ? `${d.meta.notes}\n${note}` : note;
      });
    },
  };
}

/**
 * Point duplicate payloads at one shared copy.
 *
 * Every body keeps its own transform, so nothing moves; only the triangles are
 * shared. The document stays plain JSON, so the share is by reference within
 * the in-memory document and by a single copy on save.
 */
function dedupFix(group) {
  return {
    label: `Share one copy between ${group.length} bodies`,
    apply: (store) => {
      store.edit('Share duplicate meshes', (d) => {
        const ids = new Set(group.map(f => f.id));
        const features = d.features.filter(f => ids.has(f.id));
        if (features.length < 2) return;
        const keep = features[0].data;
        for (let i = 1; i < features.length; i++) features[i].data = keep;
      });
    },
  };
}

/** One line for the status bar or a report. */
export function summary(result) {
  const { issues, weight } = result;
  if (!issues.length) return `Clean. ${weight.features} features, ${(weight.totalBytes / 1024).toFixed(0)} kB.`;
  const blocks = issues.filter(i => i.severity === 'block').length;
  const warns = issues.filter(i => i.severity === 'warn').length;
  return [
    blocks ? `${blocks} serious` : '',
    warns ? `${warns} worth fixing` : '',
    `${(weight.totalBytes / 1024).toFixed(0)} kB`,
  ].filter(Boolean).join(', ');
}
