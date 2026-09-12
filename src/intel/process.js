/**
 * Manufacturing processes: the shared table behind both the Design Doctor and
 * the cost estimate.
 *
 * Every number here is an order-of-magnitude figure drawn from published shop
 * guidance, not a quote. They exist so the software can say "this wall is
 * below what your process can hold" and "these two processes cross over around
 * here" — questions that have a useful answer at one significant figure and a
 * misleading one at three. Nothing in this file should ever be presented to a
 * user as a price.
 *
 * Lengths are millimetres, volumes cubic millimetres, money a neutral currency
 * unit the user can relabel. Rates are editable in Studio standards, because a
 * shop's real rates are exactly the organisational memory the app should hold
 * rather than make you re-enter per project.
 */

/**
 * @typedef {object} Process
 * @property {string} label         name shown to the user
 * @property {string} kind          'additive' | 'subtractive' | 'formative'
 * @property {number} minWall       thinnest wall the process reliably holds, mm
 * @property {number} minFeature    smallest hole, slot, rib or engraving, mm
 * @property {number[]} envelope    usable build/work envelope, mm
 * @property {number} tolerance     typical achievable tolerance, ±mm
 * @property {number} setup         one-off cost per job (fixturing, slicing, CAM)
 * @property {number} tooling       one-off cost of dedicated tooling, amortised over the batch
 * @property {number} rate          machine + operator cost per hour
 * @property {number} throughput    mm^3 of part produced per hour at the machine
 * @property {number} scrap         fraction of purchased material that ends up as swarf or support
 * @property {string[]} wants       design rules this process rewards
 * @property {string} note          the one sentence worth knowing before choosing it
 */

/** @type {Record<string, Process>} */
export const PROCESSES = {
  fdm: {
    label: 'FDM 3D printing',
    kind: 'additive',
    minWall: 1.2, minFeature: 0.8,
    envelope: [256, 256, 256],
    tolerance: 0.3,
    setup: 4, tooling: 0, rate: 3.5, throughput: 16000,
    scrap: 0.15,
    wants: ['overhangs under 45 degrees', 'no unsupported bridges over 10mm'],
    note: 'Cheapest way to hold a part in your hand today; layer lines and weak Z-bonding make it a prototype process, not a production one.',
  },
  sla: {
    label: 'Resin (SLA/DLP)',
    kind: 'additive',
    minWall: 0.6, minFeature: 0.3,
    envelope: [145, 145, 175],
    tolerance: 0.1,
    setup: 9, tooling: 0, rate: 6, throughput: 9000,
    scrap: 0.25,
    wants: ['drain holes in every hollow', 'no fully enclosed voids'],
    note: 'Fine detail and a smooth surface, but the parts are brittle and degrade in sunlight.',
  },
  sls: {
    label: 'SLS nylon',
    kind: 'additive',
    minWall: 0.8, minFeature: 0.5,
    envelope: [330, 330, 600],
    tolerance: 0.2,
    setup: 25, tooling: 0, rate: 22, throughput: 26000,
    scrap: 0.35,
    wants: ['escape holes for unsintered powder'],
    note: 'No support structures, so geometry is nearly free; the powder bed makes small batches viable where moulding is not.',
  },
  cnc3: {
    label: '3-axis CNC',
    kind: 'subtractive',
    minWall: 0.8, minFeature: 1.0,
    envelope: [400, 400, 150],
    tolerance: 0.05,
    setup: 70, tooling: 0, rate: 65, throughput: 40000,
    scrap: 0.1,
    wants: ['internal corners with a radius', 'features reachable from one side'],
    note: 'You pay for the material you cut away and for every extra setup, so a part that machines from one side costs a fraction of one that does not.',
  },
  sheet: {
    label: 'Laser-cut sheet',
    kind: 'subtractive',
    minWall: 1.0, minFeature: 1.0,
    envelope: [1500, 3000, 12],
    tolerance: 0.15,
    setup: 25, tooling: 0, rate: 55, throughput: 90000,
    scrap: 0.2,
    wants: ['constant thickness', 'bends no tighter than the material thickness'],
    note: 'Far and away the cheapest metal process, but only for parts that are genuinely a folded sheet.',
  },
  cast: {
    label: 'Sand casting',
    kind: 'formative',
    minWall: 3.0, minFeature: 3.0,
    envelope: [1000, 1000, 600],
    tolerance: 0.8,
    setup: 120, tooling: 350, rate: 40, throughput: 150000,
    scrap: 0.3,
    wants: ['uniform wall thickness', 'draft on every vertical face', 'generous fillets'],
    note: 'Cheap per kilogram at volume; the pattern and the rough surface mean it is rarely the finished part.',
  },
  im: {
    label: 'Injection moulding',
    kind: 'formative',
    minWall: 1.0, minFeature: 0.5,
    envelope: [400, 400, 250],
    tolerance: 0.1,
    setup: 200, tooling: 7000, rate: 55, throughput: 400000,
    scrap: 0.05,
    wants: ['uniform wall thickness', 'draft on every vertical face', 'no thick solid sections'],
    note: 'The tool dominates everything: pennies per part once it exists, and thousands before it does.',
  },
};

