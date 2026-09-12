/**
 * Economic manufacturability.
 *
 * A part can be perfectly manufacturable and still be a bad part, because
 * manufacturability is a yes/no question and cost is the one that decides
 * whether the design ships. Conventional DFM tells you a feature can be made.
 * This tells you what making it will cost, which process wins at your batch
 * size, where the crossover between processes actually falls, and which single
 * number in the model is driving the price.
 *
 * On honesty: these are estimates from an order-of-magnitude model, and the
 * user interface says so everywhere it shows one. The value is not the absolute
 * figure — no static model can quote your shop. The value is the *shape*: that
 * moulding overtakes printing at roughly this quantity, that you are paying
 * mostly for removed material rather than for the part. Those conclusions are
 * robust to the rates being wrong by a factor of two, which is exactly why they
 * are worth showing and a precise-looking price is not.
 */
import { MATERIALS } from '../core/doc.js';
import { PROCESSES, PROCESS_IDS, MATERIAL_PRICE, processSuits, processFitsShape, processFitsEnvelope } from './process.js';

const MM3_PER_CM3 = 1000;

/**
 * Cost one part by one process.
 *
 * @param {object} part   { volume, box:{x,y,z}, material, area }
 * @param {string} processId
 * @param {object} opts   { batch, rates }  rates override the process defaults
 * @returns {{ total, each, setup, tooling, material, machine, hours, drivers }}
 */
export function costOne(part, processId, { batch = 1, rates = {} } = {}) {
  const p = { ...PROCESSES[processId], ...(rates[processId] || {}) };
  const n = Math.max(1, Math.round(batch));
  const density = (MATERIALS[part.material] || MATERIALS.steel).density;      // kg/mm^3
  const price = rates.materialPrice?.[part.material] ?? MATERIAL_PRICE[part.material] ?? 5;

  // Subtractive processes are billed on the block you start from, not the part
  // you end up with. That single difference is why a lightweight machined part
  // is often dearer than a heavy one, and the model has to carry it.
  const stock = part.box.x * part.box.y * part.box.z;
  const billedVolume = p.kind === 'subtractive' ? stock : part.volume;
  const removed = Math.max(0, stock - part.volume);

  const materialKg = (billedVolume * (1 + p.scrap)) * density;
  const material = materialKg * price;

  // Machine time: additive is paced by the volume it lays down, subtractive by
  // the volume it takes away, formative by cycle time and barely by size.
  const workVolume = p.kind === 'subtractive' ? removed : part.volume;
  const hours = Math.max(0.02, workVolume / p.throughput);
  const machine = hours * p.rate;

  const setup = p.setup / n;
  const tooling = p.tooling / n;
  const each = material + machine + setup + tooling;

  const drivers = [
    { key: 'material', label: 'Material', value: material },
    { key: 'machine', label: 'Machine time', value: machine },
    { key: 'setup', label: 'Setup, per part', value: setup },
    { key: 'tooling', label: 'Tooling, per part', value: tooling },
  ].filter(d => d.value > 0).sort((a, b) => b.value - a.value);

  return {
    processId, each, total: each * n, material, machine, setup, tooling,
    hours, materialKg, removedFraction: stock > 0 ? removed / stock : 0,
    drivers,
  };
}

/**
 * Compare every process that can make this part, at one batch size.
 * Returns them cheapest-first with the winner's margin over the runner-up.
 */
export function compare(part, { batch = 1, rates = {} } = {}) {
  const suits = PROCESS_IDS.filter(id => processSuits(id, part.material));
  // Shape and envelope gates first. If nothing survives them the part is
  // awkward rather than impossible, so fall back to the material-only list and
  // say so, instead of reporting no answer at all.
  let ids = suits.filter(id => processFitsShape(id, part) && processFitsEnvelope(id, part));
  const constrained = ids.length > 0;
  if (!constrained) ids = suits;

  const rows = ids
    .map(id => ({ ...costOne(part, id, { batch, rates }), label: PROCESSES[id].label }))
    .sort((a, b) => a.each - b.each);
  const margin = rows.length > 1 ? (rows[1].each - rows[0].each) / rows[1].each : 1;
  return { rows, best: rows[0] || null, margin, constrained, excluded: suits.length - ids.length };
}

