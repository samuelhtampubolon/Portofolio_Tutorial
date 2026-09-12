/**
 * Fasteners that carry engineering data, not just geometry.
 *
 * "Hole Wizard is extremely useful", and "no great built-in way to create
 * clean BOMs from assemblies without putting in a lot of work". Both are true
 * at once because a component in CAD is a shape and nothing else. Drop in an
 * M8 bolt and the model knows its diameter; it does not know its proof load,
 * what to torque it to, what drill to use for the tapped hole, or what to call
 * it on a purchase order. Every one of those is a published number, and every
 * one of them gets looked up by hand.
 *
 * So they live here, next to the geometry, and travel with it into the bill of
 * materials and the drawing callouts.
 *
 * Everything below is from the standards, not estimated:
 *   thread pitch and tensile stress area  ISO 724 / ISO 898-1
 *   clearance holes                       ISO 273, close / medium / free
 *   tapping drills                        standard coarse thread
 *   head and nut sizes                    ISO 4762 (socket cap), ISO 4032 (nut)
 *   proof load and tightening torque      ISO 898-1 for the property class
 *
 * The one figure that is a model rather than a table is the tightening torque,
 * and it says so: T = K * F * d with K = 0.2 for a plain dry thread. Published
 * torque tables are that same formula, and the friction coefficient is the
 * part nobody can promise, so the function returns the assumption alongside
 * the number instead of hiding it.
 */

/**
 * Metric coarse threads.
 *   pitch    mm, ISO 724
 *   area     tensile stress area, mm^2, ISO 898-1
 *   clear    clearance hole diameter, mm: [close, medium, free] from ISO 273
 *   tap      tapping drill for a coarse thread, mm
 *   head     socket cap head diameter / height, mm, ISO 4762
 *   hex      across-flats of the nut, mm, ISO 4032
 *   nutH     nut height, mm, ISO 4032
 */
export const METRIC = {
  'M1.6': { d: 1.6, pitch: 0.35, area: 1.27, clear: [1.7, 1.8, 2.0], tap: 1.25, head: [3.0, 1.6], hex: 3.2, nutH: 1.3 },
  M2:     { d: 2,   pitch: 0.4,  area: 2.07, clear: [2.2, 2.4, 2.6], tap: 1.6,  head: [3.8, 2.0], hex: 4,   nutH: 1.6 },
  'M2.5': { d: 2.5, pitch: 0.45, area: 3.39, clear: [2.7, 2.9, 3.1], tap: 2.05, head: [4.5, 2.5], hex: 5,   nutH: 2.0 },
  M3:     { d: 3,   pitch: 0.5,  area: 5.03, clear: [3.2, 3.4, 3.6], tap: 2.5,  head: [5.5, 3.0], hex: 5.5, nutH: 2.4 },
  M4:     { d: 4,   pitch: 0.7,  area: 8.78, clear: [4.3, 4.5, 4.8], tap: 3.3,  head: [7.0, 4.0], hex: 7,   nutH: 3.2 },
  M5:     { d: 5,   pitch: 0.8,  area: 14.2, clear: [5.3, 5.5, 5.8], tap: 4.2,  head: [8.5, 5.0], hex: 8,   nutH: 4.7 },
  M6:     { d: 6,   pitch: 1.0,  area: 20.1, clear: [6.4, 6.6, 7.0], tap: 5,    head: [10, 6.0],  hex: 10,  nutH: 5.2 },
  M8:     { d: 8,   pitch: 1.25, area: 36.6, clear: [8.4, 9.0, 10],  tap: 6.8,  head: [13, 8.0],  hex: 13,  nutH: 6.8 },
  M10:    { d: 10,  pitch: 1.5,  area: 58.0, clear: [10.5, 11, 12],  tap: 8.5,  head: [16, 10],   hex: 16,  nutH: 8.4 },
  M12:    { d: 12,  pitch: 1.75, area: 84.3, clear: [13, 13.5, 14.5], tap: 10.2, head: [18, 12],  hex: 18,  nutH: 10.8 },
  M14:    { d: 14,  pitch: 2.0,  area: 115,  clear: [15, 15.5, 16.5], tap: 12,   head: [21, 14],  hex: 21,  nutH: 12.8 },
  M16:    { d: 16,  pitch: 2.0,  area: 157,  clear: [17, 17.5, 18.5], tap: 14,   head: [24, 16],  hex: 24,  nutH: 14.8 },
  M20:    { d: 20,  pitch: 2.5,  area: 245,  clear: [21, 22, 24],    tap: 17.5, head: [30, 20],  hex: 30,  nutH: 18 },
  M24:    { d: 24,  pitch: 3.0,  area: 353,  clear: [25, 26, 28],    tap: 21,   head: [36, 24],  hex: 36,  nutH: 21.5 },
  M30:    { d: 30,  pitch: 3.5,  area: 561,  clear: [31, 33, 35],    tap: 26.5, head: [45, 30],  hex: 46,  nutH: 25.6 },
  M36:    { d: 36,  pitch: 4.0,  area: 817,  clear: [37, 39, 42],    tap: 32,   head: [54, 36],  hex: 55,  nutH: 31 },
};

