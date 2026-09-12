/**
 * Tolerance stack-up, process capability and ISO 286 fits.
 *
 * A dimension is not a number, it is a range, and the question that decides
 * whether a design works in production is what happens when every range in a
 * chain lands badly at once. CAD packages model the nominal and leave that
 * question to a spreadsheet somebody else maintains. This module answers it
 * next to the model: worst case for the contract, root-sum-square for the
 * realistic spread, Monte Carlo for the shape of the tail, and Cp/Cpk so the
 * answer is in the language a production engineer already argues in.
 *
 * Lengths are millimetres throughout. The ISO 286 tables below are in
 * micrometres because that is how they are published; `itGrade` and
 * `fundamental` convert on the way out so nothing else in the app has to
 * think about it.
 *
 * Every number in the standard tables is a published figure, not a fit or an
 * approximation. Where a letter's fundamental deviation changes inside one IT
 * diameter step (c and s do, above 50mm) the finer sub-steps are kept, so a
 * looked-up limit matches the printed table rather than nearly matching it.
 */

/* ------------------------------------------------------------ ISO 286 IT */

/** Upper bound (mm, exclusive) of each standard diameter step. */
export const IT_STEPS = [3, 6, 10, 18, 30, 50, 80, 120, 180, 250, 315, 400, 500];

/**
 * Standard tolerance grades, micrometres, one entry per diameter step.
 * ISO 286-1 table 1. Grades below IT5 are included because press fits and
 * bearing seats are specified in them, even though nothing in this app can
 * hold them.
 */
export const IT = {
  1:  [0.8, 1, 1, 1.2, 1.5, 1.5, 2, 2.5, 3.5, 4.5, 6, 7, 8],
  2:  [1.2, 1.5, 1.5, 2, 2.5, 2.5, 3, 4, 5, 7, 8, 9, 10],
  3:  [2, 2.5, 2.5, 3, 4, 4, 5, 6, 8, 10, 12, 13, 15],
  4:  [3, 4, 4, 5, 6, 7, 8, 10, 12, 14, 16, 18, 20],
  5:  [4, 5, 6, 8, 9, 11, 13, 15, 18, 20, 23, 25, 27],
  6:  [6, 8, 9, 11, 13, 16, 19, 22, 25, 29, 32, 36, 40],
  7:  [10, 12, 15, 18, 21, 25, 30, 35, 40, 46, 52, 57, 63],
  8:  [14, 18, 22, 27, 33, 39, 46, 54, 63, 72, 81, 89, 97],
  9:  [25, 30, 36, 43, 52, 62, 74, 87, 100, 115, 130, 140, 155],
  10: [40, 48, 58, 70, 84, 100, 120, 140, 160, 185, 210, 230, 250],
  11: [60, 75, 90, 110, 130, 160, 190, 220, 250, 290, 320, 360, 400],
  12: [100, 120, 150, 180, 210, 250, 300, 350, 400, 460, 520, 570, 630],
  13: [140, 180, 220, 270, 330, 390, 460, 540, 630, 720, 810, 890, 970],
};

export const IT_GRADES = Object.keys(IT).map(Number).sort((a, b) => a - b);

function stepIndex(D) {
  const d = Math.abs(D);
  for (let i = 0; i < IT_STEPS.length; i++) if (d <= IT_STEPS[i]) return i;
  return -1;
}

/**
 * Width of one IT grade at a given diameter, in millimetres.
 * Returns null outside the tabulated range (over 500mm) rather than
 * extrapolating a number the standard does not give.
 */
export function itGrade(grade, D) {
  const row = IT[grade];
  const i = stepIndex(D);
  if (!row || i < 0) return null;
  return row[i] / 1000;
}

/* ------------------------------------------ ISO 286 fundamental deviations */

/**
 * Fundamental deviations, micrometres, as `[upTo, value]` pairs. For the
 * clearance letters the value is `es`, the upper deviation of the shaft, at or
 * below zero. For the interference letters it is `ei`, the lower deviation, at
 * or above zero. Upper-case hole letters mirror these: EI = -es, ES = -ei.
 *
 * `k` is tabulated for grades IT4 to IT7; in coarser grades its deviation is
 * zero, which `fundamental` handles.
 */
