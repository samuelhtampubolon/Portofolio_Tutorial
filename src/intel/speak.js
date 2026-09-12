/**
 * Typed intent to a real feature tree.
 *
 * The want is clear and repeated everywhere: say "a 60 by 40 plate 8 thick
 * with 4 M6 holes" and get something you can edit afterwards, not a dead mesh
 * and not a hundred clicks. What everybody reaches for is a language model,
 * and this application has no server and no model by design. So it does the
 * part that can be done properly offline, and says plainly which part that is.
 *
 * This is a grammar, not a language model. It does not understand English; it
 * recognises a vocabulary of shapes, numbers, units and relations, and refuses
 * anything outside it rather than guessing. That refusal is the feature: a
 * co-pilot that quietly does the wrong thing costs more than one that says it
 * did not follow you. Every parse reports exactly what it understood, in the
 * app's own vocabulary, before anything is built.
 *
 * What it produces is always the same kind of thing the mouse produces: real
 * catalogue features with real parameters, driven by expressions where the
 * phrasing implies a relationship. "M6 clearance" becomes 6.6, and a count
 * along a spacing becomes a pattern rather than n copies, because a pattern is
 * the thing you can change your mind about later.
 *
 * Companion to spec.js: that is the whole document as text, this is one
 * sentence at a time. Both end at the same place, a feature you can drag.
 */
import { CATALOG, MATERIALS, makeFeature } from '../core/doc.js';

/* -------------------------------------------------------------- vocabulary */

/** Shape words, including the ones people actually say. */
const SHAPES = {
  box: ['box', 'block', 'cube', 'cuboid', 'slab', 'bar'],
  plate: ['plate', 'panel', 'sheet', 'flange'],
  cylinder: ['cylinder', 'cyl', 'rod', 'shaft', 'pin', 'peg', 'disc', 'disk', 'boss'],
  tube: ['tube', 'pipe', 'sleeve', 'bush', 'bushing', 'ring', 'washer'],
  sphere: ['sphere', 'ball', 'dome'],
  cone: ['cone', 'taper', 'frustum'],
  torus: ['torus', 'donut', 'doughnut', 'toroid'],
  wedge: ['wedge', 'ramp'],
  prism: ['prism', 'hex', 'hexagon', 'hexagonal'],
  pyramid: ['pyramid'],
  helix: ['helix', 'spring', 'coil', 'thread'],
};

/** Words that mean "remove material", which is a boolean, not a shape. */
const CUT_WORDS = ['hole', 'holes', 'bore', 'bores', 'cut', 'pocket', 'slot', 'drill', 'drilled', 'counterbore'];

/**
 * Length units, to millimetres. Everything internal is millimetres.
 *
 * The bare `m` is last in the tokeniser's alternation and guarded by a
 * lookahead, so "mm" still matches as millimetres and the `m` of "M6" is never
 * mistaken for metres.
 */
const UNITS = {
  mm: 1, millimetre: 1, millimetres: 1, millimeter: 1, millimeters: 1,
  cm: 10, centimetre: 10, centimetres: 10, centimeter: 10, centimeters: 10,
  m: 1000, metre: 1000, metres: 1000, meter: 1000, meters: 1000,
  in: 25.4, inch: 25.4, inches: 25.4, '"': 25.4,
  ft: 304.8, foot: 304.8, feet: 304.8, "'": 304.8,
  thou: 0.0254, mil: 0.0254,
};

/**
 * ISO metric clearance holes, medium series (ISO 273), in millimetres.
 * These are the numbers that make "M6 clearance" mean something exact rather
 * than approximately six.
 */
export const METRIC_CLEARANCE = {
  M1_6: 1.8, M2: 2.4, M2_5: 2.9, M3: 3.4, M4: 4.5, M5: 5.5, M6: 6.6, M8: 9,
  M10: 11, M12: 13.5, M14: 15.5, M16: 17.5, M20: 22, M24: 26, M30: 33, M36: 39,
};

/** Tapping drill sizes for a standard coarse thread, millimetres. */
export const METRIC_TAPPING = {
  M1_6: 1.25, M2: 1.6, M2_5: 2.05, M3: 2.5, M4: 3.3, M5: 4.2, M6: 5, M8: 6.8,
  M10: 8.5, M12: 10.2, M14: 12, M16: 14, M20: 17.5, M24: 21, M30: 26.5, M36: 32,
};

const metricKey = (size) => `M${String(size).replace('.', '_')}`;

/** Named words for small counts, because people write "four holes". */
const NUMBER_WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, twelve: 12, sixteen: 16, twenty: 20, twentyfour: 24,
};