export const SIZES = Object.keys(METRIC);

/**
 * Property classes, ISO 898-1.
 *   proof   proof stress, N/mm^2: the stress a bolt takes with no permanent set
 *   tensile minimum tensile strength, N/mm^2
 *   note    what it is for, since the number alone does not say
 */
export const CLASSES = {
  '4.6': { proof: 225, tensile: 400, note: 'Mild steel. General fixing where nothing is calculated.' },
  '8.8': { proof: 580, tensile: 800, note: 'The default structural bolt. Most machine assemblies.' },
  '10.9': { proof: 830, tensile: 1040, note: 'High tensile. Needs controlled torque and a hardened washer.' },
  '12.9': { proof: 970, tensile: 1220, note: 'Highest common class. Brittle if abused; not for shock loads.' },
  A2: { proof: 210, tensile: 500, note: 'A2 stainless. Corrosion resistance, not strength. Galls if run dry.' },
  A4: { proof: 240, tensile: 600, note: 'A4 stainless. Marine. Same galling caution as A2.' },
};

export const FITS = { close: 0, medium: 1, free: 2 };

/** Hole diameter for a bolt, by clearance class or tapped. */
export function holeFor(size, kind = 'medium') {
  const m = METRIC[size];
  if (!m) return null;
  if (kind === 'tapped') return m.tap;
  const i = FITS[kind];
  return i === undefined ? m.clear[1] : m.clear[i];
}

/**
 * Everything a bolt knows about itself.
 *
 * `torque` is the one modelled figure rather than a tabulated one, so it comes
 * with its assumptions attached: 90% of proof load, and a nut factor of 0.2
 * for a plain dry thread. Lubricate it and the same torque gives more preload,
 * which is why the assumption is returned and not buried.
 */
export function spec(size, { cls = '8.8', length = null, fit = 'medium', lubricated = false } = {}) {
  const m = METRIC[size];
  const c = CLASSES[cls];
  if (!m || !c) return null;

  const K = lubricated ? 0.15 : 0.2;
  const proofLoad = c.proof * m.area;              // N
  const preload = 0.9 * proofLoad;                 // N, the usual target
  const torque = (K * preload * m.d) / 1000;       // N·m

  return {
    size, cls, length,
    designation: `${size}${length ? `×${length}` : ''} ${cls}`,
    standard: 'ISO 4762 socket head cap screw',
    diameter: m.d,
    pitch: m.pitch,
    tensileArea: m.area,
    proofStress: c.proof,
    tensileStrength: c.tensile,
    proofLoadN: Math.round(proofLoad),
    preloadN: Math.round(preload),
    torqueNm: Math.round(torque * 10) / 10,
    torqueBasis: `T = K·F·d with K = ${K} (${lubricated ? 'lubricated' : 'plain dry thread'}), F = 90% of proof load. Published torque tables are this same formula; the friction coefficient is the part nobody can promise.`,
    clearanceHole: m.clear[FITS[fit] ?? 1],
    clearanceFit: fit,
    tappingDrill: m.tap,
    minThreadEngagement: Math.round(m.d * 10) / 10,
    engagementNote: 'One diameter of engagement in steel, two in aluminium, three in plastic. Less and the thread strips before the bolt yields, which is the wrong failure.',
    headDiameter: m.head[0],
    headHeight: m.head[1],
    nutAcrossFlats: m.hex,
    nutHeight: m.nutH,
    classNote: c.note,
    // A neutral figure the user relabels, consistent with the cost model.
    unitCost: Math.round((0.02 + m.area * 0.0016) * (cls === '12.9' ? 2.4 : cls === '10.9' ? 1.7 : /^A/.test(cls) ? 3.1 : 1) * 100) / 100,
  };
}

/**
 * Will this joint hold?
 *
 * A first-order answer to the question a bolt table cannot answer on its own,
 * and it says what it is not: no bending in the bolt, no eccentric load, no
 * fatigue, no gasket relaxation, and the friction coefficient assumed.
 */
