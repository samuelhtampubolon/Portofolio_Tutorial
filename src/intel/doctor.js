/**
 * The Design Doctor: continuous validation, and repairs that keep design intent.
 *
 * Conventional CAD answers "is this geometry valid?" and leaves the more useful
 * question alone: will this part actually work, and can the shop you are sending
 * it to make it? The Doctor runs after every rebuild and turns that into a
 * ranked list of findings, each one carrying three things a bare error message
 * never does — what is wrong, why it matters, and where possible a repair the
 * user can apply without understanding the internals.
 *
 * Two rules govern everything here.
 *
 * It never edits on its own. Every repair is a described, single-step, undoable
 * edit the user chooses. Software that silently "fixes" a model teaches you not
 * to trust it.
 *
 * It never claims more precision than it has. Several of these checks are honest
 * proxies rather than exact analyses: real minimum-wall detection wants a medial
 * axis, and interference wants a mesh-mesh intersection. Where a check is a
 * proxy the finding says so in its own text, so a user is never misled about
 * what has been verified. Nothing here is a substitute for FEA or a DFM review.
 */
import * as THREE from 'three';
import { MATERIALS, catalogOf } from '../core/doc.js';
import { massProperties } from '../core/rebuild.js';
import { TRI_BUDGET } from '../core/csg.js';
import { processOf, processSuits, PROCESSES } from './process.js';
import { limits } from './standards.js';

/** Ranked worst-first. `block` findings should stop a release. */
export const SEVERITY = { block: 3, warn: 2, note: 1 };
const SEV_LABEL = { 3: 'Blocking', 2: 'Warning', 1: 'Note' };
export const severityLabel = (s) => SEV_LABEL[s] || 'Note';

/* ------------------------------------------------------------ body extraction */

/**
 * Mass properties for every visible top-level body, with the feature that owns
 * it. Computed once and shared by every check that needs geometry.
 */
function bodiesOf(doc, build) {
  const out = [];
  for (const f of build.topLevel) {
    const r = build.results.get(f.id);
    if (!r || r.error || !r.instances.length) continue;
    for (let i = 0; i < r.instances.length; i++) {
      const inst = r.instances[i];
      const mp = massProperties(inst.geometry, inst.matrix);
      out.push({ feature: f, index: i, instances: r.instances.length, ...mp });
    }
  }
  return out;
}

/* ----------------------------------------------------------------- the checks */

/**
 * Each check receives the shared context and pushes findings. Splitting them
 * this way means a check can be read, argued with, and tested on its own.
 */
const CHECKS = [];
const check = (id, fn) => CHECKS.push({ id, fn });

/* ---- build integrity, and the repairs that go with it ---- */

check('feature-failed', (ctx, add) => {
  for (const f of ctx.doc.features) {
    const r = ctx.build.results.get(f.id);
    if (!r || !r.error) continue;
    const repair = diagnoseFailure(f, r.error, ctx);
    add({
      severity: SEVERITY.block,
      featureId: f.id,
      title: `${f.name} failed to build`,
      detail: r.error,
      why: repair
        ? repair.why
        : 'A failed feature contributes no geometry, so anything downstream of it is building against a hole in the model.',
      fix: repair ? repair.fix : null,
    });
  }
});

check('param-error', (ctx, add) => {
  for (const [name, msg] of Object.entries(ctx.build.paramErrors || {})) {
    add({
      severity: SEVERITY.block,
      title: `Parameter “${name}” does not evaluate`,
      detail: msg,
      why: 'Every feature that references this parameter falls back to its default, so the model you are looking at is not the model you described.',
    });
  }
});

check('starved-boolean', (ctx, add) => {
  for (const f of ctx.doc.features) {
    if (!['boolean'].includes(f.type)) continue;
    const live = f.inputs.filter(id => {
      const g = ctx.doc.features.find(x => x.id === id);
      return g && !g.suppressed;
    });
    if (live.length >= 2 || ctx.build.results.get(f.id)?.error) continue;
    add({
      severity: SEVERITY.warn,
      featureId: f.id,
      title: `${f.name} has ${live.length} live input${live.length === 1 ? '' : 's'}`,
      detail: 'A boolean needs at least two bodies to combine.',
      why: 'A boolean with one input silently passes that body through unchanged, which looks like it worked and is why this kind of break survives to the shop floor.',
    });
  }
});

