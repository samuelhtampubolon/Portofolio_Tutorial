/**
 * The design brief: requirements in, an engineered parametric model out.
 *
 * The gap this addresses is the largest of the ten and also the easiest to fake.
 * The honest version of "describe what you want and get a model" needs a
 * language model and a server, and this application has neither by design —
 * nothing here touches the network and nothing is uploaded. So rather than
 * pretend, this does the part that can be done properly and completely offline:
 *
 *   requirements → engineering calculation → named parameters → feature tree
 *
 * over a bounded catalogue of part archetypes. You state the load, the envelope,
 * the fixings and the material; it sizes the part from first principles, writes
 * the sizing *as expressions* so the reasoning stays visible and editable in the
 * model, and reports every assumption it made.
 *
 * What that buys over a template: a template gives you a bracket. This gives you
 * a bracket whose thickness is `sqrt(6 * load * arm / (width * allow))`, so when
 * the load doubles the part follows, and an engineer can read the intent and
 * disagree with it.
 *
 * What it is not: a substitute for analysis. Every calculation here is a
 * textbook closed-form one on an idealised section, with a stated safety factor
 * and no stress concentrations, no fatigue, no buckling and no real boundary
 * conditions. The generated model says so, in the document notes, where it
 * cannot be lost.
 */
import { MATERIALS } from '../core/doc.js';
import { processOf } from './process.js';
import { standards, limits } from './standards.js';

/**
 * Yield strength in MPa (N/mm²), and a note on where the number comes from.
 * Conservative ends of common ranges: sizing should err heavy.
 */
export const STRENGTH = {
  steel:     { yield: 250, label: 'Mild steel, S275 at the low end' },
  stainless: { yield: 210, label: '304 stainless, annealed' },
  aluminium: { yield: 215, label: '6061-T6' },
  brass:     { yield: 130, label: 'CZ121 free-cutting' },
  copper:    { yield: 70,  label: 'C101 annealed' },
  titanium:  { yield: 830, label: 'Ti-6Al-4V' },
  abs:       { yield: 40,  label: 'ABS, injection moulded' },
  pla:       { yield: 50,  label: 'PLA, printed solid along the layer plane' },
  nylon:     { yield: 45,  label: 'Nylon 12' },
  acrylic:   { yield: 65,  label: 'Cast acrylic, brittle: treat with suspicion under shock' },
  wood:      { yield: 35,  label: 'Pine, along the grain' },
  concrete:  { yield: 3,   label: 'Unreinforced, in tension. Do not load it this way.' },
  glass:     { yield: 30,  label: 'Annealed float glass, brittle' },
  rubber:    { yield: 5,   label: 'Not a structural material' },
  custom:    { yield: 100, label: 'Placeholder: set a real figure before trusting anything below' },
};

/** Metric clearance holes, mm. */
export const BOLTS = {
  M3: { clear: 3.4, head: 6.0, washer: 7 },
  M4: { clear: 4.5, head: 8.0, washer: 9 },
  M5: { clear: 5.5, head: 10.0, washer: 10 },
  M6: { clear: 6.6, head: 11.0, washer: 12 },
  M8: { clear: 9.0, head: 15.0, washer: 17 },
  M10: { clear: 11.0, head: 18.0, washer: 21 },
  M12: { clear: 13.5, head: 21.0, washer: 24 },
};

/* ------------------------------------------------------------- archetypes */

/**
 * Each archetype declares the questions it needs answered and how to turn the
 * answers into parameters, features and a rationale. Adding one is a matter of
 * writing a `fields` list and a `build`; nothing else in the application has to
 * know about it.
 */