const AXES = { x: 'x', y: 'y', z: 'z', across: 'x', along: 'x', up: 'z', vertical: 'z', horizontal: 'x' };

/* ------------------------------------------------------------------ tokens */

/** Word and number tokens, with units attached to the number they follow. */
function tokenize(text) {
  const out = [];
  const src = String(text ?? '').toLowerCase();
  // The separator alternative comes before the word alternative so a bare "x"
  // between dimensions reads as "by" rather than as an unrecognised word.
  const re = /(\d+\.?\d*|\.\d+)\s*(mm|cm|millimetres?|millimeters?|centimetres?|centimeters?|metres?|meters?|inches|inch|in\b|thou|mil|ft|feet|foot|m(?![a-z0-9])|["'])?|(?:\b(by)\b|([×*,@])|(?<![a-z])x(?![a-z]))|([a-z][a-z0-9_.]*)|(\S)/g;
  let m;
  while ((m = re.exec(src))) {
    if (m[1] !== undefined) {
      const unit = m[2] ? (UNITS[m[2]] ?? 1) : null;
      out.push({ t: 'num', v: Number(m[1]), unit, raw: m[0].trim() });
    } else if (m[3] !== undefined || m[4] !== undefined) {
      out.push({ t: 'sep', v: 'by' });
    } else if (m[5] !== undefined) {
      const w = m[5];
      if (NUMBER_WORDS[w] !== undefined) out.push({ t: 'num', v: NUMBER_WORDS[w], unit: null, raw: w });
      else out.push({ t: 'word', v: w });
    } else if (m[0] === 'x' || m[0] === 'X') {
      out.push({ t: 'sep', v: 'by' });
    } else {
      out.push({ t: 'punct', v: m[6] ?? m[0] });
    }
  }
  return out;
}

const shapeFor = (word) => {
  for (const [type, words] of Object.entries(SHAPES)) if (words.includes(word)) return type;
  return null;
};

/* ------------------------------------------------------------------ parse */

/**
 * Read one instruction.
 *
 * @returns {{ok: boolean, plan: object|null, understood: string[], unknown: string[], why: string}}
 *   `understood` is the readback: every fact taken from the sentence, in the
 *   app's own words. `unknown` lists words that were ignored, because a
 *   silently dropped word is how a co-pilot builds the wrong part.
 */
export function parse(text, { context = {} } = {}) {
  const tokens = tokenize(text);
  if (!tokens.length) return { ok: false, plan: null, understood: [], unknown: [], why: 'Nothing to read.' };

  const used = new Set();
  const understood = [];
  const take = (i) => { used.add(i); return tokens[i]; };

  /* --- what kind of thing --- */
  let type = null, typeAt = -1, isCut = false;
  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];
    if (tk.t !== 'word') continue;
    if (CUT_WORDS.includes(tk.v)) { isCut = true; typeAt = i; take(i); if (!type) type = 'cylinder'; continue; }
    const s = shapeFor(tk.v);
    if (!s) continue;
    take(i);                                  // recognised either way
    if (!type) { type = s; typeAt = i; }
  }
  if (!type) {
    return {
      ok: false, plan: null, understood: [], unknown: [],
      why: `No shape in that. This reads a vocabulary rather than English, so it needs one of: ${Object.keys(SHAPES).join(', ')}, or a hole to cut.`,
    };
  }

  /* --- thread callouts: M6, M6 clearance, tapped M8 --- */
  let thread = null;
  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];
    if (tk.t !== 'word') continue;
    const m = /^m(\d+(?:\.\d+)?)$/.exec(tk.v);
    if (!m) continue;
    const size = Number(m[1]);
    const key = metricKey(size);
    if (!(key in METRIC_CLEARANCE)) continue;
    const tapped = tokens.some((t, j) => t.t === 'word' && /^tapp?ed$/.test(t.v) && Math.abs(j - i) <= 3);
    thread = { size, key, tapped, dia: tapped ? METRIC_TAPPING[key] : METRIC_CLEARANCE[key] };
    take(i);
    // Consume the qualifier word so it is not reported as unknown.
    for (let j = Math.max(0, i - 2); j <= Math.min(tokens.length - 1, i + 2); j++) {
      if (tokens[j].t === 'word' && /^(clearance|tapp?ed|thread|threads|bolt|bolts|screw|screws)$/.test(tokens[j].v)) take(j);
    }
    understood.push(`M${size} ${tapped ? 'tapping' : 'clearance'} diameter ${thread.dia} mm`);
    break;
  }

  /* --- numbers, with their units resolved --- */
  const nums = [];
  tokens.forEach((tk, i) => {
    if (tk.t !== 'num' || used.has(i)) return;
    nums.push({ i, v: tk.v, unit: tk.unit, raw: tk.raw });
  });

  /** A number that a keyword points at: "8 thick", "thickness 8", "r 20". */
  const labelled = (words) => {
    for (const n of nums) {
      if (n.taken) continue;
      for (let d = 1; d <= 2; d++) {
        for (const j of [n.i - d, n.i + d]) {
          const tk = tokens[j];
          if (tk?.t === 'word' && words.includes(tk.v)) {
            n.taken = true; used.add(n.i); used.add(j);
            return n;
          }
        }
      }
    }
    return null;
  };

  /**
   * A number spoken before its noun, with anything in between.
   *
   * "4 M6 clearance holes" puts three words between the count and the thing
   * being counted, so adjacency is not enough. Counts are always spoken first
   * in English, which makes "nearest number to the left" the right rule and
   * stops "40 apart" being read as the count.
   */
  const precedes = (words, maxGap = 6) => {
    for (let i = 0; i < tokens.length; i++) {
      const tk = tokens[i];
      if (tk.t !== 'word' || !words.includes(tk.v)) continue;
      for (let j = i - 1; j >= 0 && i - j <= maxGap; j--) {
        const n = nums.find(x => x.i === j && !x.taken);
        if (n) { n.taken = true; used.add(n.i); used.add(i); return n; }
        // Stop at another number that is already spoken for: it belongs to
        // something else and the count is not behind it.
        if (tokens[j].t === 'num') break;
      }
    }
    return null;
  };

  // Round to a micron. An inch is 25.4 mm exactly, but 3 x 25.4 in binary
  // floating point is 76.19999999999999, and a dimension that reads like that
  // makes the whole answer look untrustworthy.
  const mm = (n) => Math.round(n.v * (n.unit ?? 1) * 1000) / 1000;

  /** Shapes where a bare leading number means the diameter, not a radius. */
  const ROUND = new Set(['cylinder', 'sphere', 'tube', 'torus', 'cone', 'prism', 'pyramid']);

  const dia = labelled(['diameter', 'dia', 'across', 'wide']) || null;
  const rad = labelled(['radius', 'rad', 'r']);
  const thick = labelled(['thick', 'thickness', 'deep', 'depth', 'tall', 'high', 'height', 'long', 'length']);
  const count = precedes(['holes', 'hole', 'off', 'times', 'copies', 'instances', 'bolts', 'screws', 'sides'])
    || labelled(['count']);
  const spacing = labelled(['apart', 'spacing', 'pitch', 'spaced', 'every']);
  const wallT = labelled(['wall']);

  /* --- a dimension run: "60 by 40 by 8", "60 x 40 x 8" --- */
  const run = [];
  for (const n of nums) {
    if (n.taken) continue;
    const prev = tokens[n.i - 1], next = tokens[n.i + 1];
    const joined = (t) => t?.t === 'sep' && ['by', 'x', '×', '*'].includes(t.v);
    if (joined(prev) || joined(next) || run.length) {
      run.push(n); n.taken = true; used.add(n.i);
      if (joined(next)) used.add(n.i + 1);
      if (joined(prev)) used.add(n.i - 1);
    }
    if (run.length && !joined(next)) break;
  }

  const free = nums.filter(n => !n.taken);

  /* --- build the plan --- */
  const plan = { kind: isCut ? 'cut' : 'add', type, params: {}, count: 1, spacing: null, material: null, notes: [] };

  // Material, if named.
  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];
    if (tk.t !== 'word' || used.has(i)) continue;
    const key = Object.keys(MATERIALS).find(k => k === tk.v || MATERIALS[k].name.toLowerCase() === tk.v);
    if (key) { plan.material = key; take(i); understood.push(`material ${MATERIALS[key].name}`); }
  }

  function setDia(d) {
    if (type === 'cylinder' || type === 'sphere') plan.params.r = d / 2;
    else if (type === 'tube') plan.params.ro = d / 2;
    else if (type === 'torus') plan.params.R = d / 2;
    else if (type === 'cone') plan.params.r1 = d / 2;
    else if (type === 'prism' || type === 'pyramid') plan.params.r = d / 2;
  }

  if (thread) { setDia(thread.dia); plan.thread = thread; }
  if (dia) { setDia(mm(dia)); understood.push(`diameter ${mm(dia)} mm`); }
  if (rad) {
    const r = mm(rad);
    if (type === 'tube') plan.params.ro = r; else if (type === 'torus') plan.params.R = r;
    else plan.params.r = r;
    understood.push(`radius ${r} mm`);
  }

  if (run.length >= 2) {
    const v = run.map(mm);
    if (type === 'box' || type === 'plate' || type === 'wedge') {
      plan.params.w = v[0]; plan.params.d = v[1];
      if (v[2] != null) plan.params.h = v[2];
      understood.push(`${v[0]} by ${v[1]}${v[2] != null ? ` by ${v[2]}` : ''} mm`);
    } else {
      // For a round shape a two-number run reads as diameter then length.
      setDia(v[0]); plan.params.h = v[1];
      understood.push(`${v[0]} mm across, ${v[1]} mm long`);
    }
  }

  if (thick) {
    const t = mm(thick);
    if (type === 'tube' && plan.params.ro != null && !wallT) plan.params.h = t;
    else if (CATALOG[type].params.h != null) plan.params.h = t;
    understood.push(`${t} mm ${type === 'plate' || type === 'box' ? 'thick' : 'long'}`);
  }
  if (wallT && type === 'tube') {
    const w = mm(wallT);
    const ro = plan.params.ro ?? CATALOG.tube.params.ro;
    plan.params.ri = Math.max(0.1, ro - w);
    understood.push(`${w} mm wall`);
  }

  if (count) {
    plan.count = Math.max(1, Math.round(count.v));
    if (type === 'prism' || type === 'pyramid') { plan.params.sides = plan.count; plan.count = 1; understood.push(`${count.v} sides`); }
    else understood.push(`${plan.count} of them`);
  }
  if (spacing) { plan.spacing = mm(spacing); understood.push(`${plan.spacing} mm apart`); }

  // "a 20 rod", "2 inch cylinder": a bare number right before a round shape
  // word is how people give a diameter, and reading it as a radius would make
  // the part twice the size asked for.
  if (ROUND.has(type) && typeAt > 0 && plan.params.r === undefined && plan.params.ro === undefined && plan.params.R === undefined) {
    const lead = free.find(n => n.i === typeAt - 1);
    if (lead) {
      setDia(mm(lead));
      lead.taken = true; used.add(lead.i);
      understood.push(`${mm(lead)} mm across`);
    }
  }

  // Anything still left fills the shape's own fields in catalogue order, so
  // "cylinder 20 45" works without keywords at all.
  const spare = free.filter(n => !n.taken);
  if (spare.length) {
    const fields = (CATALOG[type].fields || []).filter(f => f.kind === 'len').map(f => f.key);
    for (const n of spare) {
      const key = fields.find(k => plan.params[k] === undefined);
      if (!key) break;
      plan.params[key] = mm(n);
      n.taken = true; used.add(n.i);
      understood.push(`${key} ${mm(n)} mm`);
    }
  }

  /* --- direction, for a pattern --- */
  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];
    if (tk.t !== 'word' || used.has(i)) continue;
    if (AXES[tk.v] && plan.count > 1) { plan.axis = AXES[tk.v]; take(i); understood.push(`along ${plan.axis.toUpperCase()}`); }
  }
  // "in a circle", "around": a circular pattern rather than a row.
  if (tokens.some((t, i) => t.t === 'word' && ['circle', 'circular', 'around', 'radially', 'ring'].includes(t.v) && !used.has(i) && take(i))) {
    plan.pattern = 'circular';
    understood.push('arranged in a circle');
  } else if (plan.count > 1) {
    plan.pattern = 'linear';
  }

  /* --- what was ignored --- */
  const FILLER = new Set(['a', 'an', 'the', 'with', 'and', 'of', 'to', 'make', 'create', 'add', 'new',
    'please', 'me', 'i', 'want', 'need', 'that', 'is', 'it', 'in', 'on', 'at', 'by', 'for', 'mm',
    'this', 'body', 'part', 'piece', 'each', 'centre', 'center', 'centred', 'centered']);
  const unknown = tokens
    .map((tk, i) => ({ tk, i }))
    .filter(({ tk, i }) => !used.has(i) && tk.t === 'word' && !FILLER.has(tk.v))
    .map(({ tk }) => tk.v);

  if (isCut) understood.unshift(`cut ${plan.count > 1 ? `${plan.count} holes` : 'a hole'}`);
  else understood.unshift(`add a ${CATALOG[type].label.toLowerCase()}`);

  return { ok: true, plan, understood, unknown, why: '' };
}

