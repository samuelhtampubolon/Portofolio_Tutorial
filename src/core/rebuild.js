/**
 * The feature-evaluation engine.
 *
 * Walks the ordered feature list, resolves every expression against the
 * document parameters, builds geometry, and folds booleans/patterns/mirrors.
 * Results are cached per feature by a content key so editing one parameter
 * only re-evaluates that feature and whatever depends on it.
 */
import * as THREE from 'three';
import { buildScope, evaluate } from './expr.js';
import { booleanGeometries, operandsToArrays, trianglesToGeometry } from './csg.js';
import { pool, isWorkerUnavailable } from './csg-pool.js';
import {
  buildPrimitive, buildExtrude, buildRevolve, shapesFromEntities,
  transformMatrix, recentre, triangleCount,
} from './geometry.js';
import { catalogOf, MATERIALS } from './doc.js';

const D2R = Math.PI / 180;
const PROFILE_TYPES = new Set(['extrude', 'revolve']);

/* --------------------------------------------------------------- caching */

const cache = new Map();   // featureId -> { key, instances, tris }

export function invalidateCache(id) {
  if (id) cache.delete(id); else cache.clear();
}

/* -------------------------------------------------------- param resolving */

function resolveParams(feature, scope) {
  const cat = catalogOf(feature.type);
  const out = {};
  for (const [k, def] of Object.entries(cat.params)) {
    const raw = feature.params[k];
    const v = raw === undefined ? def : raw;
    if (typeof v === 'boolean' || typeof def === 'boolean') { out[k] = !!v; continue; }
    if (typeof def === 'string') { out[k] = v == null ? def : String(v); continue; }
    out[k] = evaluate(v, scope);
  }
  return out;
}

function resolveTransform(tr, scope) {
  const num = (v) => evaluate(v, scope);
  return {
    pos: [num(tr.pos[0] ?? 0), num(tr.pos[1] ?? 0), num(tr.pos[2] ?? 0)],
    rot: [num(tr.rot[0] ?? 0), num(tr.rot[1] ?? 0), num(tr.rot[2] ?? 0)],
    scale: [num(tr.scale?.[0] ?? 1), num(tr.scale?.[1] ?? 1), num(tr.scale?.[2] ?? 1)],
  };
}

/* -------------------------------------------------------- winding flipping */

/** Mirror bakes into vertices, so triangle winding has to be reversed. */
function flipWinding(geo) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const p = g.attributes.position.array;
  for (let i = 0; i < p.length; i += 9) {
    for (let k = 0; k < 3; k++) {
      const t = p[i + 3 + k]; p[i + 3 + k] = p[i + 6 + k]; p[i + 6 + k] = t;
    }
  }
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

function applyMatrixBaked(geo, matrix) {
  const g = (geo.index ? geo.toNonIndexed() : geo.clone());
  g.applyMatrix4(matrix);
  return g;
}

/* ----------------------------------------------------------- mass props */

/**
 * Volume, surface area and centroid from a closed triangle mesh via the
 * divergence theorem (signed tetrahedra against the origin).
 */
export function massProperties(geometry, matrix = null) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const p = g.attributes.position.array;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), cr = new THREE.Vector3();
  let vol = 0, area = 0;
  const cen = new THREE.Vector3();
  const box = new THREE.Box3();
  box.makeEmpty();

  for (let i = 0; i < p.length; i += 9) {
    a.set(p[i], p[i + 1], p[i + 2]);
    b.set(p[i + 3], p[i + 4], p[i + 5]);
    c.set(p[i + 6], p[i + 7], p[i + 8]);
    if (matrix) { a.applyMatrix4(matrix); b.applyMatrix4(matrix); c.applyMatrix4(matrix); }
    box.expandByPoint(a); box.expandByPoint(b); box.expandByPoint(c);

    ab.subVectors(b, a); ac.subVectors(c, a); cr.crossVectors(ab, ac);
    area += cr.length() * 0.5;

    const v = a.dot(cr) / 6;      // signed tetra volume (origin, a, b, c)
    vol += v;
    cen.x += (a.x + b.x + c.x) * 0.25 * v;
    cen.y += (a.y + b.y + c.y) * 0.25 * v;
    cen.z += (a.z + b.z + c.z) * 0.25 * v;
  }

  const volume = Math.abs(vol);
  if (volume > 1e-9) cen.multiplyScalar(1 / vol);
  else box.getCenter(cen);

  const size = new THREE.Vector3();
  box.getSize(size);
  return { volume, area, centroid: cen, box, size, closed: Math.abs(vol) > 1e-9 };
}