export const PROCESS_IDS = Object.keys(PROCESSES);

/** Material prices per kilogram, in the same neutral unit as the process rates. */
export const MATERIAL_PRICE = {
  steel: 2.2, aluminium: 5.5, stainless: 8.0, brass: 11, copper: 12,
  titanium: 60, abs: 3.2, pla: 3.0, nylon: 9, acrylic: 6,
  wood: 1.5, concrete: 0.4, glass: 4, rubber: 5, custom: 5,
};

/** Which processes can actually make a part from this material. */
const METALS = new Set(['steel', 'aluminium', 'stainless', 'brass', 'copper', 'titanium']);
const PLASTICS = new Set(['abs', 'pla', 'nylon', 'acrylic', 'rubber']);

export function processSuits(processId, material) {
  const p = PROCESSES[processId];
  if (!p) return false;
  if (processId === 'fdm' || processId === 'sla' || processId === 'sls' || processId === 'im') return PLASTICS.has(material);
  if (processId === 'cast') return METALS.has(material);
  if (processId === 'sheet') return METALS.has(material) || material === 'acrylic';
  return METALS.has(material) || PLASTICS.has(material) || material === 'wood';
}

/**
 * Can this process make a part of this *shape*, as opposed to this material?
 *
 * Without this the estimate happily recommends laser-cut sheet for a turned
 * sleeve, because sheet is cheap per kilogram and the material check passes.
 * That is the kind of confidently wrong answer that makes a whole feature
 * untrustworthy, so the geometric gate matters as much as the material one.
 *
 * @param {object} part { volume, box: {x,y,z} }
 */
export function processFitsShape(processId, part) {
  const p = PROCESSES[processId];
  if (!p || !part?.box) return true;
  const dims = [part.box.x, part.box.y, part.box.z].sort((a, b) => a - b);
  const [min, mid, max] = dims;

  if (processId === 'sheet') {
    // A sheet part is a flat profile of constant thickness. Two cheap tests
    // catch almost everything that is not: too thick for stock, or not flat.
    if (min > p.envelope[2]) return false;
    if (min > max * 0.25) return false;
    // A constant-thickness profile fills a good fraction of its bounding box;
    // a cone or a sphere sitting in the same box does not.
    const fill = part.volume / Math.max(1e-9, min * mid * max);
    if (fill < 0.3) return false;
  }
  return true;
}

/** Does the part fit the work envelope, in any orientation? */
export function processFitsEnvelope(processId, part) {
  const p = PROCESSES[processId];
  if (!p || !part?.box) return true;
  const dims = [part.box.x, part.box.y, part.box.z].sort((a, b) => b - a);
  const env = [...p.envelope].sort((a, b) => b - a);
  return dims.every((v, i) => v <= env[i]);
}

export function processOf(id) { return PROCESSES[id] || PROCESSES.cnc3; }