const DEV = {
  h: { side: 'es', table: [[500, 0]] },
  g: { side: 'es', table: [[3, -2], [6, -4], [10, -5], [18, -6], [30, -7], [50, -9], [80, -10], [120, -12], [180, -14], [250, -15], [315, -17], [400, -18], [500, -20]] },
  f: { side: 'es', table: [[3, -6], [6, -10], [10, -13], [18, -16], [30, -20], [50, -25], [80, -30], [120, -36], [180, -43], [250, -50], [315, -56], [400, -62], [500, -68]] },
  e: { side: 'es', table: [[3, -14], [6, -20], [10, -25], [18, -32], [30, -40], [50, -50], [80, -60], [120, -72], [180, -85], [250, -100], [315, -110], [400, -125], [500, -135]] },
  d: { side: 'es', table: [[3, -20], [6, -30], [10, -40], [18, -50], [30, -65], [50, -80], [80, -100], [120, -120], [180, -145], [250, -170], [315, -190], [400, -210], [500, -230]] },
  c: { side: 'es', table: [[3, -60], [6, -70], [10, -80], [18, -95], [30, -110], [40, -120], [50, -130], [65, -140], [80, -150], [100, -170], [120, -180], [140, -200], [160, -210], [180, -230], [200, -240], [225, -260], [250, -280], [280, -300], [315, -330], [355, -360], [400, -400], [450, -440], [500, -480]] },
  k: { side: 'ei', table: [[3, 0], [6, 1], [10, 1], [18, 1], [30, 2], [50, 2], [80, 2], [120, 3], [180, 3], [250, 4], [315, 4], [400, 4], [500, 5]] },
  n: { side: 'ei', table: [[3, 4], [6, 8], [10, 10], [18, 12], [30, 15], [50, 17], [80, 20], [120, 23], [180, 27], [250, 31], [315, 34], [400, 37], [500, 40]] },
  p: { side: 'ei', table: [[3, 6], [6, 12], [10, 15], [18, 18], [30, 22], [50, 26], [80, 32], [120, 37], [180, 43], [250, 50], [315, 56], [400, 62], [500, 68]] },
  s: { side: 'ei', table: [[3, 14], [6, 19], [10, 23], [18, 28], [30, 35], [50, 43], [65, 53], [80, 59], [100, 71], [120, 79], [140, 92], [160, 100], [180, 108], [200, 122], [225, 130], [250, 140], [280, 158], [315, 170], [355, 190], [400, 208], [450, 232], [500, 252]] },
};

export const SHAFT_LETTERS = Object.keys(DEV);
export const HOLE_LETTERS = SHAFT_LETTERS.map(l => l.toUpperCase());

/**
 * Fundamental deviation for one letter at one diameter, in millimetres.
 * @returns {{side: 'es'|'ei', value: number}|null}
 */
export function fundamental(letter, D, grade = 7) {
  const lower = String(letter || '').toLowerCase();
  const spec = DEV[lower];
  if (!spec || stepIndex(D) < 0) return null;
  const d = Math.abs(D);
  let um = 0;
  for (const [upTo, value] of spec.table) { um = value; if (d <= upTo) break; }
  // k is only displaced for the fine grades; in IT8 and coarser it sits on zero.
  if (lower === 'k' && (grade < 4 || grade > 7)) um = 0;
  const hole = letter !== lower;
  if (hole) return { side: spec.side === 'es' ? 'ei' : 'es', value: -um / 1000 };
  return { side: spec.side, value: um / 1000 };
}

/**
 * Parse a fit designation such as 'H7' or 'g6' and return its limits at a
 * given nominal size, in millimetres relative to that nominal.
 * @returns {{letter: string, grade: number, upper: number, lower: number, width: number, hole: boolean}|null}
 */
export function limitsFor(spec, D) {
  const m = /^([A-Za-z]+)\s*(\d{1,2})$/.exec(String(spec || '').trim());
  if (!m) return null;
  const letter = m[1], grade = Number(m[2]);
  const width = itGrade(grade, D);
  const fd = fundamental(letter, D, grade);
  if (width == null || !fd) return null;
  const upper = fd.side === 'es' ? fd.value : fd.value + width;
  const lower = fd.side === 'ei' ? fd.value : fd.value - width;
  return { letter, grade, upper, lower, width, hole: letter !== letter.toLowerCase() };
}