export function summarise(features, results) {
  let volume = 0, area = 0, tris = 0, mass = 0, bodies = 0;
  const box = new THREE.Box3(); box.makeEmpty();
  const wc = new THREE.Vector3();
  for (const f of features) {
    const r = results.get(f.id);
    if (!r || r.error || !r.instances.length) continue;
    const dens = (MATERIALS[f.material] || MATERIALS.steel).density;
    for (const inst of r.instances) {
      const mp = massProperties(inst.geometry, inst.matrix);
      volume += mp.volume; area += mp.area; tris += triangleCount(inst.geometry);
      mass += mp.volume * dens;
      wc.addScaledVector(mp.centroid, mp.volume);
      box.union(mp.box);
      bodies++;
    }
  }
  if (volume > 1e-9) wc.multiplyScalar(1 / volume);
  return { volume, area, tris, mass, bodies, box, centroid: wc };
}

/* ------------------------------------------------------------- evaluation */

function keyOf(feature, scope, doc, inputKeys) {
  const profileSig = PROFILE_TYPES.has(feature.type)
    ? JSON.stringify((feature.profile || []).map(id => doc.draw.entities.find(e => e.id === id)).filter(Boolean))
    : '';
  return JSON.stringify([
    feature.type, feature.params, feature.transform, feature.data ? feature.data.hash || feature.data.positions?.length : 0,
    inputKeys, profileSig,
    // only parameters actually referenced matter, but hashing the whole scope
    // is cheap and keeps the key honest
    Object.keys(scope).length ? scope : 0,
  ]);
}