/* ---- geometry you cannot manufacture ---- */

check('open-shell', (ctx, add) => {
  for (const b of ctx.bodies) {
    if (b.closed) continue;
    add({
      severity: SEVERITY.block,
      featureId: b.feature.id,
      title: `${b.feature.name} is not a closed solid`,
      detail: 'The surface does not enclose a volume, so it has no mass and no inside.',
      why: 'Slicers, CAM and every mass calculation need a watertight solid. An open shell will usually export without complaint and then fail at the machine.',
    });
  }
});

check('tiny-feature', (ctx, add) => {
  const p = ctx.process;
  for (const b of ctx.bodies) {
    const min = Math.min(b.size.x, b.size.y, b.size.z);
    if (!(min > 0) || min >= ctx.limits.minFeature) continue;
    add({
      severity: SEVERITY.warn,
      featureId: b.feature.id,
      title: `${b.feature.name} is ${fmt(min)}mm at its thinnest`,
      detail: `${p.label} holds about ${ctx.limits.minFeature}mm.`,
      why: `Below the process minimum the feature either disappears or arrives out of tolerance. This measures the body's overall bounding box, not its true minimum wall, so treat it as a prompt to look rather than a verdict.`,
    });
  }
});

check('thin-wall', (ctx, add) => {
  const p = ctx.process;
  for (const f of ctx.doc.features) {
    if (ctx.build.results.get(f.id)?.error) continue;
    // Tube is the one primitive whose wall thickness is exactly known from its
    // parameters, so it gets a real answer rather than a bounding-box proxy.
    if (f.type !== 'tube') continue;
    const wall = num(ctx, f.params.ro) - num(ctx, f.params.ri);
    if (!(wall > 0) || wall >= ctx.limits.minWall) continue;
    add({
      severity: SEVERITY.warn,
      featureId: f.id,
      title: `${f.name} has a ${fmt(wall)}mm wall`,
      detail: `${p.label} needs at least ${ctx.limits.minWall}mm.`,
      why: 'A wall under the process minimum will not fill, will not bond between layers, or will blow through when machined.',
      fix: {
        label: `Open the wall to ${ctx.limits.minWall}mm`,
        apply: (store) => store.edit('Thicken wall', (d) => {
          const t = d.features.find(x => x.id === f.id);
          if (t) t.params.ri = round2(num(ctx, t.params.ro) - ctx.limits.minWall);
        }),
      },
    });
  }
});

check('envelope', (ctx, add) => {
  const p = ctx.process;
  const s = ctx.build.stats;
  if (!s.bodies) return;
  const size = new THREE.Vector3(); s.box.getSize(size);
  // Compare the part's sorted dimensions against the sorted envelope, which is
  // the same thing as asking whether it fits in any orientation.
  const part = [size.x, size.y, size.z].sort((a, b) => b - a);
  const env = [...p.envelope].sort((a, b) => b - a);
  const over = part.findIndex((v, i) => v > env[i]);
  if (over < 0) return;
  add({
    severity: SEVERITY.warn,
    title: `The part does not fit a ${p.label} envelope`,
    detail: `${fmt(part[0])} × ${fmt(part[1])} × ${fmt(part[2])}mm against ${env.join(' × ')}mm.`,
    why: 'It will have to be split, re-oriented onto a larger machine, or made by a different process, and each of those changes the price and the lead time.',
  });
});

check('material-process', (ctx, add) => {
  const mats = new Set(ctx.doc.features.filter(f => !f.suppressed).map(f => f.material));
  for (const m of mats) {
    if (processSuits(ctx.processId, m)) continue;
    add({
      severity: SEVERITY.warn,
      title: `${MATERIALS[m]?.name || m} cannot be made by ${ctx.process.label}`,
      detail: 'The material and the process in the document do not go together.',
      why: 'Mass, cost and every manufacturability check below are computed from this pair, so while they disagree none of those numbers mean anything.',
    });
  }
});