/** The fits worth offering by name, with what each is actually for. */
export const FITS = {
  'H11/c11': { kind: 'clearance', label: 'Loose running', note: 'Wide clearance for dirt, paint or heat. Use where nothing has to locate.' },
  'H9/d9':   { kind: 'clearance', label: 'Free running',  note: 'Rotating at speed with generous lubrication; not for accurate location.' },
  'H8/f7':   { kind: 'clearance', label: 'Close running', note: 'Turns freely, locates moderately. The default plain-bearing fit.' },
  'H7/g6':   { kind: 'clearance', label: 'Sliding',       note: 'Slides and turns by hand, locates accurately. Good for spigots.' },
  'H7/h6':   { kind: 'clearance', label: 'Locational clearance', note: 'Assembles freely by hand and stays put. The safe default.' },
  'H7/k6':   { kind: 'transition', label: 'Locational transition', note: 'Light tap to assemble. Accurate location without a press.' },
  'H7/n6':   { kind: 'transition', label: 'Locational interference', note: 'Press to assemble. Rigid location, still separable.' },
  'H7/p6':   { kind: 'interference', label: 'Press fit', note: 'Press or shrink. Torque through the joint only with a key.' },
  'H7/s6':   { kind: 'interference', label: 'Driving fit', note: 'Heavy press or heat. Permanent; parts are rarely separable undamaged.' },
};

/**
 * Resolve a hole/shaft pair at a nominal size into real clearances.
 * Positive clearance is a gap, negative is interference.
 */
export function fitOf(holeSpec, shaftSpec, D) {
  const hole = limitsFor(holeSpec, D);
  const shaft = limitsFor(shaftSpec, D);
  if (!hole || !shaft) return null;
  const maxClearance = hole.upper - shaft.lower;
  const minClearance = hole.lower - shaft.upper;
  const kind = minClearance >= 0 ? 'clearance' : maxClearance <= 0 ? 'interference' : 'transition';
  const name = `${holeSpec}/${shaftSpec}`;
  return {
    name, nominal: D, hole, shaft, maxClearance, minClearance, kind,
    named: FITS[name] || null,
    // The spread an assembler actually feels: how much the gap varies part to part.
    variation: maxClearance - minClearance,
  };
}

/** Every named fit resolved at one size, for a table the user can scan. */
export function fitTable(D) {
  return Object.keys(FITS).map(name => {
    const [h, s] = name.split('/');
    return fitOf(h, s, D);
  }).filter(Boolean);
}

/**
 * Pick the named fit whose clearance range best matches what the designer
 * actually asked for, so the answer to "I need 0.02 to 0.06 of play" is a
 * designation rather than a browse through a table.
 */
export function suggestFit(D, { minClearance = 0, maxClearance = null, kind = null } = {}) {
  const want = { lo: minClearance, hi: maxClearance == null ? minClearance + 0.05 : maxClearance };
  const scored = fitTable(D)
    .filter(f => !kind || f.kind === kind)
    .map(f => {
      const overlapLo = Math.max(f.minClearance, want.lo);
      const overlapHi = Math.min(f.maxClearance, want.hi);
      const overlap = Math.max(0, overlapHi - overlapLo);
      const span = Math.max(1e-9, Math.max(f.maxClearance, want.hi) - Math.min(f.minClearance, want.lo));
      return { ...f, score: overlap / span };
    })
    .sort((a, b) => b.score - a.score);
  return scored;
}

/* ----------------------------------------------------------------- stacks */

/**
 * How a tolerance band is expected to be filled by real production.
 * `sigma` converts a half-width into a standard deviation.
 *   normal      a centred process held inside +/- 3 sigma, the usual assumption
 *   uniform     no central tendency at all: a sorted bin, a shim, a clearance
 *   triangular  some central tendency but no capability data to back it
 *   sixSigma    a genuinely capable process, band is +/- 6 sigma
 */
export const DISTRIBUTIONS = {
  normal:     { label: 'Normal (±3σ)', sigma: t => t / 3 },
  sixSigma:   { label: 'Capable (±6σ)', sigma: t => t / 6 },
  triangular: { label: 'Triangular', sigma: t => t / Math.sqrt(6) },
  uniform:    { label: 'Uniform', sigma: t => t / Math.sqrt(3) },
};