/* ---------------------------------------------------------------- compile */

/**
 * Turn a plan into features.
 *
 * Two rules make the output editable rather than disposable. A repeat becomes
 * a pattern feature, not n copies, because a pattern is the thing you can
 * change your mind about. And a dimension that came from a named standard is
 * written as a parameter reference, so the number has a name and one edit
 * moves every hole that uses it.
 *
 * @returns {{features: object[], params: object[], notes: string[]}}
 */
export function compile(plan, { doc = null, target = null } = {}) {
  const features = [];
  const params = [];
  const notes = [];
  const existing = new Set((doc?.params || []).map(p => p.name));

  /** Declare a named parameter once, and return the name to reference it by. */
  const named = (name, value, note) => {
    if (!existing.has(name) && !params.some(p => p.name === name)) {
      params.push({ name, value, note });
      existing.add(name);
    }
    return name;
  };

  const cat = CATALOG[plan.type];
  const body = makeFeature(plan.type, {
    name: plan.kind === 'cut' ? 'Hole' : cat.label,
    material: plan.material || undefined,
  });
  body.params = { ...body.params, ...plan.params };

  if (plan.thread) {
    // The hole diameter gets a name, so "M6 clearance" survives as intent
    // rather than decaying into the number 6.6.
    const pname = named(
      `${plan.thread.tapped ? 'tap' : 'clear'}_m${String(plan.thread.size).replace('.', '_')}`,
      plan.thread.dia,
      `M${plan.thread.size} ${plan.thread.tapped ? 'tapping drill' : 'clearance'}, ISO 273 medium`,
    );
    body.params.r = `${pname} / 2`;
    body.name = `M${plan.thread.size} ${plan.thread.tapped ? 'tapped hole' : 'clearance hole'}`;
    notes.push(`Hole diameter is the parameter ${pname}, so changing the bolt size moves every hole that uses it.`);
  }

  // A cut needs to go through something, so make it longer than it is wide
  // unless a depth was given.
  if (plan.kind === 'cut' && body.params.h === CATALOG[plan.type].params.h) {
    body.params.h = 60;
    notes.push('No depth given, so the hole is 60 mm deep. Set it, or make it longer than the part to cut right through.');
  }

  features.push(body);

  let head = body;
  if (plan.count > 1) {
    if (plan.pattern === 'circular') {
      const pat = makeFeature('patternCircular', { name: `${plan.count} around` });
      pat.params = { ...pat.params, count: plan.count, axis: 'z', angle: 360, rotate: true };
      pat.inputs = [body.id];
      features.push(pat);
      head = pat;
    } else {
      const axis = plan.axis || 'x';
      const step = plan.spacing ?? 40;
      const pat = makeFeature('patternLinear', { name: `${plan.count} along ${axis.toUpperCase()}` });
      pat.params = {
        ...pat.params, count: plan.count, count2: 1,
        dx: axis === 'x' ? step : 0, dy: axis === 'y' ? step : 0, dz: axis === 'z' ? step : 0,
        dx2: 0, dy2: 0, dz2: 0,
      };
      pat.inputs = [body.id];
      features.push(pat);
      head = pat;
      if (!plan.spacing) notes.push(`No spacing given, so they are ${step} mm apart.`);
    }
  }

  if (plan.kind === 'cut') {
    if (!target) {
      notes.push('Nothing was selected to cut, so the hole arrives as a body. Select it and the part, then Subtract.');
    } else {
      const cut = makeFeature('boolean', { name: 'Cut' });
      cut.params = { op: 'subtract' };
      cut.inputs = [target, head.id];
      features.push(cut);
    }
  }

  return { features, params, notes };
}

/**
 * Read and compile in one call, which is what the dialog uses.
 * Nothing is applied: the caller shows the readback first.
 */
export function interpret(text, { doc = null, target = null } = {}) {
  const read = parse(text, { context: { doc } });
  if (!read.ok) return { ...read, features: [], params: [], notes: [] };
  const built = compile(read.plan, { doc, target });
  return { ...read, ...built };
}

/** Worked examples, which double as the dialog's help and the suite's input. */
export const EXAMPLES = [
  'a 120 by 80 plate 8 thick in aluminium',
  '4 M6 clearance holes 40 apart',
  'cylinder 30 diameter 60 long',
  'a tube 40 across with a 3 wall, 50 long',
  '6 M8 tapped holes in a circle',
  'a steel bar 200 x 20 x 10',
  'sphere radius 18',
  'hex prism 25 across 40 tall',
  '2 inch cylinder 3 inches long',
];