check('interference', (ctx, add) => {
  const b = ctx.bodies;
  if (b.length < 2 || b.length > 60) return;   // O(n²); skip on very large assemblies
  const seen = new Set();
  for (let i = 0; i < b.length; i++) {
    for (let j = i + 1; j < b.length; j++) {
      if (b[i].feature.id === b[j].feature.id) continue;   // instances of one pattern
      if (!b[i].box.intersectsBox(b[j].box)) continue;
      const o = b[i].box.clone().intersect(b[j].box);
      const s = new THREE.Vector3(); o.getSize(s);
      const vol = s.x * s.y * s.z;
      if (vol < 1e-3) continue;
      const key = [b[i].feature.id, b[j].feature.id].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      add({
        severity: SEVERITY.note,
        featureId: b[i].feature.id,
        title: `${b[i].feature.name} and ${b[j].feature.name} may intersect`,
        detail: `Their bounding boxes overlap by ${fmt(s.x)} × ${fmt(s.y)} × ${fmt(s.z)}mm.`,
        why: 'Two solids occupying the same space is either an assembly clash or a missing boolean. This compares bounding boxes, not the solids themselves, so a diagonal part will report an overlap it does not have — the check is here to make you look.',
        fix: {
          label: 'Union them into one body',
          apply: (store, makeFeature) => store.edit('Union overlapping bodies', (d) => {
            const f = makeFeature('boolean', { name: 'Union', params: { op: 'union' }, inputs: [b[i].feature.id, b[j].feature.id] });
            d.features.push(f);
          }),
        },
      });
    }
  }
});

/* ---- intent that has gone missing ---- */

check('unused-param', (ctx, add) => {
  const used = referencedParams(ctx.doc);
  for (const p of ctx.doc.params) {
    if (used.has(p.name)) continue;
    add({
      severity: SEVERITY.note,
      title: `Parameter “${p.name}” drives nothing`,
      detail: `Defined as ${p.value}, referenced by no feature.`,
      why: 'Either a dimension was meant to be driven by it and is not, or it is left over from an earlier revision. Both mislead the next person to open the file.',
      fix: {
        label: 'Delete the parameter',
        apply: (store) => store.edit('Delete unused parameter', (d) => {
          d.params = d.params.filter(x => x.name !== p.name);
        }),
      },
    });
  }
});

check('hardcoded', (ctx, add) => {
  if (!ctx.doc.params.length) return;
  const loose = ctx.doc.features.filter(f => {
    if (f.suppressed || f.type === 'mesh') return false;
    const fields = catalogOf(f.type).fields.filter(x => x.kind === 'len');
    if (!fields.length) return false;
    return fields.every(x => typeof f.params[x.key] !== 'string');
  });
  // One unparameterised feature is a judgement call; a model that is almost all
  // raw numbers while carrying named parameters is a broken intent.
  if (loose.length < 2 || loose.length < ctx.doc.features.length * 0.6) return;
  add({
    severity: SEVERITY.note,
    title: `${loose.length} features use raw numbers, not parameters`,
    detail: `The document defines ${ctx.doc.params.length} parameter${ctx.doc.params.length === 1 ? '' : 's'} that these features ignore.`,
    why: 'The point of a feature tree is that changing one number changes everything that depends on it. Dimensions typed in by hand look identical and do not move.',
  });
});

check('duplicate-name', (ctx, add) => {
  const byName = new Map();
  for (const f of ctx.doc.features) {
    if (f.suppressed) continue;
    byName.set(f.name, (byName.get(f.name) || 0) + 1);
  }
  for (const [name, n] of byName) {
    if (n < 2) continue;
    add({
      severity: SEVERITY.note,
      title: `${n} features are called “${name}”`,
      detail: 'Names are how a bill of materials tells parts apart.',
      why: 'A BOM, a drawing balloon and a supplier purchase order all key off the name. Duplicates turn into the wrong part being ordered.',
    });
  }
});

check('mesh-opaque', (ctx, add) => {
  for (const f of ctx.doc.features) {
    if (f.type !== 'mesh' || f.suppressed) continue;
    add({
      severity: SEVERITY.note,
      featureId: f.id,
      title: `${f.name} is an imported mesh`,
      detail: 'Triangles only: no parameters, no features, nothing to edit but scale.',
      why: 'Imported geometry cannot follow a parameter change, so any dimension driven off it will silently stop tracking the rest of the model.',
    });
  }
});