let linkSeq = 0;
export function makeLink(over = {}) {
  linkSeq++;
  return {
    id: `tl${Date.now().toString(36).slice(-4)}${linkSeq.toString(36)}`,
    label: 'Dimension',
    nominal: 10,
    plus: 0.1,
    minus: 0.1,
    dir: 1,
    dist: 'normal',
    fixed: false,
    source: null,
    ...over,
  };
}

export function emptyStack(over = {}) {
  return {
    id: `st${Date.now().toString(36).slice(-5)}${(++linkSeq).toString(36)}`,
    name: 'Stack 1',
    // What the chain has to achieve. Absolute millimetres, not deviations.
    lower: 0.05,
    upper: 0.35,
    requirement: 'Assembly gap',
    // Allowance for a process mean that drifts off centre over a production run.
    shift: 0,
    links: [],
    ...over,
  };
}

const half = (l) => (Math.abs(l.plus) + Math.abs(l.minus)) / 2;
const mid = (l) => l.nominal + (l.plus - l.minus) / 2;
const sigmaOf = (l) => (DISTRIBUTIONS[l.dist] || DISTRIBUTIONS.normal).sigma(half(l));

/* Normal CDF via Abramowitz & Stegun 7.1.26, good to 1.5e-7 absolute. */
function erf(x) {
  const s = Math.sign(x), a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return s * y;
}
export const normalCdf = (z) => 0.5 * (1 + erf(z / Math.SQRT2));

/** Deterministic PRNG so a Monte Carlo result is reproducible and diffable. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sampleLink(l, rnd) {
  const t = half(l), c = mid(l);
  switch (l.dist) {
    case 'uniform': return c + (rnd() * 2 - 1) * t;
    case 'triangular': return c + ((rnd() + rnd()) - 1) * t;
    case 'sixSigma': case 'normal': default: {
      // Box-Muller, clipped at the stated band: parts outside it are scrap,
      // not assembled, so including them would overstate the failure rate.
      const u = Math.max(1e-12, rnd());
      const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
      const s = (DISTRIBUTIONS[l.dist] || DISTRIBUTIONS.normal).sigma(t);
      return c + Math.max(-t, Math.min(t, z * s));
    }
  }
}

/**
 * Capability of one spread against one requirement.
 * Cp asks whether the process is tight enough; Cpk asks whether it is also
 * aimed at the middle. A Cp of 2.0 with a Cpk of 0.8 is a good machine
 * pointed at the wrong number, which is a different fix from a bad machine.
 */
export function capability({ mean, sigma, lower, upper, shift = 0 }) {
  const mu = mean + shift;
  if (!(sigma > 0)) {
    const inside = mu >= lower && mu <= upper;
    return { cp: Infinity, cpk: Infinity, ppm: inside ? 0 : 1e6, sigmaLevel: Infinity, yield: inside ? 1 : 0, centred: true, mean: mu, sigma: 0 };
  }
  const cp = (upper - lower) / (6 * sigma);
  const cpu = (upper - mu) / (3 * sigma);
  const cpl = (mu - lower) / (3 * sigma);
  const cpk = Math.min(cpu, cpl);
  const pHigh = 1 - normalCdf((upper - mu) / sigma);
  const pLow = normalCdf((lower - mu) / sigma);
  const bad = Math.max(0, Math.min(1, pHigh + pLow));
  return {
    cp, cpk, cpu, cpl,
    ppm: bad * 1e6,
    yield: 1 - bad,
    sigmaLevel: cpk * 3,
    centred: Math.abs(cp - cpk) < 0.05,
    mean: mu, sigma,
  };
}

/** Plain-language verdict on a Cpk, using the thresholds industry argues in. */
export function cpkVerdict(cpk) {
  if (!Number.isFinite(cpk)) return { grade: 'exact', label: 'No variation modelled', severity: 'note' };
  if (cpk >= 2.00) return { grade: 'six-sigma', label: 'Six sigma: effectively never fails', severity: 'ok' };
  if (cpk >= 1.67) return { grade: 'excellent', label: 'Excellent: safe for automated assembly', severity: 'ok' };
  if (cpk >= 1.33) return { grade: 'capable', label: 'Capable: the usual production target', severity: 'ok' };
  if (cpk >= 1.00) return { grade: 'marginal', label: 'Marginal: expect sorting and rework', severity: 'warn' };
  // 0.66 rather than 0.67, so a Cpk of exactly two thirds (2 sigma, about 4.5%
  // rejects) reads as poor rather than falling off the bottom of the scale.
  if (cpk >= 0.66) return { grade: 'poor', label: 'Poor: a few percent will not assemble', severity: 'warn' };
  return { grade: 'incapable', label: 'Incapable: this chain does not hold', severity: 'block' };
}

