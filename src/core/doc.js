/**
 * Document model, feature catalogue, undo/redo history and persistence.
 *
 * The document is plain JSON at all times — no class instances, no THREE
 * objects — so it can be structuredClone()d for history and JSON.stringify()d
 * for saving without any custom serialiser.
 */
import { bus, T } from './bus.js';

export const SCHEMA = 3;
export const APP_NAME = 'TesserCAD';
export const APP_VERSION = '1.0.0';
export const FILE_EXT = '.tcad';

let idSeq = 0;
export function uid(prefix = 'f') {
  idSeq++;
  return `${prefix}${Date.now().toString(36).slice(-5)}${idSeq.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

/* ------------------------------------------------------------------ units */

export const UNITS = {
  mm: { label: 'mm', perMm: 1,      prec: 2 },
  cm: { label: 'cm', perMm: 0.1,    prec: 3 },
  m:  { label: 'm',  perMm: 0.001,  prec: 4 },
  in: { label: 'in', perMm: 1 / 25.4, prec: 4 },
  ft: { label: 'ft', perMm: 1 / 304.8, prec: 5 },
};
/** Internal length unit is always the millimetre. */
export function toDisplay(mm, unit) { return mm * (UNITS[unit]?.perMm ?? 1); }
export function fromDisplay(v, unit) { return v / (UNITS[unit]?.perMm ?? 1); }

export const MATERIALS = {
  steel:     { name: 'Steel',        density: 7.85e-6, color: '#8d99ae', metal: 0.9, rough: 0.35 },
  aluminium: { name: 'Aluminium',    density: 2.70e-6, color: '#cfd6de', metal: 0.9, rough: 0.28 },
  stainless: { name: 'Stainless',    density: 8.00e-6, color: '#b6bfc9', metal: 1.0, rough: 0.20 },
  brass:     { name: 'Brass',        density: 8.50e-6, color: '#d7a94b', metal: 0.95, rough: 0.30 },
  copper:    { name: 'Copper',       density: 8.96e-6, color: '#c9764a', metal: 0.95, rough: 0.28 },
  titanium:  { name: 'Titanium',     density: 4.50e-6, color: '#9aa0a6', metal: 0.85, rough: 0.42 },
  abs:       { name: 'ABS plastic',  density: 1.04e-6, color: '#e8e2d8', metal: 0.0, rough: 0.62 },
  pla:       { name: 'PLA',          density: 1.24e-6, color: '#6fcf97', metal: 0.0, rough: 0.58 },
  nylon:     { name: 'Nylon',        density: 1.15e-6, color: '#f2f2f2', metal: 0.0, rough: 0.70 },
  acrylic:   { name: 'Acrylic',      density: 1.18e-6, color: '#bfe6ff', metal: 0.0, rough: 0.10 },
  wood:      { name: 'Wood (pine)',  density: 0.50e-6, color: '#c08b5c', metal: 0.0, rough: 0.80 },
  concrete:  { name: 'Concrete',     density: 2.40e-6, color: '#a5a5a0', metal: 0.0, rough: 0.92 },
  glass:     { name: 'Glass',        density: 2.50e-6, color: '#cfe9f5', metal: 0.0, rough: 0.05 },
  rubber:    { name: 'Rubber',       density: 1.20e-6, color: '#3a3a3a', metal: 0.0, rough: 0.95 },
  custom:    { name: 'Custom',       density: 1.00e-6, color: '#9aa7b8', metal: 0.2, rough: 0.5 },
};
// Densities are kg/mm^3, so volume_mm3 * density = mass in kilograms.

/* ------------------------------------------------------- feature catalogue */

/**
 * Each entry describes one feature type: its default parameters, the editable
 * fields the inspector renders, and how many inputs it consumes.
 * `fields` entries: { key, label, kind, min, max, step, options, unit }
 *   kind: 'len' (length, unit aware) | 'num' | 'ang' | 'int' | 'bool' |
 *         'vec' | 'select' | 'text'
 */
export const CATALOG = {
  box: {
    label: 'Box', glyph: '▧', group: 'solid',
    params: { w: 60, d: 40, h: 25 },
    fields: [
      { key: 'w', label: 'Width (X)', kind: 'len' },
      { key: 'd', label: 'Depth (Y)', kind: 'len' },
      { key: 'h', label: 'Height (Z)', kind: 'len' },
    ],
  },
  cylinder: {
    label: 'Cylinder', glyph: '⬤', group: 'solid',
    params: { r: 20, h: 45, seg: 48, arc: 360 },
    fields: [
      { key: 'r', label: 'Radius', kind: 'len' },
      { key: 'h', label: 'Height', kind: 'len' },
      { key: 'arc', label: 'Sweep', kind: 'ang' },
      { key: 'seg', label: 'Segments', kind: 'int', min: 3, max: 256 },
    ],
  },
  sphere: {
    label: 'Sphere', glyph: '◍', group: 'solid',
    params: { r: 25, seg: 40 },
    fields: [
      { key: 'r', label: 'Radius', kind: 'len' },
      { key: 'seg', label: 'Segments', kind: 'int', min: 4, max: 200 },
    ],
  },
  cone: {
    label: 'Cone / Frustum', glyph: '▲', group: 'solid',
    params: { r1: 25, r2: 0, h: 45, seg: 48 },
    fields: [
      { key: 'r1', label: 'Bottom R', kind: 'len' },
      { key: 'r2', label: 'Top R', kind: 'len' },
      { key: 'h', label: 'Height', kind: 'len' },
      { key: 'seg', label: 'Segments', kind: 'int', min: 3, max: 256 },
    ],
  },
  torus: {
    label: 'Torus', glyph: '◎', group: 'solid',
    params: { R: 30, r: 8, seg: 64, tseg: 24, arc: 360 },
    fields: [
      { key: 'R', label: 'Ring R', kind: 'len' },
      { key: 'r', label: 'Tube R', kind: 'len' },
      { key: 'arc', label: 'Sweep', kind: 'ang' },
      { key: 'seg', label: 'Ring seg', kind: 'int', min: 3, max: 256 },
      { key: 'tseg', label: 'Tube seg', kind: 'int', min: 3, max: 128 },
    ],
  },
  tube: {
    label: 'Tube / Pipe', glyph: '◯', group: 'solid',
    params: { ro: 22, ri: 15, h: 60, seg: 48 },
    fields: [
      { key: 'ro', label: 'Outer R', kind: 'len' },
      { key: 'ri', label: 'Inner R', kind: 'len' },
      { key: 'h', label: 'Height', kind: 'len' },
      { key: 'seg', label: 'Segments', kind: 'int', min: 3, max: 256 },
    ],
  },
  wedge: {
    label: 'Wedge', glyph: '◺', group: 'solid',
    params: { w: 50, d: 40, h: 30 },
    fields: [
      { key: 'w', label: 'Width (X)', kind: 'len' },
      { key: 'd', label: 'Depth (Y)', kind: 'len' },
      { key: 'h', label: 'Height (Z)', kind: 'len' },
    ],
  },
  prism: {
    label: 'Prism', glyph: '⬡', group: 'solid',
    params: { r: 25, h: 40, sides: 6 },
    fields: [
      { key: 'r', label: 'Radius', kind: 'len' },
      { key: 'h', label: 'Height', kind: 'len' },
      { key: 'sides', label: 'Sides', kind: 'int', min: 3, max: 64 },
    ],
  },
  pyramid: {
    label: 'Pyramid', glyph: '△', group: 'solid',
    params: { r: 28, h: 45, sides: 4 },
    fields: [
      { key: 'r', label: 'Base R', kind: 'len' },
      { key: 'h', label: 'Height', kind: 'len' },
      { key: 'sides', label: 'Sides', kind: 'int', min: 3, max: 64 },
    ],
  },
  plate: {
    label: 'Rounded plate', glyph: '▭', group: 'solid',
    params: { w: 80, d: 50, h: 8, fillet: 8, hole: 0, seg: 12 },
    fields: [
      { key: 'w', label: 'Width (X)', kind: 'len' },
      { key: 'd', label: 'Depth (Y)', kind: 'len' },
      { key: 'h', label: 'Thickness', kind: 'len' },
      { key: 'fillet', label: 'Corner R', kind: 'len' },
      { key: 'hole', label: 'Centre hole R', kind: 'len' },
      { key: 'seg', label: 'Corner seg', kind: 'int', min: 1, max: 48 },
    ],
  },
  helix: {
    label: 'Helix / Spring', glyph: '⌇', group: 'solid',
    params: { R: 25, r: 4, pitch: 14, turns: 6, seg: 24, steps: 24 },
    fields: [
      { key: 'R', label: 'Coil R', kind: 'len' },
      { key: 'r', label: 'Wire R', kind: 'len' },
      { key: 'pitch', label: 'Pitch', kind: 'len' },
      { key: 'turns', label: 'Turns', kind: 'num', min: 0.25, max: 200 },
      { key: 'seg', label: 'Wire seg', kind: 'int', min: 3, max: 48 },
      { key: 'steps', label: 'Steps/turn', kind: 'int', min: 6, max: 96 },
    ],
  },

  extrude: {
    label: 'Extrude sketch', glyph: '⇧', group: 'sketch', needsProfile: true,
    params: { dist: 25, symmetric: false, plane: 'xy', offset: 0, taper: 0, twist: 0, steps: 1, capped: true },
    fields: [
      { key: 'dist', label: 'Distance', kind: 'len' },
      { key: 'symmetric', label: 'Midplane', kind: 'bool' },
      { key: 'plane', label: 'Sketch plane', kind: 'select', options: [['xy', 'XY (top)'], ['xz', 'XZ (front)'], ['yz', 'YZ (right)']] },
      { key: 'offset', label: 'Plane offset', kind: 'len' },
      { key: 'taper', label: 'Draft angle', kind: 'ang', min: -60, max: 60 },
      { key: 'twist', label: 'Twist', kind: 'ang', min: -1440, max: 1440 },
      { key: 'steps', label: 'Steps', kind: 'int', min: 1, max: 200 },
    ],
  },
  revolve: {
    label: 'Revolve sketch', glyph: '⟳', group: 'sketch', needsProfile: true,
    params: { angle: 360, axis: 'y', seg: 64, plane: 'xz' },
    fields: [
      { key: 'angle', label: 'Angle', kind: 'ang', min: -360, max: 360 },
      { key: 'axis', label: 'Axis', kind: 'select', options: [['y', 'Vertical (sketch Y)'], ['x', 'Horizontal (sketch X)']] },
      { key: 'plane', label: 'Sketch plane', kind: 'select', options: [['xz', 'XZ (front)'], ['xy', 'XY (top)'], ['yz', 'YZ (right)']] },
      { key: 'seg', label: 'Segments', kind: 'int', min: 3, max: 360 },
    ],
  },

  boolean: {
    label: 'Boolean', glyph: '⊕', group: 'combine', minInputs: 2,
    params: { op: 'union' },
    fields: [{ key: 'op', label: 'Operation', kind: 'select', options: [['union', 'Union (add)'], ['subtract', 'Subtract (cut)'], ['intersect', 'Intersect (common)']] }],
  },
  patternLinear: {
    label: 'Linear pattern', glyph: '⋯', group: 'combine', minInputs: 1, maxInputs: 1,
    params: { dx: 40, dy: 0, dz: 0, count: 4, dx2: 0, dy2: 40, dz2: 0, count2: 1 },
    fields: [
      { key: 'count', label: 'Count 1', kind: 'int', min: 1, max: 400 },
      { key: 'dx', label: 'Step 1 X', kind: 'len' },
      { key: 'dy', label: 'Step 1 Y', kind: 'len' },
      { key: 'dz', label: 'Step 1 Z', kind: 'len' },
      { key: 'count2', label: 'Count 2', kind: 'int', min: 1, max: 400 },
      { key: 'dx2', label: 'Step 2 X', kind: 'len' },
      { key: 'dy2', label: 'Step 2 Y', kind: 'len' },
      { key: 'dz2', label: 'Step 2 Z', kind: 'len' },
    ],
  },
  patternCircular: {
    label: 'Circular pattern', glyph: '✳', group: 'combine', minInputs: 1, maxInputs: 1,
    params: { axis: 'z', cx: 0, cy: 0, cz: 0, count: 6, angle: 360, rotate: true },
    fields: [
      { key: 'count', label: 'Count', kind: 'int', min: 1, max: 400 },
      { key: 'angle', label: 'Total angle', kind: 'ang', min: -360, max: 360 },
      { key: 'axis', label: 'Axis', kind: 'select', options: [['x', 'X'], ['y', 'Y'], ['z', 'Z']] },
      { key: 'cx', label: 'Centre X', kind: 'len' },
      { key: 'cy', label: 'Centre Y', kind: 'len' },
      { key: 'cz', label: 'Centre Z', kind: 'len' },
      { key: 'rotate', label: 'Rotate copies', kind: 'bool' },
    ],
  },
  mirror: {
    label: 'Mirror', glyph: '⇄', group: 'combine', minInputs: 1, maxInputs: 1,
    params: { plane: 'yz', offset: 0, keep: true },
    fields: [
      { key: 'plane', label: 'Mirror plane', kind: 'select', options: [['yz', 'YZ (mirror X)'], ['xz', 'XZ (mirror Y)'], ['xy', 'XY (mirror Z)']] },
      { key: 'offset', label: 'Plane offset', kind: 'len' },
      { key: 'keep', label: 'Keep original', kind: 'bool' },
    ],
  },
  mesh: {
    label: 'Imported mesh', glyph: '◇', group: 'import',
    params: { scale: 1 },
    fields: [{ key: 'scale', label: 'Import scale', kind: 'num', min: 0.0001, max: 10000 }],
  },
};

export function catalogOf(type) { return CATALOG[type] || CATALOG.box; }

/* ---------------------------------------------------------- factory helpers */

/**
 * Force a feature's parameters back inside the ranges the catalogue declares.
 *
 * The catalogue has always carried `min` and `max` for its numeric fields, and
 * until now only the inspector honoured them. That made them a hint to one
 * widget rather than a property of the data, and anything arriving from
 * outside the interface skipped them entirely: a hand-edited `.tcad`, an
 * imported design-intent file, a spec typed into the text editor. A crafted
 * document could therefore ask for a helix of a million turns and get however
 * many triangles the builder happened to tolerate before the tab died.
 *
 * So validation moves to the boundary where untrusted data enters, and the
 * catalogue becomes the single authority on what a parameter may be. This runs
 * inside `migrate`, which every document passes through however it arrived.
 *
 * Expressions are left alone on purpose: a string cannot be range-checked
 * without evaluating it, and the expression engine already refuses a
 * non-finite result at build time with a message naming the feature.
 *
 * SEGMENT_PRODUCT_CEILING is a second, blunter guard: each segment count can
 * sit inside its own limit while the product of several of them does not. It
 * bounds the product, which is a count of grid cells, and a cell is two
 * triangles, so the worst case it permits is about twice this number of
 * triangles. Booleans are gated separately and much harder by TRI_BUDGET.
 */
export const SEGMENT_PRODUCT_CEILING = 125000;

export function sanitiseParams(type, params) {
  const cat = CATALOG[type];
  if (!cat) return { ...params };
  const out = { ...params };
  const fields = new Map((cat.fields || []).map(f => [f.key, f]));

  for (const [key, value] of Object.entries(out)) {
    const field = fields.get(key);
    const fallback = cat.params[key];

    // A parameter with no declared field still has a default, which is the
    // only thing that can be trusted about it.
    if (!field) {
      if (typeof fallback === 'number' && typeof value === 'number' && !Number.isFinite(value)) out[key] = fallback;
      continue;
    }

    if (field.kind === 'bool') { out[key] = !!value; continue; }

    if (field.kind === 'select') {
      const allowed = (field.options || []).map(o => (Array.isArray(o) ? o[0] : o));
      if (allowed.length && !allowed.includes(value)) out[key] = fallback;
      continue;
    }

    if (field.kind === 'text') { out[key] = value == null ? '' : String(value); continue; }

    // Numeric kinds: len, num, ang, int.
    if (typeof value === 'string') continue;               // an expression
    let n = Number(value);
    if (!Number.isFinite(n)) { out[key] = fallback; continue; }
    if (field.kind === 'int') n = Math.round(n);
    const lo = field.min ?? (field.kind === 'int' ? 1 : -Number.MAX_SAFE_INTEGER);
    const hi = field.max ?? (field.kind === 'int' ? 4096 : Number.MAX_SAFE_INTEGER);
    out[key] = Math.min(hi, Math.max(lo, n));
  }

  // Segment counts multiply, so each can be legal while the product is not.
  // Scale the whole set down rather than picking one to blame.
  const segKeys = (cat.fields || [])
    .filter(f => f.kind === 'int' && /seg|steps|sides|tseg/i.test(f.key))
    .map(f => f.key)
    .filter(k => typeof out[k] === 'number');
  if (segKeys.length > 1) {
    let product = segKeys.reduce((n, k) => n * Math.max(1, out[k]), 1);
    const turns = typeof out.turns === 'number' ? Math.max(1, out.turns) : 1;
    product *= turns;
    if (product > SEGMENT_PRODUCT_CEILING) {
      const scale = Math.pow(SEGMENT_PRODUCT_CEILING / product, 1 / segKeys.length);
      for (const k of segKeys) {
        // Floor rather than round: rounding up can put the product back over
        // the ceiling it was just scaled to fit under.
        out[k] = Math.max(fields.get(k).min ?? 3, Math.floor(out[k] * scale));
      }
    }
  }
  return out;
}

export function makeFeature(type, over = {}) {
  const cat = catalogOf(type);
  const mat = MATERIALS[over.material || 'steel'] || MATERIALS.steel;
  return {
    id: uid(),
    type,
    name: over.name || cat.label,
    visible: true,
    suppressed: false,
    inputs: over.inputs ? [...over.inputs] : [],
    params: { ...structuredClone(cat.params), ...(over.params || {}) },
    transform: {
      pos: over.pos ? [...over.pos] : [0, 0, 0],
      rot: over.rot ? [...over.rot] : [0, 0, 0],   // degrees, XYZ order
      scale: over.scale ? [...over.scale] : [1, 1, 1],
    },
    appearance: {
      color: over.color || mat.color,
      opacity: over.opacity ?? 1,
      metalness: mat.metal,
      roughness: mat.rough,
      wireframe: false,
    },
    material: over.material || 'steel',
    profile: over.profile || null,   // for extrude/revolve: array of draft entity ids
    data: over.data || null,         // for mesh: { positions: [...], normals?: [...] }
  };
}

export function makeLayer(name, color) {
  return { id: uid('l'), name, color: color || '#9aa7b8', visible: true, locked: false, weight: 1, style: 'solid' };
}

export function emptyDraw() {
  const l0 = makeLayer('0', '#c9d3e0');
  const dims = makeLayer('Dimensions', '#4da3ff');
  const constr = makeLayer('Construction', '#6b7888');
  return { layers: [l0, dims, constr], entities: [], activeLayer: l0.id };
}

export function emptySim() {
  return {
    duration: 10,
    fps: 30,
    loop: true,
    speed: 1,
    tracks: {},         // featureId -> { props: { prop: [ {t,v,ease} ] } }
    schedule: { enabled: false, items: {} },  // featureId -> { start, dur, mode }
    dynamics: {
      enabled: false,
      gravity: -9810,     // mm/s^2  (-9.81 m/s^2)
      ground: true,
      groundZ: 0,
      airDrag: 0.02,
      substeps: 4,
      bodies: {},         // featureId -> { mass, static, vel, spin, bounce, friction, motor }
    },
  };
}

export function newDocument(name = 'Untitled') {
  return {
    schema: SCHEMA,
    app: APP_NAME,
    appVersion: APP_VERSION,
    meta: {
      name,
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      units: 'mm',
      author: '',
      notes: '',
    },
    params: [
      { id: uid('p'), name: 'width', value: 60, note: 'Example parameter — reference it from any field' },
    ],
    features: [],
    draw: emptyDraw(),
    sim: emptySim(),
    stacks: [],
    view: {
      grid: true,
      axes: true,
      shading: 'shaded-edges',   // shaded | shaded-edges | wire | xray
      ortho: false,
      bg: 'studio',
      clip: { enabled: false, axis: 'x', pos: 0, flip: false },
      ground: true,
    },
  };
}

/* ------------------------------------------------------------ migrations */

export function migrate(doc) {
  if (!doc || typeof doc !== 'object') throw new Error('Not a TesserCAD document');
  const d = structuredClone(doc);
  d.schema = d.schema || 1;
  d.meta = d.meta || { name: 'Imported', units: 'mm' };
  d.meta.units = d.meta.units in UNITS ? d.meta.units : 'mm';
  d.params = Array.isArray(d.params) ? d.params : [];
  d.features = Array.isArray(d.features) ? d.features : [];
  d.draw = d.draw && Array.isArray(d.draw.layers) ? d.draw : emptyDraw();
  d.draw.entities = Array.isArray(d.draw.entities) ? d.draw.entities : [];
  if (!d.draw.activeLayer || !d.draw.layers.some(l => l.id === d.draw.activeLayer)) {
    d.draw.activeLayer = d.draw.layers[0].id;
  }
  const s = emptySim();
  d.sim = { ...s, ...(d.sim || {}) };
  d.sim.schedule = { ...s.schedule, ...(d.sim.schedule || {}) };
  d.sim.dynamics = { ...s.dynamics, ...(d.sim.dynamics || {}) };
  d.sim.tracks = d.sim.tracks || {};
  const v = newDocument().view;
  d.view = { ...v, ...(d.view || {}) };
  d.view.clip = { ...v.clip, ...(d.view.clip || {}) };

  // Configurations arrived after the first schema, so a document without them
  // is normal rather than broken: give it the single default variant.
  if (!d.configs || !Array.isArray(d.configs.list) || !d.configs.list.length) {
    d.configs = { active: 'default', list: [{ id: 'default', name: 'Default', overrides: {}, note: 'The design as drawn.' }] };
  }
  if (!d.configs.list.some(c => c.id === d.configs.active)) d.configs.active = d.configs.list[0].id;
  d.studio = d.studio && typeof d.studio === 'object' ? d.studio : {};
  // Tolerance chains are part of the design, not a session preference, so they
  // live in the document and travel with it.
  if (!Array.isArray(d.stacks)) d.stacks = [];

  // Normalise every feature against the current catalogue.
  d.features = d.features.filter(f => f && f.id && CATALOG[f.type]).map(f => {
    const base = makeFeature(f.type);
    return {
      ...base, ...f,
      params: sanitiseParams(f.type, { ...base.params, ...(f.params || {}) }),
      transform: { ...base.transform, ...(f.transform || {}) },
      appearance: { ...base.appearance, ...(f.appearance || {}) },
      inputs: Array.isArray(f.inputs) ? f.inputs : [],
    };
  });
  // Drop dangling input references.
  const ids = new Set(d.features.map(f => f.id));
  for (const f of d.features) f.inputs = f.inputs.filter(i => ids.has(i));
  d.schema = SCHEMA;
  return d;
}

/* --------------------------------------------------------------- history */

const HISTORY_LIMIT = 120;

/**
 * History is a tree, not two stacks.
 *
 * Every package this one imitates gets this wrong in the same way, and it is
 * the single most bitterly reported thing about all of them: undo a few steps,
 * make one edit, and everything you undid is gone forever. There is no reason
 * for that. The states you undid past still exist; a linear redo stack simply
 * throws them away the moment you do anything else.
 *
 * So an edit after an undo adds a *second child* instead of truncating. The
 * abandoned future stays reachable, named, and one click away in the history
 * dialog. Nothing you have done in a session is ever unreachable while the
 * session lasts.
 *
 * Each node holds a whole document snapshot rather than a delta, for the same
 * reason the version store does: a delta chain that cannot be replayed is
 * worse than no history, and `structuredClone` on plain JSON is fast enough
 * that the simple thing is also the right thing.
 *
 * `visited` is a counter, not a timestamp, so pruning is deterministic and
 * testable rather than dependent on the clock.
 */
let nodeSeq = 0;
function historyNode(label, doc, parent = null) {
  nodeSeq++;
  return {
    id: `h${nodeSeq}`,
    label,
    doc,
    parent,
    children: [],
    // Which child redo should follow: the one you most recently came back
    // from, so redo retraces the path you just undid rather than a sibling.
    next: null,
    visited: nodeSeq,
  };
}

class Store {
  constructor() {
    this.doc = newDocument();
    this.root = historyNode('Blank document', this.doc);
    this.head = this.root;
    this._clock = nodeSeq;
    this.dirty = false;
    this._label = null;
  }

  /** Depth of the current node, which is how many steps back are available. */
  get depth() {
    let n = 0, at = this.head;
    while (at.parent) { at = at.parent; n++; }
    return n;
  }

  /** Snapshot the document before a mutation. Call, mutate, then commit(). */
  begin(label = 'Edit') {
    this._pending = structuredClone(this.doc);
    this._label = label;
  }

  /** Finish a begin()…commit() pair. `rebuild=false` skips geometry evaluation. */
  commit({ rebuild = true, silent = false } = {}) {
    if (this._batch) {
      // Inside a batch, each commit is one step of a larger action rather than
      // an action in its own right, so its snapshot is dropped: the batch
      // pushes a single entry when it finishes.
      this._pending = null;
    } else if (this._pending) {
      // `this.doc` and `head.doc` are the same object, so the mutation that
      // just happened also changed the node's snapshot. Put the pre-edit copy
      // back into the node and hang the mutated document off it as a new
      // child. That is what makes this a branch rather than a truncation:
      // whatever children the node already had are still there.
      this.head.doc = this._pending;
      const node = historyNode(this._label || 'Edit', this.doc, this.head);
      this.head.children.push(node);
      this.head.next = node;
      this.head = node;
      this._clock = nodeSeq;
      this._pending = null;
      this._prune();
    }
    this.doc.meta.modified = new Date().toISOString();
    this.dirty = true;
    if (!silent) bus.emit(rebuild ? T.DOC_CHANGED : T.DOC_TOUCHED, this.doc);
  }

  /**
   * Keep the tree under the node limit.
   *
   * Never drop a node on the path from the root to where you are: that path is
   * your undo chain. Everything else goes oldest-visited first, which sheds
   * long-abandoned branches before recent ones.
   */
  _prune() {
    const all = [];
    const walk = (n) => { all.push(n); n.children.forEach(walk); };
    walk(this.root);
    if (all.length <= HISTORY_LIMIT) return;

    const spine = new Set();
    for (let at = this.head; at; at = at.parent) spine.add(at);

    // Only leaves can be removed without orphaning anything, so shed leaves
    // repeatedly until the tree fits.
    let count = all.length;
    while (count > HISTORY_LIMIT) {
      const leaves = [];
      const collect = (n) => {
        if (!n.children.length && n !== this.root && !spine.has(n)) leaves.push(n);
        n.children.forEach(collect);
      };
      collect(this.root);
      if (!leaves.length) break;              // nothing left but the spine
      leaves.sort((a, b) => a.visited - b.visited);
      const drop = leaves[0];
      drop.parent.children = drop.parent.children.filter(c => c !== drop);
      if (drop.parent.next === drop) drop.parent.next = drop.parent.children.at(-1) || null;
      count--;
    }

    // If even the spine is over the limit, re-root: the oldest states go, and
    // the new root keeps its own snapshot so it is still a usable document.
    const spineList = [];
    for (let at = this.head; at; at = at.parent) spineList.unshift(at);
    if (spineList.length > HISTORY_LIMIT) {
      const newRoot = spineList[spineList.length - HISTORY_LIMIT];
      newRoot.parent = null;
      newRoot.label = 'Earlier history dropped';
      this.root = newRoot;
    }
  }

  /** Convenience: begin + mutate + commit in one call. */
  edit(label, fn, opts) {
    this.begin(label);
    try { fn(this.doc); }
    catch (e) { this._pending = null; throw e; }
    this.commit(opts);
  }

  /**
   * Run `fn`, collapsing everything it commits into one history entry.
   *
   * A macro that does twelve things must cost one undo, or nobody will risk
   * running one. Nesting is a no-op rather than an error so a batch inside a
   * batch still produces exactly one entry, which is the only sane behaviour
   * once macros can call each other.
   */
  batch(label, fn) {
    if (this._batch) return fn();
    this._batch = { doc: structuredClone(this.doc), label };
    try {
      fn();
    } finally {
      const b = this._batch;
      this._batch = null;
      this._pending = b.doc;
      this._label = b.label;
      this.commit();
    }
  }

  /** Mutate without adding a history entry (drag previews, playback state). */
  quiet(fn, { rebuild = false } = {}) {
    fn(this.doc);
    this.dirty = true;
    bus.emit(rebuild ? T.DOC_CHANGED : T.DOC_TOUCHED, this.doc);
  }

  /** Move to a node and make its snapshot the live document. */
  _goto(node, verb) {
    const label = node === this.head ? '' : (verb === 'Undo' ? this.head.label : node.label);
    this.head.visited = ++this._clock;
    this.head = node;
    node.visited = ++this._clock;
    this.doc = node.doc;
    this.dirty = true;
    bus.emit(T.DOC_CHANGED, this.doc);
    if (label) bus.emit(T.STATUS, `${verb}: ${label}`);
    return true;
  }

  undo() {
    if (!this.head.parent) return false;
    const from = this.head;
    from.parent.next = from;          // so redo comes back the way we left
    return this._goto(from.parent, 'Undo');
  }

  redo() {
    const node = this.head.next || this.head.children.at(-1);
    if (!node) return false;
    return this._goto(node, 'Redo');
  }

  canUndo() { return !!this.head.parent; }
  canRedo() { return this.head.children.length > 0; }

  /** Jump to any node by id, including one on an abandoned branch. */
  gotoNode(id) {
    let found = null;
    const walk = (n) => { if (n.id === id) found = n; else n.children.forEach(walk); };
    walk(this.root);
    if (!found || found === this.head) return false;
    // Mark the path so a later redo follows the branch that was chosen.
    for (let at = found; at.parent; at = at.parent) at.parent.next = at;
    return this._goto(found, 'Jump to');
  }

  /**
   * The history as the UI needs it: the chain of states behind you, where you
   * are, the future ahead on the path you last took, and every other branch
   * still reachable. The last of those is the whole point of the tree.
   */
  timeline() {
    const past = [];
    for (let at = this.head.parent; at; at = at.parent) past.unshift({ id: at.id, label: at.label });

    const future = [];
    for (let at = this.head.next || this.head.children.at(-1); at; at = at.next || at.children.at(-1)) {
      future.push({ id: at.id, label: at.label });
    }

    // Anything reachable that is on neither the past chain nor the followed
    // future: a state a linear redo stack would have destroyed.
    const onPath = new Set([this.head.id, ...past.map(p => p.id), ...future.map(f => f.id)]);
    const abandoned = [];
    const walk = (n, depth) => {
      if (!onPath.has(n.id)) abandoned.push({ id: n.id, label: n.label, depth, visited: n.visited });
      n.children.forEach(c => walk(c, depth + 1));
    };
    walk(this.root, 0);
    abandoned.sort((a, b) => b.visited - a.visited);

    return { past, now: { id: this.head.id, label: this.head.label }, future, abandoned, nodes: nodeSeq };
  }

  load(raw, { markClean = true } = {}) {
    this.doc = migrate(raw);
    this.root = historyNode('Opened', this.doc);
    this.head = this.root;
    this._clock = nodeSeq;
    this.dirty = !markClean;
    bus.emit(T.DOC_LOADED, this.doc);
    bus.emit(T.DOC_CHANGED, this.doc);
  }

  reset(name) {
    this.load(newDocument(name));
  }

  /* -------- lookups -------- */
  feature(id) { return this.doc.features.find(f => f.id === id) || null; }
  featureIndex(id) { return this.doc.features.findIndex(f => f.id === id); }

  /** ids consumed by a later feature — they are not rendered at top level */
  consumedIds() {
    const s = new Set();
    for (const f of this.doc.features) {
      if (f.suppressed) continue;
      for (const i of f.inputs) s.add(i);
    }
    return s;
  }

  entity(id) { return this.doc.draw.entities.find(e => e.id === id) || null; }
  layer(id) { return this.doc.draw.layers.find(l => l.id === id) || null; }

  uniqueName(base) {
    const taken = new Set(this.doc.features.map(f => f.name));
    if (!taken.has(base)) return base;
    let n = 2;
    while (taken.has(`${base} ${n}`)) n++;
    return `${base} ${n}`;
  }
}

export const store = new Store();

/* ----------------------------------------------------------- autosave */

const AUTOSAVE_KEY = 'tessercad.autosave.v3';

export function saveLocal() {
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ at: Date.now(), doc: store.doc }));
    return true;
  } catch (e) {
    console.warn('autosave failed', e);
    return false;
  }
}

export function loadLocal() {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return null;
    const wrap = JSON.parse(raw);
    if (!wrap || !wrap.doc) return null;
    return wrap;
  } catch { return null; }
}

export function clearLocal() {
  try { localStorage.removeItem(AUTOSAVE_KEY); } catch { /* ignore */ }
}