function evalOne(feature, ctx) {
  const { scope, doc, results } = ctx;
  const params = resolveParams(feature, scope);
  const tr = resolveTransform(feature.transform, scope);
  const matrix = transformMatrix(tr);

  const inputInstances = [];
  for (const id of feature.inputs) {
    const r = results.get(id);
    if (!r) throw new Error('Missing input feature');
    if (r.error) throw new Error(`Input "${r.name}" failed`);
    for (const inst of r.instances) inputInstances.push(inst);
  }

  switch (feature.type) {
    case 'boolean': {
      const cat = catalogOf('boolean');
      if (inputInstances.length < (cat.minInputs || 2)) throw new Error('Boolean needs at least two input bodies');
      const geom = booleanGeometries(params.op, inputInstances.map(i => ({ geometry: i.geometry, matrix: i.matrix })));
      if (triangleCount(geom) === 0) throw new Error('Boolean produced an empty body — check that the inputs overlap');
      const c = recentre(geom);
      const m = new THREE.Matrix4().makeTranslation(c.x, c.y, c.z).multiply(matrix);
      return [{ geometry: geom, matrix: m }];
    }

    case 'patternLinear': {
      if (!inputInstances.length) throw new Error('Linear pattern needs an input body');
      const n1 = Math.max(1, Math.round(params.count));
      const n2 = Math.max(1, Math.round(params.count2));
      if (n1 * n2 > 2000) throw new Error('Pattern would create more than 2000 instances');
      const out = [];
      for (let i = 0; i < n1; i++) {
        for (let j = 0; j < n2; j++) {
          const off = new THREE.Matrix4().makeTranslation(
            params.dx * i + params.dx2 * j,
            params.dy * i + params.dy2 * j,
            params.dz * i + params.dz2 * j,
          );
          for (const inst of inputInstances) {
            out.push({ geometry: inst.geometry, matrix: new THREE.Matrix4().multiplyMatrices(matrix, new THREE.Matrix4().multiplyMatrices(off, inst.matrix)) });
          }
        }
      }
      return out;
    }

    case 'patternCircular': {
      if (!inputInstances.length) throw new Error('Circular pattern needs an input body');
      const n = Math.max(1, Math.round(params.count));
      if (n > 2000) throw new Error('Pattern would create more than 2000 instances');
      const full = Math.abs(params.angle) >= 359.999;
      const step = (params.angle * D2R) / (full ? n : Math.max(1, n - 1));
      const axis = new THREE.Vector3(
        params.axis === 'x' ? 1 : 0, params.axis === 'y' ? 1 : 0, params.axis === 'z' ? 1 : 0,
      );
      const centre = new THREE.Vector3(params.cx, params.cy, params.cz);
      const out = [];
      for (let i = 0; i < n; i++) {
        const rot = new THREE.Matrix4().makeRotationAxis(axis, step * i);
        const about = new THREE.Matrix4()
          .makeTranslation(centre.x, centre.y, centre.z)
          .multiply(rot)
          .multiply(new THREE.Matrix4().makeTranslation(-centre.x, -centre.y, -centre.z));
        for (const inst of inputInstances) {
          let m;
          if (params.rotate) {
            m = new THREE.Matrix4().multiplyMatrices(about, inst.matrix);
          } else {
            // translate the instance origin, keep its orientation
            const p = new THREE.Vector3().setFromMatrixPosition(inst.matrix).applyMatrix4(about);
            m = inst.matrix.clone().setPosition(p);
          }
          out.push({ geometry: inst.geometry, matrix: new THREE.Matrix4().multiplyMatrices(matrix, m) });
        }
      }
      return out;
    }

    case 'mirror': {
      if (!inputInstances.length) throw new Error('Mirror needs an input body');
      const ax = params.plane === 'yz' ? 0 : params.plane === 'xz' ? 1 : 2;
      const s = [1, 1, 1]; s[ax] = -1;
      const off = params.offset || 0;
      const mir = new THREE.Matrix4().makeScale(s[0], s[1], s[2]);
      const t1 = new THREE.Matrix4().makeTranslation(ax === 0 ? off : 0, ax === 1 ? off : 0, ax === 2 ? off : 0);
      const t0 = new THREE.Matrix4().makeTranslation(ax === 0 ? -off : 0, ax === 1 ? -off : 0, ax === 2 ? -off : 0);
      const full = new THREE.Matrix4().multiplyMatrices(t1, new THREE.Matrix4().multiplyMatrices(mir, t0));
      const out = [];
      if (params.keep) for (const inst of inputInstances) out.push({ geometry: inst.geometry, matrix: new THREE.Matrix4().multiplyMatrices(matrix, inst.matrix) });
      for (const inst of inputInstances) {
        const baked = flipWinding(applyMatrixBaked(inst.geometry, new THREE.Matrix4().multiplyMatrices(full, inst.matrix)));
        out.push({ geometry: baked, matrix: matrix.clone() });
      }
      return out;
    }

    case 'extrude':
    case 'revolve': {
      const ids = feature.profile || [];
      const ents = doc.draw.entities.filter(e => ids.includes(e.id));
      if (!ents.length) throw new Error('No sketch geometry linked — select entities in Draft and press “Use as profile”');
      const shapes = shapesFromEntities(ents, 48);
      if (!shapes.length) throw new Error('Linked sketch has no closed region');
      let geom;
      if (feature.type === 'extrude') {
        geom = buildExtrude(shapes, params);
        const plane = params.plane || 'xy';
        const basis = planeBasis(plane);
        const pm = new THREE.Matrix4().makeBasis(basis[0], basis[1], basis[2]);
        if (params.offset) pm.setPosition(basis[2].clone().multiplyScalar(params.offset));
        geom.applyMatrix4(pm);
      } else {
        geom = buildRevolve(shapes, params);
        const plane = params.plane || 'xz';
        if (plane !== 'xy') {
          // revolve builds around world Z; re-orient onto the chosen plane
          const basis = planeBasis(plane);
          const pm = new THREE.Matrix4().makeBasis(basis[0], basis[1], basis[2]);
          geom.applyMatrix4(pm);
        }
      }
      geom.computeVertexNormals();
      return [{ geometry: geom, matrix }];
    }

    case 'mesh': {
      const data = feature.data;
      if (!data || !data.positions || !data.positions.length) throw new Error('Imported mesh has no geometry');
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(data.positions), 3));
      if (data.normals && data.normals.length === data.positions.length) {
        g.setAttribute('normal', new THREE.BufferAttribute(Float32Array.from(data.normals), 3));
      } else {
        g.computeVertexNormals();
      }
      const sc = params.scale || 1;
      if (sc !== 1) g.scale(sc, sc, sc);
      g.computeBoundingBox(); g.computeBoundingSphere();
      return [{ geometry: g, matrix }];
    }

    default: {
      const geom = buildPrimitive(feature.type, params);
      geom.computeBoundingBox(); geom.computeBoundingSphere();
      return [{ geometry: geom, matrix }];
    }
  }
}