/**
 * Analyse a stack three ways at once, because the three answers disagree and
 * the disagreement is the useful part: worst case is what a contract promises,
 * RSS is what a run of parts actually does, Monte Carlo shows whether the tail
 * is symmetric or piles against one limit.
 */
export function analyseStack(stack, { trials = 20000, seed = 0x5eed } = {}) {
  const links = (stack.links || []).filter(l => l && Number.isFinite(l.nominal));
  const lower = Math.min(stack.lower, stack.upper);
  const upper = Math.max(stack.lower, stack.upper);

  let mean = 0, wcMin = 0, wcMax = 0, varSum = 0, tolSum = 0;
  for (const l of links) {
    const dir = l.dir >= 0 ? 1 : -1;
    const c = mid(l), t = half(l);
    mean += dir * c;
    const a = dir * (c - t), b = dir * (c + t);
    wcMin += Math.min(a, b);
    wcMax += Math.max(a, b);
    const s = sigmaOf(l);
    varSum += s * s;
    tolSum += t;
  }
  const sigma = Math.sqrt(varSum);
  const rssHalf = 3 * sigma; // the +/-3 sigma band the RSS method quotes

  const worst = {
    min: wcMin, max: wcMax,
    fits: wcMin >= lower - 1e-12 && wcMax <= upper + 1e-12,
    // How much of the requirement the chain consumes at the extremes.
    used: (wcMax - wcMin) / Math.max(1e-12, upper - lower),
  };
  const rss = {
    min: mean - rssHalf, max: mean + rssHalf, sigma,
    fits: mean - rssHalf >= lower - 1e-12 && mean + rssHalf <= upper + 1e-12,
  };
  const cap = capability({ mean, sigma, lower, upper, shift: stack.shift || 0 });

  // Monte Carlo. Deterministic seed, clipped normals, so the figure is stable
  // between runs and moves only when the design does.
  const rnd = mulberry32(seed);
  const n = Math.max(200, Math.min(200000, trials | 0));
  const samples = new Float64Array(n);
  let bad = 0;
  for (let i = 0; i < n; i++) {
    let v = stack.shift || 0;
    for (const l of links) v += (l.dir >= 0 ? 1 : -1) * sampleLink(l, rnd);
    samples[i] = v;
    if (v < lower || v > upper) bad++;
  }
  samples.sort();
  const at = (q) => samples[Math.min(n - 1, Math.max(0, Math.round(q * (n - 1))))];
  const mc = {
    trials: n,
    mean: samples.reduce((s, v) => s + v, 0) / n,
    min: samples[0], max: samples[n - 1],
    p1: at(0.01), p50: at(0.5), p99: at(0.99),
    failures: bad,
    ppm: (bad / n) * 1e6,
    yield: 1 - bad / n,
  };

  return {
    name: stack.name, requirement: stack.requirement,
    lower, upper, mean, nominalFits: mean >= lower && mean <= upper,
    links: links.length,
    worst, rss, mc, capability: cap, verdict: cpkVerdict(cap.cpk),
    contributors: contributors(stack),
    tolSum,
  };
}

/**
 * Rank the chain by who is responsible for the spread. Variance share is the
 * honest ranking: halving the biggest contributor's tolerance buys far more
 * than halving three small ones, and the percentages say by how much.
 */
export function contributors(stack) {
  const links = (stack.links || []).filter(l => l && Number.isFinite(l.nominal));
  const vars = links.map(l => { const s = sigmaOf(l); return s * s; });
  const totalVar = vars.reduce((a, b) => a + b, 0);
  const totalTol = links.reduce((a, l) => a + half(l), 0);
  return links.map((l, i) => ({
    id: l.id, label: l.label, dir: l.dir >= 0 ? 1 : -1,
    nominal: l.nominal, tol: half(l), dist: l.dist, fixed: !!l.fixed,
    sigma: Math.sqrt(vars[i]),
    varianceShare: totalVar > 0 ? vars[i] / totalVar : 0,
    worstShare: totalTol > 0 ? half(l) / totalTol : 0,
  })).sort((a, b) => b.varianceShare - a.varianceShare);
}