export const ARCHETYPES = {
  bracket: {
    label: 'L-bracket',
    icon: 'wedge',
    blurb: 'A right-angle bracket sized so the vertical arm survives the load in bending.',
    fields: [
      { key: 'load', label: 'Load at the tip', unit: 'N', kind: 'num', def: 300, min: 1 },
      { key: 'arm', label: 'Arm length', unit: 'mm', kind: 'len', def: 80, min: 5 },
      { key: 'width', label: 'Bracket width', unit: 'mm', kind: 'len', def: 40, min: 5 },
      { key: 'sf', label: 'Safety factor', kind: 'num', def: 2.5, min: 1, max: 10 },
      { key: 'bolt', label: 'Fixing', kind: 'select', def: 'M6', options: Object.keys(BOLTS) },
    ],
    build: (v, ctx) => {
      const allow = ctx.yield / v.sf;
      // Cantilever, rectangular section: t = sqrt(6 F L / (b σ))
      const t = Math.sqrt((6 * v.load * v.arm) / (v.width * allow));
      const thick = ctx.round(Math.max(t, ctx.lim.minWall));
      const bolt = BOLTS[v.bolt];
      const base = ctx.round(Math.max(v.arm * 0.6, bolt.washer * 2.5));
      return {
        params: [
          ['load', v.load, 'Design load at the tip of the arm, newtons'],
          ['arm', v.arm, 'Distance from the wall to the load'],
          ['width', v.width, 'Bracket width'],
          ['sf', v.sf, 'Safety factor against yield'],
          ['allow', `${ctx.yield} / sf`, `Allowable stress, N/mm². Yield for ${ctx.matLabel} is ${ctx.yield} MPa.`],
          ['thick', `max(sqrt(6 * load * arm / (width * allow)), ${ctx.lim.minWall})`,
            'Wall thickness from cantilever bending, floored at the process minimum'],
          ['base', base, 'Length of the fixed leg'],
          ['hole', bolt.clear, `${v.bolt} clearance hole`],
        ],
        features: [
          { type: 'box', name: 'Vertical arm', params: { w: 'thick', d: 'width', h: 'arm' }, pos: ['thick/2', 0, 'arm/2'] },
          { type: 'box', name: 'Base leg', params: { w: 'base', d: 'width', h: 'thick' }, pos: ['base/2', 0, 'thick/2'] },
          { type: 'boolean', name: 'Bracket', params: { op: 'union' }, inputs: [0, 1] },
          { type: 'cylinder', name: 'Fixing hole', params: { r: 'hole/2', h: 'thick*3' }, pos: ['base*0.7', 0, 'thick/2'] },
          { type: 'patternLinear', name: 'Fixing holes', params: { dx: 0, dy: `width*0.5`, dz: 0, count: 2 }, inputs: [3], pos: [0, `-width*0.25`, 0] },
          { type: 'boolean', name: 'L-bracket', params: { op: 'subtract' }, inputs: [2, 4] },
        ],
        rationale: [
          `Treated as a cantilever with the load at ${v.arm}mm: bending moment ${(v.load * v.arm / 1000).toFixed(1)} N·m.`,
          `Allowable stress ${allow.toFixed(0)} N/mm², from ${ctx.yield} MPa yield divided by a safety factor of ${v.sf}.`,
          `Required thickness ${t.toFixed(2)}mm; used ${thick}mm after the ${ctx.lim.minWall}mm process floor.`,
          `The bend root is a sharp internal corner, which is where it will actually fail. Add a fillet or a gusset before loading it near the limit.`,
        ],
      };
    },
  },

  plate: {
    label: 'Bolted plate',
    icon: 'plate',
    blurb: 'A mounting plate with a bolt pattern on a pitch circle or a rectangle.',
    fields: [
      { key: 'w', label: 'Width', unit: 'mm', kind: 'len', def: 120, min: 10 },
      { key: 'd', label: 'Depth', unit: 'mm', kind: 'len', def: 80, min: 10 },
      { key: 'load', label: 'Load, centre', unit: 'N', kind: 'num', def: 500, min: 0 },
      { key: 'sf', label: 'Safety factor', kind: 'num', def: 2.5, min: 1, max: 10 },
      { key: 'bolt', label: 'Fixing', kind: 'select', def: 'M6', options: Object.keys(BOLTS) },
      { key: 'count', label: 'Bolt count', kind: 'int', def: 4, min: 2, max: 24 },
    ],
    build: (v, ctx) => {
      const allow = ctx.yield / v.sf;
      const span = Math.min(v.w, v.d);
      // Simply-supported plate strip, load at mid-span: t = sqrt(1.5 F L / (b σ))
      const t = Math.sqrt((1.5 * Math.max(v.load, 1) * span) / (Math.max(v.w, v.d) * allow));
      const thick = ctx.round(Math.max(t, ctx.lim.minWall, 3));
      const bolt = BOLTS[v.bolt];
      const inset = ctx.round(bolt.washer * 0.9);
      return {
        params: [
          ['plate_w', v.w, 'Plate width'],
          ['plate_d', v.d, 'Plate depth'],
          ['load', v.load, 'Central load, newtons'],
          ['sf', v.sf, 'Safety factor against yield'],
          ['allow', `${ctx.yield} / sf`, `Allowable stress, N/mm², for ${ctx.matLabel}`],
          ['thick', `max(sqrt(1.5 * load * min(plate_w, plate_d) / (max(plate_w, plate_d) * allow)), ${Math.max(ctx.lim.minWall, 3)})`,
            'Thickness from a simply-supported strip, floored'],
          ['bolt_r', bolt.clear / 2, `${v.bolt} clearance radius`],
          ['inset', inset, 'Bolt centre inset from the edge, sized for a washer'],
        ],
        features: [
          { type: 'plate', name: 'Plate', params: { w: 'plate_w', d: 'plate_d', h: 'thick', fillet: 'inset', hole: 0 } },
          { type: 'cylinder', name: 'Bolt hole', params: { r: 'bolt_r', h: 'thick*3' }, pos: [`plate_w/2 - inset`, `plate_d/2 - inset`, 0] },
          { type: 'patternCircular', name: 'Bolt pattern', params: { axis: 'z', count: v.count, angle: 360, rotate: false }, inputs: [1] },
          { type: 'boolean', name: 'Bolted plate', params: { op: 'subtract' }, inputs: [0, 2] },
        ],
        rationale: [
          `Sized as a simply-supported strip across the ${span}mm span with the load at mid-span.`,
          `Allowable stress ${allow.toFixed(0)} N/mm² from ${ctx.yield} MPa yield and a safety factor of ${v.sf}.`,
          `Required thickness ${t.toFixed(2)}mm; used ${thick}mm after flooring at ${Math.max(ctx.lim.minWall, 3)}mm.`,
          `Bolts are on a circular pattern about the centre. For a rectangular pattern, change the pattern feature's type in the tree.`,
        ],
      };
    },
  },

  shaft: {
    label: 'Shaft',
    icon: 'cylinder',
    blurb: 'A round shaft sized for torque, with an optional through-bore.',
    fields: [
      { key: 'torque', label: 'Torque', unit: 'N·m', kind: 'num', def: 40, min: 0.1 },
      { key: 'len', label: 'Length', unit: 'mm', kind: 'len', def: 150, min: 5 },
      { key: 'sf', label: 'Safety factor', kind: 'num', def: 3, min: 1, max: 10 },
      { key: 'hollow', label: 'Through-bore', kind: 'bool', def: false },
    ],
    build: (v, ctx) => {
      // Shear yield taken as 0.577 of tensile (von Mises).
      const allow = (ctx.yield * 0.577) / v.sf;
      const T = v.torque * 1000;                        // N·mm
      const d = Math.cbrt((16 * T) / (Math.PI * allow));
      const dia = ctx.round(Math.max(d, ctx.lim.minFeature * 3, 4));
      return {
        params: [
          ['torque', v.torque, 'Transmitted torque, N·m'],
          ['shaft_len', v.len, 'Shaft length'],
          ['sf', v.sf, 'Safety factor against shear yield'],
          ['allow', `${(ctx.yield * 0.577).toFixed(0)} / sf`,
            `Allowable shear, N/mm². Shear yield taken as 0.577 × ${ctx.yield} MPa tensile, von Mises.`],
          ['shaft_d', `max(cbrt(16 * torque * 1000 / (pi * allow)), 4)`,
            'Diameter from torsion of a solid round section'],
          ...(v.hollow ? [['bore', `shaft_d * 0.5`, 'Through-bore, half the outside diameter']] : []),
        ],
        features: v.hollow
          ? [{ type: 'tube', name: 'Shaft', params: { ro: 'shaft_d/2', ri: 'bore/2', h: 'shaft_len' } }]
          : [{ type: 'cylinder', name: 'Shaft', params: { r: 'shaft_d/2', h: 'shaft_len' } }],
        rationale: [
          `Solid round section in pure torsion: d = cbrt(16T / πτ).`,
          `Allowable shear ${allow.toFixed(0)} N/mm², from ${ctx.yield} MPa tensile yield, a von Mises factor of 0.577, and a safety factor of ${v.sf}.`,
          `Required diameter ${d.toFixed(2)}mm; used ${dia}mm.`,
          v.hollow
            ? `A bore at half the outside diameter removes a quarter of the mass and only about 6% of the torsional stiffness, because material near the axis does almost no work.`
            : `Torsion is resisted almost entirely by the outer material, so a through-bore would cost very little strength if you need to save mass.`,
          `No keyway, no shoulder and no fatigue allowance. A rotating shaft under reversing load needs a fatigue check this does not do.`,
        ],
      };
    },
  },

  pressureTube: {
    label: 'Pressure tube',
    icon: 'tube',
    blurb: 'A cylinder whose wall is sized for internal pressure by hoop stress.',
    fields: [
      { key: 'bore', label: 'Internal diameter', unit: 'mm', kind: 'len', def: 60, min: 2 },
      { key: 'pressure', label: 'Internal pressure', unit: 'bar', kind: 'num', def: 10, min: 0.1 },
      { key: 'len', label: 'Length', unit: 'mm', kind: 'len', def: 200, min: 5 },
      { key: 'sf', label: 'Safety factor', kind: 'num', def: 4, min: 1, max: 12 },
    ],
    build: (v, ctx) => {
      const allow = ctx.yield / v.sf;
      const p = v.pressure * 0.1;                 // bar → N/mm²
      const t = (p * v.bore) / (2 * allow);       // thin-wall hoop stress
      const wall = ctx.round(Math.max(t, ctx.lim.minWall));
      return {
        params: [
          ['bore', v.bore, 'Internal diameter'],
          ['pressure', v.pressure, 'Internal pressure, bar'],
          ['tube_len', v.len, 'Length'],
          ['sf', v.sf, 'Safety factor against yield'],
          ['allow', `${ctx.yield} / sf`, `Allowable stress, N/mm², for ${ctx.matLabel}`],
          ['wall', `max(pressure * 0.1 * bore / (2 * allow), ${ctx.lim.minWall})`,
            'Wall thickness from thin-wall hoop stress, floored at the process minimum'],
        ],
        features: [
          { type: 'tube', name: 'Pressure tube', params: { ro: 'bore/2 + wall', ri: 'bore/2', h: 'tube_len' } },
        ],
        rationale: [
          `Thin-wall hoop stress: t = pD / 2σ, with ${v.pressure} bar as ${p.toFixed(2)} N/mm².`,
          `Allowable stress ${allow.toFixed(0)} N/mm² from ${ctx.yield} MPa yield and a safety factor of ${v.sf}.`,
          `Required wall ${t.toFixed(3)}mm; used ${wall}mm after the ${ctx.lim.minWall}mm process floor.`,
          t / v.bore > 0.05
            ? `At ${(t / v.bore * 100).toFixed(0)}% of the bore this is no longer thin-walled, so the formula understates the peak stress. Use a thick-wall (Lamé) calculation before building it.`
            : `Wall-to-bore ratio is under 5%, so the thin-wall assumption holds.`,
          `Ends, joints and fittings are not covered. A pressure vessel is a regulated item in most jurisdictions.`,
        ],
      };
    },
  },

  enclosure: {
    label: 'Enclosure',
    icon: 'box',
    blurb: 'A box sized around what goes inside it, with walls at the process minimum.',
    fields: [
      { key: 'iw', label: 'Internal width', unit: 'mm', kind: 'len', def: 100, min: 5 },
      { key: 'id', label: 'Internal depth', unit: 'mm', kind: 'len', def: 70, min: 5 },
      { key: 'ih', label: 'Internal height', unit: 'mm', kind: 'len', def: 40, min: 5 },
      { key: 'clear', label: 'Clearance around contents', unit: 'mm', kind: 'len', def: 1.5, min: 0 },
    ],
    build: (v, ctx) => {
      const wall = ctx.round(Math.max(ctx.lim.minWall * 1.5, 1.6));
      return {
        params: [
          ['inner_w', v.iw, 'Internal width, before clearance'],
          ['inner_d', v.id, 'Internal depth, before clearance'],
          ['inner_h', v.ih, 'Internal height, before clearance'],
          ['clear', v.clear, 'Clearance around the contents on every side'],
          ['wall', wall, `Wall thickness: 1.5 × the ${ctx.process.label} minimum of ${ctx.lim.minWall}mm`],
          ['cav_w', 'inner_w + clear*2', 'Cavity width'],
          ['cav_d', 'inner_d + clear*2', 'Cavity depth'],
          ['cav_h', 'inner_h + clear*2', 'Cavity height'],
        ],
        features: [
          { type: 'box', name: 'Shell', params: { w: 'cav_w + wall*2', d: 'cav_d + wall*2', h: 'cav_h + wall' }, pos: [0, 0, '(cav_h + wall)/2'] },
          { type: 'box', name: 'Cavity', params: { w: 'cav_w', d: 'cav_d', h: 'cav_h' }, pos: [0, 0, 'wall + cav_h/2'] },
          { type: 'boolean', name: 'Enclosure', params: { op: 'subtract' }, inputs: [0, 1] },
        ],
        rationale: [
          `Walls at ${wall}mm: one and a half times the ${ctx.lim.minWall}mm minimum for ${ctx.process.label}, which is where a wall stops being fragile.`,
          `Outside dimensions follow the contents through expressions, so changing what goes inside resizes the box.`,
          `Open-topped: it is a tray until you add a lid. Model the lid as a second body so both can be made in the same run.`,
          ctx.process.kind === 'formative'
            ? `This process needs draft on every vertical face, and there is none here yet. Add it before cutting a tool.`
            : `No draft applied, which is correct for ${ctx.process.label}.`,
        ],
      };
    },
  },
};

