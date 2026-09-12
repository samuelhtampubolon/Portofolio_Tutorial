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

  // Normalise every feature against the current catalogue.
  d.features = d.features.filter(f => f && f.id && CATALOG[f.type]).map(f => {
    const base = makeFeature(f.type);
    return {
      ...base, ...f,
      params: { ...base.params, ...(f.params || {}) },
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

class Store {
  constructor() {
    this.doc = newDocument();
    this.undoStack = [];
    this.redoStack = [];
    this.dirty = false;
    this._label = null;
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
      this.undoStack.push({ label: this._label, doc: this._pending });
      if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
      this.redoStack.length = 0;
      this._pending = null;
    }
    this.doc.meta.modified = new Date().toISOString();
    this.dirty = true;
    if (!silent) bus.emit(rebuild ? T.DOC_CHANGED : T.DOC_TOUCHED, this.doc);
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

  undo() {
    const prev = this.undoStack.pop();
    if (!prev) return false;
    this.redoStack.push({ label: prev.label, doc: structuredClone(this.doc) });
    this.doc = prev.doc;
    this.dirty = true;
    bus.emit(T.DOC_CHANGED, this.doc);
    bus.emit(T.STATUS, `Undo: ${prev.label}`);
    return true;
  }

  redo() {
    const next = this.redoStack.pop();
    if (!next) return false;
    this.undoStack.push({ label: next.label, doc: structuredClone(this.doc) });
    this.doc = next.doc;
    this.dirty = true;
    bus.emit(T.DOC_CHANGED, this.doc);
    bus.emit(T.STATUS, `Redo: ${next.label}`);
    return true;
  }

  canUndo() { return this.undoStack.length > 0; }
  canRedo() { return this.redoStack.length > 0; }

  load(raw, { markClean = true } = {}) {
    this.doc = migrate(raw);
    this.undoStack.length = 0;
    this.redoStack.length = 0;
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