/**
 * What to change. Two levers, priced: scale every open tolerance by a common
 * factor, or tighten one link at a time until the target is met. The second is
 * what a shop would actually do, because one tighter operation is cheaper than
 * five.
 */
export function levers(stack, { target = 1.33, trials = 4000 } = {}) {
  const base = analyseStack(stack, { trials });
  const out = { base, target, uniform: null, single: [], centring: null, closes: true };
  if (base.capability.cpk >= target) { out.met = true; return out; }

  const open = (stack.links || []).filter(l => l && !l.fixed && half(l) > 0);
  const lower = base.lower, upper = base.upper;
  const mu = base.mean + (stack.shift || 0);
  const worstHalfSpace = Math.min(upper - mu, mu - lower);

  // The nominal chain lands outside the requirement. No tolerance is small
  // enough to fix that, so saying "tighten this" would be wrong advice rather
  // than incomplete advice. Name the gap and the dimension that would close
  // it, and stop: this is a design change, not a precision problem.
  if (!(worstHalfSpace > 0)) {
    const miss = mu > upper ? mu - upper : lower - mu;
    out.closes = false;
    out.nominal = {
      mean: mu, lower, upper, miss,
      note: `The nominal chain closes at ${mu.toFixed(4)} mm, which is ${miss.toFixed(4)} mm ${mu > upper ? 'above' : 'below'} the requirement. Tightening tolerances cannot reach a number the nominals never sum to: change a dimension by ${((mu > upper ? -1 : 1) * miss).toFixed(4)} mm, or check that every link's direction is right.`,
    };
    return out;
  }

  // Uniform scaling. Cpk is linear in 1/sigma while the mean stays put, so the
  // factor is exact and needs no search.
  if (base.capability.sigma > 0 && worstHalfSpace > 0) {
    const sigmaWanted = worstHalfSpace / (3 * target);
    const fixedVar = (stack.links || []).filter(l => l.fixed).reduce((a, l) => { const s = sigmaOf(l); return a + s * s; }, 0);
    const openVar = Math.max(0, base.capability.sigma ** 2 - fixedVar);
    const wantedOpenVar = sigmaWanted ** 2 - fixedVar;
    out.uniform = wantedOpenVar <= 0
      ? { possible: false, note: 'Even zero tolerance on the open links cannot reach the target: the fixed links alone are too loose.' }
      : { possible: true, factor: Math.sqrt(wantedOpenVar / Math.max(1e-18, openVar)) };
  }

  // Single-link tightening. For each open link, the tolerance it would need if
  // it alone absorbed the shortfall.
  for (const l of open) {
    const s = sigmaOf(l);
    const others = base.capability.sigma ** 2 - s * s;
    const sigmaWanted = worstHalfSpace / (3 * target);
    const room = sigmaWanted ** 2 - others;
    const scale = (DISTRIBUTIONS[l.dist] || DISTRIBUTIONS.normal).sigma(1);
    out.single.push({
      id: l.id, label: l.label, from: half(l),
      to: room > 0 ? Math.sqrt(room) / scale : null,
      enough: room > 0,
    });
  }
  out.single.sort((a, b) => (a.enough === b.enough ? (b.from - b.to) - (a.from - a.to) : a.enough ? -1 : 1));

  // Centring. If Cp already clears the target, the chain is tight enough and
  // only aimed wrong; moving one nominal is free where tightening is not.
  if (base.capability.cp >= target && base.capability.cpk < target) {
    out.centring = { move: (lower + upper) / 2 - mu, note: 'The chain is tight enough but off centre. Shift a nominal instead of buying tolerance.' };
  }
  return out;
}

/**
 * Allocate tolerances from the requirement backwards, which is how a stack
 * should be written and almost never is.
 *   equal          every link gets the same band
 *   proportional   bands scale with nominal size, matching how processes behave
 *   capability     bands scale with what the chosen process can actually hold
 */