check('tri-budget', (ctx, add) => {
  const t = ctx.build.stats.tris;
  if (t < TRI_BUDGET * 0.7) return;
  add({
    severity: t > TRI_BUDGET * 0.95 ? SEVERITY.warn : SEVERITY.note,
    title: `${t.toLocaleString()} triangles, against a ${TRI_BUDGET.toLocaleString()} budget`,
    detail: 'Booleans past this size are refused rather than run.',
    why: 'Segment counts on curved primitives are usually the cause, and dropping them costs far less accuracy than you would expect.',
    fix: {
      label: 'Halve segment counts on curved features',
      apply: (store) => store.edit('Reduce tessellation', (d) => {
        for (const f of d.features) {
          for (const k of ['seg', 'tseg']) {
            const v = f.params[k];
            if (typeof v === 'number' && v > 16) f.params[k] = Math.max(16, Math.round(v / 2));
          }
        }
      }),
    },
  });
});

check('scale-sanity', (ctx, add) => {
  const s = ctx.build.stats;
  if (!s.bodies) return;
  const size = new THREE.Vector3(); s.box.getSize(size);
  const max = Math.max(size.x, size.y, size.z);
  if (max > 0 && max < 1) {
    add({
      severity: SEVERITY.warn,
      title: `The whole model is under 1mm across`,
      detail: `Largest dimension ${fmt(max)}mm.`,
      why: 'Almost always a unit mix-up on import: a model authored in metres or inches read as millimetres. Check before you machine it.',
    });
  } else if (max > 10000) {
    add({
      severity: SEVERITY.note,
      title: `The model is ${fmt(max / 1000)}m across`,
      detail: 'Larger than any of the processes in the cost model.',
      why: 'If that is deliberate this is fine; if it is not, it is the same unit mix-up in the other direction.',
    });
  }
});

check('no-bodies', (ctx, add) => {
  if (ctx.build.stats.bodies || !ctx.doc.features.length) return;
  add({
    severity: SEVERITY.warn,
    title: 'The document has features but no visible bodies',
    detail: 'Everything is either suppressed, consumed by a boolean, or failing.',
    why: 'An empty model exports as an empty file, and that is usually discovered by whoever receives it rather than by you.',
  });
});

/* -------------------------------------------------- failure diagnosis */

/**
 * Turn a thrown build error into an explanation and, where the intent is
 * recoverable, a repair.
 *
 * This is the half of self-healing that matters: not guessing at what the user
 * meant, but recognising the handful of breaks whose correct repair is genuinely
 * unambiguous, and saying plainly what is being changed.
 */
function diagnoseFailure(f, message, ctx) {
  const m = String(message).toLowerCase();

  if (m.includes('needs at least two') || m.includes('needs an input')) {
    const candidates = ctx.doc.features.filter(x => x.id !== f.id && !x.suppressed && !ctx.build.results.get(x.id)?.error);
    const suppressed = f.inputs.map(id => ctx.doc.features.find(x => x.id === id)).filter(x => x && x.suppressed);
    if (suppressed.length) {
      return {
        why: `Its input ${suppressed.map(x => `“${x.name}”`).join(' and ')} ${suppressed.length === 1 ? 'is' : 'are'} suppressed, so this feature has nothing to work on. The intent is intact; the input is just switched off.`,
        fix: {
          label: `Unsuppress ${suppressed.map(x => x.name).join(', ')}`,
          apply: (store) => store.edit('Restore suppressed input', (d) => {
            for (const s of suppressed) {
              const t = d.features.find(x => x.id === s.id);
              if (t) t.suppressed = false;
            }
          }),
        },
      };
    }
    if (f.inputs.length === 0 && candidates.length >= 2) {
      const pick = candidates.slice(-2).map(x => x.id);
      return {
        why: 'Its inputs were lost, most likely because the features it referenced were deleted. The two most recent bodies are the usual intent.',
        fix: {
          label: `Use ${candidates.slice(-2).map(x => x.name).join(' and ')}`,
          apply: (store) => store.edit('Reconnect boolean inputs', (d) => {
            const t = d.features.find(x => x.id === f.id);
            if (t) t.inputs = pick;
          }),
        },
      };
    }
    return { why: 'The feature lost the bodies it was combining, and there is no unambiguous replacement in the document. Pick its inputs in the feature tree.', fix: null };
  }

  if (m.includes('no sketch geometry') || m.includes('no closed region')) {
    const closed = ctx.doc.draw.entities.filter(e => e.closed || e.type === 'rect' || e.type === 'circle' || e.type === 'polygon' || e.type === 'ellipse');
    if (closed.length) {
      return {
        why: 'The drawing entities this feature was linked to are gone, but the Draft workspace still holds closed profiles it could use instead.',
        fix: {
          label: `Relink to the ${closed.length} closed profile${closed.length === 1 ? '' : 's'} in Draft`,
          apply: (store) => store.edit('Relink profile', (d) => {
            const t = d.features.find(x => x.id === f.id);
            if (t) t.profile = closed.map(e => e.id);
          }),
        },
      };
    }
    return { why: 'The profile it extruded no longer exists, and the drawing has no closed region to put in its place. Draw one in Draft, select it, and use “Use as profile”.', fix: null };
  }

  if (m.includes('more than 2000 instances')) {
    return {
      why: 'A pattern count is being driven by an expression that has grown past what the engine will evaluate. The pattern itself is fine; the number feeding it is not.',
      fix: {
        label: 'Clamp the count to 200',
        apply: (store) => store.edit('Clamp pattern count', (d) => {
          const t = d.features.find(x => x.id === f.id);
          if (t) t.params.count = 200;
        }),
      },
    };
  }

  if (m.includes('triangle') || m.includes('budget')) {
    return {
      why: 'The boolean was refused because its operands carry more triangles than the engine will process, not because the geometry is wrong.',
      fix: {
        label: 'Halve segment counts and rebuild',
        apply: (store) => store.edit('Reduce tessellation', (d) => {
          for (const x of d.features) {
            for (const k of ['seg', 'tseg']) {
              const v = x.params[k];
              if (typeof v === 'number' && v > 16) x.params[k] = Math.max(16, Math.round(v / 2));
            }
          }
        }),
      },
    };
  }

  return null;
}

