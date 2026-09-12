/**
 * The fastener library.
 *
 * Almost every number here is from a standard, so almost every check is a
 * cross-reference against the published value rather than against this code's
 * own opinion. The one modelled figure is the tightening torque, and what is
 * checked there is that it is the standard formula and that it says so.
 */
import 'three';
globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.structuredClone ??= (o) => JSON.parse(JSON.stringify(o));

const F = await import('../../src/intel/fasteners.js');
const { makeFeature } = await import('../../src/core/doc.js');

let fails = 0;
const ok = (name, cond, extra = '') => { if (!cond) fails++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? '  - ' + extra : ''}`); };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

/* ---- ISO 724 pitches ---- */
ok('M3 coarse pitch is 0.5', F.METRIC.M3.pitch === 0.5);
ok('M6 is 1.0', F.METRIC.M6.pitch === 1.0);
ok('M8 is 1.25', F.METRIC.M8.pitch === 1.25);
ok('M10 is 1.5', F.METRIC.M10.pitch === 1.5);
ok('M12 is 1.75', F.METRIC.M12.pitch === 1.75);
ok('M20 is 2.5', F.METRIC.M20.pitch === 2.5);

/* ---- ISO 898-1 tensile stress areas ---- */
ok('M6 tensile stress area is 20.1 mm2', F.METRIC.M6.area === 20.1);
ok('M8 is 36.6', F.METRIC.M8.area === 36.6);
ok('M10 is 58.0', F.METRIC.M10.area === 58.0);
ok('M12 is 84.3', F.METRIC.M12.area === 84.3);
ok('M16 is 157', F.METRIC.M16.area === 157);
// Sanity: the stress area is smaller than the plain shank area, always.
ok('every stress area is below the shank area, as a thread requires',
  F.SIZES.every(s => F.METRIC[s].area < Math.PI * (F.METRIC[s].d / 2) ** 2),
  F.SIZES.filter(s => F.METRIC[s].area >= Math.PI * (F.METRIC[s].d / 2) ** 2).join(','));

/* ---- ISO 273 clearance holes ---- */
ok('M6 medium clearance is 6.6', F.holeFor('M6') === 6.6);
ok('M6 close is 6.4 and free is 7.0', F.holeFor('M6', 'close') === 6.4 && F.holeFor('M6', 'free') === 7.0);
ok('M8 medium is 9.0', F.holeFor('M8') === 9);
ok('M10 medium is 11', F.holeFor('M10') === 11);
ok('M12 medium is 13.5', F.holeFor('M12') === 13.5);
ok('M20 medium is 22', F.holeFor('M20') === 22);
ok('clearance always exceeds the bolt, and free always exceeds close',
  F.SIZES.every(s => F.holeFor(s, 'close') > F.METRIC[s].d && F.holeFor(s, 'free') > F.holeFor(s, 'close')));

/* ---- tapping drills ---- */
ok('M6 taps at 5.0', F.holeFor('M6', 'tapped') === 5);
ok('M8 taps at 6.8', F.holeFor('M8', 'tapped') === 6.8);
ok('M10 taps at 8.5', F.holeFor('M10', 'tapped') === 8.5);
ok('M4 taps at 3.3', F.holeFor('M4', 'tapped') === 3.3);
// A tapping drill is the pitch diameter, near enough: d - pitch.
ok('every tapping drill is about one pitch under the nominal, as it must be',
  F.SIZES.every(s => Math.abs(F.METRIC[s].tap - (F.METRIC[s].d - F.METRIC[s].pitch)) < 0.35),
  F.SIZES.filter(s => Math.abs(F.METRIC[s].tap - (F.METRIC[s].d - F.METRIC[s].pitch)) >= 0.35).join(','));
ok('an unknown size returns nothing rather than a guess', F.holeFor('M7') === null && F.holeFor('', 'tapped') === null);

/* ---- proof load, computed from the class ---- */
let s = F.spec('M8', { cls: '8.8' });
ok('M8 class 8.8 proof load is 21.2 kN', near(s.proofLoadN, 21228, 2), `${s.proofLoadN} N`);
ok('which is proof stress times stress area', near(s.proofLoadN, 580 * 36.6, 1));
ok('class 8.8 proof stress is 580', s.proofStress === 580);
ok('and its tensile strength 800', s.tensileStrength === 800);
ok('class 10.9 is stronger', F.spec('M8', { cls: '10.9' }).proofLoadN > s.proofLoadN);
ok('and A2 stainless is weaker than 8.8, which is the point people miss',
  F.spec('M8', { cls: 'A2' }).proofLoadN < s.proofLoadN,
  `${F.spec('M8', { cls: 'A2' }).proofLoadN} vs ${s.proofLoadN}`);
ok('the class note explains what it is for', /structural/.test(F.CLASSES['8.8'].note));

/* ---- torque: the modelled figure, with its assumptions attached ---- */
ok('M8 8.8 dry torque is about 31 Nm', near(s.torqueNm, 30.6, 0.2), `${s.torqueNm} Nm`);
ok('which is exactly K*F*d with K = 0.2 and F = 90% of proof',
  near(s.torqueNm, 0.2 * 0.9 * 21228 * 8 / 1000, 0.1));
ok('it states the formula and the friction assumption',
  /T = K·F·d/.test(s.torqueBasis) && /K = 0.2/.test(s.torqueBasis) && /nobody can promise/.test(s.torqueBasis));
const lub = F.spec('M8', { lubricated: true });
ok('lubricating it lowers the torque for the same preload', lub.torqueNm < s.torqueNm, `${lub.torqueNm} vs ${s.torqueNm}`);
ok('and says it is lubricated', /lubricated/.test(lub.torqueBasis));
ok('M10 torque exceeds M8, as diameter and area both grow',
  F.spec('M10').torqueNm > s.torqueNm, `${F.spec('M10').torqueNm} vs ${s.torqueNm}`);

/* ---- thread engagement ---- */
ok('minimum engagement is one diameter', s.minThreadEngagement === 8);
ok('and the note gives the real rule per material', /two in aluminium/.test(s.engagementNote));

/* ---- joint check ---- */
let j = F.checkJoint('M8', { load: 12000, count: 4, safety: 2 });
ok('12 kN on four M8 is 3 kN each', j.per === 3000, String(j.per));
ok('allowable is proof load over the safety factor', near(j.allowableN, 21228 / 2, 2), String(j.allowableN));
ok('so it passes comfortably', j.pass && j.utilisation < 0.5, `${(j.utilisation * 100).toFixed(1)}%`);
ok('and the verdict says so in words', j.verdict === 'Comfortable', j.verdict);
j = F.checkJoint('M4', { load: 40000, count: 2, safety: 2 });
ok('40 kN on two M4 fails', !j.pass && j.utilisation > 1, `${(j.utilisation * 100).toFixed(0)}%`);
ok('and is named as far over capacity', /over capacity/.test(j.verdict), j.verdict);
const sh = F.checkJoint('M8', { load: 12000, count: 4, shear: true, safety: 2 });
ok('shear capacity is 0.6 of tensile strength times area, per the standard',
  near(sh.capacityN, 0.6 * 800 * 36.6, 2), String(sh.capacityN));
ok('and the mode is reported', sh.mode === 'shear');
ok('every joint answer carries its caveat', /first-order/i.test(j.caveat) && /fatigue/.test(j.caveat));

/* ---- sizing backwards from a load ---- */
let pick = F.sizeFor({ load: 20000, count: 4, safety: 2 });
ok('20 kN over four bolts at safety 2 picks M6', pick.size === 'M6', pick?.designation);
ok('and the pick actually carries the load', pick.pass);
ok('the next size down would not', !F.checkJoint('M5', { load: 20000, count: 4, safety: 2 }).pass);
ok('a larger load picks a larger bolt',
  F.sizeFor({ load: 200000, count: 4 }).diameter > pick.diameter,
  `${F.sizeFor({ load: 200000, count: 4 }).size} for 200 kN vs ${pick.size} for 20 kN`);
ok('an impossible load returns nothing rather than the biggest bolt',
  F.sizeFor({ load: 1e9, count: 1 }) === null);

/* ---- identifying a measured hole ---- */
let id = F.identifyHole(6.6);
ok('a 6.6 hole is identified as M6 medium clearance',
  id[0].size === 'M6' && id[0].kind === 'medium' && id[0].error === 0, JSON.stringify(id[0]));
ok('a 5.0 hole is identified as an M6 tapping drill',
  F.identifyHole(5.0)[0].kind === 'tapped' && F.identifyHole(5.0)[0].size === 'M6',
  JSON.stringify(F.identifyHole(5.0)[0]));
ok('a measured 8.97 still reads as M8 medium, within tolerance',
  F.identifyHole(8.97)[0].size === 'M8' && F.identifyHole(8.97)[0].kind === 'medium',
  JSON.stringify(F.identifyHole(8.97)[0]));
ok('the closest match comes first', Math.abs(F.identifyHole(6.5)[0].error) <= Math.abs(F.identifyHole(6.5)[1].error));
ok('a hole that matches nothing standard says nothing rather than the nearest',
  F.identifyHole(19).length === 0, JSON.stringify(F.identifyHole(19)));

/* ---- geometry ---- */
const g = F.featuresFor('M8', { length: 30 }, makeFeature);
ok('a fastener becomes real features, not a symbol', g.features.length === 3);
ok('the shank is the bolt diameter', g.features[0].params.r === 4);
ok('the head is the standard head diameter', g.features[1].params.r === 13 / 2, String(g.features[1].params.r));
ok('the head sits at the end of the shank', g.features[1].transform.pos[2] === 30);
ok('and they are unioned into one body', g.features[2].type === 'boolean' && g.features[2].params.op === 'union');
ok('the union consumes both', g.features[2].inputs.length === 2);
ok('a stainless bolt is modelled in stainless',
  F.featuresFor('M8', { cls: 'A4' }, makeFeature).features[0].material === 'stainless');

/* ---- BOM ---- */
const row = F.bomRow('M8', { length: 30, qty: 12 });
ok('a BOM row names the part the way a purchase order needs',
  row.item === 'M8×30 8.8' && /ISO 4762/.test(row.description), row.item);
ok('it carries the torque, so the shop floor does not look it up', row.torqueNm === 30.6);
ok('and both hole sizes', row.clearanceHole === 9 && row.tappingDrill === 6.8);
ok('the line cost is the unit cost times quantity',
  near(row.lineCost, row.unitCost * 12, 0.01), `${row.unitCost} x 12 = ${row.lineCost}`);
const csv = F.fastenerCSV([row, F.bomRow('M6', { length: 20, qty: 4 })]);
ok('the CSV has a header and one line per row', csv.split('\n').length === 3);
ok('and quotes any field that needs it', !/[^"],[^,]*,[^,]*ISO 4762,/.test(csv.split('\n')[1]) || csv.includes('"'));
ok('an unknown size makes no BOM row', F.bomRow('M7') === null);

console.log(fails ? `\n${fails} FAILURES` : '\nALL FASTENER CHECKS PASS');
process.exit(fails ? 1 : 0);