export const ARCHETYPE_IDS = Object.keys(ARCHETYPES);

/* -------------------------------------------------------------- synthesis */

/**
 * Turn a brief into parameters, features and the reasoning behind them.
 *
 * @param {string} id       archetype key
 * @param {object} values   answers to that archetype's fields
 * @param {object} opts     { material, process }
 * @returns {{ params, features, rationale, warnings, label }}
 */
export function synthesise(id, values = {}, opts = {}) {
  const arch = ARCHETYPES[id];
  if (!arch) throw new Error(`Unknown archetype “${id}”`);

  const s = standards();
  const material = opts.material || s.material || 'aluminium';
  const process = processOf(opts.process || s.process);
  const strength = STRENGTH[material] || STRENGTH.custom;

  const v = {};
  for (const f of arch.fields) {
    const raw = values[f.key];
    if (f.kind === 'bool') { v[f.key] = !!raw; continue; }
    if (f.kind === 'select') { v[f.key] = f.options.includes(raw) ? raw : f.def; continue; }
    const n = Number(raw);
    v[f.key] = Number.isFinite(n) ? clamp(n, f.min, f.max) : f.def;
  }

  const ctx = {
    material,
    matLabel: MATERIALS[material]?.name || material,
    yield: strength.yield,
    process,
    lim: limits(process),
    round: (x) => Math.round(x * 100) / 100,
  };

  const out = arch.build(v, ctx);
  const warnings = [];

  if (material === 'concrete' || material === 'rubber' || material === 'glass') {
    warnings.push(`${ctx.matLabel} is not a structural material in the way this calculation assumes. The numbers below are arithmetic, not engineering.`);
  }
  if (material === 'pla' || material === 'abs' || material === 'nylon') {
    warnings.push('Printed plastics are markedly weaker across layers than along them, and creep under sustained load. Orientation on the build plate matters as much as the thickness here.');
  }
  if (v.sf != null && v.sf < 1.5) {
    warnings.push(`A safety factor of ${v.sf} leaves nothing for material variation, stress concentration or the load being larger than you think.`);
  }

  return {
    id,
    label: arch.label,
    material,
    process: process.label,
    params: out.params.map(([name, value, note]) => ({ name, value, note })),
    features: out.features,
    rationale: out.rationale,
    warnings,
    strengthNote: `${strength.label}, ${strength.yield} MPa yield.`,
  };
}

/**
 * The disclaimer written into every generated document.
 * It lives in the document rather than only in a dialog because a dialog is
 * dismissed once and the file outlives it.
 */
export function briefNotes(result, values) {
  const answers = Object.entries(values).map(([k, x]) => `${k}=${x}`).join(', ');
  return [
    `Generated from a design brief: ${result.label}.`,
    `Requirements: ${answers}`,
    `Material: ${result.material} (${result.strengthNote})`,
    `Process assumed: ${result.process}`,
    '',
    'Sizing:',
    ...result.rationale.map(r => `  - ${r}`),
    ...(result.warnings.length ? ['', 'Warnings:', ...result.warnings.map(w => `  - ${w}`)] : []),
    '',
    'These are closed-form textbook calculations on idealised sections. They do not account for',
    'stress concentrations, fatigue, buckling, impact, temperature, or real boundary conditions,',
    'and they are not a substitute for analysis or for a qualified engineer signing the design off.',
  ].join('\n');
}

function clamp(v, lo, hi) {
  if (lo != null && v < lo) return lo;
  if (hi != null && v > hi) return hi;
  return v;
}