/* ------------------------------------------------------------------ helpers */

function referencedParams(doc) {
  const used = new Set();
  const scan = (v) => {
    if (typeof v !== 'string') return;
    for (const m of v.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) used.add(m[0]);
  };
  for (const f of doc.features) {
    for (const v of Object.values(f.params)) scan(v);
    for (const v of [...f.transform.pos, ...f.transform.rot, ...f.transform.scale]) scan(v);
  }
  for (const p of doc.params) scan(p.value);
  return used;
}

function num(ctx, v) {
  if (typeof v === 'number') return v;
  const n = Number(v);
  if (Number.isFinite(n)) return n;
  const s = ctx.build.scope?.[String(v)];
  return Number.isFinite(s) ? s : 0;
}

const fmt = (v) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2));
const round2 = (v) => Math.round(v * 100) / 100;

/* -------------------------------------------------------------- the entry point */

/**
 * Run every check against a rebuilt document.
 *
 * @param {object} doc      the live document
 * @param {object} build    the result of rebuild(doc)
 * @param {object} opts     { process: processId }
 * @returns {{ issues: object[], counts: object, worst: number, checked: number }}
 */
export function diagnose(doc, build, { process: processId = 'cnc3' } = {}) {
  const ctx = {
    doc, build,
    processId,
    process: processOf(processId),
    // House minimums win over the process defaults: a shop that knows it can
    // hold 0.6mm should not be told off for holding 0.6mm.
    limits: limits(processOf(processId)),
    bodies: bodiesOf(doc, build),
  };
  const issues = [];
  for (const c of CHECKS) {
    const add = (issue) => issues.push({ check: c.id, severity: SEVERITY.note, ...issue });
    try { c.fn(ctx, add); }
    catch (err) {
      // A broken check must never take the panel down with it.
      issues.push({
        check: c.id, severity: SEVERITY.note,
        title: `The “${c.id}” check could not run`,
        detail: String(err.message || err),
        why: 'This is a defect in the Doctor, not in your model.',
      });
    }
  }
  issues.sort((a, b) => b.severity - a.severity || a.title.localeCompare(b.title));
  const counts = { block: 0, warn: 0, note: 0 };
  for (const i of issues) counts[i.severity === 3 ? 'block' : i.severity === 2 ? 'warn' : 'note']++;
  return { issues, counts, worst: issues.length ? issues[0].severity : 0, checked: CHECKS.length };
}

export const CHECK_IDS = CHECKS.map(c => c.id);
export { PROCESSES };