export function allocate(stack, { method = 'proportional', target = 1.33, floor = 0.005 } = {}) {
  const links = (stack.links || []).filter(l => l && Number.isFinite(l.nominal));
  if (!links.length) return [];
  const lower = Math.min(stack.lower, stack.upper), upper = Math.max(stack.lower, stack.upper);
  const mu = links.reduce((a, l) => a + (l.dir >= 0 ? 1 : -1) * l.nominal, 0) + (stack.shift || 0);
  const room = Math.min(upper - mu, mu - lower);
  if (!(room > 0)) return links.map(l => ({ id: l.id, label: l.label, tol: null, note: 'The nominal chain already misses the requirement; fix the nominals first.' }));

  const sigmaBudget = room / (3 * target);
  const weights = links.map(l => {
    if (method === 'equal') return 1;
    if (method === 'capability') return Math.max(1e-6, half(l));
    return Math.max(1e-6, Math.cbrt(Math.abs(l.nominal) || 1));
  });
  // sigma_i = k*w_i, and sum(k^2 w_i^2) = sigmaBudget^2.
  const norm = Math.sqrt(weights.reduce((a, w) => a + w * w, 0));
  const k = sigmaBudget / Math.max(1e-12, norm);
  return links.map((l, i) => {
    const scale = (DISTRIBUTIONS[l.dist] || DISTRIBUTIONS.normal).sigma(1);
    const tol = (k * weights[i]) / scale;
    return {
      id: l.id, label: l.label, nominal: l.nominal,
      tol: Math.max(floor, tol),
      tight: tol < floor,
      note: tol < floor ? `Needs ±${tol.toFixed(4)}mm, below the ±${floor}mm floor. Rethink the chain rather than the tolerance.` : '',
    };
  });
}

/* ------------------------------------------------- chains from the model */

/**
 * Offer a chain built from the model instead of an empty table. Every solid in
 * the build contributes the extent it actually has along the chosen axis, with
 * the tolerance the chosen process can hold, so the first thing the user sees
 * is their own part rather than a blank form. They then delete what is not in
 * the chain, which is far less work than typing it in.
 */
export function stackFromBuild(bodies, { axis = 'x', process = null, limits = null, requirement = 'Assembly gap' } = {}) {
  const i = axis === 'z' ? 2 : axis === 'y' ? 1 : 0;
  const tol = limits?.tolerance ?? 0.1;
  const links = [];
  for (const b of bodies || []) {
    const box = b.box;
    if (!box) continue;
    const min = box.min?.[axis] ?? box.min?.[i] ?? (Array.isArray(box.min) ? box.min[i] : null);
    const max = box.max?.[axis] ?? box.max?.[i] ?? (Array.isArray(box.max) ? box.max[i] : null);
    if (!Number.isFinite(min) || !Number.isFinite(max)) continue;
    const size = max - min;
    if (!(size > 1e-6)) continue;
    links.push(makeLink({
      label: `${b.feature?.name || 'Body'} ${axis.toUpperCase()}`,
      nominal: Number(size.toFixed(4)),
      plus: tol, minus: tol,
      dir: 1, dist: 'normal',
      source: { feature: b.feature?.id || null, axis },
    }));
  }
  const nominal = links.reduce((a, l) => a + l.nominal, 0);
  return emptyStack({
    name: `${axis.toUpperCase()} chain`,
    requirement,
    links,
    lower: Number((nominal * 0.995).toFixed(4)),
    upper: Number((nominal * 1.005).toFixed(4)),
    process: process || null,
  });
}

/** One line per stack for a report or the release package. */
export function stackSummary(stack) {
  const a = analyseStack(stack, { trials: 4000 });
  return {
    name: stack.name,
    requirement: stack.requirement,
    spec: `${a.lower.toFixed(3)} to ${a.upper.toFixed(3)} mm`,
    worstCase: `${a.worst.min.toFixed(3)} to ${a.worst.max.toFixed(3)} mm`,
    worstCaseFits: a.worst.fits,
    cp: a.capability.cp, cpk: a.capability.cpk,
    ppm: a.capability.ppm,
    verdict: a.verdict.label,
    severity: a.verdict.severity,
    driver: a.contributors[0]?.label || null,
    driverShare: a.contributors[0]?.varianceShare ?? 0,
  };
}