export function checkJoint(size, { cls = '8.8', load = 1000, count = 1, shear = false, safety = 2, lubricated = false } = {}) {
  const s = spec(size, { cls, lubricated });
  if (!s) return null;
  const per = load / Math.max(1, count);
  // Shear strength of a bolt is about 0.6 of tensile; ISO 898-1 gives 0.6 Rm.
  const capacity = shear ? 0.6 * s.tensileStrength * s.tensileArea : s.proofLoadN;
  const allowable = capacity / Math.max(1, safety);
  const util = per / allowable;
  return {
    ...s, count, load, per: Math.round(per), shear, safety,
    capacityN: Math.round(capacity),
    allowableN: Math.round(allowable),
    utilisation: util,
    pass: util <= 1,
    verdict: util <= 0.5 ? 'Comfortable' : util <= 1 ? 'Adequate' : util <= 1.5 ? 'Over capacity' : 'Far over capacity',
    mode: shear ? 'shear' : 'tension',
    caveat: 'First-order only: the bolt is assumed loaded along its axis with no bending, no eccentricity, no fatigue and no joint relaxation. A bolted joint usually fails at the thread, the clamped material or in fatigue long before the bolt reaches proof load.',
  };
}

/** The smallest size in a class that carries the load at the given factor. */
export function sizeFor({ load = 1000, count = 1, cls = '8.8', shear = false, safety = 2 } = {}) {
  for (const size of SIZES) {
    const r = checkJoint(size, { cls, load, count, shear, safety });
    if (r?.pass) return r;
  }
  return null;
}

/**
 * A fastener as a parametric feature set, so it is a real body you can move
 * rather than a symbol. A socket cap screw is a shank and a head, which two
 * cylinders describe exactly enough for clearance and assembly checks.
 */
export function featuresFor(size, { length = 20, cls = '8.8' } = {}, makeFeature) {
  const s = spec(size, { cls, length });
  if (!s) return null;
  const shank = makeFeature('cylinder', {
    name: `${size}×${length} shank`, material: /^A/.test(cls) ? 'stainless' : 'steel',
    params: { r: s.diameter / 2, h: length, seg: 32, arc: 360 },
  });
  const head = makeFeature('cylinder', {
    name: `${size} head`, material: /^A/.test(cls) ? 'stainless' : 'steel',
    params: { r: s.headDiameter / 2, h: s.headHeight, seg: 32, arc: 360 },
  });
  head.transform.pos = [0, 0, length];
  const body = makeFeature('boolean', { name: `${s.designation}`, params: { op: 'union' } });
  body.inputs = [shank.id, head.id];
  return { features: [shank, head, body], spec: s };
}

/** One BOM row per fastener, with the data a purchase order needs. */
export function bomRow(size, { cls = '8.8', length = 20, qty = 1 } = {}) {
  const s = spec(size, { cls, length });
  if (!s) return null;
  return {
    item: s.designation,
    description: `Socket head cap screw ${size}×${length}, class ${cls}, ISO 4762`,
    qty,
    diameter: s.diameter,
    pitch: s.pitch,
    torqueNm: s.torqueNm,
    clearanceHole: s.clearanceHole,
    tappingDrill: s.tappingDrill,
    unitCost: s.unitCost,
    lineCost: Math.round(s.unitCost * qty * 100) / 100,
    standard: 'ISO 4762',
  };
}

/** CSV of the fastener lines, for the release package. */
export function fastenerCSV(rows) {
  const head = ['Item', 'Description', 'Qty', 'Dia mm', 'Pitch mm', 'Torque Nm', 'Clearance mm', 'Tap drill mm', 'Unit', 'Line', 'Standard'];
  const esc = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return [head, ...rows.map(r => [r.item, r.description, r.qty, r.diameter, r.pitch, r.torqueNm,
    r.clearanceHole, r.tappingDrill, r.unitCost, r.lineCost, r.standard])]
    .map(r => r.map(esc).join(',')).join('\n');
}

/**
 * Match recognised holes to the fastener that fits them.
 *
 * This is what closes the loop with mesh recognition: measure a hole in an
 * imported part, and get back the bolt it was drilled for, with its torque and
 * its tapping drill, rather than just a diameter.
 */
export function identifyHole(diameter, { tol = 0.35 } = {}) {
  const out = [];
  for (const [size, m] of Object.entries(METRIC)) {
    m.clear.forEach((c, i) => {
      if (Math.abs(c - diameter) <= tol) {
        out.push({ size, kind: ['close', 'medium', 'free'][i], nominal: c, error: diameter - c });
      }
    });
    if (Math.abs(m.tap - diameter) <= tol) {
      out.push({ size, kind: 'tapped', nominal: m.tap, error: diameter - m.tap });
    }
  }
  out.sort((a, b) => Math.abs(a.error) - Math.abs(b.error));
  return out;
}