/**
 * Where does the cheapest process change as the batch grows?
 *
 * This is the question the estimate exists to answer, and the one a per-part
 * price cannot: printing wins at ten, moulding wins at ten thousand, and the
 * number in between is what decides how you tool the job.
 */
export function crossovers(part, { rates = {}, quantities = QUANTITIES } = {}) {
  const points = quantities.map(q => {
    const c = compare(part, { batch: q, rates });
    return { qty: q, winner: c.best?.processId || null, label: c.best?.label || '', each: c.best?.each ?? 0 };
  });
  const changes = [];
  for (let i = 1; i < points.length; i++) {
    if (points[i].winner && points[i].winner !== points[i - 1].winner) {
      changes.push({ from: points[i - 1], to: points[i] });
    }
  }
  return { points, changes };
}

export const QUANTITIES = [1, 10, 100, 1000, 10000];

/**
 * The design changes with the largest effect on price, ranked.
 *
 * Each is measured rather than asserted: the model is perturbed, re-costed, and
 * the saving reported. A suggestion that cannot demonstrate its own saving does
 * not belong in the list.
 */
export function levers(part, { batch = 1, rates = {} } = {}) {
  const base = compare(part, { batch, rates });
  if (!base.best) return [];
  const out = [];
  const test = (label, note, mutate) => {
    const alt = structuredClone(part);
    mutate(alt);
    const c = compare(alt, { batch, rates });
    if (!c.best) return;
    const saving = (base.best.each - c.best.each) / base.best.each;
    if (saving > 0.05) out.push({ label, note, saving, each: c.best.each, process: c.best.label });
  };

  test('Shrink the bounding box by 10%', 'Machining is billed on the block you start from, so the envelope matters more than the part.',
    (a) => { a.box = { x: a.box.x * 0.9, y: a.box.y * 0.9, z: a.box.z * 0.9 }; a.volume *= 0.729; });
  test('Hollow the part to 60% of its volume', 'Ribs and shells hold the same stiffness for a fraction of the material.',
    (a) => { a.volume *= 0.6; });
  if (part.material !== 'aluminium' && MATERIAL_PRICE[part.material] > MATERIAL_PRICE.aluminium) {
    test('Switch to aluminium', 'Cheaper per kilogram and faster to cut than most of what it replaces.',
      (a) => { a.material = 'aluminium'; });
  }
  if (batch === 1) {
    const ten = compare(part, { batch: 10, rates });
    if (ten.best && ten.best.each < base.best.each * 0.85) {
      out.push({
        label: 'Order ten instead of one',
        note: 'Setup and tooling are one-off costs; at a batch of one you are paying all of them yourself.',
        saving: (base.best.each - ten.best.each) / base.best.each,
        each: ten.best.each, process: ten.best.label,
      });
    }
  }
  return out.sort((a, b) => b.saving - a.saving);
}

/**
 * Build the costing input from a rebuilt document.
 * Bodies of different materials are costed separately and summed, which is what
 * a real quote does.
 */
export function partsFrom(doc, build, massPropsFor) {
  const parts = [];
  for (const f of build.topLevel) {
    const r = build.results.get(f.id);
    if (!r || r.error || !r.instances.length) continue;
    for (const inst of r.instances) {
      const mp = massPropsFor(inst.geometry, inst.matrix);
      if (!(mp.volume > 0)) continue;
      parts.push({
        name: f.name,
        featureId: f.id,
        material: f.material,
        volume: mp.volume,
        area: mp.area,
        box: { x: mp.size.x, y: mp.size.y, z: mp.size.z },
      });
    }
  }
  return parts;
}

/** Roll a whole document up into one estimate. */
export function costDocument(parts, { batch = 1, rates = {}, process = null } = {}) {
  const rows = parts.map((part) => {
    const c = process
      ? { ...costOne(part, process, { batch, rates }), label: PROCESSES[process].label, forced: true }
      : compare(part, { batch, rates }).best;
    return { part, cost: c };
  }).filter(r => r.cost);
  const each = rows.reduce((s, r) => s + r.cost.each, 0);
  const mass = rows.reduce((s, r) => s + r.part.volume * (MATERIALS[r.part.material] || MATERIALS.steel).density, 0);
  return { rows, each, total: each * Math.max(1, batch), mass, batch };
}