function planeBasis(plane) {
  if (plane === 'xz') return [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, -1, 0)];
  if (plane === 'yz') return [new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0)];
  return [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
}

/**
 * How deep a feature sits in the dependency graph.
 *
 * Everything at one depth is independent of everything else at that depth, by
 * construction, so a whole depth can be evaluated at once. That is what makes
 * the parallel rebuild possible without a scheduler: the document's own
 * structure already says what may overlap.
 */
function depths(doc) {
  const byId = new Map(doc.features.map(f => [f.id, f]));
  const memo = new Map();
  const depthOf = (id, seen = new Set()) => {
    if (memo.has(id)) return memo.get(id);
    if (seen.has(id)) return 0;                  // a cycle; migrate() prevents these
    seen.add(id);
    const f = byId.get(id);
    if (!f || !f.inputs?.length) { memo.set(id, 0); return 0; }
    let d = 0;
    for (const i of f.inputs) d = Math.max(d, depthOf(i, seen) + 1);
    memo.set(id, d);
    return d;
  };
  const levels = [];
  for (const f of doc.features) {
    const d = depthOf(f.id);
    (levels[d] ??= []).push(f);
  }
  return levels.map(l => l || []);
}

/**
 * Evaluate the whole document, off the main thread where it can be.
 *
 * Same results as `rebuild`, same cache, same order of effects: the only
 * difference is that booleans are handed to the worker pool, a whole
 * dependency level at a time, so several run at once and none of them runs on
 * the thread that draws the interface. If the pool is unavailable for any
 * reason, each boolean falls straight through to the identical synchronous
 * kernel, so the answer never depends on whether workers started.
 */
export async function rebuildAsync(doc, { onProgress = null } = {}) {
  const { scope, errors: paramErrors } = buildScope(doc.params);
  const results = new Map();
  const ctx = { scope, doc, results };
  const consumed = new Set();
  const keys = new Map();
  const parallel = { levels: 0, offThread: 0, onThread: 0, peak: 0, yields: 0 };

  for (const f of doc.features) {
    if (f.suppressed) continue;
    for (const i of f.inputs) consumed.add(i);
  }

  const levels = depths(doc);
  let done = 0;
  let sinceYield = performance.now();
  // Hand the thread back when we have held it for longer than a frame. A
  // boolean now runs in a worker, but tessellating primitives and measuring
  // mass properties still happen here, and a long document can hold the
  // thread for hundreds of milliseconds even with no boolean in it. Yielding
  // turns one long stall into several short ones, which is the difference
  // between a window that is slow and one that looks broken.
  const breathe = async () => {
    if (performance.now() - sinceYield < 12) return false;
    await new Promise(r => setTimeout(r, 0));
    sinceYield = performance.now();
    parallel.yields++;
    return true;
  };

  for (const level of levels) {
    if (!level.length) continue;
    parallel.levels++;
    const waits = [];

    for (const f of level) {
      if (f.suppressed) {
        results.set(f.id, { instances: [], error: null, suppressed: true, name: f.name });
        keys.set(f.id, 'suppressed');
        continue;
      }
      const inputKeys = f.inputs.map(id => keys.get(id) || '');
      const key = keyOf(f, scope, doc, inputKeys);
      const hit = cache.get(f.id);
      if (hit && hit.key === key) {
        results.set(f.id, { ...hit.result, name: f.name });
        keys.set(f.id, key);
        continue;
      }

      // Booleans go off-thread; everything else is a fast primitive builder
      // and costs more to ship to a worker than to just run.
      const job = f.type === 'boolean' ? prepareBoolean(f, ctx) : null;
      if (!job) {
        let result;
        try { result = { instances: evalOne(f, ctx), error: null, name: f.name }; }
        catch (err) { result = { instances: [], error: err.message || String(err), name: f.name }; }
        cache.set(f.id, { key, result });
        keys.set(f.id, key);
        results.set(f.id, result);
        await breathe();
        continue;
      }

      parallel.offThread++;
      waits.push(
        pool.run(job.op, job.operands)
          .then(out => ({ f, key, geom: trianglesToGeometry(out), job }))
          .catch((err) => {
            if (!isWorkerUnavailable(err)) return { f, key, error: err.message, job };
            // The pool could not take it. Run it here rather than failing.
            parallel.onThread++;
            try { return { f, key, geom: booleanGeometries(job.op, job.operands3), job }; }
            catch (e2) { return { f, key, error: e2.message || String(e2), job }; }
          }),
      );
      // Preparing a job is itself real work: flattening a 64-segment sphere
      // into typed arrays is tens of milliseconds, and four of them back to
      // back was the largest remaining stall. The job is already dispatched
      // by this point, so yielding here costs no parallelism.
      await breathe();
    }

    if (waits.length) {
      parallel.peak = Math.max(parallel.peak, waits.length);
      const settled = await Promise.all(waits);
      for (const r of settled) {
        let result;
        if (r.error) {
          result = { instances: [], error: r.error, name: r.f.name };
        } else if (triangleCount(r.geom) === 0) {
          result = { instances: [], error: 'Boolean produced an empty body — check that the inputs overlap', name: r.f.name };
        } else {
          result = { instances: finishBoolean(r.geom, r.job), error: null, name: r.f.name };
        }
        cache.set(r.f.id, { key: r.key, result });
        keys.set(r.f.id, r.key);
        results.set(r.f.id, result);
      }
    }

    done += level.length;
    onProgress?.(done, doc.features.length);
    await breathe();
  }

  const live = new Set(doc.features.map(f => f.id));
  for (const id of [...cache.keys()]) if (!live.has(id)) cache.delete(id);

  const topLevel = doc.features.filter(f => !consumed.has(f.id) && !f.suppressed);
  const stats = summarise(topLevel, results);
  return { results, consumed, scope, paramErrors, stats, topLevel, parallel };
}

/**
 * Everything a boolean needs, resolved on this thread, ready to ship.
 * Returns null when the feature cannot be handed off at all (bad inputs), so
 * the caller runs the normal path and gets the normal error message.
 */
function prepareBoolean(feature, ctx) {
  try {
    const params = resolveParams(feature, ctx.scope);
    const tr = resolveTransform(feature.transform, ctx.scope);
    const matrix = transformMatrix(tr);
    const cat = catalogOf('boolean');
    const inputInstances = [];
    for (const id of feature.inputs) {
      const r = ctx.results.get(id);
      if (!r || r.error) return null;
      for (const inst of r.instances) inputInstances.push(inst);
    }
    if (inputInstances.length < (cat.minInputs || 2)) return null;
    const operands3 = inputInstances.map(i => ({ geometry: i.geometry, matrix: i.matrix }));
    return { op: params.op, operands: operandsToArrays(operands3), operands3, matrix };
  } catch {
    return null;
  }
}

/** Recentre a boolean result and fold its own transform in, as evalOne does. */
function finishBoolean(geom, job) {
  const c = recentre(geom);
  const m = new THREE.Matrix4().makeTranslation(c.x, c.y, c.z).multiply(job.matrix);
  return [{ geometry: geom, matrix: m }];
}

/**
 * Evaluate the whole document.
 * @returns {{ results: Map, consumed: Set, scope: object, paramErrors: object, stats: object }}
 */
export function rebuild(doc) {
  const { scope, errors: paramErrors } = buildScope(doc.params);
  const results = new Map();
  const ctx = { scope, doc, results };
  const consumed = new Set();
  const keys = new Map();

  for (const f of doc.features) {
    if (f.suppressed) continue;
    for (const i of f.inputs) consumed.add(i);
  }

  for (const f of doc.features) {
    if (f.suppressed) {
      results.set(f.id, { instances: [], error: null, suppressed: true, name: f.name });
      keys.set(f.id, 'suppressed');
      continue;
    }
    const inputKeys = f.inputs.map(id => keys.get(id) || '');
    const key = keyOf(f, scope, doc, inputKeys);
    const hit = cache.get(f.id);
    if (hit && hit.key === key) {
      results.set(f.id, { ...hit.result, name: f.name });
      keys.set(f.id, key);
      continue;
    }
    let result;
    try {
      const instances = evalOne(f, ctx);
      result = { instances, error: null, name: f.name };
    } catch (err) {
      result = { instances: [], error: err.message || String(err), name: f.name };
    }
    cache.set(f.id, { key, result });
    keys.set(f.id, key);
    results.set(f.id, result);
  }

  // Drop cache entries for deleted features.
  const live = new Set(doc.features.map(f => f.id));
  for (const id of [...cache.keys()]) if (!live.has(id)) cache.delete(id);

  const topLevel = doc.features.filter(f => !consumed.has(f.id) && !f.suppressed);
  const stats = summarise(topLevel, results);

  return { results, consumed, scope, paramErrors, stats, topLevel };
}
